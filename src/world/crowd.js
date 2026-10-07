// Crowd manager: simulated ravers (wander, dance, react, chat), interpolated remote players,
// the resident DJ shown in the booth when no host is live, and floating 3D emoji reactions.

import * as THREE from 'three';
import { Avatar } from '../avatar/avatar.js';
import { randomAvatar, normalizeAvatar } from '../avatar/options.js';
import { mulberry32, pick } from '../core/rng.js';
import { emojiTexture } from './textures.js';
import { STAGE } from './stage.js';

const FIRST = ['Sokha', 'Dara', 'Vanna', 'Bopha', 'Rithy', 'Sreyneang', 'Visal', 'Chenda', 'Pisey', 'Kosal', 'Narin', 'Sophea', 'Mony', 'Chantrea', 'Rotha', 'Veasna', 'Kanha', 'Sothea', 'Lina', 'Panha', 'Seyha', 'Davy', 'Ratana', 'Kimsan', 'Malis', 'Thida', 'Vuthy', 'Socheat', 'Nimol', 'Leakena'];
const HANDLES = ['BassMonk', 'TukTukTurbo', 'AngkorAcid', 'MekongMami', 'KromaKid', 'NeonNaga', 'ApsaraRave', 'RiversideRaver', 'SiemReapSub', 'KampotKick', 'PenhPulse', 'LotusLaser', 'SugarPalmDJ', 'CyberCyclo', 'BayonBeats'];
const TAGS = ['@phnompenh', '@siemreap', '@kampot', '@battambang', '@kep', 'basshead', 'PLUR', 'glow crew', '', '', '', '', ''];

export const BOT_CHAT = {
  general: [
    'this set is unreal 🔥', 'PHNOM PENH WHERE U AT', 'សួស្តី everyone!', 'first time at E-Rave 😭✨',
    'bass is shaking my tuk-tuk', 'who else came from Siem Reap?', 'vibes are immaculate', 'សប្បាយណាស់! 🎉',
    'DJ PLEASE NEVER STOP', 'my glowsticks are dying lol', 'love from Battambang 💜', 'that roneat melody 🥹',
    'hydrate ravers 💧', 'kroma squad rise up', 'can we get a laser storm?!', 'meet at the nom pang stall after',
  ],
  drop: ['DROOOOP 💥', 'OMG THE DROP', '🔥🔥🔥🔥', 'HANDS UP!!!', 'រាំ! រាំ! រាំ!', 'I CAN FEEL IT IN MY CHEST', "let's gooooo", 'BASS 🔊🔊'],
  fx: ['THE FIRE 😱', 'those lasers tho', 'CO2 blast hit different', 'PYRO!!!', 'we are so back', 'DJ is cooking 👨‍🍳'],
  track: ['ID? 👀', 'new track hits', 'this one!!', 'tune 🎶', 'ohhh I know this one'],
};

const RESIDENT = {
  skin: '#a8703f', hair: 'buzz', hairColor: '#141418', top: 'kroma', topColor: '#1d4ed8',
  pants: 'cargo', pantsColor: '#1a1a24', head: 'phones', eyes: 'shutter', hands: 'gloves', accent: 'gold',
};

const DANCE_WEIGHTS = {
  drop: ['jumpwave', 'jumpwave', 'headbang', 'shuffle', 'glowstick', 'sidestep'],
  build: ['idle', 'sidestep', 'glowstick', 'headbang'],
  break: ['idle', 'idle', 'glowstick', 'sidestep'],
  default: ['idle', 'idle', 'shuffle', 'sidestep', 'glowstick', 'headbang', 'jumpwave'],
};

const EMOJI = {
  heart: ['💖', '💜', '💙', '💚', '💛', '❤️'],
  fire: ['🔥'],
  confetti: ['🎉', '🎊', '✨'],
  cheer: ['🙌', '🤘', '👏'],
};
export const REACTION_TYPES = Object.keys(EMOJI);

function lerpAngle(a, b, k) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

class FloatingReactions {
  constructor(scene, max = 80) {
    this.items = [];
    this.cursor = 0;
    for (let i = 0; i < max; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
      s.visible = false;
      s.renderOrder = 6;
      scene.add(s);
      this.items.push({ s, age: 0, life: 0, vx: 0, base: 0 });
    }
  }

  spawn(type, pos) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.s.material.map = emojiTexture(pick(Math.random, EMOJI[type] || EMOJI.heart));
    it.s.material.needsUpdate = true;
    it.s.position.set(pos.x + (Math.random() - 0.5) * 0.6, pos.y + 2.3, pos.z + (Math.random() - 0.5) * 0.6);
    it.age = 0;
    it.life = 1.6 + Math.random() * 0.6;
    it.vx = (Math.random() - 0.5) * 0.6;
    it.base = 0.55 + Math.random() * 0.3;
    it.s.visible = true;
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.s.visible) continue;
      it.age += dt;
      const f = it.age / it.life;
      if (f >= 1) {
        it.s.visible = false;
        continue;
      }
      it.s.position.y += dt * 1.8;
      it.s.position.x += Math.sin(it.age * 6) * dt * 0.4 + it.vx * dt;
      it.s.scale.setScalar(it.base * Math.min(1, it.age * 7));
      it.s.material.opacity = 1 - f * f;
    }
  }
}

