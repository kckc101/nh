// Atmosphere: the haze and the backlight that make the beams read.
//   • GroundFog: two thin layers of drifting haze over the pitch, tinted by the palette and lit
//     where the moving heads hit the floor (the same spot list the dance floor uses), so every
//     sweep catches in the air above it.
//   • BoothBacklight: a hot glow with radiating rays behind the DJ booth, so the DJ and the
//     deck read as a black silhouette against it.
// Both are unlit additive shaders on flat quads (no lights, no extra passes); the bloom pass
// does the rest. Nothing is allocated per frame.

import * as THREE from 'three';
import { MAX_SPOTS } from './shaders.js';
import { CENTER_Z } from './venue.js';

const fogMaterial = (uSpots, uSpotCols, useSpots, scroll, scale) =>
  new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uColA: { value: new THREE.Color() },
      uColB: { value: new THREE.Color() },
      uSpots: { value: uSpots },
      uSpotCols: { value: uSpotCols },
      uUseSpots: { value: useSpots ? 1 : 0 },
      uScroll: { value: new THREE.Vector2(...scroll) },
      uScale: { value: scale },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uLevel, uUseSpots, uScale;
      uniform vec2 uScroll;
      uniform vec3 uColA, uColB;
      uniform vec4 uSpots[${MAX_SPOTS}];
      uniform vec3 uSpotCols[${MAX_SPOTS}];
      varying vec3 vW;
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 p = vW.xz * uScale + uScroll * uTime;
        float n = 0.55 * vn(p) + 0.3 * vn(p * 2.1 + 7.3) + 0.15 * vn(p * 4.3 - 3.1);
        float density = smoothstep(0.32, 0.85, n);
        // Fade out towards the edge of the pitch and the track.
        vec2 q = (vW.xz - vec2(0.0, ${CENTER_Z.toFixed(1)} + 8.0)) / vec2(50.0, 70.0);
        float edge = smoothstep(1.0, 0.45, length(q));
        vec3 col = mix(uColA, uColB, n) * uLevel * 0.2;
        if (uUseSpots > 0.5) {
          for (int i = 0; i < ${MAX_SPOTS}; i++) {
            vec4 s = uSpots[i];
            float d = distance(vW.xz, s.xy);
            col += uSpotCols[i] * s.w * smoothstep(s.z * 1.6, s.z * 0.1, d) * 0.55;
          }
        }
        float a = density * edge;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * a, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

const backlightMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uColA: { value: new THREE.Color() },
      uColB: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uLevel;
      uniform vec3 uColA, uColB;
      varying vec2 vUv;
      void main() {
        vec2 c = (vUv - vec2(0.5, 0.38)) * vec2(1.0, 1.45);
        float d = length(c);
        float glow = pow(smoothstep(0.5, 0.0, d), 1.7);
        float ang = atan(c.y, c.x);
        float rays = pow(abs(sin(ang * 9.0 + uTime * 0.35)), 10.0) * smoothstep(0.5, 0.05, d);
        float hot = pow(smoothstep(0.2, 0.0, d), 2.0);
        vec3 col = mix(uColA, uColB, vUv.y) * (glow * 0.9 + rays * 0.7) + vec3(1.0) * hot * 0.35;
        gl_FragColor = vec4(max(col, vec3(0.0)) * uLevel, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

export class Atmosphere {
  constructor(scene, lights) {
    this.lite = false;
    this.fog = [
      { y: 0.5, mat: fogMaterial(lights.spots, lights.spotCols, true, [0.05, 0.02], 0.045) },
      { y: 2.1, mat: fogMaterial(lights.spots, lights.spotCols, false, [-0.035, 0.05], 0.06) },
    ].map(({ y, mat }) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(120, 150), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, y, CENTER_Z + 8);
      m.renderOrder = 1;
      scene.add(m);
      return m;
    });
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(18, 11), backlightMaterial());
    this.back.position.set(0, 8, -34.8); // behind the booth (the DJ faces +z), in front of the LED wall
    this.back.renderOrder = 1;
    scene.add(this.back);
  }

  /** Weak-GPU tier: one layer of haze, no spot lookups in the shader. */
  setLite(on) {
    this.lite = on;
  }

  update(t, M, mood, palette, dt = 0) {
    const dim = mood.floorDim;
    // The haze drifts on its own clock: slower in a breakdown (mood.fogFlow), and thicker (mood.haze).
    this.fogT = (this.fogT ?? t) + dt * (mood.fogFlow ?? 1);
    const level = (0.3 + 0.8 * mood.lights + 0.5 * M.kick * mood.lights + mood.flash * 0.4) * dim * (mood.haze ?? 1);
    this.fog.forEach((f, i) => {
      f.visible = !(this.lite && i > 0) && level > 0.01;
      const u = f.material.uniforms;
      u.uTime.value = this.fogT;
      u.uLevel.value = level;
      u.uColA.value.copy(palette[0]);
      u.uColB.value.copy(palette[1]);
      u.uUseSpots.value = this.lite ? 0 : i === 0 ? 1 : 0;
    });
    const b = this.back.material.uniforms;
    b.uTime.value = t;
    b.uLevel.value = (0.25 + 0.5 * mood.lights + 0.9 * M.kick * mood.lights + mood.flash * 0.8) * dim;
    b.uColA.value.copy(palette[0]);
    b.uColB.value.copy(palette[2] || palette[1]);
    this.back.visible = b.uLevel.value > 0.01;
  }
}
