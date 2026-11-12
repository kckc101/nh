// Ravers in the stands, cheap enough for weak GPUs:
//   • lower tier (closest to the pitch): up to 5,000 blocky 3D fans in the avatars'
//     proportions, five boxes with the faces nobody sees left out (96 vertices each);
//   • middle and upper tiers: flat sprites, one vertex per fan, with the same outfits and moves.
// They face the stage and dance on the beat: bouncing, fist-pumping, hands up (more of them in a
// drop), some filming on phone torches or waving glowsticks. All the motion happens in the
// vertex shaders (fanPose / armPose in shaders.js), driven by the beat clock.
//
// Wherever you are in the middle or upper tier, the sprites around you make way for a bubble of
// real 3D fans (setBubbleCenter), so up close the stands are never flat cut-outs.
//
// The drone feed never renders the lower tier's 3D fans: it sees sprite stand-ins for them
// instead (MAIN_ONLY_LAYER / FEED_ONLY_LAYER). setDensity() thins them out by graphics quality and by
// the performance governor's fanShare (which follows the frame rate).
//
// The bowl is cut into SECTORS slices, each drawn on its own with a real bounding sphere, so the
// frustum culls the stands that are off-screen. A slice of the lower tier far from the camera
// (zoomed out, the drone, the far side of the bowl) swaps its 3D fans for their sprite stand-ins
// (setViewer: it switches only when a slice crosses over, never per fan or per frame).
//
// Named ravers take a fan's place: the simulated ones all have seats in the stands (allocateSeat),
// so the people around you have name tags and answer a private chat; you and other players
// wherever you sit (allocateSeat on arrival, then freeSpotNear / claim / release). Those lookups
// go through a grid of the spots (CELL), never the whole stand.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { fanMaterial, fanSpriteMaterial, fanLightsMaterial } from './shaders.js';
import { CENTER_Z, STRAIGHT, SEAT_ROWS, outline, underVipDeck } from './venue.js';
import { MAIN_ONLY_LAYER, FEED_ONLY_LAYER } from './dronecam.js';

const SEAT_STEP = 1.2; // metres along a row: shoulder to shoulder for these blocky ravers
const FILL = [0.9, 0.75, 0.65]; // share of spots taken: lower (3D), middle, upper tier (sprites)
const MAX_FANS_3D = 5000;
/** Share of the fans drawn at each graphics quality (× the governor's fanShare). */
const QUALITY_SHARE = { high: 1, medium: 0.65, low: 0.4 };
const MIN_SPRITE_SHARE = 0.5; // sprites are nearly free: thin them less
const HIDDEN_Y = -500;
const FAN_ATTRS = ['iPos', 'iFan', 'iTop', 'iSkin']; // the instanced fans' per-fan attributes // a fan whose spot a named raver took
const BUBBLE = 400; // 3D fans in place of the sprites around you, up in the middle / upper tier
const BUBBLE_R = 16; // metres
const SECTORS = 16; // slices round the bowl (frustum culling and distance LOD work per slice)
const LOD_OUT = 75; // metres from the camera to a lower-tier slice's nearest edge: past this, sprites…
const LOD_IN = 65; // …and 3D again inside this (the gap stops a camera on the line from flickering)
const CELL = 4; // metres: the grid the seat lookups search

const TOPS = ['#111118', '#1a1a24', '#0f172a', '#2a2a3a', '#111118', '#1d4ed8', '#00f3ff', '#ff007f', '#9dff00', '#ffc400', '#8b5cff', '#ff2d55', '#f4f0ff', '#14b8a6', '#f97316', '#e11d48'];
const SKINS = ['#f1c9a5', '#d9a273', '#c68b59', '#b98055', '#a8703f', '#8a5a35', '#6b4226'];

/** Metres along the outline from u = 0 at offset d (standMaterial draws its aisles on this). */
function arcAt(u, d) {
  const L2 = 2 * STRAIGHT;
  const E = Math.PI * d;
  if (u < 1) return u * L2;
  if (u < 2) return L2 + (u - 1) * E;
  if (u < 3) return L2 + E + (u - 2) * L2;
  return 2 * L2 + E + (u - 3) * E;
}

