// Feuilles d'automne : de vraies petites feuilles (érable et hêtre, avec tige et nervure, légèrement
// bombées) qui tombent en zigzag comme une feuille morte — elles se balancent, basculent dans le sens
// du balancement et tournent sur elles-mêmes —, se posent à plat dans l'herbe, puis brunissent et
// disparaissent. Deux maillages instanciés : tout le feuillage en deux appels de rendu.
import * as THREE from 'three';

const FALL_MAX = 130;
const REST_MAX = 750;
const MAX = FALL_MAX + REST_MAX;

/** Teintes d'automne (rouge érable, orangé, or, brun). */
const PALETTE = [0xc8461f, 0xd9662a, 0xe58b2e, 0xe9b03c, 0xd4a12a, 0xa8432a, 0x8e4a24, 0xb85a1e, 0xd7c040];

interface Leaf {
  kind: 0 | 1;
  x: number;
  y: number;
  z: number;
  vy: number;
  phase: number;
  freq: number;
  amp: number;
  spin: number;
  yaw: number;
  size: number;
  color: THREE.Color;
  /** Posée au sol depuis… (secondes), -1 tant qu'elle tombe. */
  rest: number;
  life: number;
  tiltX: number;
  tiltZ: number;
}

/** Feuille dans le plan XY (tige vers le bas), légèrement creusée, nervure plus sombre. */
function leafGeometry(points: Array<[number, number]>, curve = false) {
  const shape = new THREE.Shape();
  if (curve) {
    // hêtre : contour ovale pointu
    shape.moveTo(0.022, -0.2);
    shape.lineTo(0.022, 0.02);
    shape.bezierCurveTo(0.42, 0.12, 0.4, 0.72, 0, 1);
    shape.bezierCurveTo(-0.4, 0.72, -0.42, 0.12, -0.022, 0.02);
    shape.lineTo(-0.022, -0.2);
    shape.closePath();
  } else {
    shape.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
    shape.closePath();
  }
  const g = new THREE.ShapeGeometry(shape, 6);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // feuille bombée (les bords remontent) et pointe qui se recourbe
    pos.setZ(i, x * x * 0.55 + Math.max(0, y - 0.6) * 0.12);
    // nervure centrale plus sombre, bords un peu plus clairs
    const vein = Math.exp(-((x / 0.035) ** 2)) * (y > 0 ? 0.22 : 0.35);
    const edge = Math.min(1, Math.abs(x) * 1.8) * 0.08;
    const k = 1 - vein + edge;
    col[i * 3] = k;
    col[i * 3 + 1] = k;
    col[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // pivot au centre de la feuille
  g.translate(0, -0.4, 0);
  g.computeVertexNormals();
  return g;
}

const MAPLE: Array<[number, number]> = [
  [0.025, 0.06],
  [0.12, 0.2],
  [0.45, 0.1],
  [0.38, 0.3],
  [0.56, 0.44],
  [0.32, 0.5],
  [0.4, 0.76],
  [0.15, 0.63],
  [0, 1],
  [-0.15, 0.63],
  [-0.4, 0.76],
  [-0.32, 0.5],
  [-0.56, 0.44],
  [-0.38, 0.3],
  [-0.45, 0.1],
  [-0.12, 0.2],
  [-0.025, 0.06],
  [-0.02, -0.2],
  [0.02, -0.2],
];

export class FallingLeaves {
  private meshes: [THREE.InstancedMesh, THREE.InstancedMesh];
  private leaves: Leaf[] = [];
  private tmp = new THREE.Object3D();
  private spawnAcc = 0;
  private gust = 0;

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.meshes = [new THREE.InstancedMesh(leafGeometry(MAPLE), mat, MAX), new THREE.InstancedMesh(leafGeometry([], true), mat, MAX)];
    for (const m of this.meshes) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color());
      scene.add(m);
    }
  }

  private spawn(center: THREE.Vector3) {
    const kind: 0 | 1 = Math.random() < 0.6 ? 0 : 1;
    const c = new THREE.Color(PALETTE[Math.floor(Math.random() * PALETTE.length)]);
    c.offsetHSL((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.08);
    this.leaves.push({
      kind,
      x: center.x + (Math.random() - 0.5) * 30,
      y: 5 + Math.random() * 5,
      z: center.z + (Math.random() - 0.5) * 30,
      vy: 0.42 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      freq: 1.6 + Math.random() * 1.2,
      amp: 0.5 + Math.random() * 0.6,
      spin: (Math.random() - 0.5) * 2.4,
      yaw: Math.random() * Math.PI * 2,
      size: (kind === 0 ? 0.23 : 0.2) * (0.8 + Math.random() * 0.45),
      color: c,
      rest: -1,
      life: 110 + Math.random() * 80,
      tiltX: 0,
      tiltZ: 0,
    });
  }

  /** intensity 0..1 : feuilles qui tombent (automne) ; hors saison, celles au sol se fanent. */
  update(dt: number, time: number, center: THREE.Vector3, intensity: number, groundY: number) {
    dt = Math.min(dt, 0.1);
    // de temps en temps une rafale emporte les feuilles
    this.gust += (Math.max(0, Math.sin(time * 0.21) * Math.sin(time * 0.53)) * 1.6 - this.gust) * Math.min(1, dt * 0.8);
    const wind = 0.25 + this.gust;
    const falling = this.leaves.reduce((a, l) => a + (l.rest < 0 ? 1 : 0), 0);
    if (intensity > 0.01) {
      this.spawnAcc += dt * intensity * (7 + this.gust * 8);
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        if (falling < FALL_MAX) this.spawn(center);
      }
    }
    for (const l of this.leaves) {
      if (l.rest < 0) {
        // chute en zigzag : balancement latéral, la feuille penche du côté où elle glisse
        const sw = Math.sin(time * l.freq + l.phase);
        l.x += (wind + Math.cos(time * l.freq + l.phase) * l.amp) * dt;
        l.z += Math.sin(time * l.freq * 0.7 + l.phase * 1.3) * l.amp * 0.5 * dt;
        l.y -= l.vy * (0.75 + 0.5 * Math.abs(sw)) * dt;
        l.yaw += l.spin * dt;
        l.tiltZ = sw * 0.9;
        l.tiltX = Math.cos(time * l.freq * 0.8 + l.phase) * 0.55;
        if (l.y <= groundY + 0.01) {
          l.rest = 0;
          l.y = groundY + 0.004 + Math.random() * 0.006;
          l.tiltX = (Math.random() - 0.5) * 0.25;
          l.tiltZ = (Math.random() - 0.5) * 0.25;
        }
      } else {
        // au sol : elle sèche (brunit) puis disparaît ; plus vite quand l'automne est fini
        l.rest += dt * (intensity > 0.01 ? 1 : 4);
      }
    }
    this.leaves = this.leaves.filter((l) => l.rest < l.life);
    // au-delà du maximum au sol, les plus anciennes s'en vont
    let resting = 0;
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      if (this.leaves[i].rest < 0) continue;
      if (++resting > REST_MAX) this.leaves.splice(i, 1);
    }
    const counts = [0, 0];
    const t = this.tmp;
    const dry = new THREE.Color(0x7a5230);
    const col = new THREE.Color();
    for (const l of this.leaves) {
      const m = this.meshes[l.kind];
      const i = counts[l.kind]++;
      const fade = l.rest < 0 ? 1 : Math.min(1, (l.life - l.rest) / 8);
      t.position.set(l.x, l.y, l.z);
      // feuille à plat (plan XZ), puis bascules du vol et rotation sur elle-même
      t.rotation.set(-Math.PI / 2 + l.tiltX, 0, 0);
      t.rotateOnWorldAxis(Y_AXIS, l.yaw);
      t.rotateZ(l.tiltZ);
      t.scale.setScalar(l.size * fade);
      t.updateMatrix();
      m.setMatrixAt(i, t.matrix);
      col.copy(l.color);
      if (l.rest >= 0) col.lerp(dry, Math.min(0.55, l.rest / l.life));
      m.setColorAt(i, col);
    }
    this.meshes.forEach((m, k) => {
      m.count = counts[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
