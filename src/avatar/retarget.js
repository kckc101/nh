// Humanoid → E-Rave rig retargeting.
// Turns a clip made for a standard humanoid skeleton (Mixamo bone names: Hips, Spine2, Neck,
// Head, LeftArm, LeftForeArm, LeftHand, LeftUpLeg, LeftLeg, LeftFoot, …) into a clip for the
// blocky avatar rig (body, torso, head, armL/foreL, legL/shinL, …), so it plays through the
// same AnimationMixer path as everything else in clips.js.
//
// The skeleton is played frame by frame and every joint's *direction* is measured in world
// space, then solved into the rig's joint angles (the same conventions as the procedural
// dances). Working from directions rather than copying bone rotations means it doesn't
// matter how the source rig's bones are oriented or what its rest pose is. It also:
//   • scales hip motion by leg length and keeps the soles on the floor,
//   • detects the dance's tempo and where the beats fall — from its bounce when it has a clear
//     one, otherwise from the spacing of its movement accents (motion converted from video is
//     often too irregular to autocorrelate) — so playback can be locked to the room's beat
//     clock,
//   • lightly smooths jitter and keeps arm twist stable when an arm is nearly straight,
//   • smooths the loop seam so the dance repeats without a jump.

import * as THREE from 'three';
import { KNEE } from './builder.js';

const SOLE = -0.47; // sole below the knee, limb space
const HIP_Y = 0.95; // hip joint above the body origin
const LEG_LEN = -KNEE - SOLE; // hip → sole, rig units
const Y = new THREE.Vector3(0, 1, 0);

const BONES = {
  hips: 'Hips', spine: 'Spine2', neck: 'Neck', head: 'Head', headTop: 'HeadTop_End',
  armL: 'LeftArm', foreL: 'LeftForeArm', handL: 'LeftHand',
  armR: 'RightArm', foreR: 'RightForeArm', handR: 'RightHand',
  upLegL: 'LeftUpLeg', legL: 'LeftLeg', footL: 'LeftFoot',
  upLegR: 'RightUpLeg', legR: 'RightLeg', footR: 'RightFoot',
};
const OPTIONAL = new Set(['spine', 'headTop']);

// Pose key → the rig property it animates (the node names ClipPlayer builds).
const TRACKS = {
  x: 'body.position[x]', y: 'body.position[y]', yaw: 'body.rotation[y]',
  tX: 'torso.rotation[x]', tY: 'torso.rotation[y]', tZ: 'torso.rotation[z]',
  hX: 'head.rotation[x]', hY: 'head.rotation[y]', hZ: 'head.rotation[z]',
  aLX: 'armL.rotation[x]', aLY: 'armL.rotation[y]', aLZ: 'armL.rotation[z]', eL: 'foreL.rotation[x]',
  aRX: 'armR.rotation[x]', aRY: 'armR.rotation[y]', aRZ: 'armR.rotation[z]', eR: 'foreR.rotation[x]',
  lLX: 'legL.rotation[x]', lLZ: 'legL.rotation[z]', kL: 'shinL.rotation[x]',
  lRX: 'legR.rotation[x]', lRZ: 'legR.rotation[z]', kR: 'shinR.rotation[x]',
};
const ANGLES = new Set(Object.keys(TRACKS).filter((k) => k !== 'x' && k !== 'y'));

const shortName = (n) => n.replace(/^.*[:|]/, '').replace(/^mixamorig_?/i, '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (x) => x * x * (3 - 2 * x);

/** The humanoid bones under `root`, or null when it isn't a (Mixamo-style) humanoid. */
export function findHumanoidBones(root) {
  const byName = new Map();
  root.traverse((o) => o.isBone && byName.set(shortName(o.name), o));
  const out = {};
  for (const [key, name] of Object.entries(BONES)) {
    out[key] = byName.get(name) || null;
    if (!out[key] && !OPTIONAL.has(key)) return null;
  }
  return out;
}

/** Shoulder/hip solve shared by arms and legs: the limb's direction → swing (X) and open (Z). */
function swingOpen(u) {
  return { x: Math.atan2(-u.z, -u.y), z: Math.asin(clamp(u.x, -1, 1)) };
}

/** Unwrap an angle series in place (no jumps bigger than π between frames). */
function unwrap(a) {
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    if (d > Math.PI || d < -Math.PI) a[i] -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
  }
}

