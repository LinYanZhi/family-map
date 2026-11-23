// @generated
// 搜索面板：普通搜索（可设起/终点） + 专用选点模式（点任意结果行=选中，带取消）
import { api } from './api.js';
import { escapeHtml, toast } from './ui.js';

const QUICK = ['白云万达广场', '广州塔', '番禺广场', '白云机场', '北京路步行街'];
const RECENT_KEY = 'map-app:recent';

function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(list) ? list.slice(0, 5).filter((word) => typeof word === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(word) {
  try {
    const list = [word, ...readRecent().filter((item) => item !== word)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

function blurActive() {
  try {
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
  } catch { /* ignore */ }
}

export function createSearchPanel(ctx) {
  let keyword = '';
  let results = [];
  let status = 'idle';
  let error = '';
  let pick = null;
  let bodyEl = null;

  function chipList() {
    return [...new Set([...QUICK, ...readRecent()])].slice(0, 8);
  }

  function render(body) {
    bodyEl = body;
    const picker = Boolean(pick);
    body.innerHTML = `
      <form class="search-form">
        <input class="search-input" type="search" placeholder="搜索地点，如：白云万达广场"
               autocomplete="off" enterkeyhint="search" value="${escapeHtml(keyword)}">
        <button class="search-submit" type="submit">搜索</button>
      </form>
      <div class="chips">
        ${chipList().map((word) => `<button type="button" class="chip" data-word="${escapeHtml(word)}">${escapeHtml(word)}</button>`).join('')}
      </div>
      <p class="panel-hint" data-hint ${picker ? '' : 'hidden'}>${picker ? `点下方结果确认${pick.label}` : ''}</p>
      <div class="results"></div>
    `;

    const input = body.querySelector('.search-input');
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

    requestAnimationFrame(() => {
      try {
        input.focus({ preventScroll: true });
        input.select();
      } catch { /* ignore */ }
    });
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

    const picker = Boolean(pick);
    box.innerHTML = results.map((poi, index) => `
      <div class="result ${picker ? 'result-pick' : ''}" data-index="${index}">
        <button type="button" class="result-main" data-action="locate">
          <span class="result-name">${escapeHtml(poi.name)}</span>
          <span class="result-meta">${escapeHtml([poi.adname, poi.address].filter(Boolean).join(' · '))}</span>
        </button>
        ${picker
          ? '<span class="pick-arrow" aria-hidden="true">选择 ›</span>'
          : `<span class="result-actions">
               <button type="button" class="mini-btn" data-action="origin">起</button>
               <button type="button" class="mini-btn" data-action="destination">终</button>
             </span>`}
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
      pushRecent(query);
    } catch (err) {
      status = 'error';
      error = err.message;
    }
    renderResults();
  }

  function resolvePick(poi) {
    if (!pick) return;
    const current = pick;
    pick = null;
    blurActive();
    ctx.closeSheet();
    current.resolve({ name: poi.name, location: poi.location });
  }

  function onResultsClick(event) {
    const row = event.target.closest('.result');
    if (!row) return;
    const poi = results[Number(row.dataset.index)];
    if (!poi) return;

    // 选点模式：点这一行的任何位置都算选中（不区分按钮/文字，避免误触）
    if (pick) {
      resolvePick(poi);
      return;
    }

    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'locate') {
      ctx.mapView.setSearchMarker(poi.location);
      ctx.mapView.focus(poi.location, 16);
      toast(`已定位：${poi.name}`);
      return;
    }
    if (action === 'origin' || action === 'destination') {
      ctx.setRoutePoint(action, { name: poi.name, location: poi.location });
    }
  }

  function pickPoint(label) {
    return new Promise((resolve) => {
      pick = { label, resolve };
      ctx.openSheet('search');
    });
  }

  function cancelPick() {
    if (!pick) return;
    const current = pick;
    pick = null;
    blurActive();
    current.resolve(null);
  }

  return { render, pickPoint, cancelPick, run, getResults: () => results, isPicking: () => Boolean(pick) };
}
