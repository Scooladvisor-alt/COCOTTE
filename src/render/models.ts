// Modèles low-poly procéduraux : poules, œufs, bâtiments (par niveau), décor, clients.
import * as THREE from 'three';
import { EGG_TYPES } from '../config/balance';
import { BREEDS } from '../config/breeds';
import { COOP_SCALE, STORAGE_SCALE } from '../config/buildings';
import { HEN_MAT, HEN_PIVOT, type HenGeo } from './henModel';
import type { BreedId, BuildingType, EggType } from '../sim/types';
import { C, CREATURE_MAT, GLOW, MAT, box, cone, cyl, finalizeExport, ico, merge, mesh, prism, sph } from './geo';
import { armParts, headParts, legParts, lookOf, strip, torsoParts, type Outfit } from './people';
import {
  compostBin,
  compostHeap,
  compostPallets,
  coopBarn,
  coopCabin,
  coopModern,
  coopFarm,
  gooseHouse,
  coopAviary,
  coopNormand,
  dustbathShelter,
  dustbathSleepers,
  eggCrate,
  nestCurtains,
  nestRollaway,
  nestSimple,
  storeCold,
  storeLarder,
  storeVented,
  storeWarehouse,
  storeColdHub,
} from './farmBuildings';

// ================================================================ POULES ====
// Le modèle des volailles (poules, coqs, jeunes, poussins) est dans henModel.ts.
export { ADULT_STAGE, GOLD_HEN_MAT, HEN_MAT, HEN_PIVOT, HEN_RIM, henGeometry, type HenGeo, type HenKind } from './henModel';

/**
 * Squelette d'animation d'une poule (sans maillage) : ses matrices sont recopiées
 * dans des InstancedMesh partagés par race, pour dessiner tout le troupeau en peu d'appels.
 */
export interface HenView {
  root: THREE.Object3D;
  bodyPivot: THREE.Object3D;
  headPivot: THREE.Object3D;
  wingL: THREE.Object3D;
  wingR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  phase: number;
  tint: THREE.Color;
  size: number;
  /** Ouverture des yeux (1 : ouverts, ~0 : fermés), animée par le rendu (clignement). */
  eyeOpen: number;
}

export function createHenView(breed: BreedId, seed: number): HenView {
  const rnd = (k: number) => {
    const x = Math.sin(seed * 91.7 + k * 13.3) * 43758.5453;
    return x - Math.floor(x);
  };
  const root = new THREE.Object3D();
  const bodyPivot = new THREE.Object3D();
  bodyPivot.position.y = HEN_PIVOT.body;
  root.add(bodyPivot);
  const headPivot = new THREE.Object3D();
  headPivot.position.set(HEN_PIVOT.neck[0], HEN_PIVOT.neck[1] - HEN_PIVOT.body, HEN_PIVOT.neck[2]);
  bodyPivot.add(headPivot);
  const wingL = new THREE.Object3D();
  const wingR = new THREE.Object3D();
  wingL.position.set(HEN_PIVOT.wing[0], HEN_PIVOT.wing[1] - HEN_PIVOT.body, HEN_PIVOT.wing[2]);
  wingR.position.set(-HEN_PIVOT.wing[0], HEN_PIVOT.wing[1] - HEN_PIVOT.body, HEN_PIVOT.wing[2]);
  bodyPivot.add(wingL, wingR);
  const legL = new THREE.Object3D();
  const legR = new THREE.Object3D();
  legL.position.set(HEN_PIVOT.hip[0], HEN_PIVOT.hip[1], HEN_PIVOT.hip[2]);
  legR.position.set(-HEN_PIVOT.hip[0], HEN_PIVOT.hip[1], HEN_PIVOT.hip[2]);
  root.add(legL, legR);
  // chaque poule est unique : légère variation de taille et de teinte du plumage
  const size = BREEDS[breed].scale * (0.94 + rnd(1) * 0.12);
  const l = 0.9 + rnd(2) * 0.16;
  const tint = new THREE.Color(l * (0.98 + rnd(3) * 0.04), l, l * (0.97 + rnd(4) * 0.05));
  root.scale.setScalar(size);
  return { root, bodyPivot, headPivot, wingL, wingR, legL, legR, phase: rnd(5) * 10, tint, size, eyeOpen: 1 };
}

/** Un lot d'InstancedMesh par race : corps (ombre portée), tête, ailes, pattes. */
export class HenBatch {
  body: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
  eyes: THREE.InstancedMesh;
  private eyeAt: [number, number];
  private static readonly M = new THREE.Matrix4();
  private static readonly T = new THREE.Matrix4();
  wingL: THREE.InstancedMesh;
  wingR: THREE.InstancedMesh;
  legs: THREE.InstancedMesh;
  private n = 0;
  private static readonly WHITE = new THREE.Color(1, 1, 1);

  constructor(g: HenGeo, max: number, mat: THREE.Material = HEN_MAT) {
    this.body = new THREE.InstancedMesh(g.body, mat, max);
    this.head = new THREE.InstancedMesh(g.head, mat, max);
    this.eyes = new THREE.InstancedMesh(g.eyes, HEN_MAT, max);
    this.eyeAt = g.eyeAt;
    this.wingL = new THREE.InstancedMesh(g.wingL, mat, max);
    this.wingR = new THREE.InstancedMesh(g.wingR, mat, max);
    this.legs = new THREE.InstancedMesh(g.leg, mat, max * 2);
    this.body.castShadow = true;
    for (const m of this.meshes()) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
    }
    for (let i = 0; i < max * 2; i++) this.legs.setColorAt(i, HenBatch.WHITE);
  }

  meshes() {
    return [this.body, this.head, this.eyes, this.wingL, this.wingR, this.legs];
  }

  begin() {
    this.n = 0;
  }

  push(v: HenView, tint: THREE.Color = v.tint) {
    if (this.n >= this.body.instanceMatrix.count) return;
    v.root.updateMatrixWorld(true);
    const i = this.n;
    this.body.setMatrixAt(i, v.bodyPivot.matrixWorld);
    this.head.setMatrixAt(i, v.headPivot.matrixWorld);
    // clignement : les yeux s'écrasent verticalement autour de leur centre (la paupière se ferme)
    if (v.eyeOpen >= 0.999) this.eyes.setMatrixAt(i, v.headPivot.matrixWorld);
    else {
      const [ey, ez] = this.eyeAt;
      const M = HenBatch.M.copy(v.headPivot.matrixWorld).multiply(HenBatch.T.makeTranslation(0, ey, ez));
      M.multiply(HenBatch.T.makeScale(1, Math.max(0.06, v.eyeOpen), 1)).multiply(HenBatch.T.makeTranslation(0, -ey, -ez));
      this.eyes.setMatrixAt(i, M);
    }
    this.wingL.setMatrixAt(i, v.wingL.matrixWorld);
    this.wingR.setMatrixAt(i, v.wingR.matrixWorld);
    this.legs.setMatrixAt(i * 2, v.legL.matrixWorld);
    this.legs.setMatrixAt(i * 2 + 1, v.legR.matrixWorld);
    this.body.setColorAt(i, tint);
    this.head.setColorAt(i, tint);
    this.wingL.setColorAt(i, tint);
    this.wingR.setColorAt(i, tint);
    this.n++;
  }

  end() {
    this.body.count = this.n;
    this.head.count = this.n;
    this.eyes.count = this.n;
    this.wingL.count = this.n;
    this.wingR.count = this.n;
    this.legs.count = this.n * 2;
    for (const m of this.meshes()) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

// ================================================================== ŒUFS ====
const eggGeoCache = new Map<EggType, THREE.BufferGeometry>();
export function eggGeometry(type: EggType) {
  let g = eggGeoCache.get(type);
  if (!g) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const a = t * Math.PI;
      const r = Math.sin(a) * (0.062 + 0.012 * Math.cos(a));
      pts.push(new THREE.Vector2(r, -Math.cos(a) * 0.088 + 0.088));
    }
    const lathe = new THREE.LatheGeometry(pts, 8);
    // l'œuf d'oie est bien plus gros que celui de la poule
    if (type === 'oie') lathe.scale(1.45, 1.5, 1.45);
    g = merge([lathe].map((l) => {
      const c = new THREE.Color(EGG_TYPES[type].color);
      const n = l.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) (arr[i * 3] = c.r), (arr[i * 3 + 1] = c.g), (arr[i * 3 + 2] = c.b);
      l.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      l.deleteAttribute('uv');
      return l;
    }));
    eggGeoCache.set(type, g);
  }
  return g;
}
export const EGG_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
/** Œuf d'or : métal poli, reflets éclatants et légère lueur. */
export const GOLD_EGG_MAT = new THREE.MeshPhongMaterial({ vertexColors: true, specular: 0xfff4c0, shininess: 110, emissive: 0x5a3c00 });
/** Œufs oubliés au sol : ils ternissent puis verdissent avant de pourrir. */
export const EGG_STALE_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xc9bf98 });
export const EGG_ROT_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x8f9a5c });

// ============================================================= BÂTIMENTS ====
export interface BuildingView {
  group: THREE.Group;
  fill?: THREE.Object3D;
  fillBase?: number;
  fillHeight?: number;
  /** scale : s'étire en hauteur ; move : monte et descend ; heap : une butte fixe (le compost). */
  fillMode?: 'scale' | 'move' | 'heap';
  eggSlots: THREE.Vector3[];
  eggMeshes: THREE.Mesh[];
  crates?: THREE.Mesh[];
  dirt?: THREE.Mesh;
  /** Trappe du poulailler (pivot en haut de l'ouverture, échelle Y = fermeture). */
  door?: THREE.Object3D;
  key: string;
}

/** Trappe coulissante en bois : visible quand le commis a fermé le poulailler. */
function trapDoor(w: number, h: number, x: number, top: number, z: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, top, z);
  const panel = mesh(
    merge([
      box(w, h, 0.035, 0xb7773f, [0, -h / 2, 0]),
      box(w * 0.92, 0.03, 0.04, 0x8a5428, [0, -h * 0.3, 0.004]),
      box(w * 0.92, 0.03, 0.04, 0x8a5428, [0, -h * 0.7, 0.004]),
      box(0.05, 0.05, 0.05, 0x5b5f66, [w * 0.3, -h * 0.5, 0.02]),
    ]),
    false,
    false,
  );
  pivot.add(panel);
  pivot.scale.y = 0.001;
  pivot.visible = false;
  return pivot;
}

function slab(w: number, d: number, color = 0xe6d9bf, h = 0.05) {
  return box(w - 0.08, h, d - 0.08, color, [w / 2, h / 2, d / 2]);
}

function windowPane(w: number, h: number, p: [number, number, number], ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), GLOW);
  m.position.set(...p);
  m.rotation.y = ry;
  return m;
}

function coopModel(level: number): BuildingView {
  // dessiné sur 3 × 2, puis agrandi (le groupe extérieur reste libre pour l'animation de pose)
  const outer = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(COOP_SCALE);
  outer.add(g);
  // les grands poulaillers sont dessinés sur 4 × 2,5 (niveau 5) et 5 × 3 (niveau 6)
  const [W, D] = level === 5 ? [4, 2.5] : level === 6 ? [5, 3] : [3, 2];
  const parts: THREE.BufferGeometry[] = [slab(W, D, level >= 4 ? 0xd6d8da : 0xe2d3b5)];
  const windows: THREE.Mesh[] = [];
  if (level === 1) coopCabin(parts, windows);
  else if (level === 2) coopBarn(parts, windows);
  else if (level === 3) coopNormand(parts, windows);
  else if (level === 4) coopModern(parts, windows);
  else if (level === 5) coopFarm(parts, windows);
  else coopAviary(parts, windows);
  g.add(mesh(merge(parts)));
  for (const w of windows) g.add(w);
  const door =
    level === 1
      ? trapDoor(0.32, 0.44, 1.5, 0.75, 1.598)
      : level === 2
        ? trapDoor(0.34, 0.52, 1.5, 0.78, 1.692)
        : level === 3
          ? trapDoor(0.38, 0.58, 1.5, 0.74, 1.758)
          : level === 4
            ? trapDoor(0.34, 0.38, 1.5, 0.46, 1.81)
            : level === 5
              ? trapDoor(0.44, 0.5, 2, 0.62, 2.22)
              : trapDoor(0.38, 0.4, 2.5, 0.5, 2.68);
  g.add(door);
  return { group: outer, eggSlots: [], eggMeshes: [], key: `coop${level}`, door };
}

