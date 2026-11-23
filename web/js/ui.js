// @generated
// 轻量 UI 工具：toast / 底部面板 / 操作菜单
let toastTimer = 0;

export function toast(message, ms = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = message;
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createSheet({ sheet, titleEl, bodyEl, closeBtn, grip, onClose }) {
  let isOpen = false;

  function close() {
    if (!isOpen) return;
    isOpen = false;
    sheet.hidden = true;
    document.body.classList.remove('sheet-open');
    onClose?.();
  }

  function open(title) {
    titleEl.textContent = title;
    bodyEl.scrollTop = 0;
    sheet.hidden = false;
    isOpen = true;
    document.body.classList.add('sheet-open');
  }

  closeBtn.addEventListener('click', close);
  grip.addEventListener('click', close);

  return { open, close, get isOpen() { return isOpen; } };
}

// 底部操作菜单：返回 item.id；取消/点遮罩返回 null
export function actionMenu(title, items) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'action-mask';
    const card = document.createElement('div');
    card.className = 'action-card';

    const heading = document.createElement('h3');
    heading.textContent = title;
    card.appendChild(heading);

    const done = (value) => {
      mask.remove();
      resolve(value);
    };

    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'action-item';
      btn.textContent = item.label;
      btn.addEventListener('click', () => done(item.id));
      card.appendChild(btn);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'action-item action-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => done(null));
    card.appendChild(cancel);

    mask.appendChild(card);
    mask.addEventListener('click', (event) => {
      if (event.target === mask) done(null);
    });
    document.body.appendChild(mask);
  });
}
