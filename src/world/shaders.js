// Custom materials: volumetric light beams, the reactive dance floor, night sky,
// procedural city windows and soft particle sprites.

import * as THREE from 'three';
import { CENTER_Z, STRAIGHT, TRACK, DANCE_FLOOR } from './venue.js';

/**
 * The crowd's own glow (Arena Blackout): one shared uniform, 1 normally, eased to 0 by World. It
 * scales the stand fans' sky light, palette rims, LED tops, phone torches and glowsticks, and the
 * avatars' unlit extras (VIP aura, profile photo) — never the stage's light on them.
 */
export const crowdGlow = { value: 1 };

/** Make an unlit material fade with the crowd's glow (Arena Blackout): its output × uCrowdGlow. */
export function withCrowdGlow(m) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCrowdGlow = crowdGlow;
    sh.fragmentShader = `uniform float uCrowdGlow;\n${sh.fragmentShader.replace(/}\s*$/, '  gl_FragColor.rgb *= uCrowdGlow;\n}')}`;
  };
  return m;
}

const OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/**
 * Additive fake-volumetric cone. Brightest at the source (a hot core), soft at the silhouette
 * edges. On an InstancedMesh each instance gets its own placement and colour (instanceColor:
 * colour × intensity), so a whole rig of beams is one draw. `dust` (0–1) drifts haze through the
 * beam: bands crawling along it and round it, driven by uTime.
 */
