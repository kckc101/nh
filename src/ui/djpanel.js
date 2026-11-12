// DJ host control panel: transport + queue, add tracks (built-in, upload, MP3 / Icecast /
// YouTube / SoundCloud link), strobe lighting (mode, rate, flash length, hold-to-flash),
// drone cam (live feed on/off, flight mode, speed), the broadcast vision mixer (which of the five
// cameras the DJ screen and the raver screens show, or the auto director, and its cut length),
// stage FX pad, announcements, live mic and tempo.

import { el, esc, toast, $, $$ } from './dom.js';
import { icon, renderIcons } from './icons.js';
import { SYNTH_PRESETS } from '../../shared/dj.js';
import { parseMediaUrl } from '../audio/embeds.js';
import { LIGHT_DEFAULTS, LIGHT_RATES, FLASH_MS } from '../../shared/lighting.js';
import { DRONECAM_DEFAULTS, DRONE_SPEEDS, BROADCAST_CAMS, CUT_BEATS } from '../../shared/dronecam.js';
import { SHOW_PHASES, SHOW_DEFAULTS } from '../../shared/show.js';

/** The broadcast rig's cameras (world/broadcast.js), in the panel. */
const CAM_UI = {
  stage: { n: 1, label: 'Stage', hint: 'Front of house: the booth, rig and LED wall' },
  crowd: { n: 2, label: 'Crowd', hint: 'High in the north stand: the whole crowd' },
  booth: { n: 3, label: 'Booth', hint: 'Over your shoulder, out to the crowd' },
  drone: { n: 4, label: 'Drone', hint: 'The roaming drone (flight mode above)' },
  pit: { n: 5, label: 'Pit', hint: 'Eye level in the front rows, handheld' },
};
const OUTPUT_UI = [
  { id: 'dj', label: 'DJ screen', hint: 'LED wall + your booth monitor' },
  { id: 'raver', label: 'Raver screens', hint: 'Side towers + everyone’s picture-in-picture' },
];

const DRONE_MODE_UI = [
  { id: 'stadium', label: 'Stadium', hint: 'High aerial of the whole venue' },
  { id: 'orbit', label: 'Orbit', hint: 'Circles inside the bowl' },
  { id: 'flythrough', label: 'Flythrough', hint: 'Through the rings, low swoops' },
  { id: 'crane_shot', label: 'Crane', hint: 'Rises up to a wide of the stage' },
];

const LIGHT_MODE_UI = [
  { id: 'normal', label: 'Normal', hint: 'Festival lighting' },
  { id: 'auto', label: 'Auto strobe', hint: 'Blackout + flash on the beat' },
  { id: 'manual', label: 'Blackout', hint: 'Dark until you hold flash' },
];
const LIGHT_RATE_UI = [
  { id: 'bar', label: 'Bar', hint: 'downbeat' },
  { id: 'beat', label: '1/4', hint: 'every beat' },
  { id: 'eighth', label: '1/8', hint: 'every half beat' },
];

/** The lighting director's cues (lightingdirector.js), for everyone. */
const CUES = [
  { id: 'drop', label: 'DROP', hint: 'Lights out · white blinders · CO2 · full lasers', color: '#00ff44', title: 'Call the drop (holds 16 bars)' },
  { id: 'breakdown', label: 'BREAKDOWN', hint: 'Lasers down · deep purple & blue · slow haze', color: '#8b5cff', title: 'Call the breakdown (holds 8 bars)' },
];

const FX = [
  { id: 'fire', label: 'Fire Cannons', emoji: '🔥', color: '#ff6a1f' },
  { id: 'co2', label: 'CO2 Jets', emoji: '💨', color: '#cfe8ff' },
  { id: 'smoke', label: 'Smoke Burst', emoji: '🌫️', color: '#b9a3ff' },
  { id: 'blackout', label: 'Blackout Strobe', emoji: '⚡', color: '#ffffff' },
  { id: 'lasers', label: 'Laser Storm', emoji: '🟢', color: '#9dff00' },
  { id: 'confetti', label: 'Confetti Drop', emoji: '🎊', color: '#ff2bd6' },
  { id: 'fireworks', label: 'Fireworks', emoji: '🎆', color: '#ffc400' },
  { id: 'hype', label: 'Crowd Hype', emoji: '🙌', color: '#00f0ff' },
];

const ANNOUNCE_PRESETS = [
  'DJ DROP: MAKE SOME NOISE PHNOM PENH!',
  'HANDS UP CAMBODIA! 🇰🇭',
  'ARE YOU READY?! 3… 2… 1…',
  'សួស្តី E-RAVE! 🙌',
  'HYDRATE & LOOK AFTER EACH OTHER 💧',
];

const TYPE_BADGE = { synth: 'BUILT-IN', url: 'MP3', stream: 'RADIO', youtube: 'YOUTUBE', soundcloud: 'SOUNDCLOUD' };

