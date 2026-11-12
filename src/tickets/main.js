// The tickets page (tickets/index.html): buy a ticket to E-Rave Cambodia, separate from the rave.
//
//   choose   General admission or VIP, the attendee's details → PAY WITH KHQR
//   pay      the dynamic KHQR with a countdown, polled every 2.5 s ("Pay (Test)" in mock mode)
//   receipt  payment received: the receipt (number, date, method, billed to, item, total) with
//            the ticket's access QR attached. Download it as an image, print it, or save the QR.
//   find     already bought? the ticket code brings the receipt back, on any device
//
// The ticket is also kept in this browser, so the E-Rave entrance recognises it straight away;
// anywhere else, its QR (or code) is scanned at the entrance's "Enter your ticket".

import '../style.css';
import { el, $ } from '../ui/dom.js';
import { icon, renderIcons } from '../ui/icons.js';
import { createBackdrop, angkorCrest } from '../ui/landing.js';
import { burst, calm } from '../ui/confetti.js';
import { ticketsApi } from '../net/ticketsApi.js';
import { tierOf, money, loadPass, savePass, passFrom, bindCodeInput } from '../core/pass.js';
import { receiptFrom, receiptPng, printImage, paidOn } from './receipt.js';

const POLL_MS = 2500;
const ENTRANCE = new URL('../', location.href).href; // the rave's entrance, next to this page
const mmss = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const STEPS = [['choose', 'Choose'], ['pay', 'Pay'], ['receipt', 'Receipt']];

