// Robot ramasseur d'œufs : disque bas façon aspirateur robot, capteur sur le dessus,
// bac transparent où l'on voit les œufs ramassés, voyant d'état (bleu en route, vert en charge).
import * as THREE from 'three';
import { C, CREATURE_MAT, MAT, box, cyl, merge, mesh, sph } from './geo';

const cmesh = (g: THREE.BufferGeometry, cast = true, receive = true) => mesh(g, cast, receive, CREATURE_MAT);
import { EGG_MAT, eggGeometry } from './models';

export interface RobotView {
  root: THREE.Group;
  body: THREE.Group;
  eggs: THREE.Mesh[];
  led: THREE.Mesh;
  ledMat: THREE.MeshBasicMaterial;
  brush: THREE.Mesh;
  dock: THREE.Group;
  phase: number;
  px: number;
  pz: number;
}

let geo: THREE.BufferGeometry | null = null;
function robotGeometry() {
  if (geo) return geo;
  geo = merge([
    cyl(0.3, 0.31, 0.09, 24, 0xf3f4f6, [0, 0.065, 0]),
    cyl(0.31, 0.31, 0.025, 24, 0x3a3f4a, [0, 0.02, 0]),
    cyl(0.27, 0.27, 0.012, 24, 0xd7dbe2, [0, 0.115, 0]),
    // pare-chocs avant
    box(0.36, 0.06, 0.05, 0x5b6170, [0, 0.07, 0.27]),
    // tourelle capteur
    cyl(0.07, 0.08, 0.05, 14, 0x3a3f4a, [0, 0.145, -0.1]),
    // bac à œufs
    cyl(0.15, 0.13, 0.05, 16, 0xc9d7e8, [0, 0.145, 0.07]),
    // bras ramasseur
    box(0.2, 0.02, 0.06, 0x8b93a3, [0, 0.04, 0.33]),
  ]);
  return geo;
}

const EGG_SPOTS: Array<[number, number]> = [
  [-0.06, 0.03],
  [0.05, 0.05],
  [0, 0.12],
  [-0.07, 0.12],
  [0.07, 0.13],
  [0, 0.0],
];

export function createRobotView(): RobotView {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.add(cmesh(robotGeometry()));
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x3aa0ff });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), ledMat);
  led.position.set(0, 0.18, -0.1);
  body.add(led);
  const brush = cmesh(merge([box(0.03, 0.012, 0.16, 0x9aa0aa, [0, 0, 0.08]), box(0.16, 0.012, 0.03, 0x9aa0aa, [0, 0, 0.08])]), false, false);
  brush.position.set(0.2, 0.012, 0.18);
  body.add(brush);
  const eggs: THREE.Mesh[] = [];
  for (const [x, z] of EGG_SPOTS) {
    const e = new THREE.Mesh(eggGeometry('roux'), EGG_MAT);
    e.scale.setScalar(0.75);
    e.rotation.set(1.3, 0, 0.3);
    e.position.set(x, 0.19, z + 0.03);
    e.visible = false;
    body.add(e);
    eggs.push(e);
  }
  root.add(body);
  // borne de recharge
  const dock = new THREE.Group();
  dock.add(cmesh(merge([box(0.34, 0.2, 0.08, 0xe9ecf1, [0, 0.1, 0]), box(0.24, 0.04, 0.1, 0x3a3f4a, [0, 0.03, 0.06]), sph(0.02, 6, 4, 0x48b86b, [0.1, 0.17, 0.045])])));
  return { root, body, eggs, led, ledMat, brush, dock, phase: Math.random() * 6, px: 0, pz: 0 };
}
export { C, MAT };
