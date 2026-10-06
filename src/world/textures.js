import * as THREE from 'three';

export const KHMER_FONT = '"Koulen", "Kantumruy Pro", "Khmer UI", "Leelawadee UI", sans-serif';
export const DISPLAY_FONT = '"Koulen", "Orbitron", "Impact", sans-serif';

export function canvasTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const [c, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

let smokeTex = null;
export function smokeTexture() {
  if (smokeTex) return smokeTex;
  const [c, ctx] = makeCanvas(128, 128);
  for (let i = 0; i < 14; i++) {
    const x = 64 + (Math.random() - 0.5) * 40;
    const y = 64 + (Math.random() - 0.5) * 40;
    const r = 24 + Math.random() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  smokeTex = new THREE.CanvasTexture(c);
  return smokeTex;
}

const emojiCache = new Map();
export function emojiTexture(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);
  const [c, ctx] = makeCanvas(128, 128);
  ctx.font = '100px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 64, 70);
  const t = canvasTexture(c);
  emojiCache.set(emoji, t);
  return t;
}

/** Glowing neon-tube lettering on a transparent background (use with additive blending). */
export function neonTexture(lines, w = 1024, h = 512) {
  const [c, ctx] = makeCanvas(w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of lines) {
    ctx.font = `${l.weight || 400} ${l.size}px ${l.font || DISPLAY_FONT}`;
    ctx.fillStyle = l.color;
    ctx.shadowColor = l.color;
    for (const blur of [48, 24, 10]) {
      ctx.shadowBlur = blur;
      ctx.fillText(l.text, w / 2, l.y, w - 40);
    }
    ctx.shadowBlur = 6;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${l.weight || 400} ${l.size * 0.96}px ${l.font || DISPLAY_FONT}`;
    ctx.fillText(l.text, w / 2, l.y, w - 48);
  }
  return canvasTexture(c);
}

/** Kroma — the red/blue & white gingham scarf worn all over Cambodia. */
export function kromaCanvas(base = '#c4122f', size = 256, cells = 12) {
  const [c, ctx] = makeCanvas(size, size);
  const s = size / cells;
  ctx.fillStyle = '#f4efe4';
  ctx.fillRect(0, 0, size, size);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = base;
  for (let i = 0; i < cells; i += 2) {
    ctx.fillRect(i * s, 0, s, size);
    ctx.fillRect(0, i * s, size, s);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < cells; i += 2) for (let j = 0; j < cells; j += 2) ctx.fillRect(i * s, j * s, s, s);
  return c;
}

export function kromaTexture(base, repeat = 1) {
  const t = canvasTexture(kromaCanvas(base));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

export function stripeTexture(a, b, n = 8) {
  const [c, ctx] = makeCanvas(256, 64);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? b : a;
    ctx.fillRect((i * 256) / n, 0, 256 / n + 1, 64);
  }
  return canvasTexture(c);
}

/** Big festival banner: kroma border, title and Khmer subtitle. */
export function bannerTexture(title, khmer, sub, accent = '#ff2bd6') {
  const [c, ctx] = makeCanvas(2048, 340);
  const bg = ctx.createLinearGradient(0, 0, 2048, 0);
  bg.addColorStop(0, '#1a0630');
  bg.addColorStop(0.5, '#2a0a3c');
  bg.addColorStop(1, '#1a0630');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 2048, 340);
  const krama = kromaCanvas('#c4122f', 64, 8);
  for (let x = 0; x < 2048; x += 32) {
    ctx.drawImage(krama, 0, 0, 64, 64, x, 0, 32, 32);
    ctx.drawImage(krama, 0, 0, 64, 64, x, 308, 32, 32);
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#ffffff';
  ctx.font = `150px ${DISPLAY_FONT}`;
  ctx.fillText(title, 1024, 150, 1900);
  ctx.shadowColor = '#00f0ff';
  ctx.fillStyle = '#ffd86b';
  ctx.font = `64px ${KHMER_FONT}`;
  ctx.fillText(`${khmer}  •  ${sub}`, 1024, 258, 1900);
  return canvasTexture(c);
}
