// VIP Bottle Service (Aura Farming) rules shared by the server (authoritative) and the client
// (UI + offline demo). It's free: anyone can order, one order at a time each.
// Keep this file identical in the web client and the server repo, like dj.js.

/** Tiers. Durations are how long the whole presentation runs. */
export const BOTTLE_TIERS = {
  1: { durationMs: 15000, label: 'Standard', perks: ['2 hostesses', 'Spotlights on you', 'Your sign board', 'Airhorn sting'] },
  2: { durationMs: 20000, label: 'Luxury', perks: ['4 hostesses', 'Luxury vine board', 'Cold sparklers', 'DJ shoutout'] },
  3: { durationMs: 26000, label: 'Full Entourage', perks: ['6 hostesses + security', 'Sparklers everywhere', 'Music ducks for your shoutout', 'LED screen takeover'] },
};

export const SIGN_STYLE_IDS = ['cyber', 'gold', 'glitch'];
export const SIGN_MAX = 24;
export const BOTTLE_QUEUE_MAX = 10;
export const BOTTLE_GAP_MS = 2500; // breather between presentations

/**
 * Sign text: plain text only. Tags, HTML-significant characters and control characters are
 * removed, whitespace collapsed, and the result capped at SIGN_MAX characters (emoji count
 * as one).
 */
export function cleanSignText(v) {
  const s = String(v ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[<>&"'`\\]/g, '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(s).slice(0, SIGN_MAX).join('').trim();
}
