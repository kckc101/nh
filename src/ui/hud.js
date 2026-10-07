// Festival HUD: now-playing + visualizer, connection / FPS / volume, dance & reaction bar,
// TikTok-style floating reactions, DJ announcement banner, hype popups, settings & help.

import { el, $, $$, toast, markKhmer } from './dom.js';
import { icon, renderIcons } from './icons.js';
import { Chat } from './chat.js';
import { createJoystick } from './joystick.js';
import { DANCES } from '../avatar/dances.js';
import { settings, saveSettings, isTouch } from '../core/device.js';
import { load, save } from '../core/store.js';

export const REACTIONS = [
  { id: 'heart', emoji: '💖', label: 'Love', key: 'Z' },
  { id: 'fire', emoji: '🔥', label: 'Fire', key: 'X' },
  { id: 'confetti', emoji: '🎉', label: 'Confetti', key: 'C' },
  { id: 'cheer', emoji: '🙌', label: 'Cheer', key: 'V' },
];
const FLOAT = { heart: ['💖', '💜', '💙', '💗', '❤️', '💛'], fire: ['🔥'], confetti: ['🎉', '🎊', '✨'], cheer: ['🙌', '🤘', '👏'] };

export class HUD {
  constructor(root, { audio, net, isDJ, actions }) {
    this.audio = audio;
    this.net = net;
    this.actions = actions;
    this.isDJ = isDJ;
    this.floating = 0;

    const danceBtns = [{ id: 'idle', label: 'Vibe', icon: '🎵', key: '0' }, ...DANCES]
      .map((d) => `<button class="act shrink-0 rounded-xl px-2.5 md:px-3 py-1.5 md:py-2 flex md:flex-col items-center gap-1.5 md:gap-0.5 md:min-w-[68px] border border-white/10 md:border-transparent glass md:bg-transparent md:backdrop-blur-none" data-dance="${d.id}" title="${d.label} (${d.key})">
          <span class="text-lg md:text-xl leading-none">${d.icon}</span>
          <span class="text-[11px] font-semibold whitespace-nowrap">${d.label}</span>
          <kbd class="hidden md:block text-[9px] text-white/35 font-mono">${d.key}</kbd></button>`)
      .join('');
    const reactBtns = REACTIONS.map(
      (r) => `<button class="act react rounded-full md:rounded-xl size-12 md:size-auto md:px-3 md:py-2 grid md:flex md:flex-col place-items-center md:items-center glass md:bg-transparent md:backdrop-blur-none border border-white/10 md:border-transparent" data-react="${r.id}" title="${r.label} (${r.key})">
          <span class="text-2xl md:text-xl leading-none">${r.emoji}</span>
          <span class="hidden md:block text-[11px] font-semibold">${r.label}</span>
          <kbd class="hidden md:block text-[9px] text-white/35 font-mono">${r.key}</kbd></button>`,
    ).join('');

    this.node = el(`
      <div class="hud fixed inset-0 pointer-events-none z-30 select-none" style="padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)">
        <div class="np pointer-events-auto absolute left-3 top-3 md:left-4 md:top-4 glass rounded-2xl p-2.5 md:p-3 flex items-center gap-3 w-[min(60vw,360px)]">
          <div class="relative size-11 md:size-14 shrink-0 rounded-xl grid place-items-center overflow-hidden"
               style="background: conic-gradient(from 0deg, #ff2bd6, #8b5cff, #00f0ff, #9dff00, #ffc400, #ff2bd6)">
            <div class="absolute inset-[3px] rounded-[10px] bg-ink grid place-items-center">${icon('disc-3', 'disc size-6 md:size-7 text-magenta')}</div>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 text-[10px] tracking-[.18em] font-semibold">
              <span class="flex items-center gap-1 text-[#ff4d6d]"><span class="size-1.5 rounded-full bg-[#ff2d55] pulse-dot"></span>LIVE</span>
              <span class="host text-gold/90 truncate">DJ ANGKOR</span>
              <span class="mic hidden items-center gap-1 text-acid">${icon('mic', 'size-3')}ON MIC</span>
            </div>
            <div class="title font-semibold text-[13px] md:text-sm truncate">Tuning in…</div>
            <div class="artist hidden sm:block text-[11px] text-white/55 truncate">&nbsp;</div>
            <canvas class="viz mt-1 block w-full h-4 md:h-5"></canvas>
            <div class="h-[2px] mt-1 rounded bg-white/10 overflow-hidden"><div class="prog h-full w-0 bg-gradient-to-r from-magenta to-cyan"></div></div>
          </div>
        </div>

        <div class="pointer-events-auto absolute right-3 top-3 md:right-4 md:top-4 flex flex-col items-end gap-2">
          <div class="flex items-center gap-1.5">
            <div class="status glass rounded-full px-3 h-9 text-[11px] font-semibold flex items-center gap-2">
              <span class="dot size-2 rounded-full bg-gold"></span><span class="label hidden sm:inline">CONNECTING</span>
              <span class="text-white/30 hidden sm:inline">|</span>${icon('users', 'size-3.5 text-white/60')}<span class="count">—</span>
            </div>
            <button class="mute act glass rounded-full size-9 grid place-items-center" aria-label="Mute">${icon('volume-2', 'size-4')}</button>
            <button class="settings act glass rounded-full size-9 grid place-items-center" aria-label="Settings">${icon('settings', 'size-4')}</button>
            <button class="help act glass rounded-full size-9 hidden md:grid place-items-center" aria-label="Controls">${icon('circle-help', 'size-4')}</button>
            <button class="fs act glass rounded-full size-9 hidden sm:grid place-items-center" aria-label="Fullscreen">${icon('maximize', 'size-4')}</button>
            ${isDJ ? `<button class="dj act rounded-xl h-9 px-3 flex items-center gap-1.5 font-display text-lg text-black" style="background:linear-gradient(90deg,#ff2bd6,#ffc400)" aria-label="DJ panel">${icon('headphones', 'size-4')}<span class="hidden sm:inline">DJ</span></button>` : ''}
          </div>
          <div class="vol hidden md:flex glass rounded-full h-8 px-3 items-center gap-2">
            ${icon('volume-2', 'size-3.5 text-white/60')}<input type="range" min="0" max="1" step="0.01" class="w-28 accent-[#00f0ff]" aria-label="Volume"/>
          </div>
          <div class="stats text-[10px] text-white/45 font-mono tracking-wider">-- FPS · -- ms</div>
          <div class="embed hidden w-[220px] md:w-[260px] aspect-video rounded-xl overflow-hidden glass [&>iframe]:w-full [&>iframe]:h-full"></div>
        </div>

        <div class="announce hidden absolute left-1/2 -translate-x-1/2 top-[92px] md:top-24 w-[min(92vw,820px)] text-center pointer-events-none">
          <div class="text-[10px] md:text-xs tracking-[.4em] text-gold font-semibold mb-1 by">DJ ANNOUNCEMENT</div>
          <div class="text font-display glitch text-white text-[clamp(28px,6vw,64px)] leading-[0.95]"></div>
        </div>
        <div class="hype absolute inset-0 grid place-items-center pointer-events-none"></div>

        <div class="stream absolute right-2 md:right-6 bottom-[260px] md:bottom-24 w-24 h-[50vh] pointer-events-none overflow-visible"></div>

        <div class="dances pointer-events-auto absolute left-0 right-0 bottom-[calc(8px+env(safe-area-inset-bottom))] px-2 flex gap-1.5 overflow-x-auto no-scrollbar
                    md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-4 md:px-1.5 md:py-1.5 md:rounded-2xl md:glass md:gap-0.5 md:overflow-visible">
          ${danceBtns}
        </div>
        <div class="reacts pointer-events-auto absolute right-3 bottom-[calc(68px+env(safe-area-inset-bottom))] flex flex-col gap-2.5
                    md:right-4 md:bottom-4 md:flex-row md:gap-0.5 md:p-1.5 md:rounded-2xl md:glass">
          ${reactBtns}
          <button class="chat-btn act md:hidden rounded-full size-12 grid place-items-center glass border border-white/10" aria-label="Chat">${icon('message-circle', 'size-5')}</button>
        </div>

        <div class="help-card hidden pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(92vw,460px)] glass-strong rounded-2xl p-5">
          <div class="flex items-center justify-between mb-3">
            <h3 class="font-display text-2xl">HOW TO RAVE</h3>
            <button class="close-help act rounded-lg size-8 grid place-items-center" aria-label="Close">${icon('x', 'size-4')}</button>
          </div>
          <ul class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            ${(isTouch
              ? [['Left stick', 'Walk (push far to run)'], ['Drag screen', 'Look around'], ['Pinch', 'Zoom'], ['Bottom bar', 'Dance moves'], ['Right rail', 'Reactions & chat']]
              : [['W A S D / ←↑↓→', 'Walk · hold Shift to run'], ['Space', 'Jump'], ['Drag mouse', 'Orbit camera · wheel to zoom'], ['1 – 5 · 0', 'Dance moves · back to vibing'], ['Z X C V', 'Hearts · Fire · Confetti · Cheer'], ['Enter / T', 'Chat']]
            ).map(([k, v]) => `<li class="contents"><span class="font-mono text-cyan text-xs mt-0.5 whitespace-nowrap">${k}</span><span class="text-white/80">${v}</span></li>`).join('')}
          </ul>
        </div>

        <div class="settings-card hidden pointer-events-auto absolute right-3 md:right-4 top-[60px] md:top-16 w-[min(92vw,300px)] glass-strong rounded-2xl p-4 space-y-4 text-sm">
          <div class="flex items-center justify-between"><h3 class="font-display text-xl">SETTINGS</h3>
            <button class="close-settings act rounded-lg size-8 grid place-items-center" aria-label="Close">${icon('x', 'size-4')}</button></div>
          <div class="md:hidden"><div class="text-[11px] tracking-[.2em] text-white/45 mb-1.5">VOLUME</div>
            <input type="range" min="0" max="1" step="0.01" class="vol-m w-full accent-[#00f0ff]" aria-label="Volume"/></div>
          <div><div class="text-[11px] tracking-[.2em] text-white/45 mb-1.5">GRAPHICS</div>
            <div class="flex gap-1.5">${['high', 'medium', 'low'].map((q) => `<button class="chip q flex-1 rounded-lg py-1.5 capitalize" data-q="${q}">${q}</button>`).join('')}</div></div>
          <div><div class="text-[11px] tracking-[.2em] text-white/45 mb-1.5 flex justify-between"><span>SIMULATED CROWD</span><span class="bots-n text-white/70">${settings.bots}</span></div>
            <input type="range" min="0" max="90" step="1" value="${settings.bots}" class="bots w-full accent-[#ff2bd6]" aria-label="Simulated crowd size"/></div>
          <label class="flex items-center justify-between gap-3 cursor-pointer"><span>Reduce flashing lights</span><input type="checkbox" class="reduce size-4 accent-[#ff2bd6]" ${settings.reduceFlash ? 'checked' : ''}/></label>
          <label class="flex items-center justify-between gap-3 cursor-pointer"><span>Auto performance<span class="block text-[11px] text-white/45">Dynamic resolution · drops effects below 30 FPS</span></span><input type="checkbox" class="autoperf size-4 accent-[#ff2bd6]" ${settings.autoPerf !== false ? 'checked' : ''}/></label>
          <label class="flex items-center justify-between gap-3 cursor-pointer"><span>Auto pyro on drops</span><input type="checkbox" class="autofx size-4 accent-[#ff2bd6]" ${settings.autoFx ? 'checked' : ''}/></label>
        </div>

        <button class="unmute hidden pointer-events-auto absolute left-1/2 -translate-x-1/2 bottom-28 btn-rave rounded-full px-6 py-3 font-semibold">🔊 Tap to turn the sound on</button>
      </div>`);
    root.append(this.node);
    renderIcons(this.node);

    const n = this.node;
    this.els = {
      title: $(n, '.title'), artist: $(n, '.artist'), host: $(n, '.host'), mic: $(n, '.mic'), prog: $(n, '.prog'),
      viz: $(n, '.viz'), disc: $(n, '.disc'), status: $(n, '.status'), stats: $(n, '.stats'),
      announce: $(n, '.announce'), hype: $(n, '.hype'), stream: $(n, '.stream'), embed: $(n, '.embed'),
    };
    audio.mountEmbed(this.els.embed);

    this.chat = new Chat(n, {
      onSend: (t) => actions.chat(t),
      onQuick: (t, r) => actions.quick(t, r),
      onOpenChange: (open) => this.joystick?.classList.toggle('hidden', open),
    });
    if (isTouch) this.joystick = createJoystick(n, (x, y) => actions.joystick(x, y));

    $$(n, '[data-dance]').forEach((b) => b.addEventListener('click', () => actions.dance(b.dataset.dance)));
    $$(n, '[data-react]').forEach((b) => b.addEventListener('click', () => actions.react(b.dataset.react)));
    $(n, '.chat-btn').addEventListener('click', () => this.chat.toggle());
    $(n, '.dj')?.addEventListener('click', () => actions.toggleDJ());

    // volume
    const volInputs = [$(n, '.vol input'), $(n, '.vol-m')];
    volInputs.forEach((v) => {
      v.value = audio.volume;
      v.addEventListener('input', () => {
        audio.setMuted(false);
        audio.setVolume(Number(v.value));
      });
    });
    const muteBtn = $(n, '.mute');
    muteBtn.addEventListener('click', () => audio.setMuted(!audio.muted));
    audio.on('volume', (vol, muted) => {
      volInputs.forEach((v) => (v.value = vol));
      muteBtn.innerHTML = icon(muted || vol === 0 ? 'volume-x' : 'volume-2', 'size-4');
      renderIcons(muteBtn);
    });

    // settings / help / fullscreen
    const settingsCard = $(n, '.settings-card');
    const helpCard = $(n, '.help-card');
    $(n, '.settings').addEventListener('click', () => settingsCard.classList.toggle('hidden'));
    $(n, '.close-settings').addEventListener('click', () => settingsCard.classList.add('hidden'));
    $(n, '.help').addEventListener('click', () => helpCard.classList.toggle('hidden'));
    $(n, '.close-help').addEventListener('click', () => helpCard.classList.add('hidden'));
    $(n, '.fs').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    const qBtns = $$(n, '.q');
    this.markQuality = (lvl) => qBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === lvl)));
    this.markQuality(settings.quality);
    qBtns.forEach((b) => b.addEventListener('click', () => actions.quality(b.dataset.q)));
    const bots = $(n, '.bots');
    bots.addEventListener('input', () => ($(n, '.bots-n').textContent = bots.value));
    bots.addEventListener('change', () => actions.bots(Number(bots.value)));
    $(n, '.reduce').addEventListener('change', (e) => {
      settings.reduceFlash = e.target.checked;
      saveSettings();
    });
    $(n, '.autoperf').addEventListener('change', (e) => {
      settings.autoPerf = e.target.checked;
      saveSettings();
      actions.autoPerf?.(e.target.checked);
    });
    $(n, '.autofx').addEventListener('change', (e) => {
      settings.autoFx = e.target.checked;
      saveSettings();
    });

    const unmute = $(n, '.unmute');
    unmute.addEventListener('click', () => audio.init());
    this.unmute = unmute;

    if (!load('erave.seenHelp', false)) {
      helpCard.classList.remove('hidden');
      save('erave.seenHelp', true);
      setTimeout(() => helpCard.classList.add('hidden'), 12000);
    }

    this.vizCtx = this.els.viz.getContext('2d');
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  loop() {
    const M = this.audio.beat.state;
    const c = this.els.viz;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== w * 2) {
      c.width = w * 2;
      c.height = h * 2;
    }
    const ctx = this.vizCtx;
    ctx.clearRect(0, 0, c.width, c.height);
    const bars = 32;
    const bw = c.width / bars;
    for (let i = 0; i < bars; i++) {
      const v = M.fft[Math.floor(i * 1.6)] / 255;
      const bh = Math.max(2, v * c.height);
      const g = i / bars;
      ctx.fillStyle = `hsl(${300 - g * 130}, 100%, ${55 + v * 15}%)`;
      ctx.fillRect(i * bw + 1, c.height - bh, bw - 2, bh);
    }
    this.els.disc.style.transform = `rotate(${(performance.now() / 6) % 360}deg) scale(${1 + M.kick * 0.12})`;
    const t = this.audio.track;
    if (t?.duration) this.els.prog.style.width = `${Math.min(100, (this.audio.position / t.duration) * 100)}%`;
    else this.els.prog.style.width = t ? '100%' : '0';
    const suspended = this.audio.ctx && this.audio.ctx.state !== 'running';
    this.unmute.classList.toggle('hidden', !suspended);
    requestAnimationFrame(this.loop);
  }

  setTrack(t) {
    this.els.title.textContent = t ? t.title : 'Stage is quiet';
    this.els.artist.textContent = t ? `${t.artist}${t.type === 'stream' ? ' · LIVE RADIO' : t.type === 'synth' ? ` · ${t.bpm} BPM` : ''}` : '';
  }

  setHost(name) {
    this.els.host.textContent = name;
  }

  setMicLive(live) {
    this.els.mic.classList.toggle('hidden', !live);
    this.els.mic.classList.toggle('flex', live);
  }

  setStatus(status, count) {
    const dot = $(this.els.status, '.dot');
    const label = $(this.els.status, '.label');
    const map = { online: ['bg-acid', 'ONLINE'], offline: ['bg-magenta', 'OFFLINE DEMO'], reconnecting: ['bg-gold pulse-dot', 'RECONNECTING'], connecting: ['bg-gold pulse-dot', 'CONNECTING'] };
    const [cls, text] = map[status] || map.connecting;
    dot.className = `dot size-2 rounded-full ${cls}`;
    label.textContent = text;
    if (count !== undefined) $(this.els.status, '.count').textContent = count;
  }

  setStats(fps, ping) {
    this.fps = fps;
    this.ping = ping;
    this.renderStats();
  }

  setPerf({ scale, tierName }) {
    this.perf = { scale, tierName };
    this.renderStats();
  }

  renderStats() {
    const parts = [`${this.fps ?? '--'} FPS`];
    if (this.perf && this.perf.scale < 0.99) parts.push(`${Math.round(this.perf.scale * 100)}% res`);
    if (this.perf && this.perf.tierName !== 'full') parts.push(this.perf.tierName);
    if (this.ping) parts.push(`${this.ping} ms`);
    this.els.stats.textContent = parts.join(' · ');
  }

  setDance(id) {
    $$(this.node, '[data-dance]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dance === id)));
  }

  announce(text, by) {
    const a = this.els.announce;
    markKhmer($(a, '.text'), text).textContent = text;
    $(a, '.by').textContent = by ? `📣 ${by}` : 'DJ ANNOUNCEMENT';
    a.classList.remove('hidden');
    a.classList.remove('announce-in');
    void a.offsetWidth;
    a.classList.add('announce-in');
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => a.classList.add('hidden'), 6500);
  }

  hype(text, color = '#ffc400') {
    const h = el(`<div class="hype-pop font-display text-center leading-none text-[clamp(56px,13vw,150px)] neon" style="color:${color}"></div>`);
    h.textContent = text;
    this.els.hype.replaceChildren(h);
    setTimeout(() => h.remove(), 1900);
  }

  /** TikTok-live style emoji rising up the right side of the screen. */
  floatReaction(type) {
    if (this.floating > 36) return;
    this.floating++;
    const list = FLOAT[type] || FLOAT.heart;
    const e = document.createElement('div');
    e.className = 'float-emoji';
    e.textContent = list[Math.floor(Math.random() * list.length)];
    e.style.left = `${20 + Math.random() * 40}px`;
    e.style.setProperty('--dx', `${(Math.random() - 0.5) * 90}px`);
    e.style.setProperty('--rot', `${(Math.random() - 0.5) * 50}deg`);
    e.style.setProperty('--dur', `${2.2 + Math.random() * 1.4}s`);
    e.style.fontSize = `${26 + Math.random() * 16}px`;
    e.addEventListener('animationend', () => {
      e.remove();
      this.floating--;
    });
    this.els.stream.append(e);
  }

  toast(text, tone) {
    toast(text, tone);
  }
}
