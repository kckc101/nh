// The E-Rave entrance: the first screen, and the only way in. Nothing of the rave runs behind it
// (no 3D scene, no music, no multiplayer connection) until you press Enter with a verified ticket.
// Tickets are bought on their own page (tickets/); here you only show one.
//
//   checking   a ticket saved in this browser is sent to the server to verify
//   verified   TICKET VERIFIED · ENTER THE RAVE (or show the pass / use another ticket)
//   enter      ENTER YOUR TICKET: scan its QR (camera, or a photo / screenshot of the receipt)
//              or type its code · no ticket? → the tickets page
//   unlocked   a scanned / typed ticket checked out: the pass unlocks → ENTER E-RAVE NOW
//   pass       the full pass with its access QR
//   offline    the server can't be reached to check a ticket
//   dj         ?dj=true: the host's entrance (the DJ password is checked on the next screen)
//
// No ticket server at all (a static host such as GitHub Pages, where /api is a 404 page): the
// entrance offers ENTER THE OFFLINE DEMO (a simulated crowd and a local DJ, nothing networked).
// That opens nothing a server guards: if a server does turn out to be there, it still turns away
// anyone without a ticket when they join.
//
// The browser only shows what the server says: it verifies every ticket, and the multiplayer
// server checks it again when you join (no ticket, no entry), so editing this page or its storage
// doesn't get anyone in.

import { el, $, toast } from './dom.js';
import { icon, renderIcons } from './icons.js';
import { settings, saveSettings } from '../core/device.js';
import { load, save } from '../core/store.js';
import { ticketsApi } from '../net/ticketsApi.js';
import { tierOf, loadPass, savePass, clearPass, passFrom, bindCodeInput } from '../core/pass.js';
import { createBackdrop, angkorCrest } from './landing.js';
import { burst } from './confetti.js';

export { clearPass };

const MSG_KEY = 'erave.gateMsg';
const TICKETS_PAGE = 'tickets/';
const calm = () => settings.reduceFlash || matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A message for the entrance to show next time it opens (e.g. after the server refused a ticket). */
export const setGateMessage = (text) => save(MSG_KEY, text, 'session');

/** The ticket pass card. `full` adds the access QR. */
function passCard(p, full) {
  const tier = tierOf(p.type);
  const node = el(`
    <div class="pass relative w-full rounded-2xl p-[1.5px] text-left" style="--tier:${tier.color};background:linear-gradient(135deg,var(--tier),#ff2bd6 55%,#8b5cff)">
      <div class="rounded-[15px] bg-[#07040f] overflow-hidden">
        <div class="relative px-5 pt-5 pb-4" style="background:radial-gradient(120% 90% at 0% 0%,color-mix(in srgb,var(--tier) 28%,transparent),transparent 60%)">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-[10px] tracking-[.3em] text-white/55">E-RAVE CAMBODIA 2026</div>
              <div class="font-display text-3xl leading-none mt-1">MORODOK TECHO</div>
            </div>
            <span class="tier-badge rounded-full px-3 py-1 text-[11px] font-bold tracking-[.16em] text-black whitespace-nowrap" style="background:var(--tier);box-shadow:0 0 16px var(--tier)"></span>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-y-2 text-xs">
            <div class="col-span-2"><div class="text-[10px] tracking-[.2em] text-white/45">ATTENDEE</div><div class="a-name font-semibold text-lg leading-tight break-words"></div></div>
            <div><div class="text-[10px] tracking-[.2em] text-white/45">ADMITS</div><div class="font-semibold">1 person</div></div>
            <div><div class="text-[10px] tracking-[.2em] text-white/45">TICKET CODE</div><div class="a-code font-mono font-semibold tracking-[.12em] text-white/90"></div></div>
          </div>
          <div class="a-perks mt-3 text-[11px] text-white/55"></div>
        </div>
        ${full ? `
        <div class="relative h-0 border-t-2 border-dashed border-white/15 mx-4">
          <span class="absolute -left-[26px] -top-3 size-6 rounded-full bg-[#0b0614]"></span><span class="absolute -right-[26px] -top-3 size-6 rounded-full bg-[#0b0614]"></span>
        </div>
        <div class="px-5 py-4 flex flex-col items-center gap-2">
          <div class="rounded-xl bg-white p-2"><img class="access-qr block size-48 [@media(max-height:700px)]:size-36 [image-rendering:pixelated]" alt="Ticket access QR code"/></div>
          <div class="flex items-center gap-1.5 text-xs text-acid font-semibold">${icon('shield-check', 'size-4')}VERIFIED · signed by E-Rave</div>
        </div>` : ''}
        <div class="test-flag hidden pb-3 text-center text-[10px] tracking-[.2em] text-gold">TEST TICKET · NOT VALID ONCE REAL SALES OPEN</div>
      </div>
    </div>`);
  node.querySelector('.tier-badge').textContent = tier.badge;
  node.querySelector('.a-name').textContent = p.name;
  node.querySelector('.a-code').textContent = p.code || p.id.slice(0, 8).toUpperCase();
  node.querySelector('.a-perks').textContent = tier.perks.join(' · ');
  node.querySelector('.test-flag').classList.toggle('hidden', !p.test);
  if (full) node.querySelector('.access-qr').src = p.qrDataUrl;
  renderIcons(node);
  return node;
}

