// Audio engine: one AudioContext, a shared analyser tap, and interchangeable sources
// (procedural synth, MP3 URL / upload, Icecast stream, YouTube / SoundCloud embed).
// The DJ state from the server says *what* plays and *since when*; every client
// seeks itself to the same position.
//
//   music sources → input ─┬─→ analyser (beat/tempo/peaks, pre-volume so lights work muted)
//                          └─→ lowpass ("outside the venue") → duck → limiter ─┐
//   DJ live mic (WebRTC) ──────────────────────────────────────→ micGain ──────┤
//                                                              MasterGain ←─────┘ → destination
//   Every audible WebAudio path ends in the single MasterGain, so the volume slider and
//   mute control all of it. Embeds (YouTube/SoundCloud iframes) and no-CORS streams can't
//   enter the graph; they get the same volume through their own player APIs.

import { Emitter } from '../core/events.js';
import { load, save } from '../core/store.js';
import { presetById } from '../../shared/dj.js';
import { SynthTrack } from './synth.js';
import { BeatDetector } from './beat.js';
import { EmbedPlayer } from './embeds.js';

class SynthSource {
  constructor(engine, track) {
    this.engine = engine;
    this.track = track;
    this.analysable = true;
    this.inst = null;
    this.endedSent = false;
  }

  play(pos) {
    if (pos >= this.track.duration - 0.05) {
      if (!this.endedSent) {
        this.endedSent = true;
        this.engine.emit('ended', this.track.uid);
      }
      return;
    }
    if (this.inst && Math.abs(this.inst.position - pos) < 0.25) return;
    this.halt(0.08);
    const preset = presetById(this.track.preset);
    if (!preset) return;
    const inst = new SynthTrack(this.engine.ctx, this.engine.input, preset);
    this.inst = inst;
    inst.onSection = (name, t, bar, immediate) =>
      this.engine.at(t, () => {
        if (this.inst !== inst) return;
        this.engine.section = { name, bar };
        this.engine.emit('section', name, bar, immediate);
      });
    inst.onEnded = () => {
      if (this.inst !== inst || this.endedSent) return;
      this.endedSent = true;
      this.engine.emit('ended', this.track.uid);
    };
    inst.start(pos);
  }

  pause() {
    this.halt(0.3);
  }

  stop() {
    this.halt(0.5);
  }

  halt(fade) {
    if (this.inst) {
      this.inst.stop(fade);
      this.inst = null;
    }
  }

  get position() {
    return this.inst ? this.inst.position : 0;
  }
}

class ElementSource {
  constructor(engine, track) {
    this.engine = engine;
    this.track = track;
    this.live = track.type === 'stream';
    this.want = null;
    this.dead = false;
    this.build(true);
  }

  build(cors) {
    const el = new Audio();
    el.preload = 'auto';
    el.playsInline = true;
    if (cors) el.crossOrigin = 'anonymous';
    el.addEventListener('error', () => el === this.el && this.onError(cors));
    el.addEventListener('ended', () => el === this.el && !this.dead && this.engine.emit('ended', this.track.uid));
    el.src = this.track.src;
    this.el = el;
    if (cors) {
      this.node = this.engine.ctx.createMediaElementSource(el);
      this.node.connect(this.engine.input);
      this.analysable = true;
    } else {
      this.node = null;
      this.analysable = false;
      el.volume = this.engine.outputLevel ** 2;
    }
  }

  onError(cors) {
    if (this.dead) return;
    if (cors) {
      // Most likely the host sends no CORS headers: play it directly, lose analysis.
      this.teardown();
      this.build(false);
      this.engine.emit('notice', 'This source blocks audio analysis (no CORS) — lights follow the BPM clock');
      if (this.want) this.play(this.want.pos + (performance.now() - this.want.at) / 1000);
    } else {
      this.engine.emit('notice', `Couldn't load “${this.track.title}”`);
    }
  }

