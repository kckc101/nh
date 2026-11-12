// DJ strobe / beat-blackout lighting controller.
//
// Owns every global light source while the DJ has strobe lighting on:
//   • normal — hands everything back to the usual festival lighting (and restores what it touched)
//   • dark   — total pitch black: lights at 0, scene.background / fog / clear colour #000, and the
//              frame is not drawn at all (the canvas is cleared to black). That's the only way to
//              guarantee black — the neon, LED wall and signs are unlit materials — and it costs
//              nothing on the GPU.
//   • flash  — hyper-bright white strobe for `flashMs` (50–100 ms), then straight back to dark.
//
// Flashes are quantized to the room's beat clock (phase-locked to the detected kick, falling back
// to the track / DJ BPM, 128 by default): a flash fires each time the beat position crosses a
// subdivision line — every bar, beat or 1/8 — so the strobe lands on the music. The 60000 / BPM
// interval comes from the beat clock itself rather than a separate timer, so it never drifts.
//
// Nothing is allocated per flash: the controller only writes numbers into existing lights,
// uniforms and colours. It runs in two places in World.frame():
//   pre(M, mood)  after the FX director, before the visual systems — takes over the shared mood
//                 (lasers, beams, laser sheet off) so nothing fades in on its own;
//   post()        after the systems, just before rendering — sets the real lights and says
//                 whether to draw ('normal' | 'flash') or clear to black ('dark').

import * as THREE from 'three';
import { LIGHT_DEFAULTS, LIGHT_RATES, cleanLight } from '../../shared/lighting.js';
import { settings } from '../core/device.js';
import { avatarUniforms } from '../avatar/builder.js';

const WHITE = new THREE.Color(1, 1, 1);
const BLACK = new THREE.Color(0, 0, 0);
const HAZE = new THREE.Color(0.16, 0.16, 0.18); // the air lit up by a strobe
// Photosensitivity: with "Reduce flashing lights" on, flashes are dimmer, never white-out the
// screen and are spaced at least this far apart (≤ 2 per second).
const SAFE_GAP_MS = 500;

export class LightingController {
  constructor(world) {
    this.w = world;
    this.state = { ...LIGHT_DEFAULTS };
    this.look = 'normal';
    this.flashUntil = 0;
    this.lastFlash = -Infinity;
    this.lastSlot = null;
    this.pending = false; // a flash that hasn't been drawn yet (so even slow frames show it)
    this.frameMs = 16.7;
    this.lastNow = 0;
    this.overlay = 0; // white screen overlay strength for the current frame (main.js)
    this.touched = false;
  }

  /** Apply a (partial) lighting state, e.g. from the DJ or the server. */
  set(update) {
    const prev = this.state;
    this.state = cleanLight(update, prev);
    if (this.state.hold && !prev.hold) this.flash(performance.now()); // press = instant flash
    if (!this.strobing) this.lastSlot = null;
    return this.state;
  }

  /** True while the strobe owns the lights (any mode but normal, or the flash button held). */
  get active() {
    return this.state.mode !== 'normal' || this.state.hold;
  }

  get strobing() {
    return this.state.mode === 'auto' || this.state.hold;
  }

  flash(now) {
    if (settings.reduceFlash && now - this.lastFlash < SAFE_GAP_MS) return;
    this.lastFlash = now;
    this.flashUntil = now + this.state.flashMs;
    this.pending = true;
  }

  /** After FXDirector.update, before the visual systems read the mood. */
  pre(M, mood) {
    if (!this.active) {
      this.look = 'normal';
      return;
    }
    const now = performance.now();
    // Typical frame length, so flash length can be rounded to whole frames rather than overshoot.
    if (this.lastNow) this.frameMs += (Math.min(100, now - this.lastNow) - this.frameMs) * 0.1;
    this.lastNow = now;
    if (this.strobing) {
      // Beat-quantized pulse: one flash per subdivision of the beat clock.
      const slot = Math.floor((M.beatCount + M.phase) * LIGHT_RATES[this.state.rate]);
      if (this.lastSlot !== null && slot !== this.lastSlot) this.flash(now);
      this.lastSlot = slot;
    } else {
      this.lastSlot = null;
    }
    // Lit while more than half a frame of the flash remains: a 70 ms flash shows for ~70 ms.
    this.look = this.flashUntil - now > this.frameMs / 2 || this.pending ? 'flash' : 'dark';
    // The strobe is a white flood: no coloured beams, lasers or laser sheet, no FX strobe.
    mood.lights = 0;
    mood.lasers = 0;
    mood.sky = 0;
    mood.sheet = 0;
    mood.strobe = 0;
    mood.strobePattern = null;
    mood.blinder = this.look === 'flash' ? 1 : 0; // blinder pods punch with the flash
    mood.flash = this.look === 'flash' ? 1 : 0; // floor wash
    mood.floorDim = 1;
  }

  /**
   * After the visual systems, right before rendering. Returns 'normal', 'flash' or 'dark'
   * ('dark' = don't draw; clear to black).
   */
  post() {
    const w = this.w;
    const scene = w.scene;
    this.overlay = 0;
    if (this.look === 'normal') {
      if (this.touched) this.restore();
      return 'normal';
    }
    this.touched = true;
    if (this.look === 'dark') {
      scene.background.copy(BLACK);
      scene.fog.color.copy(BLACK);
      w.hemi.intensity = w.rimA.intensity = w.rimB.intensity = w.front.intensity = 0;
      w.bottles.spot.intensity = 0;
      avatarUniforms.uGlowBoost.value = 0;
      return 'dark';
    }
    // Flash: everything snaps to a hard white strobe for this frame.
    const safe = settings.reduceFlash;
    const k = safe ? 0.4 : 1;
    scene.background.copy(HAZE).multiplyScalar(k);
    scene.fog.color.copy(HAZE).multiplyScalar(k);
    w.hemi.color.copy(WHITE);
    w.hemi.groundColor.copy(WHITE);
    w.hemi.intensity = 4.2 * k;
    w.front.color.copy(WHITE);
    w.front.intensity = 6 * k;
    w.rimA.color.copy(WHITE);
    w.rimB.color.copy(WHITE);
    w.rimA.intensity = w.rimB.intensity = 2.5 * k;
    avatarUniforms.uGlowBoost.value = 2.5 * k;
    if (w.bloom) w.bloom.strength = safe ? 0.5 : 1.2;
    this.overlay = safe ? 0 : 0.22;
    this.pending = false; // this flash has now been drawn
    return 'flash';
  }

  /** Back to the festival look. Nothing to put back: the lights, the background and fog colours
   *  (with Arena Blackout), bloom and avatar glow are all recomputed every frame (World.frame). */
  restore() {
    this.touched = false;
  }
}
