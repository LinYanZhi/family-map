// @generated
// 家庭地图 · 阶段 2：高德 JS API 2.0 渲染 + 浏览器定位 + 缩放/中心控制
const DEFAULT_CENTER = [113.272674, 23.156789]; // 白云区政府（白云区中心）
const DEFAULT_ZOOM = 13;

const GEO_ERRORS = {
  1: '定位权限被拒绝（iPhone：设置 → Safari → 位置 → 允许）',
  2: '无法获取位置（检查系统定位服务是否开启）',
  3: '定位超时，请到空旷处重试',
};

const els = {
  dot: document.getElementById('status-dot'),
  toast: document.getElementById('toast'),
  locate: document.getElementById('locate'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayText: document.getElementById('overlay-text'),
  overlayRetry: document.getElementById('overlay-retry'),
  diag: document.getElementById('diag'),
};

const state = {
  map: null,
  marker: null,
  circle: null,
  locating: false,
  toastTimer: 0,
};

function setStatus(name) {
  els.dot.classList.remove('ok', 'err');
  if (name === 'ok') els.dot.classList.add('ok');
  else if (name === 'err') els.dot.classList.add('err');
}

function toast(message, ms = 4000) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  state.toastTimer = setTimeout(() => { els.toast.hidden = true; }, ms);
}

// 失败上报到服务端 data/client-errors.log，手机端出问题不用靠用户抄报错
function reportError(code, message, detail) {
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        code,
        message,
        detail,
        ua: navigator.userAgent,
        href: location.href,
        at: new Date().toISOString(),
      }),
    }).catch(() => {});
  } catch { /* ignore */ }
}

function showError(code, message, detail) {
  setStatus('err');
  els.overlayTitle.textContent = '地图加载失败';
  els.overlayText.textContent = `[${code}] ${message}`;
  if (els.diag) {
    els.diag.textContent = `${navigator.userAgent} · ${new Date().toLocaleString()}`;
  }
  els.overlay.hidden = false;
  reportError(code, message, detail);
}

function hideOverlay() {
  els.overlay.hidden = true;
}

async function fetchConfig() {
  const res = await fetch(`/api/config?t=${Date.now()}`, { cache: 'no-store' });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const reason = data?.error === 'amap_not_configured'
      ? '服务端未配置高德 key（deploy/secrets.local.json）'
      : `配置接口返回 ${res.status}`;
    throw new Error(reason);
  }
  return data.amap;
}

function loadAmapOnce(amapCfg) {
  return new Promise((resolve, reject) => {
    if (window.AMap) {
      resolve();
      return;
    }
    window._AMapSecurityConfig = { securityJsCode: amapCfg.securityJsCode };
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(amapCfg.jsKey)}&plugin=AMap.Scale`;
    const timer = setTimeout(() => reject(new Error('高德 JS API 加载超时（检查网络或隧道）')), 15000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.AMap) resolve();
      else reject(new Error('高德 JS API 未就绪'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error('高德 JS API 脚本请求失败（检查网络）'));
    };
    document.head.appendChild(script);
  });
}

// 首次失败自动再试一次（瞬时断流/弱网时能自愈）
async function loadAmap(amapCfg) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await loadAmapOnce(amapCfg);
      return;
    } catch (err) {
      lastError = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastError || new Error('高德 JS API 加载失败');
}

function initMap() {
  const map = new window.AMap.Map('map', {
    zoom: DEFAULT_ZOOM,
    center: DEFAULT_CENTER,
    viewMode: '2D',
    resizeEnable: true,
  });
  map.addControl(new window.AMap.Scale({ position: 'LB' }));
  state.map = map;
  window.__map = map; // 供自测/CDP 读取中心与缩放
}

function renderLocation(lnglat, accuracy) {
  const map = state.map;
  if (!state.marker) {
    state.marker = new window.AMap.Marker({ position: lnglat, anchor: 'bottom-center', title: '我的位置' });
    map.add(state.marker);
  } else {
    state.marker.setPosition(lnglat);
  }

  const radius = Math.max(Number(accuracy) || 0, 10);
  if (!state.circle) {
    state.circle = new window.AMap.Circle({
      center: lnglat,
      radius,
      strokeColor: '#35d07f',
      strokeOpacity: 0.9,
      strokeWeight: 1,
      fillColor: '#35d07f',
      fillOpacity: 0.15,
    });
    map.add(state.circle);
  } else {
    state.circle.setCenter(lnglat);
    state.circle.setRadius(radius);
  }

  map.setZoomAndCenter(16, lnglat);
}

function onLocated(pos) {
  state.locating = false;
  els.locate.disabled = false;
  const { longitude, latitude, accuracy } = pos.coords;
  renderLocation([longitude, latitude], accuracy);
  const acc = accuracy ? `，精度约 ${Math.round(accuracy)} 米` : '';
  toast(`已定位到当前位置${acc}`, 3500);
}

function onLocateError(err) {
  state.locating = false;
  els.locate.disabled = false;
  toast(GEO_ERRORS[err.code] || `定位失败：${err.message || '未知错误'}`, 6000);
}

function locate() {
  if (state.locating) return;
  if (!state.map) {
    toast('地图还没加载好，请稍等');
    return;
  }
  if (!navigator.geolocation) {
    toast('这个浏览器不支持定位');
    return;
  }
  const isSecure = location.protocol === 'https:'
    || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!isSecure) {
    toast('定位需要 HTTPS（iOS 限制），请用 https:// 地址打开');
    return;
  }
  state.locating = true;
  els.locate.disabled = true;
  toast('正在定位…', 8000);
  navigator.geolocation.getCurrentPosition(onLocated, onLocateError, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 30000,
  });
}

async function boot() {
  hideOverlay();
  setStatus('loading');
  let amapCfg;
  try {
    amapCfg = await fetchConfig();
  } catch (err) {
    showError('config', err.message);
    return;
  }
  try {
    await loadAmap(amapCfg);
  } catch (err) {
    showError('script', err.message, { online: navigator.onLine });
    return;
  }
  try {
    initMap();
    setStatus('ok');
    toast('地图已加载（白云区）：拖动/双指缩放，点右下角定位', 4500);
  } catch (err) {
    showError('init', err.message || '地图初始化异常');
  }
}

window.addEventListener('error', (event) => {
  if (state.map) return;
  reportError('js', event.message || 'uncaught error', { source: event.filename, line: event.lineno });
});

window.addEventListener('unhandledrejection', (event) => {
  if (state.map) return;
  reportError('promise', String(event.reason || 'unhandled rejection'));
});

els.locate.addEventListener('click', locate);
els.overlayRetry.addEventListener('click', () => location.reload());
boot();
