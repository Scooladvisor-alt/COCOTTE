// Décoration et biomes (rubrique « Déco & biomes » de la boutique). Coordonnées locales du
// bâtiment : x le long de la façade, z en profondeur (façade vers +z), y vers le haut, sol en y = 0.
// Les plantes (herbes, fougères, fleurs) utilisent le matériau de la prairie : elles ondulent au vent
// et se couchent sous les robots, comme le reste de l'herbe. Les biomes laissent passer les poules :
// seuls leurs éléments pleins (troncs du bois, massif central du jardin) occupent une case.
import * as THREE from 'three';
import { FOREST_TRUNKS } from '../config/buildings';
import { FOUNTAIN_RIM } from '../sim/feeding';
import { GRASS_MAT, box, cone, cyl, finalizeExport, ico, merge, mesh, sph } from './geo';
import type { BuildingView } from './models';
import { TREE_MAT, speciesGeometry } from './nature';

type Parts = THREE.BufferGeometry[];

function rnd(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Géométrie libre (triangles) avec couleurs par sommet et normales « ciel » (comme l'herbe). */
class Tris {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  private c = new THREE.Color();
  v(x: number, y: number, z: number, color: number | THREE.Color, k = 1) {
    this.pos.push(x, y, z);
    this.nor.push(0.15, 0.97, 0.15);
    if (typeof color === 'number') this.c.set(color);
    else this.c.copy(color);
    this.c.multiplyScalar(k);
    this.col.push(this.c.r, this.c.g, this.c.b);
  }
  /** Brin effilé d'un seul triangle (base sombre, pointe claire). */
  blade(x: number, z: number, h: number, w: number, dir: number, lean: number, base: number, tip: number, k = 1) {
    const face = dir + Math.PI / 2;
    const fx = (Math.cos(face) * w) / 2;
    const fz = (Math.sin(face) * w) / 2;
    this.v(x - fx, 0, z - fz, base, k);
    this.v(x + fx, 0, z + fz, base, k);
    this.v(x + Math.cos(dir) * lean, h, z + Math.sin(dir) * lean, tip, k);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Plantes qui ondulent au vent (et se couchent sous un robot), sans ombre portée. */
function plants(parts: Parts) {
  const m = new THREE.Mesh(merge(parts), GRASS_MAT);
  m.receiveShadow = true;
  return m;
}

/** Une fleur : tige, deux feuilles, et sa corolle (couleur au choix). */
function flower(p: Parts, x: number, z: number, h: number, color: number, k: number, big = 1) {
  const lean = (rnd(k * 3) - 0.5) * 0.12;
  p.push(cyl(0.006, 0.008, h, 3, 0x4e8a32, [x, h / 2, z], [lean, 0, lean * 0.6]));
  for (const s of [-1, 1]) p.push(box(0.05, 0.004, 0.018, 0x5f9c3c, [x + s * 0.025, h * (0.35 + s * 0.08), z], [0, rnd(k) * 3 + s, s * 0.5]));
  const top: [number, number, number] = [x + Math.sin(lean * 0.6) * h, h, z - Math.sin(lean) * h];
  p.push(ico(0.032 * big, 0, color, top, [1, 0.7, 1]));
  p.push(sph(0.012 * big, 5, 3, 0xf5d142, [top[0], top[1] + 0.018 * big, top[2]]));
}

/** Pelouse dessinée pour la seule vignette (dans le jeu, c'est la vraie herbe de la ferme). */
function thumbLawn(g: THREE.Group, w: number, d: number) {
  const lawn = mesh(box(w, 0.03, d, 0x7fb24e, [w / 2, -0.005, d / 2]), false, false);
  lawn.visible = false;
  g.add(lawn);
  return lawn;
}

// ============================================================ FONTAINE ====
const WATER = new THREE.MeshLambertMaterial({ color: 0x5fb6e4, emissive: 0x0f3550 });
const FALLING = new THREE.MeshBasicMaterial({ color: 0xcdeefc, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });

/** Anneau plat (margelle, rebord de vasque) : l'eau se voit au milieu. */
const ringPart = (inner: number, outer: number, y: number, color: number, cx: number, cz: number) =>
  finalizeExport(new THREE.RingGeometry(inner, outer, 40, 1).rotateX(-Math.PI / 2), color, [cx, y, cz], [0, 0, 0], [1, 1, 1]);
/** Paroi verticale ouverte (pas de couvercle qui cacherait l'eau). */
const wallPart = (rTop: number, rBot: number, y0: number, y1: number, color: number, cx: number, cz: number) =>
  finalizeExport(new THREE.CylinderGeometry(rTop, rBot, y1 - y0, 40, 1, true), color, [cx, (y0 + y1) / 2, cz], [0, 0, 0], [1, 1, 1]);
const RIPPLE = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });

/**
 * Fontaine prestigieuse (3 × 3) : place dallée de pierre claire, grand bassin rond à margelle
 * moulurée où les poules viennent boire, colonne et deux vasques d'où l'eau retombe en voiles, œuf
 * doré au sommet d'où jaillit le jet ; quatre vasques fleuries aux coins. Ronds dans l'eau animés.
 */
export function fountainModel(): BuildingView {
  const g = new THREE.Group();
  const p: Parts = [];
  const cx = 1.5;
  const cz = 1.5;
  const STONE = 0xe4dccb;
  const STONE_D = 0xc9bfa9;
  const STONE_L = 0xf1ece1;
  // place dallée et ses joints
  p.push(box(2.96, 0.05, 2.96, STONE_D, [cx, 0.025, cz]));
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) p.push(box(0.47, 0.012, 0.47, (i + j) % 2 ? STONE : STONE_L, [0.27 + i * 0.49, 0.056, 0.27 + j * 0.49]));
  // bassin : paroi, margelle moulurée (le bord où les poules posent le bec), socle ; l'eau affleure
  const R = FOUNTAIN_RIM;
  p.push(wallPart(R, R + 0.01, 0.05, 0.29, STONE, cx, cz));
  p.push(ringPart(R - 0.12, R + 0.02, 0.29, STONE_L, cx, cz));
  p.push(wallPart(R + 0.02, R + 0.02, 0.255, 0.29, STONE_L, cx, cz));
  p.push(cyl(R + 0.035, R + 0.035, 0.02, 40, STONE_D, [cx, 0.06, cz]));
  // colonne, vasques (creuses : on voit l'eau dedans) et œuf doré
  p.push(cyl(0.11, 0.15, 0.6, 16, STONE, [cx, 0.58, cz]));
  p.push(cyl(0.58, 0.2, 0.12, 24, STONE_L, [cx, 0.8, cz]));
  p.push(ringPart(0.5, 0.6, 0.88, STONE_D, cx, cz));
  p.push(wallPart(0.6, 0.58, 0.86, 0.88, STONE_D, cx, cz));
  p.push(cyl(0.07, 0.1, 0.3, 12, STONE, [cx, 1.02, cz]));
  p.push(cyl(0.33, 0.12, 0.09, 20, STONE_L, [cx, 1.16, cz]));
  p.push(ringPart(0.27, 0.35, 1.23, STONE_D, cx, cz));
  p.push(wallPart(0.35, 0.33, 1.205, 1.23, STONE_D, cx, cz));
  p.push(cyl(0.05, 0.06, 0.2, 10, STONE, [cx, 1.3, cz]));
  p.push(sph(0.085, 16, 12, 0xe0b13f, [cx, 1.47, cz], [0.85, 1.15, 0.85]));
  // vasques fleuries aux quatre coins
  for (const [x, z] of [
    [0.32, 0.32],
    [2.68, 0.32],
    [0.32, 2.68],
    [2.68, 2.68],
  ]) {
    p.push(cyl(0.07, 0.05, 0.12, 10, STONE_D, [x, 0.12, z]));
    p.push(cyl(0.15, 0.1, 0.12, 14, STONE_L, [x, 0.24, z]));
    p.push(cyl(0.13, 0.13, 0.02, 14, 0x5a4632, [x, 0.3, z]));
  }
  const body = mesh(merge(p));
  g.add(body);
  const fl: Parts = [];
  let k = 0;
  for (const [x, z] of [
    [0.32, 0.32],
    [2.68, 0.32],
    [0.32, 2.68],
    [2.68, 2.68],
  ])
    for (let i = 0; i < 7; i++, k++) {
      const a = (i / 7) * Math.PI * 2;
      const fx = x + Math.cos(a) * 0.07;
      const fz = z + Math.sin(a) * 0.07;
      fl.push(...flowerAt(fx, fz, 0.31, [0xd9534f, 0xf3eee4, 0xe85d9b, 0xf2c230][i % 4], k));
    }
  const flowers = plants(fl);
  g.add(flowers);
  // l'eau : bassin, deux vasques, voiles d'eau qui retombent, jet au sommet
  const disc = (r: number, y: number) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40).rotateX(-Math.PI / 2), WATER);
    m.position.set(cx, y, cz);
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  disc(R - 0.115, 0.284);
  disc(0.505, 0.875);
  disc(0.275, 1.225);
  // voiles d'eau : du rebord de chaque vasque jusqu'à l'eau d'en dessous
  const veil1 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.68, 0.59, 32, 1, true), FALLING);
  veil1.position.set(cx, 0.88 - 0.295, cz);
  const veil2 = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.41, 0.355, 24, 1, true), FALLING);
  veil2.position.set(cx, 1.23 - 0.1775, cz);
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.3, 8, 1, true), FALLING);
  jet.position.set(cx, 1.72, cz);
  g.add(veil1, veil2, jet);
  // ronds dans l'eau, là où tombe le voile
  const ripples = [0, 1, 2].map(() => {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.94, 40).rotateX(-Math.PI / 2), RIPPLE.clone());
    r.position.set(cx, 0.289, cz);
    g.add(r);
    return r;
  });
  const tick = (t: number) => {
    veil1.scale.set(1 + Math.sin(t * 7) * 0.012, 1, 1 + Math.cos(t * 6) * 0.012);
    veil2.scale.set(1 + Math.sin(t * 8 + 1) * 0.015, 1, 1 + Math.cos(t * 7) * 0.015);
    jet.scale.set(1, 1 + Math.sin(t * 11) * 0.12, 1);
    FALLING.opacity = 0.27 + Math.sin(t * 5) * 0.04;
    ripples.forEach((r, i) => {
      const u = (t * 0.45 + i / 3) % 1;
      const s = 0.74 + u * 0.32;
      r.scale.set(s, 1, s);
      (r.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - u);
    });
  };
  return { group: g, eggSlots: [], eggMeshes: [], key: 'fountain1', tick };
}

