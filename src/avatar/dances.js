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
  { id: 'glowstick', label: 'Glowstick Rave', key: '5', icon: '🪄' },
];

export const POSE_KEYS = ['x', 'y', 'yaw', 'tX', 'tZ', 'hX', 'hY', 'hZ', 'aLX', 'aLZ', 'aRX', 'aRZ', 'lLX', 'lLZ', 'lRX', 'lRZ'];

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
 */
export function computePose(o, dance, p, b, amp, s) {
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
  o.aLX = -a * 0.85 * sw;
  o.aRX = a * 0.85 * sw;
  o.aLZ = 0.1;
  o.aRZ = -0.1;
  o.y = 0.06 * Math.abs(Math.cos(w));
  o.tX = run ? 0.15 : 0.06;
}