const VIEW_HTML = `
  <section data-view="checking" class="hidden flex flex-col items-center gap-3 py-12 text-center">
    <span class="size-10 rounded-full border-2 border-cyan/25 border-t-cyan animate-spin"></span>
    <p class="text-sm text-white/70">Checking your ticket…</p>
  </section>

  <section data-view="verified" class="hidden flex flex-col gap-4">
    <div class="flex items-center gap-2 text-acid font-display text-3xl leading-none">${icon('lock-open', 'size-7')}TICKET VERIFIED</div>
    <button type="button" class="enter btn-rave rounded-2xl px-6 py-4 font-display text-2xl tracking-wider text-white flex items-center justify-center gap-3">${icon('play', 'size-6 fill-white')}ENTER THE RAVE</button>
    <p class="offline-note hidden text-[11px] rounded-lg px-3 py-2 border border-gold/40 text-gold bg-gold/10">The ticket desk is offline, so this is the ticket verified on this device before. You'll enter on your own until it's back.</p>
    <div class="slot"></div>
    <div class="flex justify-between text-sm text-white/60">
      <button type="button" class="to-pass underline underline-offset-4 hover:text-white">Show my pass</button>
      <button type="button" class="other underline underline-offset-4 hover:text-white">Use another ticket</button>
    </div>
  </section>

  <section data-view="enter" class="hidden flex flex-col gap-4">
    <div>
      <h2 class="font-display text-3xl leading-none">ENTER YOUR <span class="text-cyan neon-soft">TICKET</span></h2>
      <p class="text-xs text-white/55 mt-1.5">Scan the QR on your ticket receipt, or type its ticket code.</p>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <button type="button" class="scan-cam btn-rave rounded-xl px-3 py-3.5 font-semibold text-white flex flex-col items-center justify-center gap-1.5">${icon('scan-qr-code', 'size-7')}<span class="text-sm">Scan with camera</span></button>
      <label class="scan-photo rounded-xl px-3 py-3.5 font-semibold border border-white/20 hover:bg-white/10 flex flex-col items-center justify-center gap-1.5 cursor-pointer">${icon('image-up', 'size-7 text-cyan')}<span class="text-sm">Photo of your QR</span><input type="file" accept="image/*" class="scan-file hidden"/></label>
    </div>
    <div class="cam hidden relative rounded-xl overflow-hidden bg-black aspect-square">
      <video class="w-full h-full object-cover" playsinline muted></video>
      <div class="absolute inset-[16%] rounded-xl border-2 border-cyan/80 shadow-[0_0_0_9999px_rgba(0,0,0,.4)]"></div>
      <p class="absolute inset-x-0 bottom-3 text-center text-xs font-semibold text-white/85">Hold your ticket QR inside the frame</p>
      <button type="button" class="cam-stop absolute top-2 right-2 rounded-lg size-8 grid place-items-center bg-black/60" aria-label="Stop the camera">${icon('x', 'size-4')}</button>
    </div>
    <div class="flex items-center gap-3 text-[11px] tracking-[.2em] text-white/35"><span class="h-px flex-1 bg-white/10"></span>OR TYPE THE CODE<span class="h-px flex-1 bg-white/10"></span></div>
    <div class="flex gap-2">
      <input class="f-code field flex-1 min-w-0 text-white font-mono text-lg tracking-[.18em] uppercase" maxlength="14" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Ticket code"/>
      <button type="button" class="redeem rounded-xl px-4 font-display text-lg tracking-wider border border-cyan/60 text-cyan hover:bg-cyan/10 disabled:opacity-40">ENTER</button>
    </div>
    <p class="err hidden text-sm text-[#ff6b8a]" role="alert"></p>
    <button type="button" class="demo-entry hidden w-full rounded-xl px-4 py-3 border border-[#00f0ff]/40 bg-[#00f0ff]/5 hover:bg-[#00f0ff]/10 text-left flex items-center justify-between gap-3">
      <span><span class="block text-sm font-semibold">No ticket server here</span><span class="block text-xs text-white/55">Try the offline demo: a simulated crowd and a local DJ</span></span>
      <span class="shrink-0 font-display text-lg tracking-wider text-cyan flex items-center gap-1.5">${icon('play', 'size-4')}DEMO</span>
    </button>
    <a href="${TICKETS_PAGE}" class="buy-link rounded-xl px-4 py-3 border border-white/10 bg-white/[.03] hover:bg-white/10 flex items-center justify-between gap-3">
      <span><span class="block text-sm font-semibold">No ticket yet?</span><span class="block text-xs text-white/55">General admission $5 · VIP $20 · pay with KHQR</span></span>
      <span class="shrink-0 font-display text-lg tracking-wider text-magenta flex items-center gap-1.5">${icon('ticket', 'size-5')}BUY TICKETS</span>
    </a>
  </section>

  <section data-view="unlocked" class="hidden relative flex flex-col items-center gap-4 text-center">
    <span class="ring-fx pointer-events-none absolute left-1/2 top-[30%] -ml-24 -mt-24 size-48 rounded-full border-4 border-acid opacity-0"></span>
    <div class="granted-title font-display text-[clamp(34px,8vw,46px)] leading-none text-acid">ACCESS GRANTED</div>
    <p class="text-sm text-white/65 -mt-2">Ticket checked. See you on the floor.</p>
    <button type="button" class="enter btn-rave w-full rounded-2xl px-6 py-4 font-display text-2xl tracking-wider text-white flex items-center justify-center gap-3">${icon('play', 'size-6 fill-white')}ENTER E-RAVE NOW</button>
    <div class="slot w-full"></div>
  </section>

  <section data-view="pass" class="hidden flex flex-col items-center gap-3">
    <div class="slot w-full"></div>
    <div class="flex gap-2 w-full">
      <a class="save flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold border border-white/20 hover:bg-white/10 flex items-center justify-center gap-2">${icon('download', 'size-4')}Save QR</a>
      <button type="button" class="enter btn-rave flex-1 rounded-xl px-4 py-2.5 font-display text-lg tracking-wider text-white">ENTER</button>
    </div>
    <button type="button" class="to-verified text-sm text-white/60 underline underline-offset-4">Back</button>
  </section>

  <section data-view="offline" class="hidden flex flex-col items-center gap-3 py-8 text-center">
    ${icon('wifi-off', 'size-10 text-white/50')}
    <h2 class="font-display text-2xl">THE TICKET DESK IS OFFLINE</h2>
    <p class="text-sm text-white/60 max-w-[32ch]">Tickets are checked by the E-Rave server, which can't be reached right now.</p>
    <button type="button" class="retry btn-rave rounded-xl px-6 py-3 font-display text-xl tracking-wider text-white">TRY AGAIN</button>
    <button type="button" class="demo-entry hidden w-full rounded-xl px-4 py-3 border border-[#00f0ff]/40 bg-[#00f0ff]/5 hover:bg-[#00f0ff]/10 text-left flex items-center justify-between gap-3">
      <span><span class="block text-sm font-semibold">No ticket server here</span><span class="block text-xs text-white/55">Try the offline demo: a simulated crowd and a local DJ</span></span>
      <span class="shrink-0 font-display text-lg tracking-wider text-cyan flex items-center gap-1.5">${icon('play', 'size-4')}DEMO</span>
    </button>
  </section>

  <section data-view="dj" class="hidden flex flex-col items-center gap-4 py-6 text-center">
    ${icon('headphones', 'size-10 text-magenta')}
    <h2 class="font-display text-3xl leading-none">HOST <span class="text-magenta neon-soft">ENTRANCE</span></h2>
    <p class="text-sm text-white/60 max-w-[32ch]">DJs come in with the host password on the next screen. No ticket needed.</p>
    <button type="button" class="enter btn-rave w-full rounded-2xl px-6 py-4 font-display text-2xl tracking-wider text-white">ENTER AS DJ</button>
  </section>`;

