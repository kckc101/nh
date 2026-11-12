// FX director: turns the music (arrangement sections, kicks, energy) and DJ-triggered
// effects into a "mood" that every visual system reads — light level, beam pattern,
// laser mode, strobe, LED program, palette — and fires the pyro / CO2 / confetti emitters.
// The big cues (the drop, the breakdown, blackouts) are the LightingDirector's
// (lightingdirector.js): it hears every section and surge from here, shapes the mood after
// this update, and fires the cryo jets (cryojets.js).

import * as THREE from 'three';
import { KIND } from './particles.js';
import { settings } from '../core/device.js';

// Curated looks, the way an LD builds an exclusive night: [main, second, accent]. Main and second
// alternate across the rig and fill the stands and floor; the accent is the side towers, the LED
// wall's third colour and the crisp strobe hit.
const PALETTES = [
  ['#ff2bd6', '#5a1bff', '#ffa43a'], // Cyber Lotus: electric orchid and deep ultraviolet, a sunset amber
  ['#a6ff00', '#00b86b', '#ffffff'], // Emerald Acid: radioactive lime over jungle emerald, white blinders
  ['#ffc830', '#2d5bff', '#ffffff'], // Liquid Gold & Midnight Chrome: 24K gold against cold cobalt
  ['#00f0ff', '#7b2cff', '#ff2bd6'], // Laser Cyan: icy cyan, violet, a flash of orchid
  ['#ff7a1a', '#ff1f8e', '#7b2cff'], // Neon Sunrise: amber into hot pink and violet
  ['#ff1a2e', '#a3001a', '#ffffff'], // Red Room: kept for the darkest breakdowns
].map((p) => p.map((c) => new THREE.Color(c)));
/** The strobe programme for a drop, a new one every 4 bars (lights.js strobeHit). */
const STROBE_PROGRAMME = ['wave', 'chase', 'split', 'stutter'];

// `sheet` is the laser "liquid sky" over the crowd: strongest in the quiet, floaty sections.
// Mostly dark: slow, sparse light in the grooves and breakdowns, everything saved for the drop.
const MOODS = {
  intro: { lights: 0.25, sky: 0.25, lasers: 0, laserMode: 'tunnel', pattern: 'sweep', speed: 0.4, led: 0, sheet: 0.35 },
  intro2: { lights: 0.35, sky: 0.3, lasers: 0.15, laserMode: 'tunnel', pattern: 'sweep', speed: 0.5, led: 0, sheet: 0.4 },
  groove: { lights: 0.55, sky: 0.25, lasers: 0.35, laserMode: 'fan', pattern: 'fan', speed: 0.6, led: 2, sheet: 0 },
  break: { lights: 0.15, sky: 0.5, lasers: 0.3, laserMode: 'tunnel', pattern: 'center', speed: 0.3, led: 0, sheet: 0.6 },
  build: { lights: 0.45, sky: 0.35, lasers: 0.5, laserMode: 'scan', pattern: 'chase', speed: 1.0, led: 1, sheet: 0.2 },
  drop: { lights: 0.9, sky: 0.7, lasers: 0.85, laserMode: 'fan', pattern: 'sweep', speed: 1.1, led: 4, sheet: 0 }, // led 4: hardcore
  break2: { lights: 0.15, sky: 0.5, lasers: 0.3, laserMode: 'tunnel', pattern: 'center', speed: 0.3, led: 0, sheet: 0.6 },
  outro: { lights: 0.3, sky: 0.25, lasers: 0.1, laserMode: 'tunnel', pattern: 'sweep', speed: 0.5, led: 0, sheet: 0.3 },
};
const DROP_PATTERNS = ['sweep', 'matrix', 'ballyhoo', 'cross', 'fan', 'chase'];
const NEON = ['#00f0ff', '#ff2bd6', '#9dff00', '#ffc400', '#8b5cff', '#ff2d55', '#ffffff'];

const rand = (a, b) => a + Math.random() * (b - a);

