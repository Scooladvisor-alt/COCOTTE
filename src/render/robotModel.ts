// Robot ramasseur d'œufs, inspiré des vrais robots agricoles : petit rover à quatre roues
// crantées, coque blanche à bandeau vert, phares et caméra à l'avant, bras articulé terminé par
// une ventouse souple qui cueille les œufs au sol, plateau alvéolé à l'arrière où l'on voit les
// œufs ramassés, mât avec lidar tournant, antenne et voyant d'état (bleu en tournée, vert en
// charge, rouge batterie faible). Chaque robot a sa borne de recharge : socle à contacts cuivrés,
// colonne et balise lumineuse.
import * as THREE from 'three';
import { C, CREATURE_MAT, MAT, box, cyl, merge, mesh, sph } from './geo';
import { EGG_MAT, eggGeometry } from './models';
import { strip } from './people';

const cmesh = (g: THREE.BufferGeometry, cast = true, receive = true) => mesh(g, cast, receive, CREATURE_MAT);

export interface RobotView {
  root: THREE.Group;
  body: THREE.Group;
  eggs: THREE.Mesh[];
  led: THREE.Mesh;
  ledMat: THREE.MeshBasicMaterial;
  /** Lidar qui tourne sur le mât. */
  brush: THREE.Mesh;
  dock: THREE.Group;
  /** Balise de la borne (couleur pilotée par le rendu). */
  dockLedMat: THREE.MeshBasicMaterial;
  phase: number;
  px: number;
  pz: number;
}

const SHELL = 0xf3f4f6;
const SHELL_D = 0xd9dde3;
const DARK = 0x2f333b;
const GREEN = 0x2e9d57;
const SOFT = 0xf08a3a;

let geo: THREE.BufferGeometry | null = null;
function robotGeometry() {
  if (geo) return geo;
  const p: THREE.BufferGeometry[] = [];
  // châssis et coque (avant vers +z)
  p.push(box(0.36, 0.07, 0.5, DARK, [0, 0.1, 0]));
  p.push(box(0.4, 0.13, 0.46, SHELL, [0, 0.2, 0]));
  p.push(box(0.37, 0.03, 0.42, SHELL_D, [0, 0.28, 0]));
  for (const sx of [-1, 1]) p.push(box(0.02, 0.1, 0.44, SHELL_D, [sx * 0.2, 0.21, 0], [0, 0, sx * 0.25]));
  p.push(box(0.405, 0.028, 0.465, GREEN, [0, 0.165, 0]));
  // roues crantées et garde-boue
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 0.235;
      const z = sz * 0.16;
      p.push(cyl(0.085, 0.085, 0.07, 14, 0x2b2b31, [x, 0.085, z], [0, 0, Math.PI / 2]));
      p.push(cyl(0.045, 0.045, 0.075, 10, 0xb7c0c7, [x, 0.085, z], [0, 0, Math.PI / 2]));
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        p.push(box(0.074, 0.02, 0.025, 0x1f2126, [x, 0.085 + Math.sin(a) * 0.085, z + Math.cos(a) * 0.085], [-a, 0, 0]));
      }
      p.push(box(0.09, 0.02, 0.2, SHELL, [x, 0.19, z]));
    }
  // pare-chocs, phares, caméra
  p.push(box(0.36, 0.055, 0.04, DARK, [0, 0.11, 0.255]));
  for (const sx of [-1, 1]) p.push(box(0.07, 0.035, 0.012, 0xfff4d0, [sx * 0.12, 0.22, 0.232]));
  p.push(box(0.07, 0.05, 0.03, DARK, [0, 0.24, 0.238]));
  p.push(cyl(0.016, 0.016, 0.012, 10, 0x6fa8dc, [0, 0.24, 0.255], [Math.PI / 2, 0, 0]));
  // plateau alvéolé à l'arrière (6 alvéoles)
  p.push(box(0.3, 0.05, 0.22, 0x8fa3b8, [0, 0.315, -0.1]));
  p.push(box(0.31, 0.012, 0.23, 0x7a8ea3, [0, 0.344, -0.1]));
  for (const x of [-0.085, 0, 0.085]) for (const z of [-0.05, -0.15]) p.push(cyl(0.032, 0.026, 0.02, 10, 0x5f7286, [x, 0.346, z]));
  // bras articulé : tourelle, épaule, bras, avant-bras, poignet et ventouse souple
  p.push(cyl(0.05, 0.06, 0.04, 14, DARK, [0, 0.31, 0.11]));
  p.push(sph(0.034, 10, 8, SHELL_D, [0, 0.34, 0.11]));
  p.push(strip([0, 0.34, 0.11], [0, 0.45, 0.25], 0.04, 0.04, SHELL));
  p.push(sph(0.026, 10, 8, DARK, [0, 0.45, 0.25]));
  p.push(strip([0, 0.45, 0.25], [0, 0.2, 0.35], 0.034, 0.034, SHELL));
  p.push(sph(0.022, 8, 6, DARK, [0, 0.2, 0.35]));
  p.push(cyl(0.012, 0.012, 0.06, 6, 0x9aa3ab, [0, 0.16, 0.35]));
  p.push(cyl(0.035, 0.016, 0.035, 12, SOFT, [0, 0.12, 0.35]));
  for (const sx of [-1, 1]) p.push(strip([sx * 0.022, 0.15, 0.35], [sx * 0.03, 0.1, 0.37], 0.012, 0.02, SOFT));
  // câble du bras
  p.push(strip([0.03, 0.33, 0.08], [0.03, 0.42, 0.22], 0.008, 0.008, 0x1f2126));
  // mât arrière : lidar (à part, il tourne), antenne, voyant
  p.push(cyl(0.012, 0.014, 0.16, 6, 0x9aa3ab, [-0.13, 0.37, -0.2]));
  p.push(cyl(0.004, 0.004, 0.14, 4, DARK, [-0.13, 0.53, -0.2]));
  p.push(sph(0.009, 6, 4, 0xd8433a, [-0.13, 0.6, -0.2]));
  // écran arrière et bandeau à logo
  p.push(box(0.12, 0.06, 0.008, 0x1f2a35, [0.08, 0.22, -0.232]));
  p.push(box(0.09, 0.008, 0.004, 0x48d47a, [0.08, 0.225, -0.237]));
  for (const sx of [-1, 1]) p.push(box(0.004, 0.035, 0.12, 0xffffff, [sx * 0.205, 0.165, -0.02]));
  geo = merge(p);
  return geo;
}

