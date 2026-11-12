// CO₂ cryo jets (CryoJets): a row of nozzles in the photo pit, just behind the crowd barrier in
// front of the stage, that fire white plumes straight up on a cue.
//
// A burst is about a hundred point sprites per jet, shot up fast (26–34 m/s, slowed hard by the
// air), each one short-lived (0.75–1.15 s, under 1.2 s) and swelling as it rises, so every jet
// is a narrow white column that blooms out to ~3 m at the top, about 11 m up, and is gone in a
// second. Patterns: all at once, a chase across the stage, from the middle out, or odd then
// even. They have their own particle pool (the haze and the fire keep theirs) and are drawn
// like the rest of the venue, so the broadcast cameras show them on the LED screens; the pool is
// idle (no per-frame work) between bursts. The performance governor's particle budget thins
// them.
//
// API: burst({ pattern, duration, power, stagger }), update(dt, budget), setScale(pointScale),
// dispose().

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ParticlePool, KIND } from './particles.js';
import { smokeTexture } from './textures.js';

export const CRYO_PATTERNS = ['all', 'chase', 'outward', 'alternate'];
const BARRIER_Z = -20.15; // the crowd barrier is at z -19.6: the jets stand in the pit behind it
const NOZZLE_Y = 1.2;
const RATE = 120; // particles a second, per jet
const POOL = 3000; // two overlapping bursts' worth

const rand = (a, b) => a + Math.random() * (b - a);

export class CryoJets {
  constructor(scene, { count = 10, halfSpan = 26 } = {}) {
    this.count = Math.max(8, Math.min(12, Math.round(count)));
    this.points = Array.from({ length: this.count }, (_, i) => new THREE.Vector3(-halfSpan + (2 * halfSpan * i) / (this.count - 1), NOZZLE_Y, BARRIER_Z));
    this.pool = new ParticlePool(scene, POOL, smokeTexture(), THREE.NormalBlending);
    this.pool.points.renderOrder = 5; // over the beams: the plume is lit white, the lasers behind it
    this.white = new THREE.Color(0.92, 0.95, 1); // the dense base just catches the bloom
    this.jets = []; // { i, at, until, acc, power }
    this.time = 0;

    // The units: a dark box on the floor, a short nozzle, a frosty ring at the tip.
    const dark = new THREE.MeshLambertMaterial({ color: '#17151e' });
    const body = mergeGeometries(this.points.flatMap((p) => [
      new THREE.BoxGeometry(0.46, 0.86, 0.46).translate(p.x, 0.43, p.z),
      new THREE.CylinderGeometry(0.07, 0.12, 0.34, 10).translate(p.x, 1.03, p.z),
    ]).map((g) => (g.index ? g.toNonIndexed() : g)));
    this.tipMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.45, 0.6), toneMapped: false });
    const tips = mergeGeometries(this.points.map((p) => new THREE.TorusGeometry(0.075, 0.018, 6, 16).rotateX(Math.PI / 2).translate(p.x, NOZZLE_Y, p.z)));
    this.meshes = [new THREE.Mesh(body, dark), new THREE.Mesh(tips, this.tipMat)];
    scene.add(...this.meshes);
    this.disposables = [body, tips, dark, this.tipMat];
  }

  /**
   * Fire the jets.
   * @param pattern  'all' | 'chase' (left to right) | 'outward' (middle out) | 'alternate' (odd, then even)
   * @param duration s each jet fires
   * @param power    × the jets' height
   * @param stagger  s between jets in a chase
   */
  burst({ pattern = 'all', duration = 0.85, power = 1, stagger = 0.07 } = {}) {
    const n = this.count;
    const mid = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const delay = pattern === 'chase' ? i * stagger
        : pattern === 'outward' ? Math.floor(Math.abs(i - mid)) * stagger
          : pattern === 'alternate' ? (i % 2) * 0.32
            : 0;
      // A jet already firing just fires longer (two cues at once mustn't double its density).
      const at = this.time + delay;
      const busy = this.jets.find((j) => j.i === i && j.until >= at);
      if (busy) busy.until = Math.max(busy.until, at + duration);
      else this.jets.push({ i, at, until: at + duration, acc: 0, power });
    }
  }

  get active() {
    return this.jets.length > 0 || this.pool.active > 0;
  }

  /** @param budget the particle budget (World.particleScale: 1, less on a weak GPU) */
  update(dt, budget = 1) {
    this.time += dt;
    let firing = 0;
    for (let k = this.jets.length - 1; k >= 0; k--) {
      const j = this.jets[k];
      if (this.time < j.at) continue;
      firing++;
      j.acc += RATE * budget * dt;
      const p = this.points[j.i];
      while (j.acc >= 1) {
        j.acc--;
        this.pool.emit(p.x + rand(-0.04, 0.04), NOZZLE_Y + 0.05, p.z + rand(-0.04, 0.04), rand(-0.5, 0.5), rand(26, 34) * j.power, rand(-0.5, 0.5), {
          color: this.white, life: rand(0.75, 1.15), size: rand(0.3, 0.5), alpha: 0.16, drag: 2.6, grow: 2.8, kind: KIND.SMOKE,
        });
      }
      if (this.time >= j.until) this.jets.splice(k, 1);
    }
    // The tips frost over while they fire.
    this.tipMat.color.setRGB(0.35, 0.45, 0.6).multiplyScalar(firing ? 2.4 : 1);
    this.pool.update(dt);
  }

  setScale(s) {
    this.pool.setScale(s);
  }

  dispose() {
    this.pool.points.removeFromParent();
    this.pool.geo.dispose();
    this.pool.material.uniforms.uMap.value?.dispose();
    this.pool.material.dispose();
    for (const m of this.meshes) m.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
