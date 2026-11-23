// @generated
// 高德 Web 服务 API 代理：POI 搜索 / 逆地理 / 路径规划（key 只在服务端，5 分钟缓存 + 限流）
import fs from 'node:fs';

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 400;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 90;

export class AmapError extends Error {
  constructor(message, status = 502, code = 'amap_error') {
    super(message);
    this.name = 'AmapError';
    this.status = status;
    this.code = code;
  }
}

const cache = new Map();
const callTimes = [];

const DIRECTIONS = new Set(['driving', 'walking', 'riding']);
const LOCATION_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

function parseLocation(value) {
  if (!value || !LOCATION_RE.test(value)) return null;
  return value.split(',').map(Number);
}

function stripTags(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function mergePolyline(steps) {
  const path = [];
  for (const step of steps) {
    const raw = step.polyline || '';
    for (const pair of raw.split(';')) {
      const point = parseLocation(pair);
      if (!point) continue;
      const last = path[path.length - 1];
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      path.push(point);
    }
  }
  return path;
}

function cachePut(key, data) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), data });
}

export function createAmapClient({ secretsFile, fetchImpl = globalThis.fetch }) {
  function readKey() {
    if (process.env.MAP_AMAP_WS_KEY) return process.env.MAP_AMAP_WS_KEY;
    try {
      const secrets = JSON.parse(fs.readFileSync(secretsFile, 'utf8'));
      return secrets?.amap?.webServiceKey || null;
    } catch {
      return null;
    }
  }

  function assertRate() {
    const now = Date.now();
    while (callTimes.length && now - callTimes[0] > RATE_WINDOW_MS) callTimes.shift();
    if (callTimes.length >= RATE_MAX) {
      throw new AmapError('请求太频繁，请稍后再试', 429, 'amap_rate_limited');
    }
    callTimes.push(now);
  }

  async function call(pathname, params) {
    const key = readKey();
    if (!key) throw new AmapError('服务端未配置高德 Web 服务 key', 503, 'amap_key_missing');

    const cacheKey = pathname + '?' + new URLSearchParams(params).toString();
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

    assertRate();
    const query = new URLSearchParams({ ...params, key }).toString();
    let res;
    try {
      res = await fetchImpl(`https://restapi.amap.com${pathname}?${query}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      throw new AmapError(`高德接口网络错误：${err.message}`, 502, 'amap_network_error');
    }
    if (!res.ok) throw new AmapError(`高德接口 HTTP ${res.status}`, 502, 'amap_http_error');

    const data = await res.json().catch(() => null);
    if (!data) throw new AmapError('高德接口返回非 JSON', 502, 'amap_bad_json');
    if (data.status !== '1') {
      throw new AmapError(`高德接口错误：${data.info || 'unknown'}（${data.infocode || '-'}）`, 502, 'amap_api_error');
    }

    cachePut(cacheKey, data);
    return data;
  }

  async function searchPoi({ keywords, city = '广州' }) {
    const data = await call('/v3/place/text', {
      keywords,
      city,
      offset: '20',
      page: '1',
      extensions: 'base',
    });
    return (data.pois || [])
      .filter((poi) => poi.location)
      .map((poi) => ({
        id: poi.id,
        name: poi.name,
        address: typeof poi.address === 'string' ? poi.address : '',
        adname: poi.adname || '',
        type: poi.type || '',
        location: parseLocation(poi.location),
      }));
  }

  async function regeo({ location }) {
    const data = await call('/v3/geocode/regeo', { location, extensions: 'base' });
    const rc = data.regeocode || {};
    return {
      address: rc.formatted_address || '',
      pois: (rc.pois || []).slice(0, 3).map((poi) => ({
        name: poi.name,
        address: typeof poi.address === 'string' ? poi.address : '',
        location: parseLocation(poi.location),
      })),
    };
  }

  async function route({ mode = 'driving', origin, destination, waypoints = '' }) {
    const safeMode = DIRECTIONS.has(mode) ? mode : 'driving';
    const params = { origin, destination, extensions: 'base' };
    if (safeMode === 'driving' && waypoints) params.waypoints = waypoints;

    const data = await call(`/v3/direction/${safeMode}`, params);
    const path = data.route?.paths?.[0];
    if (!path) throw new AmapError('没有找到可用路线', 404, 'amap_no_route');

    const steps = (path.steps || []).map((step) => ({
      instruction: stripTags(step.instruction),
      distance: Number(step.distance) || 0,
      duration: Number(step.duration) || 0,
    }));
    const duration = Number(path.duration) || steps.reduce((sum, s) => sum + s.duration, 0);
    return {
      mode: safeMode,
      distance: Number(path.distance) || 0,
      duration,
      steps,
      polyline: mergePolyline(path.steps || []),
    };
  }

  return { searchPoi, regeo, route };
}