export function beamMaterial(color, intensity = 1, flip = 0, dust = 0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uFlip: { value: flip },
      uDust: { value: dust },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying float vAlong; varying vec3 vN; varying vec3 vV; varying vec3 vTint; varying vec2 vUv;
      void main() {
        vAlong = uv.y;
        vUv = uv;
        vec4 p = vec4(position, 1.0);
        vec3 n = normal;
        vTint = vec3(1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vTint = instanceColor;
        #endif
        vec4 mv = modelViewMatrix * p;
        vN = normalize(normalMatrix * n);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uIntensity; uniform float uFlip; uniform float uDust; uniform float uTime;
      varying float vAlong; varying vec3 vN; varying vec3 vV; varying vec3 vTint; varying vec2 vUv;
      void main() {
        float a = clamp(mix(vAlong, 1.0 - vAlong, uFlip), 0.0, 1.0); // pow() of a hair below 0 is NaN
        float nl = length(vN);
        float edge = nl > 1e-5 ? pow(abs(dot(vN / nl, normalize(vV))), 2.2) : 0.0;
        float core = 1.0 + 2.2 * pow(a, 9.0) * uDust;                       // hot where the beam leaves the lens
        float haze = 1.0 + uDust * (0.55 * sin(vUv.x * 50.27 + a * 17.0 - uTime * 2.1) * sin(a * 33.0 + uTime * 1.4)
                                    + 0.25 * sin(vUv.x * 18.85 - a * 9.0 + uTime * 0.9));
        gl_FragColor = vec4(uColor * uIntensity * vTint * edge * pow(a, 1.6) * core * max(haze, 0.15), 1.0);
        ${OUTPUT}
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export const MAX_SPOTS = 26;

/**
 * Post-processing guard, run before the bloom: a NaN / Inf pixel (from any shader, on any GPU)
 * would be blurred by the bloom across the whole screen and blank it, so it's dropped; HDR
 * values are clamped to a sane ceiling so no stack of additive lights can overflow.
 */
export const SanitizeShader = {
  name: 'SanitizeShader',
  uniforms: { tDiffuse: { value: null }, uMax: { value: 64 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, uMax), clamp(c.a, 0.0, 1.0));
    }`,
};

/**
 * Stadium floor (venue.js layout): the pitch at night — mown stripes and dim white markings —
 * with the neon LED dance floor (grid, beat tiles, bass rings from the stage) over its north
 * half, the athletics track around it, concrete beyond, and the moving heads' light pools.
 */
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
        uKick: { value: 0 },
        uBeat: { value: 0 },
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
      uniform float uTime, uBass, uFlash, uDim, uKick, uBeat;
      uniform vec3 uColA, uColB;
      uniform float uRings[4];
      uniform vec4 uSpots[${MAX_SPOTS}];
      uniform vec3 uSpotCols[${MAX_SPOTS}];
      varying vec3 vW;
      #include <common>
      #include <fog_pars_fragment>
      const float CZ = ${CENTER_Z.toFixed(2)};
      const float L = ${STRAIGHT.toFixed(2)};
      // A painted line of width w (metres) at v == at, anti-aliased.
      float ln(float v, float at, float w) {
        float a = max(fwidth(v), 1e-4);
        return 1.0 - smoothstep(w * 0.5, w * 0.5 + a * 1.5, abs(v - at));
      }
      float gridLine(vec2 p, float w) {
        vec2 d = max(fwidth(p), vec2(1e-4));
        vec2 g = abs(fract(p - 0.5) - 0.5) / d;
        return 1.0 - min(min(g.x, g.y) / w, 1.0);
      }
      void main() {
        vec2 p = vW.xz;
        float dz = p.y - CZ;
        float d = length(vec2(p.x, dz - clamp(dz, -L, L)));
        float n = fract(sin(dot(floor(p * 1.5), vec2(12.9898, 78.233))) * 43758.5453);
        vec3 col;
        if (d < ${TRACK.inner.toFixed(2)}) {
          // Turf: mown stripes, night-dark.
          float stripe = mod(floor((dz + 52.5) / 5.25), 2.0);
          col = mix(vec3(0.004, 0.011, 0.007), vec3(0.006, 0.016, 0.010), stripe) + n * 0.003;
          // Pitch markings.
          float ax = abs(p.x);
          float az = abs(dz);
          float m = 0.0;
          m += ln(ax, 34.0, 0.12) * step(az, 52.56);
          m += ln(az, 52.5, 0.12) * step(ax, 34.06);
          m += ln(dz, 0.0, 0.12) * step(ax, 34.0);
          m += ln(length(vec2(p.x, dz)), 9.15, 0.12);
          m += ln(az, 36.0, 0.12) * step(ax, 20.16);
          m += ln(ax, 20.16, 0.12) * step(36.0, az) * step(az, 52.5);
          m += ln(az, 47.0, 0.12) * step(ax, 9.16);
          m += ln(ax, 9.16, 0.12) * step(47.0, az) * step(az, 52.5);
          m += ln(length(vec2(p.x, az - 41.5)), 9.15, 0.12) * step(az, 36.0);
          col += vec3(0.05, 0.06, 0.07) * min(m, 1.0);
        } else if (d < ${TRACK.outer.toFixed(2)}) {
          // Athletics track: dark red, faint lane lines.
          col = vec3(0.022, 0.004, 0.006) + n * 0.004;
          col += vec3(0.03) * ln(fract((d - ${TRACK.inner.toFixed(2)}) / 1.22), 0.0, 0.05 / 1.22);
        } else {
          col = vec3(0.006, 0.007, 0.012) + n * 0.003;
        }
        // Neon LED dance floor over the pitch in front of the stage.
        vec2 q = abs(p - vec2(0.0, ${((DANCE_FLOOR.minZ + DANCE_FLOOR.maxZ) / 2).toFixed(2)})) - vec2(${DANCE_FLOOR.maxX.toFixed(1)}, ${((DANCE_FLOOR.maxZ - DANCE_FLOOR.minZ) / 2).toFixed(2)});
        float box = max(q.x, q.y);
        float inside = 1.0 - smoothstep(0.0, 1.5, box);
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
        vec2 tc = floor(p / 2.5);
        float pick = fract(sin(dot(tc + floor(uBeat) * 1.37, vec2(41.3, 289.1))) * 43758.5453);
        col += inside * step(0.93, pick) * mix(uColA, uColB, fract(pick * 7.0)) * uKick * 0.22 * uDim;
        col += inside * (vec3(0.005, 0.003, 0.010) * tile
             + lineCol * gl * (0.015 + 0.1 * uBass) * uDim
             + lineCol * rings * 0.18 * uDim);
        col += smoothstep(0.45, 0.0, abs(box)) * lineCol * 0.2 * uDim;
        for (int i = 0; i < ${MAX_SPOTS}; i++) {
          vec4 s = uSpots[i];
          if (s.w <= 0.001) continue;
          float dd = length(p - s.xy);
          col += uSpotCols[i] * s.w * smoothstep(s.z, s.z * 0.15, dd) * 0.3;
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
    uniforms: { uTime: { value: 0 }, uBass: { value: 0 }, uLevel: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uBass, uLevel;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        // Dark navy fading to black, a faint city glow on the horizon.
        vec3 col = mix(vec3(0.016, 0.026, 0.06), vec3(0.004, 0.008, 0.024), smoothstep(-0.02, 0.18, h));
        col = mix(col, vec3(0.0006, 0.001, 0.005), smoothstep(0.15, 0.7, h));
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
        col += vec3(0.05, 0.25, 0.4) * exp(-max(h, 0.0) * 14.0) * (0.05 + 0.04 * uBass);
        col += vec3(0.5, 0.05, 0.3) * exp(-max(h, 0.0) * 30.0) * 0.03;
        col = mix(col, vec3(0.006, 0.008, 0.02), smoothstep(0.0, -0.1, h));
        col = mix(vec3(0.0006, 0.0006, 0.0015), col, uLevel); // Arena Blackout: #020205, no stars, no moon
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
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLevel: { value: 1 } }]),
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
      uniform float uTime, uLevel;
      varying vec3 vW; varying vec3 vN; varying float vId;
      #include <common>
      #include <fog_pars_fragment>
      float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        vec3 col = vec3(0.01, 0.008, 0.018);
        float side = step(abs(vN.y), 0.5);
        float u = abs(vN.x) > 0.5 ? vW.z : vW.x;
        vec2 g = vec2(u / 1.8, vW.y / 2.4);
        vec2 cell = floor(g);
        vec2 f = fract(g);
        float lit = step(0.74, h21(cell + vId * 13.1));
        float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75);
        float flick = 0.85 + 0.15 * sin(uTime * 0.5 + h21(cell) * 40.0);
        vec3 wc = mix(vec3(1.0, 0.72, 0.38), vec3(0.4, 0.8, 1.0), step(0.85, h21(cell * 1.7 + vId)));
        col += side * win * lit * wc * 0.5 * flick * step(1.0, vW.y);
        col = mix(vec3(0.0006, 0.0006, 0.0015), col, uLevel); // Arena Blackout: the city's windows go out
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

/** LED halo ring (TorusGeometry): pixel segments with a colour chase that kicks with the bass. */
export function haloMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 1 },
      uKick: { value: 0 },
      uSeg: { value: 72 },
      uColA: { value: new THREE.Color('#00f0ff') },
      uColB: { value: new THREE.Color('#ff2bd6') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uLevel, uKick, uSeg;
      uniform vec3 uColA, uColB;
      varying vec2 vUv;
      void main() {
        float cell = fract(vUv.x * uSeg);
        float pixel = smoothstep(0.0, 0.14, cell) * smoothstep(1.0, 0.86, cell);
        float chase = 0.5 + 0.5 * sin(vUv.x * 6.2831853 * 3.0 - uTime * 4.0);
        vec3 col = mix(uColA, uColB, chase);
        float k = 0.25 + 0.75 * pow(max(chase, 0.0), 3.0) + uKick * 0.8;
        gl_FragColor = vec4(col * k * (0.2 + 0.8 * pixel) * uLevel * 1.4, 1.0);
        ${OUTPUT}
      }`,
  });
}

/**
 * Laser "liquid sky": a horizontal sheet just above the crowd's heads. Thin contour lines of a
 * drifting wave field, brightest near the stage (where the lasers would come from).
 */
export function sheetMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: 0 },
      uColA: { value: new THREE.Color('#00f0ff') },
      uColB: { value: new THREE.Color('#9dff00') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uLevel;
      uniform vec3 uColA, uColB;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz;
        float n = sin(p.x * 0.21 + uTime * 0.9) * 1.6 + sin(p.y * 0.17 - uTime * 0.7) * 1.9
                + sin((p.x - p.y) * 0.11 + uTime * 0.5) * 1.3;
        float f = n * 1.1;
        float d = abs(fract(f + 0.5) - 0.5);
        float line = 1.0 - smoothstep(0.0, max(fwidth(f) * 1.5, 1e-4), d); // equal edges are undefined
        float ex = smoothstep(34.0, 26.0, abs(p.x));
        float ez = smoothstep(-19.0, -14.0, p.y) * smoothstep(42.0, 32.0, p.y);
        float fall = mix(1.0, 0.4, clamp((p.y + 18.0) / 58.0, 0.0, 1.0));
        vec3 col = mix(uColA, uColB, 0.5 + 0.5 * sin(n * 0.7 + uTime));
        gl_FragColor = vec4(col * (line * 0.9 + 0.025) * uLevel * ex * ez * fall, 1.0);
        ${OUTPUT}
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/**
 * Stadium bowl. aData = (kind, v, rows, s): kind 0 seats, 1 inner wall / fascia, 2 flat
 * (concourse, rim), 3 outer facade; v runs 0→1 across the segment; rows = seat rows; s =
 * metres around the bowl. Deep navy with seat rows and stair aisles, washed by the stage light
 * from below, neon rim lines on the fascias and light fins on the facade.
 */
export function standMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uWash: { value: 1 },
        uKick: { value: 0 },
        uColA: { value: new THREE.Color('#00f3ff') },
        uColB: { value: new THREE.Color('#ff007f') },
        uVip: { value: new THREE.Vector4() }, // VIP spotlight: xyz = the buyer, w = how far in
        uLed: { value: 1 }, // the aisle / row / concourse LED strips (dimmed in an Arena Blackout)
      },
    ]),
    vertexShader: /* glsl */ `
      attribute vec4 aData;
      attribute float aStep;
      varying vec4 vData;
      varying float vStep;
      varying vec3 vW;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vData = aData;
        vStep = aStep;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWash, uKick, uLed;
      uniform vec3 uColA, uColB;
      uniform vec4 uVip;
      varying vec4 vData;
      varying float vStep;
      varying vec3 vW;
      // A thin line across t in [a, b], anti-aliased, and fading (not shimmering) once it's thinner than a pixel.
      float ledLine(float t, float a, float b) {
        float w = fwidth(t) + 1e-4;
        return smoothstep(a - w, a, t) * (1.0 - smoothstep(b, b + w, t)) * min(1.0, (b - a) / w);
      }
      #include <common>
      #include <fog_pars_fragment>
      float vipPool(vec3 p, vec4 vip) { return vip.w * smoothstep(5.5, 1.2, distance(p.xz, vip.xz)) * step(abs(p.y - vip.y), 4.0); }
      void main() {
        float kind = vData.x;
        float v = vData.y;
        float rows = vData.z;
        float s = vData.w;
        vec3 col = vec3(0.008, 0.010, 0.022);
        vec3 neon = mix(uColA, uColB, 0.5 + 0.5 * sin(s * 0.012 + uTime * 0.35));
        if (kind < 0.5) {
          // Real steps: level treads (vStep 0) and risers (vStep 1 + t, t up the riser).
          float riser = step(0.5, vStep);
          float rt = clamp(vStep - 1.0, 0.0, 1.0);
          float r = fract(v * rows);
          float aisleM = abs(fract(s / 16.0) - 0.5) * 16.0; // metres from a stair aisle's centre line
          float aisle = 1.0 - smoothstep(0.7, 0.85, aisleM);
          float back = (1.0 - riser) * (1.0 - aisle) * smoothstep(0.6, 0.7, r) * (1.0 - smoothstep(0.9, 1.0, r)); // seat backs, far away
          float block = fract(sin(floor(s / 16.0) * 17.3) * 431.7);
          vec3 seat = mix(vec3(0.010, 0.016, 0.040), vec3(0.020, 0.010, 0.032), step(0.5, block));
          col = mix(col, seat, back) + vec3(0.02, 0.022, 0.03) * aisle * (1.0 - riser) + vec3(0.004, 0.005, 0.01) * riser;
          // Light from the stage and the pitch, strongest on the low rows.
          col += neon * uWash * exp(-vW.y * 0.06) * (0.05 + 0.08 * uKick);
          // LED house lighting, kept low so the eye goes to the stage: a faint cyan line along each
          // row's nosing, and soft step lights on the risers of the stair aisles. All of it stays
          // under the bloom's threshold (no halos): enough to find your way, never a show of its own.
          vec3 led = vec3(0.0, 1.0, 1.0);
          float nose = riser * ledLine(rt, 0.86, 0.97);
          float stepLight = riser * aisle * ledLine(rt, 0.3, 0.72);
          col += led * uLed * (nose * mix(0.05, 0.14, aisle) + stepLight * 0.2);
        } else if (kind < 1.5) {
          // Fascia: neon line along the top edge.
          float edge = smoothstep(0.84, 0.95, v) * (1.0 - smoothstep(0.97, 1.0, v));
          col += neon * edge * (0.8 + 1.4 * uKick) * 1.3;
        } else if (kind < 2.5) {
          col += vec3(0.006, 0.007, 0.012);
          // The concourses between the tiers: an LED strip along the front edge (the main walkways).
          col += vec3(0.0, 1.0, 1.0) * 0.12 * uLed * ledLine(v, 0.05, 0.11);
        } else {
          // Outer facade: vertical light fins.
          float fin = 1.0 - smoothstep(0.08, 0.2, abs(fract(s / 6.0) - 0.5));
          col += mix(uColA, vec3(0.3, 0.5, 1.0), 0.5) * fin * (1.0 - v) * 0.25;
        }
        col += vec3(1.0, 0.8, 0.55) * vipPool(vW, uVip) * 0.45; // the VIP spotlight's pool on the seats
        gl_FragColor = vec4(col, 1.0);
        ${OUTPUT}
        #include <fog_fragment>
      }`,
  });
}