const PAGE = `
  <div class="hero-wrap min-h-full w-full flex flex-col items-center px-4 pt-5 pb-10">
    <header class="hero-extra relative z-10 w-full max-w-5xl flex items-center justify-end gap-3">
      <a href="${ENTRANCE}" class="glass rounded-full h-10 px-4 flex items-center gap-2 text-xs md:text-sm font-semibold hover:bg-white/10">${icon('scan-qr-code', 'size-4 text-cyan')}Have a ticket? Enter E-Rave</a>
    </header>

    <div class="hero-main relative z-10 w-full max-w-5xl flex flex-col items-center gap-8 pt-[clamp(8px,4vh,48px)]">
      <div class="rise text-center max-w-xl flex flex-col items-center">
        <div class="hero-extra flex flex-wrap justify-center gap-2 mb-4 text-[11px] tracking-[.22em] font-semibold">
          <span class="glass rounded-full px-3 py-1 flex items-center gap-2 text-white"><span class="size-2 rounded-full bg-[#ff2d55] pulse-dot"></span>ON SALE NOW</span>
          <span class="glass rounded-full px-3 py-1 text-gold">MORODOK TECHO · PHNOM PENH</span>
        </div>
        <div class="hero-head">${angkorCrest()}<div class="hero-words flex flex-col items-center">
        <h1 class="hero-title font-display leading-[.82] text-[clamp(56px,min(15vw,21vh),168px)] flicker" style="background:linear-gradient(180deg,#fff 10%,#ff8ae6 45%,#ff2bd6 70%,#8b5cff);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 18px rgba(255,43,214,.7)) drop-shadow(0 0 50px rgba(139,92,255,.5))">E-RAVE</h1>
        <p class="hero-sub font-display text-cyan neon text-[clamp(18px,min(4vw,5.5vh),44px)] tracking-[.26em] -mt-1">CAMBODIA 2026</p>
        </div></div>
        <p class="hero-extra font-khmer text-gold neon-soft text-[clamp(16px,2.4vw,24px)] mt-1" lang="km">តន្ត្រី • រាំ • សប្បាយ</p>
        <button type="button" class="open-card cta btn-rave mt-6 w-full max-w-xs rounded-xl px-5 py-2.5 font-display text-[clamp(15px,4vw,19px)] tracking-wider text-white flex items-center justify-center gap-2.5">${icon('ticket', 'size-5')}PURCHASE TICKETS</button>
        <ol class="steps hidden mt-2 flex justify-center gap-2 text-[11px] font-semibold tracking-[.18em]">
          ${STEPS.map(([id, label], i) => `<li data-step="${id}" class="rounded-full px-3 py-1.5 border border-white/15 text-white/45">${i + 1} · ${label.toUpperCase()}</li>`).join('')}
        </ol>
      </div>

      <div class="card hidden rise glass-strong rounded-2xl p-4 md:p-5 w-full max-w-[460px]">
        <section data-view="choose" class="hidden flex flex-col gap-4">
          <h2 class="font-display text-3xl leading-none">CHOOSE YOUR <span class="text-cyan neon-soft">TICKET</span></h2>
          <div class="have hidden rounded-xl px-3.5 py-3 border border-acid/40 bg-acid/10 text-sm flex items-center justify-between gap-3">
            <span class="have-text text-acid"></span>
            <button type="button" class="view-mine shrink-0 underline underline-offset-4 text-white">View receipt</button>
          </div>
          <p class="mock-note hidden text-[11px] rounded-lg px-3 py-2 border border-gold/40 text-gold bg-gold/10">TEST MODE: no real payment is taken. You'll pay with a test button.</p>
          <div class="types grid gap-2"></div>
          <div class="grid gap-3">
            <label class="flex flex-col gap-1.5 text-xs text-white/60">Name on the ticket
              <input class="f-name field text-white" maxlength="40" autocomplete="name" spellcheck="false" required/></label>
            <div class="grid grid-cols-2 gap-3">
              <label class="flex flex-col gap-1.5 text-xs text-white/60">Email <span class="text-white/35 -mt-1">(for your records)</span>
                <input class="f-email field text-white" type="email" maxlength="80" autocomplete="email" spellcheck="false"/></label>
              <label class="flex flex-col gap-1.5 text-xs text-white/60">Phone <span class="text-white/35 -mt-1">(optional)</span>
                <input class="f-phone field text-white" type="tel" maxlength="20" autocomplete="tel"/></label>
            </div>
          </div>
          <div class="flex items-baseline justify-between border-t border-white/10 pt-3">
            <span class="text-sm text-white/60">Total</span><span class="total font-display text-3xl">$0.00</span>
          </div>
          <p class="err hidden text-sm text-[#ff6b8a]" role="alert"></p>
          <button type="button" class="buy btn-rave rounded-xl px-6 py-3.5 font-display text-xl tracking-wider text-white disabled:opacity-40 disabled:cursor-not-allowed">PAY WITH KHQR</button>
          <button type="button" class="to-find text-sm text-white/60 underline underline-offset-4 self-center hover:text-white">Already bought? Find your receipt</button>
        </section>

        <section data-view="pay" class="hidden flex flex-col items-center gap-3 text-center">
          <h2 class="font-display text-3xl leading-none">SCAN <span class="text-cyan neon-soft">TO PAY</span></h2>
          <div class="text-[11px] tracking-[.2em] text-white/50"><span class="p-tier"></span> · <span class="p-amount text-white"></span></div>
          <div class="relative rounded-2xl bg-white p-3 shadow-[0_0_32px_rgba(0,240,255,.3)]">
            <img class="qr block size-60 [@media(max-height:700px)]:size-44 [image-rendering:pixelated]" alt="Payment QR code"/>
            <div class="qr-dead hidden absolute inset-0 rounded-2xl bg-black/80 grid place-items-center text-sm font-semibold px-6"></div>
          </div>
          <div class="countdown font-mono text-3xl tabular-nums neon-soft">15:00</div>
          <p class="text-sm text-white/70 flex items-center gap-2"><span class="status-dot size-2 rounded-full bg-gold pulse-dot"></span><span class="status-text">Waiting for payment…</span></p>
          <p class="text-[11px] text-white/45 leading-snug max-w-[34ch]">Open your banking app (ABA, or any KHQR app), scan this code and pay. Your receipt appears here by itself.</p>
          <a class="deeplink hidden btn-rave rounded-xl px-5 py-2.5 text-sm font-semibold text-white" target="_blank" rel="noopener">Open in ABA app</a>
          <button type="button" class="pay-test hidden rounded-xl px-5 py-2.5 text-sm font-semibold border border-gold/60 text-gold bg-gold/10 hover:bg-gold/20 disabled:opacity-40">Pay (Test)</button>
          <p class="err hidden text-sm text-[#ff6b8a]" role="alert"></p>
          <button type="button" class="back text-sm text-white/60 underline underline-offset-4">Cancel</button>
        </section>

        <section data-view="receipt" class="hidden flex flex-col gap-4">
          <div class="text-center">
            <div class="r-title font-display text-[clamp(30px,7vw,42px)] leading-none text-acid">PAYMENT RECEIVED</div>
            <p class="r-sub text-sm text-white/65 mt-1">Here's your receipt. Your ticket's QR is attached.</p>
          </div>
          <div class="slot"></div>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="dl-receipt rounded-xl px-3 py-2.5 text-sm font-semibold border border-white/20 hover:bg-white/10 flex items-center justify-center gap-2 disabled:opacity-40">${icon('download', 'size-4')}Download receipt</button>
            <button type="button" class="print rounded-xl px-3 py-2.5 text-sm font-semibold border border-white/20 hover:bg-white/10 flex items-center justify-center gap-2 disabled:opacity-40">${icon('printer', 'size-4')}Print</button>
          </div>
          <a class="dl-qr text-center text-sm text-white/60 underline underline-offset-4 hover:text-white">Save the QR code only</a>
          <a href="${ENTRANCE}" class="enter btn-rave rounded-2xl px-6 py-4 font-display text-2xl tracking-wider text-white flex items-center justify-center gap-3">${icon('play', 'size-6 fill-white')}ENTER E-RAVE NOW</a>
          <button type="button" class="again text-sm text-white/60 underline underline-offset-4 self-center hover:text-white">Buy another ticket</button>
        </section>

        <section data-view="find" class="hidden flex flex-col gap-4">
          <h2 class="font-display text-3xl leading-none">FIND YOUR <span class="text-cyan neon-soft">RECEIPT</span></h2>
          <p class="text-xs text-white/55 -mt-2">The ticket code is on your receipt (XXXX-XXXX-XXXX).</p>
          <label class="flex flex-col gap-1.5 text-xs text-white/60">Ticket code
            <input class="f-code field text-white font-mono text-lg tracking-[.22em] uppercase" maxlength="14" placeholder="XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false"/></label>
          <p class="err hidden text-sm text-[#ff6b8a]" role="alert"></p>
          <button type="button" class="find btn-rave rounded-xl px-6 py-3 font-display text-xl tracking-wider text-white disabled:opacity-40">SHOW MY RECEIPT</button>
          <button type="button" class="to-choose text-sm text-white/60 underline underline-offset-4 self-center hover:text-white">Back to tickets</button>
        </section>

        <section data-view="offline" class="hidden flex flex-col items-center gap-3 py-8 text-center">
          ${icon('wifi-off', 'size-10 text-white/50')}
          <h2 class="font-display text-2xl">THE BOX OFFICE IS OFFLINE</h2>
          <p class="text-sm text-white/60 max-w-[32ch]">Tickets are sold by the E-Rave server, which can't be reached right now.</p>
          <button type="button" class="retry btn-rave rounded-xl px-6 py-3 font-display text-xl tracking-wider text-white">TRY AGAIN</button>
          <a href="${ENTRANCE}" class="text-sm text-cyan underline underline-offset-4 hover:text-white">Or try the offline demo at the entrance</a>
        </section>
      </div>
    </div>
  </div>`;

