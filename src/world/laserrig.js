// The mainstage laser array (LaserRig) and the beam renderer every laser in the venue draws with
// (BeamBatch).
//
// BeamBatch: laser beams as one instanced draw. Each beam is a long, slightly widening cone (the
// beam's divergence) drawn as a ribbon that always turns its face to the camera, so it never
// thins to a sliver seen edge-on. Its cross-section is a hot core in a soft glow skirt (the haze
// it lights), brightest near the head and fading into the air; additive, depth-tested (the
// stage and the stands hide it), fogged like everything else. A beam is never drawn thinner than
// about 1.25 px of whichever target it's rendering into (the main view, or a broadcast camera's
// 640 x 360 feed: onBeforeRender reads the target's height), and when it has to be widened
// its brightness is spread to match, so the energy on screen stays the same: far beams don't
// shimmer, break up into dashes or vanish between pixels, on the screen or on the LED walls.
//
// LaserRig: 24 laser heads (16–32) in a row along the front lip of the stage, emerald green
// (#00FF44) by default, with three looks:
//   SkyFan      the beams up into the sky in a broad V, opening and closing with the beat
//   CrowdSlice  low and flat over the dance floor, a scissor sweep at the stands' eye level
//   StrobeBlink a wide fan blinking on the 16th notes (half notes, dimmer, with "Reduce flashing")
// Presets blend over half a second; sweeps run on the beat clock. LightingDirector picks the look
// and the level (drop, breakdown, build); configure() sets count, colour, width, pitch, spread
// and sweep speed.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { settings } from '../core/device.js';

const SEGMENTS = 8; // along the beam: the min-pixel widening and the fog vary along it
const _size = new THREE.Vector2();

