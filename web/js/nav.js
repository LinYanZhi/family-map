// @generated
// 基础导航：持续定位跟随 + 当前/下一步指令 + 剩余距离时间 + 语音播报 + 偏航重算
import { api } from './api.js';
import { toast } from './ui.js';

const EARTH_R = 6371000;

function meters(a, b) {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111320 * Math.cos(lat);
  const dy = (b[1] - a[1]) * 110540;
  return Math.hypot(dx, dy);
}

export function formatDistance(m) {
  if (!Number.isFinite(m)) return '--';
  return m < 1000 ? `${Math.round(m)} 米` : `${(m / 1000).toFixed(1)} 公里`;
}

export function formatDuration(s) {
  if (!Number.isFinite(s) || s < 0) return '--';
  if (s < 60) return `${Math.round(s)} 秒`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟`;
  return `${Math.floor(s / 3600)} 小时 ${Math.round((s % 3600) / 60)} 分`;
}

function cumulative(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + meters(points[i - 1], points[i]));
  return cum;
}

export function nearestOnPath(points, cum, point) {
  let bestDistance = Infinity;
  let bestTravel = 0;
  let bestSegment = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const latRad = (a[1] * Math.PI) / 180;
    const kx = 111320 * Math.cos(latRad);
    const ky = 110540;
    const ax = a[0] * kx;
    const ay = a[1] * ky;
    const bx = b[0] * kx;
    const by = b[1] * ky;
    const px = point[0] * kx;
    const py = point[1] * ky;
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
    const dx = px - (ax + vx * t);
    const dy = py - (ay + vy * t);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTravel = cum[i] + (cum[i + 1] - cum[i]) * t;
      bestSegment = i;
    }
  }
  return { distance: bestDistance, travel: bestTravel, segment: bestSegment };
}

export function createNav({ mapView, els, onExit }) {
  let active = null;
  let watchId = null;
  let voice = true;

  function setVoice(flag) {
    voice = flag;
    if (els.navVoice) els.navVoice.textContent = `语音 ${flag ? '开' : '关'}`;
  }

  function speak(text) {
    if (!voice || !text || !window.speechSynthesis) return;
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-CN';
      utterance.rate = 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch { /* ignore */ }
  }

  function isActive() {
    return Boolean(active);
  }

  function stepCumulative(steps) {
    const cum = [0];
    for (let i = 0; i < steps.length; i += 1) cum.push(cum[i] + (steps[i].distance || 0));
    return cum;
  }

  function buildActive(plan, origin, destination, waypoints) {
    const points = plan.polyline || [];
    const cum = cumulative(points);
    const total = cum[cum.length - 1] || 0;
    return {
      plan,
      origin,
      destination,
      waypoints: waypoints || [],
      points,
      cum,
      total,
      planDistance: plan.distance || total,
      planDuration: plan.duration || 0,
      steps: plan.steps || [],
      stepCum: stepCumulative(plan.steps || []),
      travel: 0,
      lastStep: -1,
      offRouteCount: 0,
      lastReplanAt: 0,
      firstFix: false,
      arrived: false,
      voice,
      lastFix: null,
    };
  }

  function renderNav() {
    if (!active) return;
    const steps = active.steps;
    const ratio = active.total ? Math.min(1, active.travel / active.total) : 0;
    const scaled = active.planDistance * ratio;
    let index = 0;
    while (index < steps.length - 1 && scaled > active.stepCum[index + 1]) index += 1;
    const current = steps[index];
    const next = steps[index + 1];
    const remainingDistance = Math.max(0, active.planDistance - scaled);
    const remainingTime = Math.max(0, active.planDuration * (1 - ratio));

    els.navInstruction.textContent = active.arrived ? '已到达目的地附近' : (current?.instruction || '继续前行');
    els.navNext.textContent = active.arrived ? '本次导航结束' : (next ? `下一步：${next.instruction}` : '即将到达终点');
    els.navRemainingDistance.textContent = formatDistance(remainingDistance);
    els.navRemainingTime.textContent = formatDuration(remainingTime);
    els.navStep.textContent = steps.length ? `第 ${Math.min(index + 1, steps.length)}/${steps.length} 步` : '';
    els.navProgressBar.style.width = `${Math.round(ratio * 100)}%`;

    if (!active.arrived && index !== active.lastStep) {
      active.lastStep = index;
      speak(current?.instruction || '');
    }
  }

  function onPosition(position) {
    if (!active) return;
    const { longitude, latitude, accuracy } = position.coords;
    const lnglat = [longitude, latitude];
    active.lastFix = lnglat;
    const near = nearestOnPath(active.points, active.cum, lnglat);
    active.travel = near.travel;

    mapView.setLocation(lnglat, accuracy);
    if (!active.firstFix) {
      active.firstFix = true;
      mapView.follow(lnglat, 17);
    } else {
      mapView.map.setCenter(lnglat);
    }

    const remaining = Math.max(0, active.planDistance * (1 - (active.total ? near.travel / active.total : 1)));
    if (!active.arrived && remaining < 30) {
      active.arrived = true;
      speak('已到达目的地附近');
      toast('已到达目的地附近，导航结束');
      renderNav();
      setTimeout(() => stop(true), 6000);
      return;
    }

    renderNav();

    if (near.distance > 120) {
      active.offRouteCount += 1;
      if (active.offRouteCount >= 3 && Date.now() - active.lastReplanAt > 60000) {
        replan(lnglat);
      }
    } else {
      active.offRouteCount = 0;
    }
  }

  function onError(error) {
    const messages = {
      1: '定位权限被拒绝，无法导航（请允许位置权限）',
      2: '无法获取位置，检查系统定位服务',
      3: '定位超时，请到空旷处重试',
    };
    toast(messages[error.code] || `定位失败：${error.message || '未知错误'}`, 6000);
    if (error.code === 1) stop(true);
  }

  async function replan(current) {
    if (!active) return;
    active.lastReplanAt = Date.now();
    active.offRouteCount = 0;
    try {
      toast('偏离路线，正在重新规划…');
      const remainingWaypoints = active.waypoints.filter((waypoint) => {
        const near = nearestOnPath(active.points, active.cum, waypoint.location);
        return near.travel > active.travel + 50;
      });
      const data = await api.route({
        mode: active.plan.mode || 'driving',
        origin: current,
        destination: active.destination.location,
        waypoints: remainingWaypoints.map((item) => item.location),
      });
      active = buildActive(data, { name: '当前位置', location: current }, active.destination, remainingWaypoints);
      mapView.setRoute({
        origin: current,
        destination: active.destination.location,
        waypoints: remainingWaypoints.map((item) => item.location),
        polyline: data.polyline,
      });
      speak('已重新规划路线');
      renderNav();
    } catch (err) {
      toast(`重新规划失败：${err.message}`, 5000);
    }
  }

  function start({ plan, origin, destination, waypoints = [] }) {
    if (!navigator.geolocation) throw new Error('这个浏览器不支持定位');
    if (watchId !== null) stop(true);
    active = buildActive(plan, origin, destination, waypoints);
    mapView.setRoute({
      origin: origin.location,
      destination: destination.location,
      waypoints: waypoints.map((item) => item.location),
      polyline: plan.polyline,
    });
    els.nav.hidden = false;
    document.body.classList.add('nav-mode');
    els.navInstruction.textContent = '正在定位…';
    els.navNext.textContent = '获取位置后开始播报';
    els.navRemainingDistance.textContent = formatDistance(active.planDistance);
    els.navRemainingTime.textContent = formatDuration(active.planDuration);
    els.navProgressBar.style.width = '0%';
    setVoice(voice);
    watchId = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000,
    });
    speak('开始导航');
    toast('开始导航：定位跟随中…');
  }

  function stop(silent = false) {
    if (watchId !== null) {
      try { navigator.geolocation.clearWatch(watchId); } catch { /* ignore */ }
      watchId = null;
    }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    const hadActive = Boolean(active);
    active = null;
    els.nav.hidden = true;
    document.body.classList.remove('nav-mode');
    if (hadActive && !silent) toast('已退出导航');
    onExit?.();
  }

  function getState() {
    if (!active) return { active: false };
    const ratio = active.total ? Math.min(1, active.travel / active.total) : 0;
    return {
      active: true,
      travel: Math.round(active.travel),
      total: Math.round(active.total),
      remaining: Math.round(active.planDistance * (1 - ratio)),
      step: active.lastStep,
      arrived: active.arrived,
      instruction: els.navInstruction.textContent,
      next: els.navNext.textContent,
      voice,
    };
  }

  els.navExit?.addEventListener('click', () => stop(false));
  els.navVoice?.addEventListener('click', () => setVoice(!voice));

  return { start, stop, isActive, getState, setVoice };
}
