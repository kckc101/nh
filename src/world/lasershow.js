// LASER SHOW // MAIN DROP (LaserChoreographySystem): a five-phase, beat-quantized mainstage drop
// in the manner of a festival mainstage, run from the DJ panel for everyone (shared/show.js).
//
//   1 TEASE        16 beats  deep purple and warm gold wash, white moving heads stabbing in fast
//                            criss-crosses; one beat of full-stage green laser on beat 8
//   2 BLINDER       4 beats  lasers cut; white blinders, a fast white strobe, the bloom swelling
//   3 LASER DROP   32 beats  dark violet wash; every laser tier at full neon green (#00FF33), by
//                            turns slow upward-sweeping liquid-sky sheets and wide oscillating
//                            aerial beam matrices (8 beats each); the LED wall goes hardcore
//   4 PYRO GATE    32 beats  the green lasers gated on the kick (on with it, off on the off-beat),
//                            flame bursts every 4th beat, CO2 plumes every 8th, white strobe hits
//   5 OUTRO        32 beats  green out; slow narrow white beams sweeping the sky, gold sparkle
//                            bursts high over the stage, a magenta and violet wash
// AUTO runs 1 → 5 and hands back to the normal show; a pad starts its phase on the next beat and
// loops it (during AUTO, it jumps the sequence there). BLACKOUT / RESET: two beats of black, then
// the normal show. Timing is the shared clock against the playing track's beat grid (the deck's
// BPM from its start), so every client's lasers, flames and plumes land on the same beat; each
// client fires its own effects at those beats.
//
// The laser rig: 18 emitters in three tiers on the stage, every one a fan drawn by one instanced
// draw call: 6 centre-low behind the booth (tight X cross-beams, 15-35 degrees up), 4 + 4 on the wings up the front
// truss towers (wide sheets and beam arrays over the crowd), 4 crown units on top of the front
// truss (steep aerial beams). A fan is either discrete beams (its plane sliced into rays) or a
// solid "liquid sky" sheet. The shader (additive, no depth write, double-sided): fades along the
// beam into the sky, softens to nothing at the sheet's sides, fades when you see a sheet edge-on
// (the drone flying through it), and drifts with haze; rays are anti-aliased and their energy is
// kept when they're thinner than a pixel. The rest of the show (moving heads, blinders, strobe,
// the emerald array, the bloom, flames, CO2, the palette) is driven through the shared mood after
// the LightingDirector (the DJ's own strobe still has the last word). The lite performance tier
// fires half the centre and wing emitters, shorter. dispose() frees everything.

import * as THREE from 'three';
import { SHOW_PHASES, showAt, SHOW_DEFAULTS } from '../../shared/show.js';
import { settings } from '../core/device.js';
import { STAGE } from './stage.js';

const ACROSS = 32;
const ALONG = 6;
const GREEN = new THREE.Color('#00ff33');
const WHITE = new THREE.Color(1, 1, 1);
const PAL = {
  tease: ['#4b17c8', '#ffb627', '#ffffff'],
  blinder: ['#ffffff', '#5ff6ff', '#ffffff'],
  drop: ['#2a0a6e', '#5b1cff', '#ffffff'],
  pyro: ['#3a0a8c', '#ff5a1f', '#ffffff'],
  outro: ['#ff2bd6', '#8b2cff', '#ffffff'],
};
const PALETTES = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, v.map((c) => new THREE.Color(c))]));
const GOLD = new THREE.Color(2.4, 1.7, 0.55);

const smooth = (x) => x * x * (3 - 2 * x);
const hash = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

function laserMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uTime: { value: 0 }, uIntensity: { value: 1 }, uFadePower: { value: 1.8 } },
    ]),
    vertexShader: /* glsl */ `
      attribute vec2 aFan;   // x: 0 .. 1 across the fan, y: 0 at the emitter .. 1 at the far end
      attribute vec4 iFan;   // spread (rad), length (m), beams (0: a solid sheet), ray width (of the spacing)
      attribute vec3 iColor; // rgb × intensity; 0: off
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vBeams, vWidth, vFacing;
      #include <fog_pars_vertex>
      void main() {
        if (dot(iColor, iColor) < 1e-6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float a = (aFan.x - 0.5) * iFan.x;
        vec3 p = vec3(sin(a), 0.0, cos(a)) * (aFan.y * iFan.y);
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        // How square-on we see the fan's plane (its normal is the emitter's local up).
        vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * vec3(0.0, 1.0, 0.0));
        vFacing = abs(dot(n, normalize(-mvPosition.xyz)));
        vUv = aFan;
        vCol = iColor;
        vBeams = iFan.z;
        vWidth = iFan.w;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uIntensity, uFadePower;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vBeams, vWidth, vFacing;
      #include <fog_pars_fragment>
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        float along = pow(1.0 - vUv.y, uFadePower);                 // dissolving into the sky
        float edge = pow(max(sin(vUv.x * 3.14159265), 0.0), 1.5);    // no hard borders at the sides
        float facing = smoothstep(0.02, 0.35, vFacing);             // a sheet seen edge-on fades away
        float shape;
        if (vBeams > 0.5) {
          // Discrete rays: the fan sliced into vBeams beams, anti-aliased, their energy kept
          // when they're thinner than a pixel (no shimmer far away).
          float f = vUv.x * vBeams;
          float d = abs(fract(f) - 0.5);
          float w = vWidth * 0.5;
          float aa = fwidth(f) + 1e-4;
          shape = (1.0 - smoothstep(w, w + aa, d)) * min(1.0, (w * 2.0) / aa) * 1.6;
          facing = mix(0.45, 1.0, facing); // rays, not a sheet: still there side-on
          edge = mix(1.0, edge, 0.5);
        } else {
          // A liquid-sky sheet: a thin, translucent haze that ripples (the light catching the smoke).
          float ripple = vn(vec2(vUv.x * 6.0 - uTime * 0.25, vUv.y * 10.0 - uTime * 0.6));
          shape = 0.11 * (0.35 + 0.65 * ripple);
        }
        float haze = 0.7 + 0.3 * vn(vec2(vUv.x * 9.0 + uTime * 0.15, vUv.y * 14.0 - uTime * 0.4));
        vec3 c = max(vCol, vec3(0.0)) * shape * along * edge * facing * haze * uIntensity;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
}

/** The fan: a grid of (across, along) points; the vertex shader opens it to the emitter's spread. */
function fanGeometry() {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= ALONG; j++) {
    for (let i = 0; i <= ACROSS; i++) {
      pos.push(i / ACROSS, 0, j / ALONG);
      uv.push(i / ACROSS, j / ALONG);
    }
  }
  const row = ACROSS + 1;
  for (let j = 0; j < ALONG; j++) {
    for (let i = 0; i < ACROSS; i++) {
      const a = j * row + i;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFan', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class LaserChoreographySystem {
  /**
   * @param world  the World (mood via fx, the laser array, cryo, sparks, stage, governor)
   * @param clock  () => ms on the shared (server) clock
   */
  constructor(world, clock) {
    this.w = world;
    this.clock = clock;
    this.state = { ...SHOW_DEFAULTS };
    this.next = null; // a command waiting for its beat
    this.status = null; // where the show is (showAt), or null
    this.onStatus = null; // (status) — the DJ panel, 10 times a second
    this.statusAt = 0;
    this.lastKey = '';
    this.lastPhaseKey = '';

    // The rig: centre-low (6), wings (4 + 4), crown (4).
    const H = STAGE.truss.h;
    const X = STAGE.truss.x;
    this.emitters = [
      ...[-5, -3, -1, 1, 3, 5].map((x) => ({ tier: 'center', pos: new THREE.Vector3(x, 6.2, -34.2) })),
      ...[-1, 1].flatMap((s) => [11, 14.5, 18, 21.5].map((y) => ({ tier: 'wing', side: s, pos: new THREE.Vector3(s * (X + 1.3), y, -22.2) }))),
      ...[-15, -5, 5, 15].map((x) => ({ tier: 'crown', pos: new THREE.Vector3(x, H + 1.0, -23) })),
    ];
    this.emitters.forEach((e, i) => {
      e.i = i;
      e.k = 0;
      e.color = new THREE.Color();
      e.yaw = 0;
      e.pitch = 0;
      e.roll = 0;
      e.spread = 0.5;
      e.length = 120;
      e.beams = 6;
      e.width = 0.06;
    });
    const n = this.emitters.length;
    const geo = fanGeometry();
    this.iFan = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iFan', this.iFan);
    geo.setAttribute('iColor', this.iColor);
    this.material = laserMaterial();
    this.mesh = new THREE.InstancedMesh(geo, this.material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // the fans reach far beyond any bounds worth computing
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    world.scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._one = new THREE.Vector3(1, 1, 1);
  }

  // ---------------------------------------------------------------- state
  /** The shared show state (from the server). A command for a later beat waits for it. */
  applyState(s) {
    const st = { ...SHOW_DEFAULTS, ...s };
    if (st.mode !== 'off' && st.t0 > this.clock() + 5) this.next = st;
    else {
      this.state = st;
      this.next = null;
    }
  }

  get active() {
    return !!this.status && !this.status.pending;
  }

  // ---------------------------------------------------------------- per frame
  /** After the LightingDirector, before the DJ strobe: shapes the mood and runs the rig. */
  update(dt, t, M, mood) {
    const now = this.clock();
    if (this.next && now >= this.next.t0) {
      this.state = this.next;
      this.next = null;
    }
    const dj = this.w.audio?.state;
    const st = showAt(this.state, dj, now);
    this.status = st && !st.pending ? st : null;
    this.report(now);
    for (const e of this.emitters) e.k = 0;
    mood.bloomBoost = 0;
    mood.headWhite = 0;
    const vip = this.w.fx.vipLevel || 0;
    if (!this.status || vip > 0.5) return this.commit(t);

    const s = this.status;
    // Beat edges (each client fires the same effects on the same beats) and phase starts.
    const bi = Math.floor(s.beat);
    const key = `${this.state.t0}:${s.phase}:${s.cycle}:${bi}`;
    const phaseKey = `${this.state.t0}:${s.phase}:${s.cycle}`;
    if (phaseKey !== this.lastPhaseKey) {
      this.lastPhaseKey = phaseKey;
      this.onPhase(s.phase);
    }
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.onBeat(s.phase, bi);
    }
    const id = s.phase >= 0 ? SHOW_PHASES[s.phase].id : 'blackout';
    if (id !== 'blackout') this.w.fx.paletteOverride = PALETTES[id];
    this[id](s, mood, M);
    this.commit(t);
  }

  /** The DJ panel's progress, 10 times a second. */
  report(now) {
    if (!this.onStatus || now - this.statusAt < 100) return;
    this.statusAt = now;
    this.onStatus(this.status, this.state);
  }

  /** The start of a phase: the LED wall's program, the crowd. */
  onPhase(phase) {
    const id = SHOW_PHASES[phase]?.id;
    if (id === 'drop') {
      this.w.stage.led.setMode(4); // hardcore
      this.w.crowd?.erupt?.('drop', 0.9);
    } else if (id === 'outro') this.w.stage.led.setMode(3);
  }

  /** Effects on the beat: flames, CO2, gold sparkles. */
  onBeat(phase, bi) {
    const id = SHOW_PHASES[phase]?.id;
    if (id === 'pyro') {
      if (bi % 4 === 0) this.w.fx.trigger('fire');
      if (bi % 8 === 4) this.w.cryo.burst({ pattern: 'outward' });
    } else if (id === 'outro' && bi % 4 === 2) this.sparkle(bi);
  }

  /** A gold sparkle burst high over the stage arch (every client the same spot: seeded by the beat). */
  sparkle(bi) {
    const sparks = this.w.sparks;
    const seed = this.state.t0 * 0.001 + bi;
    const x = -18 + 36 * hash(seed);
    const y = 44 + 12 * hash(seed + 1.7);
    const z = -36 + 14 * hash(seed + 3.1);
    const v = new THREE.Vector3();
    const n = Math.max(30, Math.round(110 * this.w.particleScale));
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(5 + Math.random() * 5);
      sparks.emit(x, y, z, v.x, v.y, v.z, { color: GOLD, life: 1.6 + Math.random() * 0.9, size: 0.45 + Math.random() * 0.35, alpha: 1, gravity: -2.2, drag: 1.1 });
    }
  }

  // ---------------------------------------------------------------- the phases
  /** Common: the house wash down, the normal show's lasers out (this rig is the show now). */
  base(mood, { lights, ambient }) {
    mood.lights = lights;
    mood.ambient = ambient;
    mood.ambientTint = 0;
    mood.lasers = 0;
    mood.sheet = 0;
    const rig = this.w.laserRig;
    if (rig) rig.level = rig.target = 0; // cut on the beat, not faded (a phase turns it back on)
  }

  tease(s, mood) {
    this.base(mood, { lights: 0.55, ambient: 0.16 });
    mood.pattern = 'stab'; // fast criss-cross stabs (lights.js)
    mood.headWhite = 1;
    // One beat of full-stage green on beat 8.
    if (s.beat >= 8 && s.beat < 9) {
      const env = Math.pow(1 - (s.beat - 8), 1.5);
      for (const e of this.emitters) {
        const u = e.tier === 'wing' ? e.side : Math.sign(e.pos.x || 1);
        if (e.tier === 'center') this.set(e, { yaw: -u * 0.2, pitch: 0.5, spread: 0.9, beams: 9, k: 1.6 * env });
        else if (e.tier === 'wing') this.set(e, { yaw: -u * 0.3, pitch: 0.15, spread: 1.4, beams: 11, k: 1.6 * env });
        else this.set(e, { yaw: 0, pitch: 1.1, spread: 0.8, beams: 7, roll: Math.PI / 2, k: 1.6 * env });
      }
      const rig = this.w.laserRig;
      if (rig) {
        rig.setPreset('SkyFan');
        rig.level = rig.target = env;
      }
    }
  }

  blinder(s, mood) {
    this.base(mood, { lights: 0.2, ambient: 0.1 });
    mood.pattern = 'center';
    mood.headWhite = 1;
    const safe = settings.reduceFlash;
    // A fast white strobe (16ths; beats, softly, with Reduce flashing) over full white blinders.
    const pulse = safe ? (s.beat % 1 < 0.15 ? 1 : 0) : (s.beat * 4) % 1 < 0.5 ? 1 : 0;
    mood.strobe = Math.max(mood.strobe, pulse * (safe ? 0.25 : 0.9));
    mood.blinder = Math.max(mood.blinder, safe ? 0.3 : 0.75 + 0.25 * pulse);
    mood.blinderWhite = 1;
    mood.flash = Math.min(1, mood.flash + pulse * (safe ? 0.1 : 0.3));
    mood.bloomBoost = 0.2 + 0.35 * (s.beat / s.len); // swelling into the drop
  }

  drop(s, mood) {
    this.base(mood, { lights: 0.3, ambient: 0.05 });
    mood.pattern = 'sweep';
    mood.bloomBoost = 0.15;
    const b = s.beat;
    const sheets = Math.floor(b / 8) % 2 === 0; // liquid sky / aerial matrices, 8 beats each
    const p8 = (b % 8) / 8;
    for (const e of this.emitters) {
      const u = e.tier === 'wing' ? e.side : Math.sign(e.pos.x || 1);
      const ph = e.i * 0.9;
      if (sheets) {
        // Liquid sky from the upper wing emitters (two a side), sweeping slowly up; the lower
        // wing ones rest, the crown holds slow aerial beams, the centre keeps its X.
        const upper = e.tier === 'wing' && e.pos.y > 16;
        if (upper) this.set(e, { yaw: -u * 0.35, pitch: 0.05 + 0.42 * smooth(p8), spread: 1.5, beams: 0, k: 0.9 });
        else if (e.tier === 'crown') this.set(e, { yaw: u * 0.2, pitch: 1.05 + 0.2 * Math.sin(b * 0.4 + ph), spread: 0.5, beams: 5, roll: Math.PI / 2, k: 1.3 });
        else if (e.tier === 'center') this.set(e, { yaw: -u * 0.5, pitch: 0.26 + 0.35 * (0.5 + 0.5 * Math.sin(b * 0.8 + ph)), spread: 0.14, beams: 3, roll: Math.PI / 2, k: 1.6 }); // the X
      } else {
        const osc = Math.sin((b * Math.PI) / 4 + ph);
        if (e.tier === 'wing') this.set(e, { yaw: -u * (0.3 + 0.3 * Math.sin((b * Math.PI) / 8)), pitch: 0.25 + 0.2 * osc, spread: 1.2, beams: 12, k: 1.5 });
        else if (e.tier === 'crown') this.set(e, { yaw: 0.2 * osc, pitch: 1.0 + 0.25 * osc, spread: 0.7, beams: 8, roll: Math.PI / 2, k: 1.5 });
        else this.set(e, { yaw: -u * 0.45 * Math.sin((b * Math.PI) / 2), pitch: 0.4 + 0.15 * osc, spread: 0.6, beams: 6, k: 1.6 });
      }
    }
    const rig = this.w.laserRig;
    if (rig) {
      rig.setPreset(sheets ? 'SkyFan' : 'CrowdSlice');
      rig.setLevel(1);
    }
  }

  pyro(s, mood, M) {
    this.base(mood, { lights: 0.4, ambient: 0.06 });
    mood.pattern = 'cross';
    mood.bloomBoost = 0.1;
    const b = s.beat;
    const bi = Math.floor(b);
    // Kick-gated: on with the kick (or the beat itself), off on the off-beat.
    const gate = M.kick > 0.45 || b % 1 < 0.3 ? 1 : 0;
    const safe = settings.reduceFlash;
    mood.strobe = Math.max(mood.strobe, b % 1 < 0.1 && (!safe || bi % 2 === 0) ? (safe ? 0.25 : 0.7) : 0);
    for (const e of this.emitters) {
      const u = e.tier === 'wing' ? e.side : Math.sign(e.pos.x || 1);
      const j = hash(bi * 3.7 + e.i); // a new aim every beat: choppy
      if (e.tier === 'wing') this.set(e, { yaw: -u * (0.15 + 0.5 * j), pitch: 0.1 + 0.4 * j, spread: 1.1, beams: 10, k: 1.6 * gate });
      else if (e.tier === 'crown') this.set(e, { yaw: (j - 0.5) * 0.6, pitch: 0.9 + 0.4 * j, spread: 0.6, beams: 6, roll: Math.PI / 2, k: 1.6 * gate });
      else this.set(e, { yaw: -u * (0.2 + 0.5 * j), pitch: 0.26 + 0.35 * j, spread: 0.3, beams: 4, k: 1.6 * gate });
    }
    const rig = this.w.laserRig;
    if (rig) {
      rig.setPreset('SkyFan');
      rig.level = rig.target = gate;
    }
  }

  outro(s, mood) {
    this.base(mood, { lights: 0.45, ambient: 0.14 });
    mood.pattern = 'sweep';
    const b = s.beat;
    // Green out; slow, narrow white beams sweeping the sky from the crown and the centre.
    for (const e of this.emitters) {
      if (e.tier === 'wing') continue;
      const ph = e.i * 1.3;
      this.set(e, { yaw: 0.3 * Math.sin(b * 0.1 + ph), pitch: 1.15 + 0.2 * Math.sin(b * 0.2 + ph), spread: 0.12, beams: 3, width: 0.12, roll: Math.PI / 2, color: WHITE, k: 1.6 });
    }
  }

  blackout(s, mood) {
    this.base(mood, { lights: 0, ambient: 0.02 });
    mood.sky = 0;
    mood.strobe = 0;
    mood.strobePattern = null;
    mood.blinder = 0;
    mood.flash = 0;
    mood.ledDim = 0.04;
    mood.floorDim = 0.1;
  }

  // ---------------------------------------------------------------- the rig
  set(e, { yaw = 0, pitch = 0, roll = 0, spread = 0.5, beams = 6, width = 0.06, length = 130, color = GREEN, k = 1 }) {
    e.yaw = yaw;
    e.pitch = pitch;
    e.roll = roll;
    e.spread = spread;
    e.beams = beams;
    e.width = width;
    e.length = length;
    e.color.copy(color);
    e.k = k;
  }

  /** Upload this frame's emitters; on the lite tier half the centre and wing ones fire, shorter. */
  commit(t) {
    const lite = this.w.gov.tier >= 2;
    const vip = this.w.fx.vipLevel || 0;
    let any = false;
    for (const e of this.emitters) {
      let k = e.k * (1 - vip);
      if (lite && e.tier !== 'crown' && e.i % 2) k = 0;
      const i = e.i;
      if (k <= 0.002) {
        this.iColor.setXYZ(i, 0, 0, 0);
        continue;
      }
      any = true;
      this._e.set(-e.pitch, e.yaw, e.roll);
      this._q.setFromEuler(this._e);
      this.mesh.setMatrixAt(i, this._m.compose(e.pos, this._q, this._one));
      this.iFan.setXYZW(i, e.spread, e.length * (lite ? 0.75 : 1), e.beams, e.width);
      this.iColor.setXYZ(i, e.color.r * k, e.color.g * k, e.color.b * k);
    }
    this.mesh.visible = any;
    if (!any) return;
    this.material.uniforms.uTime.value = t;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.iFan.needsUpdate = true;
    this.iColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose?.();
  }
}
