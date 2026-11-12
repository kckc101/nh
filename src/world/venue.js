// Venue: Morodok Techo National Stadium, Phnom Penh — the geometry everything else agrees on.
//
// World units are metres. The pitch runs north–south along z (north = +z), with its centre
// spot under the DJ booth, so the main stage sits on the middle of the pitch facing north and
// the dance floor fills the north half. Around it: the athletics track, then the bowl — three
// tiers in the stadium's rounded "capsule" plan — with the two 99 m Sampeah pylons rising at
// the north and south ends behind the goals and cable-stayed roof canopies over the east and
// west stands (as on the real stadium).
//
// Shapes are offsets of a capsule: the segment x = 0, z ∈ CENTER_Z ± STRAIGHT, grown by `d`.
// d ≤ 36.5 is the infield, 36.5–46.3 the track, 50 the bowl's front wall, 131 its outer facade.

export const VENUE = {
  name: 'Morodok Techo National Stadium',
  khmer: 'ពហុកីឡដ្ឋានជាតិមរតកតេជោ',
  city: 'Phnom Penh',
  lngLat: [104.87628, 11.68289], // [lng, lat]
};
export const GPS_LABEL = `${VENUE.lngLat[1].toFixed(5)}°N ${VENUE.lngLat[0].toFixed(5)}°E`;

export const CENTER_Z = -29.8; // the pitch's centre spot (= the DJ booth, STAGE.dj.z)
export const PITCH = { halfW: 34, halfL: 52.5 }; // 68 × 105 m
export const STRAIGHT = 42.2; // half the track's straight (84.39 m)
export const TRACK = { inner: 36.5, outer: 46.26 }; // 8 lanes
export const WALL_D = 50; // the bowl's front wall
export const FACADE_D = 131;

/** Where avatars spawn and the neon dance floor is drawn: the pitch in front of the stage. */
export const DANCE_FLOOR = { minX: -33, maxX: 33, minZ: -18.4, maxZ: CENTER_Z + PITCH.halfL - 0.5 };

/** The bowl's cross-section: [offset d, height y]. Seat segments are marked. */
export const PROFILE = [
  { d: 50, y: 0 },
  { d: 50, y: 2.5, kind: 'wall' }, // front wall (neon top edge)
  { d: 80, y: 15, kind: 'seats' }, // lower tier
  { d: 80, y: 19.2, kind: 'wall' }, // fascia (LED ribbon board)
  { d: 82, y: 19.2, kind: 'flat' }, // concourse lip
  { d: 104, y: 33, kind: 'seats' }, // middle tier
  { d: 104, y: 36.5, kind: 'wall' },
  { d: 106, y: 36.5, kind: 'flat' },
  { d: 128, y: 49, kind: 'seats' }, // upper tier
  { d: 129.5, y: 50.5, kind: 'flat' },
  { d: FACADE_D, y: 50.5, kind: 'flat' },
  { d: FACADE_D, y: 0, kind: 'wall' }, // outer facade
];

/** Elevated VIP decks on the first tier, east and west, around the halfway line. */
export const VIP = {
  d0: 50, // deck front (the glass rail, over the front wall)
  d1: 58, // deck back (into the seating)
  halfZ: 20, // along the side, centred on the halfway line
  y: 5.8, // the lower tier's height at d1, so the deck meets the seats
  ramp: { d0: 47.4, d1: 50, z0: 20, z1: 36, landing: 14 }, // up from the track, north of the deck
};

/** Pylons: base inside the end stands, leaning outward, 99 m tall. */
export const PYLON = { baseDZ: 168, tipDZ: 190, height: 99, baseHalfW: 7, tipHalfW: 0.7 };

