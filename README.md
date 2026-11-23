# 家庭地图（map-app）

自用轻量地图 Web 应用：手机浏览器访问，最多 2 人，广州白云 / 番禺为主。原生 HTML/CSS/JS，零构建、零依赖。

当前进度：**阶段 2**（高德 JS API + 定位 + 中心/缩放；阶段 1 链路已验收）。

## 目录

```text
map-app/
  server/            零依赖 Node 服务（静态托管 + /api/health，阶段 2 起挂高德 Web 服务代理）
  web/               前端（原生 HTML/CSS/JS）
  data/              运行态与本机用户数据（pid、收藏点等，不进 git）
  deploy/
    nginx/           nginx 实例（conf/map.conf；nginx.exe 与 logs/temp 不进 git）
    tls/             自签证书（不进 git）
    public-url.txt   公网入口地址（配置隧道后写入，可选）
  start.cmd          启动 link（Node + nginx）
  stop.cmd           停止
```

## 端口

| 端口 | 用途 | 监听 |
|---|---|---|
| 8802 | Node 服务（静态 + `/api/*`，只给 nginx 反代） | 127.0.0.1 |
| 8800 | nginx HTTP：局域网手机调试 | 0.0.0.0 |
| 8801 | nginx HTTPS：Sakura TCP 隧道的公网入口 | 0.0.0.0 |

## 启动 / 停止

```powershell
.\start.cmd          # 或 node server\launch.mjs
.\stop.cmd           # 或 node server\shutdown.mjs
```

`launch.mjs` 幂等：已在运行时不会重复起；缺证书会自动生成；nginx 配置会先 `-t` 自检。

## 公网隧道（Sakura）

1. Sakura 面板新建 **TCP** 隧道，本地目标 `127.0.0.1:8801`。
2. 把面板给出的公网地址写进 `deploy/public-url.txt`，例如 `https://frp-leg.com:60835`。
3. 手机 4G 打开该地址；自签证书会提示不安全，点「高级 → 继续访问」。

隧道只做 TCP 转发，TLS 在 nginx（8801）终止，所以公网访问必须是 `https://`；明文 HTTP 会被 Sakura 节点直接拒绝（501）。

## 证书

`deploy/tls/server.crt` / `server.key` 由 `node server/gen-cert.mjs` 生成（SAN 含 `frp-leg.com` / `frp-pen.com` 及 dx/yd/lt 子域、`localhost`、`127.0.0.1`、本机局域网 IP）。隧道域名不同时重建：

```powershell
node server\gen-cert.mjs --force
```

正式使用建议换免费证书：直接把证书与私钥覆盖到这两个文件即可，重启生效。

## 高德 key 放哪里（阶段 2）

三个 key（JS API key、安全密钥、Web 服务 key）一律写本机 `deploy/secrets.local.json`（已在 `.gitignore`），**不进 git、不写进代码**。`GET /api/config` 只下发前端需要的 `jsKey` 与 `securityJsCode`，Web 服务 key 只留在服务端（阶段 3 的 `/api/*` 代理使用）。

当前使用的 key（2026-11-23 从控制台读取，域名白名单 / IP 白名单均为空 = 无限制）：

| 用途 | Key 名称 | 说明 |
|---|---|---|
| JS API | 毕设项目2 | 前端渲染地图，需配安全密钥 |
| Web 服务 | 毕设项目 | 服务端代理 POI/路线/逆地理 |

> 安全密钥（securityJsCode）与 JS key 配套下发属高德 2.0 设计（前端必然可见）；Web 服务 key 绝不出现在前端响应里。如果以后 key 泄露，到控制台重置即可。

## 自测

```powershell
node tests\smoke.mjs    # 18 项契约检查：页面/health/配置/HTTPS/404/HEAD/缓存头
```

## 排障

| 现象 | 排查 |
|---|---|
| `start.cmd` 报缺少 nginx.exe | 从 nginx for Windows 复制 `nginx.exe` 到 `deploy/nginx/`，或设 `MAP_NGINX_EXE` 指向它 |
| nginx 起不来 | `deploy/nginx/nginx.exe -t -p deploy/nginx/ -c conf/map.conf`，看 `deploy/nginx/logs/map-error.log` |
| 手机局域网打不开 | Windows 防火墙会给新的 `nginx.exe` 自动建 **Block** 规则；管理员运行 `deploy/allow-lan.cmd` 一次性放行。公网隧道走 127.0.0.1，不受影响 |
| 公网打不开 | 地址必须是 `https://`；确认 Sakura 隧道在线、`deploy/public-url.txt` 与面板端口一致 |
| 改了前端还是旧界面 | 静态资源带 `?v=` 版本串，改完递增；nginx/Node 对 html/js/css 均已禁用缓存 |
