// Local player: WASD / arrows / touch-joystick movement relative to the camera — a third-person
// orbit (drag to look, wheel / pinch to zoom, all the way out to the whole stadium) or POV
// through your raver's eyes — jumping, simple collision, taps on other ravers, sitting in the
// stands, and the DJ's stage-bound movement when hosting. While the drone cam is on, drag / zoom
// steer the drone's orbit instead.

import * as THREE from 'three';
import { Avatar } from '../avatar/avatar.js';
import { DANCES, RAVE_EMOTES, danceCode } from '../avatar/dances.js';
import { settings } from '../core/device.js';
import { STAGE } from './stage.js';
import { CENTER_Z, PYLON, WALL_D, VIP, capsule, groundAt as venueGround, walkable, inStands, seatNear, inVipArea } from './venue.js';
import { minCameraY } from './environment.js';

const STEP_UP = 1.1; // highest ledge a raver walks up without jumping (ramps are fine)
const MAX_DROP = 2; // a longer drop is a rail (the VIP decks' glass)…
const HOP_DROP = 4.5; // …except off the front of a tier, toward the pitch: hop down
const RADIUS = 0.4;
const TAG_W = 2.76; // matches makeNameTag's sprite size
const TAG_H = 0.69;
const FOV = { third: 70, pov: 80 };
const MIN_DIST = 2.5;
const MAX_DIST = 420; // zoomed all the way out: the whole stadium, both pylons and the city around
const VENUE_FOCUS = new THREE.Vector3(0, 10, CENTER_Z); // what a zoomed-out camera circles
const EYE = 1.86; // eye height above the feet (avatar scale 0.78)
const SEAT_REACH = 4.5; // how close a seat must be for "E to sit"
const SEAT_LOOK = Math.PI; // a seated POV can turn all the way round (360°); your raver's head follows as far as a head can
const SEAT_CHASE = 14; // seated third person: over the shoulder up to this zoom, then the orbit
const TAP_MOVE = 10; // px a pointer may wander and still count as a tap
const TAP_MS = 450;
const _eye = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();
const ACTION_KEYS = {
  ...Object.fromEntries(DANCES.map((d) => [danceCode(d.key), ['dance', d.id]])),
  Digit0: ['dance', 'idle'],
  Backquote: ['dance', 'idle'],
  KeyZ: ['react', 'heart'],
  KeyX: ['react', 'fire'],
  KeyC: ['react', 'confetti'],
  KeyV: ['react', 'cheer'],
  Enter: ['chat'],
  KeyT: ['chat'],
  KeyB: ['drone'],
  KeyI: ['pip'],
  KeyP: ['pov'],
  KeyY: ['say'],
};
/** Seated: which way to face. */
const FACE_KEYS = { Digit1: 'stage', Digit2: 'left', Digit3: 'right', Digit4: 'sky', Numpad1: 'stage', Numpad2: 'left', Numpad3: 'right', Numpad4: 'sky' };
/** Seated: getting up — Space / E just stand; a walking key stands you up and keeps walking. */
const STAND_KEYS = new Set(['Space', 'KeyE']);
const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export class Player {
  constructor(world, profile, isDJ, { vip = false } = {}) {
    this.world = world;
    this.camera = world.camera;
    this.dom = world.renderer.domElement;
    this.isDJ = isDJ;
    this.vip = vip; // a VIP ticket: the VIP decks are yours
    this.onVipOnly = null; // () — a GA raver walked into the VIP decks' rope
    this.avatar = new Avatar(profile.avatar, { name: profile.name, tag: profile.tag, isDJ, vip });
    this.avatar.setPhoto(profile.photo);
    this.pos = this.avatar.root.position;
    if (isDJ) {
      this.pos.copy(STAGE.dj);
      this.yaw = 0;
      this.camYaw = Math.PI;
      this.camDist = 9;
      this.avatar.setDance('dj');
      this.dance = 'dj';
    } else {
      this.pos.set((Math.random() - 0.5) * 14, 0, 8 + Math.random() * 8);
      this.yaw = Math.PI;
      this.camYaw = 0;
      this.camDist = 11;
      this.dance = 'idle';
    }
    this.zoom = this.camDist; // where the wheel / pinch wants camDist; camDist eases there
    this.camPitch = 0.3;
    this.view = 'third';
    this.povPitch = 0.05; // POV (and seated) look pitch, + up
    this.vy = 0;
    this.grounded = true;
    this.moving = false;
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.pointers = new Map();
    this.pinch = 0;
    this.jumpQueued = false;
    this.onAction = null;
    this.onTap = null; // (clientX, clientY) — a click / tap that wasn't a drag
    this.onHover = null; // (clientX, clientY) — mouse moving with no button down; (null) — it left
    this.onSeat = null; // ({ facing } | null) — sat down / turned / stood up
    this.onSeatHint = null; // (bool) — a seat is (no longer) in reach: "E to sit"
    this.seat = null; // { pos, yaw, facing, handle } while sitting in the stands
    this.seatHint = null; // the seat E would take: { x, y, z, handle }
    this.hintAt = 0;
    this.hop = null; // the hop into a seat: { from, t, dur, h }
    this.turn = null; // a seated turn in progress: { yaw, pitch } (camera yaw / look pitch)
    this.tap = null;
    this.target = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.cameraEnabled = true;
    this.camEase = 1; // < 1 while flying back from the drone
    this.avatar.root.rotation.y = this.yaw;
    this.updateTag();
    world.scene.add(this.avatar.root);
    this.bind();
    this.placeCamera(1);
  }

  bind() {
    this.onKeyDown = (e) => {
      if (typing(e.target)) return;
      if (this.seat) {
        // Seated: 1–4 turn you, Space / E stand you up, W (any walking key) gets up and walks;
        // dances wait till you're up.
        const face = !e.shiftKey && FACE_KEYS[e.code];
        if (face || STAND_KEYS.has(e.code)) {
          e.preventDefault();
          if (!e.repeat) {
            if (face) this.face(face);
            else this.standUp();
          }
          return;
        }
        if (WALK_KEYS.has(e.code)) {
          e.preventDefault();
          this.standUp();
          if (!this.seat) this.keys.add(e.code); // up (not mid-hop): carry on walking
          return;
        }
        if (/^(Digit|Numpad)\d$/.test(e.code) || (ACTION_KEYS[e.code]?.[0] === 'dance')) return;
      } else if (e.code === 'KeyE' && this.seatHint) {
        if (!e.repeat) this.sitAt(this.seatHint);
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        this.jumpQueued = true;
        return;
      }
      // Rave emotes: Shift+number (laptops) or the numpad.
      const slot = /^Numpad[1-9]$/.test(e.code) || (e.shiftKey && /^Digit[1-9]$/.test(e.code)) ? Number(e.code.slice(-1)) : 0;
      const emote = slot && RAVE_EMOTES.find((m) => m.slot === slot);
      if (emote) {
        if (!e.repeat) this.onAction?.('emote', emote.id);
        return;
      }
      const act = ACTION_KEYS[e.code];
      if (act && !e.repeat) {
        if (act[0] === 'chat') e.preventDefault();
        this.onAction?.(act[0], act[1]);
        return;
      }
      this.keys.add(e.code);
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);

    const dom = this.dom;
    dom.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dom.setPointerCapture(e.pointerId);
      if (this.pointers.size === 2) this.pinch = this.pinchDist();
      this.tap = this.pointers.size === 1 ? { id: e.pointerId, t: performance.now(), moved: 0 } : null;
      document.activeElement?.blur?.();
    });
    dom.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === 'mouse') this.onHover?.(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.tap?.id === e.pointerId) this.tap.moved += Math.abs(dx) + Math.abs(dy);
      const drone = this.world.drone;
      if (drone?.active) {
        if (this.pointers.size === 1) drone.nudge(dx * (e.pointerType === 'touch' ? 0.004 : 0.003));
        else if (this.pointers.size === 2) {
          const d = this.pinchDist();
          if (this.pinch) drone.zoomBy(this.pinch / d);
          this.pinch = d;
        }
        return;
      }
      if (this.pointers.size === 1) {
        const k = e.pointerType === 'touch' ? 0.007 : 0.005;
        this.turn = null; // you take over from a seated turn
        this.camYaw -= dx * k;
        if (this.view === 'pov' || this.seat) this.povPitch = clamp(this.povPitch - dy * k * 0.8, -1.2, 1.25);
        else this.camPitch = clamp(this.camPitch + dy * k * 0.8, -0.1, 1.45); // never past 83°: no flip over the top
        this.clampSeatLook();
      } else if (this.pointers.size === 2) {
        const d = this.pinchDist();
        if (this.pinch) {
          if (this.view === 'pov') this.world.setFov(clamp(this.camera.fov * (this.pinch / d), 50, 95));
          else this.zoom = clamp(this.zoom * (this.pinch / d) ** 1.4, MIN_DIST, MAX_DIST);
        }
        this.pinch = d;
      }
    });
    const up = (e) => {
      const tap = this.tap;
      if (e.type === 'pointerup' && tap?.id === e.pointerId && tap.moved < TAP_MOVE && performance.now() - tap.t < TAP_MS) {
        this.onTap?.(e.clientX, e.clientY);
      }
      this.tap = null;
      this.pointers.delete(e.pointerId);
      this.pinch = 0;
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && this.onHover?.(null, null));
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const f = clamp(1 + e.deltaY * 0.0012, 0.75, 1.35);
        if (this.world.drone?.active) this.world.drone.zoomBy(f);
        else if (this.view === 'pov') this.world.setFov(clamp(this.camera.fov * f, 50, 95));
        else this.zoom = clamp(this.zoom * f, MIN_DIST, MAX_DIST);
      },
      { passive: false },
    );
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pinchDist() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  setJoystick(x, y) {
    this.joy.x = x;
    this.joy.y = y;
  }

  setDance(id) {
    this.dance = id;
    this.avatar.setDance(id);
  }

  get fov() {
    return FOV[this.view];
  }

  /** 'third' (wide orbit behind your raver) or 'pov' (through your raver's eyes). */
  setView(view) {
    if (view === this.view) return;
    this.view = view;
    if (view === 'pov' && !this.seat) this.povPitch = 0.05;
    this.clampSeatLook();
    if (this.cameraEnabled) this.world.setFov(this.fov);
    this.camEase = Math.min(this.camEase, 0.35); // glide between the two shots
  }

  // ---------------------------------------------------------------- seats in the stands

  /** The seat state the HUD shows: { facing } while seated, else null. */
  get seatState() {
    return this.seat ? { facing: this.seat.facing } : null;
  }

  /** The seat "E" would take from here: a row in front of you (from the track or a VIP deck), or the nearest one in the stands. */
  findSeat() {
    const { x, y, z } = this.pos;
    const c = capsule(x, z);
    const deck = c.onStraight && c.d >= WALL_D && c.d <= VIP.d1 && Math.abs(c.dz) <= VIP.halfZ;
    const row = seatNear(x, z, inStands(x, z) && !deck ? 0 : c.d + 0.3);
    if (!row || Math.hypot(row.x - x, row.y - y, row.z - z) > SEAT_REACH) return null;
    return this.world.env.fans.seatFor(row);
  }

  /** Sit down in a seat ({ x, y, z, handle } from findSeat / World.pickSeat): hop in, or glide there from afar. */
  sitAt(spot) {
    if (this.isDJ || !spot || this.hop) return false;
    if (spot.handle && !this.world.env.fans.claim(spot.handle)) return false; // someone just took it
    if (this.seat) this.leaveSeat(); // moving to another seat
    const at = new THREE.Vector3(spot.x, spot.y, spot.z);
    this.seat = { pos: at, yaw: 0, facing: 'stage', handle: spot.handle };
    const dist = this.pos.distanceTo(at);
    if (dist > 25) {
      // Across the stadium: you're there, and the camera flies over.
      this.pos.copy(at);
      this.camEase = 0;
      this.easeSeconds = 1.8;
    } else this.hop = { from: this.pos.clone(), t: 0, dur: clamp(dist / 8, 0.45, 1.1), h: Math.min(2.2, 0.5 + dist * 0.25) };
    this.vy = 0;
    this.grounded = true;
    this.keys.clear();
    this.zoom = Math.min(this.zoom, 7); // in close to the seat
    this.setDance('sit');
    this.face('stage');
    this.setSeatHint(null);
    return true;
  }

  standUp() {
    if (!this.seat || this.hop) return;
    this.leaveSeat();
    this.setDance('idle');
    this.camPitch = clamp(0.25 - this.povPitch * 0.5, 0.05, 0.8); // the orbit picks up roughly where you were looking
    this.onSeat?.(null);
  }

  leaveSeat() {
    this.world.env.fans.release(this.seat.handle);
    this.seat = null;
    this.hop = null;
    this.turn = null;
    this.avatar.headLook.x = this.avatar.headLook.y = 0;
  }

  /**
   * Seated: which way to face — 'stage' (the DJ on the centre spot), 'left' / 'right' (along the
   * row), 'sky' (up at the nearest pylon's spotlight array and the roof). The body turns on the
   * seat and the view turns with it.
   */
  face(kind) {
    const s = this.seat;
    if (!s) return;
    const { x, y, z } = s.pos;
    const eye = y + 1.45;
    const stage = Math.atan2(-x, CENTER_Z - z);
    let yaw = stage;
    let pitch = 0.04;
    if (kind === 'stage') pitch = Math.atan2(4 - eye, Math.hypot(x, z - CENTER_Z));
    else if (kind === 'left') yaw = stage + Math.PI / 2;
    else if (kind === 'right') yaw = stage - Math.PI / 2;
    else {
      kind = 'sky';
      const tz = CENTER_Z + Math.sign(z - CENTER_Z || 1) * (PYLON.tipDZ - 7);
      yaw = Math.atan2(-x, tz - z);
      pitch = clamp(Math.atan2(PYLON.height - 9 - eye, Math.hypot(x, tz - z)), 0.35, 1.15);
    }
    s.facing = kind;
    s.yaw = yaw;
    this.turn = { yaw: yaw + Math.PI, pitch };
    this.onSeat?.(this.seatState);
  }

  /** Seated POV: your body stays on the seat, but you can look right round (SEAT_LOOK = 180° either way). */
  clampSeatLook() {
    if (!this.seat || this.view !== 'pov') return;
    const rel = clamp(wrap(this.camYaw + Math.PI - this.seat.yaw), -SEAT_LOOK, SEAT_LOOK);
    this.camYaw = this.seat.yaw + rel - Math.PI;
  }

  setSeatHint(hint) {
    if (!hint !== !this.seatHint) this.onSeatHint?.(!!hint);
    this.seatHint = hint;
  }

  updateSeat(dt) {
    const s = this.seat;
    if (this.hop) {
      const h = this.hop;
      h.t = Math.min(1, h.t + dt / h.dur);
      const k = h.t * h.t * (3 - 2 * h.t);
      this.pos.lerpVectors(h.from, s.pos, k);
      this.pos.y += Math.sin(Math.PI * h.t) * h.h;
      if (h.t >= 1) this.hop = null;
    } else this.pos.copy(s.pos);
    this.yaw = lerpAngle(this.yaw, s.yaw, 1 - Math.exp(-dt * (this.hop ? 10 : 6)));
    if (this.turn) {
      const k = 1 - Math.exp(-dt * 5);
      this.camYaw = lerpAngle(this.camYaw, this.turn.yaw, k);
      this.povPitch += (this.turn.pitch - this.povPitch) * k;
      if (Math.abs(wrap(this.turn.yaw - this.camYaw)) < 0.003 && Math.abs(this.turn.pitch - this.povPitch) < 0.003) this.turn = null;
    }
    this.clampSeatLook();
    // Your raver's head follows where you look (within reason).
    this.avatar.headLook.y = clamp(wrap(this.camYaw + Math.PI - this.yaw), -1, 1) * 0.8;
    this.avatar.headLook.x = -clamp(this.povPitch, -0.6, 0.6) * 0.6;
    this.moving = false;
    // The stick stands you up, like the walking keys.
    if (Math.hypot(this.joy.x, this.joy.y) > 0.5) this.standUp();
  }

  // ---------------------------------------------------------------- movement

  groundAt(x, z) {
    if (!this.isDJ) return venueGround(x, z); // the field, the VIP decks and ramps, the stands
    const r = STAGE.riser;
    return x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ ? STAGE.riserY : STAGE.deckY;
  }

  collide(x, z) {
    if (this.isDJ) {
      const b = STAGE.bounds;
      x = clamp(x, b.minX, b.maxX);
      z = clamp(z, b.minZ, b.maxZ);
    }
    const list = this.isDJ ? [STAGE.table] : this.world.obstacles;
    for (const o of list) {
      if (o.r !== undefined) {
        const dx = x - o.x;
        const dz = z - o.z;
        const d = Math.hypot(dx, dz);
        const min = o.r + RADIUS;
        if (d < min && d > 1e-5) {
          x = o.x + (dx / d) * min;
          z = o.z + (dz / d) * min;
        }
      } else {
        const x0 = o.minX - RADIUS;
        const x1 = o.maxX + RADIUS;
        const z0 = o.minZ - RADIUS;
        const z1 = o.maxZ + RADIUS;
        if (x > x0 && x < x1 && z > z0 && z < z1) {
          const pen = [x - x0, x1 - x, z - z0, z1 - z];
          const m = Math.min(...pen);
          if (m === pen[0]) x = x0;
          else if (m === pen[1]) x = x1;
          else if (m === pen[2]) z = z0;
          else z = z1;
        }
      }
    }
    if (!this.isDJ) {
      // Stay inside the stadium and on your level: don't walk up walls (a ledge higher than a
      // step needs the ramp), and don't step off one (the VIP decks' glass rails) — except off
      // the front of a tier toward the pitch, which is a hop down. Slide along whatever blocked.
      const here = capsule(this.pos.x, this.pos.z).d;
      const hopping = inStands(this.pos.x, this.pos.z);
      // The VIP decks and their ramps are VIP-only: anyone else is stopped at the rope.
      const roped = !this.vip && !inVipArea(this.pos.x, this.pos.z);
      const ok = (px, pz) => {
        if (!walkable(px, pz)) return false;
        if (roped && inVipArea(px, pz)) {
          this.onVipOnly?.();
          return false;
        }
        const g = venueGround(px, pz);
        const drop = hopping && capsule(px, pz).d < here ? HOP_DROP : MAX_DROP;
        return g <= this.pos.y + STEP_UP && (!this.grounded || g >= this.pos.y - drop);
      };
      if (!ok(x, z)) {
        if (ok(x, this.pos.z)) z = this.pos.z;
        else if (ok(this.pos.x, z)) x = this.pos.x;
        else return [this.pos.x, this.pos.z];
      }
    }
    return [x, z];
  }

  update(dt, M) {
    let speed = 0;
    let run = false;
    if (this.seat) this.updateSeat(dt);
    else {
      const k = this.keys;
      const has = (...codes) => codes.some((c) => k.has(c));
      let fwd = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0) - this.joy.y;
      let str = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0) + this.joy.x;
      const len = Math.hypot(fwd, str);
      if (len > 1) {
        fwd /= len;
        str /= len;
      }
      run = has('ShiftLeft', 'ShiftRight') || Math.hypot(this.joy.x, this.joy.y) > 0.92;
      speed = (run ? 7.5 : 4.2) * Math.min(1, len);
      this.moving = len > 0.08;
      if (this.moving) {
        const sy = Math.sin(this.camYaw);
        const cy = Math.cos(this.camYaw);
        const mx = -sy * fwd + cy * str;
        const mz = -cy * fwd - sy * str;
        const n = Math.hypot(mx, mz) || 1;
        const [x, z] = this.collide(this.pos.x + (mx / n) * speed * dt, this.pos.z + (mz / n) * speed * dt);
        this.pos.x = x;
        this.pos.z = z;
        this.yaw = lerpAngle(this.yaw, Math.atan2(mx, mz), 1 - Math.exp(-dt * 12));
      }
      // In POV your raver turns to face wherever you look, so others see where you're facing.
      if (this.view === 'pov' && this.cameraEnabled && !this.moving) this.yaw = lerpAngle(this.yaw, this.camYaw + Math.PI, 1 - Math.exp(-dt * 10));

      if (this.jumpQueued && this.grounded) {
        this.vy = 6.5;
        this.grounded = false;
      }
      const ground = this.groundAt(this.pos.x, this.pos.z);
      // Walking down a ramp (or the rake of the stands): stay on it instead of hopping.
      if (this.grounded && this.vy === 0 && this.pos.y > ground + 0.01 && this.pos.y < ground + 0.4) this.pos.y = ground;
      if (!this.grounded || this.pos.y > ground + 0.01) {
        this.vy -= 20 * dt;
        this.pos.y += this.vy * dt;
        if (this.pos.y <= ground) {
          this.pos.y = ground;
          this.vy = 0;
          this.grounded = true;
        } else this.grounded = false;
      } else this.pos.y = ground;

      // Is there a seat in reach ("E to sit")? Checked a few times a second.
      if (!this.isDJ && (this.hintAt -= dt) <= 0) {
        this.hintAt = 0.15;
        this.setSeatHint(this.grounded ? this.findSeat() : null);
      }
    }
    this.jumpQueued = false;

    const pov = this.view === 'pov' && this.cameraEnabled;
    this.avatar.root.rotation.y = this.yaw;
    this.avatar.setMotion(this.moving ? speed : 0, run, !this.grounded && !this.seat);
    this.avatar.update(dt, M);
    this.updateTag();
    // Hidden from yourself once the POV camera gets close to your head.
    this.avatar.root.visible = !(pov && this.camera.position.distanceTo(_eye.set(this.pos.x, this.pos.y + EYE, this.pos.z)) < 2.5);
    if (this.cameraEnabled) this.placeCamera(dt);
  }

  /**
   * Your own name tag (with your profile picture): shown unless turned off in settings, a bit
   * bigger than other people's so you can see your picture from behind, and three times
   * bigger from the drone so you can spot yourself in the crowd.
   */
  updateTag() {
    const drone = this.world.drone?.active;
    this.avatar.setTagOpacity(drone || settings.showMyTag !== false ? 1 : 0);
    const k = drone ? 3 : 1.3;
    this.avatar.tagSprite?.scale.set(TAG_W * k, TAG_H * k, 1);
  }

  /** Fly the camera back from the drone (it eases in instead of snapping). */
  returnFrom(look) {
    this.look.copy(look);
    this.camEase = 0;
    this.easeSeconds = 1.4;
  }

  /** Open on a wide establishing shot (pos, look), hold it, then glide down to the raver. */
  /** Arrive standing at a spot (a VIP deck), facing the DJ on the centre spot. */
  arriveAt({ x, y, z }) {
    if (this.seat) this.leaveSeat();
    this.pos.set(x, y, z);
    this.yaw = Math.atan2(-x, CENTER_Z - z);
    this.camYaw = this.yaw + Math.PI;
    this.vy = 0;
    this.grounded = true;
  }

  introFrom(pos, look, { hold = 1.4, seconds = 4.5 } = {}) {
    this.camera.position.copy(pos);
    this.look.copy(look);
    this.camera.lookAt(this.look);
    this.camEase = 0;
    this.easeSeconds = seconds;
    this.holdUntil = performance.now() + hold * 1000;
  }

  /**
   * The third-person orbit: around your raver up close; zooming out, the pivot slides to the
   * middle of the pitch (so the whole stadium turns around its centre) and the camera rises so
   * it clears the stands — it glides over a smooth lid across the tiers instead of their steps.
   */
  orbitShot(d, target) {
    const dist = this.camDist;
    target.set(this.pos.x, this.pos.y + 1.8, this.pos.z).lerp(VENUE_FOCUS, smooth(50, 260, dist));
    const pitch = Math.max(this.camPitch, -0.1 + 0.55 * smooth(25, 250, dist));
    const cp = Math.cos(pitch);
    d.set(
      target.x + Math.sin(this.camYaw) * cp * dist,
      target.y + Math.sin(pitch) * dist,
      target.z + Math.cos(this.camYaw) * cp * dist,
    );
    // The stage stands on the middle of the pitch: never put the camera inside the LED wall
    // (stay on the raver's side of it), never under the deck.
    if (d.y < 24 && Math.abs(d.x) < 26 && d.z < -37.4 && d.z > -41) d.z = target.z > -38.9 ? -37.4 : -41;
    if (d.z < STAGE.front + 0.3 && d.z > -40.3 && Math.abs(d.x) < 24.5) d.y = Math.max(d.y, STAGE.deckY + 0.8);
    d.y = Math.max(d.y, minCameraY(d.x, d.z, smooth(12, 40, dist)));
  }

  /** Seated, third person: over your shoulder, looking wherever you look (up at the pylons too). */
  seatShot(pos, look) {
    const ly = this.camYaw + Math.PI;
    const fx = Math.sin(ly);
    const fz = Math.cos(ly);
    const cp = Math.cos(this.povPitch);
    const dist = clamp(this.camDist, MIN_DIST, SEAT_CHASE);
    const hx = this.pos.x;
    const hy = this.pos.y + 1.5;
    const hz = this.pos.z;
    pos.set(hx - fx * dist * 0.9, hy + 0.5 + dist * 0.3, hz - fz * dist * 0.9);
    pos.y = Math.max(pos.y, minCameraY(pos.x, pos.z));
    look.set(hx + fx * cp * 30, hy + Math.sin(this.povPitch) * 30, hz + fz * cp * 30);
  }

  placeCamera(dt) {
    // Never let a bad number into the camera (it would blank the view for good): back to defaults.
    if (![this.camYaw, this.camPitch, this.camDist, this.zoom, this.povPitch].every(Number.isFinite)) {
      Object.assign(this, { camYaw: this.yaw + Math.PI, camPitch: 0.3, camDist: 11, zoom: 11, povPitch: 0.05 });
    }
    // Zoom eases in log space, so a long pull out to the whole stadium stays even.
    if (Math.abs(this.zoom - this.camDist) > 1e-3) {
      this.camDist = Math.exp(Math.log(this.camDist) + (Math.log(this.zoom) - Math.log(this.camDist)) * (1 - Math.exp(-dt * 7)));
    }
    const d = this.desired;
    const pov = this.view === 'pov';
    if (pov) {
      // Eye height with a little of the dance bounce (seated: the lowered hips), looking along camYaw / povPitch.
      const cp = Math.cos(this.povPitch);
      const fx = -Math.sin(this.camYaw) * cp;
      const fz = -Math.cos(this.camYaw) * cp;
      const fy = Math.sin(this.povPitch);
      const bob = this.avatar.body.position.y * (this.seat ? 1 : 0.4);
      d.set(this.pos.x + fx * 0.12, this.pos.y + EYE + bob, this.pos.z + fz * 0.12);
      this.target.set(d.x + fx * 10, d.y + fy * 10, d.z + fz * 10);
    } else {
      this.orbitShot(d, this.target);
      // Seated: over the shoulder until you zoom well out, then the orbit takes over.
      const w = this.seat ? 1 - smooth(SEAT_CHASE, 60, this.camDist) : 0;
      if (w > 0) {
        this.seatShot(_pos, _look);
        d.lerp(_pos, w);
        this.target.lerp(_look, w);
      }
    }
    // Near plane: never tiny (a 0.1 m near plane spends the depth buffer's precision up close and
    // the stadium shimmers far away); it grows with the zoom. On a portrait screen the view also
    // widens as you zoom out, so the whole stadium fits across.
    const cam = this.camera;
    const near = pov ? 0.3 : clamp(this.camDist * 0.01, 0.5, 4);
    const fov = pov ? cam.fov : FOV.third + (this.world.fitFov(FOV.third) - FOV.third) * smooth(40, 250, this.camDist);
    if (Math.abs(near - cam.near) > cam.near * 0.05 || Math.abs(fov - cam.fov) > 0.05 || !Number.isFinite(cam.fov)) {
      cam.near = near;
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    if (this.holdUntil && performance.now() < this.holdUntil) {
      this.camera.lookAt(this.look); // establishing shot: hold
      return;
    }
    const ease = this.camEase;
    if (ease < 1) this.camEase = Math.min(1, ease + dt / (this.easeSeconds || 1.4));
    if (pov && ease >= 1) this.camera.position.copy(d);
    else this.camera.position.lerp(d, 1 - Math.exp(-dt * (2 + 12 * ease * ease)));
    if (ease < 1) this.look.lerp(this.target, 1 - Math.exp(-dt * (3 + 12 * ease)));
    else this.look.copy(this.target);
    this.camera.lookAt(this.look);
  }

  netState() {
    const r = (v) => Math.round(v * 100) / 100;
    return [r(this.pos.x), r(this.pos.y), r(this.pos.z), r(this.yaw), this.dance, this.moving ? 1 : 0];
  }
}
