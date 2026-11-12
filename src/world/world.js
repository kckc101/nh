// The festival world: renderer + bloom, every visual subsystem, and the frame loop that
// feeds them the live audio analysis.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Emitter } from '../core/events.js';
import { qualityProfile, settings, saveSettings } from '../core/device.js';
import { avatarUniforms, djUniforms } from '../avatar/builder.js';
import { Environment } from './environment.js';
import { Stage } from './stage.js';
import { StageLights } from './lights.js';
import { Lasers } from './lasers.js';
import { ParticlePool, Confetti } from './particles.js';
import { FXDirector } from './fx.js';
import { Crowd } from './crowd.js';
import { Player } from './player.js';
import { CrowdRig } from './rig.js';
import { Drone } from './drone.js';
import { DroneCamSystem } from './dronecam.js';
import { DronePip } from './dronepip.js';
import { BroadcastRig } from './broadcast.js';
import { Atmosphere } from './atmosphere.js';
import { BottlePresentationManager } from './bottle.js';
import { LightingController } from './strobe.js';
import { LaserRig } from './laserrig.js';
import { CryoJets } from './cryojets.js';
import { LightingDirector } from './lightingdirector.js';
import { StadiumSeats } from './seats.js';
import { LaserChoreographySystem } from './lasershow.js';
import { glowTexture, smokeTexture } from './textures.js';
import { PerformanceGovernor, TIERS } from './perf.js';
import { CENTER_Z, bowlRayHit, seatNear } from './venue.js';
import { SanitizeShader, crowdGlow } from './shaders.js';
import { CinematicShader, CinematicLook } from './cinematic.js';

