// A short burst of confetti from (x, y) on its own canvas over `host`, gone after ~2 s.

export function burst(host, x, y, colors) {
  const c = document.createElement('canvas');
  c.className = 'pointer-events-none fixed inset-0 w-full h-full z-[55]';
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  host.append(c);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const bits = Array.from({ length: 150 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const v = 6 + Math.random() * 11;
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, c: colors[(Math.random() * colors.length) | 0] };
  });
  const t0 = performance.now();
  const frame = (now) => {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 1.2) / 0.8);
    for (const b of bits) {
      b.vy += 0.38;
      b.vx *= 0.985;
      b.x += b.vx;
      b.y += b.vy;
      b.r += b.vr;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.r);
      ctx.fillStyle = b.c;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (t < 2) requestAnimationFrame(frame);
    else c.remove();
  };
  requestAnimationFrame(frame);
}

export const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
