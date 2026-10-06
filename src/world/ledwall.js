// LED video wall: four audio-reactive visual programs rendered in a shader through an
// LED pixel-grid mask, plus a text layer for the logo, now-playing and DJ announcements.

import * as THREE from 'three';
import { canvasTexture, DISPLAY_FONT, KHMER_FONT } from './textures.js';

export const LED_MODES = ['sunset', 'tunnel', 'bars', 'kaleido'];

const shared = {
  uTime: { value: 0 },
  uBass: { value: 0 },
  uKick: { value: 0 },
  uMode: { value: 0 },
  uDim: { value: 1 },
  uColA: { value: new THREE.Color('#00f0ff') },
  uColB: { value: new THREE.Color('#ff2bd6') },
  uColC: { value: new THREE.Color('#ffc400') },
  uFFT: { value: null },
  uText: { value: null },
};

const fragment = /* glsl */ `
uniform float uTime, uBass, uKick, uMode, uDim, uTextAmt, uAspect;
uniform vec2 uRes;
uniform vec3 uColA, uColB, uColC;
uniform sampler2D uFFT, uText;
varying vec2 vUv;
#define PI 3.14159265

vec3 pal(float t) { return mix(mix(uColA, uColB, smoothstep(0.0, 0.5, t)), uColC, smoothstep(0.5, 1.0, t)); }

float prang(vec2 p, float cx, float w, float h, float base) {
  float y = (p.y - base) / h;
  if (y < 0.0 || y > 1.0) return 0.0;
  float tiers = 7.0;
  float st = floor(y * tiers) / tiers;
  float prof = pow(max(0.0, 1.0 - st), 0.85) * (1.0 - 0.18 * fract(y * tiers));
  prof = max(prof, 0.06 * step(y, 0.995));
  return step(abs(p.x - cx) / w, prof);
}

float angkor(vec2 p) {
  float base = 0.2;
  float s = step(p.y, base) * step(abs(p.x - 0.5), 0.46);
  s = max(s, step(p.y, base + 0.05) * step(abs(p.x - 0.5), 0.36));
  s = max(s, prang(p, 0.5, 0.075, 0.55, base + 0.05));
  s = max(s, prang(p, 0.37, 0.058, 0.4, base + 0.05));
  s = max(s, prang(p, 0.63, 0.058, 0.4, base + 0.05));
  s = max(s, prang(p, 0.26, 0.05, 0.3, base));
  s = max(s, prang(p, 0.74, 0.05, 0.3, base));
  return s;
}

vec3 modeSunset(vec2 uv) {
  vec2 p = vec2((uv.x - 0.5) * uAspect * 0.55 + 0.5, uv.y);
  vec3 sky = mix(vec3(1.0, 0.35, 0.12), vec3(0.3, 0.0, 0.4), smoothstep(0.2, 0.75, uv.y));
  sky = mix(sky, vec3(0.03, 0.0, 0.08), smoothstep(0.7, 1.0, uv.y));
  vec2 sp = p - vec2(0.5, 0.46);
  float r = length(sp * vec2(1.0, 1.0));
  float sunR = 0.27 + 0.025 * uBass;
  float sun = smoothstep(sunR, sunR - 0.006, r);
  float stripes = step(0.42, fract((uv.y - uTime * 0.04) * 20.0));
  float cut = mix(1.0, stripes, smoothstep(0.5, 0.25, uv.y));
  vec3 sunCol = mix(vec3(1.0, 0.85, 0.2), vec3(1.0, 0.1, 0.55), smoothstep(0.7, 0.25, uv.y));
  vec3 col = mix(sky, sunCol * 1.5, sun * cut);
  col += sunCol * 0.22 * exp(-r * 4.0);
  if (uv.y < 0.2) {
    float d = 0.05 / (0.2 - uv.y + 0.008);
    vec2 g = vec2((uv.x - 0.5) * uAspect * d * 3.0, d + uTime * (1.2 + uBass));
    float gx = abs(fract(g.x) - 0.5);
    float gy = abs(fract(g.y) - 0.5);
    float ln = max(smoothstep(0.06, 0.0, gx), smoothstep(0.08, 0.0, gy));
    col = vec3(0.04, 0.0, 0.07) + uColB * ln * (0.5 + uBass);
  }
  float a = angkor(p);
  float e = clamp(abs(a - angkor(p + vec2(0.004, 0.0))) + abs(a - angkor(p + vec2(0.0, 0.007))), 0.0, 1.0);
  col = mix(col, vec3(0.012, 0.0, 0.03), a);
  col += uColA * e * (1.4 + uKick * 2.0);
  return col;
}

vec3 modeTunnel(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  float r = length(p);
  float a = atan(p.y, p.x);
  float z = 0.35 / max(r, 0.02) + uTime * (1.0 + uBass * 1.5);
  float rings = smoothstep(0.55, 0.85, abs(fract(z) - 0.5) * 2.0);
  float spokes = smoothstep(0.92, 1.0, abs(sin(a * 6.0 + uTime * 0.5)));
  vec3 col = pal(fract(z * 0.12)) * (rings * 0.9 + spokes * 0.4) * smoothstep(0.0, 0.25, r);
  col += uColA * uKick * exp(-r * 3.0) * 0.8;
  return col;
}

vec3 modeBars(vec2 uv) {
  float x = abs(uv.x - 0.5) * 2.0;
  float bins = 40.0;
  float bi = floor(x * bins);
  float bx = fract(x * bins);
  float v = texture2D(uFFT, vec2((bi + 0.5) / bins * 0.85, 0.5)).r;
  float y = abs(uv.y - 0.5) * 2.0;
  float bar = step(y, v * 0.95) * step(0.15, bx) * step(bx, 0.85);
  float seg = step(0.3, fract(y * 22.0));
  vec3 col = pal(y) * bar * seg * 1.4;
  col += pal(x) * 0.05 + uColB * uKick * 0.08;
  return col;
}

vec3 modeKaleido(vec2 uv) {
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0) * 2.0;
  float a = atan(p.y, p.x);
  float r = length(p);
  float seg = PI / 4.0;
  a = mod(a, seg * 2.0);
  a = abs(a - seg);
  p = vec2(cos(a), sin(a)) * r;
  float t = uTime * 0.4;
  float v = sin(p.x * 6.0 + t) + sin(p.y * 7.0 - t * 1.3) + sin((p.x + p.y) * 5.0 + t * 0.7) + sin(r * 10.0 - t * 2.0 - uBass * 3.0);
  vec3 col = pal(fract(v * 0.25 + t * 0.1)) * (0.55 + 0.6 * uBass);
  vec2 k = floor(uv * vec2(24.0 * uAspect, 24.0));
  col *= 0.7 + 0.3 * mod(k.x + k.y, 2.0);
  return col;
}

void main() {
  vec2 cell = vUv * uRes;
  vec2 uv = (floor(cell) + 0.5) / uRes;
  vec3 col;
  if (uMode < 0.5) col = modeSunset(uv);
  else if (uMode < 1.5) col = modeTunnel(uv);
  else if (uMode < 2.5) col = modeBars(uv);
  else col = modeKaleido(uv);
  vec4 tx = texture2D(uText, uv);
  col = mix(col * (1.0 - 0.7 * uTextAmt * tx.a), tx.rgb * 1.6, tx.a * uTextAmt);
  vec2 f = fract(cell) - 0.5;
  float dotMask = smoothstep(0.5, 0.28, max(abs(f.x), abs(f.y)));
  col *= (0.3 + 0.7 * dotMask) * uDim;
  gl_FragColor = vec4(col * 0.8, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class LedWall {
  constructor() {
    this.fftTex = new THREE.DataTexture(new Uint8Array(64), 64, 1, THREE.RedFormat);
    this.fftTex.needsUpdate = true;
    this.textCanvas = document.createElement('canvas');
    this.textCanvas.width = 1024;
    this.textCanvas.height = 448;
    this.textTex = canvasTexture(this.textCanvas);
    shared.uFFT.value = this.fftTex;
    shared.uText.value = this.textTex;
    this.materials = [];
    this.textAmt = 0;
    this.textHold = 0;
    this.mode = 0;
    this.setText(['E-RAVE', 'CAMBODIA'], 'កម្ពុជា');
  }

  material(aspect, resX, withText = true) {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uAspect: { value: aspect },
        uRes: { value: new THREE.Vector2(resX, Math.round(resX / aspect)) },
        uTextAmt: { value: 0 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: fragment,
    });
    m.userData.withText = withText;
    this.materials.push(m);
    return m;
  }

  /** Draw lines of text into the overlay layer (shown for `hold` seconds, or periodically for the logo). */
  setText(lines, khmer = '', hold = 0) {
    const c = this.textCanvas;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const n = lines.length + (khmer ? 1 : 0);
    const size = n <= 2 ? 150 : n === 3 ? 110 : 84;
    let y = c.height / 2 - ((n - 1) * size * 0.95) / 2;
    const draw = (text, font, color) => {
      ctx.font = font;
      ctx.shadowColor = color;
      ctx.shadowBlur = 24;
      ctx.fillStyle = color;
      ctx.fillText(text, c.width / 2, y, c.width - 60);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, c.width / 2, y, c.width - 60);
      y += size * 0.95;
    };
    lines.forEach((l, i) => draw(l, `${size}px ${DISPLAY_FONT}`, i % 2 ? '#ff2bd6' : '#00f0ff'));
    if (khmer) draw(khmer, `${Math.round(size * 0.8)}px ${KHMER_FONT}`, '#ffc400');
    this.textTex.needsUpdate = true;
    this.textHold = hold;
  }

  setMode(i) {
    this.mode = ((i % LED_MODES.length) + LED_MODES.length) % LED_MODES.length;
    shared.uMode.value = this.mode;
  }

  update(dt, t, M, mood, palette) {
    shared.uTime.value = t;
    shared.uBass.value = M.bass;
    shared.uKick.value = M.kick;
    shared.uDim.value = mood.ledDim;
    shared.uColA.value.copy(palette[0]);
    shared.uColB.value.copy(palette[1]);
    shared.uColC.value.copy(palette[2] || palette[0]);
    this.fftTex.image.data.set(M.fft);
    this.fftTex.needsUpdate = true;

    let target;
    if (this.textHold > 0) {
      this.textHold -= dt;
      target = 1;
      if (this.textHold <= 0) this.setText(['E-RAVE', 'CAMBODIA'], 'កម្ពុជា');
    } else {
      // Logo flashes in for 4 beats out of every 32.
      target = M.beatCount % 32 < 4 ? 0.9 : 0;
    }
    this.textAmt += (target - this.textAmt) * Math.min(1, dt * 6);
    for (const m of this.materials) m.uniforms.uTextAmt.value = m.userData.withText ? this.textAmt : 0;
  }
}
