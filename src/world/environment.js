// Morodok Techo National Stadium, cyberpunk night: navy-black sky, the pitch as the dance floor
// (turf, pitch markings, the athletics track), the three-tier bowl with thousands of ravers
// dancing in the stands (fans.js), an LED ribbon board, VIP decks on the first tier east and west,
// cable-stayed roof canopies over the side stands, the twin 99 m Sampeah pylons at the north
// and south ends (their moving heads are in lights.js), pitch-side light towers, and the
// Phnom Penh skyline far outside. Layout constants live in venue.js.
//
// Everything is merged into a handful of meshes (≈ a dozen draw calls) and animated through
// uniforms only.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { floorMaterial, skyMaterial, buildingMaterial, standMaterial, roofMaterial, glowMaterial, beamMaterial, hdr } from './shaders.js';
import { StandCrowd } from './fans.js';
import { canvasTexture, KHMER_FONT, DISPLAY_FONT, neonTexture } from './textures.js';
import {
  CENTER_Z, STRAIGHT, PROFILE, VIP, PYLON, ROOF, WALL_D, outline, outlineSamples, bowlHeightAt, VENUE, SEAT_ROW_STEP,
} from './venue.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SIDE_TOWERS = [-6, 8, 22, 36]; // z of the pitch-side light towers (x = ±35.6)
export const SIDE_TOWER_X = 35.6;
export const SIDE_TOWER_TOP = 12;