/** Alvéoles du plateau (x, z). */
const EGG_SPOTS: Array<[number, number]> = [
  [-0.085, -0.05],
  [0, -0.05],
  [0.085, -0.05],
  [-0.085, -0.15],
  [0, -0.15],
  [0.085, -0.15],
];

let dockGeo: THREE.BufferGeometry | null = null;
/** Borne : socle (le robot s'y gare, contacts vers l'arrière) et colonne à balise côté stockage (-z). */
function dockGeometry() {
  if (dockGeo) return dockGeo;
  dockGeo = merge([
    box(0.5, 0.025, 0.62, 0x5b616c, [0, 0.013, 0]),
    box(0.52, 0.02, 0.06, 0xf0c94a, [0, 0.027, 0.3]),
    box(0.08, 0.012, 0.18, 0xd08a45, [-0.1, 0.03, -0.18]),
    box(0.08, 0.012, 0.18, 0xd08a45, [0.1, 0.03, -0.18]),
    box(0.16, 0.5, 0.1, SHELL, [0, 0.26, -0.33]),
    box(0.165, 0.04, 0.105, GREEN, [0, 0.2, -0.33]),
    box(0.1, 0.07, 0.006, 0x1f2a35, [0, 0.36, -0.278]),
    box(0.06, 0.008, 0.004, 0x48d47a, [0, 0.36, -0.274]),
    box(0.18, 0.02, 0.12, DARK, [0, 0.52, -0.33]),
    box(0.012, 0.12, 0.012, 0x9aa3ab, [0, 0.58, -0.4]),
    box(0.26, 0.015, 0.18, 0x2b3d5c, [0, 0.66, -0.45], [0.55, 0, 0]),
  ]);
  return dockGeo;
}

export function createRobotView(): RobotView {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.add(cmesh(robotGeometry()));
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x3aa0ff });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), ledMat);
  led.position.set(-0.13, 0.475, -0.2);
  body.add(led);
  const brush = cmesh(merge([cyl(0.04, 0.042, 0.035, 14, DARK, [0, 0, 0]), cyl(0.041, 0.041, 0.01, 14, 0x6fa8dc, [0, 0.005, 0]), box(0.02, 0.012, 0.012, 0xd8433a, [0.035, 0.012, 0])]), false, false);
  brush.position.set(-0.13, 0.46, -0.2);
  body.add(brush);
  const eggs: THREE.Mesh[] = [];
  for (const [x, z] of EGG_SPOTS) {
    const e = new THREE.Mesh(eggGeometry('roux'), EGG_MAT);
    e.scale.setScalar(0.7);
    e.position.set(x, 0.355, z);
    e.visible = false;
    body.add(e);
    eggs.push(e);
  }
  root.add(body);
  // borne de recharge et sa balise
  const dock = new THREE.Group();
  dock.add(cmesh(dockGeometry()));
  const dockLedMat = new THREE.MeshBasicMaterial({ color: 0x48d47a });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 12), dockLedMat);
  beacon.position.set(0, 0.57, -0.3);
  dock.add(beacon);
  return { root, body, eggs, led, ledMat, brush, dock, dockLedMat, phase: Math.random() * 6, px: 0, pz: 0 };
}
export { C, MAT };