/** Abri à oies : dessiné à l'échelle 1 (4 × 3, 5 × 3, 6 × 4) ; porte large que le commis ferme le soir. */
function gooseHouseModel(level: number): BuildingView {
  const W = level === 1 ? 4 : level === 2 ? 5 : 6;
  const D = level === 3 ? 4 : 3;
  const parts: THREE.BufferGeometry[] = [slab(W, D, 0xe2d3b5)];
  const windows: THREE.Mesh[] = [];
  gooseHouse(parts, windows, level);
  const g = new THREE.Group();
  g.add(mesh(merge(parts)));
  for (const w of windows) g.add(w);
  // porte coulissante de nuit (même animation que la trappe des poulaillers)
  const door = trapDoor(0.95, level === 3 ? 0.95 : 0.78, W / 2, level === 3 ? 0.97 : 0.8, D - 0.5);
  g.add(door);
  return { group: g, eggSlots: [], eggMeshes: [], key: `goosehouse${level}`, door };
}

function nestModel(level: number): BuildingView {
  const parts: THREE.BufferGeometry[] = [slab(2, 1, 0xe2d3b5)];
  const n = level === 1 ? 3 : level === 2 ? 4 : 5;
  if (level === 1) nestSimple(parts, n);
  else if (level === 2) nestCurtains(parts, n);
  else nestRollaway(parts, n);
  // places des œufs dans chaque nid (2, 4 ou 6 par compartiment)
  const slots: THREE.Vector3[] = [];
  const top = 0.42;
  for (let i = 0; i < n; i++) {
    const cx = 0.1 + ((i + 0.5) * 1.8) / n;
    for (let k = 0; k < (level === 1 ? 2 : level === 2 ? 4 : 6); k++) {
      slots.push(new THREE.Vector3(cx + ((k % 2) - 0.5) * 0.11, top + 0.02, 0.48 + Math.floor(k / 2) * 0.09 - 0.05));
    }
  }
  const g = new THREE.Group();
  g.add(mesh(merge(parts)));
  return { group: g, eggSlots: slots, eggMeshes: [], key: `nest${level}` };
}

// ------------------------------------------------- Mangeoires et abreuvoirs ----
const GALVA = 0xc3cad0;
const GALVA_DARK = 0x9aa3ab;
const GALVA_LIGHT = 0xdfe4e8;

/** Retourne une géométrie (non indexée) : faces vers l'intérieur. */
function flipFaces(g: THREE.BufferGeometry) {
  for (const name of ['position', 'normal', 'color']) {
    const a = g.attributes[name] as THREE.BufferAttribute | undefined;
    if (!a) continue;
    for (let i = 0; i < a.count; i += 3)
      for (let k = 0; k < a.itemSize; k++) {
        const t = a.array[(i + 1) * a.itemSize + k];
        (a.array as Float32Array)[(i + 1) * a.itemSize + k] = a.array[(i + 2) * a.itemSize + k];
        (a.array as Float32Array)[(i + 2) * a.itemSize + k] = t;
      }
  }
  const n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.array.length; i++) (n.array as Float32Array)[i] *= -1;
  return g;
}

/**
 * Récipient ouvert (seau, coupelle, cuvette) : paroi avec une épaisseur, lèvre en anneau, fond.
 * Contrairement à un cylindre plein, on voit son contenu (eau, grain) par le dessus.
 */
function openTub(parts: THREE.BufferGeometry[], rTop: number, rBot: number, h: number, seg: number, color: number, p: [number, number, number], wall = 0.014, inner = color) {
  parts.push(finalizeExport(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, true), color, p));
  parts.push(flipFaces(finalizeExport(new THREE.CylinderGeometry(rTop - wall, rBot - wall, h, seg, 1, true), inner, p)));
  const lip = new THREE.RingGeometry(rTop - wall, rTop + 0.002, seg);
  lip.rotateX(-Math.PI / 2);
  parts.push(finalizeExport(lip, color, [p[0], p[1] + h / 2, p[2]]));
  const bottom = new THREE.CircleGeometry(rBot - wall, seg);
  bottom.rotateX(-Math.PI / 2);
  parts.push(finalizeExport(bottom, inner, [p[0], p[1] - h / 2 + 0.004, p[2]]));
}

/** Sol tassé autour d'un point d'alimentation : terre battue, cailloux, grains éparpillés ou flaques. */
function wornGround(parts: THREE.BufferGeometry[], kind: 'grain' | 'water', r = 0.5, len = 1) {
  // le bâtiment est posé 2 cm sous la pelouse : la terre battue doit dépasser franchement du sol,
  // sinon les deux surfaces se disputent l'affichage (rond qui clignote). Les auges longues
  // (len cases) ont une bande de terre battue étirée sur toute leur longueur.
  const cx = len / 2;
  const sx = (r + (len - 1) / 2) / r;
  parts.push(cyl(r, r, 0.04, 16 + len * 4, kind === 'grain' ? 0xcdb88e : 0xbfb397, [cx, 0.017, 0.5], [0, 0, 0], [sx, 1, 0.88]));
  parts.push(cyl(r * 0.78, r * 0.78, 0.04, 14 + len * 4, kind === 'grain' ? 0xc4ab7c : 0xa9a083, [cx, 0.027, 0.5], [0, 0, 0], [sx * 0.97, 1, 0.9]));
  for (let i = 0; i < 7 * len; i++) {
    const a = i * 2.35 + 0.4;
    const d = r * (0.55 + ((i * 37) % 10) / 25);
    parts.push(ico(0.022 + (i % 3) * 0.008, 0, 0xb5ad9c, [cx + Math.cos(a) * d * sx, 0.05, 0.5 + Math.sin(a) * d * 0.9], [1, 0.55, 1]));
  }
  if (kind === 'grain')
    for (let i = 0; i < 16 * len; i++) {
      const a = i * 1.71;
      const d = r * (0.62 + ((i * 53) % 10) / 30);
      parts.push(box(0.022, 0.012, 0.014, i % 3 ? 0xe2b752 : 0xd29c3c, [cx + Math.cos(a) * d * sx, 0.053, 0.5 + Math.sin(a) * d * 0.9], [0, a, 0]));
    }
  else {
    // flaques d'eau renversée
    for (let k = 0; k < len; k++) parts.push(cyl(0.12, 0.12, 0.006, 12, 0x9fc6d8, [0.5 + k + r * 0.55 * (k % 2 ? -1 : 1), 0.05, 0.5 + r * 0.35 * (k % 2 ? -1 : 1)], [0, 0, 0], [1.4, 1, 0.8]));
  }
}

/** Anse en fil de fer (arc de cercle dans le plan x-y), centrée en p. */
function wireArc(parts: THREE.BufferGeometry[], radius: number, p: [number, number, number], color = GALVA_DARK, tilt = 0) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI;
    const a1 = ((i + 1) / n) * Math.PI;
    const am = (a0 + a1) / 2;
    const len = 2 * radius * Math.sin((a1 - a0) / 2) + 0.004;
    const x = Math.cos(am) * radius;
    const y = Math.sin(am) * radius;
    parts.push(cyl(0.008, 0.008, len, 4, color, [p[0] + x, p[1] + y * Math.cos(tilt), p[2] + y * Math.sin(tilt)], [tilt, 0, am]));
  }
}

/** Tas de grain (demi-ellipsoïde de hauteur 1, mis à l'échelle selon la réserve). */
function grainHeap(rx: number, rz: number, color = C.grain) {
  const g = finalizeExport(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), color, [0, 0, 0], [0, 0, 0], [rx, 1, rz]);
  // grains plus clairs au sommet, plus dorés à la base
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = g.attributes.color as THREE.BufferAttribute;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.setHex(color).multiplyScalar(0.88 + pos.getY(i) * 0.22 + (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.08);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  return g;
}

function feederModel(level: number): BuildingView {
  if (level >= 4) return longFeederModel(level);
  const parts: THREE.BufferGeometry[] = [];
  wornGround(parts, 'grain', level === 3 ? 0.56 : 0.5);
  let fill: THREE.Object3D;
  let base = 0;
  let height = 0;
  if (level === 1) {
    // auge en planches sur deux tréteaux, barre anti-perchoir en haut
    for (const x of [0.12, 0.88]) {
      parts.push(box(0.04, 0.3, 0.05, C.woodDark, [x, 0.14, 0.32], [0.32, 0, 0]));
      parts.push(box(0.04, 0.3, 0.05, C.woodDark, [x, 0.14, 0.68], [-0.32, 0, 0]));
      // flasque (pignon) de l'auge
      parts.push(box(0.035, 0.16, 0.36, C.wood, [x, 0.2, 0.5]));
      parts.push(box(0.03, 0.26, 0.04, C.woodDark, [x, 0.38, 0.5]));
    }
    parts.push(box(0.8, 0.035, 0.22, C.plank, [0.5, 0.135, 0.5]));
    parts.push(box(0.8, 0.15, 0.03, C.wood, [0.5, 0.2, 0.37], [0.28, 0, 0]));
    parts.push(box(0.8, 0.15, 0.03, C.wood, [0.5, 0.2, 0.63], [-0.28, 0, 0]));
    // lisses claires sur les bords, clous
    parts.push(box(0.82, 0.02, 0.035, C.woodLight, [0.5, 0.275, 0.345]));
    parts.push(box(0.82, 0.02, 0.035, C.woodLight, [0.5, 0.275, 0.655]));
    for (const x of [0.2, 0.5, 0.8]) for (const z of [0.345, 0.655]) parts.push(box(0.012, 0.012, 0.012, 0x6b6f75, [x, 0.288, z]));
    parts.push(cyl(0.016, 0.016, 0.8, 6, C.woodLight, [0.5, 0.48, 0.5], [0, 0, Math.PI / 2]));
    fill = mesh(grainHeap(0.36, 0.1), false, true);
    fill.position.set(0.5, 0.15, 0.5);
    base = 0.15;
    height = 0.11;
  } else if (level === 2) {
    // trémie galvanisée sur assiette à grille, alimentée par un tuyau depuis la réserve
    for (const a of [0.3, 2.4, 4.5]) parts.push(box(0.09, 0.05, 0.09, 0xb8a990, [0.5 + Math.cos(a) * 0.24, 0.025, 0.5 + Math.sin(a) * 0.24], [0, a, 0]));
    openTub(parts, 0.37, 0.34, 0.07, 20, GALVA, [0.5, 0.085, 0.5], 0.018, GALVA_DARK);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      parts.push(box(0.16, 0.012, 0.014, GALVA_DARK, [0.5 + Math.cos(a) * 0.27, 0.13, 0.5 + Math.sin(a) * 0.27], [0, -a, 0]));
    }
    parts.push(cyl(0.18, 0.19, 0.5, 16, GALVA, [0.5, 0.4, 0.5]));
    for (const y of [0.26, 0.5]) parts.push(cyl(0.193, 0.193, 0.025, 16, GALVA_DARK, [0.5, y, 0.5]));
    parts.push(cyl(0.2, 0.2, 0.03, 16, GALVA_LIGHT, [0.5, 0.66, 0.5]));
    parts.push(cone(0.21, 0.13, 16, GALVA, [0.5, 0.74, 0.5]));
    parts.push(cyl(0.025, 0.025, 0.04, 6, GALVA_DARK, [0.5, 0.82, 0.5]));
    wireArc(parts, 0.13, [0.5, 0.82, 0.5]);
    // plaque et tuyau d'alimentation
    parts.push(box(0.12, 0.08, 0.01, 0xf0e6c8, [0.5, 0.42, 0.69]));
    parts.push(cyl(0.025, 0.025, 0.45, 8, 0x5b5f66, [0.68, 0.62, 0.5], [0, 0, -0.9]));
    parts.push(cyl(0.025, 0.025, 0.55, 8, 0x5b5f66, [0.92, 0.32, 0.5]));
    fill = mesh(cyl(0.335, 0.335, 1, 20, C.grain, [0, 0.5, 0]), false, true);
    fill.position.set(0.5, 0.054, 0.5);
    base = 0.054;
    height = 0.06;
  } else {
    // petit silo sur pieds : échelle, trémie de vidange et couronne de distribution au sol
    const legs: Array<[number, number]> = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]];
    for (const [x, z] of legs) parts.push(box(0.04, 0.5, 0.04, GALVA_DARK, [x, 0.25, z]));
    parts.push(box(0.44, 0.03, 0.03, GALVA_DARK, [0.5, 0.2, 0.3]));
    parts.push(box(0.44, 0.03, 0.03, GALVA_DARK, [0.5, 0.2, 0.7]));
    parts.push(cone(0.25, 0.22, 16, GALVA, [0.5, 0.42, 0.5], [Math.PI, 0, 0]));
    parts.push(cyl(0.26, 0.26, 0.95, 18, 0xeef0f0, [0.5, 1.0, 0.5]));
    for (let i = 0; i < 5; i++) parts.push(cyl(0.262, 0.262, 0.02, 18, i === 2 ? C.blue : 0xc9ced3, [0.5, 0.6 + i * 0.2, 0.5]));
    parts.push(cone(0.3, 0.28, 18, C.roof, [0.5, 1.61, 0.5]));
    parts.push(cyl(0.05, 0.05, 0.06, 8, C.roofDark, [0.5, 1.77, 0.5]));
    // échelle
    for (const dx of [-0.07, 0.07]) parts.push(box(0.015, 1.15, 0.015, GALVA_DARK, [0.5 + dx, 1.0, 0.79]));
    for (let i = 0; i < 7; i++) parts.push(box(0.15, 0.012, 0.012, GALVA_DARK, [0.5, 0.52 + i * 0.16, 0.79]));
    // descente vers la couronne
    parts.push(cyl(0.03, 0.03, 0.22, 8, GALVA_DARK, [0.5, 0.2, 0.5]));
    openTub(parts, 0.45, 0.41, 0.07, 22, GALVA, [0.5, 0.08, 0.5], 0.02, GALVA_DARK);
    fill = mesh(cyl(0.405, 0.405, 1, 22, C.grain, [0, 0.5, 0]), false, true);
    fill.position.set(0.5, 0.05, 0.5);
    base = 0.05;
    height = 0.06;
  }
  const g = new THREE.Group();
  g.add(mesh(merge(parts)));
  g.add(fill);
  return { group: g, fill, fillBase: base, fillHeight: height, fillMode: 'scale', eggSlots: [], eggMeshes: [], key: `feeder${level}` };
}

