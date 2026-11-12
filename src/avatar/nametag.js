import * as THREE from 'three';

function pill(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function spriteFrom(canvas, sx, sy) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(sx, sy, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 5;
  return s;
}

export function disposeSprite(s) {
  if (!s) return;
  s.removeFromParent();
  s.material.map?.dispose();
  s.material.dispose();
}

/**
 * Floating spatial name tag: [photo] [DJ | VIP] Name + optional tag line, glowing in the avatar's
 * accent. `photo` (a loaded image) is drawn as a circle — the tag always faces the camera, so
 * a raver's picture is visible from any angle, including behind your own avatar.
 */
export function makeNameTag(name, tag, isDJ, accent, photo = null, vip = false) {
  const W = 512;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const label = name || 'Raver';
  ctx.font = '700 46px "Twemoji Country Flags", "Chakra Petch", "Kantumruy Pro", "Segoe UI", sans-serif';
  const nameMax = photo ? 300 : 380;
  const nameW = Math.min(nameMax, ctx.measureText(label).width);
  const badge = isDJ ? 'DJ' : vip ? 'VIP' : '';
  const badgeW = badge === 'VIP' ? 96 : badge ? 78 : 0;
  const photoW = photo ? 74 : 0;
  const total = nameW + badgeW + 44 + photoW;
  const x0 = (W - total) / 2;

  ctx.shadowColor = accent;
  ctx.shadowBlur = 14;
  pill(ctx, x0, 10, total, 64, 32);
  ctx.fillStyle = 'rgba(8,4,20,0.66)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = accent;
  ctx.stroke();

  let x = x0 + 22;
  if (photo) {
    // Bigger than the pill so it pops out of it, ringed in the accent colour.
    const r = 40;
    const cx = x0 + 36;
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(cx, 42, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(photo, cx - r, 42 - r, r * 2, r * 2);
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, 42, r, 0, Math.PI * 2);
    ctx.lineWidth = 4;
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.restore();
    x = cx + r + 12;
  }
  if (badge) {
    // DJ: magenta → gold. VIP (a VIP ticket, verified by the server): gold.
    const bw = badgeW - 14;
    const g = ctx.createLinearGradient(x, 0, x + bw, 0);
    g.addColorStop(0, isDJ ? '#ff2bd6' : '#ffe27a');
    g.addColorStop(1, '#ffc400');
    ctx.shadowBlur = isDJ ? 0 : 12;
    ctx.shadowColor = '#ffc400';
    pill(ctx, x, 22, bw, 40, 12);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#10051c';
    ctx.font = '700 30px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge, x + bw / 2, 43);
    x += badgeW;
  }
  ctx.font = '700 46px "Twemoji Country Flags", "Chakra Petch", "Kantumruy Pro", "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#f4f0ff';
  ctx.fillText(label, x, 44, nameMax);

  if (tag) {
    ctx.font = '600 28px "Twemoji Country Flags", "Chakra Petch", "Kantumruy Pro", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = accent;
    ctx.shadowBlur = 8;
    ctx.fillText(tag, W / 2, 104, 440);
  }
  const s = spriteFrom(c, 2.76, 0.69);
  s.material.opacity = 0.95;
  return s;
}

function wrap(ctx, text, maxW, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) break;
    } else line = test;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
  }
  return lines;
}

/** Chat bubble shown above an avatar for a few seconds. */
export function makeBubble(text, accent = '#00f0ff') {
  const W = 512;
  const H = 176;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.font = '600 34px "Twemoji Country Flags", "Chakra Petch", "Kantumruy Pro", "Segoe UI", sans-serif';
  const lines = wrap(ctx, text, W - 80, 3);
  const lh = 40;
  const bh = lines.length * lh + 28;
  const bw = Math.min(W - 16, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 48);
  const bx = (W - bw) / 2;
  const by = H - bh - 22;
  pill(ctx, bx, by, bw, bh, 22);
  ctx.fillStyle = 'rgba(14,6,30,0.86)';
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W / 2 - 14, by + bh);
  ctx.lineTo(W / 2, H - 4);
  ctx.lineTo(W / 2 + 14, by + bh);
  ctx.fillStyle = 'rgba(14,6,30,0.86)';
  ctx.fill();
  ctx.fillStyle = '#f6f2ff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, by + 14 + i * lh));
  return spriteFrom(c, 3.25, 1.11);
}
