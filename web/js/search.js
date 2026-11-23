// @generated
// 搜索面板：关键词搜索（后端代理高德 POI）、常用地点、结果可直接设为起/终点
import { api } from './api.js';
import { escapeHtml, toast } from './ui.js';

const QUICK = ['白云万达广场', '广州塔', '番禺广场', '白云机场', '北京路步行街'];

export function createSearchPanel(ctx) {
  let keyword = '';
  let results = [];
  let status = 'idle';
  let error = '';
  let pick = null;
  let bodyEl = null;

  function render(body) {
    bodyEl = body;
    body.innerHTML = `
      <form class="search-form">
        <input class="search-input" type="search" placeholder="搜索地点，如：白云万达广场"
               autocomplete="off" enterkeyhint="search" value="${escapeHtml(keyword)}">
        <button class="search-submit" type="submit">搜索</button>
      </form>
      <div class="chips">
        ${QUICK.map((word) => `<button type="button" class="chip" data-word="${escapeHtml(word)}">${escapeHtml(word)}</button>`).join('')}
      </div>
      <p class="panel-hint" data-hint ${pick ? '' : 'hidden'}></p>
      <div class="results"></div>
    `;

    const input = body.querySelector('.search-input');
    const hint = body.querySelector('[data-hint]');
    if (pick) hint.textContent = `正在为「${pick.label}」选择地点，点下方结果确认`;

    body.querySelector('.search-form').addEventListener('submit', (event) => {
      event.preventDefault();
      run(input.value);
    });
    body.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        input.value = chip.dataset.word;
        run(chip.dataset.word);
      });
    });
    body.querySelector('.results').addEventListener('click', onResultsClick);

    renderResults();
  }

  function renderResults() {
    if (!bodyEl) return;
    const box = bodyEl.querySelector('.results');
    if (status === 'loading') {
      box.innerHTML = '<p class="empty">搜索中…</p>';
      return;
    }
    if (status === 'error') {
      box.innerHTML = `<p class="panel-error">${escapeHtml(error)}</p>`;
      return;
    }
    if (status === 'done' && !results.length) {
      box.innerHTML = '<p class="empty">没有找到匹配地点，换个关键词试试</p>';
      return;
    }
    if (!results.length) {
      box.innerHTML = '<p class="empty">输入关键词，或点上面的常用地点</p>';
      return;
    }
    box.innerHTML = results.map((poi, index) => `
      <div class="result" data-index="${index}">
        <button type="button" class="result-main" data-action="locate">
          <span class="result-name">${escapeHtml(poi.name)}</span>
          <span class="result-meta">${escapeHtml([poi.adname, poi.address].filter(Boolean).join(' · '))}</span>
        </button>
        <span class="result-actions">
          <button type="button" class="mini-btn" data-action="origin">起</button>
          <button type="button" class="mini-btn" data-action="destination">终</button>
        </span>
      </div>`).join('');
  }

  async function run(words) {
    const query = String(words || '').trim();
    if (!query) {
      toast('先输入地点关键词');
      return;
    }
    keyword = query;
    status = 'loading';
    error = '';
    renderResults();
    try {
      const data = await api.searchPoi(query);
      results = data.pois || [];
      status = 'done';
    } catch (err) {
      status = 'error';
      error = err.message;
    }
    renderResults();
  }

  function onResultsClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = button.closest('[data-index]');
    if (!row) return;
    const poi = results[Number(row.dataset.index)];
    if (!poi) return;
    const action = button.dataset.action;

    if (action === 'locate') {
      if (pick) {
        const current = pick;
        pick = null;
        ctx.closeSheet();
        current.resolve({ name: poi.name, location: poi.location });
        return;
      }
      ctx.mapView.setSearchMarker(poi.location);
      ctx.mapView.focus(poi.location, 16);
      toast(`已定位：${poi.name}`);
      return;
    }

    ctx.setRoutePoint(action, { name: poi.name, location: poi.location });
  }

  function pickPoint(label) {
    return new Promise((resolve) => {
      pick = { label, resolve };
      ctx.openSheet('search');
      if (bodyEl) {
        const hint = bodyEl.querySelector('[data-hint]');
        if (hint) {
          hint.hidden = false;
          hint.textContent = `正在为「${label}」选择地点，点下方结果确认`;
        }
      }
    });
  }

  function cancelPick() {
    if (!pick) return;
    const current = pick;
    pick = null;
    current.resolve(null);
  }

  return { render, pickPoint, cancelPick, run, getResults: () => results };
}