/**
 * Grandes mangeoires, sur 3 ou 4 cases de long : auge galvanisée sur tréteaux avec barre anti-perchoir
 * et séparateurs (niveau 4), puis chaîne d'alimentation au ras du sol avec sa trémie motorisée (niveau 5).
 * Les places des poules sont dans sim/feeding.ts.
 */
function longFeederModel(level: number): BuildingView {
  const parts: THREE.BufferGeometry[] = [];
  let fill: THREE.Object3D;
  let base: number;
  let height: number;
  if (level === 4) {
    wornGround(parts, 'grain', 0.5, 3);
    const x0 = 0.12;
    const x1 = 2.88;
    const L = x1 - x0;
    const cx = (x0 + x1) / 2;
    // tréteaux en A et leurs patins
    for (const x of [0.25, 1.5, 2.75]) {
      for (const s2 of [-1, 1]) parts.push(box(0.035, 0.24, 0.035, GALVA_DARK, [x, 0.11, 0.5 + s2 * 0.1], [s2 * 0.42, 0, 0]));
      parts.push(box(0.05, 0.015, 0.3, GALVA_DARK, [x, 0.008, 0.5]));
      parts.push(box(0.03, 0.03, 0.26, GALVA_DARK, [x, 0.125, 0.5]));
    }
    // auge en U : fond, flancs évasés, bords roulés, embouts
    parts.push(box(L, 0.02, 0.17, GALVA_DARK, [cx, 0.14, 0.5]));
    for (const s2 of [-1, 1]) {
      parts.push(box(L, 0.13, 0.018, GALVA, [cx, 0.205, 0.5 + s2 * 0.095], [s2 * -0.22, 0, 0]));
      parts.push(cyl(0.014, 0.014, L, 6, GALVA_LIGHT, [cx, 0.27, 0.5 + s2 * 0.11], [0, 0, Math.PI / 2]));
    }
    for (const x of [x0, x1]) parts.push(box(0.018, 0.14, 0.24, GALVA, [x, 0.205, 0.5]));
    // barre anti-perchoir tournante sur ses potences, séparateurs en fil
    for (const x of [x0 + 0.02, x1 - 0.02]) parts.push(box(0.02, 0.22, 0.02, GALVA_DARK, [x, 0.36, 0.5]));
    parts.push(cyl(0.02, 0.02, L, 8, GALVA_LIGHT, [cx, 0.46, 0.5], [0, 0, Math.PI / 2]));
    for (let i = 1; i < 7; i++) {
      const x = x0 + (i * L) / 7;
      parts.push(box(0.008, 0.18, 0.008, GALVA_DARK, [x, 0.36, 0.5]));
      parts.push(box(0.008, 0.008, 0.2, GALVA_DARK, [x, 0.275, 0.5]));
    }
    // arrivée de grain automatique : tube incliné depuis une petite trémie au bout
    parts.push(cone(0.13, 0.16, 4, GALVA, [3.0, 0.62, 0.5], [Math.PI, Math.PI / 4, 0]));
    parts.push(box(0.2, 0.18, 0.2, GALVA, [3.0, 0.79, 0.5]));
    parts.push(box(0.22, 0.02, 0.22, GALVA_LIGHT, [3.0, 0.89, 0.5]));
    parts.push(cyl(0.025, 0.025, 0.35, 8, 0x5b5f66, [2.88, 0.4, 0.5], [0, 0, -0.6]));
    for (const dz of [-0.07, 0.07]) parts.push(box(0.025, 0.55, 0.025, GALVA_DARK, [3.0, 0.27, 0.5 + dz]));
    parts.push(box(0.12, 0.07, 0.01, 0xf0e6c8, [1.5, 0.2, 0.612]));
    fill = mesh(box(L - 0.04, 1, 0.16, C.grain, [0, 0.5, 0]), false, true);
    fill.position.set(cx, 0.15, 0.5);
    base = 0.15;
    height = 0.1;
  } else {
    wornGround(parts, 'grain', 0.5, 4);
    // trémie motorisée en tête de ligne
    for (const [x, z] of [
      [0.12, 0.28],
      [0.48, 0.28],
      [0.12, 0.72],
      [0.48, 0.72],
    ]) parts.push(box(0.035, 0.4, 0.035, GALVA_DARK, [x, 0.2, z]));
    parts.push(cone(0.33, 0.25, 4, GALVA, [0.3, 0.32, 0.5], [Math.PI, Math.PI / 4, 0]));
    parts.push(box(0.46, 0.34, 0.46, GALVA, [0.3, 0.6, 0.5]));
    for (const y of [0.48, 0.66]) parts.push(box(0.47, 0.015, 0.47, GALVA_DARK, [0.3, y, 0.5]));
    parts.push(box(0.5, 0.03, 0.5, GALVA_LIGHT, [0.3, 0.785, 0.5]));
    parts.push(box(0.18, 0.14, 0.14, 0xd8433a, [0.3, 0.13, 0.82]));
    parts.push(cyl(0.05, 0.05, 0.1, 10, 0x3a3f4a, [0.3, 0.13, 0.94], [Math.PI / 2, 0, 0]));
    parts.push(box(0.14, 0.09, 0.01, 0xf0e6c8, [0.3, 0.6, 0.737]));
    // canal au ras du sol, chaîne, roue d'angle au bout, fil anti-perchoir
    const x0 = 0.55;
    const x1 = 3.78;
    const L = x1 - x0;
    const cx = (x0 + x1) / 2;
    parts.push(box(L, 0.016, 0.15, GALVA_DARK, [cx, 0.035, 0.5]));
    for (const s2 of [-1, 1]) {
      parts.push(box(L, 0.075, 0.015, GALVA, [cx, 0.07, 0.5 + s2 * 0.075]));
      parts.push(cyl(0.011, 0.011, L, 6, GALVA_LIGHT, [cx, 0.11, 0.5 + s2 * 0.078], [0, 0, Math.PI / 2]));
    }
    for (let x = x0 + 0.06; x < x1; x += 0.11) parts.push(box(0.06, 0.012, 0.03, 0x5b5f66, [x, 0.052, 0.5]));
    parts.push(cyl(0.14, 0.14, 0.18, 14, GALVA, [3.8, 0.11, 0.5], [Math.PI / 2, 0, 0]));
    parts.push(cyl(0.045, 0.045, 0.2, 8, GALVA_DARK, [3.8, 0.11, 0.5], [Math.PI / 2, 0, 0]));
    for (let x = x0 + 0.25; x < x1; x += 0.65) {
      parts.push(box(0.012, 0.2, 0.012, GALVA_DARK, [x, 0.17, 0.5]));
      parts.push(box(0.04, 0.012, 0.18, GALVA_DARK, [x, 0.03, 0.5]));
    }
    parts.push(cyl(0.006, 0.006, L, 4, GALVA_LIGHT, [cx, 0.27, 0.5], [0, 0, Math.PI / 2]));
    fill = mesh(box(L - 0.04, 1, 0.12, C.grain, [0, 0.5, 0]), false, true);
    fill.position.set(cx, 0.045, 0.5);
    base = 0.045;
    height = 0.045;
  }
  const g = new THREE.Group();
  g.add(mesh(merge(parts)));
  g.add(fill);
  return { group: g, fill, fillBase: base, fillHeight: height, fillMode: 'scale', eggSlots: [], eggMeshes: [], key: `feeder${level}` };
}

/**
 * Grands abreuvoirs, sur 3 ou 4 cases : auge longue en inox à niveau constant (niveau 4), puis grand
 * bac en béton à niveau constant (niveau 5).
 */
function longDrinkerModel(level: number): BuildingView {
  const parts: THREE.BufferGeometry[] = [];
  let fill: THREE.Object3D;
  let base: number;
  let height: number;
  const INOX = 0xdfe4ea;
  const INOX_D = 0xb3bcc5;
  if (level === 4) {
    wornGround(parts, 'water', 0.48, 3);
    const x0 = 0.1;
    const x1 = 2.75;
    const L = x1 - x0;
    const cx = (x0 + x1) / 2;
    for (const x of [0.22, 1.42, 2.62]) {
      for (const s2 of [-1, 1]) parts.push(box(0.035, 0.2, 0.035, INOX_D, [x, 0.09, 0.5 + s2 * 0.1], [s2 * 0.45, 0, 0]));
      parts.push(box(0.04, 0.03, 0.34, INOX_D, [x, 0.115, 0.5]));
    }
    parts.push(box(L, 0.02, 0.18, INOX_D, [cx, 0.13, 0.5]));
    for (const s2 of [-1, 1]) {
      parts.push(box(L, 0.12, 0.016, INOX, [cx, 0.185, 0.5 + s2 * 0.09]));
      parts.push(cyl(0.013, 0.013, L, 6, 0xf4f6f8, [cx, 0.247, 0.5 + s2 * 0.09], [0, 0, Math.PI / 2]));
    }
    for (const x of [x0, x1]) parts.push(box(0.016, 0.12, 0.2, INOX, [x, 0.185, 0.5]));
    // traverses anti-souillure, capot du flotteur, arrivée d'eau, vanne, bonde de vidange
    for (let i = 1; i < 7; i++) parts.push(box(0.012, 0.012, 0.2, INOX_D, [x0 + (i * L) / 7, 0.25, 0.5]));
    parts.push(box(0.2, 0.1, 0.24, INOX_D, [2.86, 0.27, 0.5]));
    parts.push(box(0.21, 0.015, 0.25, 0xf4f6f8, [2.86, 0.325, 0.5]));
    parts.push(cyl(0.022, 0.022, 0.32, 8, 0x2f3238, [2.98, 0.16, 0.5]));
    parts.push(cyl(0.03, 0.03, 0.05, 8, 0xd9b35a, [2.98, 0.12, 0.5]));
    parts.push(box(0.08, 0.015, 0.02, 0xd8433a, [2.98, 0.15, 0.54]));
    parts.push(cyl(0.022, 0.022, 0.5, 8, 0x2f3238, [2.98, 0.01, 0.75], [Math.PI / 2, 0, 0]));
    parts.push(cyl(0.025, 0.025, 0.03, 8, 0x3a3f4a, [0.08, 0.13, 0.5], [0, 0, Math.PI / 2]));
    fill = mesh(box(L - 0.04, 0.012, 0.16, C.water, [0, 0, 0]), false, false);
    fill.position.set(cx, 0.14, 0.5);
    base = 0.14;
    height = 0.08;
  } else {
    // grand bac en béton à niveau constant : bords arrondis, traverses anti-baignade, flotteur
    // sous son capot au bout, arrivée d'eau enterrée, bonde de vidange et un peu de mousse
    wornGround(parts, 'water', 0.5, 4);
    const CONC = 0xc9c5bb;
    const CONC_D = 0xb3afa5;
    const x0 = 0.15;
    const x1 = 3.8;
    const L = x1 - x0;
    const cx = (x0 + x1) / 2;
    const half = 0.22;
    const top = 0.25;
    parts.push(box(L + 0.06, 0.05, 2 * half + 0.06, CONC_D, [cx, 0.025, 0.5]));
    parts.push(box(L, 0.06, 2 * half - 0.08, CONC, [cx, 0.06, 0.5]));
    for (const s2 of [-1, 1]) {
      parts.push(box(L, top, 0.055, CONC, [cx, top / 2, 0.5 + s2 * (half - 0.028)]));
      parts.push(cyl(0.032, 0.032, L + 0.02, 8, 0xd6d2c8, [cx, top, 0.5 + s2 * (half - 0.028)], [0, 0, Math.PI / 2]));
      // coulures et mousse au pied du bac
      for (let i = 0; i < 6; i++) parts.push(box(0.08 + (i % 3) * 0.05, 0.05, 0.012, i % 2 ? 0x7f9a5a : CONC_D, [x0 + 0.3 + i * 0.6, 0.05, 0.5 + s2 * (half + 0.002)]));
    }
    for (const x of [x0, x1]) parts.push(box(0.06, top, 2 * half, CONC, [x, top / 2, 0.5]));
    // traverses galvanisées (les poules boivent sans entrer dans le bac)
    for (let i = 1; i < 6; i++) parts.push(cyl(0.012, 0.012, 2 * half - 0.04, 6, GALVA, [x0 + (i * L) / 6, top + 0.035, 0.5], [Math.PI / 2, 0, 0]));
    // capot du flotteur, arrivée d'eau enterrée et vanne, bonde
    parts.push(box(0.26, 0.09, 0.34, GALVA_DARK, [x1 - 0.18, top + 0.03, 0.5]));
    parts.push(box(0.27, 0.015, 0.35, GALVA_LIGHT, [x1 - 0.18, top + 0.08, 0.5]));
    parts.push(cyl(0.024, 0.024, 0.3, 8, 0x2f3238, [x1 + 0.06, 0.13, 0.5]));
    parts.push(cyl(0.024, 0.024, 0.12, 8, 0x2f3238, [x1 + 0.01, 0.27, 0.5], [0, 0, Math.PI / 2]));
    parts.push(cyl(0.032, 0.032, 0.05, 8, 0xd9b35a, [x1 + 0.06, 0.08, 0.5]));
    parts.push(box(0.08, 0.015, 0.02, 0xd8433a, [x1 + 0.06, 0.11, 0.54]));
    parts.push(cyl(0.03, 0.03, 0.04, 8, 0x3a3f4a, [x0 - 0.03, 0.08, 0.5], [0, 0, Math.PI / 2]));
    fill = mesh(box(L - 0.36, 0.012, 2 * half - 0.12, C.water, [0, 0, 0]), false, false);
    fill.position.set(cx - 0.13, 0.12, 0.5);
    base = 0.12;
    height = 0.1;
  }
  return { group: groupOf(parts, fill), fill, fillBase: base, fillHeight: height, fillMode: 'move', eggSlots: [], eggMeshes: [], key: `drinker${level}` };
}

