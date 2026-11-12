// VIP Bottle Service (Aura Farming): a 🍾 VIP button that opens the order modal — sign text,
// neon style, tier, and a live preview drawn with the same artwork as the 3D sign board.
// Ordering is free; the server just queues shows so they never overlap.

import { el, toast } from './dom.js';
import { icon, renderIcons } from './icons.js';
import { BOTTLE_TIERS, SIGN_MAX, cleanSignText } from '../../shared/aura.js';
import { SIGN_STYLES, drawSign, signAnimates } from '../world/sign.js';

export class AuraUI {
  /**
   * @param root     the UI layer (the order modal goes here)
   * @param slot     where the 🍾 VIP button goes: the HUD's top-right column, under the toolbar
   * @param name     default sign text
   * @param onOrder  async ({ tier, signText, signStyle }) => { ok, position, error }
   */
  constructor(root, { slot, name, onOrder }) {
    this.onOrder = onOrder;
    this.name = name;
    this.tier = 1;
    this.style = SIGN_STYLES[0].id;
    this.busy = false;

    this.button = el(`
      <button type="button" class="vip-btn act pointer-events-auto glass rounded-full h-9 pl-2.5 pr-3.5 flex items-center gap-1.5 border border-gold/35"
              aria-label="VIP Bottle Service" title="VIP Bottle Service">
        <span class="text-base leading-none">🍾</span>
        <span class="text-[11px] tracking-[.18em] font-semibold text-gold/90">VIP</span>
        <span class="queue hidden rounded-full bg-gold text-black text-[10px] font-bold px-1.5"></span>
      </button>`);

    const tierCards = Object.entries(BOTTLE_TIERS)
      .map(([n, t]) => `
        <button type="button" class="tier chip rounded-xl p-3 text-left flex flex-col gap-1.5" data-tier="${n}">
          <span class="font-semibold text-sm">Tier ${n} · ${t.label}</span>
          <span class="text-[11px] text-white/60 leading-snug">${t.perks.join(' · ')}</span>
        </button>`)
      .join('');
    this.modal = el(`
      <div class="bottle-modal hidden pointer-events-auto fixed inset-0 z-50 place-items-center bg-black/65 backdrop-blur-sm p-3" role="dialog" aria-modal="true" aria-label="VIP Bottle Service">
        <div class="glass-strong rounded-2xl w-[min(96vw,560px)] max-h-[92dvh] flex flex-col overflow-hidden">
          <div class="overflow-y-auto scroll-thin p-4 md:p-5 flex flex-col gap-4 min-h-0">
            <header class="flex items-center justify-between">
              <h3 class="font-display text-2xl md:text-3xl leading-none">🍾 VIP <span class="text-gold neon-soft">BOTTLE SERVICE</span></h3>
              <button type="button" class="close act rounded-lg size-8 grid place-items-center" aria-label="Close">${icon('x', 'size-4')}</button>
            </header>
            <canvas class="preview w-full aspect-[8/3] rounded-xl bg-black" width="1024" height="384" aria-label="Sign preview"></canvas>
            <label class="flex flex-col gap-1.5 text-xs text-white/60">
              <span class="flex justify-between"><span>Sign text</span><span class="count font-mono">0/${SIGN_MAX}</span></span>
              <input class="sign field text-white" maxlength="48" autocomplete="off" spellcheck="false"/>
            </label>
            <div>
              <div class="text-[11px] tracking-[.2em] text-white/45 mb-1.5">NEON STYLE</div>
              <div class="flex flex-wrap gap-2">
                ${SIGN_STYLES.map((s) => `<button type="button" class="style chip rounded-lg px-3 py-1.5 text-sm font-medium flex items-center gap-2" data-style="${s.id}" style="--accent:${s.color}"><span class="size-2.5 rounded-full" style="background:${s.color};box-shadow:0 0 8px ${s.color}"></span>${s.label}</button>`).join('')}
              </div>
            </div>
            <div>
              <div class="text-[11px] tracking-[.2em] text-white/45 mb-1.5">TIER</div>
              <div class="grid gap-2">${tierCards}</div>
            </div>
            <p class="err hidden text-sm text-[#ff6b8a]" role="alert"></p>
          </div>
          <footer class="flex items-center gap-3 px-4 md:px-5 py-3 border-t border-white/10 bg-black/30">
            <p class="note flex-1 text-[12px] text-white/55 leading-tight">Everyone in the rave sees your show.</p>
            <button type="button" class="order btn-rave rounded-xl px-6 py-3 font-display text-xl tracking-wider text-white disabled:opacity-40 disabled:cursor-not-allowed">ORDER 🍾</button>
          </footer>
        </div>
      </div>`);

    slot.append(this.button);
    root.append(this.modal);
    renderIcons(this.modal);

    const $ = (s) => this.modal.querySelector(s);
    this.input = $('.sign');
    this.input.placeholder = name || 'Your name in lights';
    this.preview = $('.preview');
    this.orderBtn = $('.order');
    this.errEl = $('.err');

    this.button.addEventListener('click', () => this.open());
    $('.close').addEventListener('click', () => this.close());
    this.modal.addEventListener('pointerdown', (e) => e.target === this.modal && this.close());
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter') this.order();
      e.stopPropagation(); // typing must not move or dance the raver
    });
    this.modal.querySelectorAll('.style').forEach((b) =>
      b.addEventListener('click', () => {
        this.style = b.dataset.style;
        this.refresh();
      }),
    );
    this.modal.querySelectorAll('.tier').forEach((b) =>
      b.addEventListener('click', () => {
        this.tier = Number(b.dataset.tier);
        this.refresh();
      }),
    );
    this.orderBtn.addEventListener('click', () => this.order());
    this.drawLoop = this.drawLoop.bind(this);
  }

  get signText() {
    return cleanSignText(this.input.value) || cleanSignText(this.name) || 'VIP';
  }

  /** Your place in the VIP line ({ position }), or null once it's your turn. */
  setQueue(q) {
    const badge = this.button.querySelector('.queue');
    const waiting = q && q.position > 1;
    badge.classList.toggle('hidden', !waiting);
    if (waiting) badge.textContent = `#${q.position}`;
    this.button.title = waiting ? `VIP Bottle Service — you're #${q.position} in line` : 'VIP Bottle Service';
  }

  get isOpen() {
    return !this.modal.classList.contains('hidden');
  }

  open() {
    this.errEl.classList.add('hidden');
    this.modal.classList.remove('hidden');
    this.modal.classList.add('grid');
    this.refresh();
    requestAnimationFrame(this.drawLoop);
    setTimeout(() => this.input.focus(), 30);
  }

  close() {
    this.input.blur();
    this.modal.classList.add('hidden');
    this.modal.classList.remove('grid');
  }

  refresh() {
    const count = Array.from(cleanSignText(this.input.value)).length;
    this.modal.querySelector('.count').textContent = `${count}/${SIGN_MAX}`;
    this.modal.querySelectorAll('.style').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.style === this.style)));
    this.modal.querySelectorAll('.tier').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.tier) === this.tier)));
    this.orderBtn.disabled = this.busy;
    this.orderBtn.textContent = this.busy ? 'ORDERING…' : 'ORDER 🍾';
    this.previewText = this.signText;
  }

  drawLoop(now) {
    if (!this.isOpen) return;
    const t = now / 1000;
    const key = `${this.previewText}|${this.style}|${this.tier}`;
    if (key !== this.lastPreview || (signAnimates(this.style, this.tier) && t - (this.lastDraw || 0) > 0.1)) {
      drawSign(this.preview, this.previewText, this.style, { tier: this.tier, t });
      this.lastPreview = key;
      this.lastDraw = t;
    }
    requestAnimationFrame(this.drawLoop);
  }

  async order() {
    if (this.busy) return;
    this.busy = true;
    this.errEl.classList.add('hidden');
    this.refresh();
    let res;
    try {
      res = await this.onOrder({ tier: this.tier, signText: this.signText, signStyle: this.style });
    } catch {
      res = { ok: false, error: 'Something went wrong — try again.' };
    }
    this.busy = false;
    if (!res?.ok) {
      this.errEl.textContent = res?.error || 'Order failed.';
      this.errEl.classList.remove('hidden');
      this.refresh();
      return;
    }
    this.close();
    toast(res.position > 1 ? `🍾 Order placed — you're #${res.position} in the VIP line` : '🍾 Your bottles are coming out now!', 'fx', 3500);
    this.setQueue(res.position > 1 ? { position: res.position } : null);
  }
}
