// @generated
// 路线面板：驾车/步行/骑行 + 起终点 + 最多 3 个途径点（可开关）+ 距离/时长/步骤
import { api } from './api.js';
import { escapeHtml, toast } from './ui.js';

const MODES = [
  { id: 'driving', name: '驾车' },
  { id: 'walking', name: '步行' },
  { id: 'riding', name: '骑行' },
];

const distanceText = (m) => (m < 1000 ? `${Math.round(m)} 米` : `${(m / 1000).toFixed(1)} 公里`);
const durationText = (s) => {
  if (s < 60) return `${Math.round(s)} 秒`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟`;
  return `${Math.floor(s / 3600)} 小时 ${Math.round((s % 3600) / 60)} 分`;
};

export function createRoutePanel(ctx) {
  const state = {
    mode: 'driving',
    origin: null,
    destination: null,
    waypoints: [],
    useWaypoints: false,
    result: null,
    loading: false,
    error: '',
  };
  let bodyEl = null;
  let justPlanned = false;

  function pointRow(kind, label, name) {
    const placeholder = name === null;
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

  function resultHtml() {
    if (!state.result) return '';
    const result = state.result;
    return `
      <div class="route-summary">
        <div class="sum-cell"><span class="sum-value">${distanceText(result.distance)}</span><span class="sum-label">距离</span></div>
        <div class="sum-cell"><span class="sum-value">${durationText(result.duration)}</span><span class="sum-label">预计用时</span></div>
      </div>
      <button type="button" class="ghost-btn" data-action="collapse">收起面板看地图</button>
      <details class="steps">
        <summary>查看 ${result.steps.length} 步指引</summary>
        <ol>${result.steps.map((step) => `<li>${escapeHtml(step.instruction)}<em>${distanceText(step.distance)}</em></li>`).join('')}</ol>
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
        ${state.loading ? '规划中…' : '规划路线'}
      </button>
      ${state.error ? `<p class="panel-error">${escapeHtml(state.error)}</p>` : ''}
      <div class="route-result">${resultHtml()}</div>
    `;

    body.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.mode === button.dataset.mode) return;
        state.mode = button.dataset.mode;
        state.result = null;
        state.error = '';
        ctx.mapView.clearRoute();
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

    body.querySelectorAll('[data-action="collapse"]').forEach((button) => {
      button.addEventListener('click', () => ctx.closeSheet());
    });

    if (justPlanned) {
      justPlanned = false;
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }
  }

  function clearPlan() {
    state.result = null;
    state.error = '';
    ctx.mapView.clearRoute();
  }

  async function choosePoint(kind, index) {
    const label = kind === 'origin' ? '出发点' : kind === 'destination' ? '终点' : '途径点';
    const point = await ctx.pickPoint(label);
    if (!point) return;
    if (kind === 'origin') state.origin = point;
    else if (kind === 'destination') state.destination = point;
    else {
      const slot = index >= 0 ? index : state.waypoints.length;
      state.waypoints[slot] = point;
      state.useWaypoints = true;
    }
    clearPlan();
    render(bodyEl);
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
    state.result = null;
    render(bodyEl);

    try {
      const data = await api.route({
        mode: state.mode,
        origin: state.origin.location,
        destination: state.destination.location,
        waypoints: waypoints.map((point) => point.location),
      });
      state.result = data;
      ctx.mapView.setRoute({
        origin: state.origin.location,
        destination: state.destination.location,
        waypoints: waypoints.map((point) => point.location),
        polyline: data.polyline,
      });
      justPlanned = true;
      toast(`路线已生成：${distanceText(data.distance)} · ${durationText(data.duration)}`);
    } catch (err) {
      state.error = err.message;
    }
    state.loading = false;
    render(bodyEl);
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
