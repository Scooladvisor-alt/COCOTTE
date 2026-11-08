// Robot ramasseur d'œufs, inspiré des vrais robots agricoles : petit rover à quatre roues
// crantées, coque blanche à bandeau vert. Tout l'avant est une vraie bouche : un tunnel creux, noir
// à l'intérieur, au ras du sol, avec un tapis roulant au fond et deux brosses latérales qui tournent
// pour pousser l'œuf dedans. L'œuf y roule tout entier et disparaît sous le capot (rien ne le coupe).
// Plateau alvéolé à l'arrière où l'on voit les œufs ramassés, mât avec lidar tournant, antenne et
// voyant d'état (bleu en tournée, vert en charge, rouge batterie faible). Chaque robot a sa borne
// de recharge : socle à contacts cuivrés, colonne et balise lumineuse.
import * as THREE from 'three';
import { C, CREATURE_MAT, MAT, box, cyl, merge, mesh, sph } from './geo';
import { EGG_MAT, eggGeometry } from './models';

const cmesh = (g: THREE.BufferGeometry, cast = true, receive = true) => mesh(g, cast, receive, CREATURE_MAT);

export interface RobotView {
  root: THREE.Group;
  body: THREE.Group;
  /** Les deux brosses latérales, devant la bouche (elles tournent pour pousser l'œuf dedans). */
  sweepers: THREE.Mesh[];
  /** Les tasseaux du tapis roulant, au fond du tunnel (ils défilent vers l'intérieur). */
  belt: THREE.Mesh;
  /** Œufs en train d'être avalés (plusieurs à la fois au niveau 3) : pivot au centre de l'œuf. */
  mouths: Array<{ pivot: THREE.Group; egg: THREE.Mesh; gulp: Gulp | null }>;
  level: number;
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
  /** Œufs déjà pris en charge (pour ne pas les reprendre deux fois). */
  gulpSeen: Set<number>;
  /** Défilement du tapis roulant. */
  beltT: number;
}

/**
 * Un œuf avalé : il part exactement de là où il était (au sol ou au bord du pondoir), se couche,
 * puis roule (ou glisse, pour l'œuf d'oie, couché dans la longueur) jusqu'au fond du tunnel.
 */
export interface Gulp {
  id: number;
  t: number;
  dur: number;
  /** Centre et orientation de départ. */
  c0: THREE.Vector3;
  q0: THREE.Quaternion;
  /** Orientation couchée (sur le flanc, en travers ; dans la longueur pour l'œuf d'oie). */
  qLie: THREE.Quaternion;
  /** Rayon de l'œuf (il roule de sa distance divisée par ce rayon). */
  rad: number;
  roll: boolean;
  /** Couché devant la bouche, prêt à entrer. */
  cA: THREE.Vector3;
  zEnd: number;
  /** Venu d'un pondoir : il arrive en arc par-dessus le rebord et le perchoir (points de contrôle). */
  arc: THREE.Vector3 | null;
  arc2: THREE.Vector3 | null;
}

const SHELL = 0xf3f4f6;
const SHELL_D = 0xd9dde3;
const DARK = 0x2f333b;
const INSIDE = 0x14161a;
const GREEN1 = 0x2e9d57;
const SOFT = 0xf08a3a;

/**
 * La bouche (repère du robot, avant vers +z) : un tunnel creux de l'ouverture (z = front) jusqu'au
 * fond (z = back), entre les parois intérieures (|x| < half), du tapis (y = floor) au plafond (y = roof).
 */
export const MOUTH = { front: 0.25, back: -0.11, half: 0.142, floor: 0.016, roof: 0.253 };
/** Hauteur libre sous le plafond du tunnel (le plafond noir descend un peu sous le pont). */
export const MOUTH_CLEAR = MOUTH.roof - 0.003;

