// Le chemin de terre du camion des revendeurs : une branche de la route qui s'écarte en courbe, longe la
// parcelle du bas à droite et rejoint son grand portail. Terre battue, ornières, herbe au milieu, bords
// qui se fondent dans le pré ; devant le portail, une aire ronde où le camion fait demi-tour.
// Le même tracé sert à conduire le camion (render/delivery.ts) et à dégager le décor (countryside.ts).
import * as THREE from 'three';
import { BIRD_ORDERS, WORLD } from '../config/balance';
import { C, box, merge, mesh } from './geo';
import { lump } from './nature';

type Pt = [number, number];
const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Bruit doux le long du chemin. */
function wave(u: number, seed: number) {
  const i = Math.floor(u);
  const f = u - i;
  const k = f * f * (3 - 2 * f);
  return hash(i + seed * 57) * (1 - k) + hash(i + 1 + seed * 57) * k;
}

const LANE_W = WORLD.ROAD_Z - WORLD.ROAD_HALF / 2;
const LANE_E = WORLD.ROAD_Z + WORLD.ROAD_HALF / 2;
const Z = BIRD_ORDERS.yardZ;
/** Milieu du camion garé. */
const PARKED = BIRD_ORDERS.rearX - BIRD_ORDERS.tail;
/** Le portail, à l'est de la parcelle. */
export const YARD_GATE = { x: 80, z: Z };

/** La branche, de la voie vers l'ouest jusqu'au portail. */
const BRANCH: Pt[] = [
  [BIRD_ORDERS.stopX, LANE_W],
  [93.4, LANE_W - 0.02],
  [91.2, 39.05],
  [88.9, 37.75],
  [86.7, 35.7],
  [85.1, 33],
  [84.3, 30.2],
  [83.7, 27.9],
  [82.5, 26.1],
  [80.9, 25.2],
  [79, Z],
];
/** L'aire de demi-tour, devant le portail. */
export const TURN_PAD = { x: 85.1, z: 23.3, rx: 3.7, rz: 3.7 };
/** Le camion ressort à reculons, sa caisse pivote vers le nord dans l'aire... */
const TURN_END: Pt = [86.6, 21.6];
const BACK: Pt[] = [[PARKED, Z], [77.5, Z], [80.5, Z], [82.9, Z - 0.2], [85.1, 23.6], TURN_END];
/** ... puis repart en marche avant par le chemin, et rejoint la voie vers l'est. */
const LEAVE: Pt[] = [TURN_END, [85.9, 23], [85, 25.3], [84.4, 27.8], [84.3, 30.2], [85.1, 33], [86.7, 35.7], [88.9, 37.75], [91.5, 39.5], [94.6, 40.85], [98, LANE_E], [100, LANE_E]];

/** Échantillonne une courbe douce passant par ces points. */
function smooth(pts: Pt[], step = 0.25): Pt[] {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = Math.max(8, Math.round(curve.getLength() / step));
  return curve.getSpacedPoints(n).map((p) => [p.x, p.z] as Pt);
}

export interface Route {
  total: number;
  at(s: number): { x: number; z: number; heading: number };
}
function route(pts: Pt[]): Route {
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lens[lens.length - 1];
  return {
    total,
    at(s) {
      const d = Math.max(0, Math.min(total, s));
      let a = 0;
      let b = lens.length - 1;
      while (b - a > 1) {
        const m = (a + b) >> 1;
        if (lens[m] < d) a = m;
        else b = m;
      }
      const dx = pts[b][0] - pts[a][0];
      const dz = pts[b][1] - pts[a][1];
      const k = (d - lens[a]) / Math.max(1e-6, lens[b] - lens[a]);
      return { x: pts[a][0] + dx * k, z: pts[a][1] + dz * k, heading: Math.atan2(-dz, dx) };
    },
  };
}

const branch = smooth(BRANCH);
/** Entrée (marche avant), sortie à reculons, puis retour à la route. */
export const ENTRY = route(smooth([...BRANCH, [PARKED, Z]]));
export const BACKUP = route(smooth(BACK));
export const EXIT = route(smooth(LEAVE));
/** Où il attend, sur le chemin, que la route soit libre. */
export const EXIT_WAIT = (() => {
  let w = 0;
  while (w < EXIT.total && EXIT.at(w).z < 36.3) w += 0.1;
  return w;
})();
/** Longueur totale du trajet d'entrée (pour que le camion soit à l'heure). */
export const ENTRY_LENGTH = ENTRY.total;

