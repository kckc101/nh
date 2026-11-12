// Stadium seats: a moulded bucket seat on every row of the three tiers (venue.js PROFILE: the
// same rows the stepped stands are built in, and the same places the fans and named ravers stand),
// one instanced draw of only the seats within ~34 m of the camera, rebuilt when it has moved 4 m.
// The stands you're in have real seats round you; further out a seat is a pixel, and the painted
// rows on the steps (shaders.js standMaterial) carry it. Seats keep the stair aisles clear (every
// 16 m, as fans.js leaves them) and skip the rows under the VIP decks. Colour changes block by block
// between the aisles. Main camera only (MAIN_ONLY_LAYER): the broadcast feeds don't need them.
//
// API: new StadiumSeats(scene), update(cameraPosition), count (seats drawn now), dispose().

import * as THREE from 'three';
import { PROFILE, SEAT_ROW_STEP, STRAIGHT, outline, underVipDeck } from './venue.js';
import { MAIN_ONLY_LAYER } from './dronecam.js';

const PITCH = 1.2; // m between seats along a row (fans.js SEAT_STEP)
const RADIUS = 34; // m round the camera
const MOVE = 4; // m the camera moves before the set is rebuilt
const MAX = 4500; // at most ~27k triangles
const CELL = 8; // m, the lookup grid
const BLOCKS = ['#24368c', '#462682', '#17506c', '#342a7c'].map((c) => new THREE.Color(c)); // dark: the stage is the bright thing
const BACK = 0.15; // m behind the row's centre: the fans stand just in front of their seats

/** Metres along the outline at offset d (fans.js arcAt: the aisles are laid out on it). */
function arcAt(u, d) {
  const L2 = 2 * STRAIGHT;
  const E = Math.PI * d;
  if (u < 1) return u * L2;
  if (u < 2) return L2 + (u - 1) * E;
  if (u < 3) return L2 + E + (u - 2) * L2;
  return 2 * L2 + E + (u - 3) * E;
}

/** A bucket seat facing +z: the pan, the back and a lip at the front (6 triangles, both sides drawn). */
function seatGeometry() {
  const w = 0.22;
  const pos = [
    -w, 0.42, -0.17, w, 0.42, -0.17, w, 0.42, 0.2, -w, 0.42, 0.2, // pan
    -w, 0.42, -0.17, w, 0.42, -0.17, w, 0.86, -0.27, -w, 0.86, -0.27, // back
    -w, 0.42, 0.2, w, 0.42, 0.2, w, 0.33, 0.24, -w, 0.33, 0.24, // lip
  ];
  const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 8, 10, 9, 8, 11, 10];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Every seat: { x, y, z, yaw, c } (c: its block colour index). */
function layout() {
  const seats = [];
  const o = {};
  for (let i = 1; i < PROFILE.length; i++) {
    const a = PROFILE[i - 1];
    const b = PROFILE[i];
    if (b.kind !== 'seats') continue;
    const n = Math.floor(Math.hypot(b.d - a.d, b.y - a.y) / SEAT_ROW_STEP);
    const mid = (a.d + b.d) / 2;
    for (let row = 0; row < n; row++) {
      const v = (row + 0.5) / n;
      const d = a.d + (b.d - a.d) * v;
      const y = a.y + (b.y - a.y) * v;
      for (let seg = 0; seg < 4; seg++) {
        const count = Math.floor((seg % 2 === 0 ? 2 * STRAIGHT : Math.PI * d) / PITCH);
        for (let k = 0; k < count; k++) {
          const u = seg + (k + (row % 2) * 0.5) / count;
          const arc = arcAt(u, mid);
          if (Math.abs(((arc / 16) % 1) - 0.5) * 16 < 0.8) continue; // a stair aisle
          outline(u, d + BACK, o);
          if (underVipDeck(o.x, o.z, d)) continue;
          seats.push({ x: o.x, y, z: o.z, yaw: Math.atan2(-o.nx, -o.nz), c: Math.floor(arc / 16) % BLOCKS.length });
        }
      }
    }
  }
  return seats;
}

const key = (cx, cz) => cx * 4096 + cz;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

export class StadiumSeats {
  constructor(scene) {
    this.seats = layout();
    this.grid = new Map();
    this.seats.forEach((s, i) => {
      const k = key(Math.floor(s.x / CELL), Math.floor(s.z / CELL));
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    });
    this.material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(seatGeometry(), this.material, MAX);
    this.mesh.count = 0;
    this.mesh.layers.set(MAIN_ONLY_LAYER);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, BLOCKS[0]); // creates instanceColor
    scene.add(this.mesh);
    this.at = new THREE.Vector3(1e9, 0, 0); // where the set was last built round
    this.nextAt = 0;
  }

  get count() {
    return this.mesh.count;
  }

  /** Call each frame with the camera's position: rebuilds the nearby set when it has moved MOVE m. */
  update(cam) {
    if (cam.distanceToSquared(this.at) < MOVE * MOVE) return;
    const now = performance.now();
    if (now < this.nextAt) return; // a fast fly-by: at most 4 rebuilds a second
    this.nextAt = now + 250;
    this.at.copy(cam);
    const r2 = RADIUS * RADIUS;
    let n = 0;
    const c0x = Math.floor((cam.x - RADIUS) / CELL);
    const c1x = Math.floor((cam.x + RADIUS) / CELL);
    const c0z = Math.floor((cam.z - RADIUS) / CELL);
    const c1z = Math.floor((cam.z + RADIUS) / CELL);
    const mesh = this.mesh;
    for (let cx = c0x; cx <= c1x && n < MAX; cx++) {
      for (let cz = c0z; cz <= c1z && n < MAX; cz++) {
        const list = this.grid.get(key(cx, cz));
        if (!list) continue;
        for (const i of list) {
          const s = this.seats[i];
          const dx = s.x - cam.x;
          const dy = s.y - cam.y;
          const dz = s.z - cam.z;
          if (dx * dx + dy * dy + dz * dz > r2) continue;
          _q.setFromAxisAngle(_up, s.yaw);
          mesh.setMatrixAt(n, _m.compose(_p.set(s.x, s.y, s.z), _q, _s));
          mesh.setColorAt(n, BLOCKS[s.c]);
          if (++n >= MAX) break;
        }
      }
    }
    mesh.count = n;
    mesh.visible = n > 0;
    if (!n) return;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