  play(pos) {
    this.want = { pos, at: performance.now() };
    const el = this.el;
    if (!this.live) {
      const seek = () => {
        if (!this.want || el !== this.el) return;
        const target = this.want.pos + (performance.now() - this.want.at) / 1000;
        if (Number.isFinite(el.duration) && target < el.duration - 0.5 && Math.abs(el.currentTime - target) > 0.8) {
          el.currentTime = target;
        }
      };
      if (el.readyState >= 1) seek();
      else el.addEventListener('loadedmetadata', seek, { once: true });
    }
    if (el.paused) {
      el.play().catch((err) => {
        if (err?.name === 'NotAllowedError') this.engine.emit('blocked');
      });
    }
  }

  pause() {
    this.want = null;
    this.el.pause();
  }

  stop() {
    this.dead = true;
    this.teardown();
  }

  teardown() {
    const el = this.el;
    this.el = null;
    el.pause();
    el.removeAttribute('src');
    el.load();
    try {
      this.node?.disconnect();
    } catch {
      /* noop */
    }
    this.node = null;
  }

  setElementVolume(v) {
    if (!this.analysable && this.el) this.el.volume = v * v; // same curve as the master gain
  }

  get position() {
    return this.el?.currentTime || 0;
  }
}

class EmbedSource {
  constructor(engine, track) {
    this.engine = engine;
    this.track = track;
    this.analysable = false;
    this.playing = false;
    this.pos = 0;
    this.at = 0;
  }

  play(pos) {
    if (this.playing && Math.abs(this.position - pos) < 4) return;
    this.pos = pos;
    this.at = performance.now();
    this.playing = this.engine.embed.open(this.track, pos);
  }

  pause() {
    this.pos = this.position;
    this.playing = false;
    this.engine.embed.close();
  }

  stop() {
    this.playing = false;
    this.engine.embed.close();
  }

  get position() {
    return this.playing ? this.pos + (performance.now() - this.at) / 1000 : this.pos;
  }
}

export class AudioEngine extends Emitter {
  constructor() {
    super();
    this.ctx = null;
    this.volume = load('erave.volume', 0.8);
    this.muted = false;
    this.source = null;
    this.track = null;
    this.state = null;
    this.playing = false;
    this.beat = new BeatDetector();
    this.embed = new EmbedPlayer();
    this.serverNow = () => Date.now();
    this.micEl = null;
    this.section = null; // current arrangement section of a synth track
  }

  async init() {
    if (this.ctx) return this.ctx.resume();
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = (this.ctx = new Ctx({ latencyHint: 'interactive' }));

    this.input = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    this.analyser.minDecibels = -85;
    this.analyser.maxDecibels = -15;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.filter.Q.value = 0.9;
    this.duckGain = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    this.master = ctx.createGain(); // MasterGain: the only node connected to the speakers
    this.master.gain.value = this.gainFor(this.outputLevel);
    this.micGain = ctx.createGain();
    this.micSource = null;

    // Analyser hangs off the input so lights keep reacting when the user mutes.
    this.input.connect(this.analyser);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    this.analyser.connect(sink).connect(ctx.destination);
    this.input.connect(this.filter).connect(this.duckGain).connect(limiter).connect(this.master);
    this.micGain.connect(this.master);
    this.master.connect(ctx.destination);
    this.beat.attach(this.analyser, ctx.sampleRate);
    this.setupOnsetWorklet(ctx);

    // Context resumed after being suspended → re-seek everything to the shared clock.
    ctx.onstatechange = () => ctx.state === 'running' && this.state && this.sync(this.state);
    const unlock = () => {
      if (ctx.state === 'running') {
        removeEventListener('pointerdown', unlock);
        removeEventListener('keydown', unlock);
      } else ctx.resume();
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);

    if (this.state) this.sync(this.state);
    return ctx.resume().catch(() => {});
  }

