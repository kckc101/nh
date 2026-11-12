// Procedural dances. Every pose is a pure function of the shared beat clock
// (phase 0..1 within the beat + beat counter), so the whole crowd moves in time with the
// music on every client without sending animation data over the network.
//
// Rotation conventions (avatar faces +Z):
//   arms/legs hang down — negative X swings them forward/up, +Z moves the left limb outward
//   torso/head sit on top — positive X leans/nods forward

const TAU = Math.PI * 2;

export const DANCES = [
  { id: 'headbang', label: 'Headbang', key: '1', icon: '🤘' },
  { id: 'jumpwave', label: 'Jump Wave', key: '2', icon: '🙌' },
  { id: 'shuffle', label: 'Shuffle', key: '3', icon: '👟' },
  { id: 'sidestep', label: 'Side-Step', key: '4', icon: '💃' },
  { id: 'glowstick', label: 'Glowsticks', key: '5', icon: '🪄' },
  { id: 'pump', label: 'Fist Pump', key: '6', icon: '✊' },
  { id: 'runningman', label: 'Running Man', key: '7', icon: '🏃' },
  { id: 'cutshapes', label: 'Cut Shapes', key: '8', icon: '✂️' },
  { id: 'jumpstyle', label: 'Hardstyle', key: '9', icon: '🦵' },
  { id: 'liquid', label: 'Liquid Arms', key: 'Q', icon: '🌊' },
  { id: 'handsup', label: 'Hands Up', key: 'E', icon: '👐' },
  { id: 'lasso', label: 'Lasso', key: 'R', icon: '🤠' },
  { id: 'spin', label: 'Spin', key: 'F', icon: '🌀' },
];

/** Dances that hand the avatar a spare pair of glowsticks when it isn't carrying any. */
export const STICK_DANCES = new Set(['glowstick', 'liquid', 'lasso']);

/**
 * Rave emotes — their own quick-bar, Shift+1/2/3 or Numpad 1/2/3, synced with the
 * AVATAR_DANCE_CHANGE message. Pre-baked clips can take over from these procedural moves
 * (see clips.js); `cadence(bpm)` is how many steps land on each beat at a given tempo.
 */
export const RAVE_EMOTES = [
  { id: 'muzzing', label: 'Muzzing', icon: '✋', slot: 1, cadence: (bpm) => (bpm > 170 ? 1 : 2) },
  { id: 'hakken', label: 'Hakken', icon: '🦶', slot: 2, cadence: (bpm) => (bpm >= 145 ? 1 : 2) },
  { id: 'groove', label: 'Groove', icon: '🕺', slot: 3, cadence: () => 1 },
  // Clip-only: the retargeted public/animations/dance_tiktok.glb (falls back to the vibe).
  { id: 'tiktok', label: 'TikTok', icon: '📱', slot: 4, cadence: () => 1 },
];
const emoteCadence = (id, bpm) => RAVE_EMOTES.find((e) => e.id === id).cadence(bpm || 128);

