// Drone camera rules shared by the server (authoritative state) and the client (flight + DJ
// panel). Keep this file identical in both repos, like dj.js.
//
// The flight is a pure function of the shared clock: phase = phase0 + elapsed × speed / lap,
// so every client flies the same path at the same moment without streaming positions.
//
// The broadcast routing lives here too: which of the five cameras each screen shows (the DJ's
// screens — LED wall + booth monitor — and the ravers' — the side towers + picture-in-picture),
// or whether the auto director cuts between them every `cutBeats` beats.

export const DRONE_MODES = ['stadium', 'orbit', 'flythrough', 'crane_shot'];
export const DRONE_SPEEDS = [0.5, 1, 2];
/** Seconds per lap at 1× speed. */
export const DRONE_LAPS = { stadium: 120, orbit: 80, flythrough: 64, crane_shot: 36 };

/** The broadcast cameras (src/world/broadcast.js): stage front, high crowd, behind the DJ, the drone, the pit. */
export const BROADCAST_CAMS = ['stage', 'crowd', 'booth', 'drone', 'pit'];
/** Auto-cut lengths, in beats. */
export const CUT_BEATS = [8, 16, 32];

/** The night opens on the stadium aerial: the whole venue in one shot; the director cutting both screens. */
export const DRONECAM_DEFAULTS = {
  mode: 'stadium', speed: 1, feed: true, t0: 0, phase0: 0,
  djCam: 'drone', raverCam: 'crowd', djAuto: true, raverAuto: true, cutBeats: 16,
};

/** Path position 0..1 (wraps) at shared-clock time `now` (ms). */
export function dronePhase(s, now) {
  const p = s.phase0 + ((now - s.t0) / 1000) * (s.speed / DRONE_LAPS[s.mode]);
  return ((p % 1) + 1) % 1;
}

/**
 * Merge an (untrusted) partial update into `prev` at time `now`. Changing speed keeps the drone
 * where it is on its path (no jump); changing mode starts the new path from the top.
 */
export function cleanDroneCam(update, prev, now) {
  const u = update && typeof update === 'object' ? update : {};
  const mode = DRONE_MODES.includes(u.mode) ? u.mode : prev.mode;
  const speed = DRONE_SPEEDS.includes(Number(u.speed)) ? Number(u.speed) : prev.speed;
  const feed = typeof u.feed === 'boolean' ? u.feed : prev.feed;
  const D = DRONECAM_DEFAULTS;
  const cam = (k) => (BROADCAST_CAMS.includes(u[k]) ? u[k] : BROADCAST_CAMS.includes(prev[k]) ? prev[k] : D[k]);
  const flag = (k) => (typeof u[k] === 'boolean' ? u[k] : typeof prev[k] === 'boolean' ? prev[k] : D[k]);
  const route = {
    djCam: cam('djCam'), raverCam: cam('raverCam'), djAuto: flag('djAuto'), raverAuto: flag('raverAuto'),
    cutBeats: CUT_BEATS.includes(Number(u.cutBeats)) ? Number(u.cutBeats) : CUT_BEATS.includes(prev.cutBeats) ? prev.cutBeats : D.cutBeats,
  };
  if (mode === prev.mode && speed === prev.speed) return { ...prev, feed, ...route };
  return { mode, speed, feed, t0: now, phase0: mode === prev.mode ? dronePhase(prev, now) : 0, ...route };
}
