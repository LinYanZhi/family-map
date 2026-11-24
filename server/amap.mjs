// @generated
// 高德 Web 服务 API 代理：POI 搜索 / 逆地理 / 路径规划
// key 只在服务端；内存 + 磁盘持久缓存（按接口设不同 TTL）+ 每分钟限流
import fs from 'node:fs';
import path from 'node:path';

const CACHE_MAX = 600;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 90;
const MIN_OUTBOUND_INTERVAL_MS = 350; // 高德个人 key 有 QPS 限制，串行 + 间隔最稳

// 不同接口的缓存时长：POI 一天、逆地理七天、路线三十分钟（路况会变）
const TTL_RULES = [
  { prefix: '/v3/place/polygon', ttl: 24 * 3600 * 1000 },
  { prefix: '/v3/place/text', ttl: 24 * 3600 * 1000 },
  { prefix: '/v3/geocode/regeo', ttl: 7 * 24 * 3600 * 1000 },
  { prefix: '/v3/direction/', ttl: 30 * 60 * 1000 },
];
const DEFAULT_TTL = 5 * 60 * 1000;

export class AmapError extends Error {
  constructor(message, status = 502, code = 'amap_error') {
    super(message);
    this.name = 'AmapError';
    this.status = status;
    this.code = code;
  }
}

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
  const pathPoints = [];
  for (const step of steps) {
    for (const pair of String(step.polyline || '').split(';')) {
      const point = parseLocation(pair);
      if (!point) continue;
      const last = pathPoints[pathPoints.length - 1];
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      pathPoints.push(point);
    }
  }
  return pathPoints;
}

function ttlFor(pathname) {
  const rule = TTL_RULES.find((item) => pathname.startsWith(item.prefix));
  return rule ? rule.ttl : DEFAULT_TTL;
}

let lastOutboundAt = 0;
let outboundQueue = Promise.resolve();

// 所有出站高德请求串行化（缓存命中不排队），并保持最小间隔，避免触发 QPS 限制
function enqueueOutbound(task) {
  const run = outboundQueue.then(task, task);
  outboundQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function waitOutboundSlot() {
  const waitMs = Math.max(0, lastOutboundAt + MIN_OUTBOUND_INTERVAL_MS - Date.now());
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastOutboundAt = Date.now();
}

export function createAmapClient({ secretsFile, cacheFile = null, fetchImpl = globalThis.fetch }) {
  const cache = new Map();
  const callTimes = [];
  let saveTimer = 0;

  function prune(now = Date.now()) {
    for (const [key, entry] of cache) {
      const pathname = key.slice(0, key.indexOf('?'));
      if (now - entry.at > ttlFor(pathname)) cache.delete(key);
    }
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  function loadCache() {
    if (!cacheFile) return;
    try {
      const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      for (const [key, entry] of Object.entries(raw.entries || {})) {
        if (entry && typeof entry.at === 'number' && entry.data) cache.set(key, entry);
      }
      prune();
    } catch { /* 首次运行或文件损坏 */ }
  }

  function saveCache() {
    if (!cacheFile) return;
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const entries = {};
      for (const [key, entry] of cache) entries[key] = entry;
      const tmp = `${cacheFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, savedAt: Date.now(), entries }));
      fs.renameSync(tmp, cacheFile);
    } catch { /* 落盘失败不影响请求 */ }
  }

  function scheduleSave() {
    if (!cacheFile) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCache, 800);
    saveTimer.unref?.();
  }

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

    const cacheKey = `${pathname}?${new URLSearchParams(params).toString()}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < ttlFor(pathname)) {
      return { data: cached.data, cacheHit: true };
    }
    if (cached) cache.delete(cacheKey);

    const query = new URLSearchParams({ ...params, key }).toString();
    const url = `https://restapi.amap.com${pathname}?${query}`;

    return enqueueOutbound(async () => {
      // 排队期间可能已被其他请求填充
      const again = cache.get(cacheKey);
      if (again && Date.now() - again.at < ttlFor(pathname)) {
        return { data: again.data, cacheHit: true };
      }

      assertRate();
      let attempt = 0;
      while (attempt < 3) {
        attempt += 1;
        await waitOutboundSlot();

        let res;
        try {
          res = await fetchImpl(url, {
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
          const infoCode = String(data.infocode || '');
          // 10021 = CUQPS 并发/QPS 超限：退避后重试
          if (infoCode === '10021' && attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
            continue;
          }
          throw new AmapError(`高德接口错误：${data.info || 'unknown'}（${infoCode || '-'}）`, 502, 'amap_api_error');
        }

        cache.set(cacheKey, { at: Date.now(), data });
        prune();
        scheduleSave();
        return { data, cacheHit: false };
      }
      throw new AmapError('高德接口繁忙，请稍后再试', 502, 'amap_qps_limited');
    });
  }

  async function polygonSearch({ polygon, keywords, pages = 2 }) {
    const pois = [];
    for (let page = 1; page <= pages; page += 1) {
      const { data } = await call('/v3/place/polygon', {
        polygon,
        keywords,
        offset: '25',
        page: String(page),
        extensions: 'base',
      });
      const list = data.pois || [];
      pois.push(...list);
      if (list.length < 25) break;
    }
    return pois
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

  async function searchPoi({ keywords, city = '广州' }) {
    const { data, cacheHit } = await call('/v3/place/text', {
      keywords,
      city,
      offset: '20',
      page: '1',
      extensions: 'base',
    });
    const pois = (data.pois || [])
      .filter((poi) => poi.location)
      .map((poi) => ({
        id: poi.id,
        name: poi.name,
        address: typeof poi.address === 'string' ? poi.address : '',
        adname: poi.adname || '',
        type: poi.type || '',
        location: parseLocation(poi.location),
      }));
    return { pois, cacheHit };
  }

  async function regeo({ location }) {
    const { data, cacheHit } = await call('/v3/geocode/regeo', { location, extensions: 'base' });
    const rc = data.regeocode || {};
    return {
      address: rc.formatted_address || '',
      pois: (rc.pois || []).slice(0, 3).map((poi) => ({
        name: poi.name,
        address: typeof poi.address === 'string' ? poi.address : '',
        location: parseLocation(poi.location),
      })),
      cacheHit,
    };
  }

  async function route({ mode = 'driving', origin, destination, waypoints = '', strategy = null }) {
    const safeMode = DIRECTIONS.has(mode) ? mode : 'driving';
    const params = { origin, destination, extensions: 'base' };
    if (safeMode === 'driving') {
      if (waypoints) params.waypoints = waypoints;
      if (strategy !== null && strategy !== undefined && strategy !== '') params.strategy = String(strategy);
    }

    const { data, cacheHit } = await call(`/v3/direction/${safeMode}`, params);
    const routePath = data.route?.paths?.[0];
    if (!routePath) throw new AmapError('没有找到可用路线', 404, 'amap_no_route');

    const steps = (routePath.steps || []).map((step) => ({
      instruction: stripTags(step.instruction),
      distance: Number(step.distance) || 0,
      duration: Number(step.duration) || 0,
    }));
    const duration = Number(routePath.duration) || steps.reduce((sum, step) => sum + step.duration, 0);
    return {
      mode: safeMode,
      distance: Number(routePath.distance) || 0,
      duration,
      steps,
      polyline: mergePolyline(routePath.steps || []),
      cacheHit,
    };
  }

  function stats() {
    prune();
    return { entries: cache.size, persistent: Boolean(cacheFile) };
  }

  loadCache();

  return { searchPoi, polygonSearch, regeo, route, stats };
}
