import * as THREE from 'three';
import { buildAvatarGeometry, buildImpostorGeometry, avatarMaterial } from './builder.js';
import { computePose, walkPose, makePose, POSE_KEYS } from './dances.js';
import { makeNameTag, makeBubble, disposeSprite } from './nametag.js';

export const AVATAR_SCALE = 0.78;

/**
 * A blocky festival-goer: pivots for torso/head/arms/legs, procedural dances driven by the
 * shared beat clock, spatial name tag and chat bubble.
 */
export class Avatar {
  constructor(config, { name = '', tag = '', isDJ = false, nameTag = true, tagScale = 1 } = {}) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(AVATAR_SCALE);
    this.root.add(this.body);

    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);
    this.torso = new THREE.Group();
    this.hips.add(this.torso);
    this.head = new THREE.Group();
    this.head.position.y = 0.95;
    this.torso.add(this.head);
    this.armL = new THREE.Group();
    this.armL.position.set(0.7, 0.86, 0);
    this.armR = new THREE.Group();
    this.armR.position.set(-0.7, 0.86, 0);
    this.torso.add(this.armL, this.armR);
    this.legL = new THREE.Group();
    this.legL.position.x = 0.24;
    this.legR = new THREE.Group();
    this.legR.position.x = -0.24;
    this.hips.add(this.legL, this.legR);

    this.meshes = [];
    this.pose = makePose();
    this.target = makePose();
    this.dance = 'idle';
    this.speed = 0;
    this.running = false;
    this.airborne = false;
    this.walkPhase = 0;
    this.cheer = 0;
    this.seed = Math.random() * Math.PI * 2;
    this.name = name;
    this.tag = tag;
    this.isDJ = isDJ;
    this.tagSprite = null;
    this.bubble = null;
    this.bubbleTimer = 0;
    this.hasTag = nameTag;
    this.lod = 0;
    this.impostor = null;
    this.lodAcc = 0;
    this.lodFrame = Math.floor(Math.random() * 3); // staggers reduced-rate updates across the crowd
    this.tagScale = tagScale;

    this.setConfig(config);
  }

  setConfig(config) {
    if (this.impostor) {
      this.impostor.removeFromParent();
      this.impostor.geometry.dispose();
      this.impostor = null;
    }
    for (const m of this.meshes) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    this.meshes = [];
    const g = buildAvatarGeometry(config);
    this.config = g.cfg;
    this.accent = g.accent;
    const mat = avatarMaterial();
    const add = (geo, parent) => {
      const m = new THREE.Mesh(geo, mat);
      parent.add(m);
      this.meshes.push(m);
      return m;
    };
    add(g.torso, this.torso);
    add(g.head, this.head);
    add(g.armL, this.armL);
    add(g.armR, this.armR);
    add(g.legL, this.legL);
    add(g.legR, this.legR);
    this.stickL = add(g.stickL, this.armL);
    this.stickR = add(g.stickR, this.armR);
    this.stickL.visible = this.stickR.visible = false;
    if (this.hasTag) this.setLabel(this.name, this.tag, this.isDJ);
    if (this.lod === 2) {
      this.lod = 0;
      this.setLOD(2);
    }
  }

  /** 0 = full rig, 1 = full rig animated at a reduced rate, 2 = single-mesh impostor. */
  setLOD(level) {
    if (level === this.lod) return;
    if (level === 2 && !this.impostor) {
      this.impostor = new THREE.Mesh(buildImpostorGeometry(this.config), avatarMaterial());
      this.body.add(this.impostor);
    }
    this.hips.visible = level !== 2;
    if (this.impostor) this.impostor.visible = level === 2;
    this.lod = level;
  }

  /** LOD-aware per-frame update (the crowd decides the level from distance and GPU budget). */
  tick(dt, M, level) {
    this.setLOD(level);
    if (level === 0) return this.update(dt, M);
    if (level === 1) {
      this.lodAcc += dt;
      if (++this.lodFrame % 3 === 0) {
        this.update(Math.min(this.lodAcc, 0.1), M);
        this.lodAcc = 0;
      }
      return;
    }
    // Far away: just bob on the beat.
    const dip = 1 - Math.abs(Math.sin(Math.PI * M.phase));
    this.body.position.set(0, -0.06 * dip * AVATAR_SCALE, 0);
    this.body.rotation.y = 0;
    this.tickBubble(dt);
  }

  setLabel(name, tag, isDJ) {
    this.name = name;
    this.tag = tag;
    this.isDJ = isDJ;
    disposeSprite(this.tagSprite);
    this.tagSprite = makeNameTag(name, tag, isDJ, this.accent);
    this.tagSprite.scale.multiplyScalar(this.tagScale);
    this.tagSprite.position.y = 2.45;
    this.root.add(this.tagSprite);
  }

  say(text) {
    disposeSprite(this.bubble);
    this.bubble = makeBubble(text, this.accent);
    this.bubble.position.y = this.tag ? 3.1 : 2.95;
    this.root.add(this.bubble);
    this.bubbleTimer = 5;
  }

  setDance(id) {
    this.dance = id;
  }

  setMotion(speed, running = false, airborne = false) {
    this.speed = speed;
    this.running = running;
    this.airborne = airborne;
  }

  doCheer() {
    this.cheer = 1.2;
  }

  setTagOpacity(o) {
    if (!this.tagSprite) return;
    this.tagSprite.visible = o > 0.02;
    this.tagSprite.material.opacity = o * 0.95;
  }

  update(dt, M) {
    const t = this.target;
    const walking = this.speed > 0.3;
    if (walking) {
      this.walkPhase += dt * (2.2 + this.speed * 1.3);
      walkPose(t, this.walkPhase, this.running);
    } else {
      computePose(t, this.dance, M.phase, M.beatCount, 0.55 + Math.min(0.8, M.energy * 1.4), this.seed);
    }
    if (this.airborne) {
      t.lLX = -0.55;
      t.lRX = -0.25;
      t.aLZ = 0.5;
      t.aRZ = -0.5;
    }
    if (this.cheer > 0) {
      this.cheer -= dt;
      const w = Math.min(1, this.cheer * 2);
      t.aLX += (-2.9 - t.aLX) * w;
      t.aRX += (-2.9 - t.aRX) * w;
      t.aLZ += (0.35 - t.aLZ) * w;
      t.aRZ += (-0.35 - t.aRZ) * w;
    }

    const p = this.pose;
    const k = 1 - Math.exp(-dt * 18);
    for (const key of POSE_KEYS) p[key] += (t[key] - p[key]) * k;

    this.body.position.set(p.x * AVATAR_SCALE, p.y * AVATAR_SCALE, 0);
    this.body.rotation.y = p.yaw;
    this.torso.rotation.set(p.tX, 0, p.tZ);
    this.head.rotation.set(p.hX, p.hY, p.hZ);
    this.armL.rotation.set(p.aLX, 0, p.aLZ);
    this.armR.rotation.set(p.aRX, 0, p.aRZ);
    this.legL.rotation.set(p.lLX, 0, p.lLZ);
    this.legR.rotation.set(p.lRX, 0, p.lRZ);

    const spare = this.dance === 'glowstick' && !walking && this.config.hands !== 'sticks';
    this.stickL.visible = this.stickR.visible = spare;
    this.tickBubble(dt);
  }

  tickBubble(dt) {
    if (this.bubble) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0) {
        disposeSprite(this.bubble);
        this.bubble = null;
      } else {
        this.bubble.material.opacity = Math.min(1, this.bubbleTimer * 2);
      }
    }
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.impostor?.geometry.dispose();
    disposeSprite(this.tagSprite);
    disposeSprite(this.bubble);
    this.root.removeFromParent();
  }
}
