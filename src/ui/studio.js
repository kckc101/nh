// Avatar Studio: live 3D preview (dancing to the muffled music coming from the stage),
// identity, skin, hair, outfit, rave gear and glow accent. Resolves with the profile.

import * as THREE from 'three';
import { Avatar } from '../avatar/avatar.js';
import {
  SKIN_TONES, HAIR_STYLES, HAIR_COLORS, TOPS, TOP_COLORS, PANTS, PANTS_COLORS,
  HEADWEAR, EYEWEAR, HANDS, ACCENTS, normalizeAvatar, randomAvatar, accentColor,
} from '../avatar/options.js';
import { DANCES } from '../avatar/dances.js';
import { el, esc, toast, $, $$ } from './dom.js';
import { icon, renderIcons } from './icons.js';

const section = (title, body, extra = '') =>
  `<div ${extra}><h3 class="text-[11px] font-semibold tracking-[.25em] text-white/45 mb-2.5">${title}</h3>${body}</div>`;
const chips = (key, list) =>
  `<div class="flex flex-wrap gap-2">${list.map((o) => `<button type="button" class="chip rounded-lg px-3 py-1.5 text-sm font-medium" data-key="${key}" data-val="${o.id}">${o.label}</button>`).join('')}</div>`;
const swatches = (key, colors) =>
  `<div class="flex flex-wrap gap-2.5">${colors.map((c) => `<button type="button" class="swatch size-8 rounded-full border border-white/20" style="background:${c};--sw:${c}" data-key="${key}" data-val="${c}" aria-label="Colour ${c}"></button>`).join('')}</div>`;

