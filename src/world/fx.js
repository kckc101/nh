// FX director: turns the music (arrangement sections, kicks, energy) and DJ-triggered
// effects into a "mood" that every visual system reads — light level, beam pattern,
// laser mode, strobe, LED program, palette — and fires the pyro / CO2 / confetti emitters.

import * as THREE from 'three';
import { KIND } from './particles.js';
import { settings } from '../core/device.js';

const PALETTES = [
  ['#00f0ff', '#ff2bd6', '#ffc400'],
  ['#ffc400', '#ff2bd6', '#00f0ff'],
  ['#9dff00', '#00f0ff', '#ff2bd6'],
  ['#8b5cff', '#ffc400', '#00f0ff'],
  ['#ff2d55', '#00f0ff', '#ffc400'],
  ['#ff2bd6', '#8b5cff', '#9dff00'],
].map((p) => p.map((c) => new THREE.Color(c)));

const MOODS = {
  intro: { lights: 0.45, sky: 0.5, lasers: 0, laserMode: 'tunnel', pattern: 'sweep', speed: 0.5, led: 0 },
  intro2: { lights: 0.6, sky: 0.6, lasers: 0.35, laserMode: 'tunnel', pattern: 'sweep', speed: 0.6, led: 0 },
  groove: { lights: 0.85, sky: 0.5, lasers: 0.6, laserMode: 'fan', pattern: 'fan', speed: 0.8, led: 2 },
  break: { lights: 0.3, sky: 0.9, lasers: 0.5, laserMode: 'tunnel', pattern: 'center', speed: 0.35, led: 0 },
  build: { lights: 0.6, sky: 0.7, lasers: 0.7, laserMode: 'scan', pattern: 'chase', speed: 1.2, led: 1 },
  drop: { lights: 1, sky: 1, lasers: 1, laserMode: 'fan', pattern: 'sweep', speed: 1.3, led: 3 },
  break2: { lights: 0.3, sky: 0.9, lasers: 0.5, laserMode: 'tunnel', pattern: 'center', speed: 0.35, led: 0 },
  outro: { lights: 0.5, sky: 0.5, lasers: 0.25, laserMode: 'tunnel', pattern: 'sweep', speed: 0.6, led: 0 },
};
const DROP_PATTERNS = ['sweep', 'fan', 'cross', 'chase'];
const NEON = ['#00f0ff', '#ff2bd6', '#9dff00', '#ffc400', '#8b5cff', '#ff2d55', '#ffffff'];

const rand = (a, b) => a + Math.random() * (b - a);

export class FXDirector {
  constructor(world) {
    this.w = world;
    this.time = 0;
    this.section = 'groove';
    this.base = { ...MOODS.groove };
    this.mood = { ...MOODS.groove, strobe: 0, ledDim: 1, floorDim: 1, flash: 0 };
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

  onSection(name, bar, immediate) {
    if (!MOODS[name]) return;
    this.section = name;
    this.base = { ...MOODS[name] };
    this.w.stage.led.setMode(this.base.led);
    this.nextPalette();
    if (immediate || !settings.autoFx) return;
    if (name === 'drop') {
      this.trigger('co2');
      this.after(0.05, () => this.trigger('confetti'));
      this.after(0.3, () => this.trigger('fireworks'));
      if (bar >= 64) this.trigger('fire');
    }
    if (name === 'break') this.trigger('smoke');
  }

  /** Energy jump on a non-synth track. */
  onSurge() {
    if (this.mode !== 'energy' || !settings.autoFx) return;
    this.trigger('co2');
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
    this.emitters.push({ until: this.time + duration, rate, acc: 0, fn });
  }

  nextPalette() {
    this.paletteIdx = (this.paletteIdx + 1) % PALETTES.length;
  }

  trigger(type) {
    const st = this.w.stage;
    const sparks = this.w.sparks;
    const smoke = this.w.smoke;
    const white = new THREE.Color(0.85, 0.9, 1);
    const co2 = new THREE.Color(0.62, 0.68, 0.78);
    switch (type) {
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
      case 'co2':
        for (const p of st.co2Points) {
          this.emitFor(1.5, 150, () =>
            smoke.emit(p.x + rand(-0.2, 0.2), p.y, p.z, rand(-1.5, 1.5), rand(20, 27), rand(-1, 1.5), {
              color: co2, life: rand(1.6, 2.4), size: rand(0.7, 1.2), alpha: 0.2, drag: 2.4, grow: 3.0, kind: KIND.SMOKE,
            }),
          );
        }
        break;
      case 'smoke': {
        const c = new THREE.Color(0.75, 0.62, 0.95);
        for (let i = 0; i < 160; i++) {
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
        this.w.confetti.burst(480, { x: 0, y: 20, z: 6, w: 64, h: 12, d: 46 }, NEON);
        break;
      case 'fireworks':
        for (let i = 0; i < 6; i++) this.after(i * 0.45 + Math.random() * 0.2, () => this.firework());
        break;
      case 'hype':
        this.hypeUntil = this.time + 8;
        this.trigger('fireworks');
        this.trigger('confetti');
        this.after(0.4, () => this.trigger('co2'));
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
      for (let i = 0; i < 120; i++) {
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
          this.w.stage.led.setMode([3, 1, 2][(bar / 4) % 3]);
          this.nextPalette();
        } else if (bar % 8 === 0) {
          this.nextPalette();
        }
      }
    }

    // Palette crossfade
    const target = PALETTES[this.paletteIdx];
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
    let ledDim = 1;
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

    m.lights = lights;
    m.sky = b.sky * playing * (this.blackoutUntil > this.time ? 0 : 1);
    m.lasers = lasers;
    m.laserMode = laserMode;
    m.pattern = pattern;
    m.speed = speed;
    m.strobe = strobe;
    m.ledDim = ledDim;
    m.floorDim = floorDim;
    m.flash = Math.min(1, strobe * 0.6 + this.flash);
  }
}
