// Procedural house music generator (Web Audio).
// Each preset is rendered deterministically from its seed so every client plays the identical
// arrangement; the server only shares the start timestamp. Three flavours of house:
//   piano — classic piano house: M1-style organ bass, syncopated piano stabs, a piano riff
//           and "ah" vocal chops
//   deep  — deep house: electric-piano 9th chords, warm sub bass, congas, shaker, "oh" chops
//   disco — filter disco house: chord stabs through a slowly sweeping filter, octave bass,
//           tambourine and "ooh" chops
// All three follow the arrangement map below, which the lights and lasers follow too.

import { mulberry32, hash01, pick } from '../core/rng.js';
import { SYNTH_BARS } from '../../shared/dj.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const STYLES = {
  piano: { swing: 0.08, kickHi: 135, chordBars: 1, bass: 'organ', keys: 'piano', perc: 'shaker', vowel: 'ah', riff: true },
  deep: { swing: 0.16, kickHi: 120, chordBars: 2, bass: 'sub', keys: 'rhodes', perc: 'conga', vowel: 'oh', riff: false },
  disco: { swing: 0.05, kickHi: 140, chordBars: 1, bass: 'octave', keys: 'filter', perc: 'tamb', vowel: 'ooh', riff: false },
};

// Chord loops as [semitones above the key, quality]; one chord per `chordBars` bars.
const PROGRESSIONS = {
  piano: [
    [[0, 'maj7'], [9, 'm7'], [5, 'maj7'], [7, 'dom7']],
    [[0, 'm7'], [8, 'maj7'], [10, 'dom7'], [7, 'm7']],
    [[0, 'm9'], [5, 'm9'], [10, 'dom9'], [3, 'maj9']],
  ],
  deep: [
    [[0, 'm9'], [5, 'm9'], [10, 'dom9'], [3, 'maj9']],
    [[0, 'm9'], [7, 'm7'], [8, 'maj9'], [10, 'dom9']],
    [[0, 'm9'], [3, 'maj9'], [8, 'maj9'], [7, 'm7']],
  ],
  disco: [
    [[0, 'm7'], [5, 'dom7'], [10, 'maj7'], [3, 'maj7']],
    [[0, 'dom9'], [5, 'dom9'], [0, 'dom9'], [7, 'dom9']],
    [[0, 'm7'], [10, 'maj7'], [8, 'maj7'], [7, 'dom7']],
  ],
};
const QUALITY = {
  m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], dom7: [0, 4, 7, 10],
  m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], dom9: [0, 4, 7, 10, 14],
};
// Where in the bar the keys hit (16th steps).
const KEYS_RHYTHM = {
  piano: [[0, 3, 6, 10, 12], [2, 5, 8, 11, 14], [0, 3, 7, 10, 14], [2, 6, 9, 12, 14]],
  rhodes: [[0, 6, 10], [2, 7, 12], [0, 3, 10], [3, 6, 11]],
  filter: [[2, 6, 10, 14], [0, 3, 6, 8, 11, 14], [2, 4, 6, 10, 12, 14]],
};
const VOWELS = { ah: [800, 1150, 2900], oh: [450, 800, 2830], ooh: [325, 700, 2530] };

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
    this.style = STYLES[preset.style] || STYLES.piano;
    this.seed = preset.seed;
    this.key = preset.key;
    this.stepDur = 60 / preset.bpm / 4;
    this.barDur = this.stepDur * 16;
    this.totalSteps = SYNTH_BARS * 16;
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
    fb.gain.value = 0.32;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    this.delaySend.connect(delay).connect(damp).connect(fb).connect(delay);
    damp.connect(wet).connect(this.musicFilter);

    this.reverbSend = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const rv = ctx.createGain();
    rv.gain.value = 0.3;
    this.reverbSend.connect(conv).connect(rv).connect(out);

    // Percussion runs through shared filters: one biquad per sound, not one per hit.
    const bus = (type, freq, q) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      f.connect(this.drums);
      return f;
    };
    this.hatOpenBus = bus('highpass', 6500, 0.7);
    this.hatBus = bus('highpass', 8000, 0.7);
    this.shakerBus = bus('bandpass', 6200, 1.4);
    this.tambBus = bus('highpass', 7800, 0.7);
    this.clickBus = bus('bandpass', 2400, 1.2);

    this.nodes = [
      out, this.drums, this.musicIn, this.musicFilter, this.duck, this.delaySend, delay, fb, damp, wet, this.reverbSend, conv, rv,
      this.hatOpenBus, this.hatBus, this.shakerBus, this.tambBus, this.clickBus,
    ];

    // ---- deterministic composition
    const rng = mulberry32(this.seed);
    const st = this.style;
    this.chords = pick(rng, PROGRESSIONS[preset.style] || PROGRESSIONS.piano).map(([off, q]) => this.voice(off, q));
    this.keysA = pick(rng, KEYS_RHYTHM[st.keys]);
    this.keysB = pick(rng, KEYS_RHYTHM[st.keys]);
    this.bassPat = this.makeBass(rng);
    this.riffA = this.makeRiff(rng);
    this.riffB = this.makeRiff(rng);
    this.vocalSteps = pick(rng, [[3, 10], [6, 14], [2, 11], [7, 15]]);
    this.congaPat = Array.from({ length: 16 }, (_, i) => (rng() < (i % 2 ? 0.45 : 0.15) ? (rng() < 0.5 ? 1 : 2) : 0));

    this.timer = null;
    this.nextStep = 0;
    this.t0 = 0;
    this.ended = false;
    this.onSection = null;
    this.onEnded = null;
  }

  /** A closely voiced chord around A3–A4 plus its bass note. */
  voice(off, quality) {
    const root = 57 + this.key + off;
    const notes = [...new Set(QUALITY[quality].map((iv) => {
      let n = root + iv;
      while (n > 70) n -= 12;
      while (n < 55) n += 12;
      return n;
    }))].sort((a, b) => a - b);
    let bass = 33 + ((this.key + off) % 12);
    if (bass > 43) bass -= 12;
    return { notes, bass };
  }

  makeBass(rng) {
    switch (this.style.bass) {
      case 'organ': {
        // Offbeat organ bass with syncopated pushes.
        const pat = [2, 6, 10, 14].map((s) => ({ s, oct: false, len: 1.6 }));
        for (const s of [3, 7, 11, 13, 15]) if (rng() < 0.35) pat.push({ s, oct: rng() < 0.5, len: 0.9 });
        return pat;
      }
      case 'sub':
        return pick(rng, [
          [{ s: 0, len: 3 }, { s: 7, len: 2 }, { s: 10, len: 4 }],
          [{ s: 2, len: 2 }, { s: 6, len: 3 }, { s: 11, len: 3 }],
          [{ s: 0, len: 2 }, { s: 3, len: 2 }, { s: 10, len: 3 }, { s: 14, len: 1 }],
        ]);
      default: {
        // Disco octaves on the eighths, with an occasional ghost note.
        const pat = [];
        for (let s = 0; s < 16; s += 2) pat.push({ s, oct: s % 4 === 2, len: 0.9 });
        if (rng() < 0.6) pat.push({ s: 15, oct: true, len: 0.5 });
        return pat;
      }
    }
  }

  /** Two-bar right-hand piano riff: indexes into the current chord, an octave above it. */
  makeRiff(rng) {
    const pat = new Array(32).fill(null);
    for (let i = 0; i < 16; i++) {
      const p = i % 4 === 0 ? 0.55 : i % 4 === 3 ? 0.5 : i % 2 === 0 ? 0.4 : 0.15;
      if (rng() < p) pat[i] = Math.floor(rng() * 5);
    }
    for (let i = 0; i < 12; i++) pat[16 + i] = pat[i];
    for (let i = 12; i < 16; i++) if (rng() < 0.5) pat[16 + i] = Math.floor(rng() * 5);
    return pat;
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
    // Notes go to the audio thread this far ahead: enough to ride out a long frame (a shader
    // compiling, a big scene change) on the main thread without a gap in the music.
    const horizon = this.ctx.currentTime + (document.hidden ? 1.5 : 0.35);
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
      f.setTargetAtTime(2200, t, 0.6);
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
    const chord = this.chords[Math.floor(bar / st.chordBars) % this.chords.length];

    // KICK — four to the floor
    let kick = !brk && !build && s % 4 === 0;
    if (build && bar >= 44 && s % 4 === 0) kick = true;
    if (build && bar === 47 && s >= 8) kick = s % 2 === 0;
    if (drop && bar === 79 && s >= 12) kick = false;
    if (kick) this.kick(t, drop ? 1 : 0.9);

    // CLAP on 2 and 4
    if (!intro && !brk && !(build && bar < 46) && (s === 4 || s === 12)) this.clap(t, drop ? 0.48 : 0.4);

    // HATS: the open offbeat "tss", closed sixteenths in the drop
    if ((!build || bar >= 44) && !(intro && bar < 4)) {
      if (s % 4 === 2) this.hat(tt, brk ? 0.08 : 0.2, !brk);
      else if ((drop || sec === 'groove') && s % 2 === 1) this.hat(tt, 0.05 + h(1) * 0.03, false);
    }

    // PERCUSSION
    const percOn = !intro || bar >= 4;
    if (percOn && !build) {
      if (st.perc === 'shaker') {
        this.shaker(tt, (s % 2 ? 0.05 : 0.08) * (brk ? 0.6 : 1));
      } else if (st.perc === 'conga') {
        const c = this.congaPat[s];
        if (c && !brk) this.conga(tt, c === 1, 0.22);
        if (s % 2 === 1) this.shaker(tt, 0.04);
      } else if (!brk && (s === 4 || s === 12 || (drop && s % 2 === 1 && h(2) < 0.4))) {
        this.tamb(tt, s % 4 === 0 ? 0.16 : 0.07);
      }
    }

    // BUILD-UP: accelerating snare roll + noise riser
    if (build) {
      const p = (bar - 40 + s / 16) / 8;
      const every = p < 0.5 ? 4 : p < 0.75 ? 2 : 1;
      if (s % every === 0) this.snare(t, 0.1 + 0.36 * p);
      if (bar === 40 && s === 0) this.riser(t, this.barDur * 8);
    }
    if (s === 0 && (bar === 16 || bar === 48 || bar === 64)) this.crash(t);

    // BASS
    const bassOn = sec === 'intro2' || sec === 'groove' || drop || (sec === 'outro' && bar < 92) || (build && bar >= 46);
    if (bassOn) {
      for (const n of this.bassPat) {
        if (n.s !== s) continue;
        const midi = chord.bass + (n.oct ? 12 : 0);
        const len = n.len * this.stepDur;
        if (st.bass === 'organ') this.organBass(tt, midi, len, 0.32);
        else if (st.bass === 'sub') this.subBass(tt, midi, len, 0.42);
        else this.discoBass(tt, midi, n.oct ? 0.26 : 0.34);
      }
    }

    // KEYS
    const keysOn = (sec === 'groove' && bar >= 16) || brk || drop || (build && bar < 46);
    if (keysOn) {
      const rhythm = drop && bar >= 64 ? this.keysB : this.keysA;
      if (brk) {
        // Breakdown: the chord just once per bar, ringing out.
        if (s === 0) this.keys(t, chord.notes, 1.35, this.barDur * 0.9);
      } else if (rhythm.includes(s)) {
        const accent = s === rhythm[0] ? 1 : 0.8 + h(3) * 0.15;
        this.keys(tt, chord.notes, (drop ? 1 : 0.8) * accent, this.stepDur * (st.keys === 'rhodes' ? 2.5 : 1.4), bar);
      }
    }

    // PIANO RIFF (piano house): over the breakdown and the second half of the drop
    if (st.riff && (brk || (drop && bar >= 56))) {
      const pat = drop && bar >= 64 ? this.riffB : this.riffA;
      const idx = pat[(bar % 2) * 16 + s];
      if (idx != null) {
        const m = chord.notes[idx % chord.notes.length] + 12 + (idx >= chord.notes.length ? 12 : 0);
        this.piano(tt, [m], 0.5 * (0.85 + h(4) * 0.3), 0.6);
      }
    }

    // PAD under the breakdown and build
    if ((brk || build) && s === 0 && bar % 2 === 0) this.pad(t, chord.notes, this.barDur * 2, brk ? 0.13 : 0.06);

    // VOCAL CHOPS
    const vocalOn = drop || brk || (sec === 'groove' && bar >= 24);
    if (vocalOn && this.vocalSteps.includes(s) && (drop || bar % 2 === 1)) {
      const note = h(5) < 0.55 ? chord.notes[chord.notes.length - 1] : chord.notes[Math.floor(h(6) * chord.notes.length)];
      const len = brk ? this.stepDur * 6 : this.stepDur * (s === this.vocalSteps[0] ? 1.5 : 2.5);
      this.vocal(tt, note + 12, st.vowel, len, brk ? 0.2 : 0.13);
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

  /** Attack, hold for `len`, then release. */
  gate(t, peak, attack, len, release) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + Math.max(attack, len));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, len) + release);
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
    o.frequency.exponentialRampToValueAtTime(52, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.004);
    g.gain.setTargetAtTime(0.0001, t + 0.11, 0.1);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.7);
    const n = this.noise(t, 0.02);
    n.connect(this.filter('highpass', 2500)).connect(this.env(t, v * 0.12, 0.001, 0.015)).connect(this.drums);
    // Sidechain pump: everything melodic ducks under the kick.
    const d = this.duck.gain;
    d.setValueAtTime(0.3, t);
    d.setTargetAtTime(1, t + 0.03, 0.09);
  }

  clap(t, v) {
    const n = this.noise(t, 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 3; i++) {
      const ti = t + i * 0.011;
      g.gain.setValueAtTime(v, ti);
      g.gain.exponentialRampToValueAtTime(v * 0.25, ti + 0.01);
    }
    g.gain.setValueAtTime(v * 0.8, t + 0.033);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    n.connect(this.filter('bandpass', 1300, 1.0)).connect(g).connect(this.drums);
    this.send(g, this.reverbSend, 0.3);
  }

  hat(t, v, open) {
    const dur = open ? 0.16 : 0.04;
    const n = this.noise(t, dur + 0.02);
    n.connect(this.env(t, v, 0.001, dur)).connect(open ? this.hatOpenBus : this.hatBus);
  }

  shaker(t, v) {
    const n = this.noise(t, 0.08);
    n.connect(this.env(t, v, 0.006, 0.05)).connect(this.shakerBus);
  }

  conga(t, high, v) {
    const f = high ? 340 : 230;
    const o = this.osc('sine', f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.86, t + 0.09);
    o.connect(this.env(t, v, 0.002, 0.2)).connect(this.drums);
    o.start(t);
    o.stop(t + 0.25);
    const n = this.noise(t, 0.02);
    n.connect(this.env(t, v * 0.25, 0.001, 0.015)).connect(this.clickBus);
  }

  tamb(t, v) {
    for (const dt of [0, 0.018]) {
      const n = this.noise(t + dt, 0.14);
      n.connect(this.env(t + dt, v, 0.001, 0.11)).connect(this.tambBus);
    }
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
    const g = this.env(t, 0.24, 0.002, 1.9);
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
    g.gain.exponentialRampToValueAtTime(0.22, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    n.connect(bp).connect(g).connect(this.out);
    this.send(g, this.reverbSend, 0.3);
  }

  /** M1-style organ bass: a sine body with a soft triangle on top for the organ "bark". */
  organBass(t, midi, len, v) {
    const f = mtof(midi);
    const g = this.gate(t, v, 0.006, len, 0.06);
    const a = this.osc('triangle', f, t);
    const b = this.osc('sine', f, t);
    const ag = this.ctx.createGain();
    ag.gain.value = 0.55;
    a.connect(ag).connect(g);
    b.connect(g);
    g.connect(this.musicIn);
    for (const o of [a, b]) {
      o.start(t);
      o.stop(t + len + 0.12);
    }
  }

  subBass(t, midi, len, v) {
    const f = mtof(midi);
    const g = this.gate(t, v, 0.012, len, 0.1);
    const a = this.osc('sine', f, t);
    const b = this.osc('triangle', f * 2, t);
    const bg = this.ctx.createGain();
    bg.gain.value = 0.12;
    a.connect(g);
    b.connect(bg).connect(g);
    g.connect(this.musicIn);
    for (const o of [a, b]) {
      o.start(t);
      o.stop(t + len + 0.15);
    }
  }

  discoBass(t, midi, v) {
    const f = mtof(midi);
    const lp = this.filter('lowpass', 1600, 4);
    lp.frequency.setValueAtTime(1600, t);
    lp.frequency.exponentialRampToValueAtTime(260, t + 0.14);
    const g = this.env(t, v * 1.2, 0.004, 0.18);
    const a = this.osc('sawtooth', f, t);
    a.connect(lp).connect(g).connect(this.musicIn);
    a.start(t);
    a.stop(t + 0.26);
  }

  /** The style's chord instrument. */
  keys(t, midis, v, len, bar = 0) {
    if (this.style.keys === 'rhodes') this.rhodes(t, midis, v * 0.9, len);
    else if (this.style.keys === 'filter') this.filterChord(t, midis, v, bar);
    else this.piano(t, midis, v * 0.85, len);
  }

  /** House piano: bright, percussive attack that decays quickly. */
  piano(t, midis, v, len = 0.4) {
    const g = this.ctx.createGain();
    g.gain.value = 1;
    const lp = this.filter('lowpass', 5200, 0.6);
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(1700, t + 0.35);
    lp.connect(g).connect(this.musicIn);
    this.send(g, this.reverbSend, 0.22);
    this.send(g, this.delaySend, 0.1);
    const per = (0.075 * v) / Math.sqrt(midis.length);
    const decay = Math.max(0.35, len + 0.25);
    for (const m of midis) {
      const f = mtof(m);
      const body = this.osc('triangle', f, t);
      const hammer = this.osc('sawtooth', f, t);
      hammer.detune.setValueAtTime(4, t);
      body.connect(this.env(t, per * 1.1, 0.002, decay)).connect(lp);
      hammer.connect(this.env(t, per * 0.55, 0.001, 0.1)).connect(lp);
      body.start(t);
      body.stop(t + decay + 0.05);
      hammer.start(t);
      hammer.stop(t + 0.15);
    }
  }

  /** Electric piano: soft sine body with a short bell-like "tine". */
  rhodes(t, midis, v, len) {
    const g = this.ctx.createGain();
    g.gain.value = 1;
    g.connect(this.musicIn);
    this.send(g, this.reverbSend, 0.35);
    this.send(g, this.delaySend, 0.18);
    const per = (0.09 * v) / Math.sqrt(midis.length);
    for (const m of midis) {
      const f = mtof(m);
      const body = this.osc('sine', f, t);
      body.detune.setValueAtTime((m % 3) * 4 - 4, t);
      const tine = this.osc('sine', f * 7.02, t);
      body.connect(this.gate(t, per * 1.2, 0.006, len, 0.45)).connect(g);
      tine.connect(this.env(t, per * 0.18, 0.001, 0.06)).connect(g);
      body.start(t);
      body.stop(t + len + 0.5);
      tine.start(t);
      tine.stop(t + 0.1);
    }
  }

  /** Disco chord stab through a filter that sweeps open and shut over eight bars. */
  filterChord(t, midis, v, bar) {
    const sweep = 0.5 - 0.5 * Math.cos((Math.PI * 2 * (bar % 8)) / 8);
    const cutoff = 500 + 3800 * sweep;
    const lp = this.filter('lowpass', cutoff, 4);
    const g = this.env(t, (0.15 * v) / Math.sqrt(midis.length), 0.004, 0.22);
    midis.forEach((m, i) => {
      const o = this.osc('sawtooth', mtof(m), t);
      o.detune.setValueAtTime(i % 2 ? 7 : -7, t);
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.3);
    });
    lp.connect(g).connect(this.musicIn);
    this.send(g, this.delaySend, 0.2);
    this.send(g, this.reverbSend, 0.15);
  }

  pad(t, midis, dur, v) {
    const lp = this.filter('lowpass', 1300, 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.8);
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

  /** Vocal chop: a buzzy source through vowel formant filters, with a little vibrato. */
  vocal(t, midi, vowel, len, v) {
    while (midi > 81) midi -= 12;
    while (midi < 62) midi += 12;
    const f = mtof(midi);
    const src = this.osc('sawtooth', f, t);
    const lfo = this.osc('sine', 5.2, t);
    const depth = this.ctx.createGain();
    depth.gain.value = f * 0.012;
    lfo.connect(depth).connect(src.frequency);
    const g = this.gate(t, v, 0.025, len, 0.14);
    [1, 0.6].forEach((amt, i) => {
      const bp = this.filter('bandpass', VOWELS[vowel][i], 10);
      const a = this.ctx.createGain();
      a.gain.value = amt * 2.2;
      src.connect(bp).connect(a).connect(g);
    });
    g.connect(this.musicIn);
    this.send(g, this.reverbSend, 0.4);
    this.send(g, this.delaySend, 0.25);
    for (const o of [src, lfo]) {
      o.start(t);
      o.stop(t + len + 0.2);
    }
  }
}
