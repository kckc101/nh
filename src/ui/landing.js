// The entrance backdrop: neon Angkor skyline reflected in a pool, laser beams and bass pulses at
// 128 BPM. The gate (ui/gate.js) stands in front of it.

import { el } from './dom.js';

function prangPoints(cx, by, w, h, tiers = 6) {
  const left = [];
  for (let i = 0; i < tiers; i++) {
    const y = by - (h * 0.8 * (i + 1)) / tiers;
    const half = (w / 2) * (1 - (i / tiers) * 0.78);
    const next = (w / 2) * (1 - ((i + 1) / tiers) * 0.78);
    left.push([cx - half, y + 5], [cx - next, y]);
  }
  left.push([cx, by - h]);
  const right = left.slice(0, -1).reverse().map(([x, y]) => [2 * cx - x, y]);
  return [[cx - w / 2, by], ...left, ...right, [cx + w / 2, by]];
}

/**
 * The neon Angkor sign as a compact crest for the page header (the entrance and tickets pages put
 * it behind their title once the card is open, and the backdrop's big sign fades out).
 */
export function angkorCrest() {
  const path = angkorPath();
  return `<svg class="hero-crest pointer-events-none" viewBox="0 -12 800 274" aria-hidden="true">
    <defs><filter id="crestGlow" x="-10%" y="-25%" width="120%" height="150%">
      <feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter></defs>
    <g filter="url(#crestGlow)" fill="none" stroke-linejoin="round" stroke-linecap="round">
      <path d="${path}" stroke="#ff2bd6" stroke-width="3.2"/>
      <path d="${path}" stroke="#00f0ff" stroke-width="1.3" transform="translate(0,-3)"/>
    </g></svg>`;
}

function angkorPath() {
  // Three towers, as on the Cambodian flag: tall centre on the upper gallery,
  // two flanking towers on the terrace.
  const towers = [
    [400, 185, 82, 182],
    [215, 215, 64, 140],
    [585, 215, 64, 140],
  ];
  let d = 'M20 250 H780 M130 250 V215 H670 V250 M270 215 V185 H530 V215';
  for (const [cx, by, w, h] of towers) {
    d += ' M' + prangPoints(cx, by, w, h).map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
  }
  return d;
}

/**
 * The entrance backdrop: the neon Angkor skyline reflected in a pool, a perspective grid, laser
 * beams and bass pulses at 128 BPM, behind whatever goes in `content` (the gate, ui/gate.js).
 * @returns { node, content, close() } — close() fades it out and removes it.
 */
export function createBackdrop(root) {
  const path = angkorPath();
  const node = el(`
    <section class="pointer-events-auto fixed inset-0 z-50 overflow-hidden select-none"
      style="background: radial-gradient(120% 70% at 50% 110%, #2e0838 0%, #0f041e 45%, #030207 80%)">
      <canvas class="absolute inset-0 w-full h-full"></canvas>
      <div class="absolute inset-x-0 bottom-0 h-[38%] opacity-50"
        style="background-image: linear-gradient(rgba(255,43,214,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,.4) 1px, transparent 1px);
               background-size: 44px 44px; transform: perspective(380px) rotateX(62deg); transform-origin: bottom; mask-image: linear-gradient(to top, #000 10%, transparent)"></div>

      <svg viewBox="0 0 800 520" class="bd-angkor absolute left-1/2 -translate-x-1/2 bottom-[3%] w-[min(1100px,135vw)] pointer-events-none" aria-hidden="true">
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
          <mask id="reflect"><rect x="0" y="250" width="800" height="270" fill="url(#fade)"/></mask>
        </defs>
        <g filter="url(#glow)" fill="none" stroke-linejoin="round" stroke-linecap="round">
          <path class="angkor-path" d="${path}" stroke="#ff2bd6" stroke-width="3"/>
          <path class="angkor-path" d="${path}" stroke="#00f0ff" stroke-width="1.2" transform="translate(0,-3)" style="animation-delay:.5s"/>
          <g mask="url(#reflect)" transform="translate(0,500) scale(1,-1)">
            <path class="angkor-path" d="${path}" stroke="#ff2bd6" stroke-width="2.5"/>
          </g>
        </g>
      </svg>

      <div class="content absolute inset-0 overflow-y-auto scroll-thin"></div>
    </section>`);
  root.append(node);
  const stopAnim = animateBackground(node.querySelector('canvas'));
  return {
    node,
    content: node.querySelector('.content'),
    close() {
      node.style.transition = 'opacity .6s, transform .6s';
      node.style.opacity = '0';
      node.style.transform = 'scale(1.06)';
      setTimeout(() => {
        stopAnim();
        node.remove();
      }, 620);
    },
  };
}

function animateBackground(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  let raf = 0;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const resize = () => {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);
  const sparks = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), v: 0.02 + Math.random() * 0.06, s: 0.5 + Math.random() * 1.8, c: Math.random() < 0.5 ? '#ff2bd6' : '#00f0ff' }));
  const colors = ['#ff2bd6', '#00f0ff', '#9dff00', '#ffc400'];
  const start = performance.now();
  const beat = 60 / 128;

  const frame = (now) => {
    const t = (now - start) / 1000;
    const phase = (t % beat) / beat;
    const pulse = Math.pow(1 - phase, 3);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    const ox = w / 2;
    const oy = h * 0.72;
    const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, Math.max(w, h) * (0.35 + pulse * 0.08));
    g.addColorStop(0, `rgba(255,43,214,${0.22 + pulse * 0.22})`);
    g.addColorStop(1, 'rgba(255,43,214,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + Math.sin(t * 0.6 + i * 0.7) * 0.9 + (i - 4) * 0.06;
      const len = Math.max(w, h) * 1.2;
      ctx.strokeStyle = colors[i % colors.length];
      ctx.globalAlpha = 0.14 + pulse * 0.2;
      ctx.lineWidth = 1.5 + pulse * 1.5;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(a) * len, oy + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const s of sparks) {
      s.y -= s.v * 0.016;
      if (s.y < -0.05) {
        s.y = 1.05;
        s.x = Math.random();
      }
      ctx.fillStyle = s.c;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 3 + s.x * 20);
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
  };
}
