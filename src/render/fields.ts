// Les champs : blé, colza, tournesols, lavande, vigne, potagers, labours et foins. Vu de loin, un champ
// est fait de rangs ; de près, il se couvre de vraies plantes qui ondulent au vent. Les cultures suivent
// l'année : elles poussent au printemps, mûrissent l'été, sont moissonnées à l'automne.
import * as THREE from 'three';
import { MAT, box, cyl, merge, mergeChunks, mesh, prism } from './geo';
import { CROP_CLUMPS, CROP_ROWS, SOIL_MAT, Soup, lump, plant, type CropClass, type Plant } from './nature';
import { roundBale } from './models';

export type CropKind = 'wheat' | 'colza' | 'sunflower' | 'lavender' | 'vines' | 'veg' | 'plough' | 'hay';
export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

function rnd(k: number) {
  const x = Math.sin(k * 91.17 + 17.3) * 43758.5453;
  return x - Math.floor(x);
}

// ------------------------------------------------------------------ Plants ----
function wheatClump() {
  const s = new Soup();
  for (let i = 0; i < 7; i++) {
    const a = i * 2.39;
    const r = 0.04 + rnd(i) * 0.17;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const h = 0.44 + rnd(i + 9) * 0.2;
    const lx = bx + (rnd(i + 21) - 0.5) * 0.14;
    const lz = bz + (rnd(i + 31) - 0.5) * 0.14;
    const face = rnd(i + 41) * Math.PI;
    const fx = Math.cos(face) * 0.016;
    const fz = Math.sin(face) * 0.016;
    s.tri([bx - fx, 0, bz - fz], [bx + fx, 0, bz + fz], [lx, h - 0.1, lz], i % 2 ? 0xbab35e : 0xc9bb62);
    s.diamond(lx, h - 0.16, h + 0.03, lz, 0.032, face, i % 3 ? 0xeac65c : 0xddb44c);
  }
  return s.geometry();
}

function colzaClump() {
  const s = new Soup();
  for (let i = 0; i < 6; i++) {
    const a = i * 2.39;
    const r = 0.05 + rnd(i + 3) * 0.19;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const h = 0.42 + rnd(i + 13) * 0.18;
    s.tri([bx - 0.018, 0, bz], [bx + 0.018, 0, bz], [bx, h, bz], 0x7fa84e);
    const R = 0.075;
    const c = i % 2 ? 0xf5dc3c : 0xeccf30;
    // bouquet de fleurs : un losange à plat et un debout, visibles sous tous les angles
    s.quad([bx - R, h, bz], [bx, h + 0.02, bz + R], [bx + R, h, bz], [bx, h + 0.02, bz - R], c);
    s.diamond(bx, h - 0.04, h + 0.1, bz, 0.05, a, c);
  }
  return s.geometry();
}

function lavenderPlant() {
  const s = new Soup();
  for (let i = 0; i < 18; i++) {
    const a = i * 2.39;
    const r = 0.05 + (i / 18) * 0.24;
    const bx = Math.cos(a) * r * 0.4;
    const bz = Math.sin(a) * r * 0.4;
    const tx = Math.cos(a) * r;
    const tz = Math.sin(a) * r;
    const h = 0.36 + rnd(i + 5) * 0.16;
    s.tri([bx - 0.014, 0.1, bz], [bx + 0.014, 0.1, bz], [tx, h - 0.1, tz], 0x7f9c7b);
    s.diamond(tx, h - 0.17, h + 0.03, tz, 0.05, a + 1.2, i % 3 === 0 ? 0xab90ea : i % 3 === 1 ? 0x9273d8 : 0x8060c8);
    s.diamond(tx, h - 0.16, h + 0.02, tz, 0.045, a + 2.8, i % 3 === 0 ? 0x9a7fe0 : 0x8a6bd0);
  }
  return merge([lump(0.17, 0, 0x7a9875, [0, 0.1, 0], [1.1, 0.66, 1.1], 3), s.geometry()]);
}