export class Crowd {
  constructor(world, botCount) {
    this.world = world;
    this.scene = world.scene;
    this.rng = mulberry32(20251);
    this.bots = [];
    this.remotes = new Map();
    this.reactions = new FloatingReactions(this.scene);
    this.section = 'groove';
    this.localDJ = false;
    this.chatTimer = 4;
    this.onBotChat = null; // (avatar, text)
    this.onReaction = null; // (type, source)
    this.lodScale = 1; // shrunk by the performance governor on weak GPUs
    this.frustum = new THREE.Frustum();
    this.viewProj = new THREE.Matrix4();
    this.sphere = new THREE.Sphere(new THREE.Vector3(), 1.6);

    this.resident = new Avatar(RESIDENT, { name: 'DJ ANGKOR', tag: 'resident selector', isDJ: true });
    this.resident.root.position.copy(STAGE.dj);
    this.resident.setDance('dj');
    this.scene.add(this.resident.root);

    this.setBotCount(botCount);
  }

  // ---------------------------------------------------------------- bots

  setBotCount(n) {
    while (this.bots.length > n) this.bots.pop().av.dispose();
    while (this.bots.length < n) this.spawnBot();
  }

  spawnBot() {
    const r = this.rng;
    const name = r() < 0.6 ? pick(r, FIRST) : pick(r, HANDLES);
    const av = new Avatar(randomAvatar(r), { name, tag: pick(r, TAGS) });
    const pos = this.randomSpot();
    av.root.position.copy(pos);
    av.root.rotation.y = this.faceStage(pos);
    av.setDance(this.pickDance());
    this.scene.add(av.root);
    this.bots.push({
      av,
      target: pos.clone(),
      walking: false,
      nextMove: 8 + Math.random() * 50,
      nextDance: 2 + Math.random() * 12,
      speed: 1.5 + Math.random() * 1.2,
      faceYaw: undefined,
    });
  }

  randomSpot() {
    const z = -17 + Math.pow(Math.random(), 1.5) * 44;
    const half = Math.min(31, 10 + (z + 17) * 0.75);
    return new THREE.Vector3((Math.random() * 2 - 1) * half, 0, z);
  }

  faceStage(p) {
    return Math.atan2(-p.x, STAGE.dj.z - p.z) + (Math.random() - 0.5) * 0.5;
  }

  pickDance() {
    const key = this.section === 'drop' ? 'drop' : this.section === 'build' ? 'build' : this.section.startsWith('break') ? 'break' : 'default';
    return pick(Math.random, DANCE_WEIGHTS[key]);
  }

  setSection(name) {
    this.section = name;
    for (const b of this.bots) if (Math.random() < 0.5) b.nextDance = Math.random() * 2;
  }

  /** Big moment (drop / hype): most of the crowd jumps and throws reactions. */
  erupt(chatPool = 'drop', share = 0.6) {
    for (const b of this.bots) {
      if (Math.random() > share) continue;
      const delay = Math.random() * 1.2;
      setTimeout(() => {
        b.av.setDance(Math.random() < 0.6 ? 'jumpwave' : 'headbang');
        b.av.doCheer();
        b.nextDance = 8 + Math.random() * 10;
        if (Math.random() < 0.5) this.react(b.av, pick(Math.random, ['fire', 'heart', 'cheer', 'confetti']), 'bot');
      }, delay * 1000);
    }
    this.chatSoon(chatPool, 0.4);
    this.chatSoon(chatPool, 1.6);
  }

  chatSoon(pool, delay) {
    setTimeout(() => {
      const b = pick(Math.random, this.bots);
      if (b) this.onBotChat?.(b.av, pick(Math.random, BOT_CHAT[pool] || BOT_CHAT.general));
    }, delay * 1000);
  }

  onKick() {
    if (this.section !== 'drop') return;
    for (const b of this.bots) if (Math.random() < 0.012) this.react(b.av, Math.random() < 0.5 ? 'fire' : 'heart', 'bot');
  }

  react(av, type, source) {
    this.reactions.spawn(type, av.root.position);
    av.doCheer();
    this.onReaction?.(type, source);
  }

  // ---------------------------------------------------------------- remote players

