import * as THREE from 'three';
import { buildAvatarGeometry, buildImpostorGeometry, avatarMaterial, ELBOW, KNEE } from './builder.js';
import { computePose, walkPose, makePose, POSE_KEYS, STICK_DANCES } from './dances.js';
import { makeNameTag, makeBubble, disposeSprite } from './nametag.js';
import { beamMaterial, withCrowdGlow } from '../world/shaders.js';
import { clipFor, ClipPlayer, CROSSFADE } from './clips.js';
import { isPhotoUrl } from './photo.js';

export const AVATAR_SCALE = 0.78;
const TAU = Math.PI * 2;
const wrapAngle = (a) => {
  a %= TAU;
  return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a;
};

// Profile photo on the head's front face: a disc with an accent ring (geometry shared).
let photoGeo = null;

// Aura buff (VIP bottle service): shared geometry, one material set per colour.
let auraGeo = null;
const auraMats = new Map();
function auraParts(color) {
  auraGeo ||= {
    ring: new THREE.TorusGeometry(0.62, 0.035, 6, 48),
    inner: new THREE.TorusGeometry(0.42, 0.02, 6, 40),
    column: new THREE.CylinderGeometry(0.55, 0.62, 2.6, 24, 1, true).translate(0, 1.3, 0),
  };
  if (!auraMats.has(color)) {
    auraMats.set(color, {
      // The aura fades with the crowd's glow (Arena Blackout).
      ring: withCrowdGlow(new THREE.MeshBasicMaterial({
        color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      })),
      column: withCrowdGlow(beamMaterial(color, 0.2, 1)),
    });
  }
  return { geo: auraGeo, mat: auraMats.get(color) };
}

/**
 * A blocky festival-goer: pivots for torso/head/arms/legs, procedural dances driven by the
 * shared beat clock, spatial name tag and chat bubble. Every mesh and the tag carry
 * `userData.avatar`, so a raycast can tell which raver was tapped.
 */
export class Avatar {
  constructor(config, { name = '', tag = '', isDJ = false, vip = false, nameTag = true, tagScale = 1 } = {}) {
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
    // Twist about the arm's own axis first, then open (Z), then swing (X).
    this.armL.rotation.order = this.armR.rotation.order = 'XZY';
    this.foreL = new THREE.Group();
    this.foreR = new THREE.Group();
    this.foreL.position.y = this.foreR.position.y = ELBOW;
    this.armL.add(this.foreL);
    this.armR.add(this.foreR);
    this.legL = new THREE.Group();
    this.legL.position.x = 0.24;
    this.legR = new THREE.Group();
    this.legR.position.x = -0.24;
    this.hips.add(this.legL, this.legR);
    this.shinL = new THREE.Group();
    this.shinR = new THREE.Group();
    this.shinL.position.y = this.shinR.position.y = KNEE;
    this.legL.add(this.shinL);
    this.legR.add(this.shinR);

    this.meshes = [];
    this.pose = makePose();
    this.target = makePose();
    this.fromPose = makePose(); // snapshot the cross-fade starts from
    this.fade = 1; // 0 → 1 over fadeTime seconds after a state change
    this.fadeTime = CROSSFADE;
    this.headLook = { x: 0, y: 0 }; // added to the dance's head turn (your raver looks where you look)
    this.state = null; // 'walk' or the dance id
    this.clips = null; // ClipPlayer, created the first time a clip-backed move plays
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
    this.vip = vip; // a VIP ticket: a gold VIP badge on the name tag
    this.tagSprite = null;
    this.bubble = null;
    this.aura = null;
    this.photoUrl = null;
    this.photo = null; // { group, tex, mat, ringMat }
    this.photoImg = null; // the loaded picture, also drawn into the name tag
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
    const g = buildAvatarGeometry(config, { face: !this.photoUrl });
    this.config = g.cfg;
    this.accent = g.accent;
    if (this.photo) this.photo.ringMat.color.set(this.accent).multiplyScalar(1.4);
    const mat = avatarMaterial(this.isDJ); // the DJ's is rim-lit
    const add = (geo, parent) => {
      const m = new THREE.Mesh(geo, mat);
      m.userData.avatar = this;
      parent.add(m);
      this.meshes.push(m);
      return m;
    };
    add(g.torso, this.torso);
    add(g.head, this.head);
    add(g.armL, this.armL);
    add(g.foreL, this.foreL);
    add(g.armR, this.armR);
    add(g.foreR, this.foreR);
    add(g.legL, this.legL);
    add(g.shinL, this.shinL);
    add(g.legR, this.legR);
    add(g.shinR, this.shinR);
    this.stickL = add(g.stickL, this.foreL);
    this.stickR = add(g.stickR, this.foreR);
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
      this.impostor = new THREE.Mesh(buildImpostorGeometry(this.config), avatarMaterial(this.isDJ));
      this.impostor.userData.avatar = this;
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
    if (!!isDJ !== !!this.isDJ) {
      // Became (or stopped being) the DJ: their rim-lit material, or back to the crowd's.
      const mat = avatarMaterial(!!isDJ);
      for (const m of this.meshes) m.material = mat;
      if (this.impostor) this.impostor.material = mat;
    }
    this.name = name;
    this.tag = tag;
    this.isDJ = isDJ;
    disposeSprite(this.tagSprite);
    this.tagSprite = makeNameTag(name, tag, isDJ, this.accent, this.photoImg, this.vip);
    this.tagSprite.scale.multiplyScalar(this.tagScale);
    this.tagSprite.position.y = 2.45;
    this.tagSprite.userData.avatar = this;
    this.root.add(this.tagSprite);
  }