function drinkerModel(level: number): BuildingView {
  if (level >= 4) return longDrinkerModel(level);
  const parts: THREE.BufferGeometry[] = [];
  wornGround(parts, 'water', level === 3 ? 0.55 : 0.48);
  let fill: THREE.Object3D;
  let base = 0;
  let height = 0;
  if (level === 1) {
    // bassine galvanisée basse sur une pierre plate : la poule y trempe le bec (voir sim/feeding.ts)
    parts.push(ico(0.33, 1, 0xb9b2a2, [0.5, 0.0, 0.5], [1, 0.12, 1]));
    openTub(parts, 0.27, 0.23, 0.15, 22, GALVA, [0.5, 0.11, 0.5], 0.012, GALVA_DARK);
    parts.push(finalizeExport(new THREE.CylinderGeometry(0.258, 0.258, 0.016, 22, 1, true), GALVA_DARK, [0.5, 0.09, 0.5]));
    parts.push(finalizeExport(new THREE.TorusGeometry(0.27, 0.011, 4, 22), GALVA_LIGHT, [0.5, 0.185, 0.5], [Math.PI / 2, 0, 0]));
    // poignées repliées de chaque côté
    for (const sx of [-1, 1]) parts.push(finalizeExport(new THREE.TorusGeometry(0.045, 0.009, 4, 10, Math.PI), GALVA_DARK, [0.5 + sx * 0.285, 0.15, 0.5], [0, sx > 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI]));
    fill = mesh(cyl(0.233, 0.233, 0.012, 22, C.water, [0, 0, 0]), false, false);
    fill.position.set(0.5, 0.06, 0.5);
    base = 0.06;
    height = 0.1;
  } else if (level === 2) {
    // abreuvoir à niveau constant : cuve blanche à poignée sur coupelle rouge, raccordé au réseau
    openTub(parts, 0.36, 0.31, 0.08, 22, 0xd8433a, [0.5, 0.05, 0.5], 0.02, 0xc23a32);
    parts.push(cyl(0.2, 0.22, 0.36, 18, 0xf4f2ec, [0.5, 0.28, 0.5]));
    for (const y of [0.18, 0.32]) parts.push(cyl(0.21, 0.21, 0.012, 18, 0xe2ded4, [0.5, y, 0.5]));
    parts.push(sph(0.2, 16, 8, 0xf4f2ec, [0.5, 0.46, 0.5], [1, 0.45, 1]));
    parts.push(cyl(0.06, 0.06, 0.05, 10, 0xd8433a, [0.5, 0.55, 0.5]));
    wireArc(parts, 0.08, [0.5, 0.56, 0.5], 0xd8433a);
    // graduations de niveau
    for (let i = 0; i < 3; i++) parts.push(box(0.05, 0.008, 0.008, 0x9fb7c8, [0.5, 0.2 + i * 0.06, 0.712]));
    // flotteur et tuyau d'arrivée d'eau
    parts.push(box(0.1, 0.08, 0.08, 0x5b5f66, [0.82, 0.07, 0.62]));
    parts.push(cyl(0.022, 0.022, 0.3, 8, 0x2f3238, [0.95, 0.03, 0.62], [0, 0, Math.PI / 2]));
    fill = mesh(cyl(0.31, 0.31, 0.012, 22, C.water, [0, 0, 0]), false, false);
    fill.position.set(0.5, 0.07, 0.5);
    base = 0.035;
    height = 0.045;
  } else {
    // abreuvoir en long à niveau constant : auge galvanisée sur deux tréteaux, flotteur sous son
    // capot au bout, arrivée d'eau du réseau avec sa vanne ; huit poules y boivent côte à côte
    const L = 1.3;
    const zc = 0.5;
    for (const x of [0.06, 0.94])
      for (const s2 of [-1, 1]) parts.push(box(0.035, 0.2, 0.035, GALVA_DARK, [x, 0.09, zc + s2 * 0.1], [s2 * 0.45, 0, 0]));
    for (const x of [0.06, 0.94]) parts.push(box(0.04, 0.03, 0.34, GALVA_DARK, [x, 0.115, zc]));
    parts.push(box(L, 0.02, 0.3, GALVA_DARK, [0.5, 0.13, zc]));
    for (const s2 of [-1, 1]) {
      parts.push(box(L, 0.11, 0.018, GALVA, [0.5, 0.18, zc + s2 * 0.15]));
      parts.push(cyl(0.013, 0.013, L, 6, GALVA_LIGHT, [0.5, 0.237, zc + s2 * 0.15], [0, 0, Math.PI / 2]));
    }
    for (const ex of [-0.15, 1.15]) parts.push(box(0.018, 0.11, 0.3, GALVA, [ex, 0.18, zc]));
    for (let i = 1; i < 4; i++) parts.push(box(0.012, 0.012, 0.3, GALVA_DARK, [0.5 - L / 2 + (i * L) / 4, 0.243, zc]));
    // capot du flotteur, arrivée d'eau, vanne
    parts.push(box(0.16, 0.08, 0.32, GALVA_DARK, [1.08, 0.27, zc]));
    parts.push(box(0.17, 0.015, 0.33, GALVA_LIGHT, [1.08, 0.315, zc]));
    parts.push(cyl(0.022, 0.022, 0.32, 8, 0x2f3238, [1.24, 0.16, zc]));
    parts.push(cyl(0.022, 0.022, 0.12, 8, 0x2f3238, [1.19, 0.31, zc], [0, 0, Math.PI / 2]));
    parts.push(cyl(0.03, 0.03, 0.05, 8, 0xd9b35a, [1.24, 0.12, zc]));
    parts.push(box(0.08, 0.015, 0.02, 0xd8433a, [1.24, 0.15, zc + 0.04]));
    parts.push(cyl(0.022, 0.022, 0.5, 8, 0x2f3238, [1.24, 0.01, zc + 0.3], [Math.PI / 2, 0, 0]));
    fill = mesh(box(L - 0.04, 0.012, 0.27, C.water, [0, 0, 0]), false, false);
    fill.position.set(0.5, 0.14, zc);
    base = 0.14;
    height = 0.075;
  }
  return { group: groupOf(parts, fill), fill, fillBase: base, fillHeight: height, fillMode: 'move', eggSlots: [], eggMeshes: [], key: `drinker${level}` };
}

function groupOf(parts: THREE.BufferGeometry[], ...extra: THREE.Object3D[]) {
  const g = new THREE.Group();
  g.add(mesh(merge(parts)));
  for (const e of extra) g.add(e);
  return g;
}

function storageModel(level: number): BuildingView {
  // dessinée sur 2 × 2 (3 × 2 pour la plateforme frigorifique), puis agrandie (le groupe
  // extérieur reste libre pour l'animation de pose)
  const outer = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [slab(level === 5 ? 3 : 2, 2, level >= 3 ? 0xd6d8da : 0xe0d4bc)];
  const windows: THREE.Mesh[] = [];
  const spots =
    level === 1 ? storeLarder(parts, windows) : level === 2 ? storeVented(parts, windows) : level === 3 ? storeCold(parts, windows) : level === 4 ? storeWarehouse(parts, windows) : storeColdHub(parts, windows);
  const g = new THREE.Group();
  g.scale.setScalar(STORAGE_SCALE);
  outer.add(g);
  g.add(mesh(merge(parts)));
  for (const w of windows) g.add(w);
  // cageots d'œufs devant la réserve : on en voit plus quand le stock se remplit
  const crateGeo = eggCrate();
  const crates = spots.map(([x, z, y, ry]) => {
    const c = mesh(crateGeo, true, true);
    c.position.set(x, y, z);
    c.rotation.y = ry;
    c.visible = false;
    g.add(c);
    return c;
  });
  return { group: outer, eggSlots: [], eggMeshes: [], crates, key: `storage${level}` };
}

function dustbathModel(level: number): BuildingView {
  const parts: THREE.BufferGeometry[] = [];
  const slots = level === 1 ? 3 : 5;
  if (level === 1) dustbathSleepers(parts, slots);
  else dustbathShelter(parts, slots);
  return { group: groupOf(parts), eggSlots: [], eggMeshes: [], key: `dustbath${level}` };
}

/** Compost : bac de palettes ou composteur à lattes ; le tas de terreau grouillant de vers monte avec le stock. */
function compostModel(level: number): BuildingView {
  const parts: THREE.BufferGeometry[] = [];
  if (level === 1) compostPallets(parts);
  else compostBin(parts);
  const g = new THREE.Group();
  g.add(mesh(merge(parts)));
  const fill = mesh(compostHeap(), true, true);
  fill.position.set(1, 0.04, 1);
  g.add(fill);
  return { group: g, fill, fillBase: 0.04, fillHeight: level === 1 ? 0.5 : 0.62, fillMode: 'heap', eggSlots: [], eggMeshes: [], key: `compost${level}` };
}

