// Real-time kick detection + phase-locked beat clock.
//
// - Kicks: adaptive threshold on the 35–120 Hz band of the AnalyserNode (drives strobes,
//   floor pulses, speaker cones).
// - Beat clock: runs at the known/estimated BPM and is nudged toward detected kicks, so
//   dance animations stay on the beat even through breakdowns with no kick drum.
// - Sources that can't be analysed (YouTube/SoundCloud embeds, streams without CORS) fall
//   back to a synthetic spectrum driven by the clock.

import { Emitter } from '../core/events.js';

export class BeatDetector extends Emitter {
  constructor() {
    super();
    this.analyser = null;
    this.freq = null;
    this.fft = new Uint8Array(64);
    this.state = {
      bass: 0, mid: 0, high: 0, level: 0,
      kick: 0, kickStrength: 0,
      phase: 0, beatCount: 0, bpm: 128,
      energy: 0, playing: false, analysed: false,
      fft: this.fft,
    };
    this.mean = 0.3;
    this.var = 0.01;
    this.prevE = 0;
    this.time = 0;
    this.lastKick = -10;
    this.intervals = [];
    this.estBpm = 0;
    this.hintBpm = 0;
    this.fallbackBpm = 128;
    this.misaligned = 0;
    this.minEnergy = 0;
    this.lastSurge = -100;
  }

  attach(analyser, sampleRate) {
    this.analyser = analyser;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    const binHz = sampleRate / analyser.fftSize;
    const band = (lo, hi) => [Math.max(1, Math.floor(lo / binHz)), Math.max(2, Math.ceil(hi / binHz))];
    this.kickBand = band(35, 120);
    this.bassBand = band(35, 250);
    this.midBand = band(250, 2500);
    this.highBand = band(2500, 12000);
    this.logMap = [];
    for (let i = 0; i <= 64; i++) {
      const f = 40 * Math.pow(14000 / 40, i / 64);
      this.logMap.push(Math.min(this.freq.length - 1, Math.max(1, Math.round(f / binHz))));
    }
  }

  setTempo(hintBpm, fallbackBpm) {
    if (hintBpm !== undefined && hintBpm !== this.hintBpm) {
      this.hintBpm = hintBpm || 0;
      this.intervals.length = 0;
      this.estBpm = 0;
    }
    if (fallbackBpm) this.fallbackBpm = fallbackBpm;
  }

  avg([a, b]) {
    let s = 0;
    for (let i = a; i < b; i++) s += this.freq[i];
    return s / ((b - a) * 255);
  }

  update(dt, playing, analysable) {
    this.time += dt;
    const S = this.state;
    S.playing = playing;
    let analysed = false;

    if (playing && analysable && this.analyser) {
      this.analyser.getByteFrequencyData(this.freq);
      const bass = this.avg(this.bassBand);
      const mid = this.avg(this.midBand);
      const high = this.avg(this.highBand);
      analysed = bass + mid + high > 0.002;
      if (analysed) {
        S.bass = bass;
        S.mid = mid;
        S.high = high;
        const e = this.avg(this.kickBand);
        const k = Math.min(1, dt * 2.5);
        this.mean += (e - this.mean) * k;
        const d = e - this.mean;
        this.var += (d * d - this.var) * k;
        const threshold = this.mean + Math.max(0.05, Math.sqrt(this.var));
        if (e > threshold && e > 0.35 && e - this.prevE > 0.02 && this.time - this.lastKick > 0.27) this.onKick(e, false);
        this.prevE = e;
        for (let i = 0; i < 64; i++) {
          let m = 0;
          const end = Math.max(this.logMap[i], this.logMap[i + 1] - 1);
          for (let j = this.logMap[i]; j <= end; j++) if (this.freq[j] > m) m = this.freq[j];
          this.fft[i] = m;
        }
      }
    }
    S.analysed = analysed;

    // Beat clock
    const bpm = this.hintBpm || (analysed && this.estBpm) || this.fallbackBpm || 128;
    S.bpm = bpm;
    if (playing) {
      S.phase += (dt * bpm) / 60;
      if (S.phase >= 1) {
        S.phase -= Math.floor(S.phase);
        S.beatCount++;
        this.emit('beat', S.beatCount);
        if (!analysed) this.onKick(0.8, true);
      }
    }

    if (!analysed) {
      const env = playing ? Math.pow(1 - S.phase, 3) : 0;
      const decay = 0.95;
      S.bass = playing ? 0.3 + 0.5 * env : S.bass * decay;
      S.mid = playing ? 0.35 + 0.1 * Math.sin(this.time * 2.1) : S.mid * decay;
      S.high = playing ? 0.25 + 0.1 * Math.sin(this.time * 3.7) : S.high * decay;
      for (let i = 0; i < 64; i++) {
        const target = playing ? Math.max(0, 210 * (1 - i / 80) * (0.45 + 0.55 * env) * (0.7 + 0.3 * Math.sin(this.time * 3 + i * 0.7))) : 0;
        this.fft[i] += (target - this.fft[i]) * 0.3;
      }
    }

    S.level = S.bass * 0.5 + S.mid * 0.35 + S.high * 0.15;
    S.kick = Math.max(0, S.kick - dt * 4.5);
    S.energy += (S.level - S.energy) * Math.min(1, dt * 0.5);

    // "Surge" = sustained energy jump (a drop) — used for auto FX on non-synth tracks.
    this.minEnergy = Math.min(S.energy, this.minEnergy + dt * 0.03);
    if (S.energy - this.minEnergy > 0.18 && this.time - this.lastSurge > 25) {
      this.lastSurge = this.time;
      this.minEnergy = S.energy;
      this.emit('surge');
    }
    return S;
  }

  onKick(strength, synthetic) {
    const S = this.state;
    if (!synthetic) {
      const iv = this.time - this.lastKick;
      if (iv > 0.3 && iv < 1.0) {
        this.intervals.push(iv);
        if (this.intervals.length > 24) this.intervals.shift();
        if (this.intervals.length >= 6) {
          const sorted = [...this.intervals].sort((a, b) => a - b);
          let bpm = 60 / sorted[sorted.length >> 1];
          while (bpm < 90) bpm *= 2;
          while (bpm > 180) bpm /= 2;
          this.estBpm = this.estBpm ? this.estBpm + (bpm - this.estBpm) * 0.3 : bpm;
        }
      }
      // Phase-lock: only trust kicks near where the clock expects a beat (ignores off-beat bass).
      const err = S.phase > 0.5 ? S.phase - 1 : S.phase;
      if (Math.abs(err) < 0.22) {
        S.phase -= err * 0.35;
        this.misaligned = 0;
      } else if (++this.misaligned >= 6) {
        S.phase = 0;
        this.misaligned = 0;
      }
    }
    this.lastKick = this.time;
    S.kick = 1;
    S.kickStrength = strength;
    this.emit('kick', strength);
  }
}
