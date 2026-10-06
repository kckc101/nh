// CPU particle pools rendered as GPU point sprites (fire, CO2 jets, haze, fireworks)
// plus instanced tumbling confetti.

import * as THREE from 'three';
import { pointsMaterial } from './shaders.js';

export const KIND = { PLAIN: 0, FIRE: 1, SMOKE: 2 };

export class ParticlePool {
  constructor(scene, max, texture, blending) {
    this.max = max;
    this.cursor = 0;
    this.active = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max).fill(-1);
    this.size0 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.kind = new Uint8Array(max);

    const g = new THREE.BufferGeometry();
    const attr = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', attr(this.pos, 3));
    g.setAttribute('pcolor', attr(this.col, 3));
    g.setAttribute('size', attr(this.size, 1));
    g.setAttribute('alpha', attr(this.alpha, 1));
    this.geo = g;
    this.material = pointsMaterial(texture, blending);
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, o) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    const c = o.color;
    this.col[i3] = c.r;
    this.col[i3 + 1] = c.g;
    this.col[i3 + 2] = c.b;
    this.age[i] = 0;
    this.life[i] = o.life;
    this.size0[i] = o.size;
    this.alpha0[i] = o.alpha ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.grow[i] = o.grow ?? 0;
    this.kind[i] = o.kind ?? KIND.PLAIN;
  }

  update(dt) {
    let live = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] < 0) continue;
      const a = (this.age[i] += dt);
      if (a >= this.life[i]) {
        this.life[i] = -1;
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      live++;
      const f = a / this.life[i];
      const i3 = i * 3;
      const damp = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= damp;
      this.vel[i3 + 1] = this.vel[i3 + 1] * damp + this.grav[i] * dt;
      this.vel[i3 + 2] *= damp;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < 0.05) {
        this.pos[i3 + 1] = 0.05;
        this.vel[i3 + 1] *= -0.2;
      }
      switch (this.kind[i]) {
        case KIND.FIRE: {
          // white-hot → yellow → orange → deep red
          this.col[i3] = 2.2 - f * 0.9;
          this.col[i3 + 1] = Math.max(0.04, 1.15 * (1 - f * 1.4));
          this.col[i3 + 2] = Math.max(0, 0.35 * (1 - f * 4));
          this.size[i] = this.size0[i] * (1 - f * 0.55);
          this.alpha[i] = this.alpha0[i] * (1 - f * f);
          break;
        }
        case KIND.SMOKE: {
          this.size[i] = this.size0[i] + this.grow[i] * a;
          this.alpha[i] = this.alpha0[i] * Math.min(1, f * 6) * (1 - f);
          break;
        }
        default: {
          this.size[i] = this.size0[i] * (1 - f * 0.5);
          this.alpha[i] = this.alpha0[i] * (1 - f);
        }
      }
    }
    if (live || this.active) {
      for (const k of ['position', 'pcolor', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
    }
    this.active = live;
  }

  setScale(s) {
    this.material.uniforms.uScale.value = s;
  }
}

export class Confetti {
  constructor(scene, max = 700) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(0.24, 0.13);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.spin = new Float32Array(max * 3);
    this.life = new Float32Array(max).fill(-1);
    this.cursor = 0;
    this.active = false;
    this.zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.m = new THREE.Matrix4();
    this.e = new THREE.Euler();
    this.q = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  burst(count, area, colors) {
    const c = new THREE.Color();
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      this.pos[i3] = area.x + (Math.random() - 0.5) * area.w;
      this.pos[i3 + 1] = area.y + Math.random() * area.h;
      this.pos[i3 + 2] = area.z + (Math.random() - 0.5) * area.d;
      this.vel[i3] = (Math.random() - 0.5) * 2;
      this.vel[i3 + 1] = area.vy ?? -2 - Math.random() * 1.5;
      this.vel[i3 + 2] = (Math.random() - 0.5) * 2;
      for (let k = 0; k < 3; k++) {
        this.rot[i3 + k] = Math.random() * 6.28;
        this.spin[i3 + k] = (Math.random() - 0.5) * 12;
      }
      this.life[i] = 9 + Math.random() * 4;
      c.set(colors[Math.floor(Math.random() * colors.length)]).multiplyScalar(1.6);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.active = true;
    this.mesh.visible = true;
  }

  update(dt, t) {
    if (!this.active) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] < 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.life[i] = -1;
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      any = true;
      const i3 = i * 3;
      const grounded = this.pos[i3 + 1] <= 0.03;
      if (!grounded) {
        this.vel[i3 + 1] = Math.max(-2.6, this.vel[i3 + 1] - 6 * dt);
        this.pos[i3] += (this.vel[i3] + Math.sin(t * 2 + i) * 0.8) * dt;
        this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
        this.pos[i3 + 2] += (this.vel[i3 + 2] + Math.cos(t * 1.7 + i) * 0.8) * dt;
        for (let k = 0; k < 3; k++) this.rot[i3 + k] += this.spin[i3 + k] * dt;
      } else {
        this.pos[i3 + 1] = 0.03;
        this.rot[i3] = -Math.PI / 2;
        this.rot[i3 + 2] = 0;
      }
      this.e.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2]);
      this.q.setFromEuler(this.e);
      this.p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
      this.s.setScalar(Math.min(1, this.life[i]));
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!any) {
      this.active = false;
      this.mesh.visible = false;
    }
  }
}
