// Blocky (Roblox-style) avatar geometry.
// Every body part (torso, head, arms, legs) is merged into ONE BufferGeometry with baked
// vertex colours plus an `fx` attribute: fx.x = glow amount (emissive neon), fx.y = 1 for
// kroma (Cambodian gingham scarf) pattern. All avatars share a single material, so a crowd
// of 50 dancers costs ~6 draw calls each and every neon accent pulses with the bass at once.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { normalizeAvatar, accentColor } from './options.js';

export const avatarUniforms = { uGlowBoost: { value: 1.4 } };
/**
 * The DJ's own look (the focal point): their neon on its own level (it doesn't go down with the
 * crowd's in an Arena Blackout), and a rim of light round the silhouette in the look's colour,
 * punching on the kick (World.frame sets these).
 */
export const djUniforms = { uDjGlow: { value: 1.4 }, uRim: { value: 1 }, uRimColor: { value: new THREE.Color('#00f0ff') } };

const materials = {};
/** The avatars' shared material; `dj` the DJ's (rim-lit) one. */
export function avatarMaterial(dj = false) {
  const key = dj ? 'dj' : 'crowd';
  if (materials[key]) return materials[key];
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGlowBoost = dj ? djUniforms.uDjGlow : avatarUniforms.uGlowBoost;
    if (dj) {
      shader.uniforms.uRim = djUniforms.uRim;
      shader.uniforms.uRimColor = djUniforms.uRimColor;
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 fx;\nvarying vec2 vFx;\nvarying vec2 vPatUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFx = fx;\nvPatUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vFx;\nvarying vec2 vPatUv;\nuniform float uGlowBoost;${dj ? '\nuniform float uRim;\nuniform vec3 uRimColor;' : ''}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        if (vFx.y > 0.5) {
          float sx = step(0.5, fract(vPatUv.x * 5.0));
          float sy = step(0.5, fract(vPatUv.y * 5.0));
          diffuseColor.rgb = mix(vec3(0.9), diffuseColor.rgb, (sx + sy) * 0.5);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vFx.x * uGlowBoost;${
          dj ? '\n{ float rimF = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0); totalEmissiveRadiance += uRimColor * pow(rimF, 1.4) * uRim; }' : ''
        }`,
      );
  };
  // The two share a source, so tell three's program cache they differ.
  m.customProgramCacheKey = () => `erave-avatar-${key}`;
  materials[key] = m;
  return m;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

class Parts {
  constructor() {
    this.list = [];
  }

  add(geo, color, o = {}) {
    _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
    _q.setFromEuler(_e);
    _p.set(o.x || 0, o.y || 0, o.z || 0);
    _s.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
    geo.applyMatrix4(_m.compose(_p, _q, _s));
    const n = geo.attributes.position.count;
    _c.set(color);
    const col = new Float32Array(n * 3);
    const fx = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
      fx[i * 2] = o.glow || 0;
      fx[i * 2 + 1] = o.pattern || 0;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('fx', new THREE.BufferAttribute(fx, 2));
    this.list.push(geo);
    return this;
  }

  box(w, h, d, color, o) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, o);
  }

  cyl(rt, rb, h, seg, color, o) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, o);
  }

  cone(r, h, seg, color, o) {
    return this.add(new THREE.ConeGeometry(r, h, seg), color, o);
  }

  sphere(r, ws, hs, color, o) {
    return this.add(new THREE.SphereGeometry(r, ws, hs), color, o);
  }

  torus(r, tube, rs, ts, color, o) {
    return this.add(new THREE.TorusGeometry(r, tube, rs, ts), color, o);
  }

  build() {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false);
    for (const x of this.list) x.dispose();
    this.list = [];
    g.computeBoundingSphere();
    return g;
  }
}

/** Elbow and knee heights in limb space (arms hang from the shoulder, legs from the hip). */
export const ELBOW = -0.42;
export const KNEE = -0.45;

/**
 * An arm or leg in two segments hinged at `joint`: parts above it go to the upper segment,
 * parts below to the lower one (re-based on the joint). Axis-aligned boxes that straddle the
 * joint — sleeves, trousers, stripes — are split in two so both halves bend cleanly.
 */
class Limb {
  constructor(joint) {
    this.joint = joint;
    this.upper = new Parts();
    this.lower = new Parts();
  }

  route(o = {}) {
    const y = o.y || 0;
    return y > this.joint ? [this.upper, o] : [this.lower, { ...o, y: y - this.joint }];
  }

  box(w, h, d, color, o = {}) {
    const J = this.joint;
    const y = o.y || 0;
    const top = y + h / 2;
    const bottom = y - h / 2;
    if (!o.rx && !o.rz && top > J + 0.01 && bottom < J - 0.01) {
      this.upper.box(w, top - J, d, color, { ...o, y: (top + J) / 2 });
      this.lower.box(w, J - bottom, d, color, { ...o, y: (J + bottom) / 2 - J });
      return this;
    }
    const [P, oo] = this.route(o);
    P.box(w, h, d, color, oo);
    return this;
  }

  cyl(rt, rb, h, seg, color, o) {
    const [P, oo] = this.route(o);
    P.cyl(rt, rb, h, seg, color, oo);
    return this;
  }

  sphere(r, ws, hs, color, o) {
    const [P, oo] = this.route(o);
    P.sphere(r, ws, hs, color, oo);
    return this;
  }
}

function shade(hex, f) {
  return '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();
}

const GOLD = '#e2b23a';
// Sleeve length per top ('short' when not listed) and how strongly long-sleeve cuffs glow.
const SLEEVES = { kroma: 'long', hoodie: 'long', bomber: 'long', trackjkt: 'long', holo: 'long', tank: 'none', crop: 'none', apsara: 'none' };
const CUFF_GLOW = { kroma: 1, bomber: 1, trackjkt: 0.6, holo: 1.2 };
const COVERS_TOP = new Set(['bucket', 'cap', 'crown', 'bandana']);
const KANDI = ['#ff2bd6', '#00f0ff', '#9dff00', '#ffc400', '#8b5cff'];

function sleeveColorOf(c) {
  if (c.top === 'vest') return '#17171f';
  if (c.top === 'holo') return shade(c.topColor, 0.35);
  return c.topColor;
}

// Seven-segment glow digits (the jersey number).
const SEGMENTS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function digit(P, d, x, y, z, w, h, t, color) {
  const hw = w / 2;
  const hh = h / 2;
  const o = (dx, dy) => ({ x: x + dx, y: y + dy, z, glow: 1.1 });
  for (const seg of SEGMENTS[d]) {
    if (seg === 'a') P.box(w, t, 0.03, color, o(0, hh));
    else if (seg === 'g') P.box(w, t, 0.03, color, o(0, 0));
    else if (seg === 'd') P.box(w, t, 0.03, color, o(0, -hh));
    else if (seg === 'b') P.box(t, hh, 0.03, color, o(hw, hh / 2));
    else if (seg === 'c') P.box(t, hh, 0.03, color, o(hw, -hh / 2));
    else if (seg === 'e') P.box(t, hh, 0.03, color, o(-hw, -hh / 2));
    else if (seg === 'f') P.box(t, hh, 0.03, color, o(-hw, hh / 2));
  }
}

/**
 * @param opts.face false leaves the face clear for a profile photo: no drawn eyes or mouth,
 *                  no eyewear and no hair fringe over the forehead.
 */
export function buildAvatarGeometry(input, { face = true } = {}) {
  const c = normalizeAvatar(input);
  const skin = c.skin;
  const accent = accentColor(c.accent);
  const torso = new Parts();
  const head = new Parts();
  const armL = new Limb(ELBOW);
  const armR = new Limb(ELBOW);
  const legL = new Limb(KNEE);
  const legR = new Limb(KNEE);
  const stickL = new Parts();
  const stickR = new Parts();

  // ---------------------------------------------------------------- legs (pivot at hip, hang down)
  for (const [L, side] of [[legL, 1], [legR, -1]]) {
    switch (c.pants) {
      case 'shorts':
        L.box(0.46, 0.42, 0.48, c.pantsColor, { y: -0.21 });
        L.box(0.4, 0.36, 0.42, skin, { y: -0.6 });
        break;
      case 'tutu':
        // Bare legs and knee-high socks; the skirt itself hangs off the torso.
        L.box(0.4, 0.42, 0.42, skin, { y: -0.21 });
        L.box(0.44, 0.38, 0.46, c.pantsColor, { y: -0.59 });
        L.box(0.46, 0.05, 0.48, accent, { y: -0.41, glow: 1 });
        break;
      case 'fluffies':
        // Hot pants and big fuzzy leg warmers in the glow colour.
        L.box(0.46, 0.32, 0.48, c.pantsColor, { y: -0.16 });
        L.box(0.4, 0.16, 0.42, skin, { y: -0.4 });
        L.box(0.54, 0.4, 0.6, accent, { y: -0.66, glow: 0.55 });
        L.box(0.58, 0.06, 0.64, '#f4f0ff', { y: -0.47, glow: 0.3 });
        break;
      case 'flare':
        L.box(0.46, 0.5, 0.48, c.pantsColor, { y: -0.25 });
        L.cyl(0.25, 0.37, 0.32, 8, c.pantsColor, { y: -0.66 });
        L.cyl(0.38, 0.38, 0.04, 8, accent, { y: -0.81, glow: 1 });
        break;
      case 'sampot':
        // Khmer chang kben: a baggy wrap gathered at the calf, gold-trimmed.
        L.box(0.52, 0.62, 0.54, c.pantsColor, { y: -0.31 });
        L.box(0.44, 0.18, 0.46, c.pantsColor, { y: -0.7 });
        L.box(0.54, 0.04, 0.56, GOLD, { y: -0.61, glow: 0.2 });
        break;
      default:
        L.box(0.46, 0.78, 0.48, c.pantsColor, { y: -0.39 });
    }
    if (c.pants === 'track') L.box(0.04, 0.74, 0.1, accent, { x: side * 0.235, y: -0.39, glow: 1 });
    if (c.pants === 'cargo') L.box(0.05, 0.2, 0.26, shade(c.pantsColor, 0.75), { x: side * 0.245, y: -0.42 });
    L.box(0.48, 0.14, 0.58, '#ececf4', { y: -0.85, z: 0.05 });
    L.box(0.5, 0.04, 0.6, accent, { y: -0.93, z: 0.05, glow: 1 });
  }

  // ---------------------------------------------------------------- torso (pivot at hips, spans 0..0.95)
  switch (c.top) {
    case 'vest': {
      torso.box(1, 0.95, 0.5, '#17171f', { y: 0.475 });
      for (const s of [1, -1]) {
        torso.box(0.38, 0.86, 0.05, c.topColor, { x: s * 0.29, y: 0.47, z: 0.265, glow: 0.25 });
        torso.box(0.06, 0.86, 0.5, c.topColor, { x: s * 0.505, y: 0.47, glow: 0.25 });
        for (const y of [0.3, 0.56]) torso.box(0.38, 0.07, 0.06, accent, { x: s * 0.29, y, z: 0.27, glow: 1 });
      }
      torso.box(0.96, 0.86, 0.05, c.topColor, { y: 0.47, z: -0.265, glow: 0.25 });
      for (const y of [0.3, 0.56]) torso.box(0.96, 0.07, 0.06, accent, { y, z: -0.27, glow: 1 });
      break;
    }
    case 'kroma': {
      torso.box(1.02, 0.95, 0.52, c.topColor, { y: 0.475, pattern: 1 });
      torso.box(0.26, 0.9, 0.03, '#121218', { y: 0.47, z: 0.265 });
      torso.box(0.7, 0.1, 0.56, c.topColor, { y: 0.92, pattern: 1 });
      for (const s of [1, -1]) torso.box(0.03, 0.9, 0.04, accent, { x: s * 0.14, y: 0.47, z: 0.27, glow: 1 });
      break;
    }
    case 'hoodie': {
      torso.box(1.02, 0.95, 0.52, c.topColor, { y: 0.475 });
      torso.box(0.6, 0.24, 0.04, shade(c.topColor, 0.82), { y: 0.22, z: 0.27 });
      torso.box(0.86, 0.32, 0.26, shade(c.topColor, 0.9), { y: 0.95, z: -0.26 });
      for (const s of [1, -1]) torso.box(0.03, 0.26, 0.03, accent, { x: s * 0.1, y: 0.78, z: 0.27, glow: 1 });
      break;
    }
    case 'tank': {
      torso.box(0.96, 0.95, 0.5, c.topColor, { y: 0.475 });
      torso.box(0.5, 0.05, 0.04, accent, { y: 0.93, z: 0.255, glow: 1 });
      torso.box(0.98, 0.05, 0.52, accent, { y: 0.04, glow: 0.8 });
      break;
    }
    case 'crop': {
      torso.box(0.96, 0.4, 0.48, skin, { y: 0.2 });
      torso.box(1, 0.55, 0.5, c.topColor, { y: 0.675 });
      torso.box(1.02, 0.05, 0.52, accent, { y: 0.4, glow: 1 });
      torso.box(0.36, 0.05, 0.04, accent, { y: 0.93, z: 0.255, glow: 1 });
      break;
    }
    case 'bomber': {
      const rib = shade(c.topColor, 0.6);
      torso.box(1.04, 0.95, 0.54, c.topColor, { y: 0.475 });
      torso.box(1.06, 0.1, 0.56, rib, { y: 0.07 });
      torso.box(0.62, 0.1, 0.58, rib, { y: 0.92 });
      torso.box(0.03, 0.84, 0.03, accent, { y: 0.48, z: 0.285, glow: 1.2 });
      for (const s of [1, -1]) torso.box(0.22, 0.03, 0.03, accent, { x: s * 0.28, y: 0.7, z: 0.285, glow: 1 });
      torso.box(0.8, 0.04, 0.03, accent, { y: 0.84, z: -0.285, glow: 1 });
      break;
    }
    case 'jersey': {
      torso.box(1.06, 0.98, 0.54, c.topColor, { y: 0.47 });
      for (const s of [1, -1]) {
        torso.box(0.05, 0.22, 0.04, accent, { x: s * 0.08, y: 0.86, z: 0.275, rz: s * 0.5, glow: 1 });
        torso.box(0.04, 0.92, 0.56, accent, { x: s * 0.51, y: 0.47, glow: 0.8 });
      }
      digit(torso, 2, -0.14, 0.5, 0.285, 0.17, 0.34, 0.045, accent);
      digit(torso, 6, 0.14, 0.5, 0.285, 0.17, 0.34, 0.045, accent);
      break;
    }
    case 'trackjkt': {
      torso.box(1.02, 0.95, 0.52, c.topColor, { y: 0.475 });
      torso.box(0.03, 0.88, 0.03, '#e8e8f0', { y: 0.47, z: 0.27 });
      torso.box(0.5, 0.12, 0.56, shade(c.topColor, 0.7), { y: 0.91 });
      for (const s of [1, -1]) torso.box(0.05, 0.95, 0.54, accent, { x: s * 0.49, y: 0.475, glow: 0.9 });
      break;
    }
    case 'holo': {
      torso.box(1, 0.95, 0.5, sleeveColorOf(c), { y: 0.475 });
      torso.box(0.78, 0.5, 0.06, c.topColor, { y: 0.62, z: 0.26, glow: 0.35 });
      torso.box(0.22, 0.22, 0.04, accent, { y: 0.62, z: 0.3, rz: Math.PI / 4, glow: 1.4 });
      for (const s of [1, -1]) {
        torso.box(0.03, 0.36, 0.03, accent, { x: s * 0.3, y: 0.24, z: 0.27, glow: 1.1 });
        torso.box(0.25, 0.03, 0.03, accent, { x: s * 0.2, y: 0.1, z: 0.27, glow: 1.1 });
      }
      torso.box(0.84, 0.03, 0.03, accent, { y: 0.82, z: -0.27, glow: 1 });
      torso.box(0.84, 0.03, 0.03, accent, { y: 0.18, z: -0.27, glow: 1 });
      break;
    }
    case 'apsara': {
      torso.box(0.96, 0.95, 0.5, c.topColor, { y: 0.475 });
      torso.box(1.04, 0.14, 0.56, GOLD, { y: 0.88, glow: 0.2 });
      torso.box(0.6, 0.16, 0.05, GOLD, { y: 0.74, z: 0.27, glow: 0.2 });
      torso.box(0.12, 0.12, 0.04, accent, { y: 0.72, z: 0.3, rz: Math.PI / 4, glow: 1.3 });
      torso.box(1, 0.09, 0.54, GOLD, { y: 0.14, glow: 0.2 });
      torso.box(0.14, 0.14, 0.04, accent, { y: 0.14, z: 0.28, rz: Math.PI / 4, glow: 1.3 });
      break;
    }
    default: {
      torso.box(1, 0.95, 0.5, c.topColor, { y: 0.475 });
      torso.box(0.2, 0.2, 0.04, accent, { y: 0.6, z: 0.26, rz: Math.PI / 4, glow: 1 });
    }
  }
  torso.box(1.03, 0.08, 0.53, c.pants === 'sampot' ? GOLD : '#101014', { y: 0.03, glow: c.pants === 'sampot' ? 0.2 : 0 });
  if (c.pants === 'tutu') {
    // Layered tulle skirt (rides on the torso so it sways with the dance).
    torso.cyl(0.56, 0.84, 0.24, 16, c.pantsColor, { y: -0.08, glow: 0.35 });
    torso.cyl(0.6, 0.92, 0.1, 16, accent, { y: -0.21, glow: 0.7 });
  }

  // ---------------------------------------------------------------- arms (pivot at shoulder)
  const sleeves = SLEEVES[c.top] || 'short';
  const sleeveColor = sleeveColorOf(c);
  const upper = sleeves === 'none' ? skin : sleeveColor;
  const sleevePattern = c.top === 'kroma' ? 1 : 0;
  for (const [A, side] of [[armL, 1], [armR, -1]]) {
    A.box(0.4, 0.42, 0.42, upper, { y: -0.21, pattern: sleevePattern });
    A.box(0.38, 0.3, 0.4, sleeves === 'long' ? sleeveColor : skin, { y: -0.57, pattern: sleevePattern });
    if (sleeves === 'long') A.box(0.4, 0.05, 0.42, accent, { y: -0.7, glow: CUFF_GLOW[c.top] || 0 });
    if (c.top === 'trackjkt') A.box(0.05, 0.74, 0.43, accent, { x: side * 0.19, y: -0.36, glow: 0.9 });
    if (c.top === 'bomber') A.box(0.42, 0.05, 0.44, accent, { y: -0.12, glow: 1 });
    if (c.top === 'holo') A.box(0.44, 0.14, 0.46, c.topColor, { y: -0.08, glow: 0.4 });
    if (c.top === 'jersey') A.box(0.42, 0.05, 0.44, accent, { y: -0.36, glow: 0.8 });
    if (c.top === 'apsara') A.box(0.42, 0.07, 0.44, GOLD, { y: -0.3, glow: 0.2 });
    const gloves = c.hands === 'gloves';
    A.box(0.36, 0.16, 0.38, gloves ? accent : skin, { y: -0.8, glow: gloves ? 0.9 : 0 });
    if (c.hands === 'bracelets') {
      A.box(0.42, 0.05, 0.44, accent, { y: -0.62, glow: 1 });
      A.box(0.42, 0.05, 0.44, side > 0 ? '#ff2bd6' : '#00f0ff', { y: -0.69, glow: 1 });
    }
    if (c.hands === 'kandi') {
      for (let k = 0; k < 4; k++) A.box(0.43, 0.045, 0.45, KANDI[(k + (side > 0 ? 0 : 2)) % KANDI.length], { y: -0.56 - k * 0.055, glow: 0.9 });
    }
    if (c.hands === 'sticks') A.cyl(0.045, 0.045, 0.62, 6, accent, { y: -0.8, z: 0.28, rx: Math.PI / 2, glow: 1.3 });
    if (c.hands === 'poi') {
      A.cyl(0.012, 0.012, 0.42, 4, '#c8c8d4', { y: -1.08 });
      A.sphere(0.11, 10, 8, side > 0 ? accent : '#ff2bd6', { y: -1.32, glow: 1.5 });
    }
  }
  // Spare glowsticks (in the hands, so on the forearm) shown during the stick dances when none are equipped.
  stickL.cyl(0.045, 0.045, 0.62, 6, accent, { y: -0.8 - ELBOW, z: 0.28, rx: Math.PI / 2, glow: 1.3 });
  stickR.cyl(0.045, 0.045, 0.62, 6, '#ff2bd6', { y: -0.8 - ELBOW, z: 0.28, rx: Math.PI / 2, glow: 1.3 });

  // ---------------------------------------------------------------- head (pivot at neck)
  head.box(0.3, 0.12, 0.3, skin, { y: 0.04 });
  head.box(0.72, 0.72, 0.72, skin, { y: 0.46 });
  if (face) {
    for (const s of [1, -1]) {
      head.box(0.1, 0.14, 0.03, '#111118', { x: s * 0.15, y: 0.54, z: 0.365 });
      head.box(0.04, 0.04, 0.02, '#ffffff', { x: s * 0.15 + 0.02, y: 0.58, z: 0.38 });
      head.box(0.05, 0.05, 0.03, '#3a1a1a', { x: s * 0.13, y: 0.33, z: 0.365 });
    }
    head.box(0.22, 0.05, 0.03, '#3a1a1a', { y: 0.3, z: 0.365 });
  }

  buildHair(head, c.hair, c.hairColor, accent, COVERS_TOP.has(c.head), face);
  buildHeadwear(head, c.head, c.topColor, accent);
  if (face) buildEyewear(head, c.eyes, accent);

  return {
    cfg: c,
    accent,
    torso: torso.build(),
    head: head.build(),
    armL: armL.upper.build(),
    foreL: armL.lower.build(),
    armR: armR.upper.build(),
    foreR: armR.lower.build(),
    legL: legL.upper.build(),
    shinL: legL.lower.build(),
    legR: legR.upper.build(),
    shinR: legR.lower.build(),
    stickL: stickL.build(),
    stickR: stickR.build(),
  };
}

/**
 * Far-LOD stand-in: the whole raver as one static mesh of ~10 boxes in its own colours
 * (one draw call, no skeleton to animate). Proportions match the rest pose.
 */
export function buildImpostorGeometry(input) {
  const c = normalizeAvatar(input);
  const accent = accentColor(c.accent);
  const P = new Parts();
  const upper = SLEEVES[c.top] === 'none' ? c.skin : sleeveColorOf(c);
  for (const s of [1, -1]) {
    P.box(0.46, 0.95, 0.48, c.pantsColor, { x: s * 0.24, y: 0.475 });
    P.box(0.4, 0.88, 0.42, upper, { x: s * 0.7, y: 1.37 });
  }
  const body = c.top === 'holo' ? sleeveColorOf(c) : c.topColor;
  P.box(1, 0.95, 0.5, body, { y: 1.425, pattern: c.top === 'kroma' ? 1 : 0, glow: c.top === 'vest' ? 0.25 : 0 });
  P.box(1.02, 0.07, 0.52, accent, { y: 1.25, glow: 1 });
  P.box(0.72, 0.72, 0.72, c.skin, { y: 2.36 });
  if (c.hair !== 'none') P.box(0.76, 0.14, 0.76, c.hairColor, { y: 2.74 });
  if (c.head !== 'none') P.box(0.8, 0.12, 0.8, c.head === 'crown' ? GOLD : c.head === 'bandana' ? '#c4122f' : accent, { y: 2.86, glow: 0.8 });
  return P.build();
}

function buildHair(P, style, color, accent, covered, fringe = true) {
  const cap = () => P.box(0.76, 0.12, 0.76, color, { y: 0.84 });
  const back = (h) => P.box(0.76, h, 0.08, color, { y: 0.82 - h / 2, z: -0.37 });
  switch (style) {
    case 'buzz':
      cap();
      back(0.3);
      break;
    case 'spiky':
      cap();
      back(0.36);
      if (!covered) {
        const spots = [[0, 0], [0.2, 0.15], [-0.2, 0.15], [0.2, -0.15], [-0.2, -0.15], [0, 0.28], [0, -0.26]];
        for (const [x, z] of spots) P.cone(0.13, 0.36, 4, color, { x, y: 1.05, z, rx: z * 0.9, rz: -x * 0.9 });
      }
      break;
    case 'topknot':
      cap();
      back(0.42);
      if (!covered) {
        P.sphere(0.2, 10, 8, color, { y: 1.08 });
        P.torus(0.12, 0.035, 6, 14, accent, { y: 0.93, rx: Math.PI / 2, glow: 1 });
      }
      break;
    case 'long':
      cap();
      P.box(0.8, 1.0, 0.12, color, { y: 0.36, z: -0.38 });
      for (const s of [1, -1]) P.box(0.08, 0.7, 0.62, color, { x: s * 0.4, y: 0.5, z: -0.04 });
      if (fringe) P.box(0.76, 0.12, 0.06, color, { y: 0.76, z: 0.37 });
      break;
    case 'mohawk':
      P.box(0.74, 0.04, 0.74, shade(color, 0.55), { y: 0.83 });
      if (!covered) {
        for (let i = 0; i < 5; i++) {
          const h = 0.2 + 0.1 * (2 - Math.abs(i - 2));
          P.box(0.14, h, 0.16, color, { y: 0.84 + h / 2, z: 0.3 - i * 0.15 });
        }
      }
      break;
    case 'afro':
      if (!covered) P.sphere(0.56, 12, 9, color, { y: 0.86, z: -0.1, sy: 0.78 });
      else {
        back(0.5);
        for (const s of [1, -1]) P.box(0.14, 0.4, 0.6, color, { x: s * 0.41, y: 0.62, z: -0.06 });
      }
      break;
    case 'bob':
      cap();
      P.box(0.8, 0.62, 0.1, color, { y: 0.52, z: -0.38 });
      for (const s of [1, -1]) P.box(0.1, 0.56, 0.72, color, { x: s * 0.41, y: 0.54 });
      if (fringe) P.box(0.78, 0.16, 0.08, color, { y: 0.74, z: 0.38 });
      break;
    default:
      break;
  }
}

function buildHeadwear(P, type, topColor, accent) {
  switch (type) {
    case 'bucket':
      P.cyl(0.42, 0.45, 0.3, 12, '#1d1d2b', { y: 0.98 });
      P.cyl(0.465, 0.465, 0.07, 12, accent, { y: 0.87, glow: 1.2 });
      P.cyl(0.5, 0.68, 0.07, 12, '#1d1d2b', { y: 0.8 });
      break;
    case 'cap':
      P.box(0.78, 0.24, 0.78, topColor, { y: 0.92 });
      P.box(0.72, 0.05, 0.42, shade(topColor, 0.7), { y: 0.82, z: 0.55 });
      P.box(0.18, 0.12, 0.03, accent, { y: 0.93, z: 0.395, glow: 1 });
      break;
    case 'phones':
      P.box(0.86, 0.07, 0.14, '#24242c', { y: 0.9 });
      for (const s of [1, -1]) {
        P.box(0.07, 0.34, 0.14, '#24242c', { x: s * 0.43, y: 0.72 });
        P.box(0.14, 0.32, 0.32, '#111116', { x: s * 0.44, y: 0.5 });
        P.torus(0.12, 0.025, 6, 16, accent, { x: s * 0.52, y: 0.5, ry: Math.PI / 2, glow: 1.2 });
      }
      break;
    case 'halo':
      P.torus(0.34, 0.04, 8, 28, accent, { y: 1.14, rx: Math.PI / 2, glow: 1.4 });
      break;
    case 'crown': {
      const gold = GOLD;
      P.cyl(0.4, 0.42, 0.12, 10, gold, { y: 0.86, glow: 0.15 });
      P.cyl(0.3, 0.38, 0.14, 10, gold, { y: 0.99, glow: 0.15 });
      P.cyl(0.2, 0.28, 0.14, 10, gold, { y: 1.12, glow: 0.15 });
      P.cone(0.18, 0.5, 10, gold, { y: 1.44, glow: 0.2 });
      P.torus(0.42, 0.03, 6, 20, accent, { y: 0.82, rx: Math.PI / 2, glow: 1.2 });
      P.sphere(0.06, 6, 4, accent, { y: 1.72, glow: 1.6 });
      break;
    }
    case 'ears':
      P.box(0.78, 0.05, 0.12, '#1d1d2b', { y: 0.84 });
      for (const s of [1, -1]) {
        P.cone(0.15, 0.32, 4, '#1d1d2b', { x: s * 0.24, y: 0.99, ry: Math.PI / 4, rz: -s * 0.25 });
        P.cone(0.09, 0.22, 4, accent, { x: s * 0.24, y: 0.97, z: 0.035, ry: Math.PI / 4, rz: -s * 0.25, glow: 1.3 });
      }
      break;
    case 'horns':
      for (const s of [1, -1]) P.cone(0.09, 0.38, 8, accent, { x: s * 0.22, y: 1.0, z: 0.06, rz: -s * 0.45, glow: 1.4 });
      break;
    case 'bandana':
      // Cambodian kroma tied as a head wrap, knot at the back.
      P.box(0.8, 0.2, 0.8, '#c4122f', { y: 0.8, pattern: 1 });
      P.box(0.66, 0.08, 0.66, '#c4122f', { y: 0.93, pattern: 1 });
      for (const s of [1, -1]) P.box(0.08, 0.26, 0.05, '#c4122f', { x: s * 0.07, y: 0.62, z: -0.43, rz: s * 0.35, pattern: 1 });
      break;
    default:
      break;
  }
}

function buildEyewear(P, type, accent) {
  switch (type) {
    case 'shutter':
      P.box(0.68, 0.2, 0.05, '#0d0d12', { y: 0.52, z: 0.38 });
      for (let k = 0; k < 4; k++) P.box(0.64, 0.025, 0.06, accent, { y: 0.45 + k * 0.045, z: 0.4, glow: 1.1 });
      for (const s of [1, -1]) P.box(0.03, 0.04, 0.32, accent, { x: s * 0.37, y: 0.56, z: 0.22, glow: 1 });
      break;
    case 'visor':
      P.box(0.78, 0.15, 0.08, accent, { y: 0.53, z: 0.38, glow: 1.2 });
      for (const s of [1, -1]) P.box(0.06, 0.15, 0.42, accent, { x: s * 0.39, y: 0.53, z: 0.19, glow: 1 });
      break;
    case 'round':
      for (const s of [1, -1]) {
        P.cyl(0.13, 0.13, 0.04, 14, '#0b0b10', { x: s * 0.16, y: 0.53, z: 0.385, rx: Math.PI / 2 });
        P.torus(0.13, 0.018, 4, 16, accent, { x: s * 0.16, y: 0.53, z: 0.39, glow: 0.7 });
      }
      P.box(0.08, 0.025, 0.03, '#9a9aa8', { y: 0.56, z: 0.39 });
      break;
    case 'goggles':
      P.box(0.75, 0.07, 0.75, '#222230', { y: 0.53 });
      for (const s of [1, -1]) {
        P.cyl(0.15, 0.15, 0.1, 14, '#15151c', { x: s * 0.16, y: 0.53, z: 0.39, rx: Math.PI / 2 });
        P.cyl(0.11, 0.11, 0.02, 14, accent, { x: s * 0.16, y: 0.53, z: 0.445, rx: Math.PI / 2, glow: 1.1 });
      }
      break;
    case 'ledmask':
      // Covers the mouth; three glowing equaliser bars.
      P.box(0.62, 0.3, 0.06, '#0d0d12', { y: 0.32, z: 0.38 });
      for (let k = 0; k < 3; k++) P.box(0.46 - k * 0.12, 0.035, 0.02, accent, { y: 0.4 - k * 0.075, z: 0.415, glow: 1.3 });
      for (const s of [1, -1]) P.box(0.03, 0.04, 0.4, '#0d0d12', { x: s * 0.37, y: 0.4, z: 0.18 });
      break;
    default:
      break;
  }
}