function standModel(level: number): BuildingView {
  const parts: THREE.BufferGeometry[] = [];
  const stripe = (x0: number, x1: number, y: number, z0: number, z1: number, tilt: number) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const w = (x1 - x0) / n;
      parts.push(box(w, 0.03, Math.abs(z1 - z0), i % 2 ? C.white : C.blue, [x0 + w * (i + 0.5), y, (z0 + z1) / 2], [tilt, 0, 0]));
    }
  };
  parts.push(box(2.2, 0.04, 1.2, 0xe6dccb, [1, 0.02, 0.55]));
  if (level === 1) {
    parts.push(box(1.7, 0.07, 0.62, C.wood, [1, 0.72, 0.6]));
    for (const x of [0.25, 1.75]) for (const z of [0.35, 0.85]) parts.push(box(0.06, 0.72, 0.06, C.woodDark, [x, 0.36, z]));
    for (const x of [0.15, 1.85]) parts.push(box(0.05, 1.45, 0.05, C.woodDark, [x, 0.72, 0.2]));
    stripe(0.1, 1.9, 1.38, 0.15, 0.95, 0.28);
    for (const [x, z] of [
      [0.6, 0.6],
      [1.0, 0.55],
      [1.4, 0.62],
    ]) {
      parts.push(box(0.32, 0.08, 0.2, 0xd9c7a4, [x, 0.8, z]));
      for (let k = 0; k < 3; k++) parts.push(sph(0.035, 5, 4, k === 1 ? 0xc98a55 : 0xf3ece0, [x - 0.08 + k * 0.08, 0.86, z]));
    }
    parts.push(box(0.45, 0.55, 0.04, 0x37443b, [-0.25, 0.42, 1.0], [-0.15, 0.3, 0]));
    parts.push(box(0.5, 0.6, 0.02, C.woodDark, [-0.25, 0.42, 0.97], [-0.15, 0.3, 0]));
  } else if (level === 2) {
    parts.push(box(1.9, 1.3, 0.12, C.wood, [1, 0.65, 0.12]));
    parts.push(box(0.12, 1.3, 0.8, C.wood, [0.08, 0.65, 0.5]));
    parts.push(box(0.12, 1.3, 0.8, C.wood, [1.92, 0.65, 0.5]));
    parts.push(box(1.9, 0.75, 0.25, C.woodLight, [1, 0.38, 0.8]));
    parts.push(box(2.0, 0.07, 0.35, C.woodDark, [1, 0.78, 0.82]));
    parts.push(box(2.1, 0.1, 1.05, C.roof, [1, 1.4, 0.5], [0.12, 0, 0]));
    stripe(0, 2.0, 1.25, 0.95, 1.3, 0.55);
    for (let i = 0; i < 4; i++) {
      parts.push(box(0.3, 0.08, 0.2, 0xd9c7a4, [0.4 + i * 0.4, 0.86, 0.8]));
      parts.push(sph(0.04, 5, 4, i % 2 ? 0xc98a55 : 0xf3ece0, [0.4 + i * 0.4, 0.93, 0.8]));
    }
  } else {
    parts.push(box(2.1, 1.5, 0.9, 0xf6efe2, [1, 0.75, 0.45]));
    parts.push(box(2.14, 0.1, 0.94, C.woodDark, [1, 0.05, 0.45]));
    parts.push(prism(2.3, 0.55, 1.15, 0xc96a4a, [1, 1.5, 0.45]));
    parts.push(box(1.0, 0.75, 0.04, 0x9fd4f5, [0.65, 0.75, 0.915]));
    parts.push(box(1.08, 0.83, 0.03, C.woodDark, [0.65, 0.75, 0.905]));
    parts.push(box(0.42, 0.95, 0.05, C.blue, [1.6, 0.5, 0.92]));
    stripe(0.1, 1.95, 1.3, 0.92, 1.35, 0.5);
    parts.push(box(1.3, 0.3, 0.06, C.blue, [1, 2.05, 0.45]));
    parts.push(box(1.36, 0.36, 0.04, C.white, [1, 2.05, 0.42]));
    for (const x of [-0.2, 2.2]) parts.push(ico(0.25, 0, C.leaf, [x, 0.25, 0.85]));
  }
  return { group: groupOf(parts), eggSlots: [], eggMeshes: [], key: `stand${level}` };
}

// Couveuse : coque blanche sur un établi, couvercle transparent, lampe chauffante ;
// les œufs en incubation sont visibles sur la grille (eggSlots).
const INC_GLASS = new THREE.MeshLambertMaterial({ color: 0xe4f3fb, transparent: true, opacity: 0.28, depthWrite: false });
export const INC_LAMP = new THREE.MeshBasicMaterial({ color: 0xffb25a });

function incubatorModel(level: number): BuildingView {
  const parts: THREE.BufferGeometry[] = [slab(2, 1, 0xe2d3b5)];
  const extra: THREE.Object3D[] = [];
  // établi en bois avec étagère basse
  const top = 0.42;
  parts.push(box(1.84, 0.06, 0.8, C.wood, [1, top - 0.03, 0.5]));
  for (const x of [0.16, 1.84]) for (const z of [0.18, 0.82]) parts.push(box(0.07, top - 0.06, 0.07, C.woodDark, [x, (top - 0.06) / 2, z]));
  parts.push(box(1.7, 0.04, 0.62, C.woodDark, [1, 0.12, 0.5]));
  parts.push(box(0.34, 0.16, 0.24, 0xd8c08a, [0.45, 0.22, 0.5])); // sac de copeaux
  parts.push(cyl(0.07, 0.07, 0.14, 10, 0x7cc7ee, [1.55, 0.21, 0.5])); // bidon d'eau (humidité)
  const W = level === 1 ? 1.1 : 1.5;
  const D = level === 1 ? 0.58 : 0.66;
  const cols = level === 1 ? 4 : 6;
  const rows = level === 1 ? 3 : 4;
  const units = level === 3 ? 2 : 1;
  const H = 0.22;
  const slots: THREE.Vector3[] = [];
  let y0 = top;
  for (let u = 0; u < units; u++) {
    const last = u === units - 1;
    parts.push(box(W + 0.03, 0.03, D + 0.03, 0xc9cdd3, [1, y0 + 0.015, 0.5]));
    parts.push(box(W, H, D, 0xf5f2ec, [1, y0 + H / 2 + 0.02, 0.5]));
    // façade : afficheur de température, bouton, grille d'aération
    const fz = 0.5 + D / 2 + 0.006;
    parts.push(box(0.26, 0.1, 0.02, 0x23262d, [1 - W / 2 + 0.24, y0 + 0.13, fz]));
    parts.push(box(0.15, 0.04, 0.022, 0xff8a3d, [1 - W / 2 + 0.22, y0 + 0.13, fz + 0.002]));
    parts.push(cyl(0.035, 0.035, 0.03, 10, 0x8e939b, [1 - W / 2 + 0.45, y0 + 0.13, fz], [Math.PI / 2, 0, 0]));
    for (let k = 0; k < 4; k++) parts.push(box(0.18, 0.012, 0.02, 0xd4d7dc, [1 + W / 2 - 0.2, y0 + 0.08 + k * 0.035, fz]));
    y0 += H + 0.02;
    if (!last) {
      parts.push(box(W, 0.03, D, 0xe8e4dc, [1, y0 + 0.015, 0.5]));
      y0 += 0.03;
      continue;
    }
    // grille porte-œufs et rebord du couvercle
    parts.push(box(W - 0.1, 0.015, D - 0.1, 0xcdbf98, [1, y0 + 0.008, 0.5]));
    for (const [w, d, x, z] of [
      [W, 0.04, 1, 0.5 - D / 2 + 0.02],
      [W, 0.04, 1, 0.5 + D / 2 - 0.02],
      [0.04, D, 1 - W / 2 + 0.02, 0.5],
      [0.04, D, 1 + W / 2 - 0.02, 0.5],
    ] as const)
      parts.push(box(w, 0.03, d, 0xe8e4dc, [x, y0 + 0.015, z]));
    const glass = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.13, D - 0.06), INC_GLASS);
    glass.position.set(1, y0 + 0.08, 0.5);
    glass.renderOrder = 4;
    // lampe chauffante (lueur orangée sous le couvercle)
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(W * 0.55, 0.018, 0.05), INC_LAMP);
    lamp.position.set(1, y0 + 0.135, 0.5);
    extra.push(glass, lamp);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        slots.push(new THREE.Vector3(1 - (W - 0.22) / 2 + ((W - 0.22) * c) / (cols - 1), y0 + 0.016, 0.5 - (D - 0.2) / 2 + ((D - 0.2) * r) / (rows - 1)));
  }
  return { group: groupOf(parts, ...extra), eggSlots: slots, eggMeshes: [], key: `incubator${level}` };
}

const POND_WATER = new THREE.MeshLambertMaterial({ color: 0x7fc0e2 });

/** Mare : berge de terre et de galets, roseaux, nénuphars ; l'eau monte et baisse avec le niveau. */
function pondModel(level: number): BuildingView {
  const big = level >= 2;
  const parts: THREE.BufferGeometry[] = [];
  const cx = 1.5;
  const cz = 1.5;
  const rx = big ? 1.4 : 1.32;
  const rz = big ? 1.36 : 1.26;
  // berge : un anneau de terre claire qui ne recouvre jamais l'eau (sinon les deux surfaces se
  // disputent l'affichage et scintillent), fond vaseux bien plus bas que la surface de l'eau
  const bank = new THREE.RingGeometry(1, 1 + 0.16 / rx, 32, 1);
  bank.rotateX(-Math.PI / 2);
  parts.push(finalizeExport(bank, 0xcdbd93, [cx, 0.062, cz], [0, 0, 0], [rx - 0.02, 1, rz - 0.02]));
  parts.push(finalizeExport(new THREE.CylinderGeometry(1 + 0.16 / rx, 1 + 0.34 / rx, 0.062, 32, 1, true), 0xc2b088, [cx, 0.031, cz], [0, 0, 0], [rx - 0.02, 1, rz - 0.02]));
  parts.push(cyl(1, 1, 0.012, 32, 0x4f6f5c, [cx, 0.006, cz], [0, 0, 0], [rx - 0.06, 1, rz - 0.06]));
  // galets et touffes de roseaux tout autour
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.sin(i * 7.1) * 0.12;
    const x = cx + Math.cos(a) * (rx + 0.05);
    const z = cz + Math.sin(a) * (rz + 0.05);
    if (i % 3 === 0) parts.push(ico(0.1 + (i % 4) * 0.02, 0, 0xb9b2a2, [x, 0.07, z], [1, 0.6, 1]));
    else if (i % 3 === 1 && Math.sin(a) < 0.3)
      for (let k = 0; k < 3; k++) parts.push(cyl(0.012, 0.016, 0.38 + k * 0.08, 3, 0x6f9d4a, [x + (k - 1) * 0.06, 0.24 + k * 0.04, z], [0.12 * (k - 1), 0, 0.1]));
  }
  // massettes (quenouilles brunes) d'un côté
  for (let k = 0; k < 4; k++) {
    const x = cx - rx + 0.15 + k * 0.08;
    const z = cz - rz * 0.4 + k * 0.1;
    parts.push(cyl(0.012, 0.014, 0.6, 3, 0x6f9d4a, [x, 0.35, z]));
    parts.push(cyl(0.03, 0.03, 0.12, 5, 0x7a5236, [x, 0.66, z]));
  }
  if (big) {
    // petit ponton de bois
    parts.push(box(0.5, 0.05, 0.9, C.wood, [cx + 0.95, 0.14, cz + 0.55], [0, 0.5, 0]));
    for (const [dx, dz] of [[0.75, 0.3], [1.05, 0.85]] as const) parts.push(cyl(0.035, 0.035, 0.25, 5, C.woodDark, [cx + dx, 0.07, cz + dz]));
  }
  // l'eau (monte et baisse avec le niveau), nénuphars posés dessus
  const water = new THREE.Group();
  const surf = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.02, 26), POND_WATER);
  surf.scale.set(rx - 0.04, 1, rz - 0.04);
  surf.receiveShadow = true;
  water.add(surf);
  const lilies: THREE.BufferGeometry[] = [];
  for (let i = 0; i < (big ? 6 : 4); i++) {
    const a = i * 2.4;
    const r = 0.35 + (i % 3) * 0.22;
    lilies.push(cyl(0.11, 0.11, 0.012, 8, 0x5fa35a, [Math.cos(a) * r, 0.015, Math.sin(a) * r * 0.9]));
    if (i % 2 === 0) lilies.push(ico(0.035, 0, i % 4 ? 0xf6f0f4 : 0xf2a7c0, [Math.cos(a) * r, 0.04, Math.sin(a) * r * 0.9]));
  }
  if (big) {
    // deux canards
    for (const [dx, dz, ry] of [[-0.4, 0.2, 0.6], [0.1, -0.45, 2.4]] as const) {
      const duck = mesh(
        merge([
          sph(0.11, 8, 6, 0xf4f1ea, [0, 0.06, 0], [0.9, 0.65, 1.35]),
          sph(0.065, 7, 5, 0x2f7a4a, [0, 0.18, 0.11]),
          box(0.045, 0.018, 0.07, 0xf0a33a, [0, 0.165, 0.18]),
        ]),
        true,
        false,
      );
      duck.position.set(dx, 0, dz);
      duck.rotation.y = ry;
      water.add(duck);
    }
  }
  water.add(mesh(merge(lilies), false, false));
  water.position.set(cx, 0.08, cz);
  return { group: groupOf(parts, water), fill: water, fillBase: 0.045, fillHeight: 0.05, fillMode: 'move', eggSlots: [], eggMeshes: [], key: `pond${level}` };
}