const fmt = (s) => {
  if (!Number.isFinite(s)) return '--:--';
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class DJPanel {
  constructor(root, { net, audio, mic }) {
    this.net = net;
    this.audio = audio;
    this.mic = mic;
    this.state = null;
    this.taps = [];
    this.light = { ...LIGHT_DEFAULTS };
    this.drone = { ...DRONECAM_DEFAULTS };
    this.onAir = {}; // output id → the camera it's showing now

    const sec = (title, body) => `<section class="space-y-2.5"><h3 class="text-[11px] font-semibold tracking-[.25em] text-white/45">${title}</h3>${body}</section>`;
    this.node = el(`
      <aside class="djp pointer-events-auto fixed z-40 inset-0 md:inset-auto md:top-0 md:right-0 md:h-full md:w-[420px] glass-strong md:border-l border-white/10
                    flex flex-col translate-x-full transition-transform duration-300 ease-out" aria-label="DJ control panel" style="--accent:#ff2bd6;backdrop-filter:none;-webkit-backdrop-filter:none;background:rgba(6,3,13,.97)">
        <header class="flex items-center justify-between px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-3 border-b border-white/10">
          <div>
            <div class="text-[10px] tracking-[.3em] text-magenta font-semibold">HOST MODE</div>
            <h2 class="font-display text-3xl leading-none">DJ <span class="text-cyan neon-soft">CONTROL</span></h2>
          </div>
          <button class="close act rounded-xl size-10 grid place-items-center glass" aria-label="Close DJ panel">${icon('x', 'size-5')}</button>
        </header>
        <div class="flex-1 overflow-y-auto scroll-thin px-5 py-4 space-y-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          ${sec('NOW PLAYING', `
            <div class="glass rounded-2xl p-3">
              <div class="np-title font-semibold truncate">—</div>
              <div class="np-sub text-xs text-white/55 truncate">—</div>
              <div class="flex items-center justify-between mt-3">
                <span class="np-time font-mono text-xs text-white/60">0:00</span>
                <div class="flex items-center gap-2">
                  <button class="prev act glass rounded-xl size-10 grid place-items-center" aria-label="Previous">${icon('skip-back', 'size-4')}</button>
                  <button class="toggle act rounded-xl size-12 grid place-items-center text-black" style="background:linear-gradient(135deg,#00f0ff,#ff2bd6)" aria-label="Play / pause">${icon('pause', 'size-5')}</button>
                  <button class="next act glass rounded-xl size-10 grid place-items-center" aria-label="Next">${icon('skip-forward', 'size-4')}</button>
                </div>
                <span class="np-len font-mono text-xs text-white/60">--:--</span>
              </div>
            </div>`)}
          ${sec('LIGHTING', `
            <button class="larena w-full rounded-xl px-3 py-2.5 flex items-center justify-between gap-3 border border-white/15 bg-white/5" aria-pressed="false" title="Arena blackout (K)">
              <span class="text-left"><span class="block text-sm font-semibold">Arena blackout <span class="text-[10px] font-normal text-white/40">K</span></span>
                <span class="block text-[11px] text-white/50">House lights, sky and crowd glow off · the stage show stays on</span></span>
              <span class="larena-pill rounded-full px-2.5 py-1 text-[11px] font-bold">OFF</span></button>
            <div class="grid grid-cols-3 gap-1.5" role="group" aria-label="Lighting mode">
              ${LIGHT_MODE_UI.map((m) => `<button class="lmode chip rounded-xl px-2 py-2 text-left" data-lmode="${m.id}" aria-pressed="false">
                <span class="block text-[13px] font-semibold">${m.label}</span><span class="block text-[10px] text-white/50 leading-tight">${m.hint}</span></button>`).join('')}
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-white/50 w-14">Flash</span>
              <div class="flex gap-1.5 flex-1" role="group" aria-label="Flash rate">
                ${LIGHT_RATE_UI.map((r) => `<button class="lrate chip rounded-lg px-2 py-1 flex-1 text-xs font-semibold" data-lrate="${r.id}" title="${r.hint}" aria-pressed="false">${r.label}</button>`).join('')}
              </div>
            </div>
            <label class="flex items-center gap-2 text-[11px] text-white/50"><span class="w-14">Length</span>
              <input type="range" class="lms flex-1 accent-[#ff2bd6]" min="${FLASH_MS.min}" max="${FLASH_MS.max}" step="5" value="${FLASH_MS.default}" aria-label="Flash length"/>
              <span class="lms-v font-mono text-white/80 w-12 text-right">${FLASH_MS.default} ms</span></label>
            <button class="lhold w-full rounded-2xl py-4 font-display text-2xl tracking-wider select-none touch-none border border-white/20 bg-white/5 transition-[background,box-shadow] duration-75"
                    aria-label="Hold to flash">HOLD TO FLASH <span class="block font-sans text-[10px] tracking-[.2em] text-white/50">OR HOLD H · L CYCLES MODES</span></button>
            <p class="lbpm text-[11px] text-white/50 font-mono"></p>`)}
          ${sec('LASER SHOW // MAIN DROP', `
            <button class="show-auto w-full rounded-xl px-3 py-2.5 flex items-center justify-between gap-3 border border-[#00ff33]/40 bg-[#00ff33]/5" aria-pressed="false">
              <span class="text-left min-w-0"><span class="block text-sm font-bold tracking-wide">AUTO DROP SEQUENCE</span>
                <span class="show-status block text-[11px] text-white/55 truncate">Tease → Blinder → Laser drop → Pyro gate → Outro, on the beat</span></span>
              <span class="show-pill shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold">OFF</span></button>
            <div class="h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true"><div class="show-bar h-full w-0 bg-[#00ff33] transition-[width] duration-100"></div></div>
            <div class="grid grid-cols-5 gap-1.5" role="group" aria-label="Laser show phases">
              ${SHOW_PHASES.map((p, i) => `<button class="show-pad chip rounded-lg px-1 py-2 text-center" data-phase="${i}" aria-pressed="false" title="Start ${p.label} on the next beat (${p.beats} beats, looping)">
                <span class="block text-[13px] font-bold leading-none">${i + 1}</span><span class="block text-[9px] text-white/60 leading-tight mt-1">${p.label}</span></button>`).join('')}
            </div>
            <button class="show-reset w-full rounded-xl py-2 text-sm font-bold tracking-wide border border-[#ff2d55]/50 text-[#ff6b8a] hover:bg-[#ff2d55]/10">BLACKOUT / RESET</button>
            <p class="text-[10px] text-white/40">Everything starts on the next beat. A pad loops its phase until you change it; during AUTO it jumps the sequence there.</p>`)}
          ${sec('DRONE CAM', `
            <button class="dfeed w-full rounded-xl px-3 py-2.5 flex items-center justify-between gap-3 border border-white/15 bg-white/5" aria-pressed="true">
              <span class="text-left"><span class="block text-sm font-semibold">Live feed on the screens</span>
                <span class="block text-[11px] text-white/50">LED wall, booth monitor and side towers · BROADCAST picks the cameras</span></span>
              <span class="dfeed-pill rounded-full px-2.5 py-1 text-[11px] font-bold">ON</span></button>
            <div class="grid grid-cols-2 gap-1.5" role="group" aria-label="Drone flight mode">
              ${DRONE_MODE_UI.map((m) => `<button class="dmode chip rounded-xl px-2 py-2 text-left" data-dmode="${m.id}" aria-pressed="false">
                <span class="block text-[13px] font-semibold">${m.label}</span><span class="block text-[10px] text-white/50 leading-tight">${m.hint}</span></button>`).join('')}
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-white/50 w-14">Speed</span>
              <div class="flex gap-1.5 flex-1" role="group" aria-label="Drone speed">
                ${DRONE_SPEEDS.map((v) => `<button class="dspeed chip rounded-lg px-2 py-1 flex-1 text-xs font-semibold" data-dspeed="${v}" aria-pressed="false">${v}×</button>`).join('')}
              </div>
            </div>`)}
          ${sec('BROADCAST', `
            ${OUTPUT_UI.map((o) => `
            <div class="space-y-1.5">
              <div class="flex items-baseline justify-between gap-2">
                <span class="text-[13px] font-semibold">${o.label} <span class="text-[10px] font-normal text-white/45">${o.hint}</span></span>
                <span class="onair-${o.id} shrink-0 font-mono text-[10px] text-[#ff4d6d] whitespace-nowrap" aria-live="polite">● —</span>
              </div>
              <div class="grid grid-cols-6 gap-1" role="group" aria-label="${o.label} camera">
                <button class="bauto chip rounded-lg px-1 py-1.5 text-[11px] font-bold" data-bout="${o.id}" aria-pressed="false" title="Auto director: cuts on the beat">AUTO</button>
                ${BROADCAST_CAMS.map((c) => `<button class="bcam chip rounded-lg px-1 py-1.5 text-center" data-bout="${o.id}" data-bcam="${c}" aria-pressed="false" title="CAM ${CAM_UI[c].n} · ${CAM_UI[c].hint}">
                  <span class="block text-[12px] font-bold leading-none">${CAM_UI[c].n}</span><span class="block text-[9px] text-white/55 leading-tight mt-0.5">${CAM_UI[c].label}</span></button>`).join('')}
              </div>
            </div>`).join('')}
            <div class="flex items-center gap-2">
              <span class="text-[11px] text-white/50 w-14">Auto cut</span>
              <div class="flex gap-1.5 flex-1" role="group" aria-label="Auto director cut length">
                ${CUT_BEATS.map((b) => `<button class="bcut chip rounded-lg px-2 py-1 flex-1 text-xs font-semibold" data-bcut="${b}" aria-pressed="false">${b} beats</button>`).join('')}
              </div>
            </div>
            <p class="text-[10px] text-white/40">N next camera on the DJ screen · Shift+N on the raver screens · M both back to AUTO</p>`)}
          ${sec('STAGE FX', `<div class="grid grid-cols-2 gap-2 mb-2">${CUES.map((c) => `
            <button class="fx-pad rounded-xl px-3 py-2.5 text-left bg-white/5" style="--glow:${c.color}40" data-fx="${c.id}" title="${c.title}">
              <span class="block font-display text-xl tracking-wider leading-none" style="color:${c.color}">${c.label}</span><span class="block text-[10px] text-white/50 leading-tight mt-1">${c.hint}</span></button>`).join('')}</div>
            <div class="grid grid-cols-4 gap-2">${FX.map((f) => `
            <button class="fx-pad rounded-xl aspect-square flex flex-col items-center justify-center gap-1 text-center bg-white/5" style="--glow:${f.color}40" data-fx="${f.id}">
              <span class="text-2xl leading-none">${f.emoji}</span><span class="text-[10px] font-semibold leading-tight px-1">${f.label}</span></button>`).join('')}</div>`)}
          ${sec('ANNOUNCEMENT', `
            <form class="ann flex gap-2"><input class="field flex-1 min-w-0 text-sm text-white" maxlength="80" placeholder="Shout to the crowd…" aria-label="Announcement"/>
              <button class="act rounded-xl px-3 glass flex items-center gap-1.5 text-sm font-semibold">${icon('megaphone', 'size-4')}Send</button></form>
            <div class="flex flex-wrap gap-1.5">${ANNOUNCE_PRESETS.map((p, i) => `<button class="chip rounded-full px-2.5 py-1 text-[11px]" data-ann="${i}">${esc(p)}</button>`).join('')}</div>`)}
          ${sec('LIVE MIC', `
            <div class="mic-perm flex items-center gap-2 text-xs text-white/70" role="status">
              <span class="dot size-2 rounded-full bg-white/30"></span><span class="label">Checking microphone access…</span>
            </div>
            <div class="flex gap-2">
              <button class="mic-test act glass rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm font-semibold">${icon('headphones', 'size-4')}<span>Test mic</span></button>
              <button class="mic-btn act glass rounded-xl px-3 py-2.5 flex-1 flex items-center justify-center gap-2 text-sm font-semibold">${icon('mic', 'size-4')}<span>Go live on mic</span></button>
            </div>
            <select class="mic-device hidden field w-full text-sm text-white bg-ink" aria-label="Microphone input"></select>
            <div class="flex items-center gap-2">
              <div class="relative flex-1 h-2.5 rounded-full bg-white/10 overflow-hidden" role="meter" aria-label="Microphone level" aria-valuemin="-60" aria-valuemax="0">
                <div class="mic-meter absolute inset-y-0 left-0 w-0 rounded-full"></div>
                <div class="mic-peak absolute inset-y-0 w-0.5 bg-white/80 hidden"></div>
              </div>
              <span class="mic-db w-16 text-right font-mono text-[11px] text-white/55">off</span>
            </div>
            <p class="mic-msg hidden text-xs leading-snug text-[#ff7a9a]" role="alert"></p>
            <p class="text-[11px] text-white/45">"Test mic" checks your input locally. "Go live" streams your voice to every raver (WebRTC) and ducks the music.</p>`)}
          ${sec('QUEUE', '<ol class="queue space-y-1.5"></ol>')}
          ${sec('ADD TRACK', `
            <div class="flex gap-1.5 text-xs font-semibold">
              <button class="chip tab rounded-lg px-3 py-1.5" data-tab="builtin" aria-pressed="true">Built-in</button>
              <button class="chip tab rounded-lg px-3 py-1.5" data-tab="upload">Upload</button>
              <button class="chip tab rounded-lg px-3 py-1.5" data-tab="link">Link / Stream</button>
            </div>
            <div class="pane" data-pane="builtin">
              <div class="flex gap-2"><select class="preset field flex-1 text-sm text-white bg-ink">${SYNTH_PRESETS.map((p) => `<option value="${p.id}">${esc(p.title)} · ${p.bpm} BPM</option>`).join('')}</select>
              <button class="add-preset act glass rounded-xl px-3" aria-label="Add">${icon('plus', 'size-4')}</button></div>
              <p class="text-[11px] text-white/45 mt-1.5">Procedural Khmer-pentatonic rave tracks rendered live in every browser.</p>
            </div>
            <div class="pane hidden" data-pane="upload">
              <label class="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/25 py-5 text-sm text-white/70 cursor-pointer hover:border-cyan">
                ${icon('upload', 'size-4')}<span class="up-label">Choose MP3 / WAV / OGG / M4A</span><input type="file" accept="audio/*" class="file hidden"/></label>
            </div>
            <div class="pane hidden space-y-2" data-pane="link">
              <input class="url field w-full text-sm text-white" placeholder="https://… .mp3 · Icecast stream · YouTube · SoundCloud" aria-label="Track URL"/>
              <div class="flex gap-2">
                <input class="ltitle field flex-1 min-w-0 text-sm text-white" maxlength="80" placeholder="Title (optional)" aria-label="Title"/>
                <input class="lbpm field w-20 text-sm text-white" type="number" min="60" max="200" placeholder="BPM" aria-label="BPM"/>
              </div>
              <div class="flex gap-2 items-center">
                <select class="ltype field flex-1 text-sm text-white bg-ink" aria-label="Source type">
                  <option value="auto">Auto-detect</option><option value="url">MP3 / audio file</option><option value="stream">Live radio (Icecast)</option>
                  <option value="youtube">YouTube</option><option value="soundcloud">SoundCloud</option></select>
                <button class="add-link act glass rounded-xl px-4 py-2 text-sm font-semibold">Add</button>
              </div>
            </div>`)}
          ${sec('TEMPO', `
            <div class="flex items-center gap-2">
              <input class="bpm field w-24 text-sm text-white" type="number" min="60" max="200" aria-label="Manual BPM"/>
              <button class="tap act glass rounded-xl px-4 py-2 text-sm font-semibold">Tap tempo</button>
              <span class="detected text-xs text-white/50 font-mono"></span>
            </div>
            <p class="text-[11px] text-white/45">Used to drive the lights for YouTube / SoundCloud and streams without CORS. Other sources are beat-detected live.</p>`)}
        </div>
      </aside>`);
    root.append(this.node);
    renderIcons(this.node);
    this.bind();
    // The readouts the tick updates, looked up once (not six querySelectors a frame).
    this.live = { time: $(this.node, '.np-time'), detected: $(this.node, '.detected'), lbpm: $(this.node, '.lbpm') };
    this.shown = {};
    this.nextTick = 0;
    requestAnimationFrame((t) => this.tick(t));
  }

  get open() {
    return !this.node.classList.contains('translate-x-full');
  }

  toggle(open = !this.open) {
    this.node.classList.toggle('translate-x-full', !open);
  }

  bind() {
    const n = this.node;
    $(n, '.close').addEventListener('click', () => this.toggle(false));
    $(n, '.toggle').addEventListener('click', () => this.net.dj('toggle'));
    $(n, '.next').addEventListener('click', () => this.net.dj('next'));
    $(n, '.prev').addEventListener('click', () => this.net.dj('prev'));
    $$(n, '[data-fx]').forEach((b) => b.addEventListener('click', () => this.net.fx(b.dataset.fx)));

    // Drone cam: everyone's drone and screens follow these.
    $(n, '.dfeed').addEventListener('click', () => this.net.dronecam({ feed: !this.drone.feed }));
    $$(n, '[data-dmode]').forEach((b) => b.addEventListener('click', () => this.net.dronecam({ mode: b.dataset.dmode })));
    $$(n, '[data-dspeed]').forEach((b) => b.addEventListener('click', () => this.net.dronecam({ speed: Number(b.dataset.dspeed) })));
    // Broadcast: a camera button takes that output off AUTO; AUTO hands it back to the director.
    $$(n, '.bcam').forEach((b) => b.addEventListener('click', () => this.setScreen(b.dataset.bout, b.dataset.bcam)));
    $$(n, '.bauto').forEach((b) => b.addEventListener('click', () => this.net.dronecam({ [`${b.dataset.bout}Auto`]: !this.drone[`${b.dataset.bout}Auto`] })));
    $$(n, '[data-bcut]').forEach((b) => b.addEventListener('click', () => this.net.dronecam({ cutBeats: Number(b.dataset.bcut) })));

    // Lighting: mode / rate / length go to the server (everyone's room follows), hold-to-flash too.
    $$(n, '[data-lmode]').forEach((b) => b.addEventListener('click', () => this.net.light({ mode: b.dataset.lmode })));
    $(n, '.larena').addEventListener('click', () => this.toggleArena());
    // The laser show: everyone's stage follows, on the next beat.
    $(n, '.show-auto').addEventListener('click', () => this.net.show({ action: this.showAuto ? 'stop' : 'auto' }));
    $$(n, '.show-pad').forEach((b) => b.addEventListener('click', () => this.net.show({ action: 'phase', phase: Number(b.dataset.phase) })));
    $(n, '.show-reset').addEventListener('click', () => this.net.show({ action: 'blackout' }));
    $$(n, '[data-lrate]').forEach((b) => b.addEventListener('click', () => this.net.light({ rate: b.dataset.lrate })));
    const lms = $(n, '.lms');
    lms.addEventListener('input', () => ($(n, '.lms-v').textContent = `${lms.value} ms`));
    lms.addEventListener('change', () => this.net.light({ flashMs: Number(lms.value) }));
    const hold = $(n, '.lhold');
    const press = (e) => {
      e.preventDefault();
      hold.setPointerCapture?.(e.pointerId);
      this.holdFlash(true);
    };
    const release = () => this.holdFlash(false);
    hold.addEventListener('pointerdown', press);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) hold.addEventListener(ev, release);
    hold.addEventListener('contextmenu', (e) => e.preventDefault());

    const ann = $(n, '.ann');
    ann.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $(ann, 'input');
      if (!input.value.trim()) return;
      this.net.announce(input.value.trim());
      input.value = '';
    });
    $$(n, '[data-ann]').forEach((b) => b.addEventListener('click', () => this.net.announce(ANNOUNCE_PRESETS[Number(b.dataset.ann)])));

    $$(n, '.tab').forEach((t) =>
      t.addEventListener('click', () => {
        $$(n, '.tab').forEach((x) => x.setAttribute('aria-pressed', String(x === t)));
        $$(n, '.pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== t.dataset.tab));
      }),
    );
    $(n, '.add-preset').addEventListener('click', () => {
      this.net.dj('add', { type: 'synth', preset: $(n, '.preset').value });
      toast('Added to the queue');
    });

    const file = $(n, '.file');
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      if (!f) return;
      const label = $(n, '.up-label');
      label.textContent = `Uploading ${f.name}…`;
      try {
        const src = await this.net.upload(f);
        this.net.dj('add', { type: 'url', src, title: f.name.replace(/\.[^.]+$/, ''), artist: this.net.profile?.name || 'Guest DJ' });
        toast(`Uploaded “${f.name}”`);
      } catch (err) {
        toast(err.message || 'Upload failed', 'error');
      }
      label.textContent = 'Choose MP3 / WAV / OGG / M4A';
      file.value = '';
    });

    $(n, '.add-link').addEventListener('click', () => {
      const url = $(n, '.url').value.trim();
      if (!/^https?:\/\//i.test(url)) return toast('Paste a full http(s) link', 'error');
      let type = $(n, '.ltype').value;
      if (type === 'auto') {
        const embed = parseMediaUrl(url);
        type = embed ? embed.type : /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm)(\?|$)/i.test(url) ? 'url' : 'stream';
      }
      let fromUrl = url.split('/').pop().split('?')[0] || '';
      try {
        fromUrl = decodeURIComponent(fromUrl);
      } catch {
        /* keep raw */
      }
      const title = $(n, '.ltitle').value.trim() || fromUrl || 'Live link';
      const bpm = Number($(n, '.lbpm').value) || undefined;
      this.net.dj('add', { type, src: url, title, artist: type === 'stream' ? 'Live radio' : 'Guest selector', bpm });
      $(n, '.url').value = '';
      $(n, '.ltitle').value = '';
      toast(`Added ${type === 'stream' ? 'radio stream' : type} to the queue`);
    });

    const bpm = $(n, '.bpm');
    bpm.addEventListener('change', () => this.net.dj('bpm', Number(bpm.value)));
    $(n, '.tap').addEventListener('click', () => {
      const now = performance.now();
      this.taps = this.taps.filter((t) => now - t < 3000);
      this.taps.push(now);
      if (this.taps.length >= 4) {
        const iv = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
        const v = Math.round(60000 / iv);
        bpm.value = v;
        this.net.dj('bpm', v);
      }
    });

    $(n, '.queue').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const { act, uid, idx } = b.dataset;
      if (act === 'play') this.net.dj('play', Number(idx));
      if (act === 'up') this.net.dj('move', { uid, dir: -1 });
      if (act === 'down') this.net.dj('move', { uid, dir: 1 });
      if (act === 'remove') this.net.dj('remove', uid);
    });

    this.bindMic();
  }

  // ---------------------------------------------------------------- live mic

  bindMic() {
    const n = this.node;
    const micBtn = $(n, '.mic-btn');
    const testBtn = $(n, '.mic-test');
    const deviceSel = $(n, '.mic-device');
    const msg = $(n, '.mic-msg');
    const showError = (text) => {
      msg.textContent = text || '';
      msg.classList.toggle('hidden', !text);
    };
    const run = async (fn) => {
      showError('');
      try {
        await fn();
      } catch (err) {
        showError(err.message);
      }
    };
    micBtn.addEventListener('click', () => run(() => (this.mic.live ? this.mic.stop() : this.mic.start())));
    testBtn.addEventListener('click', () => run(() => (this.mic.stream ? this.mic.stop() : this.mic.test())));
    deviceSel.addEventListener('change', () => run(() => this.mic.setDevice(deviceSel.value)));
    this.mic.on('error', (text) => showError(text));
    this.mic.on('permission', () => this.renderMic());
    this.mic.on('change', () => {
      this.renderMic();
      this.setupMeter(this.mic.stream);
      this.fillDevices();
    });
    this.net.on('status', () => this.renderMic());
    this.mic.checkPermission().then(() => {
      this.renderMic();
      this.fillDevices();
    });
  }

  async fillDevices() {
    const sel = $(this.node, '.mic-device');
    if (this.mic.permission !== 'granted') return sel.classList.add('hidden');
    const devices = await this.mic.devices();
    if (devices.length < 2) return sel.classList.add('hidden');
    sel.innerHTML = devices.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || `Microphone ${i + 1}`)}</option>`).join('');
    const current = this.mic.stream?.getAudioTracks()[0]?.getSettings().deviceId;
    if (current) sel.value = current;
    sel.classList.remove('hidden');
  }

  renderMic() {
    const n = this.node;
    const { live, testing, permission } = this.mic.status;
    const PERM = {
      granted: ['bg-acid', 'Microphone allowed'],
      prompt: ['bg-gold', 'Your browser will ask for microphone access'],
      denied: ['bg-[#ff2d55]', 'Microphone blocked: allow it in this site\'s settings'],
      insecure: ['bg-[#ff2d55]', 'Microphone needs HTTPS or localhost'],
      unsupported: ['bg-[#ff2d55]', 'This browser can\'t capture audio'],
      unknown: ['bg-white/30', 'Microphone access will be requested when you start'],
    };
    const [dot, label] = PERM[permission] || PERM.unknown;
    $(n, '.mic-perm .dot').className = `dot size-2 rounded-full ${dot}`;
    $(n, '.mic-perm .label').textContent = label;
    const blocked = permission === 'insecure' || permission === 'unsupported';
    const micBtn = $(n, '.mic-btn');
    micBtn.innerHTML = `${icon(live ? 'mic-off' : 'mic', 'size-4')}<span>${live ? 'End live mic' : this.net.online ? 'Go live on mic' : 'Go live (needs server)'}</span>`;
    micBtn.style.boxShadow = live ? '0 0 20px #9dff00' : '';
    micBtn.disabled = blocked || (!live && !this.net.online);
    micBtn.classList.toggle('opacity-40', micBtn.disabled);
    const testBtn = $(n, '.mic-test');
    testBtn.innerHTML = `${icon('headphones', 'size-4')}<span>${testing ? 'Stop test' : 'Test mic'}</span>`;
    testBtn.disabled = blocked || live;
    testBtn.classList.toggle('opacity-40', testBtn.disabled);
    renderIcons(micBtn);
    renderIcons(testBtn);
  }

  /**
   * Level meter for the captured mic. Primary: an AnalyserNode on the stream. Fallback when
   * Web Audio can't run it (context suspended / unavailable): the encoder's audioLevel from
   * WebRTC stats while live, else an "on, level unknown" indicator.
   */
  setupMeter(stream) {
    try {
      this.meter?.src?.disconnect();
    } catch {
      /* gone */
    }
    this.meter = null;
    if (!stream) return;
    const ctx = this.audio.ctx;
    try {
      if (!ctx) throw new Error('no audio context');
      if (ctx.state !== 'running') ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      const sink = ctx.createGain();
      sink.gain.value = 0; // keeps the analyser pulling without making the mic audible locally
      src.connect(an).connect(sink).connect(ctx.destination);
      this.meter = { mode: 'analyser', ctx, src, an, data: new Float32Array(an.fftSize), peak: -60, level: -60 };
    } catch {
      this.meter = { mode: 'stats', peak: -60, level: -60, polling: false };
    }
  }

  meterTick() {
    const m = this.meter;
    const fill = $(this.node, '.mic-meter');
    const peakEl = $(this.node, '.mic-peak');
    const dbEl = $(this.node, '.mic-db');
    if (!m) {
      fill.style.width = '0';
      peakEl.classList.add('hidden');
      dbEl.textContent = 'off';
      return;
    }
    let db = null;
    if (m.mode === 'analyser' && m.ctx.state === 'running') {
      m.an.getFloatTimeDomainData(m.data);
      let sum = 0;
      for (const v of m.data) sum += v * v;
      db = 20 * Math.log10(Math.sqrt(sum / m.data.length) + 1e-6);
    } else {
      // Fallback: poll WebRTC stats (they only exist while broadcasting).
      if (!m.polling) {
        m.polling = true;
        this.mic.statsLevel().then((lvl) => {
          m.stats = lvl;
          setTimeout(() => (m.polling = false), 200);
        });
      }
      if (typeof m.stats === 'number') db = 20 * Math.log10(m.stats + 1e-6);
    }
    if (db === null) {
      // Level unknown: show that the mic is open with a gentle pulse.
      fill.style.width = `${30 + 20 * Math.sin(performance.now() / 300)}%`;
      fill.style.background = 'rgba(255,255,255,0.25)';
      peakEl.classList.add('hidden');
      dbEl.textContent = 'on';
      return;
    }
    db = Math.max(-60, Math.min(0, db));
    m.level = db > m.level ? db : m.level - 6; // fast attack, slow release
    m.peak = db > m.peak ? db : Math.max(-60, m.peak - 1.5);
    const pct = (v) => `${((v + 60) / 60) * 100}%`;
    fill.style.width = pct(m.level);
    fill.style.background = m.peak > -3 ? '#ff2d55' : m.peak > -12 ? 'linear-gradient(90deg,#9dff00,#ffc400)' : '#9dff00';
    peakEl.style.left = pct(m.peak);
    peakEl.classList.remove('hidden');
    dbEl.textContent = `${Math.round(m.level)} dB`;
  }

  render(state) {
    this.state = state;
    const n = this.node;
    const cur = state.queue[state.index];
    $(n, '.np-title').textContent = cur ? cur.title : 'Queue is empty';
    $(n, '.np-sub').textContent = cur ? `${cur.artist} · ${TYPE_BADGE[cur.type]}${cur.bpm ? ` · ${cur.bpm} BPM` : ''}` : 'Add a track below';
    $(n, '.np-len').textContent = cur?.duration ? fmt(cur.duration) : cur?.type === 'stream' ? 'LIVE' : '--:--';
    const tg = $(n, '.toggle');
    tg.innerHTML = icon(state.playing ? 'pause' : 'play', 'size-5');
    renderIcons(tg);
    const bpm = $(n, '.bpm');
    if (document.activeElement !== bpm) bpm.value = state.bpm;
    $(n, '.queue').innerHTML = state.queue
      .map(
        (t, i) => `
      <li class="flex items-center gap-2 rounded-xl px-2.5 py-2 ${i === state.index ? 'bg-magenta/15 ring-1 ring-magenta/60' : 'bg-white/[.04]'}">
        <button class="act rounded-lg size-8 shrink-0 grid place-items-center ${i === state.index ? 'text-magenta' : 'text-white/60'}" data-act="play" data-idx="${i}" aria-label="Play ${esc(t.title)}">${i === state.index ? icon('audio-lines', 'size-4') : icon('play', 'size-4')}</button>
        <div class="min-w-0 flex-1"><div class="text-sm font-semibold truncate">${esc(t.title)}</div>
          <div class="text-[10px] text-white/45 tracking-wider">${TYPE_BADGE[t.type]}${t.bpm ? ` · ${t.bpm} BPM` : ''}</div></div>
        <button class="act rounded-lg size-7 grid place-items-center text-white/50" data-act="up" data-uid="${t.uid}" aria-label="Move up">${icon('chevron-up', 'size-4')}</button>
        <button class="act rounded-lg size-7 grid place-items-center text-white/50" data-act="down" data-uid="${t.uid}" aria-label="Move down">${icon('chevron-down', 'size-4')}</button>
        <button class="act rounded-lg size-7 grid place-items-center text-white/40 hover:text-[#ff2d55]" data-act="remove" data-uid="${t.uid}" aria-label="Remove">${icon('trash-2', 'size-4')}</button>
      </li>`,
      )
      .join('');
    renderIcons($(n, '.queue'));
  }

  /** The laser show's state (from the server): which mode, which phase. */
  setShow(state) {
    this.show = { ...SHOW_DEFAULTS, ...state };
    this.showAuto = this.show.mode === 'auto';
    const pill = $(this.node, '.show-pill');
    pill.textContent = this.showAuto ? 'ON' : 'OFF';
    pill.style.cssText = this.showAuto ? 'background:#00ff33;color:#000' : 'background:rgba(255,255,255,.12);color:rgba(255,255,255,.6)';
    $(this.node, '.show-auto').setAttribute('aria-pressed', String(this.showAuto));
  }

  /** Where the show is right now (10 times a second): the phase, the beat, the progress bar. */
  setShowStatus(st, state) {
    const n = this.node;
    const key = st ? `${st.mode}:${st.phase}:${Math.floor(st.beat)}` : state?.mode === 'off' || !state ? 'idle' : 'waiting';
    if (key === this.showKey) return;
    this.showKey = key;
    // The sequence ran out (or the blackout ended): AUTO's switch goes back off.
    if (!st && this.showAuto && state?.mode !== 'auto') this.setShow(SHOW_DEFAULTS);
    let text = 'Tease → Blinder → Laser drop → Pyro gate → Outro, on the beat';
    let pct = 0;
    if (st?.mode === 'blackout') text = 'BLACKOUT';
    else if (st) {
      const p = SHOW_PHASES[st.phase];
      text = `${st.phase + 1} · ${p.label} · beat ${Math.floor(st.beat) + 1}/${p.beats}${st.mode === 'loop' ? ' · LOOP' : ''}`;
      if (st.mode === 'auto') {
        const total = SHOW_PHASES.reduce((a, q) => a + q.beats, 0);
        const before = SHOW_PHASES.slice(0, st.phase).reduce((a, q) => a + q.beats, 0);
        pct = ((before + st.beat) / total) * 100;
      } else pct = (st.beat / st.len) * 100;
    } else if (key === 'waiting') text = 'Starting on the next beat…';
    $(n, '.show-status').textContent = text;
    $(n, '.show-bar').style.width = `${Math.min(100, pct).toFixed(1)}%`;
    $$(n, '.show-pad').forEach((b) => b.classList.toggle('onair', !!st && Number(b.dataset.phase) === st.phase));
    $$(n, '.show-pad').forEach((b) => b.setAttribute('aria-pressed', String(!!st && st.mode === 'loop' && Number(b.dataset.phase) === st.phase)));
  }

  /** Arena Blackout on / off for everyone (the panel switch or the K key). */
  toggleArena() {
    this.net.light({ arena: !this.light.arena });
  }

  /** Press (true) / release (false) the flash button — from the panel or the H key. */
  holdFlash(on) {
    if (on === this.holding) return;
    this.holding = on;
    this.net.lightHold(on);
  }

  /** Cycle Normal → Auto strobe → Blackout (the L key). */
  cycleLight() {
    const ids = LIGHT_MODE_UI.map((m) => m.id);
    this.net.light({ mode: ids[(ids.indexOf(this.light.mode) + 1) % ids.length] });
  }

  /** Put a camera on an output ('dj' | 'raver') for everyone: off AUTO, onto that camera. */
  setScreen(out, cam) {
    this.net.dronecam({ [`${out}Cam`]: cam, [`${out}Auto`]: false });
  }

  /** N / Shift+N: the next camera on an output, from the one it shows now (AUTO's pick included). */
  nextCamera(out) {
    const now = this.onAir[out] || this.drone[`${out}Cam`];
    this.setScreen(out, BROADCAST_CAMS[(BROADCAST_CAMS.indexOf(now) + 1) % BROADCAST_CAMS.length]);
  }

  /** M: both outputs back to the auto director. */
  autoAll() {
    this.net.dronecam({ djAuto: true, raverAuto: true });
  }

  /** What each output is showing right now (the director's cuts, a VIP show): "● CAM 2 · CROWD". */
  setOnAir(out, cam) {
    this.onAir[out] = cam;
    const label = $(this.node, `.onair-${out}`);
    if (label) label.textContent = `● CAM ${CAM_UI[cam]?.n ?? '?'} · ${(CAM_UI[cam]?.label ?? cam).toUpperCase()}`;
    $$(this.node, `.bcam[data-bout="${out}"]`).forEach((b) => b.classList.toggle('onair', b.dataset.bcam === cam));
  }

  /** Reflect the drone cam state (as broadcast by the server). */
  setDroneCam(state) {
    this.drone = { ...this.drone, ...state };
    const n = this.node;
    const feed = $(n, '.dfeed');
    feed.setAttribute('aria-pressed', String(this.drone.feed));
    const pill = $(n, '.dfeed-pill');
    pill.textContent = this.drone.feed ? 'ON' : 'OFF';
    pill.style.cssText = this.drone.feed ? 'background:#ff2d55;color:#fff' : 'background:rgba(255,255,255,.12);color:rgba(255,255,255,.6)';
    $$(n, '[data-dmode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dmode === this.drone.mode)));
    $$(n, '[data-dspeed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.dspeed) === this.drone.speed)));
    for (const o of OUTPUT_UI) {
      const auto = !!this.drone[`${o.id}Auto`];
      const cam = this.drone[`${o.id}Cam`];
      $(n, `.bauto[data-bout="${o.id}"]`).setAttribute('aria-pressed', String(auto));
      $$(n, `.bcam[data-bout="${o.id}"]`).forEach((b) => b.setAttribute('aria-pressed', String(!auto && b.dataset.bcam === cam)));
    }
    $$(n, '[data-bcut]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.bcut) === this.drone.cutBeats)));
  }

  /** Reflect the room's lighting state (as broadcast by the server). */
  setLight(state) {
    this.light = { ...this.light, ...state };
    const n = this.node;
    $$(n, '[data-lmode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lmode === this.light.mode)));
    $$(n, '[data-lrate]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lrate === this.light.rate)));
    const lms = $(n, '.lms');
    if (document.activeElement !== lms) {
      lms.value = this.light.flashMs;
      $(n, '.lms-v').textContent = `${this.light.flashMs} ms`;
    }
    const arena = !!this.light.arena;
    $(n, '.larena').setAttribute('aria-pressed', String(arena));
    const pill = $(n, '.larena-pill');
    pill.textContent = arena ? 'ON' : 'OFF';
    pill.style.cssText = arena ? 'background:#ffffff;color:#000' : 'background:rgba(255,255,255,.12);color:rgba(255,255,255,.6)';
    const hold = $(n, '.lhold');
    hold.style.background = this.light.hold ? '#ffffff' : '';
    hold.style.color = this.light.hold ? '#000000' : '';
    hold.style.boxShadow = this.light.hold ? '0 0 40px rgba(255,255,255,.8)' : '';
  }

  /** Write a readout only when its text changed (a write re-lays-out and repaints the panel). */
  setText(key, text) {
    if (this.shown[key] === text) return;
    this.shown[key] = text;
    this.live[key].textContent = text;
  }

  /** The open panel's readouts, 10 times a second (the clock shows whole seconds, the mic meter eases fine at 10 Hz). */
  tick(now = 0) {
    if (this.open && now >= this.nextTick) {
      this.nextTick = now + 100;
      this.setText('time', fmt(this.audio.position));
      const st = this.audio.beat.state;
      const how = { detected: `detected live, ${Math.round(st.confidence * 100)}% sure`, track: 'track tempo, locking on...', manual: 'manual clock' }[st.bpmSource];
      this.setText('detected', `${Math.round(st.bpm)} BPM · ${how}`);
      const every = 60000 / st.bpm / LIGHT_RATES[this.light.rate];
      this.setText('lbpm', `Locked to ${st.bpm.toFixed(1)} BPM → a ${this.light.flashMs} ms flash every ${Math.round(every)} ms`);
      this.meterTick();
    }
    requestAnimationFrame((t) => this.tick(t));
  }
}
