// Fientes : de temps en temps, une poule laisse une petite crotte noire (à pointe blanche) dans
// l'herbe derrière elle. Elles sèchent puis disparaissent au bout d'environ une journée de jeu.
// Purement visuel (la propreté du poulailler reste gérée par la simulation).
import * as THREE from 'three';
import { HOUR, TIME } from '../config/balance';
import { inGrid } from '../sim/core';
import type { GameState, Hen, HenAct } from '../sim/types';
import { MAT, merge, sph } from './geo';

const MAX = 700;
/** Une fiente toutes les ~4 heures de jeu par poule éveillée. */
const PER_SECOND = 1 / (4 * HOUR);
const LIFE = TIME.DAY;
/** Pas de fiente pendant ces activités (au nid, au bain de poussière, à l'abri…). */
const SKIP = new Set<HenAct>(['sleep', 'enter', 'exit', 'lay', 'bathe', 'caught', 'flee']);

interface Drop {
  x: number;
  z: number;
  t: number;
  size: number;
  rot: number;
}

export class Droppings {
  private mesh: THREE.InstancedMesh;
  private drops: Drop[] = [];
  private lastT = -1;
  private tmp = new THREE.Object3D();

  constructor(scene: THREE.Scene, private groundY: number) {
    const geo = merge([
      sph(0.034, 7, 4, 0x2b241f, [0, 0.01, 0], [1, 0.42, 1.25]),
      sph(0.022, 6, 4, 0x1f1a17, [0.018, 0.02, 0.018], [1, 0.6, 1]),
      // pointe blanche (urates), comme les vraies fientes de poule
      sph(0.013, 5, 4, 0xe8e4d8, [0.012, 0.03, 0.014], [1, 0.55, 1]),
    ]);
    this.mesh = new THREE.InstancedMesh(geo, MAT, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
  }

  update(s: GameState) {
    const now = s.clock.t;
    // le temps a reculé : autre partie chargée
    if (now < this.lastT) this.reset();
    const dt = this.lastT < 0 ? 0 : Math.max(0, Math.min(5, now - this.lastT));
    this.lastT = now;
    if (dt > 0) {
      for (const h of s.hens) if (this.canDrop(h) && Math.random() < dt * PER_SECOND) this.drop(h, now);
    }
    // les plus anciennes sèchent et disparaissent
    while (this.drops.length && now - this.drops[0].t > LIFE) this.drops.shift();
    if (this.drops.length > MAX) this.drops.splice(0, this.drops.length - MAX);
    const m = this.tmp;
    let n = 0;
    for (const d of this.drops) {
      const age = (now - d.t) / LIFE;
      // apparition, puis elle s'aplatit et rétrécit en séchant
      const pop = Math.min(1, (now - d.t) / 0.4);
      const k = d.size * pop * (age > 0.65 ? 1 - (age - 0.65) / 0.35 : 1);
      if (k <= 0.01) continue;
      m.position.set(d.x, this.groundY, d.z);
      m.rotation.set(0, d.rot, 0);
      m.scale.set(k, k * (1 - age * 0.4), k);
      m.updateMatrix();
      this.mesh.setMatrixAt(n++, m.matrix);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Après un chargement ou une nouvelle partie : on repart d'une herbe propre. */
  reset() {
    this.drops = [];
    this.lastT = -1;
  }

  private canDrop(h: Hen) {
    if (SKIP.has(h.act)) return false;
    return inGrid(Math.floor(h.x), Math.floor(h.z));
  }

  private drop(h: Hen, now: number) {
    // juste derrière la poule
    const back = 0.16 + Math.random() * 0.06;
    this.drops.push({
      x: h.x - Math.sin(h.heading) * back + (Math.random() - 0.5) * 0.06,
      z: h.z - Math.cos(h.heading) * back + (Math.random() - 0.5) * 0.06,
      t: now,
      // petites fientes discrètes (environ deux fois plus petites qu’avant)
      size: (h.young ? 0.28 : 0.45) + Math.random() * 0.2,
      rot: Math.random() * Math.PI * 2,
    });
  }
}
