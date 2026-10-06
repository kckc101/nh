/** Parse an HTML string into a single element. Only ever used with our own static markup. */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const $ = (root, sel) => root.querySelector(sel);
export const $$ = (root, sel) => [...root.querySelectorAll(sel)];

/** Escape untrusted text before it goes anywhere near innerHTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let toastHost = null;
export function toast(text, tone = 'info', ms = 3200) {
  if (!toastHost) {
    toastHost = el('<div class="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex flex-col items-center gap-2 pointer-events-none w-[min(92vw,420px)]"></div>');
    document.body.append(toastHost);
  }
  const color = tone === 'error' ? '#ff2d55' : tone === 'fx' ? '#ffc400' : '#00f0ff';
  const t = el(`<div class="toast-in glass-strong rounded-xl px-4 py-2 text-sm font-semibold text-center" style="box-shadow:0 0 18px ${color}55;border-color:${color}66"></div>`);
  t.textContent = text;
  toastHost.append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(-8px)';
    setTimeout(() => t.remove(), 320);
  }, ms);
}
