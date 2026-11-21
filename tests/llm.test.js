import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmProvider } from '../server/llm-provider.js';

function completion(value, finishReason = 'stop') {
  return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] }), { status: 200 });
}

test('extracts Chinese preferences using JSON output and only the official endpoint', async () => {
  let calls = 0;
  const provider = new LlmProvider({ apiKey: 'test-key', model: 'test-model', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const request = JSON.parse(options.body);
    assert.deepEqual(request.response_format, { type: 'json_object' });
    assert.equal(request.model, 'test-model');
    assert.equal(request.messages[1].content, '想做手工，再吃饭，安静些');
    assert.match(request.messages[0].content, /JSON/);
    assert.equal(request.stream, false);
    return completion({ activityQueries: [' 手工DIY ', '餐厅'], foodSearchTerms: ['清淡餐厅', '安静餐厅'], preferenceSummary: '先做手工再吃饭，偏好安静。' });
  } });
  const result = await provider.normalizePreference(' 想做手工，再吃饭，安静些 ');
  assert.equal(calls, 1);
  assert.deepEqual(result, { provider: 'deepseek', text: '想做手工，再吃饭，安静些', preferences: { activityQueries: ['手工DIY', '餐厅'], foodSearchTerms: ['清淡餐厅', '安静餐厅'], preferenceSummary: '先做手工再吃饭，偏好安静。' } });
});

test('missing key fails explicitly without a network call or demo fallback', async () => {
  const provider = new LlmProvider({ apiKey: '', fetchImpl: () => assert.fail('must not fetch') });
  await assert.rejects(provider.normalizePreference('吃饭'), { code: 'LLM_NOT_CONFIGURED', status: 503 });
});

test('rejects empty, non-string, and oversized input before calling the API', async () => {
  const provider = new LlmProvider({ apiKey: 'test-key', fetchImpl: () => assert.fail('must not fetch') });
  for (const input of ['', '   ', {}, '长'.repeat(2001)]) {
    await assert.rejects(provider.normalizePreference(input), { code: 'INVALID_PREFERENCE', status: 400 });
  }
});

test('timeout aborts the request and does not retry', async () => {
  let calls = 0;
  let signal;
  const provider = new LlmProvider({ apiKey: 'test-key', timeoutMs: 10, fetchImpl: async (_url, options) => {
    calls++;
    signal = options.signal;
    return new Promise(() => {});
  } });
  await assert.rejects(provider.normalizePreference('想做手工'), { code: 'LLM_TIMEOUT', status: 504 });
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('HTTP errors expose only the HTTP status, never upstream body or key', async () => {
  let calls = 0;
  const provider = new LlmProvider({ apiKey: 'secret-never-print', fetchImpl: async () => {
    calls++;
    return new Response('upstream secret-never-print private response', { status: 401 });
  } });
  await assert.rejects(provider.normalizePreference('吃饭'), error => {
    assert.equal(error.code, 'LLM_HTTP_ERROR');
    assert.equal(error.upstreamStatus, 401);
    assert.equal(error.message, '模型服务请求失败（HTTP 401）。');
    assert.doesNotMatch(error.message, /secret|private|https:/);
    return true;
  });
  assert.equal(calls, 1);
});

test('network errors do not expose raw error messages', async () => {
  const provider = new LlmProvider({ apiKey: 'test-key', fetchImpl: async () => { throw new Error('https://unsafe/?key=secret'); } });
  await assert.rejects(provider.normalizePreference('吃饭'), { code: 'LLM_NETWORK_ERROR', message: '暂时无法连接模型服务，请稍后重试。' });
});

test('invalid JSON, truncated content, and invalid schema are rejected', async t => {
  const cases = [
    ['malformed JSON', () => completion('{oops')],
    ['invalid outer JSON', () => new Response('{oops', { status: 200 })],
    ['missing content', () => new Response('{}', { status: 200 })],
    ['truncated completion', () => completion({ preferenceSummary: '吃饭' }, 'length')],
    ['array root', () => completion([])],
    ['missing summary', () => completion({ activityQueries: ['餐厅'] })],
    ['unknown fields', () => completion({ preferenceSummary: '吃饭', inventedShop: '某网红店' })],
    ['oversized summary', () => completion({ preferenceSummary: '长'.repeat(301) })],
    ['empty query', () => completion({ preferenceSummary: '吃饭', activityQueries: [''] })],
    ['nonstring query', () => completion({ preferenceSummary: '吃饭', activityQueries: [1] })],
    ['oversized query', () => completion({ preferenceSummary: '吃饭', activityQueries: ['长'.repeat(41)] })],
    ['too many queries', () => completion({ preferenceSummary: '吃饭', activityQueries: Array(7).fill('餐厅') })],
    ['too many food terms', () => completion({ preferenceSummary: '清淡', foodSearchTerms: Array(5).fill('清淡餐厅') })],
  ];
  for (const [name, response] of cases) {
    await t.test(name, async () => {
      const provider = new LlmProvider({ apiKey: 'test-key', fetchImpl: async () => response() });
      await assert.rejects(provider.normalizePreference('吃饭'), { code: 'LLM_INVALID_RESPONSE', status: 502 });
    });
  }
});

test('summary-only preferences are supported when no activities are specified', async () => {
  const provider = new LlmProvider({ apiKey: 'test-key', fetchImpl: async () => completion({ preferenceSummary: '偏好安静。' }) });
  assert.deepEqual((await provider.normalizePreference('安静些')).preferences, { preferenceSummary: '偏好安静。' });
});
