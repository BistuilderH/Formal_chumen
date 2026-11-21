import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config.js';

// Official docs: https://lbs.baidu.com/docs/webapi?title=placev3/guide/webservice-placeapiV3/interfaceDocumentV2
// https://lbs.baidu.com/docs/webapi?title=directionlite/guide/webservice-lwrouteplanapi/transit
const API_ORIGIN = 'https://api.map.baidu.com';
const ERROR_MESSAGES = {
  3: '百度地图权限校验失败，请检查服务端 AK。', 4: '百度地图调用配额不足。',
  5: '百度地图服务端 AK 无效。', 7: '百度地图未找到可用路线。',
  9: '百度地图当前接口权限未开通。', 101: '百度地图缺少服务端 AK。',
  200: '百度地图服务端 AK 无效。', 203: '百度 AK 类型不正确，请使用服务端 AK。',
  210: '百度地图服务端 IP 校验失败。', 211: '百度地图服务端 SN 校验失败。',
  240: '请在百度控制台为该 AK 开通对应的地点或轻量路线服务。',
  302: '百度地图今日配额已用完。', 401: '百度地图请求过于频繁，请稍后再试。',
  1001: '百度地图未找到公交方案。', 1002: '当前轻量公交接口不支持跨城路线。',
  1003: '起终点附近未找到可用公交路线。',
};

export class MapProviderError extends Error {
  constructor(message, code = 'MAP_ERROR') { super(message); this.name = 'MapProviderError'; this.code = String(code); }
}
const numberOrNull = value => value === '' || value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const cleanText = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').slice(0, 600) : '';
const coordinate = value => {
  const lat = numberOrNull(value?.lat), lng = numberOrNull(value?.lng);
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
};
const coordinateText = value => {
  const point = coordinate(value);
  if (!point) throw new MapProviderError('地点坐标无效。', 'INVALID_COORDINATE');
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
};

export function normalizePlace(place) {
  const location = coordinate(place.location);
  if (!location || !place.uid || !place.name) return null;
  const detail = place.detail_info || {};
  const price = numberOrNull(detail.price);
  return {
    id: String(place.uid), name: cleanText(place.name), address: cleanText(place.address), location,
    area: cleanText(place.area), city: cleanText(place.city), tag: cleanText(detail.tag || detail.classified_poi_tag),
    price: price !== null && price > 0 ? price : null, openingHours: cleanText(detail.shop_hours) || null,
    rating: numberOrNull(detail.overall_rating), commentCount: numberOrNull(detail.comment_num),
    source: 'baidu', coordinateSystem: 'bd09ll',
  };
}

const pathPoints = path => typeof path === 'string' ? path.split(';').map(pair => {
  const [lng, lat] = pair.split(','); return coordinate({ lat, lng });
}).filter(Boolean) : [];

export function normalizeRoute(route, mode) {
  const durationSeconds = numberOrNull(route.duration), distanceMeters = numberOrNull(route.distance);
  if (durationSeconds === null || durationSeconds < 0 || distanceMeters === null || distanceMeters < 0) return null;
  // Transit steps are arrays of alternatives. Concatenating alternatives creates a fictional route.
  const rawSteps = (route.steps || []).map(step => Array.isArray(step) ? step[0] : step).filter(Boolean);
  const steps = rawSteps.map(step => ({
    mode: mode === 'transit' ? (Number(step.type) === 5 ? 'walking' : Number(step.type) === 3 ? 'transit' : 'other') : mode,
    durationSeconds: numberOrNull(step.duration), distanceMeters: numberOrNull(step.distance),
    instruction: cleanText(step.instruction || step.instructions), start: coordinate(step.start_location), end: coordinate(step.end_location),
    path: pathPoints(step.path), lineName: cleanText(step.vehicle?.name),
    startStation: cleanText(step.vehicle?.start_name), endStation: cleanText(step.vehicle?.end_name),
  }));
  const walkingSegments = [];
  let walkingSeconds = 0, walkingKnown = true, hadWalking = false;
  for (const step of steps) {
    if (step.mode === 'walking') {
      hadWalking = true;
      if (step.durationSeconds === null) walkingKnown = false;
      else walkingSeconds += step.durationSeconds;
    } else if (hadWalking) { walkingSegments.push(walkingSeconds); walkingSeconds = 0; hadWalking = false; }
  }
  if (hadWalking) walkingSegments.push(walkingSeconds);
  return {
    mode, durationSeconds, distanceMeters, paths: steps.map(step => step.path).filter(path => path.length > 1), steps,
    fare: mode === 'transit' ? numberOrNull(route.price) : null,
    maxAccessSeconds: mode === 'transit' && steps.length && walkingKnown ? Math.max(0, ...walkingSegments) : null,
    source: 'baidu', coordinateSystem: 'bd09ll', verifiedAt: new Date().toISOString(),
  };
}

