// La campagne tout autour de la ferme, jusqu'au-delà de ce que la caméra peut montrer : un sol marbré
// d'un seul tenant, des bois, des champs, des prés avec leurs bêtes, des vergers, des mares, une rivière
// bordée de saules, une route plantée de peupliers et quelques fermes voisines. Aucun bord vide : où
// que l'on regarde, le paysage continue. Presque tout est instancié et fusionné.
import * as THREE from 'three';
import { GRID_W, GRID_Z0, GRID_Z1, WORLD } from '../config/balance';
import { C, MAT, box, cone, cyl, merge, mesh, prism, sph } from './geo';
import { FieldKit, type CropKind, type Rect } from './fields';
import { grassPatchGeometry } from './models';
import { GROUND_MAT, MEADOW_FLOWERS, MEADOW_GRASS, SHADOW_RADIUS, Soup, WATER_MAT, contactShadows, lump, plant, pondGeometry, reed, speciesGeometry, type Plant, type Species } from './nature';

function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const h2 = (a: number, b: number, k = 0) => hash(a * 73.13 + b * 19.71 + k * 5.31);
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Bruit doux (valeurs interpolées) pour marbrer le sol. */
function vnoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = smooth(x - xi);
  const v = smooth(z - zi);
  const a = h2(xi, zi, 2);
  const b = h2(xi + 1, zi, 2);
  const c = h2(xi, zi + 1, 2);
  const d = h2(xi + 1, zi + 1, 2);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------------------------------------------------------------- Rivière ----
/** La rivière descend du nord au sud à l'ouest de la mairie et passe sous la route. */
export const riverX = (z: number) => -41 + 5.5 * Math.sin(z * 0.031 + 0.6) + 2.4 * Math.sin(z * 0.083 + 2.1);
export const riverHalf = (z: number) => 1.3 + 0.35 * Math.sin(z * 0.047);
const nearRiver = (x: number, z: number, m: number) => Math.abs(x - riverX(z)) < riverHalf(z) + m;

/** Zones déjà occupées par la ferme, la route, la mairie, le village et les champs du nord. */
const RESERVED: Rect[] = [
  { x0: -7.5, x1: GRID_W + 6.5, z0: GRID_Z0 - 7, z1: GRID_Z1 + 1.2 }, // la ferme et sa ceinture d'arbres
  { x0: -12, x1: GRID_W + 8, z0: GRID_Z0 - 17.5, z1: GRID_Z0 - 6 }, // champs et chemin du nord
  { x0: -400, x1: 400, z0: WORLD.ROAD_Z - WORLD.ROAD_HALF - 1.7, z1: WORLD.ROAD_Z + WORLD.ROAD_HALF + 1.7 }, // la route et ses trottoirs
  { x0: -27, x1: GRID_W + 11, z0: GRID_Z1, z1: WORLD.ROAD_Z }, // la place de l'étal, le parking, le trottoir
  { x0: -17.5, x1: -0.5, z0: 1.5, z1: 33 }, // la mairie, le moulin, la mare, le potager
  { x0: -27.8, x1: -17.5, z0: 10.5, z1: 33 }, // le verger de la mairie
  { x0: -23, x1: 65, z0: WORLD.ROAD_Z + 2.6, z1: WORLD.ROAD_Z + 31.1 }, // le village
  { x0: GRID_W + 12, x1: GRID_W + 15, z0: -200, z1: WORLD.ROAD_Z }, // le chemin de la ferme voisine
];
/** Fermes voisines : un corps de ferme au milieu de ses prés. */
const NEIGHBOURS: Array<{ x: number; z: number; ry: number }> = [
  { x: GRID_W + 34, z: -6, ry: 0 },
  { x: -68, z: -14, ry: Math.PI / 2 },
  { x: 26, z: GRID_Z0 - 42, ry: 0 },
  { x: GRID_W + 38, z: 76, ry: -Math.PI / 2 },
  { x: -64, z: 82, ry: Math.PI },
];
for (const n of NEIGHBOURS) RESERVED.push({ x0: n.x - 9.5, x1: n.x + 9.5, z0: n.z - 7.5, z1: n.z + 7.5 });

const reserved = (x: number, z: number, m = 0) => RESERVED.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);
const rectHitsReserved = (r: Rect) => RESERVED.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.z0 < q.z1 && r.z1 > q.z0);
function rectHitsRiver(r: Rect) {
  for (let z = r.z0; z <= r.z1; z += 2) {
    const c = riverX(z);
    const h = riverHalf(z) + 1.8;
    if (c + h > r.x0 && c - h < r.x1) return true;
  }
  return false;
}

/** Étendue du paysage : bien au-delà de ce que montre la caméra au zoom le plus éloigné. */
const AREA: Rect = { x0: -170, x1: GRID_W + 170, z0: GRID_Z0 - 150, z1: GRID_Z1 + 150 };
const CELL_W = 19;
const CELL_D = 15;
/** Au plus près de la ferme, les champs portent de vraies plantes (elles ne se verraient pas plus loin). */
const NEAR: Rect = { x0: -46, x1: GRID_W + 34, z0: GRID_Z0 - 34, z1: GRID_Z1 + 46 };

