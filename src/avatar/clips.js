// Dance clips: dances can be driven by pre-baked animation clips instead of the procedural
// moves in dances.js. A .glb in public/animations/ plays through a THREE.AnimationMixer,
// cross-faded and locked to the room's tempo. Two kinds of file work:
//   • clips made for the avatar rig's node names (RIG_NODES), time-scaled from `baseBpm`;
//   • standard humanoid (Mixamo-named) clips — retargeted onto the rig on load (retarget.js),
//     with their tempo and beat phase detected, then played straight off the beat clock.
// Missing or broken clips fall back to the procedural move (or the vibe), so swapping in
// final mocap needs no code changes.
//
// The avatars are blocky pivot rigs, not skinned meshes, so the mixer runs on a hidden copy
// of the rig and the result is read back as a pose (the same pose the procedural moves
// produce), which keeps clip ↔ procedural blending in one place. Mixamo / FBX mocap has to be
// retargeted onto these node names first (e.g. SkeletonUtils.retargetClip).

import * as THREE from 'three';
import { POSE_KEYS } from './dances.js';
import { ELBOW, KNEE } from './builder.js';
import { findHumanoidBones, retargetHumanoid } from './retarget.js';

/**
 * Clip file per dance. `baseBpm` is the tempo a rig clip was recorded at (playback scales to
 * the room's BPM); humanoid clips have theirs detected, so they leave it out.
 */
export const DANCE_MOVES = {
  MUZZING: { id: 'muzzing', clip: 'animations/muzzing.glb', baseBpm: 150 },
  HAKKEN: { id: 'hakken', clip: 'animations/hakken.glb', baseBpm: 160 },
  GROOVE: { id: 'groove', clip: 'animations/groove.glb', baseBpm: 124 },
  TIKTOK: { id: 'tiktok', clip: 'animations/dance_tiktok.glb' },
};

/** Seconds to cross-fade between dance states (idle, walking, dances, clips). */
export const CROSSFADE = 0.25;

/**
 * Nodes a clip may animate. Rotations are in each node's local axes, as in the procedural
 * poses: torso/head pitch on X, turn on Y and roll on Z; arms swing on X (negative = forward/up),
 * open on Z and twist on Y (Euler order XZY); forearms bend on X at the elbow (negative =
 * forward); legs swing on X and open on Z; shins bend on X at the knee (positive = back).
 * `body.position` is the bounce/sway in rig units and `body.rotation.y` the yaw. `hips` is only
 * the parent of torso and legs.
 */
export const RIG_NODES = ['body', 'hips', 'torso', 'head', 'armL', 'foreL', 'armR', 'foreR', 'legL', 'shinL', 'legR', 'shinR'];

const clips = new Map(); // move id → { clip, baseBpm, beats?, offset? }
const status = new Map(); // move id → 'loading' | 'ready' | 'missing' | 'error'
export const clipFor = (id) => clips.get(id) || null;
/** Load state of a move's clip file (undefined when the move has no clip file). */
export const clipStatus = (id) => status.get(id);

/**
 * Use `clip` for move `id` (also handy for testing a clip without a file). With `beat`
 * ({ beats, offset }), playback is locked to the beat clock: `beats` whole beats per loop, the
 * first one `offset` seconds in. Without it, the clip is time-scaled from `baseBpm`.
 */
export function registerDanceClip(id, clip, baseBpm = 128, beat = null) {
  if (clip instanceof THREE.AnimationClip) {
    clips.set(id, { clip, baseBpm, ...(beat || {}) });
    status.set(id, 'ready');
  }
}

/**
 * Look for each move's clip file and register the ones that load. Resolves with the ids that
 * now use clips; everything else keeps its procedural move.
 */
let loading = null;
export function loadDanceClips() {
  loading ||= loadAll();
  return loading;
}

