// @generated
// 生成自签 HTTPS 证书（阶段 1 用；正式换免费证书时替换 deploy/tls/server.crt|server.key 即可）
// 用法：node server/gen-cert.mjs [--force]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TLS_DIR = path.join(ROOT, 'deploy', 'tls');
const CERT = path.join(TLS_DIR, 'server.crt');
const KEY = path.join(TLS_DIR, 'server.key');
const FORCE = process.argv.includes('--force');

const OPENSSL_CANDIDATES = [
  process.env.MAP_OPENSSL,
  'C:/Program Files/Git/usr/bin/openssl.exe',
  'C:/Program Files/Git/mingw64/bin/openssl.exe',
  'openssl',
].filter(Boolean);

function findOpenssl() {
  for (const exe of OPENSSL_CANDIDATES) {
    const r = spawnSync(exe, ['version'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return exe;
  }
  return null;
}

function lanIPv4() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && a.address.startsWith('192.168.')) return a.address;
    }
  }
  return null;
}

if (fs.existsSync(CERT) && fs.existsSync(KEY) && !FORCE) {
  console.log(`[gen-cert] 证书已存在，跳过（要重建加 --force）：${CERT}`);
  process.exit(0);
}

const openssl = findOpenssl();
if (!openssl) {
  console.error('[gen-cert] 找不到 openssl；请安装 Git for Windows（自带 openssl）或用 MAP_OPENSSL 指定路径');
  process.exit(1);
}

const dnsNames = ['frp-leg.com', 'dx.frp-leg.com', 'yd.frp-leg.com', 'lt.frp-leg.com', 'localhost'];
const extra = process.env.MAP_TLS_DNS ? process.env.MAP_TLS_DNS.split(',').map((s) => s.trim()).filter(Boolean) : [];
const sans = [...dnsNames, ...extra].map((d) => `DNS:${d}`);
sans.push('IP:127.0.0.1');
const lan = lanIPv4();
if (lan) sans.push(`IP:${lan}`);

fs.mkdirSync(TLS_DIR, { recursive: true });

const args = [
  'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '825', '-nodes',
  '-keyout', KEY, '-out', CERT,
  '-subj', '/CN=frp-leg.com',
  '-addext', `subjectAltName=${sans.join(',')}`,
];

console.log(`[gen-cert] 使用 ${openssl}`);
console.log(`[gen-cert] SAN = ${sans.join(', ')}`);
const r = spawnSync(openssl, args, { stdio: 'inherit', windowsHide: true });
if (r.status !== 0) {
  console.error('[gen-cert] 生成失败');
  process.exit(r.status || 1);
}
console.log(`[gen-cert] 完成：${CERT}`);
