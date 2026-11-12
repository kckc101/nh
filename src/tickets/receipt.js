// The receipt as one image (PNG): payment details, billed to, the line item and total, and the
// ticket stub with its access QR, on white so it prints and scans well. Downloaded, printed, or
// kept in a phone's photos; the QR on it is what gets you into E-Rave ("Enter your ticket").

import { tierOf, money } from '../core/pass.js';

const W = 1000;
const INK = '#17121f';
const MUTED = '#6b6478';
const LINE = '#e6e1ee';
const DISPLAY = 'Koulen, "Chakra Petch", sans-serif';
const BODY = '"Chakra Petch", "Kantumruy Pro", "Segoe UI", sans-serif';
const MONO = 'ui-monospace, Consolas, "Courier New", monospace';

/** A receipt from a paid order (create + poll, or found by code). */
export function receiptFrom(o, local = {}) {
  const t = o.ticket;
  const r = o.receipt || {};
  const buyer = { name: t.name || local.name || 'Raver', email: local.email || '', phone: local.phone || '', ...r.buyer };
  return {
    number: r.number || o.tranId,
    paidAt: r.paidAt || t.paidAt || Date.now(),
    method: r.method || (t.test ? 'Test payment (mock mode)' : 'ABA PayWay · KHQR'),
    buyer,
    item: r.item || { description: `${tierOf(t.type).label} ticket`, quantity: 1, unitPrice: o.amount, total: o.amount },
    currency: o.currency || 'USD',
    test: !!t.test,
    ticket: { id: t.id, type: t.type, code: t.code, name: buyer.name, qrDataUrl: t.qrDataUrl },
  };
}

export const paidOn = (ms) =>
  new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