function sunflowerPlant() {
  const s = new Soup();
  // tige et feuilles
  s.quad([-0.022, 0, 0], [0.022, 0, 0], [0.018, 0.92, 0], [-0.018, 0.92, 0], 0x6c9a45);
  s.quad([0, 0.34, 0], [0.26, 0.42, 0.06], [0.3, 0.3, 0.14], [0.06, 0.28, 0.03], 0x5f9140);
  s.quad([0, 0.56, 0], [-0.24, 0.62, -0.05], [-0.28, 0.5, 0.1], [-0.05, 0.5, 0.03], 0x6fa44a);
  // capitule tourné vers le soleil : en direction de la caméra, légèrement relevé
  const n = new THREE.Vector3(0.62, 0.5, 0.62).normalize();
  const u = new THREE.Vector3(1, 0, -1).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const c = new THREE.Vector3(0, 0.96, 0).addScaledVector(n, 0.03);
  const at = (a: number, r: number, off = 0): [number, number, number] => {
    const p = c.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r).addScaledVector(n, off);
    return [p.x, p.y, p.z];
  };
  const up: [number, number, number] = [n.x, n.y, n.z];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const b = ((i + 1) / 10) * Math.PI * 2;
    s.tri(at(a, 0.08), at(b, 0.08), at((a + b) / 2, 0.19), i % 2 ? 0xf7cf2a : 0xf0b81f, up);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const b = ((i + 1) / 8) * Math.PI * 2;
    s.tri(at(0, 0, 0.012), at(a, 0.09, 0.012), at(b, 0.09, 0.012), 0x6b4a28, up);
  }
  return s.geometry();
}

function vinePlant() {
  const leaves = merge([
    lump(0.2, 0, 0x5d8f45, [0, 0.44, 0], [1.2, 0.85, 0.72], 5),
    lump(0.16, 0, 0x6b9d4c, [0.2, 0.5, 0.02], [1, 0.85, 0.75], 6),
    lump(0.16, 0, 0x57863f, [-0.2, 0.42, -0.02], [1, 0.85, 0.75], 7),
  ]);
  return merge([
    cyl(0.018, 0.034, 0.36, 4, 0x5f4632, [0, 0.18, 0]),
    leaves,
    lump(0.05, 0, 0x53305f, [0.09, 0.27, 0.13], [0.9, 1.25, 0.9], 8, 0.1),
    lump(0.045, 0, 0x5f3a70, [-0.1, 0.25, 0.13], [0.9, 1.25, 0.9], 9, 0.1),
  ]);
}

function lettucePlant() {
  const s = new Soup();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const c = i % 2 ? 0x70a94f : 0x82b95c;
    s.tri([0, 0.03, 0], [Math.cos(a - 0.5) * 0.17, 0.1, Math.sin(a - 0.5) * 0.17], [Math.cos(a + 0.5) * 0.17, 0.1, Math.sin(a + 0.5) * 0.17], c);
  }
  return merge([lump(0.12, 0, 0x93c769, [0, 0.11, 0], [1, 0.82, 1], 4), s.geometry()]);
}

/** Touffe de lavande, aussi utilisée pour les bordures d'allée. */
export const lavenderGeometry = () => plantOf('lavender');

const PLANTS: Partial<Record<CropKind, { make: () => THREE.BufferGeometry; cls: CropClass; along: number; spread: number }>> = {
  wheat: { make: wheatClump, cls: 'cereal', along: 0.46, spread: 0.07 },
  colza: { make: colzaClump, cls: 'colza', along: 0.5, spread: 0.06 },
  sunflower: { make: sunflowerPlant, cls: 'cereal', along: 0.56, spread: 0.08 },
  lavender: { make: lavenderPlant, cls: 'garden', along: 0.52, spread: 0.08 },
  vines: { make: vinePlant, cls: 'garden', along: 0.64, spread: 0.08 },
  veg: { make: lettucePlant, cls: 'garden', along: 0.56, spread: 0.13 },
};
const plantGeo = new Map<CropKind, THREE.BufferGeometry>();
function plantOf(kind: CropKind) {
  let g = plantGeo.get(kind);
  if (!g) plantGeo.set(kind, (g = PLANTS[kind]!.make()));
  return g;
}