/** Petite fleur de vasque ou de massif (renvoie ses pièces). */
function flowerAt(x: number, z: number, y0: number, color: number, k: number, big = 1): Parts {
  const p: Parts = [];
  const h = 0.1 + rnd(k) * 0.06;
  p.push(cyl(0.005, 0.006, h, 3, 0x4e8a32, [x, y0 + h / 2, z]));
  p.push(ico(0.028 * big, 0, color, [x, y0 + h, z], [1, 0.75, 1]));
  p.push(sph(0.01 * big, 5, 3, 0xf5d142, [x, y0 + h + 0.016 * big, z]));
  return p;
}

// ====================================================== MASSIF DE FLEURS ====
/** Massif de fleurs (2 × 1) : bac de planches débordant de tulipes, marguerites et lavande. */
export function flowerbedModel(): BuildingView {
  const g = new THREE.Group();
  const p: Parts = [];
  const WOOD = 0xb07a45;
  p.push(box(1.86, 0.2, 0.74, 0x8a5d36, [1, 0.1, 0.5]));
  for (let i = 0; i < 2; i++) p.push(box(1.88, 0.095, 0.03, i ? WOOD : 0xc08a52, [1, 0.05 + i * 0.1, 0.875]));
  for (let i = 0; i < 2; i++) p.push(box(0.03, 0.095, 0.76, i ? WOOD : 0xc08a52, [1.935, 0.05 + i * 0.1, 0.5]));
  for (const [x, z] of [
    [0.07, 0.13],
    [1.93, 0.13],
    [0.07, 0.87],
    [1.93, 0.87],
  ])
    p.push(box(0.06, 0.24, 0.06, 0x8a5d36, [x, 0.12, z]));
  p.push(box(1.8, 0.02, 0.68, 0x5a4632, [1, 0.205, 0.5]));
  g.add(mesh(merge(p)));
  const fl: Parts = [];
  const COLORS = [0xd9534f, 0xf2c230, 0xe85d9b, 0xf3eee4, 0x9b7fd1, 0xf08a3a];
  let k = 0;
  for (let i = 0; i < 9; i++)
    for (let j = 0; j < 3; j++, k++) {
      const x = 0.2 + i * 0.2 + (rnd(k * 5) - 0.5) * 0.08;
      const z = 0.27 + j * 0.23 + (rnd(k * 7) - 0.5) * 0.06;
      const h = 0.16 + rnd(k * 11) * 0.12;
      fl.push(cyl(0.006, 0.008, h, 3, 0x4e8a32, [x, 0.21 + h / 2, z]));
      for (const s of [-1, 1]) fl.push(box(0.05, 0.004, 0.018, 0x5f9c3c, [x + s * 0.025, 0.21 + h * 0.4, z], [0, rnd(k) * 3, s * 0.45]));
      const c = COLORS[(i + j * 2) % COLORS.length];
      if (c === 0x9b7fd1) for (let q = 0; q < 4; q++) fl.push(sph(0.017, 5, 3, c, [x, 0.21 + h - q * 0.03, z]));
      else {
        fl.push(ico(0.036, 0, c, [x, 0.21 + h, z], [1, c === 0xd9534f ? 1.2 : 0.7, 1]));
        fl.push(sph(0.012, 5, 3, 0xf5d142, [x, 0.23 + h, z]));
      }
    }
  g.add(plants(fl));
  return { group: g, eggSlots: [], eggMeshes: [], key: 'flowerbed1', thumbOnly: thumbLawn(g, 2, 1) };
}