/** Arbre d'ombrage : un beau feuillu au houppier large, racines apparentes. */
function shadeTreeModel(): BuildingView {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(cyl(0.11, 0.17, 1.35, 7, C.trunk, [0.5, 0.67, 0.5]));
  for (const a of [0.3, 2.4, 4.4]) parts.push(cyl(0.03, 0.07, 0.4, 5, C.trunk, [0.5 + Math.cos(a) * 0.14, 0.08, 0.5 + Math.sin(a) * 0.14], [Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1]));
  parts.push(cyl(0.035, 0.05, 0.6, 5, C.trunk, [0.62, 1.35, 0.5], [0, 0, -0.7]));
  parts.push(ico(0.78, 1, 0x8fc56f, [0.5, 1.95, 0.5], [1.1, 0.85, 1.1]));
  parts.push(ico(0.52, 1, C.leafDark, [0.95, 1.72, 0.62], [1, 0.85, 1]));
  parts.push(ico(0.5, 1, 0xa8d68a, [0.12, 1.8, 0.35], [1, 0.85, 1]));
  parts.push(ico(0.44, 1, C.leaf, [0.55, 2.38, 0.3], [1, 0.85, 1]));
  // ombre portée au sol, plus fraîche (herbe plus verte au pied)
  parts.push(cyl(0.95, 0.95, 0.012, 18, 0x86b862, [0.5, 0.034, 0.55]));
  return { group: groupOf(parts), eggSlots: [], eggMeshes: [], key: 'tree1' };
}

export function buildingModel(type: BuildingType, level: number): BuildingView {
  switch (type) {
    case 'pond':
      return pondModel(level);
    case 'tree':
      return shadeTreeModel();
    case 'coop':
      return coopModel(level);
    case 'goosehouse':
      return gooseHouseModel(level);
    case 'nest':
      return nestModel(level);
    case 'feeder':
      return feederModel(level);
    case 'drinker':
      return drinkerModel(level);
    case 'storage':
      return storageModel(level);
    case 'dustbath':
      return dustbathModel(level);
    case 'stand':
      return standModel(level);
    case 'compost':
      return compostModel(level);
    case 'incubator':
      return incubatorModel(level);
  }
}

// ================================================================= DÉCOR ====
export function treeGeometry(variant: number) {
  const parts: THREE.BufferGeometry[] = [];
  const s = 0.85 + (variant % 3) * 0.18;
  parts.push(cyl(0.06 * s, 0.09 * s, 0.9 * s, 6, C.trunk, [0, 0.45 * s, 0]));
  const leaf = variant % 2 ? C.leaf : 0xa8d68a;
  parts.push(ico(0.55 * s, 1, leaf, [0, 1.2 * s, 0]));
  if (variant % 3 === 0) parts.push(ico(0.36 * s, 1, C.leafDark, [0.28 * s, 0.98 * s, 0.12 * s]));
  return merge(parts);
}

export function pineGeometry() {
  return merge([
    cyl(0.07, 0.09, 0.5, 6, C.trunk, [0, 0.25, 0]),
    cone(0.5, 0.9, 7, 0x7fb874, [0, 0.85, 0]),
    cone(0.38, 0.7, 7, 0x8cc47f, [0, 1.3, 0]),
  ]);
}

export function bushGeometry() {
  return merge([ico(0.32, 1, C.leafDark, [0, 0.22, 0], [1.2, 0.8, 1]), ico(0.22, 1, C.leaf, [0.2, 0.2, 0.1])]);
}

/**
 * Bouquet de fleurs des champs : une pâquerette, un bouton d'or et un trèfle en fleur, avec leurs
 * feuilles. (Les variantes viennent de la rotation et de l'échelle de chaque instance.)
 */
export function flowerGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  // pâquerette : pétales blancs en étoile, cœur jaune
  parts.push(cyl(0.006, 0.008, 0.16, 3, 0x5f9c45, [0, 0.08, 0]));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(box(0.045, 0.006, 0.016, 0xfbfaf6, [Math.cos(a) * 0.026, 0.162, Math.sin(a) * 0.026], [0, -a, 0.2]));
  }
  parts.push(ico(0.014, 0, 0xf4c43a, [0, 0.168, 0]));
  // bouton d'or : petite coupe jaune brillant
  parts.push(cyl(0.005, 0.007, 0.12, 3, 0x5f9c45, [0.07, 0.06, 0.03], [0, 0, -0.15]));
  parts.push(cone(0.022, 0.03, 6, 0xf2cf2b, [0.087, 0.13, 0.03], [Math.PI, 0, 0]));
  parts.push(ico(0.008, 0, 0xe8a91f, [0.087, 0.13, 0.03]));
  // trèfle : tête rose-mauve et feuilles en trois folioles
  parts.push(cyl(0.005, 0.007, 0.09, 3, 0x5f9c45, [-0.05, 0.045, 0.05], [0.1, 0, 0.12]));
  parts.push(ico(0.022, 1, 0xc9709c, [-0.056, 0.098, 0.055], [1, 1.15, 1]));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    parts.push(cyl(0.018, 0.018, 0.004, 6, 0x4f8f3a, [-0.03 + Math.cos(a) * 0.02, 0.035, 0.08 + Math.sin(a) * 0.02]));
  }
  // feuilles de la pâquerette au ras du sol
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.7;
    parts.push(box(0.05, 0.004, 0.018, 0x568f3c, [Math.cos(a) * 0.03, 0.016, Math.sin(a) * 0.03], [0, -a, 0]));
  }
  return merge(parts);
}

/**
 * Touffe d'herbe : neuf brins fins, effilés et recourbés vers l'extérieur, du vert sombre à la base
 * au vert tendre à la pointe. Chaque triangle existe dans les deux sens, avec des normales tournées
 * vers le ciel : la touffe reste lumineuse sous tous les angles, sans face sombre.
 */
