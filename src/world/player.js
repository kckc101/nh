// Local player: WASD / arrows / touch-joystick movement relative to a third-person orbit
// camera (drag to look, wheel / pinch to zoom), jumping, simple collision, and the DJ's
// stage-bound movement when hosting.

import * as THREE from 'three';
import { Avatar } from '../avatar/avatar.js';
import { STAGE } from './stage.js';

const GROUNDS = { minX: -50, maxX: 50, minZ: -18.4, maxZ: 64 };
const RADIUS = 0.4;
const ACTION_KEYS = {
  Digit1: ['dance', 'headbang'],
  Digit2: ['dance', 'jumpwave'],
  Digit3: ['dance', 'shuffle'],
  Digit4: ['dance', 'sidestep'],
  Digit5: ['dance', 'glowstick'],
  Digit0: ['dance', 'idle'],
  Backquote: ['dance', 'idle'],
  KeyZ: ['react', 'heart'],
  KeyX: ['react', 'fire'],
  KeyC: ['react', 'confetti'],
  KeyV: ['react', 'cheer'],
  Enter: ['chat'],
  KeyT: ['chat'],
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export class Player {
  constructor(world, profile, isDJ) {
    this.world = world;
    this.camera = world.camera;
    this.dom = world.renderer.domElement;
    this.isDJ = isDJ;
    this.avatar = new Avatar(profile.avatar, { name: profile.name, tag: profile.tag, isDJ });
    this.pos = this.avatar.root.position;
    if (isDJ) {
      this.pos.copy(STAGE.dj);
      this.yaw = 0;
      this.camYaw = Math.PI;
      this.camDist = 6.5;
      this.avatar.setDance('dj');
      this.dance = 'dj';
    } else {
      this.pos.set((Math.random() - 0.5) * 14, 0, 8 + Math.random() * 8);
      this.yaw = Math.PI;
      this.camYaw = 0;
      this.camDist = 7.5;
      this.dance = 'idle';
    }
    this.camPitch = 0.28;
    this.vy = 0;
    this.grounded = true;
    this.moving = false;
    this.keys = new Set();
    this.joy = { x: 0, y: 0 };
    this.pointers = new Map();
    this.pinch = 0;
    this.jumpQueued = false;
    this.onAction = null;
    this.target = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.avatar.root.rotation.y = this.yaw;
    this.avatar.setTagOpacity(0);
    world.scene.add(this.avatar.root);
    this.bind();
    this.placeCamera(1);
  }

  bind() {
    this.onKeyDown = (e) => {
      if (typing(e.target)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.jumpQueued = true;
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
      document.activeElement?.blur?.();
    });
    dom.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        const k = e.pointerType === 'touch' ? 0.007 : 0.005;
        this.camYaw -= dx * k;
        this.camPitch = clamp(this.camPitch + dy * k * 0.8, -0.1, 1.25);
      } else if (this.pointers.size === 2) {
        const d = this.pinchDist();
        if (this.pinch) this.camDist = clamp(this.camDist * (this.pinch / d), 3, 24);
        this.pinch = d;
      }
    });
    const up = (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch = 0;
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.camDist = clamp(this.camDist * (1 + e.deltaY * 0.001), 3, 24);
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

  groundAt(x, z) {
    if (!this.isDJ) return 0;
    const r = STAGE.riser;
    return x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ ? STAGE.riserY : STAGE.deckY;
  }

  collide(x, z) {
    const b = this.isDJ ? STAGE.bounds : GROUNDS;
    x = clamp(x, b.minX, b.maxX);
    z = clamp(z, b.minZ, b.maxZ);
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
    return [x, z];
  }

  update(dt, M) {
    const k = this.keys;
    const has = (...codes) => codes.some((c) => k.has(c));
    let fwd = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0) - this.joy.y;
    let str = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0) + this.joy.x;
    const len = Math.hypot(fwd, str);
    if (len > 1) {
      fwd /= len;
      str /= len;
    }
    const run = has('ShiftLeft', 'ShiftRight') || Math.hypot(this.joy.x, this.joy.y) > 0.92;
    const speed = (run ? 7.5 : 4.2) * Math.min(1, len);
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

    if (this.jumpQueued && this.grounded) {
      this.vy = 6.5;
      this.grounded = false;
    }
    this.jumpQueued = false;
    const ground = this.groundAt(this.pos.x, this.pos.z);
    if (!this.grounded || this.pos.y > ground + 0.01) {
      this.vy -= 20 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.vy = 0;
        this.grounded = true;
      } else this.grounded = false;
    } else this.pos.y = ground;

    this.avatar.root.rotation.y = this.yaw;
    this.avatar.setMotion(this.moving ? speed : 0, run, !this.grounded);
    this.avatar.update(dt, M);
    this.placeCamera(dt);
  }

  placeCamera(dt) {
    this.target.set(this.pos.x, this.pos.y + 1.7, this.pos.z);
    const cp = Math.cos(this.camPitch);
    this.desired.set(
      this.target.x + Math.sin(this.camYaw) * cp * this.camDist,
      Math.max(0.5, this.target.y + Math.sin(this.camPitch) * this.camDist),
      this.target.z + Math.cos(this.camYaw) * cp * this.camDist,
    );
    // Keep the camera out of the stage geometry: never behind the LED wall, never
    // under the deck when it swings over the stage.
    const d = this.desired;
    d.z = Math.max(d.z, -37.4);
    if (d.z < STAGE.front + 0.3 && Math.abs(d.x) < 24.5) d.y = Math.max(d.y, STAGE.deckY + 0.8);
    this.camera.position.lerp(d, 1 - Math.exp(-dt * 14));
    this.camera.lookAt(this.target);
  }

  netState() {
    const r = (v) => Math.round(v * 100) / 100;
    return [r(this.pos.x), r(this.pos.y), r(this.pos.z), r(this.yaw), this.dance, this.moving ? 1 : 0];
  }
}
