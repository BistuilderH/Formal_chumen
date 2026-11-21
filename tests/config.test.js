import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePort } from '../server/config.js';

test('invalid port values fall back to the configured default', () => {
  assert.equal(parsePort('8787'), 8787);
  assert.equal(parsePort('0'), 0);
  assert.equal(parsePort('https://api.example.com'), 8787);
  assert.equal(parsePort('70000'), 8787);
  assert.equal(parsePort('', 9000), 9000);
});
