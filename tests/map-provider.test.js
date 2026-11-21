import test from 'node:test';
import assert from 'node:assert/strict';
import { MapProvider, normalizePlace, normalizeRoute } from '../server/map-provider.js';
import { generateCandidates } from '../server/planner.js';

const response = body => ({ ok: true, status: 200, json: async () => body });

test('POI normalization preserves missing information rather than treating zero as a price', () => {
  const poi = normalizePlace({ uid: 'p', name: '餐厅', location: { lat: 31, lng: 121 }, detail_info: { price: '0' } });
  assert.equal(poi.price, null);
  assert.equal(poi.openingHours, null);
  assert.equal(poi.coordinateSystem, 'bd09ll');
  assert.equal(normalizePlace({ uid: 'bad', name: 'bad', location: { lat: '', lng: 121 } }), null);
});

test('transit alternative steps are not concatenated and adjacent access segments are summed', () => {
  const walking = duration => ({ type: 5, duration, distance: 100, path: '121,31;121.001,31.001' });
  const result = normalizeRoute({ duration: 1600, distance: 4000, steps: [
    [walking(700), walking(10)], [walking(600)], [{ type: 3, duration: 200, distance: 3800 }], [walking(100)],
  ] }, 'transit');
  assert.equal(result.steps.length, 4);
  assert.equal(result.maxAccessSeconds, 1300);
  assert.equal(result.paths.length, 3);
  assert.deepEqual(result.paths[0][0], { lat: 31, lng: 121 });
  const unknown = normalizeRoute({ duration: 100, distance: 20, steps: [[{ type: 5 }]] }, 'transit');
  assert.equal(unknown.maxAccessSeconds, null);
});

test('API requests use HTTPS official host, coordinate order, and bounded cache', async () => {
  const calls = [];
  const provider = new MapProvider({ ak: 'private-test-key', minIntervalMs: 0, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response({ status: 0, results: [{ uid: 'p', name: '店', location: { lat: 31, lng: 121 } }] });
  } });
  const input = { query: 'KTV', location: { lat: 31.2, lng: 121.4 }, radius: 1500 };
  const first = await provider.searchPlaces(input);
  first[0].name = 'mutated';
  const second = await provider.searchPlaces(input);
  assert.equal(second[0].name, '店');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, 'https://api.map.baidu.com');
  assert.equal(calls[0].url.searchParams.get('location'), '31.200000,121.400000');
  assert.equal(calls[0].url.searchParams.get('radius_limit'), 'true');
  assert.equal(calls[0].options.redirect, 'error');
});

test('upstream messages and request URLs never leak through errors', async () => {
  for (const fetchImpl of [async () => { throw new Error('https://api.map.baidu.com?ak=private-test-key'); }, async () => response({ status: 210, message: 'private-test-key' })]) {
    const provider = new MapProvider({ ak: 'private-test-key', minIntervalMs: 0, fetchImpl });
    await assert.rejects(() => provider.searchPlaces({ query: '店' }), error => {
      assert.ok(!error.message.includes('private-test-key'));
      assert.ok(!error.message.includes('https://'));
      return true;
    });
  }
});

test('transit selects a slower alternative if the fastest violates access limit', async () => {
  const route = (duration, access) => ({ duration, distance: 1000, steps: [[{ type: 5, duration: access }], [{ type: 3, duration: 100 }]] });
  const provider = new MapProvider({ ak: 'key', minIntervalMs: 0, fetchImpl: async () => response({ status: 0, result: { routes: [route(1000, 1300), route(1500, 500)] } }) });
  const result = await provider.planRoute({ origin: { lat: 31, lng: 121 }, destination: { lat: 31.1, lng: 121 }, mode: 'transit' });
  assert.equal(result.durationSeconds, 1500);
  assert.equal(result.maxAccessSeconds, 500);
});

const poi = (id, name, tag, lng = 121) => ({ id, name, tag, address: '测试公开地点', location: { lat: 31, lng }, price: null, openingHours: null, source: 'baidu' });
const places = { origin: poi('origin', '公共车站', '车站'), KTV: poi('ktv', '测试KTV', 'KTV', 121.001), 餐厅: poi('food', '测试餐厅', '餐厅', 121.002), 酒吧: poi('bar', '测试酒吧', '酒吧', 121.003) };
function fakeProvider({ impossible = false, missingCommute = false } = {}) {
  return {
    searchPlaces: async ({ query }) => [places[query] || places.origin],
    planRoute: async ({ mode }) => {
      if (mode === 'transit' && missingCommute) throw new Error('private data');
      return { mode, durationSeconds: impossible && mode !== 'transit' ? 2000 : 300, distanceMeters: 400, paths: [[{ lat: 31, lng: 121 }, { lat: 31.1, lng: 121.1 }]], steps: [], maxAccessSeconds: 300, source: 'baidu' };
    },
  };
}
const input = { city: '上海', originQueries: ['公共车站'], activities: ['KTV', '餐厅', '酒吧'], walkMinutes: 15, rideMinutes: 10 };

test('planner streams real candidate shape and never certifies unknown budget or hours', async () => {
  const events = [];
  const result = await generateCandidates(input, { provider: fakeProvider(), onProgress: event => events.push(event) });
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.checks.travel, 'passed');
  assert.equal(candidate.checks.budget, 'unknown');
  assert.equal(candidate.checks.openingHours, 'unknown');
  assert.equal(candidate.checks.schedule, 'unknown');
  assert.equal(candidate.estimatedCost, null);
  assert.equal(candidate.commutes[0].originIndex, 0);
  assert.equal(candidate.commutes[0].durationSeconds, 300);
  assert.ok(events.some(event => event.stage === 'candidate'));
  assert.equal(candidate.originQueries, undefined);
});

test('planner excludes impossible activity legs rather than inventing an itinerary', async () => {
  const result = await generateCandidates(input, { provider: fakeProvider({ impossible: true }) });
  assert.equal(result.candidates.length, 0);
  assert.ok(result.warnings.some(warning => warning.includes('15')));
});

test('failed commute is explicitly unknown, with no invented duration or raw error', async () => {
  const result = await generateCandidates(input, { provider: fakeProvider({ missingCommute: true }) });
  const candidate = result.candidates[0];
  assert.equal(candidate.checks.commuteAccess, 'unknown');
  assert.equal(candidate.commutes[0].durationSeconds, null);
  assert.ok(!JSON.stringify(candidate).includes('private data'));
});

test('a user-specified restaurant remains in the restaurant stage', async () => {
  const provider = fakeProvider();
  const ordinarySearch = provider.searchPlaces;
  provider.searchPlaces = async args => args.query === '必去餐厅' ? [poi('pinned', '必去餐厅', '餐厅', 121.002)] : ordinarySearch(args);
  const result = await generateCandidates({ ...input, specifiedPlaces: ['必去餐厅'] }, { provider });
  assert.equal(result.candidates[0].stops[1].id, 'pinned');
});

test('food preferences are included in restaurant POI searches while activity order stays intact', async () => {
  const provider = fakeProvider();
  const queries = [];
  const searchPlaces = provider.searchPlaces;
  provider.searchPlaces = async args => { queries.push(args.query); return searchPlaces(args); };
  await generateCandidates({ ...input, activities: ['KTV', '餐厅'], preferenceSearchTerms: ['清淡餐厅', '粤菜'] }, { provider });
  assert.ok(queries.includes('餐厅 清淡餐厅 粤菜'));
  assert.ok(queries.includes('KTV'));
});