const geos = new Map<number, THREE.BufferGeometry>();
function robotGeometry(level = 1) {
  const hit = geos.get(level);
  if (hit) return hit;
  // (le niveau 2 se reconnaît à son bandeau bleu)
  // (niveau 2 : bandeau bleu ; niveau 3 : bandeau doré)
  const GREEN = level === 3 ? 0xd9a520 : level === 2 ? 0x2f6bff : GREEN1;
  const { front, back, half, roof } = MOUTH;
  const depth = front - back;
  const midZ = (front + back) / 2;
  const wall = 0.2 - half - 0.003;
  const wallX = half + 0.003 + wall / 2;
  const p: THREE.BufferGeometry[] = [];
  // arrière du châssis et de la coque (derrière le tunnel)
  p.push(box(0.36, 0.07, 0.25 + back - 0.005, DARK, [0, 0.1, (-0.25 + back - 0.005) / 2]));
  p.push(box(0.4, 0.13, 0.23 + back - 0.005, SHELL, [0, 0.2, (-0.23 + back - 0.005) / 2]));
  // flancs de la bouche : longerons du châssis et parois de coque, de chaque côté du tunnel
  for (const sx of [-1, 1]) {
    p.push(box(wall, 0.07, 0.5, DARK, [sx * wallX, 0.1, 0]));
    p.push(box(wall, 0.13, 0.23 - back + 0.005, SHELL, [sx * wallX, 0.2, (0.23 + back - 0.005) / 2]));
    // le bas des flancs, devant les roues avant, descend jusqu'au sol (la bouche est fermée sur les côtés)
    p.push(box(wall, 0.065, 0.1, DARK, [sx * wallX, 0.0325, front - 0.05]));
  }
  // pont au-dessus du tunnel, capot et plaque supérieure
  p.push(box(0.4, 0.265 - roof, 0.23 - back + 0.005, SHELL, [0, (roof + 0.265) / 2, (0.23 + back - 0.005) / 2]));
  p.push(box(0.37, 0.03, 0.42, SHELL_D, [0, 0.28, 0]));
  for (const sx of [-1, 1]) p.push(box(0.02, 0.1, 0.44, SHELL_D, [sx * 0.2, 0.21, 0], [0, 0, sx * 0.25]));
  // bandeau de couleur tout autour (interrompu par la bouche)
  for (const sx of [-1, 1]) {
    p.push(box(0.006, 0.028, 0.465, GREEN, [sx * 0.2015, 0.165, 0]));
    p.push(box(wall, 0.028, 0.006, GREEN, [sx * wallX, 0.165, 0.2335]));
  }
  p.push(box(0.405, 0.028, 0.006, GREEN, [0, 0.165, -0.2335]));
  // intérieur du tunnel, tout noir : parois, plafond, fond, et le lit du tapis roulant
  for (const sx of [-1, 1]) p.push(box(0.003, roof, depth, INSIDE, [sx * (half + 0.0015), roof / 2, midZ]));
  p.push(box(half * 2 + 0.006, 0.004, depth, INSIDE, [0, roof - 0.001, midZ]));
  p.push(box(half * 2 + 0.006, roof, 0.006, INSIDE, [0, roof / 2, back - 0.003]));
  p.push(box(half * 2, 0.012, depth, 0x23262d, [0, 0.006, midZ]));
  // pare-chocs de caoutchouc au-dessus de l'ouverture, lèvre de caoutchouc au ras du sol
  p.push(box(0.4, 0.034, 0.028, DARK, [0, roof + 0.02, front + 0.002]));
  p.push(box(half * 2, 0.006, 0.012, 0x1f2126, [0, 0.003, front + 0.005]));
  // deux volets en entonnoir de part et d'autre de l'ouverture
  for (const sx of [-1, 1]) p.push(box(0.01, 0.06, 0.09, DARK, [sx * (half + 0.03), 0.045, front + 0.035], [0, sx * 0.55, 0]));
  // phares sur le front des flancs, caméra sur le capot
  for (const sx of [-1, 1]) p.push(box(0.04, 0.022, 0.008, 0xfff4d0, [sx * wallX, 0.215, 0.234]));
  p.push(box(0.07, 0.04, 0.035, DARK, [0, 0.315, 0.19]));
  p.push(cyl(0.014, 0.014, 0.012, 10, 0x6fa8dc, [0, 0.315, 0.209], [Math.PI / 2, 0, 0]));
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
  // plateau alvéolé à l'arrière (6 alvéoles)
  p.push(box(0.3, 0.05, 0.22, 0x8fa3b8, [0, 0.315, -0.1]));
  p.push(box(0.31, 0.012, 0.23, 0x7a8ea3, [0, 0.344, -0.1]));
  for (const x of [-0.085, 0, 0.085]) for (const z of [-0.05, -0.15]) p.push(cyl(0.032, 0.026, 0.02, 10, 0x5f7286, [x, 0.346, z]));
  // trappe de visite du réservoir, sur le capot
  p.push(box(0.16, 0.012, 0.1, SHELL_D, [0, 0.296, 0.07]));
  p.push(box(0.05, 0.01, 0.02, DARK, [0, 0.304, 0.11]));
  // mât arrière : lidar (à part, il tourne), antenne, voyant
  p.push(cyl(0.012, 0.014, 0.16, 6, 0x9aa3ab, [-0.13, 0.37, -0.2]));
  p.push(cyl(0.004, 0.004, 0.14, 4, DARK, [-0.13, 0.53, -0.2]));
  p.push(sph(0.009, 6, 4, 0xd8433a, [-0.13, 0.6, -0.2]));
  // écran arrière et bandeau à logo
  p.push(box(0.12, 0.06, 0.008, 0x1f2a35, [0.08, 0.22, -0.232]));
  p.push(box(0.09, 0.008, 0.004, 0x48d47a, [0.08, 0.225, -0.237]));
  for (const sx of [-1, 1]) p.push(box(0.004, 0.035, 0.12, 0xffffff, [sx * 0.205, 0.165, -0.02]));
  const g = merge(p);
  geos.set(level, g);
  return g;
}