type Kind = CropKind | 'forest' | 'meadow' | 'pond' | 'orchard' | 'pasture';

// -------------------------------------------------------------- Le sol ----
const GRASS_A = new THREE.Color(0x93bf5f);
const GRASS_B = new THREE.Color(0x82b053);
const GRASS_C = new THREE.Color(0xa9c76c);
const UNDERWOOD = new THREE.Color(0x67944a);
const STEP = 3;

function groundGeometry(isForest: (x: number, z: number) => boolean) {
  const M = 12;
  const nx = Math.ceil((AREA.x1 - AREA.x0 + 2 * M) / STEP);
  const nz = Math.ceil((AREA.z1 - AREA.z0 + 2 * M) / STEP);
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3);
  const col = new Float32Array((nx + 1) * (nz + 1) * 3);
  const nor = new Float32Array((nx + 1) * (nz + 1) * 3);
  const c = new THREE.Color();
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      const x = AREA.x0 - M + i * STEP;
      const z = AREA.z0 - M + j * STEP;
      const k = (j * (nx + 1) + i) * 3;
      pos.set([x, 0.015, z], k);
      nor.set([0, 1, 0], k);
      const a = vnoise(x * 0.045, z * 0.045);
      const b = vnoise(x * 0.13 + 40, z * 0.13 + 9);
      const d = vnoise(x * 0.02 + 90, z * 0.02 + 70);
      c.copy(GRASS_A).lerp(GRASS_B, smooth(Math.min(1, a * 1.35)));
      c.lerp(GRASS_C, Math.max(0, d - 0.42) * 1.25);
      c.multiplyScalar(0.96 + b * 0.08);
      if (isForest(x + (b - 0.5) * 5, z + (a - 0.5) * 5)) c.lerp(UNDERWOOD, 0.72);
      col.set([c.r, c.g, c.b], k);
    }
  const idx: number[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const p = j * (nx + 1) + i;
      idx.push(p, p + nx + 1, p + 1, p + 1, p + nx + 1, p + nx + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

// ----------------------------------------------------------- Bêtes des prés ----
function cowGeometry(coat: number, patch: number, grazing: boolean) {
  const hy = grazing ? 0.26 : 0.8;
  const hz = grazing ? 0.66 : 0.62;
  const parts = [
    sph(0.27, 8, 5, coat, [0, 0.62, 0], [1, 0.98, 1.85]),
    sph(0.15, 6, 4, patch, [0.15, 0.72, -0.16], [0.75, 0.85, 1.35]),
    sph(0.13, 6, 4, patch, [-0.14, 0.7, 0.2], [0.8, 0.85, 1.2]),
    cyl(0.1, 0.14, 0.42, 6, coat, [0, (hy + 0.68) / 2, (hz + 0.42) / 2], [grazing ? -1.0 : 0.62, 0, 0]),
    sph(0.13, 6, 4, coat, [0, hy, hz], [0.82, 0.86, 1.22]),
    box(0.15, 0.09, 0.09, 0xe7c7b2, [0, hy - 0.035, hz + 0.14]),
    box(0.05, 0.05, 0.1, coat, [0.12, hy + 0.07, hz - 0.03]),
    box(0.05, 0.05, 0.1, coat, [-0.12, hy + 0.07, hz - 0.03]),
    box(0.1, 0.03, 0.03, 0xe6dcc8, [0, hy + 0.13, hz - 0.03]),
    box(0.028, 0.38, 0.028, coat, [0, 0.55, -0.52]),
    sph(0.075, 5, 4, 0xe6b0a4, [0, 0.38, -0.2]),
  ];
  for (const [x, z] of [[-0.15, 0.32], [0.15, 0.32], [-0.15, -0.32], [0.15, -0.32]]) {
    parts.push(box(0.09, 0.38, 0.1, coat, [x, 0.23, z]), box(0.095, 0.06, 0.105, 0x3c3530, [x, 0.03, z]));
  }
  return merge(parts);
}

function sheepGeometry(grazing: boolean) {
  const hy = grazing ? 0.16 : 0.5;
  const hz = grazing ? 0.42 : 0.38;
  const wool = 0xf1ece0;
  const parts = [
    lump(0.25, 1, wool, [0, 0.42, 0], [0.92, 0.9, 1.3], 2, 0.15),
    lump(0.12, 0, 0xfaf6ec, [0.08, 0.6, -0.1], [1, 0.8, 1], 3, 0.15),
    lump(0.12, 0, 0xfaf6ec, [-0.08, 0.6, 0.12], [1, 0.8, 1], 4, 0.15),
    sph(0.085, 5, 4, 0x3f3a36, [0, hy, hz], [0.82, 0.92, 1.2]),
    box(0.1, 0.03, 0.05, 0x3f3a36, [0.08, hy + 0.03, hz - 0.03]),
    box(0.1, 0.03, 0.05, 0x3f3a36, [-0.08, hy + 0.03, hz - 0.03]),
  ];
  for (const [x, z] of [[-0.11, 0.2], [0.11, 0.2], [-0.11, -0.2], [0.11, -0.2]]) parts.push(box(0.05, 0.26, 0.05, 0x3f3a36, [x, 0.13, z]));
  return merge(parts);
}

// -------------------------------------------------------- La ferme voisine ----
function neighbourFarm(ox: number, oz: number, ry: number, seed: number) {
  const roof = seed % 2 ? 0xb65a42 : 0x8e5b45;
  const parts: THREE.BufferGeometry[] = [
    box(16, 0.05, 12, 0xc9b892, [0, 0.03, 0]),
    // la grange
    box(6, 2.3, 3.6, 0xb5694a, [-3.6, 1.15, -2.6]),
    prism(6.2, 1.2, 3.9, roof, [-3.6, 2.3, -2.6]),
    box(1.5, 1.6, 0.05, 0x7f4630, [-3.6, 0.8, -0.78]),
    box(1.54, 0.08, 0.06, 0xf1e9d8, [-3.6, 1.64, -0.77]),
    box(0.06, 1.6, 0.06, 0xf1e9d8, [-4.35, 0.8, -0.76]),
    box(0.06, 1.6, 0.06, 0xf1e9d8, [-2.85, 0.8, -0.76]),
    box(0.6, 0.5, 0.05, 0x7f4630, [-3.6, 2.08, -0.78]),
    // le logis
    box(4.2, 1.7, 2.6, 0xeee3cc, [3.2, 0.85, -2.8]),
    prism(4.4, 1.05, 2.9, roof, [3.2, 1.7, -2.8]),
    box(0.34, 0.5, 0.05, 0x8f5b43, [3.2, 0.3, -1.48]),
    box(0.3, 0.7, 0.3, 0xa86a4c, [4.4, 2.3, -3.2]),
    // le silo
    cyl(0.75, 0.75, 3.2, 12, 0xc8ccd0, [7.1, 1.6, -3.6]),
    cone(0.82, 0.7, 12, 0x9fa5ac, [7.1, 3.55, -3.6]),
    // tas de foin et abreuvoir
    box(1.1, 0.34, 0.5, 0x8f9aa2, [-1, 0.2, 3.4]),
    box(0.95, 0.03, 0.38, 0x7cb6d4, [-1, 0.36, 3.4]),
    box(3.6, 1.1, 1.8, 0xdcc272, [5.2, 0.6, 2.8]),
    prism(3.6, 0.55, 1.8, 0xe8d38a, [5.2, 1.15, 2.8]),
  ];
  for (const dx of [2.2, 4.2]) parts.push(box(0.45, 0.5, 0.05, C.glass, [dx, 0.95, -1.48]), box(0.55, 0.04, 0.08, 0xf1e9d8, [dx, 0.68, -1.47]));
  // clôture de la cour
  for (let x = -7.8; x <= 7.8; x += 1.95) {
    parts.push(box(0.08, 0.6, 0.08, C.woodDark, [x, 0.3, 5.9]));
    if (x < 7) parts.push(box(1.95, 0.05, 0.03, C.wood, [x + 0.97, 0.45, 5.9]), box(1.95, 0.05, 0.03, C.wood, [x + 0.97, 0.25, 5.9]));
  }
  const g = merge(parts);
  g.rotateY(ry);
  g.translate(ox, 0, oz);
  return g;
}

// ------------------------------------------------------------ Fleurs des prés ----
function wildflowers(color: number, center: number) {
  const s = new Soup();
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39;
    const r = 0.06 + (i / 9) * 0.34;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.11 + hash(i + 3) * 0.1;
    const R = 0.075;
    s.tri([x - 0.01, 0, z], [x + 0.01, 0, z], [x, h, z], 0x5f9c45);
    s.quad([x - R, h, z], [x, h + 0.012, z + R], [x + R, h, z], [x, h + 0.012, z - R], color);
    s.quad([x - R * 0.7, h + 0.008, z - R * 0.7], [x - R * 0.7, h + 0.008, z + R * 0.7], [x + R * 0.7, h + 0.008, z + R * 0.7], [x + R * 0.7, h + 0.008, z - R * 0.7], color);
    s.quad([x - R * 0.34, h + 0.018, z], [x, h + 0.022, z + R * 0.34], [x + R * 0.34, h + 0.018, z], [x, h + 0.022, z - R * 0.34], center);
  }
  return s.geometry();
}

// --------------------------------------------------------------- Le paysage ----
export function buildCountryside(scene: THREE.Scene) {
  const fields = new FieldKit();
  const solid: THREE.BufferGeometry[] = [];
  const waters: THREE.BufferGeometry[] = [];
  const banks: THREE.BufferGeometry[] = [];
  const stands: Record<Species, Plant[]> = { oak: [], lime: [], birch: [], pine: [], poplar: [], apple: [], willow: [], bush: [] };
  const cows: Plant[][] = [[], [], []];
  const sheep: Plant[][] = [[], []];
  const forestCells = new Set<string>();

  const free = (x: number, z: number, m: number) => !reserved(x, z, m) && !nearRiver(x, z, m + 0.6);
  const tree = (x: number, z: number, k: number, pine = false) => {
    if (!free(x, z, 1.2)) return;
    const sp: Species = pine ? 'pine' : (['oak', 'lime', 'birch'] as Species[])[Math.floor(h2(x, z, k) * 3)];
    stands[sp].push([x, z, h2(z, x, k) * 6.28, 0.78 + h2(x, k, z) * 0.62]);
  };
  const shrub = (x: number, z: number, k: number) => {
    if (free(x, z, 0.8)) stands.bush.push([x, z, h2(k, x, z) * 6, 0.72 + h2(z, k, x) * 0.6]);
  };

  for (let cz = AREA.z0, j = 0; cz < AREA.z1; cz += CELL_D, j++)
    for (let cx = AREA.x0, i = 0; cx < AREA.x1; cx += CELL_W, i++) {
      // parcelles de tailles inégales : chaque case de la mosaïque est un peu décalée
      const r: Rect = { x0: cx + h2(i, j, 1) * 1.5, x1: cx + CELL_W - h2(i, j, 2) * 1.5, z0: cz + h2(i, j, 3) * 1.2, z1: cz + CELL_D - h2(i, j, 4) * 1.2 };
      const blocked = rectHitsReserved(r) || rectHitsRiver(r);
      const n = h2(i, j, 7);
      // les bois se regroupent : un bruit à grande échelle décide des massifs forestiers
      const woods = Math.sin(i * 0.55 + 1.3) * Math.cos(j * 0.6 - 0.7) + (h2(Math.floor(i / 2), Math.floor(j / 2), 9) - 0.5);
      let kind: Kind = woods > 0.45 ? 'forest'
        : n < 0.13 ? 'wheat'
        : n < 0.21 ? 'colza'
        : n < 0.28 ? 'sunflower'
        : n < 0.34 ? 'lavender'
        : n < 0.4 ? 'vines'
        : n < 0.46 ? 'veg'
        : n < 0.52 ? 'plough'
        : n < 0.58 ? 'hay'
        : n < 0.63 ? 'orchard'
        : n < 0.66 ? 'pond'
        : n < 0.78 ? 'pasture'
        : 'meadow';
      // une case qui touche la ferme ou le village reste un pré (on y plante au cas par cas)
      if (blocked && kind !== 'forest') kind = 'meadow';
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      const mx = (r.x0 + r.x1) / 2;
      const mz = (r.z0 + r.z1) / 2;

      if (kind === 'meadow' || kind === 'pond' || kind === 'orchard' || kind === 'pasture') {
        // quelques arbres isolés et des buissons
        const nt = kind === 'orchard' ? 0 : kind === 'pasture' ? 2 : 2 + Math.floor(h2(i, j, 12) * 4);
        for (let k = 0; k < nt; k++) tree(r.x0 + h2(i, j, 20 + k) * w, r.z0 + h2(i, j, 40 + k) * d, k);
        for (let k = 0; k < 3; k++) shrub(r.x0 + h2(i, j, 60 + k) * w, r.z0 + h2(i, j, 70 + k) * d, k);
      }
      if (kind === 'orchard') {
        // verger : arbres en quinconce
        for (let z = r.z0 + 1.5, a = 0; z < r.z1 - 1; z += 2.6, a++)
          for (let x = r.x0 + 1.5 + (a % 2) * 1.3; x < r.x1 - 1; x += 2.6) stands.apple.push([x, z, h2(x, z) * 6, 0.86 + h2(z, x) * 0.26]);
      }
      if (kind === 'pond') {
        const px = mx + (h2(i, j, 13) - 0.5) * 4;
        const pz = mz + (h2(i, j, 14) - 0.5) * 3;
        const sx = 2.6 + h2(i, j, 15) * 2;
        const sz = 1.8 + h2(i, j, 16) * 1.4;
        const P = pondGeometry(px, pz, sx, sz, i + j * 3);
        waters.push(P.water);
        banks.push(P.bank);
        // roseaux en touffes et cailloux de la berge
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2 + h2(i, k, 2) * 0.3;
          const R = P.shore(a) * 1.04;
          const x = px + Math.cos(a) * sx * R;
          const z = pz + Math.sin(a) * sz * R;
          if (k % 3) {
            for (let q = 0; q < 3; q++) reed(x + (q - 1) * 0.1, z + h2(k, q, i) * 0.14, 0.5 + h2(k, i, q) * 0.34, solid, (q - 1) * 0.08, q === 1);
          } else solid.push(lump(0.16 + h2(k, j) * 0.14, 0, 0xb4ad9d, [x, 0.08, z], [1, 0.62, 1], k));
        }
        stands.willow.push([px + (h2(i, j, 80) - 0.5) * sx, pz - sz - 1.5, h2(i, j, 81) * 6, 0.9 + h2(i, j, 82) * 0.3]);
      }
      if (kind === 'forest') {
        forestCells.add(`${i},${j}`);
        // arbres serrés (pins mêlés aux feuillus), lisière irrégulière
        const count = Math.round((w * d) / 6.5);
        for (let k = 0; k < count; k++) tree(r.x0 + h2(i * 7 + k, j, 1) * w, r.z0 + h2(i, j * 7 + k, 2) * d, k, h2(k, i + j, 3) < 0.3);
      }
      if (kind === 'pasture') {
        // clôture de piquets et de lisses
        const posts = (x0: number, z0: number, x1: number, z1: number) => {
          const len = Math.hypot(x1 - x0, z1 - z0);
          const q = Math.round(len / 2.1);
          for (let k = 0; k <= q; k++) solid.push(box(0.07, 0.56, 0.07, C.woodDark, [x0 + ((x1 - x0) * k) / q, 0.28, z0 + ((z1 - z0) * k) / q]));
          const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
          for (const y of [0.24, 0.44]) solid.push(box(alongX ? len : 0.025, 0.04, alongX ? 0.025 : len, C.wood, [(x0 + x1) / 2, y, (z0 + z1) / 2]));
        };
        const m = 0.5;
        posts(r.x0 + m, r.z0 + m, r.x1 - m, r.z0 + m);
        posts(r.x0 + m, r.z1 - m, r.x1 - m, r.z1 - m);
        posts(r.x0 + m, r.z0 + m, r.x0 + m, r.z1 - m);
        posts(r.x1 - m, r.z0 + m, r.x1 - m, r.z1 - m);
        const isCow = h2(i, j, 21) < 0.55;
        const herd = isCow ? 5 + Math.floor(h2(i, j, 22) * 5) : 8 + Math.floor(h2(i, j, 22) * 8);
        const breed = Math.floor(h2(i, j, 23) * 3);
        // un troupeau reste groupé : les bêtes broutent côte à côte
        const hx = mx + (h2(i, j, 24) - 0.5) * (w - 8);
        const hz = mz + (h2(i, j, 25) - 0.5) * (d - 7);
        for (let k = 0; k < herd; k++) {
          const a = k * 2.39 + i;
          const rr = 0.7 + Math.sqrt(k) * (isCow ? 1.25 : 0.82);
          const x = Math.max(r.x0 + 1.5, Math.min(r.x1 - 1.5, hx + Math.cos(a) * rr));
          const z = Math.max(r.z0 + 1.5, Math.min(r.z1 - 1.5, hz + Math.sin(a) * rr));
          const item: Plant = [x, z, h2(k, i, j) * 6.28, isCow ? 0.92 + h2(j, k, i) * 0.18 : 0.8 + h2(j, k, i) * 0.26];
          // la plupart broutent ; les autres lèvent la tête
          if (isCow) cows[breed === 2 && k % 2 ? 1 : breed === 0 ? (h2(k, j, 3) < 0.7 ? 0 : 1) : 2].push(item);
          else sheep[h2(k, j, 3) < 0.72 ? 0 : 1].push(item);
        }
      }
      if (kind === 'wheat' || kind === 'colza' || kind === 'sunflower' || kind === 'lavender' || kind === 'vines' || kind === 'veg' || kind === 'plough' || kind === 'hay') {
        const near = mx > NEAR.x0 && mx < NEAR.x1 && mz > NEAR.z0 && mz < NEAR.z1;
        fields.add(kind, r, h2(i, j, 17) < 0.5, near, i * 7 + j);
        // haie le long d'un côté du champ
        if (h2(i, j, 18) < 0.6) {
          const south = h2(i, j, 19) < 0.5;
          for (let x = r.x0; x < r.x1; x += 1.1) shrub(x + h2(x, j) * 0.3, south ? r.z1 + 0.4 : r.z0 - 0.4, Math.round(x));
        }
      }
    }

  // ------------------------------------------------------------- le sol ----
  const isForest = (x: number, z: number) => forestCells.has(`${Math.floor((x - AREA.x0) / CELL_W)},${Math.floor((z - AREA.z0) / CELL_D)}`);
  const ground = new THREE.Mesh(groundGeometry(isForest), GROUND_MAT);
  ground.receiveShadow = true;
  scene.add(ground);
  fields.flush(scene);

  // --------------------------------------------------------- la rivière ----
  {
    const pos: number[] = [];
    const col: number[] = [];
    const nor: number[] = [];
    const bpos: number[] = [];
    const bcol: number[] = [];
    const bnor: number[] = [];
    const ca = new THREE.Color();
    const strip = (P: number[], Cc: number[], Nn: number[], z0: number, z1: number, u0: number, u1: number, y0: number, y1: number, c0: number, c1: number) => {
      const x = (z: number, u: number) => riverX(z) + u * (riverHalf(z) + (Math.abs(u) > 1 ? (Math.abs(u) - 1) * 0.9 : 0));
      const ax = x(z0, u0);
      const bx = x(z0, u1);
      const cx = x(z1, u0);
      const dx = x(z1, u1);
      const push = (X: number, Y: number, Z: number, c: number) => {
        ca.set(c);
        P.push(X, Y, Z);
        Cc.push(ca.r, ca.g, ca.b);
        Nn.push(0, 1, 0);
      };
      push(ax, y0, z0, c0);
      push(cx, y0, z1, c0);
      push(bx, y1, z0, c1);
      push(bx, y1, z0, c1);
      push(cx, y0, z1, c0);
      push(dx, y1, z1, c1);
    };
    const STEPZ = 2.5;
    for (let z = -205; z < 205; z += STEPZ) {
      const z1 = z + STEPZ;
      // l'eau : claire au bord, plus sombre au milieu
      const y = 0.04;
      strip(pos, col, nor, z, z1, -1.03, -0.55, y, y, 0x9cd4dc, 0x63afd2);
      strip(pos, col, nor, z, z1, -0.55, 0.55, y, y, 0x63afd2, 0x63afd2);
      strip(pos, col, nor, z, z1, 0.55, 1.03, y, y, 0x63afd2, 0x9cd4dc);
      // les berges : boue, sable, puis l'herbe
      const grass = 0x8fbb5c;
      strip(bpos, bcol, bnor, z, z1, -1.75, -1.3, 0.005, 0.048, grass, 0xc2b288);
      strip(bpos, bcol, bnor, z, z1, -1.3, -0.95, 0.048, 0.03, 0xc2b288, 0x7f7050);
      strip(bpos, bcol, bnor, z, z1, 0.95, 1.3, 0.03, 0.048, 0x7f7050, 0xc2b288);
      strip(bpos, bcol, bnor, z, z1, 1.3, 1.75, 0.048, 0.005, 0xc2b288, grass);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    waters.push(g);
    const b = new THREE.BufferGeometry();
    b.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
    b.setAttribute('color', new THREE.Float32BufferAttribute(bcol, 3));
    b.setAttribute('normal', new THREE.Float32BufferAttribute(bnor, 3));
    banks.push(b);

    // saules et peupliers sur les berges, roseaux, cailloux
    const RZ = WORLD.ROAD_Z;
    for (let z = -200, k = 0; z < 200; z += 5.2, k++) {
      if (Math.abs(z - RZ) < 5) continue;
      const side = hash(k * 3) < 0.5 ? -1 : 1;
      const x = riverX(z) + side * (riverHalf(z) + 2 + hash(k) * 1.6);
      if (reserved(x, z, 1)) continue;
      const pick = hash(k * 7);
      if (pick < 0.3) stands.willow.push([x, z, hash(k) * 6, 0.9 + hash(k * 5) * 0.4]);
      else if (pick < 0.55) stands.poplar.push([x, z, hash(k) * 6, 0.85 + hash(k * 5) * 0.35]);
      else if (pick < 0.75) stands.bush.push([x, z, hash(k) * 6, 0.9]);
      const rx = riverX(z) + (hash(k * 11) < 0.5 ? -1 : 1) * (riverHalf(z) + 0.1);
      if (Math.abs(z) < 90 && !reserved(rx, z, 0.5)) {
        if (k % 3 !== 2) for (let q = 0; q < 4; q++) reed(rx + (q - 1.5) * 0.1, z + hash(k + q) * 0.5, 0.48 + hash(k * q + 1) * 0.36, solid, (q - 1.5) * 0.06, q % 2 === 0);
        else solid.push(lump(0.18 + hash(k) * 0.14, 0, 0xaea899, [rx, 0.07, z], [1, 0.6, 1.1], k));
      }
    }

    // le pont de pierre, où la route enjambe la rivière
    const xb = riverX(RZ);
    const half = riverHalf(RZ) + 2.1;
    for (const s of [-1, 1]) {
      const z = RZ + s * (WORLD.ROAD_HALF + 0.17);
      solid.push(box(half * 2, 0.34, 0.22, 0xbfb4a0, [xb, 0.19, z]));
      solid.push(box(half * 2 + 0.1, 0.05, 0.28, 0xd8cfbe, [xb, 0.38, z]));
      for (let q = 0; q < 4; q++) solid.push(box(0.012, 0.3, 0.226, 0xa79c87, [xb - half * 0.75 + q * half * 0.5, 0.19, z]));
      for (const e of [-1, 1]) {
        solid.push(box(0.36, 0.56, 0.36, 0xa9a08c, [xb + e * half, 0.28, z]));
        solid.push(box(0.42, 0.06, 0.42, 0xd8cfbe, [xb + e * half, 0.58, z]));
        // murets qui retiennent la berge
        solid.push(box(0.26, 0.22, 1.8, 0xb5ab97, [xb + e * (half - 0.5), 0.11, z + s * 1.0]));
      }
    }

    // une passerelle en bois et un pêcheur, en amont, en vue de la mairie
    const zf = -4;
    const xf = riverX(zf);
    const hf = riverHalf(zf) + 0.7;
    for (let k = 0; k <= 12; k++) solid.push(box(0.24, 0.035, 1.06, k % 2 ? C.wood : C.plank, [xf - hf + (k / 12) * hf * 2, 0.26 + 0.1 * Math.sin((k / 12) * Math.PI), zf]));
    for (const s of [-0.5, 0.5]) {
      solid.push(box(hf * 2 + 0.2, 0.03, 0.03, C.woodDark, [xf, 0.62, zf + s]));
      for (let k = 0; k <= 4; k++) solid.push(box(0.05, 0.42 + 0.1 * Math.sin((k / 4) * Math.PI), 0.05, C.woodDark, [xf - hf + (k / 4) * hf * 2, 0.45, zf + s]));
    }
    const zp = 17;
    const xp = riverX(zp) + riverHalf(zp) + 0.28;
    solid.push(
      box(0.24, 0.03, 0.24, 0x7d6448, [xp + 0.08, 0.2, zp]),
      box(0.03, 0.2, 0.03, 0x5f4a35, [xp + 0.15, 0.1, zp + 0.08]),
      box(0.03, 0.2, 0.03, 0x5f4a35, [xp, 0.1, zp - 0.08]),
      box(0.17, 0.3, 0.19, 0x4d6d8f, [xp + 0.08, 0.36, zp]),
      sph(0.075, 7, 5, 0xe9c7a6, [xp + 0.06, 0.58, zp]),
      cyl(0.13, 0.13, 0.015, 9, 0xe2c06a, [xp + 0.06, 0.63, zp]),
      cyl(0.07, 0.08, 0.07, 9, 0xe2c06a, [xp + 0.06, 0.67, zp]),
      box(0.1, 0.05, 0.1, 0x3d4a63, [xp - 0.03, 0.17, zp + 0.09]),
      box(0.05, 0.2, 0.06, 0x3d4a63, [xp - 0.09, 0.08, zp + 0.09]),
      box(0.05, 0.05, 0.2, 0x4d6d8f, [xp - 0.02, 0.4, zp + 0.09], [0.1, 0.6, 0]),
      cyl(0.006, 0.012, 1.4, 3, 0x5f4a35, [xp - 0.56, 0.72, zp + 0.1], [0, 0, 0.95]),
      box(0.006, 0.42, 0.006, 0xe8e8e8, [xp - 1.13, 0.31, zp + 0.1]),
      box(0.28, 0.16, 0.2, 0x5aa36b, [xp + 0.36, 0.13, zp + 0.05]),
    );
  }

  // ------------------------------------------------- la route et ses peupliers ----
  {
    const RZ = WORLD.ROAD_Z;
    const bridge = riverX(RZ);
    for (let x = WORLD.ROAD_MIN_X; x < WORLD.ROAD_MAX_X; x += 4.6) {
      if (x > -30 && x < GRID_W + 12) continue;
      if (Math.abs(x - bridge) < 6) continue;
      for (const s of [-1, 1]) stands.poplar.push([x + s * 1.1, RZ + s * (WORLD.ROAD_HALF + 1.5), hash(x) * 6, 0.92 + hash(x * 3 + s) * 0.22]);
    }
  }

  // --------------------------------------------------- les fermes voisines ----
  NEIGHBOURS.forEach((n, i) => {
    solid.push(neighbourFarm(n.x, n.z, n.ry, i));
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3 + i;
      const tx = n.x + Math.cos(a) * (10.5 + hash(k + i) * 2);
      const tz = n.z + Math.sin(a) * (8.5 + hash(k + i * 3) * 2);
      if (!nearRiver(tx, tz, 2) && !RESERVED.slice(0, 8).some((q) => tx > q.x0 && tx < q.x1 && tz > q.z0 && tz < q.z1)) stands.oak.push([tx, tz, hash(k) * 6, 1.1 + hash(k * 3) * 0.4]);
    }
  });
  // le chemin qui mène à la ferme voisine, depuis la route
  {
    const x = GRID_W + 13.5;
    const z0 = -6;
    const z1 = WORLD.ROAD_Z - WORLD.ROAD_HALF;
    solid.push(box(1.1, 0.035, z1 - z0, 0xd2c29a, [x, 0.03, (z0 + z1) / 2]));
    solid.push(box(0.32, 0.038, z1 - z0, 0x9eb86c, [x, 0.032, (z0 + z1) / 2]));
    solid.push(box(GRID_W + 26 - x, 0.035, 1.1, 0xd2c29a, [(x + GRID_W + 26) / 2, 0.03, z0]));
  }

  // ------------------------------------------------------------ assemblage ----
  if (waters.length) {
    const wm = new THREE.Mesh(merge(waters), WATER_MAT);
    wm.receiveShadow = true;
    scene.add(wm);
  }
  if (banks.length) {
    const bm = new THREE.Mesh(merge(banks), GROUND_MAT);
    bm.receiveShadow = true;
    scene.add(bm);
  }
  if (solid.length) scene.add(mesh(merge(solid), true, true));

  // arbres : seuls les blocs à l'écran sont dessinés, et leur modèle s'allège quand on dézoome
  const shadows: Array<[number, number, number]> = [];
  for (const sp of Object.keys(stands) as Species[]) {
    plant(scene, speciesGeometry(sp), speciesGeometry(sp, true), stands[sp], { cast: true, spread: sp === 'pine' ? 0.07 : 0.12 });
    for (const [x, z, , sc] of stands[sp]) shadows.push([x, z, SHADOW_RADIUS[sp] * sc]);
  }
  scene.add(contactShadows(shadows));

  // bêtes (toujours visibles : le troupeau anime le paysage, même de loin)
  const cowGeos = [cowGeometry(0xf2eee4, 0x3a3532, true), cowGeometry(0xf2eee4, 0x3a3532, false), cowGeometry(0xe8d9b8, 0xdccba7, true)];
  cows.forEach((list, k) => list.length && plant(scene, cowGeos[k], null, list, { mat: MAT, chunk: 60, spread: 0.04, cast: true }));
  const sheepGeos = [sheepGeometry(true), sheepGeometry(false)];
  sheep.forEach((list, k) => list.length && plant(scene, sheepGeos[k], null, list, { mat: MAT, chunk: 60, spread: 0.03, cast: true }));

  // touffes d'herbe et fleurs des champs autour de la ferme (de près seulement)
  const inFarm = (x: number, z: number) => x > -0.6 && x < GRID_W + 0.6 && z > GRID_Z0 - 0.6 && z < GRID_Z1 + 0.6;
  const onHard = (x: number, z: number) =>
    (z > GRID_Z1 + 0.1 && x > 10.6 && x < 42.6 && z < WORLD.ROAD_Z + WORLD.ROAD_HALF + 1.6) || // place et parking
    (z > WORLD.WALK_Z - 0.8 && z < WORLD.ROAD_Z + WORLD.ROAD_HALF + 1.7) || // trottoirs et route
    (x > -11.6 && x < -0.5 && z > 16.5 && z < 29) || // mairie et sa cour
    (x > -15.2 && x < -5.3 && z > 3.6 && z < 11.6) || // mare
    (x > -6.8 && x < -5.2 && z > 28 && z < 38) || // allée
    (x > -6 && x < 12 && z > 30.8 && z < 31.9) || // chemin du personnel
    (x > -15.8 && x < -7.2 && z > 28.9 && z < 33.7) || // potager
    (x > -15 && x < -11 && z > 13.5 && z < 21); // moulin
  const fieldAt = (x: number, z: number) => z < GRID_Z0 - 7.7 && z > GRID_Z0 - 16.3 && x > -10.3 && x < 86.3;
  const tufts: Plant[] = [];
  const blooms: Plant[][] = [[], [], [], []];
  for (let i = 0; i < 9000; i++) {
    const x = -44 + hash(i * 3.1) * (GRID_W + 76);
    const z = GRID_Z0 - 26 + hash(i * 7.7) * (GRID_Z1 - GRID_Z0 + 72);
    if (inFarm(x, z) || onHard(x, z) || fieldAt(x, z) || nearRiver(x, z, 0.5)) continue;
    if (z > WORLD.ROAD_Z + 2 && x > -23 && x < 65) continue; // le village
    tufts.push([x, z, hash(i) * 6.28, 0.7 + hash(i * 2) * 0.6]);
  }
  for (let i = 0; i < 2400; i++) {
    const x = -44 + hash(i * 5.3) * (GRID_W + 76);
    const z = GRID_Z0 - 26 + hash(i * 9.1) * (GRID_Z1 - GRID_Z0 + 72);
    if (inFarm(x, z) || onHard(x, z) || fieldAt(x, z) || nearRiver(x, z, 0.6)) continue;
    if (z > WORLD.ROAD_Z + 2 && x > -23 && x < 65) continue;
    // les fleurs poussent par taches, chaque espèce a ses coins
    const patch = vnoise(x * 0.09 + 12, z * 0.09 + 31);
    if (patch < 0.5) continue;
    const sort = Math.floor(vnoise(x * 0.06 + 70, z * 0.06 + 5) * 4) % 4;
    blooms[sort].push([x, z, hash(i * 3) * 6.28, 0.75 + hash(i * 2) * 0.55]);
  }
  plant(scene, grassPatchGeometry(true, 2, false), null, tufts, { mat: MEADOW_GRASS, chunk: 26, spread: 0.08, detail: true });
  const flowerSets = [wildflowers(0xdf3a2c, 0x2f2622), wildflowers(0xfbfaf6, 0xf4c43a), wildflowers(0x5f7fe0, 0xe8e0a0), wildflowers(0xf2cf2b, 0xe0a81f)];
  blooms.forEach((list, k) => list.length && plant(scene, flowerSets[k], null, list, { mat: MEADOW_FLOWERS, chunk: 40, spread: 0.03, detail: true }));
}