// Fans in the stands share one pose (fanPose) between their bodies and the lights in their
// hands, so a phone torch stays in the hand that holds it. A 3D fan is five boxes in avatar
// proportions (part: 0 legs, 1 torso, 2 head, 3 left arm, 4 right arm; arms hang from the
// shoulder), built in avatar units and drawn at the avatars' scale (FAN_SCALE), placed at `at`
// and turned by `fan.x` (yaw); sprite fans use the same beat, bounce and arm moves. A fan right
// next to the camera isn't drawn (fanNearCamera), so a camera in the stands never sits inside
// one. fan = (yaw, seed, style, led): style
// picks the move — < 0.12 filming on a phone, < 0.2 glowsticks, < 0.45 fist pumps, < 0.6 hands
// up, the rest bounce with their arms low and join in with hands up as the hype builds.
const FAN_POSE = /* glsl */ `
  uniform float uTime, uBeat, uEnergy, uHype;
  const float FAN_SCALE = 0.78; // AVATAR_SCALE
  bool fanNearCamera(vec3 at) { return distance(at + vec3(0.0, 1.0, 0.0), cameraPosition) < 1.8; }
  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
  // x = raise (radians, forward and up from hanging), y = spread (outward from the body).
  vec2 armPose(float side, float seed, float style, float h) {
    float pump = 1.0 - h; // 1 on the beat
    bool right = side < 0.0;
    if (style < 0.12) return right ? vec2(2.05 + 0.06 * sin(uTime * 1.3 + seed * 9.0), 0.08) : vec2(0.3, 0.05);
    if (style < 0.2) return vec2(2.6, 0.25 + 0.4 * side * sin(3.14159 * (uBeat * 0.5 + seed)));
    if (style < 0.45) return (right || uHype > 0.5) ? vec2(1.9 + 0.95 * pump, 0.12) : vec2(0.35 + 0.2 * pump, 0.08);
    if (style < 0.6 + 0.4 * uHype) return vec2(2.75 - 0.25 * pump, 0.3 + 0.12 * sin(uTime * 2.0 + seed * 7.0));
    return vec2(0.25 + 0.3 * h, 0.08);
  }
  float fanBeat(float seed) { return sin(3.14159 * fract(uBeat + (seed - 0.5) * 0.12)); } // 0 on the beat, 1 between
  // Bounce: a dip on every beat; in a drop, half the stand jumps.
  float fanLift(float seed, float h) {
    return uHype * step(fract(seed * 5.31), 0.45) * 0.35 * h - (0.05 + 0.12 * uEnergy) * (1.0 - h);
  }
  vec3 fanPose(vec3 p, inout vec3 n, float part, vec3 at, vec4 fan) {
    float seed = fan.y;
    float h = fanBeat(seed);
    if (part > 2.5) {
      float side = part < 3.5 ? 1.0 : -1.0;
      vec2 a = armPose(side, seed, fan.z, h);
      vec3 pivot = vec3(side * 0.7, 1.82, 0.0);
      mat3 r = rotX(-a.x) * rotZ(a.y * side);
      p = pivot + r * (p - pivot);
      n = r * n;
    } else if (part > 1.5) {
      p.z += 0.07 * (1.0 - h); // nod
      p.y -= 0.03 * (1.0 - h);
    }
    p.y += fanLift(seed, h);
    mat3 ry = rotY(fan.x + 0.12 * sin(uTime * 1.7 + seed * 30.0));
    n = ry * n;
    return at + ry * (p * FAN_SCALE);
  }
`;

