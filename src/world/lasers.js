// Laser show: all beams are instances of one thin box (one draw call). Emitters sit on the
// stage lip (fanning over the crowd, above head height), on the truss and atop the LED wall.

import * as THREE from 'three';
import { hash01 } from '../core/rng.js';

const PER = 10;
const Z = new THREE.Vector3(0, 0, 1);

export class Lasers {
  constructor(scene) {
    this.emitters = [
      ...[-18, -10, -3, 3, 10, 18].map((x) => ({ pos: new THREE.Vector3(x, 2.95, -22.6), kind: 'low' })),
      { pos: new THREE.Vector3(-25, 21, -22.6), kind: 'high' },
      { pos: new THREE.Vector3(25, 21, -22.6), kind: 'high' },
      { pos: new THREE.Vector3(-14, 18.6, -37.8), kind: 'wall' },
      { pos: new THREE.Vector3(14, 18.6, -37.8), kind: 'wall' },
    ];
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.emitters.length * PER);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    for (let i = 0; i < this.mesh.count; i++) this.mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    scene.add(this.mesh);

    this.dir = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.m = new THREE.Matrix4();
    this.s = new THREE.Vector3();
    this.c = new THREE.Color();
    this.level = 0;
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  update(dt, t, M, mood, palette) {
    this.level += (mood.lasers - this.level) * Math.min(1, dt * 8);
    const mesh = this.mesh;
    mesh.visible = this.level > 0.01;
    if (!mesh.visible) return;
    const mode = mood.laserMode;
    const sp = mood.speed;
    let idx = 0;
    this.emitters.forEach((e, ei) => {
      for (let j = 0; j < PER; j++, idx++) {
        const u = j / (PER - 1) - 0.5;
        let yaw;
        let pitch;
        let on = true;
        switch (mode) {
          case 'tunnel': {
            const a = (j / PER) * Math.PI * 2 + t * 0.8 * sp + ei;
            yaw = Math.sin(a) * 0.35;
            pitch = (e.kind === 'low' ? 0.12 : -0.28) + Math.cos(a) * 0.12;
            on = e.kind !== 'low' || j % 2 === 0;
            break;
          }
          case 'scan': {
            yaw = Math.sin(t * 1.6 * sp) * 0.7 + u * 0.08;
            pitch = (e.kind === 'low' ? 0.04 : -0.3) + u * 0.12;
            break;
          }
          case 'storm': {
            const step = Math.floor(t * 9);
            yaw = (hash01(step * 31 + idx) - 0.5) * 1.8;
            pitch = (e.kind === 'low' ? 0.03 : -0.45) + hash01(step * 17 + idx * 3) * 0.35;
            on = hash01(step * 7 + idx) < 0.75;
            break;
          }
          default: {
            // fan
            yaw = u * 1.4 * (0.75 + 0.25 * Math.sin(t * 0.9 * sp + ei)) + Math.sin(t * 0.5 * sp) * 0.2;
            pitch = (e.kind === 'low' ? 0.05 : -0.32) + 0.06 * Math.sin(t * 1.3 * sp + j);
          }
        }
        if (e.kind === 'high') yaw += e.pos.x < 0 ? 0.35 : -0.35;
        if (!on) {
          mesh.setMatrixAt(idx, this.zero);
          continue;
        }
        const cp = Math.cos(pitch);
        this.dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();
        this.q.setFromUnitVectors(Z, this.dir);
        this.s.set(0.022, 0.022, 110);
        mesh.setMatrixAt(idx, this.m.compose(e.pos, this.q, this.s));
        const col = mode === 'storm' ? palette[(idx + Math.floor(t * 4)) % 3] || palette[0] : palette[(ei + (j > PER / 2 ? 1 : 0)) % 2];
        this.c.copy(col).multiplyScalar(this.level * (1.1 + M.kick * 0.9));
        mesh.setColorAt(idx, this.c);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }
}
