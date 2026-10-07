// Real-time music analysis on the Web Audio AnalyserNode.
//
// - Peak / RMS levels from the time-domain signal (meters).
// - Kicks: adaptive threshold on the 35–120 Hz band (strobes, floor pulses, speaker cones).
// - Tempo: an onset-strength envelope (spectral flux) resampled to 100 Hz and
//   autocorrelated over a 6 s window, with sub-sample peak interpolation and a tempo prior
//   that avoids half/double-time errors. This replaces fixed BPM values whenever the audio
//   can be analysed — built-in tracks, uploads, MP3 links and CORS-enabled streams.
// - Beat clock: runs at the detected tempo and is phase-locked to detected kicks, so dances
//   stay on the beat through breakdowns. Sources that can't be analysed (YouTube /
//   SoundCloud iframes, streams without CORS) fall back to the track's or DJ's BPM.
//
// Onsets for the tempo come from an AudioWorklet on the audio thread (exact 100 Hz in audio
// time) when available; otherwise from per-frame spectral flux on wall-clock time.

import { Emitter } from '../core/events.js';

class TempoTracker {
  constructor() {
    this.rate = 100; // envelope samples per second
    this.size = 800;
    this.env = new Float32Array(this.size);
    this.work = new Float32Array(600);
    this.ac = new Float32Array(110);
    this.reset();
  }

  reset() {
    this.env.fill(0);
    this.lastSlot = -1;
    this.filled = 0;
    this.bpm = 0;
    this.confidence = 0;
    this.pending = 0;
    this.pendingCount = 0;
    this.nextAnalysis = 0;
    this.sinceAnalysis = 0;
  }

  /** Consecutive 10 ms onset values from the audio thread (no timing jitter). */
  pushBlock(values) {
    for (let i = 0; i < values.length; i++) {
      this.lastSlot++;
      this.env[this.lastSlot % this.size] = values[i];
      this.filled++;
      if (++this.sinceAnalysis >= this.rate) {
        this.sinceAnalysis = 0;
        this.analyse();
      }
    }
  }

  /** Frame-rate fallback: one onset value at wall-clock time t (seconds). */
  push(t, value) {
    const slot = Math.floor(t * this.rate);
    if (this.lastSlot < 0) this.lastSlot = slot - 1;
    if (slot > this.lastSlot) {
      // Frames are slower than the envelope rate: skipped slots carry no onset energy.
      for (let s = Math.max(this.lastSlot + 1, slot - this.size + 1); s < slot; s++) this.env[s % this.size] = 0;
      this.filled += slot - this.lastSlot;
      this.lastSlot = slot;
      this.env[slot % this.size] = value;
    } else {
      this.env[slot % this.size] = Math.max(this.env[slot % this.size], value);
    }
    if (t >= this.nextAnalysis) {
      this.nextAnalysis = t + 1;
      this.analyse();
    }
  }

  analyse() {
    const N = this.work.length;
    if (this.filled < N * 0.7) return; // need ~4 s of history
    const x = this.work;
    let mean = 0;
    const start = this.lastSlot - N + 1;
    for (let i = 0; i < N; i++) {
      const s = start + i;
      x[i] = s >= 0 ? this.env[s % this.size] : 0;
      mean += x[i];
    }
    mean /= N;
    let energy = 0;
    for (let i = 0; i < N; i++) {
      x[i] -= mean;
      energy += x[i] * x[i];
    }
    if (energy < 1e-7) {
      this.confidence *= 0.7;
      return;
    }
    const minLag = Math.floor((this.rate * 60) / 200); // 200 BPM
    const maxLag = Math.ceil((this.rate * 60) / 60); //  60 BPM
    const ac = this.ac;
    for (let L = minLag - 1; L <= maxLag + 1; L++) {
      let s = 0;
      for (let i = L; i < N; i++) s += x[i] * x[i - L];
      ac[L] = s / energy;
    }
    let best = -1;
    let bestScore = -Infinity;
    for (let L = minLag; L <= maxLag; L++) {
      if (ac[L] < ac[L - 1] || ac[L] < ac[L + 1]) continue; // local maxima only
      const bpm = (60 * this.rate) / L;
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 125) / 0.6) ** 2);
      const score = ac[L] * prior;
      if (score > bestScore) {
        bestScore = score;
        best = L;
      }
    }
    if (best < 0) return;
    const a = ac[best - 1];
    const b = ac[best];
    const c = ac[best + 1];
    const denom = a - 2 * b + c;
    const lag = best + (denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0);
    const bpm = (60 * this.rate) / lag;
    const conf = Math.max(0, Math.min(1, b * 1.6));

    // Hysteresis: small drifts are smoothed in, big jumps must repeat before we switch.
    if (this.bpm && Math.abs(bpm - this.bpm) / this.bpm < 0.04) {
      this.bpm += (bpm - this.bpm) * 0.35;
      this.pendingCount = 0;
    } else {
      this.pendingCount = this.pending && Math.abs(bpm - this.pending) / bpm < 0.03 ? this.pendingCount + 1 : 1;
      this.pending = bpm;
      if (!this.bpm || this.pendingCount >= 3) {
        this.bpm = bpm;
        this.pendingCount = 0;
      }
    }
    this.confidence = this.confidence * 0.5 + conf * 0.5;
  }
}