const FAN_UNIFORMS = () => ({
  uTime: { value: 0 },
  uBeat: { value: 0 },
  uEnergy: { value: 0 },
  uHype: { value: 0 },
  uFlash: { value: 0 },
  uColA: { value: new THREE.Color('#00f3ff') },
  uColB: { value: new THREE.Color('#ff007f') },
  uVip: { value: new THREE.Vector4() }, // VIP spotlight: xyz = the buyer, w = how far in
});

/**
 * Fans' bodies (InstancedBufferGeometry, see fans.js). Outfit colours per instance; hair, eyes
 * and sleeves drawn from the box-space position. Lit faintly by the night sky, washed by the
 * stage in front of them, rimmed in the palette; LED tops glow on the kick.
 */
export function fanMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        FAN_UNIFORMS(),
        { uWash: { value: 1 }, uKick: { value: 0 }, uDim: { value: 1 }, uStageZ: { value: CENTER_Z } },
      ]),
      uCrowdGlow: crowdGlow, // shared, so outside merge() (it clones)
    },
    vertexShader: /* glsl */ `
      attribute float aPart;
      attribute vec3 iPos;
      attribute vec4 iFan;
      attribute vec3 iTop;
      attribute vec3 iSkin;
      varying vec3 vN; varying vec3 vW; varying vec3 vL; varying vec3 vLN;
      varying float vPart; varying vec3 vTop; varying vec3 vSkin; varying vec2 vFx;
      #include <common>
      #include <fog_pars_vertex>
      ${FAN_POSE}
      void main() {
        vec3 n = normal;
        vec3 w = fanNearCamera(iPos) ? vec3(0.0, -1000.0, 0.0) : fanPose(position, n, aPart, iPos, iFan);
        vN = n; vW = w; vL = position; vLN = normal;
        vPart = aPart; vTop = iTop; vSkin = iSkin; vFx = iFan.yw;
        vec4 mvPosition = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uKick, uWash, uFlash, uDim, uStageZ, uCrowdGlow;
      uniform vec3 uColA, uColB;
      uniform vec4 uVip;
      varying vec3 vN; varying vec3 vW; varying vec3 vL; varying vec3 vLN;
      varying float vPart; varying vec3 vTop; varying vec3 vSkin; varying vec2 vFx;
      #include <common>
      #include <fog_pars_fragment>
      float vipPool(vec3 p, vec4 vip) { return vip.w * smoothstep(5.5, 1.2, distance(p.xz, vip.xz)) * step(abs(p.y - vip.y), 4.0); }
      void main() {
        float seed = vFx.x;
        vec3 neon = mix(uColA, uColB, step(0.5, fract(seed * 11.3)));
        vec3 albedo;
        vec3 glow = vec3(0.0);
        if (vPart < 0.5) {
          albedo = mix(vec3(0.02, 0.022, 0.04), vTop * 0.3, step(0.75, fract(seed * 3.7)));
          if (vL.y < 0.14) albedo = vec3(0.55); // trainers
          if (abs(vL.x) < 0.03) albedo *= 0.2; // the gap between the legs (one box)
        } else if (vPart < 1.5) {
          albedo = vTop;
          if (vFx.y > 0.5 && abs(vL.y - 1.5) < 0.05) glow = neon * (0.5 + 1.3 * uKick); // LED top
        } else if (vPart < 2.5) {
          albedo = vSkin;
          vec3 hair = fract(seed * 17.9) < 0.15 ? neon * 0.6 : vec3(0.015, 0.012, 0.012);
          if (vLN.y > 0.5 || vLN.z < -0.5 || vL.y > 2.6) albedo = hair;
          if (vLN.z > 0.5 && abs(abs(vL.x) - 0.15) < 0.05 && abs(vL.y - 2.4) < 0.07) albedo = vec3(0.01); // eyes
        } else {
          albedo = vL.y > 1.42 ? vTop : vSkin; // sleeve, then the forearm and hand
        }
        vec3 n = normalize(vN);
        vec3 toStage = normalize(vec3(0.0, 8.0, uStageZ) - vW);
        float front = max(0.0, dot(n, toStage));
        // Sky light and palette rims are the crowd's own (Arena Blackout takes them); the stage
        // wash, the flashes and the VIP spotlight are the show's.
        vec3 light = vec3(0.03, 0.035, 0.07) * (1.0 + 0.6 * n.y) * uCrowdGlow
          + mix(vec3(0.7), uColA, 0.5) * front * uWash * (0.14 + 0.22 * uKick) * exp(-vW.y * 0.015)
          + (uColA * max(0.0, dot(n, vec3(-0.7, 0.4, 0.6))) + uColB * max(0.0, dot(n, vec3(0.7, 0.4, -0.6)))) * 0.07 * (0.25 + 0.75 * uDim) * uCrowdGlow
          + vec3(uFlash * 0.7)
          + vec3(1.0, 0.8, 0.55) * vipPool(vW, uVip) * 1.6; // in the VIP spotlight
        gl_FragColor = vec4(albedo * light + glow * uCrowdGlow, 1.0);
        ${OUTPUT}
        #include <fog_fragment>
      }`,
  });
}