/** Shift a whole angle series by a multiple of 2π so its mean sits in [lo, lo + 2π). */
function center(a, lo) {
  let m = 0;
  for (const v of a) m += v;
  m /= a.length;
  const shift = Math.floor((m - lo) / (2 * Math.PI)) * 2 * Math.PI;
  if (shift) for (let i = 0; i < a.length; i++) a[i] -= shift;
}

/** Normalised autocorrelation of `s` at lag L. */
function autocorr(s, L) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < s.length; i++) {
    den += s[i] * s[i];
    if (i + L < s.length) num += s[i] * s[i + L];
  }
  return den ? num / den : 0;
}

function zscore(a) {
  let m = 0;
  for (const v of a) m += v;
  m /= a.length;
  let sd = 0;
  for (const v of a) sd += (v - m) ** 2;
  sd = Math.sqrt(sd / a.length) || 1;
  return a.map((v) => (v - m) / sd);
}

/**
 * Retarget `clip` (animating the humanoid skeleton in `root`) onto the E-Rave rig.
 * Returns { clip, baseBpm, beats, offset, stats } — `beats` whole beats per loop, the first
 * of them `offset` seconds into the clip — or throws when the rig isn't a humanoid.
 */
export function retargetHumanoid(root, clip, { fps = 30, name = 'retargeted' } = {}) {
  const b = findHumanoidBones(root);
  if (!b) throw new Error('not a humanoid rig (no Hips / arm / leg bones found)');
  root.updateMatrixWorld(true);
  const P = (o) => o.getWorldPosition(new THREE.Vector3());

  // Rest-pose frame: up along the spine, left across the hips, forward = left × up.
  const up = P(b.neck).sub(P(b.hips)).normalize();
  const left = P(b.upLegL).sub(P(b.upLegR));
  left.addScaledVector(up, -left.dot(up)).normalize();
  const fwd = new THREE.Vector3().crossVectors(left, up).normalize();
  const toRig = (v) => v.set(v.dot(left), v.dot(up), v.dot(fwd)); // dot() reads before set() writes
  const legLen = (P(b.upLegL).distanceTo(P(b.legL)) + P(b.legL).distanceTo(P(b.footL)) +
    P(b.upLegR).distanceTo(P(b.legR)) + P(b.legR).distanceTo(P(b.footR))) / 2;
  const k = LEG_LEN / legLen; // source length → rig units
  const hips0 = toRig(P(b.hips));
  const headRestInv = b.head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const headFwdWorld = new THREE.Vector3(fwd.x, fwd.y, fwd.z); // forward, in source world space

  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const dur = clip.duration;
  const N = Math.max(8, Math.round(dur * fps));
  const S = Object.fromEntries(Object.keys(TRACKS).map((key) => [key, new Float32Array(N + 1)]));
  const hipY = new Float32Array(N + 1);
  const energy = new Float32Array(N + 1);
  const p = {};
  const prev = {};
  let twistL = 0;
  let twistR = 0;
  const q = new THREE.Quaternion();
  const qT = new THREE.Quaternion();
  const e3 = new THREE.Euler();
  const v = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  const arm = (shoulder, elbow, hand, qInv, prevTwist) => {
    const u = v.subVectors(elbow, shoulder).applyQuaternion(qInv).normalize();
    const { x, z } = swingOpen(u);
    const f = v2.subVectors(hand, elbow).applyQuaternion(qInv).normalize();
    // Forearm in the arm's frame before its twist: the twist turns the elbow's bend plane.
    const g = f.applyQuaternion(q.setFromEuler(e3.set(x, 0, z, 'XZY')).invert());
    const s = Math.hypot(g.x, g.z);
    const twist = s > 0.3 ? Math.atan2(g.x, g.z) : prevTwist; // (nearly) straight arm: keep the last twist
    return { x, z, twist, e: -Math.atan2(s, -g.y) };
  };
  const leg = (hip, knee, foot, yawInv) => {
    const t = v.subVectors(knee, hip).applyQuaternion(yawInv).normalize();
    const { x, z } = swingOpen(t);
    const s = v2.subVectors(foot, knee).applyQuaternion(yawInv).normalize();
    s.applyQuaternion(q.setFromEuler(e3.set(x, 0, z, 'XYZ')).invert());
    return { x, z, k: Math.max(0, Math.atan2(-s.z, -s.y)) };
  };

  for (let i = 0; i <= N; i++) {
    mixer.setTime((i / N) * dur);
    root.updateMatrixWorld(true);
    for (const key of Object.keys(BONES)) if (b[key]) p[key] = toRig(P(b[key]));
    if (!p.headTop) p.headTop = p.head.clone().add(new THREE.Vector3().subVectors(p.head, p.neck));

    // Facing from the hip line; everything below the waist is solved with that turn removed.
    const hl = new THREE.Vector3().subVectors(p.upLegL, p.upLegR);
    const yaw = Math.atan2(-hl.z, hl.x);
    const yawInv = new THREE.Quaternion().setFromAxisAngle(Y, -yaw);
    S.yaw[i] = yaw;
    S.x[i] = (p.hips.x - hips0.x) * k;
    S.y[i] = (p.hips.y - hips0.y) * k;
    hipY[i] = p.hips.y * k;

    // Torso: lean and roll from the spine, twist from the shoulder line.
    const d = new THREE.Vector3().subVectors(p.neck, p.hips).applyQuaternion(yawInv).normalize();
    const tX = Math.atan2(d.z, d.y);
    const tZ = Math.atan2(-d.x, Math.hypot(d.y, d.z));
    const sh = new THREE.Vector3().subVectors(p.armL, p.armR).applyQuaternion(yawInv);
    const tY = clamp(Math.atan2(-sh.z, sh.x), -1.2, 1.2);
    S.tX[i] = tX;
    S.tY[i] = tY;
    S.tZ[i] = tZ;
    qT.setFromAxisAngle(Y, yaw).multiply(q.setFromEuler(e3.set(tX, tY, tZ, 'XYZ')));
    const qTi = qT.clone().invert();

    // Head: nod / tilt from its up vector, turn from its forward vector (both torso-local).
    const hu = new THREE.Vector3().subVectors(p.headTop, p.head).applyQuaternion(qTi).normalize();
    S.hX[i] = clamp(Math.atan2(hu.z, hu.y), -0.9, 0.9);
    S.hZ[i] = clamp(Math.atan2(-hu.x, Math.hypot(hu.y, hu.z)), -0.6, 0.6);
    const hf = headFwdWorld.clone().applyQuaternion(b.head.getWorldQuaternion(new THREE.Quaternion()).multiply(headRestInv));
    toRig(hf).applyQuaternion(qTi);
    S.hY[i] = clamp(Math.atan2(hf.x, hf.z), -1.2, 1.2);

    // Arms (torso-local) and legs (hip-local, turn removed).
    const L = arm(p.armL, p.foreL, p.handL, qTi, twistL);
    const R = arm(p.armR, p.foreR, p.handR, qTi, twistR);
    twistL = L.twist;
    twistR = R.twist;
    S.aLX[i] = L.x; S.aLY[i] = L.twist; S.aLZ[i] = L.z; S.eL[i] = L.e;
    S.aRX[i] = R.x; S.aRY[i] = R.twist; S.aRZ[i] = R.z; S.eR[i] = R.e;
    const LL = leg(p.upLegL, p.legL, p.footL, yawInv);
    const LR = leg(p.upLegR, p.legR, p.footR, yawInv);
    S.lLX[i] = LL.x; S.lLZ[i] = LL.z; S.kL[i] = LL.k;
    S.lRX[i] = LR.x; S.lRZ[i] = LR.z; S.kR[i] = LR.k;

    // Motion energy (hands + feet speed) for the tempo estimate.
    if (prev.pts) {
      let e = 0;
      for (const key of ['handL', 'handR', 'footL', 'footR', 'hips']) e += p[key].distanceTo(prev.pts[key]);
      energy[i] = e * k;
    }
    prev.pts = Object.fromEntries(['handL', 'handR', 'footL', 'footR', 'hips'].map((key) => [key, p[key].clone()]));
  }
  energy[0] = energy[1];
  mixer.stopAllAction();
  mixer.uncacheRoot(root);

  // ---------------------------------------------------------------- clean up the series
  for (const key of ANGLES) unwrap(S[key]);
  // Light 1-2-1 smoothing against capture jitter (twice for twist, the noisiest channel).
  const soften = (a) => {
    const c = Float32Array.from(a);
    for (let i = 1; i < a.length - 1; i++) a[i] = (c[i - 1] + 2 * c[i] + c[i + 1]) / 4;
  };
  for (const a of Object.values(S)) soften(a);
  soften(S.aLY);
  soften(S.aRY);
  center(S.aLX, -1.5 * Math.PI); // arms: down = 0, forward −π/2, up −π
  center(S.aRX, -1.5 * Math.PI);
  center(S.lLX, -Math.PI);
  center(S.lRX, -Math.PI);
  for (const key of ['aLY', 'aRY', 'yaw']) center(S[key], -Math.PI);
  // Face forward on average and stay on the spot (sway kept, drift removed).
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const yawMean = mean(S.yaw);
  const xMean = mean(S.x);
  for (let i = 0; i <= N; i++) {
    S.yaw[i] -= yawMean;
    S.x[i] = clamp(S.x[i] - xMean, -0.8, 0.8);
  }

  // ---------------------------------------------------------------- feet on the floor
  const fk = new THREE.Group();
  const hipsN = new THREE.Group();
  hipsN.position.y = HIP_Y;
  fk.add(hipsN);
  const soles = [0.24, -0.24].map((x) => {
    const legN = new THREE.Group();
    legN.position.x = x;
    const shin = new THREE.Group();
    shin.position.y = KNEE;
    const sole = new THREE.Object3D();
    sole.position.y = SOLE;
    hipsN.add(legN);
    legN.add(shin);
    shin.add(sole);
    return { legN, shin, sole };
  });
  let corrected = 0;
  for (let i = 0; i <= N; i++) {
    fk.position.set(S.x[i], S.y[i], 0);
    fk.rotation.set(0, S.yaw[i], 0);
    soles[0].legN.rotation.set(S.lLX[i], 0, S.lLZ[i]);
    soles[0].shin.rotation.x = S.kL[i];
    soles[1].legN.rotation.set(S.lRX[i], 0, S.lRZ[i]);
    soles[1].shin.rotation.x = S.kR[i];
    fk.updateMatrixWorld(true);
    const h = Math.min(soles[0].sole.getWorldPosition(v).y, soles[1].sole.getWorldPosition(v2).y);
    // Sinking: lift out. Hovering a little: plant. Clearly airborne (jumps): leave it.
    if (h < 0.06) {
      S.y[i] -= h;
      corrected++;
    }
  }

  // ---------------------------------------------------------------- tempo and beat phase
  const bounce = zscore(Array.from(hipY, (y) => -y));
  const nrgRaw = Array.from(energy);
  const nrgS = nrgRaw.map((x, i) => (nrgRaw[Math.max(0, i - 1)] + 2 * x + nrgRaw[Math.min(N, i + 1)]) / 4);
  const nrg = zscore(nrgS);
  const fold = (sec) => {
    while (sec < 60 / 150) sec *= 2;
    while (sec > 60 / 75) sec /= 2;
    return sec;
  };
  // (a) Autocorrelation of bounce + energy: good when the dancer grooves steadily.
  const sig = bounce.map((x, i) => x + 0.6 * nrg[i]);
  let ac = { score: -Infinity, L: 0, r: 0 };
  for (let L = Math.floor((fps * 60) / 180); L <= Math.ceil((fps * 60) / 70); L++) {
    const bpm = (60 * fps) / L;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 118) / 0.45) ** 2);
    const r = autocorr(sig, L);
    const score = r * (0.6 + 0.4 * prior);
    if (score > ac.score) ac = { score, L, r };
  }
  // (b) Spacing of movement accents (peaks in limb speed): robust to irregular motion.
  const sorted = [...nrgS].sort((x, y) => x - y);
  const floor = sorted[Math.floor(sorted.length * 0.55)];
  const minGap = Math.round(0.28 * fps);
  const peaks = [];
  for (let i = 1; i < N; i++) {
    if (nrgS[i] < floor || nrgS[i] < nrgS[i - 1] || nrgS[i] < nrgS[i + 1]) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < minGap) {
      if (nrgS[i] > nrgS[last]) peaks[peaks.length - 1] = i;
    } else peaks.push(i);
  }
  const gaps = peaks.slice(1).map((i, n) => fold((i - peaks[n]) / fps)).sort((x, y) => x - y);
  const accentPeriod = gaps.length >= 4 ? gaps[Math.floor(gaps.length / 2)] : 0;
  const steady = ac.r >= 0.2 || !accentPeriod;
  const period = steady ? ac.L / fps : accentPeriod;
  // Whole beats per loop (prefer an even count if that's within 6% of the tempo).
  let beats = Math.max(2, Math.round(dur / period));
  const even = 2 * Math.round(dur / period / 2);
  if (even >= 2 && Math.abs(even * period - dur) / dur < 0.06) beats = even;
  const beatLen = dur / beats;
  // Beat phase: the grid offset where accents (and dips) land on the beats.
  const accent = nrg.map((x, i) => x + 0.5 * bounce[i]);
  let offset = 0;
  let bestHit = -Infinity;
  for (let f = 0; f < beatLen * fps; f++) {
    let sum = 0;
    for (let n = 0; n < beats; n++) sum += accent[Math.round((f / fps + n * beatLen) * (N / dur)) % (N + 1)];
    if (sum > bestHit) {
      bestHit = sum;
      offset = f / fps;
    }
  }
  const tempoStats = {
    method: steady ? 'bounce autocorrelation' : 'accent spacing',
    autocorrelation: +ac.r.toFixed(3),
    accents: peaks.length,
    detectedBpm: +(60 / period).toFixed(1),
  };

  // ---------------------------------------------------------------- seamless loop
  const W = Math.min(Math.round(0.45 * fps), Math.floor(N / 4));
  for (const [key, a] of Object.entries(S)) {
    let off = a[0] - a[N];
    if (key === 'yaw') off = Math.atan2(Math.sin(off), Math.cos(off));
    for (let j = 1; j <= W; j++) a[N - W + j] += off * smooth(j / W);
  }

  const times = Float32Array.from({ length: N + 1 }, (_, i) => (i / N) * dur);
  const tracks = Object.entries(TRACKS).map(([key, path]) => new THREE.NumberKeyframeTrack(path, times, S[key]));
  return {
    clip: new THREE.AnimationClip(name, dur, tracks),
    baseBpm: (beats * 60) / dur,
    beats,
    offset,
    stats: { ...tempoStats, beats, loopBpm: +((beats * 60) / dur).toFixed(1), offset: +offset.toFixed(3), frames: N + 1, scale: +k.toFixed(3), groundFixedFrames: corrected },
  };
}
