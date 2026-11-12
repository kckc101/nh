// DJ strobe / beat-blackout lighting rules, shared by the server (authoritative state) and
// the client (controller + DJ panel). Keep this file identical in both repos, like dj.js.

/**
 * normal — the usual festival lighting
 * auto   — strobe-blackout: pitch black, with a brief white flash on every beat subdivision
 * manual — pitch black until the DJ holds the flash button
 * (Holding the flash button strobes in any mode, for as long as it's held.)
 *
 * arena  — Arena Blackout (a separate switch, any mode): the house lights, sky and the crowd's own
 *          glow go dark while the stage show (moving heads, lasers, LED wall, blinders, pyro)
 *          carries on at full power.
 */
export const LIGHT_MODES = ['normal', 'auto', 'manual'];

/** Flashes per beat: once a bar (on the downbeat), every beat (1/4), every 1/8. */
export const LIGHT_RATES = { bar: 0.25, beat: 1, eighth: 2 };

/** Flash length in ms — the "blink": long enough to see, short enough to read as a strobe. */
export const FLASH_MS = { min: 50, max: 100, default: 70 };

export const LIGHT_DEFAULTS = { mode: 'normal', rate: 'beat', flashMs: FLASH_MS.default, hold: false, arena: false };

/** Merge an (untrusted) partial update into `prev`, keeping only valid values. */
export function cleanLight(update, prev = LIGHT_DEFAULTS) {
  const u = update && typeof update === 'object' ? update : {};
  const ms = Number(u.flashMs);
  return {
    mode: LIGHT_MODES.includes(u.mode) ? u.mode : prev.mode,
    rate: Object.hasOwn(LIGHT_RATES, u.rate) ? u.rate : prev.rate,
    flashMs: Number.isFinite(ms) ? Math.round(Math.min(FLASH_MS.max, Math.max(FLASH_MS.min, ms))) : prev.flashMs,
    hold: typeof u.hold === 'boolean' ? u.hold : prev.hold,
    arena: typeof u.arena === 'boolean' ? u.arena : prev.arena === true,
  };
}