  /** Persistent aura (VIP buff): a glowing ring at the feet and a soft column of light. Null removes it. */
  setAura(color) {
    this.aura?.removeFromParent();
    this.aura = null;
    if (!color) return;
    const { geo, mat } = auraParts(color);
    const g = new THREE.Group();
    const ring = new THREE.Mesh(geo.ring, mat.ring);
    const inner = new THREE.Mesh(geo.inner, mat.ring);
    ring.rotation.x = inner.rotation.x = Math.PI / 2;
    ring.position.y = inner.position.y = 0.05;
    const column = new THREE.Mesh(geo.column, mat.column);
    column.renderOrder = 2;
    g.add(ring, inner, column);
    this.root.add(g);
    this.aura = g;
  }

  /**
   * Show a profile photo (small data URL) as a circle filling the front of the head, and as a
   * round picture in the name tag; null removes it. While a photo is on, the drawn eyes and
   * mouth, eyewear and hair fringe are left off so nothing covers it.
   */
  setPhoto(url) {
    url = isPhotoUrl(url) ? url : null;
    if (url === this.photoUrl) return;
    const faceChanged = !url !== !this.photoUrl;
    this.photoUrl = url;
    this.photoImg = null;
    this.disposePhoto();
    if (faceChanged) this.setConfig(this.config);
    if (!url) return;
    photoGeo ||= { disc: new THREE.CircleGeometry(0.335, 48), ring: new THREE.RingGeometry(0.335, 0.358, 48) };
    const group = new THREE.Group();
    group.position.set(0, 0.46, 0.363);
    // Unlit and not tone-mapped: the picture shows at its real brightness, like a screen,
    // even in the dark room.
    // (and goes dark with the crowd in an Arena Blackout)
    const mat = withCrowdGlow(new THREE.MeshBasicMaterial({ color: '#1a1a22', toneMapped: false }));
    const ringMat = withCrowdGlow(new THREE.MeshBasicMaterial({ color: new THREE.Color(this.accent).multiplyScalar(1.4), toneMapped: false }));
    group.add(new THREE.Mesh(photoGeo.disc, mat), new THREE.Mesh(photoGeo.ring, ringMat));
    this.head.add(group);
    const photo = (this.photo = { group, mat, ringMat, tex: null });
    const img = new Image();
    img.onload = () => {
      if (this.photo !== photo) return; // replaced while loading
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      photo.tex = tex;
      mat.map = tex;
      mat.color.set('#ffffff');
      mat.needsUpdate = true;
      this.photoImg = img;
      if (this.hasTag) this.setLabel(this.name, this.tag, this.isDJ); // picture into the name tag
    };
    img.onerror = () => this.photo === photo && this.setPhoto(null); // unreadable: back to the drawn face
    img.src = url;
  }

