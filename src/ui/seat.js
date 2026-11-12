// Sitting in the stands: a "Sit here" prompt (E) when a row of seats is in reach — the seat
// glows in the stands — and once you're seated, which way to face (1–4) and Stand up (Space / W).

import { el, $, $$ } from './dom.js';
import { icon, renderIcons } from './icons.js';
import { isTouch } from '../core/device.js';

const FACINGS = [
  { id: 'stage', label: 'Stage', key: '1', icon: 'disc-3', hint: 'Face the DJ on the centre spot' },
  { id: 'left', label: 'Left', key: '2', icon: 'rotate-ccw', hint: 'Look along the row' },
  { id: 'right', label: 'Right', key: '3', icon: 'rotate-cw', hint: 'Look along the row the other way' },
  { id: 'sky', label: 'Sky', key: '4', icon: 'telescope', hint: 'Look up at the pylon lights and the roof' },
];
const kbd = (k) => (isTouch ? '' : `<kbd class="hidden md:inline text-[9px] text-white/40 font-mono">${k}</kbd>`);

export class SeatBar {
  /** @param onSit () => void · onStand () => void · onFace (id) => void */
  constructor(parent, { onSit, onStand, onFace }) {
    this.sit = el(`
      <button type="button" class="seat-sit hidden pointer-events-auto absolute left-1/2 -translate-x-1/2 bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-[200px]
                     btn-rave rounded-full px-5 py-2.5 text-sm font-semibold items-center gap-2" title="Sit in the glowing seat">
        ${icon('armchair', 'size-4')} Sit here ${isTouch ? '' : '<kbd class="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]">E</kbd>'}
      </button>`);
    this.panel = el(`
      <div class="seat-panel hidden pointer-events-auto absolute left-1/2 -translate-x-1/2 bottom-[calc(8px+env(safe-area-inset-bottom))] md:bottom-4
                  glass-strong rounded-2xl p-1.5 flex-col items-center gap-1 w-max max-w-[96vw]" role="group" aria-label="Your seat">
        <div class="text-[11px] text-white/65 pt-0.5 px-2 text-center">
          ${isTouch ? 'Tap <b class="text-white">Stand up</b>, or push the stick to walk' : '<kbd class="font-mono text-cyan">[Space]</kbd> to stand · <kbd class="font-mono text-cyan">[W]</kbd> to walk'}
        </div>
        <div class="flex items-center justify-center flex-wrap md:flex-nowrap gap-1">
        <span class="hidden md:block text-[10px] tracking-[.2em] text-white/45 font-semibold px-2">FACE</span>
        ${FACINGS.map((f) => `<button type="button" class="chip rounded-xl px-2 sm:px-2.5 py-1.5 flex items-center gap-1.5" data-face="${f.id}" aria-pressed="false" title="${f.hint} (${f.key})">
          ${icon(f.icon, 'size-4')}<span class="text-[12px] font-semibold">${f.label}</span>${kbd(f.key)}</button>`).join('')}
        <button type="button" class="seat-stand act rounded-xl px-3 py-1.5 md:ml-0.5 w-full md:w-auto flex items-center justify-center gap-1.5 border border-white/15 bg-white/5 text-[12px] font-semibold whitespace-nowrap" title="Stand up (Space or W)">
          ${icon('arrow-up-from-line', 'size-4')}Stand up${kbd('Space')}</button>
        </div>
      </div>`);
    parent.append(this.sit, this.panel);
    renderIcons(this.sit);
    renderIcons(this.panel);
    this.sit.addEventListener('click', () => onSit());
    $(this.panel, '.seat-stand').addEventListener('click', () => onStand());
    $$(this.panel, '[data-face]').forEach((b) => b.addEventListener('click', () => onFace(b.dataset.face)));
    this.hint = false;
    this.facing = null;
    this.drone = false;
  }

  /** Riding the drone: no "Sit here" prompt over the aerial. */
  setDrone(on) {
    this.drone = on;
    this.render();
  }

  /** A seat is in reach (show "Sit here"). */
  setHint(on) {
    this.hint = on;
    this.render();
  }

  /** Seated, facing 'stage' / 'left' / 'right' / 'sky' — or null once you're up. */
  setSeated(facing) {
    this.facing = facing;
    this.render();
  }

  render() {
    const seated = !!this.facing;
    show(this.sit, this.hint && !seated && !this.drone);
    show(this.panel, seated);
    $$(this.panel, '[data-face]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.face === this.facing)));
  }
}

function show(node, on) {
  node.classList.toggle('hidden', !on);
  node.classList.toggle('flex', on);
}
