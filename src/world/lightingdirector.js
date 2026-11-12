// Lighting cues (LightingDirector): the big festival moments on top of the FX director's mood.
//
//   triggerDrop()       the room drops to almost no ambient light (0.05), the blinders punch
//                       white on the next four beats, the cryo jets fire, the mainstage laser
//                       array and the laser show go to full power: SkyFan and CrowdSlice by
//                       turns every 4 bars, a StrobeBlink fill on the last beat of every 8.
//   triggerBreakdown()  the lasers sink to a slow, faint low sweep, the room and the whole rig
//                       go to deep purples and blues, and the haze thickens and drifts slowly.
//   blackout(beats)     a stage blackout. On synth tracks the last beat of every build is one
//                       (the arrangement is known), so the drop lands out of the dark.
//   release()           back to the show (what the music's section says).
//
// The music drives it: an arrangement section (FXDirector.onSection) picks the look, a drop
// section or an energy surge on any other track fires the hit (with auto-FX on). The DJ fires
// DROP / BREAKDOWN from the FX pad for everyone (the server's `fx`); a DJ cue holds its look
// (16 bars for a drop, 8 for a breakdown) before the music takes back over. The looks blend
// (in fast for a drop, slowly for a breakdown). A VIP show overrides it; "Reduce flashing
// lights" caps the blinder hits and slows StrobeBlink. It writes only to the mood, the laser
// rig and the FX palette; World turns `mood.ambient` / `ambientTint` into the hemisphere and
// rim lights, the rig turns `blinderWhite` into white blinders, the atmosphere turns `haze` and
// `fogFlow` into the haze. Nothing is allocated per frame.

import * as THREE from 'three';
import { settings } from '../core/device.js';

export const LOOKS = ['show', 'drop', 'breakdown'];
/** The breakdown's palette: deep violet, cobalt, blue-violet. */
const DEEP = ['#5b1cff', '#1d3dff', '#9b30ff'].map((c) => new THREE.Color(c));
/** Hemisphere light, base intensity (the "ambient") for each look. */
const AMBIENT = { show: 0.3, drop: 0.05, breakdown: 0.2, blackout: 0.02 };
const HOLD_BARS = { drop: 16, breakdown: 8 };

const lookFor = (section) => (section === 'drop' ? 'drop' : section === 'break' || section === 'break2' ? 'breakdown' : 'show');
const ease = (v, to, rate, dt) => v + (to - v) * Math.min(1, dt * rate);

export class LightingDirector {
  constructor(world) {
    this.w = world;
    this.section = 'groove';
    this.look = 'show';
    this.mix = { drop: 0, breakdown: 0, blackout: 0 };
    this.beat = 0; // the beat clock, last frame (cues are timed in beats)
    this.lookBeat = 0; // when the current look started
    this.holdUntil = -1; // a DJ cue holds its look until this beat
    this.hitBeat = -100; // the last drop hit
    this.blackoutUntil = -1;
    this.pending = null; // a cue waiting for the next frame's beat clock: { look, hold, hit, blackout }
  }

  get held() {
    return this.holdUntil > this.beat || !!this.pending?.hold;
  }

  // ---------------------------------------------------------------- cues
  /** The drop: dark room, white blinder hits, cryo, full lasers. */
  triggerDrop({ hit = true, holdBars = HOLD_BARS.drop } = {}) {
    this.cue({ look: 'drop', hold: holdBars, hit });
  }

  /** The breakdown: lasers down, deep purple / blue, slow thick haze. */
  triggerBreakdown({ holdBars = HOLD_BARS.breakdown } = {}) {
    this.cue({ look: 'breakdown', hold: holdBars });
  }

  /** A stage blackout for `beats` beats (a drop or a section change ends it sooner). */
  blackout(beats = 1) {
    this.cue({ blackout: beats });
  }

  /** Back to the show: whatever the music's section says. */
  release() {
    this.holdUntil = -1;
    this.cue({ look: lookFor(this.section) });
  }

  cue(c) {
    const p = (this.pending ||= {});
    if (c.look) p.look = c.look;
    if (c.hold) p.hold = c.hold;
    if (c.blackout) p.blackout = c.blackout;
    if (c.hit) {
      p.hit = true;
      this.fireHit();
    }
  }

  /** The hit's instant part (the cryo); the blinders and lasers start on the next frame's beat. */
  fireHit() {
    this.w.cryo?.burst({ pattern: 'all', power: 1.1 });
    this.blackoutUntil = -1;
  }

  // ---------------------------------------------------------------- the music
  /** An arrangement section began (FXDirector.onSection). `immediate`: a catch-up, no hit. */
  onSection(name, bar, immediate) {
    this.section = name;
    this.blackoutUntil = -1;
    if (this.held) return;
    const look = lookFor(name);
    this.cue({ look, hit: look === 'drop' && !immediate && settings.autoFx });
  }

  /** An energy jump on a track that isn't the built-in synth: the drop hit (its look follows the energy). */
  onSurge() {
    if (settings.autoFx) this.cue({ hit: true });
  }

