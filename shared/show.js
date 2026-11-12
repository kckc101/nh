// The laser show's MAIN DROP choreography (DJ mode): five phases on the beat, shared by the server
// (the authoritative state) and the clients (the choreography engine, world/lasershow.js, and the
// DJ panel). Keep this file identical in both repos, like dj.js.
//
// State: { mode, phase, t0 }
//   mode   'off' | 'auto' (the phases run from `phase` to the end, then the normal show is back) |
//          'loop' (`phase` repeats until the next command) | 'blackout' (stage black for a moment)
//   phase  0–4, SHOW_PHASES
//   t0     when it starts, in ms on the shared (server) clock: always on a beat of the track playing
//          (the next one after the DJ pressed), so every client starts it on the same beat.

export const SHOW_PHASES = [
  { id: 'tease', label: 'TEASE', beats: 16 },
  { id: 'blinder', label: 'BLINDER', beats: 4 },
  { id: 'drop', label: 'LASER DROP', beats: 32 },
  { id: 'pyro', label: 'PYRO GATE', beats: 32 },
  { id: 'outro', label: 'OUTRO', beats: 32 },
];
export const SHOW_DEFAULTS = { mode: 'off', phase: 0, t0: 0 };
export const BLACKOUT_BEATS = 2;

/** ms per beat at the deck's tempo (128 BPM if it's unknown). */
export const beatMs = (dj) => 60000 / (dj?.bpm >= 60 && dj?.bpm <= 200 ? dj.bpm : 128);

/** The first beat at or after `now` on the playing track's grid (counted from its start). */
export function nextBeat(dj, now) {
  const b = beatMs(dj);
  const origin = dj?.playing && Number.isFinite(dj.startedAt) ? dj.startedAt : 0;
  return origin + Math.ceil((now - origin - 2) / b) * b; // a press right on a beat takes that beat
}

/**
 * Where a show is at `now`: { mode, phase, beat (beats into the phase), len (its beats), cycle }
 * — or null when there's no show running (off, finished, or the blackout over). Before t0 it's
 * { pending: true }: the previous show carries on until the beat.
 */
export function showAt(s, dj, now) {
  if (!s || s.mode === 'off') return null;
  const beats = (now - s.t0) / beatMs(dj);
  if (beats < 0) return { pending: true };
  if (s.mode === 'blackout') return beats < BLACKOUT_BEATS ? { mode: 'blackout', phase: -1, beat: beats, len: BLACKOUT_BEATS, cycle: 0 } : null;
  if (s.mode === 'loop') {
    const len = SHOW_PHASES[s.phase].beats;
    return { mode: 'loop', phase: s.phase, beat: beats % len, len, cycle: Math.floor(beats / len) };
  }
  let rest = beats;
  for (let i = s.phase; i < SHOW_PHASES.length; i++) {
    const len = SHOW_PHASES[i].beats;
    if (rest < len) return { mode: 'auto', phase: i, beat: rest, len, cycle: 0 };
    rest -= len;
  }
  return null; // the sequence has played out
}

/**
 * Apply a DJ command to the state. `cmd`: { action: 'auto' | 'phase' | 'blackout' | 'stop', phase }.
 * 'phase' during a running auto sequence jumps it there (and it carries on); otherwise it loops.
 * `dj` is the deck's state (bpm, startedAt, playing) for the beat grid.
 */
export function cleanShow(cmd, prev = SHOW_DEFAULTS, dj = null, now = Date.now()) {
  const c = cmd && typeof cmd === 'object' ? cmd : {};
  const t0 = nextBeat(dj, now);
  switch (c.action) {
    case 'auto':
      return { mode: 'auto', phase: 0, t0 };
    case 'blackout':
      return { mode: 'blackout', phase: 0, t0 };
    case 'stop':
      return { ...SHOW_DEFAULTS };
    case 'phase': {
      const i = Number(c.phase);
      if (!Number.isInteger(i) || i < 0 || i >= SHOW_PHASES.length) return prev;
      const running = showAt(prev, dj, now);
      const auto = prev.mode === 'auto' && (running?.mode === 'auto' || running?.pending);
      return { mode: auto ? 'auto' : 'loop', phase: i, t0 };
    }
    default:
      return prev;
  }
}
