// The drone camera: its flight (DroneCameraManager).
//
// A roaming camera flies one of four cinematic paths — `stadium` (a high aerial circling
// outside the bowl with the whole venue in frame: stands, pitch, roofs and both pylons),
// `orbit` (a wide ellipse inside the stadium bowl, with the two pylons lined up at either end), `flythrough` (through the halo
// rings, low swoops over the crowd, past the VIP decks and around behind the stage) and
// `crane_shot` (rising from the front of the crowd to a high wide of the stage) — as Catmull-Rom loops sampled at constant speed. Its aim eases between the DJ booth,
// the densest knot of dancers and a wide venue overview, with a little hand-held shake.
//
// The drone is CAM 4 of the broadcast rig (broadcast.js), which renders it (and the other four
// cameras) to the LED wall, the booth monitor, the side screens and your picture-in-picture.
//
// VIP bottle service takes the drone over for the length of the show (setVip): it leaves its
// path for the buyer — an orbit round them, a low fly-through past them, then a rising reveal
// of the darkened stadium with every light on them — and puts them on the LED wall (the feed
// is forced on for the show) under a "VIP" lower third. It's a pure function of the shared
// clock and the buyer's position, so every client's drone flies the same shot.
//
// API: init(), update(delta, M), setFlightMode(mode), setSpeed(x), toggleFeed(on),
// applyState(state) (the DJ / server state), nudge(), zoomBy(), setVip(), clearVip(), feedOn.

import * as THREE from 'three';
import { DRONECAM_DEFAULTS, DRONE_MODES, dronePhase, cleanDroneCam } from '../../shared/dronecam.js';
import { STAGE } from './stage.js';
import { CENTER_Z, WALL_D, capsule, bowlHeightAt } from './venue.js';

export const DRONE_LAYER = 2; // the drone's own mesh — main camera only
export const SCREEN_LAYER = 3; // the feed screens — main camera only
export const MAIN_ONLY_LAYER = 4; // detail the feed can do without (the 3D fans) — main camera only
export const FEED_ONLY_LAYER = 5; // their cheap stand-ins (fan sprites) — feed camera only

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const MODE_LABEL = { stadium: 'STADIUM', orbit: 'ORBIT', flythrough: 'FLYTHROUGH', crane_shot: 'CRANE SHOT', vip: 'VIP SHOT' };
const VIP_BLEND = 2.5; // seconds to fly over to the buyer, and back to the path at the end

const smooth = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/** Lowest the drone flies at (x, z): over the pitch, or clear of the fans' heads in the stands. */
function flyFloor(x, z) {
  const d = capsule(x, z).d;
  return d < WALL_D - 0.5 ? 1.5 : bowlHeightAt(d) + 3.4;
}

