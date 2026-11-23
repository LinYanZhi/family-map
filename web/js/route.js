// @generated
// 路线面板：驾车/步行/骑行 + 起终点/途径点 + 多方案切换 + 直达对比 + 开始导航
import { api } from './api.js';
import { escapeHtml, toast } from './ui.js';
import { formatDistance, formatDuration } from './nav.js';

const MODES = [
  { id: 'driving', name: '驾车' },
  { id: 'walking', name: '步行' },
  { id: 'riding', name: '骑行' },
];

const distanceText = (m) => formatDistance(m);
const durationText = (s) => formatDuration(s);

export function createRoutePanel(ctx) {
  const state = {
    mode: 'driving',
    origin: null,
    destination: null,
    waypoints: [],
    useWaypoints: false,
    plans: [],
    direct: null,
    activePlan: 0,
    loading: false,
    error: '',
  };
  let bodyEl = null;
  let justPlanned = false;

  const usedWaypoints = () => (state.useWaypoints && state.mode === 'driving' ? state.waypoints.filter(Boolean) : []);

  function pointRow(kind, label, name) {
    const placeholder = !name;
    return `<button type="button" class="point-row" data-point="${kind}">
      <span class="point-dot ${kind}">${label}</span>
      <span class="point-name ${placeholder ? 'placeholder' : ''}">${escapeHtml(name || (kind === 'origin' ? '选择出发点' : '选择终点'))}</span>
      <span class="chevron" aria-hidden="true">›</span>
    </button>`;
  }

  function waypointRow(point, index) {
    return `<div class="point-row waypoint-row">
      <span class="point-dot waypoint">${index + 1}</span>
      <button type="button" class="point-name as-btn" data-point="waypoint" data-index="${index}">
        ${escapeHtml(point?.name || '选择途径点')}
      </button>
      <button type="button" class="remove-wp" data-action="remove-wp" data-index="${index}" aria-label="删除途径点">×</button>
    </div>`;
  }

  function planTabs() {
    if (state.plans.length < 2) return '';
    return `<div class="plan-tabs">${state.plans.map((plan, index) => `
      <button type="button" class="plan-tab ${index === state.activePlan ? 'active' : ''}" data-plan-index="${index}">
        <span class="plan-name">${escapeHtml(plan.label || `方案${index + 1}`)}</span>
        <span class="plan-meta">${distanceText(plan.distance)} · ${durationText(plan.duration)}</span>
      </button>`).join('')}</div>`;
  }

  function compareHtml(plan) {
    if (!state.direct) return '';
    const direct = state.direct;
    const deltaDistance = plan.distance - direct.distance;
    const deltaDuration = plan.duration - direct.duration;
    return `<div class="compare">
      <div class="compare-row"><i class="compare-dot active"></i><span>经途径点</span><b>${distanceText(plan.distance)} · ${durationText(plan.duration)}</b></div>
      <div class="compare-row"><i class="compare-dot direct"></i><span>直达（不走途径点）</span><b>${distanceText(direct.distance)} · ${durationText(direct.duration)}</b></div>
      <p class="compare-diff">${deltaDistance >= 0 ? '多绕' : '少绕'} ${distanceText(Math.abs(deltaDistance))} · ${deltaDuration >= 0 ? '多' : '少'} ${durationText(Math.abs(deltaDuration))}</p>
      <div class="route-legend">
        <span><i class="legend-line active"></i>当前方案</span>
        <span><i class="legend-line dashed"></i>直达对比线</span>
      </div>
    </div>`;
  }

  function waypointListHtml(waypoints) {
    if (!waypoints.length) return '';
    return `<div class="waypoint-list">
      <span class="waypoint-title">途经点</span>
      <ol>${waypoints.map((point, index) => `<li><span class="wp-index">${index + 1}</span>${escapeHtml(point.name)}</li>`).join('')}</ol>
    </div>`;
  }

  function resultHtml() {
    if (state.error) return `<p class="panel-error">${escapeHtml(state.error)}</p>`;
    if (!state.plans.length) return '';
    const plan = state.plans[state.activePlan] || state.plans[0];
    const waypoints = usedWaypoints();
    return `${planTabs()}
      <div class="route-summary">
        <div class="sum-cell"><span class="sum-value">${distanceText(plan.distance)}</span><span class="sum-label">距离</span></div>
        <div class="sum-cell"><span class="sum-value">${durationText(plan.duration)}</span><span class="sum-label">预计用时</span></div>
      </div>
      ${compareHtml(plan)}
      ${waypointListHtml(waypoints)}
      <button type="button" class="primary-btn" data-action="nav">开始导航</button>
      <button type="button" class="ghost-btn" data-action="collapse">收起面板看地图</button>
      <details class="steps">
        <summary>查看 ${plan.steps.length} 步指引</summary>
        <ol>${plan.steps.map((step) => `<li>${escapeHtml(step.instruction)}<em>${distanceText(step.distance)}</em></li>`).join('')}</ol>
      </details>`;
  }

  function render(body) {
    bodyEl = body;
    const showWaypoints = state.useWaypoints;
    body.innerHTML = `
      <div class="segmented" role="tablist">
        ${MODES.map((mode) => `<button type="button" class="seg ${state.mode === mode.id ? 'active' : ''}" data-mode="${mode.id}">${mode.name}</button>`).join('')}
      </div>
      <div class="point-list">
        ${pointRow('origin', '起', state.origin?.name)}
        ${showWaypoints ? state.waypoints.map((point, index) => waypointRow(point, index)).join('') : ''}
        ${showWaypoints && state.waypoints.length < 3 ? '<button type="button" class="add-wp" data-action="add-wp">＋ 添加途径点</button>' : ''}
        ${pointRow('destination', '终', state.destination?.name)}
      </div>
      <div class="switch-row">
        <span class="switch-label">使用途径点<span class="switch-sub">关闭则按起终点直达规划</span></span>
        <button type="button" class="switch ${state.useWaypoints ? 'on' : ''}" data-action="toggle-wp"
                role="switch" aria-checked="${state.useWaypoints}" aria-label="使用途径点"><span class="knob"></span></button>
      </div>
      ${showWaypoints && state.mode !== 'driving' ? '<p class="panel-hint">步行/骑行暂不支持途径点，将按直达路线规划</p>' : ''}
      <button type="button" class="primary-btn" data-action="plan" ${state.loading ? 'disabled' : ''}>
        ${state.loading ? '规划中…' : (state.plans.length ? '重新规划' : '规划路线')}
      </button>
      <div class="route-result">${resultHtml()}</div>
    `;
    attach(body);
    if (justPlanned) {
      justPlanned = false;
      // 规划完滚到结果顶部（方案切换/对比在这里），而不是滚到最底部的步骤
      const anchor = bodyEl.querySelector('.plan-tabs') || bodyEl.querySelector('.route-summary');
      bodyEl.scrollTop = anchor ? Math.max(0, anchor.offsetTop - bodyEl.offsetTop - 8) : 0;
    }
  }

  function attach(body) {
    body.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.mode === button.dataset.mode) return;
        state.mode = button.dataset.mode;
        clearPlan();
        render(bodyEl);
      });
    });

    body.querySelectorAll('[data-point]').forEach((button) => {
      button.addEventListener('click', () => choosePoint(button.dataset.point, Number(button.dataset.index ?? -1)));
    });

    body.querySelectorAll('[data-action="remove-wp"]').forEach((button) => {
      button.addEventListener('click', () => {
        state.waypoints.splice(Number(button.dataset.index), 1);
        clearPlan();
        render(bodyEl);
      });
    });

    body.querySelectorAll('[data-action="add-wp"]').forEach((button) => {
      button.addEventListener('click', () => choosePoint('waypoint', -1));
    });

    body.querySelectorAll('[data-action="toggle-wp"]').forEach((button) => {
      button.addEventListener('click', () => {
        state.useWaypoints = !state.useWaypoints;
        clearPlan();
        render(bodyEl);
      });
    });

    body.querySelectorAll('[data-action="plan"]').forEach((button) => {
      button.addEventListener('click', plan);
    });

    body.querySelectorAll('[data-plan-index]').forEach((button) => {
      button.addEventListener('click', () => {
        state.activePlan = Number(button.dataset.planIndex);
        drawActive();
        render(bodyEl);
      });
    });

    body.querySelectorAll('[data-action="nav"]').forEach((button) => {
      button.addEventListener('click', () => {
        const plan = state.plans[state.activePlan];
        if (!plan) return;
        ctx.startNav({ plan, origin: state.origin, destination: state.destination, waypoints: usedWaypoints() });
      });
    });

    body.querySelectorAll('[data-action="collapse"]').forEach((button) => {
      button.addEventListener('click', () => ctx.closeSheet());
    });
  }

  function clearPlan() {
    state.plans = [];
    state.direct = null;
    state.activePlan = 0;
    state.error = '';
    ctx.mapView.clearRoute();
  }

  function drawActive() {
    const plan = state.plans[state.activePlan];
    if (!plan) return;
    ctx.mapView.setRoute({
      origin: state.origin.location,
      destination: state.destination.location,
      waypoints: usedWaypoints().map((point) => point.location),
      polyline: plan.polyline,
      directPolyline: state.direct?.polyline || null,
    });
  }

  async function plan() {
    if (!state.origin || !state.destination) {
      toast('请先选择出发点和终点');
      return;
    }
    const useWaypoints = state.useWaypoints && state.mode === 'driving';
    const waypoints = useWaypoints ? state.waypoints.filter(Boolean) : [];

    state.loading = true;
    state.error = '';
    state.plans = [];
    state.direct = null;
    render(bodyEl);

    try {
      const data = await api.routePlans({
        mode: state.mode,
        origin: state.origin.location,
        destination: state.destination.location,
        waypoints: waypoints.map((point) => point.location),
        direct: waypoints.length > 0,
        strategies: state.mode === 'driving' ? [0, 2, 4] : [0],
      });
      state.plans = data.plans || [];
      state.direct = data.direct || null;
      state.activePlan = 0;
      drawActive();
      justPlanned = true;
      const first = state.plans[0];
      toast(`已规划 ${state.plans.length} 条方案：${distanceText(first.distance)} · ${durationText(first.duration)}`);
    } catch (err) {
      state.error = err.message;
    }
    state.loading = false;
    render(bodyEl);
  }

  async function choosePoint(kind, index) {
    const label = kind === 'origin' ? '出发点' : kind === 'destination' ? '终点' : '途径点';
    const point = await ctx.pickPoint(label);
    if (!point) {
      ctx.openSheet('route');
      return;
    }
    if (kind === 'origin') state.origin = point;
    else if (kind === 'destination') state.destination = point;
    else {
      const slot = index >= 0 ? index : state.waypoints.length;
      state.waypoints[slot] = point;
      state.useWaypoints = true;
    }
    clearPlan();
    ctx.openSheet('route');
  }

  function setPoint(kind, point) {
    if (!point) return;
    if (kind === 'origin') state.origin = point;
    else if (kind === 'destination') state.destination = point;
    else {
      state.useWaypoints = true;
      state.waypoints.push(point);
    }
    clearPlan();
    if (bodyEl) render(bodyEl);
  }

  return { render, setPoint, plan, getState: () => state };
}