export class FXDirector {
  constructor(world) {
    this.w = world;
    this.time = 0;
    this.section = 'groove';
    this.base = { ...MOODS.groove };
    this.mood = { ...MOODS.groove, strobe: 0, ledDim: 1, floorDim: 1, flash: 0, blinder: 0, ambient: 0.3, ambientTint: 0, blinderWhite: 0, haze: 1, fogFlow: 1, bloomBoost: 0, headWhite: 0 };
    this.paletteOverride = null; // the LightingDirector's (a breakdown's deep purples and blues)
    this.mode = 'synth'; // 'synth' → section events drive the show, 'energy' → derived from loudness
    this.paletteIdx = 0;
    this.palette = PALETTES[0].map((c) => c.clone());
    this.emitters = [];
    this.timers = [];
    this.blackoutUntil = 0;
    this.stormUntil = 0;
    this.hypeUntil = 0;
    this.rings = [-100, -100, -100, -100];
    this.ringIdx = 0;
    this.strobeEnv = 0;
    this.flash = 0;
    this.lastBar = -1;
    this.tmp = new THREE.Color();
  }

  setMode(mode) {
    this.mode = mode;
  }

  /** VIP presentation: dim the room and hold back lasers / strobes so the spotlight owns it. */
  setVip(on) {
    this.vipOn = on;
  }

  onSection(name, bar, immediate) {
    if (!MOODS[name]) return;
    this.section = name;
    this.base = { ...MOODS[name] };
    this.w.stage.led.setMode(this.base.led);
    this.nextPalette();
    this.w.director?.onSection(name, bar, immediate); // the look; a drop's hit (cryo, blinders, lasers)
    if (immediate || !settings.autoFx) return;
    if (name === 'drop') {
      // The hit: every head snaps onto one point over the dance floor, then the drop's patterns start.
      this.base.pattern = 'pinpoint';
      this.after(1.6, () => this.section === 'drop' && (this.base.pattern = 'sweep'));
      this.after(0.05, () => this.trigger('confetti'));
      this.after(0.3, () => this.trigger('fireworks'));
      if (bar >= 64) this.trigger('fire');
    }
    if (name === 'break') this.trigger('smoke');
  }

  /** Energy jump on a non-synth track. */
  onSurge() {
    if (this.mode !== 'energy' || !settings.autoFx) return;
    this.w.director?.onSurge(); // the drop hit: cryo, white blinders, the laser array
    this.after(0.1, () => this.trigger('confetti'));
  }

  onKick(strength) {
    this.rings[this.ringIdx] = this.time;
    this.ringIdx = (this.ringIdx + 1) % 4;
    if (this.section === 'drop' || this.hypeUntil > this.time) this.strobeEnv = Math.max(this.strobeEnv, 0.35 + strength * 0.3);
  }

  after(sec, fn) {
    this.timers.push({ at: this.time + sec, fn });
  }

  emitFor(duration, rate, fn) {
    this.emitters.push({ until: this.time + duration, rate: rate * this.w.particleScale, acc: 0, fn });
  }

  /** Particle count scaled by the performance budget. */
  n(count) {
    return Math.max(1, Math.round(count * this.w.particleScale));
  }

  nextPalette() {
    this.paletteIdx = (this.paletteIdx + 1) % PALETTES.length;
  }

