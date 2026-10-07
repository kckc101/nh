// AudioWorklet: onset-strength envelope computed on the audio thread.
//
// Emits one value per 10 ms hop of *audio* time (exactly 100 Hz, independent of the
// page's frame rate), so tempo detection stays accurate on slow devices. Each value is the
// positive change in log energy of the low band (kick drum) plus a smaller full-band term.
// Values are posted to the main thread in batches of 10 (every 100 ms).

class OnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hop = Math.round(sampleRate / 100);
    this.a = Math.exp((-2 * Math.PI * 150) / sampleRate); // one-pole low-pass ≈150 Hz
    this.lp1 = 0;
    this.lp2 = 0;
    this.eLow = 0;
    this.eAll = 0;
    this.n = 0;
    this.prevLow = 0;
    this.prevAll = 0;
    this.batch = new Float32Array(10);
    this.count = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (outputs[0]?.[0]) outputs[0][0].fill(0);
    if (!ch) return true;
    const a = this.a;
    const b = 1 - a;
    const ch2 = input[1];
    for (let i = 0; i < ch.length; i++) {
      const x = ch2 ? (ch[i] + ch2[i]) * 0.5 : ch[i];
      this.lp1 = a * this.lp1 + b * x;
      this.lp2 = a * this.lp2 + b * this.lp1;
      this.eLow += this.lp2 * this.lp2;
      this.eAll += x * x;
      if (++this.n >= this.hop) {
        const low = Math.log1p(1000 * (this.eLow / this.n));
        const all = Math.log1p(1000 * (this.eAll / this.n));
        const onset = Math.max(0, low - this.prevLow) + 0.3 * Math.max(0, all - this.prevAll);
        this.prevLow = low;
        this.prevAll = all;
        this.eLow = 0;
        this.eAll = 0;
        this.n = 0;
        this.batch[this.count++] = onset;
        if (this.count === this.batch.length) {
          this.port.postMessage(this.batch.slice());
          this.count = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('onset-detector', OnsetProcessor);