// ============================================================ ÉPOUVANTAIL ====
/**
 * Épouvantail (1 × 1) : poteau et traverse, salopette bleue sur chemise à carreaux, tête de toile de
 * jute cousue, chapeau de paille, paille qui dépasse des manches, un corbeau perché sur un bras.
 * Il se balance un peu au vent.
 */
export function scarecrowModel(): BuildingView {
  const g = new THREE.Group();
  const post = mesh(merge([cyl(0.035, 0.04, 1.5, 6, 0x7a5236, [0.5, 0.75, 0.5]), box(1.0, 0.05, 0.05, 0x7a5236, [0.5, 1.16, 0.5])]));
  g.add(post);
  const body = new THREE.Group();
  body.position.set(0.5, 0, 0.5);
  const p: Parts = [];
  // chemise à carreaux (bras le long de la traverse) et salopette
  p.push(box(0.3, 0.32, 0.18, 0xc0392b, [0, 1.06, 0]));
  for (let i = 0; i < 4; i++) p.push(box(0.302, 0.012, 0.182, 0x7d1f16, [0, 0.94 + i * 0.08, 0]));
  for (const s of [-1, 1]) {
    p.push(box(0.36, 0.1, 0.11, 0xc0392b, [s * 0.32, 1.16, 0]));
    for (let i = 0; i < 3; i++) p.push(box(0.012, 0.102, 0.112, 0x7d1f16, [s * (0.2 + i * 0.1), 1.16, 0]));
    // paille qui dépasse des manches
    for (let i = 0; i < 4; i++) p.push(cone(0.012, 0.12, 3, 0xe8c66a, [s * 0.54, 1.16 + (i - 1.5) * 0.025, (i % 2) * 0.02 - 0.01], [0, 0, (s * Math.PI) / 2 + (i - 1.5) * 0.15]));
  }
  p.push(box(0.28, 0.32, 0.17, 0x3d6fa8, [0, 0.82, 0.005]));
  for (const s of [-1, 1]) {
    p.push(box(0.04, 0.24, 0.02, 0x3d6fa8, [s * 0.09, 1.04, 0.095]));
    p.push(sph(0.015, 6, 4, 0xd9b35a, [s * 0.09, 1.13, 0.105]));
    p.push(box(0.11, 0.24, 0.14, 0x3d6fa8, [s * 0.075, 0.6, 0]));
    for (let i = 0; i < 3; i++) p.push(cone(0.012, 0.1, 3, 0xe8c66a, [s * 0.075 + (i - 1) * 0.025, 0.46, 0], [Math.PI, 0, (i - 1) * 0.2]));
  }
  p.push(box(0.1, 0.08, 0.01, 0x2f5a8c, [0, 0.9, 0.091]));
  // tête de jute, yeux et sourire cousus, chapeau de paille
  p.push(sph(0.13, 12, 10, 0xd8c08a, [0, 1.34, 0], [1, 1.08, 0.95]));
  for (const s of [-1, 1]) p.push(box(0.035, 0.035, 0.01, 0x2b2b31, [s * 0.05, 1.37, 0.122], [0, 0, Math.PI / 4]));
  for (let i = 0; i < 5; i++) p.push(box(0.022, 0.006, 0.01, 0x2b2b31, [-0.05 + i * 0.025, 1.29 - Math.abs(i - 2) * -0.006, 0.12]));
  p.push(cyl(0.075, 0.13, 0.04, 6, 0x2b2b31, [0, 1.2, 0]));
  p.push(cyl(0.26, 0.26, 0.02, 18, 0xe2bf63, [0, 1.45, 0]));
  p.push(cyl(0.11, 0.13, 0.13, 14, 0xe2bf63, [0, 1.52, 0]));
  p.push(cyl(0.131, 0.131, 0.03, 14, 0xc0392b, [0, 1.48, 0]));
  // le corbeau perché sur le bras droit
  p.push(sph(0.05, 8, 6, 0x23252b, [0.4, 1.25, 0], [1.4, 0.9, 0.9]));
  p.push(sph(0.034, 8, 6, 0x23252b, [0.46, 1.3, 0]));
  p.push(cone(0.012, 0.05, 4, 0x4a4d55, [0.5, 1.3, 0], [0, 0, -Math.PI / 2]));
  p.push(box(0.08, 0.012, 0.05, 0x1a1c21, [0.33, 1.25, 0], [0, 0, 0.3]));
  const m = mesh(merge(p));
  body.add(m);
  g.add(body);
  const tick = (t: number) => {
    body.rotation.z = Math.sin(t * 1.3) * 0.025;
    body.rotation.y = Math.sin(t * 0.7) * 0.05;
  };
  return { group: g, eggSlots: [], eggMeshes: [], key: 'scarecrow1', thumbOnly: thumbLawn(g, 1, 1), tick };
}

