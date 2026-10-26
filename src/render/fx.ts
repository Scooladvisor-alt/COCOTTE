// Particules légères (plumes, poussière, étincelles, pièces) via un seul InstancedMesh.
import * as THREE from 'three';

interface P {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  spin: number;
  gravity: number;
}

const MAX = 400;
const tmp = new THREE.Object3D();
const col = new THREE.Color();

export class Particles {
  mesh: THREE.InstancedMesh;
  private ps: P[] = [];
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.TetrahedronGeometry(0.06, 0);
    const mat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    for (let i = 0; i < MAX; i++) {
      this.ps.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, spin: 0, gravity: 0 });
      tmp.scale.setScalar(0);
      tmp.updateMatrix();
      this.mesh.setMatrixAt(i, tmp.matrix);
      this.mesh.setColorAt(i, col.set(0xffffff));
    }
    scene.add(this.mesh);
  }

  burst(x: number, y: number, z: number, color: number, n: number, opts: { speed?: number; up?: number; size?: number; life?: number; gravity?: number } = {}) {
    const speed = opts.speed ?? 1.2;
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      const p = this.ps[i];
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * speed;
      p.alive = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.vx = Math.cos(a) * r;
      p.vz = Math.sin(a) * r;
      p.vy = (opts.up ?? 1.5) * (0.5 + Math.random());
      p.life = 0;
      p.max = (opts.life ?? 0.9) * (0.7 + Math.random() * 0.6);
      p.size = (opts.size ?? 1) * (0.6 + Math.random() * 0.8);
      p.spin = Math.random() * 6;
      p.gravity = opts.gravity ?? 4;
      this.mesh.setColorAt(i, col.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const p = this.ps[i];
      if (!p.alive) continue;
      any = true;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        tmp.scale.setScalar(0);
        tmp.position.set(0, -10, 0);
        tmp.updateMatrix();
        this.mesh.setMatrixAt(i, tmp.matrix);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.08, p.y + p.vy * dt);
      p.z += p.vz * dt;
      p.vx *= 0.97;
      p.vz *= 0.97;
      const k = 1 - p.life / p.max;
      tmp.position.set(p.x, p.y, p.z);
      tmp.rotation.set(p.life * p.spin, p.life * p.spin * 0.7, 0);
      tmp.scale.setScalar(p.size * Math.min(1, k * 2));
      tmp.updateMatrix();
      this.mesh.setMatrixAt(i, tmp.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ------------------------------------------------------------ Coups de feu ----
// Éclairs de bouche, traçantes et impacts : quelques maillages réutilisés, fondus rapides.
interface Fx {
  obj: THREE.Mesh | THREE.Line;
  life: number;
  max: number;
  grow: number;
}

const FLASH_GEO = new THREE.IcosahedronGeometry(0.12, 0);
const RING_GEO = (() => {
  const g = new THREE.RingGeometry(0.12, 0.2, 20);
  g.rotateX(-Math.PI / 2);
  return g;
})();

export class Shots {
  private list: Fx[] = [];
  constructor(private scene: THREE.Scene) {}

  private add(obj: THREE.Mesh | THREE.Line, life: number, grow: number) {
    this.scene.add(obj);
    this.list.push({ obj, life: 0, max: life, grow });
  }

  /** Éclair lumineux (bouche du canon ou impact). */
  flash(x: number, y: number, z: number, color = 0xfff1a8, size = 1, life = 0.12) {
    const m = new THREE.Mesh(FLASH_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.set(x, y, z);
    m.scale.setScalar(size);
    m.renderOrder = 8;
    this.add(m, life, 2.5);
  }

  /** Onde au sol (impact, ou tir divin du joueur). */
  shockwave(x: number, z: number, color = 0xffffff, size = 1) {
    const m = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    m.position.set(x, 0.13, z);
    m.scale.setScalar(size);
    m.renderOrder = 8;
    this.add(m, 0.35, 6);
  }

  /** Traçante entre la bouche du fusil et le point d'impact. */
  tracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color = 0xfff4c2) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)]);
    const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }));
    l.renderOrder = 8;
    this.add(l, 0.1, 0);
  }

  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.life += dt;
      const k = f.life / f.max;
      const mat = f.obj.material as THREE.Material & { opacity: number };
      if (k >= 1) {
        this.scene.remove(f.obj);
        mat.dispose();
        if (f.obj instanceof THREE.Line) f.obj.geometry.dispose();
        this.list.splice(i, 1);
        continue;
      }
      mat.opacity = 1 - k;
      if (f.grow) f.obj.scale.multiplyScalar(1 + f.grow * dt);
    }
  }
}