// ------------------------------------------------------------------ Champs ----
/** Écartement des rangs et aspect vu de loin. */
const LOOK: Record<CropKind, { soil: number; a: number; b: number; h: number; d: number; step: number }> = {
  wheat: { soil: 0xb79a6b, a: 0xe6c565, b: 0xdab756, h: 0.26, d: 0.6, step: 0.56 },
  colza: { soil: 0xa8926a, a: 0xf2d94a, b: 0xe2c93c, h: 0.26, d: 0.6, step: 0.56 },
  sunflower: { soil: 0x9d8158, a: 0x6f9e4a, b: 0x7fae52, h: 0.42, d: 0.46, step: 0.98 },
  lavender: { soil: 0xc4b48c, a: 0x8f76cf, b: 0x8064be, h: 0.3, d: 0.58, step: 1.04 },
  vines: { soil: 0xb9a57e, a: 0x618f48, b: 0x6d9a50, h: 0.38, d: 0.32, step: 1.22 },
  veg: { soil: 0x8f7450, a: 0x7fb35a, b: 0x6ea34c, h: 0.09, d: 0.42, step: 0.82 },
  plough: { soil: 0x8f7350, a: 0x7f6345, b: 0x745a3e, h: 0.07, d: 0.4, step: 0.46 },
  hay: { soil: 0xbcc884, a: 0xd9c97c, b: 0xcfbd6c, h: 0.05, d: 0.5, step: 1.5 },
};
const CLASS_OF: Partial<Record<CropKind, CropClass>> = { wheat: 'cereal', sunflower: 'cereal', hay: 'cereal', colza: 'colza', lavender: 'garden', vines: 'garden', veg: 'garden' };

export class FieldKit {
  private soil: THREE.BufferGeometry[] = [];
  private rows: Record<CropClass, THREE.BufferGeometry[]> = { cereal: [], colza: [], garden: [] };
  private fixtures: THREE.BufferGeometry[] = [];
  private patches: Array<{ kind: CropKind; items: Plant[] }> = [];
  private bales: Plant[] = [];

