// @generated
// 家庭地图 0.3：地图 + 搜索 + 路线（起终点/途径点）+ 地图样式，手机端底部面板交互
import { api } from './api.js';
import { actionMenu, createSheet, toast } from './ui.js';
import { MapView, geolocationMessage } from './map.js';
import { createSearchPanel } from './search.js';
import { createRoutePanel } from './route.js';
import { createStylePanel } from './style.js';
import { createNav } from './nav.js';

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
  overlayForce: document.getElementById('overlay-force'),
  overlayCopy: document.getElementById('overlay-copy'),
  diag: document.getElementById('diag'),
  pickbar: document.getElementById('pickbar'),
  pickCancel: document.getElementById('pick-cancel'),
  nav: document.getElementById('nav'),
  navInstruction: document.getElementById('nav-instruction'),
  navNext: document.getElementById('nav-next'),
  navRemainingDistance: document.getElementById('nav-remaining-distance'),
  navRemainingTime: document.getElementById('nav-remaining-time'),
  navStep: document.getElementById('nav-step'),
  navProgressBar: document.getElementById('nav-progress-bar'),
  navVoice: document.getElementById('nav-voice'),
  navExit: document.getElementById('nav-exit'),
};

const state = {
  mapView: null,
  sheet: null,
  active: null,
  panels: {},
  nav: null,
  pickResolve: null,
  engine: '2.0',
};
const reportedErrors = new Set();
const ENGINE_KEY = 'map-app:engine';

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

function reportUncaught(code, message, detail) {
  const key = `${code}:${message}`;
  if (reportedErrors.has(key) || reportedErrors.size > 20) return;
  reportedErrors.add(key);
  reportError(code, message, detail);
}

// 关键交互埋点（用户报 bug 时可从 data/client-errors.log 还原卡在哪一步）
function trace(message, detail) {
  reportError('ui', message, detail);
}

function showError(code, message, detail) {
  setStatus('err');
  els.overlayTitle.textContent = '地图加载失败';
  els.overlayText.textContent = `[${code}] ${message}`;
  els.overlayRetry.hidden = false;
  els.overlayForce.hidden = true;
  els.overlayCopy.hidden = true;
  if (els.diag) els.diag.textContent = `${navigator.userAgent} · ${new Date().toLocaleString()}`;
  els.overlay.hidden = false;
  reportError(code, message, detail);
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext
      && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

function preferredEngine() {
  try {
    const forced = localStorage.getItem(ENGINE_KEY);
    if (forced === '1.4') return '1.4';
    if (forced === '2.0') return '2.0';
  } catch { /* ignore */ }
  // 没有 WebGL 时高德 2.0 会提示「浏览器版本过低」，直接用 1.4
  return supportsWebGL() ? '2.0' : '1.4';
}

function setEnginePreference(engine) {
  try {
    localStorage.setItem(ENGINE_KEY, engine);
  } catch { /* ignore */ }
}

function showCompatOverlay(reason, canForce = true) {
  setStatus('err');
  els.overlayTitle.textContent = '浏览器不支持地图引擎';
  els.overlayText.textContent = `${reason}\n\n${canForce ? '可以点「兼容模式重试」（换用高德 1.4 引擎），或' : ''}换 Chrome / Safari / 高德地图 App 打开（点「复制地址」）。`;
  els.overlayRetry.hidden = true;
  els.overlayForce.hidden = !canForce;
  els.overlayCopy.hidden = false;
  if (els.diag) els.diag.textContent = `${navigator.userAgent} · 引擎 ${state.engine}`;
  els.overlay.hidden = false;
  reportError('browser', 'engine_unsupported', { engine: state.engine, reason, canForce });
}

function hideOverlay() {
  els.overlay.hidden = true;
}

function loadAmapOnce(cfg, engine) {
  return new Promise((resolve, reject) => {
    if (window.AMap) {
      resolve();
      return;
    }
    window._AMapSecurityConfig = { securityJsCode: cfg.securityJsCode };
    const version = engine === '1.4' ? '1.4.15' : '2.0';
    const script = document.createElement('script');
    script.src = `https://webapi.amap.com/maps?v=${version}&key=${encodeURIComponent(cfg.jsKey)}&plugin=AMap.Scale`;
    const timer = setTimeout(() => reject(new Error(`高德 JS API ${version} 加载超时（检查网络或隧道）`)), 15000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.AMap) resolve();
      else reject(new Error('高德 JS API 未就绪'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`高德 JS API ${version} 脚本请求失败（检查网络或拦截）`));
    };
    document.head.appendChild(script);
  });
}