/** The receipt, on screen: white paper, the ticket stub with its QR at the bottom. */
function receiptCard(rc) {
  const tier = tierOf(rc.ticket.type);
  const node = el(`
    <article class="receipt rounded-2xl overflow-hidden bg-white text-[#17121f] shadow-[0_0_40px_rgba(255,43,214,.25)]">
      <header class="relative px-5 pt-5 pb-4 bg-[#0b0614] text-white">
        <div class="flex items-start justify-between gap-3">
          <div><div class="font-display text-4xl leading-none" style="text-shadow:0 0 14px #ff2bd6">E-RAVE</div><div class="font-display text-cyan text-lg tracking-[.2em] leading-none mt-1">CAMBODIA 2026</div></div>
          <div class="text-right text-[11px] text-white/70 leading-snug"><div class="font-semibold tracking-[.16em] text-white">PAYMENT RECEIPT</div>Morodok Techo<br/>Phnom Penh</div>
        </div>
        <div class="absolute inset-x-0 bottom-0 h-1" style="background:linear-gradient(90deg,#ff2bd6,#8b5cff,#00f0ff)"></div>
      </header>
      <div class="px-5 py-4 flex flex-col gap-4">
        <div class="flex items-center justify-between gap-2">
          <div class="flex flex-wrap gap-1.5">
            <span class="rounded-full bg-[#12b76a] text-white text-xs font-bold px-3 py-1">✓ PAID</span>
            <span class="r-test hidden rounded-full bg-[#fff3c4] text-[#8a6100] text-[10px] font-bold px-2.5 py-1 tracking-wide">TEST · NO CHARGE</span>
          </div>
          <span class="r-total-top font-display text-3xl leading-none"></span>
        </div>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div><dt class="text-[10px] font-semibold tracking-[.16em] text-[#6b6478]">RECEIPT NO.</dt><dd class="r-number font-semibold font-mono text-[13px] break-all"></dd></div>
          <div><dt class="text-[10px] font-semibold tracking-[.16em] text-[#6b6478]">DATE PAID</dt><dd class="r-date font-semibold"></dd></div>
          <div><dt class="text-[10px] font-semibold tracking-[.16em] text-[#6b6478]">PAYMENT METHOD</dt><dd class="r-method font-semibold"></dd></div>
          <div><dt class="text-[10px] font-semibold tracking-[.16em] text-[#6b6478]">BILLED TO</dt><dd class="r-buyer font-semibold break-words"></dd><dd class="r-contact text-xs text-[#6b6478] break-words"></dd></div>
        </dl>
        <table class="w-full text-sm border-y border-[#e6e1ee]">
          <thead><tr class="text-[10px] tracking-[.16em] text-[#6b6478]"><th class="text-left font-semibold py-2">DESCRIPTION</th><th class="text-right font-semibold py-2">QTY</th><th class="text-right font-semibold py-2">AMOUNT</th></tr></thead>
          <tbody><tr class="align-top"><td class="py-2 pr-2"><div class="r-item font-semibold"></div><div class="r-each text-xs text-[#6b6478]"></div></td><td class="r-qty text-right py-2 font-semibold"></td><td class="r-amount text-right py-2 font-semibold"></td></tr></tbody>
        </table>
        <div class="flex items-baseline justify-end gap-4 -mt-2"><span class="text-xs font-bold tracking-[.16em] text-[#6b6478]">TOTAL PAID</span><span class="r-total text-xl font-bold"></span></div>
      </div>
      <div class="relative h-0 border-t-2 border-dashed border-[#c9c1d6] mx-3">
        <span class="absolute -left-[22px] -top-3 size-6 rounded-full bg-[#0b0614]"></span><span class="absolute -right-[22px] -top-3 size-6 rounded-full bg-[#0b0614]"></span>
      </div>
      <div class="px-5 py-5 grid grid-cols-[auto_1fr] gap-4 items-center">
        <div class="rounded-xl p-1.5 border-4" style="border-color:${tier.color}"><img class="r-qr block size-36 sm:size-40 [image-rendering:pixelated]" alt="Ticket access QR code"/></div>
        <div class="min-w-0 flex flex-col gap-1.5">
          <div class="text-[10px] font-semibold tracking-[.16em] text-[#6b6478]">YOUR TICKET</div>
          <span class="r-tier self-start rounded-full px-3 py-1 text-[11px] font-bold tracking-[.14em] text-[#10051c]" style="background:${tier.color}"></span>
          <div class="r-attendee font-semibold break-words"></div>
          <div class="r-code font-mono font-bold text-lg tracking-[.12em]"></div>
          <div class="text-[11px] text-[#6b6478] leading-snug">Admits 1 person. At E-Rave Cambodia, choose <b class="text-[#17121f]">Enter your ticket</b> and scan this QR.</div>
        </div>
      </div>
      <footer class="px-5 py-3 bg-[#f6f3fa] text-[11px] text-[#6b6478] text-center">Keep this receipt. The QR is your ticket: don't share it.</footer>
    </article>`);
  const set = (sel, v) => (node.querySelector(sel).textContent = v);
  set('.r-total-top', money(rc.item.total, rc.currency));
  set('.r-number', rc.number);
  set('.r-date', paidOn(rc.paidAt));
  set('.r-method', rc.method);
  set('.r-buyer', rc.buyer.name);
  set('.r-contact', [rc.buyer.email, rc.buyer.phone].filter(Boolean).join(' · '));
  set('.r-item', `E-Rave Cambodia 2026 · ${rc.item.description}`);
  set('.r-each', `${money(rc.item.unitPrice, rc.currency)} each`);
  set('.r-qty', String(rc.item.quantity));
  set('.r-amount', money(rc.item.total, rc.currency));
  set('.r-total', money(rc.item.total, rc.currency));
  set('.r-tier', tier.badge);
  set('.r-attendee', rc.ticket.name);
  set('.r-code', rc.ticket.code || '—');
  node.querySelector('.r-qr').src = rc.ticket.qrDataUrl;
  node.querySelector('.r-test').classList.toggle('hidden', !rc.test);
  return node;
}