function pill(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Draw the receipt; resolves with a PNG data URL. */
export async function receiptPng(rc) {
  await Promise.allSettled([document.fonts.load(`64px ${DISPLAY}`, 'E-RAVE'), document.fonts.load(`600 28px ${BODY}`, 'Receipt')]);
  const qr = await loadImage(rc.ticket.qrDataUrl);
  const H = 1660;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const text = (s, x, y, { font = `500 26px ${BODY}`, color = INK, align = 'left', max } = {}) => {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(s ?? ''), x, y, max);
  };
  const P = 64; // page margin

  // Paper.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Header: the festival, neon on night.
  ctx.fillStyle = '#0b0614';
  ctx.fillRect(0, 0, W, 250);
  const band = ctx.createLinearGradient(0, 0, W, 0);
  band.addColorStop(0, '#ff2bd6');
  band.addColorStop(0.5, '#8b5cff');
  band.addColorStop(1, '#00f0ff');
  ctx.fillStyle = band;
  ctx.fillRect(0, 250, W, 10);
  ctx.shadowColor = '#ff2bd6';
  ctx.shadowBlur = 24;
  text('E-RAVE', P, 150, { font: `120px ${DISPLAY}`, color: '#ffffff' });
  ctx.shadowColor = '#00f0ff';
  ctx.shadowBlur = 16;
  text('CAMBODIA 2026', P + 4, 205, { font: `40px ${DISPLAY}`, color: '#00f0ff' });
  ctx.shadowBlur = 0;
  text('PAYMENT RECEIPT', W - P, 100, { font: `600 26px ${BODY}`, color: '#ffffff', align: 'right' });
  text('Morodok Techo National Stadium', W - P, 140, { font: `500 22px ${BODY}`, color: 'rgba(255,255,255,.7)', align: 'right' });
  text('Phnom Penh, Cambodia', W - P, 172, { font: `500 22px ${BODY}`, color: 'rgba(255,255,255,.7)', align: 'right' });

  // Status.
  let y = 330;
  pill(ctx, P, y - 44, 150, 58, 29, '#12b76a');
  text('✓  PAID', P + 75, y - 4, { font: `700 28px ${BODY}`, color: '#ffffff', align: 'center' });
  if (rc.test) {
    pill(ctx, P + 166, y - 44, 330, 58, 29, '#fff3c4');
    text('TEST PAYMENT · NO CHARGE', P + 331, y - 4, { font: `700 22px ${BODY}`, color: '#8a6100', align: 'center' });
  }
  text(money(rc.item.total, rc.currency), W - P, y, { font: `56px ${DISPLAY}`, align: 'right' });

  // Details.
  const field = (label, value, x, yy, w) => {
    text(label.toUpperCase(), x, yy, { font: `600 18px ${BODY}`, color: MUTED });
    text(value, x, yy + 36, { font: `600 26px ${BODY}`, max: w });
  };
  y += 70;
  const col = W / 2 + 10;
  field('Receipt no.', rc.number, P, y, col - P - 30);
  field('Date paid', paidOn(rc.paidAt), col, y, W - P - col);
  y += 92;
  field('Payment method', rc.method, P, y, col - P - 30);
  field('Billed to', rc.buyer.name, col, y, W - P - col);
  const contact = [rc.buyer.email, rc.buyer.phone].filter(Boolean).join(' · ');
  if (contact) text(contact, col, y + 68, { font: `500 22px ${BODY}`, color: MUTED, max: W - P - col });

  // Line item and total.
  y += 130;
  ctx.fillStyle = LINE;
  ctx.fillRect(P, y, W - 2 * P, 2);
  y += 44;
  text('DESCRIPTION', P, y, { font: `600 18px ${BODY}`, color: MUTED });
  text('QTY', 640, y, { font: `600 18px ${BODY}`, color: MUTED, align: 'right' });
  text('AMOUNT', W - P, y, { font: `600 18px ${BODY}`, color: MUTED, align: 'right' });
  y += 50;
  text(`E-Rave Cambodia 2026 · ${rc.item.description}`, P, y, { font: `600 26px ${BODY}`, max: 520 });
  text(String(rc.item.quantity), 640, y, { font: `600 26px ${BODY}`, align: 'right' });
  text(money(rc.item.total, rc.currency), W - P, y, { font: `600 26px ${BODY}`, align: 'right' });
  y += 34;
  text(`${money(rc.item.unitPrice, rc.currency)} each · admits 1 person`, P, y, { font: `500 20px ${BODY}`, color: MUTED });
  y += 34;
  ctx.fillStyle = LINE;
  ctx.fillRect(P, y, W - 2 * P, 2);
  y += 52;
  text('TOTAL PAID', 640, y, { font: `700 22px ${BODY}`, color: MUTED, align: 'right' });
  text(money(rc.item.total, rc.currency), W - P, y, { font: `700 34px ${BODY}`, align: 'right' });

  // Tear line.
  y += 60;
  ctx.setLineDash([14, 12]);
  ctx.strokeStyle = '#c9c1d6';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(P - 20, y);
  ctx.lineTo(W - P + 20, y);
  ctx.stroke();
  ctx.setLineDash([]);
  text('✂', P - 34, y + 9, { font: `26px ${BODY}`, color: '#c9c1d6' });

  // The ticket stub: QR on the left, who and what on the right.
  y += 50;
  const tier = tierOf(rc.ticket.type);
  const qs = 400;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = tier.color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(P, y, qs + 40, qs + 40, 24);
  ctx.stroke();
  ctx.imageSmoothingEnabled = false; // crisp modules scan best
  ctx.drawImage(qr, P + 20, y + 20, qs, qs);
  ctx.imageSmoothingEnabled = true;
  const x = P + qs + 90;
  text('YOUR TICKET', x, y + 34, { font: `600 20px ${BODY}`, color: MUTED });
  ctx.font = `700 24px ${BODY}`;
  const bw = ctx.measureText(tier.badge).width + 44;
  pill(ctx, x, y + 56, bw, 50, 25, tier.color);
  text(tier.badge, x + bw / 2, y + 90, { font: `700 24px ${BODY}`, color: '#10051c', align: 'center' });
  field('Attendee', rc.ticket.name, x, y + 160, W - P - x);
  text('TICKET CODE', x, y + 266, { font: `600 18px ${BODY}`, color: MUTED });
  text(rc.ticket.code || '—', x, y + 312, { font: `700 34px ${MONO}`, max: W - P - x });
  text('Admits 1 person', x, y + 360, { font: `600 22px ${BODY}`, color: MUTED });
  text('At E-Rave Cambodia, choose', x, y + 400, { font: `500 20px ${BODY}`, color: MUTED });
  text('"Enter your ticket" and scan this QR.', x, y + 428, { font: `600 20px ${BODY}`, color: INK, max: W - P - x });

  // Footer.
  y += qs + 110;
  ctx.fillStyle = '#f6f3fa';
  ctx.fillRect(0, y, W, H - y);
  text('Keep this receipt. The QR is your ticket: anyone with it can enter in your place, so don\'t share it.', W / 2, y + 56, { font: `500 21px ${BODY}`, color: MUTED, align: 'center', max: W - 2 * P });
  text('E-Rave Cambodia · Morodok Techo National Stadium, Phnom Penh', W / 2, y + 96, { font: `600 21px ${BODY}`, color: INK, align: 'center' });
  return c.toDataURL('image/png');
}

/** Print an image (the receipt) on its own, through a hidden frame. */
export function printImage(src, title) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.append(f);
  const d = f.contentDocument;
  d.open();
  d.write(`<!doctype html><title>${title}</title><style>@page{margin:12mm}html,body{margin:0}img{width:100%;max-width:180mm;display:block;margin:0 auto}</style><img src="${src}">`);
  d.close();
  const img = d.querySelector('img');
  const go = () => {
    f.contentWindow.focus();
    f.contentWindow.print();
    setTimeout(() => f.remove(), 60_000);
  };
  if (img.complete) go();
  else img.onload = go;
}
