// VIP Bottle Presentation (Aura Farming): a server-synchronised bottle-service show.
// Every client stages the same event around the buyer from its start timestamp:
//   • the moving heads swing onto the buyer and the room dims (lights.js / fx.js)
//   • hostesses (plus security on tier 3) walk in and form a semicircle around them
//   • the lead hostess holds up a sign board with the buyer's text (CanvasTexture)
//   • bottles go up with cold sparklers (tier 2+); a warm spotlight lights the group
//   • the drone cam flies round the buyer and puts them on the LED wall (dronecam.js setVip);
//     tier 3 opens with the sign text on the wall
// Afterwards the entourage walks off, the rig returns to the beat, and the buyer keeps a
// glowing aura. Audio and HUD reactions hang off onStart / onEnd (wired in main.js).

import * as THREE from 'three';
import { Avatar, AVATAR_SCALE } from '../avatar/avatar.js';
import { ELBOW } from '../avatar/builder.js';
import { drawSign, styleMeta, signAnimates, SIGN_W, SIGN_H } from './sign.js';
import { canvasTexture } from './textures.js';
import { hdr } from './shaders.js';
import { groundAt } from './venue.js';

const WALK_IN = 2.4; // seconds for the entourage to reach their spots
const WALK_OUT = 2.4;
const ACCENT = { cyber: 'cyan', gold: 'gold', glitch: 'magenta' };
const SPARK = new THREE.Color(1.7, 1.4, 0.95);
const ROSTERS = {
  1: ['sign', 'bottle'],
  2: ['bottle', 'sign', 'bottle', 'dancer'],
  3: ['security', 'bottle', 'bottle', 'sign', 'dancer', 'bottle', 'bottle', 'security'],
};

const smooth = (a, b, x) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const rand = (a, b) => a + Math.random() * (b - a);

function hostessLook(i, style, lead, tier) {
  return {
    skin: ['#eab68f', '#cf9466', '#a8703f', '#f6d5bd', '#7f4d2b', '#56331c'][i % 6],
    hair: ['long', 'bob', 'topknot', 'long'][i % 4],
    hairColor: ['#141418', '#3b2416', '#141418', '#e9d27a'][i % 4],
    top: 'apsara',
    topColor: '#0b0b12',
    pants: 'sampot',
    pantsColor: '#0b0b12',
    head: lead && tier >= 3 ? 'crown' : 'none',
    eyes: 'none',
    hands: 'none',
    accent: ACCENT[style] || 'gold',
  };
}
const SECURITY = {
  skin: '#7f4d2b', hair: 'buzz', hairColor: '#141418', top: 'tee', topColor: '#0b0b12', pants: 'cargo',
  pantsColor: '#141418', head: 'none', eyes: 'round', hands: 'none', accent: 'red',
};

// Shared bottle parts.
let bottleKit = null;
function makeBottle() {
  bottleKit ||= {
    body: new THREE.CylinderGeometry(0.11, 0.12, 0.42, 12),
    label: new THREE.CylinderGeometry(0.123, 0.123, 0.13, 12),
    neck: new THREE.CylinderGeometry(0.09, 0.04, 0.2, 10),
    cap: new THREE.CylinderGeometry(0.045, 0.045, 0.06, 8),
    glass: new THREE.MeshLambertMaterial({ color: '#0c3b1f', emissive: '#03140a' }),
    gold: new THREE.MeshBasicMaterial({ color: hdr('#ffc400', 1.3) }),
  };
  const k = bottleKit;
  // Built along the arm's -Y (shoulder → hand), so it points wherever the arm points.
  const group = new THREE.Group();
  const add = (geo, mat, y) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    group.add(m);
  };
  add(k.body, k.glass, -1.05);
  add(k.label, k.gold, -1.0);
  add(k.neck, k.glass, -1.36);
  add(k.cap, k.gold, -1.48);
  const tip = new THREE.Object3D();
  tip.position.y = -1.52;
  group.add(tip);
  return { group, tip };
}

// The sign board's brightness: its brightest text stays under the bloom's threshold (0.82), so the
// buyer's text reads sharp instead of blooming into a smear (and throwing lens streaks).
const BOARD_LEVEL = 0.86;
const SIDES = [-1, 1];

