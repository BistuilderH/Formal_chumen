import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config, providerStatus } from './config.js';
import { ApiError, assert, safeError } from './errors.js';
import * as store from './store.js';
import { LlmProvider } from './llm-provider.js';
import { generateCandidates } from './planner.js';

async function readBody(req) {
  assert((req.headers['content-type'] || '').includes('application/json'), 415, 'CONTENT_TYPE', '请发送 JSON 请求');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    assert(size <= 32768, 413, 'BODY_TOO_LARGE', '请求内容过长');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    assert(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_JSON', '请求须为 JSON 对象');
    return body;
  } catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(400, 'INVALID_JSON', 'JSON 格式不正确'); }
}

export function createApp({ planner = generateCandidates, llm = new LlmProvider(), webOrigin = config.webOrigin } = {}) {
  const clients = new Map();
  let activePlans = 0;
  const origins = new Set(webOrigin.split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .map(origin => new URL(origin).origin));
  function reply(req, res, status, data) {
    const origin = req.headers.origin;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (origin && origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    res.writeHead(status, headers);
    res.end(status === 204 ? undefined : JSON.stringify(data));
  }
  function start(room, input, baseVersionNo, rollbackOf = null) {
    assert(activePlans < 4, 429, 'BUSY', '路线服务正在处理其他请求，请稍后再试');
    const plan = store.beginGeneration(room, input, baseVersionNo, rollbackOf);
    activePlans++;
    Promise.resolve().then(() => planner(input, { onProgress: event => store.generationProgress(room, event), signal: AbortSignal.timeout(90000) }))
      .then(result => {
        plan.warnings = result.warnings || [];
        store.finishGeneration(room, plan, result.candidates);
      })
      .catch(error => store.failGeneration(room, safeError(error)))
      .finally(() => { activePlans--; });
  }
  return http.createServer(async (req, res) => {
    try {
      if (req.headers.origin && !origins.has(req.headers.origin)) throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', '当前网页域名未在后端 WEB_ORIGIN 中配置');
      if (req.method === 'OPTIONS') return reply(req, res, 204);
      const url = new URL(req.url, 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.method === 'GET' && url.pathname === '/api/health') return reply(req, res, 200, { ok: true, service: 'chumen-api', apiVersion: 2, providers: providerStatus(), storage: 'memory' });
      if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'shares' && parts.length === 3) return reply(req, res, 200, store.getPublicShare(parts[2]));
      if (req.method === 'POST') {
        const now = Date.now();
        for (const [key, value] of clients) if (now > value.until) clients.delete(key);
        const address = req.socket.remoteAddress;
        const budget = clients.get(address) || { until: now + 60000, count: 0 };
        assert(++budget.count <= 40, 429, 'RATE_LIMIT', '请求过于频繁，请一分钟后重试');
        clients.set(address, budget);
      }
      if (req.method === 'POST' && url.pathname === '/api/preferences') {
        const body = await readBody(req);
        return reply(req, res, 200, await llm.normalizePreference(body.text));
      }
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        const result = store.createRoom(await readBody(req));
        return reply(req, res, 201, { room: store.publicRoom(result.room, result.host), token: result.token, memberId: result.host.id });
      }
      assert(parts[0] === 'api' && parts[1] === 'rooms' && parts[2], 404, 'NOT_FOUND', '接口不存在');
      const room = store.getRoom(parts[2]);
      if (req.method === 'POST' && parts.length === 4 && ['join', 'members'].includes(parts[3])) {
        const result = store.joinRoom(room, await readBody(req));
        return reply(req, res, 201, { room: store.publicRoom(room, result.member), token: result.token, memberId: result.member.id });
      }
      const auth = req.headers.authorization || '';
      const viewer = store.authenticate(room, auth.startsWith('Bearer ') ? auth.slice(7) : '');
      if (req.method === 'GET' && parts.length === 3) return reply(req, res, 200, store.publicRoom(room, viewer));
      if (req.method === 'POST' && parts.length === 4) {
        const body = await readBody(req);
        if (parts[3] === 'shares') return reply(req, res, 201, store.createPublicShare(room, viewer, body));
        if (parts[3] === 'votes') store.addVote(room, viewer, body);
        else if (parts[3] === 'comments') store.addComment(room, viewer, body);
        else if (['generate', 'regenerate', 'rollback'].includes(parts[3])) {
          store.requireHost(room, viewer);
          let input, rollbackOf = null;
          if (parts[3] === 'rollback') {
            const historical = room.history.find(p => p.versionNo === Number(body.versionNo));
            assert(historical, 404, 'VERSION_NOT_FOUND', '该历史版本不可回溯');
            input = structuredClone(historical.input); rollbackOf = historical.versionNo;
          } else input = store.normalizeInput(body.input || body, room.input);
          const newLimit = Number((body.input || body).memberLimit ?? room.memberLimit);
          assert(Number.isInteger(newLimit) && newLimit >= Math.max(room.members.length, input.origins.length) && newLimit <= 6,
            400, 'INVALID_INPUT', '人数上限须在现有成员和出发地数量以上，且不超过 6 人');
          start(room, input, body.baseVersionNo, rollbackOf);
          room.memberLimit = newLimit;
          return reply(req, res, 202, store.publicRoom(room, viewer));
        } else throw new ApiError(404, 'NOT_FOUND', '接口不存在');
        return reply(req, res, 200, store.publicRoom(room, viewer));
      }
      throw new ApiError(404, 'NOT_FOUND', '接口不存在');
    } catch (error) {
      const result = safeError(error);
      reply(req, res, result.status, { error: result.message, code: result.code });
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createApp();
  app.requestTimeout = 20000;
  app.listen(config.port, config.host, () => console.log('Chumen API listening on http://' + config.host + ':' + config.port));
}