/** Le chemin (et son aire de demi-tour) passe-t-il ici ? Pour ne rien planter dessus. */
export function nearTruckRoad(x: number, z: number, m = 1.5) {
  if (x < 79 || x > 97 || z < 15 || z > 40) return false;
  if (Math.hypot((x - TURN_PAD.x) / (TURN_PAD.rx + m - 0.5), (z - TURN_PAD.z) / (TURN_PAD.rz + m - 0.5)) < 1) return true;
  for (let i = 0; i < branch.length; i += 3) if (Math.hypot(branch[i][0] - x, branch[i][1] - z) < m) return true;
  return false;
}

/** Touffes d'herbe du milieu du chemin et de ses bords (herbe du pré, ondulant au vent). */
export function roadsideTufts(): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  const seed = 3;
  for (let i = 4; i < branch.length - 2; i += 2) {
    const [x, z] = branch[i];
    if (z > 38.3 || Math.hypot((x - TURN_PAD.x) / TURN_PAD.rx, (z - TURN_PAD.z) / TURN_PAD.rz) < 1) continue;
    const [nx, nz] = normalAt(branch, i);
    const k = i * 0.61 + seed;
    // au milieu : par touffes, là où les roues ne passent pas
    if (wave(i * 0.11, seed) > 0.42) out.push([x + nx * (hash(k) - 0.5) * 0.2, z + nz * (hash(k) - 0.5) * 0.2, hash(k * 3) * 6.28, 0.55 + hash(k * 5) * 0.3]);
    // sur les bords : plus hautes, plus serrées
    for (const sd of [-1, 1]) {
      const u = 1.32 + hash(k * sd + 11) * 0.5;
      if (hash(k * sd + 7) < 0.8) out.push([x + nx * sd * u, z + nz * sd * u, hash(k * 9 * sd) * 6.28, 0.8 + hash(k * 13 + sd) * 0.45]);
    }
  }
  // autour de l'aire de demi-tour
  for (let a = 0; a < 60; a++) {
    const t = (a / 60) * Math.PI * 2;
    const r = 1.04 + hash(a * 3.3) * 0.16;
    const x = TURN_PAD.x + Math.cos(t) * TURN_PAD.rx * r;
    const z = TURN_PAD.z + Math.sin(t) * TURN_PAD.rz * r;
    if (x > 80.4 && Math.hypot(x - 83.8, z - 29) > 2.2) out.push([x, z, hash(a) * 6.28, 0.75 + hash(a * 7) * 0.4]);
  }
  return out;
}

function normalAt(list: Pt[], i: number): Pt {
  const a = list[Math.max(0, i - 1)];
  const b = list[Math.min(list.length - 1, i + 1)];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l = Math.hypot(dx, dz) || 1;
  return [-dz / l, dx / l];
}

const DIRT = new THREE.Color(0xb59a72);
const DIRT_LIGHT = new THREE.Color(0xc6ad84);
const RUT = new THREE.Color(0x8b7352);
const STRIP = new THREE.Color(0x8fb765);
const _c = new THREE.Color();