class TicketsPage {
  constructor(root) {
    this.types = null;
    this.sel = 'general';
    this.order = null;
    this.busy = false;
    this.bd = createBackdrop(root);
    this.bd.node.classList.remove('z-50');
    this.node = el(PAGE);
    this.bd.content.append(this.node);
    renderIcons(this.node);
    this.q = (s) => $(this.node, s);
    this.bind(); // the ticket card (and its prices) loads when PURCHASE is pressed
  }

  bind() {
    const on = (sel, fn) => this.node.querySelectorAll(sel).forEach((b) => b.addEventListener('click', fn));
    on('.open-card', () => this.reveal());
    on('.buy', () => this.buy());
    on('.pay-test', () => this.payTest());
    on('.back', () => this.cancelPay());
    on('.again', () => this.toChoose());
    on('.to-find', () => this.show('find'));
    on('.to-choose', () => this.toChoose());
    on('.retry', () => this.toChoose());
    on('.find', () => this.find(this.q('.f-code').value));
    on('.view-mine', () => this.viewMine());
    on('.dl-receipt', () => this.downloadReceipt());
    on('.print', () => this.print());
    bindCodeInput(this.q('.f-code'), (v) => this.find(v));
    for (const sel of ['.f-name', '.f-email', '.f-phone']) this.q(sel).addEventListener('keydown', (e) => e.key === 'Enter' && this.buy());
  }

