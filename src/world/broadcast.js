// The broadcast rig (CameraManager): five cameras round the stadium and a two-output vision mixer
// that puts them live on the venue's screens.
//
//   CAM 1 STAGE   on the pitch in front of the barrier, centred on the DJ booth, the lighting rig
//                 and the LED wall; a slow dolly
//   CAM 2 CROWD   high in the north stand, wide, down across the crowd to the stage; a slow drift
//   CAM 3 BOOTH   just behind the DJ, over the shoulder, out across the decks to the crowd
//   CAM 4 DRONE   the roaming drone (dronecam.js)
//   CAM 5 PIT     eye level in the front rows of the east stand, in among the dancing crowd,
//                 handheld and bouncing on the kick (the pitch is kept clear: the crowd's floor
//                 is the stands)
//
// Two outputs, each with its own WebGLRenderTarget (640 x 360; 480 x 270 on low, half on the
// lite tier):
//   dj     the main LED wall and the DJ booth monitor
//   raver  a picture on each side tower's LED screen, and your picture-in-picture (dronepip.js)
//
// Routing (which camera each output shows, or the auto director) is shared state
// (shared/dronecam.js) set from the DJ panel, so every client's screens agree. The director cuts
// every cutBeats beats of the DJ's tempo on the shared clock, so the cuts land together on every
// screen; each cut flashes a short glitch. A VIP show takes both outputs to the drone's VIP shot.
//
// Cost: the outputs take turns, at most one extra scene render a frame, and fewer when the device
// is struggling. The picture-in-picture's output leads (every 2nd frame, evenly; every 3rd on the
// lite tier); the LED screens' output fills the frames between (every 6th below 50 fps, every 9th
// on the lite tier). An output nobody can see doesn't render, and when both show the same camera
// it renders once for both (cadence()). Ravers more than
// FAR_RAVER m away, and every name tag, sit the broadcast renders out. The cameras never see the
// screens (SCREEN_LAYER: a feedback loop) and, except the pit cam in the crowd, they see the 3D
// fans' sprite stand-ins (FEED_ONLY_LAYER).
//
// API: init(), applyState(droneState), setScreenSource('djScreen' | 'raverScreen', camId),
// update(dt, t, M), render(renderer), output('dj' | 'raver'), cameraOf(id), dispose().

import * as THREE from 'three';
import { DRONECAM_DEFAULTS } from '../../shared/dronecam.js';
import { STAGE } from './stage.js';
import { CENTER_Z, GPS_LABEL, bowlHeightAt } from './venue.js';
import { DISPLAY_FONT } from './textures.js';
import { DRONE_LAYER, SCREEN_LAYER, MAIN_ONLY_LAYER, FEED_ONLY_LAYER, MODE_LABEL } from './dronecam.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// The LED wall shows its feed through 192 x 84 LED pixels, the side towers through 56 x 32, and
// the picture-in-picture is at most 340 CSS px wide (about 600 device px): 640 x 360 is plenty.
const RESOLUTIONS = { high: [640, 360], medium: [640, 360], low: [480, 270] };
const FAR_RAVER = 140; // m from the camera: a raver this far is about 2 px tall on a feed