// ---------------------------------------------------------------- flight paths (stadium coords)
// Stage z ≈ −22…−40 (truss to y 22.5, Angkor crown to y 32), crowd z −18…22, pitch-side
// light towers x ±35.6 (to y 12.3) at z −6/8/22/36, VIP decks x ±50…58 around z −30, the bowl
// from d 50 (venue.js), roof canopies from d 68 at y 43+ on the sides, halo rings (horizontal,
// r 7 / 9.5 / 7) at (0,15,−4) (0,17,13) (0,15,30). Paths keep clear of all of them (checked
// against the venue geometry).
// Orbit: an ellipse around the stadium's centre spot at ~60° map pitch (the camera about 30°
// below the horizon), inside the roof's edge, so the pylons line up at either end.
function orbitPoints() {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    pts.push(V(Math.sin(a) * 58, 33 + 3 * Math.sin(2 * a), CENTER_Z + Math.cos(a) * 82));
  }
  return pts;
}
// Stadium: a high ellipse outside the bowl (facade at d 131, pylon tips 190 m from the centre
// spot), 34–38° above the venue all the way round, so the whole bowl, both pylons and the stage
// on the centre spot are in one frame — over the ends the near pylon passes just below the
// middle of the shot and the far one stands up near the top.
function stadiumPoints() {
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    pts.push(V(Math.sin(a) * 220, 185 + 15 * Math.cos(2 * a), CENTER_Z + Math.cos(a) * 290));
  }
  return pts;
}
const PATHS = {
  stadium: stadiumPoints(),
  orbit: orbitPoints(),
  flythrough: [
    V(0, 24, 70), V(0, 22, 46), V(0, 22, 30), V(0, 22, 19), // in over the north stand, above the halo rings…
    V(0, 11.5, 12), // …then dive down through the middle ring
    V(-5, 9, 1), V(-7, 4.8, -3), V(-9, 4.6, -13), // low toward the stage
    V(-24, 6, -12), V(-43, 8.5, -16), V(-43, 8.5, -44), // swing west, glide south past the west VIP deck
    V(-28, 12, -62), V(0, 15, -66), V(28, 12, -62), // round behind the stage
    V(43, 8.5, -44), V(43, 8.5, -16), V(24, 6, -12), // north past the east VIP deck
    V(10, 4.6, 8), V(-10, 4.6, 24), // back low across the floor
    V(-24, 10, 40), V(-10, 20, 60), // and climb out to the north
  ],
  // Rises from the front of the crowd, straight up through the first halo ring, to a high wide.
  crane_shot: [V(0, 3.6, -1), V(-1, 9, -1.5), V(-1, 15, -2.5), V(-2, 23, 3), V(0, 33, 20), V(2, 23, 3), V(1, 15, -2.5), V(1, 9, -1.5)],
};

// Look-at targets, cycled on the shared clock (and eased between).
const DJ_TARGET = V(STAGE.dj.x, STAGE.dj.y + 1.6, STAGE.dj.z);
const OVERVIEW = V(0, 2, CENTER_Z + 10);
const VENUE_TARGET = V(0, 15, CENTER_Z); // over the centre spot: the bowl and both pylons in frame
const SCHEDULE = {
  stadium: ['venue'],
  orbit: ['dj', 'crowd', 'overview'],
  flythrough: ['crowd', 'dj', 'crowd', 'overview'],
  crane_shot: ['dj', 'overview', 'dj', 'crowd'],
};
const SHOT_SECONDS = 9;