  show(view) {
    if (this.view === 'pay' && view !== 'pay') this.stopTimers();
    this.view = view;
    for (const s of this.node.querySelectorAll('[data-view]')) s.classList.toggle('hidden', s.dataset.view !== view);
    for (const e of this.node.querySelectorAll('.err')) e.classList.add('hidden');
    // Just the title and the PURCHASE button to start; any other step (paying, the receipt, an
    // error) opens the card straight away.
    if (view !== 'choose' || this.open) this.reveal();
    const step = view === 'find' || view === 'offline' ? 'choose' : view;
    const order = STEPS.findIndex(([id]) => id === step);
    this.node.querySelectorAll('[data-step]').forEach((li, i) => {
      li.style.cssText = i === order ? 'border-color:#00f0ff;color:#00f0ff;box-shadow:0 0 14px rgba(0,240,255,.35)' : i < order ? 'border-color:rgba(157,255,0,.5);color:#9dff00' : '';
    });
    if (view === 'pay') this.startTimers();
    this.settled = true;
  }

  /** Open the card under the title: the PURCHASE button and its note give way to it. */
  reveal() {
    const card = this.q('.card');
    const first = card.classList.contains('hidden');
    card.classList.remove('hidden');
    this.node.querySelectorAll('.cta').forEach((n) => n.classList.add('hidden'));
    this.q('.steps').classList.remove('hidden');
    // One header block (the crest, the title over it), the card below it in the flow.
    this.node.classList.add('hero-compact');
    this.bd.node.classList.add('bd-compact');
    this.open = true;
    if (first && this.view !== 'choose') this.toChoose();
  }

  fail(text) {
    const e = this.q(`[data-view="${this.view}"] .err`);
    if (!e) return;
    e.textContent = text;
    e.classList.remove('hidden');
  }

  // ---------------------------------------------------------------- choose
  async toChoose() {
    this.show('choose');
    const mine = loadPass();
    this.q('.have').classList.toggle('hidden', !mine);
    if (mine) this.q('.have-text').textContent = `You have a ${tierOf(mine.type).label} ticket on this device${mine.code ? ` (${mine.code})` : ''}.`;
    if (!this.types) {
      try {
        this.types = await ticketsApi.types();
      } catch {
        return this.show('offline');
      }
    }
    this.renderTypes();
  }

