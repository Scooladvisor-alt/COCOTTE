// Chute de neige : de vrais petits flocons en 3D dans la scène (comme les feuilles d'automne),
// éclairés comme le reste et à l'échelle du monde — ils rapetissent quand on dézoome, rien n'est
// plaqué devant l'écran. Ils descendent lentement en ondulant et disparaissent en touchant le sol.
import * as THREE from 'three';

const MAX = 1400;
const TOP = 7;

export class Snowfall {
  private mesh: THREE.InstancedMesh;
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private z = new Float32Array(MAX);
  private speed = new Float32Array(MAX);
  private phase = new Float32Array(MAX);
  private size = new Float32Array(MAX);
  private tmp = new THREE.Object3D();
  private amount = 0;
  private ready = false;
  /** Côté de la zone de neige (s'élargit quand on dézoome). */
  private box = 30;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x58606e, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    for (let i = 0; i < MAX; i++) {
      this.speed[i] = 0.45 + Math.random() * 0.4;
      this.phase[i] = Math.random() * Math.PI * 2;
      // quelques flocons plus gros (amas), la plupart minuscules
      this.size[i] = Math.random() < 0.12 ? 0.05 + Math.random() * 0.02 : 0.025 + Math.random() * 0.02;
    }
  }

  private place(i: number, cx: number, cz: number, anyHeight: boolean) {
    this.x[i] = cx + (Math.random() - 0.5) * this.box;
    this.z[i] = cz + (Math.random() - 0.5) * this.box;
    this.y[i] = anyHeight ? Math.random() * TOP : TOP * (0.85 + Math.random() * 0.15);
  }

  /** intensity 0..1 : rien (ciel dégagé) à une belle chute de neige. */
  update(dt: number, time: number, center: THREE.Vector3, intensity: number, groundY: number, zoom = 1.5) {
    dt = Math.min(dt, 0.1);
    this.box = Math.min(70, Math.max(30, 18 + 34 / zoom));
    this.amount += (intensity - this.amount) * Math.min(1, dt * 0.5);
    const n = Math.floor(MAX * Math.min(1, this.amount));
    this.mesh.visible = n > 0;
    if (!n) return;
    if (!this.ready) {
      for (let i = 0; i < MAX; i++) this.place(i, center.x, center.z, true);
      this.ready = true;
    }
    const t = this.tmp;
    for (let i = 0; i < n; i++) {
      this.y[i] -= this.speed[i] * dt;
      this.x[i] += (Math.sin(time * 0.9 + this.phase[i]) * 0.22 + 0.08) * dt;
      this.z[i] += Math.cos(time * 0.7 + this.phase[i] * 1.3) * 0.16 * dt;
      // touché le sol ou sorti de la zone visible : il retombe d'en haut
      if (this.y[i] <= groundY || Math.abs(this.x[i] - center.x) > this.box / 2 || Math.abs(this.z[i] - center.z) > this.box / 2) this.place(i, center.x, center.z, this.y[i] > groundY);
      t.position.set(this.x[i], this.y[i], this.z[i]);
      t.rotation.set(this.phase[i] + time * 0.5, this.phase[i] * 2, 0);
      t.scale.setScalar(this.size[i]);
      t.updateMatrix();
      this.mesh.setMatrixAt(i, t.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
