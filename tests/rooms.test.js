import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/index.js';

const candidate = (suffix = '') => ({ id: 'route' + suffix, title: '测试候选', stops: [], legs: [],
  commutes: [{ originIndex: 0, origin: { name: '局主私密地址', location: { lat: 31, lng: 121 } }, paths: [[{ lat: 31, lng: 121 }]], durationSeconds: 1200 },
    { originIndex: 1, origin: { name: '参与者私密地址' }, durationSeconds: 1800 }], returnCommutes: [], checks: { openingHours: 'unknown' } });

test('real HTTP flow: auth, isolation, one vote, version conflicts, rollback and history privacy', async t => {
  let calls = 0;
  const app = createApp({ planner: async (input, { onProgress }) => {
    const c = candidate(String(++calls)); onProgress({ stage: 'candidate', message: '找到候选', candidate: c });
    return { candidates: [c, { ...candidate('alt' + calls), title: '备选' }], warnings: ['待确认营业'] };
  } });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); return new Promise(resolve => app.close(resolve)); });
  const base = 'http://127.0.0.1:' + app.address().port;
  const request = async (path, method = 'GET', token, body) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, data: await response.json() };
  };
  const created = await request('/api/rooms', 'POST', null, { origins: ['局主私密地址', '参与者私密地址'], preference: '不要透露的地址', nickname: '局主' });
  assert.equal(created.status, 201);
  const { room, token } = created.data, path = '/api/rooms/' + room.id;
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path + '?memberId=' + room.hostId)).status, 401);
  assert.equal((await request(path + '/members', 'POST', null, { inviteToken: 'wrong' })).status, 403);
  const joined = await request(path + '/members', 'POST', null, { inviteToken: room.inviteToken, nickname: '参与者', origin: '参与者私密地址' });
  assert.equal(joined.status, 201);
  const participantToken = joined.data.token;
  assert.equal(JSON.stringify(joined.data.room).includes('局主私密地址'), false);
  assert.equal(JSON.stringify(joined.data.room).includes('不要透露的地址'), false);
  assert.equal('inviteToken' in joined.data.room, false);
  assert.equal((await request(path + '/generate', 'POST', participantToken, { baseVersionNo: 0 })).status, 403);
  assert.equal((await request(path + '/generate', 'POST', token, { baseVersionNo: 0 })).status, 202);
  const waitComplete = async () => {
    for (let n = 0; n < 50; n++) {
      const x = await request(path, 'GET', token);
      if (x.data.generation.status !== 'running') return x.data;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('generation did not finish');
  };
  let plan = await waitComplete(); assert.equal(plan.versionNo, 1);
  assert.equal(plan.candidates.length, 2); assert.equal(plan.voteCount, 0);
  const participantView = (await request(path, 'GET', participantToken)).data;
  assert.equal(JSON.stringify(participantView).includes('局主私密地址'), false);
  assert.equal(participantView.candidates[0].commutes[0].durationSeconds, 1200);
  assert.equal(participantView.candidates[0].commutes[0].paths, undefined);
  assert.equal(participantView.candidates[0].commutes[1].origin.name, '参与者私密地址');
  for (const c of plan.candidates) {
    const result = await request(path + '/votes', 'POST', participantToken, { candidateId: c.id, versionNo: 1 });
    assert.equal(result.data.voteCount, 1); assert.equal(result.data.myVote, c.id);
  }
  assert.equal((await request(path + '/votes', 'POST', participantToken, { candidateId: null, versionNo: 1 })).data.voteCount, 0);
  await request(path + '/comments', 'POST', participantToken, { candidateId: plan.candidates[0].id, versionNo: 1, body: '<img src=x onerror=alert(1)>希望安静些' });
  assert.equal((await request(path, 'GET', token)).data.comments.length, 1);
  assert.equal((await request(path + '/generate', 'POST', token, { baseVersionNo: 0 })).status, 409);
  for (let n = 1; n <= 6; n++) {
    await request(path + '/generate', 'POST', token, { baseVersionNo: n });
    plan = await waitComplete(); assert.equal(plan.versionNo, n + 1);
  }
  assert.equal(plan.history.length, 5); assert.equal(plan.comments.length, 0);
  const target = plan.history[0].versionNo;
  await request(path + '/rollback', 'POST', token, { baseVersionNo: plan.versionNo, versionNo: target });
  plan = await waitComplete(); assert.equal(plan.versionNo, 8); assert.equal(plan.rollbackOf, target);
  const historyView = (await request(path, 'GET', participantToken)).data;
  assert.equal(JSON.stringify(historyView).includes('局主私密地址'), false);
  assert.equal(JSON.stringify(historyView).includes('tokenHash'), false);
  assert.equal(JSON.stringify(historyView).includes(token), false);
});

test('failed generation preserves existing candidate round; unsafe upstream error is redacted', async t => {
  let first = true;
  const app = createApp({ planner: async () => {
    if (first) { first = false; return { candidates: [candidate('saved')], warnings: [] }; }
    throw Error('secret=DO_NOT_LEAK');
  } });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { app.closeAllConnections(); return new Promise(resolve => app.close(resolve)); });
  const base = 'http://127.0.0.1:' + app.address().port;
  const created = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origins: ['上海站'] }) }).then(r => r.json());
  const headers = { Authorization: 'Bearer ' + created.token, 'Content-Type': 'application/json' };
  await fetch(base + '/api/rooms/' + created.room.id + '/generate', { method: 'POST', headers, body: JSON.stringify({ baseVersionNo: 0 }) });
  await fetch(base + '/api/rooms/' + created.room.id + '/generate', { method: 'POST', headers, body: JSON.stringify({ baseVersionNo: 1 }) });
  const view = await fetch(base + '/api/rooms/' + created.room.id, { headers }).then(r => r.json());
  assert.equal(view.generation.status, 'failed'); assert.equal(view.versionNo, 1);
  assert.equal(view.candidates[0].id, 'routesaved');
  assert.equal(JSON.stringify(view).includes('DO_NOT_LEAK'), false);
});