/** Arc length along a list of outline points. */
function arcLengths(us, d) {
  const s = [0];
  const a = {};
  const b = {};
  for (let i = 1; i < us.length; i++) {
    outline(us[i - 1], d, a);
    outline(us[i], d, b);
    s.push(s[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  return s;
}

/** A strip between two (d, y) edges along u samples. Returns { pos, uv, data } arrays. */
function strip(us, d0, y0, d1, y1, kind, rows, extra = 0) {
  const pos = [];
  const data = [];
  const uv = [];
  const s = arcLengths(us, (d0 + d1) / 2);
  const a = {};
  const b = {};
  for (let i = 0; i < us.length - 1; i++) {
    outline(us[i], d0, a);
    const a0 = [a.x, y0, a.z];
    outline(us[i], d1, a);
    const a1 = [a.x, y1, a.z];
    outline(us[i + 1], d0, b);
    const b0 = [b.x, y0, b.z];
    outline(us[i + 1], d1, b);
    const b1 = [b.x, y1, b.z];
    for (const [p, v, sv] of [[a0, 0, s[i]], [b0, 0, s[i + 1]], [b1, 1, s[i + 1]], [a0, 0, s[i]], [b1, 1, s[i + 1]], [a1, 1, s[i]]]) {
      pos.push(...p);
      data.push(kind, v, rows, sv + extra);
      uv.push(sv, v);
    }
  }
  return { pos, uv, data };
}

/**
 * A seating tier as real steps: n rows (the rows of venue.js SEAT_ROWS, where the fans, the named
 * ravers and the seats are), each a level tread at its row's centre height and a riser up to it,
 * all the way round. aStep: 0 on the treads, 1 + t on the risers (t: 0 at the foot, 1 at the
 * nosing), for the LED strips (standMaterial). The walking ground stays the smooth slope
 * (venue.js bowlHeightAt), which meets every tread at its row's centre.
 */
function steps(us, d0, y0, d1, y1, n) {
  const pos = [];
  const uv = [];
  const data = [];
  const step = [];
  const s = arcLengths(us, (d0 + d1) / 2);
  const a = {};
  const b = {};
  const quad = (i, dA, yA, dB, yB, vA, vB, tA, tB) => {
    outline(us[i], dA, a);
    const a0 = [a.x, yA, a.z];
    outline(us[i], dB, a);
    const a1 = [a.x, yB, a.z];
    outline(us[i + 1], dA, b);
    const b0 = [b.x, yA, b.z];
    outline(us[i + 1], dB, b);
    const b1 = [b.x, yB, b.z];
    for (const [p, v, sv, t] of [[a0, vA, s[i], tA], [b0, vA, s[i + 1], tA], [b1, vB, s[i + 1], tB], [a0, vA, s[i], tA], [b1, vB, s[i + 1], tB], [a1, vB, s[i], tB]]) {
      pos.push(...p);
      data.push(0, v, n, s.length ? sv : 0);
      uv.push(sv, v);
      step.push(t);
    }
  };
  for (let i = 0; i < us.length - 1; i++) {
    let yPrev = y0;
    for (let k = 0; k <= n; k++) {
      const v0 = k / n;
      const d = d0 + (d1 - d0) * v0;
      const yRow = k < n ? y0 + ((y1 - y0) * (k + 0.5)) / n : y1;
      if (yRow > yPrev + 1e-3) quad(i, d, yPrev, d, yRow, v0, v0, 1, 2); // the riser
      if (k === n) break;
      quad(i, d, yRow, d0 + ((d1 - d0) * (k + 1)) / n, yRow, v0, (k + 1) / n, 0, 0); // the tread
      yPrev = yRow;
    }
  }
  return { pos, uv, data, step };
}

function geometryFrom({ pos, uv, data, step }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (data) g.setAttribute('aData', new THREE.Float32BufferAttribute(data, 4));
  g.setAttribute('aStep', new THREE.Float32BufferAttribute(step || new Array(pos.length / 3).fill(0), 1));
  g.computeVertexNormals();
  return g;
}

/** Tapered, flattened tube along a curve (a pylon "palm"). */
function bladeGeometry(curve, segs, r0, r1, flat = 0.42, radial = 10) {
  const pos = [];
  const idx = [];
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const X = new THREE.Vector3(1, 0, 0);
  const P = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T);
    N.crossVectors(X, T).normalize(); // in the pylon's plane, across the blade
    B.crossVectors(T, N).normalize(); // ≈ x: the thin direction
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(
        P.x + N.x * r * Math.cos(a) + B.x * r * flat * Math.sin(a),
        P.y + N.y * r * Math.cos(a) + B.y * r * flat * Math.sin(a),
        P.z + N.z * r * Math.cos(a) + B.z * r * flat * Math.sin(a),
      );
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function ribbonTexture() {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#020208';
  ctx.fillRect(0, 0, c.width, c.height);
  const parts = [
    ['E-RAVE CAMBODIA', '#00f3ff', DISPLAY_FONT],
    ['✦', '#ff007f', DISPLAY_FONT],
    ['មរតកតេជោ', '#ff007f', KHMER_FONT],
    ['✦', '#00f3ff', DISPLAY_FONT],
    ['MORODOK TECHO · PHNOM PENH', '#ffffff', DISPLAY_FONT],
    ['✦', '#ff007f', DISPLAY_FONT],
  ];
  ctx.textBaseline = 'middle';
  let x = 20;
  const gap = (c.width - 40) / parts.length;
  for (const [text, color, font] of parts) {
    ctx.font = `64px ${font}`;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.fillText(text, x, 52, gap - 20);
    x += gap;
  }
  // LED pixel grid
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < c.height; y += 4) ctx.fillRect(0, y, c.width, 1);
  for (let i = 0; i < c.width; i += 4) ctx.fillRect(i, 0, 1, c.height);
  const t = canvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = [];

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMaterial());
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.floorMat = floorMaterial();
    // Big enough that its edge is lost in the fog even zoomed all the way out.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), this.floorMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    this.dark = new THREE.MeshLambertMaterial({ color: '#0d0f1a' });
    this.metal = new THREE.MeshLambertMaterial({ color: '#2a3040' });

    this.buildSkyline();
    this.buildBowl();
    this.buildSpectators();
    this.buildVip();
    this.buildRoof();
    this.buildPylons();
    this.buildTowers();
    this.buildSeatMarker();
  }

  /** A soft column of light over the seat you'd sit in (E, or the one under the mouse). */
  buildSeatMarker() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.035, 6, 32).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: hdr('#00f3ff', 2.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    ring.position.y = 0.3;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 2.4, 20, 1, true).translate(0, 1.2, 0), beamMaterial('#00f3ff', 0.35, 1));
    column.renderOrder = 2;
    g.add(ring, column);
    g.visible = false;
    this.seatMarker = g;
    this.scene.add(g);
  }

  /** Show the seat marker at a seat ({ x, y, z }), or hide it (null). */
  showSeat(spot) {
    const g = this.seatMarker;
    g.visible = !!spot;
    if (spot) g.position.set(spot.x, spot.y, spot.z);
  }

  buildSkyline() {
    // Phnom Penh, well outside the stadium: mostly hidden behind the bowl, seen from the drone.
    const rng = mulberry32(77);
    const count = 110;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.buildingMat = buildingMaterial();
    const mesh = new THREE.InstancedMesh(geo, this.buildingMat, count + 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const r = 380 + rng() * 320;
      p.set(Math.sin(a) * r, 0, CENTER_Z + Math.cos(a) * r);
      s.set(14 + rng() * 22, 20 + Math.pow(rng(), 2) * 110, 14 + rng() * 22);
      mesh.setMatrixAt(i, m.compose(p, q, s));
    }
    // A tall landmark tower on the riverside skyline
    p.set(-420, 0, 330);
    s.set(22, 175, 22);
    mesh.setMatrixAt(count, m.compose(p, q, s));
    this.scene.add(mesh);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8), glowMaterial('#ff2d55', 3));
    beacon.position.set(-420, 178, 330);
    this.beacon = beacon;
    this.scene.add(beacon);
  }

  buildBowl() {
    const us = [...outlineSamples(16, 44), 4];
    const parts = [];
    for (let i = 1; i < PROFILE.length; i++) {
      const a = PROFILE[i - 1];
      const b = PROFILE[i];
      const outer = i === PROFILE.length - 1;
      const kind = outer ? 3 : b.kind === 'seats' ? 0 : b.kind === 'wall' ? 1 : 2;
      const len = Math.hypot(b.d - a.d, b.y - a.y);
      // Seating tiers are built as real steps, one per seat row; the rest are flat strips.
      if (kind === 0) parts.push(geometryFrom(steps(us, a.d, a.y, b.d, b.y, Math.floor(len / SEAT_ROW_STEP))));
      else parts.push(geometryFrom(strip(us, a.d, a.y, b.d, b.y, kind, Math.round(len / 0.85))));
    }
    this.standMat = standMaterial();
    const bowl = (this.bowl = new THREE.Mesh(mergeGeometries(parts), this.standMat)); // seat picks use its shape (venue.js bowlRayHit), not this mesh
    this.scene.add(bowl);
    for (const g of parts) g.dispose();

    // LED ribbon board on the lower-tier fascia, all the way round.
    const rib = strip(us, 79.85, 15.6, 79.85, 18.9, 0, 0);
    const ribbon = geometryFrom(rib);
    const uvs = ribbon.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) / 64); // one texture = 64 m of board
    this.ribbonTex = ribbonTexture();
    this.ribbonMat = new THREE.MeshBasicMaterial({ map: this.ribbonTex, color: hdr('#ffffff', 1.25), side: THREE.DoubleSide, toneMapped: false });
    this.scene.add(new THREE.Mesh(ribbon, this.ribbonMat));
  }

  buildSpectators() {
    this.fans = new StandCrowd(this.scene);
  }

  buildVip() {
    // Two glass-fronted VIP decks over the front rows, east and west of the halfway line,
    // with a ramp up from the track at their north end.
    const deck = [];
    const glass = [];
    const neon = [];
    const sofas = [];
    for (const side of [1, -1]) {
      const x0 = side * VIP.d0;
      const x1 = side * VIP.d1;
      const cx = (x0 + x1) / 2;
      const w = VIP.d1 - VIP.d0;
      const L = VIP.halfZ * 2;
      deck.push(new THREE.BoxGeometry(w, 0.35, L).translate(cx, VIP.y - 0.175, CENTER_Z));
      deck.push(new THREE.BoxGeometry(0.3, VIP.y - 2.5, L).translate(x0, (VIP.y + 2.5) / 2 - 0.05, CENTER_Z)); // fills the gap above the wall
      // Glass rail along the front, open where the ramp's landing joins the deck (north end).
      const r = VIP.ramp;
      const gl = VIP.halfZ + r.landing;
      const gz = CENTER_Z + (r.landing - VIP.halfZ) / 2;
      glass.push(new THREE.BoxGeometry(0.06, 1.1, gl).translate(x0, VIP.y + 0.55, gz));
      neon.push(new THREE.BoxGeometry(0.1, 0.06, gl).translate(x0, VIP.y + 1.12, gz));
      neon.push(new THREE.BoxGeometry(0.1, 0.05, L).translate(x0, VIP.y + 0.02, CENTER_Z));
      for (let k = -2; k <= 2; k++) {
        const z = CENTER_Z + k * 7;
        sofas.push(new THREE.BoxGeometry(1.0, 0.45, 3.2).translate(side * (VIP.d1 - 1.2), VIP.y + 0.22, z));
        sofas.push(new THREE.BoxGeometry(0.35, 0.9, 3.2).translate(side * (VIP.d1 - 0.55), VIP.y + 0.45, z));
      }
      // Ramp: landing, then down along the track to the north.
      const rw = r.d1 - r.d0;
      const rx = side * (r.d0 + rw / 2);
      deck.push(new THREE.BoxGeometry(rw, 0.3, r.z0 - r.landing).translate(rx, VIP.y - 0.15, CENTER_Z + (r.landing + r.z0) / 2));
      // The landing's own glass: its track side and its south end.
      const ll = r.z0 - r.landing;
      glass.push(new THREE.BoxGeometry(0.06, 1.1, ll).translate(side * r.d0, VIP.y + 0.55, CENTER_Z + (r.landing + r.z0) / 2));
      neon.push(new THREE.BoxGeometry(0.1, 0.06, ll).translate(side * r.d0, VIP.y + 1.12, CENTER_Z + (r.landing + r.z0) / 2));
      glass.push(new THREE.BoxGeometry(rw, 1.1, 0.06).translate(rx, VIP.y + 0.55, CENTER_Z + r.landing));
      neon.push(new THREE.BoxGeometry(rw, 0.06, 0.1).translate(rx, VIP.y + 1.12, CENTER_Z + r.landing));
      const len = Math.hypot(r.z1 - r.z0, VIP.y);
      const ramp = new THREE.BoxGeometry(rw, 0.3, len);
      ramp.rotateX(Math.atan2(VIP.y, r.z1 - r.z0));
      ramp.translate(rx, VIP.y / 2 - 0.15, CENTER_Z + (r.z0 + r.z1) / 2);
      deck.push(ramp);
      const rail = new THREE.BoxGeometry(0.08, 0.06, len);
      rail.rotateX(Math.atan2(VIP.y, r.z1 - r.z0));
      rail.translate(side * r.d0, VIP.y / 2 + 1.0, CENTER_Z + (r.z0 + r.z1) / 2);
      neon.push(rail);
      // "VIP" sign on the deck's back wall
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(7, 2.2),
        new THREE.MeshBasicMaterial({
          map: neonTexture([{ text: 'VIP', size: 300, y: 256, color: '#ff007f' }]), transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, color: hdr('#ffffff', 1.6), side: THREE.DoubleSide,
        }),
      );
      sign.position.set(side * (VIP.d1 + 0.6), VIP.y + 4.2, CENTER_Z);
      sign.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.scene.add(sign);
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(deck), new THREE.MeshLambertMaterial({ color: '#141626' })));
    this.scene.add(new THREE.Mesh(mergeGeometries(glass), new THREE.MeshBasicMaterial({ color: '#5fd8ff', transparent: true, opacity: 0.12, depthWrite: false })));
    this.vipNeon = glowMaterial('#ff007f', 2);
    this.scene.add(new THREE.Mesh(mergeGeometries(neon), this.vipNeon));
    this.scene.add(new THREE.Mesh(mergeGeometries(sofas), new THREE.MeshLambertMaterial({ color: '#3a1030' })));
  }

  buildRoof() {
    const roofs = [];
    this.roofEdges = [];
    const front = [];
    const back = [];
    for (const [from, to] of [[ROOF.uFrom, ROOF.uTo], [2 + ROOF.uFrom, 2 + ROOF.uTo]]) {
      const us = [];
      for (let u = from; u <= to + 1e-6; u += 0.02) us.push(u);
      roofs.push(geometryFrom(strip(us, ROOF.d0, ROOF.y0, ROOF.d1, ROOF.y1, 2, 0)));
      const o = {};
      for (let i = 0; i < us.length - 1; i++) {
        for (const [arr, d, y] of [[front, ROOF.d0, ROOF.y0], [back, ROOF.d1, ROOF.y1]]) {
          outline(us[i], d, o);
          arr.push(o.x, y, o.z);
          outline(us[i + 1], d, o);
          arr.push(o.x, y, o.z);
        }
      }
      this.roofEdges.push({ from, to });
    }
    this.roofMat = roofMaterial();
    this.scene.add(new THREE.Mesh(mergeGeometries(roofs), this.roofMat));
    const line = (arr, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const m = new THREE.LineBasicMaterial({ color: hdr(color, 2) });
      this.scene.add(new THREE.LineSegments(g, m));
      return m;
    };
    this.roofFront = line(front, '#00f3ff');
    this.roofBack = line(back, '#ff007f');
  }

  buildPylons() {
    // The twin Sampeah pylons: two slender curved "palms" pressed together, 99 m tall, leaning
    // out over the north and south stands, with cables fanning down to the roof canopies.
    const blades = [];
    const stripsA = [];
    const stripsB = [];
    const cables = [];
    this.pylonTips = [];
    const P = PYLON;
    for (const e of [1, -1]) {
      const zc = (dz) => CENTER_Z + e * dz;
      for (const sx of [-1, 1]) {
        this.obstacles.push({ x: sx * P.baseHalfW, z: zc(P.baseDZ), r: 3.4 }); // the blade's foot, in the upper tier
        const curve = new THREE.CatmullRomCurve3([
          V(sx * P.baseHalfW, 0, zc(P.baseDZ)),
          V(sx * 6.2, 30, zc(P.baseDZ + 3)),
          V(sx * 4.2, 62, zc(P.baseDZ + 10)),
          V(sx * 1.9, 86, zc(P.baseDZ + 17)),
          V(sx * P.tipHalfW, P.height, zc(P.tipDZ)),
        ]);
        blades.push(bladeGeometry(curve, 40, 3.4, 0.45));
        // Neon strips along the inner (pitch-facing) and outer edges: thick enough to read from
        // across the stadium.
        for (const [arr, dir] of [[stripsA, -1], [stripsB, 1]]) {
          const pts = curve.getSpacedPoints(24).map((q, i) => {
            const r = 3.4 + (0.45 - 3.4) * (i / 24);
            return q.clone().setZ(q.z + e * dir * r * 1.02);
          });
          arr.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.32, 5, false));
        }
      }
      this.pylonTips.push(V(0, P.height + 0.6, zc(P.tipDZ)));
      // Cables from the pylon's upper section to the roof front edges on both sides.
      const o = {};
      for (const [u0, u1] of e > 0 ? [[0.55, ROOF.uTo], [2 + ROOF.uFrom, 2.45]] : [[ROOF.uFrom, 0.45], [2.55, 2 + ROOF.uTo]]) {
        for (let k = 0; k < 9; k++) {
          const u = u0 + ((u1 - u0) * k) / 8;
          outline(u, ROOF.d0 + 4, o);
          const t = 0.45 + 0.5 * (k / 8);
          cables.push(0, 50 + 45 * t, zc(P.baseDZ + 4 + 14 * t), o.x, ROOF.y0 + 1, o.z);
        }
      }
    }
    // Dark steel, faintly self-lit so the silhouette reads against the night sky.
    this.scene.add(new THREE.Mesh(mergeGeometries(blades), new THREE.MeshLambertMaterial({ color: '#232a3d', emissive: '#0b1430' })));
    this.pylonEdgeA = glowMaterial('#00f3ff', 2.2);
    this.pylonEdgeB = glowMaterial('#ff007f', 2.2);
    this.scene.add(new THREE.Mesh(mergeGeometries(stripsA), this.pylonEdgeA));
    this.scene.add(new THREE.Mesh(mergeGeometries(stripsB), this.pylonEdgeB));
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
    this.cableMat = new THREE.LineBasicMaterial({ color: '#4a5a8a', transparent: true, opacity: 0.55 });
    this.scene.add(new THREE.LineSegments(cg, this.cableMat));
    // Aviation warning lights on the tips.
    this.tipLights = this.pylonTips.map((p) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), glowMaterial('#ff2d55', 4));
      m.position.copy(p);
      this.scene.add(m);
      return m;
    });
  }

  buildTowers() {
    // Pitch-side truss towers carrying the side moving heads (lights.js).
    const parts = [];
    for (const z of SIDE_TOWERS) {
      for (const x of [-SIDE_TOWER_X, SIDE_TOWER_X]) {
        for (const [ox, oz] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) parts.push(new THREE.BoxGeometry(0.08, SIDE_TOWER_TOP, 0.08).translate(x + ox, SIDE_TOWER_TOP / 2, z + oz));
        for (let y = 1; y < SIDE_TOWER_TOP; y += 1.5) parts.push(new THREE.BoxGeometry(0.66, 0.05, 0.66).translate(x, y, z));
        parts.push(new THREE.BoxGeometry(1.4, 0.3, 1.4).translate(x, 0.15, z));
        this.obstacles.push({ x, z, r: 0.7 });
      }
    }
    this.scene.add(new THREE.Mesh(mergeGeometries(parts), this.metal));
  }

  setPointScale(s) {
    this.fans.setPointScale(s);
  }

  update(dt, t, M, mood, palette, lights, rings) {
    const u = this.floorMat.uniforms;
    u.uTime.value = t;
    u.uBass.value = M.bass * Math.max(0.3, mood.lights);
    u.uColA.value.copy(palette[0]);
    u.uColB.value.copy(palette[1]);
    u.uRings.value = rings;
    u.uFlash.value = mood.flash;
    u.uDim.value = mood.floorDim;
    u.uKick.value = M.kick * Math.max(0.2, mood.lights);
    u.uBeat.value = M.beatCount;
    u.uSpots.value = lights.spots;
    u.uSpotCols.value = lights.spotCols;
    this.sky.material.uniforms.uTime.value = t;
    this.sky.material.uniforms.uBass.value = M.bass;
    this.buildingMat.uniforms.uTime.value = t;
    // Arena Blackout (mood.arena, eased by World): the sky and the city go dark.
    const house = 1 - (mood.arena || 0);
    this.sky.material.uniforms.uLevel.value = house;
    this.buildingMat.uniforms.uLevel.value = house;
    this.beacon.visible = Math.floor(t * 1.2) % 2 === 0;

    const dim = mood.floorDim;
    const su = this.standMat.uniforms;
    su.uTime.value = t;
    su.uColA.value.copy(palette[0]);
    su.uColB.value.copy(palette[1]);
    su.uWash.value = (0.35 * house + 0.65 * mood.lights) * dim + mood.flash * 2; // house wash + the stage's
    // The aisle and row LEDs: low house lighting that gives way to the show (dimmer the brighter
    // the stage is), down to a safety glow in an Arena Blackout or a VIP show.
    su.uLed.value = (0.3 + 0.7 * house) * Math.max(0.35, dim) * (1 - 0.45 * Math.min(1, mood.lights));
    su.uKick.value = M.kick * Math.max(0.25, mood.lights) * dim;
    // The VIP spotlight's pool, where the moving heads are converging (lights.js focus).
    su.uVip.value.set(lights.focus.x, lights.focus.y, lights.focus.z, lights.focusW);

    this.fans.update(dt, t, M, mood, palette, su.uWash.value, su.uKick.value, su.uVip.value);

    this.ribbonTex.offset.x = (this.ribbonTex.offset.x + dt * 0.09) % 1;
    this.ribbonMat.color.setScalar((1.0 + M.kick * 0.5) * Math.max(0.12, dim));

    const pulse = (0.9 + M.bass * 1.4) * Math.max(0.15, dim);
    this.roofFront.color.copy(palette[0]).multiplyScalar(pulse * 1.6);
    this.roofBack.color.copy(palette[1]).multiplyScalar(pulse * 1.2);
    this.roofMat.uniforms.uColA.value.copy(palette[0]);
    this.roofMat.uniforms.uPulse.value = pulse;
    this.pylonEdgeA.color.set('#00f3ff').lerp(palette[0], 0.35).multiplyScalar(pulse * 1.9);
    this.pylonEdgeB.color.set('#ff007f').lerp(palette[1], 0.35).multiplyScalar(pulse * 1.6);
    this.cableMat.color.set('#4a5a8a').lerp(palette[0], 0.25).multiplyScalar((0.45 + M.kick * 0.35) * Math.max(0.1, dim));
    this.vipNeon.color.set('#ff007f').multiplyScalar(1.4 + M.bass * 1.2);
    if (this.seatMarker.visible) this.seatMarker.children[0].scale.setScalar(1 + 0.12 * Math.sin(t * 5));
    const blink = Math.floor(t * 0.9) % 2 === 0;
    for (const l of this.tipLights) l.visible = blink;
  }
}

