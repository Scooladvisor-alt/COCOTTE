// Le décor vivant autour de la ferme : champs du nord et leur tracteur, mare, ponton et canards, moulin,
// potager de la mairie, verger et ruches, puits, charrette fleurie, lampadaires, massifs de fleurs,
// chat, papillons, lucioles, oiseaux et montgolfière. (Décor seul : rien ici n'influence la simulation.)
import * as THREE from 'three';
import { BIRD_ORDERS, GRID_H, GRID_W, GRID_Z0, TRUCK_BAY, WORLD } from '../config/balance';
import { PET_PLOT } from '../config/buildings';
import { C, GLOW, MAT, box, cone, cyl, finalizeExport, merge, mergeChunks, mesh, prism, sph, type V3 } from './geo';
import { FieldKit, lavenderGeometry, type CropKind } from './fields';
import { LANTERN_GLOW, textPanel, tractor } from './models';
import { CROP_CLUMPS, GROUND_MAT, SEASON, SHADOW_RADIUS, Soup, WATER_MAT, WATER_U, contactShadows, floweringBush, lump, plant, pondGeometry, reed, setCropWind, shingledCone, speciesGeometry, type Plant } from './nature';

function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const TIMBER = 0x7a5a3e;
const STONE = 0xc6baa4;
const STONE_D = 0xa89c86;
const IRON = 0x3d4249;
const PICKET = 0xefe7d6;
const STRAW = 0xe2c06a;

/** Zones où l'on ne plante pas d'arbres (décor dédié). */
export const DECOR_ZONES = [
  { x0: -16.5, x1: -4.8, z0: 2.6, z1: 12.5 }, // mare
  { x0: -17, x1: -10, z0: 12.5, z1: 18.5 }, // moulin
];
export function inDecorZone(x: number, z: number) {
  return DECOR_ZONES.some((d) => x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1);
}

export interface Decor {
  update(time: number, dt: number, day: number): void;
  /** L'emplacement de l'animalerie (on clique dessus) ; il disparaît quand elle est construite. */
  petPlot: THREE.Group;
  setPetShop(open: boolean): void;
}

/** Rangée de pieux blancs entre deux points (avec ses deux lisses). */
function pickets(parts: THREE.BufferGeometry[], x0: number, z0: number, x1: number, z1: number) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.round(len / 0.21);
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    parts.push(box(alongX ? 0.07 : 0.022, 0.42, alongX ? 0.022 : 0.07, PICKET, [x, 0.21, z]));
    parts.push(cone(0.05, 0.06, 4, PICKET, [x, 0.45, z], [0, Math.PI / 4, 0]));
  }
  for (const y of [0.13, 0.31]) parts.push(box(alongX ? len : 0.02, 0.03, alongX ? 0.02 : len, 0xdcd3c0, [(x0 + x1) / 2, y, (z0 + z1) / 2]));
}

/** Clôture de bois rustique le long du trottoir. */
function railFence(parts: THREE.BufferGeometry[], x0: number, x1: number, z: number) {
  const n = Math.max(1, Math.round((x1 - x0) / 1.6));
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n;
    parts.push(box(0.09, 0.62, 0.09, TIMBER, [x, 0.31, z]));
    parts.push(cone(0.075, 0.06, 4, 0x6a4e36, [x, 0.65, z], [0, Math.PI / 4, 0]));
  }
  for (const y of [0.26, 0.48]) parts.push(box(x1 - x0, 0.05, 0.035, 0xb08a5e, [(x0 + x1) / 2, y, z + 0.05]));
}

// ----------------------------------------------------------------- Moulin ----
function windmill() {
  const g = new THREE.Group();
  const p: THREE.BufferGeometry[] = [];
  const panes: THREE.BufferGeometry[] = [];
  const PLASTER = 0xf4ecdb;
  const H0 = 0.44;
  const H1 = 3.84;
  const R = (y: number) => 1.26 + ((y - H0) / (H1 - H0)) * (0.96 - 1.26);
  // pièce posée sur la tour (angle a mesuré depuis +x vers +z)
  const on = (a: number, y: number, w: number, h: number, depth: number, color: number, out = 0) => {
    const r = R(y) + out;
    return box(w, h, depth, color, [Math.cos(a) * r, y, Math.sin(a) * r], [0, Math.atan2(Math.cos(a), Math.sin(a)), 0]);
  };
  // socle de pierre, marches, tour enduite
  p.push(cyl(1.44, 1.6, 0.42, 14, STONE, [0, 0.21, 0]));
  p.push(cyl(1.5, 1.5, 0.05, 14, STONE_D, [0, 0.44, 0]));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    p.push(box(0.34, 0.14, 0.05, k % 2 ? STONE_D : 0xd2c7b2, [Math.cos(a) * 1.53, 0.15, Math.sin(a) * 1.53], [0, Math.atan2(Math.cos(a), Math.sin(a)), 0]));
  }
  p.push(cyl(0.96, 1.26, H1 - H0, 14, PLASTER, [0, (H0 + H1) / 2, 0]));
  // bandeaux et pierres apparentes sous l'enduit
  for (const y of [0.56, 3.72]) p.push(cyl(R(y) + 0.015, R(y) + 0.03, 0.09, 14, STONE_D, [0, y, 0]));
  for (let k = 0; k < 26; k++) {
    const a = hash(k * 3) * Math.PI * 2;
    const y = 0.75 + hash(k * 7) * 2.8;
    p.push(on(a, y, 0.16 + hash(k) * 0.14, 0.08 + hash(k * 5) * 0.05, 0.03, k % 3 ? 0xd9cfba : STONE, 0.005));
  }
  // marches et porte cintrée
  const dz = R(0.87);
  p.push(box(0.9, 0.14, 0.42, STONE_D, [0, 0.07, 1.74]), box(0.8, 0.14, 0.32, 0xbdb19b, [0, 0.21, 1.6]));
  p.push(box(0.62, 1.0, 0.06, STONE_D, [0, 0.92, dz - 0.015]));
  p.push(cyl(0.31, 0.31, 0.06, 12, STONE_D, [0, 1.42, dz - 0.015], [Math.PI / 2, 0, 0]));
  p.push(box(0.48, 0.94, 0.05, 0x6e4a2e, [0, 0.92, dz + 0.02]));
  p.push(cyl(0.24, 0.24, 0.05, 12, 0x6e4a2e, [0, 1.39, dz + 0.02], [Math.PI / 2, 0, 0]));
  for (const x of [-0.12, 0.12]) p.push(box(0.012, 0.94, 0.054, 0x57391f, [x, 0.92, dz + 0.02]));
  for (const y of [0.68, 1.16]) p.push(box(0.3, 0.03, 0.056, IRON, [-0.08, y, dz + 0.02]));
  // fenêtres à volets
  const win = (a: number, y: number) => {
    p.push(on(a, y, 0.36, 0.5, 0.05, STONE_D, 0.01));
    panes.push(on(a, y, 0.26, 0.4, 0.05, 0xffffff, 0.03));
    const side = Math.atan2(Math.cos(a), Math.sin(a));
    const ox = Math.cos(side) * 0.26;
    const oz = -Math.sin(side) * 0.26;
    const r = R(y) + 0.02;
    for (const s of [-1, 1]) p.push(box(0.15, 0.46, 0.03, 0x4f7f8f, [Math.cos(a) * r + s * ox, y, Math.sin(a) * r + s * oz], [0, side, 0]));
    p.push(on(a, y - 0.28, 0.44, 0.04, 0.1, 0xd8cfbe, 0.04));
  };
  win(0.5, 1.15);
  win(1.15, 2.42);
  win(0.2, 2.95);
  win(2.4, 2.0);
  // galerie de bois
  const GY = 1.68;
  p.push(cyl(1.42, 1.42, 0.07, 18, 0x8a6a48, [0, GY, 0]));
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    p.push(box(0.03, 0.4, 0.03, TIMBER, [Math.cos(a) * 1.38, GY + 0.22, Math.sin(a) * 1.38]));
    if (k % 3 === 0) p.push(box(0.05, 0.05, 0.42, TIMBER, [Math.cos(a) * 1.24, GY - 0.18, Math.sin(a) * 1.24], [0.62 * 0, Math.atan2(Math.cos(a), Math.sin(a)), 0]));
  }
  p.push(finalizeExport(new THREE.TorusGeometry(1.38, 0.02, 4, 28), TIMBER, [0, GY + 0.42, 0], [Math.PI / 2, 0, 0]));
  p.push(finalizeExport(new THREE.TorusGeometry(1.38, 0.012, 3, 28), TIMBER, [0, GY + 0.22, 0], [Math.PI / 2, 0, 0]));
  // chapeau en écailles, épi et girouette
  p.push(cyl(1.04, 1.04, 0.1, 14, TIMBER, [0, H1 + 0.03, 0]));
  p.push(shingledCone(1.12, 1.0, H1 + 0.08, 0, 0, 0xa95a42, 0x8f4a36, 5, 14));
  p.push(cyl(0.02, 0.03, 0.42, 5, IRON, [0, H1 + 1.26, 0]));
  p.push(sph(0.05, 6, 4, 0xd6a93a, [0, H1 + 1.2, 0]));
  p.push(box(0.36, 0.02, 0.02, IRON, [0, H1 + 1.36, 0]));
  p.push(cone(0.04, 0.09, 4, IRON, [0.21, H1 + 1.36, 0], [0, 0, -Math.PI / 2]));
  p.push(box(0.09, 0.08, 0.012, IRON, [-0.17, H1 + 1.36, 0]));
  // sacs de farine, charreton
  for (const [x, z, r] of [[1.9, 0.6, 0], [2.15, 0.34, 0.8], [1.98, 0.14, 0.3]] as const) p.push(lump(0.15, 0, 0xeee4cc, [x, 0.15, z], [1, 1.12, 0.85], x * 7, 0.12), box(0.1, 0.02, 0.1, 0xb9a57e, [x, 0.3, z], [0, r, 0]));
  p.push(lump(0.15, 0, 0xeee4cc, [2.02, 0.4, 0.42], [1, 0.95, 0.85], 3, 0.12));
  g.add(mesh(merge(p)));
  g.add(mesh(merge(panes), false, false, GLOW));

  // ailes à claire-voie : vergue, lattis et toile
  const arm: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const q: THREE.BufferGeometry[] = [box(0.08, 2.38, 0.07, 0x6e5238, [0, 1.2, 0]), box(0.03, 1.8, 0.03, 0x7f6146, [0.54, 1.46, 0]), box(0.03, 1.8, 0.03, 0x7f6146, [-0.13, 1.46, 0])];
    for (let k = 0; k < 11; k++) q.push(box(0.68, 0.02, 0.022, 0x7f6146, [0.205, 0.56 + k * 0.18, 0]));
    q.push(box(0.46, 1.58, 0.01, 0xf7f0de, [0.28, 1.48, 0.024]));
    const a = merge(q);
    a.rotateZ((i * Math.PI) / 2);
    arm.push(a);
  }
  arm.push(cyl(0.17, 0.17, 0.2, 10, 0x6e5238, [0, 0, 0], [Math.PI / 2, 0, 0]));
  arm.push(cyl(0.07, 0.09, 0.7, 8, 0x6e5238, [0, 0, -0.42], [Math.PI / 2, 0, 0]));
  const blades = new THREE.Group();
  blades.position.set(0, 3.9, 1.56);
  blades.add(mesh(merge(arm), true, false));
  g.add(blades);
  return { group: g, blades };
}

