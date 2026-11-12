// The broadcast picture-in-picture's frame, top left under the LIVE pill (the DJ's now-playing
// card): a neon border, "● LIVE · CAM 4 · DRONE" (the camera the ravers' output is on: the side
// towers' picture) with the shot, and telemetry (height, speed, position, time). The picture itself is drawn into the main canvas underneath, lined up with
// this frame's inside (world/dronepip.js).
//
// I (or the HUD's picture-in-picture button, or the frame's ×) shows / hides it; the choice is
// kept. Tap or click the picture to ride the drone (B), which hides the panel until you land.
// It sizes itself to the room between the LIVE pill and the chat at its biggest, and steps
// aside when there isn't enough (a phone held sideways).

import { settings, saveSettings } from '../core/device.js';
import { MODE_LABEL } from '../world/dronecam.js';
import { camLabel } from '../world/broadcast.js';
import { GPS_LABEL } from '../world/venue.js';
import { icon, renderIcons } from './icons.js';

const BORDER = 1; // px: the picture fills the frame inside its border
const MIN_WIDTH = 136; // px: below this it isn't shown

export class DronePipPanel {
  constructor(root, { world, onChange, onNoRoom }) {
    this.world = world;
    this.onChange = onChange; // (on) — for the HUD button
    this.onNoRoom = onNoRoom; // () — turned on where it doesn't fit (a phone held sideways)
    this.on = settings.dronePip !== false;
    this.fits = true;
    const node = (this.node = document.createElement('div'));
    node.className = 'drone-pip pointer-events-auto fixed z-30 hidden cursor-pointer select-none';
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', 'Live broadcast feed: open the drone view');
    node.title = 'Live broadcast feed · click to ride the drone (B) · I to hide';
    node.innerHTML = `
      <div class="pip-screen relative w-full aspect-video rounded-[10px] border border-cyan/70 overflow-hidden"
           style="box-shadow: 0 0 0 1px rgba(255,43,214,.28), 0 0 22px rgba(0,240,255,.28), inset 0 0 14px rgba(0,240,255,.22)">
        <div class="absolute inset-x-0 top-0 h-7 px-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-[.16em] bg-gradient-to-b from-black/75 to-transparent">
          <span class="size-1.5 rounded-full bg-[#ff2d55] pulse-dot shrink-0"></span>
          <span class="text-[#ff4d6d]">LIVE</span><span class="cam text-white/90 whitespace-nowrap">CAM 4 · DRONE</span>
          <span class="mode ml-auto text-cyan/90 tracking-[.12em] whitespace-nowrap truncate">—</span>
          <button class="pip-close act -mr-1 size-6 shrink-0 grid place-items-center rounded-md text-white/70 hover:text-white" aria-label="Hide the broadcast feed (I)" title="Hide (I)">${icon('x', 'size-3.5')}</button>
        </div>
        <div class="absolute inset-x-0 bottom-0 h-6 px-2 flex items-center gap-2 font-mono text-[9px] text-white/80 bg-gradient-to-t from-black/75 to-transparent whitespace-nowrap overflow-hidden">
          <span class="alt">ALT —</span><span class="spd text-white/55"></span>
          <span class="gps text-white/45 hidden">${GPS_LABEL}</span>
          <span class="tc ml-auto text-magenta/90"></span>
        </div>
        ${['top-1 left-1 border-t border-l', 'top-1 right-1 border-t border-r', 'bottom-1 left-1 border-b border-l', 'bottom-1 right-1 border-b border-r']
          .map((c) => `<span class="absolute ${c} size-2.5 border-white/50 pointer-events-none"></span>`)
          .join('')}
      </div>`;
    root.append(node);
    renderIcons(node);
    this.screen = node.querySelector('.pip-screen');
    this.els = { cam: node.querySelector('.cam'), mode: node.querySelector('.mode'), alt: node.querySelector('.alt'), spd: node.querySelector('.spd'), gps: node.querySelector('.gps'), tc: node.querySelector('.tc') };

    node.querySelector('.pip-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle(false);
    });
    node.addEventListener('click', () => world.setDroneView(true)); // ride along
    world.on('drone', () => this.apply());
    // Line the picture up again whenever the frame moves or changes size.
    addEventListener('resize', () => this.layout());
    new ResizeObserver(() => this.measure()).observe(this.screen);
    this.timer = setInterval(() => this.telemetry(), 250);
    requestAnimationFrame(() => this.layout()); // once the rest of the HUD has laid out
  }

  toggle(on = !this.on) {
    this.on = on;
    settings.dronePip = on;
    saveSettings();
    this.apply();
    if (on && !this.fits) this.onNoRoom?.();
  }

  /** Shown when it's on, fits, and you're not riding the drone already. */
  apply() {
    const show = this.on && this.fits && !this.world.droneView;
    this.node.classList.toggle('hidden', !show);
    this.world.dronePip.active = show;
    if (show) this.measure();
    this.onChange?.(this.on);
  }

  /** Size and place it: under the LIVE pill (the DJ's now-playing card), above the chat at its tallest. */
  layout() {
    const vw = innerWidth;
    const wide = vw >= 768;
    const above = document.querySelector('.hud .np');
    const top = (above ? above.getBoundingClientRect().bottom : 96) + 10;
    let floor = innerHeight - 16;
    const chat = document.querySelector('.chat');
    const log = chat?.querySelector('.log');
    if (chat && log) {
      // The chat's top once its log has grown to its full height.
      const cr = chat.getBoundingClientRect();
      const lr = log.getBoundingClientRect();
      const max = parseFloat(getComputedStyle(log).maxHeight) || lr.height;
      floor = cr.bottom - (cr.height - lr.height) - max - 10;
    }
    const width = Math.floor(Math.min(wide ? Math.min(340, vw * 0.26) : vw * 0.44, ((floor - top) * 16) / 9));
    this.fits = width >= MIN_WIDTH;
    this.node.style.left = `${wide ? 16 : 12}px`;
    this.node.style.top = `${Math.round(top)}px`;
    this.node.style.width = `${Math.max(MIN_WIDTH, width)}px`;
    this.els.gps.classList.toggle('hidden', width < 300);
    this.els.mode.classList.toggle('hidden', width < 230); // a phone: LIVE · CAM 4 · DRONE is enough
    this.apply();
  }

  /** The picture's rectangle (inside the border) for the renderer. */
  measure() {
    if (!this.world.dronePip.active) return;
    const r = this.screen.getBoundingClientRect();
    this.world.dronePip.rect = { left: r.left + BORDER, top: r.top + BORDER, width: r.width - 2 * BORDER, height: r.height - 2 * BORDER };
  }

  /** The camera, its shot, height, the drone's speed and the time, four times a second (only while shown). */
  telemetry() {
    if (!this.world.dronePip.active) return;
    const dc = this.world.droneCam;
    const rig = this.world.broadcast;
    const id = rig.raver.cam;
    const drone = id === 'drone';
    const s = Math.floor(rig.t);
    const pad = (n) => String(n).padStart(2, '0');
    this.els.cam.textContent = camLabel(id);
    this.els.mode.textContent = dc.vip ? `VIP · ${dc.vip.name.toUpperCase()}` : drone ? MODE_LABEL[dc.state.mode] || '' : rig.where(id);
    this.els.alt.textContent = `ALT ${Math.round(drone ? dc.pos.y : rig.cameraOf(id).position.y)}M`;
    this.els.spd.textContent = dc.vip || !drone ? '' : `${dc.state.speed.toFixed(1)}×`;
    this.els.tc.textContent = `${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  }
}