export class DroneCamSystem {
  /**
   * @param world  the World (scene, stage, crowd, player, renderer, governor)
   * @param clock  () => ms on the shared (server-synced) clock
   */
  constructor(world, clock) {
    this.w = world;
    this.clock = clock;
    this.state = { ...DRONECAM_DEFAULTS };
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 1, 5000); // layer 0 + FEED_ONLY_LAYER
    this.camera.layers.enable(FEED_ONLY_LAYER);
    this.curves = Object.fromEntries(Object.entries(PATHS).map(([k, pts]) => [k, new THREE.CatmullRomCurve3(pts, true, 'centripetal')]));
    this.pos = new THREE.Vector3(); // camera position (before shake)
    this.dronePos = new THREE.Vector3(); // the drone body, just above its camera
    this.heading = 0;
    this.pathLook = new THREE.Vector3().copy(OVERVIEW); // the path's subject, eased
    this.look = new THREE.Vector3().copy(OVERVIEW); // what the camera looks at (the VIP, during a show)
    this.lookWant = new THREE.Vector3();
    this.vip = null; // { timestamp, D, target, name, text, color } during a VIP show
    this.vipPos = new THREE.Vector3();
    this.vipLook = new THREE.Vector3();
    this.vipTmp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.cluster = new THREE.Vector3(0, 1.4, 8);
    this.clusterAt = 0;
    this.offset = 0; // local drag nudge along the path
    this.blend = 1; // eases from the old shot after a mode change
    this.fromPos = new THREE.Vector3();
    this.fromLook = new THREE.Vector3();
    this.glitch = 0;
    this.t = 0;
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
  }

  init() {
    // The main camera sees the drone and the screens; the broadcast cameras see neither.
    const cam = this.w.camera;
    cam.layers.enable(DRONE_LAYER);
    cam.layers.enable(SCREEN_LAYER);
    cam.layers.enable(MAIN_ONLY_LAYER);
    return this;
  }

  // ---------------------------------------------------------------- controls
  /** The DJ / server state ({ mode, speed, feed, t0, phase0 }). */
  applyState(s) {
    const prev = this.state;
    this.state = { ...prev, ...s };
    if (this.state.mode !== prev.mode) {
      // Ease from the current shot into the new path over a couple of seconds.
      this.fromPos.copy(this.camera.position);
      this.fromLook.copy(this.look);
      this.blend = 0;
    }
    this.w.broadcast?.applyVisibility();
  }

  setFlightMode(mode) {
    if (DRONE_MODES.includes(mode)) this.applyState(cleanDroneCam({ mode }, this.state, this.clock()));
  }

  setSpeed(speed) {
    this.applyState(cleanDroneCam({ speed }, this.state, this.clock()));
  }

  toggleFeed(on = !this.state.feed) {
    this.applyState({ feed: !!on });
  }

  /** Ride-along drag: slide along the path (this client only). */
  nudge(d) {
    this.offset -= d * 0.05;
  }

  /** Ride-along wheel / pinch: lens zoom. */
  zoomBy(f) {
    this.camera.fov = Math.max(50, Math.min(90, this.camera.fov * f));
    this.camera.updateProjectionMatrix();
  }

  /** Is the feed on the screens? (The DJ's switch, or a VIP show.) */
  get feedOn() {
    return this.state.feed || !!this.vip;
  }

  /**
   * A VIP show: { timestamp (shared-clock ms it started), D (seconds), target (Vector3, the buyer,
   * kept up to date by the show), name, text (their sign), color }.
   */
  setVip(vip) {
    this.vip = vip;
    this.w.broadcast?.applyVisibility(); // both screens take the VIP shot, under its lower third
  }

  clearVip() {
    this.vip = null;
    this.w.broadcast?.applyVisibility();
  }

  // ---------------------------------------------------------------- flight
  /** The densest knot of dancers (6 m cells), refreshed every 1.5 s. */
  updateCluster(t) {
    if (t - this.clusterAt < 1.5) return;
    this.clusterAt = t;
    const cells = new Map();
    const add = (p) => {
      const k = `${Math.floor(p.x / 6)},${Math.floor(p.z / 6)}`;
      const c = cells.get(k) || { n: 0, x: 0, z: 0 };
      c.n++;
      c.x += p.x;
      c.z += p.z;
      cells.set(k, c);
    };
    const crowd = this.w.crowd;
    for (const b of crowd.bots) add(b.av.root.position);
    for (const r of crowd.remotes.values()) add(r.av.root.position);
    if (this.w.player) add(this.w.player.pos);
    let best = null;
    for (const c of cells.values()) if (!best || c.n > best.n) best = c;
    if (best) this.cluster.set(best.x / best.n, 1.4, best.z / best.n);
  }

  update(dt, M) {
    const now = this.clock();
    const t = (this.t = now / 1000);
    const mode = this.state.mode;
    const curve = this.curves[mode];
    const u = (((dronePhase(this.state, now) + this.offset) % 1) + 1) % 1;
    curve.getPointAt(u, this.pos);
    curve.getPointAt((u + 0.004) % 1, this.tmp);
    this.heading = Math.atan2(this.tmp.x - this.pos.x, this.tmp.z - this.pos.z);

    // Where to look: the scheduled subject, eased; flythrough also looks where it's going.
    this.updateCluster(t);
    const shots = SCHEDULE[mode];
    const shot = shots[Math.floor(t / SHOT_SECONDS) % shots.length];
    this.lookWant.copy(shot === 'dj' ? DJ_TARGET : shot === 'crowd' ? this.cluster : shot === 'venue' ? VENUE_TARGET : OVERVIEW);
    if (mode === 'flythrough') {
      curve.getPointAt((u + 0.03) % 1, this.tmp2);
      this.tmp2.y -= 3;
      this.lookWant.lerp(this.tmp2, 0.55);
    }
    this.pathLook.lerp(this.lookWant, 1 - Math.exp(-dt * 1.2));
    this.look.copy(this.pathLook);

    // VIP show: off the path to the buyer and back, over VIP_BLEND seconds each way.
    const vip = this.vip;
    if (vip) {
      const e = (now - vip.timestamp) / 1000;
      if (e > vip.D + 0.5) this.clearVip();
      else {
        const w = smooth(0, VIP_BLEND, e) * (1 - smooth(vip.D - VIP_BLEND, vip.D, e));
        this.vipPose(e, vip.D, vip.target, this.vipPos, this.vipLook);
        this.pos.lerp(this.vipPos, w);
        this.look.lerp(this.vipLook, w);
        if (w > 0.5) this.heading = Math.atan2(this.look.x - this.pos.x, this.look.z - this.pos.z); // nose on them
      }
    }
    this.dronePos.copy(this.pos);
    this.dronePos.y += 0.9; // the camera hangs under the drone

    // Hand-held feel: slow bob plus a little bass shake.
    const cam = this.camera;
    cam.position.copy(this.pos);
    cam.position.x += Math.sin(t * 1.7) * 0.06 + (Math.random() - 0.5) * 0.03 * M.bass;
    cam.position.y += Math.sin(t * 2.3) * 0.08 + (Math.random() - 0.5) * 0.03 * M.bass;
    cam.position.z += Math.sin(t * 1.3) * 0.06;
    if (this.blend < 1) {
      // Just switched mode: glide from the previous shot.
      this.blend = Math.min(1, this.blend + dt / 2.5);
      const k = this.blend * this.blend * (3 - 2 * this.blend);
      cam.position.lerpVectors(this.fromPos, cam.position, k);
      this.tmp.lerpVectors(this.fromLook, this.look, k);
      cam.lookAt(this.tmp);
    } else cam.lookAt(this.look);
    cam.rotateZ(Math.sin(t * 0.9) * 0.012); // gentle roll
    cam.updateMatrixWorld();

    // Glitch burst on big hits in a drop; decays fast.
    const drop = this.w.fx.section === 'drop';
    if (drop && M.kick > 0.85 && M.bass > 0.55 && Math.random() < 0.35) this.glitch = 1;
    this.glitch = Math.max(0, this.glitch - dt * 3.5);
  }

  /**
   * The VIP shot `e` seconds into a `D`-second show round the buyer at B: one orbit round them
   * (7 m out, 3.5 m up, starting on the pitch side), a low fly-through just in front of them
   * along their stand (or across the pitch), then a rising pull-back over the pitch that reveals
   * the dark stadium with every light on them. Always above the crowd in the stands.
   */
  vipPose(e, D, B, pos, look) {
    let rx = B.x;
    let rz = B.z - CENTER_Z;
    const rl = Math.hypot(rx, rz);
    if (rl < 1) [rx, rz] = [0, 1];
    else [rx, rz] = [rx / rl, rz / rl]; // out from the centre spot; along the stand is (−rz, rx)
    look.set(B.x, B.y + 1.3, B.z);
    const [orbit, fly, reveal] = this.vipTmp;
    const a = Math.atan2(-rx, -rz) + (e / (0.46 * D)) * TAU;
    orbit.set(B.x + Math.sin(a) * 7, B.y + 3.5, B.z + Math.cos(a) * 7);
    const along = (smooth(0.46 * D, 0.74 * D, e) - 0.5) * 26;
    fly.set(B.x - rz * along - rx * 2, B.y + 2.2, B.z + rx * along - rz * 2);
    const k = smooth(0.74 * D, D, e);
    reveal.set(B.x - rx * (6 + 24 * k), B.y + 3 + 26 * k, B.z - rz * (6 + 24 * k));
    pos.copy(orbit).lerp(fly, smooth(0.4 * D, 0.5 * D, e)).lerp(reveal, smooth(0.7 * D, 0.78 * D, e));
    pos.y = Math.max(pos.y, flyFloor(pos.x, pos.z));
  }

}
