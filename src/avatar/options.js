import { pick } from '../core/rng.js';

export const SKIN_TONES = ['#f6d5bd', '#eab68f', '#cf9466', '#a8703f', '#7f4d2b', '#56331c'];

export const HAIR_STYLES = [
  { id: 'topknot', label: 'Apsara Bun' },
  { id: 'spiky', label: 'Spiky' },
  { id: 'buzz', label: 'Buzz Cut' },
  { id: 'long', label: 'Long' },
  { id: 'mohawk', label: 'Mohawk' },
  { id: 'afro', label: 'Afro' },
  { id: 'bob', label: 'Bob' },
  { id: 'none', label: 'Bald' },
];
export const HAIR_COLORS = ['#141418', '#3b2416', '#e9d27a', '#ff3fb4', '#22e4ff', '#9b5cff', '#e8e8f2', '#ff6a1f'];

export const TOPS = [
  { id: 'vest', label: 'Neon Vest' },
  { id: 'kroma', label: 'Kroma Jacket' },
  { id: 'tee', label: 'Rave Tee' },
  { id: 'hoodie', label: 'Hoodie' },
  { id: 'tank', label: 'Mesh Tank' },
];
export const TOP_COLORS = ['#ff2bd6', '#00e5ff', '#9dff00', '#ffd400', '#ff5a1f', '#c4122f', '#1d4ed8', '#1b1b2a', '#f2f2f2'];

export const PANTS = [
  { id: 'cargo', label: 'Cargo' },
  { id: 'track', label: 'Glow Track' },
  { id: 'shorts', label: 'Shorts' },
];
export const PANTS_COLORS = ['#1a1a24', '#2b3a67', '#4a4a52', '#e8e8e8', '#3d2b56', '#14532d', '#7a1d3a'];

export const HEADWEAR = [
  { id: 'none', label: 'None' },
  { id: 'bucket', label: 'LED Bucket Hat' },
  { id: 'cap', label: 'Snapback' },
  { id: 'phones', label: 'Headphones' },
  { id: 'halo', label: 'Neon Halo' },
  { id: 'crown', label: 'Apsara Crown' },
];

export const EYEWEAR = [
  { id: 'none', label: 'None' },
  { id: 'shutter', label: 'Glow Glasses' },
  { id: 'visor', label: 'Cyber Visor' },
  { id: 'round', label: 'Round Shades' },
];

export const HANDS = [
  { id: 'none', label: 'None' },
  { id: 'bracelets', label: 'Glow Bracelets' },
  { id: 'sticks', label: 'Glow Sticks' },
  { id: 'gloves', label: 'LED Gloves' },
];

export const ACCENTS = [
  { id: 'cyan', label: 'Cyan', color: '#00f0ff' },
  { id: 'magenta', label: 'Magenta', color: '#ff2bd6' },
  { id: 'acid', label: 'Acid Green', color: '#9dff00' },
  { id: 'gold', label: 'Electric Gold', color: '#ffc400' },
  { id: 'violet', label: 'UV Violet', color: '#8b5cff' },
  { id: 'red', label: 'Laser Red', color: '#ff2d55' },
];

export const DEFAULT_AVATAR = {
  skin: SKIN_TONES[2],
  hair: 'topknot',
  hairColor: HAIR_COLORS[0],
  top: 'kroma',
  topColor: '#c4122f',
  pants: 'cargo',
  pantsColor: PANTS_COLORS[0],
  head: 'none',
  eyes: 'shutter',
  hands: 'sticks',
  accent: 'cyan',
};

export function accentColor(id) {
  return (ACCENTS.find((a) => a.id === id) || ACCENTS[0]).color;
}

const HEX = /^#[0-9a-f]{6}$/i;
const ids = (list) => list.map((x) => x.id);

/** Fill in / validate a (possibly remote, untrusted) avatar config. */
export function normalizeAvatar(a = {}) {
  const d = DEFAULT_AVATAR;
  const oneOf = (v, list, def) => (list.includes(v) ? v : def);
  const hex = (v, def) => (typeof v === 'string' && HEX.test(v) ? v : def);
  return {
    skin: hex(a.skin, d.skin),
    hair: oneOf(a.hair, ids(HAIR_STYLES), d.hair),
    hairColor: hex(a.hairColor, d.hairColor),
    top: oneOf(a.top, ids(TOPS), d.top),
    topColor: hex(a.topColor, d.topColor),
    pants: oneOf(a.pants, ids(PANTS), d.pants),
    pantsColor: hex(a.pantsColor, d.pantsColor),
    head: oneOf(a.head, ids(HEADWEAR), d.head),
    eyes: oneOf(a.eyes, ids(EYEWEAR), d.eyes),
    hands: oneOf(a.hands, ids(HANDS), d.hands),
    accent: oneOf(a.accent, ids(ACCENTS), d.accent),
  };
}

export function randomAvatar(rng = Math.random) {
  return {
    skin: pick(rng, SKIN_TONES),
    hair: pick(rng, ids(HAIR_STYLES)),
    hairColor: pick(rng, HAIR_COLORS),
    top: pick(rng, ids(TOPS)),
    topColor: pick(rng, TOP_COLORS),
    pants: pick(rng, ids(PANTS)),
    pantsColor: pick(rng, PANTS_COLORS),
    head: rng() < 0.45 ? 'none' : pick(rng, ids(HEADWEAR)),
    eyes: rng() < 0.4 ? 'none' : pick(rng, ids(EYEWEAR)),
    hands: rng() < 0.3 ? 'none' : pick(rng, ids(HANDS)),
    accent: pick(rng, ids(ACCENTS)),
  };
}
