// Frame-rate governor for weak GPUs (low-end phones, integrated graphics).
//
// 1. Dynamic resolution: the render scale drifts down while FPS < 50 and back up while
//    the device has headroom (scale changes are rate-limited — they reallocate buffers).
// 2. Feature tiers: if FPS stays under 30 the governor sheds work in steps —
//    bloom/post-processing off, then heavy particles cut and avatar LOD ranges shortened.
// 3. Recovery: after a long stretch of smooth frames a tier is restored; each recovery
//    doubles the wait so the scene doesn't flap between states.

import { Emitter } from '../core/events.js';

export const TIERS = [
  { name: 'full', bloom: true, particles: 1, lod: 1 },
  { name: 'no post-fx', bloom: false, particles: 1, lod: 0.8 },
  { name: 'lite', bloom: false, particles: 0.35, lod: 0.55 },
];

export class PerformanceGovernor extends Emitter {
  constructor({ enabled = true, minScale = 0.5 } = {}) {
    super();
    this.enabled = enabled;
    this.minScale = minScale;
    this.scale = 1;
    this.tier = 0;
    this.fps = 60;
    this.frames = 0;
    this.windowStart = performance.now();
    this.lowFor = 0;
    this.goodFor = 0;
    this.scaleCooldown = 0;
    this.recoverAfter = 15;
  }

  get state() {
    return { fps: this.fps, scale: this.scale, tier: this.tier, tierName: TIERS[this.tier].name };
  }

  reset() {
    this.scale = 1;
    this.tier = 0;
    this.lowFor = 0;
    this.goodFor = 0;
    this.recoverAfter = 15;
    this.emit('change', this.state);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.reset();
  }

  /** Call once per rendered frame with a real-time timestamp (ms). */
  tick(now, hidden) {
    this.frames++;
    const elapsed = (now - this.windowStart) / 1000;
    if (elapsed < 0.5) return;
    this.fps = this.frames / elapsed;
    this.frames = 0;
    this.windowStart = now;
    this.emit('fps', this.fps);
    // Ignore stalls caused by tab switches or the window being hidden.
    if (!this.enabled || hidden || elapsed > 2) return;

    const fps = this.fps;
    this.lowFor = fps < 30 ? this.lowFor + elapsed : 0;
    this.goodFor = fps >= 55 ? this.goodFor + elapsed : 0;
    let changed = false;

    // 1) dynamic resolution
    this.scaleCooldown -= elapsed;
    if (this.scaleCooldown <= 0) {
      let next = this.scale;
      if (fps < 50) next = Math.max(this.minScale, this.scale - (fps < 35 ? 0.15 : 0.08));
      else if (fps > 57 && this.goodFor >= 2) next = Math.min(1, this.scale + 0.05);
      if (Math.abs(next - this.scale) > 0.01) {
        this.scale = next;
        this.scaleCooldown = 1;
        changed = true;
      }
    }

    // 2) shed features when we're stuck below 30 FPS
    if (this.lowFor >= 2.5 && this.tier < TIERS.length - 1) {
      this.tier++;
      this.lowFor = 0;
      changed = true;
      this.emit('degrade', this.state);
    }

    // 3) slowly win them back
    if (this.goodFor >= this.recoverAfter && this.tier > 0) {
      this.tier--;
      this.goodFor = 0;
      this.recoverAfter = Math.min(240, this.recoverAfter * 2);
      changed = true;
    }

    if (changed) this.emit('change', this.state);
  }
}