// ---------------------------------------------------------------- the screens' material
const FEED_GLSL = /* glsl */ `
#ifdef USE_EMISSIVEMAP
{
  vec2 suv = vEmissiveMapUv;
  vec2 uv = (suv - 0.5) * uFit + 0.5; // cover-fit the 16:9 feed on this screen's aspect
  // Glitch bursts: horizontal tearing on a few bands, stronger colour split.
  float band = floor(suv.y * 28.0);
  float tick = floor(uTime * 24.0);
  float tear = uGlitch * step(0.7, fract(sin(band * 91.7 + tick * 13.3) * 43758.5453));
  uv.x += tear * (fract(sin(band * 12.9 + tick) * 437.58) - 0.5) * 0.14;
  vec2 d = uv - 0.5;
  float ca = 0.0025 + 0.012 * uGlitch;
  vec3 c = vec3(
    texture2D(emissiveMap, uv + d * ca).r,
    texture2D(emissiveMap, uv).g,
    texture2D(emissiveMap, uv - d * ca).b);
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  // A soft knee over 1: the lasers' hot cores and the plumes keep their colour on the screen
  // instead of clipping to a white smear (and blooming it across the stadium).
  float peak = max(max(c.r, c.g), c.b);
  if (peak > 1.0) c *= (1.0 + (peak - 1.0) / (1.0 + (peak - 1.0) * 0.6)) / peak;
  c *= 0.86 + 0.14 * sin(suv.y * 1700.0 + uTime * 6.0);                                      // scanlines
  c *= 1.0 - 0.55 * dot(d, d);                                                                  // vignette
  c += (fract(sin(dot(suv * 913.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.025; // grain
  if (uDots > 0.5) {                                                                            // LED pixels
    vec2 cell = fract(suv * uDotRes) - 0.5;
    c *= 0.4 + 0.6 * smoothstep(0.5, 0.28, max(abs(cell.x), abs(cell.y)));
  }
  vec4 o = texture2D(uOverlay, suv);
  c = mix(max(c, vec3(0.0)), o.rgb * 1.5, o.a);
  totalEmissiveRadiance *= c;
}
#endif`;

function feedMaterial(map, overlay, shared, { dots = false, dotRes = [1, 1], fit = [1, 1], intensity = 1 }) {
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 1, metalness: 0, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: intensity,
    // The wall screen hangs 2 cm in front of the LED wall: pulled forward in depth so it never
    // shimmers against it from the far end of the stadium.
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const own = {
    uOverlay: { value: overlay },
    uDots: { value: dots ? 1 : 0 },
    uDotRes: { value: new THREE.Vector2(...dotRes) },
    uFit: { value: new THREE.Vector2(...fit) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, own);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uOverlay;\nuniform float uTime, uGlitch, uDots;\nuniform vec2 uDotRes, uFit;')
      .replace('#include <emissivemap_fragment>', FEED_GLSL);
  };
  m.customProgramCacheKey = () => 'erave-drone-feed';
  return m;
}