  disposePhoto() {
    const p = this.photo;
    if (!p) return;
    p.group.removeFromParent();
    p.tex?.dispose();
    p.mat.dispose();
    p.ringMat.dispose();
    this.photo = null;
  }

  /** Speech bubble above the head for `seconds`. */
  say(text, seconds = 5) {
    disposeSprite(this.bubble);
    this.bubble = makeBubble(text, this.accent);
    // Just above the name tag, whatever size it's drawn at.
    const tag = this.tagSprite;
    this.bubble.position.y = tag?.visible ? tag.position.y + tag.scale.y + 0.06 : 3.0;
    this.root.add(this.bubble);
    this.bubbleTimer = seconds;
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
    const clip = !walking && clipFor(this.dance);
    if (walking) {
      this.walkPhase += dt * (2.2 + this.speed * 1.3);
      walkPose(t, this.walkPhase, this.running);
    } else if (clip) {
      // A pre-baked clip for this move: the mixer cross-fades between clips itself.
      this.clips ||= new ClipPlayer();
      this.clips.play(this.dance);
      this.clips.sample(dt, M, t);
    } else {
      computePose(t, this.dance, M.phase, M.beatCount, 0.55 + Math.min(0.8, M.energy * 1.4), this.seed, M.bpm);
    }
    if (!clip && this.clips?.action) this.clips.stop();

    // Cross-fade on every state change (idle ↔ walking ↔ dances) from a snapshot of the pose
    // we were showing, so nothing snaps. Clip → clip fades are left to the mixer.
    const state = walking ? 'walk' : this.dance;
    if (state !== this.state) {
      const mixerFade = clip && this.state && clipFor(this.state);
      if (this.state !== null && !mixerFade) {
        Object.assign(this.fromPose, this.pose);
        this.fade = 0;
        this.fadeTime = state === 'sit' || this.state === 'sit' ? 0.55 : CROSSFADE; // sitting down / getting up
      }
      this.state = state;
    }
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / this.fadeTime);
      const w = this.fade * this.fade * (3 - 2 * this.fade);
      const f = this.fromPose;
      for (const key of POSE_KEYS) {
        t[key] = key === 'yaw' ? f.yaw + wrapAngle(t.yaw - f.yaw) * w : f[key] + (t[key] - f[key]) * w;
      }
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
    const k = 1 - Math.exp(-dt * 26); // light smoothing on top; the cross-fade does the heavy lifting
    for (const key of POSE_KEYS) {
      if (key === 'yaw') continue;
      p[key] += (t[key] - p[key]) * k;
    }
    // Yaw eases along the shortest arc, so a full spin (0 → 2π, then back to 0) keeps turning
    // the same way instead of unwinding.
    let dy = (t.yaw - p.yaw) % TAU;
    if (dy > Math.PI) dy -= TAU;
    else if (dy < -Math.PI) dy += TAU;
    p.yaw = (p.yaw + dy * k) % TAU;

    this.body.position.set(p.x * AVATAR_SCALE, p.y * AVATAR_SCALE, 0);
    this.body.rotation.y = p.yaw;
    this.torso.rotation.set(p.tX, p.tY, p.tZ);
    this.head.rotation.set(p.hX + this.headLook.x, p.hY + this.headLook.y, p.hZ);
    this.armL.rotation.set(p.aLX, p.aLY, p.aLZ);
    this.armR.rotation.set(p.aRX, p.aRY, p.aRZ);
    this.foreL.rotation.x = p.eL;
    this.foreR.rotation.x = p.eR;
    this.legL.rotation.set(p.lLX, 0, p.lLZ);
    this.legR.rotation.set(p.lRX, 0, p.lRZ);
    this.shinL.rotation.x = p.kL;
    this.shinR.rotation.x = p.kR;

    if (this.aura) {
      const [ring, inner] = this.aura.children;
      ring.scale.setScalar(1 + M.kick * 0.14);
      inner.rotation.z += dt * 1.4;
    }

    const spare = STICK_DANCES.has(this.dance) && !walking && this.config.hands !== 'sticks';
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
    this.aura?.removeFromParent(); // aura geometry/materials are shared
    this.disposePhoto();
    this.root.removeFromParent();
  }
}