// ------------------------------------------------------------------ Canards ----
function duckGeometry(kind: 'drake' | 'hen' | 'chick') {
  if (kind === 'chick') {
    return merge([sph(0.075, 7, 5, 0xf0d765, [0, 0.07, 0], [0.9, 0.78, 1.25]), sph(0.052, 6, 5, 0xf4de76, [0, 0.15, 0.07]), box(0.03, 0.012, 0.04, 0xe88f30, [0, 0.145, 0.125]), box(0.02, 0.012, 0.012, 0x4a3a2a, [0.046, 0.165, 0.09]), box(0.02, 0.012, 0.012, 0x4a3a2a, [-0.046, 0.165, 0.09])]);
  }
  const drake = kind === 'drake';
  const parts = [
    sph(0.14, 8, 6, drake ? 0xbdb4a4 : 0x9a7a55, [0, 0.1, 0], [0.9, 0.72, 1.4]),
    sph(0.1, 7, 5, drake ? 0x6e4e38 : 0x8a6b48, [0, 0.13, 0.11], [0.96, 0.82, 0.96]),
    sph(0.09, 6, 5, drake ? 0x93897a : 0x7d6342, [0.06, 0.16, -0.06], [0.6, 0.55, 1.5]),
    sph(0.09, 6, 5, drake ? 0x93897a : 0x7d6342, [-0.06, 0.16, -0.06], [0.6, 0.55, 1.5]),
    cone(0.055, 0.12, 5, drake ? 0x3f4a55 : 0x7a5e3e, [0, 0.17, -0.2], [-1.2, 0, 0]),
    sph(0.075, 7, 5, drake ? 0x2c6b46 : 0xa58660, [0, 0.27, 0.16]),
    box(0.052, 0.022, 0.09, 0xeea030, [0, 0.255, 0.255]),
    box(0.02, 0.016, 0.012, 0x151515, [0.072, 0.285, 0.18]),
    box(0.02, 0.016, 0.012, 0x151515, [-0.072, 0.285, 0.18]),
  ];
  if (drake) parts.push(cyl(0.058, 0.064, 0.022, 8, 0xf6f4ee, [0, 0.21, 0.135]));
  return merge(parts);
}

/**
 * Barque en bois, proue vers +x : une vraie coque creuse, faite d'anneaux qui suivent son contour
 * (le bas est sous l'eau). Bordé, plat-bord, fond et bancs sont tous à des hauteurs différentes.
 */
function rowBoat() {
  const L = 0.82;
  const W = 0.3;
  const N = 22;
  // contour : pointu à la proue, arrondi à la poupe
  const ring = (k: number, y: number): V3[] =>
    Array.from({ length: N }, (_, i) => {
      const a = (i / N) * Math.PI * 2;
      const c = Math.cos(a);
      const sharp = 1 - 0.42 * Math.pow(Math.max(0, c), 1.5);
      return [L * k * c, y, W * k * Math.sin(a) * sharp] as V3;
    });
  const hull = new Soup();
  // paroi extérieure : a est en dessous de b
  const outer = (A: V3[], B: V3[], color: number) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      hull.tri(A[i], B[i], A[j], color);
      hull.tri(A[j], B[i], B[j], color);
    }
  };
  // paroi tournée vers l'intérieur
  const inner = (A: V3[], B: V3[], color: number) => {
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      hull.tri(A[i], A[j], B[i], color);
      hull.tri(A[j], B[j], B[i], color);
    }
  };
  const keel = ring(0.66, 0);
  const chine = ring(0.92, 0.14);
  const strake = ring(1, 0.25);
  const rimIn = ring(0.9, 0.262);
  const rimOut = ring(1.02, 0.262);
  const floor = ring(0.66, 0.1);
  outer(keel, chine, 0x4f7f8f);
  outer(chine, strake, 0xf1e8d4);
  outer(strake, rimOut, 0x8a6a48);
  // plat-bord : l'anneau de bois qui fait le tour, vu de dessus
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    hull.tri(rimOut[i], rimIn[i], rimOut[j], 0xa3794f);
    hull.tri(rimOut[j], rimIn[i], rimIn[j], 0xa3794f);
  }
  inner(floor, rimIn, 0x8b6743);
  // le fond
  for (let i = 0; i < N; i++) hull.tri([0, 0.1, 0], floor[(i + 1) % N], floor[i], 0x6b4d33);
  const parts: THREE.BufferGeometry[] = [hull.geometry()];
  // lattes du fond, deux bancs, deux avirons posés sur les bancs
  for (const z of [-0.09, 0, 0.09]) parts.push(box(0.8, 0.012, 0.05, 0x8b6743, [-0.03, 0.115, z]));
  for (const [x, w] of [[0.2, 0.44], [-0.28, 0.48]] as const) parts.push(box(0.12, 0.024, w, 0xb48a5c, [x, 0.2, 0]));
  for (const z of [-0.07, 0.07]) {
    parts.push(box(0.92, 0.016, 0.018, 0xd2b184, [-0.04, 0.225, z]));
    parts.push(box(0.16, 0.014, 0.05, 0xd2b184, [0.46, 0.225, z]));
  }
  // anneau d'amarrage à la proue
  parts.push(cyl(0.012, 0.012, 0.05, 6, IRON, [L * 0.98, 0.285, 0]));
  return merge(parts);
}

/** Bout de corde tendu entre deux points. */
function rope(a: V3, b: V3, r = 0.008) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const g = finalizeExport(new THREE.CylinderGeometry(r, r, d.length(), 4), 0xc9b98a, [0, 0, 0]);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  const m = A.clone().add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

// -------------------------------------------------------------- Montgolfière ----
function balloonModel() {
  const parts: THREE.BufferGeometry[] = [];
  const colors = [0xe85d4a, 0xf6efdd, 0xf0a33a, 0xf6efdd];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const g = new THREE.SphereGeometry(1.3, 3, 9, (i / N) * Math.PI * 2, (Math.PI * 2) / N);
    parts.push(finalizeExport(g, colors[i % 4], [0, 0, 0], [0, 0, 0], [1, 1.14, 1]));
  }
  // bas de l'enveloppe, cordages et nacelle
  parts.push(cyl(0.55, 0.26, 0.55, 12, 0xd9543f, [0, -1.34, 0]));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.78;
    parts.push(box(0.012, 0.62, 0.012, 0x4a4a4a, [Math.cos(a) * 0.17, -1.86, Math.sin(a) * 0.17]));
  }
  parts.push(box(0.34, 0.26, 0.34, 0xa8804f, [0, -2.26, 0]));
  parts.push(box(0.37, 0.03, 0.37, 0x6e5238, [0, -2.13, 0]));
  parts.push(box(0.08, 0.12, 0.08, 0xe9c7a6, [0.05, -2.06, 0.05]));
  return merge(parts);
}

