// Your E-Rave ticket as this browser keeps it, shared by the tickets page (tickets/) and the
// entrance (ui/gate.js). Only ever trusted after the server has verified it.

import { load, save } from './store.js';

const KEY = 'erave.ticket';

export const TIER = {
  general: { label: 'General admission', badge: 'GENERAL ADMISSION', color: '#00f0ff', perks: ['A seat in the stands', 'The dance floor', 'Every show and DJ set'] },
  vip: { label: 'VIP', badge: 'VIP', color: '#ffc400', perks: ['Arrive on the VIP deck', 'VIP-only decks', 'A gold VIP name tag'] },
};
export const tierOf = (t) => TIER[t] || TIER.general;

export const money = (n, cur = 'USD') => (n == null ? '—' : cur === 'USD' ? `$${Number(n).toFixed(2)}` : `${Math.round(n).toLocaleString()} ${cur}`);

/** The pass saved in this browser (not yet verified), or null. */
export function loadPass() {
  const p = load(KEY, null);
  return p && typeof p.token === 'string' ? p : null;
}
export const savePass = (p) => save(KEY, p);
export const clearPass = () => save(KEY, null);

/** A ticket-code field that formats itself as you type (XXXX-XXXX-XXXX); Enter calls `onSubmit(value)`. */
export function bindCodeInput(input, onSubmit) {
  input.addEventListener('input', () => {
    const raw = input.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 12);
    input.value = raw.replace(/(.{4})(?=.)/g, '$1-');
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && onSubmit(input.value));
}

/** A pass from a paid order (the poll's PAID answer, or a redeemed code). */
export function passFrom(o, name) {
  const t = o.ticket;
  return {
    id: t.id, tranId: o.tranId, type: t.type, token: t.token, qrDataUrl: t.qrDataUrl, code: t.code || null,
    name: t.name || name || 'Raver', amount: o.amount ?? null, currency: o.currency || 'USD', paidAt: t.paidAt || Date.now(),
    test: !!t.test, verifiedAt: Date.now(),
  };
}
