// Festival grounds: night sky, reactive dance floor, distant Phnom Penh skyline, sugar palms
// with uplights, street-food stalls, Khmer neon signs, the entrance arch banner, kroma
// flags and festoon bulb strings.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../core/rng.js';
import { floorMaterial, skyMaterial, buildingMaterial, beamMaterial, pointsMaterial, glowMaterial, hdr } from './shaders.js';
import { neonTexture, stripeTexture, bannerTexture, kromaCanvas, canvasTexture, glowTexture, KHMER_FONT, DISPLAY_FONT } from './textures.js';

const STALLS = [
  { x: -44, z: 2, en: 'NOM PANG', km: 'នំបុ័ង', color: '#ffb000' },
  { x: -44, z: 18, en: 'KUY TEAV', km: 'គុយទាវ', color: '#ff3d7f' },
  { x: -44, z: 34, en: 'FRESH COCONUT', km: 'ដូង', color: '#9dff00' },
  { x: 44, z: 2, en: 'ICED KAFE', km: 'កាហ្វេទឹកកក', color: '#00f0ff' },
  { x: 44, z: 18, en: 'GLOW SHOP', km: 'ភ្លើង', color: '#ff2bd6' },
  { x: 44, z: 34, en: 'SUGAR PALM JUICE', km: 'ទឹកត្នោត', color: '#ffd400' },
];

const SIGNS = [
  { x: -38, z: -13, ry: 0.6, lines: [['ភ្នំពេញ', '#ff2bd6', KHMER_FONT, 190], ['PHNOM PENH', '#00f0ff', DISPLAY_FONT, 110]] },
  { x: 38, z: -13, ry: -0.6, lines: [['E-RAVE', '#00f0ff', DISPLAY_FONT, 200], ['កម្ពុជា', '#ffc400', KHMER_FONT, 130]] },
  { x: -26, z: 52, ry: Math.PI - 0.35, lines: [['សួស្តី!', '#ffc400', KHMER_FONT, 190], ['HELLO RAVERS', '#ff2bd6', DISPLAY_FONT, 100]] },
  { x: 26, z: 52, ry: Math.PI + 0.35, lines: [['រាំ!', '#9dff00', KHMER_FONT, 200], ['DANCE ALL NIGHT', '#00f0ff', DISPLAY_FONT, 96]] },
];

