// @generated
// 阶段 1 占位页逻辑：只检查「服务在线 + HTTPS」两项，地图逻辑阶段 2 接入
const dots = {
  page: document.querySelector('[data-dot="page"]'),
  api: document.querySelector('[data-dot="api"]'),
  https: document.querySelector('[data-dot="https"]'),
};
const texts = {
  api: document.querySelector('[data-text="api"]'),
  https: document.querySelector('[data-text="https"]'),
};
const versionEl = document.getElementById('version');
const nowEl = document.getElementById('now');
const retryBtn = document.getElementById('retry');

function setDot(name, state) {
  const el = dots[name];
  if (!el) return;
  el.classList.remove('ok', 'warn', 'err');
  if (state) el.classList.add(state);
}

function setText(name, value) {
  const el = texts[name];
  if (el) el.textContent = value;
}

function renderHttps() {
  if (location.protocol === 'https:') {
    setDot('https', 'ok');
    setText('https', 'HTTPS 已启用（自签证书提示可继续）');
    return true;
  }
  setDot('https', 'warn');
  setText('https', '当前是 HTTP：局域网调试可用，公网必须走 HTTPS');
  return false;
}

async function checkApi() {
  setDot('api', null);
  setText('api', '检测服务接口…');
  try {
    const res = await fetch(`/api/health?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || data.service !== 'map-app') throw new Error('响应格式不对');
    setDot('api', 'ok');
    setText('api', `服务正常（${data.service} v${data.version}，已运行 ${data.uptimeSec}s）`);
    versionEl.textContent = `v${data.version}`;
    retryBtn.hidden = true;
    return true;
  } catch (err) {
    setDot('api', 'err');
    setText('api', `服务接口异常：${err.message}`);
    retryBtn.hidden = false;
    versionEl.textContent = 'v?';
    return false;
  }
}

function renderClock() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  nowEl.textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

renderClock();
renderHttps();
checkApi();

retryBtn.addEventListener('click', () => {
  renderHttps();
  checkApi();
});

// 回到前台时自动复检一次，便于「隧道断开后重连」的场景
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkApi();
});
