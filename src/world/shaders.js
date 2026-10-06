// Custom materials: volumetric light beams, the reactive dance floor, night sky,
// procedural city windows and soft particle sprites.

import * as THREE from 'three';

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/** Additive fake-volumetric cone. Brightest at the source, soft at the silhouette edges. */
export function beamMaterial(color, intensity = 1, flip = 0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uFlip: { value: flip },
    },
    vertexShader: /* glsl */ `
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        vAlong = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity; uniform float uFlip;
      varying float vAlong; varying vec3 vN; varying vec3 vV;
      void main() {
        float a = mix(vAlong, 1.0 - vAlong, uFlip);
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
        gl_FragColor = vec4(uColor * uIntensity * edge * pow(a, 1.6), 1.0);
        ${OUTPUT}
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export const MAX_SPOTS = 16;

/** Festival ground + LED dance floor: neon grid, bass rings from the stage, beam light pools. */
export function floorMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uFlash: { value: 0 },
        uDim: { value: 1 },
        uColA: { value: new THREE.Color('#00f0ff') },
        uColB: { value: new THREE.Color('#ff2bd6') },
        uRings: { value: [-100, -100, -100, -100] },
        uSpots: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4()) },
        uSpotCols: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Color()) },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uBass, uFlash, uDim;
      uniform vec3 uColA, uColB;
      uniform float uRings[4];
      uniform vec4 uSpots[${MAX_SPOTS}];
      uniform vec3 uSpotCols[${MAX_SPOTS}];
      varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      float gridLine(vec2 p, float w) {
        vec2 d = max(fwidth(p), vec2(1e-4));
        vec2 g = abs(fract(p - 0.5) - 0.5) / d;
        return 1.0 - min(min(g.x, g.y) / w, 1.0);
      }
      void main() {
        vec2 p = vW.xz;
        vec2 q = abs(p - vec2(0.0, 6.0)) - vec2(34.0, 24.5);
        float box = max(q.x, q.y);
        float inside = 1.0 - smoothstep(0.0, 1.5, box);
        float n = fract(sin(dot(floor(p * 1.5), vec2(12.9898, 78.233))) * 43758.5453);
        vec3 col = vec3(0.016, 0.011, 0.026) + n * 0.008;
        vec3 lineCol = mix(uColA, uColB, 0.5 + 0.5 * sin(p.x * 0.07 + uTime * 0.5));
        float gl = gridLine(p / 2.5, 1.3);
        float r = length(p - vec2(0.0, -21.0));
        float rings = 0.0;
        for (int i = 0; i < 4; i++) {
          float age = uTime - uRings[i];
          if (age < 0.0 || age > 3.0) continue;
          rings += smoothstep(1.8, 0.0, abs(r - age * 26.0)) * exp(-age * 1.4);
        }
        float tile = mod(floor(p.x / 2.5) + floor(p.y / 2.5), 2.0);
        col += inside * (vec3(0.014, 0.009, 0.024) * tile
             + lineCol * gl * (0.05 + 0.3 * uBass) * uDim
             + lineCol * rings * 0.35 * uDim);
        col += smoothstep(0.45, 0.0, abs(box)) * lineCol * 0.5 * uDim;
        for (int i = 0; i < ${MAX_SPOTS}; i++) {
          vec4 s = uSpots[i];
          if (s.w <= 0.001) continue;
          float dd = length(p - s.xy);
          col += uSpotCols[i] * s.w * smoothstep(s.z, s.z * 0.15, dd) * 0.4;
        }
        col += uFlash * vec3(0.16);
        gl_FragColor = vec4(col, 1.0);
        ${OUTPUT}
        #include <fog_fragment>
      }`,
  });
}

export function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBass: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uBass;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(vec3(0.3, 0.05, 0.26), vec3(0.05, 0.012, 0.09), smoothstep(-0.02, 0.18, h));
        col = mix(col, vec3(0.006, 0.004, 0.025), smoothstep(0.15, 0.7, h));
        vec2 uv = vec2(atan(d.z, d.x) * 60.0, h * 120.0);
        vec2 cell = floor(uv);
        float r = hash(cell);
        float star = step(0.986, r) * smoothstep(0.12, 0.0, length(fract(uv) - 0.5)) * smoothstep(0.05, 0.3, h);
        star *= 0.6 + 0.4 * sin(uTime * (2.0 + r * 5.0) + r * 50.0);
        col += vec3(0.9, 0.85, 1.0) * star * 1.4;
        vec3 md = normalize(vec3(-0.55, 0.42, -0.72));
        float m = dot(d, md);
        col += vec3(1.0, 0.92, 0.8) * smoothstep(0.99955, 0.9997, m) * 1.6;
        col += vec3(0.35, 0.25, 0.5) * pow(max(m, 0.0), 300.0) * 0.6;
        col += vec3(0.6, 0.12, 0.45) * exp(-max(h, 0.0) * 12.0) * (0.22 + 0.1 * uBass);
        col = mix(col, vec3(0.02, 0.01, 0.03), smoothstep(0.0, -0.1, h));
        gl_FragColor = vec4(col, 1.0);
        ${OUTPUT}
      }`,
    side: THREE.BackSide,
    depthWrite: false,
  });
}

/** City skyline with procedurally lit windows (works with InstancedMesh). */
export function buildingMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying float vId;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
          vId = float(gl_InstanceID);
        #else
          vId = 0.0;
        #endif
        vec4 w = m * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(m) * normal);
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vW; varying vec3 vN; varying float vId;
      #include <common>
      #include <fog_pars_fragment>
      float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec3 col = vec3(0.025, 0.02, 0.04);
        float side = step(abs(vN.y), 0.5);
        float u = abs(vN.x) > 0.5 ? vW.z : vW.x;
        vec2 g = vec2(u / 1.8, vW.y / 2.4);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float lit = step(0.62, h21(cell + vId * 13.1));
        float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75);
        float flick = 0.85 + 0.15 * sin(uTime * 0.5 + h21(cell) * 40.0);
        vec3 wc = mix(vec3(1.0, 0.72, 0.38), vec3(0.4, 0.8, 1.0), step(0.85, h21(cell * 1.7 + vId)));
        col += side * win * lit * wc * 0.9 * flick * step(1.0, vW.y);
        gl_FragColor = vec4(col, 1.0);
        ${OUTPUT}
        #include <fog_fragment>
      }`,
  });
}

/** Round soft point sprites with per-point size/alpha/colour (particles, festoon bulbs). */
export function pointsMaterial(map, blending = THREE.AdditiveBlending) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uScale: { value: 400 } },
    vertexShader: /* glsl */ `
      attribute float size; attribute float alpha; attribute vec3 pcolor;
      uniform float uScale;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * uScale / max(0.1, -mv.z);
        gl_Position = projectionMatrix * mv;
        vColor = pcolor;
        vAlpha = alpha;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec3 vColor; varying float vAlpha;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        float a = t.a * vAlpha;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vColor * t.rgb, a);
        ${OUTPUT}
      }`,
    transparent: true,
    depthWrite: false,
    blending,
  });
}

export function hdr(color, k) {
  return new THREE.Color(color).multiplyScalar(k);
}

export function glowMaterial(color, k = 2) {
  return new THREE.MeshBasicMaterial({ color: hdr(color, k) });
}
