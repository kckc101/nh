// The ticketing endpoints of the multiplayer server (hh: server/routes/tickets.routes.js).

const SERVER = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');

async function call(path, init) {
  const res = await fetch(`${SERVER}/api/tickets${path}`, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Server answered ${res.status}`), { status: res.status, code: json.code });
  return json;
}

const post = (path, body) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const ticketsApi = {
  /** { currency, configured, mock, types: [{ id, label, price }] } */
  types: () => call('/types'),
  /** → { tranId, status, amount, currency, expiresInMs, qrString, qrImage, abapayDeeplink } */
  createOrder: (ticketType, buyer) => post('/create-order', { ticketType, buyer }),
  /** → { tranId, status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED', ticket? } */
  poll: (tranId) => call(`/poll-status/${encodeURIComponent(tranId)}`),
  /** Mock mode only: pay the order as if from the banking app. */
  mockPay: (tranId) => post(`/mock-pay/${encodeURIComponent(tranId)}`),
  /** Is this ticket good for entry? → { valid, ticket: { id, type, code, test } }; throws (status 401) if not. */
  verify: (token) => post('/verify', { token }),
  /** A ticket code (or a scanned token) → the order, with its ticket. Throws (404) if there's none. */
  redeem: (code) => post('/redeem', { code }),
};