/**
 * Fans as flat sprites (Points, one vertex each) in the middle and upper tiers, and as the
 * drone feed's stand-ins for the 3D ones: the same outfit, bounce and arm moves (armPose),
 * drawn as a blocky silhouette in a 3.2 m square facing the camera.
 */
export function fanSpriteMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        FAN_UNIFORMS(),
        { uWash: { value: 1 }, uKick: { value: 0 }, uScale: { value: 400 } },
      ]),
      uCrowdGlow: crowdGlow, // shared, so outside merge() (it clones)
    },
    vertexShader: /* glsl */ `
      attribute vec4 iFan;
      attribute vec3 iTop;
      attribute vec3 iSkin;
      uniform float uScale;
      varying vec3 vTop; varying vec3 vSkin; varying vec4 vHands; varying vec2 vFx; varying float vY; varying vec3 vAt;
      #include <common>
      #include <fog_pars_vertex>
      ${FAN_POSE}
      // Where a hand is, seen from the front (metres from the feet), for an armPose.
      vec2 handAt(float side, vec2 a) { return vec2(side * (0.7 + 0.8 * sin(a.y)), 1.82 - 0.8 * cos(a.x) * cos(a.y)); }
      void main() {
        float seed = iFan.y;
        float h = fanBeat(seed);
        vHands = vec4(handAt(1.0, armPose(1.0, seed, iFan.z, h)), handAt(-1.0, armPose(-1.0, seed, iFan.z, h)));
        vTop = iTop; vSkin = iSkin; vFx = iFan.yw; vY = position.y; vAt = position;
        vec4 mvPosition = modelViewMatrix * vec4(position + vec3(0.0, (1.6 + fanLift(seed, h)) * FAN_SCALE, 0.0), 1.0);
        gl_PointSize = max(1.0, 3.2 * FAN_SCALE * uScale / max(0.1, -mvPosition.z));
        gl_Position = fanNearCamera(position) ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uKick, uWash, uFlash, uCrowdGlow;
      uniform vec3 uColA, uColB;
      uniform vec4 uVip;
      varying vec3 vTop; varying vec3 vSkin; varying vec4 vHands; varying vec2 vFx; varying float vY; varying vec3 vAt;
      #include <common>
      #include <fog_pars_fragment>
      float vipPool(vec3 p, vec4 vip) { return vip.w * smoothstep(5.5, 1.2, distance(p.xz, vip.xz)) * step(abs(p.y - vip.y), 4.0); }
      float seg(vec2 p, vec2 a, vec2 b) {
        vec2 ab = b - a;
        return length(p - a - ab * clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0));
      }
      void main() {
        vec2 f = vec2(gl_PointCoord.x - 0.5, 1.0 - gl_PointCoord.y) * 3.2; // metres, feet at 0
        float seed = vFx.x;
        float ax = abs(f.x);
        vec3 neon = mix(uColA, uColB, step(0.5, fract(seed * 11.3)));
        vec3 glow = vec3(0.0);
        vec3 albedo;
        float dL = seg(f, vec2(0.7, 1.82), vHands.xy);
        float dR = seg(f, vec2(-0.7, 1.82), vHands.zw);
        if (min(dL, dR) < 0.19) {
          albedo = length(f - (dL < dR ? vHands.xy : vHands.zw)) < 0.3 ? vSkin : vTop; // hand, sleeve
        } else if (f.y < 0.95 && ax < 0.46) {
          albedo = ax < 0.03 ? vec3(0.005) : mix(vec3(0.02, 0.022, 0.04), vTop * 0.3, step(0.75, fract(seed * 3.7)));
        } else if (f.y < 1.9 && ax < 0.5) {
          albedo = vTop;
          if (vFx.y > 0.5 && abs(f.y - 1.5) < 0.06) glow = neon * (0.5 + 1.3 * uKick); // LED top
        } else if (f.y > 2.0 && f.y < 2.72 && ax < 0.36) {
          albedo = f.y > 2.6 ? (fract(seed * 17.9) < 0.15 ? neon * 0.6 : vec3(0.015, 0.012, 0.012)) : vSkin;
        } else discard;
        vec3 light = vec3(0.04, 0.046, 0.09) * uCrowdGlow
          + mix(vec3(0.7), uColA, 0.5) * uWash * (0.1 + 0.16 * uKick) * exp(-vY * 0.015)
          + vec3(uFlash * 0.7)
          + vec3(1.0, 0.8, 0.55) * vipPool(vAt, uVip) * 1.6;
        gl_FragColor = vec4(albedo * light + glow * uCrowdGlow, 1.0);
        ${OUTPUT}
        #include <fog_fragment>
      }`,
  });
}

