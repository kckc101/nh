// VIP sign board artwork, drawn on a 2D canvas. The same drawing feeds the 3D board's
// CanvasTexture and the live preview in the bottle-service modal, so what the buyer sees is
// what the room sees. Three styles: Cyber Neon, Gold Luxury and Glitch (animated). Tier 2+
// boards get the "vine" border.
//
// The buyer's text must read from across the crowd, through the bloom and the lens streaks:
// every style draws it in two passes, a soft neon glow behind (neonText's halo) and then the
// letters themselves, crisp, with a dark outline and no blur, in tinted (never pure white)
// colours that stay under the bloom's threshold on the board (bottle.js BOARD_LEVEL).

import { DISPLAY_FONT } from './textures.js';

export const SIGN_STYLES = [
  { id: 'cyber', label: 'Cyber Neon', color: '#00f0ff' },
  { id: 'gold', label: 'Gold Luxury', color: '#ffc400' },
  { id: 'glitch', label: 'Glitch', color: '#ff2bd6' },
];
export const styleMeta = (id) => SIGN_STYLES.find((s) => s.id === id) || SIGN_STYLES[0];

export const SIGN_W = 1024;
export const SIGN_H = 384;

const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/** Largest font size (≤ max) at which `text` fits in `width`. */
function fit(ctx, text, width, max, weight = '') {
  let size = max;
  ctx.font = `${weight}${size}px ${DISPLAY_FONT}`;
  const w = ctx.measureText(text).width;
  if (w > width) size = Math.max(40, Math.floor((size * width) / w));
  ctx.font = `${weight}${size}px ${DISPLAY_FONT}`;
  return size;
}