  addRemote(p) {
    if (!p || this.remotes.has(p.id)) return;
    const av = new Avatar(normalizeAvatar(p.avatar), { name: p.name, tag: p.tag, isDJ: p.isDJ });
    av.root.position.set(p.x || 0, p.y || 0, p.z || 12);
    av.root.rotation.y = p.ry || 0;
    av.setDance(p.dance || 'idle');
    this.scene.add(av.root);
    this.remotes.set(p.id, { av, target: av.root.position.clone(), ry: av.root.rotation.y, moving: false, isDJ: !!p.isDJ, name: p.name });
    this.updateResident();
  }

  removeRemote(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.av.dispose();
    this.remotes.delete(id);
    this.updateResident();
  }

  clearRemotes() {
    for (const id of [...this.remotes.keys()]) this.removeRemote(id);
  }

  setRemoteProfile({ id, avatar, name, tag }) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.name = name;
    r.av.name = name;
    r.av.tag = tag;
    r.av.setConfig(normalizeAvatar(avatar));
  }

  applySnapshot(list, selfId) {
    for (const [id, x, y, z, ry, dance, moving] of list) {
      if (id === selfId) continue;
      const r = this.remotes.get(id);
      if (!r) continue;
      r.target.set(x, y, z);
      r.ry = ry;
      r.moving = !!moving;
      if (r.av.dance !== dance) r.av.setDance(dance);
    }
  }

  remote(id) {
    return this.remotes.get(id)?.av || null;
  }

  updateResident() {
    const hostLive = this.localDJ || [...this.remotes.values()].some((r) => r.isDJ);
    this.resident.root.visible = !hostLive;
  }

  get headcount() {
    return this.bots.length + this.remotes.size + 1;
  }

  // ---------------------------------------------------------------- frame

  /** Pick an LOD level, or -1 when the avatar is off-screen and needs no animation. */
  lodFor(pos, dist, reach = 1) {
    this.sphere.center.set(pos.x, pos.y + 1, pos.z);
    if (!this.frustum.intersectsSphere(this.sphere)) return -1;
    const near = 30 * this.lodScale * reach;
    const mid = 65 * this.lodScale * reach;
    return dist < near ? 0 : dist < mid ? 1 : 2;
  }

  update(dt, t, M, camPos) {
    const cam = this.world.camera;
    this.frustum.setFromProjectionMatrix(this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    for (const b of this.bots) {
      const av = b.av;
      const pos = av.root.position;
      b.nextDance -= dt;
      if (b.nextDance <= 0) {
        av.setDance(this.pickDance());
        b.nextDance = 6 + Math.random() * 18;
      }
      if (!b.walking) {
        b.nextMove -= dt;
        if (b.nextMove <= 0) {
          b.target = this.randomSpot();
          b.walking = true;
        }
      } else {
        const dx = b.target.x - pos.x;
        const dz = b.target.z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3) {
          b.walking = false;
          b.nextMove = 20 + Math.random() * 50;
          b.faceYaw = this.faceStage(pos);
        } else {
          pos.x += (dx / d) * b.speed * dt;
          pos.z += (dz / d) * b.speed * dt;
          b.faceYaw = Math.atan2(dx, dz);
        }
      }
      if (b.faceYaw !== undefined) av.root.rotation.y = lerpAngle(av.root.rotation.y, b.faceYaw, 1 - Math.exp(-dt * 6));
      av.setMotion(b.walking ? b.speed : 0);
      const dist = camPos.distanceTo(pos);
      av.setTagOpacity(Math.max(0, Math.min(1, (26 * this.lodScale - dist) / 8)));
      const lod = this.lodFor(pos, dist);
      if (lod >= 0) av.tick(dt, M, lod);
    }

    for (const r of this.remotes.values()) {
      const pos = r.av.root.position;
      const bx = pos.x;
      const bz = pos.z;
      pos.lerp(r.target, 1 - Math.exp(-dt * 10));
      r.av.root.rotation.y = lerpAngle(r.av.root.rotation.y, r.ry, 1 - Math.exp(-dt * 10));
      const speed = Math.hypot(pos.x - bx, pos.z - bz) / Math.max(dt, 1e-3);
      r.av.setMotion(r.moving ? Math.max(2.5, speed) : 0, speed > 6, pos.y > r.target.y + 0.2);
      const dist = camPos.distanceTo(pos);
      r.av.setTagOpacity(Math.max(0, Math.min(1, (60 - dist) / 10)));
      const lod = this.lodFor(pos, dist, 1.4);
      if (lod >= 0) r.av.tick(dt, M, lod);
    }

    if (this.resident.root.visible) {
      this.resident.setTagOpacity(Math.max(0, Math.min(1, (70 - camPos.distanceTo(this.resident.root.position)) / 10)));
      this.resident.update(dt, M);
    }

    this.chatTimer -= dt;
    if (this.chatTimer <= 0 && this.bots.length) {
      this.chatTimer = (this.section === 'drop' ? 4 : 7) + Math.random() * 8;
      this.chatSoon('general', 0);
    }
    this.reactions.update(dt);
  }
}