export class MapProvider {
  constructor({ ak = config.baiduMapServerAk, fetchImpl = globalThis.fetch, timeoutMs = 8000, minIntervalMs = 180, concurrency = 3, cacheTtlMs = 120000 } = {}) {
    Object.assign(this, { ak, fetchImpl, timeoutMs, minIntervalMs, concurrency, cacheTtlMs });
    this.cache = new Map(); this.active = 0; this.waiting = []; this.nextStart = 0;
  }

  async request(path, params, signal) {
    if (!this.ak) throw new MapProviderError('尚未配置 BAIDU_MAP_SERVER_AK。', 'MAP_NOT_CONFIGURED');
    signal?.throwIfAborted();
    const cacheKey = JSON.stringify([path, params]);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return structuredClone(cached.data);
    if (this.active >= this.concurrency) await new Promise(resolve => this.waiting.push(resolve));
    else this.active += 1;
    try {
      signal?.throwIfAborted();
      const pause = Math.max(0, this.nextStart - Date.now());
      this.nextStart = Date.now() + pause + this.minIntervalMs;
      if (pause) await delay(pause, undefined, { signal });
      const url = new URL(path, API_ORIGIN);
      url.search = new URLSearchParams({ ...params, ak: this.ak });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const timeout = AbortSignal.timeout(this.timeoutMs);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        let data;
        try {
          const response = await this.fetchImpl(url, { signal: requestSignal, redirect: 'error' });
          if (!response.ok) throw new MapProviderError(`百度地图服务暂不可用（HTTP ${response.status}）。`, 'MAP_HTTP_ERROR');
          data = await response.json();
        } catch (error) {
          if (signal?.aborted) throw new MapProviderError('已取消地图查询。', 'ABORTED');
          if (timeout.aborted) throw new MapProviderError('百度地图查询超时，请稍后重试。', 'MAP_TIMEOUT');
          if (error instanceof MapProviderError) throw error;
          // Never propagate fetch errors: their causes can contain the AK-bearing URL.
          throw new MapProviderError('无法连接百度地图服务。', 'MAP_NETWORK_ERROR');
        }
        if (Number(data.status) === 401 && attempt === 0) { await delay(600, undefined, { signal }); continue; }
        if (Number(data.status) !== 0) throw new MapProviderError(ERROR_MESSAGES[data.status] || `百度地图请求失败（状态 ${Number(data.status) || '未知'}）。`, `BAIDU_${Number(data.status) || 'UNKNOWN'}`);
        if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(cacheKey, { data, expires: Date.now() + this.cacheTtlMs });
        return structuredClone(data);
      }
    } finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active -= 1;
    }
  }

  async searchPlaces({ query, city = '上海', location, radius = 2000, signal } = {}) {
    if (typeof query !== 'string' || !query.trim()) throw new MapProviderError('请输入需要检索的地点。', 'INVALID_QUERY');
    const params = { query: query.trim().slice(0, 80), output: 'json', scope: '2', page_size: '10', page_num: '0', coord_type: '3' };
    if (location) Object.assign(params, { location: coordinateText(location), radius: String(Math.max(100, Math.min(10000, radius))), radius_limit: 'true', filter: 'sort_name:distance|sort_rule:1' });
    else Object.assign(params, { region: city, city_limit: 'true' });
    const data = await this.request('/place/v2/search', params, signal);
    return (data.results || []).map(normalizePlace).filter(Boolean);
  }

  async planRoute({ origin, destination, mode = 'walking', accessMinutes = 20, originUid, destinationUid, signal } = {}) {
    if (!['walking', 'riding', 'transit'].includes(mode)) throw new MapProviderError('不支持该交通方式。', 'INVALID_MODE');
    const params = { origin: coordinateText(origin), destination: coordinateText(destination), coord_type: 'bd09ll', ret_coordtype: 'bd09ll', steps_info: '1' };
    if (mode === 'riding') params.riding_type = '0';
    if (originUid) params.origin_uid = originUid;
    if (destinationUid) params.destination_uid = destinationUid;
    const data = await this.request(`/directionlite/v1/${mode}`, params, signal);
    const routes = (data.result?.routes || []).map(route => normalizeRoute(route, mode)).filter(Boolean).sort((a, b) => a.durationSeconds - b.durationSeconds);
    if (!routes.length) throw new MapProviderError('百度地图未返回可用路线。', 'NO_ROUTE');
    if (mode === 'transit') return routes.find(route => route.maxAccessSeconds !== null && route.maxAccessSeconds <= accessMinutes * 60) || routes[0];
    return routes[0];
  }
}
