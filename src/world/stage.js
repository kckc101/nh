// Mega-stage: deck, elevated DJ booth with decks, LED wall + side screens, high truss,
// line arrays and sub stacks, and a neon-outlined Angkor Wat crown (five prangs).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowMaterial, hdr, beamMaterial } from './shaders.js';
import { LedWall } from './ledwall.js';
import { neonTexture, kromaTexture, KHMER_FONT, glowTexture } from './textures.js';

export const STAGE = {
  front: -22,
  deckY: 2.6,
  riserY: 3.6,
  dj: new THREE.Vector3(0, 3.6, -29.8),
  table: { minX: -3.6, maxX: 3.6, minZ: -29.3, maxZ: -27.9 },
  riser: { minX: -7, maxX: 7, minZ: -32, maxZ: -26.5 },
  // Where the DJ can walk on the deck: in front of the curved LED wall all the way across.
  bounds: { minX: -26.5, maxX: 26.5, minZ: -33.5, maxZ: -22.6 },
  halfW: 28, // the deck, x -28 .. 28
  // The LED wall: 48 m of screen (along its curve) by 18 m, bowed toward the crowd on a 64 m radius.
  wall: { w: 48, h: 18, y: 12.2, z: -38.6, R: 64 },
  truss: { x: 28, h: 25 }, // the main truss towers (x ±28, z -23 / -39) and their height
};

/** z of the curved LED wall's face at x (the middle is the furthest back; the ends come forward). */
export const wallZAt = (x) => {
  const { z, R } = STAGE.wall;
  return z + R - Math.sqrt(Math.max(0, R * R - x * x));
};

/** A plane w x h bent round a vertical axis R in front of it (concave toward +z), segs across. */
function curvedPanel(w, h, R, segs) {
  const g = new THREE.PlaneGeometry(w, h, segs, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = p.getX(i) / R;
    p.setXYZ(i, R * Math.sin(a), p.getY(i), R * (1 - Math.cos(a)));
  }
  g.computeVertexNormals();
  return g;
}

/** The same faces turned to face the other way (for the back of a one-sided panel). */
function flipped(g) {
  const f = g.clone();
  const idx = f.index.array;
  for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  f.computeVertexNormals();
  return f;
}