  trigger(type) {
    const st = this.w.stage;
    const sparks = this.w.sparks;
    const smoke = this.w.smoke;
    const white = new THREE.Color(0.85, 0.9, 1);
    switch (type) {
      case 'drop': // the DJ calls the drop: the director's hit and look (held 16 bars), and confetti
        this.w.director?.triggerDrop();
        this.after(0.05, () => this.trigger('confetti'));
        break;
      case 'breakdown': // and the breakdown (8 bars), with a low bank of haze rolling off the stage
        this.w.director?.triggerBreakdown();
        this.trigger('smoke');
        break;
      case 'fire':
        for (let pulse = 0; pulse < 3; pulse++) {
          this.after(pulse * 0.38, () => {
            this.flash = Math.max(this.flash, 0.5);
            for (const p of st.flamePoints) {
              this.emitFor(0.3, 420, () =>
                sparks.emit(p.x + rand(-0.3, 0.3), p.y, p.z + rand(-0.3, 0.3), rand(-1.2, 1.2), rand(13, 19), rand(-1.2, 1.2), {
                  color: white, life: rand(0.5, 0.8), size: rand(0.8, 1.4), alpha: 0.85, gravity: -4, drag: 0.6, kind: KIND.FIRE,
                }),
              );
            }
          });
        }
        break;
      case 'co2': // the cryo jets along the barrier (a chase across the stage when it's a hype)
        this.w.cryo?.burst({ pattern: 'all' });
        break;
      case 'smoke': {
        const c = new THREE.Color(0.75, 0.62, 0.95);
        for (let i = 0; i < this.n(160); i++) {
          smoke.emit(rand(-22, 22), rand(2.7, 3.5), rand(-26, -22), rand(-1.5, 1.5), rand(0, 0.3), rand(1.5, 4.5), {
            color: c, life: rand(6, 9), size: rand(5, 9), alpha: 0.2, drag: 0.35, grow: 1.3, kind: KIND.SMOKE,
          });
        }
        break;
      }
      case 'blackout':
        this.blackoutUntil = this.time + 4;
        this.after(4, () => {
          this.trigger('fire');
          this.trigger('co2');
          this.trigger('confetti');
          this.stormUntil = Math.max(this.stormUntil, this.time + 6);
        });
        break;
      case 'lasers':
        this.stormUntil = this.time + 10;
        break;
      case 'confetti':
        this.w.confetti.burst(this.n(480), { x: 0, y: 20, z: 6, w: 64, h: 12, d: 46 }, NEON);
        break;
      case 'fireworks':
        for (let i = 0; i < 6; i++) this.after(i * 0.45 + Math.random() * 0.2, () => this.firework());
        break;
      case 'hype':
        this.hypeUntil = this.time + 8;
        this.trigger('fireworks');
        this.trigger('confetti');
        this.after(0.4, () => this.w.cryo?.burst({ pattern: 'chase' }));
        break;
      default:
        return;
    }
  }

  firework() {
    const sparks = this.w.sparks;
    const x = rand(-28, 28);
    const z = rand(-40, -14);
    const y = rand(28, 42);
    const trail = new THREE.Color(1.6, 1.3, 0.9);
    const start = this.time;
    this.emitFor(0.85, 70, () => {
      const k = Math.min(1, (this.time - start) / 0.85);
      sparks.emit(x + rand(-0.1, 0.1), 3 + (y - 3) * k, z, rand(-0.3, 0.3), rand(-1, 0), rand(-0.3, 0.3), { color: trail, life: 0.5, size: 0.5, alpha: 0.8 });
    });
    this.after(0.85, () => {
      const col = new THREE.Color(NEON[Math.floor(Math.random() * NEON.length)]).multiplyScalar(2.6);
      const v = new THREE.Vector3();
      for (let i = 0; i < this.n(120); i++) {
        v.randomDirection().multiplyScalar(rand(8, 13));
        sparks.emit(x, y, z, v.x, v.y, v.z, { color: col, life: rand(1.3, 2), size: rand(0.6, 0.9), alpha: 1, gravity: -5, drag: 0.9 });
      }
      this.flash = Math.max(this.flash, 0.25);
    });
  }

