// Moving-head beam fixtures: 10 on the front truss sweeping the crowd, 8 on the pitch-side
// towers that only open up for the drop, 6 "sky" beams behind the booth, and 8 long-throw heads
// on top of the twin 99 m pylons sweeping inward across the crowd from both ends.
// Narrow beams, kept low: an exclusive night is mostly darkness cut by a few shafts of light.
// Patterns, colours and intensity come from the FX director's mood; floor hit points are
// reported back so the dance floor can draw light pools.
//
// All 32 heads are drawn as instances: one draw for the housings, one for the lenses and one
// per beam length — 5 in all, instead of three meshes (and a material each) per head. A head's
// `pivot` is a plain Object3D, never added to the scene: its matrix places that head's instances.

import * as THREE from 'three';
import { beamMaterial, MAX_SPOTS } from './shaders.js';
import { CENTER_Z, PYLON, DANCE_FLOOR } from './venue.js';
import { SIDE_TOWER_X, SIDE_TOWER_TOP } from './environment.js';
import { STAGE, wallZAt } from './stage.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const VIP_WARM = new THREE.Color('#ffd9a0');
const _aim = new THREE.Vector3();
const _col = new THREE.Color();
const _tint = new THREE.Color();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const INTENSITY = { sky: 0.22, side: 0.24, pylon: 0.34, front: 0.3 }; // each kind's beam brightness
const _hsl = { h: 0, s: 0, l: 0 };
const WHITE = new THREE.Color(1, 1, 1);
const PIN = new THREE.Vector3(0, 2, 4); // the drop's pinpoint: every head converges just over the dance floor
const BOOTH_Z = -29.8;
const frac = (x) => x - Math.floor(x);
const tri = (x) => Math.abs(frac(x) * 2 - 1) * 2 - 1; // triangle wave, -1…1
const pulse = (x) => Math.max(0, 1 - x * 4); // a sharp flash that dies in a quarter of its step

/**
 * Strobe choreography: how hard head `f` is hit (0–1) by pattern `sp` at this moment of the beat.
 *   chase   one flash running to and fro along the whole rig, west to east and back
 *   wave    a ring of flashes spreading out from the DJ booth to the pylons and the perimeter
 *   split   even and odd heads trading hits on every half-beat
 *   stutter every head at once, in the last beat of each bar
 */
function strobeHit(sp, f, M) {
  const bt = M.beatCount + M.phase;
  switch (sp) {
    case 'chase': {
      const u = (f.pivot.position.x + 36) / 72;
      return Math.max(0, 1 - Math.abs(u - (tri(bt * 0.25) * 0.5 + 0.5)) * 9);
    }
    case 'wave': {
      const d = Math.hypot(f.pivot.position.x, f.pivot.position.z - BOOTH_Z);
      return Math.max(0, 1 - Math.abs(d - frac(bt * 0.25) * 170) / 9);
    }
    case 'split':
      return (f.k & 1) === (Math.floor(bt * 2) & 1) ? pulse(frac(bt * 2)) : 0;
    case 'stutter':
      return (M.beatCount & 3) === 3 && frac(bt * 8) < 0.5 ? 1 : 0;
    default:
      return 0;
  }
}
function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

export class StageLights {
  constructor(scene) {
    this.fixtures = [];
    const shortGeo = new THREE.CylinderGeometry(0.08, 1.4, 32, 18, 1, true).translate(0, -16, 0);
    const longGeo = new THREE.CylinderGeometry(0.1, 2.6, 90, 18, 1, true).translate(0, -45, 0);
    const pylonGeo = new THREE.CylinderGeometry(0.25, 6.5, 240, 18, 1, true).translate(0, -120, 0);
    const headGeo = new THREE.BoxGeometry(0.55, 0.5, 0.55).translate(0, 0.1, 0);
    const lensGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12).translate(0, -0.18, 0);
    const headMat = new THREE.MeshLambertMaterial({ color: '#202028' });