// A smooth lid over the bowl's cross-section ([d, y], linear between): above the seating, the
// tier fascias and the rim everywhere, without their steps.
const CAMERA_HULL = [[47.5, 0], [49.5, 2.5], [78, 19.2], [102, 36.5], [126.5, 50.5], [131.5, 50.5], [138, 0]];
function hullAt(d) {
  if (d <= CAMERA_HULL[0][0] || d >= CAMERA_HULL[CAMERA_HULL.length - 1][0]) return 0;
  for (let i = 1; i < CAMERA_HULL.length; i++) {
    const [d1, y1] = CAMERA_HULL[i];
    if (d <= d1) {
      const [d0, y0] = CAMERA_HULL[i - 1];
      return y0 + ((d - d0) / (d1 - d0)) * (y1 - y0);
    }
  }
  return 0;
}

/**
 * Camera helper: lowest a camera may go at (x, z) without ending up inside the stands.
 * `smooth` (0–1) blends from the stands' own surface to the smooth lid over them, so a camera
 * pulling far out glides over the tiers instead of hopping up each fascia.
 */
export function minCameraY(x, z, smooth = 0) {
  const dz = z - CENTER_Z;
  const cz = Math.max(-STRAIGHT, Math.min(STRAIGHT, dz));
  const d = Math.hypot(x, dz - cz);
  const surface = d < WALL_D - 0.5 ? 0.5 : bowlHeightAt(d) + 2.6; // in the stands: over the fans' heads
  return smooth > 0 ? surface + (Math.max(surface, hullAt(d) + 1.2) - surface) * smooth : surface;
}

export { VENUE };
