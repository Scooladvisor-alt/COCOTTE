// Le camion du couvoir : quand un lot de poules est commandé, il arrive par la route, s'arrête
// devant le portail (feux de détresse), le temps que les poules descendent, puis repart.
// Sa position se lit sur le temps simulé : il suit l'accélération du jeu et la pause.
import * as THREE from 'three';
import { DELIVERY, WORLD, smoothstep } from '../config/balance';
import { GATE } from '../sim/core';
import type { GameState } from '../sim/types';
import { C, box, cyl, merge, mesh, sph } from './geo';

const STOP_X = GATE.x + 0.5;
/** Voie côté ferme (on roule à droite : vers l'ouest). */
const LANE = WORLD.ROAD_Z - WORLD.ROAD_HALF / 2;
const RUN = 45;

function truckModel() {
  const g = new THREE.Group();
  const wheel = (x: number, z: number) => [cyl(0.22, 0.22, 0.14, 12, 0x2b2b31, [x, 0.22, z], [Math.PI / 2, 0, 0]), cyl(0.11, 0.11, 0.15, 8, 0xc9ccd1, [x, 0.22, z], [Math.PI / 2, 0, 0])];
  const parts = [
    // cabine (avant vers +x)
    box(0.9, 0.85, 1.06, C.white, [1.25, 0.72, 0]),
    box(0.92, 0.12, 1.08, 0x2f6bff, [1.25, 0.36, 0]),
    box(0.05, 0.38, 0.92, 0x9fc4dc, [1.71, 0.9, 0]),
    box(0.5, 0.32, 1.08, 0x9fc4dc, [1.35, 0.92, 0]),
    box(0.08, 0.1, 1.06, 0x55585f, [1.72, 0.4, 0]),
    // châssis et plateau
    box(2.3, 0.14, 1.0, 0x55585f, [-0.2, 0.36, 0]),
    box(2.0, 0.08, 1.1, C.woodDark, [-0.45, 0.48, 0]),
    ...wheel(1.15, 0.5),
    ...wheel(1.15, -0.5),
    ...wheel(-0.85, 0.5),
    ...wheel(-0.85, -0.5),
  ];
  // ridelles à claire-voie
  for (const z of [-0.53, 0.53]) for (let y = 0.6; y < 1.25; y += 0.16) parts.push(box(2.0, 0.07, 0.04, C.wood, [-0.45, y, z]));
  for (const x of [-1.42, -0.45, 0.52]) for (const z of [-0.53, 0.53]) parts.push(box(0.06, 0.8, 0.06, C.woodDark, [x, 0.9, z]));
  parts.push(box(0.04, 0.7, 1.1, C.woodDark, [0.53, 0.88, 0]));
  // cageots de poules empilés, quelques têtes qui dépassent
  for (let i = 0; i < 6; i++) {
    const x = -1.15 + (i % 3) * 0.55;
    const y = 0.64 + Math.floor(i / 3) * 0.3;
    parts.push(box(0.48, 0.26, 0.9, 0xd9b77a, [x, y, 0]));
    parts.push(sph(0.07, 6, 5, i % 2 ? 0xb5652e : C.white, [x, y + 0.17, 0.2]));
    parts.push(box(0.03, 0.04, 0.03, 0xd9534f, [x, y + 0.24, 0.2]));
  }
  // panneau du couvoir
  parts.push(box(0.04, 0.22, 0.8, 0xf0c94a, [1.71, 1.24, 0]));
  g.add(mesh(merge(parts)));
  // feux de détresse (ils clignotent à l'arrêt)
  const blinkMat = new THREE.MeshBasicMaterial({ color: 0xf0a33a });
  const blink = new THREE.Group();
  for (const [x, z] of [
    [1.72, 0.45],
    [1.72, -0.45],
    [-1.47, 0.45],
    [-1.47, -0.45],
  ])
    blink.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.12), blinkMat).translateX(x).translateY(0.5).translateZ(z));
  g.add(blink);
  return { g, blink };
}

export interface DeliveryTruck {
  update(s: GameState): void;
  /** Position sur la route (pour que la circulation l'évite), null s'il n'est pas là. */
  onRoad(): { x: number; z: number; len: number } | null;
}

export function buildDeliveryTruck(scene: THREE.Scene): DeliveryTruck {
  const { g, blink } = truckModel();
  g.visible = false;
  scene.add(g);
  /** Heure d'arrivée de la livraison en cours (gardée après la descente des poules, pour le départ). */
  let eta = -1;
  return {
    onRoad: () => (g.visible ? { x: g.position.x, z: g.position.z, len: 3.4 } : null),
    update(s) {
      const t = s.clock.t;
      const next = s.deliveries.reduce((a, d) => Math.min(a, d.eta), Infinity);
      if (eta < 0 || t > eta + DELIVERY.unload + DELIVERY.drive) eta = Number.isFinite(next) ? next : -1;
      // on ne montre que le camion qui approche (pas une commande encore lointaine)
      if (eta < 0 || t < eta - DELIVERY.drive) {
        g.visible = false;
        return;
      }
      g.visible = true;
      let x: number;
      const stopped = t >= eta - 0.4 && t <= eta + DELIVERY.unload;
      if (t < eta) {
        // il arrive de l'est et ralentit jusqu'au portail
        const k = smoothstep(eta - DELIVERY.drive, eta - 0.4, t);
        x = STOP_X + RUN * (1 - Math.sin((k * Math.PI) / 2));
      } else if (t <= eta + DELIVERY.unload) x = STOP_X;
      else {
        // puis repart vers l'ouest
        const k = (t - eta - DELIVERY.unload) / DELIVERY.drive;
        x = STOP_X - RUN * k * k;
      }
      g.position.set(x, 0.06, LANE);
      g.rotation.y = Math.PI;
      blink.visible = stopped && Math.floor(performance.now() / 420) % 2 === 0;
    },
  };
}
