# 家庭地图（map-app）

> 在线体验：<https://frp-pen.com:28700>（自签证书，浏览器提示「继续访问」即可；服务跑在家里电脑上，电脑和隧道在线时才可访问）
>
> 代码仓库：<https://github.com/LinYanZhi/family-map>

自用轻量地图 Web 应用：手机浏览器访问，最多 2 人，广州白云 / 番禺为主。原生 HTML/CSS/JS，零构建、零依赖。

当前进度：**0.6.0** —— 地图 + 定位 + POI 搜索 + 路线规划（起终点/途径点、多方案切换、直达对比、沿途找最近的店）+ 4 种地图样式（默认暗黑）+ 基础导航 + **高德引擎兼容模式（2.0 / 1.4 自动降级）**。

## 目录

```text
map-app/
  server/
    app.mjs            零依赖 HTTP 服务：静态托管 + /api/health /api/config /api/client-log
    amap.mjs           高德 Web 服务代理：POI / 逆地理 / 路径规划 / 多边形搜索（持久缓存 + 限流）
    geo.mjs            路线几何：折线距离、均匀采样、走廊多边形
  web/
    index.html         页面骨架（地图 + 底部 Tab + 底部面板）
    css/app.css        移动优先样式（底部面板 / 安全区 / 暗色 UI）
    js/app.js          启动装配：加载 JS API、面板/Tab、定位、错误诊断
    js/map.js          地图视图：样式切换、标记、折线、定位
    js/search.js       搜索面板
    js/route.js        路线面板（起终点 + 途径点 + 多方案 + 对比 + 导航入口）
    js/nav.js          基础导航（定位跟随、指令、剩余距离时间、语音、偏航重算）
    js/style.js        地图样式面板
    js/api.js          前端 API 封装
    js/ui.js           toast / 底部面板 / 操作菜单
  data/                运行态与本机用户数据（pid、错误日志，不进 git）
  deploy/
    nginx/             nginx 实例（conf/map.conf；nginx.exe 与 logs/temp 不进 git）
    tls/               自签证书（不进 git）
    public-url.txt     公网入口地址（配置隧道后写入，可选）
  tests/
    smoke.mjs          离线契约测试（不消耗高德配额）
    live.mjs           真实高德接口测试（会消耗少量配额）
  start.cmd            启动 link（Node + nginx）
  stop.cmd             停止
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

## 高德 key 放哪里

三个 key（JS API key、安全密钥、Web 服务 key）一律写本机 `deploy/secrets.local.json`（已在 `.gitignore`），**不进 git、不写进代码**。`GET /api/config` 只下发前端需要的 `jsKey` 与 `securityJsCode`，Web 服务 key 只留在服务端（阶段 3 的 `/api/*` 代理使用）。

当前使用的 key（2026-11-23 从控制台读取，域名白名单 / IP 白名单均为空 = 无限制）：

| 用途 | Key 名称 | 说明 |
|---|---|---|
| JS API | 毕设项目2 | 前端渲染地图，需配安全密钥 |
| Web 服务 | 毕设项目 | 服务端代理 POI/路线/逆地理 |

> 安全密钥（securityJsCode）与 JS key 配套下发属高德 2.0 设计（前端必然可见）；Web 服务 key 绝不出现在前端响应里。如果以后 key 泄露，到控制台重置即可。

## 功能与接口（0.6）

**页面功能**

- 默认中心：**白云区政府**（`113.272674, 23.156789`），zoom 13；拖动 / 双指缩放 / 滚轮缩放。
- 底部 3 个 Tab：**搜索 / 路线 / 样式**，面板从底部弹出，手机单手可操作。
- **搜索**：关键词 + 常用地点快捷词；结果可「定位」，也可直接点「起 / 终」设为路线起终点。
- **选点**：起终点/途径点统一用**专用选点面板**（整行可点、无小按钮误触、明确取消）；**设好起点后自动接着弹终点选择**，减少手机上的第二步操作。
- **路线**：驾车 / 步行 / 骑行；起终点支持「我的位置 / 搜索地点 / 地图选点」；**途径点最多 3 个**，有「使用途径点」开关。
- **多方案切换**：驾车一次给出最多 3 条方案（推荐 / 距离最短 / 躲避拥堵），面板顶部切换，地图同步重绘。
- **两种途径点规划**：
  - 手动选点：自己指定起点/终点/途径点，规划经过它的路线；
  - **沿途找最近的**：先拿到起点→终点的路线，在路线两侧 800m 走廊内搜关键词（如「麦当劳」「加油站」），按**离路线最近 / 绕行最少**排序；点候选即设为途经点并重新规划，自动显示「直达 vs 绕行」对比。找不到时会自动把走廊放宽到 1600m 再试一次。
- **直达对比**：带途径点规划时，自动再算一条「不走途径点」的直达路线——面板显示两组距离/时长与差值，地图上用**蓝色实线（当前方案）+ 灰色虚线（直达）**同时展示。
- **途径点地图展示**：起/终 + 编号（1/2/3）标记；折线按途径点自动**分段着色**；结果面板列出途经点名称。
- **基础导航**：点「开始导航」→ 地图跟随定位、顶部显示当前指令与下一步、底部显示剩余距离/时间和进度条、语音播报（可关）、偏航 3 次自动重算、到达提醒后自动结束。
- **样式**：暗黑（默认）/ 标准 / 浅色 / 灰白，选择写入 localStorage。暗黑样式数据来自 `custyle.amap.com`，**被网络/内置浏览器拦截时会静默保持亮色**——现在会检测样式数据请求，失败时自动给地图画布加暗色滤镜兜底，并在样式面板明确提示（日志 `style:check`）。
- **浏览器兼容（引擎降级）**：默认高德 JS API 2.0；没有 WebGL 时自动改用 1.4；2.0 被浏览器拒载（提示「浏览器版本过低」）时页面会给出「兼容模式重试」（切 1.4）和「复制地址」；1.4 也不支持时只提示换 Chrome / Safari / 高德 App。样式面板会显示当前引擎，1.4 模式下可点「重试地图引擎 2.0」。引擎选择记在 localStorage `map-app:engine`。
- 右下角定位按钮：浏览器 Geolocation，蓝点 + 精度圈；HTTPS 下才允许（iOS 限制）。
- 加载失败显示错误码遮罩并自动上报 `data/client-errors.log`；手机细节：键盘抬升面板、搜索框自动聚焦全选、地图选点提示条+取消、选点后回面板。

> 真机排查：`data/client-errors.log` 里 `code=ui` 的行记录了选点/规划/导航的关键步骤（`pick:start` → `pick:resolved` → `point:chooseDone` → `plan:done`），下次某一步卡住可直接从日志定位。

> 导航限制：网页导航依赖前台定位，**切到后台/锁屏会暂停定位**（iOS 限制）。真机导航时保持页面在前台（后续可加 Wake Lock 保持屏幕常亮）。

**缓存策略（持久化）**

- 内存 + 磁盘缓存写 `data/amap-cache.json`（不进 git，重启后仍在），命中时响应头 `X-Amap-Cache: hit`。
- TTL 按接口区分：**POI 搜索 24 小时 / 逆地理 7 天 / 路线 30 分钟**（路况会变，所以短）。
- 说明：这些是「查过的结果」缓存，不是把广州全量 POI 抓下来存本地（高德条款不允许批量抓取，且 POI 会变）；想长期保存的是自己的**收藏点**（后续做）。

**后端接口（key 只在服务端）**

| 接口 | 参数 | 说明 |
|---|---|---|
| `GET /api/poi` | `keywords`、`city`（默认广州） | POI 搜索，返回名称/地址/区/坐标 |
| `GET /api/regeo` | `location=lng,lat` | 逆地理编码，地图选点取名用 |
| `GET /api/route` | `mode=driving\|walking\|riding`、`origin`、`destination`、`waypoints`（`;` 分隔，仅驾车） | 单条路线：距离/时长/步骤/折线 |
| `GET /api/route/plans` | 同上 + `strategies=0,2,4`、`direct=1` | 多方案（驾车按策略去重）+ 可选的直达对比方案 |
| `GET /api/route/along` | `mode`、`origin`、`destination`、`keywords`、`corridor`（默认 800） | 沿途找：路线走廊内搜关键词，返回按绕行排序的候选（含 `distanceToRoute`/`detour`） |

服务端对高德请求做持久缓存 + **每分钟 90 次**限流，保护个人免费额度；超限返回 `429 amap_rate_limited`。命中缓存的响应带 `X-Amap-Cache: hit`。

自测可通过 `window.__app` 读取面板/地图状态（CDP 断言用）：`__app.mapView.getStyle()`、`__app.panels.search.getResults()`、`__app.panels.route.getState()`、`__nav.getState()`。

## 自测

```powershell
node tests\smoke.mjs    # 29 项离线契约检查（不消耗高德配额）
node tests\live.mjs     # 12 项真实高德接口检查（POI/缓存/逆地理/驾车/途径点/步行/多方案/直达对比/沿途找，会消耗少量配额）
```

`smoke.mjs` 覆盖：页面/health/config/上报/各接口参数校验/模块加载/HTTPS/404/HEAD/缓存头。

## 手机端自测清单（改 UI 后必跑）

1. 390/360/320 宽度：搜索面板结果行的「起/终」按钮完整可见（不超出面板右边），点它能打开路线面板并填入起点。
2. 路线：起点用「地图选点」、终点用「搜索地点」；再反过来试一遍；都能规划出距离/时长。
3. 设好起点后应**自动弹出终点选择**；点结果行任意位置都能选中（选点面板里没有起/终小按钮）。
3. 添加途径点后规划：面板出现「直达」对比和方案切换；地图上能看到灰虚线 + 分段彩色路线 + 编号途径点。
4. 沿途找：起终点设好后，在「沿途找最近的」里输入「麦当劳」→ 出现候选列表（距路线/绕行距离）→ 点一个 → 自动设为途经点并规划，对比里能看到绕行代价。
5. 点「开始导航」：允许定位后应看到当前位置跟随、指令/剩余距离/进度条变化；点「退出导航」回到路线面板。
6. 面板打开时右下角定位按钮隐藏（避免被面板盖住点不到）；关闭面板后点定位能出蓝点。
7. 横屏（844×390）打开路线面板，「规划路线」按钮在可视区域内；样式切换后刷新仍保持；iPhone 键盘弹出时搜索框不被遮挡。

## 排障

| 现象 | 排查 |
|---|---|
| `start.cmd` 报缺少 nginx.exe | 从 nginx for Windows 复制 `nginx.exe` 到 `deploy/nginx/`，或设 `MAP_NGINX_EXE` 指向它 |
| nginx 起不来 | `deploy/nginx/nginx.exe -t -p deploy/nginx/ -c conf/map.conf`，看 `deploy/nginx/logs/map-error.log` |
| 手机局域网打不开 | Windows 防火墙会给新的 `nginx.exe` 自动建 **Block** 规则；管理员运行 `deploy/allow-lan.cmd` 一次性放行。公网隧道走 127.0.0.1，不受影响 |
| 公网打不开 | 地址必须是 `https://`；确认 Sakura 隧道在线、`deploy/public-url.txt` 与面板端口一致 |
| 地图页显示「地图加载失败」 | 看遮罩里的错误码 + `data/client-errors.log`（含设备 UA/时间/错误明细）；`[script]` = 高德 JS API 请求失败（网络/拦截），`[config]` = 服务端 key 未配置 |
| 搜索/路线报错 | 页面会显示高德返回的原因；`429` = 本机限流（每分钟 90 次），等一分钟；`amap_api_error` = 高德侧参数/额度问题，看 message 里的 info |
| 暗黑样式不生效 / 地图还是亮色 | 高德暗黑样式数据来自 `custyle.amap.com`，被网络或内置浏览器拦截会失败。样式面板会提示「滤镜兜底」；`data/client-errors.log` 里 `style:check` 记录每次样式数据是否加载成功；换网络/换浏览器重试 |
| 页面提示「浏览器版本过低」 | 高德 JS API 2.0 拒载当前浏览器（内置浏览器/旧内核常见）。页面会出现「兼容模式重试」按钮（切换高德 1.4），或点「复制地址」换 Chrome / Safari / 高德 App 打开。日志里看 `engine:choice` / `engine:unsupported` / `browser engine_unsupported` |
| 改了前端还是旧界面 | 静态资源带 `?v=` 版本串，改完递增；nginx/Node 对 html/js/css 均已禁用缓存；手机 Safari 还需关标签重开 |
