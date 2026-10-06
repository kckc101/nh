// Mega-stage: deck, elevated DJ booth with decks, LED wall + side screens, high truss,
// line arrays and sub stacks, and a neon-outlined Angkor Wat crown (five prangs).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowMaterial, hdr } from './shaders.js';
import { LedWall } from './ledwall.js';
import { neonTexture, kromaTexture, KHMER_FONT } from './textures.js';

export const STAGE = {
  front: -22,
  deckY: 2.6,
  riserY: 3.6,
  dj: new THREE.Vector3(0, 3.6, -29.8),
  table: { minX: -2.6, maxX: 2.6, minZ: -29.3, maxZ: -27.9 },
  riser: { minX: -5, maxX: 5, minZ: -32, maxZ: -26.5 },
  bounds: { minX: -22.5, maxX: 22.5, minZ: -37.5, maxZ: -22.6 },
};

const UP = new THREE.Vector3(0, 1, 0);

function strut(list, a, b, t = 0.09) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.BoxGeometry(t, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(UP, d.normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  list.push(g);
}

/** Square box-truss between two points along one axis, with rungs and zig-zag bracing. */
function truss(list, from, to, size = 0.9, step = 1.4) {
  const axis = new THREE.Vector3().subVectors(to, from);
  const len = axis.length();
  axis.normalize();
  const helper = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(axis, helper).normalize().multiplyScalar(size / 2);
  const v = new THREE.Vector3().crossVectors(axis, u).normalize().multiplyScalar(size / 2);
  const corners = [u.clone().add(v), u.clone().sub(v), u.clone().negate().sub(v), u.clone().negate().add(v)];
  for (const c of corners) strut(list, from.clone().add(c), to.clone().add(c), 0.1);
  const n = Math.max(1, Math.round(len / step));
  for (let i = 0; i <= n; i++) {
    const p = from.clone().addScaledVector(axis, (len * i) / n);
    for (let k = 0; k < 4; k++) {
      const c1 = corners[k];
      const c2 = corners[(k + 1) % 4];
      strut(list, p.clone().add(c1), p.clone().add(c2), 0.06);
      if (i < n) {
        const p2 = from.clone().addScaledVector(axis, (len * (i + 1)) / n);
        strut(list, p.clone().add(i % 2 ? c1 : c2), p2.clone().add(i % 2 ? c2 : c1), 0.05);
      }
    }
  }
}

export class Stage {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.dark = new THREE.MeshLambertMaterial({ color: '#16131d' });
    this.metal = new THREE.MeshLambertMaterial({ color: '#5a5f72' });
    this.stone = new THREE.MeshLambertMaterial({ color: '#1d1628' });
    this.neonA = glowMaterial('#00f0ff', 2.2);
    this.neonB = glowMaterial('#ff2bd6', 2.2);
    this.strobeMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.stripMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.angkorLine = new THREE.LineBasicMaterial({ color: hdr('#ffc400', 2.5) });
    this.cones = [];
    this.platters = [];
    // Sub-woofer stacks stand in the crowd area.
    this.obstacles = [-1, 1].map((s) => ({ minX: s > 0 ? 27.2 : -31.9, maxX: s > 0 ? 31.9 : -27.2, minZ: -18.6, maxZ: -16.4 }));
    this.led = new LedWall();

    this.co2Points = [-20, -12, -4, 4, 12, 20].map((x) => new THREE.Vector3(x, 3.4, -22.9));
    this.flamePoints = [-22.5, -15, 15, 22.5].map((x) => new THREE.Vector3(x, 3.1, -22.9));

    this.buildDeck();
    this.buildBooth();
    this.buildScreens();
    this.buildTruss();
    this.buildSpeakers();
    this.buildAngkor();
    this.buildEmitters();
  }

  add(geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  buildDeck() {
    this.add(new THREE.BoxGeometry(48, 2.6, 18), this.dark, 0, 1.3, -31);
    const front = neonTexture(
      [{ text: 'E-RAVE CAMBODIA  •  កម្ពុជា  •  E-RAVE CAMBODIA', size: 92, y: 64, color: '#ff2bd6', font: KHMER_FONT }],
      2048,
      128,
    );
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 2.3),
      new THREE.MeshBasicMaterial({ map: front, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: hdr('#ffffff', 1.4) }),
    );
    plane.position.set(0, 1.3, -21.98);
    this.group.add(plane);
    this.add(new THREE.BoxGeometry(48, 0.14, 0.14), this.stripMat, 0, 2.62, -22.02);
    // crowd barrier
    const bars = [];
    for (let x = -24; x <= 24; x += 2) {
      bars.push(new THREE.BoxGeometry(0.08, 1.2, 0.08).translate(x, 0.6, -19.6));
    }
    bars.push(new THREE.BoxGeometry(48, 0.08, 0.08).translate(0, 1.15, -19.6));
    bars.push(new THREE.BoxGeometry(48, 0.08, 0.08).translate(0, 0.35, -19.6));
    this.add(mergeGeometries(bars), this.metal);
  }

  buildBooth() {
    const r = STAGE.riser;
    this.add(new THREE.BoxGeometry(r.maxX - r.minX, 1, r.maxZ - r.minZ), this.dark, 0, 3.1, (r.minZ + r.maxZ) / 2);
    this.kromaMat = new THREE.MeshBasicMaterial({ map: kromaTexture('#000000', 6), color: hdr('#ff2bd6', 1.2) });
    const facade = new THREE.Mesh(new THREE.PlaneGeometry(10, 1), this.kromaMat);
    facade.position.set(0, 3.1, r.maxZ + 0.01);
    this.group.add(facade);

    const t = STAGE.table;
    this.add(new THREE.BoxGeometry(t.maxX - t.minX, 1, t.maxZ - t.minZ), this.dark, 0, 4.1, (t.minZ + t.maxZ) / 2);
    const logo = neonTexture([{ text: 'E-RAVE', size: 170, y: 128, color: '#00f0ff' }], 1024, 256);
    const lp = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 1.1),
      new THREE.MeshBasicMaterial({ map: logo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: hdr('#ffffff', 1.5) }),
    );
    lp.position.set(0, 4.1, t.maxZ + 0.01);
    this.group.add(lp);

    const deckTop = 4.6;
    for (const x of [-1.7, 1.7]) {
      this.add(new THREE.BoxGeometry(1.4, 0.12, 1.1), this.metal, x, deckTop + 0.06, -28.6);
      const platter = this.add(new THREE.CylinderGeometry(0.48, 0.48, 0.05, 24), this.dark, x, deckTop + 0.15, -28.6);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.49, 0.025, 6, 32), this.neonB);
      ring.rotation.x = Math.PI / 2;
      platter.add(ring);
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 0.05), this.neonA);
      mark.position.set(0.2, 0.03, 0);
      platter.add(mark);
      this.platters.push(platter);
    }
    this.add(new THREE.BoxGeometry(1.2, 0.14, 1), this.metal, 0, deckTop + 0.07, -28.6);
    const knobs = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) knobs.push(new THREE.BoxGeometry(0.1, 0.06, 0.1).translate(-0.3 + i * 0.3, deckTop + 0.17, -28.95 + j * 0.22));
    this.add(mergeGeometries(knobs), this.neonA);
  }

  buildScreens() {
    const wall = this.add(new THREE.PlaneGeometry(32, 14), this.led.material(32 / 14, 192), 0, 11, -38.6);
    wall.renderOrder = 1;
    this.add(new THREE.BoxGeometry(33.2, 15.2, 0.6), this.dark, 0, 11, -39.05);
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 31.5, 0, -27);
      g.rotation.y = -s * 0.45;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(8, 11), this.led.material(8 / 11, 56, false));
      scr.position.y = 9.5;
      g.add(scr);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(8.6, 11.6, 0.5), this.dark);
      frame.position.set(0, 9.5, -0.3);
      g.add(frame);
      for (const lx of [-3, 3]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 0.3), this.metal);
        leg.position.set(lx, 2, -0.3);
        g.add(leg);
      }
      this.group.add(g);
    }
  }

  buildTruss() {
    const list = [];
    const H = 22;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const x of [-26, 26]) for (const z of [-23, -39]) truss(list, V(x, 0, z), V(x, H, z));
    truss(list, V(-26, H, -23), V(26, H, -23));
    truss(list, V(-26, H, -39), V(26, H, -39));
    truss(list, V(-26, H, -23), V(-26, H, -39));
    truss(list, V(26, H, -23), V(26, H, -39));
    truss(list, V(-26, H, -31), V(26, H, -31));
    this.add(mergeGeometries(list), this.metal);
    for (const g of list) g.dispose();

    // Strobe panels hung under the front truss.
    const strobes = [];
    for (let i = 0; i < 8; i++) strobes.push(new THREE.BoxGeometry(1.4, 0.45, 0.25).translate(-21 + i * 6, 21.2, -22.5));
    this.add(mergeGeometries(strobes), this.strobeMat);
  }

  buildSpeakers() {
    const cabs = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const g = new THREE.BoxGeometry(2.2, 0.7, 1.4);
        g.rotateX(-0.05 - i * 0.07);
        g.translate(s * 23.5, 19.5 - i * 0.74, -22.3 + i * 0.06);
        cabs.push(g);
      }
      for (let col = 0; col < 2; col++) {
        for (let row = 0; row < 3; row++) {
          const x = s * (28.4 + col * 2.3);
          const y = 0.75 + row * 1.5;
          cabs.push(new THREE.BoxGeometry(2.2, 1.5, 1.8).translate(x, y, -17.5));
          const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.2, 20), this.dark);
          cone.rotation.x = Math.PI / 2;
          cone.position.set(x, y, -16.55);
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.04, 6, 24), (col + row) % 2 ? this.neonA : this.neonB);
          ring.position.set(x, y, -16.58);
          this.group.add(cone, ring);
          this.cones.push(cone);
        }
      }
    }
    this.add(mergeGeometries(cabs), this.dark);
  }

  buildAngkor() {
    const profile = [
      [0, 0], [0.5, 0], [0.5, 0.06], [0.45, 0.06], [0.45, 0.15], [0.41, 0.15], [0.43, 0.21], [0.37, 0.27],
      [0.39, 0.33], [0.32, 0.39], [0.34, 0.45], [0.27, 0.51], [0.28, 0.57], [0.21, 0.63], [0.21, 0.69],
      [0.14, 0.75], [0.13, 0.82], [0.07, 0.9], [0.035, 0.96], [0, 1],
    ].map(([r, h]) => new THREE.Vector2(r, h));
    const towers = [
      [0, 6.2, 11, -39.6],
      [-8.6, 4.6, 8, -39.3],
      [8.6, 4.6, 8, -39.3],
      [-16, 3.6, 6, -39],
      [16, 3.6, 6, -39],
    ];
    const solids = [];
    const edges = [];
    for (const [x, w, h, z] of towers) {
      const g = new THREE.LatheGeometry(profile, 8);
      g.scale(w, h, w);
      g.translate(x, 19.1, z);
      solids.push(g);
      edges.push(new THREE.EdgesGeometry(g, 20));
    }
    const gallery = new THREE.BoxGeometry(38, 1.2, 2.6).translate(0, 18.5, -39.2);
    solids.push(gallery.toNonIndexed());
    edges.push(new THREE.EdgesGeometry(gallery));
    // LatheGeometry is non-indexed-compatible only after conversion; normalise all to non-indexed.
    const merged = mergeGeometries(solids.map((g) => (g.index ? g.toNonIndexed() : g)));
    this.add(merged, this.stone);
    const lines = new THREE.LineSegments(mergeGeometries(edges), this.angkorLine);
    this.group.add(lines);
  }

  buildEmitters() {
    const parts = [];
    for (const p of this.co2Points) parts.push(new THREE.CylinderGeometry(0.22, 0.3, 0.8, 10).translate(p.x, 3.0, p.z));
    for (const p of this.flamePoints) parts.push(new THREE.BoxGeometry(0.8, 0.5, 0.8).translate(p.x, 2.85, p.z));
    this.add(mergeGeometries(parts), this.metal);
    const tops = this.flamePoints.map((p) => new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(p.x, 3.12, p.z));
    this.add(mergeGeometries(tops), glowMaterial('#ff6a1f', 2));
  }

  update(dt, t, M, mood, palette) {
    this.led.update(dt, t, M, mood, palette);
    for (const p of this.platters) p.rotation.y -= dt * 3.5;
    const push = M.kick * mood.lights;
    for (const c of this.cones) c.scale.y = 1 + push * 1.8;
    const pulse = 1.2 + M.bass * 2.2 * mood.lights;
    this.neonA.color.copy(palette[0]).multiplyScalar(pulse);
    this.neonB.color.copy(palette[1]).multiplyScalar(pulse);
    this.kromaMat.color.copy(palette[1]).multiplyScalar(0.8 + M.kick * 1.5);
    this.stripMat.color.copy(palette[(M.beatCount >> 1) & 1]).multiplyScalar(1.5 + M.kick * 2);
    this.angkorLine.color.copy(palette[2] || palette[0]).multiplyScalar((1.6 + M.bass * 2.5) * Math.max(0.25, mood.lights));
    this.strobeMat.color.setScalar(0.08 + mood.strobe * 9);
  }
}