// -------------------------------------------------------------------- Décor ----
export function buildDecor(scene: THREE.Scene): Decor {
  const statics: THREE.BufferGeometry[] = [];

  // ---------------------------------------------------- Champs cultivés ----
  // au-delà du bord nord de la ferme (la grille s'étend jusqu'à GRID_Z0)
  const N0 = GRID_Z0 - 16;
  const N1 = GRID_Z0 - 8;
  const northFields: Array<[number, number, CropKind]> = [
    [-10, 5, 'wheat'],
    [6.2, 18, 'veg'],
    [19.2, 32, 'colza'],
    [33.2, 46, 'lavender'],
    [47.2, 58, 'vines'],
    [59.2, 72, 'plough'],
    [73.2, 86, 'sunflower'],
  ];
  const kit = new FieldKit();
  northFields.forEach(([x0, x1, kind], i) => kit.add(kind, { x0, x1, z0: N0, z1: N1 }, kind !== 'vines', true, i * 11 + 1));
  kit.flush(scene);
  // chemin de terre (deux ornières, de l'herbe au milieu) entre les champs et la ferme
  statics.push(box(GRID_W + 30, 0.05, 1.1, 0xd9c8a4, [GRID_W / 2, 0.03, GRID_Z0 - 7.1]));
  statics.push(box(GRID_W + 30, 0.052, 0.34, 0xa2bd6d, [GRID_W / 2, 0.031, GRID_Z0 - 7.1]));
  // bornes et piquets au coin des champs
  for (const [x0, x1] of northFields) {
    for (const x of [x0, x1]) statics.push(box(0.07, 0.5, 0.07, C.woodDark, [x, 0.25, N1 + 0.25]));
  }

  // un tracteur laboure pendant la journée
  const ploughF = northFields[5];
  const worker = new THREE.Group();
  const tr = mesh(tractor());
  worker.add(tr);
  // la charrue attelée
  const plough = mesh(merge([box(0.5, 0.05, 0.5, 0x8e939b, [-1.05, 0.28, 0]), box(0.07, 0.05, 0.5, 0x3d4249, [-0.74, 0.28, 0]), box(0.12, 0.3, 0.05, 0x3d4249, [-1.1, 0.14, 0.18]), box(0.12, 0.3, 0.05, 0x3d4249, [-1.1, 0.14, -0.18]), box(0.4, 0.05, 0.05, 0x3d4249, [-0.82, 0.3, 0])]));
  worker.add(plough);
  scene.add(worker);
  const tractorPlan = { row: 0, dir: 1, x: ploughF[0] + 1.5, z: N0 + 0.8, turn: 0, heading: 0 };
  worker.position.set(tractorPlan.x, 0.04, tractorPlan.z);

  // --------------------------------------------------------------- Mare ----
  const pondC = { x: -10.2, z: 7.6 };
  const P = pondGeometry(pondC.x, pondC.z, 3.25, 2.35, 1.7);
  const water = new THREE.Mesh(P.water, WATER_MAT);
  water.receiveShadow = true;
  scene.add(water);
  const bank = new THREE.Mesh(P.bank, GROUND_MAT);
  bank.receiveShadow = true;
  scene.add(bank);
  // cailloux et roseaux en touffes, plus fournis du côté du nord-ouest
  const onShore = (a: number, k = 1.04): [number, number] => {
    const R = P.shore(a) * k;
    return [pondC.x + Math.cos(a) * 3.25 * R, pondC.z + Math.sin(a) * 2.35 * R];
  };
  for (let i = 0; i < 14; i++) {
    const a = hash(i * 11) * Math.PI * 2;
    const [x, z] = onShore(a, 1.03 + hash(i) * 0.12);
    statics.push(lump(0.12 + hash(i * 3) * 0.2, 0, i % 3 ? 0xb4ad9d : 0x9c9586, [x, 0.08, z], [1, 0.6, 1.1], i));
    if (i % 4 === 0) statics.push(lump(0.08, 0, 0x7e9c56, [x + 0.05, 0.16, z - 0.03], [1.1, 0.35, 1], i + 3));
  }
  for (let i = 0; i < 7; i++) {
    const a = 3.0 + i * 0.32;
    const [x, z] = onShore(a, 1.0);
    for (let k = 0; k < 7; k++) reed(x + (hash(i * 7 + k) - 0.5) * 0.46, z + (hash(i * 3 + k * 5) - 0.5) * 0.42, 0.55 + hash(i + k * 3) * 0.5, statics, (hash(k + i) - 0.5) * 0.2, k % 2 === 0);
  }
  // (à l'est de la mare : la barque et le ponton restent dégagés)
  for (const a of [-0.42, -0.2]) {
    const [x, z] = onShore(a, 1.0);
    for (let k = 0; k < 5; k++) reed(x + (hash(a * 7 + k) - 0.5) * 0.36, z + (hash(a * 3 + k * 5) - 0.5) * 0.34, 0.45 + hash(a + k * 3) * 0.35, statics, (hash(k + a) - 0.5) * 0.2, k % 2 === 0);
  }
  // nénuphars et leurs fleurs
  const pad: THREE.BufferGeometry[] = [];
  const padAt: Array<[number, number, number]> = [[-12.3, 6.5, 0.26], [-11.9, 7.1, 0.2], [-12.45, 7.5, 0.22], [-11.35, 6.3, 0.17], [-11, 5.95, 0.23], [-10.4, 5.72, 0.16], [-12, 8.2, 0.18]];
  padAt.forEach(([x, z, r], i) => {
    pad.push(finalizeExport(new THREE.CircleGeometry(r, 9, 0.3, 5.7), i % 2 ? 0x57994f : 0x4f8e4a, [x, 0.066, z], [-Math.PI / 2, 0, hash(i) * 6]));
    if (i % 2 === 0) {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + i;
        pad.push(cone(0.04, 0.07, 3, i % 4 === 0 ? 0xf6c6d4 : 0xfaf6ee, [x + Math.cos(a) * 0.045, 0.1, z + Math.sin(a) * 0.045], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]));
      }
      pad.push(sph(0.022, 5, 4, 0xf0c63a, [x, 0.115, z]));
    }
  });
  const lilies = mesh(merge(pad), false, true);
  scene.add(lilies);
  // ponton et barque amarrée
  const JX = -9.25;
  for (let k = 0; k < 12; k++) statics.push(box(0.8, 0.035, 0.19, k % 3 === 0 ? 0xa3794f : k % 3 === 1 ? 0xb48a5c : 0x9c7249, [JX + (hash(k) - 0.5) * 0.04, 0.19, 8.5 + k * 0.205]));
  for (const x of [JX - 0.36, JX + 0.36]) {
    statics.push(box(0.04, 0.05, 2.5, 0x6e5238, [x, 0.15, 9.72]));
    for (const z of [8.58, 9.5, 10.5]) statics.push(cyl(0.035, 0.04, 0.44, 6, 0x6e5238, [x, 0.18, z]));
  }
  statics.push(cyl(0.045, 0.05, 0.56, 6, 0x6e5238, [JX + 0.36, 0.3, 8.62]));
  statics.push(cyl(0.11, 0.09, 0.15, 8, 0xc69a63, [JX - 0.2, 0.28, 8.82]), cyl(0.112, 0.112, 0.012, 8, 0x4d3b2a, [JX - 0.2, 0.33, 8.82]));
  const boat = mesh(rowBoat());
  // amarrée au ponton, la proue vers lui
  const BOAT = { x: -8.2, z: 8.0, ry: -Math.PI / 2 + 0.2 };
  boat.position.set(BOAT.x, 0, BOAT.z);
  boat.rotation.y = BOAT.ry;
  scene.add(boat);
  // la corde : du pieu du ponton à l'anneau de la proue, avec un peu de mou
  {
    const ring: V3 = [BOAT.x + Math.cos(BOAT.ry) * 0.8, 0.29, BOAT.z - Math.sin(BOAT.ry) * 0.8];
    const post: V3 = [JX + 0.36, 0.5, 8.62];
    const slack: V3 = [(ring[0] + post[0]) / 2, 0.24, (ring[2] + post[2]) / 2];
    statics.push(rope(post, slack), rope(slack, ring), cyl(0.05, 0.05, 0.03, 6, 0xc9b98a, [post[0], 0.5, post[2]]));
  }

  // la famille canard fait le tour de la mare
  const drakeG = duckGeometry('drake');
  const henG = duckGeometry('hen');
  const chickG = duckGeometry('chick');
  const brood = [drakeG, henG, chickG, chickG, chickG].map((g) => {
    const d = mesh(g, true, false);
    scene.add(d);
    return d;
  });

  // -------------------------------------------------------------- Moulin ----
  const M = windmill();
  M.group.position.set(-13.5, 0, 14.7);
  scene.add(M.group);
  // chemin du moulin à la cour de la mairie
  statics.push(box(0.9, 0.04, 3.2, 0xdccdaa, [-12.1, 0.03, 18.6]));
  statics.push(box(1.3, 0.04, 0.9, 0xdccdaa, [-11.7, 0.03, 20.4]));
  // charrette de sacs devant le moulin
  {
    const [cx, cz] = [-11.25, 15.2];
    const r = 0.5;
    const cart: THREE.BufferGeometry[] = [box(1.0, 0.06, 0.6, 0x8a6a48, [0, 0.42, 0])];
    for (const s of [-1, 1]) {
      cart.push(box(1.0, 0.16, 0.03, 0x7a5a3e, [0, 0.52, s * 0.3]));
      cart.push(cyl(0.32, 0.32, 0.04, 12, 0x5f4632, [0.05, 0.32, s * 0.36], [Math.PI / 2, 0, 0]));
      cart.push(cyl(0.2, 0.2, 0.05, 8, 0xa3794f, [0.05, 0.32, s * 0.36], [Math.PI / 2, 0, 0]));
      cart.push(box(0.95, 0.035, 0.035, 0x7a5a3e, [0.95, 0.27, s * 0.18], [0, 0, -0.32]));
    }
    cart.push(lump(0.17, 0, 0xeee4cc, [-0.2, 0.62, 0.03], [1.15, 0.9, 0.9], 5, 0.1), lump(0.17, 0, 0xe8dcc0, [0.18, 0.62, -0.05], [1.15, 0.9, 0.9], 6, 0.1));
    const g = merge(cart);
    g.rotateY(r);
    g.translate(cx, 0, cz);
    statics.push(g);
  }

  // ------------------------------------------------------------ Potager ----
  {
    const [X0, X1, Z0, Z1] = [-15.7, -7.3, 29.1, 33.6];
    const GATE_Z = 31.35;
    pickets(statics, X0, Z0, X1, Z0);
    pickets(statics, X0, Z1, X1, Z1);
    pickets(statics, X0, Z0, X0, Z1);
    pickets(statics, X1, Z0, X1, GATE_Z - 0.5);
    pickets(statics, X1, GATE_Z + 0.5, X1, Z1);
    // barrière ouverte et allée de gravier
    statics.push(box(0.1, 0.62, 0.1, TIMBER, [X1, 0.31, GATE_Z - 0.5]), box(0.1, 0.62, 0.1, TIMBER, [X1, 0.31, GATE_Z + 0.5]));
    statics.push(box(1.7, 0.035, 0.7, 0xdccdaa, [X1 - 0.45 + 0.8, 0.03, GATE_Z]));
    statics.push(box(6.2, 0.03, 4.3, 0xa9b774, [X0 + 3.1 + 2.0, 0.025, (Z0 + Z1) / 2]));
    statics.push(box(0.68, 0.035, 3.6, 0xdccdaa, [-7.95, 0.03, GATE_Z - 0.2]));
    const bed = (z: number) => {
      const [cx, L, W] = [-11.1, 4.9, 0.78];
      statics.push(box(L, 0.05, W, 0x6b4a2f, [cx, 0.17, z]));
      for (const s of [-1, 1]) {
        statics.push(box(L + 0.06, 0.2, 0.06, 0x9c7249, [cx, 0.1, z + s * (W / 2)]));
        statics.push(box(0.06, 0.2, W, 0x9c7249, [cx + s * (L / 2), 0.1, z]));
      }
      for (const s of [-1, 1]) for (const e of [-1, 1]) statics.push(box(0.08, 0.26, 0.08, 0x7a5a3e, [cx + s * (L / 2), 0.13, z + e * (W / 2)]));
      for (const dz of [-0.2, 0.2]) statics.push(box(L - 0.1, 0.012, 0.03, 0x5a3e27, [cx, 0.2, z + dz]));
    };
    const BZ = [29.95, 31.15, 32.35];
    BZ.forEach(bed);
    // salades (vertes et rouges)
    for (let k = 0; k < 16; k++) {
      const x = -13.3 + k * 0.29 + (hash(k) - 0.5) * 0.05;
      const z = BZ[0] + (k % 2 ? 0.17 : -0.17);
      statics.push(lump(0.12, 0, k % 3 === 0 ? 0xa55a64 : k % 2 ? 0x8cc46b : 0x7bb65a, [x, 0.28, z], [1, 0.72, 1], k));
    }
    // carottes : fanes et collet orangé
    for (let k = 0; k < 22; k++) {
      const x = -13.35 + k * 0.21;
      const z = BZ[1] + (k % 2 ? 0.2 : -0.2) * (k % 3 === 0 ? 0.2 : 1);
      statics.push(cone(0.045, 0.1, 4, 0xee8a2c, [x, 0.22, z]));
      statics.push(cone(0.075, 0.2, 5, k % 2 ? 0x5aa34b : 0x68ae55, [x, 0.34, z]));
    }
    // tomates tuteurées et potirons
    for (let k = 0; k < 8; k++) {
      const x = -13.3 + k * 0.45;
      const z = BZ[2];
      statics.push(box(0.022, 0.86, 0.022, 0x7d6448, [x, 0.56, z]));
      statics.push(lump(0.14, 0, k % 2 ? 0x5b9548 : 0x69a454, [x, 0.42, z], [1, 1.2, 1], k));
      statics.push(lump(0.11, 0, k % 2 ? 0x69a454 : 0x5b9548, [x, 0.68, z], [1, 1.1, 1], k + 4));
      for (let q = 0; q < 3; q++) statics.push(sph(0.042, 5, 4, q === 1 ? 0xe9a23a : 0xd9433a, [x + Math.cos(q * 2.1 + k) * 0.12, 0.4 + q * 0.14, z + Math.abs(Math.sin(q * 2.1 + k)) * 0.14]));
    }
    for (const [x, r] of [[-9.55, 0.16], [-9.05, 0.2]] as const) {
      statics.push(lump(r, 1, 0xe98a2c, [x, 0.3, BZ[2] + 0.03], [1, 0.74, 1], x, 0.05));
      statics.push(cyl(0.018, 0.028, 0.06, 4, 0x5f7f3a, [x, 0.3 + r * 0.72, BZ[2] + 0.03]));
    }
    // cabane de jardin
    const [sx, sz] = [-14.75, 30.05];
    statics.push(box(1.2, 1.0, 1.1, 0xb48a5c, [sx, 0.5, sz]));
    for (let k = 0; k < 6; k++) statics.push(box(0.012, 1.0, 1.104, 0x8f6b43, [sx - 0.5 + k * 0.2, 0.5, sz]));
    statics.push(prism(1.46, 0.46, 1.36, 0x8f5a43, [sx, 1.0, sz], Math.PI / 2));
    statics.push(box(0.46, 0.8, 0.03, 0x4f7f8f, [sx + 0.2, 0.4, sz + 0.56]));
    statics.push(box(0.02, 0.02, 0.05, 0xd6a93a, [sx + 0.38, 0.42, sz + 0.585]));
    statics.push(box(0.26, 0.24, 0.03, 0xffffff, [sx - 0.3, 0.68, sz + 0.56]));
    statics.push(box(0.025, 0.86, 0.025, 0x8a6a48, [sx - 0.4, 0.42, sz + 0.65], [0.16, 0, 0.05]));
    statics.push(box(0.2, 0.03, 0.06, 0x8e939b, [sx - 0.4, 0.02, sz + 0.72]));
    // châssis vitré pour les semis
    const [fx, fz] = [-14.75, 32.3];
    statics.push(box(1.1, 0.2, 0.8, 0x9c7249, [fx, 0.1, fz]));
    statics.push(box(1.0, 0.03, 0.7, 0x6b4a2f, [fx, 0.21, fz]));
    for (let k = 0; k < 5; k++) statics.push(lump(0.06, 0, 0x8cc46b, [fx - 0.38 + k * 0.19, 0.25, fz + (k % 2 ? 0.14 : -0.14)], [1, 0.6, 1], k));
    statics.push(box(1.16, 0.022, 0.86, 0xc9e6f2, [fx, 0.34, fz], [0.24, 0, 0]));
    // brouette et arrosoir
    {
      const q: THREE.BufferGeometry[] = [
        cyl(0.16, 0.16, 0.05, 10, 0x3d4249, [0.5, 0.16, 0], [Math.PI / 2, 0, 0]),
        box(0.56, 0.2, 0.42, 0x7a9c62, [0.05, 0.36, 0]),
        box(0.48, 0.02, 0.34, 0x5a3e27, [0.05, 0.46, 0]),
      ];
      for (const s of [-1, 1]) q.push(box(0.92, 0.03, 0.03, 0x8a6a48, [-0.03, 0.26, s * 0.17], [0, 0, -0.12]), box(0.03, 0.2, 0.03, 0x8a6a48, [-0.2, 0.11, s * 0.17]));
      q.push(lump(0.11, 0, 0x8cc46b, [0.06, 0.53, 0.06], [1, 0.7, 1], 2));
      const g = merge(q);
      g.rotateY(0.6);
      g.translate(-8.15, 0, 33.0);
      statics.push(g);
      const [wx, wz] = [-13.2, 33.1];
      statics.push(cyl(0.085, 0.1, 0.19, 9, 0x5a9a6c, [wx, 0.1, wz]));
      statics.push(box(0.2, 0.02, 0.02, 0x5a9a6c, [wx + 0.16, 0.17, wz], [0, 0, 0.8]));
      statics.push(cyl(0.035, 0.012, 0.03, 6, 0x5a9a6c, [wx + 0.25, 0.25, wz], [0, 0, 0.8]));
      statics.push(finalizeExport(new THREE.TorusGeometry(0.08, 0.008, 3, 8, Math.PI), 0x5a9a6c, [wx, 0.2, wz]));
    }
    // épouvantail à chemise écossaise, un corbeau sur le bras
    const [ex, ez] = [-8.1, 30.0];
    statics.push(cyl(0.028, 0.034, 1.5, 5, 0x7a5a3e, [ex, 0.75, ez]));
    statics.push(box(1.0, 0.04, 0.04, 0x7a5a3e, [ex, 1.16, ez]));
    statics.push(box(0.34, 0.46, 0.2, 0xa8493c, [ex, 1.0, ez]));
    for (const y of [0.87, 1.0, 1.13]) statics.push(box(0.345, 0.02, 0.205, 0x7d2f28, [ex, y, ez]));
    for (const dx of [-0.08, 0.08]) statics.push(box(0.02, 0.46, 0.205, 0x7d2f28, [ex + dx, 1.0, ez]));
    for (const s of [-1, 1]) {
      statics.push(box(0.3, 0.14, 0.14, 0xa8493c, [ex + s * 0.31, 1.16, ez]));
      for (let k = 0; k < 4; k++) statics.push(cone(0.022, 0.16, 3, STRAW, [ex + s * 0.5, 1.16 + (k - 1.5) * 0.03, ez + (k - 1.5) * 0.025], [0, 0, s * -1.45 + (k - 1.5) * 0.12]));
    }
    for (let k = 0; k < 6; k++) statics.push(cone(0.03, 0.18, 3, STRAW, [ex + (k - 2.5) * 0.05, 0.74, ez], [0, 0, Math.PI + (k - 2.5) * 0.1]));
    statics.push(lump(0.14, 1, 0xdcc99a, [ex, 1.41, ez], [1, 1.04, 1], 2, 0.06));
    statics.push(box(0.03, 0.03, 0.02, 0x2b2b31, [ex + 0.05, 1.44, ez + 0.13]), box(0.03, 0.03, 0.02, 0x2b2b31, [ex - 0.05, 1.44, ez + 0.13]));
    statics.push(box(0.12, 0.012, 0.012, 0x2b2b31, [ex, 1.36, ez + 0.135]));
    statics.push(cyl(0.28, 0.3, 0.025, 12, STRAW, [ex, 1.53, ez]));
    statics.push(cyl(0.11, 0.14, 0.14, 10, STRAW, [ex, 1.61, ez]));
    statics.push(cyl(0.142, 0.142, 0.03, 10, 0x8a4b3a, [ex, 1.565, ez]));
    statics.push(sph(0.06, 6, 5, 0x24242a, [ex + 0.36, 1.31, ez], [1.3, 0.9, 0.85]), sph(0.04, 6, 4, 0x24242a, [ex + 0.42, 1.38, ez]), cone(0.012, 0.05, 3, 0x46464e, [ex + 0.47, 1.38, ez], [0, 0, -Math.PI / 2]), cone(0.024, 0.11, 3, 0x24242a, [ex + 0.28, 1.31, ez], [0, 0, 1.8]));
  }

  // -------------------------------------------------- L'allée de la mairie ----
  // bordures de lavande, entre le chemin du personnel et le trottoir
  {
    const walkN = WORLD.WALK_Z - 0.6;
    const items: Plant[] = [];
    for (let z = 32.3; z < walkN - 0.6; z += 0.42) for (const x of [-6.95, -5.05]) items.push([x, z, hash(z * 5 + x) * 6, 0.92 + hash(z + x) * 0.22]);
    plant(scene, lavenderGeometry(), null, items, { mat: CROP_CLUMPS.garden, spread: 0.06, chunk: 1000 });
    // clôture rustique le long du trottoir
    railFence(statics, -26, -7.6, walkN - 0.32);
    railFence(statics, -3.9, -0.5, walkN - 0.32);
    railFence(statics, 3.7, 10.6, walkN - 0.32);
  }

  // ---------------------------------------------------- Le chemin du camion ----
  // de la route au grand portail, puis dans l'enclos : de la terre battue, deux ornières, de l'herbe au milieu
  {
    const DIRT = 0xb0926a;
    const RUT = 0x8d7350;
    const X = BIRD_ORDERS.laneX;
    const track = (z0: number, z1: number, y: number, w: number) => {
      const c = (z0 + z1) / 2;
      const l = z1 - z0;
      statics.push(box(w, 0.012, l, DIRT, [X, y, c]));
      for (const s of [-1, 1]) statics.push(box(0.3, 0.004, l, RUT, [X + s * 0.56, y + 0.008, c]));
      statics.push(box(0.34, 0.004, l, 0x93b866, [X, y + 0.008, c]));
      for (let z = z0 + 0.3; z < z1 - 0.1; z += 0.62) statics.push(lump(0.09 + hash(z) * 0.05, 0, 0x8fbb5c, [X + (hash(z * 3) - 0.5) * 0.22, y + 0.02, z], [1, 0.5, 1], z, 0.05));
    };
    track(30.1, 37.3, 0.05, 2.4);
    track(TRUCK_BAY.z0 - 0.4, 30, 0.106, 1.94);
    // l'entrée du chemin s'évase au bord du trottoir, et le trottoir s'abaisse pour le laisser passer
    statics.push(box(1.3, 0.012, 1.1, DIRT, [X + 1.5, 0.05, 36.75]), box(1.1, 0.012, 0.6, DIRT, [X - 1.5, 0.05, 37]));
    statics.push(box(3.6, 0.008, 1.22, 0xd5cbb6, [X + 0.5, 0.069, WORLD.WALK_Z]));
  }

  // --------------------------------------------- Charrette fleurie, arbres ----
  {
    const cart: THREE.BufferGeometry[] = [box(1.5, 0.07, 0.8, 0x8a6a48, [0, 0.52, 0])];
    for (const s of [-1, 1]) {
      cart.push(box(1.5, 0.24, 0.04, 0x7a5a3e, [0, 0.68, s * 0.4]));
      cart.push(box(0.04, 0.24, 0.8, 0x7a5a3e, [s * 0.75, 0.68, 0]));
      // roues à rayons
      const wz = s * 0.5;
      cart.push(finalizeExport(new THREE.TorusGeometry(0.4, 0.035, 4, 16), 0x5f4632, [-0.1, 0.42, wz]));
      cart.push(cyl(0.07, 0.07, 0.08, 8, 0x5f4632, [-0.1, 0.42, wz], [Math.PI / 2, 0, 0]));
      for (let k = 0; k < 4; k++) cart.push(box(0.76, 0.024, 0.024, 0x7a5a3e, [-0.1, 0.42, wz], [0, 0, (k * Math.PI) / 4]));
      // brancards appuyés au sol
      cart.push(box(1.25, 0.05, 0.05, 0x7a5a3e, [1.3, 0.3, s * 0.24], [0, 0, -0.42]));
    }
    // chargement : foin, tonneaux de fleurs, bouquets
    cart.push(lump(0.46, 1, 0xdcc272, [-0.05, 0.86, 0], [1.45, 0.62, 0.78], 8, 0.14));
    const COLS = [0xe85d75, 0xf5c542, 0xfaf6ee, 0x9a7ad6, 0xf08a3a];
    for (let k = 0; k < 26; k++) {
      const a = k * 2.39;
      const u = -0.62 + (k / 25) * 1.2;
      cart.push(lump(0.045, 0, COLS[k % 5], [u, 0.98 + Math.sin(a) * 0.08, Math.cos(a) * 0.28], [1, 0.8, 1], k, 0.05));
      if (k % 2) cart.push(lump(0.05, 0, 0x6ea84f, [u + 0.05, 0.93, Math.cos(a + 1) * 0.3], [1, 0.8, 1], k, 0.05));
    }
    const g = merge(cart);
    g.rotateY(-0.42);
    g.translate(5.6, 0, 33.9);
    statics.push(g);
    // tilleuls et rosiers le long de l'herbe
    const limes: Plant[] = [[-2.3, 35.1, 0.6, 1.08], [8.3, 34.5, 2.1, 1.16], [-22.2, 35.0, 4.2, 1.2], [-13.4, 35.2, 1.1, 1.05]];
    plant(scene, speciesGeometry('lime'), speciesGeometry('lime', true), limes, { cast: true, spread: 0.1 });
    const roses: Plant[] = [[4.8, 35.6, 0.7, 0.95], [5.7, 35.75, 2, 0.84], [-2.9, 32.7, 1.2, 0.9], [-3.8, 32.5, 3, 0.8], [10, 32.4, 4, 0.9], [-9.2, 34.9, 5, 0.9], [-17.4, 34.3, 1.6, 0.95], [-18.4, 34.5, 2.6, 0.84]];
    const hyd: Plant[] = [[9.2, 35.7, 1, 0.92], [-25, 35, 2, 0.96], [-24.1, 35.3, 3, 0.86], [-10.3, 35.5, 4, 0.92], [-4.5, 34.7, 5, 0.86]];
    plant(scene, floweringBush(0xe85d75, 1), speciesGeometry('bush', true), roses, { cast: true, spread: 0.06 });
    plant(scene, floweringBush(0x8ea6e8, 2), speciesGeometry('bush', true), hyd, { cast: true, spread: 0.06 });
    scene.add(contactShadows([...limes.map(([x, z, , s]) => [x, z, SHADOW_RADIUS.lime * s] as [number, number, number]), ...[...roses, ...hyd].map(([x, z, , s]) => [x, z, 0.46 * s] as [number, number, number])]));
  }

  // ---------------------------------------------------- Le verger et les ruches ----
  {
    const items: Plant[] = [];
    for (let z = 12.2, a = 0; z < 31; z += 2.75, a++) for (let x = -26.6 + (a % 2) * 1.35; x < -18; x += 2.7) items.push([x, z, hash(x * 3 + z) * 6, 0.92 + hash(z * 2 + x) * 0.24]);
    plant(scene, speciesGeometry('apple'), speciesGeometry('apple', true), items, { cast: true, spread: 0.1 });
    scene.add(contactShadows(items.map(([x, z, , s]) => [x, z, SHADOW_RADIUS.apple * s] as [number, number, number])));
    // ruches peintes au bout du verger
    [0xf6efdd, 0x8fb4d6, 0xf0c34a, 0xf6efdd].forEach((col, i) => {
      const [x, z] = [-26 + i * 1.05, 32.3 + (i % 2) * 0.16];
      for (const [dx, dz] of [[-0.18, -0.15], [0.18, -0.15], [-0.18, 0.15], [0.18, 0.15]]) statics.push(box(0.04, 0.22, 0.04, 0x6e5238, [x + dx, 0.11, z + dz]));
      statics.push(box(0.5, 0.03, 0.44, 0x8a6a48, [x, 0.23, z]));
      statics.push(box(0.42, 0.2, 0.38, col, [x, 0.35, z]), box(0.42, 0.018, 0.38, 0xd8cfbe, [x, 0.46, z]), box(0.42, 0.18, 0.38, col, [x, 0.56, z]));
      statics.push(box(0.5, 0.04, 0.46, 0x9c4433, [x, 0.67, z], [0, 0, 0.05]));
      statics.push(box(0.16, 0.03, 0.02, 0x2b2b31, [x, 0.27, z + 0.195]));
    });
  }

  // --------------------------------------------------------------- Puits ----
  {
    const [x, z] = [-1.7, 28.8];
    statics.push(cyl(0.5, 0.54, 0.52, 14, 0xb4ab9b, [x, 0.26, z]));
    for (let r = 0; r < 3; r++)
      for (let i = 0; i < 12; i++) {
        const a = ((i + (r % 2) * 0.5) / 12) * Math.PI * 2;
        const R = 0.535 - r * 0.012;
        statics.push(box(0.25, 0.14, 0.05, (i + r) % 3 === 0 ? 0xa39a8a : (i + r) % 3 === 1 ? 0xc8bfaf : 0xbab1a1, [x + Math.cos(a) * R, 0.09 + r * 0.16, z + Math.sin(a) * R], [0, Math.atan2(Math.cos(a), Math.sin(a)), 0]));
      }
    statics.push(cyl(0.55, 0.55, 0.05, 14, 0xd8cfbe, [x, 0.55, z]));
    statics.push(cyl(0.42, 0.42, 0.012, 14, 0x2f5d7a, [x, 0.56, z]));
    for (const s of [-1, 1]) {
      statics.push(box(0.09, 1.08, 0.09, TIMBER, [x + s * 0.5, 1.06, z]));
      statics.push(box(0.05, 0.42, 0.05, TIMBER, [x + s * 0.5, 1.42, z + 0.16], [0.75, 0, 0]));
      statics.push(box(0.05, 0.42, 0.05, TIMBER, [x + s * 0.5, 1.42, z - 0.16], [-0.75, 0, 0]));
    }
    statics.push(cyl(0.055, 0.055, 0.96, 8, 0x9c7249, [x, 1.3, z], [0, 0, Math.PI / 2]));
    statics.push(box(0.03, 0.2, 0.03, IRON, [x + 0.56, 1.22, z]), box(0.14, 0.03, 0.03, IRON, [x + 0.62, 1.14, z]));
    statics.push(cyl(0.012, 0.012, 0.4, 3, 0xc9b98a, [x, 1.1, z]));
    statics.push(cyl(0.1, 0.08, 0.16, 8, 0x9c7249, [x, 0.84, z]));
    statics.push(cyl(0.105, 0.105, 0.015, 8, IRON, [x, 0.87, z]));
    statics.push(finalizeExport(new THREE.TorusGeometry(0.09, 0.007, 3, 8, Math.PI), IRON, [x, 0.9, z]));
    // toit de tuiles sur deux pans
    statics.push(prism(1.44, 0.5, 1.22, C.roof, [x, 1.58, z]));
    for (let k = 0; k < 4; k++) {
      const t = k / 4;
      const y = 1.6 + t * 0.44;
      const dz = 0.6 * (1 - t);
      for (const s of [-1, 1]) statics.push(box(1.46, 0.018, 0.06, C.roofDark, [x, y, z + s * dz], [s * 0.68, 0, 0]));
    }
    statics.push(box(1.48, 0.05, 0.08, C.roofDark, [x, 2.09, z]));
    // un seau au pied du puits
    statics.push(cyl(0.1, 0.08, 0.16, 8, 0x9c7249, [x + 0.44, 0.08, z + 0.62]), cyl(0.082, 0.082, 0.01, 8, 0x5a8fb3, [x + 0.44, 0.15, z + 0.62]));
  }

  // ---------------------------------------------- Massifs de fleurs ----
  const flowerColors = [0xe85d75, 0xf5c542, 0xfaf6ee, 0x9a7ad6, 0xf08a3a];
  for (const [x0, x1] of [
    [10.2, 13.4],
    [20.4, 24.6],
    [-3.6, -0.6],
  ]) {
    const L = x1 - x0;
    const cx = (x0 + x1) / 2;
    const z = 30.75;
    statics.push(box(L, 0.1, 0.62, 0x6b4a2f, [cx, 0.05, z]));
    // bordure de pierres
    const nb = Math.round(L / 0.34);
    for (let k = 0; k < nb; k++) {
      const x = x0 + (k + 0.5) * (L / nb);
      for (const s of [-1, 1]) statics.push(box(L / nb - 0.02, 0.14 + hash(k + s) * 0.03, 0.09, k % 2 ? 0xd0c6b2 : 0xbcb19b, [x, 0.07, z + s * 0.33]));
    }
    for (const e of [0, 1]) statics.push(box(0.09, 0.15, 0.72, 0xc6bca8, [e ? x1 : x0, 0.075, z]));
    // des touffes de fleurs par couleur plutôt qu'un semis uniforme
    for (let x = x0 + 0.22, k = 0; x < x1 - 0.1; x += 0.3, k++) {
      const col = flowerColors[Math.floor(k / 3 + hash(x0) * 5) % 5];
      statics.push(lump(0.14, 0, k % 2 ? 0x6ea84f : 0x5f9842, [x, 0.2, z + (k % 2 ? 0.07 : -0.07)], [1, 0.82, 1], k));
      for (let q = 0; q < 3; q++) statics.push(lump(0.05, 0, col, [x + (q - 1) * 0.07, 0.33 + (q % 2) * 0.03, z + (k % 2 ? 0.1 : -0.1) + (q - 1) * 0.04], [1, 0.8, 1], q, 0.05));
    }
  }

  // ----------------------------------------------- Le chat ----
  // (le chien de la maison est géré par le rendu de la ferme : il peut être adopté)
  const FUR = 0x6f6b70;
  const cat = new THREE.Group();
  cat.add(
    mesh(
      merge([
        sph(0.12, 8, 6, FUR, [0, 0.13, -0.02], [0.82, 1.15, 1.15]),
        sph(0.075, 7, 5, 0xe8e2d6, [0, 0.13, 0.07], [0.9, 1.05, 0.7]),
        sph(0.09, 8, 6, FUR, [0, 0.31, 0.06], [1.05, 0.92, 0.95]),
        cone(0.036, 0.075, 3, FUR, [0.056, 0.4, 0.05]),
        cone(0.036, 0.075, 3, FUR, [-0.056, 0.4, 0.05]),
        cone(0.02, 0.045, 3, 0xd9a3a3, [0.056, 0.39, 0.058]),
        cone(0.02, 0.045, 3, 0xd9a3a3, [-0.056, 0.39, 0.058]),
        sph(0.012, 5, 4, 0xc9d94a, [0.038, 0.325, 0.135]),
        sph(0.012, 5, 4, 0xc9d94a, [-0.038, 0.325, 0.135]),
        sph(0.01, 4, 3, 0xd98a8a, [0, 0.3, 0.145]),
        box(0.04, 0.05, 0.05, 0xe8e2d6, [0.055, 0.03, 0.09]),
        box(0.04, 0.05, 0.05, 0xe8e2d6, [-0.055, 0.03, 0.09]),
      ]),
    ),
  );
  const tail = new THREE.Group();
  tail.position.set(0.04, 0.06, -0.12);
  tail.add(mesh(merge([cyl(0.018, 0.026, 0.2, 5, FUR, [0.1, 0.0, 0], [0, 0, -Math.PI / 2]), cyl(0.014, 0.018, 0.14, 5, FUR, [0.25, 0.04, 0], [0, 0, -1.1])]), true, false));
  cat.add(tail);
  cat.position.set(-2.5, 0.45, 19.4);
  cat.rotation.y = 0.9;
  scene.add(cat);

  // -------------------------------------------------------- Lampadaires ----
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
  const poolMat = new THREE.MeshBasicMaterial({ map: LANTERN_GLOW.map, color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const lampPositions: Array<[number, number]> = [];
  // au bord du trottoir côté ferme, la crosse penchée au-dessus des passants (pas sur le parking)
  for (let x = -12; x <= GRID_W + 12; x += 9) if (x < 32.5 || x > 42.5) lampPositions.push([x, WORLD.WALK_Z - 0.75]);
  const lampGlass: THREE.BufferGeometry[] = [];
  lampPositions.forEach(([x, z], i) => {
    // socle mouluré, fût à bagues, crosse à volute, lanterne à quatre pans
    statics.push(cyl(0.11, 0.15, 0.1, 8, IRON, [x, 0.05, z]), cyl(0.07, 0.105, 0.26, 8, IRON, [x, 0.23, z]), cyl(0.09, 0.09, 0.03, 8, IRON, [x, 0.37, z]));
    statics.push(cyl(0.034, 0.055, 2.04, 7, IRON, [x, 1.38, z]), cyl(0.056, 0.056, 0.03, 7, IRON, [x, 1.02, z]), cyl(0.046, 0.046, 0.03, 7, IRON, [x, 2.2, z]));
    statics.push(finalizeExport(new THREE.TorusGeometry(0.17, 0.018, 4, 10, Math.PI), IRON, [x, 2.4, z + 0.17], [0, -Math.PI / 2, 0]));
    statics.push(finalizeExport(new THREE.TorusGeometry(0.07, 0.012, 4, 10, Math.PI * 1.3), IRON, [x, 2.26, z + 0.12], [0, -Math.PI / 2, 2.6]));
    statics.push(box(0.02, 0.06, 0.02, IRON, [x, 2.38, z + 0.34]));
    statics.push(cone(0.16, 0.1, 4, IRON, [x, 2.3, z + 0.34], [0, Math.PI / 4, 0]));
    statics.push(cyl(0.11, 0.085, 0.015, 4, IRON, [x, 2.255, z + 0.34], [0, Math.PI / 4, 0]));
    statics.push(cyl(0.075, 0.075, 0.03, 4, IRON, [x, 1.98, z + 0.34], [0, Math.PI / 4, 0]));
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      statics.push(box(0.012, 0.27, 0.012, IRON, [x + Math.cos(a) * 0.1, 2.12, z + 0.34 + Math.sin(a) * 0.1]));
    }
    lampGlass.push(cyl(0.11, 0.075, 0.26, 4, 0xffffff, [x, 2.12, z + 0.34], [0, Math.PI / 4, 0]));
    // suspension fleurie, un lampadaire sur deux
    if (i % 2 === 0) {
      statics.push(box(0.34, 0.016, 0.016, IRON, [x - 0.17, 1.72, z]));
      statics.push(box(0.008, 0.2, 0.008, IRON, [x - 0.3, 1.62, z]));
      statics.push(cyl(0.12, 0.07, 0.1, 8, 0x8a6a48, [x - 0.3, 1.49, z]));
      statics.push(lump(0.13, 0, 0x6ea84f, [x - 0.3, 1.57, z], [1, 0.8, 1], i));
      for (let k = 0; k < 6; k++) {
        const a = k * 1.05 + i;
        statics.push(lump(0.042, 0, flowerColors[(k + i) % 5], [x - 0.3 + Math.cos(a) * 0.11, 1.56 + (k % 2) * 0.05, z + Math.sin(a) * 0.11], [1, 0.8, 1], k, 0.05));
      }
    }
  });
  const lampMesh = new THREE.Mesh(merge(lampGlass), lampMat);
  scene.add(lampMesh);
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2), poolMat, lampPositions.length);
  lampPositions.forEach(([x, z], i) => pools.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0.075, z + 0.5)));
  pools.renderOrder = 2;
  scene.add(pools);

  for (const g of mergeChunks(statics, 16)) scene.add(mesh(g, true, true));

  // saule et arbres de la mare
  const willows: Plant[] = [[-14.3, 4.6, 0.8, 1.16], [-5.8, 3.7, 2.3, 0.94]];
  plant(scene, speciesGeometry('willow'), speciesGeometry('willow', true), willows, { cast: true, spread: 0.06 });
  scene.add(contactShadows(willows.map(([x, z, , s]) => [x, z, SHADOW_RADIUS.willow * s] as [number, number, number])));

  // ------------------------------------------- Papillons et lucioles ----
  const flyGeo = merge([box(0.12, 0.005, 0.07, 0xffffff, [0.06, 0, 0]), box(0.12, 0.005, 0.07, 0xffffff, [-0.06, 0, 0])]);
  const butterflies = Array.from({ length: 12 }, (_, i) => {
    const m = new THREE.Mesh(flyGeo, new THREE.MeshBasicMaterial({ color: [0xffd23f, 0xffffff, 0xf49ac1, 0x8ec5ff][i % 4], side: THREE.DoubleSide }));
    scene.add(m);
    return { m, cx: 2 + hash(i) * (GRID_W - 4), cz: GRID_Z0 + 2 + hash(i * 3) * (GRID_H - 4), r: 1 + hash(i * 5) * 2.5, s: 0.3 + hash(i * 7) * 0.4, p: hash(i * 11) * 10 };
  });
  const fireflyMat = new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const fireflyGeo = new THREE.SphereGeometry(0.05, 6, 4);
  const fireflies = Array.from({ length: 36 }, (_, i) => {
    const m = new THREE.Mesh(fireflyGeo, fireflyMat);
    scene.add(m);
    const nearPond = i < 14;
    return {
      m,
      cx: nearPond ? pondC.x + (hash(i) - 0.5) * 7 : hash(i * 2) * GRID_W,
      cz: nearPond ? pondC.z + (hash(i * 3) - 0.5) * 5 : GRID_Z0 + hash(i * 4) * GRID_H,
      p: hash(i * 9) * 20,
    };
  });

  // ------------------------------------------------------------ Oiseaux ----
  const birdGeo = merge([box(0.28, 0.02, 0.07, 0x3a3f4a, [0.12, 0, 0], [0, 0, 0.35]), box(0.28, 0.02, 0.07, 0x3a3f4a, [-0.12, 0, 0], [0, 0, -0.35])]);
  const flock = new THREE.Group();
  const birds = Array.from({ length: 5 }, (_, i) => {
    const b = new THREE.Mesh(birdGeo, MAT);
    b.position.set((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.6, 0, -Math.ceil(i / 2) * 0.7);
    flock.add(b);
    return b;
  });
  flock.visible = false;
  scene.add(flock);
  let flockT = 8;

  // ---------------------------------------------- L'emplacement de l'animalerie ----
  // tant qu'elle n'est pas construite : du gravier, des piquets et un grand panneau
  const petPlot = new THREE.Group();
  {
    const P = PET_PLOT;
    const w = P.x1 - P.x0;
    const d = P.z1 - P.z0;
    const cx = (P.x0 + P.x1) / 2;
    const cz = (P.z0 + P.z1) / 2;
    const parts: THREE.BufferGeometry[] = [box(w, 0.05, d, 0xcbbf9f, [cx, 0.025, cz])];
    for (let k = 0; k < 90; k++) parts.push(lump(0.05 + hash(k) * 0.07, 0, k % 2 ? 0xb5a98a : 0xd9cfb4, [P.x0 + 0.3 + hash(k * 3.1) * (w - 0.6), 0.055, P.z0 + 0.3 + hash(k * 5.7) * (d - 0.6)], [1, 0.35, 1], k, 0.1));
    // piquets et cordeau tout autour
    const corners: Array<[number, number]> = [
      [P.x0 + 0.2, P.z0 + 0.2],
      [P.x1 - 0.2, P.z0 + 0.2],
      [P.x1 - 0.2, P.z1 - 0.2],
      [P.x0 + 0.2, P.z1 - 0.2],
    ];
    corners.forEach(([x, z], i) => {
      const [nx, nz] = corners[(i + 1) % 4];
      const len = Math.hypot(nx - x, nz - z);
      const n = Math.round(len / 2.2);
      for (let k = 0; k < n; k++) {
        const t = k / n;
        parts.push(box(0.07, 0.62, 0.07, 0xe9dfc8, [x + (nx - x) * t, 0.34, z + (nz - z) * t]), box(0.078, 0.1, 0.078, 0xe85d3a, [x + (nx - x) * t, 0.6, z + (nz - z) * t]));
      }
      parts.push(nx !== x ? box(len, 0.018, 0.018, 0xe85d3a, [(x + nx) / 2, 0.52, z]) : box(0.018, 0.018, len, 0xe85d3a, [x, 0.52, (z + nz) / 2]));
    });
    // le panneau, bien visible depuis la route
    const sx = cx - 2.2;
    const sz = P.z1 - 1.6;
    parts.push(box(0.12, 1.75, 0.12, C.woodDark, [sx - 1.35, 0.9, sz]), box(0.12, 1.75, 0.12, C.woodDark, [sx + 1.35, 0.9, sz]), box(3.1, 1.2, 0.07, C.woodDark, [sx, 1.3, sz - 0.03]), box(3.3, 0.06, 0.26, C.roof, [sx, 1.93, sz]));
    // planches et sable, prêts pour le chantier
    for (let k = 0; k < 5; k++) parts.push(box(2.3, 0.06, 0.26, k % 2 ? 0xc99c63 : 0xb98c56, [cx + 2.6, 0.1 + Math.floor(k / 3) * 0.07, cz - 1.2 + (k % 3) * 0.3]));
    parts.push(lump(0.7, 1, 0xdcc99a, [cx + 3.2, 0.06, cz + 1.25], [1.3, 0.5, 1], 4, 0.1));
    const m = mesh(merge(parts), true, true);
    petPlot.add(m);
    const big = textPanel('ANIMALERIE', 2.9, 0.62, 0x2f6f4e, '#fbf6e8');
    big.position.set(sx, 1.52, sz + 0.02);
    const small = textPanel('Emplacement à construire', 2.9, 0.4, 0xf3efe6, '#2f6f4e');
    small.position.set(sx, 0.98, sz + 0.02);
    petPlot.add(big, small);
    scene.add(petPlot);
  }

  // ------------------------------------------------------- Montgolfière ----
  const balloon = mesh(balloonModel(), false, false);
  scene.add(balloon);

  return {
    petPlot,
    setPetShop(open) {
      petPlot.visible = !open;
    },
    update(time, dt, day) {
      WATER_U.uTime.value = time;
      setCropWind(time);
      const frozen = SEASON.snow > 0.2;
      lilies.visible = !frozen;
      // la famille canard en file indienne ; le colvert fait sa ronde de son côté
      const dx = -10.95;
      const dz = 7.2;
      brood.forEach((d, i) => {
        d.visible = !frozen;
        if (frozen) return;
        const a = i === 0 ? time * 0.1 + 2.4 : time * 0.13 - (i - 1) * 0.1;
        const rx = i === 0 ? 1.15 : 1.7;
        const rz = i === 0 ? 0.8 : 1.15;
        d.position.set(dx + Math.cos(a) * rx, 0.045 + Math.sin(time * 2 + i) * 0.008, dz + Math.sin(a) * rz);
        d.rotation.y = Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz);
      });
      // elle tangue doucement ; prise dans la glace, elle ne bouge plus
      boat.position.y = frozen ? 0 : Math.sin(time * 0.9) * 0.012;
      boat.rotation.z = frozen ? 0 : Math.sin(time * 0.7) * 0.018;
      M.blades.rotation.z -= dt * 0.5;
      tail.rotation.y = Math.sin(time * 1.3) * 0.5;
      // le tracteur laboure aux heures du jour et rentre dans son coin la nuit
      if (day > 0.5) {
        const p = tractorPlan;
        const X0 = ploughF[0] + 1.5;
        const X1 = ploughF[1] - 1.5;
        if (p.turn > 0) {
          p.turn -= dt;
          // demi-tour au bout du rang : il pivote et se décale d'un rang
          p.heading += ((p.dir > 0 ? 0 : Math.PI) - p.heading) * Math.min(1, dt * 2.2);
          p.z += (N0 + 0.8 + p.row * 0.92 - p.z) * Math.min(1, dt * 1.6);
        } else {
          p.x += p.dir * dt * 0.85;
          if ((p.dir > 0 && p.x > X1) || (p.dir < 0 && p.x < X0)) {
            p.dir *= -1;
            p.row = (p.row + 1) % 8;
            p.turn = 2.4;
          }
        }
        worker.position.set(p.x, 0.04 + Math.sin(time * 8) * 0.004, p.z);
        worker.rotation.y = p.heading;
      }
      // lampadaires et lucioles la nuit
      const night = 1 - day;
      lampMat.color.setRGB(0.55 + 0.45 * night, 0.55 + 0.4 * night, 0.5 + 0.25 * night);
      poolMat.opacity = night * 0.62;
      pools.visible = night > 0.05;
      fireflyMat.opacity = Math.max(0, night - 0.3) * 1.2;
      for (const f of fireflies) {
        f.m.visible = night > 0.35;
        if (!f.m.visible) continue;
        f.m.position.set(f.cx + Math.sin(time * 0.4 + f.p) * 1.2, 0.35 + Math.sin(time * 1.3 + f.p * 2) * 0.2, f.cz + Math.cos(time * 0.35 + f.p) * 1.1);
        f.m.scale.setScalar(0.6 + Math.max(0, Math.sin(time * 3 + f.p * 5)) * 0.8);
      }
      for (const b of butterflies) {
        b.m.visible = day > 0.6 && SEASON.winter < 0.5;
        if (!b.m.visible) continue;
        const a = time * b.s + b.p;
        b.m.position.set(b.cx + Math.cos(a) * b.r + Math.sin(a * 2.7) * 0.3, 0.6 + Math.sin(a * 3.1) * 0.25, b.cz + Math.sin(a * 1.3) * b.r);
        b.m.rotation.set(0, -a, Math.sin(time * 26 + b.p) * 0.9);
      }
      // vol d'oiseaux de temps en temps
      flockT -= dt;
      if (flockT <= 0 && !flock.visible && day > 0.5) {
        flock.visible = true;
        flock.position.set(-40, 7 + Math.random() * 2, GRID_Z0 - 8 + Math.random() * (GRID_H + 10));
        flock.userData.vz = (Math.random() - 0.5) * 2;
      }
      if (flock.visible) {
        flock.position.x += dt * 5;
        flock.position.z += dt * flock.userData.vz;
        flock.rotation.y = Math.PI / 2 - Math.atan2(flock.userData.vz, 5) * 0.6;
        birds.forEach((b, i) => (b.rotation.z = Math.sin(time * 10 + i) * 0.5));
        if (flock.position.x > GRID_W + 40) {
          flock.visible = false;
          flockT = 25 + Math.random() * 35;
        }
      }
      // la montgolfière dérive au-dessus de la campagne, par beau temps
      balloon.visible = day > 0.45 && SEASON.snow < 0.1;
      if (balloon.visible) {
        const a = time * 0.008 + 1;
        balloon.position.set(32 + Math.cos(a) * 72, 15 + Math.sin(time * 0.17) * 0.5, -6 + Math.sin(a * 1.3) * 46);
        balloon.rotation.y = time * 0.03;
      }
    },
  };
}
