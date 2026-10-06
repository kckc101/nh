// Moving-head beam fixtures: 10 on the front truss sweeping the crowd and 6 "sky" beams
// behind the booth. Patterns, colours and intensity come from the FX director's mood;
// floor hit points are reported back so the dance floor can draw light pools.

import * as THREE from 'three';
import { beamMaterial, MAX_SPOTS } from './shaders.js';

const DOWN = new THREE.Vector3(0, -1, 0);

export class StageLights {
  constructor(scene) {
    this.fixtures = [];
    const shortGeo = new THREE.CylinderGeometry(0.12, 2.4, 32, 18, 1, true).translate(0, -16, 0);
    const longGeo = new THREE.CylinderGeometry(0.15, 5, 90, 18, 1, true).translate(0, -45, 0);
    const headGeo = new THREE.BoxGeometry(0.55, 0.5, 0.55).translate(0, 0.1, 0);
    const lensGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12).translate(0, -0.18, 0);
    const headMat = new THREE.MeshLambertMaterial({ color: '#202028' });

    const make = (x, y, z, sky) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.rotation.order = 'YXZ';
      const beamMat = beamMaterial('#00f0ff', 0);
      const beam = new THREE.Mesh(sky ? longGeo : shortGeo, beamMat);
      beam.renderOrder = 2;
      const lensMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
      pivot.add(new THREE.Mesh(headGeo, headMat), new THREE.Mesh(lensGeo, lensMat), beam);
      scene.add(pivot);
      const f = { pivot, beamMat, lensMat, sky, color: new THREE.Color(), dir: new THREE.Vector3(), intensity: 0 };
      this.fixtures.push(f);
      return f;
    };
    for (let i = 0; i < 10; i++) make(-22 + i * (44 / 9), 21.3, -23, false);
    for (const x of [-20, -12, -4, 4, 12, 20]) make(x, 2.9, -36.8, true);

    this.spots = Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4());
    this.spotCols = Array.from({ length: MAX_SPOTS }, () => new THREE.Color());
  }

  update(dt, t, M, mood, palette) {
    const s = t * mood.speed;
    const front = this.fixtures.filter((f) => !f.sky);
    const n = front.length;
    let spot = 0;
    for (const f of this.fixtures) {
      const i = this.fixtures.indexOf(f);
      let pan;
      let tilt;
      let on = 1;
      if (f.sky) {
        pan = Math.sin(s * 0.4 + i) * 0.6;
        tilt = 0.25 + 0.2 * Math.sin(s * 0.6 + i * 1.3);
        f.pivot.rotation.set(Math.PI + tilt, pan, 0);
      } else {
        const k = front.indexOf(f);
        switch (mood.pattern) {
          case 'fan':
            pan = (k / (n - 1) - 0.5) * 1.6 * (0.6 + 0.4 * Math.sin(s * 0.5));
            tilt = 0.6 + 0.15 * Math.sin(s * 1.3);
            break;
          case 'cross':
            pan = (k % 2 ? 1 : -1) * (0.5 + 0.35 * Math.sin(s * 0.8));
            tilt = 0.7;
            break;
          case 'center':
            pan = -f.pivot.position.x / 30 + 0.05 * Math.sin(s * 2 + k);
            tilt = 0.45 + 0.1 * Math.sin(s * 2 + k);
            break;
          case 'chase':
            pan = (k / (n - 1) - 0.5) * 1.2;
            tilt = 0.55;
            on = M.beatCount % n === k || M.beatCount % n === n - 1 - k ? 1 : 0.08;
            break;
          default:
            pan = 0.8 * Math.sin(s * 0.7 + k * 0.5);
            tilt = 0.55 + 0.25 * Math.sin(s * 0.9 + k * 0.8);
        }
        f.pivot.rotation.set(-tilt, pan, 0);
      }
      const target = (f.sky ? mood.sky : mood.lights) * on * (0.65 + M.kick * 0.6 + M.bass * 0.3);
      f.intensity += (target - f.intensity) * Math.min(1, dt * 12);
      f.color.copy(palette[i % 2]);
      f.beamMat.uniforms.uColor.value.copy(f.color);
      f.beamMat.uniforms.uIntensity.value = f.intensity * (f.sky ? 0.42 : 0.42);
      f.lensMat.color.copy(f.color).multiplyScalar(0.3 + f.intensity * 4);

      if (!f.sky && spot < MAX_SPOTS) {
        f.dir.copy(DOWN).applyEuler(f.pivot.rotation);
        const p = f.pivot.position;
        if (f.dir.y < -0.1) {
          const d = p.y / -f.dir.y;
          this.spots[spot].set(p.x + f.dir.x * d, p.z + f.dir.z * d, d * 0.095, f.intensity);
          this.spotCols[spot].copy(f.color);
          spot++;
        }
      }
    }
    for (; spot < MAX_SPOTS; spot++) this.spots[spot].w = 0;
  }
}