// ============================================================ PETIT BOIS ====
/**
 * Petit bois (4 × 4) : quatre grands arbres d'essences différentes sur leurs cases, et, entre eux,
 * là où marchent les poules, fougères, jacinthes des bois et champignons ; une souche moussue et une
 * bûche au pied des troncs.
 */
export function forestModel(): BuildingView {
  const g = new THREE.Group();
  const SPECIES = ['oak', 'lime', 'birch', 'pine'] as const;
  FOREST_TRUNKS.forEach(([i, j], n) => {
    const t = new THREE.Mesh(speciesGeometry(SPECIES[n]), TREE_MAT);
    t.position.set(i + 0.5, 0, j + 0.5);
    t.rotation.y = n * 1.7;
    t.scale.setScalar(SPECIES[n] === 'pine' ? 1.05 : 1.2);
    t.castShadow = true;
    t.receiveShadow = true;
    g.add(t);
  });
  // souche moussue et bûche, sur les cases des troncs (pas sur le passage)
  const solid: Parts = [];
  const [ai, aj] = FOREST_TRUNKS[0];
  solid.push(cyl(0.15, 0.18, 0.2, 10, 0x8a6a48, [ai + 0.2, 0.1, aj + 0.8]));
  solid.push(cyl(0.15, 0.15, 0.015, 10, 0xc9a77a, [ai + 0.2, 0.205, aj + 0.8]));
  solid.push(ico(0.08, 0, 0x6f9a48, [ai + 0.12, 0.2, aj + 0.86], [1.3, 0.4, 1]));
  const [bi, bj] = FOREST_TRUNKS[2];
  solid.push(cyl(0.08, 0.08, 0.6, 10, 0x7a5a3e, [bi + 0.5, 0.08, bj + 0.82], [0, 0, Math.PI / 2]));
  for (const s of [-1, 1]) solid.push(cyl(0.075, 0.075, 0.01, 10, 0xc9a77a, [bi + 0.5 + s * 0.3, 0.08, bj + 0.82], [0, 0, Math.PI / 2]));
  // champignons rouges à pois blancs au pied des arbres
  FOREST_TRUNKS.forEach(([i, j], n) => {
    for (let q = 0; q < 3; q++) {
      const a = n * 2.1 + q * 2.2;
      const x = i + 0.5 + Math.cos(a) * 0.32;
      const z = j + 0.5 + Math.sin(a) * 0.32;
      solid.push(cyl(0.012, 0.016, 0.06, 5, 0xf3eee4, [x, 0.03, z]));
      solid.push(sph(0.035, 8, 5, q === 1 ? 0xc9a77a : 0xd9433a, [x, 0.065, z], [1, 0.6, 1]));
      if (q !== 1) solid.push(sph(0.008, 4, 3, 0xffffff, [x + 0.012, 0.085, z]));
    }
  });
  g.add(mesh(merge(solid)));
  // sous-bois : fougères et jacinthes, sur toutes les cases où l'on passe
  const tr = new Tris();
  const fern = new THREE.Color(0x4f8a35);
  const fernTip = new THREE.Color(0x86bb54);
  let k = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      if (FOREST_TRUNKS.some(([a, b]) => a === i && b === j)) continue;
      for (let q = 0; q < 3; q++, k++) {
        const x = i + 0.2 + rnd(k * 3) * 0.6;
        const z = j + 0.2 + rnd(k * 5) * 0.6;
        // une fougère : huit frondes qui s'ouvrent en rosette
        for (let f = 0; f < 8; f++) {
          const dir = (f / 8) * Math.PI * 2 + rnd(k + f) * 0.4;
          tr.blade(x, z, 0.12 + rnd(k * 7 + f) * 0.08, 0.07, dir, 0.18, fern.getHex(), fernTip.getHex(), 0.9 + rnd(k + f * 3) * 0.2);
        }
      }
      // quelques jacinthes des bois
      for (let q = 0; q < 2; q++, k++) {
        const x = i + 0.15 + rnd(k * 11) * 0.7;
        const z = j + 0.15 + rnd(k * 13) * 0.7;
        tr.blade(x, z, 0.16, 0.012, rnd(k) * 6, 0.02, 0x4e8a32, 0x5f9c3c);
      }
    }
  const fl: Parts = [tr.geo()];
  k = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      if (FOREST_TRUNKS.some(([a, b]) => a === i && b === j)) continue;
      for (let q = 0; q < 2; q++, k++) {
        const x = i + 0.15 + rnd(k * 17) * 0.7;
        const z = j + 0.15 + rnd(k * 19) * 0.7;
        for (let b = 0; b < 3; b++) fl.push(sph(0.014, 5, 3, 0x6a6fd1, [x, 0.12 + b * 0.025, z]));
      }
    }
  g.add(plants(fl));
  return { group: g, eggSlots: [], eggMeshes: [], key: 'forest1', thumbOnly: thumbLawn(g, 4, 4) };
}