export function showStudio({ root, audio, net, profile, wantsDJ, netReady }) {
  let cfg = normalizeAvatar(profile.avatar);
  const accentSw = ACCENTS.map(
    (a) => `<button type="button" class="swatch flex flex-col items-center gap-1.5 group" data-key="accent" data-val="${a.id}" style="--sw:${a.color}" aria-label="${a.label}">
      <span class="size-10 rounded-xl" style="background:${a.color};box-shadow:0 0 18px ${a.color}"></span>
      <span class="text-[11px] text-white/70">${a.label}</span></button>`,
  ).join('');

  const node = el(`
    <section class="pointer-events-auto fixed inset-0 z-40 flex flex-col md:flex-row bg-night">
      <div class="preview relative flex-1 min-h-[38dvh] md:min-h-0 overflow-hidden"
        style="background: radial-gradient(70% 60% at 50% 70%, #3a0d4f 0%, #14072a 55%, #07040d 100%)">
        <div class="absolute inset-x-0 bottom-0 h-1/2 opacity-40 pointer-events-none"
          style="background-image: linear-gradient(rgba(255,43,214,.45) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,.35) 1px, transparent 1px);
                 background-size: 40px 40px; transform: perspective(300px) rotateX(60deg); transform-origin: bottom; mask-image: linear-gradient(to top, #000, transparent)"></div>
        <canvas class="absolute inset-0 w-full h-full touch-none cursor-grab"></canvas>
        <header class="absolute top-0 inset-x-0 p-4 md:p-7 flex items-start justify-between gap-3 pointer-events-none">
          <div>
            <h2 class="font-display text-[34px] md:text-6xl leading-none">AVATAR <span class="text-magenta neon">STUDIO</span></h2>
            <p class="text-white/55 text-xs md:text-sm mt-1">Drag to spin · tap a move to preview it</p>
          </div>
          <div class="now glass rounded-xl px-3 py-2 text-[11px] md:text-xs max-w-[46%] text-right leading-snug">
            <div class="text-white/50 flex items-center justify-end gap-1">${icon('audio-lines', 'size-3.5')} heard from the main stage</div>
            <div class="track font-semibold text-cyan truncate">Tuning in…</div>
          </div>
        </header>
        <div class="dances absolute bottom-3 inset-x-0 flex md:justify-center gap-2 px-3 overflow-x-auto no-scrollbar">
          <button type="button" class="chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold glass" data-dance="idle">🎵 Vibe</button>
          ${DANCES.map((d) => `<button type="button" class="chip shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold glass" data-dance="${d.id}">${d.icon} ${d.label}</button>`).join('')}
        </div>
      </div>

      <aside class="panel glass-strong w-full md:w-[460px] h-[62dvh] md:h-full flex flex-col border-0 md:border-l border-white/10">
        <form class="body flex-1 overflow-y-auto scroll-thin p-4 md:p-6 space-y-6" autocomplete="off">
          ${section('IDENTITY', `
            <div class="grid grid-cols-2 gap-2.5">
              <label class="flex flex-col gap-1 text-xs text-white/60">Raver name
                <input name="raver" maxlength="18" class="field text-white" value="${esc(profile.name)}" placeholder="Your name" required/></label>
              <label class="flex flex-col gap-1 text-xs text-white/60">DJ tag / handle
                <input name="handle" maxlength="18" class="field text-white" value="${esc(profile.tag)}" placeholder="@phnompenh"/></label>
            </div>`)}
          ${section('SKIN TONE', swatches('skin', SKIN_TONES))}
          ${section('HAIRSTYLE', `${chips('hair', HAIR_STYLES)}<div class="mt-3">${swatches('hairColor', HAIR_COLORS)}</div>`)}
          ${section('RAVE OUTFIT', `${chips('top', TOPS)}<div class="mt-3">${swatches('topColor', TOP_COLORS)}</div>`)}
          ${section('BOTTOMS', `${chips('pants', PANTS)}<div class="mt-3">${swatches('pantsColor', PANTS_COLORS)}</div>`)}
          ${section('HEADWEAR', chips('head', HEADWEAR))}
          ${section('EYEWEAR', chips('eyes', EYEWEAR))}
          ${section('HANDS', chips('hands', HANDS))}
          ${section('GLOW ACCENT', `<div class="grid grid-cols-3 gap-3">${accentSw}</div>`)}
          ${wantsDJ ? section('HOST MODE', `
            <div class="rounded-xl border border-magenta/40 bg-magenta/10 p-3 text-sm space-y-2">
              <p class="flex items-center gap-2 text-white/80">${icon('headphones', 'size-4 text-magenta')} You'll spawn in the DJ booth with the control panel.</p>
              <label class="dj-key-row flex flex-col gap-1 text-xs text-white/60">DJ password
                <input name="djkey" type="password" autocomplete="current-password" class="field text-white" placeholder="Host password"/></label>
              <p class="dj-offline hidden text-xs text-gold">Offline demo — host controls work locally without a password.</p>
            </div>`) : ''}
        </form>
        <footer class="p-4 md:p-5 border-t border-white/10 space-y-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <div class="net flex items-center gap-2 text-xs text-white/55"><span class="dot size-2 rounded-full bg-gold pulse-dot"></span><span class="label">Connecting to the festival…</span></div>
          <div class="flex gap-3">
            <button type="button" class="random chip rounded-xl px-4 flex items-center gap-2 text-sm font-semibold" title="Randomize">${icon('dices', 'size-5')}<span class="hidden sm:inline">Random</span></button>
            <button type="button" class="enter btn-rave flex-1 rounded-xl py-3.5 font-display text-2xl tracking-wider text-white">ENTER FESTIVAL</button>
          </div>
        </footer>
      </aside>
    </section>`);
  root.append(node);
  renderIcons(node);

  const form = $(node, 'form');
  const panel = $(node, '.panel');

  // ---------------------------------------------------------------- 3D preview
  const canvas = $(node, 'canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight('#a99cff', '#22102e', 1.5));
  const key = new THREE.DirectionalLight('#ffffff', 1.4);
  key.position.set(2, 4, 6);
  const rimA = new THREE.DirectionalLight('#ff2bd6', 2.2);
  rimA.position.set(-5, 3, -3);
  const rimB = new THREE.DirectionalLight('#00f0ff', 2);
  rimB.position.set(5, 2, -2);
  scene.add(key, rimA, rimB);
  const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.35, 0.16, 48), new THREE.MeshLambertMaterial({ color: '#1a1226' }));
  platform.position.y = -0.08;
  const ringMat = new THREE.MeshBasicMaterial({ color: accentColor(cfg.accent) });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.035, 8, 64), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(platform, ring);

  const avatar = new Avatar(cfg, { name: profile.name || 'Raver', tag: profile.tag, tagScale: 0.55 });
  scene.add(avatar.root);
  let spin = 0.35;
  let spinVel = 0;
  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = e.clientX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging === null) return;
    spinVel = (e.clientX - dragging) * 0.012;
    spin += spinVel;
    dragging = e.clientX;
  });
  canvas.addEventListener('pointerup', () => (dragging = null));
  canvas.addEventListener('pointercancel', () => (dragging = null));

  const preview = $(node, '.preview');
  const resize = () => {
    const w = preview.clientWidth;
    const h = preview.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const dist = w / h < 0.9 ? 7.6 : 6.4;
    camera.position.set(0, 1.55, dist);
    camera.lookAt(0, 1.1, 0);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(preview);
  resize();

  const timer = new THREE.Timer();
  let alive = true;
  const loop = (ts) => {
    if (!alive) return;
    timer.update(ts);
    const dt = Math.min(0.05, Math.max(0, timer.getDelta()));
    const M = audio.update(dt);
    if (dragging === null) {
      spinVel *= 0.94;
      spin += spinVel + dt * 0.25;
    }
    avatar.root.rotation.y = spin;
    avatar.update(dt, M);
    ring.scale.setScalar(1 + M.kick * 0.06);
    ringMat.color.set(accentColor(cfg.accent)).multiplyScalar(0.8 + M.kick * 0.8);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // ---------------------------------------------------------------- options
  const refresh = () => {
    panel.style.setProperty('--accent', accentColor(cfg.accent));
    for (const b of $$(node, '[data-key]')) b.setAttribute('aria-pressed', String(cfg[b.dataset.key] === b.dataset.val));
  };
  let tagTimer = 0;
  const relabel = () => {
    clearTimeout(tagTimer);
    tagTimer = setTimeout(() => avatar.setLabel(form.raver.value.trim() || 'Raver', form.handle.value.trim(), wantsDJ), 150);
  };
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    cfg = { ...cfg, [b.dataset.key]: b.dataset.val };
    avatar.setConfig(cfg);
    refresh();
  });
  form.addEventListener('input', (e) => (e.target.name === 'raver' || e.target.name === 'handle') && relabel());
  form.addEventListener('submit', (e) => e.preventDefault());
  $(node, '.random').addEventListener('click', () => {
    cfg = normalizeAvatar(randomAvatar());
    avatar.setConfig(cfg);
    avatar.doCheer();
    refresh();
  });
  const danceBtns = $$(node, '[data-dance]');
  const setPreviewDance = (id) => {
    avatar.setDance(id);
    danceBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dance === id)));
  };
  danceBtns.forEach((b) => b.addEventListener('click', () => setPreviewDance(b.dataset.dance)));
  setPreviewDance('idle');
  refresh();
  avatar.setLabel(profile.name || 'Raver', profile.tag, wantsDJ);

  // ---------------------------------------------------------------- status
  const trackEl = $(node, '.track');
  const offTrack = audio.on('track', (t) => (trackEl.textContent = t ? `♪ ${t.title} — ${t.artist}` : 'Stage is quiet'));
  if (audio.track) trackEl.textContent = `♪ ${audio.track.title} — ${audio.track.artist}`;
  const netEl = $(node, '.net');
  let onlineCount = 0;
  const showNet = () => {
    const dot = $(netEl, '.dot');
    const label = $(netEl, '.label');
    if (net.status === 'online') {
      dot.className = 'dot size-2 rounded-full bg-acid';
      label.textContent = `Connected — ${onlineCount} raver${onlineCount === 1 ? '' : 's'} inside + the crowd`;
      $(node, '.dj-key-row')?.classList.remove('hidden');
      $(node, '.dj-offline')?.classList.add('hidden');
    } else if (net.status === 'offline') {
      dot.className = 'dot size-2 rounded-full bg-magenta';
      label.textContent = 'Offline demo — simulated crowd (start the server for multiplayer)';
      $(node, '.dj-key-row')?.classList.add('hidden');
      $(node, '.dj-offline')?.classList.remove('hidden');
    }
  };
  const offs = [
    offTrack,
    net.on('status', showNet),
    net.on('hello', (h) => {
      onlineCount = h.online || 0;
      showNet();
    }),
    net.on('online', (n) => {
      onlineCount = n;
      showNet();
    }),
  ];
  showNet();

  // ---------------------------------------------------------------- enter
  return new Promise((resolve) => {
    const enter = $(node, '.enter');
    enter.addEventListener('click', async () => {
      const name = form.raver.value.trim().slice(0, 18) || `Raver${Math.floor(Math.random() * 900 + 100)}`;
      const tag = form.handle.value.trim().slice(0, 18);
      let djKey = null;
      enter.disabled = true;
      await netReady;
      if (wantsDJ) {
        djKey = net.online ? form.djkey.value : 'local';
        if (net.online && !(await net.checkDJ(djKey))) {
          toast('Wrong DJ password — try again, or join as a raver by removing ?dj=true', 'error', 4500);
          enter.disabled = false;
          form.djkey.focus();
          return;
        }
      }
      alive = false;
      ro.disconnect();
      offs.forEach((off) => off());
      avatar.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      node.style.transition = 'opacity .5s';
      node.style.opacity = '0';
      setTimeout(() => node.remove(), 520);
      resolve({ profile: { name, tag, avatar: cfg }, djKey });
    });
  });
}