/**
 * Show the entrance; resolves with the verified pass (or null for the DJ) when Enter is pressed.
 * @param onEnter  called inside the Enter click (unlocks Web Audio on iOS)
 * @param preload  starts fetching the rave's code in the background while the entrance is up
 * @param quick    ?quick: a verified saved ticket goes straight in (no click)
 */
export function showGate(root, opts) {
  return new Gate(root, opts).done;
}

class Gate {
  constructor(root, { wantsDJ = false, quick = false, name = '', onEnter, preload }) {
    this.wantsDJ = wantsDJ;
    this.quick = quick;
    this.name = name;
    this.onEnter = onEnter;
    this.pass = null;
    this.done = new Promise((r) => (this.resolve = r));

    this.bd = createBackdrop(root);
    this.node = el(`
      <div class="hero-wrap min-h-full w-full flex flex-col items-center gap-8 px-4 pt-[clamp(28px,8vh,88px)] pb-10">
        <div class="relative z-10 flex flex-col items-center text-center max-w-xl">
          <div class="hero-extra rise flex flex-wrap justify-center gap-2 mb-4 text-[11px] tracking-[.22em] font-semibold" style="animation-delay:.1s">
            <span class="glass rounded-full px-3 py-1 flex items-center gap-2 text-white"><span class="size-2 rounded-full bg-[#ff2d55] pulse-dot"></span>LIVE NOW</span>
            <span class="glass rounded-full px-3 py-1 text-gold">MORODOK TECHO · PHNOM PENH</span>
          </div>
          <div class="hero-head">${angkorCrest()}<div class="hero-words flex flex-col items-center">
          <h1 class="hero-title rise font-display leading-[.82] text-[clamp(56px,min(15vw,21vh),176px)] flicker"
              style="background: linear-gradient(180deg,#fff 10%,#ff8ae6 45%,#ff2bd6 70%,#8b5cff); -webkit-background-clip:text; background-clip:text; color:transparent;
                     filter: drop-shadow(0 0 18px rgba(255,43,214,.7)) drop-shadow(0 0 50px rgba(139,92,255,.5)); animation-delay:.2s">E-RAVE</h1>
          <p class="hero-sub rise font-display text-cyan neon text-[clamp(18px,min(4vw,5.5vh),44px)] tracking-[.26em] -mt-1" style="animation-delay:.3s">CAMBODIA 2026</p>
          </div></div>
          <p class="hero-extra rise font-khmer text-gold neon-soft text-[clamp(16px,2.4vw,24px)] mt-1" style="animation-delay:.4s" lang="km">តន្ត្រី • រាំ • សប្បាយ</p>
          <button type="button" class="open-card cta rise btn-rave mt-6 w-full max-w-xs rounded-xl px-5 py-2.5 font-display text-[clamp(15px,4vw,19px)] tracking-wider text-white flex items-center justify-center gap-2.5 whitespace-nowrap" style="animation-delay:.5s">${icon('scan-qr-code', 'size-5')}SCAN YOUR TICKET TO ENTER</button>
          <button type="button" class="demo-hero demo-go hidden mt-3 w-full max-w-xs rounded-xl px-5 py-2 font-display text-[clamp(14px,3.6vw,17px)] tracking-wider text-cyan border border-[#00f0ff]/50 hover:bg-[#00f0ff]/10 flex items-center justify-center gap-2 whitespace-nowrap">${icon('play', 'size-4')}ENTER THE OFFLINE DEMO</button>
          <p class="demo-hero hidden mt-2 text-[11px] text-white/45 max-w-xs">No ticket server on this site: try it with a simulated crowd and a local DJ.</p>
          <div class="gate-lock hero-extra rise mt-4 inline-flex items-center gap-2 rounded-full border border-[#ff2d55]/60 bg-[#ff2d55]/10 px-4 py-1.5 text-[11px] font-bold tracking-[.2em] text-[#ff6b8a]" style="animation-delay:.55s">
            ${icon('lock', 'size-3.5')}<span>ACCESS RESTRICTED · TICKET REQUIRED</span>
          </div>
          <div class="hero-extra rise mt-4 flex flex-wrap justify-center items-center gap-3 text-xs text-white/60" style="animation-delay:.7s">
            <span class="flex items-center gap-1.5">${icon('headphones', 'size-4')} Best with headphones</span>
            <label class="flex items-center gap-2 cursor-pointer"><input type="checkbox" class="reduce accent-[#ff2bd6] size-4" ${settings.reduceFlash ? 'checked' : ''}/>Reduce flashing lights</label>
          </div>
        </div>
        <div class="card hidden rise relative z-10 w-full max-w-[420px] glass-strong rounded-2xl p-4 md:p-5">${VIEW_HTML}</div>
      </div>`);
    this.bd.content.append(this.node);
    renderIcons(this.node);
    this.q = (s) => $(this.node, s);
    this.bind();
    // Fetch the rave's code in the background while the entrance is up (nothing is created yet).
    if (preload) setTimeout(() => preload().catch(() => {}), 1200);
    this.start();
  }