/** Bande de terre : colonnes de points en travers du chemin, couleur et transparence par sommet. */
function ribbon(list: Pt[], o: { half: number; y: number; seed: number; ruts?: boolean; flare?: (i: number) => number; fade?: (x: number, z: number) => number }) {
  const cols = [-1.3, -1, -0.74, -0.54, -0.36, -0.15, 0, 0.15, 0.36, 0.54, 0.74, 1, 1.3];
  const nc = cols.length;
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  list.forEach(([x, z], i) => {
    const [nx, nz] = normalAt(list, i);
    const hw = o.half * (0.9 + 0.2 * wave(i * 0.09, o.seed)) + (o.flare?.(i) ?? 0);
    const fade = o.fade?.(x, z) ?? 1;
    cols.forEach((u, j) => {
      const au = Math.abs(u);
      const side = u < 0 ? 1 : 2;
      const ragged = au >= 1 ? (wave(i * 0.23, o.seed + side) - 0.5) * 0.35 : (wave(i * 0.3, o.seed + side * 3) - 0.5) * 0.05;
      const off = u * hw + Math.sign(u) * ragged;
      pos.push(x + nx * off, o.y, z + nz * off);
      nor.push(0, 1, 0);
      const speck = wave(i * 0.5 + j * 3.1, o.seed + 5);
      _c.copy(speck > 0.5 ? DIRT_LIGHT : DIRT).lerp(DIRT, 0.5 + Math.abs(speck - 0.5));
      if (o.ruts) {
        // les ornières : plus sombres par endroits, là où l'eau a stagné
        if (au === 0.54) _c.lerp(RUT, 0.55 + wave(i * 0.17, o.seed + side * 7) * 0.45);
        // l'herbe du milieu, par plaques
        const grass = wave(i * 0.13, o.seed + 13);
        if (u === 0) _c.lerp(STRIP, 0.25 + grass * 0.75);
        else if (au === 0.15) _c.lerp(STRIP, Math.max(0, grass - 0.45) * 1.1);
      }
      const a = (au > 1 ? 0 : 1) * fade;
      col.push(_c.r, _c.g, _c.b, a);
      if (j < nc - 1 && i < list.length - 1) {
        const q = i * nc + j;
        idx.push(q, q + 1, q + nc, q + 1, q + nc + 1, q + nc);
      }
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** Bruit doux en deux dimensions, pour que la terre ne soit jamais d'un seul ton. */
function patchNoise(x: number, z: number, seed: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = x - xi;
  const v = z - zi;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const at = (a: number, b: number) => hash(a * 13.7 + b * 71.3 + seed * 5.1);
  const n0 = at(xi, zi) + (at(xi + 1, zi) - at(xi, zi)) * su;
  const n1 = at(xi, zi + 1) + (at(xi + 1, zi + 1) - at(xi, zi + 1)) * su;
  return n0 + (n1 - n0) * sv;
}

/** Tache de terre aux bords fondus : la cour devant la rampe, l'aire de demi-tour devant le portail. */
function dirtPatch(cx: number, cz: number, rx: number, rz: number, y: number, seed: number) {
  const STEP = 0.36;
  const nx = Math.ceil((rx * 2.5) / STEP);
  const nz = Math.ceil((rz * 2.5) / STEP);
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = cx - rx * 1.25 + i * STEP;
      const z = cz - rz * 1.25 + j * STEP;
      pos.push(x, y, z);
      nor.push(0, 1, 0);
      // le bord serpente, et la terre se fond dans l'herbe sur une petite largeur
      const edge = Math.hypot((x - cx) / rx, (z - cz) / rz) + (patchNoise(x * 0.5, z * 0.5, seed) - 0.5) * 0.3;
      const a = Math.max(0, Math.min(1, (1.02 - edge) / 0.14));
      _c.copy(DIRT).lerp(DIRT_LIGHT, patchNoise(x * 0.9, z * 0.9, seed + 1));
      _c.lerp(RUT, Math.max(0, patchNoise(x * 0.42, z * 0.42, seed + 2) - 0.55) * 0.9);
      col.push(_c.r, _c.g, _c.b, a);
      if (i < nx && j < nz) {
        const q = j * (nx + 1) + i;
        idx.push(q, q + nx + 1, q + 1, q + 1, q + nx + 1, q + nx + 2);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

const ROAD_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false });
function soft(g: THREE.BufferGeometry) {
  const m = new THREE.Mesh(g, ROAD_MAT);
  m.receiveShadow = true;
  return m;
}

/** Clôture de bois qui suit une partie du chemin, sur un côté. */
function roadRails(list: Pt[], i0: number, i1: number, side: number, off: number, parts: THREE.BufferGeometry[]) {
  const pts: Pt[] = [];
  for (let i = i0; i <= i1; i += 7) {
    const [nx, nz] = normalAt(list, i);
    pts.push([list[i][0] + nx * side * off, list[i][1] + nz * side * off]);
  }
  pts.forEach(([x, z], k) => {
    parts.push(box(0.1, 0.72, 0.1, C.woodDark, [x, 0.36, z]));
    const nxt = pts[k + 1];
    if (!nxt) return;
    const dx = nxt[0] - x;
    const dz = nxt[1] - z;
    const l = Math.hypot(dx, dz);
    const ry = Math.atan2(-dz, dx);
    for (const y of [0.34, 0.58]) parts.push(box(l + 0.06, 0.055, 0.05, C.wood, [(x + nxt[0]) / 2, y, (z + nxt[1]) / 2], [0, ry, 0]));
  });
}

/**
 * Pose le chemin dans le décor. `yard` regroupe ce qui est sur la parcelle : on ne le voit qu'une fois
 * celle-ci achetée, le chemin s'arrêtant sinon au grand portail.
 */
export function buildTruckRoad(scene: THREE.Object3D) {
  const Y = 0.034;
  const GRASS = 0.1;
  // la terre déborde un peu sur l'enrobé en sortant de la route, et se fond dans le pré au portail
  scene.add(
    soft(
      ribbon(branch, {
        half: 1.2,
        y: Y,
        seed: 2,
        ruts: true,
        flare: (i) => Math.max(0, 1 - i / 30) * 0.9,
        fade: (x, z) => (z > 38.5 ? 0.6 : 1) * Math.min(1, (x - 80.05) / 0.6),
      }),
    ),
    soft(dirtPatch(TURN_PAD.x, TURN_PAD.z, TURN_PAD.rx, TURN_PAD.rz, Y - 0.001, 8)),
    // les traces du camion qui y fait demi-tour
    soft(ribbon(smooth(BACK.slice(3)), { half: 0.86, y: Y + 0.001, seed: 6, ruts: true, fade: (x, z) => Math.max(0, Math.min(1, (1.02 - Math.hypot((x - TURN_PAD.x) / TURN_PAD.rx, (z - TURN_PAD.z) / TURN_PAD.rz)) / 0.3)) * 0.8 })),
    soft(ribbon(smooth(LEAVE.slice(0, 4)), { half: 0.86, y: Y + 0.0015, seed: 7, ruts: true, fade: (x, z) => Math.max(0, Math.min(1, (1.02 - Math.hypot((x - TURN_PAD.x) / TURN_PAD.rx, (z - TURN_PAD.z) / TURN_PAD.rz)) / 0.3)) * 0.8 })),
  );
  // quelques cailloux et une petite clôture de bois de chaque côté de la grande courbe
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < branch.length; i += 5) {
    const [x, z] = branch[i];
    if (z > 38.2 || x < 80.6) continue;
    const a = hash(i * 1.7) * 6.28;
    const r = 0.95 + hash(i * 2.3) * 0.5;
    if (hash(i * 3.1) < 0.5) parts.push(lump(0.05 + hash(i) * 0.06, 0, hash(i * 5) < 0.5 ? 0xa59a88 : 0xc2b8a4, [x + Math.cos(a) * r, Y + 0.02, z + Math.sin(a) * r], [1, 0.55, 1], i, 0.12));
  }
  roadRails(branch, 32, 74, 1, 2.05, parts);
  roadRails(branch, 38, 72, -1, 2.05, parts);
  scene.add(mesh(merge(parts), true, true));

  // sur la parcelle : le chemin continue jusqu'au nez du camion, et la cour s'étale devant la rampe
  const yard = new THREE.Group();
  const inside = smooth([[80.1, Z], [75, Z], [BIRD_ORDERS.rearX - 6.6, Z]]);
  yard.add(
    soft(ribbon(inside, { half: 0.92, y: GRASS + 0.012, seed: 11, ruts: true, fade: (x) => Math.min(1, (x - (BIRD_ORDERS.rearX - 6.6)) / 1.2) })),
    soft(dirtPatch(78.4, Z, 1.95, 3.3, GRASS + 0.011, 12)),
    // le seuil sous le portail raccorde le chemin à la parcelle, un peu plus haute
    mesh(merge([box(0.8, 0.118, 1.94, 0xb59a72, [80.1, 0.059, Z]), box(0.8, 0.004, 0.3, 0x8b7352, [80.1, 0.12, Z - 0.56]), box(0.8, 0.004, 0.3, 0x8b7352, [80.1, 0.12, Z + 0.56])]), false, true),
  );
  scene.add(yard);
  return { yard };
}
