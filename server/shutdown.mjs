// @generated
// 停止 map-app：先停 Node 服务（按 data/app.pid，先确认健康接口是我们自己的），再让 nginx 优雅退出
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const PID_FILE = path.join(DATA_DIR, 'app.pid');
const DEPLOY_DIR = path.join(ROOT, 'deploy');
const NGINX_DIR = path.join(DEPLOY_DIR, 'nginx');
const NGINX_EXE = process.env.MAP_NGINX_EXE || path.join(NGINX_DIR, 'nginx.exe');
const NGINX_PREFIX = NGINX_DIR.replace(/\\/g, '/') + '/';
const NGINX_CONF = 'conf/map.conf';
const NGINX_PID = path.join(NGINX_DIR, 'logs', 'map-nginx.pid');

const APP_PORT = Number(process.env.MAP_PORT || 8802);
const HTTP_PORT = 8800;
const HTTPS_PORT = 8801;
const SERVICE = 'map-app';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGetJson(port, pathname, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET', timeout: timeoutMs }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(700);
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
  });
}

async function waitClosed(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portOpen(port))) return true;
    await sleep(250);
  }
  return false;
}

// 只有「健康接口返回 map-app」才认为 Node 服务是我们的，绝不盲杀
async function stopApp() {
  const health = await httpGetJson(APP_PORT, '/api/health');
  if (health?.body?.service !== SERVICE) {
    console.log('[stop] Node 服务未运行（或端口不是 map-app），跳过');
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    return;
  }
  let pid = 0;
  try { pid = Number(fs.readFileSync(PID_FILE, 'utf8')); } catch { /* ignore */ }
  if (!pid) {
    console.warn('[stop] 健康接口在，但 data/app.pid 缺失，未自动杀进程；请手动检查');
    return;
  }
  console.log(`[stop] 停止 Node 服务 pid=${pid}`);
  try { process.kill(pid); } catch (err) { console.warn(`[stop] kill 失败：${err.message}`); }
  const closed = await waitClosed(APP_PORT, 8000);
  console.log(closed ? '[stop] Node 服务已停止' : '[stop] Node 服务 8 秒内未停止，请手动检查');
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

function stopNginx() {
  if (!fs.existsSync(NGINX_EXE)) {
    console.log('[stop] 未找到 nginx.exe，跳过');
    return;
  }
  if (!fs.existsSync(NGINX_PID)) {
    console.log('[stop] nginx 未运行（无 pid 文件），跳过');
    return;
  }
  console.log('[stop] 让 nginx 优雅退出…');
  const r = spawnSync(NGINX_EXE, ['-p', NGINX_PREFIX, '-c', NGINX_CONF, '-s', 'quit'], { stdio: 'inherit', windowsHide: true });
  if (r.status !== 0) console.warn('[stop] nginx -s quit 返回非 0，稍后用 pid 兜底');
}

async function main() {
  await stopApp();
  stopNginx();
  const httpClosed = await waitClosed(HTTP_PORT, 8000);
  const httpsClosed = await waitClosed(HTTPS_PORT, 8000);
  if (httpClosed && httpsClosed) {
    console.log('[stop] nginx 已停止');
    return;
  }
  // 优雅退出失败时，按 nginx 自己写的 pid 文件兜底（仍只动我们这一个实例）
  console.warn('[stop] 端口仍占用，按 nginx pid 文件兜底');
  try {
    const pid = Number(fs.readFileSync(NGINX_PID, 'utf8'));
    if (pid) process.kill(pid);
  } catch (err) {
    console.warn(`[stop] 兜底失败：${err.message}`);
  }
  const ok = (await waitClosed(HTTP_PORT, 5000)) && (await waitClosed(HTTPS_PORT, 5000));
  console.log(ok ? '[stop] nginx 已停止' : '[stop] nginx 仍未停止，请手动检查');
}

await main();