/** Curling vine with leaves along the top and bottom edges (tier 2+ "vine board"). */
function vines(ctx, color, t) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 4;
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  for (const [y0, dir] of [[52, 1], [SIGN_H - 52, -1]]) {
    ctx.beginPath();
    for (let x = 70; x <= SIGN_W - 70; x += 8) {
      const y = y0 + Math.sin(x * 0.035 + t * 1.5) * 9 * dir;
      if (x === 70) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let x = 100; x < SIGN_W - 80; x += 46) {
      const y = y0 + Math.sin(x * 0.035 + t * 1.5) * 9 * dir;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((x / 46) % 2 ? 0.7 : -0.7);
      ctx.beginPath();
      ctx.ellipse(0, -10 * dir, 6, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * The buyer's text, readable: a glow behind (blurred, only around the letters), a dark outline,
 * then the letters themselves, sharp. `fill` is a colour or gradient; `glow` the halo colour.
 */
function neonText(ctx, text, x, y, { fill, glow, outline = '#04060c', halo = 34 }) {
  ctx.save();
  ctx.lineJoin = 'round';
  // 1. The halo: the glow colour, blurred, a little faded so it frames the letters.
  ctx.shadowColor = glow;
  ctx.shadowBlur = halo;
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = glow;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
  // 2. A dark outline, so the letters stand apart from their own glow.
  ctx.shadowBlur = 0;
  ctx.lineWidth = 10;
  ctx.strokeStyle = outline;
  ctx.strokeText(text, x, y);
  // 3. The letters, crisp.
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function caption(ctx, text, color, y = 80) {
  ctx.save();
  ctx.font = `40px ${DISPLAY_FONT}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '8px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.fillText(text, SIGN_W / 2, y, SIGN_W - 200);
  ctx.restore();
}

function drawCyber(ctx, text, tier, t) {
  rounded(ctx, 18, 18, SIGN_W - 36, SIGN_H - 36, 40);
  ctx.fillStyle = '#05030d';
  ctx.fill();
  ctx.save();
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#00f0ff';
  ctx.shadowColor = '#00f0ff';
  ctx.shadowBlur = 30;
  ctx.stroke();
  rounded(ctx, 36, 36, SIGN_W - 72, SIGN_H - 72, 28);
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ff2bd6';
  ctx.shadowColor = '#ff2bd6';
  ctx.stroke();
  ctx.restore();
  if (tier >= 2) vines(ctx, '#ff2bd6', t);
  caption(ctx, tier >= 3 ? 'FULL ENTOURAGE' : 'VIP BOTTLE SERVICE', '#ff6fe0', tier >= 2 ? 92 : 82);
  const label = text.toUpperCase();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = fit(ctx, label, SIGN_W - 150, 150);
  const fill = ctx.createLinearGradient(0, 222 - size / 2, 0, 222 + size / 2);
  fill.addColorStop(0, '#c8fbff');
  fill.addColorStop(0.55, '#3ff3ff');
  fill.addColorStop(1, '#00b8e6');
  neonText(ctx, label, SIGN_W / 2, 222, { fill, glow: '#00e5ff' });
}

function drawGold(ctx, text, tier, t) {
  const bg = ctx.createLinearGradient(0, 0, 0, SIGN_H);
  bg.addColorStop(0, '#1a1104');
  bg.addColorStop(1, '#050302');
  rounded(ctx, 18, 18, SIGN_W - 36, SIGN_H - 36, 26);
  ctx.fillStyle = bg;
  ctx.fill();
  const gold = ctx.createLinearGradient(0, 0, SIGN_W, SIGN_H);
  for (const [o, c] of [[0, '#7a5410'], [0.25, '#ffe39a'], [0.5, '#b8860b'], [0.75, '#fff1c1'], [1, '#8a6414']]) gold.addColorStop(o, c);
  ctx.save();
  ctx.lineWidth = 14;
  ctx.strokeStyle = gold;
  ctx.shadowColor = '#ffc400';
  ctx.shadowBlur = 18;
  ctx.stroke();
  rounded(ctx, 44, 44, SIGN_W - 88, SIGN_H - 88, 14);
  ctx.lineWidth = 3;
  ctx.stroke();
  // Diamonds in the corners.
  ctx.fillStyle = gold;
  for (const [x, y] of [[44, 44], [SIGN_W - 44, 44], [44, SIGN_H - 44], [SIGN_W - 44, SIGN_H - 44]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-11, -11, 22, 22);
    ctx.restore();
  }
  ctx.restore();
  if (tier >= 2) vines(ctx, '#e2b23a', t);
  caption(ctx, tier >= 3 ? '✦ FULL ENTOURAGE ✦' : '✦ VIP BOTTLE SERVICE ✦', '#ffd76a', tier >= 2 ? 92 : 84);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = fit(ctx, text, SIGN_W - 170, 146);
  const fill = ctx.createLinearGradient(0, 222 - size / 2, 0, 222 + size / 2);
  fill.addColorStop(0, '#fff6d0');
  fill.addColorStop(0.5, '#ffcc33');
  fill.addColorStop(1, '#a8740e');
  neonText(ctx, text, SIGN_W / 2, 226, { fill, glow: '#ffb000', outline: '#2a1a00', halo: 26 });
}

function drawGlitch(ctx, text, tier, t) {
  rounded(ctx, 18, 18, SIGN_W - 36, SIGN_H - 36, 8);
  ctx.fillStyle = '#020206';
  ctx.fill();
  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#ff2bd6';
  ctx.stroke();
  ctx.translate(5, -3);
  ctx.strokeStyle = 'rgba(0,240,255,0.8)';
  ctx.stroke();
  ctx.restore();
  // Scanlines.
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 24; y < SIGN_H - 24; y += 6) ctx.fillRect(24, y, SIGN_W - 48, 2);
  if (tier >= 2) vines(ctx, '#00f0ff', t);
  const frame = Math.floor(t * 9);
  const burst = hash(frame) < 0.35; // big glitch moments
  caption(ctx, tier >= 3 ? 'FULL_ENTOURAGE.EXE' : 'VIP://BOTTLE_SERVICE', '#00f0ff', tier >= 2 ? 92 : 82);
  const label = text.toUpperCase();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = fit(ctx, label, SIGN_W - 160, 150);
  const bands = 7;
  const top = 222 - size * 0.6;
  const bandH = (size * 1.2) / bands;
  for (let b = 0; b < bands; b++) {
    const shift = burst && hash(frame * 13 + b) < 0.4 ? (hash(frame * 7 + b) - 0.5) * 70 : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top + b * bandH, SIGN_W, bandH + 1);
    ctx.clip();
    // The colour split sits behind the letters (not added over them: red + cyan made white).
    const split = burst ? 8 : 3;
    ctx.fillStyle = 'rgba(255,43,85,0.85)';
    ctx.fillText(label, SIGN_W / 2 + shift - split, 222);
    ctx.fillStyle = 'rgba(0,240,255,0.85)';
    ctx.fillText(label, SIGN_W / 2 + shift + split, 222);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#020206';
    ctx.strokeText(label, SIGN_W / 2 + shift, 222);
    ctx.fillStyle = '#e8ecff';
    ctx.fillText(label, SIGN_W / 2 + shift, 222);
    ctx.restore();
  }
}

/**
 * @param canvas any size; drawing is in SIGN_W × SIGN_H units
 * @param text   the (already cleaned) sign text
 * @param style  'cyber' | 'gold' | 'glitch'
 * @param opts   tier (1–3) and t (seconds, animates the glitch and the vines)
 */
export function drawSign(canvas, text, style, { tier = 1, t = 0 } = {}) {
  const ctx = canvas.getContext('2d');
  ctx.setTransform(canvas.width / SIGN_W, 0, 0, canvas.height / SIGN_H, 0, 0);
  ctx.clearRect(0, 0, SIGN_W, SIGN_H);
  const label = String(text || 'VIP').trim() || 'VIP';
  if (style === 'gold') drawGold(ctx, label, tier, t);
  else if (style === 'glitch') drawGlitch(ctx, label, tier, t);
  else drawCyber(ctx, label, tier, t);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Whether a style needs redrawing over time (animated). */
export const signAnimates = (style, tier) => style === 'glitch' || tier >= 2;
