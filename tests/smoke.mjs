// @generated
// 阶段 2 契约自测：静态页 / health / config / client-log / HTTPS / API 404 / HEAD
import http from 'node:http';
import https from 'node:https';

const HTTP_BASE = `http://127.0.0.1:${process.env.MAP_HTTP_PORT || 8800}`;
const HTTPS_BASE = `https://127.0.0.1:${process.env.MAP_HTTPS_PORT || 8801}`;

function request(base, pathname, { method = 'GET', insecure = false, body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const mod = base.startsWith('https') ? https : http;
    const url = new URL(base + pathname);
    const req = mod.request({
      host: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
      rejectUnauthorized: !insecure,
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, body: 'timeout' }); });
    req.on('error', (err) => resolve({ status: 0, headers: {}, body: err.message }));
    if (body) req.write(body);
    req.end();
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const page = await request(HTTP_BASE, '/');
check('HTTP 首页 200', page.status === 200, `status=${page.status}`);
check('首页是 HTML', (page.headers['content-type'] || '').includes('text/html'), page.headers['content-type']);
check('首页含标题', page.body.includes('家庭地图'));
check('HTML 禁止缓存', (page.headers['cache-control'] || '').includes('no-cache'), page.headers['cache-control']);

const health = await request(HTTP_BASE, '/api/health');
let healthJson = null;
try { healthJson = JSON.parse(health.body); } catch { /* ignore */ }
check('health 200', health.status === 200, `status=${health.status}`);
check('health 服务名正确', healthJson?.service === 'map-app', healthJson?.service);
check('health 带版本号', typeof healthJson?.version === 'string' && healthJson.version.length > 0, healthJson?.version);

const js = await request(HTTP_BASE, '/js/app.js');
check('JS 资源 200', js.status === 200, `status=${js.status}`);
check('JS 类型正确', (js.headers['content-type'] || '').includes('javascript'), js.headers['content-type']);

const api404 = await request(HTTP_BASE, '/api/not-exist');
let api404Json = null;
try { api404Json = JSON.parse(api404.body); } catch { /* ignore */ }
check('未知 API 返回 404 JSON', api404.status === 404 && api404Json?.ok === false, `status=${api404.status}`);

const cfg = await request(HTTP_BASE, '/api/config');
let cfgJson = null;
try { cfgJson = JSON.parse(cfg.body); } catch { /* ignore */ }
check('config 200', cfg.status === 200, `status=${cfg.status}${cfgJson?.error ? ` error=${cfgJson.error}` : ''}`);
check('config 下发 JS key', typeof cfgJson?.amap?.jsKey === 'string' && cfgJson.amap.jsKey.length > 10);
check('config 下发安全密钥', typeof cfgJson?.amap?.securityJsCode === 'string' && cfgJson.amap.securityJsCode.length > 10);
check('config 不含 Web 服务 key 字段', !('webServiceKey' in (cfgJson?.amap || {})));

const clientLog = await request(HTTP_BASE, '/api/client-log', {
  method: 'POST',
  body: JSON.stringify({ code: 'smoke', message: 'smoke test', ua: 'smoke', href: '/' }),
  headers: { 'Content-Type': 'application/json' },
});
check('client-log 接受上报', clientLog.status === 200 && JSON.parse(clientLog.body)?.ok === true, `status=${clientLog.status}`);

const page404 = await request(HTTP_BASE, '/no-such-page.html');
check('未知页面 404', page404.status === 404, `status=${page404.status}`);

const head = await request(HTTP_BASE, '/', { method: 'HEAD' });
check('HEAD 首页 200 且无 body', head.status === 200 && head.body === '', `status=${head.status} bodyLen=${head.body.length}`);

const httpsHealth = await request(HTTPS_BASE, '/api/health', { insecure: true });
let httpsJson = null;
try { httpsJson = JSON.parse(httpsHealth.body); } catch { /* ignore */ }
check('HTTPS health 200', httpsHealth.status === 200, `status=${httpsHealth.status}`);
check('HTTPS 服务名正确', httpsJson?.service === 'map-app', httpsJson?.service);

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
