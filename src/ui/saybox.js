// "Say above my head": tap your own raver (or press Y) to pop a short line up in a speech
// bubble that everyone around you can see. It doesn't go into the chat log.

import { el } from './dom.js';
import { icon, renderIcons } from './icons.js';

const PRESETS = ['👋 hiii', '🔥 LET’S GO', '💜 PLUR', '🙌 this track!', '💧 hydrate'];

export class SayBox {
  /** @param onSay (text) => void */
  constructor(parent, { onSay }) {
    this.onSay = onSay;
    this.node = el(`
      <div class="say hidden pointer-events-auto absolute left-1/2 -translate-x-1/2 bottom-[calc(132px+env(safe-area-inset-bottom))] md:bottom-[150px]
                  w-[min(92vw,420px)] glass-strong rounded-2xl p-3 flex-col gap-2.5">
        <div class="flex items-center justify-between">
          <div class="text-[11px] font-semibold tracking-[.2em] text-white/55 flex items-center gap-1.5">${icon('message-circle', 'size-3.5')} SAY ABOVE YOUR HEAD</div>
          <button type="button" class="close act rounded-lg size-7 grid place-items-center" aria-label="Close">${icon('x', 'size-4')}</button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${PRESETS.map((p) => `<button type="button" class="preset chip rounded-full px-2.5 py-1 text-xs font-semibold">${p}</button>`).join('')}
        </div>
        <form class="flex gap-2">
          <input class="field flex-1 min-w-0 !py-2 text-sm text-white placeholder:text-white/40" maxlength="80" placeholder="Everyone near you will see it…" aria-label="Say above your head"/>
          <button class="act glass rounded-xl px-3 border border-white/10" aria-label="Say">${icon('send', 'size-4')}</button>
        </form>
      </div>`);
    parent.append(this.node);
    renderIcons(this.node);
    this.input = this.node.querySelector('input');
    const say = (text) => {
      text = text.trim();
      if (!text) return;
      this.onSay(text.slice(0, 80));
      this.close();
    };
    this.node.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      say(this.input.value);
    });
    this.node.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => say(b.textContent)));
    this.node.querySelector('.close').addEventListener('click', () => this.close());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      e.stopPropagation();
    });
  }

  get isOpen() {
    return !this.node.classList.contains('hidden');
  }

  open() {
    this.input.value = '';
    this.node.classList.remove('hidden');
    this.node.classList.add('flex');
    setTimeout(() => this.input.focus(), 30);
  }

  close() {
    this.input.blur();
    this.node.classList.add('hidden');
    this.node.classList.remove('flex');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }
}
