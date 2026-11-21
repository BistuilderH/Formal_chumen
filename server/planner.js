import { randomUUID } from 'node:crypto';
import { MapProvider, MapProviderError } from './map-provider.js';

const defaultProvider = new MapProvider();
const radians = degrees => degrees * Math.PI / 180;
function straightDistance(a, b) {
  const dLat = radians(b.lat - a.lat), dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const midpoint = places => ({ lat: places.reduce((sum, p) => sum + p.location.lat, 0) / places.length, lng: places.reduce((sum, p) => sum + p.location.lng, 0) / places.length });
const strip = value => String(value || '').replace(/[\s()（）]/g, '').toLowerCase();
const publicError = error => error instanceof MapProviderError ? error.message : '地图查询失败，请稍后重试。';
const unique = values => [...new Set(values)];
const activityQuery = value => String(value).trim().replace(/\s*(?:\/|／|或)\s*/g, '$');

function category(value) {
  if (/ktv|卡拉|唱歌|歌舞/i.test(value)) return 'ktv';
  if (/diy|手作|手工|陶艺/i.test(value)) return 'diy';
  if (/酒吧|酒馆|bar|清吧/i.test(value)) return 'bar';
  if (/餐|美食|吃饭|火锅|料理|烧烤/.test(value)) return 'food';
  if (/台球/.test(value)) return 'billiard';
  if (/网吧|网咖/.test(value)) return 'internet';
  return null;
}

function stageMatches(place, activity) {
  const categories = String(activity).split(/\/|／|或|\$/).map(category).filter(Boolean);
  if (!categories.length) return true;
  const text = `${place.name} ${place.tag}`;
  return categories.some(kind => {
    if (kind === 'ktv') return /ktv|卡拉|唱歌/i.test(text);
    if (kind === 'diy') return /diy|手作|手工|陶艺/i.test(text);
    if (kind === 'bar') return /酒吧|酒馆|bar|清吧/i.test(text);
    if (kind === 'food') return /餐|美食|火锅|料理|烧烤|饭|面馆/.test(text);
    return category(text) === kind;
  });
}

async function resolvePlace(provider, query, city, signal) {
  const matches = await provider.searchPlaces({ query, city, signal });
  if (!matches.length) throw new MapProviderError(`未找到“${query}”，请补充门店或校区名称。`, 'PLACE_NOT_FOUND');
  return matches.find(place => strip(place.name) === strip(query)) || matches[0];
}

function emptyCommute(origin, originIndex, error) {
  return { originIndex, origin, mode: 'transit', durationSeconds: null, distanceMeters: null, paths: [], steps: [], accessCheck: 'unknown', warning: publicError(error) };
}

async function commute(provider, origin, destination, originIndex, input, signal, isReturn = false) {
  const from = isReturn ? destination : origin, to = isReturn ? origin : destination;
  try {
    const route = await provider.planRoute({ origin: from.location, destination: to.location, originUid: from.id, destinationUid: to.id, mode: 'transit', accessMinutes: input.accessMinutes, signal });
    const accessCheck = route.maxAccessSeconds === null ? 'unknown' : route.maxAccessSeconds <= input.accessMinutes * 60 ? 'passed' : 'failed';
    return { ...route, originIndex, origin, accessCheck };
  } catch (error) {
    if (signal?.aborted) throw error;
    // A nearby destination may have no meaningful transit service. Check the actual walking route.
    if (['BAIDU_1001', 'BAIDU_1003', 'NO_ROUTE'].includes(error.code)) {
      try {
        const walk = await provider.planRoute({ origin: from.location, destination: to.location, mode: 'walking', signal });
        return { ...walk, originIndex, origin, accessCheck: walk.durationSeconds <= input.accessMinutes * 60 ? 'passed' : 'failed' };
      } catch (walkError) { return emptyCommute(origin, originIndex, walkError); }
    }
    return emptyCommute(origin, originIndex, error);
  }
}

async function connect(provider, from, to, input, signal) {
  const params = { origin: from.location, destination: to.location, originUid: from.id, destinationUid: to.id, signal };
  let walkingError;
  let walk;
  try { walk = await provider.planRoute({ ...params, mode: 'walking' }); } catch (error) { walkingError = error; }
  if (walk && walk.durationSeconds <= input.walkMinutes * 60) return walk;
  try {
    const ride = await provider.planRoute({ ...params, mode: 'riding' });
    if (ride.durationSeconds <= input.rideMinutes * 60) return ride;
    return null;
  } catch (error) {
    if (walkingError) throw walkingError;
    if (!['NO_ROUTE', 'BAIDU_7'].includes(error.code)) throw error;
    return null;
  }
}

async function buildCandidate(provider, first, stages, origins, input, signal) {
  const stops = [{ ...first, activity: stages[0].activity }];
  const legs = [];
  for (let stageIndex = 1; stageIndex < stages.length; stageIndex += 1) {
    signal?.throwIfAborted();
    const stage = stages[stageIndex], previous = stops.at(-1);
    const results = stage.place ? [stage.place] : await provider.searchPlaces({ query: activityQuery(stage.activity), city: input.city, location: previous.location, radius: 1800, signal });
    const possible = results.filter(place => !stops.some(stop => stop.id === place.id) && (stage.place || stageMatches(place, stage.activity)))
      .sort((a, b) => straightDistance(previous.location, a.location) - straightDistance(previous.location, b.location));
    let chosen;
    for (const place of possible.slice(0, 3)) {
      const route = await connect(provider, previous, place, input, signal);
      if (route) { chosen = { place, route }; break; }
    }
    if (!chosen) return { rejection: `“${previous.name}”附近未找到满足步行 ${input.walkMinutes} 分钟或骑行 ${input.rideMinutes} 分钟的${stage.activity}。` };
    legs.push({ fromStopId: previous.id, toStopId: chosen.place.id, ...chosen.route });
    stops.push({ ...chosen.place, activity: stage.activity });
  }
  const [commutes, returnCommutes] = await Promise.all([
    Promise.all(origins.map((origin, index) => commute(provider, origin, stops[0], index, input, signal))),
    Promise.all(origins.map((origin, index) => commute(provider, origin, stops.at(-1), index, input, signal, true))),
  ]);
  const allCommutes = [...commutes, ...returnCommutes];
  if (allCommutes.some(route => route.accessCheck === 'failed')) return { rejection: `以“${first.name}”开场的路线存在超过 ${input.accessMinutes} 分钟的公交步行接驳，已排除。` };
  const commuteAccess = allCommutes.every(route => route.accessCheck === 'passed') ? 'passed' : 'unknown';
  const knownPrices = stops.filter(stop => stop.price !== null);
  const estimatedCost = knownPrices.length === stops.length ? Math.round(knownPrices.reduce((sum, stop) => sum + stop.price, 0) * 100) / 100 : null;
  const warnings = [
    '商家价格仅为百度参考价，实际消费、预约、营业与入场条件尚未核验；预算状态待确认。',
    '公交时间为当前查询估算；尚未核验活动日期的班次与结束活动后的返程末班车。',
    '各活动停留时长尚未确定，未验证开始和结束时间之间能否完成全部活动。',
  ];
  if (commuteAccess === 'unknown') warnings.push('部分往返通勤未查到完整接驳信息，不能据此确认可达。');
  if (estimatedCost !== null && estimatedCost > input.budgetPerPerson) warnings.push(`已知商家参考价合计约 ${Math.round(estimatedCost)} 元，超过人均预算 ${input.budgetPerPerson} 元。`);
  const roundTrips = origins.map((_, index) => commutes[index].durationSeconds === null || returnCommutes[index].durationSeconds === null ? null : commutes[index].durationSeconds + returnCommutes[index].durationSeconds);
  return {
    candidate: {
      id: randomUUID(), title: stops.map(stop => stop.name).join(' → '), stops, legs, commutes, returnCommutes,
      checks: { travel: 'passed', commuteAccess, budget: 'unknown', openingHours: 'unknown', schedule: 'unknown' },
      estimatedCost, knownPriceCount: knownPrices.length, warnings: unique([...warnings, ...allCommutes.map(route => route.warning).filter(Boolean)]),
      totalActivityTravelSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0),
      maxRoundTripSeconds: roundTrips.some(time => time === null) ? null : Math.max(...roundTrips),
      totalCommuteSeconds: roundTrips.some(time => time === null) ? null : roundTrips.reduce((sum, time) => sum + time, 0),
      source: 'baidu', coordinateSystem: 'bd09ll',
    },
  };
}