/** Candidate spots on the seat rows (venue.js SEAT_ROWS): { x, y, z, tier, row, sector }. */
function seatSpots(rng) {
  const spots = [];
  const o = {};
  for (const { tier, row, d, y, mid } of SEAT_ROWS) {
    for (let seg = 0; seg < 4; seg++) {
      const n = Math.floor((seg % 2 === 0 ? 2 * STRAIGHT : Math.PI * d) / SEAT_STEP);
      for (let k = 0; k < n; k++) {
        if (rng() > FILL[tier]) continue;
        const u = seg + (k + (row % 2) * 0.5 + (rng() - 0.5) * 0.3) / n;
        if (Math.abs(((arcAt(u, mid) / 16) % 1) - 0.5) * 16 < 0.8) continue; // stair aisles
        outline(u, d, o);
        if (underVipDeck(o.x, o.z, d)) continue;
        const sector = Math.min(SECTORS - 1, Math.floor((arcAt((u + 4) % 4, d) / arcAt(4, d)) * SECTORS));
        spots.push({ x: o.x, y, z: o.z, tier, row, sector });
      }
    }
  }
  return spots;
}

const cellKey = (cx, cz) => cx * 4096 + cz;

// BoxGeometry stores its faces in this order, 4 vertices and 6 indices each.
const FACE = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 };

/** A box with only the listed faces, every vertex tagged with its body part. */
function boxPart(w, h, d, x, y, part, faces) {
  const box = new THREE.BoxGeometry(w, h, d).translate(x, y, 0);
  const P = box.attributes.position;
  const N = box.attributes.normal;
  const pos = [];
  const nor = [];
  const idx = [];
  for (const f of faces) {
    const base = pos.length / 3;
    for (let v = FACE[f] * 4; v < FACE[f] * 4 + 4; v++) {
      pos.push(P.getX(v), P.getY(v), P.getZ(v));
      nor.push(N.getX(v), N.getY(v), N.getZ(v));
    }
    for (let i = FACE[f] * 6; i < FACE[f] * 6 + 6; i++) idx.push(box.index.getX(i) - FACE[f] * 4 + base);
  }
  box.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(part), 1));
  g.setIndex(idx);
  return g;
}

/** One 3D fan: legs (one box), torso, head, two arms — 96 vertices, no hidden faces. */
function fanGeometry() {
  const parts = [
    boxPart(0.92, 0.95, 0.46, 0, 0.475, 0, ['px', 'nx', 'pz', 'nz']), // top is under the torso
    boxPart(1, 0.95, 0.5, 0, 1.425, 1, ['px', 'nx', 'py', 'pz', 'nz']),
    boxPart(0.72, 0.72, 0.72, 0, 2.36, 2, ['px', 'nx', 'py', 'pz', 'nz']),
    boxPart(0.38, 0.75, 0.4, 0.7, 1.82 - 0.375, 3, ['px', 'nx', 'ny', 'pz', 'nz']), // top at the shoulder
    boxPart(0.38, 0.75, 0.4, -0.7, 1.82 - 0.375, 4, ['px', 'nx', 'ny', 'pz', 'nz']),
  ];
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}


/**
 * Per-fan data for a list of spots: typed arrays, the fans holding a light (ascending) with their
 * own arrays (lightPos / lightFan), and fan → light index.
 */
function fanData(spots, rng) {
  const n = spots.length;
  const d = { pos: new Float32Array(n * 3), fan: new Float32Array(n * 4), top: new Float32Array(n * 3), skin: new Float32Array(n * 3), lights: [] };
  const c = new THREE.Color();
  spots.forEach((s, i) => {
    d.pos.set([s.x, s.y, s.z], i * 3);
    // Face the stage (the DJ booth on the centre spot), give or take.
    const yaw = Math.atan2(-s.x, CENTER_Z - s.z) + (rng() - 0.5) * 0.4;
    const style = rng();
    d.fan.set([yaw, rng(), style, rng() < 0.22 ? 1 : 0], i * 4);
    d.top.set(c.set(TOPS[Math.floor(rng() * TOPS.length)]).toArray(), i * 3);
    d.skin.set(c.set(SKINS[Math.floor(rng() * SKINS.length)]).toArray(), i * 3);
    if (style < 0.2) d.lights.push(i); // filming on a phone, or glowsticks
  });
  d.lightOf = new Int32Array(n).fill(-1);
  d.lightPos = new Float32Array(d.lights.length * 3);
  d.lightFan = new Float32Array(d.lights.length * 4);
  d.lights.forEach((f, li) => {
    d.lightOf[f] = li;
    d.lightPos.set(d.pos.subarray(f * 3, f * 3 + 3), li * 3);
    d.lightFan.set(d.fan.subarray(f * 4, f * 4 + 4), li * 4);
  });
  return d;
}