  bind() {
    const on = (sel, fn) => this.node.querySelectorAll(sel).forEach((b) => b.addEventListener('click', fn));
    on('.enter', () => this.enter());
    on('.open-card', () => this.reveal());
    on('.to-pass', () => this.show('pass'));
    on('.to-verified', () => this.show(this.lastPassView || 'verified'));
    on('.other', () => {
      clearPass();
      this.pass = null;
      this.show('enter');
    });
    on('.retry', () => this.start());
    on('.demo-entry, .demo-go', () => this.enterDemo());
    on('.redeem', () => this.check(this.q('.f-code').value));
    on('.scan-cam', () => this.startCamera());
    on('.cam-stop', () => this.stopCamera());
    this.q('.scan-file').addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) this.scanFile(f);
    });
    this.q('.reduce').addEventListener('change', (e) => {
      settings.reduceFlash = e.target.checked;
      saveSettings();
    });
    bindCodeInput(this.q('.f-code'), (v) => this.check(v));
    // No camera without a secure page (https or localhost): the photo still works.
    if (!(window.isSecureContext && navigator.mediaDevices?.getUserMedia)) {
      this.q('.scan-cam').classList.add('hidden');
      this.q('.scan-photo').classList.add('col-span-2');
    }
  }

  // ---------------------------------------------------------------- flow
  async start() {
    const msg = load(MSG_KEY, null, 'session');
    if (msg) {
      save(MSG_KEY, null, 'session');
      setTimeout(() => toast(msg, 'error', 6500), 400);
    }
    if (this.wantsDJ) return this.show('dj');
    // Is there a ticket server? (Asked once, alongside everything else; a static host has none.)
    ticketsApi.reachable().then((ok) => this.setDesk(ok));
    const saved = loadPass();
    if (!saved) return this.show('enter');
    this.pass = saved;
    this.show('checking');
    try {
      const r = await ticketsApi.verify(saved.token);
      this.pass = { ...saved, type: r.ticket.type, code: r.ticket.code || saved.code, test: !!r.ticket.test, verifiedAt: Date.now() };
      savePass(this.pass);
      this.offline = false;
    } catch (err) {
      if (err.status === 401) {
        clearPass();
        this.pass = null;
        toast(err.message || 'Your saved ticket is no longer valid.', 'error', 6000);
        return this.show('enter');
      }
      if (!saved.verifiedAt) return this.show('offline');
      this.offline = true; // unreachable: a ticket verified here before still opens the (offline) rave
    }
    if (this.quick) return this.enter();
    this.show('verified');
  }

  show(view) {
    if (this.view === 'enter' && view !== 'enter') this.stopCamera();
    this.view = view;
    for (const s of this.node.querySelectorAll('[data-view]')) s.classList.toggle('hidden', s.dataset.view !== view);
    for (const e of this.node.querySelectorAll('.err')) e.classList.add('hidden');
    // A fresh "enter your ticket" is just the title and its button; the card opens when it's pressed
    // (every other view, with a ticket or a message to show, opens it straight away).
    if (view !== 'enter' || this.cardOpen) this.reveal();
    const sec = this.q(`[data-view="${view}"]`);
    if (view === 'verified') {
      this.lastPassView = 'verified';
      sec.querySelector('.slot').replaceChildren(passCard(this.pass, false));
      sec.querySelector('.offline-note').classList.toggle('hidden', !this.offline);
    }
    if (view === 'pass' || view === 'unlocked') {
      if (view === 'unlocked') this.lastPassView = 'unlocked';
      sec.querySelector('.slot').replaceChildren(passCard(this.pass, view === 'pass'));
      const a = sec.querySelector('.save');
      if (a) {
        a.href = this.pass.qrDataUrl;
        a.download = `e-rave-ticket-qr-${(this.pass.code || this.pass.id).replace(/-/g, '').slice(0, 12)}.png`;
      }
    }
    if (view !== 'checking') this.settled = true;
    this.setLock(view === 'verified' || view === 'unlocked' || view === 'pass');
  }

  /** Open the card under the title (the button gives way to it). */
  /** No ticket server: offer the offline demo (in the header, the card's views). Back on: hide it. */
  setDesk(ok) {
    this.noDesk = !ok;
    for (const n of this.node.querySelectorAll('.demo-entry')) n.classList.toggle('hidden', ok);
    for (const n of this.node.querySelectorAll('.demo-hero')) n.classList.toggle('hidden', ok || !!this.cardOpen);
  }

  /** The offline demo: in without a ticket, to the local crowd and DJ (no server is there). */
  enterDemo() {
    this.pass = null;
    this.enter();
  }

  reveal() {
    const card = this.q('.card');
    card.classList.remove('hidden');
    this.q('.cta').classList.add('hidden');
    for (const n of this.node.querySelectorAll('.demo-hero')) n.classList.add('hidden');
    // The header becomes one block (the Angkor crest, the title over it) and the card follows it
    // in the page's flow, so they can't overlap; the card scrolls inside itself if it's tight.
    this.node.classList.add('hero-compact');
    this.bd.node.classList.add('bd-compact');
    this.cardOpen = true;
  }

  /** The hero's badge: locked until a ticket's verified. */
  setLock(open) {
    const b = this.q('.gate-lock');
    b.querySelector('span').textContent = open ? 'ACCESS GRANTED · TICKET VERIFIED' : this.wantsDJ ? 'HOST ACCESS · DJ PASSWORD' : 'ACCESS RESTRICTED · TICKET REQUIRED';
    b.style.color = open ? '#9dff00' : '';
    b.style.borderColor = open ? 'rgba(157,255,0,.6)' : '';
    b.style.background = open ? 'rgba(157,255,0,.1)' : '';
  }

  fail(text) {
    const e = this.q(`[data-view="${this.view}"] .err`);
    if (!e) return toast(text, 'error');
    e.textContent = text;
    e.classList.remove('hidden');
  }

  enter() {
    if (this.entered) return;
    this.entered = true;
    this.onEnter?.(); // inside the click: unlocks Web Audio on Safari / iOS
    this.stopCamera();
    this.bd.close();
    this.resolve(this.pass);
  }

  // ---------------------------------------------------------------- enter your ticket
  /** A ticket code, or a scanned QR (its token): the server checks it and hands back the ticket. */
  async check(input) {
    const raw = String(input || '').trim();
    if (!raw) return this.fail('Type the ticket code from your receipt (XXXX-XXXX-XXXX), or scan its QR.');
    const btn = this.q('.redeem');
    btn.disabled = true;
    try {
      const o = await ticketsApi.redeem(raw);
      this.unlock(passFrom(o, this.name));
    } catch (err) {
      this.fail(
        err.status === 429 ? 'Too many tries: wait a few minutes and try again.'
          : err.status === 404 ? (raw.includes('.') ? "That QR isn't a valid E-Rave ticket." : err.message)
            : err.status ? err.message : "The ticket desk can't be reached right now.",
      );
    }
    btn.disabled = false;
  }

  unlock(pass) {
    this.pass = pass;
    savePass(pass);
    this.offline = false;
    this.show('unlocked');
    const sec = this.q('[data-view="unlocked"]');
    for (const [node, cls] of [[sec.querySelector('.pass'), 'pass-unlock'], [sec.querySelector('.granted-title'), 'granted'], [sec.querySelector('.ring-fx'), 'unlock-ring']]) {
      node.classList.remove(cls);
      void node.offsetWidth; // restart the animation
      node.classList.add(cls);
    }
    if (calm()) return;
    const r = sec.getBoundingClientRect();
    burst(this.bd.node, r.left + r.width / 2, r.top + r.height * 0.35, ['#ff2bd6', '#00f0ff', '#9dff00', tierOf(pass.type).color, '#ffffff']);
  }

  async decoder() {
    this.jsQR ||= (await import('jsqr')).default;
    return this.jsQR;
  }

  async startCamera() {
    if (this.stream) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch {
      return this.fail('No camera access. Allow it, or use a photo of your ticket QR instead.');
    }
    const jsQR = await this.decoder();
    const box = this.q('.cam');
    const video = box.querySelector('video');
    box.classList.remove('hidden');
    video.srcObject = this.stream;
    await video.play().catch(() => {});
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const scan = () => {
      if (!this.stream) return;
      if (video.videoWidth) {
        const k = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * k);
        canvas.height = Math.round(video.videoHeight * k);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
        if (hit?.data) {
          this.stopCamera();
          return this.check(hit.data);
        }
      }
      this.camTimer = setTimeout(scan, 180);
    };
    scan();
  }

  stopCamera() {
    clearTimeout(this.camTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.q('.cam')?.classList.add('hidden');
  }

  /** A photo or screenshot of the ticket QR (the receipt image works too). */
  async scanFile(file) {
    try {
      const jsQR = await this.decoder();
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * k);
      canvas.height = Math.round(bmp.height * k);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const hit = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
      if (!hit?.data) return this.fail("Couldn't find a ticket QR in that picture. Try a sharper one, or type the code.");
      this.check(hit.data);
    } catch {
      this.fail("Couldn't read that picture.");
    }
  }
}