const FOG_DENSITY = 0.0034;
const MAX_PIXEL_RATIO = 1.75; // sharp on high-DPI screens, short of their full 2–3× (the governor scales down from here)

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
    r.toneMappingExposure = 1.0;
    r.domElement.className = 'block w-full h-full';
    container.append(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    // Morodok Techo at night: navy-black, deep stadium shadows; thin enough fog that the bowl
    // and the pylons 200 m away still read.
    scene.background = new THREE.Color('#010208');
    // Arena Blackout's targets (the scene's own colours are set from these every frame).
    this.house = { bg: scene.background.clone(), fog: new THREE.Color('#02040b'), black: new THREE.Color('#020205') };
    this.arenaT = 0; // 0 → 1 through the Arena Blackout transition
    this.rimWhite = new THREE.Color(1, 1, 1);
    scene.fog = new THREE.FogExp2('#02040b', FOG_DENSITY); // thinned for far-out cameras (viewFrom)
    // Far enough for the whole complex and the city from the widest zoom. The near plane is never
    // tiny (that's what spends the depth buffer's precision): Player keeps it at 0.3 m in POV,
    // 0.5–4 m in third person (it grows with the zoom), 1 m on the drone.
    this.camera = new THREE.PerspectiveCamera(70, Math.max(1, innerWidth) / Math.max(1, innerHeight), 0.5, 5000);
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.pickSphere = new THREE.Sphere(new THREE.Vector3(), 2.5); // a raver and their tag, for pick()
    this.seatHit = {}; // pickSeat's scratch

    this.hemi = new THREE.HemisphereLight('#3d5be0', '#07040f', 1.1);
    // Its colours, and where a breakdown takes them (LightingDirector: mood.ambientTint).
    this.hemiSky = [new THREE.Color('#3d5be0'), new THREE.Color('#3a1aa8')];
    this.hemiGround = [new THREE.Color('#07040f'), new THREE.Color('#080628')];
    this.rimA = new THREE.DirectionalLight('#ff2bd6', 1.0);
    this.rimA.position.set(-30, 25, 20);
    this.rimB = new THREE.DirectionalLight('#00f0ff', 0.9);
    this.rimB.position.set(30, 20, 30);
    this.front = new THREE.DirectionalLight('#ffffff', 0.5);
    this.front.position.set(0, 20, -40);
    scene.add(this.hemi, this.rimA, this.rimB, this.front);

    this.env = new Environment(scene);
    this.stage = new Stage(scene);
    this.seats = new StadiumSeats(scene); // real seats in the stands round the camera
    this.lights = new StageLights(scene);
    this.lasers = new Lasers(scene);
    this.laserRig = new LaserRig(scene); // the mainstage emerald array (the director runs it)
    this.cryo = new CryoJets(scene); // CO2 jets behind the crowd barrier
    this.atmosphere = new Atmosphere(scene, this.lights); // ground haze + the booth's silhouette backlight
    this.rig = new CrowdRig(scene);
    // Drone cam (its flight; the visible drone follows it), one of the broadcast rig's five cameras.
    const sharedClock = () => (audio.serverNow ? audio.serverNow() : Date.now());
    this.droneCam = new DroneCamSystem(this, sharedClock);
    this.drone = new Drone(scene, this.droneCam);
    this.sparks = new ParticlePool(scene, 4000, glowTexture(), THREE.AdditiveBlending);
    this.smoke = new ParticlePool(scene, 1400, smokeTexture(), THREE.NormalBlending);
    this.confetti = new Confetti(scene);
    this.obstacles = [...this.env.obstacles, ...this.stage.obstacles, ...this.lasers.obstacles];
    this.fx = new FXDirector(this);
    this.crowd = new Crowd(this, settings.bots);
    this.bottles = new BottlePresentationManager(this, this.drone.clock);
    this.lighting = new LightingController(this); // DJ strobe / beat blackout
    this.director = new LightingDirector(this); // the drop, the breakdown, blackouts
    this.show = new LaserChoreographySystem(this, sharedClock); // the DJ's LASER SHOW // MAIN DROP
    this.droneCam.init();
    // The broadcast rig: five cameras live on the LED wall + booth monitor (the DJ output) and the
    // side towers + your picture-in-picture (the ravers' output).
    this.broadcast = new BroadcastRig(this, sharedClock).init();
    this.dronePip = new DronePip(this.broadcast); // the ravers' output on your own screen (ui/dronepip.js)
    this.player = null;
    this.hoverSeat = null; // the seat under the mouse (main.js), for the seat marker

    this.cineLook = new CinematicLook();
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
    this.gov.on('fans', (share) => this.env.fans.setDensity(this.q.level, share));
    this.env.fans.setDensity(this.q.level, this.gov.fanShare);
    this.gov.on('degrade', (s) => this.emit('degrade', s));
  }

  /** Effective device-pixel ratio: quality ceiling × governor scale (never below 0.6). */
  get pixelRatio() {
    return Math.min(MAX_PIXEL_RATIO, Math.max(0.6, this.q.pixelRatio * (this.gov?.scale ?? 1)));
  }

  /** Apply the governor's current scale and feature tier. */
  applyPerf() {
    const tier = TIERS[this.gov.tier];
    const wantBloom = this.q.bloom && tier.bloom;
    if (wantBloom !== !!this.composer) this.setupComposer();
    this.particleScale = tier.particles;
    this.crowd.lodScale = tier.lod;
    this.env.fans.setDensity(this.q.level, this.gov.fanShare);
    this.rig.setLite(tier.particles < 1);
    this.atmosphere.setLite(tier.particles < 1);
    this.broadcast.refreshResolution();
    this.resize();
    this.emit('perf', this.gov.state);
  }

  /**
   * Per-camera view settings: the sky dome centred on the camera (it's a backdrop — the moon
   * and stars mustn't grow as a zoomed-out camera nears them), and thinner fog for a camera far
   * out (the drone's aerial, the widest zoom), so the whole venue reads.
   */
  viewFrom(cam) {
    this.env.sky.position.copy(cam.position);
    const p = cam.position;
    const r = Math.hypot(p.x, p.y, p.z - CENTER_Z);
    this.scene.fog.density = FOG_DENSITY * Math.min(1, Math.max(0.18, 120 / Math.max(1, r)));
  }

  get droneView() {
    return this.drone.active;
  }

  /** Switch the camera between following your raver and riding the circling drone. */
  setDroneView(on) {
    if (!this.player || on === this.drone.active) return this.drone.active;
    if (on) {
      this.camera.near = 1; // the drone flies a few metres from the halo rings at closest
      this.camera.updateProjectionMatrix();
      this.drone.setActive(true, this.camera, this.player.look);
      this.player.cameraEnabled = false;
      this.setFov(this.fitFov(this.droneCam.camera.fov));
    } else {
      this.drone.setActive(false);
      this.player.cameraEnabled = true;
      this.player.returnFrom(this.drone.curLook);
      this.setFov(this.player.fov);
    }
    this.emit('drone', on);
    return on;
  }

  /**
   * A vertical field of view wide enough that a portrait screen still sees `minAcross` degrees
   * across (landscape: unchanged), for the shots that have to fit the whole stadium.
   */
  fitFov(fov, minAcross = 58) {
    const aspect = this.camera.aspect;
    if (!(aspect > 0) || aspect >= 1) return fov; // also a 0 × 0 (minimised) window
    const need = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(minAcross / 2)) / aspect) * 180) / Math.PI;
    return Math.min(100, Math.max(fov, need));
  }

  /** Change the field of view (sprite sizes depend on it; the canvas and render targets don't). */
  setFov(fov) {
    if (Math.abs(this.camera.fov - fov) < 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.updatePointScale();
  }

  /** The raver under a screen point — their name tag or their body — or null. */
  aim(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
  }

  /**
   * Where a raver arrives: a free seat in the front rows of the lower tier at the north end of
   * the bowl — the stage's front, the LED wall and the dance floor in view — facing the DJ, and
   * at least 1.5 m from anyone already there (`avoid`: other players' positions). Not claimed
   * yet (Player.sitAt does that); null if the stands are full.
   */
  spawnSeat(avoid = []) {
    const clear = (s) => avoid.every((p) => (p.x - s.x) ** 2 + (p.z - s.z) ** 2 > 1.5 * 1.5);
    const north = (s) => s.z - CENTER_Z > 24 && clear(s);
    return this.env.fans.allocateSeat({ tier: 0, maxRow: 5, where: north, claim: false }) || this.env.fans.allocateSeat({ tier: 0, maxRow: 12, where: clear, claim: false });
  }

  /**
   * The seat under a screen point, if it's on a row of the stands: { x, y, z, handle } (see
   * StandCrowd.seatFor), or null.
   */
  pickSeat(clientX, clientY) {
    this.aim(clientX, clientY);
    const { origin, direction } = this.raycaster.ray;
    const p = bowlRayHit(origin, direction, 1000, this.seatHit); // the bowl's shape, not its mesh
    if (!p) return null;
    const row = seatNear(p.x, p.z);
    if (!row || Math.abs(row.d - p.d) > 1.5 || Math.abs(row.y - p.y) > 1.2) return null; // a wall, a lip, the rim
    return this.env.fans.seatFor(row);
  }

  pick(clientX, clientY) {
    this.aim(clientX, clientY);
    const ray = this.raycaster.ray;
    const sphere = this.pickSphere;
    const targets = [];
    const add = (av) => {
      if (!av?.root.visible) return;
      // Coarse first: one sphere round the raver and their name tag; only those under the
      // pointer get their meshes tested.
      sphere.center.copy(av.root.position).y += 1.8;
      if (!ray.intersectsSphere(sphere)) return;
      if (av.tagSprite?.visible) targets.push(av.tagSprite);
      if (av.lod === 2) {
        if (av.impostor) targets.push(av.impostor);
      } else targets.push(...av.meshes);
    };
    add(this.player?.avatar);
    for (const b of this.crowd.bots) add(b.av);
    for (const r of this.crowd.remotes.values()) add(r.av);
    add(this.crowd.resident);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    return hit?.object.userData.avatar || null;
  }

  /** Your raver. `vip`: a VIP ticket (the VIP badge, and the VIP decks are open to you). */
  setPlayer(profile, isDJ, { vip = false } = {}) {
    this.player = new Player(this, profile, isDJ, { vip });
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
    c.addPass(new ShaderPass(SanitizeShader)); // no NaN / Inf pixel reaches the bloom
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.4, 0.82);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    // The cinematic look on the shown frame: grade, anamorphic streaks, lens, grain, letterbox.
    this.cine = new ShaderPass(CinematicShader);
    this.cine.enabled = settings.cinematic !== false;
    c.addPass(this.cine);
  }

  /** Settings → Cinematic look: the film grade, lens streaks, grain and letterbox on or off. */
  setCinematic(on) {
    settings.cinematic = on;
    saveSettings();
    if (this.cine) this.cine.enabled = on;
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
    if (w < 1 || h < 1) return; // minimised: keep the last size (a 0 aspect would poison the projection)
    const pr = this.pixelRatio;
    if (this.renderer.getPixelRatio() !== pr) this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      // Bloom from half the screen's CSS size, whatever the pixel ratio (or less, when the
      // governor has scaled the frame down): a glow needs no high-DPI detail, and its blur
      // passes are the composer's heaviest. (UnrealBloomPass halves the size it's given.)
      const s = Math.min(1, pr);
      this.bloom.setSize(Math.round(w * s), Math.round(h * s));
      this.cineLook.setSize(this.cine, Math.round(w * pr), Math.round(h * pr));
    }
    this.updatePointScale();
  }

  /** Point sprites (particles, the fans in the stands) are sized in pixels: screen height × fov. */
  updatePointScale() {
    this.pointScale = (innerHeight * this.pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.setPointScale(this.pointScale);
  }

  /** Every point sprite's pixels-per-metre (a broadcast camera sets its own for its render, then puts it back). */
  setPointScale(scale) {
    this.sparks.setScale(scale);
    this.smoke.setScale(scale);
    this.cryo.setScale(scale);
    this.env.setPointScale(scale);
  }

  start() {
    this.renderer.setAnimationLoop((ts) => this.frame(ts));
  }

  frame(ts) {
    // The governor first: a resolution change resizes the canvas, which clears it — before this
    // frame's draw, not after it (that would present a black frame). Real wall-clock timing (dt
    // below is clamped, which would hide slow frames).
    this.gov.tick(performance.now(), document.hidden);
    this.timer.update(ts);
    const dt = Math.min(0.05, Math.max(0, this.timer.getDelta()));
    const t = this.timer.getElapsed();
    const M = this.audio.update(dt);

    this.fx.update(dt, t, M);
    const mood = this.fx.mood;
    const pal = this.fx.palette;
    this.director.update(dt, t, M, mood); // the cues shape the mood before the DJ strobe has its say
    this.show.update(dt, t, M, mood); // the MAIN DROP choreography, when the DJ runs it
    this.lighting.pre(M, mood); // DJ strobe / blackout takes over the mood before anything reads it
    // Arena Blackout (the DJ's switch, synced): 0.35 s down, 0.5 s back, eased, so it punches
    // without popping. Everything reads the eased level from mood.arena; nothing is overwritten,
    // so switching it off brings back exactly what was there.
    const arenaOn = !!this.lighting.state.arena;
    this.arenaT = Math.min(1, Math.max(0, this.arenaT + (arenaOn ? dt / 0.35 : -dt / 0.5)));
    const arena = this.arenaT * this.arenaT * (3 - 2 * this.arenaT);
    const house = 1 - arena;
    mood.arena = arena;
    crowdGlow.value = house;

    this.player?.update(dt, M);
    this.droneCam.update(dt, M);
    this.broadcast.update(dt, t, M); // the fixed cameras' moves, the director's cuts
    this.drone.update(dt, this.camera);
    if (this.drone.active) this.drone.placeCamera(this.camera, dt);
    this.crowd.update(dt, t, M, this.camera.position);
    this.bottles.update(dt, t, M);
    this.stage.update(dt, t, M, mood, pal);
    this.lights.update(dt, t, M, mood, pal);
    this.lasers.update(dt, t, M, mood, pal);
    this.laserRig.update(dt, t, M);
    this.atmosphere.update(t, M, mood, pal, dt);
    this.rig.update(dt, t, M, mood, pal);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.cryo.update(dt, this.particleScale);
    this.confetti.update(dt, t);
    this.env.update(dt, t, M, mood, pal, this.lights, this.fx.rings);
    // Stand LOD for this camera (far slices of 3D fans → sprites; the 3D bubble round you), then
    // the seat you'd sit in: under the mouse, else the one "E" would take.
    const p = this.player;
    this.env.fans.setViewer(this.camera.position, p?.pos);
    this.seats.update(this.camera.position);
    this.env.showSeat(p && !p.seat && !this.drone.active ? this.hoverSeat || p.seatHint : null);

    // The DJ: their neon at full whatever the house lights do, and a rim of light in the look's
    // main colour (a touch whiter), punching on the kick. The focal point of the stage.
    djUniforms.uDjGlow.value = 0.9 + M.bass * 0.8 + mood.strobe * 0.6;
    djUniforms.uRim.value = 1.3 + M.kick * 2.2 * Math.max(0.35, mood.lights);
    djUniforms.uRimColor.value.copy(pal[0]).lerp(this.rimWhite, 0.3).multiplyScalar(1.6); // over the bloom's threshold
    // Avatars' neon (Arena Blackout takes it with the rest of the crowd's glow).
    avatarUniforms.uGlowBoost.value = (0.55 + M.bass * 0.7 * Math.max(0.3, mood.lights) + mood.strobe * 0.6) * house;
    // Darker room: low ambient so beams, lasers and neon do the lighting.
    // Ambient: 0.3 for the show, 0.05 in a drop, deep purple-blue in a breakdown (LightingDirector).
    const ambient = mood.ambient ?? 0.3;
    // The house lights (hemisphere, neon rims) go in an Arena Blackout; the stage's front wash,
    // flashes and blinders stay.
    this.hemi.intensity = (ambient * house + mood.flash * 2.5 + mood.blinder * 0.5) * (mood.floorDim < 1 ? 0.35 : 1);
    this.hemi.color.copy(this.hemiSky[0]).lerp(this.hemiSky[1], mood.ambientTint || 0);
    this.hemi.groundColor.copy(this.hemiGround[0]).lerp(this.hemiGround[1], mood.ambientTint || 0);
    const rim = 0.4 + 0.6 * Math.min(1, ambient / 0.3); // the neon rims dim with the room
    this.rimA.intensity = 1.0 * rim * house;
    this.rimB.intensity = 0.9 * rim * house;
    this.scene.background.copy(this.house.bg).lerp(this.house.black, arena);
    this.scene.fog.color.copy(this.house.fog).lerp(this.house.black, arena);
    this.rimA.color.copy(pal[1]);
    this.rimB.color.copy(pal[0]);
    this.front.color.copy(pal[2]);
    this.front.intensity = 0.15 + M.kick * 0.6 * mood.lights + mood.strobe * 2.5 + mood.blinder * 1.2;
    // The bloom, swelling with the show's big moments (mood.bloomBoost: the blinder before the drop).
    if (this.bloom) this.bloom.strength = Math.min(1.3, 0.42 + M.bass * 0.18 + mood.strobe * 0.25 + (mood.bloomBoost || 0)) || 0.42;
    if (this.cine?.enabled) {
      // Letterbox for the big moments: the arrival shot, riding the drone, a VIP show.
      const moment = this.drone.active || (p && p.camEase < 1) || (this.fx.vipLevel || 0) > 0.5;
      this.cineLook.update(this.cine, this.bloom, dt, t, M, mood, { moment, reduceFlash: settings.reduceFlash });
    }

    // Strobe lighting gets the last word on the lights; 'dark' means pitch black — skip the draw.
    const look = this.lighting.post();
    if (look !== 'dark') this.broadcast.render(this.renderer); // the screens' feeds (taking turns, every Nth frame)
    this.viewFrom(this.camera);
    if (look === 'dark') {
      this.camera.updateMatrixWorld(); // rendering normally does this (the crowd's culling needs it)
      this.renderer.setRenderTarget(null);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
    } else {
      if (this.composer) this.composer.render(dt);
      else this.renderer.render(this.scene, this.camera);
      this.dronePip.draw(this.renderer, dt); // the ravers' feed picture-in-picture, on top
    }
  }
}