/** Espacement des tasseaux du tapis roulant (ils défilent d'un pas, puis recommencent). */
export const BELT_STEP = 0.06;

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
    box(0.165, 0.04, 0.105, GREEN1, [0, 0.2, -0.33]),
    box(0.1, 0.07, 0.006, 0x1f2a35, [0, 0.36, -0.278]),
    box(0.06, 0.008, 0.004, 0x48d47a, [0, 0.36, -0.274]),
    box(0.18, 0.02, 0.12, DARK, [0, 0.52, -0.33]),
    box(0.012, 0.12, 0.012, 0x9aa3ab, [0, 0.58, -0.4]),
    box(0.26, 0.015, 0.18, 0x2b3d5c, [0, 0.66, -0.45], [0.55, 0, 0]),
  ]);
  return dockGeo;
}

export function createRobotView(level = 1): RobotView {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.add(cmesh(robotGeometry(level)));
  // brosses latérales (comme celles d'un aspirateur robot) : cinq faisceaux de brins orange, au ras du sol
  const sweepGeo = merge([
    cyl(0.018, 0.018, 0.012, 10, DARK, [0, 0.006, 0]),
    ...Array.from({ length: 5 }, (_, k) => {
      const a = (k / 5) * Math.PI * 2;
      return box(0.065, 0.006, 0.008, SOFT, [Math.cos(a) * 0.04, 0.004, Math.sin(a) * 0.04], [0, -a, 0]);
    }),
  ]);
  const sweepers = [-1, 1].map((sx) => {
    const m = cmesh(sweepGeo, false, true);
    m.position.set(sx * (MOUTH.half + 0.02), 0.002, MOUTH.front + 0.085);
    body.add(m);
    return m;
  });
  // tasseaux du tapis roulant, dans le fond du tunnel (sous l'œuf)
  const cleats: THREE.BufferGeometry[] = [];
  for (let z = MOUTH.back + 0.02; z <= MOUTH.front - 0.02 - BELT_STEP; z += BELT_STEP) cleats.push(box(MOUTH.half * 2 - 0.02, 0.004, 0.01, 0x3a3f4a, [0, 0.014, z]));
  const belt = cmesh(merge(cleats), false, true);
  body.add(belt);
  const mouths = Array.from({ length: level === 3 ? 4 : 1 }, () => {
    const pivot = new THREE.Group();
    const egg = new THREE.Mesh(eggGeometry('roux'), EGG_MAT.clone());
    egg.castShadow = true;
    egg.receiveShadow = true;
    pivot.add(egg);
    pivot.visible = false;
    body.add(pivot);
    return { pivot, egg, gulp: null as Gulp | null };
  });
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
  return { root, body, sweepers, belt, mouths, level, eggs, led, ledMat, brush, dock, dockLedMat, phase: Math.random() * 6, px: 0, pz: 0, gulpSeen: new Set(), beltT: 0 };
}
export { C, MAT };
