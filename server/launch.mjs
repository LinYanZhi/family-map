// @generated
// 启动本机链路：Node 服务（8802）→ nginx（8800 HTTP / 8801 HTTPS），幂等，已启动则跳过
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
const DEPLOY_DIR = path.join(ROOT, 'deploy');
const NGINX_DIR = path.join(DEPLOY_DIR, 'nginx');
const NGINX_EXE = process.env.MAP_NGINX_EXE || path.join(NGINX_DIR, 'nginx.exe');
const NGINX_PREFIX = NGINX_DIR.replace(/\\/g, '/') + '/';
const NGINX_CONF = 'conf/map.conf';
const NODE = process.execPath;

const APP_PORT = Number(process.env.MAP_PORT || 8802);
const HTTP_PORT = 8800;
const HTTPS_PORT = 8801;
const SERVICE = 'map-app';
const HEALTH_PATH = '/api/health';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error(`[launch] ${msg}`);
  process.exit(1);
}

function httpGetJson(port, pathname, timeoutMs = 2500) {
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

function httpsGetJson(port, pathname, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = https.request({ host: '127.0.0.1', port, path: pathname, method: 'GET', rejectUnauthorized: false, timeout: timeoutMs }, (res) => {
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
    sock.setTimeout(800);
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
  });
}

async function waitFor(label, fn, timeoutMs, intervalMs = 300) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  console.warn(`[launch] 等待超时：${label}`);
  return false;
}

function lanIPv4() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith('192.168.')) return a.address;
    }
  }
  return null;
}

function ensureRuntimeDirs() {
  for (const dir of ['logs', 'temp/client_body', 'temp/proxy', 'temp/fastcgi', 'temp/uwsgi', 'temp/scgi']) {
    fs.mkdirSync(path.join(NGINX_DIR, dir), { recursive: true });
  }
}

async function main() {
  if (!fs.existsSync(NGINX_EXE)) {
    fail(`缺少 nginx.exe：${NGINX_EXE}\n        从 nginx for Windows 复制 nginx.exe 到 deploy/nginx/，或用 MAP_NGINX_EXE 指定路径`);
  }
  ensureRuntimeDirs();

  const cert = path.join(DEPLOY_DIR, 'tls', 'server.crt');
  const key = path.join(DEPLOY_DIR, 'tls', 'server.key');
  if (!fs.existsSync(cert) || !fs.existsSync(key)) {
    console.log('[launch] 证书不存在，先生成自签证书…');
    const r = spawnSync(NODE, [path.join(SERVER_DIR, 'gen-cert.mjs')], { stdio: 'inherit', windowsHide: true });
    if (r.status !== 0) fail('自签证书生成失败');
  }

  // 1) Node 服务
  const health = await httpGetJson(APP_PORT, HEALTH_PATH);
  if (health?.body?.service === SERVICE) {
    console.log(`[launch] Node 服务已在运行（v${health.body.version}）`);
  } else {
    if (await portOpen(APP_PORT)) {
      fail(`端口 ${APP_PORT} 已被其它程序占用，先腾出端口再启动`);
    }
    console.log(`[launch] 启动 Node 服务（${APP_PORT}）…`);
    const child = spawn(NODE, [path.join(SERVER_DIR, 'app.mjs')], {
      cwd: ROOT,
      env: { ...process.env, MAP_PORT: String(APP_PORT) },
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    const ok = await waitFor('Node 服务就绪', async () => (await httpGetJson(APP_PORT, HEALTH_PATH))?.body?.service === SERVICE, 15000);
    if (!ok) fail('Node 服务未能在 15 秒内就绪；手动运行 node server/app.mjs 查看报错');
  }

  // 2) nginx 配置自检
  const test = spawnSync(NGINX_EXE, ['-t', '-p', NGINX_PREFIX, '-c', NGINX_CONF], { stdio: 'inherit', windowsHide: true });
  if (test.status !== 0) fail(`nginx 配置检查失败（见 deploy/nginx/logs/map-error.log）`);

  // 3) nginx
  const proxyHealth = await httpsGetJson(HTTPS_PORT, HEALTH_PATH);
  if (proxyHealth?.body?.service === SERVICE) {
    console.log('[launch] nginx 已在运行（HTTPS 8801 正常）');
  } else {
    if ((await portOpen(HTTP_PORT)) || (await portOpen(HTTPS_PORT))) {
      fail(`端口 ${HTTP_PORT}/${HTTPS_PORT} 已被其它程序占用，先腾出端口再启动`);
    }
    console.log('[launch] 启动 nginx（8800 HTTP / 8801 HTTPS）…');
    const child = spawn(NGINX_EXE, ['-p', NGINX_PREFIX, '-c', NGINX_CONF], {
      cwd: NGINX_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    const ok = await waitFor('nginx 就绪', async () => (await httpsGetJson(HTTPS_PORT, HEALTH_PATH))?.body?.service === SERVICE, 12000);
    if (!ok) fail('nginx 未能在 12 秒内就绪；查看 deploy/nginx/logs/map-error.log');
  }

  // 4) 汇总
  const lan = lanIPv4();
  let publicUrl = '';
  try {
    publicUrl = fs.readFileSync(path.join(DEPLOY_DIR, 'public-url.txt'), 'utf8').trim();
  } catch { /* 尚未配置隧道 */ }

  console.log('');
  console.log('map-app 已启动');
  console.log(`  本机 HTTP   http://127.0.0.1:${HTTP_PORT}/`);
  console.log(`  本机 HTTPS  https://127.0.0.1:${HTTPS_PORT}/   （自签证书，浏览器提示可继续）`);
  if (lan) console.log(`  局域网      http://${lan}:${HTTP_PORT}/`);
  console.log(`  健康检查    http://127.0.0.1:${HTTP_PORT}${HEALTH_PATH}`);
  if (publicUrl) console.log(`  公网入口    ${publicUrl}   （Sakura 隧道 → 127.0.0.1:${HTTPS_PORT}）`);
  else console.log('  公网入口    待配置：Sakura 新建 TCP 隧道，本地目标 127.0.0.1:8801，地址写入 deploy/public-url.txt');
}

await main();