/** Items a..b of an array as an attribute: each slice draws its own range of the shared data. */
const view = (Attr, arr, size, a, b) => new Attr(arr.subarray(a * size, b * size), size);

/** Points over fans a..b (sprites), or over lights a..b (`lights`). */
function fanPoints(d, a, b, material, lights) {
  const A = THREE.BufferAttribute;
  const g = new THREE.BufferGeometry();
  if (lights) {
    g.setAttribute('position', view(A, d.lightPos, 3, a, b));
    g.setAttribute('iFan', view(A, d.lightFan, 4, a, b));
  } else {
    g.setAttribute('position', view(A, d.pos, 3, a, b));
    g.setAttribute('iFan', view(A, d.fan, 4, a, b));
    g.setAttribute('iTop', view(A, d.top, 3, a, b));
    g.setAttribute('iSkin', view(A, d.skin, 3, a, b));
  }
  return new THREE.Points(g, material);
}

/**
 * Cut a band of fans (sorted by sector) into slices, one per sector: { a, b (its fans), sphere
 * (bounds for the frustum), count (fans drawn), lodFar }. Each spot learns its slice and its
 * place in it (k).
 */
function slicesOf(spots) {
  const out = [];
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let a = 0; a < spots.length; ) {
    let b = a;
    box.makeEmpty();
    while (b < spots.length && spots[b].sector === spots[a].sector) {
      const s = spots[b++];
      box.expandByPoint(v.set(s.x, s.y, s.z)).expandByPoint(v.set(s.x, s.y + 2.6, s.z));
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius += 1.5; // arms up, a sprite's width
    const sl = { a, b, sphere, count: b - a, lodFar: false };
    for (let i = a; i < b; i++) {
      spots[i].slice = sl;
      spots[i].k = i - a;
    }
    out.push(sl);
    a = b;
  }
  return out;
}

export class StandCrowd {
  constructor(scene) {
    const rng = mulberry32(4041);
    const spots = seatSpots(rng);
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    // Grouped by sector, still shuffled within one (a stable sort): setDensity draws the first k of each.
    const bySector = (p, q) => p.sector - q.sector;
    this.near = spots.filter((s) => s.tier === 0).slice(0, MAX_FANS_3D).sort(bySector);
    this.far = spots.filter((s) => s.tier > 0).sort(bySector);
    const nd = (this.nearData = fanData(this.near, rng));
    const fd = (this.farData = fanData(this.far, rng));

    this.bodyMat = fanMaterial();
    this.spriteMat = fanSpriteMaterial();
    this.lightsMat = fanLightsMaterial();
    const base = fanGeometry();
    const I = THREE.InstancedBufferAttribute;
    /** Instanced 3D fans over fan data (one geometry per slice, sharing the fan's own buffers). */
    const bodies = (d, a, b) => {
      const g = new THREE.InstancedBufferGeometry();
      g.setIndex(base.index);
      for (const k of ['position', 'normal', 'aPart']) g.setAttribute(k, base.attributes[k]);
      g.setAttribute('iPos', view(I, d.pos, 3, a, b));
      g.setAttribute('iFan', view(I, d.fan, 4, a, b));
      g.setAttribute('iTop', view(I, d.top, 3, a, b));
      g.setAttribute('iSkin', view(I, d.skin, 3, a, b));
      g.instanceCount = b - a;
      return new THREE.Mesh(g, this.bodyMat);
    };
    const bound = (sl, ...objs) => {
      for (const o of objs) {
        o.geometry.boundingSphere = sl.sphere; // the frustum culls the slice as a whole
        scene.add(o);
      }
    };

    // Lower tier: 3D fans for the main camera (sprite stand-ins for the drone feed, and for the
    // main camera too when the slice is far off).
    this.nearSlices = slicesOf(this.near);
    for (const sl of this.nearSlices) {
      sl.bodies = bodies(nd, sl.a, sl.b);
      sl.bodies.layers.set(MAIN_ONLY_LAYER);
      sl.points = fanPoints(nd, sl.a, sl.b, this.spriteMat, false);
      sl.points.layers.set(FEED_ONLY_LAYER);
      bound(sl, sl.bodies, sl.points);
    }
    // Middle and upper tiers: sprites.
    this.farSlices = slicesOf(this.far);
    for (const sl of this.farSlices) {
      sl.points = fanPoints(fd, sl.a, sl.b, this.spriteMat, false);
      bound(sl, sl.points);
    }
    // Their lights: one vertex each, so one draw per band, round the whole bowl.
    this.nearLights = fanPoints(nd, 0, nd.lights.length, this.lightsMat, true);
    this.farLights = fanPoints(fd, 0, fd.lights.length, this.lightsMat, true);
    for (const l of [this.nearLights, this.farLights]) {
      l.frustumCulled = false;
      scene.add(l);
    }

    // The bubble of 3D fans around you in the far tiers (empty until setBubbleCenter).
    const bd = (this.bubbleData = { pos: new Float32Array(BUBBLE * 3), fan: new Float32Array(BUBBLE * 4), top: new Float32Array(BUBBLE * 3), skin: new Float32Array(BUBBLE * 3) });
    this.bubble = bodies(bd, 0, BUBBLE);
    for (const k of FAN_ATTRS) this.bubble.geometry.attributes[k].setUsage(THREE.DynamicDrawUsage);
    this.bubble.geometry.instanceCount = 0;
    this.bubble.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(1e9, 0, 0), BUBBLE_R + 3);
    scene.add(this.bubble);
    this.bubbleIdx = [];
    this.bubbleAt = new THREE.Vector3(1e9, 0, 0);
    this.bubbleOn = false;