    const make = (x, y, z, kind) => {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, y, z);
      pivot.rotation.order = 'YXZ';
      const geo = kind === 'pylon' ? pylonGeo : kind === 'sky' ? longGeo : shortGeo;
      const list = this[kind] || (this[kind] = []);
      const f = { pivot, geo, beamScale: 1, kind, k: list.length, color: new THREE.Color(), dir: new THREE.Vector3(), intensity: 0 };
      list.push(f);
      this.fixtures.push(f);
      return f;
    };
    for (let i = 0; i < 10; i++) make(-22 + i * (44 / 9), STAGE.truss.h - 0.7, -23, 'front');
    for (const x of [-20, -12, -4, 4, 12, 20]) make(x, 2.9, wallZAt(x) + 1.6, 'sky'); // in front of the curved wall
    // Side towers: heads on top of the pitch-side truss towers, aimed in across the crowd.
    for (const z of [-6, 8, 22, 36]) for (const x of [-SIDE_TOWER_X, SIDE_TOWER_X]) make(x, SIDE_TOWER_TOP + 0.3, z, 'side');
    // Pylon tops: four heads on each pylon's inner face, just under the tip.
    for (const e of [1, -1]) {
      for (const x of [-4.5, -1.5, 1.5, 4.5]) make(x, PYLON.height - 9, CENTER_Z + e * (PYLON.tipDZ - 7), 'pylon');
    }

    // The instanced parts. Their matrices and colours change every frame (the heads sweep).
    const n = this.fixtures.length;
    this.heads = new THREE.InstancedMesh(headGeo, headMat, n);
    this.lenses = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: '#ffffff' }), n);
    this.beams = [shortGeo, longGeo, pylonGeo].map((geo) => {
      const list = this.fixtures.filter((f) => f.geo === geo);
      const mesh = new THREE.InstancedMesh(geo, beamMaterial('#ffffff', 1, 0, 1), list.length);
      mesh.renderOrder = 2;
      list.forEach((f, j) => {
        f.beamMesh = mesh;
        f.beamIndex = j;
        mesh.setColorAt(j, _tint.setRGB(0, 0, 0));
      });
      return mesh;
    });
    this.fixtures.forEach((f, i) => this.lenses.setColorAt(i, _tint.setRGB(0, 0, 0)));
    this.instanced = [this.heads, this.lenses, ...this.beams];
    for (const m of this.instanced) {
      m.frustumCulled = false; // they sweep across the whole venue
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.instanceColor?.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }

    this.spots = Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4());
    this.spotCols = Array.from({ length: MAX_SPOTS }, () => new THREE.Color());
    // VIP focus: the moving heads — front truss, pitch-side towers and both pylons' arrays —
    // leave their beat patterns and converge on one raver.
    this.focus = new THREE.Vector3();
    this.focusW = 0;
    this.focusTarget = 0;
    this.pinW = 0; // how far the rig has swung onto the drop's pinpoint
  }

  /** Point the rig at `pos` (a Vector3) while `on`; it eases in and back out to the show. */
  setFocus(pos, on) {
    if (pos) this.focus.copy(pos);
    this.focusTarget = on ? 1 : 0;
  }

  update(dt, t, M, mood, palette) {
    const s = t * mood.speed;
    for (const m of this.beams) m.material.uniforms.uTime.value = t;
    this.pinW += ((mood.pattern === 'pinpoint' ? 1 : 0) - this.pinW) * Math.min(1, dt * 7);
    const pw = this.pinW > 0.01 ? this.pinW : 0;
    const strobePat = mood.strobePattern;
    const n = this.front.length;
    let spot = 0;
    this.focusW += (this.focusTarget - this.focusW) * Math.min(1, dt * 1.6);
    const fw = this.focusW > 0.002 ? this.focusW : 0;
    this.fixtures.forEach((f, i) => {
      const k = f.k;
      let pan;
      let tilt;
      let on = 1;
      let level = mood.lights;
      let col = palette[i % 2];
      switch (f.kind) {
        case 'sky':
          pan = Math.sin(s * 0.4 + i) * 0.6;
          tilt = 0.25 + 0.2 * Math.sin(s * 0.6 + i * 1.3);
          f.pivot.rotation.set(Math.PI + tilt, pan, 0);
          level = mood.sky;
          break;
        case 'pylon': {
          // Sweep inward over the dance floor: each head traces its own slow figure-of-eight.
          const north = f.pivot.position.z > CENTER_Z;
          const midZ = (DANCE_FLOOR.minZ + DANCE_FLOOR.maxZ) / 2;
          const a = s * 0.32 + k * 1.9;
          const tx = Math.sin(a) * 26 * (mood.pattern === 'center' ? 0.35 : 1);
          const tz = midZ + Math.sin(a * 0.7 + (north ? 0 : 2)) * 14 + (mood.pattern === 'cross' ? (north ? -10 : 10) : 0);
          _aim.set(tx, 0, tz).sub(f.pivot.position);
          const len = _aim.length() || 1;
          f.pivot.rotation.set(-Math.acos(Math.max(-1, Math.min(1, -_aim.y / len))), Math.atan2(_aim.x, _aim.z), 0);
          f.beamScale = len / 240; // reach the floor and stop there
          level = mood.sky * 0.8 + mood.lights * 0.25;
          col = palette[k % 2 === 0 ? 0 : 1];
          if (mood.pattern === 'chase') on = (M.beatCount & 3) === k ? 1 : 0.1;
          break;
        }
        case 'side': {
          const left = f.pivot.position.x < 0;
          const base = left ? Math.PI / 2 : -Math.PI / 2;
          const row = k >> 1;
          switch (mood.pattern) {
            case 'center':
              pan = base + (left ? -0.55 : 0.55) + 0.06 * Math.sin(s * 2 + k);
              tilt = 0.95;
              break;
            case 'chase':
              pan = base + (left ? 0.2 : -0.2);
              tilt = 0.8;
              on = (M.beatCount & 3) === row ? 1 : 0.06;
              break;
            case 'cross':
              pan = base + (k % 2 ? 0.45 : -0.45) * (0.6 + 0.4 * Math.sin(s * 0.8));
              tilt = 0.85;
              break;
            default:
              pan = base + 0.55 * Math.sin(s * 0.6 + row * 0.9 + (left ? 0 : Math.PI));
              tilt = 0.75 + 0.2 * Math.sin(s * 0.8 + k);
          }
          f.pivot.rotation.set(-tilt, pan, 0);
          col = palette[2] || palette[0];
          level = Math.max(0, mood.lights - 0.5) * 2; // dark until the drop
          break;
        }
        default:
          switch (mood.pattern) {
            case 'fan':
              pan = (k / (n - 1) - 0.5) * 1.6 * (0.6 + 0.4 * Math.sin(s * 0.5));
              tilt = 0.6 + 0.15 * Math.sin(s * 1.3);
              break;
            case 'cross':
              pan = (k % 2 ? 1 : -1) * (0.5 + 0.35 * Math.sin(s * 0.8));
              tilt = 0.7;
              break;
            case 'center':
              pan = -f.pivot.position.x / 30 + 0.05 * Math.sin(s * 2 + k);
              tilt = 0.45 + 0.1 * Math.sin(s * 2 + k);
              break;
            case 'stab': {
              // The laser show's TEASE: neighbours snap across each other on every half beat.
              const st = Math.floor((M.beatCount + M.phase) * 2) % 2;
              pan = (k % 2 ? 1 : -1) * (st ? 0.6 : -0.3);
              tilt = st ? 0.45 : 0.85;
              break;
            }
            case 'chase':
              pan = (k / (n - 1) - 0.5) * 1.2;
              tilt = 0.55;
              on = M.beatCount % n === k || M.beatCount % n === n - 1 - k ? 1 : 0.08;
              break;
            case 'matrix': // criss-cross: neighbours scan opposite ways while every head tilts in step, so the beams weave a lattice
              pan = (k % 2 ? 1 : -1) * 0.85 * tri(s * 0.35);
              tilt = 0.55 + 0.3 * tri(s * 0.35 + 0.25);
              break;
            case 'ballyhoo': // one synchronised sweep, rippling along the truss
              pan = 0.95 * Math.sin(s * 0.8 + k * 0.18);
              tilt = 0.5 + 0.28 * Math.sin(s * 1.6 + k * 0.18);
              break;
            default:
              pan = 0.8 * Math.sin(s * 0.7 + k * 0.5);
              tilt = 0.55 + 0.25 * Math.sin(s * 0.9 + k * 0.8);
          }
          f.pivot.rotation.set(-tilt, pan, 0);
      }
      // Strobe hits on the beat (fx.js strobePattern): flash the head, and flip its colour to the
      // complement (split: complement / split-complement) — never a plain on-off white.
      let hit = 0;
      if (strobePat && f.kind !== 'sky') {
        hit = strobeHit(strobePat, f, M);
        if (hit > 0.02) {
          level = Math.max(level, hit);
          on = Math.max(on, hit);
          col.getHSL(_hsl);
          if (_hsl.s > 0.12) {
            _col.setHSL(_hsl.h + (strobePat === 'split' ? (k & 1 ? 0.33 : 0.5) : 0.5), Math.min(1, _hsl.s + 0.1), Math.max(_hsl.l, 0.5));
            col = _col;
          }
          if (strobePat === 'stutter' || hit > 0.85) col = _tint.copy(col).lerp(WHITE, 0.55 * hit);
        }
      }
      const aw = fw > 0 ? fw : pw; // the VIP show beats the drop's pinpoint
      if (aw && f.kind !== 'sky') {
        // Swing onto the VIP, or the pinpoint (each head circles a little round it so the pool shimmers).
        const a = t * 0.9 + i * 1.7;
        const vip = fw > 0;
        const ring = vip ? 0.35 : 1.8;
        const at = vip ? this.focus : PIN;
        _aim.set(at.x + Math.cos(a) * ring, at.y + (vip ? 0.3 : 0), at.z + Math.sin(a) * ring).sub(f.pivot.position);
        const len = _aim.length() || 1;
        const tiltT = Math.acos(Math.max(-1, Math.min(1, -_aim.y / len)));
        const panT = Math.atan2(_aim.x, _aim.z);
        const r = f.pivot.rotation;
        r.set(-(-r.x + (tiltT - -r.x) * aw), lerpAngle(r.y, panT, aw), 0);
        // Reach all the way down to them (a pylon's beam is 240 m long; the others 32 m).
        if (f.kind === 'pylon') f.beamScale += (len / 240 - f.beamScale) * aw;
        else f.beamScale = 1 + (Math.max(1, len / 32) - 1) * aw;
        on += (1 - on) * aw;
        level += (Math.max(level, 0.9) - level) * aw;
        if (vip) col = _col.copy(col).lerp(VIP_WARM, 0.65 * fw);
      } else if (f.kind !== 'pylon') f.beamScale = 1; // pylon beams size themselves
      const target = level * on * (0.65 + M.kick * 0.6 + M.bass * 0.3) * (1 + hit * 0.9);
      f.intensity += (target - f.intensity) * Math.min(1, dt * (hit > 0.02 ? 45 : 12)); // strobe hits snap on
      f.color.copy(col);
      if (mood.headWhite) f.color.lerp(WHITE, mood.headWhite); // the laser show's white heads
      // This head's instances: housing and lens on the pivot, the beam stretched along it.
      f.pivot.updateMatrix();
      this.heads.setMatrixAt(i, f.pivot.matrix);
      this.lenses.setMatrixAt(i, f.pivot.matrix);
      this.lenses.setColorAt(i, _tint.copy(f.color).multiplyScalar(0.15 + f.intensity * 2.5));
      f.beamMesh.setMatrixAt(f.beamIndex, _m.copy(f.pivot.matrix).scale(_s.set(1, f.beamScale, 1)));
      f.beamMesh.setColorAt(f.beamIndex, _tint.copy(f.color).multiplyScalar(f.intensity * INTENSITY[f.kind]));

      if ((f.kind === 'front' || f.kind === 'side' || f.kind === 'pylon') && spot < MAX_SPOTS) {
        f.dir.copy(DOWN).applyEuler(f.pivot.rotation);
        const p = f.pivot.position;
        if (f.dir.y < -0.1) {
          const d = p.y / -f.dir.y;
          this.spots[spot].set(p.x + f.dir.x * d, p.z + f.dir.z * d, d * (f.kind === 'pylon' ? 0.03 : 0.095), f.intensity * (f.kind === 'pylon' ? 0.8 : 1));
          this.spotCols[spot].copy(f.color);
          spot++;
        }
      }
    });
    for (; spot < MAX_SPOTS; spot++) this.spots[spot].w = 0;
    for (const m of this.instanced) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true; // the housings have none
    }
  }
}
