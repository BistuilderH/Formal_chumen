import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

// Platform variables take priority over local development values.
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function parsePort(value, fallback = 8787) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback;
  const requestedPort = Number(value);
  return Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort < 65536
    ? requestedPort
    : fallback;
}

const port = parsePort(process.env.PORT);

export const config = {
  port,
  host: process.env.HOST || '127.0.0.1',
  webOrigin: process.env.WEB_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173',
  baiduMapAuthToken: process.env.BAIDU_MAP_AUTH_TOKEN || '',
  baiduMapServerAk: process.env.BAIDU_MAP_SERVER_AK || '',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
};

export function providerStatus() {
  return {
    baiduWebApi: { configured: Boolean(config.baiduMapServerAk), implemented: true },
    llm: { configured: Boolean(config.deepseekApiKey), implemented: true },
    mapAgent: { configured: Boolean(config.baiduMapAuthToken), implemented: false },
    storage: 'memory',
  };
}
