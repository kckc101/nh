// DJ host control panel: transport + queue, add tracks (built-in, upload, MP3 / Icecast /
// YouTube / SoundCloud link), stage FX pad, announcements, live mic and tempo.

import { el, esc, toast, $, $$ } from './dom.js';
import { icon, renderIcons } from './icons.js';
import { SYNTH_PRESETS } from '../../shared/dj.js';
import { parseMediaUrl } from '../audio/embeds.js';

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

    const sec = (title, body) => `<section class="space-y-2.5"><h3 class="text-[11px] font-semibold tracking-[.25em] text-white/45">${title}</h3>${body}</section>`;
    this.node = el(`
      <aside class="djp pointer-events-auto fixed z-40 inset-0 md:inset-auto md:top-0 md:right-0 md:h-full md:w-[420px] glass-strong md:border-l border-white/10
                    flex flex-col translate-x-full transition-transform duration-300 ease-out" aria-label="DJ control panel" style="--accent:#ff2bd6">
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
          ${sec('STAGE FX', `<div class="grid grid-cols-4 gap-2">${FX.map((f) => `
            <button class="fx-pad rounded-xl aspect-square flex flex-col items-center justify-center gap-1 text-center bg-white/5" style="--glow:${f.color}40" data-fx="${f.id}">
              <span class="text-2xl leading-none">${f.emoji}</span><span class="text-[10px] font-semibold leading-tight px-1">${f.label}</span></button>`).join('')}</div>`)}
          ${sec('ANNOUNCEMENT', `
            <form class="ann flex gap-2"><input class="field flex-1 min-w-0 text-sm text-white" maxlength="80" placeholder="Shout to the crowd…" aria-label="Announcement"/>
              <button class="act rounded-xl px-3 glass flex items-center gap-1.5 text-sm font-semibold">${icon('megaphone', 'size-4')}Send</button></form>
            <div class="flex flex-wrap gap-1.5">${ANNOUNCE_PRESETS.map((p, i) => `<button class="chip rounded-full px-2.5 py-1 text-[11px]" data-ann="${i}">${esc(p)}</button>`).join('')}</div>`)}
          ${sec('LIVE MIC', `
            <div class="flex items-center gap-3">
              <button class="mic-btn act rounded-xl px-4 py-2.5 glass flex items-center gap-2 font-semibold text-sm">${icon('mic', 'size-4')}<span>Go live on mic</span></button>
              <div class="flex-1 h-2 rounded-full bg-white/10 overflow-hidden"><div class="mic-meter h-full w-0 bg-gradient-to-r from-acid to-gold transition-[width] duration-75"></div></div>
            </div>
            <p class="text-[11px] text-white/45">Your voice streams to every raver (WebRTC) and the music ducks while you talk.</p>`)}
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
    requestAnimationFrame(() => this.tick());
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

    const micBtn = $(n, '.mic-btn');
    micBtn.addEventListener('click', async () => {
      try {
        if (this.mic.live) this.mic.stop();
        else await this.mic.start();
      } catch (err) {
        toast(err.message || 'Microphone unavailable', 'error', 4500);
      }
    });
    this.mic.on('change', (live) => {
      micBtn.innerHTML = `${icon(live ? 'mic-off' : 'mic', 'size-4')}<span>${live ? 'End mic' : 'Go live on mic'}</span>`;
      micBtn.style.boxShadow = live ? '0 0 20px #9dff00' : '';
      renderIcons(micBtn);
      this.setupMeter(live ? this.mic.stream : null);
    });
  }

  setupMeter(stream) {
    this.meter = null;
    if (!stream || !this.audio.ctx) return;
    const src = this.audio.ctx.createMediaStreamSource(stream);
    const an = this.audio.ctx.createAnalyser();
    an.fftSize = 256;
    src.connect(an);
    this.meter = { an, data: new Uint8Array(an.fftSize) };
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

  tick() {
    if (this.open) {
      $(this.node, '.np-time').textContent = fmt(this.audio.position);
      const st = this.audio.beat.state;
      $(this.node, '.detected').textContent = st.analysed ? `detected ${Math.round(st.bpm)} BPM` : 'BPM clock';
      if (this.meter) {
        this.meter.an.getByteTimeDomainData(this.meter.data);
        let peak = 0;
        for (const v of this.meter.data) peak = Math.max(peak, Math.abs(v - 128));
        $(this.node, '.mic-meter').style.width = `${Math.min(100, (peak / 128) * 160)}%`;
      }
    }
    requestAnimationFrame(() => this.tick());
  }
}
