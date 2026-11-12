// The cinematic look: one full-screen pass after the bloom and tone mapping (no extra render of
// the scene), on the frame as it'll be shown.
//
//   grade        a filmic S-curve, a split tone (cool deep-blue shadows, warm highlights) and a
//                little more colour in the mids, so the neon reads rich, not flat
//   streaks      anamorphic lens flares: the bloom's own bright pass smeared far sideways,
//                tinted cold, so every beam head, strobe and LED throws a horizontal streak
//   lens         a soft vignette, colour fringing toward the edges (a hair more on the kick)
//   grain        fine animated film grain, heavier in the shadows
//   letterbox    2.39:1 bars that glide in for the big moments: the arrival shot, riding the
//                drone, a VIP show
//
// It follows the music: punchier contrast and longer streaks on a drop, a moodier vignette in a
// breakdown. Settings → "Cinematic look" turns it off; it goes with the bloom when the
// performance governor drops post-processing on a weak GPU.

import * as THREE from 'three';

export const CinematicShader = {
  name: 'CinematicShader',
  uniforms: {
    tDiffuse: { value: null },
    tStreak: { value: null },
    uStreakTexel: { value: new THREE.Vector2(1 / 480, 1 / 270) },
    uStreak: { value: 0.3 },
    uRes: { value: new THREE.Vector2(1920, 1080) },
    uTime: { value: 0 },
    uContrast: { value: 0.3 },
    uSat: { value: 1.08 },
    uVignette: { value: 0.4 },
    uFringe: { value: 0.006 },
    uGrain: { value: 0.035 },
    uLetterbox: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tStreak;
    uniform vec2 uStreakTexel, uRes;
    uniform float uStreak, uTime, uContrast, uSat, uVignette, uFringe, uGrain, uLetterbox;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float aspect = uRes.x / uRes.y;
      // Letterbox: outside the 2.39:1 frame, black (skip the rest).
      float bar = uLetterbox * max(0.0, 1.0 - aspect / 2.39) * 0.5;
      float frame = smoothstep(bar, bar + 0.003, vUv.y) * smoothstep(bar, bar + 0.003, 1.0 - vUv.y);
      if (frame <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

      // Lens: colour fringing grows toward the edges.
      float r2 = dot(d, d);
      vec2 off = d * r2 * uFringe; // ~3 px in the corners, nothing in the middle
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);

      // Anamorphic streaks: the bright pass, smeared far sideways (about ±100 px).
      vec3 s = vec3(0.0);
      float wsum = 0.0;
      for (int i = -7; i <= 7; i++) {
        float fi = float(i);
        float w = exp(-abs(fi) * 0.22);
        s += texture2D(tStreak, vUv + vec2(fi * uStreakTexel.x * 6.0, 0.0)).rgb * w;
        wsum += w;
      }
      s = s * (3.0 / wsum);
      s = s / (1.0 + s); // it's linear HDR: tame it before adding to the shown frame
      c += s * vec3(0.55, 0.78, 1.15) * uStreak;

      // Grade: saturation, a filmic S-curve, cool shadows and warm highlights.
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      vec3 cc = clamp(c, 0.0, 1.0);
      c = mix(c, cc * cc * (3.0 - 2.0 * cc), uContrast);
      c += vec3(-0.012, 0.012, 0.045) * (1.0 - smoothstep(0.0, 0.45, l));
      c += vec3(0.04, 0.012, -0.025) * smoothstep(0.55, 1.0, l);

      // Vignette: round on any screen (distance in real proportions, 1 at the corners), then
      // grain, heavier in the dark.
      vec2 dp = d * vec2(aspect, 1.0);
      float v = length(dp) / length(vec2(aspect, 1.0) * 0.5);
      c *= 1.0 - uVignette * smoothstep(0.45, 1.0, v);
      float g = hash(floor(vUv * uRes) + fract(uTime * 7.31) * 113.0) - 0.5;
      c += g * uGrain * (1.15 - l);

      gl_FragColor = vec4(clamp(c, 0.0, 1.0) * frame, 1.0);
    }`,
};

/** Drives the pass from the music and the moment. */
export class CinematicLook {
  constructor() {
    this.letterbox = 0;
    this.kickFringe = 0;
  }

  /**
   * @param pass   the ShaderPass (CinematicShader)
   * @param bloom  the UnrealBloomPass whose blurred bright pass feeds the streaks
   * @param moment true during the arrival shot, the drone view or a VIP show (letterbox in)
   */
  update(pass, bloom, dt, t, M, mood, { moment, reduceFlash }) {
    const u = pass.uniforms;
    const src = bloom?.renderTargetBright; // the bright pass before any blur: crisp streaks through each light
    if (src) {
      u.tStreak.value = src.texture;
      u.uStreakTexel.value.set(1 / src.width, 1 / src.height);
    }
    const lights = mood.lights;
    this.letterbox += ((moment ? 1 : 0) - this.letterbox) * Math.min(1, dt * 1.8);
    this.kickFringe = Math.max(M.kick * lights, this.kickFringe - dt * 4);
    u.uTime.value = t;
    u.uLetterbox.value = this.letterbox < 0.003 ? 0 : this.letterbox;
    u.uStreak.value = (0.3 + 0.35 * lights + 0.35 * mood.strobe + 0.25 * mood.blinder) * (reduceFlash ? 0.45 : 1) * (bloom ? 1 : 0);
    u.uContrast.value = 0.22 + 0.16 * lights; // punchier on the drop
    u.uVignette.value = 0.32 + 0.22 * (1 - lights) + 0.15 * this.letterbox; // moodier in the breakdowns
    u.uFringe.value = 0.005 + 0.006 * this.kickFringe;
  }

  setSize(pass, w, h) {
    pass.uniforms.uRes.value.set(w, h);
  }
}
