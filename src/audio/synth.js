// Procedural rave music generator (Web Audio).
// Each preset is rendered deterministically from its seed so every client plays the identical
// arrangement; the server only shares the start timestamp. Lead voice is a "roneat"
// (Khmer xylophone) style mallet synth playing pentatonic patterns.

import { mulberry32, hash01, pick } from '../core/rng.js';
import { SYNTH_BARS } from '../../shared/dj.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const STYLES = {
  house: { scale: [0, 2, 4, 7, 9], swing: 0.1, bass: 'pluck', hats: 'offbeat', stabs: false, pad: true, leadVel: 0.42, kickHi: 140 },
  techno: { scale: [0, 3, 5, 7, 10], swing: 0, bass: 'rolling', hats: 'sixteenth', stabs: true, pad: false, leadVel: 0.36, kickHi: 160 },
  acid: { scale: [0, 3, 5, 7, 10], swing: 0.04, bass: 'acid', hats: 'sixteenth', stabs: false, pad: true, leadVel: 0.3, kickHi: 165 },
  trance: { scale: [0, 2, 4, 7, 9], swing: 0, bass: 'offbeat', hats: 'offbeat', stabs: true, pad: true, leadVel: 0.46, kickHi: 170 },
  deep: { scale: [0, 2, 3, 7, 10], swing: 0.14, bass: 'sub', hats: 'shuffle', stabs: false, pad: true, leadVel: 0.4, kickHi: 130 },
};

/** Arrangement map shared with the visuals (lights/lasers follow these sections). */
export function sectionAt(bar) {
  if (bar < 8) return 'intro';
  if (bar < 16) return 'intro2';
  if (bar < 32) return 'groove';
  if (bar < 40) return 'break';
  if (bar < 48) return 'build';
  if (bar < 80) return 'drop';
  if (bar < 88) return 'break2';
  return 'outro';
}

const sharedBuffers = new WeakMap();
function buffersFor(ctx) {
  let b = sharedBuffers.get(ctx);
  if (b) return b;
  const sr = ctx.sampleRate;
  const noise = ctx.createBuffer(1, sr * 2, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const len = Math.floor(sr * 2.4);
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
  }
  b = { noise, ir };
  sharedBuffers.set(ctx, b);
  return b;
}

export class SynthTrack {
  constructor(ctx, destination, preset) {
    this.ctx = ctx;
    this.preset = preset;
    this.style = STYLES[preset.style] || STYLES.techno;
    this.seed = preset.seed;
    this.stepDur = 60 / preset.bpm / 4;
    this.barDur = this.stepDur * 16;
    this.totalSteps = SYNTH_BARS * 16;
    this.bassRoot = 33 + preset.key;
    this.leadRoot = 72 + preset.key;
    this.padRoot = 57 + preset.key;
    const { noise, ir } = buffersFor(ctx);
    this.noiseBuf = noise;

    // ---- mixer graph
    const out = (this.out = ctx.createGain());
    out.gain.value = 0;
    out.connect(destination);
    this.drums = ctx.createGain();
    this.drums.gain.value = 0.9;
    this.drums.connect(out);
    this.musicIn = ctx.createGain();
    this.musicIn.gain.value = 0.8;
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 16000;
    this.musicFilter.Q.value = 0.8;
    this.duck = ctx.createGain();
    this.musicIn.connect(this.musicFilter).connect(this.duck).connect(out);

    this.delaySend = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = this.stepDur * 3;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    this.delaySend.connect(delay).connect(damp).connect(fb).connect(delay);
    damp.connect(wet).connect(this.musicFilter);

    this.reverbSend = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const rv = ctx.createGain();
    rv.gain.value = 0.3;
    this.reverbSend.connect(conv).connect(rv).connect(out);

    this.nodes = [out, this.drums, this.musicIn, this.musicFilter, this.duck, this.delaySend, delay, fb, damp, wet, this.reverbSend, conv, rv];

    // ---- deterministic composition
    const rng = mulberry32(this.seed);
    this.prog = pick(rng, [[0, 0, 3, 4], [0, 3, 4, 3], [0, 4, 3, 2], [0, 2, 3, 4], [0, 3, 0, 4], [0, 4, 2, 3]]);
    this.lead = this.makeLead(rng);
    this.leadB = this.makeLead(rng);
    this.acidPat = Array.from({ length: 16 }, () => ({
      on: rng() < 0.72,
      deg: pick(rng, [0, 0, 0, 1, 2, 3, 4, 5]),
      up: rng() < 0.2,
      accent: rng() < 0.3,
      slide: rng() < 0.25,
    }));
    this.stabSteps = pick(rng, [[2, 6, 10, 14], [3, 6, 11, 14], [2, 7, 10, 15], [3, 7, 11]]);
    this.bassAlt = rng() < 0.5;

    this.timer = null;
    this.nextStep = 0;
    this.t0 = 0;
    this.lastAcidF = 0;
    this.ended = false;
    this.onSection = null;
    this.onEnded = null;
  }