/** Roof canopies over the east and west stands (cantilevered, cable-stayed from the pylons). */
export const ROOF = { d0: 68, d1: 133, y0: 43, y1: 52, uFrom: -0.28, uTo: 1.28 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Offset of (x, z) from the capsule core: d (metres) and which side it's on. */
export function capsule(x, z) {
  const dz = z - CENTER_Z;
  const cz = clamp(dz, -STRAIGHT, STRAIGHT);
  return { d: Math.hypot(x, dz - cz), dz, onStraight: Math.abs(dz) <= STRAIGHT };
}

/**
 * Point on the capsule outline at parameter u ∈ [0, 4) and offset d:
 * [0,1) east straight going north, [1,2) north end, [2,3) west straight going south, [3,4) south end.
 * Writes { x, z, nx, nz } (outward normal) into `out`.
 */
export function outline(u, d, out = {}) {
  u = ((u % 4) + 4) % 4;
  const L = STRAIGHT;
  let nx;
  let nz;
  let cz;
  if (u < 1) [nx, nz, cz] = [1, 0, -L + 2 * L * u];
  else if (u < 2) {
    const a = (u - 1) * Math.PI;
    [nx, nz, cz] = [Math.cos(a), Math.sin(a), L];
  } else if (u < 3) [nx, nz, cz] = [-1, 0, L - 2 * L * (u - 2)];
  else {
    const a = (u - 3) * Math.PI;
    [nx, nz, cz] = [-Math.cos(a), -Math.sin(a), -L];
  }
  out.x = nx * d;
  out.z = CENTER_Z + cz + nz * d;
  out.nx = nx;
  out.nz = nz;
  return out;
}

/** u samples around the outline (denser on the curved ends). */
export function outlineSamples(perStraight = 12, perEnd = 40) {
  const us = [];
  for (let i = 0; i < perStraight; i++) us.push(i / perStraight);
  for (let i = 0; i < perEnd; i++) us.push(1 + i / perEnd);
  for (let i = 0; i < perStraight; i++) us.push(2 + i / perStraight);
  for (let i = 0; i < perEnd; i++) us.push(3 + i / perEnd);
  return us;
}

/** Height of the bowl surface at offset d (0 inside the front wall). */
export function bowlHeightAt(d) {
  if (d < WALL_D) return 0;
  for (let i = 1; i < PROFILE.length; i++) {
    const a = PROFILE[i - 1];
    const b = PROFILE[i];
    if (d <= b.d && b.d > a.d) return a.y + ((d - a.d) / (b.d - a.d)) * (b.y - a.y);
    if (d <= b.d && b.d === a.d) return Math.max(a.y, b.y);
  }
  return 0;
}

const inVipDeck = (c, x) => c.onStraight && c.d >= VIP.d0 && c.d <= VIP.d1 && Math.abs(c.dz) <= VIP.halfZ && Math.abs(x) > 1;
function rampHeight(c, x) {
  const r = VIP.ramp;
  if (!c.onStraight || c.d < r.d0 || c.d > r.d1 || Math.abs(x) < 1) return null;
  if (c.dz >= r.landing && c.dz <= r.z0) return VIP.y;
  if (c.dz > r.z0 && c.dz <= r.z1) return VIP.y * (1 - (c.dz - r.z0) / (r.z1 - r.z0));
  return null;
}

/**
 * Ground height for avatars at (x, z): VIP decks and their ramps, the field, and the stands —
 * the front wall's top, then the rake of the seating, tier by tier.
 */
export function groundAt(x, z) {
  const c = capsule(x, z);
  if (inVipDeck(c, x)) return VIP.y;
  const ramp = rampHeight(c, x);
  if (ramp !== null) return ramp;
  return c.d > WALL_D - 0.5 ? bowlHeightAt(Math.max(c.d, WALL_D)) : 0;
}

/** On a VIP deck or its ramp: VIP ticket holders only (Player.collide keeps everyone else off). */
export function inVipArea(x, z) {
  const c = capsule(x, z);
  return inVipDeck(c, x) || rampHeight(c, x) !== null;
}

/**
 * Can a raver stand here? Anywhere inside the outer facade. The walls between levels (the
 * front wall, the fascias between tiers, the VIP decks' edges) are what keep ravers on their
 * level: Player.collide won't climb more than a step or drop over a rail.
 */
export function walkable(x, z) {
  return capsule(x, z).d <= FACADE_D - 0.5;
}

/** In the stands (seating, lips and rim), not on a VIP deck or its ramp. */
export function inStands(x, z) {
  const c = capsule(x, z);
  return c.d > WALL_D - 0.5 && !inVipDeck(c, x) && rampHeight(c, x) === null;
}

/**
 * Rows of seats people sit in: every other painted row of each tier, as the fans in the stands
 * stand (fans.js). The top rows of a tier are left out (under the next fascia / the roof's
 * edge). { tier, row, d, y, mid } — mid is the tier's middle offset (its stair aisles' spacing).
 */
export const SEAT_ROW_STEP = 1.7;
export const SEAT_ROWS = (() => {
  const rows = [];
  let tier = 0;
  for (let i = 1; i < PROFILE.length; i++) {
    const a = PROFILE[i - 1];
    const b = PROFILE[i];
    if (b.kind !== 'seats') continue;
    const n = Math.floor(Math.hypot(b.d - a.d, b.y - a.y) / SEAT_ROW_STEP);
    for (let row = 0; row < n; row++) {
      const v = (row + 0.5) / n;
      if (v > 0.88) break;
      rows.push({ tier, row, d: a.d + (b.d - a.d) * v, y: a.y + (b.y - a.y) * v, mid: (a.d + b.d) / 2 });
    }
    tier++;
  }
  return rows;
})();

/** A seat row's spot under a VIP deck (the decks sit over the front rows there). */
export const underVipDeck = (x, z, d) => Math.abs(z - CENTER_Z) <= VIP.halfZ + 1 && d <= VIP.d1 + 1 && Math.abs(x) > 40;

/**
 * The point on a row of seats nearest (x, z), on a row at least `minD` out: { x, y, z, d,
 * tier, row }, or null. Rows under the VIP decks are skipped.
 */
export function seatNear(x, z, minD = 0) {
  const c = capsule(x, z);
  const cz = clamp(c.dz, -STRAIGHT, STRAIGHT);
  const nx = c.d > 1e-3 ? x / c.d : 1;
  const nz = c.d > 1e-3 ? (c.dz - cz) / c.d : 0;
  let best = null;
  for (const r of SEAT_ROWS) {
    if (r.d < minD || (best && Math.abs(r.d - c.d) >= Math.abs(best.d - c.d))) continue;
    if (underVipDeck(nx * r.d, CENTER_Z + cz + nz * r.d, r.d)) continue;
    best = r;
  }
  if (!best) return null;
  return { x: nx * best.d, y: best.y, z: CENTER_Z + cz + nz * best.d, d: best.d, tier: best.tier, row: best.row };
}

/**
 * Where a ray (origin `o`, unit direction `dir`) first meets the stands, walking the bowl's
 * cross-section (PROFILE) in 1 m steps instead of testing its mesh's triangles: { x, y, z, d }
 * in `out`, or null when it meets the field or the ground outside first, or nothing. Seat picking
 * uses it — a few microseconds, so it never shows up on a click.
 */
export function bowlRayHit(o, dir, maxT = 1000, out = {}) {
  const above = (t) => {
    const d = capsule(o.x + dir.x * t, o.z + dir.z * t).d;
    return o.y + dir.y * t - (d > FACADE_D ? 0 : bowlHeightAt(d));
  };
  if (above(0) < 0) return null; // starting inside the stands
  const top = PROFILE[PROFILE.length - 2].y;
  for (let t0 = 0, t = 1; t <= maxT; t0 = t, t += 1) {
    if (dir.y >= 0 && o.y + dir.y * t > top) return null; // climbing over the rim: nothing to hit
    if (above(t) > 0) continue;
    let lo = t0;
    let hi = t;
    for (let i = 0; i < 10; i++) {
      const m = (lo + hi) / 2;
      if (above(m) > 0) lo = m;
      else hi = m;
    }
    out.x = o.x + dir.x * hi;
    out.y = o.y + dir.y * hi;
    out.z = o.z + dir.z * hi;
    out.d = capsule(out.x, out.z).d;
    return out.d < WALL_D || out.d > FACADE_D ? null : out;
  }
  return null;
}

/** Spawn spots on a VIP deck (side = +1 east, −1 west). */
export function vipSpot(side, rng = Math.random) {
  const d = VIP.d0 + 1 + rng() * (VIP.d1 - VIP.d0 - 2);
  const dz = (rng() * 2 - 1) * (VIP.halfZ - 1.5);
  return { x: side * d, y: VIP.y, z: CENTER_Z + dz };
}