/** Broadcast overlay ("● LIVE · CAM 2 · CROWD", timecode, the shot, viewfinder corners) on a canvas. */
class Overlay {
  constructor(w, h) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  draw({ tc, cam, detail, blink, vip }) {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const u = H / 576; // scale from a 1024×576 design
    const pad = 34 * u;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 4 * u;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    const L = 46 * u;
    for (const [x, y, sx, sy] of [[pad, pad, 1, 1], [W - pad, pad, -1, 1], [pad, H - pad, 1, -1], [W - pad, H - pad, -1, -1]]) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * L);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * L, y);
      ctx.stroke();
    }
    ctx.textBaseline = 'middle';
    ctx.font = `${30 * u}px ${DISPLAY_FONT}`;
    // ● LIVE  CAM 2 · CROWD
    const y0 = pad + 34 * u;
    const x0 = pad + 26 * u;
    if (blink) {
      ctx.fillStyle = '#ff2d55';
      ctx.beginPath();
      ctx.arc(x0 + 10 * u, y0, 10 * u, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#ff2d55';
    ctx.textAlign = 'left';
    ctx.fillText('LIVE', x0 + 28 * u, y0);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(cam, x0 + 100 * u, y0);
    ctx.textAlign = 'right';
    ctx.font = `${26 * u}px ui-monospace, Consolas, monospace`;
    ctx.fillText(`TC ${tc}`, W - pad - 26 * u, y0);
    // The shot, and the brand
    const y1 = H - pad - 30 * u;
    ctx.textAlign = 'left';
    ctx.font = `${22 * u}px ui-monospace, Consolas, monospace`;
    ctx.fillStyle = '#00f0ff';
    ctx.fillText(`${detail}  ${GPS_LABEL}`, x0, y1, W * 0.6);
    ctx.textAlign = 'right';
    ctx.font = `${24 * u}px ${DISPLAY_FONT}`;
    ctx.fillStyle = '#ff2bd6';
    ctx.fillText('E-RAVE · MORODOK TECHO', W - pad - 26 * u, y1);
    if (vip) {
      // VIP lower third: who it is, and their sign.
      const bh = 104 * u;
      const by = y1 - 30 * u - bh;
      const g = ctx.createLinearGradient(pad, 0, pad + W * 0.72, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.8)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(pad, by, W * 0.72, bh);
      ctx.fillStyle = vip.color;
      ctx.fillRect(pad, by, 8 * u, bh);
      ctx.textAlign = 'left';
      ctx.font = `${24 * u}px ${DISPLAY_FONT}`;
      ctx.fillStyle = '#ffc400';
      ctx.fillText(`VIP BOTTLE SERVICE · “${vip.text}”`, pad + 28 * u, by + 28 * u, W * 0.66);
      ctx.font = `${50 * u}px ${DISPLAY_FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = vip.color;
      ctx.shadowBlur = 18 * u;
      ctx.fillText(vip.name.toUpperCase(), pad + 28 * u, by + 72 * u, W * 0.66);
      ctx.shadowBlur = 0;
    }
    this.texture.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- the cameras
const CAMS = {
  stage: { n: 1, name: 'STAGE', where: 'FRONT OF HOUSE', fov: 50 },
  crowd: { n: 2, name: 'CROWD', where: 'NORTH STAND · HIGH', fov: 48 },
  booth: { n: 3, name: 'BOOTH', where: 'BEHIND THE DJ', fov: 64 },
  drone: { n: 4, name: 'DRONE', where: '' },
  pit: { n: 5, name: 'PIT', where: 'EAST STAND · FRONT ROWS', fov: 62 },
};
export const CAM_IDS = Object.keys(CAMS);
/** "CAM 2 · CROWD" */
export const camLabel = (id) => `CAM ${CAMS[id]?.n ?? '?'} · ${CAMS[id]?.name ?? id}`;

// The auto director's running order for each output, a cut every `cutBeats` beats. The two never
// show the same camera at once.
const PLAN = {
  dj: ['drone', 'stage', 'booth', 'crowd', 'drone', 'stage', 'pit', 'booth'],
  raver: ['crowd', 'pit', 'drone', 'booth', 'stage', 'crowd', 'drone', 'pit'],
};

// East stand, row 3, a phone held up over the heads: the crowd round it fills the bottom of the
// frame, the stage above (at eye level the neighbours' heads filled it). Far enough north of the
// VIP deck (it ends 20 m north of the stage) that the deck isn't in the line of sight to the stage.
const PIT_BASE = V(54, bowlHeightAt(54) + 2.3, CENTER_Z + 34);
const _look = new THREE.Vector3();

/** Where each fixed camera is at time t (s), with its life: dollies, drift, the pit's handheld bounce. */
function poseCamera(id, cam, t, M) {
  const s = Math.sin;
  switch (id) {
    case 'stage': // on the pitch in front of the barrier, a slow dolly left and right
      cam.position.set(s(t * 0.11) * 4, 5.2 + s(t * 0.17) * 0.4, -6);
      _look.set(s(t * 0.11) * 1.5, 8.5, -32);
      break;
    case 'crowd': // high in the north stand, drifting along it
      cam.position.set(s(t * 0.06) * 16, 41, 118);
      _look.set(s(t * 0.06) * 5, 3, -20);
      break;
    case 'booth': {
      // just behind the DJ and above their shoulder, panning slowly across the crowd
      const d = STAGE.dj;
      cam.position.set(d.x + 0.95 + s(t * 0.4) * 0.05, d.y + 2.45 + s(t * 0.55) * 0.04, d.z - 3.5);
      _look.set(s(t * 0.09) * 14, 3.5, 14);
      break;
    }
    case 'pit': {
      // eye level in the crowd: handheld, bouncing on the kick
      const bounce = M.kick * 0.07;
      cam.position.set(
        PIT_BASE.x + s(t * 1.7) * 0.05 + s(t * 4.1) * 0.02,
        PIT_BASE.y + s(t * 2.3) * 0.04 + bounce,
        PIT_BASE.z + s(t * 0.21) * 1.6 + s(t * 1.3) * 0.05,
      );
      _look.set(s(t * 0.13) * 5, 6 + bounce * 2, CENTER_Z);
      break;
    }
    default:
      return;
  }
  cam.lookAt(_look);
  if (id === 'pit') cam.rotateZ(s(t * 0.8) * 0.02 + s(t * 2.9) * 0.006);
  cam.updateMatrixWorld();
}

// ---------------------------------------------------------------- outputs
class Output {
  constructor(id, [w, h], samples) {
    this.id = id;
    this.target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples, depthBuffer: true });
    this.target.texture.name = `broadcast-${id}`;
    this.shown = this.target; // what its screens show (the other output's target, when both have the same camera)
    this.cam = id === 'dj' ? 'drone' : 'crowd';
    this.screens = [];
    this.overlays = []; // [Overlay, onlyForTheDJ]
    this.shared = { uTime: { value: 0 }, uGlitch: { value: 0 } };
    this.glitch = 0;
    this.overlayAt = 0;
    this.frames = 0;
  }
}

export class BroadcastRig {
  /**
   * @param world  the World (scene, stage, crowd, drone cam, renderer, governor)
   * @param clock  () => ms on the shared (server-synced) clock
   */
  constructor(world, clock) {
    this.w = world;
    this.clock = clock;
    this.state = { ...DRONECAM_DEFAULTS };
    this.t = 0;
    this.frameNo = 0;
    this.slow = false;
    this.lodCam = null; // the camera on the busiest screen, for the crowd's LOD (crowd.js)
    this.onCut = null; // (outputId, camId) — a screen cut to another camera
    this.override = {}; // setScreenSource: this client's own choice, until the next shared state
    this.cams = {};
    for (const id of CAM_IDS) {
      if (id === 'drone') continue;
      const cam = new THREE.PerspectiveCamera(CAMS[id].fov, 16 / 9, 0.5, 3000);
      // The fixed cameras see the drone fly by; the pit cam is in the crowd, so it sees the real
      // 3D fans (the others make do with their sprite stand-ins).
      cam.layers.enable(DRONE_LAYER);
      cam.layers.enable(id === 'pit' ? MAIN_ONLY_LAYER : FEED_ONLY_LAYER);
      this.cams[id] = cam;
    }
    this.hidden = [];
    this.frustum = new THREE.Frustum();
    this.sphere = new THREE.Sphere();
    this.m4 = new THREE.Matrix4();
  }

  init() {
    const w = this.w;
    const res = this.resolution();
    const samples = w.q.antialias ? 4 : 0;
    this.dj = new Output('dj', res, samples);
    this.raver = new Output('raver', res, samples);
    this.outputs = [this.dj, this.raver];

    // DJ output: the main LED wall (a feed screen 2 cm in front of it: the wall's own visuals show
    // through while the feed is off) and the booth monitor.
    const WS = STAGE.wall;
    const wallOverlay = new Overlay(1024, Math.round((1024 * WS.h) / WS.w)); // the wall's own aspect
    const djOverlay = new Overlay(1024, 576);
    const wall = w.stage.wall;
    const wallScreen = new THREE.Mesh(
      wall.geometry,
      feedMaterial(this.dj.target.texture, wallOverlay.texture, this.dj.shared, { dots: true, dotRes: [288, 108], fit: [1, (16 / 9) / (WS.w / WS.h)], intensity: 2.1 }),
    );
    wallScreen.position.copy(wall.position).add(V(0, 0, 0.02));
    wallScreen.renderOrder = 1;
    this.wallScreen = wallScreen;
    const g = new THREE.Group();
    g.position.set(4.6, STAGE.riserY, -28.9); // beside the (wider) decks, turned to the DJ
    g.rotation.y = Math.atan2(STAGE.dj.x - 4.6, STAGE.dj.z - -28.9);
    const dark = new THREE.MeshLambertMaterial({ color: '#16131d' });
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.35, 8), dark);
    stand.position.y = 0.68;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.84, 0.07), dark);
    frame.position.y = 1.62;
    frame.rotation.x = -0.12;
    const djScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.72), feedMaterial(this.dj.target.texture, djOverlay.texture, this.dj.shared, { intensity: 1.15 }));
    djScreen.position.set(0, 1.62, 0.04);
    djScreen.rotation.x = -0.12;
    g.add(stand, frame, djScreen);
    w.stage.group.add(wallScreen, g);
    this.dj.screens.push(wallScreen, djScreen);
    this.dj.overlays.push([wallOverlay, false], [djOverlay, true]);
    this.disposables = [djScreen.geometry, stand.geometry, frame.geometry, dark, wallOverlay.texture, djOverlay.texture];

    // Raver output: a 16:9 picture in the upper part of each side tower's LED screen (the tower's
    // own visuals frame it), with LED pixels to match the tower; and your picture-in-picture.
    const sideOverlay = new Overlay(1024, 576);
    const sideGeo = new THREE.PlaneGeometry(8, 4.5);
    for (const scr of w.stage.sideScreens || []) {
      const m = new THREE.Mesh(sideGeo, feedMaterial(this.raver.target.texture, sideOverlay.texture, this.raver.shared, { dots: true, dotRes: [56, 32], intensity: 1.7 }));
      m.position.set(scr.position.x, scr.position.y + 1.9, scr.position.z + 0.03);
      scr.parent.add(m);
      this.raver.screens.push(m);
    }
    this.raver.overlays.push([sideOverlay, false]);
    this.disposables.push(sideGeo, sideOverlay.texture);

    for (const out of this.outputs) {
      for (const s of out.screens) {
        s.layers.set(SCREEN_LAYER); // the main camera only: a camera seeing its own screen would feed back
        this.disposables.push(s.material);
      }
    }
    this.applyState(this.w.droneCam.state);
    return this;
  }

  /** Feed size: 640 × 360 (480 × 270 on low; half on the lite tier). */
  resolution() {
    const [rw, rh] = RESOLUTIONS[this.w.q.level] || RESOLUTIONS.medium;
    return this.w.gov.tier >= 2 ? [Math.round(rw / 2), Math.round(rh / 2)] : [rw, rh];
  }

  /** Re-size both feeds after a graphics-quality or performance-tier change. */
  refreshResolution() {
    if (!this.outputs) return;
    const [rw, rh] = this.resolution();
    for (const o of this.outputs) if (o.target.width !== rw || o.target.height !== rh) o.target.setSize(rw, rh);
  }

  // ---------------------------------------------------------------- routing
  /** The shared state (shared/dronecam.js): djCam / raverCam, djAuto / raverAuto, cutBeats. */
  applyState(s) {
    this.state = { ...this.state, ...s };
    this.override = {};
    this.applyVisibility();
  }

  /**
   * Put a camera on a screen on this client: 'djScreen' | 'raverScreen', a camera id. (The DJ
   * panel sets it for everyone, through the server; this is for one screen here, e.g. testing.)
   */
  setScreenSource(screen, cam) {
    if (!CAM_IDS.includes(cam)) throw new Error(`No camera "${cam}" (one of ${CAM_IDS.join(', ')})`);
    this.override[screen === 'djScreen' || screen === 'dj' ? 'dj' : 'raver'] = cam;
  }

  output(id) {
    return id === 'dj' ? this.dj : this.raver;
  }

  cameraOf(id) {
    return id === 'drone' ? this.w.droneCam.camera : this.cams[id];
  }

  /** Where a fixed camera stands ("NORTH STAND · HIGH"). */
  where(id) {
    return CAMS[id]?.where || '';
  }

  /** What an output should show now: a VIP show's drone shot, this client's pick, the DJ's, or the director's. */
  wantedCam(out) {
    if (this.w.droneCam.vip) return 'drone';
    if (this.override[out.id]) return this.override[out.id];
    const s = this.state;
    if (!(out.id === 'dj' ? s.djAuto : s.raverAuto)) return out.id === 'dj' ? s.djCam : s.raverCam;
    // The director: a cut every cutBeats beats of the DJ's tempo, counted from the track's start
    // (server-synced), so the cuts land on the bar, together on every client.
    const dj = this.w.audio?.state;
    const bpm = dj?.bpm || 128;
    const beats = ((this.clock() - (dj?.startedAt || 0)) * bpm) / 60000;
    const slot = Math.floor(beats / s.cutBeats);
    const plan = PLAN[out.id];
    return plan[((slot % plan.length) + plan.length) % plan.length];
  }

  /** The screens are on while the DJ's feed switch is (or a VIP show runs); announcements take the wall. */
  applyVisibility() {
    if (!this.outputs) return;
    const on = this.w.droneCam.feedOn;
    for (const out of this.outputs) for (const s of out.screens) s.visible = on;
    this.wallScreen.visible = on && !(this.w.stage.led.textHold > 0);
  }

  // ---------------------------------------------------------------- per frame
  update(dt, t, M) {
    if (!this.outputs) return;
    this.t = this.clock() / 1000;
    for (const out of this.outputs) {
      const want = this.wantedCam(out);
      if (want !== out.cam) {
        out.cam = want;
        out.glitch = 1; // a cut: a short glitch, the way a vision mixer's switch reads on an LED wall
        out.overlayAt = 0;
        this.onCut?.(out.id, want);
      }
      out.glitch = Math.max(out.glitch - dt * 5, this.w.droneCam.glitch * (out.cam === 'drone' ? 1 : 0.5));
      out.shared.uTime.value = this.t;
      out.shared.uGlitch.value = out.glitch;
    }
    for (const id of new Set([this.dj.cam, this.raver.cam])) poseCamera(id, this.cams[id], t, M);
    this.applyVisibility();
  }

  /** Is any of these screens in the main camera's view? */
  anyVisible(screens) {
    for (const s of screens) {
      if (!s.visible) continue;
      if (!s.geometry.boundingSphere) s.geometry.computeBoundingSphere();
      this.sphere.copy(s.geometry.boundingSphere).applyMatrix4(s.matrixWorld);
      if (this.frustum.intersectsSphere(this.sphere)) return true;
    }
    return false;
  }

  /**
   * How often each output renders: [lead every, other every, other's slot]. Both run on an even
   * cadence of main frames (never a timer: an uneven 2-then-3 rhythm judders).
   *   The lead (the picture-in-picture's output while it's open: right in front of you): every
   *   2nd frame (30 fps at 60 Hz, ~20–25 when the frame rate sags), every 4th at 120 Hz, every
   *   3rd on the lite tier.
   *   The other (LED screens, seen from across the stadium): the frames in between at 60 Hz; every
   *   6th below 50 fps; every 9th on the lite tier.
   * A feed render costs nearly a whole scene render (~130 draws, ~60k triangles, every stand
   * sprite), so a slow device must get FEWER of them, not more: rendering the PiP every frame
   * below 50 fps more than doubled the frame and dragged the performance governor down to its
   * lite tier. Hysteresis 50 / 54 fps.
   */
  cadence() {
    const g = this.w.gov;
    if (g.tier >= 2) return [3, 9, 4];
    const fps = g.fps || 60;
    this.slow = this.slow ? fps < 54 : fps < 50;
    if (this.slow) return [2, 6, 3];
    const k = 2 * Math.max(1, Math.round(fps / 60));
    return [k, k, k >> 1];
  }

  /** Call once per frame, before the main render. */
  render(renderer) {
    if (!this.outputs) return;
    const cam = this.w.camera;
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const feed = this.w.droneCam.feedOn;
    const pip = !!this.w.dronePip?.active;
    const wanted = {
      dj: feed && this.anyVisible(this.dj.screens),
      raver: (feed && this.anyVisible(this.raver.screens)) || pip,
    };
    // The picture-in-picture's output leads while it's open; otherwise the LED wall's.
    const lead = pip || !wanted.dj ? this.raver : this.dj;
    const other = lead === this.dj ? this.raver : this.dj;
    // Both on the same camera: the lead's render serves the other's screens too.
    const share = this.dj.cam === this.raver.cam && wanted[lead.id];
    this.show(lead, lead.target);
    this.show(other, share ? lead.target : other.target);
    this.lodCam = wanted[lead.id] ? this.cameraOf(lead.cam) : wanted[other.id] ? this.cameraOf(other.cam) : null;

    const [every, otherEvery, otherSlot] = this.cadence();
    const n = ++this.frameNo;
    if (wanted[lead.id] && n % every === 0) this.renderOutput(renderer, lead);
    if (wanted[other.id] && n % otherEvery === otherSlot) {
      if (share) this.drawOverlays(other);
      else this.renderOutput(renderer, other);
    }
  }

  /** Point an output's screens at a target's picture. */
  show(out, target) {
    if (out.shown === target) return;
    out.shown = target;
    for (const s of out.screens) s.material.emissiveMap = target.texture;
  }

  /** Has the picture an output's screens show been rendered yet? */
  hasPicture(out) {
    return (out.shown === this.dj.target ? this.dj : this.raver).frames > 0;
  }

  renderOutput(renderer, out) {
    const cam = this.cameraOf(out.cam);
    this.drawOverlays(out);
    this.w.viewFrom(cam); // the sky round this camera, the fog thinned for a far-out one
    this.hideForBroadcast(cam.position);
    // Point sprites (CO2 plumes, sparks, the fans' stand-ins) are sized in pixels: this target's,
    // at this camera's lens, or they'd come out ~3× too big on the screens. (Laser beams read the
    // target's size themselves.)
    const h = out.target.height;
    this.w.setPointScale(h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))));
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(out.target);
    renderer.render(this.w.scene, cam);
    renderer.setRenderTarget(prev);
    this.w.setPointScale(this.w.pointScale);
    for (const o of this.hidden) o.visible = true;
    out.frames++;
  }

  /** The screens' overlay, 5 times a second (timecode, blink); the booth monitor's only for the DJ. */
  drawOverlays(out) {
    if (!this.w.droneCam.feedOn || this.t - out.overlayAt < 0.2) return;
    out.overlayAt = this.t;
    const t = this.t;
    const s = Math.floor(t);
    const pad = (k) => String(k).padStart(2, '0');
    const dc = this.w.droneCam;
    const vip = dc.vip;
    const auto = (out.id === 'dj' ? this.state.djAuto : this.state.raverAuto) && !vip && !this.override[out.id];
    const detail = out.cam === 'drone' ? `${vip ? 'VIP SHOT' : `${MODE_LABEL[dc.state.mode]} · ${dc.state.speed.toFixed(1)}×`}  ALT ${Math.round(dc.pos.y)}M` : CAMS[out.cam].where;
    const info = {
      tc: `${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(Math.floor((t % 1) * 25))}`,
      cam: camLabel(out.cam), detail: auto ? `${detail} · AUTO` : detail, blink: t % 1 < 0.6,
      vip: vip && { name: vip.name, text: vip.text, color: vip.color },
    };
    for (const [overlay, djOnly] of out.overlays) if (!djOnly || this.w.crowd.localDJ) overlay.draw(info);
  }

  /** Ravers too far to see (a couple of pixels) and every name tag sit the broadcast render out. */
  hideForBroadcast(c) {
    const far2 = FAR_RAVER * FAR_RAVER;
    const hidden = this.hidden;
    hidden.length = 0;
    const hide = (o) => {
      if (o?.visible) {
        o.visible = false;
        hidden.push(o);
      }
    };
    const consider = (av) => {
      if (!av?.root.visible) return;
      if (av.root.position.distanceToSquared(c) > far2) return hide(av.root);
      hide(av.tagSprite); // broadcast cameras show no name tags
    };
    const crowd = this.w.crowd;
    for (const b of crowd.bots) consider(b.av);
    for (const r of crowd.remotes.values()) consider(r.av);
    consider(crowd.resident);
    consider(this.w.player?.avatar);
  }

  dispose() {
    for (const o of this.outputs || []) {
      for (const s of o.screens) s.removeFromParent();
      o.target.dispose();
    }
    for (const d of this.disposables || []) d.dispose?.();
    this.outputs = null;
  }
}