export function tuftGeometry() {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const base = new THREE.Color(0x4a8732);
  const mid = new THREE.Color(0x79b84a);
  const tip = new THREE.Color(0xc4df7c);
  const c = new THREE.Color();
  const blades = 9;
  const seg = 3;
  const push = (p: THREE.Vector3, t: number) => {
    pos.push(p.x, p.y, p.z);
    // normale « ciel » légèrement penchée côté brin
    nor.push(0.18, 0.96, 0.18);
    if (t < 0.5) c.copy(base).lerp(mid, t * 2);
    else c.copy(mid).lerp(tip, (t - 0.5) * 2);
    col.push(c.r, c.g, c.b);
  };
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + Math.sin(b * 12.9) * 0.6;
    const r0 = 0.012 + (b % 3) * 0.012;
    const ox = Math.cos(a) * r0;
    const oz = Math.sin(a) * r0;
    const h = 0.13 + (((b * 37) % 10) / 10) * 0.14;
    const w = 0.024 + ((b * 17) % 5) * 0.003;
    const lean = 0.25 + (((b * 53) % 10) / 10) * 0.45;
    const face = a + Math.PI / 2 + Math.sin(b * 3.1) * 0.5;
    const fx = Math.cos(face);
    const fz = Math.sin(face);
    const rows: Array<[THREE.Vector3, THREE.Vector3, number]> = [];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg;
      const out = lean * h * t * t;
      const cx = ox + Math.cos(a) * out;
      const cz = oz + Math.sin(a) * out;
      const y = h * t * (1 - 0.12 * t * t);
      const half = (w / 2) * Math.pow(1 - t, 0.8);
      rows.push([new THREE.Vector3(cx - fx * half, y, cz - fz * half), new THREE.Vector3(cx + fx * half, y, cz + fz * half), t]);
    }
    for (let k = 0; k < seg; k++) {
      const [l0, r0p, t0] = rows[k];
      const [l1, r1p, t1] = rows[k + 1];
      const tris: Array<Array<[THREE.Vector3, number]>> = [
        [[l0, t0], [r0p, t0], [l1, t1]],
        [[r0p, t0], [r1p, t1], [l1, t1]],
      ];
      for (const tri of tris) {
        for (const [p, t] of tri) push(p, t);
        for (const [p, t] of [tri[0], tri[2], tri[1]]) push(p, t);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * Tapis de prairie pour une case (un peu plus large qu'elle, pour se fondre dans les voisines) :
 * des dizaines de brins répartis régulièrement, de hauteurs, d'inclinaisons et de verts variés,
 * sombres à la base (l'ombre au pied de l'herbe), clairs et dorés à la pointe.
 * wild : herbes folles des prés à vendre, plus hautes, plus clairsemées et plus blondes.
 */
export function grassPatchGeometry(wild = false, seed = 1, dense = true) {
  const rnd = (k: number) => {
    const x = Math.sin(seed * 91.17 + k * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const grid = wild ? (dense ? 4 : 3) : dense ? 7 : 4;
  const span = 1.16;
  const base = new THREE.Color(wild ? 0x56903a : 0x4a8a2e);
  const mid = new THREE.Color(wild ? 0x86bd50 : 0x72bb45);
  const tips = [0xb2df6a, 0x9bd65a, 0xc8e97c, 0xd6e88a, 0x8fd04f].map((c) => new THREE.Color(c));
  const wildTips = [0xbfdc78, 0xc9d97e, 0xd6dd8e, 0xa9d266].map((c) => new THREE.Color(c));
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const tipC = new THREE.Color();
  const push = (p: THREE.Vector3, t: number, shade: number) => {
    pos.push(p.x, p.y, p.z);
    nor.push(0.15, 0.97, 0.15);
    if (t < 0.45) c.copy(base).lerp(mid, t / 0.45);
    else c.copy(mid).lerp(tipC, (t - 0.45) / 0.55);
    c.multiplyScalar(shade);
    col.push(c.r, c.g, c.b);
  };
  let k = 0;
  for (let gx = 0; gx < grid; gx++)
    for (let gz = 0; gz < grid; gz++) {
      const per = 1;
      for (let n = 0; n < per; n++, k++) {
        const bx = -span / 2 + ((gx + rnd(k * 3 + 1)) / grid) * span;
        const bz = -span / 2 + ((gz + rnd(k * 3 + 2)) / grid) * span;
        // quelques brins bien plus hauts donnent du relief à la prairie
        const h = wild ? 0.16 + rnd(k * 5) * 0.2 : 0.12 + rnd(k * 5) * 0.12 + (rnd(k * 7) < 0.16 ? 0.1 : 0);
        const w = (wild ? 0.03 : dense ? 0.03 : 0.045) + rnd(k * 11) * 0.012;
        const lean = 0.15 + rnd(k * 13) * 0.55;
        const dir = rnd(k * 17) * Math.PI * 2;
        const face = dir + Math.PI / 2 + (rnd(k * 19) - 0.5) * 0.8;
        const fx = Math.cos(face);
        const fz = Math.sin(face);
        tipC.copy((wild ? wildTips : tips)[Math.floor(rnd(k * 23) * (wild ? 4 : 5))]);
        const shade = 0.88 + rnd(k * 29) * 0.22;
        // brin en deux segments qui se courbe dans sa direction
        const rows: Array<[THREE.Vector3, THREE.Vector3, number]> = [];
        for (let r = 0; r <= 2; r++) {
          const t = r / 2;
          const out = lean * h * t * t;
          const cx = bx + Math.cos(dir) * out;
          const cz = bz + Math.sin(dir) * out;
          const y = h * t * (1 - 0.15 * t * t);
          const half = r === 2 ? 0 : (w / 2) * (r === 0 ? 1 : 0.62);
          rows.push([v.set(cx - fx * half, y, cz - fz * half).clone(), new THREE.Vector3(cx + fx * half, y, cz + fz * half), t]);
        }
        const tris: Array<Array<[THREE.Vector3, number]>> = [
          [[rows[0][0], rows[0][2]], [rows[0][1], rows[0][2]], [rows[1][0], rows[1][2]]],
          [[rows[0][1], rows[0][2]], [rows[1][1], rows[1][2]], [rows[1][0], rows[1][2]]],
          [[rows[1][0], rows[1][2]], [rows[1][1], rows[1][2]], [rows[2][0], rows[2][2]]],
        ];
        for (const tri of tris) for (const [p, t] of tri) push(p, t, shade);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

export function farmhouse() {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(box(5.4, 0.08, 4.4, 0xe6dccb, [2.7, 0.04, 2.2]));
  parts.push(box(4.2, 2.0, 3.0, 0xf6ead6, [2.4, 1.05, 1.8]));
  parts.push(box(4.26, 0.16, 3.06, 0xb98d66, [2.4, 0.08, 1.8]));
  parts.push(prism(4.7, 1.4, 3.5, 0xc96a4a, [2.4, 2.05, 1.8]));
  parts.push(box(4.8, 0.08, 0.1, 0xa4523a, [2.4, 3.45, 1.8]));
  parts.push(box(0.4, 0.9, 0.4, 0xd9cfc2, [3.5, 3.0, 1.2]));
  parts.push(box(0.7, 1.25, 0.06, C.blue, [2.4, 0.7, 3.32]));
  parts.push(box(0.8, 1.35, 0.04, C.white, [2.4, 0.72, 3.3]));
  parts.push(box(1.8, 0.08, 1.0, C.woodLight, [2.4, 0.08, 3.8]));
  for (const x of [1.6, 3.2]) parts.push(box(0.08, 1.6, 0.08, C.woodDark, [x, 0.85, 4.25]));
  parts.push(box(1.9, 0.07, 1.2, C.roof, [2.4, 1.65, 3.85], [0.25, 0, 0]));
  for (const x of [1.0, 3.8]) {
    parts.push(box(0.75, 0.65, 0.05, C.white, [x, 1.2, 3.3]));
    parts.push(box(0.75, 0.14, 0.18, 0x9b6b47, [x, 0.82, 3.38]));
    parts.push(ico(0.08, 0, 0xe85d75, [x - 0.2, 0.92, 3.4]));
    parts.push(ico(0.08, 0, 0xf5c542, [x + 0.15, 0.92, 3.42]));
  }
  const g = new THREE.Group();
  g.add(mesh(merge(parts)));
  for (const x of [1.0, 3.8]) g.add(windowPane(0.6, 0.5, [x, 1.2, 3.33]));
  g.add(windowPane(0.6, 0.5, [0.25, 1.3, 1.8], Math.PI / 2));
  return g;
}

export function forSaleSign() {
  return merge([
    box(0.08, 0.8, 0.08, C.woodDark, [0, 0.4, 0]),
    box(0.7, 0.4, 0.05, C.white, [0, 0.75, 0.05]),
    box(0.62, 0.1, 0.02, C.blue, [0, 0.82, 0.085]),
  ]);
}

export function mailbox() {
  return merge([box(0.06, 0.8, 0.06, C.woodDark, [0, 0.4, 0]), box(0.3, 0.22, 0.4, C.blue, [0, 0.9, 0]), box(0.04, 0.16, 0.02, C.red, [0.17, 1.0, 0.1])]);
}

export function bench() {
  return merge([
    box(1.0, 0.06, 0.35, C.wood, [0, 0.4, 0]),
    box(1.0, 0.25, 0.05, C.wood, [0, 0.62, -0.16]),
    box(0.06, 0.4, 0.3, C.greyDark, [-0.42, 0.2, 0]),
    box(0.06, 0.4, 0.3, C.greyDark, [0.42, 0.2, 0]),
  ]);
}

export function hayBale() {
  return merge([box(0.9, 0.45, 0.55, C.straw, [0, 0.225, 0]), box(0.92, 0.04, 0.57, 0xd8b85a, [0, 0.3, 0]), box(0.92, 0.04, 0.57, 0xd8b85a, [0, 0.15, 0])]);
}

export function tractor() {
  return merge([
    box(1.2, 0.5, 0.8, C.red, [0, 0.55, 0]),
    box(0.6, 0.6, 0.75, C.red, [-0.35, 1.05, 0]),
    box(0.55, 0.45, 0.7, C.glass, [-0.35, 1.08, 0]),
    cyl(0.38, 0.38, 0.22, 10, C.black, [-0.4, 0.38, 0.46], [Math.PI / 2, 0, 0]),
    cyl(0.38, 0.38, 0.22, 10, C.black, [-0.4, 0.38, -0.46], [Math.PI / 2, 0, 0]),
    cyl(0.24, 0.24, 0.18, 10, C.black, [0.45, 0.24, 0.42], [Math.PI / 2, 0, 0]),
    cyl(0.24, 0.24, 0.18, 10, C.black, [0.45, 0.24, -0.42], [Math.PI / 2, 0, 0]),
    cyl(0.04, 0.04, 0.5, 6, C.greyDark, [0.3, 1.0, 0.2]),
  ]);
}

// ================================================================ CLIENTS ====
const SHIRT = [0x2f6bff, 0xf0a33a, 0x5aa36b, 0xe85d75, 0x8a6fd1, 0x3bb2c9, 0xf2f2f2, 0xd9534f];
const PANTS = [0x3d4a63, 0x5b5f66, 0x6b4a2f, 0x2f3b4f];

export interface PersonView {
  root: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  basket: THREE.Mesh;
}

const personCache = new Map<number, { body: THREE.BufferGeometry; leg: THREE.BufferGeometry }>();
/** Les passants sont un peu plus petits que les salariés (même corps, à l'échelle 0,83). */
const PERSON_K = 0.35 / 0.42;
const SHOES = [0x2b2b31, 0x6b4a2f, 0xe9e6df, 0x3d4a63, 0x8a5a30];
const JACKETS = [0x3d4a63, 0x6b5a48, 0x2f3b4f, 0x7a2f35, 0x4a5d3f];
export function createPerson(look: number): PersonView {
  const key = look % 64;
  let g = personCache.get(key);
  if (!g) {
    const l = lookOf(key * 37 + 11);
    const fem = l.style === 'ponytail' || l.style === 'bun' || l.style === 'long' || l.style === 'pixie';
    const o: Outfit = { shirt: SHIRT[(key >> 1) % SHIRT.length], pants: PANTS[(key >> 3) % PANTS.length], shoes: SHOES[key % SHOES.length], check: key % 9 === 4 };
    const jacket = key % 5 === 2 ? JACKETS[(key >> 2) % JACKETS.length] : null;
    const skirt = fem && key % 3 === 0;
    const parts: THREE.BufferGeometry[] = torsoParts(jacket ? { ...o, shirt: jacket } : o, l.skin, { belt: !skirt && key % 4 === 1 ? 0x3b2f2a : undefined, collar: jacket ? o.shirt : undefined });
    if (jacket) {
      // veste ouverte sur la chemise
      parts.push(box(0.06, 0.3, 0.012, o.shirt, [0, 0.25, 0.1]));
      parts.push(cyl(0.15, 0.15, 0.1, 12, jacket, [0, 0.07, 0], undefined, [1, 1, 0.76]));
    }
    if (skirt) parts.push(cyl(0.135, 0.18, 0.26, 12, o.pants, [0, -0.09, 0], undefined, [1, 1, 0.8]));
    // sac à l'épaule pour certains
    if (key % 7 === 3) {
      parts.push(strip([0.12, 0.4, 0.02], [-0.13, 0.08, 0.02], 0.02, 0.012, 0x6b4a2f));
      parts.push(box(0.05, 0.13, 0.16, 0x8a5a30, [-0.15, 0.06, 0.0]));
    }
    for (const q of parts) q.translate(0, 0.42, 0);
    const head = headParts(l);
    for (const q of head) q.translate(0, 0.97, 0);
    parts.push(...head);
    const arm = armParts(jacket ? { ...o, shirt: jacket } : o, l.skin);
    for (const sx of [1, -1]) {
      const geo = merge(arm.map((q) => q.clone()));
      geo.rotateZ(sx * 0.07);
      geo.translate(sx * 0.17 * l.build, 0.81, 0);
      parts.push(geo);
    }
    for (const q of arm) q.dispose();
    const body = merge(parts).scale(PERSON_K, PERSON_K, PERSON_K);
    const leg = merge(legParts({ ...o, pants: skirt ? l.skin : o.pants })).scale(PERSON_K, PERSON_K, PERSON_K);
    g = { body, leg };
    personCache.set(key, g);
  }
  const root = new THREE.Group();
  root.add(mesh(g.body, true, false, CREATURE_MAT));
  const legL = mesh(g.leg, false, false, CREATURE_MAT);
  const legR = mesh(g.leg, false, false, CREATURE_MAT);
  legL.position.set(0.07 * PERSON_K, 0.35, 0);
  legR.position.set(-0.07 * PERSON_K, 0.35, 0);
  root.add(legL, legR);
  const basket = mesh(merge([box(0.2, 0.12, 0.14, 0xb07a45, [0, 0, 0]), box(0.18, 0.03, 0.12, 0xf3e8d3, [0, 0.07, 0])]), false, false, CREATURE_MAT);
  basket.position.set(0.22, 0.42, 0.06);
  basket.visible = false;
  root.add(basket);
  return { root, legL, legR, basket };
}

export { MAT };

const shadeHex = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

// ============================================================== SALARIÉS ====
export interface WorkerView {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  tools: Record<'basket' | 'broom' | 'can' | 'bucket' | 'sack' | 'kit' | 'lantern' | 'rifle', THREE.Object3D>;
  /** Bout du canon du fusil (éclair de tir). */
  muzzle: THREE.Object3D;
  /** Bas de la gerbe du balai (poussière soulevée). */
  broomTip: THREE.Object3D;
  glow: THREE.Mesh;
  phase: number;
}


// Les salariés sont toujours visibles : là où un bâtiment, un arbre ou une clôture les cache,
// une silhouette bleutée est dessinée (pochoir : jamais par-dessus leurs propres parties visibles).
const WORKER_MAT = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
});
const XRAY_MAT = new THREE.MeshBasicMaterial({
  color: 0x2f6bff,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  depthFunc: THREE.GreaterDepth,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.NotEqualStencilFunc,
  stencilFail: THREE.KeepStencilOp,
  stencilZFail: THREE.KeepStencilOp,
  stencilZPass: THREE.KeepStencilOp,
});
export const LANTERN_MAT = new THREE.MeshBasicMaterial({ color: 0xffd36b });
/** Flaque de lumière de la lanterne : dégradé chaud, décroissance douce (pas de disque net). */
function lanternTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  // décroissance proche de l'inverse du carré, adoucie vers le bord
  const stops: Array<[number, number]> = [[0, 1], [0.12, 0.78], [0.25, 0.5], [0.4, 0.27], [0.55, 0.13], [0.72, 0.05], [0.88, 0.015], [1, 0]];
  for (const [o, a] of stops) g.addColorStop(o, `rgba(255, ${Math.round(196 + 40 * a)}, ${Math.round(120 + 60 * a)}, ${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const LANTERN_GLOW = new THREE.MeshBasicMaterial({
  map: typeof document !== 'undefined' ? lanternTexture() : null,
  color: 0xffffff,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});
/** Petit halo autour de la flamme elle-même. */
export const LANTERN_HALO = new THREE.SpriteMaterial({
  map: LANTERN_GLOW.map,
  color: 0xffd9a0,
  transparent: true,
  opacity: 0.7,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

function part(geo: THREE.BufferGeometry, cast = true, xray = false) {
  const m = new THREE.Mesh(geo, WORKER_MAT);
  m.castShadow = cast;
  m.receiveShadow = false;
  // dessinés après le décor pour que le pochoir ne garde que leurs parties réellement visibles
  m.renderOrder = 3;
  if (xray) {
    const x = new THREE.Mesh(geo, XRAY_MAT);
    x.renderOrder = 6;
    m.add(x);
  }
  return m;
}

export function createWorkerView(
  role: 'farmhand' | 'seller' | 'caretaker' | 'gardener',
  outfit: { shirt: number; pants: number; hat: number | null; apron?: number },
  look: number,
  fem?: boolean,
): WorkerView {
  const l = lookOf(look, fem);
  const skin = l.skin;
  const root = new THREE.Group();
  // tenue de métier : chemise à carreaux et salopette en bottes ; chemise et tablier en baskets ;
  // blouse blanche, pyjama de soin et sabots ; chemise, tablier de toile, gants et bottes
  const wear: Outfit = {
    farmhand: { shirt: outfit.shirt, pants: outfit.pants, shoes: 0x3d5a3a, rolled: true, boots: true, check: true },
    seller: { shirt: outfit.shirt, pants: outfit.pants, shoes: 0xe9e6df },
    caretaker: { shirt: outfit.shirt, pants: outfit.pants, shoes: 0xf2f2f2 },
    gardener: { shirt: outfit.shirt, pants: outfit.pants, shoes: 0x6b4a2f, rolled: true, boots: true, gloves: 0xc9a46a },
  }[role];
  // jambes (pivot à la hanche)
  const legGeo = merge(legParts(wear));
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(0.07, 0.42, 0);
  legR.position.set(-0.07, 0.42, 0);
  legL.add(part(legGeo, false));
  legR.add(part(legGeo, false));
  if (role === 'gardener') {
    // genouillères
    const pad = merge([box(0.075, 0.075, 0.03, 0x4a4f57, [0, -0.2, 0.05])]);
    legL.add(part(pad, false));
    legR.add(part(pad.clone(), false));
  }
  // buste (pivot à la hanche, pour se pencher)
  const torso = new THREE.Group();
  torso.position.y = 0.42;
  const tp = torsoParts(wear, skin, { belt: role === 'seller' || role === 'gardener' ? 0x3b2f2a : undefined, collar: role === 'caretaker' ? outfit.pants : undefined });
  if (role === 'farmhand') {
    // salopette en toile : haut de pantalon, bavette et sa poche, bretelles croisées dans le dos, boutons
    const den = outfit.pants;
    tp.push(cyl(0.129, 0.131, 0.13, 12, den, [0, 0.09, 0], undefined, [1, 1, 0.77]));
    tp.push(box(0.17, 0.15, 0.03, den, [0, 0.21, 0.088]));
    tp.push(box(0.08, 0.06, 0.012, shadeHex(den, 0.85), [0, 0.22, 0.106]));
    tp.push(box(0.172, 0.012, 0.031, shadeHex(den, 1.25), [0, 0.283, 0.089]));
    for (const sx of [1, -1]) {
      tp.push(strip([sx * 0.065, 0.28, 0.098], [sx * 0.09, 0.405, 0.035], 0.03, 0.015, den));
      tp.push(strip([sx * 0.09, 0.405, 0.035], [sx * 0.07, 0.4, -0.06], 0.03, 0.015, den));
      tp.push(strip([sx * 0.07, 0.4, -0.06], [-sx * 0.05, 0.2, -0.098], 0.03, 0.015, den));
      tp.push(cyl(0.012, 0.012, 0.01, 8, 0xd9b35a, [sx * 0.066, 0.27, 0.104], [Math.PI / 2, 0, 0]));
    }
    // foulard noué au cou
    tp.push(cyl(0.055, 0.06, 0.03, 10, 0xf0d9a8, [0, 0.425, 0]));
    tp.push(cyl(0.0, 0.04, 0.06, 4, 0xf0d9a8, [0, 0.39, 0.06], [Math.PI - 0.3, Math.PI / 4, 0]));
  }
  if (role === 'seller') {
    // tablier à bavette : sangle de cou, poche ventrale, lien à la taille, badge
    const ap = outfit.apron ?? 0x2f6bff;
    tp.push(box(0.2, 0.2, 0.02, ap, [0, 0.2, 0.096]));
    tp.push(box(0.24, 0.24, 0.02, ap, [0, -0.02, 0.112]));
    tp.push(box(0.16, 0.07, 0.006, shadeHex(ap, 0.82), [0, 0.0, 0.124]));
    tp.push(cyl(0.131, 0.131, 0.022, 12, ap, [0, 0.1, 0], undefined, [1, 1, 0.78]));
    for (const sx of [1, -1]) tp.push(strip([sx * 0.085, 0.29, 0.098], [sx * 0.045, 0.425, 0.03], 0.02, 0.012, ap));
    tp.push(box(0.045, 0.025, 0.006, 0xffffff, [0.055, 0.25, 0.108]));
    tp.push(box(0.03, 0.006, 0.002, 0x2f6bff, [0.055, 0.255, 0.112]));
  }
  if (role === 'caretaker') {
    // blouse longue ouverte sur le pyjama de soin, revers, poches, stylo, stéthoscope
    const coat = outfit.shirt;
    tp.push(cyl(0.15, 0.175, 0.3, 12, coat, [0, -0.06, 0], undefined, [1, 1, 0.8]));
    tp.push(box(0.07, 0.14, 0.012, outfit.pants, [0, 0.36, 0.088], [-0.12, 0, 0]));
    for (const sx of [1, -1]) {
      tp.push(strip([sx * 0.04, 0.43, 0.085], [sx * 0.01, 0.2, 0.108], 0.035, 0.01, shadeHex(coat, 0.92)));
      tp.push(box(0.07, 0.07, 0.008, shadeHex(coat, 0.93), [sx * 0.08, -0.03, 0.135]));
      tp.push(box(0.008, 0.33, 0.004, shadeHex(coat, 0.9), [sx * 0.008, -0.02, 0.137]));
    }
    tp.push(box(0.05, 0.05, 0.008, shadeHex(coat, 0.93), [0.075, 0.27, 0.1]));
    tp.push(box(0.008, 0.05, 0.008, 0x2f6bff, [0.065, 0.3, 0.104]));
    tp.push(box(0.05, 0.05, 0.02, 0xe5484d, [-0.075, 0.3, 0.1]));
    tp.push(box(0.02, 0.05, 0.022, 0xffffff, [-0.075, 0.3, 0.104]));
    tp.push(box(0.05, 0.02, 0.022, 0xffffff, [-0.075, 0.3, 0.104]));
    const steth = 0x2b2d33;
    tp.push(strip([0.05, 0.44, 0.03], [0.035, 0.31, 0.1], 0.012, 0.012, steth));
    tp.push(strip([-0.05, 0.44, 0.03], [-0.02, 0.33, 0.1], 0.012, 0.012, steth));
    tp.push(strip([-0.04, 0.445, -0.03], [0.04, 0.445, -0.03], 0.012, 0.012, steth));
    tp.push(cyl(0.02, 0.02, 0.012, 10, 0xc9ccd1, [0.035, 0.3, 0.105], [Math.PI / 2, 0, 0]));
  }
  if (role === 'gardener') {
    // tablier de toile à grandes poches, sécateur dans la poche
    const ap = outfit.apron ?? 0x9a7b4f;
    tp.push(box(0.19, 0.18, 0.02, ap, [0, 0.19, 0.095]));
    tp.push(box(0.23, 0.26, 0.02, ap, [0, -0.03, 0.112]));
    for (const sx of [1, -1]) {
      tp.push(box(0.09, 0.08, 0.008, shadeHex(ap, 0.82), [sx * 0.055, -0.03, 0.125]));
      tp.push(strip([sx * 0.08, 0.28, 0.097], [sx * 0.05, 0.425, 0.03], 0.02, 0.012, ap));
    }
    tp.push(box(0.012, 0.07, 0.012, 0xd9534f, [0.07, 0.02, 0.13]));
    tp.push(box(0.012, 0.05, 0.012, 0xa5a9b0, [0.055, 0.04, 0.13], [0, 0, 0.3]));
  }
  const torsoMesh = part(merge(tp), true, true);
  torsoMesh.scale.x = l.build;
  torso.add(torsoMesh);
  // tête
  const head = new THREE.Group();
  head.position.y = 0.55;
  const hat = outfit.hat !== null;
  const hp = headParts(l, { hat });
  if (hat && role === 'farmhand') {
    // chapeau de paille : large bord, calotte, ruban
    hp.push(cyl(0.2, 0.205, 0.014, 18, outfit.hat!, [0, 0.118, 0]));
    hp.push(cyl(0.083, 0.1, 0.085, 14, outfit.hat!, [0, 0.165, 0]));
    hp.push(cyl(0.085, 0.085, 0.01, 14, shadeHex(outfit.hat!, 0.9), [0, 0.208, 0]));
    hp.push(cyl(0.101, 0.101, 0.024, 14, 0xb5452f, [0, 0.135, 0]));
  } else if (hat) {
    // bob de jardinier : calotte et bord tombant
    hp.push(cyl(0.1, 0.112, 0.075, 14, outfit.hat!, [0, 0.16, -0.005]));
    hp.push(cyl(0.113, 0.16, 0.035, 14, outfit.hat!, [0, 0.115, -0.005]));
    hp.push(cyl(0.113, 0.113, 0.012, 14, shadeHex(outfit.hat!, 0.75), [0, 0.135, -0.005]));
  }
  head.add(part(merge(hp), false, true));
  torso.add(head);
  // bras (pivot à l'épaule)
  const armGeo = merge(armParts(wear, skin));
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(0.17 * l.build, 0.39, 0);
  armR.position.set(-0.17 * l.build, 0.39, 0);
  armL.add(part(armGeo, false, true));
  armR.add(part(armGeo, false, true));
  torso.add(armL, armR);
  root.scale.setScalar(l.height);
  // outils (tenus par la main droite)
  const hand = (o: THREE.Object3D) => {
    o.position.set(0, -0.36, 0.02);
    o.visible = false;
    armR.add(o);
    return o;
  };
  const tools = {
    basket: hand(part(merge([cyl(0.1, 0.08, 0.1, 10, 0xb07a45, [0, -0.07, 0.04]), cyl(0.09, 0.09, 0.02, 10, 0xf3e8d3, [0, -0.02, 0.04]), box(0.012, 0.12, 0.012, 0x8a5a30, [0, 0.03, 0.04])]), false)),
    // balai de paille tenu à deux mains : posé sur la brosse (origine au sol), manche vers le haut (+y).
    // Il n'est pas attaché à la main : sa pose est recalculée à chaque image (voir poseSweep).
    broom: (() => {
      const g = new THREE.Group();
      g.add(
        part(
          merge([
            cyl(0.036, 0.122, 0.22, 10, 0xd9b35a, [0, 0.11, 0], undefined, [1, 1, 0.38]),
            cyl(0.122, 0.126, 0.025, 10, 0xc29d45, [0, 0.008, 0], undefined, [1, 1, 0.38]),
            box(0.17, 0.014, 0.05, 0x9c3b2c, [0, 0.085, 0]),
            box(0.12, 0.014, 0.045, 0x9c3b2c, [0, 0.15, 0]),
            cyl(0.03, 0.034, 0.05, 8, 0x8a5a30, [0, 0.235, 0]),
            cyl(0.014, 0.015, 0.74, 6, 0xb07a45, [0, 0.62, 0]),
          ]),
          false,
        ),
      );
      g.visible = false;
      root.add(g);
      return g;
    })(),
    can: hand(part(merge([cyl(0.08, 0.08, 0.14, 10, 0x4a9a6a, [0, -0.08, 0.06]), cyl(0.012, 0.018, 0.18, 5, 0x4a9a6a, [0, -0.04, 0.18], [1.1, 0, 0])]), false)),
    bucket: hand(part(merge([cyl(0.09, 0.075, 0.14, 10, 0x9fb3c2, [0, -0.09, 0.03]), cyl(0.082, 0.082, 0.01, 10, C.water, [0, -0.03, 0.03])]), false)),
    sack: hand(part(merge([box(0.18, 0.22, 0.12, 0xd8c08a, [0, -0.1, 0.07]), box(0.15, 0.03, 0.1, 0xb59a62, [0, 0.02, 0.07])]), false)),
    kit: hand(part(merge([box(0.18, 0.12, 0.08, 0xe5484d, [0, -0.07, 0.04]), box(0.06, 0.02, 0.085, 0xffffff, [0, -0.05, 0.04]), box(0.02, 0.06, 0.085, 0xffffff, [0, -0.05, 0.04])]), false)),
    // fusil de chasse : canon dans le prolongement du bras, crosse calée vers l'épaule
    rifle: hand(
      part(
        merge([
          cyl(0.014, 0.014, 0.44, 6, 0x2b2d33, [0, -0.2, 0.03]),
          cyl(0.012, 0.012, 0.36, 6, 0x3a3d44, [0, -0.17, 0.055]),
          box(0.04, 0.17, 0.045, 0x8a5a30, [0, -0.07, 0.045]),
          box(0.045, 0.2, 0.07, 0x7a4c28, [0, 0.11, 0.02], [0.18, 0, 0]),
          box(0.012, 0.035, 0.03, 0x2b2d33, [0, 0.0, 0.075]),
        ]),
        false,
      ),
    ),
    lantern: (() => {
      // lanterne tenue dans la main gauche pour la tournée du soir
      const l = new THREE.Group();
      l.add(part(merge([box(0.09, 0.02, 0.09, 0x3a3f4a, [0, 0.05, 0]), box(0.1, 0.02, 0.1, 0x3a3f4a, [0, -0.08, 0]), box(0.012, 0.06, 0.012, 0x3a3f4a, [0, 0.09, 0])]), false));
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.11, 0.075), LANTERN_MAT);
      bulb.position.y = -0.015;
      l.add(bulb);
      const halo = new THREE.Sprite(LANTERN_HALO);
      halo.scale.setScalar(0.42);
      halo.position.y = -0.015;
      halo.renderOrder = 7;
      l.add(halo);
      l.position.set(0, -0.42, 0.03);
      l.visible = false;
      armL.add(l);
      return l;
    })(),
  };
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.43, 0.03);
  tools.rifle.add(muzzle);
  const broomTip = new THREE.Object3D();
  broomTip.position.set(0, 0.01, 0);
  tools.broom.add(broomTip);
  root.add(legL, legR, torso);
  // flaque de lumière au sol, décalée côté lanterne (main gauche) et étirée vers l'avant
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), LANTERN_GLOW);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0.22, 0.03, 0.25);
  glow.scale.set(1, 1.18, 1);
  glow.renderOrder = 2;
  glow.visible = false;
  root.add(glow);
  return { root, torso, head, legL, legR, armL, armR, tools, muzzle, broomTip, glow, phase: (look % 17) * 0.37 };
}

export function waterDrops() {
  return merge([sph(0.02, 4, 3, C.water, [0, 0, 0])]);
}
