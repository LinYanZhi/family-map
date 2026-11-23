// @generated
// 家庭地图 0.3：地图 + 搜索 + 路线（起终点/途径点）+ 地图样式，手机端底部面板交互
import { api } from './api.js';
import { actionMenu, createSheet, toast } from './ui.js';
import { MapView, geolocationMessage } from './map.js';
import { createSearchPanel } from './search.js';
import { createRoutePanel } from './route.js';
import { createStylePanel } from './style.js';

const els = {
  map: document.getElementById('map'),
  dot: document.getElementById('status-dot'),
  locate: document.getElementById('locate'),
  sheet: document.getElementById('sheet'),
  sheetTitle: document.getElementById('sheet-title'),
  sheetBody: document.getElementById('sheet-body'),
  sheetClose: document.getElementById('sheet-close'),
  sheetGrip: document.getElementById('sheet-grip'),
  overlay: document.getElementById('overlay'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayText: document.getElementById('overlay-text'),
  overlayRetry: document.getElementById('overlay-retry'),
  diag: document.getElementById('diag'),
};

const state = { mapView: null, sheet: null, active: null, panels: {} };

function setStatus(name) {
  els.dot.classList.remove('ok', 'err');
  if (name === 'ok') els.dot.classList.add('ok');
  else if (name === 'err') els.dot.classList.add('err');
}

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
  if (els.diag) els.diag.textContent = `${navigator.userAgent} · ${new Date().toLocaleString()}`;
  els.overlay.hidden = false;
  reportError(code, message, detail);
}

function hideOverlay() {
  els.overlay.hidden = true;
}

function loadAmapOnce(cfg) {
  return new Promise((resolve, reject) => {
    if (window.AMap) {
      resolve();
      return;
    }
    window._AMapSecurityConfig = { securityJsCode: cfg.securityJsCode };
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(cfg.jsKey)}&plugin=AMap.Scale`;
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

async function loadAmap(cfg) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await loadAmapOnce(cfg);
      return;
    } catch (err) {
      lastError = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastError || new Error('高德 JS API 加载失败');
}

function openSheet(kind) {
  const titles = { search: '搜索地点', route: '路线规划', style: '地图样式' };
  state.active = kind;
  state.sheet.open(titles[kind]);
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.sheet === kind);
  });
  state.panels[kind].render(els.sheetBody);
}

function closeSheet() {
  state.sheet?.close();
}

async function pickPoint(label) {
  const choice = await actionMenu(`选择${label}`, [
    { id: 'locate', label: '使用我的位置' },
    { id: 'search', label: '搜索地点' },
    { id: 'map', label: '在地图上选点' },
  ]);
  if (!choice) return null;

  if (choice === 'locate') {
    try {
      return await state.mapView.locate();
    } catch (err) {
      toast(geolocationMessage(err));
      return null;
    }
  }

  if (choice === 'search') {
    state.sheet.close();
    return state.panels.search.pickPoint(label);
  }

  if (choice === 'map') {
    state.sheet.close();
    toast('请在地图上点选位置', 8000);
    const lnglat = await new Promise((resolve) => state.mapView.pickOnce(resolve));
    try {
      const data = await api.regeo(lnglat);
      return { name: data.address || '地图选点', location: lnglat };
    } catch {
      return { name: '地图选点', location: lnglat };
    }
  }

  return null;
}

function startApp() {
  state.mapView = new MapView(window.AMap, els.map);

  state.sheet = createSheet({
    sheet: els.sheet,
    titleEl: els.sheetTitle,
    bodyEl: els.sheetBody,
    closeBtn: els.sheetClose,
    grip: els.sheetGrip,
    onClose: () => {
      state.active = null;
      document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
      state.panels.search.cancelPick();
    },
  });

  const ctx = {
    api,
    mapView: state.mapView,
    openSheet,
    closeSheet,
    pickPoint,
    setRoutePoint: (kind, point) => {
      state.panels.route.setPoint(kind, point);
      openSheet('route');
    },
  };

  state.panels = {
    search: createSearchPanel(ctx),
    route: createRoutePanel(ctx),
    style: createStylePanel(ctx),
  };

  state.mapView.onMapClick(() => {
    if (state.sheet.isOpen) state.sheet.close();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const kind = tab.dataset.sheet;
      if (state.sheet.isOpen && state.active === kind) {
        state.sheet.close();
        return;
      }
      state.mapView.cancelPick();
      openSheet(kind);
    });
  });

  els.locate.addEventListener('click', async () => {
    els.locate.disabled = true;
    try {
      await state.mapView.locate();
      toast('已定位到当前位置');
    } catch (err) {
      toast(geolocationMessage(err));
    } finally {
      els.locate.disabled = false;
    }
  });

  window.__app = { state, api, panels: state.panels, mapView: state.mapView, openSheet, closeSheet };
  setStatus('ok');
  toast('地图已加载（白云区）：底部可搜索地点 / 规划路线 / 切换样式', 5000);
}

async function boot() {
  hideOverlay();
  setStatus('loading');
  let cfg;
  try {
    const data = await api.config();
    cfg = data.amap;
  } catch (err) {
    showError('config', err.message);
    return;
  }
  try {
    await loadAmap(cfg);
  } catch (err) {
    showError('script', err.message, { online: navigator.onLine });
    return;
  }
  try {
    startApp();
  } catch (err) {
    showError('init', err.message || '地图初始化异常');
  }
}

window.addEventListener('error', (event) => {
  if (state.mapView) return;
  reportError('js', event.message || 'uncaught error', { source: event.filename, line: event.lineno });
});

window.addEventListener('unhandledrejection', (event) => {
  if (state.mapView) return;
  reportError('promise', String(event.reason || 'unhandled rejection'));
});

els.overlayRetry.addEventListener('click', () => location.reload());
boot();