const PALMS = [
  [-48, -14], [-52, 4], [-48, 22], [-52, 40], [48, -14], [52, 4], [48, 22], [52, 40],
  [-36, 66], [-22, 72], [22, 72], [36, 66], [-60, -30], [60, -30], [-44, -38], [44, -38],
];

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = [];
    this.flags = [];
    this.signs = [];

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), skyMaterial());
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.floorMat = floorMaterial();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), this.floorMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    this.dark = new THREE.MeshLambertMaterial({ color: '#17131f' });
    this.wood = new THREE.MeshLambertMaterial({ color: '#3a2618' });

    this.buildSkyline();
    this.buildPalms();
    this.buildStalls();
    this.buildSigns();
    this.buildArch();
    this.buildFlags();
    this.buildFestoons();
  }

  buildSkyline() {
    const rng = mulberry32(77);
    const count = 96;
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.buildingMat = buildingMaterial();
    const mesh = new THREE.InstancedMesh(geo, this.buildingMat, count + 1);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    let i = 0;
    while (i < count) {
      const a = rng() * Math.PI * 2;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      if (dz < -0.8) continue; // keep the sky behind the Angkor stage clear
      const r = 170 + rng() * 100;
      p.set(dx * r, 0, dz * r);
      s.set(8 + rng() * 14, 12 + Math.pow(rng(), 2) * 70, 8 + rng() * 14);
      mesh.setMatrixAt(i++, m.compose(p, q, s));
    }
    // A tall landmark tower on the riverside skyline
    p.set(-150, 0, 140);
    s.set(16, 135, 16);
    mesh.setMatrixAt(count, m.compose(p, q, s));
    this.scene.add(mesh);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 8), glowMaterial('#ff2d55', 3));
    beacon.position.set(-150, 137, 140);
    this.beacon = beacon;
    this.scene.add(beacon);
  }

  buildPalms() {
    const rng = mulberry32(9);
    const trunks = [];
    const fronds = [];
    const lightsA = [];
    const lightsB = [];
    const up = new THREE.Vector3(0, 1, 0);
    PALMS.forEach(([x, z], i) => {
      const h = 9 + rng() * 4;
      trunks.push(new THREE.CylinderGeometry(0.22, 0.34, h, 7).translate(x, h / 2, z));
      for (let k = 0; k < 16; k++) {
        const el = -0.35 + rng() * 1.6;
        const az = rng() * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
        const g = new THREE.ConeGeometry(0.32, 3.4, 4);
        g.applyMatrix4(new THREE.Matrix4().compose(
          new THREE.Vector3(x, h, z).addScaledVector(dir, 1.6),
          new THREE.Quaternion().setFromUnitVectors(up, dir),
          new THREE.Vector3(1, 1, 0.35),
        ));
        fronds.push(g);
      }
      const beam = new THREE.CylinderGeometry(1.6, 0.25, h + 3, 14, 1, true).translate(x, (h + 3) / 2, z);
      (i % 2 ? lightsA : lightsB).push(beam);
      this.obstacles.push({ x, z, r: 0.6 });
    });
    this.scene.add(new THREE.Mesh(mergeGeometries(trunks), this.wood));
    this.scene.add(new THREE.Mesh(mergeGeometries(fronds), new THREE.MeshLambertMaterial({ color: '#1f4a2a' })));
    this.uplightA = beamMaterial('#ff2bd6', 0.5, 1);
    this.uplightB = beamMaterial('#00f0ff', 0.5, 1);
    this.scene.add(new THREE.Mesh(mergeGeometries(lightsA), this.uplightA));
    this.scene.add(new THREE.Mesh(mergeGeometries(lightsB), this.uplightB));
  }

  buildStalls() {
    for (const st of STALLS) {
      const g = new THREE.Group();
      g.position.set(st.x, 0, st.z);
      g.rotation.y = st.x < 0 ? Math.PI / 2 : -Math.PI / 2;
      const add = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        g.add(m);
        return m;
      };
      add(new THREE.BoxGeometry(4.4, 1.1, 1.3), this.wood, 0, 0.55, 0.7);
      add(new THREE.BoxGeometry(4.4, 3, 1.6), this.dark, 0, 1.5, -0.9);
      for (const px of [-2.1, 2.1]) add(new THREE.BoxGeometry(0.12, 3.2, 0.12), this.wood, px, 1.6, 1.3);
      const awning = add(
        new THREE.BoxGeometry(5, 0.12, 3.2),
        new THREE.MeshLambertMaterial({ map: stripeTexture(st.color, '#f4efe4', 10), emissive: new THREE.Color(st.color).multiplyScalar(0.15) }),
        0, 3.25, 0.25,
      );
      awning.rotation.x = 0.12;
      add(new THREE.BoxGeometry(4.3, 0.08, 0.08), glowMaterial('#ffb46b', 2.2), 0, 3.0, 1.45);
      const sign = add(
        new THREE.PlaneGeometry(4.8, 1.9),
        new THREE.MeshBasicMaterial({
          map: neonTexture([
            { text: st.en, size: 120, y: 150, color: st.color },
            { text: st.km, size: 110, y: 355, color: '#ffffff', font: KHMER_FONT },
          ]),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          color: hdr('#ffffff', 1.5),
        }),
        0, 4.45, 0.4,
      );
      this.signs.push(sign.material);
      this.scene.add(g);
      const w = 2.5;
      this.obstacles.push({ minX: st.x - (st.x < 0 ? 1.7 : 1.4), maxX: st.x + (st.x < 0 ? 1.4 : 1.7), minZ: st.z - w, maxZ: st.z + w });
    }
  }

  buildSigns() {
    for (const s of SIGNS) {
      const g = new THREE.Group();
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.ry;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 7, 8), this.dark);
      pole.position.y = 3.5;
      const board = new THREE.Mesh(new THREE.BoxGeometry(9.4, 4.8, 0.3), this.dark);
      board.position.set(0, 9.2, -0.2);
      const tex = neonTexture(
        s.lines.map(([text, color, font, size], i) => ({ text, color, font, size, y: s.lines.length === 1 ? 256 : 175 + i * 200 })),
      );
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: hdr('#ffffff', 1.7) });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 4.7), mat);
      face.position.set(0, 9.2, 0.0);
      g.add(pole, board, face);
      this.scene.add(g);
      this.signs.push(mat);
      this.obstacles.push({ x: s.x, z: s.z, r: 0.5 });
    }
  }

  buildArch() {
    const z = 60;
    for (const x of [-15, 15]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(2.4, 13, 2.4), this.dark);
      p.position.set(x, 6.5, z);
      this.scene.add(p);
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.4, 13, 2.4)), new THREE.LineBasicMaterial({ color: hdr('#ff2bd6', 2.5) }));
      edge.position.copy(p.position);
      this.scene.add(edge);
      this.obstacles.push({ minX: x - 1.2, maxX: x + 1.2, minZ: z - 1.2, maxZ: z + 1.2 });
    }
    const tex = bannerTexture('E-RAVE CAMBODIA 2026', 'មហោស្រពតន្ត្រី', 'PHNOM PENH');
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: hdr('#ffffff', 1.2) });
    for (const ry of [0, Math.PI]) {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(30, 5), mat);
      b.position.set(0, 11, z + (ry ? 0.05 : -0.05));
      b.rotation.y = ry;
      this.scene.add(b);
    }
  }

  buildFlags() {
    const colors = ['#c4122f', '#1d4ed8', '#ff2bd6', '#00b8d4', '#e2a400'];
    let n = 0;
    for (const x of [-37, 37]) {
      for (const z of [-12, 2, 16, 30, 44]) {
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 400;
        const ctx = c.getContext('2d');
        const color = colors[n % colors.length];
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 128, 400);
        ctx.drawImage(kromaCanvas(color, 128, 8), 0, 272, 128, 128);
        ctx.save();
        ctx.translate(64, 136);
        ctx.rotate(-Math.PI / 2);
        ctx.font = `64px ${DISPLAY_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('E-RAVE', 0, 0, 250);
        ctx.restore();
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9.5, 6), this.dark);
        pole.position.set(x, 4.75, z);
        this.scene.add(pole);
        const pivot = new THREE.Group();
        pivot.position.set(x, 9.3, z);
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(1.6, 5).translate(0.85, -2.5, 0),
          new THREE.MeshBasicMaterial({ map: canvasTexture(c), side: THREE.DoubleSide, color: hdr('#ffffff', 0.55) }),
        );
        flag.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
        pivot.add(flag);
        this.scene.add(pivot);
        this.flags.push({ pivot, phase: n * 0.9 });
        this.obstacles.push({ x, z, r: 0.3 });
        n++;
      }
    }
  }

  buildFestoons() {
    const rows = [-6, 8, 22, 36];
    const per = 44;
    const N = rows.length * per;
    const pos = new Float32Array(N * 3);
    this.bulbCol = new Float32Array(N * 3);
    const size = new Float32Array(N).fill(0.55);
    const alpha = new Float32Array(N).fill(1);
    let i = 0;
    for (const z of rows) {
      for (const x of [-34.5, 34.5]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 9.6, 6), this.dark);
        pole.position.set(x, 4.8, z);
        this.scene.add(pole);
        this.obstacles.push({ x, z, r: 0.3 });
      }
      for (let k = 0; k < per; k++, i++) {
        const u = k / (per - 1);
        pos[i * 3] = -34.5 + u * 69;
        pos[i * 3 + 1] = 9.5 - Math.sin(u * Math.PI) * 3;
        pos[i * 3 + 2] = z;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.bulbCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    this.bulbs = new THREE.Points(g, pointsMaterial(glowTexture()));
    this.bulbs.frustumCulled = false;
    this.scene.add(this.bulbs);
  }

  setPointScale(s) {
    this.bulbs.material.uniforms.uScale.value = s;
  }

  update(dt, t, M, mood, palette, lights, rings) {
    const u = this.floorMat.uniforms;
    u.uTime.value = t;
    u.uBass.value = M.bass * Math.max(0.3, mood.lights);
    u.uColA.value.copy(palette[0]);
    u.uColB.value.copy(palette[1]);
    u.uRings.value = rings;
    u.uFlash.value = mood.flash;
    u.uDim.value = mood.floorDim;
    u.uSpots.value = lights.spots;
    u.uSpotCols.value = lights.spotCols;
    this.sky.material.uniforms.uTime.value = t;
    this.sky.material.uniforms.uBass.value = M.bass;
    this.buildingMat.uniforms.uTime.value = t;
    this.beacon.visible = Math.floor(t * 1.2) % 2 === 0;

    const dim = mood.floorDim;
    this.uplightA.uniforms.uColor.value.copy(palette[1]);
    this.uplightB.uniforms.uColor.value.copy(palette[0]);
    this.uplightA.uniforms.uIntensity.value = this.uplightB.uniforms.uIntensity.value = (0.35 + M.bass * 0.4) * dim;

    // Festoon bulbs chase along the strings on the beat.
    const col = this.bulbCol;
    const n = col.length / 3;
    const step = M.beatCount * 2 + Math.floor(M.phase * 2);
    for (let i = 0; i < n; i++) {
      const c = palette[(i + step) % 3];
      const k = (0.5 + (i % 4 === step % 4 ? M.kick * 1.4 : 0) + 0.3) * dim;
      col[i * 3] = c.r * k + 0.25 * dim;
      col[i * 3 + 1] = c.g * k + 0.18 * dim;
      col[i * 3 + 2] = c.b * k + 0.1 * dim;
    }
    this.bulbs.geometry.attributes.pcolor.needsUpdate = true;

    for (const f of this.flags) f.pivot.rotation.y = Math.sin(t * 1.3 + f.phase) * 0.35;

    // Neon signs: steady glow, with the odd tube flicker.
    this.signs.forEach((m, i) => {
      const flicker = Math.sin(t * 13 + i * 7) > 0.97 ? 0.4 : 1;
      m.color.setScalar((1.2 + M.bass * 0.6) * flicker * Math.max(0.15, dim));
    });
  }
}