  update(dt, t, M) {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.timers[i].at <= this.time) {
        const { fn } = this.timers[i];
        this.timers.splice(i, 1);
        fn();
      }
    }
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.acc += e.rate * dt;
      while (e.acc >= 1) {
        e.fn();
        e.acc--;
      }
      if (this.time >= e.until) this.emitters.splice(i, 1);
    }

    const bar = Math.floor(M.beatCount / 4);
    if (bar !== this.lastBar) {
      this.lastBar = bar;
      if (this.mode === 'energy' && bar % 2 === 0) {
        const want = M.energy > 0.5 ? 'drop' : M.energy > 0.32 ? 'groove' : 'break';
        if (want !== this.section) this.onSection(want, bar, true);
      }
      if (bar % 4 === 0) {
        if (this.section === 'drop') {
          this.base.pattern = DROP_PATTERNS[(bar / 4) % DROP_PATTERNS.length];
          this.base.laserMode = (bar / 4) % 2 ? 'scan' : 'fan';
          this.w.stage.led.setMode([4, 3, 4, 1, 2][(bar / 4) % 5]); // the hardcore program every other phrase
          if (bar % 8 === 0) this.nextPalette();
        } else if (bar % 16 === 0) {
          this.nextPalette();
        }
      }
    }

    // Palette crossfade (to the director's override in a breakdown)
    const target = this.paletteOverride || PALETTES[this.paletteIdx];
    const pk = Math.min(1, dt * 2.5);
    for (let i = 0; i < 3; i++) this.palette[i].lerp(target[i], pk);

    const m = this.mood;
    const b = this.base;
    const playing = M.playing ? 1 : 0.25;
    let lights = b.lights * playing;
    let lasers = b.lasers * playing;
    let laserMode = b.laserMode;
    let pattern = b.pattern;
    let speed = b.speed;
    let ledDim = 0.28 + 0.3 * b.lights; // the LED wall is a backdrop, not a floodlight
    let floorDim = 1;

    if (this.section === 'build') {
      // Strobe rises through the last two bars of a build-up.
      const into = (M.beatCount % 32) / 32;
      if (into > 0.75) this.strobeEnv = Math.max(this.strobeEnv, (into - 0.75) * 2.4 * (M.phase < 0.5 ? 1 : 0.3));
    }
    if (this.hypeUntil > this.time) {
      lights = 1;
      lasers = 1;
      speed = 1.6;
      pattern = 'chase';
    }
    if (this.stormUntil > this.time) {
      lasers = 1;
      laserMode = 'storm';
    }
    let strobe = this.strobeEnv;
    if (this.blackoutUntil > this.time) {
      lights = 0;
      lasers = 0;
      ledDim = 0.04;
      floorDim = 0.1;
      const hz = settings.reduceFlash ? 2 : 12;
      strobe = (Math.floor(this.time * hz * 2) % 2) * (settings.reduceFlash ? 0.25 : 0.9);
    }
    if (settings.reduceFlash) strobe = Math.min(strobe, 0.25);
    this.strobeEnv = Math.max(0, this.strobeEnv - dt * 6);
    this.flash = Math.max(0, this.flash - dt * 2.5);

    const dark = this.blackoutUntil > this.time ? 0 : 1;
    // Audience blinders punch on every kick in a drop / hype, and barely otherwise.
    const big = this.section === 'drop' || this.hypeUntil > this.time;
    let blinder = big ? M.kick * 0.6 * dark * playing : 0;
    // Stutter strobe: in the last beat of a bar the audience blinders chatter at 16th notes.
    const strobeProg = !settings.reduceFlash && M.playing && big && dark && !this.vipOn ? STROBE_PROGRAMME[Math.floor(M.beatCount / 16) % STROBE_PROGRAMME.length] : null;
    if (strobeProg === 'stutter' && (M.beatCount & 3) === 3 && (M.phase * 8) % 1 < 0.5) blinder = Math.max(blinder, 0.9);
    if (settings.reduceFlash) blinder = Math.min(blinder, 0.2);

    m.lights = lights;
    m.sky = b.sky * playing * dark;
    m.sheet = b.sheet * playing * dark;
    m.blinder = blinder;
    // Late in a build the heads chase across the rig; in a drop (or hype) the programme runs.
    m.strobePattern = strobeProg || (!settings.reduceFlash && M.playing && this.section === 'build' && this.strobeEnv > 0.15 && !this.vipOn ? 'chase' : null);

    m.lasers = lasers;
    m.laserMode = laserMode;
    m.pattern = pattern;
    m.speed = speed;
    m.strobe = strobe;
    m.ledDim = ledDim;
    m.floorDim = floorDim;
    m.flash = Math.min(1, strobe * 0.6 + this.flash);

    // VIP presentation: the whole rave goes dark — floor, stands, screens, sky beams — and the
    // show holds back, while every moving head is on one raver (lights.js).
    this.vipLevel = (this.vipLevel || 0) + ((this.vipOn ? 1 : 0) - (this.vipLevel || 0)) * Math.min(1, dt * 1.5);
    const vip = this.vipLevel > 0.002 ? this.vipLevel : 0;
    if (vip) {
      m.floorDim = Math.min(m.floorDim, 1 - 0.8 * vip);
      m.ledDim = Math.min(m.ledDim, 1 - 0.7 * vip); // the side screens (the wall shows the drone on them)
      m.lasers *= 1 - vip;
      m.sheet *= 1 - vip;
      m.strobe *= 1 - vip;
      m.flash *= 1 - vip;
      m.blinder *= 1 - vip;
      m.sky *= 1 - 0.85 * vip;
    }
  }
}
