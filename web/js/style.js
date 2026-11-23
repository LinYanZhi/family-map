// @generated
// 地图样式面板：暗黑（默认）/ 标准 / 浅色 / 灰白，选择写入 localStorage
import { MAP_STYLES } from './map.js';

export function createStylePanel(ctx) {
  let bodyEl = null;

  function render(body) {
    bodyEl = body;
    const current = ctx.mapView.getStyle();
    body.innerHTML = `
      <div class="style-grid">
        ${MAP_STYLES.map((style) => `
          <button type="button" class="style-card ${style.key === current ? 'active' : ''}" data-style="${style.key}" aria-pressed="${style.key === current}">
            <span class="style-swatch" style="background:${style.swatch}"></span>
            <span class="style-name">${style.name}${style.key === 'dark' ? '（默认）' : ''}</span>
          </button>`).join('')}
      </div>
      <p class="panel-hint">样式选择会记住（本机浏览器），暗黑适合夜间和车内使用。</p>
    `;

    body.querySelectorAll('[data-style]').forEach((button) => {
      button.addEventListener('click', () => {
        ctx.mapView.setStyle(button.dataset.style);
        render(bodyEl);
      });
    });
  }

  return { render };
}