  renderTypes() {
    const t = this.types;
    this.q('.mock-note').classList.toggle('hidden', !t.mock);
    this.q('.buy').disabled = this.busy || !t.configured;
    this.q('.buy').textContent = this.busy ? 'STARTING…' : 'PAY WITH KHQR';
    const box = this.q('.types');
    box.replaceChildren(
      ...t.types.map((x) => {
        const tier = tierOf(x.id);
        const b = el(`
          <button type="button" class="type chip rounded-xl p-4 text-left flex items-start justify-between gap-3" style="--accent:${tier.color}" data-id="${x.id}">
            <span class="flex flex-col gap-1.5"><span class="t-label font-display text-2xl leading-none" style="color:${tier.color}"></span>
              <ul class="t-perks text-[12px] text-white/65 space-y-0.5"></ul></span>
            <span class="t-price font-display text-4xl leading-none"></span>
          </button>`);
        b.querySelector('.t-label').textContent = x.label.toUpperCase();
        b.querySelector('.t-price').textContent = money(x.price, t.currency).replace('.00', '');
        b.querySelector('.t-perks').replaceChildren(...tier.perks.map((p) => Object.assign(document.createElement('li'), { textContent: `✓ ${p}` })));
        b.setAttribute('aria-pressed', String(x.id === this.sel));
        b.addEventListener('click', () => {
          this.sel = x.id;
          this.renderTypes();
        });
        return b;
      }),
    );
    const price = t.types.find((x) => x.id === this.sel)?.price;
    this.q('.total').textContent = money(price, t.currency);
    if (!t.configured) this.fail("Tickets aren't on sale yet.");
  }

  async buy() {
    if (this.busy || !this.types?.configured || this.view !== 'choose') return;
    const name = this.q('.f-name').value.trim();
    if (!name) {
      this.q('.f-name').focus();
      return this.fail('Who is the ticket for? Enter the name to put on it.');
    }
    this.buyer = { name, email: this.q('.f-email').value.trim(), phone: this.q('.f-phone').value.trim() };
    this.busy = true;
    this.renderTypes();
    try {
      const o = await ticketsApi.createOrder(this.sel, this.buyer);
      this.order = o;
      this.endsAt = Date.now() + o.expiresInMs;
      this.q('.qr').src = o.qrImage;
      this.q('.p-tier').textContent = tierOf(o.ticketType).badge;
      this.q('.p-amount').textContent = money(o.amount, o.currency);
      const link = this.q('.deeplink');
      const real = o.abapayDeeplink && !o.abapayDeeplink.startsWith('mock:');
      link.classList.toggle('hidden', !real);
      if (real) link.href = o.abapayDeeplink;
      this.q('.pay-test').classList.toggle('hidden', !this.types.mock);
      this.q('.qr-dead').classList.add('hidden');
      this.q('.back').textContent = 'Cancel';
      this.setStatus('Waiting for payment…', 'wait');
      this.busy = false;
      this.renderTypes();
      this.show('pay');
    } catch (err) {
      this.busy = false;
      this.renderTypes();
      this.fail(err.status === 429 ? 'Too many attempts: wait a few minutes and try again.' : err.status === 503 ? "Tickets aren't available right now: try again shortly." : err.message || 'Could not start the order.');
    }
  }

  // ---------------------------------------------------------------- pay
  setStatus(text, tone) {
    this.q('.status-text').textContent = text;
    this.q('.status-dot').style.background = tone === 'bad' ? '#ff2d55' : '#ffc400';
  }

  startTimers() {
    this.stopTimers();
    this.tickCountdown();
    this.clock = setInterval(() => this.tickCountdown(), 250);
    const poll = async () => {
      const id = this.order?.tranId;
      if (this.view !== 'pay' || !id) return;
      try {
        this.handle(await ticketsApi.poll(id), id);
      } catch {
        /* the server hiccuped: the next poll tries again */
      }
      if (this.view === 'pay' && this.order?.tranId === id && this.order.status === 'PENDING') this.pollTimer = setTimeout(poll, POLL_MS);
    };
    this.pollTimer = setTimeout(poll, 800);
  }

  stopTimers() {
    clearInterval(this.clock);
    clearTimeout(this.pollTimer);
    this.clock = this.pollTimer = null;
  }

  tickCountdown() {
    const left = this.endsAt - Date.now();
    const c = this.q('.countdown');
    c.textContent = mmss(left);
    c.style.color = left < 60_000 ? '#ff6b8a' : '';
    if (left <= 0 && this.order?.status === 'PENDING') this.setStatus("Time's up: checking once more…", 'bad');
  }