/**
 * The lights fans hold up (Points, one per phone or glowstick fan): white phone torches,
 * twinkling and brighter in big moments, or glowsticks in the palette colours. Each point
 * follows its fan's right hand.
 */
export function fanLightsMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...FAN_UNIFORMS(), uScale: { value: 400 }, uCrowdGlow: crowdGlow },
    vertexShader: /* glsl */ `
      attribute vec4 iFan;
      uniform float uScale, uFlash, uCrowdGlow;
      uniform vec3 uColA, uColB;
      varying vec3 vColor;
      ${FAN_POSE}
      void main() {
        float seed = iFan.y;
        vec3 n = vec3(0.0, 1.0, 0.0);
        vec3 p = fanPose(vec3(-0.7, 1.02, 0.12), n, 4.0, position, iFan); // right hand
        float size;
        if (iFan.z < 0.12) {
          float tw = 0.65 + 0.35 * sin(uTime * (1.5 + seed * 3.0) + seed * 40.0);
          vColor = vec3(0.9, 0.95, 1.0) * (0.55 + 0.9 * uEnergy) * tw;
          size = 0.5;
        } else {
          vColor = mix(uColA, uColB, step(0.5, fract(seed * 13.7))) * (0.9 + 0.6 * uEnergy);
          size = 0.42;
        }
        vColor += vec3(uFlash * 0.3);
        vColor *= uCrowdGlow; // Arena Blackout: phones and glowsticks down
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = max(1.0, size * uScale / max(0.1, -mv.z));
        gl_Position = fanNearCamera(position) ? vec4(0.0, 0.0, 2.0, 1.0) : projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.2, length(c));
        if (a < 0.02) discard;
        gl_FragColor = vec4(vColor, a);
        ${OUTPUT}
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/**
 * Roof canopies: a smoked translucent membrane (the stands show through from the drone's
 * aerial) on ribs every 9 m, with purlins across. Strip uv = (metres around the bowl, 0 front
 * edge → 1 back edge).
 */
export function roofMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uPulse: { value: 1 }, uColA: { value: new THREE.Color('#00f3ff') } },
    ]),
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uPulse;
      uniform vec3 uColA;
      varying vec2 vUv;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        float rs = vUv.x / 9.0;
        float rib = 1.0 - smoothstep(0.0, 1.5, abs(fract(rs + 0.5) - 0.5) / max(fwidth(rs), 1e-4));
        float pv = vUv.y * 5.0;
        float purlin = 1.0 - smoothstep(0.0, 1.5, abs(fract(pv + 0.5) - 0.5) / max(fwidth(pv), 1e-4));
        vec3 col = vec3(0.012, 0.018, 0.04) + uColA * rib * 0.22 * uPulse + vec3(0.05, 0.08, 0.16) * purlin * 0.5;
        gl_FragColor = vec4(col, 0.42 + 0.35 * max(rib, purlin * 0.6));
        ${OUTPUT}
        #include <fog_fragment>
      }`,
  });
}
