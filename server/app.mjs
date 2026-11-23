// @generated
// 家庭地图 · 零依赖 HTTP 服务：静态托管 web/ + /api/health（阶段 2 起在此挂高德 Web 服务代理）
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = path.join(ROOT, 'web');
const DATA_DIR = path.join(ROOT, 'data');
const PID_FILE = path.join(DATA_DIR, 'app.pid');
const HOST = process.env.MAP_HOST || '127.0.0.1';
const PORT = Number(process.env.MAP_PORT || 8802);
const SERVICE = 'map-app';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version || '0.0.0';
const STARTED_AT = Date.now();

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

const server = http.createServer((req, res) => {
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

    if (pathname.startsWith('/api/')) return json(res, 404, { ok: false, error: 'not_found', path: pathname });
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { ok: false, error: 'method_not_allowed' });

    serveStatic(req, res, pathname);
  } catch (err) {
    if (!res.headersSent) json(res, 500, { ok: false, error: 'internal_error' });
    else res.destroy();
    console.error('[map-app] request error:', err?.message || err);
  }
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