export class BottlePresentationManager {
  /**
   * @param world  the World (scene, camera, lights, fx, stage, sparks)
   * @param clock  () => ms on the shared (server-synced) clock
   */
  constructor(world, clock) {
    this.world = world;
    this.scene = world.scene;
    this.clock = clock;
    this.active = null;
    this.pending = [];
    this.resolve = null; // (userId) => Avatar | null — set by main.js
    this.onStart = null; // (event, late) — audio / HUD
    this.onEnd = null; // (event)
    // A real light for the group (the beams are only visual). Always in the scene, so
    // turning it on doesn't recompile every material.
    this.spot = new THREE.SpotLight('#ffe2b8', 0, 40, 0.36, 0.55, 1.1);
    this.scene.add(this.spot, this.spot.target);
    this.spotLevel = 0;
    this.v = new THREE.Vector3();
  }

  /** Start (or queue) a presentation. Joining late shows the rest of it; finished ones are ignored. */
  play(evt, now = this.clock()) {
    if (!evt || !ROSTERS[evt.tier] || !(evt.durationMs > 0)) return;
    const D = evt.durationMs / 1000;
    const elapsed = Math.max(0, (now - evt.timestamp) / 1000);
    if (elapsed > D - 1) return;
    if (this.active) {
      // The server never overlaps them; this only guards against clock skew.
      this.pending.push(evt);
      return;
    }
    try {
      this.start(evt, elapsed);
    } catch (err) {
      console.error('[bottle] could not stage presentation', err);
      this.cleanup();
    }
  }

  start(evt, e0) {
    const D = evt.durationMs / 1000;
    const c = evt.userCoords || {};
    const B = new THREE.Vector3(Number(c.x) || 0, Number(c.y) || 0, Number(c.z) || 12);
    const av = this.resolve?.(evt.userId);
    if (av) B.copy(av.root.position);
    // The entourage lines up on the far side of the buyer from this viewer's camera.
    const cam = this.world.camera.position;
    const center = Math.atan2(B.x - cam.x, B.z - cam.z);
    const roles = ROSTERS[evt.tier];
    const spread = Math.min(1.5, 0.45 * (roles.length - 1));
    const members = roles.map((role, i) => {
      const look = role === 'security' ? SECURITY : hostessLook(i, evt.signStyle, role === 'sign', evt.tier);
      const m = { role, av: new Avatar(look, { nameTag: false }), tip: null, sparkAcc: 0 };
      if (role === 'security') m.av.body.scale.setScalar(AVATAR_SCALE * 1.12);
      m.av.setDance({ sign: 'handsup', bottle: 'pump', dancer: 'glowstick' }[role] || 'idle');
      if (role === 'bottle') {
        const b = makeBottle();
        b.group.position.y = -ELBOW; // built in arm space; the hand is on the forearm now
        m.av.foreR.add(b.group);
        m.tip = b.tip;
      }
      const u = roles.length > 1 ? i / (roles.length - 1) - 0.5 : 0;
      m.angle = center + u * 2 * spread;
      m.radius = role === 'security' ? 3 : 2.3;
      m.delay = i * 0.12;
      this.scene.add(m.av.root);
      return m;
    });
    this.active = {
      evt,
      D,
      B,
      members,
      lead: members.find((m) => m.role === 'sign'),
      board: this.makeBoard(evt),
      t0: performance.now() - e0 * 1000,
      lastDraw: 0,
    };
    this.world.fx.setVip(true);
    this.world.droneCam.setVip({
      timestamp: evt.timestamp, D, target: B, name: evt.userName, text: evt.signText, color: styleMeta(evt.signStyle).color,
    });
    if (evt.tier >= 3 && e0 < 3) {
      // Tier 3 opens with their sign on the wall, then the drone's shot of them takes over.
      this.world.stage.led.setText([evt.signText.toUpperCase()], `VIP · ${evt.userName}`, 3.5 - e0);
    }
    this.onStart?.(evt, e0 > 1.5);
  }