async function loadAll() {
  const loaded = [];
  let loader = null;
  await Promise.all(
    Object.values(DANCE_MOVES).map(async (m) => {
      if (!m.clip) return;
      status.set(m.id, 'loading');
      try {
        const res = await fetch(new URL(m.clip, document.baseURI));
        const buf = res.ok ? await res.arrayBuffer() : null;
        // Dev servers answer missing files with index.html: only real binary glTF counts.
        if (!buf || buf.byteLength < 12 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'glTF') {
          status.set(m.id, 'missing');
          return;
        }
        if (!loader) {
          const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
          loader = new GLTFLoader();
        }
        const gltf = await loader.parseAsync(buf, '');
        const clip = gltf.animations?.[0];
        if (!clip) throw new Error('the file has no animation');
        if (findHumanoidBones(gltf.scene)) {
          const r = retargetHumanoid(gltf.scene, clip, { name: m.id });
          registerDanceClip(m.id, r.clip, r.baseBpm, { beats: r.beats, offset: r.offset });
          console.info(`[dance] ${m.clip}: humanoid clip retargeted`, r.stats);
        } else {
          registerDanceClip(m.id, clip, m.baseBpm || 128);
        }
        gltf.scene.traverse((o) => {
          o.geometry?.dispose();
          o.material?.dispose?.();
        });
        loaded.push(m.id);
      } catch (err) {
        status.set(m.id, 'error');
        console.warn(`[dance] couldn't use ${m.clip}, keeping the procedural ${m.id}`, err);
      }
    }),
  );
  return loaded;
}

/** Plays clips on a hidden copy of the rig and reads the result back as a pose. */
export class ClipPlayer {
  constructor() {
    const node = (name, parent) => {
      const o = new THREE.Object3D();
      o.name = name;
      parent?.add(o);
      return o;
    };
    this.root = node('rig');
    const body = node('body', this.root);
    const hips = node('hips', body);
    const torso = node('torso', hips);
    node('head', torso);
    for (const side of ['L', 'R']) {
      const arm = node(`arm${side}`, torso);
      arm.rotation.order = 'XZY';
      node(`fore${side}`, arm).position.y = ELBOW;
      node(`shin${side}`, node(`leg${side}`, hips)).position.y = KNEE;
    }
    this.n = Object.fromEntries(RIG_NODES.map((name) => [name, this.root.getObjectByName(name)]));
    this.mixer = new THREE.AnimationMixer(this.root);
    this.action = null;
    this.entry = null;
  }

  /** Switch to move `id`'s clip, cross-fading from the clip that was playing. */
  play(id) {
    const c = clipFor(id);
    if (!c) return false;
    const next = this.mixer.clipAction(c.clip);
    if (next === this.action) return true;
    next.reset().setEffectiveWeight(1).play();
    if (this.action) this.action.crossFadeTo(next, CROSSFADE, false);
    this.action = next;
    this.entry = c;
    return true;
  }

  stop() {
    this.mixer.stopAllAction();
    this.action = null;
    this.entry = null;
  }

  /**
   * Advance and write the pose into `out`. `M` is the beat state ({ bpm, beatCount, phase }) or
   * just a BPM. Beat-locked clips take their time straight from the beat clock — beat n of the
   * room lands on beat n (mod the loop) of the dance, so it can't drift off the kick; other
   * clips are time-scaled from their recorded tempo.
   */
  sample(dt, M, out) {
    const beat = typeof M === 'number' ? { bpm: M } : M || {};
    const c = this.entry;
    if (this.action && c) {
      if (c.beats && Number.isFinite(beat.beatCount)) {
        const pos = ((((beat.beatCount + (beat.phase || 0)) % c.beats) + c.beats) % c.beats);
        this.action.timeScale = 0;
        this.action.time = (c.offset + pos * (c.clip.duration / c.beats)) % c.clip.duration;
      } else {
        this.action.timeScale = (beat.bpm || c.baseBpm) / c.baseBpm;
      }
    }
    this.mixer.update(dt);
    const { body, torso, head, armL, foreL, armR, foreR, legL, shinL, legR, shinR } = this.n;
    for (const k of POSE_KEYS) out[k] = 0;
    out.x = body.position.x;
    out.y = body.position.y;
    out.yaw = body.rotation.y;
    out.tX = torso.rotation.x;
    out.tY = torso.rotation.y;
    out.tZ = torso.rotation.z;
    out.hX = head.rotation.x;
    out.hY = head.rotation.y;
    out.hZ = head.rotation.z;
    out.aLX = armL.rotation.x;
    out.aLY = armL.rotation.y;
    out.aLZ = armL.rotation.z;
    out.eL = foreL.rotation.x;
    out.aRX = armR.rotation.x;
    out.aRY = armR.rotation.y;
    out.aRZ = armR.rotation.z;
    out.eR = foreR.rotation.x;
    out.lLX = legL.rotation.x;
    out.lLZ = legL.rotation.z;
    out.kL = shinL.rotation.x;
    out.lRX = legR.rotation.x;
    out.lRZ = legR.rotation.z;
    out.kR = shinR.rotation.x;
  }
}
