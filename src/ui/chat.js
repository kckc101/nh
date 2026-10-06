// Stream-style chat: transparent message log bottom-left (TikTok-live style on phones),
// composer with quick-chat hype buttons.

import { el, esc } from './dom.js';
import { icon, renderIcons } from './icons.js';
import { accentColor } from '../avatar/options.js';

export const QUICK_CHAT = [
  { text: '🔥 FIRE', react: 'fire' },
  { text: '🔊 DROP IT', react: 'confetti' },
  { text: '🇰🇭 E-RAVE CAMBODIA', react: 'heart' },
  { text: '🙌 HANDS UP', react: 'cheer' },
];

export class Chat {
  constructor(parent, { onSend, onQuick, onOpenChange }) {
    this.onSend = onSend;
    this.onQuick = onQuick;
    this.onOpenChange = onOpenChange;
    this.isOpen = false;
    this.node = el(`
      <div class="chat absolute left-3 md:left-4 bottom-[calc(214px+env(safe-area-inset-bottom))] md:bottom-4 w-[min(74vw,340px)] md:w-[350px] flex flex-col gap-2 pointer-events-none">
        <div class="log flex flex-col gap-1 max-h-[24dvh] md:max-h-[34dvh] overflow-y-auto no-scrollbar pr-1"
             style="mask-image: linear-gradient(to bottom, transparent, #000 22%); -webkit-mask-image: linear-gradient(to bottom, transparent, #000 22%)" aria-live="polite"></div>
        <div class="composer hidden md:flex flex-col gap-2 pointer-events-auto">
          <div class="quick flex flex-wrap gap-1.5">
            ${QUICK_CHAT.map((q, i) => `<button type="button" class="act glass shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border border-white/10" data-q="${i}">${q.text}</button>`).join('')}
          </div>
          <form class="flex gap-2">
            <input class="field glass flex-1 min-w-0 !py-2 text-sm text-white placeholder:text-white/40" maxlength="140" placeholder="Say something… (Enter)" aria-label="Chat message"/>
            <button class="act glass rounded-xl px-3 border border-white/10" aria-label="Send">${icon('send', 'size-4')}</button>
          </form>
        </div>
      </div>`);
    parent.append(this.node);
    renderIcons(this.node);
    this.log = this.node.querySelector('.log');
    this.composer = this.node.querySelector('.composer');
    this.input = this.node.querySelector('input');
    this.node.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.onSend(text);
      this.input.value = '';
      if (matchMedia('(max-width: 767px)').matches) this.toggle(false);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.input.blur();
        if (this.isOpen) this.toggle(false);
      }
      e.stopPropagation();
    });
    this.node.querySelectorAll('[data-q]').forEach((b) =>
      b.addEventListener('click', () => {
        const q = QUICK_CHAT[Number(b.dataset.q)];
        this.onQuick(q.text, q.react);
      }),
    );
  }

  /** Mobile: open/close the composer overlay. */
  toggle(open = !this.isOpen) {
    this.isOpen = open;
    this.composer.classList.toggle('hidden', !open);
    this.composer.classList.toggle('flex', open);
    this.log.classList.toggle('pointer-events-auto', open);
    this.node.classList.toggle('!bottom-[calc(16px+env(safe-area-inset-bottom))]', open);
    this.onOpenChange?.(open);
    if (open) setTimeout(() => this.input.focus(), 50);
  }

  focus() {
    if (matchMedia('(max-width: 767px)').matches) this.toggle(true);
    else this.input.focus();
  }

  add(msg) {
    const row = document.createElement('div');
    row.className = 'msg-in text-[13px] leading-snug';
    if (msg.system) {
      row.innerHTML = `<span class="inline-block rounded-lg px-2 py-1 bg-black/35 text-gold/90 italic">${esc(msg.text)}</span>`;
    } else {
      const color = accentColor(msg.color);
      const badge = msg.isDJ ? '<span class="mr-1 rounded px-1 text-[10px] font-bold text-black align-middle" style="background:linear-gradient(90deg,#ff2bd6,#ffc400)">DJ</span>' : '';
      const bot = msg.bot ? 'opacity-90' : '';
      row.innerHTML = `<span class="inline-block rounded-lg px-2 py-1 bg-black/40 backdrop-blur-sm ${bot}">${badge}<b style="color:${color}">${esc(msg.name)}</b> <span class="text-white/90">${esc(msg.text)}</span></span>`;
    }
    this.log.append(row);
    while (this.log.children.length > 40) this.log.firstElementChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
  }
}