  /** Ajoute un champ. `near` : assez proche de la ferme pour mériter de vraies plantes. */
  add(kind: CropKind, r: Rect, alongX: boolean, near: boolean, seed = 0) {
    const L = LOOK[kind];
    const w = r.x1 - r.x0;
    const d = r.z1 - r.z0;
    const mx = (r.x0 + r.x1) / 2;
    const mz = (r.z0 + r.z1) / 2;
    this.soil.push(box(w, 0.04, d, L.soil, [mx, 0.02, mz]));
    const across = alongX ? d : w;
    const len = (alongX ? w : d) - 0.5;
    const n = Math.max(1, Math.floor((across - 0.5) / L.step));
    const margin = (across - (n - 1) * L.step) / 2;
    const cls = CLASS_OF[kind];
    const target = cls ? this.rows[cls] : this.soil;
    for (let k = 0; k < n; k++) {
      const o = margin + k * L.step;
      const c = k % 2 ? L.b : L.a;
      const x = alongX ? mx : r.x0 + o;
      const z = alongX ? r.z0 + o : mz;
      if (kind === 'hay') {
        target.push(box(alongX ? len : L.d, L.h, alongX ? L.d : len, c, [x, 0.04 + L.h / 2, z]));
        continue;
      }
      target.push(prism(len, L.h, L.d, c, [x, 0.035, z], alongX ? 0 : Math.PI / 2));
      // le jaune des capitules se voit encore de loin
      if (kind === 'sunflower') target.push(box(alongX ? len : 0.13, 0.03, alongX ? 0.13 : len, 0xf2c62c, [x, 0.035 + L.h + 0.01, z]));
    }
    if (kind === 'vines') {
      // piquets au bout des rangs et fil de palissage
      for (let k = 0; k < n; k++) {
        const o = margin + k * L.step;
        for (const e of [-len / 2, 0, len / 2]) {
          const px = alongX ? mx + e : r.x0 + o;
          const pz = alongX ? r.z0 + o : mz + e;
          this.fixtures.push(box(0.035, 0.62, 0.035, 0x7d6448, [px, 0.31, pz]));
        }
        const fx = alongX ? mx : r.x0 + o;
        const fz = alongX ? r.z0 + o : mz;
        this.fixtures.push(box(alongX ? len : 0.012, 0.012, alongX ? 0.012 : len, 0xb6b0a2, [fx, 0.56, fz]));
      }
    }
    if (kind === 'hay') {
      const count = 3 + Math.floor(rnd(seed + 3) * 5);
      for (let k = 0; k < count; k++) this.bales.push([r.x0 + 1.4 + rnd(seed + 10 + k) * (w - 2.8), r.z0 + 1.4 + rnd(seed + 40 + k) * (d - 2.8), rnd(seed + 70 + k) * 6.28, 1]);
    }
    const P = PLANTS[kind];
    if (near && P) {
      const items: Plant[] = [];
      const dense = kind === 'wheat' || kind === 'colza';
      const aStep = P.along;
      const cStep = dense ? P.along * 1.1 : L.step;
      const cn = dense ? Math.floor((across - 0.4) / cStep) : n;
      const cm = dense ? (across - (cn - 1) * cStep) / 2 : margin;
      const lane = (alongX ? w : d) - 0.7;
      const an = Math.floor(lane / aStep);
      for (let c = 0; c < cn; c++)
        for (let a = 0; a <= an; a++) {
          const k = seed * 13 + c * 97 + a;
          const u = -lane / 2 + a * aStep + (rnd(k) - 0.5) * aStep * 0.5;
          const v = cm + c * cStep + (rnd(k + 5) - 0.5) * (dense ? 0.2 : 0.07);
          const x = alongX ? mx + u : r.x0 + v;
          const z = alongX ? r.z0 + v : mz + u;
          // les tournesols regardent tous du même côté ; le reste pousse en tous sens
          const rot = kind === 'sunflower' ? (rnd(k + 7) - 0.5) * 0.5 : kind === 'vines' ? (alongX ? 0 : Math.PI / 2) + (rnd(k + 7) - 0.5) * 0.3 : rnd(k + 7) * 6.28;
          items.push([x, z, rot, 0.86 + rnd(k + 11) * 0.3]);
        }
      this.patches.push({ kind, items });
    }
  }

  /** Construit le tout. Une seule géométrie par classe de culture. */
  flush(scene: THREE.Object3D) {
    if (this.soil.length) {
      for (const g of mergeChunks(this.soil, 40)) {
        const m = new THREE.Mesh(g, SOIL_MAT);
        m.receiveShadow = true;
        scene.add(m);
      }
    }
    for (const cls of Object.keys(this.rows) as CropClass[]) {
      if (!this.rows[cls].length) continue;
      for (const g of mergeChunks(this.rows[cls], 40)) {
        const m = new THREE.Mesh(g, CROP_ROWS[cls]);
        m.receiveShadow = true;
        scene.add(m);
      }
    }
    if (this.fixtures.length) scene.add(mesh(merge(this.fixtures), false, true));
    if (this.bales.length) plant(scene, roundBale(), null, this.bales, { mat: MAT, cast: true, spread: 0.05 });
    for (const p of this.patches) {
      const def = PLANTS[p.kind]!;
      // un seul bloc par champ : dessiné seulement s'il est à l'écran
      plant(scene, plantOf(p.kind), null, p.items, { mat: CROP_CLUMPS[def.cls], chunk: 1000, spread: def.spread, detail: true });
    }
  }
}