const beamMaterial = ({ length, width, divergence, halo, minPx, gain, glow }) =>
  new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uLength: { value: length },
        uWidth: { value: width },
        uDiverge: { value: divergence },
        uHalo: { value: halo },
        uMinPx: { value: minPx },
        uViewH: { value: 1080 },
        uGain: { value: gain },
        uGlow: { value: glow },
      },
    ]),
    vertexShader: /* glsl */ `
      attribute vec2 aBeam;   // x: 0 at the head .. 1 at the far end; y: -1 .. 1 across
      attribute vec3 iOrigin;
      attribute vec3 iDir;
      attribute vec4 iColor;  // rgb × intensity; a = on
      uniform float uLength, uWidth, uDiverge, uHalo, uMinPx, uViewH;
      varying float vX, vS, vCoreK, vCoreGain, vGlowGain;
      varying vec3 vCol;
      #include <fog_pars_vertex>
      void main() {
        if (iColor.a <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; } // off: clipped away
        float s = aBeam.x;
        vec3 axis = normalize(iDir);
        vec4 mvPosition = viewMatrix * vec4(iOrigin + axis * (s * uLength), 1.0);
        vec3 axisV = normalize((viewMatrix * vec4(axis, 0.0)).xyz);
        vec3 side = cross(axisV, normalize(-mvPosition.xyz));
        float sl = length(side);
        vec3 alt = normalize(cross(axisV, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
        side = normalize(mix(alt, side / max(sl, 1e-5), smoothstep(0.0, 0.04, sl))); // seen end-on
        float w = uWidth + uDiverge * s * uLength;         // the core's radius: a cone
        float wPhys = w + (uHalo - 1.0) * uWidth;           // the glow skirt's (it widens with the core)
        float px = 2.0 * max(0.1, -mvPosition.z) / (projectionMatrix[1][1] * uViewH); // 1 px, in m
        float wDraw = max(wPhys, uMinPx * px);
        // The core never sharper than half a pixel; its brightness spread to keep its energy.
        float core = max(w / wDraw, 0.5 * px / wDraw);
        vCoreK = 1.0 / (core * core);
        vCoreGain = w / (core * wDraw);
        vGlowGain = wPhys / wDraw;
        mvPosition.xyz += side * aBeam.y * wDraw;
        gl_Position = projectionMatrix * mvPosition;
        vX = aBeam.y;
        vS = s;
        vCol = iColor.rgb;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uGain, uGlow;
      varying float vX, vS, vCoreK, vCoreGain, vGlowGain;
      varying vec3 vCol;
      #include <fog_pars_fragment>
      void main() {
        float x2 = vX * vX;
        float core = exp(-x2 * vCoreK) * vCoreGain;
        float glow = exp(-x2 * 4.0) * uGlow * vGlowGain;
        // Brightest at the head, into the air; slow ripples of haze drifting along it.
        float along = (1.0 - smoothstep(0.55, 1.0, vS)) * (0.65 + 0.35 * exp(-vS * 7.0));
        float haze = 0.88 + 0.12 * sin(vS * 9.0 - uTime * 0.8) * sin(vS * 23.0 + uTime * 1.3);
        vec3 c = max(vCol, vec3(0.0)) * (core + glow) * along * haze * uGain;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

/** Up to `max` laser beams in one draw call. set() / hide() each, then commit() once a frame. */
export class BeamBatch {
  /**
   * @param opts.length      m, every beam
   * @param opts.width       m, the core's radius at the head
   * @param opts.divergence  m of extra radius per m of beam (the cone)
   * @param opts.halo        the glow skirt, × the core's radius
   * @param opts.minPx       px, the thinnest the ribbon is drawn (half-width)
   * @param opts.gain        overall brightness; opts.glow the skirt's share
   */
  constructor(scene, max, { length = 140, width = 0.012, divergence = 0.0012, halo = 7, minPx = 1.25, gain = 1, glow = 0.3, renderOrder = 3 } = {}) {
    this.max = max;
    const base = [];
    const idx = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      base.push(i / SEGMENTS, -1, i / SEGMENTS, 1);
      if (i < SEGMENTS) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('aBeam', new THREE.Float32BufferAttribute(base, 2));
    g.setIndex(idx);
    const inst = (n) => new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage);
    this.origin = inst(3);
    this.dir = inst(3);
    this.color = inst(4);
    g.setAttribute('iOrigin', this.origin);
    g.setAttribute('iDir', this.dir);
    g.setAttribute('iColor', this.color);
    g.instanceCount = max;
    this.geometry = g;
    this.material = beamMaterial({ length, width, divergence, halo, minPx, gain, glow });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false; // beams reach far outside any bounds worth computing
    this.mesh.renderOrder = renderOrder;
    // The thinnest a beam is drawn is a pixel of the target this render goes to.
    this.mesh.onBeforeRender = (renderer) => {
      const t = renderer.getRenderTarget();
      this.material.uniforms.uViewH.value = t ? t.height : renderer.getDrawingBufferSize(_size).y;
    };
    scene.add(this.mesh);
  }

  /** Beam i from `o` along `d` (needn't be normalised), colour `c` × intensity `k`. */
  set(i, o, d, c, k = 1) {
    this.origin.setXYZ(i, o.x, o.y, o.z);
    this.dir.setXYZ(i, d.x, d.y, d.z);
    this.color.setXYZW(i, c.r * k, c.g * k, c.b * k, k > 0.002 ? 1 : 0);
  }

  hide(i) {
    this.color.setW(i, 0);
  }

  /** Upload this frame's beams; `visible` false when none are on. */
  commit(time, visible = true) {
    this.mesh.visible = visible;
    if (!visible) return;
    this.material.uniforms.uTime.value = time;
    this.origin.needsUpdate = true;
    this.dir.needsUpdate = true;
    this.color.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------- the mainstage array
export const LASER_PRESETS = ['SkyFan', 'CrowdSlice', 'StrobeBlink'];
const MAX_HEADS = 32;
const LIP = { y: 2.6, z: -22.42, halfW: 25.5 }; // the stage deck's front edge (x clear of the flame boxes)
const BLEND = 0.5; // s, from one preset's aim to the next

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class LaserRig {
  constructor(scene, { count = 24, color = '#00ff44', width = 0.015, pitch = 0, sweepSpeed = 1, spread = 1 } = {}) {
    this.scene = scene;
    // The hero of the drop: a hotter core and more glow than the show's beams, short of washing the bloom out.
    this.beams = new BeamBatch(scene, MAX_HEADS, { length: 150, width, divergence: 0.0004, halo: 5, gain: 2.3, glow: 0.24 });
    this.color = new THREE.Color(color);
    this.pitch = pitch; // rad, added to every look's aim (up +)
    this.sweepSpeed = sweepSpeed;
    this.sweepMul = 1; // the director's (slower in a breakdown), on top of sweepSpeed
    this.spread = spread;
    this.preset = 'SkyFan';
    this.from = 'SkyFan';
    this.blend = 1;
    this.level = 0; // shown brightness, eased toward `target`
    this.target = 0;
    this.dirs = Array.from({ length: MAX_HEADS }, () => new THREE.Vector3(0, 1, 0)); // last aim (for blends)
    this.a = new THREE.Vector3();
    this.b = new THREE.Vector3();
    this.o = new THREE.Vector3();
    this.heads = null;
    this.setCount(count);
  }

  /** Change any of count (16–32), color, width (m), pitch (rad), sweepSpeed (×), spread (×). */
  configure({ count, color, width, pitch, sweepSpeed, spread } = {}) {
    if (count != null && clamp(Math.round(count), 16, MAX_HEADS) !== this.count) this.setCount(count);
    if (color != null) this.color.set(color);
    if (width != null) this.beams.material.uniforms.uWidth.value = clamp(width, 0.003, 0.08);
    if (pitch != null) this.pitch = clamp(pitch, -0.5, 0.5);
    if (sweepSpeed != null) this.sweepSpeed = clamp(sweepSpeed, 0, 4);
    if (spread != null) this.spread = clamp(spread, 0.2, 2);
  }

  /** The heads: housings and their glowing apertures, two draws. */
  setCount(count) {
    this.count = clamp(Math.round(count), 16, MAX_HEADS);
    this.xs = Array.from({ length: this.count }, (_, i) => -LIP.halfW + (2 * LIP.halfW * i) / (this.count - 1));
    for (let i = this.count; i < MAX_HEADS; i++) this.beams.hide(i);
    if (this.heads) for (const m of this.heads) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    const box = (x, w, h, d, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    const body = mergeGeometries(this.xs.map((x) => box(x, 0.34, 0.22, 0.32, LIP.y + 0.11, LIP.z)));
    const lens = mergeGeometries(this.xs.map((x) => box(x, 0.12, 0.08, 0.02, LIP.y + 0.14, LIP.z + 0.17)));
    this.headMat ||= new THREE.MeshLambertMaterial({ color: '#15131c' });
    this.lensMat ||= new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false });
    this.heads = [new THREE.Mesh(body, this.headMat), new THREE.Mesh(lens, this.lensMat)];
    this.scene.add(...this.heads);
  }

  /** The look ('SkyFan' | 'CrowdSlice' | 'StrobeBlink'), blended in from the current aim. */
  setPreset(name) {
    if (!LASER_PRESETS.includes(name) || name === this.preset) return;
    this.from = this.preset;
    this.preset = name;
    this.blend = 0;
  }

  /** Brightness 0–1 (eased: quick up, slower down). */
  setLevel(x) {
    this.target = clamp(x, 0, 1);
  }

  /** Where head i (u: -0.5 .. 0.5 across the stage) aims in a look, at beat time tb. */
  aim(name, i, u, tb, out) {
    const sp = this.sweepSpeed * this.sweepMul;
    const k = this.spread;
    switch (name) {
      case 'CrowdSlice': {
        // Flat over the floor, rising ~1.5 m by the far stands (their front rows' eye level);
        // the odd and even heads sweep against each other, scissoring.
        const dirn = i % 2 ? -1 : 1;
        const yaw = u * 1.1 * k + dirn * Math.sin(tb * 0.55 * sp) * 0.55;
        const p = 0.02 + this.pitch;
        return out.set(Math.sin(yaw) * Math.cos(p), Math.sin(p), Math.cos(yaw) * Math.cos(p));
      }
      case 'StrobeBlink': {
        // A wide still fan over the crowd, 45° up.
        const lean = u * 1.5 * k;
        const p = 0.75 + this.pitch;
        return out.set(Math.sin(lean) * Math.cos(p), Math.sin(p), Math.cos(lean) * Math.cos(p));
      }
      default: {
        // SkyFan: a broad V up into the sky, the two halves leaning out from the middle; it
        // opens and closes with the beat and the whole V sways side to side.
        const open = 0.8 + 0.2 * Math.sin(tb * 0.5 * sp);
        const lean = Math.sign(u || 1) * (0.1 + 1.05 * Math.abs(u) * k) * open + Math.sin(tb * 0.25 * sp) * 0.18;
        const fwd = 0.22 - this.pitch; // a little toward the crowd so the V faces them
        return out.set(Math.sin(lean) * Math.cos(fwd), Math.cos(lean) * Math.cos(fwd), Math.sin(fwd)).normalize();
      }
    }
  }

  /**
   * @param M  the music frame (beatCount, phase, kick)
   * @param tb beat time (beats, from the beat clock)
   */
  update(dt, t, M) {
    this.level += (this.target - this.level) * Math.min(1, dt * (this.target > this.level ? 14 : 3));
    const on = this.level > 0.01;
    this.lensMat.color.copy(this.color).multiplyScalar(on ? 0.4 + 2.2 * this.level : 0.12);
    if (!on) return this.beams.commit(t, false);
    this.blend = Math.min(1, this.blend + dt / BLEND);
    const e = this.blend * this.blend * (3 - 2 * this.blend);
    const tb = M.beatCount + M.phase;
    // StrobeBlink: on for the first half of every 16th (every half note, dimmer, with Reduce flashing).
    const blink = this.preset === 'StrobeBlink';
    const slow = settings.reduceFlash;
    const lit = !blink || (slow ? (tb / 2) % 1 < 0.5 : (tb * 4) % 1 < 0.5);
    const k = this.level * (0.8 + 0.35 * M.kick) * (blink && slow ? 0.4 : 1);
    for (let i = 0; i < this.count; i++) {
      const u = this.count > 1 ? i / (this.count - 1) - 0.5 : 0;
      this.aim(this.preset, i, u, tb, this.a);
      if (e < 1) this.a.lerp(this.aim(this.from, i, u, tb, this.b), 1 - e).normalize();
      this.dirs[i].copy(this.a);
      if (!lit) {
        this.beams.hide(i);
        continue;
      }
      this.o.set(this.xs[i], LIP.y + 0.14, LIP.z + 0.18);
      this.beams.set(i, this.o, this.a, this.color, k);
    }
    this.beams.commit(t, true);
  }

  dispose() {
    this.beams.dispose();
    for (const m of this.heads || []) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.headMat?.dispose();
    this.lensMat?.dispose();
  }
}