// Muzzing, studied from a hardstyle muzzing clip: hands popping to the face, fast horizontal
// chops across the chest, an arm flung up, a low stance pumping on every kick. The arm angles
// were solved so this avatar's hands and elbows land where the dancer's do (its arms are
// short and its shoulders wide, so the face moves sit at the side of the jaw / head).
// arms = [aLX, aLY, aLZ, eL, aRX, aRY, aRZ, eR]; tY twists the torso, hY/hX turn the head.
const MUZZ_KEYS = {
  reachR: { arms: [-0.15, -0.34, 0.16, -0.71, -2.69, 0, -0.56, -0.01], tY: -0.28, hY: -0.3, hX: -0.12 },
  templeR: { arms: [-0.1, -0.38, 0.19, -0.82, -2.45, 1.15, -0.56, -1.35], tY: -0.2, hY: -0.18, hX: 0 },
  chinL: { arms: [-1.39, -0.6, -0.12, -1.46, -0.45, -0.01, -0.66, -0.06], tY: 0.22, hY: 0.1, hX: 0.08 },
  chopR: { arms: [-1.62, 0, 0.31, -0.01, -0.96, 0.93, -0.05, -1.23], tY: -0.25, hY: 0.15, hX: 0.05 },
  overheadL: { arms: [-3.01, 0, -0.09, 0, -0.9, 0.77, -0.05, -1.46], tY: 0.12, hY: 0.15, hX: -0.22 },
  stack: { arms: [-1.15, -0.98, 0.1, -1.39, -0.7, 0.92, -0.08, -1.45], tY: 0, hY: 0, hX: 0.12 },
  flick: { arms: [-0.5, 0.21, 0.3, -2.24, -0.5, -0.21, -0.3, -2.24], tY: 0, hY: 0, hX: 0.1 },
};
const ARM_KEYS = ['aLX', 'aLY', 'aLZ', 'eL', 'aRX', 'aRY', 'aRZ', 'eR'];
const mirrorKey = ({ arms: [lx, ly, lz, el, rx, ry, rz, er], tY, hY, hX }) => ({
  arms: [rx, -ry, -rz, er, lx, -ly, -lz, el],
  tY: -tY,
  hY: -hY,
  hX,
});
/** 32 eighth-note slots (16 beats): a phrase led by the right arm, then its mirror. */
const MUZZ_SEQ = (() => {
  const K = MUZZ_KEYS;
  const M = Object.fromEntries(Object.entries(K).map(([k, v]) => [k, mirrorKey(v)]));
  return [
    K.reachR, K.reachR, K.templeR, K.templeR, K.chinL, K.chinL,
    K.chopR, M.chopR, K.chopR, M.chopR, K.chopR, M.chopR,
    K.overheadL, K.overheadL, K.stack, K.stack,
    M.reachR, M.reachR, M.templeR, M.templeR, M.chinL, M.chinL,
    M.chopR, K.chopR, M.chopR, K.chopR, M.chopR, K.chopR,
    M.overheadL, M.overheadL, K.flick, K.flick,
  ];
})();
/** Snap into a pose with a little overshoot over the first ~45% of the slot, then hold. */
function hit(k) {
  const x = Math.min(1, k / 0.45) - 1;
  return 1 + 2.4 * x * x * x + 1.4 * x * x;
}

/** KeyboardEvent.code for a dance's hotkey ('1' → 'Digit1', 'Q' → 'KeyQ'). */
export const danceCode = (key) => (/\d/.test(key) ? `Digit${key}` : `Key${key}`);

// tY twists the upper body; aLY/aRY twist the upper arms (so a bent forearm can swing across
// the chest); eL/eR bend the elbows (negative = forearm forward/up); kL/kR bend the knees
// (positive = shin back). All zero = the old straight-limbed pose, so older dances are unchanged.
export const POSE_KEYS = [
  'x', 'y', 'yaw', 'tX', 'tY', 'tZ', 'hX', 'hY', 'hZ',
  'aLX', 'aLY', 'aLZ', 'eL', 'aRX', 'aRY', 'aRZ', 'eR',
  'lLX', 'lLZ', 'kL', 'lRX', 'lRZ', 'kR',
];

export function makePose() {
  const p = {};
  for (const k of POSE_KEYS) p[k] = 0;
  return p;
}

function reset(o) {
  for (const k of POSE_KEYS) o[k] = 0;
}

/**
 * @param o     pose to write
 * @param dance dance id
 * @param p     beat phase 0..1
 * @param b     beat counter
 * @param amp   energy-scaled amplitude (~0.5..1.4)
 * @param s     per-avatar random offset so the crowd isn't perfectly cloned
 * @param bpm   current tempo (the rave emotes switch to double-time on slower tracks)
 */