async function loadAmap(cfg, engine) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await loadAmapOnce(cfg, engine);
      return;
    } catch (err) {
      lastError = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastError || new Error('高德 JS API 加载失败');
}

// iOS 键盘会盖住 fixed 定位的底部面板：用 VisualViewport 把面板抬到键盘上方
function setupKeyboardInset() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const apply = () => {
    const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
    document.documentElement.style.setProperty('--kb-inset', `${inset}px`);
    document.body.classList.toggle('kb-open', inset > 90);
  };
  viewport.addEventListener('resize', apply);
  viewport.addEventListener('scroll', apply);
  apply();
}

function openSheet(kind) {
  const titles = { search: '搜索地点', route: '路线规划', style: '地图样式' };
  trace('sheet:open', { kind });
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

function hidePickBar() {
  els.pickbar.hidden = true;
}

function cancelPickFlow() {
  if (state.mapView) state.mapView.cancelPick();
  hidePickBar();
  if (state.pickResolve) {
    const resolve = state.pickResolve;
    state.pickResolve = null;
    resolve(null);
  }
}

// forcedChoice 用于「连续选点」：跳过操作菜单直接用上一步选过的方式
async function pickPoint(label, forcedChoice = null) {
  trace('pick:start', { label, forced: forcedChoice });
  const choice = forcedChoice || await actionMenu(`选择${label}`, [
    { id: 'locate', label: '使用我的位置' },
    { id: 'search', label: '搜索地点' },
    { id: 'map', label: '在地图上选点' },
  ]);
  trace('pick:choice', { label, choice });
  if (!choice) return null;

  if (choice === 'locate') {
    try {
      const point = await state.mapView.locate();
      trace('pick:resolved', { label, by: 'locate' });
      toast('已使用当前位置');
      return { ...point, __method: 'locate' };
    } catch (err) {
      toast(geolocationMessage(err));
      return null;
    }
  }

  if (choice === 'search') {
    state.sheet.close();
    const point = await state.panels.search.pickPoint(label);
    trace('pick:resolved', { label, by: 'search', name: point?.name || null });
    return point ? { ...point, __method: 'search' } : null;
  }

  if (choice === 'map') {
    state.sheet.close();
    els.pickbar.hidden = false;
    const lnglat = await new Promise((resolve) => {
      state.pickResolve = resolve;
      state.mapView.pickOnce((point) => {
        state.pickResolve = null;
        resolve(point);
      });
    });
    els.pickbar.hidden = true;
    if (!lnglat) return null;
    try {
      const data = await api.regeo(lnglat);
      trace('pick:resolved', { label, by: 'map', name: data.address || '' });
      return { name: data.address || '地图选点', location: lnglat, __method: 'map' };
    } catch {
      trace('pick:resolved', { label, by: 'map', name: '地图选点' });
      return { name: '地图选点', location: lnglat, __method: 'map' };
    }
  }

  return null;
}

function startApp(engine) {
  state.engine = engine;
  state.mapView = new MapView(window.AMap, els.map, {
    styleCheck: engine === '2.0',
    onStyleResult: (key, ok, detail) => {
      trace('style:check', { key, ok, ...detail });
      if (!ok && key === 'dark') {
        toast('暗黑样式数据加载失败（可能被网络拦截），已用滤镜兜底；换网络后可重试', 7000);
      }
    },
  });

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
    startNav: (payload) => {
      trace('nav:start', { distance: payload?.plan?.distance ?? null });
      closeSheet();
      try {
        state.nav.start(payload);
      } catch (err) {
        toast(err.message || '无法开始导航');
      }
    },
    setRoutePoint: (kind, point) => {
      trace('route:setPoint', { kind, name: point?.name || null });
      // 兜底：若还有未完成的选点流程，先收掉，避免状态悬挂
      state.panels.search.cancelPick();
      state.panels.route.setPoint(kind, point);
      openSheet('route');
    },
    trace,
  };

  state.panels = {
    search: createSearchPanel(ctx),
    route: createRoutePanel(ctx),
    style: createStylePanel(ctx),
  };

  state.nav = createNav({
    mapView: state.mapView,
    els: {
      nav: els.nav,
      navInstruction: els.navInstruction,
      navNext: els.navNext,
      navRemainingDistance: els.navRemainingDistance,
      navRemainingTime: els.navRemainingTime,
      navStep: els.navStep,
      navProgressBar: els.navProgressBar,
      navVoice: els.navVoice,
      navExit: els.navExit,
    },
    onExit: () => {
      if (state.panels.route) openSheet('route');
    },
  });

  state.mapView.onMapClick(() => {
    if (state.sheet.isOpen) state.sheet.close();
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const kind = tab.dataset.sheet;
      cancelPickFlow();
      if (state.sheet.isOpen && state.active === kind) {
        state.sheet.close();
        return;
      }
      openSheet(kind);
    });
  });

  els.pickCancel.addEventListener('click', () => {
    cancelPickFlow();
    toast('已取消选点');
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

  setupKeyboardInset();

  window.__app = {
    state,
    api,
    panels: state.panels,
    nav: state.nav,
    mapView: state.mapView,
    openSheet,
    closeSheet,
  };
  window.__nav = state.nav;
  setStatus('ok');
  toast(`地图已加载（白云区 · 引擎 ${engine}）：底部可搜索 / 路线 / 样式`, 5000);

  // 高德在部分内置浏览器会自己弹「浏览器版本过低」提示；检测到就引导切换兼容模式
  setTimeout(() => {
    const text = els.map.innerText || '';
    if (/浏览器版本过低|请升级.{0,8}浏览器|不支持.{0,6}浏览器/.test(text)) {
      trace('engine:unsupported', { engine, snippet: text.slice(0, 80) });
      const canForce = engine === '2.0';
      showCompatOverlay(
        canForce
          ? '当前浏览器不支持高德地图 2.0（内置浏览器/旧内核常见）。'
          : '兼容引擎 1.4 在当前浏览器也不可用。',
        canForce,
      );
    }
  }, 2600);
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

  let engine = preferredEngine();
  state.engine = engine;
  trace('engine:choice', { engine, webgl: supportsWebGL() });
  try {
    await loadAmap(cfg, engine);
  } catch (err) {
    if (engine === '2.0') {
      trace('engine:fallback-1.4', { reason: err.message });
      try { window.AMap = undefined; } catch { /* ignore */ }
      try {
        await loadAmap(cfg, '1.4');
        engine = '1.4';
        state.engine = engine;
      } catch (err2) {
        showError('script', err2.message, { online: navigator.onLine });
        return;
      }
    } else {
      showError('script', err.message, { online: navigator.onLine });
      return;
    }
  }
  try {
    startApp(engine);
  } catch (err) {
    showError('init', err.message || '地图初始化异常');
  }
}

window.addEventListener('error', (event) => {
  reportUncaught('js', event.message || 'uncaught error', { source: event.filename, line: event.lineno });
});

window.addEventListener('unhandledrejection', (event) => {
  reportUncaught('promise', String(event.reason || 'unhandled rejection'));
});

els.overlayRetry.addEventListener('click', () => location.reload());

els.overlayForce.addEventListener('click', () => {
  trace('engine:force-1.4');
  setEnginePreference('1.4');
  location.reload();
});

els.overlayCopy.addEventListener('click', async () => {
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast('地址已复制，可粘贴到 Chrome / Safari / 高德 App 打开', 6000);
  } catch {
    window.prompt('复制这个地址到其它浏览器打开：', url);
  }
});

boot();
