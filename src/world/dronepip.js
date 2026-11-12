// The ravers' broadcast feed as picture-in-picture on your own screen (ui/dronepip.js is its
// frame): whichever camera the side towers show (broadcast.js), the drone's VIP shot in a show.
//
// The picture is the same off-screen render the side towers show (16:9, 640 x 360, about 30 fps,
// without the feed screens, name tags or ravers too far away to see), so while the towers are in
// view it costs no second scene render. After the main frame it's drawn
// into the panel's rectangle of the main canvas as one quad with its own broadcast look:
// scanlines, a slight colour split, vignette, grain, rounded corners to match the frame, and a
// short glitch now and then (and on big hits in a drop). Nothing is read back from the GPU; the
// HUD frame just lines up with the rectangle.

import * as THREE from 'three';

const RADIUS = 9; // px, the frame's rounded corners (inside its 1 px border)

export class DronePip {
  /** @param rig the BroadcastRig: it shows the ravers' output */
  constructor(rig) {
    this.rig = rig;
    this.active = false; // on screen (the panel sets it; off while you ride the drone)
    this.rect = null; // { left, top, width, height }: CSS px of the picture, from the panel
    this.burst = 0;
    this.nextBurst = 5;
    this.size = new THREE.Vector2();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tFeed: { value: null },
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uSize: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: RADIUS },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0); // fills the viewport (the panel's rectangle)
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tFeed;
        uniform float uTime, uGlitch, uRadius;
        uniform vec2 uSize;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          // Rounded corners, like the frame around it.
          vec2 px = vUv * uSize;
          vec2 q = abs(px - uSize * 0.5) - (uSize * 0.5 - uRadius);
          if (length(max(q, 0.0)) > uRadius) discard;
          // Glitch: a few bands torn sideways, a stronger colour split.
          vec2 uv = vUv;
          float band = floor(uv.y * 22.0);
          float tick = floor(uTime * 24.0);
          float tear = uGlitch * step(0.72, hash(vec2(band, tick)));
          uv.x += tear * (hash(vec2(tick, band * 3.1)) - 0.5) * 0.09;
          vec2 d = uv - 0.5;
          float ca = 0.0016 + 0.01 * uGlitch;
          vec3 c = vec3(texture2D(tFeed, uv + d * ca).r, texture2D(tFeed, uv).g, texture2D(tFeed, uv - d * ca).b);
          if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
          c = max(c, vec3(0.0));
          c *= 0.9 + 0.1 * sin(gl_FragCoord.y * 2.2 + uTime * 8.0); // scanlines, every ~3 px
          c *= 1.0 - 0.55 * dot(d, d);                                // vignette
          c += (hash(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.03; // grain
          gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // unused by the shader
  }

  /** After the main frame: the latest feed frame into the panel's rectangle. */
  draw(renderer, dt) {
    const r = this.rect;
    const out = this.rig.raver;
    if (!this.active || !r || r.width < 2 || r.height < 2 || !out || !this.rig.hasPicture(out)) return;
    // A short glitch every 5–12 s, and on the feed's own (a cut, the drone's big hits in a drop).
    if ((this.nextBurst -= dt) <= 0) {
      this.burst = 1;
      this.nextBurst = 5 + Math.random() * 7;
    }
    this.burst = Math.max(0, this.burst - dt * 6);
    const u = this.material.uniforms;
    u.tFeed.value = out.shown.texture;
    u.uTime.value = this.rig.t;
    u.uGlitch.value = Math.max(this.burst * 0.6, out.glitch * 0.8);
    u.uSize.value.set(r.width, r.height);

    renderer.getSize(this.size);
    const y = this.size.y - r.top - r.height; // the viewport counts from the bottom
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.setScissorTest(true);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, this.size.x, this.size.y);
    renderer.autoClear = autoClear;
  }
}