const UP = new THREE.Vector3(0, 1, 0);
const CONE_TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2); // facing the crowd
const _m = new THREE.Matrix4();
const _scale = new THREE.Vector3();

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
    this.cones = null; // the speaker cones (buildSpeakers)
    this.platters = [];
    // What ravers bump into on the pitch: the sub stacks, the crowd barrier, the stage itself,
    // its truss legs and the side screens (the stage sits on the middle of the pitch, so the
    // crowd can walk round it).
    this.obstacles = [
      ...[-1, 1].map((s) => ({ minX: s > 0 ? 27.2 : -31.9, maxX: s > 0 ? 31.9 : -27.2, minZ: -18.6, maxZ: -16.4 })),
      { minX: -28.2, maxX: 28.2, minZ: -19.8, maxZ: -19.4 }, // barrier
      { minX: -28.3, maxX: 28.3, minZ: -40.3, maxZ: -21.8 }, // stage deck, LED wall
      ...[-28, 28].flatMap((x) => [-23, -39].map((z) => ({ x, z, r: 0.85 }))), // truss legs
      ...[-1, 1].map((s) => ({ x: s * 34.5, z: -31, r: 0.8 })), // wing towers
      ...[-1, 1].map((s) => ({ x: s * 34.5, z: -27, r: 4.4 })), // side screens
    ];
    this.led = new LedWall();

    this.flamePoints = [-26.5, -18, 18, 26.5].map((x) => new THREE.Vector3(x, 3.1, -22.9));

    this.buildDeck();
    this.buildBooth();
    this.buildScreens();
    this.buildTruss();
    this.buildSpeakers();
    this.buildAngkor();
    this.buildEmitters();
    this.buildDjLights();
    this.mergeStatic();
  }

  /**
   * Fold the stage's static parts into one mesh per material (the dark boxes, the metal
   * truss / barrier / legs): about 20 fewer draws. The moving parts (platters, speaker cones)
   * and the one-of-a-kind materials stay as they are.
   */
  mergeStatic() {
    this.group.updateMatrixWorld(true);
    for (const mat of [this.dark, this.metal]) {
      const meshes = [];
      this.group.traverse((o) => o.isMesh && !o.isInstancedMesh && o.material === mat && !this.platters.includes(o) && meshes.push(o));
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); // untextured
        return g.applyMatrix4(m.matrixWorld); // the group sits at the origin
      });
      for (const m of meshes) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      this.group.add(new THREE.Mesh(mergeGeometries(geos), mat));
      for (const g of geos) g.dispose();
    }
  }

  add(geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    this.group.add(m);
    return m;
  }

  buildDeck() {
    const W = STAGE.halfW * 2;
    this.add(new THREE.BoxGeometry(W, 2.6, 18), this.dark, 0, 1.3, -31);
    const front = neonTexture(
      [{ text: 'E-RAVE CAMBODIA  •  កម្ពុជា  •  E-RAVE CAMBODIA', size: 92, y: 64, color: '#ff2bd6', font: KHMER_FONT }],
      2048,
      128,
    );
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 2, 2.3),
      new THREE.MeshBasicMaterial({ map: front, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: hdr('#ffffff', 0.7) }),
    );
    plane.position.set(0, 1.3, -21.98);
    this.group.add(plane);
    this.add(new THREE.BoxGeometry(W, 0.14, 0.14), this.stripMat, 0, 2.62, -22.02);
    // crowd barrier
    const bars = [];
    for (let x = -STAGE.halfW; x <= STAGE.halfW; x += 2) {
      bars.push(new THREE.BoxGeometry(0.08, 1.2, 0.08).translate(x, 0.6, -19.6));
    }
    bars.push(new THREE.BoxGeometry(W, 0.08, 0.08).translate(0, 1.15, -19.6));
    bars.push(new THREE.BoxGeometry(W, 0.08, 0.08).translate(0, 0.35, -19.6));
    this.add(mergeGeometries(bars), this.metal);
  }

  buildBooth() {
    const r = STAGE.riser;
    this.add(new THREE.BoxGeometry(r.maxX - r.minX, 1, r.maxZ - r.minZ), this.dark, 0, 3.1, (r.minZ + r.maxZ) / 2);
    // Decals 1 cm off their boxes: depth-offset so they don't shimmer seen from far away.
    const decal = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
    this.kromaMat = new THREE.MeshBasicMaterial({ map: kromaTexture('#000000', 6), color: hdr('#ff2bd6', 1.2), ...decal });
    const facade = new THREE.Mesh(new THREE.PlaneGeometry(r.maxX - r.minX, 1), this.kromaMat);
    facade.position.set(0, 3.1, r.maxZ + 0.01);
    this.group.add(facade);

    const t = STAGE.table;
    this.add(new THREE.BoxGeometry(t.maxX - t.minX, 1, t.maxZ - t.minZ), this.dark, 0, 4.1, (t.minZ + t.maxZ) / 2);
    const logo = neonTexture([{ text: 'E-RAVE', size: 170, y: 128, color: '#00f0ff' }], 1024, 256);
    const lp = new THREE.Mesh(
      new THREE.PlaneGeometry(6.4, 1.3),
      new THREE.MeshBasicMaterial({ map: logo, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: hdr('#ffffff', 0.9), ...decal }),
    );
    lp.position.set(0, 4.1, t.maxZ + 0.01);
    this.group.add(lp);

    const deckTop = 4.6;
    // Four decks round the mixer (the booth is 14 m wide now, the table 7.2 m).
    for (const x of [-2.85, -1.4, 1.4, 2.85]) {
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
    // The LED wall: 48 x 18 m, curved toward the crowd (6 LED pixels a metre, as before), in a
    // dark frame a little bigger than it, closed at the back.
    const W = STAGE.wall;
    const wall = (this.wall = this.add(curvedPanel(W.w, W.h, W.R, 48), this.led.material(W.w / W.h, 288), 0, W.y, W.z));
    wall.renderOrder = 1;
    const frame = curvedPanel(W.w + 1.6, W.h + 1.4, W.R + 0.45, 48);
    this.add(frame, this.dark, 0, W.y, W.z - 0.45);
    this.add(flipped(frame), this.dark, 0, W.y, W.z - 0.5);
    this.sideScreens = []; // the towers' LED screens (the broadcast rig puts its raver feed on them)
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(s * 34.5, 0, -27);
      g.rotation.y = -s * 0.45;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(8, 11), this.led.material(8 / 11, 56, false));
      scr.position.y = 9.5;
      g.add(scr);
      this.sideScreens.push(scr);
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
    // Heavy box truss: four towers 25 m tall round the deck, a top frame with a beam across the
    // middle (the DJ's downlights hang from it), and wing towers behind the side screens tied into
    // the frame at the top.
    const list = [];
    const { x: X, h: H } = STAGE.truss;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const heavy = (a, b) => truss(list, a, b, 1.2, 1.5);
    for (const x of [-X, X]) for (const z of [-23, -39]) heavy(V(x, 0, z), V(x, H, z));
    heavy(V(-X, H, -23), V(X, H, -23));
    heavy(V(-X, H, -39), V(X, H, -39));
    heavy(V(-X, H, -23), V(-X, H, -39));
    heavy(V(X, H, -23), V(X, H, -39));
    heavy(V(-X, H, -31), V(X, H, -31));
    for (const s of [-1, 1]) {
      truss(list, V(s * 34.5, 0, -31), V(s * 34.5, H, -31), 0.9);
      truss(list, V(s * 34.5, H, -31), V(s * X, H, -31), 0.9);
    }
    this.add(mergeGeometries(list), this.metal);
    for (const g of list) g.dispose();

    // Laser mounts under the back truss, their apertures lit.
    const mounts = [];
    const apertures = [];
    for (const x of [-20, -12, -4, 4, 12, 20]) {
      mounts.push(new THREE.BoxGeometry(0.7, 0.55, 0.9).translate(x, H - 0.95, -39));
      apertures.push(new THREE.BoxGeometry(0.32, 0.12, 0.02).translate(x, H - 1.0, -38.54));
    }
    this.add(mergeGeometries(mounts), this.dark);
    this.add(mergeGeometries(apertures), this.neonA);

    // Strobe panels hung under the front truss.
    const strobes = [];
    for (let i = 0; i < 8; i++) strobes.push(new THREE.BoxGeometry(1.4, 0.45, 0.25).translate(-21 + i * 6, H - 0.8, -22.5));
    this.add(mergeGeometries(strobes), this.strobeMat);
  }

  buildSpeakers() {
    const cabs = [];
    const rings = [[], []]; // neonA, neonB
    const cones = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const g = new THREE.BoxGeometry(2.2, 0.7, 1.4);
        g.rotateX(-0.05 - i * 0.07);
        g.translate(s * 25.4, STAGE.truss.h - 2.5 - i * 0.74, -22.3 + i * 0.06);
        cabs.push(g);
      }
      for (let col = 0; col < 2; col++) {
        for (let row = 0; row < 3; row++) {
          const x = s * (28.4 + col * 2.3);
          const y = 0.75 + row * 1.5;
          cabs.push(new THREE.BoxGeometry(2.2, 1.5, 1.8).translate(x, y, -17.5));
          cones.push(new THREE.Vector3(x, y, -16.55));
          rings[(col + row) % 2].push(new THREE.TorusGeometry(0.58, 0.04, 6, 24).translate(x, y, -16.58));
        }
      }
    }
    this.add(mergeGeometries(cabs), this.dark);
    this.add(mergeGeometries(rings[0]), this.neonA);
    this.add(mergeGeometries(rings[1]), this.neonB);
    // The cones pump on the kick, all together: one instanced draw (update() moves them).
    const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.55, 0.45, 0.2, 20), this.dark, cones.length);
    this.cones = { mesh, at: cones, push: -1 };
    this.group.add(mesh);
    this.pumpCones(0);
  }

  /** The speaker cones pushed out by `push` (0 at rest). Only re-uploads when it changes. */
  pumpCones(push) {
    const c = this.cones;
    if (push === c.push) return;
    c.push = push;
    _scale.set(1, 1 + push * 1.8, 1);
    c.at.forEach((p, i) => c.mesh.setMatrixAt(i, _m.compose(p, CONE_TILT, _scale)));
    c.mesh.instanceMatrix.needsUpdate = true;
    c.mesh.computeBoundingSphere();
  }

  buildAngkor() {
    const profile = [
      [0, 0], [0.5, 0], [0.5, 0.06], [0.45, 0.06], [0.45, 0.15], [0.41, 0.15], [0.43, 0.21], [0.37, 0.27],
      [0.39, 0.33], [0.32, 0.39], [0.34, 0.45], [0.27, 0.51], [0.28, 0.57], [0.21, 0.63], [0.21, 0.69],
      [0.14, 0.75], [0.13, 0.82], [0.07, 0.9], [0.035, 0.96], [0, 1],
    ].map(([r, h]) => new THREE.Vector2(r, h));
    // Angkor Wat's front silhouette (as on the Cambodian flag): a tall central prang
    // flanked by two shorter ones, rising from a stepped terrace.
    const towers = [
      // x, width, height, base y, z
      [0, 6.6, 12, 23.5, -39.6],
      [-11, 5, 9, 22.5, -39.3],
      [11, 5, 9, 22.5, -39.3],
    ];
    const solids = [];
    const edges = [];
    for (const [x, w, h, y, z] of towers) {
      const g = new THREE.LatheGeometry(profile, 8);
      g.scale(w, h, w);
      g.translate(x, y, z);
      solids.push(g);
      edges.push(new THREE.EdgesGeometry(g, 20));
    }
    const terrace = new THREE.BoxGeometry(40, 1.2, 2.8).translate(0, 21.9, -39.3);
    const gallery = new THREE.BoxGeometry(20, 1, 2.4).translate(0, 23.0, -39.5);
    for (const g of [terrace, gallery]) {
      solids.push(g.toNonIndexed());
      edges.push(new THREE.EdgesGeometry(g));
    }
    // LatheGeometry is non-indexed-compatible only after conversion; normalise all to non-indexed.
    const merged = mergeGeometries(solids.map((g) => (g.index ? g.toNonIndexed() : g)));
    this.add(merged, this.stone);
    const lines = new THREE.LineSegments(mergeGeometries(edges), this.angkorLine);
    this.group.add(lines);
  }

  buildEmitters() {
    const parts = [];
    for (const p of this.flamePoints) parts.push(new THREE.BoxGeometry(0.8, 0.5, 0.8).translate(p.x, 2.85, p.z));
    this.add(mergeGeometries(parts), this.metal);
    const tops = this.flamePoints.map((p) => new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(p.x, 3.12, p.z));
    this.add(mergeGeometries(tops), glowMaterial('#ff6a1f', 2));
  }

  /**
   * The DJ's downlights: three fixtures on the middle truss beam straight over the booth, each a
   * hot lens and a soft beam down onto the decks, a pool of light on the riser, and one real
   * spotlight (no shadows) that lights the DJ and the decks. They punch on every kick (update).
   */
  buildDjLights() {
    const H = STAGE.truss.h;
    const target = new THREE.Vector3(0, STAGE.riserY + 1.2, STAGE.dj.z + 0.6);
    const housings = [];
    const lenses = [];
    this.djBeams = [];
    for (const x of [-2.6, 0, 2.6]) {
      const at = new THREE.Vector3(x, H - 1.1, -30.6);
      housings.push(new THREE.CylinderGeometry(0.32, 0.42, 0.75, 12).translate(at.x, at.y + 0.22, at.z));
      lenses.push(new THREE.CircleGeometry(0.3, 16).rotateX(Math.PI / 2).translate(at.x, at.y - 0.17, at.z));
      const dir = new THREE.Vector3().subVectors(target, at);
      const len = dir.length();
      // A cone from the lens (top) down to the deck: bright at the lens, softening as it spreads.
      const geo = new THREE.CylinderGeometry(0.28, 2.3, len, 24, 1, true).translate(0, -len / 2, 0);
      const beam = new THREE.Mesh(geo, beamMaterial('#fff1dc', 0.5, 0, 0.8));
      beam.position.copy(at);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      beam.renderOrder = 2;
      this.group.add(beam);
      this.djBeams.push(beam);
    }
    this.add(mergeGeometries(housings), this.dark);
    this.djLensMat = new THREE.MeshBasicMaterial({ color: hdr('#fff4e0', 3), toneMapped: false, side: THREE.DoubleSide });
    this.add(mergeGeometries(lenses), this.djLensMat);
    this.djPoolMat = new THREE.MeshBasicMaterial({
      map: glowTexture(), color: hdr('#fff0d8', 0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(8, 5.5), this.djPoolMat);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, STAGE.riserY + 0.02, STAGE.dj.z + 0.4);
    pool.renderOrder = 2;
    this.group.add(pool);
    const spot = (this.djSpot = new THREE.SpotLight('#fff1dc', 0, 40, 0.17, 0.55, 1.6));
    spot.position.set(0, H - 1.4, -30.6);
    spot.target.position.copy(target);
    this.group.add(spot, spot.target);
  }

  update(dt, t, M, mood, palette) {
    this.led.update(dt, t, M, mood, palette);
    // The DJ's downlights breathe with the kick: the booth punches on every beat.
    const dl = (0.45 + 0.8 * M.kick) * (0.6 + 0.4 * Math.max(0.25, mood.lights));
    for (const b of this.djBeams) b.material.uniforms.uIntensity.value = 0.5 * dl;
    this.djLensMat.color.setRGB(1, 0.96, 0.88).multiplyScalar(1.5 + 3 * dl);
    this.djPoolMat.color.setRGB(1, 0.94, 0.85).multiplyScalar(0.3 + 0.6 * dl);
    this.djSpot.intensity = 900 * dl;
    for (const p of this.platters) p.rotation.y -= dt * 3.5;
    this.pumpCones(Math.round(M.kick * mood.lights * 100) / 100);
    const pulse = 0.6 + M.bass * 1.1 * mood.lights;
    this.neonA.color.copy(palette[0]).multiplyScalar(pulse);
    this.neonB.color.copy(palette[1]).multiplyScalar(pulse);
    this.kromaMat.color.copy(palette[1]).multiplyScalar(0.4 + M.kick * 0.7);
    this.stripMat.color.copy(palette[0]).multiplyScalar(0.6 + M.kick * 1.0);
    this.angkorLine.color.copy(palette[2] || palette[0]).multiplyScalar((0.8 + M.bass * 1.0) * Math.max(0.3, mood.lights));
    this.strobeMat.color.setScalar(0.08 + mood.strobe * 9);
  }
}