  handle(o, id = o.tranId) {
    if (!this.order || this.order.tranId !== id) return;
    this.order.status = o.status;
    if (o.status === 'PAID' && o.ticket) return this.paid(o);
    if (o.status === 'EXPIRED' || o.status === 'FAILED') {
      this.stopTimers();
      const dead = this.q('.qr-dead');
      dead.textContent = o.status === 'EXPIRED' ? 'This QR has expired.' : "This payment didn't go through.";
      dead.classList.remove('hidden');
      this.q('.pay-test').classList.add('hidden');
      this.setStatus(o.status === 'EXPIRED' ? 'Expired: nothing was charged.' : 'The payment failed.', 'bad');
      this.q('.back').textContent = 'Start again';
    }
  }

  async payTest() {
    const btn = this.q('.pay-test');
    btn.disabled = true;
    try {
      this.handle(await ticketsApi.mockPay(this.order.tranId));
    } catch (err) {
      this.fail(err.message || 'Test payment failed.');
    }
    btn.disabled = false;
  }

  cancelPay() {
    this.stopTimers();
    this.order = null;
    this.toChoose();
  }

  // ---------------------------------------------------------------- receipt
  paid(o) {
    this.stopTimers();
    this.order = null;
    savePass(passFrom(o, this.buyer?.name)); // the entrance on this device recognises it at once
    this.showReceipt(receiptFrom(o, this.buyer), { title: 'PAYMENT RECEIVED', sub: "Here's your receipt. Your ticket's QR is attached.", party: true });
  }

  showReceipt(rc, { title, sub, party = false }) {
    this.receipt = rc;
    this.receiptPngUrl = null;
    const sec = this.q('[data-view="receipt"]');
    sec.querySelector('.r-title').textContent = title;
    sec.querySelector('.r-sub').textContent = sub;
    const card = receiptCard(rc);
    sec.querySelector('.slot').replaceChildren(card);
    const qr = sec.querySelector('.dl-qr');
    qr.href = rc.ticket.qrDataUrl;
    qr.download = `e-rave-ticket-qr-${(rc.ticket.code || rc.number).replace(/-/g, '')}.png`;
    this.show('receipt');
    card.classList.add('pass-unlock');
    sec.querySelector('.r-title').classList.add('granted');
    if (party && !calm()) {
      const r = card.getBoundingClientRect();
      burst(this.bd.node, r.left + r.width / 2, r.top + 120, ['#ff2bd6', '#00f0ff', '#9dff00', tierOf(rc.ticket.type).color, '#ffffff']);
    }
  }

  async receiptImage() {
    this.receiptPngUrl ||= await receiptPng(this.receipt);
    return this.receiptPngUrl;
  }

  async downloadReceipt() {
    const btn = this.q('.dl-receipt');
    btn.disabled = true;
    try {
      const a = document.createElement('a');
      a.href = await this.receiptImage();
      a.download = `e-rave-receipt-${this.receipt.number}.png`;
      a.click();
    } finally {
      btn.disabled = false;
    }
  }

  async print() {
    const btn = this.q('.print');
    btn.disabled = true;
    try {
      printImage(await this.receiptImage(), `E-Rave receipt ${this.receipt.number}`);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------- find
  async find(input) {
    const raw = String(input || '').trim();
    if (!raw) return this.fail('Type the ticket code from your receipt.');
    const btn = this.q('.find');
    btn.disabled = true;
    try {
      const o = await ticketsApi.redeem(raw);
      savePass(passFrom(o));
      this.showReceipt(receiptFrom(o), { title: 'YOUR RECEIPT', sub: 'Found it. Your ticket is on this device now too.' });
    } catch (err) {
      this.fail(err.status === 429 ? 'Too many tries: wait a few minutes and try again.' : err.status ? err.message : "The box office can't be reached right now.");
    }
    btn.disabled = false;
  }

  /** The receipt of the ticket saved on this device. */
  async viewMine() {
    const mine = loadPass();
    if (!mine) return;
    try {
      const o = mine.tranId ? await ticketsApi.poll(mine.tranId) : await ticketsApi.redeem(mine.token);
      if (o.status !== 'PAID' || !o.ticket) throw new Error('not paid');
      this.showReceipt(receiptFrom(o), { title: 'YOUR RECEIPT', sub: 'The ticket on this device.' });
    } catch {
      this.fail("Couldn't load that receipt. Try finding it by its ticket code.");
    }
  }
}

document.fonts.load('48px Koulen', 'E-RAVE').finally(() => new TicketsPage(document.getElementById('ui')));
