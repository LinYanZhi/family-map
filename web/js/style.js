// @generated
// 地图样式面板：暗黑（默认）/ 标准 / 浅色 / 灰白，选择写入 localStorage
import { MAP_STYLES } from './map.js';
import { toast } from './ui.js';

export function createStylePanel(ctx) {
  let bodyEl = null;

  function render(body) {
    bodyEl = body;
    const current = ctx.mapView.getStyle();
    const fallback = typeof ctx.mapView.isDarkFallback === 'function' && ctx.mapView.isDarkFallback();
    const darkBlocked = fallback && current === 'dark';
    const engine = window.__app?.state?.engine || '2.0';

    body.innerHTML = `
      <div class="style-grid">
        ${MAP_STYLES.map((style) => `
          <button type="button" class="style-card ${style.key === current ? 'active' : ''}" data-style="${style.key}" aria-pressed="${style.key === current}">
            <span class="style-swatch" style="background:${style.swatch}"></span>
            <span class="style-name">${style.name}${style.key === 'dark' ? '（默认）' : ''}</span>
          </button>`).join('')}
      </div>
      ${darkBlocked
        ? '<p class="panel-error">暗黑样式数据没加载成功，当前是滤镜兜底（可能被网络/浏览器拦截）。换网络或换浏览器后重新点「暗黑」即可。</p>'
        : '<p class="panel-hint">样式选择会记住（本机浏览器），暗黑适合夜间和车内使用。</p>'}
      <p class="panel-hint">地图引擎：${engine}${engine === '1.4' ? '（兼容模式）' : ''}</p>
      ${engine === '1.4' ? '<button type="button" class="ghost-btn" data-action="engine-2">重试地图引擎 2.0</button>' : ''}
    `;

    body.querySelectorAll('[data-style]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.style;
        const style = MAP_STYLES.find((item) => item.key === key);
        ctx.mapView.setStyle(key);
        toast(`已切换：${style ? style.name : key} 样式`);
        render(bodyEl);
        // 样式数据需要 1~3 秒加载，稍后再刷新兜底提示
        setTimeout(() => {
          if (bodyEl) render(bodyEl);
        }, 3200);
      });
    });

    body.querySelectorAll('[data-action="engine-2"]').forEach((button) => {
      button.addEventListener('click', () => {
        try { localStorage.removeItem('map-app:engine'); } catch { /* ignore */ }
        location.reload();
      });
    });
  }

  return { render };
}