// ================================================= PRAIRIE AUX INSECTES ====
const WING = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, vertexColors: true });

/** Un papillon : deux paires d'ailes colorées (elles battent en tournant autour du corps). */
function butterfly(color: number) {
  const g = new THREE.Group();
  const wing = (s: number) => {
    const t = new Tris();
    t.v(0, 0, 0, color);
    t.v(s * 0.07, 0, 0.045, color, 1.1);
    t.v(s * 0.06, 0, -0.03, color, 0.85);
    t.v(0, 0, 0, color);
    t.v(s * 0.05, 0, -0.03, color, 0.85);
    t.v(s * 0.035, 0, -0.07, 0x2b2b31);
    const m = new THREE.Mesh(t.geo(), WING);
    const pivot = new THREE.Group();
    pivot.add(m);
    return pivot;
  };
  const l = wing(-1);
  const r = wing(1);
  const bodyM = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2b2b31 }));
  g.add(l, r, bodyM);
  return { g, l, r };
}

/**
 * Prairie aux insectes (4 × 4) : herbes hautes très denses, épis, fleurs des champs (coquelicots,
 * bleuets, marguerites), papillons qui volettent et sauterelles qui bondissent. Les poules y entrent
 * chasser les insectes.
 */
export function meadowModel(): BuildingView {
  const g = new THREE.Group();
  const tr = new Tris();
  const base = 0x56913a;
  const tips = [0xb7d26a, 0xc9d27a, 0x9fcd5c, 0xd6d58a, 0xa9c766];
  let k = 0;
  // un tapis d'herbes hautes, touffe contre touffe
  for (let i = 0; i < 22; i++)
    for (let j = 0; j < 22; j++, k++) {
      const x = 0.1 + (i + rnd(k * 3)) * (3.8 / 22);
      const z = 0.1 + (j + rnd(k * 5)) * (3.8 / 22);
      const fan = rnd(k * 7) * Math.PI * 2;
      for (let b = 0; b < 4; b++) {
        const dir = fan + (b / 4) * Math.PI * 2 + rnd(k + b) * 0.8;
        tr.blade(x, z, 0.2 + rnd(k * 11 + b) * 0.14, 0.022, dir, 0.06 + rnd(k + b * 5) * 0.06, base, tips[(k + b) % tips.length], 0.9 + rnd(k * 13 + b) * 0.18);
      }
    }
  const fl: Parts = [tr.geo()];
  // épis et fleurs des champs qui dépassent
  for (let q = 0; q < 130; q++) {
    const x = 0.2 + rnd(q * 3 + 1) * 3.6;
    const z = 0.2 + rnd(q * 3 + 2) * 3.6;
    const kind = q % 5;
    if (kind === 0) {
      fl.push(cyl(0.004, 0.006, 0.36, 3, 0x8faa4a, [x, 0.18, z]));
      fl.push(cyl(0.014, 0.008, 0.07, 4, 0xd9c27a, [x, 0.39, z]));
    } else flower(fl, x, z, 0.26 + rnd(q) * 0.1, kind === 1 || kind === 4 ? 0xd9433a : kind === 2 ? 0x4f7fe0 : 0xf6f2ea, q, 1.25);
  }
  g.add(plants(fl));
  // papillons et sauterelles
  const flies = [0xf2c230, 0xffffff, 0xf08a3a, 0x9fd0ff].map((c) => butterfly(c));
  for (const f of flies) g.add(f.g);
  const hoppers = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.018), new THREE.MeshLambertMaterial({ color: 0x6aa84f }));
    g.add(m);
    return m;
  });
  const tick = (t: number) => {
    flies.forEach((f, i) => {
      const a = t * (0.45 + i * 0.07) + i * 1.7;
      f.g.position.set(2 + Math.sin(a) * 1.3 + Math.sin(a * 2.3) * 0.3, 0.5 + Math.sin(t * 2.1 + i) * 0.12, 2 + Math.cos(a * 0.8) * 1.2);
      f.g.rotation.y = a + Math.PI / 2;
      const flap = Math.sin(t * 22 + i) * 0.9;
      f.l.rotation.z = flap;
      f.r.rotation.z = -flap;
    });
    hoppers.forEach((h, i) => {
      const period = 2.6 + i * 0.7;
      const u = ((t + i * 1.3) % period) / period;
      const n = Math.floor((t + i * 1.3) / period);
      const x0 = 0.5 + rnd(n * 7 + i) * 3;
      const z0 = 0.5 + rnd(n * 11 + i) * 3;
      const jump = u < 0.25 ? u / 0.25 : 1;
      h.position.set(x0 + jump * 0.35, 0.22 + Math.sin(Math.min(1, jump) * Math.PI) * 0.25, z0);
      h.rotation.y = rnd(n + i) * 6;
    });
  };
  return { group: g, eggSlots: [], eggMeshes: [], key: 'meadow1', thumbOnly: thumbLawn(g, 4, 4), tick };
}

