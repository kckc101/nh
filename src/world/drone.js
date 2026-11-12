// The camera drone you can see: a small quadcopter with nav lights, flying the drone-cam path
// (dronecam.js) — so the drone overhead is the one filming the feed on the screens. Its meshes
// sit on DRONE_LAYER, which the feed camera doesn't render. In drone view (B) your own camera
// rides along with the drone cam's shot.

import * as THREE from 'three';
import { glowMaterial } from './shaders.js';
import { DRONE_LAYER } from './dronecam.js';

const ease = (k) => k * k * (3 - 2 * k);

export class Drone {
  /** @param cam the DroneCamSystem whose flight this drone follows */
  constructor(scene, cam) {
    this.cam = cam;
    this.clock = cam.clock;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.rotors = [];
    this.build();
    this.root.traverse((o) => o.layers.set(DRONE_LAYER));
    scene.add(this.root);

    this.active = false;
    this.blend = 1;
    this.fromPos = new THREE.Vector3();
    this.fromLook = new THREE.Vector3();
    this.curLook = new THREE.Vector3();
  }

  build() {
    const dark = new THREE.MeshLambertMaterial({ color: '#1c1c26' });
    const metal = new THREE.MeshLambertMaterial({ color: '#4a4f60' });
    const add = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.root.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(0.9, 0.28, 1.1), dark);
    add(new THREE.BoxGeometry(0.5, 0.12, 0.6), metal, 0, 0.2, 0);
    const armGeo = new THREE.BoxGeometry(1.9, 0.08, 0.12);
    for (const r of [Math.PI / 4, -Math.PI / 4]) add(armGeo, dark).rotation.y = r;
    const hubGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8);
    const bladeGeo = new THREE.BoxGeometry(0.9, 0.02, 0.1);
    for (const [x, z] of [[0.67, 0.67], [-0.67, 0.67], [0.67, -0.67], [-0.67, -0.67]]) {
      add(hubGeo, metal, x, 0.1, z);
      this.rotors.push(add(bladeGeo, metal, x, 0.2, z));
    }
    add(new THREE.SphereGeometry(0.16, 10, 8), metal, 0, -0.22, 0.4); // camera gimbal
    // Nav lights: red port (left), green starboard (right), white anti-collision strobe.
    const bulb = new THREE.SphereGeometry(0.09, 8, 6);
    add(bulb, glowMaterial('#ff2d55', 4), 0.67, 0, 0.75);
    add(bulb, glowMaterial('#2dff7a', 4), -0.67, 0, 0.75);
    this.strobe = add(bulb, glowMaterial('#ffffff', 7), 0, -0.18, -0.55);
    this.root.scale.setScalar(1.8);
  }

  /** Ride-along drag: slide along the flight path. */
  nudge(d) {
    this.cam.nudge(d);
  }

  /** Ride-along wheel / pinch: zoom the lens. */
  zoomBy(f) {
    this.cam.zoomBy(f);
  }

  setActive(on, camera, lookFrom) {
    this.active = on;
    if (on) {
      this.blend = 0;
      this.fromPos.copy(camera.position);
      this.fromLook.copy(lookFrom);
    }
  }

  /** Call after DroneCamSystem.update(), with the camera you're watching through. */
  update(dt, viewer) {
    const c = this.cam;
    this.root.position.copy(c.dronePos);
    // Face along the path, nose down a touch, banked into the turn.
    this.root.rotation.set(0.12, c.heading, -0.18);
    this.rotors.forEach((r, i) => (r.rotation.y += dt * (i % 2 ? 38 : -38)));
    this.strobe.visible = c.t % 1.2 < 0.08;
    // Hidden while the camera rides it (it would fill the screen), and when a zoomed-out camera
    // passes close to its flight path (its strobe would bloom into a glare across the view).
    this.root.visible = !(this.active && this.blend > 0.4) && !(viewer && viewer.position.distanceToSquared(this.root.position) < 40 * 40);
  }

  /** Drone view: ease from wherever the camera was into the drone cam's shot. */
  placeCamera(camera, dt) {
    this.blend = Math.min(1, this.blend + dt / 1.6);
    const k = ease(this.blend);
    const shot = this.cam.camera;
    camera.position.lerpVectors(this.fromPos, shot.position, k);
    if (k >= 1) {
      camera.quaternion.copy(shot.quaternion); // exactly the feed's framing (with its roll)
      this.curLook.copy(this.cam.look);
    } else {
      this.curLook.lerpVectors(this.fromLook, this.cam.look, k);
      camera.lookAt(this.curLook);
    }
  }
}