  // ---------------------------------------------------------------- per frame
  /** After the FX director's update, before the DJ strobe: shapes `mood` and runs the laser rig. */
  update(dt, t, M, mood) {
    const beat = M.beatCount + M.phase;
    this.beat = beat;
    const p = this.pending;
    if (p) {
      this.pending = null;
      if (p.look && p.look !== this.look) {
        this.look = p.look;
        this.lookBeat = beat;
      }
      if (p.hold) this.holdUntil = beat + p.hold * 4;
      if (p.hit) {
        this.hitBeat = beat;
        if (this.look !== 'drop' && !p.look) this.lookBeat = beat; // a surge: phrase from here
      }
      if (p.blackout) this.blackoutUntil = beat + p.blackout;
    }
    if (this.holdUntil > 0 && beat >= this.holdUntil) {
      // The DJ's cue has run its course: the music has the lights again.
      this.holdUntil = -1;
      const look = lookFor(this.section);
      if (look !== this.look) {
        this.look = look;
        this.lookBeat = beat;
      }
    }

    const fx = this.w.fx;
    const vip = fx.vipLevel || 0;
    const live = 1 - vip;
    // Synth tracks: the last beat of a build goes black, and the drop lands out of the dark.
    const preDrop = fx.mode === 'synth' && this.section === 'build' && !this.held && settings.autoFx && M.playing && M.beatCount % 32 >= 31;
    const dark = (preDrop || beat < this.blackoutUntil) && !vip;
    const mx = this.mix;
    mx.drop = ease(mx.drop, this.look === 'drop' ? 1 : 0, this.look === 'drop' ? 10 : 1.5, dt);
    mx.breakdown = ease(mx.breakdown, this.look === 'breakdown' ? 1 : 0, this.look === 'drop' ? 6 : 0.9, dt);
    mx.blackout = dark ? 1 : ease(mx.blackout, 0, 12, dt);
    const d = mx.drop * live;
    const b = mx.breakdown * live * (1 - mx.drop); // a drop takes over a fading breakdown at once
    const k = mx.blackout;
    const dl = fx.blackoutUntil > fx.time ? 0 : d; // the DJ's Blackout Strobe pad keeps the lasers off

    // The room: ambient (the hemisphere light) and its tint; the palette in a breakdown.
    let ambient = AMBIENT.show + (AMBIENT.drop - AMBIENT.show) * d;
    ambient += (AMBIENT.breakdown - ambient) * b;
    ambient += (AMBIENT.blackout - ambient) * k;
    mood.ambient = ambient;
    mood.ambientTint = b;
    fx.paletteOverride = this.look === 'breakdown' && !vip ? DEEP : null;

    // Lasers: full power in a drop, sunk low in a breakdown, none in a blackout.
    mood.lasers += (1 - mood.lasers) * dl;
    mood.lasers *= (1 - 0.65 * b) * (1 - k);

    // The drop hit: the blinders punch white on the next four beats (once, softly, with Reduce flashing).
    const hb = beat - this.hitBeat;
    let pulse = 0;
    if (hb >= 0 && hb < 4 && !vip) {
      pulse = (hb < 1 ? 1 : 0.75) * Math.exp(-(hb % 1) * 9);
      if (settings.reduceFlash) pulse = hb < 1 ? pulse * 0.25 : 0;
    }
    mood.blinder = Math.max(mood.blinder, pulse);
    mood.blinderWhite = Math.max(d, pulse > 0.02 ? 1 : 0);
    mood.flash = Math.min(1, mood.flash + pulse * 0.35);

    // The haze: thicker and drifting slowly in a breakdown.
    mood.haze = 1 + 0.9 * b + 0.2 * d;
    mood.fogFlow = 1 - 0.65 * b;

    // Blackout: everything down but the dimmest glow.
    if (k > 0.001) {
      const o = 1 - k;
      mood.lights *= o;
      mood.sky *= o;
      mood.sheet *= o;
      mood.strobe *= o;
      mood.flash *= o;
      mood.blinder *= o;
      mood.ledDim += (0.04 - mood.ledDim) * k;
      mood.floorDim += (0.1 - mood.floorDim) * k;
      if (k > 0.5) mood.strobePattern = null;
    }

    this.runLasers(M, beat, dl, b, k, live);
  }

  /** The mainstage laser array's look and level. */
  runLasers(M, beat, d, b, k, live) {
    const rig = this.w.laserRig;
    if (!rig) return;
    const fx = this.w.fx;
    let level = 0;
    let preset = rig.preset;
    let sweep = 1;
    const storm = fx.stormUntil > fx.time || fx.hypeUntil > fx.time;
    if (d > 0.02) {
      // The drop: SkyFan and CrowdSlice by turns every 4 bars, a StrobeBlink fill on the last beat of every 8.
      const sb = beat - this.lookBeat;
      preset = sb % 32 >= 31 ? 'StrobeBlink' : Math.floor(sb / 16) % 2 ? 'CrowdSlice' : 'SkyFan';
      level = d;
    } else if (storm) {
      preset = Math.floor(beat / 4) % 2 ? 'StrobeBlink' : 'SkyFan';
      level = 1;
    } else if (b > 0.02) {
      // The breakdown: a faint, slow, low sweep.
      preset = 'CrowdSlice';
      level = 0.16 * b;
      sweep = 1 - 0.65 * b;
    } else if (this.section === 'build') {
      // Rising through the build, saving the full rig for the drop.
      preset = 'SkyFan';
      level = 0.12 + 0.3 * ((M.beatCount % 32) / 32);
      sweep = 0.6;
    }
    rig.sweepMul = sweep;
    rig.setPreset(preset);
    rig.setLevel(level * live * (1 - k) * (M.playing ? 1 : 0.3));
  }
}