export class BeatDetector extends Emitter {
  constructor() {
    super();
    this.analyser = null;
    this.freq = null;
    this.prevFreq = null;
    this.timeBuf = null;
    this.fft = new Uint8Array(64);
    this.tempo = new TempoTracker();
    this.workletActive = false;
    this.state = {
      bass: 0, mid: 0, high: 0, level: 0,
      peak: 0, rms: 0,
      kick: 0, kickStrength: 0,
      phase: 0, beatCount: 0, bpm: 128, bpmSource: 'manual', confidence: 0,
      energy: 0, playing: false, analysed: false,
      fft: this.fft,
    };
    this.mean = 0.3;
    this.var = 0.01;
    this.prevE = 0;
    this.time = 0;
    this.lastNow = 0;
    this.lastKick = -10;
    this.hintBpm = 0;
    this.fallbackBpm = 128;
    this.misaligned = 0;
    this.minEnergy = 0;
    this.lastSurge = -100;
  }

  attach(analyser, sampleRate) {
    this.analyser = analyser;
    this.freq = new Uint8Array(analyser.frequencyBinCount);
    this.prevFreq = new Uint8Array(analyser.frequencyBinCount);
    this.timeBuf = new Float32Array(analyser.fftSize);
    const binHz = sampleRate / analyser.fftSize;
    const band = (lo, hi) => [Math.max(1, Math.floor(lo / binHz)), Math.max(2, Math.ceil(hi / binHz))];
    this.kickBand = band(35, 120);
    this.bassBand = band(35, 250);
    this.midBand = band(250, 2500);
    this.highBand = band(2500, 12000);
    this.fluxLow = band(35, 160);
    this.fluxMid = band(160, 2500);
    this.logMap = [];
    for (let i = 0; i <= 64; i++) {
      const f = 40 * Math.pow(14000 / 40, i / 64);
      this.logMap.push(Math.min(this.freq.length - 1, Math.max(1, Math.round(f / binHz))));
    }
  }

  /** New track: forget the old tempo. hint = track BPM if known (used until the tracker locks). */
  resetTempo(hintBpm) {
    this.hintBpm = hintBpm || 0;
    this.tempo.reset();
  }

  /** Onset batches from the AudioWorklet (see onset-worklet.js). */
  pushOnsets(values) {
    this.workletActive = true;
    this.tempo.pushBlock(values);
  }

  setFallback(bpm) {
    if (bpm) this.fallbackBpm = bpm;
  }

  avg([a, b]) {
    let s = 0;
    for (let i = a; i < b; i++) s += this.freq[i];
    return s / ((b - a) * 255);
  }

  flux([a, b]) {
    let s = 0;
    for (let i = a; i < b; i++) {
      const d = this.freq[i] - this.prevFreq[i];
      if (d > 0) s += d;
    }
    return s / ((b - a) * 255);
  }

  update(dt, playing, analysable) {
    const now = performance.now() / 1000;
    const rdt = this.lastNow ? Math.min(0.25, now - this.lastNow) : dt;
    this.lastNow = now;
    this.time += rdt;
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

        // Levels from the waveform.
        this.analyser.getFloatTimeDomainData(this.timeBuf);
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < this.timeBuf.length; i++) {
          const v = this.timeBuf[i];
          const a = v < 0 ? -v : v;
          if (a > peak) peak = a;
          sum += v * v;
        }
        S.peak = Math.max(peak, S.peak - rdt * 1.5);
        S.rms = Math.sqrt(sum / this.timeBuf.length);

        // Onset strength → tempo tracker.
        if (!this.workletActive) this.tempo.push(this.time, this.flux(this.fluxLow) + 0.3 * this.flux(this.fluxMid));
        this.prevFreq.set(this.freq);

        // Kick detection.
        const e = this.avg(this.kickBand);
        const k = Math.min(1, rdt * 2.5);
        this.mean += (e - this.mean) * k;
        const d = e - this.mean;
        this.var += (d * d - this.var) * k;
        const threshold = this.mean + Math.max(0.05, Math.sqrt(Math.max(0, this.var)));
        const refractory = Math.max(0.27, (0.55 * 60) / (S.bpm || 128));
        if (e > threshold && e > 0.35 && e - this.prevE > 0.02 && this.time - this.lastKick > refractory) this.onKick(e, false);
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

    // Tempo: live detection when it's confident, else the track's BPM, else the DJ's.
    const tracked = analysed && this.tempo.bpm && this.tempo.confidence > 0.22 ? this.tempo.bpm : 0;
    S.bpm = tracked || this.hintBpm || this.fallbackBpm || 128;
    S.bpmSource = tracked ? 'detected' : this.hintBpm ? 'track' : 'manual';
    S.confidence = this.tempo.confidence;

    if (playing) {
      S.phase += (rdt * S.bpm) / 60;
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
      S.peak *= decay;
      S.rms *= decay;
      for (let i = 0; i < 64; i++) {
        const target = playing ? Math.max(0, 210 * (1 - i / 80) * (0.45 + 0.55 * env) * (0.7 + 0.3 * Math.sin(this.time * 3 + i * 0.7))) : 0;
        this.fft[i] += (target - this.fft[i]) * 0.3;
      }
    }

    S.level = S.bass * 0.5 + S.mid * 0.35 + S.high * 0.15;
    S.kick = Math.max(0, S.kick - rdt * 4.5);
    S.energy += (S.level - S.energy) * Math.min(1, rdt * 0.5);

    // "Surge" = sustained energy jump (a drop) — used for auto FX on non-synth tracks.
    this.minEnergy = Math.min(S.energy, this.minEnergy + rdt * 0.03);
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