// =========================================================== JARDIN FLEURI ====
/**
 * Jardin fleuri (4 × 4) : au centre, un grand massif rond en pierre (les quatre cases du milieu)
 * débordant de roses, delphiniums, tournesols et lavande, une ruche blanche et ses abeilles ; tout
 * autour, là où les poules se promènent, des fleurs basses dans l'herbe et des papillons.
 */
export function gardenModel(): BuildingView {
  const g = new THREE.Group();
  const p: Parts = [];
  const c = 2;
  // le massif central : bordure de pierres, terre, et la ruche sur son socle
  p.push(cyl(0.94, 0.96, 0.18, 32, 0xcfc3ad, [c, 0.09, c]));
  p.push(cyl(0.9, 0.9, 0.02, 32, 0x5a4632, [c, 0.185, c]));
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    p.push(ico(0.07, 0, i % 2 ? 0xbdb2a0 : 0xd9cfbd, [c + Math.cos(a) * 0.95, 0.17, c + Math.sin(a) * 0.95], [1.2, 0.7, 1]));
  }
  p.push(box(0.08, 0.22, 0.08, 0x8a6a48, [c, 0.29, c]));
  p.push(box(0.36, 0.05, 0.32, 0xe8e2d4, [c, 0.42, c]));
  for (let i = 0; i < 3; i++) p.push(box(0.32, 0.12, 0.28, i % 2 ? 0xf6f2ea : 0xece6da, [c, 0.5 + i * 0.12, c]));
  p.push(box(0.4, 0.04, 0.36, 0xd9cfbd, [c, 0.88, c]));
  p.push(box(0.1, 0.02, 0.01, 0x3a3f4a, [c, 0.46, c + 0.142]));
  g.add(mesh(merge(p)));
  const fl: Parts = [];
  // massif : des touffes fleuries serrées qui couvrent toute la terre (roses, lavande, œillets,
  // soucis), quelques grands delphiniums bleus et des tournesols au bord ; la ruche au milieu
  const BLOOMS = [0xd9433a, 0xe85d9b, 0xf6f2ea, 0x9b7fd1, 0xf2c230, 0xf08a3a, 0xc2185b];
  let k = 0;
  for (let ring = 0; ring < 3; ring++) {
    const r = 0.36 + ring * 0.22;
    const n = 9 + ring * 6;
    for (let i = 0; i < n; i++, k++) {
      const a = (i / n) * Math.PI * 2 + ring * 0.37;
      const x = c + Math.cos(a) * r;
      const z = c + Math.sin(a) * r;
      const rad = 0.1 + rnd(k * 3) * 0.04;
      const col = BLOOMS[(i * 3 + ring * 2) % BLOOMS.length];
      fl.push(ico(rad, 0, k % 2 ? 0x4f8a35 : 0x5f9c3c, [x, 0.2 + rad * 0.45, z], [1, 0.7, 1]));
      for (let b = 0; b < 8; b++, k++) {
        const ba = rnd(k * 7) * Math.PI * 2;
        const br = rnd(k * 11) * rad * 0.85;
        const by = 0.2 + rad * 0.45 + Math.sqrt(Math.max(0, 1 - (br / rad) ** 2)) * rad * 0.7;
        fl.push(ico(0.032 + rnd(k) * 0.012, 0, col, [x + Math.cos(ba) * br, by + 0.01, z + Math.sin(ba) * br], [1, 0.75, 1]));
      }
    }
  }
  for (let i = 0; i < 8; i++, k++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const x = c + Math.cos(a) * 0.55;
    const z = c + Math.sin(a) * 0.55;
    fl.push(cyl(0.007, 0.009, 0.46, 3, 0x4e8a32, [x, 0.42, z]));
    for (let q = 0; q < 6; q++) fl.push(sph(0.026 - q * 0.002, 5, 3, q % 2 ? 0x5a6fd8 : 0x7f8ff0, [x, 0.46 + q * 0.04, z]));
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.6;
    const x = c + Math.cos(a) * 0.82;
    const z = c + Math.sin(a) * 0.82;
    fl.push(cyl(0.011, 0.013, 0.55, 4, 0x4e8a32, [x, 0.47, z]));
    for (const s of [-1, 1]) fl.push(box(0.09, 0.006, 0.05, 0x5f9c3c, [x + s * 0.045, 0.45, z], [0, a, s * 0.4]));
    fl.push(cyl(0.085, 0.085, 0.016, 12, 0xf2c230, [x, 0.75, z + 0.012], [1.15, 0, 0]));
    fl.push(cyl(0.038, 0.038, 0.02, 10, 0x6b4a2a, [x, 0.752, z + 0.02], [1.15, 0, 0]));
  }
  // tout autour, dans l'herbe où passent les poules : un semis de fleurs basses de toutes les couleurs
  for (let q = 0; q < 220; q++) {
    const a = rnd(q * 3 + 1) * Math.PI * 2;
    const r = 1.06 + rnd(q * 3 + 2) * 0.92;
    const x = c + Math.cos(a) * r * (1 + Math.abs(Math.sin(a * 2)) * 0.1);
    const z = c + Math.sin(a) * r * (1 + Math.abs(Math.cos(a * 2)) * 0.1);
    if (x < 0.08 || x > 3.92 || z < 0.08 || z > 3.92) continue;
    fl.push(...flowerAt(x, z, 0, [0xf6f2ea, 0xf2c230, 0xe85d9b, 0xd9433a, 0x9b7fd1, 0x6a8fe0][q % 6], q, 1.25));
  }
  g.add(plants(fl));
  // abeilles autour de la ruche, papillons au-dessus des fleurs
  const beeMat = new THREE.MeshBasicMaterial({ color: 0xf2c230 });
  const bees = Array.from({ length: 6 }, () => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), beeMat);
    b.scale.set(1, 0.8, 1.4);
    g.add(b);
    return b;
  });
  const flies = [0xe85d9b, 0xffffff, 0x9fd0ff].map((col) => butterfly(col));
  for (const f of flies) g.add(f.g);
  const tick = (t: number) => {
    bees.forEach((b, i) => {
      const a = t * (1.6 + i * 0.25) + i;
      const r = 0.3 + (i % 3) * 0.25 + Math.sin(t * 3 + i) * 0.08;
      b.position.set(c + Math.cos(a) * r, 0.5 + Math.sin(t * 4 + i * 2) * 0.12 + (i % 2) * 0.15, c + Math.sin(a) * r);
      b.rotation.y = -a;
    });
    flies.forEach((f, i) => {
      const a = t * (0.5 + i * 0.08) + i * 2.1;
      f.g.position.set(c + Math.sin(a) * 1.5, 0.45 + Math.sin(t * 2 + i) * 0.1, c + Math.cos(a * 0.9) * 1.5);
      f.g.rotation.y = a + Math.PI / 2;
      const flap = Math.sin(t * 20 + i) * 0.9;
      f.l.rotation.z = flap;
      f.r.rotation.z = -flap;
    });
  };
  return { group: g, eggSlots: [], eggMeshes: [], key: 'garden1', thumbOnly: thumbLawn(g, 4, 4), tick };
}