export function computePose(o, dance, p, b, amp, s, bpm = 128) {
  reset(o);
  const sinP = Math.sin(TAU * p);
  const dip = 1 - Math.abs(Math.sin(Math.PI * p)); // 1 exactly on the beat
  const c2 = ((b & 1) + p) / 2; // two-beat cycle

  switch (dance) {
    case 'headbang': {
      const hd = (1 - p) * (1 - p);
      o.y = -0.12 * hd * amp;
      o.tX = 0.25 + 0.25 * hd * amp;
      o.hX = -0.1 + 0.75 * hd * amp;
      o.aRX = -2.6 - 0.35 * hd;
      o.aRZ = -0.25;
      o.aLX = 0.2 - 0.3 * hd;
      o.aLZ = 0.25;
      o.lLX = o.lRX = -0.15 * hd;
      o.lLZ = 0.12;
      o.lRZ = -0.12;
      break;
    }
    case 'jumpwave': {
      const jp = Math.sin(Math.PI * p);
      const wave = Math.sin(TAU * c2);
      o.y = 0.5 * jp * amp;
      o.aLX = o.aRX = -2.75;
      o.aLZ = 0.35 + 0.45 * wave;
      o.aRZ = -0.35 + 0.45 * wave;
      o.tZ = -0.1 * wave;
      o.lLX = o.lRX = -0.35 * jp;
      o.hX = -0.15 + 0.1 * jp;
      break;
    }
    case 'shuffle': {
      const k = Math.sin(TAU * c2);
      o.lLX = -0.9 * Math.max(0, k) + 0.35 * Math.max(0, -k);
      o.lRX = -0.9 * Math.max(0, -k) + 0.35 * Math.max(0, k);
      o.y = 0.07 * Math.abs(sinP) * amp;
      o.aLX = 0.5 * k;
      o.aRX = -0.5 * k;
      o.aLZ = 0.15;
      o.aRZ = -0.15;
      o.yaw = 0.25 * sinP;
      o.tX = 0.12;
      o.hX = 0.08 * Math.sin(TAU * p * 2);
      break;
    }
    case 'sidestep': {
      const sw = Math.sin(TAU * c2);
      const pump = Math.pow(1 - p, 3);
      o.x = 0.45 * sw;
      o.lLZ = 0.25 * Math.max(0, sw);
      o.lRZ = -0.25 * Math.max(0, -sw);
      o.aRX = -2.3 - 0.6 * pump;
      o.aRZ = -0.15;
      o.aLX = -0.4 * pump;
      o.aLZ = 0.3;
      o.y = -0.06 * dip * amp;
      o.tZ = -0.1 * sw;
      o.hZ = 0.12 * sw;
      o.hX = 0.1 * dip;
      break;
    }
    case 'glowstick': {
      const a = TAU * p + s;
      o.aLX = -1.7 + 0.9 * Math.sin(a);
      o.aLZ = 0.55 + 0.5 * Math.cos(a);
      o.aRX = -1.7 - 0.9 * Math.sin(a);
      o.aRZ = -0.55 + 0.5 * Math.cos(a);
      o.y = -0.06 * dip * amp;
      o.hX = 0.15 * sinP;
      o.yaw = 0.15 * Math.sin(TAU * (((b & 3) + p) / 4));
      break;
    }
    case 'pump': {
      // Fist pump: punch up on every beat, both fists on the eighth.
      const hit = Math.pow(1 - p, 4);
      const both = (b & 7) === 7;
      o.aRX = -2.05 - 0.85 * hit * amp;
      o.aRZ = -0.18;
      o.aLX = both ? o.aRX : -0.35 - 0.15 * hit;
      o.aLZ = both ? 0.18 : 0.35;
      o.y = -0.1 * dip * amp;
      o.tX = 0.12 - 0.14 * hit;
      o.hX = 0.32 * hit * amp - 0.05;
      o.lLZ = 0.12;
      o.lRZ = -0.12;
      o.yaw = 0.1 * Math.sin(TAU * c2 + s);
      break;
    }
    case 'runningman': {
      // Running Man: knee up on one beat, slide it back on the next, arms pumping.
      const k = Math.sin(TAU * c2);
      o.lLX = -1.15 * Math.max(0, k) + 0.5 * Math.max(0, -k);
      o.lRX = -1.15 * Math.max(0, -k) + 0.5 * Math.max(0, k);
      o.aLX = -0.55 + 0.75 * k;
      o.aRX = -0.55 - 0.75 * k;
      o.aLZ = 0.18;
      o.aRZ = -0.18;
      o.y = 0.1 * Math.abs(k) * amp - 0.05 * dip;
      o.tX = 0.2;
      o.hX = 0.12 * dip;
      break;
    }
    case 'cutshapes': {
      // Cutting Shapes: twist side to side, flick a leg out, both arms sweep across.
      const sw = Math.sin(TAU * c2);
      o.lLZ = 0.6 * Math.max(0, sw);
      o.lRZ = -0.6 * Math.max(0, -sw);
      o.lLX = -0.2 * Math.max(0, sw);
      o.lRX = -0.2 * Math.max(0, -sw);
      o.x = 0.18 * sw;
      o.yaw = -0.4 * sw + 0.12 * Math.sin(TAU * p * 2);
      o.aLX = o.aRX = -1.35;
      o.aLZ = 0.25 + 0.85 * sw;
      o.aRZ = -0.25 + 0.85 * sw;
      o.tZ = 0.1 * sw;
      o.hZ = -0.1 * sw;
      o.y = -0.08 * dip * amp;
      break;
    }
    case 'jumpstyle': {
      // Hardstyle kick: hop every beat, alternating straight-leg kicks, arms thrown back.
      const hop = Math.sin(Math.PI * p);
      const kick = -1.25 * hop;
      const left = (b & 1) === 0;
      o.lLX = left ? kick : 0.25 * hop;
      o.lRX = left ? 0.25 * hop : kick;
      o.y = 0.32 * hop * amp;
      o.aLX = o.aRX = 0.55 * hop - 0.2;
      o.aLZ = 0.3;
      o.aRZ = -0.3;
      o.tX = 0.18 - 0.3 * hop;
      o.hX = 0.2 * dip;
      break;
    }
    case 'liquid': {
      // Liquid / gloving: slow figure-of-eight hand flows in front of the face.
      const th = TAU * c2;
      o.aLX = -1.45 + 0.6 * Math.sin(th);
      o.aRX = -1.45 + 0.6 * Math.sin(th + Math.PI);
      o.aLZ = 0.1 + 0.55 * Math.sin(2 * th + s);
      o.aRZ = -0.1 + 0.55 * Math.sin(2 * th + s + Math.PI / 2);
      o.x = 0.1 * Math.sin(th);
      o.tZ = 0.08 * Math.sin(th);
      o.hZ = -0.12 * Math.sin(th);
      o.hX = 0.12;
      o.y = -0.05 * dip * amp;
      o.yaw = 0.1 * Math.sin(th + s);
      break;
    }
    case 'handsup': {
      // Hands up: arms high, swaying with the crowd, clapping overhead every second beat.
      const sw = Math.sin(TAU * (((b & 3) + p) / 4));
      const clap = b & 1 ? Math.pow(1 - p, 5) : 0;
      o.aLX = o.aRX = -2.95;
      o.aLZ = (0.4 + 0.25 * sw) * (1 - clap) - 0.75 * clap;
      o.aRZ = (-0.4 + 0.25 * sw) * (1 - clap) + 0.75 * clap;
      o.x = 0.12 * sw;
      o.tZ = -0.14 * sw;
      o.hZ = 0.1 * sw;
      o.hX = -0.22;
      o.y = -0.08 * dip * amp;
      break;
    }
    case 'lasso': {
      // Lasso: one arm circling overhead once a beat, bouncing on the beat.
      const a = TAU * p + s;
      const sw = Math.sin(TAU * c2);
      o.aRX = -2.55 + 0.35 * Math.cos(a);
      o.aRZ = -0.25 + 0.4 * Math.sin(a);
      o.aLX = -0.25;
      o.aLZ = 0.45;
      o.y = -0.1 * dip * amp;
      o.x = 0.1 * sw;
      o.tZ = 0.06 * sw;
      o.hX = 0.15 * dip - 0.1;
      o.yaw = 0.2 * sw;
      o.lLZ = 0.15;
      o.lRZ = -0.15;
      break;
    }
    case 'spin': {
      // Spin: step-touch for three beats, a full turn with arms out on the fourth.
      if ((b & 3) === 3) {
        const e = Math.min(1, p / 0.85);
        const open = Math.sin(Math.PI * p);
        o.yaw = TAU * e * e * (3 - 2 * e);
        o.aLZ = 0.3 + 1.1 * open;
        o.aRZ = -(0.3 + 1.1 * open);
        o.y = 0.12 * open * amp;
        o.hX = -0.1;
      } else {
        const sw = Math.sin(TAU * c2);
        o.x = 0.3 * sw;
        o.lLZ = 0.2 * Math.max(0, sw);
        o.lRZ = -0.2 * Math.max(0, -sw);
        o.aLX = o.aRX = -0.2 - 0.6 * dip;
        o.aLZ = 0.25;
        o.aRZ = -0.25;
        o.y = -0.07 * dip * amp;
        o.hX = 0.1 * dip;
      }
      break;
    }
    case 'muzzing': {
      // Arms: step through the sequence on eighth notes, snapping into each shape.
      const pos = (b + p) * emoteCadence('muzzing', bpm);
      const i = Math.floor(pos);
      const n = MUZZ_SEQ.length;
      const from = MUZZ_SEQ[(((i - 1) % n) + n) % n];
      const to = MUZZ_SEQ[((i % n) + n) % n];
      const e = hit(pos - i);
      for (let j = 0; j < 8; j++) o[ARM_KEYS[j]] = from.arms[j] + (to.arms[j] - from.arms[j]) * e;
      o.tY = from.tY + (to.tY - from.tY) * e;
      o.hY = from.hY + (to.hY - from.hY) * e;
      // Legs: low stance, knees pumping down on every kick; a running-man step lifts one foot
      // between kicks and stamps it down on the beat, alternating feet.
      const pump = Math.pow(1 - p, 2.5);
      const crouch = 0.36 + 0.14 * pump * amp; // thigh angle; the knee bends twice that
      const lift = Math.max(0, Math.sin(TAU * (p - 0.5))) * ((b & 3) === 3 ? 0.5 : 1);
      const stepL = (b & 1) === 0;
      const support = { x: -crouch, k: 2 * crouch };
      const step = { x: -(crouch + 0.45 * lift), k: 2 * crouch + 0.9 * lift };
      ({ x: o.lLX, k: o.kL } = stepL ? step : support);
      ({ x: o.lRX, k: o.kR } = stepL ? support : step);
      o.lLZ = 0.1;
      o.lRZ = -0.1;
      o.y = -0.95 * (1 - Math.cos(crouch)); // keeps the planted foot on the floor
      o.x = 0.05 * (stepL ? -1 : 1) * lift; // weight on the planted foot
      // Lean in, chest pops on the kick, head nods with it.
      o.tX = 0.18 + 0.25 * crouch + 0.08 * Math.pow(1 - p, 6);
      o.hX = from.hX + (to.hX - from.hX) * e + 0.14 * Math.pow(1 - p, 4) * amp;
      o.yaw = 0.06 * Math.sin(TAU * c2 + s);
      break;
    }
    case 'hakken': {
      // Hakken (gabber): rapid kick / heel-tap footwork, alternating feet, leaning in,
      // fists pumping low — double-time on anything slower than hardcore.
      const cad = emoteCadence('hakken', bpm);
      const pos = (b + p) * cad;
      const step = Math.floor(pos) & 3;
      const k = pos - Math.floor(pos);
      const bump = Math.sin(Math.PI * k);
      const leftLeg = step < 2;
      const kick = step % 2 === 0;
      const lead = kick ? -1.0 * bump : -0.35 - 0.15 * bump; // kick out, or heel tap in front
      o.lLX = leftLeg ? lead : 0.15;
      o.lRX = leftLeg ? 0.15 : lead;
      o.lLZ = leftLeg && !kick ? 0.12 : 0.05;
      o.lRZ = !leftLeg && !kick ? -0.12 : -0.05;
      o.y = 0.13 * bump * amp;
      o.tX = 0.32 + 0.06 * bump;
      o.tZ = (leftLeg ? -1 : 1) * 0.07;
      o.aLX = -0.55 + (leftLeg ? 0.45 : -0.45) * bump;
      o.aRX = -0.55 + (leftLeg ? -0.45 : 0.45) * bump;
      o.aLZ = 0.28;
      o.aRZ = -0.28;
      o.hX = 0.2 * bump;
      break;
    }
    case 'groove': {
      // Groove (tech house / melodic): smooth rolling bounce, hips swaying over two beats,
      // head nodding on the kick, loose arms.
      const sw = Math.sin(TAU * c2);
      const roll = Math.cos(TAU * p);
      o.y = -0.09 * (0.5 + 0.5 * roll) * amp;
      o.x = 0.16 * sw;
      o.tZ = -0.1 * sw;
      o.tX = 0.08 + 0.05 * Math.sin(TAU * p + 1);
      o.hZ = 0.08 * sw;
      o.hX = 0.22 * Math.pow(1 - p, 2) * amp;
      o.yaw = 0.14 * Math.sin(TAU * c2 + 0.6);
      o.aLX = -0.35 + 0.25 * Math.sin(TAU * c2 + 0.5);
      o.aRX = -0.35 - 0.25 * Math.sin(TAU * c2 + 0.5);
      o.aLZ = 0.2 + 0.08 * sw;
      o.aRZ = -0.2 + 0.08 * sw;
      o.lLX = -0.15 * Math.max(0, sw);
      o.lRX = -0.15 * Math.max(0, -sw);
      break;
    }
    case 'sit': {
      // In a stadium seat: thighs forward, shins down, hips dropped to seat height. Nodding
      // along with hands on the knees, and a fist up for the last bar of every four.
      const raise = (b & 15) >= 12;
      o.y = -0.45 - 0.03 * dip * amp;
      o.lLX = o.lRX = -1.5;
      o.kL = o.kR = 1.45;
      o.lLZ = 0.06;
      o.lRZ = -0.06;
      o.tX = 0.08 + 0.05 * dip * amp;
      o.hX = 0.05 + 0.22 * dip * amp;
      o.aLX = -0.75;
      o.eL = -0.6;
      o.aLZ = 0.12;
      o.aRX = raise ? -2.6 - 0.25 * dip : -0.75;
      o.eR = raise ? 0 : -0.6;
      o.aRZ = raise ? -0.2 : -0.12;
      break;
    }
    case 'dj': {
      const raise = (b & 7) >= 6;
      o.aRX = -1.2 + 0.12 * Math.sin(TAU * p * 2);
      o.aRZ = 0.1;
      o.aLX = raise ? -2.8 : -1.15 + 0.12 * Math.sin(TAU * p + 1.3);
      o.aLZ = raise ? 0.2 : -0.1;
      o.hX = 0.3 * dip * amp;
      o.tX = 0.15;
      o.y = -0.05 * dip;
      break;
    }
    default: {
      // "Vibe": the automatic crowd bounce
      o.y = -0.07 * dip * amp;
      o.hX = 0.12 * sinP * amp;
      o.tX = 0.05;
      o.aLZ = 0.12 + 0.06 * Math.sin(TAU * p + s);
      o.aRZ = -(0.12 + 0.06 * Math.sin(TAU * p + s + 1));
      o.aLX = -0.1 * Math.sin(TAU * c2);
      o.aRX = 0.1 * Math.sin(TAU * c2);
      o.yaw = 0.08 * Math.sin(TAU * c2 + s);
    }
  }
}

export function walkPose(o, w, run) {
  reset(o);
  const sw = Math.sin(w);
  const a = run ? 0.9 : 0.65;
  o.lLX = a * sw;
  o.lRX = -a * sw;
  // Knees fold as each leg swings through.
  o.kL = a * 1.1 * Math.pow(Math.max(0, -Math.cos(w)), 1.5);
  o.kR = a * 1.1 * Math.pow(Math.max(0, Math.cos(w)), 1.5);
  o.eL = o.eR = run ? -0.9 : -0.25;
  o.aLX = -a * 0.85 * sw;
  o.aRX = a * 0.85 * sw;
  o.aLZ = 0.1;
  o.aRZ = -0.1;
  o.y = 0.06 * Math.abs(Math.cos(w));
  o.tX = run ? 0.15 : 0.06;
}
