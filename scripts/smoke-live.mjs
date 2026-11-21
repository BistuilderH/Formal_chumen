// Opt-in real API smoke test: consumes a small number of Baidu/DeepSeek requests.
// Uses public Shanghai landmarks; never prints credentials or raw HTTP errors.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../server/config.js';

const base = `http://127.0.0.1:${config.port}`;
async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(base + '/api' + path, {
    method, headers: { Origin: 'http://localhost:5173', ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  assert(response.ok, `API status ${response.status}, code ${result.code || 'unknown'}`);
  return result;
}

try {
  const health = await request('/health'); assert.equal(health.apiVersion, 2);
  const created = await request('/rooms', { method: 'POST', body: {
    nickname: '联调局主', city: '上海', origins: ['上海交通大学（徐汇校区）', '上海火车站'],
    activities: ['DIY手作/KTV', '餐厅', '酒吧'], date: '2026-09-30', meetTime: '15:00', endTime: '22:00',
    walkMinutes: 15, rideMinutes: 10, accessMinutes: 20, budgetPerPerson: 500,
  } });
  const path = '/rooms/' + created.room.id;
  const started = Date.now();
  let firstCandidateMs;
  let room = await request(path + '/generate', { method: 'POST', token: created.token, body: { baseVersionNo: 0 } });
  while (room.generation.status === 'running' && Date.now() - started < 95000) {
    await delay(500);
    room = await request(path, { token: created.token });
    if (firstCandidateMs === undefined && (room.generation.candidates?.length || room.candidates.length)) firstCandidateMs = Date.now() - started;
  }
  assert.equal(room.generation.status, 'complete', room.generation.code || 'not complete');
  assert(room.candidates.length > 0 && room.candidates.length <= 3);
  assert(room.candidates.every(c => c.source === 'baidu' && c.stops.every(s => s.source === 'baidu')));
  const route = room.candidates[0];
  const generatedMs = Date.now() - started;
  const joined = await request(path + '/members', { method: 'POST', body: { nickname: '联调成员', inviteToken: room.inviteToken, origin: '上海火车站' } });
  assert(!JSON.stringify(joined.room).includes('tokenHash'));
  assert(!JSON.stringify(joined.room).includes('上海交通大学'));
  const voted = await request(path + '/votes', { method: 'POST', token: joined.token, body: { candidateId: route.id, versionNo: room.versionNo } });
  assert.equal(voted.voteCount, 1);
  const commented = await request(path + '/comments', { method: 'POST', token: joined.token, body: { candidateId: route.id, versionNo: room.versionNo, body: '真实接口联调留言' } });
  assert.equal(commented.comments.length, 1);
  let llm = 'not configured';
  if (health.providers.llm.configured) {
    const result = await request('/preferences', { method: 'POST', body: { text: '想做手工，吃饭，再去酒吧，希望安静一些' } });
    assert.equal(result.provider, 'deepseek'); assert(result.preferences.preferenceSummary); llm = 'passed';
  }
  console.log(JSON.stringify({ health: 'passed', room: 'passed', baidu: 'passed', candidates: room.candidates.length,
    firstCandidateMs, generatedMs, activityNames: route.stops.map(s => s.name), checks: route.checks,
    roadPaths: route.legs.reduce((n, leg) => n + leg.paths.length, 0), vote: 'passed', comment: 'passed', privacy: 'passed', deepseek: llm }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ passed: false, error: error instanceof assert.AssertionError ? error.message : 'Live API request failed; no raw error or credentials logged.' }));
  process.exitCode = 1;
}
