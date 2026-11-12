// Crowd-area light rig: LED halo rings hung high over the dance floor, a laser "liquid sky"
// sheet just above head height, and warm audience blinders on the front truss.

import * as THREE from 'three';
import { haloMaterial, sheetMaterial } from './shaders.js';
import { glowTexture } from './textures.js';

const WARM = new THREE.Color(1.6, 1.25, 0.85);
const WHITE = new THREE.Color(2.4, 2.4, 2.55);

const RINGS = [
  { z: -4, r: 7, y: 15 },
  { z: 13, r: 9.5, y: 17 },
  { z: 30, r: 7, y: 15 },
];

export class CrowdRig {
  constructor(scene) {
    // ---------------------------------------------------------------- halo rings
    this.rings = RINGS.map((cfg, i) => {
      const g = new THREE.Group();
      g.position.set(0, cfg.y, cfg.z);
      const outer = haloMaterial();
      const inner = haloMaterial();
      inner.uniforms.uSeg.value = 56;
      g.add(new THREE.Mesh(new THREE.TorusGeometry(cfg.r, 0.09, 6, 144), outer));
      g.add(new THREE.Mesh(new THREE.TorusGeometry(cfg.r - 0.6, 0.045, 6, 120), inner));
      scene.add(g);
      return { g, outer, inner, phase: i * 2.1 };
    });
    // Rigging cables up into the dark.
    const cable = [];
    for (const cfg of RINGS) {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2;
        const x = Math.cos(a) * cfg.r;
        const z = cfg.z + Math.sin(a) * cfg.r;
        cable.push(x, cfg.y, z, x * 0.6, 60, cfg.z + (z - cfg.z) * 0.6);
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cable, 3));
    scene.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: '#1b1726' })));

    // ---------------------------------------------------------------- laser sheet
    this.sheetMat = sheetMaterial();
    this.sheet = new THREE.Mesh(new THREE.PlaneGeometry(72, 62), this.sheetMat);
    this.sheet.rotation.x = -Math.PI / 2;
    this.sheet.position.set(0, 5.4, 11);
    this.sheet.renderOrder = 3;
    this.sheet.frustumCulled = false;
    scene.add(this.sheet);
    this.sheetLevel = 0;

    // ---------------------------------------------------------------- blinders
    this.blinders = [];
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture(),
          color: new THREE.Color(1.6, 1.25, 0.85),
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      s.position.set(-21 + i * 6, 24.2, -22.1); // under the front truss (25 m)
      s.scale.setScalar(4.5);
      s.visible = false;
      scene.add(s);
      this.blinders.push(s);
    }
    this.lite = false;
  }

  /** Weak-GPU tier: drop the full-screen-ish additive sheet. */
  setLite(on) {
    this.lite = on;
  }

  update(dt, t, M, mood, palette) {
    // Barely-there outlines most of the night; they wake up with the drop.
    const level = (0.1 + 0.55 * Math.max(0, mood.lights - 0.3)) * mood.floorDim;
    this.rings.forEach((r, i) => {
      r.g.rotation.set(Math.PI / 2 + 0.22 * Math.sin(t * 0.3 + r.phase), 0, 0.22 * Math.cos(t * 0.25 + r.phase));
      for (const [mat, a, b] of [[r.outer, i, i + 1], [r.inner, i + 1, i + 2]]) {
        const u = mat.uniforms;
        u.uTime.value = t * (mat === r.inner ? -1.3 : 1) + r.phase;
        u.uLevel.value = level;
        u.uKick.value = M.kick * mood.lights;
        u.uColA.value.copy(palette[a % 3]);
        u.uColB.value.copy(palette[b % 3]);
      }
    });

    this.sheetLevel += ((this.lite ? 0 : mood.sheet) - this.sheetLevel) * Math.min(1, dt * 2);
    this.sheet.visible = this.sheetLevel > 0.01;
    const su = this.sheetMat.uniforms;
    su.uTime.value = t;
    su.uLevel.value = this.sheetLevel * (0.45 + M.bass * 0.3);
    su.uColA.value.copy(palette[0]);
    su.uColB.value.copy(palette[2] || palette[1]);

    // Warm audience blinders; white and harder in a drop (the LightingDirector's hits).
    const b = mood.blinder;
    const white = mood.blinderWhite || 0;
    for (const s of this.blinders) {
      s.visible = b > 0.02;
      if (!s.visible) continue;
      s.material.opacity = Math.min(1, b * (0.7 + 0.3 * white));
      s.material.color.copy(WARM).lerp(WHITE, white);
      s.scale.setScalar(4.5 * (1 + 0.35 * b * white));
    }
  }
}