  makeLead(rng) {
    const pat = new Array(32).fill(null);
    let deg = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < 16; i++) {
      const p = i % 4 === 0 ? 0.75 : i % 2 === 0 ? 0.5 : 0.2;
      if (rng() < p) {
        deg = Math.max(0, Math.min(9, deg + pick(rng, [-2, -1, -1, 1, 1, 2, 0, 3, -3])));
        pat[i] = deg;
      }
    }
    // Call & response: bar two repeats the phrase with a new ending.
    for (let i = 0; i < 12; i++) pat[16 + i] = pat[i];
    for (let i = 12; i < 16; i++) {
      if (rng() < 0.55) pat[16 + i] = Math.max(0, Math.min(9, (pat[i] ?? deg) + pick(rng, [-2, -1, 1, 2])));
    }
    return pat;
  }

  note(root, deg) {
    const sc = this.style.scale;
    const o = Math.floor(deg / sc.length);
    return root + 12 * o + sc[((deg % sc.length) + sc.length) % sc.length];
  }

  get position() {
    return this.ctx.currentTime - this.t0;
  }

  start(pos) {
    const now = this.ctx.currentTime;
    pos = Math.max(0, pos);
    const step = Math.ceil(pos / this.stepDur - 1e-6);
    this.nextStep = step;
    this.t0 = now + 0.06 - pos;
    const bar = Math.floor(step / 16);
    const sec = sectionAt(Math.min(bar, SYNTH_BARS - 1));
    this.applySectionFilter(sec, now, step);
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(bar >= 92 ? 0.4 : 0.85, now + 0.25);
    this.onSection?.(sec, now, bar, true);
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop(fade = 0.25) {
    clearInterval(this.timer);
    this.timer = null;
    const now = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => {
      for (const n of this.nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    }, (fade + 0.8) * 1000);
  }

  schedule() {
    const horizon = this.ctx.currentTime + (document.hidden ? 1.5 : 0.18);
    let t = this.t0 + this.nextStep * this.stepDur;
    while (t < horizon) {
      if (this.nextStep >= this.totalSteps) {
        if (!this.ended) {
          this.ended = true;
          setTimeout(() => this.onEnded?.(), Math.max(0, t - this.ctx.currentTime) * 1000);
        }
        clearInterval(this.timer);
        this.timer = null;
        return;
      }
      this.playStep(this.nextStep, t);
      this.nextStep++;
      t = this.t0 + this.nextStep * this.stepDur;
    }
  }

  applySectionFilter(sec, t, step) {
    const f = this.musicFilter.frequency;
    f.cancelScheduledValues(t);
    if (sec === 'break' || sec === 'break2') {
      f.setTargetAtTime(1100, t, 0.6);
    } else if (sec === 'build') {
      const p = Math.max(0, Math.min(1, (step / 16 - 40) / 8));
      f.setValueAtTime(1100 * Math.pow(14000 / 1100, p), t);
      f.exponentialRampToValueAtTime(14000, t + Math.max(0.1, (48 * 16 - step) * this.stepDur));
    } else {
      f.setValueAtTime(16000, t);
    }
  }

  // ------------------------------------------------------------ sequencing

  playStep(step, t) {
    const st = this.style;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const sec = sectionAt(bar);
    if (s === 0 && bar > 0 && sectionAt(bar - 1) !== sec) {
      this.applySectionFilter(sec, t, step);
      this.onSection?.(sec, t, bar, false);
    }
    if (bar === 92 && s === 0) this.out.gain.setTargetAtTime(0.25, t, this.barDur * 1.5);

    const tt = s % 2 === 1 ? t + this.stepDur * st.swing : t;
    const h = (k) => hash01(step * 131 + k * 7 + this.seed);
    const drop = sec === 'drop';
    const brk = sec === 'break' || sec === 'break2';
    const build = sec === 'build';
    const intro = sec === 'intro';

    // KICK
    let kick = !brk && !build && s % 4 === 0;
    if (build && bar >= 44 && s % 4 === 0) kick = true;
    if (build && bar === 47 && s >= 8) kick = s % 2 === 0;
    if (drop && bar === 79 && s >= 12) kick = false;
    if (kick) this.kick(t, drop ? 1 : 0.88);

    // CLAP
    if (!intro && !brk && !(build && bar < 46) && (s === 4 || s === 12)) this.clap(t, drop ? 0.5 : 0.42);

    // HATS
    if ((!build || bar >= 44) && !(intro && bar < 4)) {
      if (st.hats === 'offbeat' || brk) {
        if (s % 4 === 2) this.hat(tt, brk ? 0.1 : 0.24, drop);
        if (drop && s % 2 === 1) this.hat(tt, 0.06, false);
      } else if (st.hats === 'sixteenth') {
        this.hat(tt, s % 4 === 2 ? 0.26 : 0.08 + h(1) * 0.06, drop && s % 4 === 2);
      } else {
        if (s % 4 === 2) this.hat(tt, 0.22, drop);
        else if (s % 4 === 3 && h(2) < 0.6) this.hat(tt, 0.09, false);
      }
    }

    // BUILD-UP: accelerating snare roll + noise riser
    if (build) {
      const p = (bar - 40 + s / 16) / 8;
      const every = p < 0.5 ? 4 : p < 0.75 ? 2 : 1;
      if (s % every === 0) this.snare(t, 0.1 + 0.4 * p);
      if (bar === 40 && s === 0) this.riser(t, this.barDur * 8);
    }
    if (s === 0 && (bar === 16 || bar === 48 || bar === 64)) this.crash(t);

    const chordDeg = this.prog[Math.floor(bar / 2) % 4];

    // BASS
    const bassOn = sec === 'intro2' || sec === 'groove' || drop || (sec === 'outro' && bar < 92) || (build && bar >= 46);
    if (bassOn) this.playBass(s, tt, chordDeg, drop, h);

    // LEAD — roneat mallet
    const leadOn = (sec === 'groove' && bar >= 20) || brk || drop || (build && bar < 44);
    if (leadOn) {
      const pat = drop && bar >= 64 ? this.leadB : this.lead;
      const deg = pat[(bar % 2) * 16 + s];
      if (deg != null) {
        const v = st.leadVel * (drop ? 1 : brk ? 0.85 : 0.7) * (0.85 + h(3) * 0.3);
        const m = this.note(this.leadRoot, deg + chordDeg);
        this.roneat(tt, m, v);
        if (drop && h(4) < 0.45) this.roneat(tt, m + 12, v * 0.35);
      }
    }

    // PADS
    if (st.pad && (brk || build || drop) && s === 0 && bar % 2 === 0) {
      this.pad(t, [0, 2, 4].map((i) => this.note(this.padRoot, chordDeg + i)), this.barDur * 2, brk ? 0.12 : 0.07);
    }

    // RAVE STABS
    if (st.stabs && drop && this.stabSteps.includes(s)) {
      this.stab(tt, [0, 2, 4].map((i) => this.note(this.padRoot + 12, chordDeg + i)), 0.09);
    }
  }

  playBass(s, t, chordDeg, drop, h) {
    const root = this.note(this.bassRoot, chordDeg);
    switch (this.style.bass) {
      case 'pluck':
        if (s % 4 === 2) this.bassPluck(t, root + (this.bassAlt && s === 14 ? 12 : 0), 0.42);
        else if ((s === 7 || s === 15) && h(5) < 0.35) this.bassPluck(t, root + 12, 0.25);
        break;
      case 'rolling':
        if (s % 4 !== 0) this.bassRoll(t, root + (s % 4 === 3 && h(6) < 0.25 ? 7 : 0), s % 4 === 2 ? 0.4 : 0.28);
        break;
      case 'offbeat':
        if (s % 4 === 2) this.bassRoll(t, root, 0.45, 0.2);
        else if (drop && s % 4 === 3) this.bassRoll(t, root + 12, 0.2, 0.1);
        break;
      case 'sub':
        if (s === 3 || s === 10) this.bassSub(t, root, this.stepDur * 3, 0.5);
        break;
      case 'acid': {
        const a = this.acidPat[s];
        if (a.on) this.bassAcid(t, this.note(this.bassRoot + 12, chordDeg + a.deg) + (a.up ? 12 : 0), a.accent || (drop && s % 4 === 2), a.slide);
        break;
      }
    }
  }

  // ------------------------------------------------------------ instruments

  osc(type, freq, t) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    return o;
  }

  env(t, peak, attack, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  filter(type, freq, q = 0.7) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  send(node, bus, amount) {
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g).connect(bus);
  }

  noise(t, dur) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    n.loop = true;
    n.start(t, Math.random() * 1.5);
    n.stop(t + dur);
    return n;
  }

  kick(t, v) {
    const o = this.osc('sine', this.style.kickHi, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(43, t + 0.32);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.004);
    g.gain.setTargetAtTime(0.0001, t + 0.09, 0.09);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.6);
    const n = this.noise(t, 0.02);
    n.connect(this.filter('highpass', 3000)).connect(this.env(t, v * 0.16, 0.001, 0.015)).connect(this.drums);
    const d = this.duck.gain;
    d.setValueAtTime(0.28, t);
    d.setTargetAtTime(1, t + 0.02, 0.075);
  }

  clap(t, v) {
    const n = this.noise(t, 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 3; i++) {
      const ti = t + i * 0.012;
      g.gain.setValueAtTime(v, ti);
      g.gain.exponentialRampToValueAtTime(v * 0.25, ti + 0.01);
    }
    g.gain.setValueAtTime(v * 0.8, t + 0.036);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(this.filter('bandpass', 1500, 1.1)).connect(g).connect(this.drums);
    this.send(g, this.reverbSend, 0.25);
  }

  hat(t, v, open) {
    const dur = open ? 0.26 : 0.05;
    const n = this.noise(t, dur + 0.02);
    n.connect(this.filter('highpass', 7200)).connect(this.env(t, v, 0.001, dur)).connect(this.drums);
  }

  snare(t, v) {
    const n = this.noise(t, 0.2);
    const g = this.env(t, v, 0.001, 0.12);
    n.connect(this.filter('bandpass', 1900, 0.8)).connect(g).connect(this.drums);
    this.send(g, this.reverbSend, 0.2);
    const o = this.osc('triangle', 185, t);
    o.connect(this.env(t, v * 0.6, 0.001, 0.07)).connect(this.drums);
    o.start(t);
    o.stop(t + 0.12);
  }

  crash(t) {
    const n = this.noise(t, 2.2);
    const g = this.env(t, 0.3, 0.002, 1.9);
    n.connect(this.filter('highpass', 4500)).connect(g).connect(this.drums);
    this.send(g, this.reverbSend, 0.3);
  }

  riser(t, dur) {
    const n = this.noise(t, dur + 0.05);
    const bp = this.filter('bandpass', 300, 3);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.26, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    n.connect(bp).connect(g).connect(this.out);
    this.send(g, this.reverbSend, 0.3);
  }

  bassPluck(t, midi, v) {
    const f = mtof(midi);
    const lp = this.filter('lowpass', 1800, 5);
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.16);
    const g = this.env(t, v, 0.004, 0.22);
    const a = this.osc('sawtooth', f, t);
    const b = this.osc('sine', f, t);
    a.connect(lp);
    b.connect(lp);
    lp.connect(g).connect(this.musicIn);
    a.start(t);
    b.start(t);
    a.stop(t + 0.3);
    b.stop(t + 0.3);
  }

  bassRoll(t, midi, v, len = 0.13) {
    const f = mtof(midi);
    const lp = this.filter('lowpass', 1300, 7);
    lp.frequency.setValueAtTime(1300, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + len);
    const a = this.osc('sawtooth', f, t);
    a.connect(lp).connect(this.env(t, v, 0.003, len)).connect(this.musicIn);
    const b = this.osc('sine', f, t);
    b.connect(this.env(t, v * 0.5, 0.003, len)).connect(this.musicIn);
    a.start(t);
    b.start(t);
    a.stop(t + len + 0.05);
    b.stop(t + len + 0.05);
  }

  bassSub(t, midi, dur, v) {
    const f = mtof(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.setValueAtTime(v, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    const a = this.osc('sine', f, t);
    const b = this.osc('triangle', f * 2, t);
    const bg = this.ctx.createGain();
    bg.gain.value = 0.15;
    a.connect(g);
    b.connect(bg).connect(g);
    g.connect(this.musicIn);
    a.start(t);
    b.start(t);
    a.stop(t + dur + 0.15);
    b.stop(t + dur + 0.15);
  }

  bassAcid(t, midi, accent, slide) {
    const f = mtof(midi);
    const o = this.osc('sawtooth', slide && this.lastAcidF ? this.lastAcidF : f, t);
    if (slide && this.lastAcidF) o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    this.lastAcidF = f;
    const lp = this.filter('lowpass', 2000, 14);
    lp.frequency.setValueAtTime(accent ? 3400 : 1900, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + (accent ? 0.22 : 0.14));
    const g = this.env(t, accent ? 0.3 : 0.2, 0.003, slide ? 0.2 : 0.14);
    o.connect(lp).connect(g).connect(this.musicIn);
    this.send(g, this.delaySend, 0.15);
    o.start(t);
    o.stop(t + 0.3);
  }

  roneat(t, midi, v) {
    while (midi > 98) midi -= 12;
    const f = mtof(midi);
    const body = this.osc('sine', f, t);
    const wood = this.osc('sine', f * 3.93, t);
    const oct = this.osc('triangle', f * 2, t);
    const g1 = this.env(t, v, 0.002, 0.42);
    body.connect(g1).connect(this.musicIn);
    wood.connect(this.env(t, v * 0.3, 0.001, 0.08)).connect(this.musicIn);
    oct.connect(this.env(t, v * 0.18, 0.002, 0.2)).connect(this.musicIn);
    this.send(g1, this.delaySend, 0.35);
    this.send(g1, this.reverbSend, 0.25);
    for (const o of [body, wood, oct]) {
      o.start(t);
      o.stop(t + 0.5);
    }
  }

  pad(t, midis, dur, v) {
    const lp = this.filter('lowpass', 1400, 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.7);
    g.gain.setValueAtTime(v, t + dur - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    for (const m of midis) {
      for (const det of [-8, 8]) {
        const o = this.osc('sawtooth', mtof(m), t);
        o.detune.setValueAtTime(det, t);
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.7);
      }
    }
    lp.connect(g).connect(this.musicIn);
    this.send(g, this.reverbSend, 0.5);
  }

  stab(t, midis, v) {
    const lp = this.filter('lowpass', 2800, 2);
    lp.frequency.setValueAtTime(2800, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + 0.2);
    const g = this.env(t, v, 0.003, 0.2);
    for (const m of midis) {
      const o = this.osc('sawtooth', mtof(m), t);
      o.detune.setValueAtTime(m % 2 ? 6 : -6, t);
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.3);
    }
    lp.connect(g).connect(this.musicIn);
    this.send(g, this.delaySend, 0.25);
    this.send(g, this.reverbSend, 0.2);
  }
}
