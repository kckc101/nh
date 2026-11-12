// Laser show: every beam is one of a BeamBatch (laserrig.js: one draw call, camera-facing
// beams never thinner than a pixel of the view or the broadcast feed they're rendered into).
// Emitters sit on the stage lip (fanning over the crowd, above head height), on the truss, atop
// the LED wall and on two front-of-house towers behind the crowd that fire back over everyone's
// heads. The mainstage emerald array (LaserRig) is separate, run by the LightingDirector.

import * as THREE from 'three';
import { hash01 } from '../core/rng.js';
import { BeamBatch } from './laserrig.js';
import { STAGE, wallZAt } from './stage.js';

const PER = 6;

export class Lasers {
  constructor(scene) {
    this.emitters = [
      ...[-18, -10, -3, 3, 10, 18].map((x) => ({ pos: new THREE.Vector3(x, 2.95, -22.6), kind: 'low' })),
      { pos: new THREE.Vector3(-27, STAGE.truss.h - 0.8, -22.6), kind: 'high' },
      { pos: new THREE.Vector3(27, STAGE.truss.h - 0.8, -22.6), kind: 'high' },
      { pos: new THREE.Vector3(-14, STAGE.wall.y + STAGE.wall.h / 2 + 0.4, wallZAt(14) + 0.4), kind: 'wall' },
      { pos: new THREE.Vector3(14, STAGE.wall.y + STAGE.wall.h / 2 + 0.4, wallZAt(14) + 0.4), kind: 'wall' },
      { pos: new THREE.Vector3(-14, 8, 46), kind: 'foh' },
      { pos: new THREE.Vector3(14, 8, 46), kind: 'foh' },
      // Behind the DJ booth: a dense fan radiating up and out over the booth, the crowd and the sky.
      ...[-6, -2, 2, 6].map((x) => ({ pos: new THREE.Vector3(x, 5.4, -35.6), kind: 'back' })),
    ];
    // FOH towers holding the rear emitters.
    const tower = new THREE.MeshLambertMaterial({ color: '#16131d' });
    this.obstacles = [];
    for (const e of this.emitters) {
      if (e.kind !== 'foh') continue;
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.7, e.pos.y - 0.4, 0.7), tower);
      pole.position.set(e.pos.x, (e.pos.y - 0.4) / 2, e.pos.z + 0.3);
      const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.2), tower);
      head.position.set(e.pos.x, e.pos.y, e.pos.z + 0.4);
      scene.add(pole, head);
      this.obstacles.push({ x: e.pos.x, z: e.pos.z + 0.3, r: 0.6 });
    }
    // 110 m beams, a 0.8 cm core (they were 1.6 cm boxes), a little haze round each.
    this.beams = new BeamBatch(scene, this.emitters.length * PER, { length: 110, width: 0.008, divergence: 0.0005, halo: 5, gain: 1.5, glow: 0.22 });
    this.dir = new THREE.Vector3();
    this.level = 0;
  }

  update(dt, t, M, mood, palette) {
    this.level += (mood.lasers - this.level) * Math.min(1, dt * 8);
    const fohOn = mood.lasers > 0.8 || mood.laserMode === 'storm'; // the rear towers fire only on the drop
    const beams = this.beams;
    if (this.level <= 0.01) return beams.commit(t, false);
    const mode = mood.laserMode;
    const sp = mood.speed;
    // Sweeps are locked to the beat clock (the tempo), not the wall clock: ~0.47 s per beat at 128 BPM.
    const tb = (M.beatCount + M.phase) * 0.47;
    let idx = 0;
    this.emitters.forEach((e, ei) => {
      const low = e.kind === 'low' || e.kind === 'foh';
      for (let j = 0; j < PER; j++, idx++) {
        const u = j / (PER - 1) - 0.5;
        let yaw;
        let pitch;
        let on = true;
        switch (mode) {
          case 'tunnel': {
            const a = (j / PER) * Math.PI * 2 + tb * 0.8 * sp + ei;
            yaw = Math.sin(a) * 0.35;
            pitch = (low ? 0.12 : -0.28) + Math.cos(a) * 0.12;
            on = !low || j % 2 === 0;
            break;
          }
          case 'scan': {
            yaw = Math.sin(tb * 1.6 * sp) * 0.7 + u * 0.08;
            pitch = (low ? 0.04 : -0.3) + u * 0.12;
            break;
          }
          case 'storm': {
            const step = Math.floor(t * 9);
            yaw = (hash01(step * 31 + idx) - 0.5) * 1.8;
            pitch = (low ? 0.03 : -0.45) + hash01(step * 17 + idx * 3) * 0.35;
            on = hash01(step * 7 + idx) < 0.75;
            break;
          }
          default: {
            // fan
            yaw = u * 1.4 * (0.75 + 0.25 * Math.sin(tb * 0.9 * sp + ei)) + Math.sin(tb * 0.5 * sp) * 0.2;
            pitch = (low ? 0.05 : -0.32) + 0.06 * Math.sin(tb * 1.3 * sp + j);
          }
        }
        if (e.kind === 'back' && mode !== 'storm') {
          // A razor fan: wide yaw spread breathing with the beat, pitched up into the sky and crowd.
          const spread = mode === 'scan' ? 0.55 : 1.9 + 0.5 * Math.sin(tb * 0.8 + ei);
          yaw = u * spread + (mode === 'scan' ? Math.sin(tb * 1.6 * sp) * 0.9 : Math.sin(tb * 0.5 * sp + ei) * 0.35);
          pitch = 0.22 + 0.5 * (0.5 + 0.5 * Math.sin(tb * 1.1 * sp + j * 0.9 + ei));
        }
        if (e.kind === 'high') yaw += e.pos.x < 0 ? 0.35 : -0.35;
        if (e.kind === 'foh' && !fohOn) on = false;
        else if (e.kind === 'foh') {
          // Turn round to face the stage, converging a little toward the centre line.
          yaw = Math.PI + yaw * 0.6 + (e.pos.x < 0 ? 0.12 : -0.12);
          pitch += 0.04;
        }
        if (!on) {
          beams.hide(idx);
          continue;
        }
        const cp = Math.cos(pitch);
        this.dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
        // One main colour across the rig, the back fan in the second (storms flick between them).
        const col = mode === 'storm' ? palette[(idx + Math.floor(t * 4)) % 2] : palette[e.kind === 'back' ? 1 : 0];
        beams.set(idx, e.pos, this.dir, col, this.level * (0.75 + M.kick * 0.6));
      }
    });
    beams.commit(t, true);
  }
}