    // The spot grid: cell → codes (lower-tier fan i as i, a far one as ~i).
    this.grid = new Map();
    const file = (list, code) =>
      list.forEach((s, i) => {
        const key = cellKey(Math.floor(s.x / CELL), Math.floor(s.z / CELL));
        let c = this.grid.get(key);
        if (!c) this.grid.set(key, (c = []));
        c.push(code(i));
      });
    file(this.near, (i) => i);
    file(this.far, (i) => ~i);

    this.mats = [this.bodyMat, this.spriteMat, this.lightsMat];
    this.litMats = [this.bodyMat, this.spriteMat]; // the ones the stage wash and the VIP pool light
    this.hype = 0;
    this.quality = 'high';
    this.share = 1;
  }

  /** Fans in the stands drawn right now (before frustum culling): { fans3d, sprites }. */
  get drawn() {
    const sum = (list) => list.reduce((n, sl) => n + sl.count, 0);
    return { fans3d: sum(this.nearSlices), sprites: sum(this.farSlices) };
  }

  /** Graphics quality ('high' / 'medium' / 'low') × the governor's fanShare (0.25–1). */
  setDensity(quality = this.quality, share = this.share) {
    this.quality = quality;
    this.share = share;
    const q = (QUALITY_SHARE[quality] ?? 1) * share;
    const thin = (slices, k, spots, d, lights) => {
      for (const sl of slices) {
        sl.count = Math.round((sl.b - sl.a) * k);
        if (sl.bodies) sl.bodies.geometry.instanceCount = sl.count;
        sl.points.geometry.setDrawRange(0, sl.count);
      }
      d.lights.forEach((f, li) => (d.lightPos[li * 3 + 1] = lightY(spots[f])));
      lights.geometry.attributes.position.needsUpdate = true;
    };
    thin(this.nearSlices, q, this.near, this.nearData, this.nearLights);
    thin(this.farSlices, Math.max(MIN_SPRITE_SHARE, q), this.far, this.farData, this.farLights);
    if (this.bubbleIdx.length) this.setBubbleCenter(this.bubbleAt, true); // the thinned-out ones leave it
  }

  setPointScale(s) {
    this.lightsMat.uniforms.uScale.value = s;
    this.spriteMat.uniforms.uScale.value = s;
  }

  /** Calls fn(spot, near, i) for the fan spots in the grid cells within r of (x, z). */
  around(x, z, r, fn) {
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    for (let cx = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL); cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const c = this.grid.get(cellKey(cx, cz));
        if (c) for (const code of c) code >= 0 ? fn(this.near[code], true, code) : fn(this.far[~code], false, ~code);
      }
    }
  }

  /**
   * Seat allocation: a random free seat matching `tier` (0 lower, 1 middle, 2 upper), rows up
   * to `maxRow` (0 = the front row) and an optional `where(spot)` test (which part of the bowl).
   * Returns { x, y, z, yaw, handle } — yaw turns a raver there to face the DJ on the centre spot
   * — or null if none is free. With `claim` the fan there makes way at once; without it, it's
   * left for Player.sitAt to claim.
   */
  allocateSeat({ tier = 0, maxRow = 6, where = null, claim = true, rng = Math.random } = {}) {
    const near = tier === 0;
    const spots = near ? this.near : this.far;
    const free = [];
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      if (!s.taken && s.tier === tier && s.row <= maxRow && (!where || where(s))) free.push(i);
    }
    if (!free.length) return null;
    const handle = { near, i: free[Math.floor(rng() * free.length)] };
    const s = spots[handle.i];
    const seat = claim ? this.claim(handle) : { x: s.x, y: s.y, z: s.z, handle };
    seat.yaw = Math.atan2(-seat.x, CENTER_Z - seat.z);
    return seat;
  }

  /** The free fan spot nearest (x, y, z) within maxDist: { x, y, z, handle } (not taken yet). */
  freeSpotNear(x, y, z, maxDist = 1.6) {
    let best = null;
    let bd = maxDist * maxDist;
    this.around(x, z, maxDist, (s, near, i) => {
      if (s.taken) return;
      const dd = (s.x - x) ** 2 + (s.y - y) ** 2 + (s.z - z) ** 2;
      if (dd < bd) {
        bd = dd;
        best = { x: s.x, y: s.y, z: s.z, handle: { near, i } };
      }
    });
    return best;
  }

  /** Is a named raver already sitting within r of (x, y, z)? */
  takenNear(x, y, z, r = 0.8) {
    let hit = false;
    this.around(x, z, r, (s) => {
      if (s.taken && (s.x - x) ** 2 + (s.y - y) ** 2 + (s.z - z) ** 2 < r * r) hit = true;
    });
    return hit;
  }

  /**
   * Where a raver sits for a point on a row (venue.js seatNear): the nearest free fan's spot
   * (that fan makes way), or the point itself when the row is empty there; null if a named
   * raver is already in that seat.
   */
  seatFor(p) {
    const free = this.freeSpotNear(p.x, p.y, p.z);
    if (free) return free;
    return this.takenNear(p.x, p.y, p.z) ? null : { x: p.x, y: p.y, z: p.z, handle: null };
  }

  /** The fan at `handle` makes way: { x, y, z, handle }, or null if it already has. */
  claim(handle) {
    const s = (handle.near ? this.near : this.far)[handle.i];
    if (!s || s.taken) return null;
    s.taken = true;
    this.syncFan(handle);
    if (s.bubble) this.setBubbleCenter(this.bubbleAt, true); // it was one of the 3D fans around you
    return { x: s.x, y: s.y, z: s.z, handle };
  }

  /** The named raver left: the fan is back in its spot. */
  release(handle) {
    const s = handle && (handle.near ? this.near : this.far)[handle.i];
    if (!s?.taken) return;
    s.taken = false;
    this.syncFan(handle);
    if (!handle.near && this.bubbleIdx.length) this.setBubbleCenter(this.bubbleAt, true);
  }

  /**
   * Called once a frame with the main camera's position and your raver's (or null). A slice of
   * the lower tier far from the camera swaps its 3D fans for their sprites, and the bubble of 3D
   * fans follows you while the camera is close enough to see it. Cheap: it only does anything
   * when a slice crosses over, or when you've moved 3 m.
   */
  setViewer(cam, you) {
    for (const sl of this.nearSlices) {
      const far = cam.distanceTo(sl.sphere.center) - sl.sphere.radius > (sl.lodFar ? LOD_IN : LOD_OUT);
      if (far === sl.lodFar) continue;
      sl.lodFar = far;
      sl.bodies.visible = !far;
      if (far) sl.points.layers.enable(MAIN_ONLY_LAYER);
      else sl.points.layers.disable(MAIN_ONLY_LAYER);
    }
    this.bubbleOn = !!you && cam.distanceTo(you) < (this.bubbleOn ? LOD_OUT : LOD_IN) + BUBBLE_R;
    this.setBubbleCenter(this.bubbleOn ? you : FAR_AWAY);
  }

  /**
   * Real 3D fans around `p` (your raver) in place of the far tiers' sprites. It only looks again
   * once you've moved 3 m (or with `force`), and only uploads when the set of fans changed.
   */
  setBubbleCenter(p, force = false) {
    if (!force && p.distanceToSquared(this.bubbleAt) < 9) return;
    this.bubbleAt.copy(p);
    const pick = [];
    this.around(p.x, p.z, BUBBLE_R, (s, near, i) => {
      if (near || s.taken || s.k >= s.slice.count) return; // 3D already; a named raver's seat; thinned out
      const dd = (s.x - p.x) ** 2 + (s.y - p.y) ** 2 + (s.z - p.z) ** 2;
      if (dd < BUBBLE_R * BUBBLE_R) pick.push([dd, i]);
    });
    pick.sort((a, b) => a[0] - b[0]);
    const idx = pick.slice(0, BUBBLE).map(([, i]) => i);
    const old = this.bubbleIdx;
    if (idx.length === old.length && idx.every((i, j) => i === old[j])) return; // the same fans
    for (const i of old) {
      this.far[i].bubble = false;
      this.syncFan({ near: false, i });
    }
    this.bubbleIdx = idx;
    const fd = this.farData;
    const bd = this.bubbleData;
    idx.forEach((i, j) => {
      const s = this.far[i];
      s.bubble = true;
      this.syncFan({ near: false, i });
      bd.pos.set([s.x, s.y, s.z], j * 3);
      bd.fan.set(fd.fan.subarray(i * 4, i * 4 + 4), j * 4);
      bd.top.set(fd.top.subarray(i * 3, i * 3 + 3), j * 3);
      bd.skin.set(fd.skin.subarray(i * 3, i * 3 + 3), j * 3);
    });
    const g = this.bubble.geometry;
    g.instanceCount = idx.length;
    g.boundingSphere.center.copy(p);
    for (const a of FAN_ATTRS) g.attributes[a].needsUpdate = true;
  }

  /** Put a fan where it belongs: hidden while a named raver has its seat (or, a sprite, while it's in the 3D bubble). */
  syncFan({ near, i }) {
    const s = (near ? this.near : this.far)[i];
    const data = near ? this.nearData : this.farData;
    const sl = s.slice;
    data.pos[i * 3 + 1] = s.taken || s.bubble ? HIDDEN_Y : s.y; // near: shared by the 3D fans and their stand-ins
    sl.points.geometry.attributes.position.needsUpdate = true; // only this slice's range goes up
    if (near) sl.bodies.geometry.attributes.iPos.needsUpdate = true;
    const li = data.lightOf[i];
    if (li >= 0) {
      data.lightPos[li * 3 + 1] = lightY(s); // the light in their hand stays with a bubble fan
      (near ? this.nearLights : this.farLights).geometry.attributes.position.needsUpdate = true;
    }
  }

  /** `vip`: the VIP spotlight (Vector4: xyz = the buyer, w = how far in) for the pool on the fans round them. */
  update(dt, t, M, mood, palette, wash, kick, vip) {
    // Hype: hands go up as the lights do (a drop), and eases back down.
    const want = Math.min(1, Math.max(0, (mood.lights - 0.6) / 0.3));
    this.hype += (want - this.hype) * (1 - Math.exp(-dt * 2));
    for (const m of this.mats) {
      const u = m.uniforms;
      u.uTime.value = t;
      u.uBeat.value = M.beatCount + M.phase;
      u.uEnergy.value = Math.min(1, M.energy * 1.6) * mood.floorDim;
      u.uHype.value = this.hype;
      u.uFlash.value = mood.flash;
      u.uColA.value.copy(palette[0]);
      u.uColB.value.copy(palette[1]);
    }
    this.bodyMat.uniforms.uDim.value = mood.floorDim; // the rim light goes down with the room
    for (const m of this.litMats) {
      m.uniforms.uVip.value.copy(vip);
      m.uniforms.uWash.value = wash;
      m.uniforms.uKick.value = kick;
    }
  }
}

const FAR_AWAY = new THREE.Vector3(1e9, 0, 0);
/** Where a fan's light is: in their hand, or hidden while a named raver has the seat or the fan's thinned out. */
const lightY = (s) => (s.taken || s.k >= s.slice.count ? HIDDEN_Y : s.y);