  makeBoard(evt) {
    const big = evt.tier >= 2;
    const w = big ? 3.2 : 2.5;
    const h = (w * SIGN_H) / SIGN_W;
    const canvas = document.createElement('canvas');
    canvas.width = SIGN_W;
    canvas.height = SIGN_H;
    drawSign(canvas, evt.signText, evt.signStyle, { tier: evt.tier, t: 0 });
    const tex = canvasTexture(canvas);
    const group = new THREE.Group();
    const disposables = [tex];
    const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      group.add(m);
      disposables.push(geo, mat);
      return m;
    };
    // The board's face: just under the bloom's threshold (BOARD_LEVEL), so its text stays sharp
    // (the frame, poles and bulbs are separate and glow), drawn after the light beams so a
    // converging spotlight can't wash over it, and filtered for being read at an angle.
    tex.anisotropy = this.world.renderer.capabilities.getMaxAnisotropy();
    const face = mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, color: new THREE.Color(BOARD_LEVEL, BOARD_LEVEL, BOARD_LEVEL) }),
      0, 0, 0.012,
    );
    face.renderOrder = 5;
    mesh(new THREE.BoxGeometry(w * 0.98, h * 0.98, 0.04), new THREE.MeshLambertMaterial({ color: '#0b0b12' }), 0, 0, -0.012);
    // Two poles down to the hostess's raised hands.
    const poleGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6);
    const poleMat = new THREE.MeshBasicMaterial({ color: hdr('#e2b23a', 1.1) });
    for (const sx of [-0.28, 0.28]) mesh(poleGeo, poleMat, sx * w * 0.6, -h / 2 - 0.75, -0.03);
    const bulbs = [];
    if (big) {
      // Luxury vine board: gold frame with a chasing bulb border.
      const gold = new THREE.MeshBasicMaterial({ color: hdr('#e2b23a', 1.2) });
      for (const [bw, bh, x, y] of [[w + 0.12, 0.06, 0, h / 2 + 0.03], [w + 0.12, 0.06, 0, -h / 2 - 0.03], [0.06, h, -w / 2 - 0.03, 0], [0.06, h, w / 2 + 0.03, 0]]) {
        mesh(new THREE.BoxGeometry(bw, bh, 0.06), gold, x, y, 0);
      }
      const on = new THREE.MeshBasicMaterial({ color: hdr(styleMeta(evt.signStyle).color, 2.2) });
      const off = new THREE.MeshBasicMaterial({ color: hdr('#ffd9a0', 0.5) });
      const geo = new THREE.SphereGeometry(0.03, 6, 4);
      disposables.push(on, off, geo);
      const per = 2 * (w + h);
      const count = Math.round(per / 0.16);
      for (let i = 0; i < count; i++) {
        let d = (i / count) * per;
        let x;
        let y;
        if (d < w) [x, y] = [-w / 2 + d, h / 2 + 0.07];
        else if ((d -= w) < h) [x, y] = [w / 2 + 0.07, h / 2 - d];
        else if ((d -= h) < w) [x, y] = [w / 2 - d, -h / 2 - 0.07];
        else [x, y] = [-w / 2 - 0.07, -h / 2 + (d - w)];
        const b = new THREE.Mesh(geo, off);
        b.position.set(x, y, 0.05);
        group.add(b);
        bulbs.push(b);
      }
      group.userData.bulbMats = [on, off];
    }
    group.scale.setScalar(0.001);
    this.scene.add(group);
    return { group, canvas, tex, bulbs, w, h, disposables };
  }

  update(dt, t, M) {
    if (this.spotLevel > 0.001 || this.active) {
      this.spotLevel += ((this.active && this.active.e < this.active.D - 1.6 ? 1 : 0) - this.spotLevel) * Math.min(1, dt * 2);
      this.spot.intensity = 45 * this.spotLevel;
    }
    const a = this.active;
    if (!a) return;
    try {
      this.step(a, dt, t, M);
    } catch (err) {
      console.error('[bottle] presentation update failed', err);
      this.finish();
    }
  }

  step(a, dt, t, M) {
    const { evt, D, B } = a;
    const e = (a.e = (performance.now() - a.t0) / 1000);
    const av = this.resolve?.(evt.userId);
    if (av) B.copy(av.root.position);

    this.world.lights.setFocus(B, e < D - 1.6);
    if (e >= D - 1.2) this.world.fx.setVip(false);
    this.spot.position.set(B.x, B.y + 14, B.z + 2.5);
    this.spot.target.position.set(B.x, B.y + 0.8, B.z);

    const sparkling = evt.tier >= 2 && e < D - WALK_OUT - 0.4;
    const rate = (evt.tier >= 3 ? 70 : 55) * this.world.particleScale;
    const onGround = Math.abs(groundAt(B.x, B.z) - B.y) < 0.3;
    for (const m of a.members) {
      const pin = smooth(m.delay, m.delay + WALK_IN, e);
      const pout = smooth(D - WALK_OUT - 0.3, D - 0.3, e);
      const dx = Math.sin(m.angle);
      const dz = Math.cos(m.angle);
      const off = (1 - pin) * 9 + pout * 7;
      const root = m.av.root;
      const hx = B.x + dx * (m.radius + off);
      const hz = B.z + dz * (m.radius + off);
      // On the venue's ground around the buyer (the rake, in the stands); on the buyer's level
      // when that isn't the venue's ground (the stage).
      root.position.set(hx, onGround ? groundAt(hx, hz) : B.y, hz);
      const walking = (pin > 0.02 && pin < 0.98) || (pout > 0.02 && pout < 0.98);
      // Face the buyer, except while walking off.
      root.rotation.y = pout > 0.02 ? Math.atan2(dx, dz) : Math.atan2(-dx, -dz);
      root.visible = pin > 0;
      root.scale.setScalar(1 - smooth(D - 1.0, D - 0.3, e));
      m.av.setMotion(walking ? 3.2 : 0);
      m.av.update(dt, M);
      if (m.tip && sparkling && pin >= 0.98) this.sparkle(m, m.tip, rate, dt);
    }

    // Sign board, held above the lead hostess and turned to face this viewer.
    const bd = a.board;
    const lead = a.lead?.av;
    if (lead) {
      const arrive = (a.lead.delay || 0) + WALK_IN;
      const k = smooth(arrive - 0.6, arrive, e) * (1 - smooth(D - WALK_OUT - 0.6, D - WALK_OUT + 0.2, e));
      bd.group.scale.setScalar(Math.max(0.001, k));
      // High enough to clear everyone's name tags; the poles reach down to her hands.
      bd.group.position.set(lead.root.position.x, lead.root.position.y + 3.45 + bd.h / 2 + lead.body.position.y * 0.8, lead.root.position.z);
      const cam = this.world.camera.position;
      bd.group.rotation.y = Math.atan2(cam.x - bd.group.position.x, cam.z - bd.group.position.z);
      if (evt.tier >= 3 && sparkling && k > 0.9) {
        // Sparkler fountains on the top corners of the board.
        for (const sx of SIDES) {
          this.v.set((sx * bd.w) / 2, bd.h / 2 + 0.05, 0.05).applyMatrix4(bd.group.matrixWorld);
          this.emitSpark(this.v, (rate * dt) / 2);
        }
      }
    }
    if (bd.bulbs.length) {
      const [on, off] = bd.group.userData.bulbMats;
      const step = Math.floor(t * 12);
      bd.bulbs.forEach((b, i) => (b.material = (i + step) % 4 < 2 ? on : off));
    }
    if (signAnimates(evt.signStyle, evt.tier) && t - a.lastDraw > 0.1) {
      a.lastDraw = t;
      drawSign(bd.canvas, evt.signText, evt.signStyle, { tier: evt.tier, t });
      bd.tex.needsUpdate = true;
    }

    if (e >= D) this.finish();
  }

  sparkle(m, tip, rate, dt) {
    m.sparkAcc += rate * dt;
    if (m.sparkAcc < 1) return;
    tip.getWorldPosition(this.v);
    this.emitSpark(this.v, m.sparkAcc);
    m.sparkAcc -= Math.floor(m.sparkAcc);
  }

  /** Cold-sparkler fountain: tiny hot-white sparks spraying up and falling. */
  emitSpark(p, count) {
    const sparks = this.world.sparks;
    for (let i = 0; i < Math.floor(count); i++) {
      sparks.emit(p.x, p.y, p.z, rand(-1.3, 1.3), rand(2.5, 5.2), rand(-1.3, 1.3), {
        color: SPARK, life: rand(0.35, 0.8), size: rand(0.1, 0.2), alpha: 1, gravity: -7, drag: 0.8,
      });
    }
  }

  /** Presentation over: the buyer keeps their aura; everything else goes away. */
  finish() {
    const a = this.active;
    if (!a) return;
    const av = this.resolve?.(a.evt.userId);
    av?.setAura(styleMeta(a.evt.signStyle).color);
    this.cleanup();
    this.onEnd?.(a.evt);
    const next = this.pending.shift();
    if (next) this.play(next);
  }

  cleanup() {
    const a = this.active;
    this.active = null;
    this.world.lights.setFocus(null, false);
    this.world.fx.setVip(false);
    this.world.droneCam.clearVip();
    if (!a) return;
    for (const m of a.members || []) m.av.dispose();
    if (a.board) {
      a.board.group.removeFromParent();
      for (const d of a.board.disposables) d.dispose?.();
    }
  }
}
