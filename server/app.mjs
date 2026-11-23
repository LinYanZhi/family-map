// @generated
// 家庭地图 · 零依赖 HTTP 服务：静态托管 web/ + /api/health（阶段 2 起在此挂高德 Web 服务代理）
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAmapClient, AmapError } from './amap.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = path.join(ROOT, 'web');
const DATA_DIR = path.join(ROOT, 'data');
const PID_FILE = path.join(DATA_DIR, 'app.pid');
const CLIENT_LOG = path.join(DATA_DIR, 'client-errors.log');
const SECRETS_FILE = path.join(ROOT, 'deploy', 'secrets.local.json');
const HOST = process.env.MAP_HOST || '127.0.0.1';
const PORT = Number(process.env.MAP_PORT || 8802);
const SERVICE = 'map-app';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version || '0.0.0';
const STARTED_AT = Date.now();
const amapClient = createAmapClient({ secretsFile: SECRETS_FILE });
const LOCATION_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

function sendAmapError(res, err) {
  if (err instanceof AmapError) return json(res, err.status, { ok: false, error: err.code, message: err.message });
  return json(res, 502, { ok: false, error: 'amap_error', message: err?.message || '高德请求失败' });
}

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

const NO_STORE_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest']);

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function healthPayload() {
  return {
    ok: true,
    service: SERVICE,
    version: VERSION,
    uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
    now: new Date().toISOString(),
  };
}

// 前端只需要 JS API key 与安全密钥；Web 服务 key 永远不下发
function readAmapConfig() {
  try {
    const secrets = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
    const amap = secrets?.amap || {};
    if (!amap.jsKey || !amap.securityJsCode) return null;
    return { jsKey: amap.jsKey, securityJsCode: amap.securityJsCode };
  } catch {
    return null;
  }
}

function readBody(req, limit = 8192) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

function sanitize(value, max = 500) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);
}

// 把 URL 路径映射到 web/ 内部；越界路径返回 null（防目录穿越）
function resolveFile(pathname) {
  const filePath = path.resolve(WEB_ROOT, '.' + pathname);
  if (filePath !== WEB_ROOT && !filePath.startsWith(WEB_ROOT + path.sep)) return null;
  return filePath;
}

function serveStatic(req, res, pathname) {
  let filePath = resolveFile(pathname);
  if (!filePath) return json(res, 400, { ok: false, error: 'bad_path' });

  let stat = null;
  try { stat = fs.statSync(filePath); } catch { /* 不存在 */ }

  if (stat && stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try { stat = fs.statSync(filePath); } catch { stat = null; }
  }

  if (!stat) {
    const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
    if (!wantsHtml) return json(res, 404, { ok: false, error: 'not_found', path: pathname });
    filePath = path.join(WEB_ROOT, 'index.html');
    try { stat = fs.statSync(filePath); } catch { return json(res, 404, { ok: false, error: 'not_found', path: pathname }); }
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME.get(ext) || 'application/octet-stream';
  const cache = NO_STORE_EXT.has(ext) ? 'no-cache, no-store, must-revalidate' : 'public, max-age=300';
  const headers = {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath)
    .on('error', () => res.destroy())
    .pipe(res);
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://map-app.local');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'method_not_allowed' });
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      return json(res, 200, healthPayload());
    }

    if (pathname === '/api/config') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'method_not_allowed' });
      const amap = readAmapConfig();
      if (!amap) return json(res, 503, { ok: false, error: 'amap_not_configured' });
      const payload = { ok: true, version: VERSION, amap };
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      return json(res, 200, payload);
    }

    // 高德 Web 服务代理：POI 搜索 / 逆地理编码 / 路径规划（key 只在服务端）
    if (pathname === '/api/poi') {
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method_not_allowed' });
      const keywords = (url.searchParams.get('keywords') || '').trim();
      if (!keywords) return json(res, 400, { ok: false, error: 'missing_keywords' });
      if (keywords.length > 80) return json(res, 400, { ok: false, error: 'keywords_too_long' });
      try {
        const pois = await amapClient.searchPoi({ keywords, city: url.searchParams.get('city') || '广州' });
        return json(res, 200, { ok: true, count: pois.length, pois });
      } catch (err) {
        return sendAmapError(res, err);
      }
    }

    if (pathname === '/api/regeo') {
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method_not_allowed' });
      const location = url.searchParams.get('location') || '';
      if (!LOCATION_RE.test(location)) return json(res, 400, { ok: false, error: 'bad_location' });
      try {
        return json(res, 200, { ok: true, ...(await amapClient.regeo({ location })) });
      } catch (err) {
        return sendAmapError(res, err);
      }
    }

    if (pathname === '/api/route') {
      if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method_not_allowed' });
      const mode = url.searchParams.get('mode') || 'driving';
      const origin = url.searchParams.get('origin') || '';
      const destination = url.searchParams.get('destination') || '';
      const rawWaypoints = url.searchParams.get('waypoints') || '';
      const waypoints = rawWaypoints ? rawWaypoints.split(';').filter(Boolean) : [];
      if (!LOCATION_RE.test(origin) || !LOCATION_RE.test(destination)) {
        return json(res, 400, { ok: false, error: 'bad_point' });
      }
      if (waypoints.length > 3 || waypoints.some((w) => !LOCATION_RE.test(w))) {
        return json(res, 400, { ok: false, error: 'bad_waypoints' });
      }
      try {
        const result = await amapClient.route({ mode, origin, destination, waypoints: waypoints.join(';') });
        return json(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendAmapError(res, err);
      }
    }

    // 前端加载/初始化失败上报：写到 data/client-errors.log，便于手机端问题不留白
    if (pathname === '/api/client-log') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });
      const body = await readBody(req);
      if (body === null) return json(res, 413, { ok: false, error: 'body_too_large' });
      let data = null;
      try { data = JSON.parse(body); } catch { /* 允许非 JSON */ }
      const line = [
        `[${new Date().toISOString()}]`,
        `code=${sanitize(data?.code, 40)}`,
        `message=${sanitize(data?.message, 400)}`,
        `ua=${sanitize(data?.ua, 300)}`,
        `href=${sanitize(data?.href, 200)}`,
        `detail=${sanitize(JSON.stringify(data?.detail ?? ''), 600)}`,
      ].join(' | ') + '\n';
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.appendFileSync(CLIENT_LOG, line);
      } catch { /* 日志写失败不影响响应 */ }
      return json(res, 200, { ok: true });
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { ok: false, error: 'not_found', path: pathname });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'method_not_allowed' });

    serveStatic(req, res, pathname);
  } catch (err) {
    if (!res.headersSent) json(res, 500, { ok: false, error: 'internal_error' });
    else res.destroy();
    console.error('[map-app] request error:', err?.message || err);
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error('[map-app] request error:', err?.message || err);
    if (!res.headersSent) json(res, 500, { ok: false, error: 'internal_error' });
    else res.destroy();
  });
});

function cleanupPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
    if (pid === process.pid) fs.unlinkSync(PID_FILE);
  } catch { /* ignore */ }
}

function shutdown(signal) {
  console.log(`[map-app] 收到 ${signal}，正在停止…`);
  cleanupPid();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[map-app] 端口 ${PORT} 已被占用：${err.message}`);
    process.exit(1);
  }
  console.error('[map-app] 服务错误:', err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PID_FILE, String(process.pid));
  console.log(`[map-app] v${VERSION} 监听 http://${HOST}:${PORT}/`);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', cleanupPid);