  /**
   * Sample-accurate onset detection on the audio thread, feeding the tempo tracker.
   * AudioWorklet needs a secure context (HTTPS/localhost); elsewhere the beat detector
   * keeps using frame-based spectral flux.
   */
  async setupOnsetWorklet(ctx) {
    if (!ctx.audioWorklet) return;
    try {
      await ctx.audioWorklet.addModule(new URL('./onset-worklet.js', import.meta.url));
      const node = new AudioWorkletNode(ctx, 'onset-detector', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = (e) => this.beat.pushOnsets(e.data);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      this.input.connect(node).connect(sink).connect(ctx.destination);
      this.onsetNode = node;
    } catch (err) {
      console.warn('[audio] onset worklet unavailable, using frame-based analysis', err);
    }
  }

  /** Run fn when the audio clock reaches ctxTime (for visuals locked to scheduled audio). */
  at(ctxTime, fn) {
    setTimeout(fn, Math.max(0, (ctxTime - this.ctx.currentTime) * 1000));
  }

  sync(state) {
    this.state = state;
    if (!this.ctx) return;
    const track = state.queue[state.index] || null;
    if (!track) {
      this.stopSource();
      this.track = null;
      this.playing = false;
      this.emit('track', null);
      this.emit('playstate', false);
      return;
    }
    if (!this.track || track.uid !== this.track.uid) {
      this.stopSource();
      this.track = track;
      this.source = this.createSource(track);
      this.section = null;
      this.beat.resetTempo(track.bpm || 0);
      this.emit('track', track);
    }
    this.beat.setFallback(state.bpm);
    const pos = state.playing ? Math.max(0, (this.serverNow() - state.startedAt) / 1000) : state.pausedPos;
    if (state.playing) this.source.play(pos);
    else this.source.pause();
    this.playing = state.playing;
    this.emit('playstate', this.playing);
  }

  createSource(track) {
    if (track.type === 'synth') return new SynthSource(this, track);
    if (track.type === 'youtube' || track.type === 'soundcloud') return new EmbedSource(this, track);
    return new ElementSource(this, track);
  }

  stopSource() {
    this.source?.stop();
    this.source = null;
  }

  update(dt) {
    const running = !!this.ctx && this.ctx.state === 'running';
    return this.beat.update(dt, this.playing && running, !!this.source?.analysable);
  }

  get position() {
    return this.source ? this.source.position : 0;
  }

  get outputLevel() {
    return this.muted ? 0 : this.volume;
  }

  gainFor(v) {
    return v * v;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    save('erave.volume', this.volume);
    this.applyVolume();
  }

  setMuted(m) {
    this.muted = m;
    this.applyVolume();
  }

  applyVolume() {
    const v = this.outputLevel;
    if (this.master) this.master.gain.setTargetAtTime(this.gainFor(v), this.ctx.currentTime, 0.04);
    this.source?.setElementVolume?.(v);
    this.embed.setVolume(v);
    if (this.micEl && !this.micEl.muted) this.micEl.volume = v; // only when the mic bypasses WebAudio
    this.emit('volume', this.volume, this.muted);
  }

  /** Low-pass the mix — sounds like you're outside the venue while building your avatar. */
  setMuffled(on, seconds = 1.5) {
    if (!this.ctx) return;
    const f = this.filter.frequency;
    const now = this.ctx.currentTime;
    f.cancelScheduledValues(now);
    f.setValueAtTime(Math.max(20, f.value), now);
    f.exponentialRampToValueAtTime(on ? 380 : 20000, now + Math.max(0.01, seconds));
  }

  setDuck(on) {
    if (this.ctx) this.duckGain.gain.setTargetAtTime(on ? 0.3 : 1, this.ctx.currentTime, 0.15);
  }

  /** Play the DJ's live mic through micGain → MasterGain (ducking the music meanwhile). */
  playMic(stream) {
    this.stopMic();
    // Chrome only pulls audio from a remote WebRTC stream while a media element plays it,
    // so a muted element stays attached; the audible path runs through the master gain.
    if (!this.micEl) this.micEl = new Audio();
    this.micEl.autoplay = true;
    this.micEl.muted = true;
    this.micEl.srcObject = stream;
    this.micEl.play().catch(() => {});
    try {
      this.micSource = this.ctx.createMediaStreamSource(stream);
      this.micSource.connect(this.micGain);
    } catch {
      // Fallback: let the element play it, mirroring the master volume.
      this.micEl.muted = false;
      this.micEl.volume = this.outputLevel;
    }
    this.setDuck(true);
  }

  stopMic() {
    try {
      this.micSource?.disconnect();
    } catch {
      /* already gone */
    }
    this.micSource = null;
    if (this.micEl) {
      this.micEl.srcObject = null;
      this.micEl.muted = true;
    }
    this.setDuck(false);
  }

  mountEmbed(container) {
    this.embed.mount(container);
    if (this.source instanceof EmbedSource && this.state) this.sync(this.state);
  }
}
