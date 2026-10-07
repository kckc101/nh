// The festival world: renderer + bloom, every visual subsystem, and the frame loop that
// feeds them the live audio analysis.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Emitter } from '../core/events.js';
import { qualityProfile, settings, saveSettings } from '../core/device.js';
import { avatarUniforms } from '../avatar/builder.js';
import { Environment } from './environment.js';
import { Stage } from './stage.js';
import { StageLights } from './lights.js';
import { Lasers } from './lasers.js';
import { ParticlePool, Confetti } from './particles.js';
import { FXDirector } from './fx.js';
import { Crowd } from './crowd.js';
import { Player } from './player.js';
import { glowTexture, smokeTexture } from './textures.js';
import { PerformanceGovernor, TIERS } from './perf.js';

export class World extends Emitter {
  constructor(container, audio) {
    super();
    this.container = container;
    this.audio = audio;
    this.q = qualityProfile();

    this.gov = new PerformanceGovernor({ enabled: settings.autoPerf !== false });
    this.particleScale = 1; // read by the FX director; cut when the governor sheds effects
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: this.q.antialias, powerPreference: 'high-performance' }));
    r.setPixelRatio(this.pixelRatio);
    r.setSize(innerWidth, innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.domElement.className = 'block w-full h-full';
    container.append(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#05030a');
    scene.fog = new THREE.FogExp2('#0b0614', 0.0065);
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1500);

    this.hemi = new THREE.HemisphereLight('#7a66ff', '#1a0b22', 1.1);
    this.rimA = new THREE.DirectionalLight('#ff2bd6', 1.3);
    this.rimA.position.set(-30, 25, 20);
    this.rimB = new THREE.DirectionalLight('#00f0ff', 1.1);
    this.rimB.position.set(30, 20, 30);
    this.front = new THREE.DirectionalLight('#ffffff', 0.5);
    this.front.position.set(0, 20, -40);
    scene.add(this.hemi, this.rimA, this.rimB, this.front);

    this.env = new Environment(scene);
    this.stage = new Stage(scene);
    this.lights = new StageLights(scene);
    this.lasers = new Lasers(scene);
    this.sparks = new ParticlePool(scene, 4000, glowTexture(), THREE.AdditiveBlending);
    this.smoke = new ParticlePool(scene, 1400, smokeTexture(), THREE.NormalBlending);
    this.confetti = new Confetti(scene);
    this.obstacles = [...this.env.obstacles, ...this.stage.obstacles];
    this.fx = new FXDirector(this);
    this.crowd = new Crowd(this, settings.bots);
    this.player = null;

    this.setupComposer();
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    this.resize();

    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.fps = 60;
    this.gov.on('fps', (fps) => {
      this.fps = Math.round(fps);
      this.emit('fps', this.fps);
    });
    this.gov.on('change', () => this.applyPerf());
    this.gov.on('degrade', (s) => this.emit('degrade', s));
  }

  /** Effective device-pixel ratio: quality ceiling × governor scale (never below 0.6). */
  get pixelRatio() {
    return Math.max(0.6, this.q.pixelRatio * (this.gov?.scale ?? 1));
  }

  /** Apply the governor's current scale and feature tier. */
  applyPerf() {
    const tier = TIERS[this.gov.tier];
    const wantBloom = this.q.bloom && tier.bloom;
    if (wantBloom !== !!this.composer) this.setupComposer();
    this.particleScale = tier.particles;
    this.crowd.lodScale = tier.lod;
    this.resize();
    this.emit('perf', this.gov.state);
  }

  setPlayer(profile, isDJ) {
    this.player = new Player(this, profile, isDJ);
    this.crowd.localDJ = isDJ;
    this.crowd.updateResident();
    return this.player;
  }

  setupComposer() {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (!this.q.bloom || !TIERS[this.gov.tier].bloom) return;
    const c = (this.composer = new EffectComposer(this.renderer));
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 0.82);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
  }

  setQuality(level) {
    settings.quality = level;
    saveSettings();
    this.q = qualityProfile(level);
    this.gov.reset(); // re-evaluates from the new ceiling (also re-applies via 'change')
    this.applyPerf();
    this.emit('quality', level);
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    const pr = this.pixelRatio;
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    const scale = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.sparks.setScale(scale);
    this.smoke.setScale(scale);
    this.env.setPointScale(scale);
  }

  start() {
    this.renderer.setAnimationLoop((ts) => this.frame(ts));
  }

  frame(ts) {
    this.timer.update(ts);
    const dt = Math.min(0.05, Math.max(0, this.timer.getDelta()));
    const t = this.timer.getElapsed();
    const M = this.audio.update(dt);

    this.fx.update(dt, t, M);
    const mood = this.fx.mood;
    const pal = this.fx.palette;

    this.player?.update(dt, M);
    this.crowd.update(dt, t, M, this.camera.position);
    this.stage.update(dt, t, M, mood, pal);
    this.lights.update(dt, t, M, mood, pal);
    this.lasers.update(dt, t, M, mood, pal);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.confetti.update(dt, t);
    this.env.update(dt, t, M, mood, pal, this.lights, this.fx.rings);

    avatarUniforms.uGlowBoost.value = 0.9 + M.bass * 1.5 * Math.max(0.3, mood.lights) + mood.strobe;
    this.hemi.intensity = (0.75 + mood.flash * 3) * (mood.floorDim < 1 ? 0.35 : 1);
    this.rimA.color.copy(pal[1]);
    this.rimB.color.copy(pal[0]);
    this.front.color.copy(pal[2]);
    this.front.intensity = 0.3 + M.kick * 1.1 * mood.lights + mood.strobe * 3;
    if (this.bloom) this.bloom.strength = 0.5 + M.bass * 0.25 + mood.strobe * 0.3;

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);

    // Real wall-clock timing (dt above is clamped, which would hide slow frames).
    this.gov.tick(performance.now(), document.hidden);
  }
}