export async function generateCandidates(rawInput, { onProgress = () => {}, signal, provider = defaultProvider } = {}) {
  const input = {
    city: rawInput.city || '上海', originQueries: rawInput.originQueries || rawInput.origins || [], activities: rawInput.activities || [],
    specifiedPlaces: rawInput.specifiedPlaces || [], budgetPerPerson: Number(rawInput.budgetPerPerson) || 500,
    walkMinutes: Number(rawInput.walkMinutes) || 15, rideMinutes: Number(rawInput.rideMinutes) || 10,
    accessMinutes: Number(rawInput.accessMinutes) || 20,
  };
  if (!input.originQueries.length) throw new MapProviderError('至少需要一个出发地。', 'INVALID_INPUT');
  if (!input.activities.length && !input.specifiedPlaces.length) throw new MapProviderError('至少需要一个活动或指定店铺。', 'INVALID_INPUT');
  onProgress({ stage: 'locating', message: '正在核对出发地与指定店铺。' });
  const [origins, pinned] = await Promise.all([
    Promise.all(input.originQueries.map(query => resolvePlace(provider, query, input.city, signal))),
    Promise.all(input.specifiedPlaces.map(query => resolvePlace(provider, query, input.city, signal))),
  ]);
  const warnings = ['地点名称可能存在同名或分店，请在方案中核对实际地址。'];
  const stages = input.activities.map(activity => ({ activity }));
  for (const place of pinned) {
    const matching = stages.find(stage => !stage.place && stageMatches(place, stage.activity));
    if (matching) matching.place = place;
    else stages.push({ activity: '指定店铺', place });
  }
  onProgress({ stage: 'searching', message: '正在查找活动地点，随后校验真实步行与骑行路线。' });
  const center = midpoint(origins);
  const firstStage = stages[0];
  const firstPlaces = firstStage.place ? [firstStage.place] : (await provider.searchPlaces({ query: activityQuery(firstStage.activity), city: input.city, location: center, radius: 3500, signal }))
    .filter(place => stageMatches(place, firstStage.activity));
  if (!firstPlaces.length) return { candidates: [], warnings: [...warnings, `候选区域内未找到${firstStage.activity}，请更换活动或指定店铺。`] };
  const selected = firstPlaces.slice(0, 3);
  const candidates = [];
  const results = await Promise.allSettled(selected.map(async first => {
    const result = await buildCandidate(provider, first, stages, origins, input, signal);
    if (result.candidate) {
      candidates.push(result.candidate);
      onProgress({ stage: 'candidate', message: `已查到 ${candidates.length} 条真实候选；商家营业及完整日程仍待确认。`, candidate: result.candidate });
    }
    return result;
  }));
  signal?.throwIfAborted();
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.rejection) warnings.push(result.value.rejection);
    if (result.status === 'rejected') warnings.push(publicError(result.reason));
  }
  candidates.sort((a, b) => (a.maxRoundTripSeconds ?? Infinity) - (b.maxRoundTripSeconds ?? Infinity) || (a.totalCommuteSeconds ?? Infinity) - (b.totalCommuteSeconds ?? Infinity) || a.totalActivityTravelSeconds - b.totalActivityTravelSeconds);
  if (!candidates.length) warnings.push('当前搜索范围内未找到已验证的可行活动路线，请修改地点或时间限制后重试。');
  if (firstStage.place) warnings.push('首个地点为指定店铺，本轮优先保留该店；目前返回一条经核验的组合。');
  return { candidates, warnings: unique(warnings) };
}
