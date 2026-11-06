// Poulaillers et réserves à œufs, un modèle par niveau : cabane sur pilotis au toit de tôle,
// poulailler de planches rouges à volets verts et girouette, chaumière normande à colombages et
// lanternon, bâtiment d'élevage moderne (panneaux solaires, ventilateurs, trappe automatique) ;
// garde-manger en planches, cellier à persiennes et son étagère, chambre froide, entrepôt
// réfrigéré à quai de chargement. Volumes simples fusionnés, détails en légère saillie
// (planches, colombages, tuiles…) visibles sous l'angle de la caméra (façade +z, côté +x).
import * as THREE from 'three';
import { C, GLOW, box, cone, cyl, finalizeExport, ico, merge, mesh, prism, sph, type V3 } from './geo';
import { nurseryPlan } from '../sim/nursery';

export type Parts = THREE.BufferGeometry[];

const TRIM = 0xf3eee4;
const TIMBER = 0x6d4a35;
const PLASTER = 0xf4eee4;
const STONE = 0xbdb2a0;
const STONE_DARK = 0xa99d8a;
const IRON = 0x3a3f4a;
const FRAME_DARK = 0x5b6170;
const GERANIUMS = [0xd9534f, 0xe85d75, 0xf08a3a, 0xffffff];

const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
function rnd(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Vitre qui s'allume le soir (matériau partagé GLOW). */
export function glassPane(w: number, h: number, p: V3, ry = 0, d = 0.03) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), GLOW);
  m.position.set(...p);
  m.rotation.y = ry;
  return m;
}

/** Volume extrudé le long de x à partir d'un profil (z, y) : murs à une pente, pignons… */
function extrudeX(profile: Array<[number, number]>, w: number, color: number, cx: number) {
  const sh = new THREE.Shape();
  profile.forEach(([z, y], i) => (i ? sh.lineTo(-z, y) : sh.moveTo(-z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return finalizeExport(g, color, [cx, 0, 0]);
}

/** Bardage de planches verticales sur une façade tournée vers +z (les joints laissent voir le mur sombre). */
function boardsZ(parts: Parts, x0: number, x1: number, y0: number, y1: number | ((x: number) => number), z: number, a: number, b: number, step = 0.17) {
  const n = Math.max(1, Math.round((x1 - x0) / step));
  const w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const x = x0 + w * (i + 0.5);
    const top = typeof y1 === 'function' ? y1(x) : y1;
    parts.push(box(w - 0.014, top - y0, 0.022, i % 3 === 1 ? b : a, [x, (y0 + top) / 2, z + 0.011]));
  }
}
/** Même chose sur un côté tourné vers +x. */
function boardsX(parts: Parts, z0: number, z1: number, y0: number, y1: number | ((z: number) => number), x: number, a: number, b: number, step = 0.17) {
  const n = Math.max(1, Math.round((z1 - z0) / step));
  const w = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const z = z0 + w * (i + 0.5);
    const top = typeof y1 === 'function' ? y1(z) : y1;
    parts.push(box(0.022, top - y0, w - 0.014, i % 3 === 1 ? b : a, [x + 0.011, (y0 + top) / 2, z]));
  }
}

/** Moellons du soubassement, sur la façade (+z) et le côté (+x). */
function stones(parts: Parts, x0: number, x1: number, z0: number, z1: number, h: number) {
  const rows = Math.max(1, Math.round(h / 0.1));
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    const y = rh * (r + 0.5);
    let k = r * 7;
    for (let x = x0 + (r % 2 ? 0.13 : 0); x < x1 - 0.06; x += 0.26) {
      const w = Math.min(0.22, x1 - x - 0.02);
      parts.push(box(w, rh - 0.022, 0.02, rnd(k++) < 0.5 ? STONE_DARK : 0xcabfac, [x + w / 2, y, z1 + 0.01]));
    }
    for (let z = z0 + (r % 2 ? 0.13 : 0); z < z1 - 0.06; z += 0.26) {
      const w = Math.min(0.22, z1 - z - 0.02);
      parts.push(box(0.02, rh - 0.022, w, rnd(k++) < 0.5 ? STONE_DARK : 0xcabfac, [x1 + 0.01, y, z + w / 2]));
    }
  }
}

/** Jardinière fleurie (géraniums) sous une fenêtre de façade. */
function flowerBox(parts: Parts, x: number, y: number, z: number, w: number, seed: number) {
  parts.push(box(w, 0.09, 0.12, C.woodDark, [x, y, z]));
  for (let i = 0; i < 6; i++) {
    const fx = x - w / 2 + 0.06 + (i * (w - 0.12)) / 5;
    parts.push(ico(0.055, 0, i % 2 ? 0x5f9a4a : 0x6ea84f, [fx, y + 0.07, z]));
    parts.push(ico(0.035, 0, GERANIUMS[(seed + i) % GERANIUMS.length], [fx + 0.01, y + 0.12, z + 0.02]));
  }
}

interface WinOpts {
  shutters?: number;
  flowers?: boolean;
  panes?: boolean;
}
/** Fenêtre de façade (+z) : vitre, cadre, croisillons, appui, volets et jardinière en option. */
function windowZ(parts: Parts, windows: THREE.Mesh[], x: number, y: number, z: number, w: number, h: number, frame: number, o: WinOpts = {}) {
  windows.push(glassPane(w, h, [x, y, z + 0.018]));
  const f = 0.045;
  parts.push(box(w + 2 * f, f, 0.04, frame, [x, y + h / 2 + f / 2, z + 0.02]));
  parts.push(box(w + 2 * f, f, 0.04, frame, [x, y - h / 2 - f / 2, z + 0.02]));
  parts.push(box(f, h, 0.04, frame, [x - w / 2 - f / 2, y, z + 0.02]));
  parts.push(box(f, h, 0.04, frame, [x + w / 2 + f / 2, y, z + 0.02]));
  if (o.panes !== false) {
    parts.push(box(0.022, h, 0.025, frame, [x, y, z + 0.036]));
    parts.push(box(w, 0.022, 0.025, frame, [x, y, z + 0.036]));
  }
  parts.push(box(w + 0.14, 0.035, 0.09, frame, [x, y - h / 2 - f - 0.012, z + 0.045]));
  if (o.shutters !== undefined) {
    const sw = w / 2 + 0.03;
    for (const s of [-1, 1]) {
      const sx = x + s * (w / 2 + f + sw / 2 + 0.012);
      parts.push(box(sw, h + 2 * f, 0.03, o.shutters, [sx, y, z + 0.015]));
      // barres et écharpe en Z
      for (const yy of [y + h * 0.32, y - h * 0.32]) parts.push(box(sw * 0.86, 0.03, 0.02, shade(o.shutters, 0.82), [sx, yy, z + 0.035]));
      parts.push(box(0.03, h * 0.72, 0.02, shade(o.shutters, 0.82), [sx, y, z + 0.035], [0, 0, s * Math.atan2(sw * 0.7, h * 0.64)]));
    }
  }
  if (o.flowers) flowerBox(parts, x, y - h / 2 - f - 0.075, z + 0.075, w + 0.16, Math.round(x * 10));
}
/** Fenêtre de côté (+x). */
function windowX(parts: Parts, windows: THREE.Mesh[], x: number, y: number, z: number, w: number, h: number, frame: number, panes = true) {
  windows.push(glassPane(w, h, [x + 0.018, y, z], Math.PI / 2));
  const f = 0.045;
  parts.push(box(0.04, f, w + 2 * f, frame, [x + 0.02, y + h / 2 + f / 2, z]));
  parts.push(box(0.04, f, w + 2 * f, frame, [x + 0.02, y - h / 2 - f / 2, z]));
  parts.push(box(0.04, h, f, frame, [x + 0.02, y, z - w / 2 - f / 2]));
  parts.push(box(0.04, h, f, frame, [x + 0.02, y, z + w / 2 + f / 2]));
  if (panes) {
    parts.push(box(0.025, h, 0.022, frame, [x + 0.036, y, z]));
    parts.push(box(0.025, 0.022, w, frame, [x + 0.036, y, z]));
  }
  parts.push(box(0.09, 0.035, w + 0.14, frame, [x + 0.045, y - h / 2 - f - 0.012, z]));
}

/** Ouverture de la trappe à poules : fond sombre et encadrement (la trappe elle-même est animée à part). */
function henDoor(parts: Parts, x: number, bottom: number, top: number, w: number, z: number, frame: number) {
  parts.push(box(w, top - bottom, 0.02, 0x3b2a20, [x, (bottom + top) / 2, z]));
  parts.push(box(0.05, top - bottom + 0.05, 0.035, frame, [x - w / 2 - 0.025, (bottom + top) / 2 + 0.025, z + 0.012]));
  parts.push(box(0.05, top - bottom + 0.05, 0.035, frame, [x + w / 2 + 0.025, (bottom + top) / 2 + 0.025, z + 0.012]));
  parts.push(box(w + 0.1, 0.05, 0.035, frame, [x, top + 0.025, z + 0.012]));
}

/** Rampe à tasseaux du seuil (hauteur sill, en zDoor) jusqu'au sol (zFoot). */
function ramp(parts: Parts, x: number, sill: number, zDoor: number, zFoot: number, w: number, color: number, cleat: number) {
  const run = zFoot - zDoor;
  const L = Math.hypot(run, sill);
  const a = Math.atan2(sill, run);
  parts.push(box(w, 0.03, L, color, [x, sill / 2 - 0.012, zDoor + run / 2], [a, 0, 0]));
  for (const t of [0.18, 0.38, 0.58, 0.78]) parts.push(box(w, 0.018, 0.025, cleat, [x, sill * (1 - t) + 0.008, zDoor + run * t], [a, 0, 0]));
  for (const s of [-1, 1]) parts.push(box(0.025, 0.05, L, cleat, [x + s * (w / 2 + 0.012), sill / 2 - 0.005, zDoor + run / 2], [a, 0, 0]));
}

/** Petite enseigne de bois peinte d'un œuf. */
function eggSign(parts: Parts, x: number, y: number, z: number, board: number) {
  parts.push(box(0.36, 0.13, 0.02, board, [x, y, z]));
  parts.push(sph(0.034, 7, 5, 0xf6efe2, [x - 0.06, y, z + 0.012], [1, 1.3, 0.35]));
  parts.push(sph(0.034, 7, 5, 0xd9a873, [x + 0.03, y, z + 0.012], [1, 1.3, 0.35]));
  parts.push(sph(0.034, 7, 5, 0xf6efe2, [x + 0.11, y, z + 0.012], [1, 1.3, 0.35]));
}

/** Lanterne murale (sa vitre s'allume le soir). */
function lantern(parts: Parts, windows: THREE.Mesh[], x: number, y: number, z: number) {
  parts.push(box(0.03, 0.03, 0.1, IRON, [x, y + 0.08, z + 0.05]));
  parts.push(box(0.11, 0.025, 0.11, IRON, [x, y + 0.07, z + 0.1]));
  parts.push(cone(0.07, 0.05, 4, IRON, [x, y + 0.1, z + 0.1], [0, Math.PI / 4, 0]));
  parts.push(box(0.1, 0.02, 0.1, IRON, [x, y - 0.06, z + 0.1]));
  const g = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.08), GLOW);
  g.position.set(x, y, z + 0.1);
  windows.push(g);
}

/** Girouette au coq sur le faîtage. */
function weathervane(parts: Parts, x: number, y: number, z: number, s = 1) {
  parts.push(cyl(0.012 * s, 0.014 * s, 0.46 * s, 5, IRON, [x, y + 0.23 * s, z]));
  parts.push(box(0.22 * s, 0.012, 0.012, IRON, [x, y + 0.2 * s, z]));
  parts.push(box(0.012, 0.012, 0.22 * s, IRON, [x, y + 0.2 * s, z]));
  parts.push(box(0.3 * s, 0.014, 0.014, IRON, [x, y + 0.36 * s, z]));
  parts.push(cone(0.035 * s, 0.07 * s, 4, IRON, [x + 0.17 * s, y + 0.36 * s, z], [0, 0, -Math.PI / 2]));
  parts.push(box(0.06 * s, 0.07 * s, 0.012, IRON, [x - 0.15 * s, y + 0.36 * s, z]));
  // le coq, de profil face à la caméra
  parts.push(sph(0.065 * s, 7, 5, IRON, [x - 0.02 * s, y + 0.47 * s, z], [1.25, 0.85, 0.22]));
  parts.push(sph(0.032 * s, 6, 5, IRON, [x + 0.06 * s, y + 0.54 * s, z], [1, 1, 0.35]));
  parts.push(box(0.05 * s, 0.1 * s, 0.012, IRON, [x - 0.1 * s, y + 0.52 * s, z], [0, 0, 0.55]));
  parts.push(box(0.04 * s, 0.03 * s, 0.012, IRON, [x + 0.07 * s, y + 0.58 * s, z]));
  parts.push(cone(0.012 * s, 0.035 * s, 3, IRON, [x + 0.1 * s, y + 0.54 * s, z], [0, 0, -Math.PI / 2]));
}

interface RoofOpts {
  cx: number;
  cz: number;
  /** Hauteur de l'égout (haut des murs). */
  y: number;
  /** Longueur (x) et profondeur (z) des murs, hauteur du faîtage au-dessus de l'égout. */
  w: number;
  d: number;
  h: number;
  /** Débord en bas de pente et sur les pignons. */
  over?: number;
  side?: number;
  a: number;
  b: number;
  /** Rangées (tuiles plates, bardeaux, ardoises) ou nervures (tuiles canal, bac acier). */
  style?: 'rows' | 'ribs';
  n?: number;
  ridge: number;
  rive?: number;
  /** Couleur du pignon (triangle sous le toit) ; absent : pas de pignon. */
  gable?: number;
}
interface Roof {
  slope: number;
  len: number;
  /** Point du pan (côté ±z) à la distance s du faîtage, soulevé de lift au-dessus du pan : [y, z]. */
  at(side: 1 | -1, s: number, lift: number): [number, number];
  ridgeY: number;
}
/** Toit à deux pans : faîtage le long de x, pans vers ±z, couverture en rangées ou nervures. */
function gableRoof(parts: Parts, o: RoofOpts): Roof {
  const over = o.over ?? 0.14;
  const ox = o.side ?? over;
  const half = o.d / 2;
  const slope = Math.atan2(o.h, half);
  const len = Math.hypot(o.h, half) + over / Math.cos(slope);
  const W = o.w + 2 * ox;
  const t = 0.05;
  const at = (side: 1 | -1, s: number, lift: number): [number, number] => [o.y + o.h - Math.sin(slope) * s + Math.cos(slope) * lift, o.cz + side * (Math.cos(slope) * s + Math.sin(slope) * lift)];
  if (o.gable !== undefined) parts.push(prism(o.w, o.h, o.d, o.gable, [o.cx, o.y, o.cz]));
  for (const side of [1, -1] as const) {
    const r: V3 = [side * slope, 0, 0];
    const [y0, z0] = at(side, len / 2, t / 2);
    parts.push(box(W, t, len, o.a, [o.cx, y0, z0], r));
    if (o.style === 'ribs') {
      const n = Math.max(2, Math.round(W / 0.19));
      const [y, z] = at(side, len / 2, t + 0.014);
      for (let i = 0; i <= n; i++) parts.push(box(0.05, 0.03, len, o.b, [o.cx - W / 2 + 0.03 + (i * (W - 0.06)) / n, y, z], r));
    } else {
      const n = o.n ?? 6;
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.5) / n) * len;
        const [y, z] = at(side, s, t + 0.012);
        parts.push(box(W + 0.01, 0.024, len / n + 0.01, k % 2 ? o.b : o.a, [o.cx, y, z], r));
        // nez de la rangée : une ombre nette entre deux rangs
        const [ly, lz] = at(side, ((k + 1) / n) * len - 0.012, t + 0.028);
        parts.push(box(W + 0.012, 0.03, 0.024, shade(o.b, 0.82), [o.cx, ly, lz], r));
      }
    }
    if (o.rive !== undefined)
      for (const ex of [-1, 1]) {
        const [y, z] = at(side, len / 2, t / 2);
        parts.push(box(0.045, 0.11, len + 0.02, o.rive, [o.cx + ex * (W / 2 + 0.02), y, z], r));
      }
  }
  const ridgeY = o.y + o.h + t / Math.cos(slope);
  parts.push(box(W + 0.04, 0.075, 0.14, o.ridge, [o.cx, ridgeY + 0.012, o.cz]));
  return { slope, len, at, ridgeY: ridgeY + 0.05 };
}

// ============================================================ POULAILLERS ====
// Repères communs : bâtiment de 3 × 2, façade et trappe vers +z, trappe centrée en x = 1,5 ; la
// profondeur du mur de façade, la hauteur du seuil et le pied de la rampe suivent COOP_DOORS
// (farmRenderer.ts) pour que les poules gravissent la rampe et passent la trappe.

/** Niveau 1 — cabane sur pilotis, planches et toit de tôle ondulée à une pente. */
export function coopCabin(parts: Parts, windows: THREE.Mesh[]) {
  const RED = 0xb8553e;
  // paille sous la cabane
  parts.push(box(1.7, 0.012, 1.02, 0xe6cd86, [1.5, 0.056, 0.98]));
  for (let i = 0; i < 10; i++) parts.push(box(0.16, 0.012, 0.02, 0xd4b462, [0.8 + rnd(i) * 1.4, 0.065, 0.55 + rnd(i + 20) * 0.85], [0, rnd(i + 40) * 3, 0]));
  // pilotis et écharpes
  for (const x of [0.72, 2.28]) for (const z of [0.5, 1.46]) parts.push(box(0.08, 0.34, 0.08, TIMBER, [x, 0.17, z]));
  parts.push(box(0.045, 0.44, 0.035, TIMBER, [0.95, 0.16, 1.48], [0, 0, 1.0]));
  parts.push(box(0.045, 0.44, 0.035, TIMBER, [2.05, 0.16, 1.48], [0, 0, -1.0]));
  parts.push(box(0.035, 0.44, 0.045, TIMBER, [2.3, 0.16, 0.98], [-1.05, 0, 0]));
  parts.push(box(1.82, 0.06, 1.16, C.woodDark, [1.5, 0.3, 0.98]));
  // caisse : façade plus haute que l'arrière, sous un toit à une pente
  const yb = 0.33;
  const zb = 0.45;
  const zf = 1.51;
  const yF = 1.12;
  const yB = 0.98;
  const top = (z: number) => yB + ((z - zb) / (zf - zb)) * (yF - yB);
  parts.push(extrudeX([[zb, yb], [zf, yb], [zf, yF], [zb, yB]], 1.7, 0x8a5d36, 1.5));
  boardsZ(parts, 0.65, 2.35, yb, yF, zf, C.wood, 0xc98f52, 0.17);
  boardsX(parts, zb, zf, yb, top, 2.35, C.wood, 0xc98f52, 0.17);
  for (const x of [0.67, 2.33]) parts.push(box(0.06, yF - yb, 0.05, C.woodDark, [x, (yb + yF) / 2, zf + 0.03]));
  parts.push(box(0.05, top(zb + 0.03) - yb, 0.06, C.woodDark, [2.37, (yb + top(zb + 0.03)) / 2, zb + 0.03]));
  // toit de tôle ondulée
  const k = (yF - yB) / (zf - zb);
  const a = Math.atan(k);
  const z0 = zb - 0.2;
  const z1 = zf + 0.22;
  const zc = (z0 + z1) / 2;
  const L = (z1 - z0) / Math.cos(a);
  const yc = top(zc) + 0.035;
  parts.push(box(2.02, 0.035, L, RED, [1.5, yc, zc], [-a, 0, 0]));
  for (let x = 0.56; x <= 2.46; x += 0.12) parts.push(box(0.04, 0.03, L, x % 0.24 < 0.12 ? 0xa3482f : 0xc0604a, [x, yc + 0.028, zc], [-a, 0, 0]));
  parts.push(box(1.8, 0.07, 0.035, C.woodDark, [1.5, yF - 0.02, zf + 0.05]));
  // trappe, fenêtre, enseigne
  henDoor(parts, 1.5, 0.31, 0.75, 0.32, zf + 0.03, C.woodDark);
  windowZ(parts, windows, 2.02, 0.8, zf + 0.022, 0.26, 0.22, C.woodLight);
  eggSign(parts, 1.08, 0.86, zf + 0.035, C.woodLight);
  // pondoir accroché sur le côté, couvercle de tôle
  parts.push(box(0.3, 0.34, 0.62, C.wood, [2.52, 0.6, 0.98]));
  boardsX(parts, 0.67, 1.29, 0.43, 0.77, 2.67, C.woodLight, C.wood, 0.155);
  parts.push(box(0.42, 0.035, 0.72, RED, [2.55, 0.82, 0.98], [0, 0, -0.38]));
  for (const z of [0.78, 1.18]) parts.push(box(0.05, 0.03, 0.08, 0x5b5f66, [2.38, 0.8, z]));
  ramp(parts, 1.5, 0.32, 1.56, 2.09, 0.3, C.plank, C.woodDark);
}

/** Niveau 2 — poulailler de planches rouges, angles blancs, volets verts, ardoises et girouette. */
export function coopBarn(parts: Parts, windows: THREE.Mesh[]) {
  const RED = 0xb5452f;
  const RED2 = 0xa63f2b;
  const x0 = 0.29;
  const x1 = 2.71;
  const zb = 0.28;
  const zf = 1.62;
  const y0 = 0.22;
  const y1 = 1.2;
  const cz = (zb + zf) / 2;
  parts.push(box(x1 - x0 + 0.06, y0, zf - zb + 0.06, STONE, [1.5, y0 / 2, cz]));
  stones(parts, x0 - 0.03, x1 + 0.03, zb - 0.03, zf + 0.03, y0);
  parts.push(box(x1 - x0, y1 - y0, zf - zb, 0x6e2a1f, [1.5, (y0 + y1) / 2, cz]));
  boardsZ(parts, x0, x1, y0, y1, zf, RED, RED2, 0.15);
  boardsX(parts, zb, zf, y0, y1, x1, RED, RED2, 0.15);
  for (const [x, z] of [
    [x0, zf],
    [x1, zf],
    [x1, zb],
  ])
    parts.push(box(0.075, y1 - y0 + 0.02, 0.075, TRIM, [x, (y0 + y1) / 2, z]));
  parts.push(box(x1 - x0 + 0.08, 0.06, 0.04, TRIM, [1.5, y1 - 0.03, zf + 0.04]));
  parts.push(box(0.04, 0.06, zf - zb + 0.08, TRIM, [x1 + 0.04, y1 - 0.03, cz]));
  const roof = gableRoof(parts, { cx: 1.5, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.68, over: 0.16, side: 0.14, a: 0x6b7682, b: 0x5f6a76, n: 7, ridge: 0x4f5862, rive: TRIM, gable: RED });
  // ventilation du pignon, girouette
  parts.push(box(0.03, 0.22, 0.34, TRIM, [x1 + 0.015, y1 + 0.26, cz]));
  for (let i = 0; i < 4; i++) parts.push(box(0.03, 0.025, 0.28, 0x4a3328, [x1 + 0.025, y1 + 0.18 + i * 0.05, cz], [0.5, 0, 0]));
  weathervane(parts, 2.25, roof.ridgeY, cz);
  // trappe, fenêtres à volets, lanterne, enseigne
  henDoor(parts, 1.5, 0.22, 0.78, 0.34, zf + 0.026, TRIM);
  windowZ(parts, windows, 0.72, 0.82, zf + 0.022, 0.32, 0.28, TRIM, { shutters: 0x3f7d4f });
  windowZ(parts, windows, 2.28, 0.82, zf + 0.022, 0.32, 0.28, TRIM, { shutters: 0x3f7d4f });
  lantern(parts, windows, 1.86, 0.96, zf + 0.02);
  eggSign(parts, 1.5, 0.96, zf + 0.04, TRIM);
  // pondoir en appentis sur le côté
  parts.push(box(0.3, 0.42, 0.8, RED, [x1 + 0.15, 0.6, cz]));
  boardsX(parts, cz - 0.4, cz + 0.4, 0.39, 0.81, x1 + 0.3, RED, RED2, 0.16);
  parts.push(box(0.44, 0.04, 0.94, 0x6b7682, [x1 + 0.18, 0.86, cz], [0, 0, -0.35]));
  parts.push(box(0.04, 0.05, 0.94, TRIM, [x1 + 0.39, 0.79, cz]));
  ramp(parts, 1.5, 0.22, 1.67, 2.11, 0.34, C.plank, C.woodDark);
}

/** Niveau 3 — chaumière normande : enduit, colombages, tuiles plates, lanternon, fleurs. */
export function coopNormand(parts: Parts, windows: THREE.Mesh[]) {
  const x0 = 0.15;
  const x1 = 2.85;
  const zb = 0.2;
  const zf = 1.7;
  const y0 = 0.12;
  const y1 = 1.22;
  const cz = (zb + zf) / 2;
  parts.push(box(x1 - x0 + 0.06, y0, zf - zb + 0.06, STONE, [1.5, y0 / 2, cz]));
  stones(parts, x0 - 0.03, x1 + 0.03, zb - 0.03, zf + 0.03, y0);
  parts.push(box(x1 - x0, y1 - y0, zf - zb, PLASTER, [1.5, (y0 + y1) / 2, cz]));
  // colombages de la façade
  const tw = 0.065;
  const tz = zf + 0.014;
  const beam = (xa: number, xb: number, y: number) => parts.push(box(xb - xa, tw, 0.03, TIMBER, [(xa + xb) / 2, y, tz]));
  const post = (x: number, ya: number, yb: number) => parts.push(box(tw, yb - ya, 0.03, TIMBER, [x, (ya + yb) / 2, tz]));
  const brace = (xa: number, ya: number, xb: number, yb: number) =>
    parts.push(box(tw, Math.hypot(xb - xa, yb - ya), 0.028, TIMBER, [(xa + xb) / 2, (ya + yb) / 2, tz - 0.002], [0, 0, -Math.atan2(xb - xa, yb - ya)]));
  const yS = y0 + 0.035;
  const yT = y1 - 0.035;
  beam(x0, 1.27, yS);
  beam(1.73, x1, yS);
  beam(x0, x1, yT);
  for (const [a, b] of [
    [x0, 1.27],
    [1.73, x1],
  ]) {
    beam(a, b, 0.62);
    beam(a, b, 1.02);
    // croix de Saint-André sous les fenêtres
    brace(a + 0.08, yS + 0.02, b - 0.08, 0.6);
    brace(b - 0.08, yS + 0.02, a + 0.08, 0.6);
  }
  beam(1.27, 1.73, 0.8);
  for (const x of [x0 + 0.03, 1.27, 1.73, x1 - 0.03]) post(x, y0, y1);
  for (const x of [0.38, 0.86, 2.14, 2.62]) post(x, 0.62, 1.02);
  for (const x of [0.62, 2.38, 1.5]) post(x, x === 1.5 ? 0.8 : 1.02, yT);
  // colombages du côté
  const sx = x1 + 0.014;
  const beamX = (za: number, zz: number, y: number) => parts.push(box(0.03, tw, zz - za, TIMBER, [sx, y, (za + zz) / 2]));
  const postX = (z: number, ya: number, yb: number) => parts.push(box(0.03, yb - ya, tw, TIMBER, [sx, (ya + yb) / 2, z]));
  const braceX = (za: number, ya: number, zz: number, yb: number) =>
    parts.push(box(0.028, Math.hypot(zz - za, yb - ya), tw, TIMBER, [sx - 0.002, (ya + yb) / 2, (za + zz) / 2], [Math.atan2(zz - za, yb - ya), 0, 0]));
  beamX(zb, zf, yS);
  beamX(zb, zf, 0.68);
  beamX(zb, zf, yT);
  for (const z of [zb + 0.03, cz, zf - 0.03]) postX(z, y0, y1);
  braceX(zb + 0.08, yS + 0.02, cz - 0.06, 0.66);
  braceX(zf - 0.08, yS + 0.02, cz + 0.06, 0.66);
  braceX(cz + 0.06, 0.7, zf - 0.08, yT - 0.02);
  windowX(parts, windows, x1, 0.94, (zb + cz) / 2, 0.3, 0.24, TRIM);
  // pignon enduit, poinçon, œil-de-bœuf
  const roof = gableRoof(parts, { cx: 1.5, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.95, over: 0.18, side: 0.16, a: 0xb8603f, b: 0xa9553a, n: 8, ridge: 0x8c4a33, rive: TIMBER, gable: PLASTER });
  parts.push(box(0.03, 0.9, tw, TIMBER, [sx, y1 + 0.45, cz]));
  parts.push(box(0.03, tw, zf - zb - 0.2, TIMBER, [sx, y1 + 0.03, cz]));
  windows.push(glassPane(0.18, 0.18, [x1 + 0.02, y1 + 0.38, cz - 0.3], Math.PI / 2));
  parts.push(box(0.03, 0.26, 0.26, TRIM, [x1 + 0.01, y1 + 0.38, cz - 0.3]));
  // épis de faîtage et lanternon d'aération (avec sa girouette)
  for (const ex of [x0 - 0.12, x1 + 0.12]) {
    parts.push(cyl(0.035, 0.05, 0.12, 6, 0x8c4a33, [ex, roof.ridgeY + 0.04, cz]));
    parts.push(cone(0.04, 0.16, 6, 0x8c4a33, [ex, roof.ridgeY + 0.18, cz]));
  }
  parts.push(box(0.38, 0.3, 0.38, PLASTER, [1.5, roof.ridgeY + 0.08, cz]));
  for (let i = 0; i < 3; i++) {
    parts.push(box(0.28, 0.025, 0.03, TIMBER, [1.5, roof.ridgeY + 0.03 + i * 0.07, cz + 0.2], [0.5, 0, 0]));
    parts.push(box(0.03, 0.025, 0.28, TIMBER, [1.7, roof.ridgeY + 0.03 + i * 0.07, cz], [0, 0, -0.5]));
  }
  parts.push(cone(0.34, 0.28, 4, 0xa9553a, [1.5, roof.ridgeY + 0.37, cz], [0, Math.PI / 4, 0]));
  weathervane(parts, 1.5, roof.ridgeY + 0.5, cz, 0.75);
  // trappe, fenêtres fleuries
  henDoor(parts, 1.5, 0.16, 0.74, 0.38, zf + 0.025, TIMBER);
  windowZ(parts, windows, 0.62, 0.82, zf + 0.03, 0.4, 0.3, TRIM, { flowers: true });
  windowZ(parts, windows, 2.38, 0.82, zf + 0.03, 0.4, 0.3, TRIM, { flowers: true });
  // roses trémières le long de la façade
  for (const [hx, hz, c] of [
    [0.3, 1.86, 0xe85d75],
    [0.42, 1.9, 0xf3eee4],
    [2.62, 1.88, 0xd9534f],
  ] as const) {
    parts.push(cyl(0.012, 0.016, 0.82, 4, 0x5f9a4a, [hx, 0.46, hz]));
    parts.push(ico(0.08, 0, 0x6ea84f, [hx, 0.1, hz]));
    for (let k = 0; k < 6; k++) parts.push(ico(0.045 - k * 0.004, 0, c, [hx + (k % 2 ? 0.03 : -0.03), 0.42 + k * 0.08, hz + 0.02]));
  }
  ramp(parts, 1.5, 0.1, 1.74, 2.12, 0.38, C.plank, C.woodDark);
}

/** Niveau 4 — bâtiment d'élevage moderne : panneaux isolés, bac acier, solaire, ventilation. */
/** Palette commune aux poulaillers modernes (niveaux 4, 5 et 6) : ils forment une même famille. */
const MODERN_PANEL = 0xeef1f4;
const MODERN_SEAM = 0xd3d9e0;
const MODERN_FRAME = 0x5b6170;
const MODERN_BAND = 0x3d4a63;

export function coopModern(parts: Parts, windows: THREE.Mesh[]) {
  const x0 = 0.1;
  const x1 = 2.9;
  const zb = 0.15;
  const zf = 1.75;
  const y0 = 0.1;
  const y1 = 1.28;
  const cz = (zb + zf) / 2;
  const PANEL = MODERN_PANEL;
  const SEAM = MODERN_SEAM;
  const FRAME = MODERN_FRAME;
  parts.push(box(x1 - x0 + 0.06, y0, zf - zb + 0.06, 0x8e939b, [1.5, y0 / 2, cz]));
  parts.push(box(x1 - x0, y1 - y0, zf - zb, PANEL, [1.5, (y0 + y1) / 2, cz]));
  for (let x = x0 + 0.35; x < x1 - 0.1; x += 0.35) parts.push(box(0.022, y1 - y0, 0.016, SEAM, [x, (y0 + y1) / 2, zf + 0.008]));
  for (let z = zb + 0.32; z < zf - 0.1; z += 0.32) parts.push(box(0.016, y1 - y0, 0.022, SEAM, [x1 + 0.008, (y0 + y1) / 2, z]));
  parts.push(box(x1 - x0 + 0.02, 0.1, zf - zb + 0.02, MODERN_BAND, [1.5, y1 - 0.05, cz]));
  for (const [x, z] of [
    [x0, zf],
    [x1, zf],
    [x1, zb],
  ])
    parts.push(box(0.05, y1 - y0, 0.05, 0xc9ced4, [x, (y0 + y1) / 2, z]));
  // bandeaux vitrés
  windows.push(glassPane(2.3, 0.2, [1.5, 1.02, zf + 0.012]));
  for (const y of [0.9, 1.14]) parts.push(box(2.38, 0.04, 0.04, FRAME, [1.5, y, zf + 0.02]));
  for (let i = 0; i <= 6; i++) parts.push(box(0.03, 0.24, 0.035, FRAME, [0.35 + (i * 2.3) / 6, 1.02, zf + 0.025]));
  windows.push(glassPane(1.24, 0.2, [x1 + 0.012, 1.02, cz], Math.PI / 2));
  for (const y of [0.9, 1.14]) parts.push(box(0.04, 0.04, 1.32, FRAME, [x1 + 0.02, y, cz]));
  for (let i = 0; i <= 3; i++) parts.push(box(0.035, 0.24, 0.03, FRAME, [x1 + 0.025, 1.02, cz - 0.62 + (i * 1.24) / 3]));
  // ventilateurs d'extraction sur le côté
  for (const z of [0.55, 1.35]) {
    parts.push(cyl(0.2, 0.2, 0.07, 16, FRAME, [x1 + 0.035, 0.52, z], [0, 0, Math.PI / 2]));
    parts.push(cyl(0.165, 0.165, 0.02, 16, 0x2a2f3a, [x1 + 0.07, 0.52, z], [0, 0, Math.PI / 2]));
    for (const a of [0, Math.PI / 4, Math.PI / 2, -Math.PI / 4]) parts.push(box(0.012, 0.33, 0.018, 0xb7c0c7, [x1 + 0.082, 0.52, z], [a, 0, 0]));
    parts.push(cyl(0.045, 0.045, 0.03, 10, 0xb7c0c7, [x1 + 0.088, 0.52, z], [0, 0, Math.PI / 2]));
  }
  // toit en bac acier, panneaux solaires, faîtière ventilée
  const roof = gableRoof(parts, { cx: 1.5, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.5, over: 0.12, side: 0.1, a: 0x939da7, b: 0x838d97, style: 'ribs', ridge: 0x6b7580, rive: 0x6b7580, gable: PANEL });
  const r: V3 = [roof.slope, 0, 0];
  for (const px of [0.62, 1.5, 2.38]) {
    const [y, z] = roof.at(1, roof.len * 0.47, 0.1);
    parts.push(box(0.8, 0.03, 0.66, 0xc9ced4, [px, y - 0.012, z], r));
    parts.push(box(0.74, 0.03, 0.6, 0x22407a, [px, y, z], r));
    const [gy, gz] = roof.at(1, roof.len * 0.47, 0.117);
    for (const dx of [-0.185, 0, 0.185]) parts.push(box(0.012, 0.01, 0.6, 0x4a6fb5, [px + dx, gy, gz], r));
    for (const ds of [-0.15, 0, 0.15]) {
      const [ly, lz] = roof.at(1, roof.len * 0.47 + ds, 0.117);
      parts.push(box(0.74, 0.01, 0.012, 0x4a6fb5, [px, ly, lz], r));
    }
  }
  parts.push(box(2.5, 0.07, 0.2, 0x6b7580, [1.5, roof.ridgeY + 0.02, cz]));
  for (let i = 0; i < 8; i++) parts.push(box(0.12, 0.05, 0.21, 0x3d4550, [0.4 + i * 0.31, roof.ridgeY + 0.02, cz]));
  parts.push(cyl(0.12, 0.12, 0.03, 14, FRAME, [x1 + 0.015, y1 + 0.2, cz], [0, 0, Math.PI / 2]));
  // gouttière et descente
  const [ey, ez] = roof.at(1, roof.len, 0);
  parts.push(box(x1 - x0 + 0.2, 0.06, 0.08, 0xc9ccd1, [1.5, ey - 0.045, ez - 0.02]));
  parts.push(cyl(0.025, 0.025, ey - 0.1, 8, 0xc9ccd1, [x1 + 0.06, (ey + 0.05) / 2, zf + 0.06]));
  parts.push(box(0.05, 0.04, ez - zf - 0.04, 0xc9ccd1, [x1 + 0.06, ey - 0.06, (ez + zf) / 2 + 0.02]));
  // trappe assez haute pour un coq, écran de contrôle, rampe de béton rainurée jusqu'au sol
  // (le moteur de la trappe automatique est un kit à part, posé à l'achat : models.ts)
  henDoor(parts, 1.5, 0.09, 0.62, 0.42, zf + 0.012, FRAME);
  parts.push(box(0.22, 0.17, 0.02, 0x2a2f3a, [2.02, 0.62, zf + 0.012]));
  windows.push(glassPane(0.17, 0.12, [2.02, 0.62, zf + 0.025], 0, 0.012));
  ramp(parts, 1.5, 0.09, zf + 0.01, 2.17, 0.52, 0xc4c7cb, 0xaeb2b7);
}

/**
 * Fenêtre à petits carreaux et cadre blanc, sur une façade bardée tournée vers +z (ou +x) ; (x, z)
 * est la surface du mur. Chaque couche est franchement devant la précédente — fond sombre, vitre,
 * puis cadre et croisillons — et toutes devant les planches (2,2 cm) : rien ne scintille au zoom.
 */
function farmWindow(parts: Parts, windows: THREE.Mesh[], x: number, y: number, z: number, w: number, h: number, onX = false) {
  const ry = onX ? Math.PI / 2 : 0;
  const B = (bw: number, bh: number, bd: number, c: number, p: V3) => parts.push(onX ? box(bd, bh, bw, c, p) : box(bw, bh, bd, c, p));
  const u0 = onX ? z : x;
  const at = (u: number, v: number, o: number): V3 => (onX ? [x + o, v, u] : [u, v, z + o]);
  // embrasure sombre, puis la vitre (qui s'allume le soir)
  B(w + 0.03, h + 0.03, 0.012, 0x2e2a28, at(u0, y, 0.028));
  const pane = at(u0, y, 0.04);
  windows.push(glassPane(w, h, pane, ry, 0.01));
  // cadre, appui saillant, croisillons devant la vitre
  B(w + 0.08, 0.045, 0.03, TRIM, at(u0, y + h / 2 + 0.022, 0.05));
  B(w + 0.14, 0.05, 0.08, TRIM, at(u0, y - h / 2 - 0.024, 0.055));
  for (const s2 of [-1, 1]) B(0.045, h + 0.07, 0.03, TRIM, at(u0 + s2 * (w / 2 + 0.022), y, 0.05));
  B(0.022, h, 0.016, TRIM, at(u0, y, 0.052));
  B(w, 0.022, 0.016, TRIM, at(u0, y + h * 0.1, 0.052));
}

/**
 * Niveau 5 — grand poulailler moderne (dessiné sur 4 × 2,5) : la suite directe du niveau 4, en plus
 * grand. Mêmes panneaux isolés, même bandeau bleu nuit et même toit en bac acier, avec des panneaux
 * solaires en plus, une faîtière ventilée, deux cheminées d'extraction et une petite trémie de grain,
 * annonce du silo du niveau 6. Trappe et rampe de béton au centre de la façade.
 */
export function coopModernLarge(parts: Parts, windows: THREE.Mesh[]) {
  const x0 = 0.12;
  const x1 = 3.88;
  const zb = 0.18;
  const zf = 2.18;
  const y0 = 0.12;
  const y1 = 1.36;
  const cx = 2;
  const cz = (zb + zf) / 2;
  // longrine de béton, panneaux isolés et leurs joints, bandeaux du haut et du bas
  parts.push(box(x1 - x0 + 0.08, y0, zf - zb + 0.08, 0x8e939b, [cx, y0 / 2, cz]));
  parts.push(box(x1 - x0, y1 - y0, zf - zb, MODERN_PANEL, [cx, (y0 + y1) / 2, cz]));
  for (let x = x0 + 0.32; x < x1 - 0.1; x += 0.32) parts.push(box(0.02, y1 - y0, 0.016, MODERN_SEAM, [x, (y0 + y1) / 2, zf + 0.008]));
  for (let z = zb + 0.32; z < zf - 0.1; z += 0.32) parts.push(box(0.016, y1 - y0, 0.02, MODERN_SEAM, [x1 + 0.008, (y0 + y1) / 2, z]));
  parts.push(box(x1 - x0 + 0.02, 0.1, zf - zb + 0.02, MODERN_BAND, [cx, y1 - 0.05, cz]));
  parts.push(box(x1 - x0 + 0.02, 0.05, 0.04, MODERN_BAND, [cx, y0 + 0.05, zf + 0.02]));
  parts.push(box(0.04, 0.05, zf - zb + 0.02, MODERN_BAND, [x1 + 0.02, y0 + 0.05, cz]));
  for (const [x, z] of [
    [x0, zf],
    [x1, zf],
    [x1, zb],
  ])
    parts.push(box(0.05, y1 - y0, 0.05, 0xc9ced4, [x, (y0 + y1) / 2, z]));
  // bandeaux vitrés sur la façade (coupés par la trappe) et le côté
  for (const [a, b] of [
    [0.34, 1.62],
    [2.38, 3.66],
  ]) {
    windows.push(glassPane(b - a, 0.2, [(a + b) / 2, 1.06, zf + 0.012]));
    for (const y of [0.94, 1.18]) parts.push(box(b - a + 0.06, 0.04, 0.04, MODERN_FRAME, [(a + b) / 2, y, zf + 0.02]));
    for (let k = 0; k <= 4; k++) parts.push(box(0.03, 0.24, 0.035, MODERN_FRAME, [a + (k * (b - a)) / 4, 1.06, zf + 0.025]));
  }
  windows.push(glassPane(1.56, 0.2, [x1 + 0.012, 1.06, cz], Math.PI / 2));
  for (const y of [0.94, 1.18]) parts.push(box(0.04, 0.04, 1.64, MODERN_FRAME, [x1 + 0.02, y, cz]));
  for (let k = 0; k <= 4; k++) parts.push(box(0.035, 0.24, 0.03, MODERN_FRAME, [x1 + 0.025, 1.06, cz - 0.78 + (k * 1.56) / 4]));
  // ventilateurs d'extraction sur le côté
  for (const z of [0.62, 1.2, 1.78]) {
    parts.push(cyl(0.2, 0.2, 0.07, 16, MODERN_FRAME, [x1 + 0.035, 0.52, z], [0, 0, Math.PI / 2]));
    parts.push(cyl(0.165, 0.165, 0.02, 16, 0x2a2f3a, [x1 + 0.07, 0.52, z], [0, 0, Math.PI / 2]));
    for (const a of [0, Math.PI / 4, Math.PI / 2, -Math.PI / 4]) parts.push(box(0.012, 0.33, 0.018, 0xb7c0c7, [x1 + 0.082, 0.52, z], [a, 0, 0]));
    parts.push(cyl(0.045, 0.045, 0.03, 10, 0xb7c0c7, [x1 + 0.088, 0.52, z], [0, 0, Math.PI / 2]));
  }
  // toit en bac acier, panneaux solaires, faîtière ventilée, cheminées d'extraction
  const roof = gableRoof(parts, { cx, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.56, over: 0.14, side: 0.1, a: 0x939da7, b: 0x838d97, style: 'ribs', ridge: 0x6b7580, rive: 0x6b7580, gable: MODERN_PANEL });
  const r: V3 = [roof.slope, 0, 0];
  for (const px of [0.72, 1.57, 2.43, 3.28]) {
    const [y, z] = roof.at(1, roof.len * 0.48, 0.1);
    parts.push(box(0.76, 0.03, 0.7, 0xc9ced4, [px, y - 0.012, z], r));
    parts.push(box(0.7, 0.03, 0.64, 0x22407a, [px, y, z], r));
    const [gy, gz] = roof.at(1, roof.len * 0.48, 0.117);
    for (const dx of [-0.175, 0, 0.175]) parts.push(box(0.012, 0.01, 0.64, 0x4a6fb5, [px + dx, gy, gz], r));
    for (const ds of [-0.16, 0, 0.16]) {
      const [ly, lz] = roof.at(1, roof.len * 0.48 + ds, 0.117);
      parts.push(box(0.7, 0.01, 0.012, 0x4a6fb5, [px, ly, lz], r));
    }
  }
  parts.push(box(x1 - x0 - 0.3, 0.07, 0.2, 0x6b7580, [cx, roof.ridgeY + 0.02, cz]));
  for (let i = 0; i < 10; i++) parts.push(box(0.12, 0.05, 0.21, 0x3d4550, [0.5 + i * 0.334, roof.ridgeY + 0.02, cz]));
  for (const px of [1.15, 2.85]) {
    parts.push(cyl(0.11, 0.11, 0.34, 14, 0xb7c0c7, [px, roof.ridgeY + 0.14, cz]));
    parts.push(cyl(0.17, 0.17, 0.035, 14, 0x8e939b, [px, roof.ridgeY + 0.33, cz]));
    parts.push(cone(0.18, 0.09, 14, 0x8e939b, [px, roof.ridgeY + 0.39, cz]));
  }
  // gouttière et descente
  const [ey, ez] = roof.at(1, roof.len, 0);
  parts.push(box(x1 - x0 + 0.22, 0.06, 0.08, 0xc9ccd1, [cx, ey - 0.045, ez - 0.02]));
  parts.push(cyl(0.025, 0.025, ey - 0.1, 8, 0xc9ccd1, [x1 + 0.06, (ey + 0.05) / 2, zf + 0.06]));
  parts.push(box(0.05, 0.04, ez - zf - 0.04, 0xc9ccd1, [x1 + 0.06, ey - 0.06, (ez + zf) / 2 + 0.02]));
  // trappe, écran de contrôle, rampe de béton rainurée (mêmes que le niveau 4)
  henDoor(parts, cx, 0.12, 0.62, 0.44, zf + 0.012, MODERN_FRAME);
  parts.push(box(0.22, 0.17, 0.02, 0x2a2f3a, [cx + 0.5, 0.62, zf + 0.012]));
  windows.push(glassPane(0.17, 0.12, [cx + 0.5, 0.62, zf + 0.025], 0, 0.012));
  ramp(parts, cx, 0.12, zf + 0.01, 2.62, 0.5, 0xc4c7cb, 0xaeb2b7);
  // petite trémie à grain sur pieds et sa vis, contre le pignon arrière
  const hx = 0.6;
  const hz = zb - 0.02;
  for (const dx of [-0.13, 0.13]) parts.push(box(0.04, 0.42, 0.04, 0x8e939b, [hx + dx, 0.21, hz - 0.02]));
  parts.push(cone(0.2, 0.2, 14, 0xd9dee2, [hx, 0.5, hz - 0.02], [Math.PI, 0, 0]));
  parts.push(cyl(0.21, 0.21, 0.6, 16, 0xeef1f3, [hx, 0.9, hz - 0.02]));
  parts.push(cyl(0.213, 0.213, 0.02, 16, MODERN_BAND, [hx, 0.9, hz - 0.02]));
  parts.push(cone(0.23, 0.2, 16, 0xc9ced3, [hx, 1.3, hz - 0.02]));
}

/**
 * Niveau 6 — bâtiment avicole plein air (dessiné sur 5 × 3) : long bâtiment en panneaux isolants
 * sur longrine de béton, bandeaux vitrés, plusieurs trappes de sortie (celle du centre a sa rampe),
 * toit en bac acier avec cheminées d'extraction et panneaux solaires, silo à grain et local
 * technique au bout, avec sa vis d'alimentation.
 */
export function coopAviary(parts: Parts, windows: THREE.Mesh[]) {
  const x0 = 0.1;
  const x1 = 4.25;
  const zb = 0.22;
  const zf = 2.64;
  const y0 = 0.12;
  const y1 = 1.32;
  const cx = (x0 + x1) / 2;
  const cz = (zb + zf) / 2;
  const PANEL = MODERN_PANEL;
  const SEAM = MODERN_SEAM;
  const FRAME = MODERN_FRAME;
  parts.push(box(x1 - x0 + 0.08, y0, zf - zb + 0.08, 0x9aa0a6, [cx, y0 / 2, cz]));
  parts.push(box(x1 - x0, y1 - y0, zf - zb, PANEL, [cx, (y0 + y1) / 2, cz]));
  for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.3) parts.push(box(0.02, y1 - y0, 0.014, SEAM, [x, (y0 + y1) / 2, zf + 0.007]));
  for (let z = zb + 0.3; z < zf - 0.1; z += 0.3) parts.push(box(0.014, y1 - y0, 0.02, SEAM, [x1 + 0.007, (y0 + y1) / 2, z]));
  parts.push(box(x1 - x0 + 0.02, 0.08, zf - zb + 0.02, MODERN_BAND, [cx, y1 - 0.04, cz]));
  parts.push(box(x1 - x0 + 0.02, 0.06, 0.04, MODERN_BAND, [cx, y0 + 0.06, zf + 0.02]));
  for (const [x, z] of [
    [x0, zf],
    [x1, zf],
    [x1, zb],
  ])
    parts.push(box(0.05, y1 - y0, 0.05, 0xc9ced4, [x, (y0 + y1) / 2, z]));
  // bandeaux vitrés hauts (lumière naturelle) sur la façade et le côté
  for (const [a, b] of [
    [0.3, 1.95],
    [3.05, 4.05],
  ]) {
    windows.push(glassPane(b - a, 0.18, [(a + b) / 2, 1.06, zf + 0.012]));
    for (const y of [0.96, 1.16]) parts.push(box(b - a + 0.06, 0.035, 0.035, FRAME, [(a + b) / 2, y, zf + 0.02]));
    for (let x = a; x <= b + 1e-3; x += (b - a) / 5) parts.push(box(0.03, 0.22, 0.03, FRAME, [x, 1.06, zf + 0.022]));
  }
  windows.push(glassPane(1.8, 0.18, [x1 + 0.012, 1.06, cz], Math.PI / 2));
  for (const y of [0.96, 1.16]) parts.push(box(0.035, 0.035, 1.86, FRAME, [x1 + 0.02, y, cz]));
  // trappes de sortie : trois sur la façade (celle du centre a sa rampe, x = 2,5), volets relevés
  for (const x of [1.0, 2.5, 3.6]) {
    henDoor(parts, x, 0.1, 0.64, 0.4, zf + 0.012, FRAME);
    if (x !== 2.5) parts.push(box(0.44, 0.03, 0.1, 0x8e939b, [x, 0.69, zf + 0.06], [0.6, 0, 0]));
  }
  ramp(parts, 2.5, 0.1, zf + 0.02, 3.1, 0.42, 0xb7c0c7, 0x8e939b);
  for (const x of [1.0, 3.6]) parts.push(box(0.5, 0.04, 0.32, 0xc4c7cb, [x, 0.02, zf + 0.2]));
  // toit en bac acier : cheminées d'extraction, panneaux solaires, faîtière
  const roof = gableRoof(parts, { cx, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.5, over: 0.12, side: 0.1, a: 0x939da7, b: 0x838d97, style: 'ribs', ridge: 0x6b7580, rive: 0x6b7580, gable: PANEL });
  const r: V3 = [roof.slope, 0, 0];
  for (const px of [0.7, 1.55, 2.4, 3.25]) {
    const [y, z] = roof.at(1, roof.len * 0.48, 0.1);
    parts.push(box(0.78, 0.03, 0.7, 0xc9ced4, [px, y - 0.012, z], r));
    parts.push(box(0.72, 0.03, 0.64, 0x22407a, [px, y, z], r));
    const [gy, gz] = roof.at(1, roof.len * 0.48, 0.117);
    for (const dx of [-0.18, 0, 0.18]) parts.push(box(0.012, 0.01, 0.64, 0x4a6fb5, [px + dx, gy, gz], r));
  }
  for (const px of [0.9, 2.17, 3.45]) {
    parts.push(cyl(0.13, 0.13, 0.42, 14, 0xb7c0c7, [px, roof.ridgeY + 0.16, cz]));
    parts.push(cyl(0.2, 0.2, 0.04, 14, 0x8e939b, [px, roof.ridgeY + 0.4, cz]));
    parts.push(cone(0.21, 0.1, 14, 0x8e939b, [px, roof.ridgeY + 0.47, cz]));
  }
  const [ey, ez] = roof.at(1, roof.len, 0);
  parts.push(box(x1 - x0 + 0.2, 0.06, 0.08, 0xc9ccd1, [cx, ey - 0.045, ez - 0.02]));
  parts.push(cyl(0.025, 0.025, ey - 0.1, 8, 0xc9ccd1, [x1 + 0.06, (ey + 0.05) / 2, zf + 0.06]));
  // local technique au bout (porte, fenêtre, climatiseur)
  const ax0 = x1 + 0.08;
  const ax1 = 4.92;
  parts.push(box(ax1 - ax0, 0.95, 0.9, 0xe9ece8, [(ax0 + ax1) / 2, 0.475, zf - 0.5]));
  parts.push(box(ax1 - ax0 + 0.1, 0.06, 1.0, 0x5f6870, [(ax0 + ax1) / 2, 0.98, zf - 0.5]));
  parts.push(box(0.3, 0.62, 0.03, FRAME, [(ax0 + ax1) / 2, 0.33, zf - 0.04]));
  parts.push(box(0.03, 0.03, 0.035, 0xd9b35a, [(ax0 + ax1) / 2 + 0.1, 0.33, zf - 0.02]));
  parts.push(box(0.26, 0.16, 0.12, 0xd8dcdf, [ax1 + 0.06, 0.7, zf - 0.6]));
  // silo à grain sur pieds, échelle, vis d'alimentation vers le bâtiment
  const sx = 4.55;
  const sz = 0.75;
  for (const [dx, dz2] of [
    [-0.2, -0.2],
    [0.2, -0.2],
    [-0.2, 0.2],
    [0.2, 0.2],
  ])
    parts.push(box(0.04, 0.55, 0.04, 0x8e939b, [sx + dx, 0.27, sz + dz2]));
  parts.push(cone(0.3, 0.3, 18, 0xd9dee2, [sx, 0.68, sz], [Math.PI, 0, 0]));
  parts.push(cyl(0.31, 0.31, 1.45, 20, 0xeef1f3, [sx, 1.55, sz]));
  for (let i = 0; i < 6; i++) parts.push(cyl(0.313, 0.313, 0.02, 20, i === 3 ? MODERN_BAND : 0xc9ced3, [sx, 0.92 + i * 0.25, sz]));
  parts.push(cone(0.34, 0.32, 20, 0xc9ced3, [sx, 2.43, sz]));
  for (const dx of [-0.07, 0.07]) parts.push(box(0.015, 1.9, 0.015, 0x8e939b, [sx + dx, 1.45, sz + 0.33]));
  for (let i = 0; i < 11; i++) parts.push(box(0.15, 0.012, 0.012, 0x8e939b, [sx, 0.6 + i * 0.17, sz + 0.33]));
  parts.push(cyl(0.04, 0.04, 0.8, 8, 0x8e939b, [sx - 0.42, 1.3, sz], [0, 0, 1.0]));
}

// ============================================================ ABRIS À OIES ====
/**
 * Abri à oies, un modèle par niveau (dessiné à l'échelle 1, façade et porte vers +z, porte centrée
 * en x = W/2) : les oies entrent de plain-pied par une porte large et basse (seuil presque nul).
 * Niveau 1 : loge en planches au toit de bardeaux, vantail ouvert, paille, bassine.
 * Niveau 2 : grande loge sur soubassement de pierre, planches gris-bleu, tuiles, abat-vent, bac.
 * Niveau 3 : maison de pierre à pignons colombés, ardoises, grande porte cintrée, petite mare.
 * Repères (profondeur de la façade, seuil, pied) dans GOOSE_DOORS (farmRenderer.ts).
 */
export function gooseHouse(parts: Parts, windows: THREE.Mesh[], level: number) {
  const W = level === 1 ? 4 : level === 2 ? 5 : 6;
  const D = level === 3 ? 4 : 3;
  const x0 = 0.25;
  const x1 = W - 0.25;
  const zb = 0.3;
  const zf = D - 0.55;
  const cx = W / 2;
  const cz = (zb + zf) / 2;
  const yb = level === 1 ? 0.06 : 0.3;
  const y1 = level === 3 ? 1.55 : level === 2 ? 1.25 : 1.05;
  const doorW = 0.95;
  const doorH = level === 3 ? 0.95 : 0.78;
  // murs
  if (level === 1) {
    parts.push(box(x1 - x0, y1, zf - zb, 0x8a6a48, [cx, y1 / 2, cz]));
    boardsZ(parts, x0, x1, 0.02, y1, zf, C.wood, 0xc2884d, 0.18);
    boardsX(parts, zb, zf, 0.02, y1, x1, C.wood, 0xc2884d, 0.18);
  } else if (level === 2) {
    parts.push(box(x1 - x0 + 0.06, yb, zf - zb + 0.06, STONE, [cx, yb / 2, cz]));
    parts.push(box(x1 - x0, y1 - yb, zf - zb, 0x5d6d78, [cx, (yb + y1) / 2, cz]));
    boardsZ(parts, x0, x1, yb, y1, zf, 0x7b8d99, 0x6c7d89, 0.16);
    boardsX(parts, zb, zf, yb, y1, x1, 0x7b8d99, 0x6c7d89, 0.16);
    for (const [x, z] of [
      [x0, zf],
      [x1, zf],
      [x1, zb],
    ])
      parts.push(box(0.07, y1 - yb, 0.07, TRIM, [x, (yb + y1) / 2, z]));
  } else {
    parts.push(box(x1 - x0, y1, zf - zb, STONE, [cx, y1 / 2, cz]));
    // moellons en relief et chaînes d'angle
    for (let i = 0; i < 40; i++) parts.push(box(0.16 + rnd(i) * 0.12, 0.08 + rnd(i + 50) * 0.06, 0.025, rnd(i + 90) < 0.5 ? STONE_DARK : 0xcabfad, [x0 + 0.12 + rnd(i + 7) * (x1 - x0 - 0.24), 0.08 + rnd(i + 13) * (y1 - 0.16), zf + 0.015]));
    for (let i = 0; i < 24; i++) parts.push(box(0.025, 0.08 + rnd(i + 150) * 0.06, 0.16 + rnd(i + 170) * 0.12, rnd(i + 190) < 0.5 ? STONE_DARK : 0xcabfad, [x1 + 0.015, 0.08 + rnd(i + 210) * (y1 - 0.16), zb + 0.12 + rnd(i + 230) * (zf - zb - 0.24)]));
    for (const sx of [-1, 1])
      for (let y = 0.12, k = 0; y < y1 - 0.1; y += 0.2, k++) parts.push(box(k % 2 ? 0.18 : 0.3, 0.17, 0.04, 0xe4dccb, [cx + sx * (W / 2 - 0.25 - (k % 2 ? 0.09 : 0.15)), y + 0.08, zf + 0.02]));
  }
  // porte large et basse (plain-pied), encadrement
  const frame = level === 3 ? 0xd8cfbd : TRIM;
  parts.push(box(doorW, doorH, 0.03, 0x2f2620, [cx, doorH / 2 + 0.02, zf + 0.035]));
  parts.push(box(doorW + 0.14, 0.08, 0.06, frame, [cx, doorH + 0.06, zf + 0.05]));
  for (const s2 of [-1, 1]) parts.push(box(0.07, doorH + 0.06, 0.06, frame, [cx + s2 * (doorW / 2 + 0.035), doorH / 2 + 0.04, zf + 0.05]));
  if (level === 3) parts.push(cyl(doorW / 2 + 0.07, doorW / 2 + 0.07, 0.06, 14, frame, [cx, doorH + 0.04, zf + 0.05], [Math.PI / 2, 0, 0], [1, 0.45, 1]));
  // vantail grand ouvert, contre la façade
  const leafC = level === 2 ? 0x6c7d89 : C.woodDark;
  parts.push(box(0.04, doorH - 0.04, doorW * 0.95, leafC, [cx + doorW / 2 + 0.08, doorH / 2 + 0.03, zf + 0.05 + doorW * 0.47], [0, 0.12, 0]));
  for (const y of [0.18, doorH - 0.15]) parts.push(box(0.05, 0.05, doorW * 0.9, IRON, [cx + doorW / 2 + 0.11, y, zf + 0.05 + doorW * 0.47], [0, 0.12, 0]));
  // toit
  if (level === 1) {
    gableRoof(parts, { cx, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.62, over: 0.16, side: 0.12, a: 0x8b7458, b: 0x7a6449, n: 7, ridge: 0x5e4c38, rive: TIMBER, gable: C.wood });
  } else if (level === 2) {
    const roof = gableRoof(parts, { cx, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.72, over: 0.16, side: 0.14, a: 0xb5573b, b: 0xa24b33, n: 7, ridge: 0x8a3c29, rive: TIMBER, gable: 0x7b8d99 });
    // abat-vent d'aération sur le faîtage
    for (const ax of [cx - 1.1, cx + 1.1]) {
      parts.push(box(0.36, 0.22, 0.3, 0x7b8d99, [ax, roof.ridgeY + 0.1, cz]));
      for (let k = 0; k < 3; k++) parts.push(box(0.3, 0.025, 0.04, TRIM, [ax, roof.ridgeY + 0.04 + k * 0.06, cz + 0.155], [0.5, 0, 0]));
      parts.push(prism(0.44, 0.16, 0.4, 0xa24b33, [ax, roof.ridgeY + 0.21, cz]));
    }
  } else {
    const roof = gableRoof(parts, { cx, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.95, over: 0.18, side: 0.16, a: 0x5f6b78, b: 0x55606b, n: 9, ridge: 0x46505a, rive: 0x46505a, gable: 0xf1e8d6 });
    // pignon à colombages et lucarne-girouette
    for (const t of [0.3, 0.55, 0.8]) parts.push(box(0.05, 0.05, 0.05, TIMBER, [x1 + 0.02, y1 + t * 0.6, cz]));
    weathervane(parts, cx, roof.ridgeY, cz, 1);
  }
  // fenêtres et aérations
  if (level === 1) {
    for (const z of [cz - 0.4, cz + 0.4]) {
      parts.push(box(0.03, 0.18, 0.34, 0x2f2620, [x1 + 0.03, 0.72, z]));
      for (let k = 0; k < 4; k++) parts.push(box(0.035, 0.02, 0.36, C.woodDark, [x1 + 0.04, 0.65 + k * 0.045, z]));
    }
  } else {
    const fy = level === 3 ? 1.1 : 0.92;
    for (const x of [cx - (level === 3 ? 1.75 : 1.4), cx + (level === 3 ? 1.75 : 1.4)]) farmWindow(parts, windows, x, fy, zf + 0.012, 0.4, 0.32);
    farmWindow(parts, windows, x1 + 0.012, fy, cz, 0.36, 0.3, true);
  }
  // abords : paille devant la porte, plumes, bassine ou bac à eau, bottes de paille
  for (let i = 0; i < 9; i++) parts.push(box(0.2 + rnd(i + 400) * 0.25, 0.015, 0.03, 0xe8cf7a, [cx + (rnd(i + 410) - 0.5) * 1.2, 0.012, zf + 0.15 + rnd(i + 420) * 0.35], [0, rnd(i + 430) * 3, 0]));
  for (let i = 0; i < 5; i++) parts.push(box(0.05, 0.008, 0.02, 0xf4f2ec, [cx + (rnd(i + 500) - 0.5) * 2, 0.012, zf + 0.3 + rnd(i + 510) * 0.25], [0, rnd(i + 520) * 3, 0]));
  if (level === 1) {
    parts.push(cyl(0.22, 0.19, 0.12, 16, 0xc3cad0, [x0 + 0.45, 0.07, zf + 0.3]));
    parts.push(cyl(0.2, 0.2, 0.01, 16, 0x7cc7ee, [x0 + 0.45, 0.12, zf + 0.3]));
    parts.push(box(0.36, 0.24, 0.24, C.straw, [x1 - 0.35, 0.12, zf + 0.25]));
  } else if (level === 2) {
    parts.push(box(0.8, 0.2, 0.32, 0x3a3f46, [x0 + 0.65, 0.1, zf + 0.28]));
    parts.push(box(0.72, 0.01, 0.24, 0x7cc7ee, [x0 + 0.65, 0.19, zf + 0.28]));
    for (const [x, y] of [
      [x1 - 0.55, 0.12],
      [x1 - 0.2, 0.12],
      [x1 - 0.38, 0.36],
    ])
      parts.push(box(0.34, 0.24, 0.24, C.straw, [x, y, zf + 0.25]));
  } else {
    // petite mare de pierre au coin, roseaux
    const px = x1 - 0.45;
    const pz = zf + 0.28;
    parts.push(cyl(0.48, 0.5, 0.08, 18, STONE, [px, 0.04, pz], undefined, [1, 1, 0.55]));
    parts.push(cyl(0.4, 0.4, 0.02, 18, 0x6fb7d8, [px, 0.085, pz], undefined, [1, 1, 0.5]));
    for (let k = 0; k < 6; k++) parts.push(cyl(0.008, 0.012, 0.32 + rnd(k + 600) * 0.15, 4, 0x6f8f4a, [px + 0.35 + rnd(k + 610) * 0.1, 0.2, pz - 0.15 + k * 0.05]));
    parts.push(box(0.36, 0.24, 0.24, C.straw, [x0 + 0.35, 0.12, zf + 0.25]));
  }
  // enseigne à l'oie au-dessus de la porte
  parts.push(box(0.4, 0.15, 0.025, level === 2 ? TRIM : 0xe7d5b0, [cx, doorH + 0.24, zf + 0.06]));
  parts.push(sph(0.045, 8, 6, 0xf4f2ec, [cx - 0.03, doorH + 0.24, zf + 0.08], [1.5, 1, 0.3]));
  parts.push(box(0.012, 0.07, 0.01, 0xf4f2ec, [cx + 0.04, doorH + 0.28, zf + 0.08], [0, 0, -0.3]));
  parts.push(box(0.04, 0.012, 0.01, 0xf09a3c, [cx + 0.07, doorH + 0.31, zf + 0.08]));
}

// ================================================================ RÉSERVES ====
/** Cageot d'œufs (une rangée de six œufs sur alvéoles). Hauteur 0,17 : on les empile de 0,17 en 0,17. */
export function eggCrate() {
  const p: Parts = [box(0.32, 0.1, 0.24, 0xc99a63, [0, 0.05, 0]), box(0.3, 0.02, 0.22, 0xe9dcc2, [0, 0.1, 0])];
  for (const x of [-0.06, 0.06]) p.push(box(0.012, 0.1, 0.25, 0xb4844f, [x, 0.05, 0]));
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 2; j++) p.push(sph(0.04, 6, 4, (i + j) % 3 === 2 ? 0xd9a873 : 0xf6efe2, [-0.09 + i * 0.09, 0.125, -0.05 + j * 0.1], [1, 1.2, 1]));
  return merge(p);
}
/** Emplacements des cageots devant la réserve [x, z, y, rotation] (remplis selon le stock). */
export type CrateSpot = [number, number, number, number];

/** Niveau 1 — garde-manger en planches, porte à écharpe, aération, lanterne, petite table. */
export function storeLarder(parts: Parts, windows: THREE.Mesh[]): CrateSpot[] {
  const x0 = 0.35;
  const x1 = 1.65;
  const zb = 0.25;
  const zf = 1.35;
  const y0 = 0.08;
  const y1 = 0.98;
  parts.push(box(x1 - x0 + 0.06, y0, zf - zb + 0.06, STONE, [1, y0 / 2, (zb + zf) / 2]));
  parts.push(box(x1 - x0, y1 - y0, zf - zb, 0x8a5d36, [1, (y0 + y1) / 2, (zb + zf) / 2]));
  boardsZ(parts, x0, x1, y0, y1, zf, C.woodLight, 0xdcb27c, 0.16);
  boardsX(parts, zb, zf, y0, y1, x1, C.woodLight, 0xdcb27c, 0.16);
  for (const [x, z] of [
    [x0, zf],
    [x1, zf],
    [x1, zb],
  ])
    parts.push(box(0.06, y1 - y0, 0.06, C.woodDark, [x, (y0 + y1) / 2, z]));
  gableRoof(parts, { cx: 1, cz: (zb + zf) / 2, y: y1, w: x1 - x0, d: zf - zb, h: 0.44, over: 0.13, side: 0.12, a: 0x8a6a4a, b: 0x7d5f42, n: 5, ridge: 0x6b4f37, rive: C.woodDark, gable: C.woodLight });
  // porte à barres et écharpe, pentures
  const dz = zf + 0.022;
  parts.push(box(0.44, 0.74, 0.03, C.wood, [0.78, y0 + 0.37, dz + 0.012]));
  for (const y of [0.24, 0.68]) parts.push(box(0.4, 0.06, 0.02, C.woodDark, [0.78, y, dz + 0.035]));
  parts.push(box(0.05, 0.56, 0.02, C.woodDark, [0.78, 0.46, dz + 0.035], [0, 0, -Math.atan2(0.34, 0.42)]));
  for (const y of [0.24, 0.68]) parts.push(box(0.18, 0.025, 0.02, IRON, [0.66, y, dz + 0.048]));
  parts.push(sph(0.022, 6, 4, IRON, [0.95, 0.46, dz + 0.04]));
  // aération à lames
  parts.push(box(0.3, 0.26, 0.03, C.woodDark, [1.33, 0.68, dz + 0.012]));
  for (let i = 0; i < 4; i++) parts.push(box(0.25, 0.028, 0.03, C.woodLight, [1.33, 0.59 + i * 0.06, dz + 0.03], [0.5, 0, 0]));
  lantern(parts, windows, 1.1, 0.86, dz);
  // petite table où l'on pose les cageots
  parts.push(box(0.62, 0.04, 0.42, C.wood, [1.42, 0.3, 1.66]));
  for (const x of [1.15, 1.69]) for (const z of [1.49, 1.83]) parts.push(box(0.04, 0.27, 0.04, C.woodDark, [x, 0.165, z]));
  return [
    [1.26, 1.66, 0.32, 0],
    [1.58, 1.66, 0.32, 0],
    [0.5, 1.7, 0.05, 0.2],
    [1.42, 1.66, 0.49, 0.1],
    [0.5, 1.7, 0.22, 0.25],
    [0.5, 1.7, 0.39, 0.15],
  ];
}

/** Niveau 2 — cellier à persiennes (l'air circule), double porte grillagée, étagère à cageots. */
export function storeVented(parts: Parts, windows: THREE.Mesh[]): CrateSpot[] {
  const x0 = 0.2;
  const x1 = 1.8;
  const zb = 0.2;
  const zf = 1.3;
  const y0 = 0.1;
  const y1 = 1.1;
  const cz = (zb + zf) / 2;
  parts.push(box(x1 - x0 + 0.06, y0, zf - zb + 0.06, STONE, [1, y0 / 2, cz]));
  parts.push(box(x1 - x0, y1 - y0, zf - zb, 0x5b3d26, [1, (y0 + y1) / 2, cz]));
  // persiennes : lames inclinées sur la façade (de part et d'autre de la porte) et le côté
  for (let y = y0 + 0.07; y < y1 - 0.03; y += 0.085) {
    for (const [a, b] of [
      [x0, 0.43],
      [1.07, x1],
    ])
      parts.push(box(b - a, 0.06, 0.03, C.woodLight, [(a + b) / 2, y, zf + 0.012], [0.45, 0, 0]));
    parts.push(box(0.03, 0.06, zf - zb, C.woodLight, [x1 + 0.012, y, cz], [0, 0, -0.45]));
  }
  for (const [x, z] of [
    [x0, zf],
    [x1, zf],
    [x1, zb],
  ])
    parts.push(box(0.065, y1 - y0, 0.065, C.woodDark, [x, (y0 + y1) / 2, z]));
  parts.push(box(x1 - x0 + 0.04, 0.06, 0.05, C.woodDark, [1, y1 - 0.03, zf + 0.02]));
  gableRoof(parts, { cx: 1, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.46, over: 0.14, side: 0.12, a: 0xc0573f, b: 0xb04c36, n: 6, ridge: 0x9c4433, rive: C.woodDark, gable: C.woodLight });
  // double porte à moustiquaires
  for (const [x, s] of [
    [0.6, -1],
    [0.9, 1],
  ] as const) {
    parts.push(box(0.29, 0.84, 0.035, C.wood, [x, y0 + 0.42, zf + 0.02]));
    parts.push(box(0.19, 0.26, 0.02, 0x3a3f4a, [x, 0.72, zf + 0.04]));
    for (let i = 1; i < 4; i++) {
      parts.push(box(0.008, 0.26, 0.012, 0x8e939b, [x - 0.095 + i * 0.0475, 0.72, zf + 0.052]));
      parts.push(box(0.19, 0.008, 0.012, 0x8e939b, [x, 0.72 - 0.13 + i * 0.065, zf + 0.052]));
    }
    parts.push(box(0.2, 0.04, 0.02, C.woodDark, [x, 0.36, zf + 0.04]));
    parts.push(box(0.03, 0.1, 0.03, IRON, [x - s * 0.11, 0.5, zf + 0.05]));
  }
  // étagère à cageots à droite de la porte
  for (const x of [1.42, 2.0]) for (const z of [1.5, 1.88]) parts.push(box(0.04, 1.0, 0.04, C.woodDark, [x, 0.5, z]));
  for (const y of [0.25, 0.5, 0.75, 1.0]) parts.push(box(0.62, 0.03, 0.42, C.woodLight, [1.71, y, 1.69]));
  parts.push(box(0.62, 0.06, 0.03, C.woodDark, [1.71, 1.04, 1.9]));
  void windows;
  const R = Math.PI / 2;
  return [
    [1.56, 1.69, 0.265, R],
    [1.86, 1.69, 0.265, R],
    [1.56, 1.69, 0.515, R],
    [1.86, 1.69, 0.515, R],
    [1.56, 1.69, 0.765, R],
    [1.86, 1.69, 0.765, R],
  ];
}

/** Niveau 3 — chambre froide : panneaux isolés, porte inox, groupe froid, palette de cageots. */
export function storeCold(parts: Parts, windows: THREE.Mesh[]): CrateSpot[] {
  const x0 = 0.15;
  const x1 = 1.65;
  const zb = 0.15;
  const zf = 1.4;
  const y0 = 0.12;
  const y1 = 1.32;
  const cz = (zb + zf) / 2;
  const cx = (x0 + x1) / 2;
  parts.push(box(x1 - x0 + 0.08, y0, zf - zb + 0.08, 0x9aa0a6, [cx, y0 / 2, cz]));
  parts.push(box(x1 - x0, y1 - y0, zf - zb, 0xf4f6f8, [cx, (y0 + y1) / 2, cz]));
  for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.3) parts.push(box(0.018, y1 - y0, 0.014, 0xdde2e8, [x, (y0 + y1) / 2, zf + 0.007]));
  for (let z = zb + 0.31; z < zf - 0.1; z += 0.31) parts.push(box(0.014, y1 - y0, 0.018, 0xdde2e8, [x1 + 0.007, (y0 + y1) / 2, z]));
  for (const [x, z] of [
    [x0, zf],
    [x1, zf],
    [x1, zb],
  ])
    parts.push(box(0.05, y1 - y0, 0.05, 0xc9ced4, [x, (y0 + y1) / 2, z]));
  parts.push(box(x1 - x0 + 0.1, 0.08, zf - zb + 0.1, 0xdfe3e8, [cx, y1 + 0.04, cz]));
  parts.push(box(x1 - x0 + 0.12, 0.05, 0.05, 0xb9c1ca, [cx, y1 + 0.1, zf + 0.04]));
  // porte inox, poignée, plaque « froid », écran du thermomètre
  parts.push(box(0.58, 0.96, 0.03, 0x9aa3ad, [0.6, y0 + 0.48, zf + 0.015]));
  parts.push(box(0.5, 0.9, 0.03, 0xc9d1d9, [0.6, y0 + 0.46, zf + 0.035]));
  parts.push(box(0.05, 0.24, 0.05, FRAME_DARK, [0.8, 0.62, zf + 0.07]));
  parts.push(box(0.14, 0.035, 0.05, FRAME_DARK, [0.75, 0.66, zf + 0.09]));
  parts.push(box(0.2, 0.2, 0.02, C.blue, [0.6, 0.94, zf + 0.06]));
  for (const a of [0, Math.PI / 3, -Math.PI / 3]) parts.push(box(0.15, 0.02, 0.01, C.white, [0.6, 0.94, zf + 0.073], [0, 0, a]));
  parts.push(box(0.17, 0.11, 0.02, 0x2a2f3a, [1.08, 0.94, zf + 0.012]));
  windows.push(glassPane(0.13, 0.07, [1.08, 0.94, zf + 0.024], 0, 0.012));
  // groupe froid sur le côté, avec son ventilateur et ses tuyaux
  parts.push(box(0.3, 0.5, 0.62, 0xd7dce2, [x1 + 0.17, 0.42, cz]));
  parts.push(cyl(0.17, 0.17, 0.03, 14, 0x2a2f3a, [x1 + 0.33, 0.42, cz], [0, 0, Math.PI / 2]));
  for (const a of [0, Math.PI / 4, Math.PI / 2, -Math.PI / 4]) parts.push(box(0.01, 0.33, 0.016, 0xb7c0c7, [x1 + 0.345, 0.42, cz], [a, 0, 0]));
  for (const [z, c] of [
    [cz - 0.2, 0xc98a55],
    [cz - 0.12, 0xb7c0c7],
  ] as const)
    parts.push(cyl(0.022, 0.022, 0.3, 6, c, [x1 + 0.1, 0.8, z]));
  // palette de cageots devant la porte
  parts.push(box(0.76, 0.1, 0.54, C.wood, [1.42, 0.1, 1.73]));
  for (const x of [1.16, 1.42, 1.68]) parts.push(box(0.08, 0.06, 0.55, 0x8a5d36, [x, 0.07, 1.73]));
  return [
    [1.26, 1.61, 0.15, 0],
    [1.6, 1.61, 0.15, 0],
    [1.26, 1.86, 0.15, 0],
    [1.6, 1.86, 0.15, 0],
    [1.26, 1.61, 0.32, 0],
    [1.6, 1.61, 0.32, 0],
  ];
}

/** Niveau 4 — entrepôt réfrigéré : bardage nervuré, rideau métallique, quai, groupes froids. */
export function storeWarehouse(parts: Parts, windows: THREE.Mesh[]): CrateSpot[] {
  const x0 = 0.08;
  const x1 = 1.92;
  const zb = 0.08;
  const zf = 1.38;
  const y0 = 0.1;
  const y1 = 1.5;
  const cz = (zb + zf) / 2;
  parts.push(box(x1 - x0, y1 - y0, zf - zb, 0xeef1f4, [1, (y0 + y1) / 2, cz]));
  parts.push(box(x1 - x0 + 0.02, 0.14, zf - zb + 0.02, 0x6b7280, [1, y0 + 0.07, cz]));
  for (let x = x0 + 0.1; x < x1 - 0.04; x += 0.1) if (x < 0.8 || x > 1.7) parts.push(box(0.03, y1 - y0 - 0.14, 0.02, 0xd9dee4, [x, (y0 + y1 + 0.14) / 2, zf + 0.01]));
  for (let z = zb + 0.1; z < zf - 0.04; z += 0.1) if (z < 0.24 || z > 0.78) parts.push(box(0.02, y1 - y0 - 0.14, 0.03, 0xd9dee4, [x1 + 0.01, (y0 + y1 + 0.14) / 2, z]));
  // rideau métallique et son coffre
  parts.push(box(0.9, 1.0, 0.03, FRAME_DARK, [1.25, y0 + 0.5, zf + 0.015]));
  for (let i = 0; i < 15; i++) parts.push(box(0.8, 0.055, 0.03, i % 2 ? 0xc9ced4 : 0xb7bec6, [1.25, y0 + 0.04 + i * 0.062, zf + 0.035]));
  parts.push(box(0.92, 0.12, 0.1, 0x9aa3ad, [1.25, y0 + 1.04, zf + 0.05]));
  lantern(parts, windows, 1.25, 1.27, zf);
  parts.push(box(x1 - x0 + 0.02, 0.15, 0.03, C.blue, [1, y1 - 0.12, zf + 0.025]));
  parts.push(box(x1 - x0 + 0.02, 0.025, 0.035, C.white, [1, y1 - 0.2, zf + 0.03]));
  // porte de service bleue sur le côté
  parts.push(box(0.03, 0.82, 0.44, C.blue, [x1 + 0.02, y0 + 0.41, 0.51]));
  parts.push(box(0.04, 0.04, 0.1, IRON, [x1 + 0.04, 0.5, 0.65]));
  gableRoof(parts, { cx: 1, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.22, over: 0.08, side: 0.06, a: 0xa7b0b9, b: 0x97a0a9, style: 'ribs', ridge: 0x7f8993, rive: 0x7f8993, gable: 0xeef1f4 });
  // groupes froids sur le toit
  for (const ux of [0.55, 1.45]) {
    parts.push(box(0.46, 0.2, 0.42, 0xdfe3e8, [ux, y1 + 0.27, cz]));
    parts.push(cyl(0.15, 0.15, 0.03, 14, 0x2a2f3a, [ux, y1 + 0.385, cz]));
    for (const a of [0, Math.PI / 2]) parts.push(box(0.3, 0.012, 0.016, 0xb7c0c7, [ux, y1 + 0.405, cz], [0, a, 0]));
  }
  // quai de chargement
  parts.push(box(x1 - x0, 0.24, 0.5, 0xc9c9c4, [1, 0.12, zf + 0.25]));
  parts.push(box(x1 - x0, 0.03, 0.06, 0xf0c94a, [1, 0.245, zf + 0.47]));
  for (const x of [0.95, 1.55]) parts.push(box(0.1, 0.14, 0.06, 0x2b2b31, [x, 0.13, zf + 0.52]));
  return [
    [0.3, 1.52, 0.24, 0],
    [0.64, 1.52, 0.24, 0],
    [0.3, 1.76, 0.24, 0],
    [0.64, 1.76, 0.24, 0],
    [0.3, 1.52, 0.41, 0],
    [0.64, 1.52, 0.41, 0],
  ];
}

/**
 * Niveau 5 — plateforme frigorifique (dessinée sur 3 × 2, plus longue que les autres) : grand
 * volume en panneaux isolants, bandeau bleu, trois quais de chargement (portes sectionnelles, sas
 * d'étanchéité, butoirs, niveleurs), quai surélevé où s'empilent les palettes de cageots, groupes
 * froids et tuyauteries sur le toit, bureau d'expédition vitré au bout, porte de service.
 */
export function storeColdHub(parts: Parts, windows: THREE.Mesh[]): CrateSpot[] {
  const x0 = 0.08;
  const x1 = 2.45;
  const zb = 0.1;
  const zf = 1.25;
  const y0 = 0.1;
  const y1 = 1.6;
  const cx = (x0 + x1) / 2;
  const cz = (zb + zf) / 2;
  const PANEL = 0xf1f3f5;
  const SEAM = 0xd8dde3;
  // volume principal : panneaux isolants, soubassement, bandeau bleu, acrotère
  parts.push(box(x1 - x0, y1 - y0, zf - zb, PANEL, [cx, (y0 + y1) / 2, cz]));
  parts.push(box(x1 - x0 + 0.02, 0.16, zf - zb + 0.02, 0x6b7280, [cx, y0 + 0.08, cz]));
  for (let x = x0 + 0.12; x < x1 - 0.04; x += 0.12) parts.push(box(0.025, y1 - y0 - 0.16, 0.018, SEAM, [x, (y0 + y1 + 0.16) / 2, zf + 0.01]));
  for (let z = zb + 0.12; z < zf - 0.04; z += 0.12) parts.push(box(0.018, y1 - y0 - 0.16, 0.025, SEAM, [x1 + 0.01, (y0 + y1 + 0.16) / 2, z]));
  parts.push(box(x1 - x0 + 0.03, 0.17, 0.035, C.blue, [cx, y1 - 0.16, zf + 0.03]));
  parts.push(box(0.035, 0.17, zf - zb + 0.03, C.blue, [x1 + 0.03, y1 - 0.16, cz]));
  parts.push(box(x1 - x0 + 0.03, 0.03, 0.04, 0xffffff, [cx, y1 - 0.26, zf + 0.035]));
  parts.push(box(x1 - x0 + 0.06, 0.08, zf - zb + 0.06, 0xdfe3e8, [cx, y1 + 0.04, cz]));
  parts.push(box(x1 - x0 - 0.04, 0.03, zf - zb - 0.04, 0xb9c0c8, [cx, y1 + 0.02, cz]));
  // trois quais : portes sectionnelles, sas d'étanchéité noirs, butoirs, niveleurs
  const docks = [0.5, 1.2, 1.9];
  for (const dx of docks) {
    parts.push(box(0.56, 0.86, 0.06, 0x23262c, [dx, y0 + 0.62, zf + 0.03]));
    parts.push(box(0.5, 0.06, 0.08, 0x23262c, [dx, y0 + 1.07, zf + 0.05]));
    for (const s2 of [-1, 1]) parts.push(box(0.05, 0.86, 0.08, 0x23262c, [dx + s2 * 0.27, y0 + 0.62, zf + 0.05]));
    for (let i = 0; i < 7; i++) parts.push(box(0.44, 0.105, 0.03, i % 2 ? 0xd6dbe0 : 0xc6ccd3, [dx, y0 + 0.24 + i * 0.112, zf + 0.075]));
    parts.push(box(0.12, 0.05, 0.02, 0x9aa3ad, [dx, y0 + 0.3, zf + 0.095]));
    // feux de quai et butoirs
    parts.push(box(0.05, 0.05, 0.03, 0x48b86b, [dx - 0.34, y0 + 0.95, zf + 0.04]));
    parts.push(box(0.05, 0.05, 0.03, 0xd9534f, [dx - 0.34, y0 + 0.89, zf + 0.04]));
    for (const s2 of [-1, 1]) parts.push(box(0.07, 0.12, 0.06, 0x2b2b31, [dx + s2 * 0.2, 0.32, zf + 0.53]));
    parts.push(box(0.42, 0.02, 0.42, 0x8e939b, [dx, 0.27, zf + 0.25]));
  }
  // quai surélevé, bord jaune et noir, escalier
  parts.push(box(x1 - x0, 0.26, 0.5, 0xc9c9c4, [cx, 0.13, zf + 0.25]));
  for (let i = 0; i < 12; i++) parts.push(box((x1 - x0) / 12 - 0.01, 0.03, 0.05, i % 2 ? 0x2b2b31 : 0xf0c94a, [x0 + ((i + 0.5) * (x1 - x0)) / 12, 0.255, zf + 0.48]));
  for (let k = 0; k < 3; k++) parts.push(box(0.3, 0.08, 0.12, 0xb9b9b4, [x1 + 0.12, 0.04 + k * 0.08, zf + 0.42 - k * 0.12]));
  // groupes froids, tuyauteries et grille d'aération sur le toit
  for (const ux of [0.45, 1.05, 1.65]) {
    parts.push(box(0.46, 0.22, 0.4, 0xdfe3e8, [ux, y1 + 0.2, cz - 0.1]));
    for (const dz of [-0.09, 0.09]) {
      parts.push(cyl(0.085, 0.085, 0.02, 14, 0x2a2f3a, [ux - 0.1, y1 + 0.32, cz - 0.1 + dz * 1.6]));
      parts.push(cyl(0.085, 0.085, 0.02, 14, 0x2a2f3a, [ux + 0.1, y1 + 0.32, cz - 0.1 + dz * 1.6]));
    }
    parts.push(cyl(0.02, 0.02, 0.3, 8, 0xb7c0c7, [ux, y1 + 0.15, cz + 0.2], [Math.PI / 2, 0, 0]));
  }
  parts.push(cyl(0.025, 0.025, y1 - 0.2, 8, 0xb7c0c7, [x1 + 0.05, (y1 + 0.2) / 2, zb + 0.15]));
  parts.push(cyl(0.025, 0.025, y1 - 0.2, 8, 0xb7c0c7, [x1 + 0.05, (y1 + 0.2) / 2, zb + 0.25]));
  // bureau d'expédition vitré au bout (côté +x)
  const ox0 = x1 + 0.02;
  const ox1 = 2.95;
  const oz0 = 0.35;
  const oz1 = 1.3;
  const oy = 1.05;
  const ocx = (ox0 + ox1) / 2;
  const ocz = (oz0 + oz1) / 2;
  parts.push(box(ox1 - ox0, oy, oz1 - oz0, 0xe9ece8, [ocx, oy / 2, ocz]));
  parts.push(box(ox1 - ox0 + 0.06, 0.06, oz1 - oz0 + 0.06, 0x5f6870, [ocx, oy + 0.03, ocz]));
  windows.push(glassPane(ox1 - ox0 - 0.12, 0.34, [ocx, 0.66, oz1 + 0.012], 0, 0.02));
  for (let i = 0; i <= 3; i++) parts.push(box(0.03, 0.4, 0.035, FRAME_DARK, [ox0 + 0.06 + (i * (ox1 - ox0 - 0.12)) / 3, 0.66, oz1 + 0.025]));
  for (const y of [0.47, 0.85]) parts.push(box(ox1 - ox0 - 0.08, 0.03, 0.035, FRAME_DARK, [ocx, y, oz1 + 0.025]));
  windows.push(glassPane(oz1 - oz0 - 0.4, 0.34, [ox1 + 0.012, 0.66, ocz + 0.12], Math.PI / 2, 0.02));
  parts.push(box(0.035, 0.66, 0.26, C.blue, [ox1 + 0.02, 0.38, oz0 + 0.2]));
  parts.push(box(0.04, 0.04, 0.06, IRON, [ox1 + 0.045, 0.4, oz0 + 0.29]));
  parts.push(box(0.4, 0.1, 0.03, C.blue, [ocx, oy - 0.12, oz1 + 0.03]));
  parts.push(box(0.12, 0.05, 0.02, 0xffffff, [ocx, oy - 0.12, oz1 + 0.048]));
  lantern(parts, windows, ox1 - 0.05, 0.86, oz1);
  // porte de service sur le volume froid, à l'arrière du bureau
  parts.push(box(0.03, 0.82, 0.32, 0xe1e5ea, [x1 + 0.02, y0 + 0.41, zb + 0.08 + 0.16]));
  // palettes de cageots sur le quai (remplies selon le stock), une palette posée devant
  const spots: CrateSpot[] = [];
  for (const dx of [0.25, 0.85, 1.55, 2.2])
    for (const k of [0, 1, 2]) {
      spots.push([dx - 0.08, zf + 0.2, 0.3 + k * 0.17, 0]);
      spots.push([dx + 0.12, zf + 0.34, 0.3 + k * 0.17, 0.08]);
    }
  for (const dx of [0.25, 0.85, 1.55, 2.2]) parts.push(box(0.42, 0.04, 0.36, 0xc8a46f, [dx + 0.02, 0.28, zf + 0.27]));
  return spots;
}

// ================================================================ PONDOIRS ====
// Repères communs : bâtiment de 2 × 1, compartiments répartis sur x ∈ [0,1 ; 1,9], fond de nid
// (paille ou tapis) à y = 0,42, poule et œufs vers z = 0,5. Le toit couvre seulement l'arrière :
// sous l'angle de la caméra, on voit toujours la poule qui couve et les œufs.

const GALVA = 0xc3cad0;
const GALVA_DARK = 0x9aa3ab;
const GALVA_LIGHT = 0xdfe4e8;
const NEST_TOP = 0.42;

/** Toit à une pente qui descend vers +z (de y0 en z0 à y1 en z1), en rangées ou nervuré. */
function shedRoof(parts: Parts, o: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; a: number; b: number; n?: number; style?: 'rows' | 'ribs' }) {
  const ang = Math.atan2(o.y0 - o.y1, o.z1 - o.z0);
  const L = Math.hypot(o.z1 - o.z0, o.y0 - o.y1);
  const W = o.x1 - o.x0;
  const cx = (o.x0 + o.x1) / 2;
  const t = 0.04;
  const at = (s: number, lift: number): [number, number] => [o.y0 - Math.sin(ang) * s + Math.cos(ang) * lift, o.z0 + Math.cos(ang) * s + Math.sin(ang) * lift];
  const r: V3 = [ang, 0, 0];
  const [cy, cz] = at(L / 2, t / 2);
  parts.push(box(W, t, L, o.a, [cx, cy, cz], r));
  if (o.style === 'ribs') {
    const n = Math.max(2, Math.round(W / 0.16));
    const [y, z] = at(L / 2, t + 0.012);
    for (let i = 0; i <= n; i++) parts.push(box(0.035, 0.025, L, o.b, [o.x0 + 0.02 + (i * (W - 0.04)) / n, y, z], r));
  } else {
    const n = o.n ?? 4;
    for (let k = 0; k < n; k++) {
      const [y, z] = at(((k + 0.5) / n) * L, t + 0.011);
      parts.push(box(W + 0.01, 0.022, L / n + 0.008, k % 2 ? o.b : o.a, [cx, y, z], r));
      const [ly, lz] = at(((k + 1) / n) * L - 0.01, t + 0.024);
      parts.push(box(W + 0.012, 0.026, 0.02, shade(o.b, 0.82), [cx, ly, lz], r));
    }
  }
  return { at, ang, L };
}

/** Bord des compartiments (x des cloisons, de 0,1 à 1,9). */
const nestEdges = (n: number) => Array.from({ length: n + 1 }, (_, i) => 0.1 + (i * 1.8) / n);

interface NestStyle {
  wood: number;
  woodAlt: number;
  /** Teinte des joues, cloisons et du fond (peut différer du bardage). */
  frame: number;
  roofA: number;
  roofB: number;
  roofStyle?: 'rows' | 'ribs';
  /** Hauteur du toit au fond (z = 0,04) et à l'avant (z = 0,6). */
  back: number;
  front: number;
}
/** Caisse commune : pieds, coffre sous les nids, fond, joues, cloisons et toit. */
function nestShell(parts: Parts, n: number, st: NestStyle) {
  const zB = 0.12;
  const zF = 0.88;
  const roofY = (z: number) => st.back + ((z - 0.04) / (0.6 - 0.04)) * (st.front - st.back);
  for (const x of [0.12, 1.88]) for (const z of [0.18, 0.82]) parts.push(box(0.06, 0.15, 0.06, shade(st.frame, 0.8), [x, 0.075, z]));
  // coffre sous les nids
  parts.push(box(1.8, 0.24, zF - zB, st.frame, [1, 0.27, (zB + zF) / 2]));
  for (const y of [0.21, 0.33]) parts.push(box(1.8, 0.11, 0.022, y < 0.3 ? st.wood : st.woodAlt, [1, y, zF + 0.011]));
  boardsX(parts, zB, zF, 0.15, 0.39, 1.9, st.wood, st.woodAlt, 0.19);
  // fond, joues et cloisons découpées en biais (le profil suit le toit)
  parts.push(box(1.84, roofY(zB) - 0.15, 0.05, st.frame, [1, (0.15 + roofY(zB)) / 2, zB]));
  boardsZ(parts, 0.11, 1.89, NEST_TOP, roofY(zB + 0.03) - 0.02, zB + 0.025, st.woodAlt, st.wood, 0.15);
  const side: Array<[number, number]> = [
    [zB - 0.02, 0.15],
    [zF, 0.15],
    [zF, 0.52],
    [0.52, roofY(0.52) - 0.01],
    [zB - 0.02, roofY(zB - 0.02) - 0.01],
  ];
  for (const x of [0.085, 1.915]) parts.push(extrudeX(side, 0.05, st.frame, x));
  boardsX(parts, zB, zF, 0.15, (z) => Math.min(z < 0.52 ? roofY(z) - 0.02 : 0.52 + ((zF - z) / (zF - 0.52)) * (roofY(0.52) - 0.53), 0.95), 1.94, st.wood, st.woodAlt, 0.15);
  const div: Array<[number, number]> = [
    [zB + 0.04, NEST_TOP - 0.02],
    [zF - 0.04, NEST_TOP - 0.02],
    [zF - 0.04, 0.52],
    [0.52, roofY(0.52) - 0.04],
    [zB + 0.04, roofY(zB + 0.04) - 0.03],
  ];
  const edges = nestEdges(n);
  for (let i = 1; i < n; i++) parts.push(extrudeX(div, 0.035, st.frame, edges[i]));
  return shedRoof(parts, { x0: 0.02, x1: 1.98, z0: 0.0, z1: 0.62, y0: roofY(0.0) + 0.02, y1: roofY(0.62) + 0.02, a: st.roofA, b: st.roofB, n: 4, style: st.roofStyle });
}

/** Litière de paille : tapis, creux du nid dans chaque compartiment, brins qui dépassent. */
function strawBed(parts: Parts, n: number) {
  parts.push(box(1.78, 0.05, 0.7, C.straw, [1, NEST_TOP - 0.025, 0.5]));
  const edges = nestEdges(n);
  for (let i = 0; i < n; i++) {
    const cx = (edges[i] + edges[i + 1]) / 2;
    parts.push(ico(0.15, 1, 0xf2d987, [cx, NEST_TOP - 0.005, 0.5], [1, 0.3, 0.95]));
    parts.push(ico(0.1, 0, 0xe2c25c, [cx, NEST_TOP + 0.01, 0.5], [1, 0.25, 1]));
    for (let k = 0; k < 7; k++) {
      const a = rnd(i * 13 + k) * Math.PI * 2;
      const r = 0.12 + rnd(i * 7 + k * 3) * 0.06;
      parts.push(box(0.12, 0.01, 0.014, k % 2 ? 0xe9cf7a : 0xd9b85a, [cx + Math.cos(a) * r, NEST_TOP + 0.012, 0.5 + Math.sin(a) * r * 0.9], [0, a + 1.2, 0.1]));
    }
    // brins qui pendent par-dessus le rebord
    for (let k = 0; k < 3; k++) parts.push(box(0.013, 0.12, 0.012, 0xe9cf7a, [edges[i] + 0.06 + rnd(i * 5 + k) * (edges[i + 1] - edges[i] - 0.12), NEST_TOP - 0.02, 0.9], [0.25, 0, (rnd(k + i) - 0.5) * 0.6]));
  }
}

/** Niveau 1 — pondoir simple : caisse de planches sur petits pieds, toit de bardeaux, perchoir. */
export function nestSimple(parts: Parts, n: number) {
  const st: NestStyle = { wood: C.wood, woodAlt: 0xc98f52, frame: 0x9a6a3e, roofA: 0x8a6a4a, roofB: 0x7d5f42, back: 1.0, front: 0.82 };
  nestShell(parts, n, st);
  strawBed(parts, n);
  parts.push(box(1.82, 0.08, 0.035, C.woodLight, [1, NEST_TOP + 0.03, 0.89]));
  // planche d'envol devant les nids
  parts.push(box(1.8, 0.03, 0.13, C.plank, [1, 0.3, 1.0]));
  for (const x of [0.2, 1.0, 1.8]) parts.push(box(0.04, 0.1, 0.12, C.woodDark, [x, 0.25, 0.94], [0.6, 0, 0]));
}

/** Niveau 2 — pondoir double peint, rideaux vichy, tiroir à œufs, toit de tuiles, perchoir rond. */
export function nestCurtains(parts: Parts, n: number) {
  const SAGE = 0x7fa898;
  const st: NestStyle = { wood: SAGE, woodAlt: 0x76a090, frame: 0x5f8a79, roofA: 0xc0573f, roofB: 0xb04c36, back: 1.04, front: 0.84 };
  const roof = nestShell(parts, n, st);
  strawBed(parts, n);
  parts.push(box(1.82, 0.08, 0.035, TRIM, [1, NEST_TOP + 0.03, 0.89]));
  // rive et bandeau blancs sous le toit
  const [ey, ez] = roof.at(roof.L, 0);
  parts.push(box(1.98, 0.06, 0.03, TRIM, [1, ey - 0.03, ez]));
  parts.push(box(0.03, 0.06, roof.L, TRIM, [1.99, ...roof.at(roof.L / 2, 0.02)], [roof.ang, 0, 0]));
  // tiroir de ramassage et ses boutons
  parts.push(box(1.7, 0.15, 0.025, shade(SAGE, 1.08), [1, 0.25, 0.905]));
  for (const x of [0.55, 1.45]) parts.push(sph(0.025, 6, 4, TRIM, [x, 0.25, 0.93]));
  // tringle et rideaux vichy noués de chaque côté des compartiments
  parts.push(cyl(0.012, 0.012, 1.84, 6, 0xd9b35a, [1, 0.78, 0.9], [0, 0, Math.PI / 2]));
  const edges = nestEdges(n);
  for (let i = 0; i <= n; i++)
    for (const s of [-1, 1]) {
      if ((i === 0 && s < 0) || (i === n && s > 0)) continue;
      const x = edges[i] + s * 0.06;
      for (let r = 0; r < 4; r++)
        for (let c = 0; c < 2; c++) parts.push(box(0.045, 0.065, 0.02, (r + c) % 2 ? 0xd9534f : 0xf6f2ea, [x - 0.0225 + c * 0.045, 0.745 - r * 0.065, 0.905]));
      parts.push(box(0.1, 0.02, 0.03, 0xd9534f, [x, 0.55, 0.915]));
    }
  // perchoir rond sur consoles
  parts.push(cyl(0.022, 0.022, 1.8, 8, TRIM, [1, 0.3, 1.02], [0, 0, Math.PI / 2]));
  for (const x of [0.15, 1.0, 1.85]) parts.push(box(0.04, 0.04, 0.16, st.frame, [x, 0.29, 0.95]));
}

/** Niveau 3 — pondoir à rouleau : caisson galvanisé, tapis inclinés, tapis roulant de collecte. */
export function nestRollaway(parts: Parts, n: number) {
  const st: NestStyle = { wood: GALVA, woodAlt: GALVA_LIGHT, frame: GALVA_DARK, roofA: GALVA, roofB: GALVA_DARK, roofStyle: 'ribs', back: 1.02, front: 0.86 };
  nestShell(parts, n, st);
  // tapis de ponte verts, légèrement inclinés vers l'avant (l'œuf roule jusqu'au tapis de collecte)
  const edges = nestEdges(n);
  for (let i = 0; i < n; i++) {
    const cx = (edges[i] + edges[i + 1]) / 2;
    const w = edges[i + 1] - edges[i] - 0.05;
    parts.push(box(w, 0.03, 0.66, 0x5f8f6a, [cx, NEST_TOP - 0.02, 0.5], [0.08, 0, 0]));
    for (let k = 0; k < 4; k++) parts.push(box(w - 0.04, 0.008, 0.02, 0x4f7a5a, [cx, NEST_TOP - 0.002, 0.28 + k * 0.15], [0.08, 0, 0]));
    // rabat de caoutchouc en haut de l'ouverture
    parts.push(box(w, 0.05, 0.015, 0x3a3f4a, [cx, 0.78, 0.6]));
  }
  // gouttière et tapis de collecte le long de la façade
  parts.push(box(1.86, 0.025, 0.14, GALVA_DARK, [1, 0.37, 0.95]));
  parts.push(box(1.86, 0.09, 0.02, GALVA, [1, 0.41, 1.025]));
  parts.push(box(1.82, 0.012, 0.1, 0x3a3f4a, [1, 0.388, 0.95]));
  for (let x = 0.15; x < 1.9; x += 0.12) parts.push(box(0.012, 0.006, 0.1, 0x6b7280, [x, 0.396, 0.95]));
  // moteur du tapis, voyant
  parts.push(box(0.16, 0.22, 0.2, 0x5b6170, [1.98, 0.32, 0.95]));
  parts.push(box(0.012, 0.03, 0.03, 0x4ade80, [2.065, 0.38, 0.95]));
  parts.push(cyl(0.012, 0.012, 0.25, 5, 0x2b2b31, [1.98, 0.15, 1.0]));
  // perchoir galvanisé
  parts.push(cyl(0.02, 0.02, 1.84, 8, GALVA_LIGHT, [1, 0.22, 1.1], [0, 0, Math.PI / 2]));
  for (const x of [0.15, 1.0, 1.85]) parts.push(box(0.03, 0.03, 0.2, GALVA_DARK, [x, 0.22, 1.0]));
}

// ===================================================== BAIN DE POUSSIÈRE ====
// Bac de 2 × 2 : les poules s'y vautrent autour du centre (rayon 0,42), enfoncées dans le sable
// (fond du bac à y = 0,1) ; elles y entrent par-dessus la bordure.
const SAND = 0xe3cf9f;

/** Sable fin mêlé de cendre : léger dôme, plaques de cendre, cuvettes creusées, plumes. */
function sandBed(parts: Parts, slots: number) {
  parts.push(box(1.64, 0.1, 1.64, SAND, [1, 0.05, 1]));
  // plaques de cendre grise et sable remué plus clair
  for (let i = 0; i < 12; i++) {
    const x = 0.32 + rnd(i * 3) * 1.36;
    const z = 0.32 + rnd(i * 3 + 1) * 1.36;
    const col = i % 3 === 0 ? 0xb3ab9d : i % 3 === 1 ? 0xc9c1b2 : 0xeedcb2;
    const r = 0.06 + rnd(i * 3 + 2) * 0.08;
    parts.push(cyl(r, r, 0.01, 9, col, [x, 0.104, z], [0, rnd(i * 11) * 3, 0], [1, 1, 0.55 + rnd(i * 5) * 0.4]));
  }
  // cuvettes creusées là où les poules se roulent (bourrelet clair, fond plus sombre)
  for (let i = 0; i < slots; i++) {
    const a = 0.6 + (i * Math.PI * 2) / slots;
    const x = 1 + Math.sin(a) * 0.42;
    const z = 1 + Math.cos(a) * 0.42;
    parts.push(cyl(0.21, 0.23, 0.02, 12, 0xeedcb2, [x, 0.108, z]));
    parts.push(cyl(0.16, 0.16, 0.012, 12, 0xc4a874, [x, 0.115, z]));
  }
  // plumes tombées
  for (let i = 0; i < 6; i++) {
    const x = 0.3 + rnd(i * 7 + 50) * 1.4;
    const z = 0.3 + rnd(i * 7 + 51) * 1.4;
    const ry = rnd(i * 7 + 52) * 6;
    const col = [0xf6f2ea, 0xb5652e, 0x8a5a30, 0xf3e3c8][i % 4];
    parts.push(sph(0.05, 6, 3, col, [x, 0.13, z], [1, 0.12, 0.35], [0, ry, 0]));
    parts.push(box(0.11, 0.008, 0.008, 0xf3eee4, [x, 0.135, z], [0, ry, 0]));
  }
  // éclaboussures de sable autour du bac
  for (let i = 0; i < 10; i++) {
    const a = rnd(i + 90) * Math.PI * 2;
    const r = 0.95 + rnd(i + 120) * 0.12;
    parts.push(sph(0.06 + rnd(i + 140) * 0.05, 7, 3, SAND, [1 + Math.sin(a) * r, 0.012, 1 + Math.cos(a) * r], [1, 0.25, 1]));
  }
}

/** Niveau 1 — bac de vieilles traverses, sable et cendre, seau de cendre de bois. */
export function dustbathSleepers(parts: Parts, slots: number) {
  sandBed(parts, slots);
  const SLEEPER = 0x7a5a3e;
  for (const [w, d, x, z] of [
    [1.86, 0.15, 1, 0.1],
    [1.86, 0.15, 1, 1.9],
    [0.15, 1.56, 0.1, 1],
    [0.15, 1.56, 1.9, 1],
  ]) {
    parts.push(box(w, 0.17, d, SLEEPER, [x, 0.085, z]));
    // veines du bois sur le dessus et la tranche
    const along = w > d;
    for (const o of [-0.035, 0.03]) parts.push(box(along ? w - 0.1 : 0.012, 0.006, along ? 0.012 : d - 0.1, 0x5e4430, [x + (along ? 0 : o), 0.172, z + (along ? o : 0)]));
  }
  // seau de cendre posé sur la traverse du fond
  parts.push(cyl(0.11, 0.09, 0.17, 12, GALVA, [1.72, 0.255, 0.12]));
  parts.push(cyl(0.1, 0.1, 0.01, 12, 0x8e8a84, [1.72, 0.33, 0.12]));
  parts.push(box(0.2, 0.012, 0.012, GALVA_DARK, [1.72, 0.39, 0.12], [0, 0, 0]));
  for (const s of [-1, 1]) parts.push(box(0.012, 0.07, 0.012, GALVA_DARK, [1.72 + s * 0.1, 0.355, 0.12]));
  // petite pelle plantée dans le sable
  parts.push(box(0.1, 0.012, 0.13, GALVA_DARK, [0.3, 0.14, 1.62], [0.5, 0.4, 0]));
  parts.push(cyl(0.012, 0.012, 0.3, 5, C.wood, [0.36, 0.26, 1.52], [0.6, 0.4, 0]));
}

/** Niveau 2 — bain de sable couvert : bordure de galets, abri en appentis, pare-vent de planches. */
export function dustbathShelter(parts: Parts, slots: number) {
  sandBed(parts, slots);
  // bordure de galets arrondis
  let k = 0;
  for (let i = 0; i < 40; i++) {
    const t = i / 40;
    const side = Math.floor(t * 4);
    const u = (t * 4) % 1;
    const [x, z] = side === 0 ? [0.1 + u * 1.8, 0.1] : side === 1 ? [1.9, 0.1 + u * 1.8] : side === 2 ? [1.9 - u * 1.8, 1.9] : [0.1, 1.9 - u * 1.8];
    parts.push(ico(0.1 + rnd(k) * 0.03, 1, rnd(k + 1) < 0.5 ? 0xbdb2a0 : 0xa99d8a, [x, 0.08, z], [1, 0.75, 1]));
    k += 2;
  }
  // abri : poteaux, pare-vent à l'arrière, toit de bardeaux qui ne couvre que l'arrière
  for (const [x, z, h] of [
    [0.08, 0.08, 1.52],
    [1.92, 0.08, 1.52],
    [0.08, 1.2, 1.32],
    [1.92, 1.2, 1.32],
  ])
    parts.push(box(0.08, h, 0.08, TIMBER, [x, h / 2, z]));
  for (const x of [0.08, 1.92]) parts.push(box(0.06, 0.06, 1.2, TIMBER, [x, 1.36, 0.64], [-0.17, 0, 0]));
  boardsZ(parts, 0.12, 1.88, 0.16, 0.78, 0.06, C.wood, 0xc98f52, 0.16);
  parts.push(box(1.84, 0.06, 0.06, TIMBER, [1, 0.8, 0.1]));
  for (const x of [0.08, 1.92]) parts.push(box(0.05, 0.5, 0.04, TIMBER, [x, 0.42, 0.42], [-0.9, 0, 0]));
  shedRoof(parts, { x0: -0.08, x1: 2.08, z0: -0.08, z1: 1.32, y0: 1.58, y1: 1.33, a: 0x8a6a4a, b: 0x7d5f42, n: 7 });
  // panneau peint d'une plume, accroché au pare-vent
  parts.push(box(0.4, 0.2, 0.025, TRIM, [1, 0.58, 0.115]));
  parts.push(sph(0.07, 7, 4, 0xb5652e, [1, 0.58, 0.135], [1.6, 0.45, 0.2], [0, 0, 0.5]));
}

/**
 * Niveau 3 — grand bain de sable (3 × 3 cases), à ciel ouvert : bassin de pierre taillée posé sur un
 * dallage propre, sable fin ratissé en lignes régulières, cuvettes nettes, quatre buis en boule.
 */
export function dustbathBasin(parts: Parts, slots: number) {
  const C0 = 1.5;
  // dallage clair et ses joints
  parts.push(box(2.94, 0.05, 2.94, 0xd8cfbd, [C0, 0.025, C0]));
  for (const t of [0.24, 2.76]) {
    parts.push(box(2.94, 0.006, 0.02, 0xc2b8a4, [C0, 0.052, t]));
    parts.push(box(0.02, 0.006, 2.94, 0xc2b8a4, [t, 0.052, C0]));
  }
  // margelle de pierre taillée
  const M = 0.17;
  const A = 0.34;
  const B = 2.66;
  const L = B - A + M;
  for (const [w, d, x, z] of [
    [L, M, C0, A],
    [L, M, C0, B],
    [M, L, A, C0],
    [M, L, B, C0],
  ] as const) {
    parts.push(box(w, 0.17, d, 0xc9bea9, [x, 0.13, z]));
    parts.push(box(w + 0.02, 0.025, d + 0.02, 0xe2d9c6, [x, 0.22, z]));
    // joints des blocs
    const along = w > d;
    for (let k = 1; k < 5; k++) {
      const o = -L / 2 + (k * L) / 5;
      parts.push(box(along ? 0.012 : w + 0.024, 0.027, along ? d + 0.024 : 0.012, 0xb5ab97, [x + (along ? o : 0), 0.221, z + (along ? 0 : o)]));
    }
  }
  // sable fin, ratissé en lignes parallèles
  const inner = B - A - M;
  parts.push(box(inner, 0.08, inner, 0xeadcb4, [C0, 0.09, C0]));
  for (let k = 0; k < 12; k++) parts.push(box(inner - 0.04, 0.005, 0.016, 0xdccba0, [C0, 0.132, A + M / 2 + 0.1 + (k * (inner - 0.2)) / 11]));
  // cuvettes là où les poules se roulent, bien rangées
  for (let i = 0; i < slots; i++) {
    const a = 0.6 + (i * Math.PI * 2) / slots;
    const x = C0 + Math.sin(a) * 0.63;
    const z = C0 + Math.cos(a) * 0.63;
    parts.push(cyl(0.2, 0.21, 0.014, 14, 0xf1e4c0, [x, 0.136, z]));
    parts.push(cyl(0.15, 0.15, 0.01, 14, 0xcdb587, [x, 0.143, z]));
  }
  // buis en boule dans leurs pots, aux quatre coins du dallage
  for (const [x, z] of [
    [0.16, 0.16],
    [2.84, 0.16],
    [0.16, 2.84],
    [2.84, 2.84],
  ]) {
    parts.push(cyl(0.11, 0.08, 0.15, 10, 0xb9694a, [x, 0.125, z]));
    parts.push(cyl(0.115, 0.115, 0.022, 10, 0xa35a3f, [x, 0.2, z]));
    parts.push(ico(0.14, 1, 0x5f9c52, [x, 0.33, z]));
    parts.push(ico(0.08, 1, 0x74b163, [x + 0.04, 0.38, z + 0.03]));
  }
}

// ============================================================ ANIMALERIE ====
/**
 * La boutique de l'animalerie, façade vers le trottoir (+z), de l'échoppe de bois à la grande maison à
 * étage : un mur de planches ou d'enduit, une devanture, un auvent rayé au-dessus du long comptoir, des
 * fleurs aux fenêtres, des sacs et des cartons. Coordonnées depuis le coin nord-ouest de la parcelle.
 * Renvoie le haut des murs, pour poser l'enseigne.
 */
export function petShopHouse(parts: Parts, windows: THREE.Mesh[], level: number, bw: number, counters: number) {
  const x0 = 0.3;
  const x1 = x0 + bw;
  const cx = x0 + bw / 2;
  const z0 = 0.2;
  const z1 = 3.0;
  const d = z1 - z0;
  const cz = (z0 + z1) / 2;
  const upper = level >= 4;
  const y1 = [1.85, 1.95, 2.2, 3.15, 3.4][level - 1];
  const WALL = [0xc98f52, 0xf3ead6, 0xf1e4cc, 0xf3ead6, 0xefdcc0][level - 1];
  const PAINT = 0x2f6f4e;
  const FLOWERS = [0xe85d75, 0xf5c542, 0xfaf6ee, 0x9a7ad6];
  parts.push(box(bw + 0.08, 0.26, d + 0.08, STONE, [cx, 0.13, cz]));
  parts.push(box(bw, y1 - 0.26, d, WALL, [cx, (y1 + 0.26) / 2, cz]));
  if (level === 1) {
    boardsZ(parts, x0, x1, 0.26, y1, z1, C.wood, 0xc98f52, 0.2);
    boardsX(parts, z0, z1, 0.26, y1, x1, C.wood, 0xc98f52, 0.2);
  }
  // chaînes d'angle
  for (const [x, z] of [
    [x0, z1],
    [x1, z1],
    [x1, z0],
  ])
    parts.push(box(0.1, y1 - 0.26, 0.1, level === 1 ? TIMBER : level >= 4 ? STONE : TRIM, [x, (y1 + 0.26) / 2, z]));
  const flowerBox = (x: number, y: number, z: number, w: number, onX = false) => {
    parts.push(onX ? box(0.14, 0.1, w, PAINT, [x + 0.08, y, z]) : box(w, 0.1, 0.14, PAINT, [x, y, z + 0.08]));
    const n = Math.max(3, Math.round(w / 0.14));
    for (let k = 0; k < n; k++) {
      const u = -w / 2 + ((k + 0.5) * w) / n;
      parts.push(ico(0.055, 0, k % 2 ? 0x6ea84f : FLOWERS[(k + Math.round(x * 3)) % 4], onX ? [x + 0.09, y + 0.08, z + u] : [x + u, y + 0.08, z + 0.09]));
    }
  };
  // l'ouverture au-dessus du comptoir : étagères de sacs de grain et de boîtes, dans la pénombre
  const hw = Math.min(bw - 1.7, Math.max(2.5, counters * 1.15 + 1.1));
  parts.push(box(hw + 0.14, 1.2, 0.03, TIMBER, [cx, 0.92, z1 + 0.01]));
  parts.push(box(hw, 1.08, 0.03, 0x3b312a, [cx, 0.9, z1 + 0.02]));
  for (const y of [0.78, 1.12]) parts.push(box(hw - 0.1, 0.03, 0.05, TIMBER, [cx, y, z1 + 0.05]));
  for (let k = 0; k < Math.floor((hw - 0.2) / 0.3); k++) {
    const x = cx - hw / 2 + 0.25 + k * 0.3;
    parts.push(box(0.2, 0.26, 0.05, k % 2 ? 0xe9dfc8 : 0xd8c08a, [x, 0.93, z1 + 0.06]));
    if (k % 3 !== 1) parts.push(box(0.17, 0.2, 0.05, k % 2 ? 0x6fa64c : 0xc9694a, [x, 1.24, z1 + 0.06]));
  }
  // de part et d'autre : la porte, puis les fenêtres ou les vitrines
  const side = (bw - hw) / 2;
  const n = Math.max(1, Math.floor(side / 1.05));
  const win = level >= 3 ? [0.86, 0.86] : [0.62, 0.62];
  for (const s of [-1, 1])
    for (let i = 0; i < n; i++) {
      const x = cx + s * (hw / 2 + ((i + 0.5) * side) / n);
      if (s < 0 && i === 0) {
        parts.push(box(0.74, 1.42, 0.03, TIMBER, [x, 0.97, z1 + 0.012]), box(0.62, 1.34, 0.03, PAINT, [x, 0.93, z1 + 0.024]));
        parts.push(box(0.4, 0.46, 0.02, 0x9fc4dc, [x, 1.26, z1 + 0.04]), sph(0.03, 6, 5, 0xd9b45a, [x + 0.22, 0.86, z1 + 0.05]));
        parts.push(box(0.84, 0.05, 0.3, STONE, [x, 0.28, z1 + 0.14]));
      } else {
        farmWindow(parts, windows, x, 1.02, z1 + 0.02, win[0], win[1]);
        flowerBox(x, 1.02 - win[1] / 2 - 0.09, z1 + 0.02, win[0] + 0.08);
      }
    }
  // le pignon côté parcs
  for (const z of d > 2.4 ? [cz - 0.7, cz + 0.7] : [cz]) {
    farmWindow(parts, windows, x1 + 0.012, 1.02, z, win[0] * 0.8, win[1] * 0.8, true);
    if (level >= 2) flowerBox(x1 + 0.012, 1.02 - (win[1] * 0.8) / 2 - 0.09, z, win[0] * 0.8 + 0.06, true);
  }
  // l'étage, avec ses volets verts
  if (upper) {
    parts.push(box(bw + 0.06, 0.07, d + 0.06, STONE, [cx, 1.8, cz]));
    const m = Math.max(2, Math.floor(bw / 1.5));
    for (let k = 0; k < m; k++) {
      const x = x0 + ((k + 0.5) * bw) / m;
      farmWindow(parts, windows, x, 2.45, z1 + 0.02, 0.62, 0.74);
      for (const s of [-1, 1]) parts.push(box(0.2, 0.74, 0.025, PAINT, [x + s * 0.43, 2.45, z1 + 0.03]));
      flowerBox(x, 2.0, z1 + 0.02, 0.72);
    }
    farmWindow(parts, windows, x1 + 0.012, 2.45, cz, 0.62, 0.74, true);
  }
  // l'auvent rayé, sur toute la longueur du comptoir
  const awLen = hw + 0.5;
  const stripes = Math.round(awLen / 0.3);
  const awW = awLen / stripes;
  const ya = upper ? 1.74 : y1 - 0.12;
  const yb = ya - 0.38;
  for (let k = 0; k < stripes; k++) {
    const x = cx - awLen / 2 + (k + 0.5) * awW;
    const c = k % 2 ? 0xf6f2ea : 0x3f8f63;
    parts.push(box(awW, 0.03, 1.22, c, [x, (ya + yb) / 2, z1 + 0.58], [Math.atan2(0.38, 1.16), 0, 0]));
    parts.push(box(awW, 0.13, 0.02, c, [x, yb - 0.06, z1 + 1.16]));
  }
  for (const s of [-1, 1]) parts.push(box(0.07, yb, 0.07, TIMBER, [cx + (s * awLen) / 2, yb / 2, z1 + 1.12]));
  // le long comptoir, le trébuchet et les cartons prêts à partir
  const cl = counters * 1.15 + 0.7;
  parts.push(box(cl, 0.62, 0.42, C.wood, [cx, 0.37, z1 + 0.72]));
  for (let k = 0; k < Math.floor(cl / 0.26); k++) parts.push(box(0.012, 0.6, 0.426, 0xb07f4a, [cx - cl / 2 + 0.13 + k * 0.26, 0.37, z1 + 0.72]));
  parts.push(box(cl + 0.14, 0.05, 0.52, 0xe0b98a, [cx, 0.705, z1 + 0.72]));
  parts.push(cyl(0.11, 0.13, 0.04, 12, 0x8e939b, [cx - cl / 2 + 0.3, 0.75, z1 + 0.72]), cyl(0.02, 0.02, 0.12, 6, 0x8e939b, [cx - cl / 2 + 0.3, 0.82, z1 + 0.72]), box(0.3, 0.02, 0.2, 0xc9ccd1, [cx - cl / 2 + 0.3, 0.88, z1 + 0.72]));
  parts.push(box(0.36, 0.22, 0.28, 0xc9a26b, [cx + cl / 2 - 0.3, 0.84, z1 + 0.72]), box(0.37, 0.012, 0.1, 0xb48c58, [cx + cl / 2 - 0.3, 0.96, z1 + 0.65], [0.5, 0, 0]), box(0.37, 0.012, 0.1, 0xb48c58, [cx + cl / 2 - 0.3, 0.96, z1 + 0.79], [-0.5, 0, 0]));
  // sacs sur leur palette et cartons empilés, de chaque côté
  const px = x1 - 0.55;
  parts.push(box(0.8, 0.08, 0.6, 0x9a7a52, [px, 0.1, z1 + 0.5]));
  for (const [dx, dz, y, c] of [
    [-0.18, -0.1, 0.24, 0xe9dfc8],
    [0.2, -0.08, 0.24, 0xd8c08a],
    [0.02, 0.14, 0.24, 0xe9dfc8],
    [0, -0.02, 0.44, 0xd8c08a],
  ] as const)
    parts.push(ico(0.2, 1, c, [px + dx, y, z1 + 0.5 + dz], [1, 0.62, 0.72]));
  for (const [dx, y, r] of [
    [0, 0.2, 0],
    [0.04, 0.46, 0.3],
    [-0.02, 0.72, -0.2],
  ] as const) {
    parts.push(box(0.42, 0.26, 0.34, 0xc9a26b, [x0 + 0.42 + dx, y, z1 + 1.05], [0, r, 0]));
    parts.push(box(0.43, 0.012, 0.05, 0xe9dcb8, [x0 + 0.42 + dx, y + 0.13, z1 + 1.05], [0, r, 0]));
  }
  // le toit
  const roof = gableRoof(parts, { cx, cz, y: y1, w: bw, d, h: [0.85, 0.95, 1.1, 1.25, 1.4][level - 1], over: 0.2, side: 0.18, a: 0xb5573b, b: 0xa24b33, n: 6 + level, ridge: 0x8a3c29, rive: TIMBER, gable: level === 1 ? C.wood : WALL });
  if (level >= 2) {
    parts.push(box(0.36, 0.95, 0.36, 0xb7a08a, [x0 + 0.9, roof.ridgeY - 0.05, cz - 0.45]), box(0.44, 0.06, 0.44, STONE, [x0 + 0.9, roof.ridgeY + 0.44, cz - 0.45]));
  }
  // lucarnes, puis la lanterne et l'horloge de la grande maison
  if (level >= 3) {
    const [yd, zd] = roof.at(1, roof.len * 0.5, 0);
    for (const s of level >= 4 ? [-0.32, 0.32] : [-0.28]) {
      const x = cx + s * bw;
      parts.push(box(0.8, 0.62, 0.7, WALL, [x, yd + 0.22, zd - 0.12]));
      farmWindow(parts, windows, x, yd + 0.22, zd + 0.24, 0.44, 0.42);
      parts.push(prism(0.86, 0.32, 0.98, 0xa24b33, [x, yd + 0.52, zd - 0.12], Math.PI / 2));
    }
  }
  if (level === 5) {
    parts.push(box(3.6, 1.0, 0.5, WALL, [cx, y1 + 0.42, z1 - 0.02]), box(3.72, 0.06, 0.58, STONE, [cx, y1 + 0.93, z1 - 0.02]));
    parts.push(prism(0.56, 0.86, 3.9, 0xb5573b, [cx, y1 + 0.96, z1 - 0.02], Math.PI / 2));
    parts.push(cyl(0.3, 0.3, 0.04, 18, 0xfaf6ee, [cx, y1 + 1.2, z1 + 0.27], [Math.PI / 2, 0, 0]), cyl(0.34, 0.34, 0.03, 18, PAINT, [cx, y1 + 1.2, z1 + 0.25], [Math.PI / 2, 0, 0]));
    parts.push(box(0.03, 0.2, 0.012, 0x2b2b31, [cx, y1 + 1.28, z1 + 0.3]), box(0.14, 0.03, 0.012, 0x2b2b31, [cx + 0.06, y1 + 1.2, z1 + 0.3]));
    parts.push(box(0.8, 0.75, 0.8, WALL, [cx, roof.ridgeY + 0.3, cz]), cone(0.72, 0.7, 4, 0x8a3c29, [cx, roof.ridgeY + 1.02, cz], [0, Math.PI / 4, 0]));
    weathervane(parts, cx, roof.ridgeY + 1.35, cz, 1.1);
  } else if (level >= 3) weathervane(parts, x1 - 0.8, roof.ridgeY, cz, 0.9);
  return y1;
}

// ============================================================== COMPOST ====
/** Rayon de la butte de compost (mètres) ; sa hauteur vaut 1 avant mise à l'échelle par le rendu. */
const HEAP_R = 0.74;
/** Profil de la butte : bombée au sommet, évasée au pied. */
const heapY = (r: number) => Math.pow(Math.max(0, 1 - (r / HEAP_R) ** 2), 0.62);

/**
 * Le tas de compost : une vraie butte de terre bosselée (terreau sombre, plaques de paille et de
 * feuilles décomposées), couverte de feuilles mortes, de branchages, d'épluchures et de vers.
 * Tout repose sur la surface de la butte, à des hauteurs différentes : rien n'est coplanaire.
 */
export function compostHeap() {
  const base = new THREE.SphereGeometry(1, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const g = base.toNonIndexed();
  base.dispose();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const r0 = Math.hypot(v.x, v.z);
    // bosses : quelques ondulations irrégulières autour et sur le dessus
    const bump = 1 + 0.07 * Math.sin(a * 3 + 1.3) + 0.05 * Math.sin(a * 7 + r0 * 5) + 0.04 * Math.cos(a * 5 - 0.7);
    const r = r0 * HEAP_R * bump;
    pos.setXYZ(i, Math.cos(a) * r, heapY(r0 * HEAP_R) * (1 + 0.08 * Math.sin(a * 4 + r0 * 6)), Math.sin(a) * r);
  }
  g.computeVertexNormals();
  // couleurs par facette : terreau, terre plus claire, paille et feuilles décomposées
  const col = new Float32Array(pos.count * 3);
  const tones = [0x4a3422, 0x553c27, 0x3f2c1c, 0x6b4f30, 0x7a6236];
  const c = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    const k = Math.floor(rnd(f * 0.37 + 11) * 10);
    c.set(tones[k < 4 ? 0 : k < 6 ? 1 : k < 8 ? 2 : k < 9 ? 3 : 4]);
    for (let j = 0; j < 3; j++) c.toArray(col, (f + j) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  const p: Parts = [g];
  /** Point de la surface (rayon r, angle a) légèrement au-dessus de la butte. */
  const on = (r: number, a: number, lift = 0.035): V3 => [Math.cos(a) * r, heapY(r) + lift, Math.sin(a) * r];
  /** Inclinaison qui couche un objet sur la pente de la butte. */
  const tilt = (r: number, a: number): V3 => {
    const slope = Math.atan2(heapY(Math.max(0, r - 0.05)) - heapY(r + 0.05), 0.1);
    return [Math.sin(a) * slope * 0.8, -a, -Math.cos(a) * slope * 0.8];
  };
  // feuilles mortes et vertes
  const LEAVES = [0xc98a3a, 0xb5652e, 0x9c7a3a, 0x7fb35a, 0x8a5a30, 0xd9a14a];
  for (let i = 0; i < 26; i++) {
    const r = rnd(i * 3 + 1) * HEAP_R * 0.92;
    const a = rnd(i * 3 + 2) * Math.PI * 2;
    const [tx, , tz] = tilt(r, a);
    p.push(sph(0.06 + rnd(i) * 0.03, 6, 3, LEAVES[i % LEAVES.length], on(r, a, 0.03 + (i % 3) * 0.012), [1, 0.18, 0.55], [tx, rnd(i * 7) * 6, tz]));
  }
  // branchages : brindilles couchées sur la butte, quelques-unes fourchues
  for (let i = 0; i < 9; i++) {
    const r = 0.12 + rnd(i * 5 + 40) * HEAP_R * 0.7;
    const a = rnd(i * 5 + 41) * Math.PI * 2;
    const len = 0.28 + rnd(i * 5 + 42) * 0.26;
    const [x, y, z] = on(r, a, 0.05);
    const ry = rnd(i * 5 + 43) * Math.PI;
    const [tx, , tz] = tilt(r, a);
    p.push(cyl(0.014, 0.02, len, 5, i % 2 ? 0x6b4a2f : 0x8a6a4a, [x, y, z], [tx, ry, Math.PI / 2 + tz]));
    if (i % 3 === 0) p.push(cyl(0.008, 0.012, len * 0.45, 4, 0x6b4a2f, [x + Math.cos(ry) * len * 0.18, y + 0.03, z - Math.sin(ry) * len * 0.18], [0.5, ry + 0.6, Math.PI / 2]));
  }
  // épluchures, trognon, coquilles d'œufs, brins de paille
  const PEEL = [0xe39b3a, 0x8cc063, 0xd9534f, 0xf3e3b0];
  for (let i = 0; i < 9; i++) {
    const r = rnd(i * 7 + 70) * HEAP_R * 0.75;
    const a = rnd(i * 7 + 71) * Math.PI * 2;
    const [tx, , tz] = tilt(r, a);
    if (i % 3 === 2) p.push(sph(0.04, 7, 4, 0xf6efe2, on(r, a, 0.04), [1, 0.55, 1], [tx, 0, tz]));
    else p.push(box(0.12, 0.03, 0.06, PEEL[i % PEEL.length], on(r, a, 0.04), [tx, rnd(i) * 6, tz]));
  }
  for (let i = 0; i < 14; i++) {
    const r = rnd(i * 11 + 90) * HEAP_R * 0.9;
    const a = rnd(i * 11 + 91) * Math.PI * 2;
    const [tx, , tz] = tilt(r, a);
    p.push(box(0.16, 0.012, 0.014, i % 2 ? 0xe9cf7a : 0xd9b85a, on(r, a, 0.03), [tx, rnd(i * 3) * 6, tz]));
  }
  // vers de terre qui sortent du terreau
  for (let i = 0; i < 4; i++) {
    const r = 0.15 + rnd(i * 13 + 120) * 0.4;
    const a = rnd(i * 13 + 121) * Math.PI * 2;
    const [x, y, z] = on(r, a, 0.02);
    p.push(cyl(0.02, 0.016, 0.12, 6, 0xc9737a, [x, y + 0.03, z], [0.5, a, 0.6]));
    p.push(sph(0.02, 6, 4, 0xd88a90, [x + 0.03, y + 0.075, z], [1, 1, 1]));
  }
  return merge(p);
}

/** Niveau 1 — tas de compost entre trois palettes, fourche, arrosoir. */
export function compostPallets(parts: Parts) {
  parts.push(box(1.84, 0.03, 1.84, 0x6b5236, [1, 0.015, 1]));
  // quelques mottes de terre tombées devant le tas
  for (let i = 0; i < 5; i++) parts.push(ico(0.05 + rnd(i + 3) * 0.04, 0, 0x4a3422, [0.4 + rnd(i) * 1.2, 0.05, 1.7 + rnd(i + 9) * 0.15], [1, 0.7, 1]));
  // une palette : planches horizontales à claire-voie sur trois montants
  const PAL = 0xc9a26c;
  const palletZ = (z: number) => {
    for (const x of [0.16, 1.0, 1.84]) parts.push(box(0.09, 0.56, 0.09, 0xa8825a, [x, 0.28, z]));
    for (let y = 0.08; y < 0.56; y += 0.13) parts.push(box(1.78, 0.085, 0.03, PAL, [1, y, z + 0.06]));
  };
  const palletX = (x: number, s: number) => {
    for (const z of [0.2, 1.0, 1.8]) parts.push(box(0.09, 0.56, 0.09, 0xa8825a, [x, 0.28, z]));
    for (let y = 0.08; y < 0.56; y += 0.13) parts.push(box(0.03, 0.085, 1.7, PAL, [x + s * 0.06, y, 1.0]));
  };
  palletZ(0.14);
  palletX(0.14, -1);
  palletX(1.86, 1);
  // planche basse à l'avant, fourche appuyée, arrosoir
  parts.push(box(1.6, 0.1, 0.04, PAL, [1, 0.06, 1.84]));
  parts.push(cyl(0.016, 0.016, 1.0, 6, C.wood, [1.97, 0.5, 1.45], [0.25, 0, -0.22]));
  parts.push(box(0.05, 0.03, 0.16, GALVA_DARK, [2.07, 0.04, 1.58]));
  for (const dx of [-0.05, 0, 0.05]) parts.push(box(0.012, 0.012, 0.2, GALVA_DARK, [2.07 + dx, 0.03, 1.68]));
  parts.push(cyl(0.09, 0.1, 0.18, 10, 0x5aa36b, [0.18, 0.12, 1.95]));
  parts.push(cyl(0.018, 0.024, 0.2, 6, 0x5aa36b, [0.32, 0.18, 1.95], [0, 0, -1.0]));
  parts.push(box(0.025, 0.1, 0.12, 0x4a8a58, [0.18, 0.26, 1.95]));
}

/** Niveau 2 — composteur en bois à lattes, couvercle relevé, trappe de récolte, seau d'épluchures. */
export function compostBin(parts: Parts) {
  const WOOD = 0x8a6a4a;
  const LATH = 0xb08458;
  parts.push(box(1.84, 0.03, 1.84, 0x6b5236, [1, 0.015, 1]));
  for (const [x, z] of [
    [0.14, 0.14],
    [1.86, 0.14],
    [0.14, 1.86],
    [1.86, 1.86],
  ])
    parts.push(box(0.1, 0.7, 0.1, WOOD, [x, 0.35, z]));
  for (let y = 0.08; y < 0.66; y += 0.11) {
    parts.push(box(1.66, 0.08, 0.035, LATH, [1, y, 0.12]));
    parts.push(box(0.035, 0.08, 1.66, LATH, [0.12, y, 1]));
    parts.push(box(0.035, 0.08, 1.66, LATH, [1.88, y, 1]));
    // façade : planches amovibles, sauf la trappe de récolte en bas
    if (y > 0.2) parts.push(box(1.66, 0.08, 0.035, LATH, [1, y, 1.88]));
  }
  parts.push(box(0.5, 0.17, 0.03, WOOD, [1, 0.12, 1.92]));
  parts.push(box(0.1, 0.03, 0.04, IRON, [1, 0.17, 1.945]));
  // terreau mûr qui s'échappe de la trappe, grouillant de vers
  parts.push(sph(0.3, 12, 6, 0x3f2c1c, [1, 0.03, 1.98], [1, 0.4, 0.62]));
  for (const [x, a] of [
    [0.9, 0.4],
    [1.12, 1.9],
  ])
    parts.push(cyl(0.018, 0.018, 0.14, 5, 0xc9737a, [x, 0.07, 2.02], [0, a, 1.5]));
  // couvercle relevé contre le fond, pentures
  parts.push(box(1.8, 0.05, 0.92, WOOD, [1, 0.98, 0.0], [-1.25, 0, 0]));
  for (const x of [0.4, 1.0, 1.6]) parts.push(box(0.06, 0.06, 0.88, 0x6b4f37, [x, 0.99, 0.03], [-1.25, 0, 0]));
  for (const x of [0.5, 1.5]) parts.push(box(0.1, 0.03, 0.06, IRON, [x, 0.7, 0.12]));
  // seau d'épluchures à côté
  parts.push(cyl(0.12, 0.1, 0.2, 12, 0xe0e4e8, [1.92, 0.1, 2.0]));
  for (const [x, z, c] of [
    [1.88, 1.97, 0xe39b3a],
    [1.96, 2.03, 0x8cc063],
    [1.93, 1.95, 0xd9534f],
  ] as const)
    parts.push(box(0.08, 0.03, 0.05, c, [x, 0.21, z], [0, x * 7, 0]));
}

// ============================================================= POUSSINIÈRE ====
const EARTH = 0xbfa377;

/** Mangeoire à poussins : assiette rouge à fentes sous une petite trémie transparente. */
function chickFeeder(parts: Parts, x: number, z: number, r: number) {
  parts.push(cyl(r, r + 0.02, 0.05, 14, 0xc8433a, [x, 0.05, z]));
  parts.push(cyl(r - 0.03, r - 0.03, 0.012, 14, 0xd9b35a, [x, 0.078, z]));
  for (let k = 0; k < 6; k++) parts.push(box(0.012, 0.03, r * 0.9, 0xa8352d, [x, 0.09, z], [0, (k / 6) * Math.PI, 0]));
  parts.push(cyl(r * 0.5, r * 0.62, 0.17, 12, 0xeadfc0, [x, 0.17, z]));
  parts.push(cyl(r * 0.54, r * 0.54, 0.025, 12, 0xc8433a, [x, 0.265, z]));
}

/** Abreuvoir à poussins : coupelle bleue et bonbonne retournée. */
function chickDrinker(parts: Parts, x: number, z: number, r: number) {
  parts.push(cyl(r, r + 0.02, 0.045, 14, 0x2f7fc1, [x, 0.045, z]));
  parts.push(cyl(r - 0.025, r - 0.025, 0.01, 14, 0x9fd4f5, [x, 0.07, z]));
  parts.push(cyl(r * 0.5, r * 0.56, 0.2, 12, 0xcfe6f5, [x, 0.17, z]));
  parts.push(sph(r * 0.5, 10, 6, 0xcfe6f5, [x, 0.27, z], [1, 0.55, 1]));
  parts.push(cyl(r * 0.2, r * 0.2, 0.03, 8, 0x2f7fc1, [x, 0.32, z]));
}

/** Petit abri de bois en bâtière où les poussins se glissent à l'ombre. */
function aFrame(parts: Parts, x: number, z: number, w: number) {
  const d = 0.52;
  for (const s2 of [-1, 1]) parts.push(box(w, 0.03, d, s2 < 0 ? C.wood : 0xc2884d, [x, 0.22, z + (s2 * d) / 2 - s2 * 0.03], [(s2 * Math.PI) / 3.4, 0, 0]));
  parts.push(box(w + 0.03, 0.03, 0.04, C.woodDark, [x, 0.42, z]));
  for (const ex of [-1, 1]) parts.push(box(0.03, 0.03, d * 0.9, C.woodDark, [x + (ex * w) / 2, 0.06, z]));
}

/** Enseigne en bois peinte d'un poussin jaune. */
function chickSign(parts: Parts, x: number, y: number, z: number) {
  parts.push(box(0.5, 0.2, 0.025, C.woodDark, [x, y, z]));
  parts.push(box(0.46, 0.16, 0.012, 0xf6efe0, [x, y, z + 0.016]));
  for (const k of [-0.13, 0, 0.13]) {
    parts.push(sph(0.042, 7, 5, 0xf5c542, [x + k, y - 0.012, z + 0.026], [1, 0.95, 0.3]));
    parts.push(sph(0.026, 6, 4, 0xf5c542, [x + k + 0.03, y + 0.034, z + 0.026], [1, 1, 0.3]));
    parts.push(box(0.016, 0.01, 0.006, 0xf08a3a, [x + k + 0.058, y + 0.034, z + 0.034]));
  }
}

/**
 * La poussinière (façade et parc vers +z) : un bâtiment de bois chauffé au fond, sa trappe et sa
 * petite rampe, et devant lui le parc grillagé, en herbe, avec ses mangeoires et abreuvoirs à
 * poussins. Niveau 2 : plus grand, véranda vitrée, lanternon d'aération, abris et bac à sable. Les
 * repères (trappe, parc, mangeoires, portillon) viennent de nurseryPlan : la simulation s'en sert aussi.
 */
export function nurseryHouse(parts: Parts, windows: THREE.Mesh[], level: number) {
  const plan = nurseryPlan(level);
  const big = level >= 2;
  const { house: h, park, doorX } = plan;
  const cz = (h.z0 + h.z1) / 2;
  const cx = (h.x0 + h.x1) / 2;
  const fz0 = h.z1 + 0.05;
  const fz1 = plan.gate[1];
  const fx0 = park.x0 - 0.2;
  const fx1 = park.x1 + 0.2;
  // pas de sol dessiné : la vraie herbe de la ferme pousse dans le parc et sur les abords (voir
  // farmRenderer.updateGrass). Juste la terre battue là où les poussins passent le plus.
  const worn: Array<[number, number, number]> = [[doorX, h.z1 + 0.5, 0.62]];
  for (const [x, z, r] of [...plan.feeders, ...plan.drinkers]) worn.push([x, z, r + 0.34]);
  for (const [x, z, r] of worn) parts.push(cyl(r, r, 0.012, 16, EARTH, [x, 0.024, z], undefined, [1, 1, 0.82]));

  // bâtiment : soubassement de pierre, bardage de bois clair, angles blancs
  const y0 = 0.18;
  const y1 = big ? 1.5 : 1.3;
  parts.push(box(h.x1 - h.x0 + 0.05, y0, h.z1 - h.z0 + 0.05, STONE, [cx, y0 / 2 + 0.02, cz]));
  parts.push(box(h.x1 - h.x0, y1 - y0, h.z1 - h.z0, 0x8a6a48, [cx, (y0 + y1) / 2, cz]));
  boardsZ(parts, h.x0, h.x1, y0, y1, h.z1, 0xdcb887, 0xcfa873, 0.17);
  boardsX(parts, h.z0, h.z1, y0, y1, h.x1, 0xdcb887, 0xcfa873, 0.17);
  for (const [x, z] of [
    [h.x0, h.z1],
    [h.x1, h.z1],
    [h.x1, h.z0],
  ])
    parts.push(box(0.07, y1 - y0, 0.07, TRIM, [x, (y0 + y1) / 2, z]));
  // toit de tuiles, débord sur le parc
  const roof = gableRoof(parts, { cx, cz, y: y1, w: h.x1 - h.x0, d: h.z1 - h.z0, h: big ? 0.9 : 0.72, over: 0.2, side: 0.14, a: 0xc96a4a, b: 0xb85c3f, n: 7, ridge: 0x8f4a33, rive: TIMBER, gable: 0xdcb887 });
  // tuyau du poêle (le bâtiment est chauffé)
  parts.push(cyl(0.05, 0.05, 0.5, 8, IRON, [h.x1 - 0.7, roof.ridgeY + 0.1, h.z0 + 0.5]));
  parts.push(cone(0.09, 0.07, 8, IRON, [h.x1 - 0.7, roof.ridgeY + 0.38, h.z0 + 0.5]));
  // trappe des poussins, sa petite rampe et un auvent ; fenêtres chaudes de part et d'autre
  henDoor(parts, doorX, 0.06, 0.46, 0.42, h.z1 + 0.012, TIMBER);
  ramp(parts, doorX, 0.07, h.z1 + 0.01, h.z1 + 0.32, 0.44, 0xcfa873, C.woodDark);
  parts.push(box(0.72, 0.03, 0.4, 0xb85c3f, [doorX, 0.68, h.z1 + 0.18], [0.35, 0, 0]));
  for (const s2 of [-1, 1]) parts.push(box(0.03, 0.14, 0.26, TIMBER, [doorX + s2 * 0.33, 0.58, h.z1 + 0.12]));
  const winY = big ? 0.92 : 0.84;
  for (const wx of big ? [h.x0 + 0.85, h.x0 + 1.95, h.x1 - 1.95, h.x1 - 0.85] : [h.x0 + 0.72, h.x1 - 0.72]) farmWindow(parts, windows, wx, winY, h.z1 + 0.022, 0.46, 0.42);
  farmWindow(parts, windows, h.x1 + 0.022, winY, cz, 0.5, 0.42, true);
  chickSign(parts, doorX, y1 - 0.2 + (big ? 0.04 : 0), h.z1 + 0.03);
  lantern(parts, windows, doorX + 0.62, 0.92, h.z1 + 0.02);
  // gouttière et descente, côté caméra
  const [ey, ez] = roof.at(1, roof.len, 0);
  parts.push(box(h.x1 - h.x0 + 0.2, 0.05, 0.07, 0xc9ccd1, [cx, ey - 0.04, ez - 0.02]));
  parts.push(cyl(0.022, 0.022, ey - 0.1, 8, 0xc9ccd1, [h.x1 + 0.05, (ey + 0.05) / 2, h.z1 + 0.06]));
  if (big) {
    // lanternon d'aération sur le faîtage et véranda vitrée au bout du bâtiment
    parts.push(box(0.7, 0.2, 0.34, 0xdcb887, [cx - 0.9, roof.ridgeY + 0.08, cz]));
    for (let k = 0; k < 3; k++) parts.push(box(0.64, 0.025, 0.04, TRIM, [cx - 0.9, roof.ridgeY + 0.03 + k * 0.06, cz + 0.18], [0.5, 0, 0]));
    parts.push(prism(0.82, 0.16, 0.46, 0xb85c3f, [cx - 0.9, roof.ridgeY + 0.18, cz]));
    weathervane(parts, cx + 1.3, roof.ridgeY - 0.02, cz, 0.85);
  }
  // emplacements des couveuses : un dallage de chaque côté, libre tant qu'aucune n'y est installée
  for (const q of plan.seats) {
    const along = q.rot % 2 === 1;
    const pw = (along ? 1.14 : 2.14) * q.k;
    const pd = (along ? 2.14 : 1.14) * q.k;
    parts.push(box(pw, 0.05, pd, 0xd9cfbd, [q.x, 0.04, q.z]));
    for (const s2 of [-1, 1]) {
      parts.push(box(pw + 0.06, 0.07, 0.05, 0xbcb19b, [q.x, 0.05, q.z + (s2 * pd) / 2]));
      parts.push(box(0.05, 0.07, pd + 0.06, 0xbcb19b, [q.x + (s2 * pw) / 2, 0.05, q.z]));
    }
    for (let k = 1; k < 4; k++) {
      const t = -0.5 + k / 4;
      if (along) parts.push(box(pw, 0.004, 0.018, 0xc2b8a4, [q.x, 0.067, q.z + t * pd]));
      else parts.push(box(0.018, 0.004, pd, 0xc2b8a4, [q.x + t * pw, 0.067, q.z]));
    }
  }
  // abords, de l'autre côté du bâtiment : bottes de paille, sacs de grain, bûches du poêle
  const hx = big ? 1.1 : 0.82;
  const sz = big ? 0.72 : 0.78;
  parts.push(box(0.55, 0.3, 0.36, C.straw, [hx, 0.17, sz]));
  parts.push(box(0.57, 0.03, 0.38, 0xd8b85a, [hx, 0.22, sz]));
  parts.push(box(0.5, 0.26, 0.34, C.straw, [hx, 0.45, sz], [0, 0.3, 0]));
  const [bagX, bagZ] = big ? [0.42, 0.78] : [0.86, 1.34];
  for (let k = 0; k < 2; k++) parts.push(box(0.3, 0.16, 0.42, k ? 0xe9dfc8 : 0xf0e6cf, [bagX, 0.1 + k * 0.15, bagZ], [0, k * 0.4, 0]));
  const [logX, logZ] = big ? [1.42, 1.42] : [0.86, 1.86];
  for (let k = 0; k < 6; k++) parts.push(cyl(0.055, 0.055, 0.42, 7, k % 2 ? 0x8b6240 : 0x7a5436, [logX + (k % 3) * 0.12 - 0.12, 0.08 + Math.floor(k / 3) * 0.1, logZ], [Math.PI / 2, 0, 0]));

  // grillage : poteaux de bois et lisses (le treillis et le portillon sont à part, dans models.ts)
  const post = (x: number, z: number) => parts.push(box(0.07, 0.74, 0.07, C.woodDark, [x, 0.38, z]));
  const stepsOf = (a: number, b: number) => Math.max(1, Math.round((b - a) / 1.05));
  for (const z of [fz1]) {
    const n = stepsOf(fx0, fx1);
    for (let i = 0; i <= n; i++) post(fx0 + ((fx1 - fx0) * i) / n, z);
  }
  for (const x of [fx0, fx1]) {
    const n = stepsOf(fz0, fz1);
    for (let i = 0; i < n; i++) post(x, fz0 + ((fz1 - fz0) * i) / n);
  }
  for (const [a, b] of [
    [fx0, h.x0],
    [h.x1, fx1],
  ]) {
    const mid = (a + b) / 2;
    post(mid, fz0);
    for (const y of [0.1, 0.68]) parts.push(box(b - a, 0.04, 0.03, C.wood, [mid, y, fz0]));
  }
  const gx = plan.gate[0];
  const gh = 0.42;
  for (const y of [0.1, 0.68]) {
    parts.push(box(gx - gh - fx0, 0.04, 0.03, C.wood, [(fx0 + gx - gh) / 2, y, fz1]));
    parts.push(box(fx1 - gx - gh, 0.04, 0.03, C.wood, [(fx1 + gx + gh) / 2, y, fz1]));
    for (const x of [fx0, fx1]) parts.push(box(0.03, 0.04, fz1 - fz0, C.wood, [x, y, (fz0 + fz1) / 2]));
  }
  for (const s2 of [-1, 1]) parts.push(box(0.09, 0.8, 0.09, C.woodDark, [gx + s2 * gh, 0.4, fz1]));

  // l'intérieur du parc : à manger, à boire, de quoi s'amuser
  for (const [x, z, r] of plan.feeders) chickFeeder(parts, x, z, r);
  for (const [x, z, r] of plan.drinkers) chickDrinker(parts, x, z, r);
  aFrame(parts, park.x1 - 0.55, park.z0 + 0.4, 0.8);
  parts.push(cyl(0.07, 0.08, 0.9, 7, 0x8b6240, [park.x0 + 0.75, 0.11, park.z1 - 0.35], [0, 0.5, Math.PI / 2]));
  parts.push(cyl(0.3, 0.42, 0.14, 10, C.straw, [park.x0 + 0.5, 0.08, park.z0 + 0.42]));
  if (big) {
    aFrame(parts, park.x0 + 0.65, park.z0 + 1.7, 0.9);
    // bac à sable pour les bains de poussière
    parts.push(box(1.2, 0.09, 0.8, C.woodDark, [park.x1 - 1.0, 0.05, park.z1 - 0.6]));
    parts.push(box(1.08, 0.04, 0.68, 0xe7d3a2, [park.x1 - 1.0, 0.09, park.z1 - 0.6]));
    // perchoir de branches
    for (const s2 of [-1, 1]) parts.push(box(0.05, 0.3, 0.05, C.woodDark, [gx + 1.6 + s2 * 0.45, 0.16, park.z1 - 0.5]));
    parts.push(cyl(0.03, 0.03, 1.05, 7, 0x8b6240, [gx + 1.6, 0.3, park.z1 - 0.5], [0, 0, Math.PI / 2]));
    // un jeune pommier derrière le grillage, pour l'ombre
    parts.push(cyl(0.05, 0.07, 0.9, 7, C.trunk, [fx0 + 0.75, 0.46, h.z0 + 0.8]));
    parts.push(ico(0.48, 1, 0x8cc46e, [fx0 + 0.75, 1.15, h.z0 + 0.8]));
    parts.push(ico(0.3, 1, 0x9ccf7e, [fx0 + 1.0, 1.38, h.z0 + 0.95]));
  }
}

// ==================================================== MAGASIN DE LA FERME ====
const SHOP_GREEN = 0x2f5d46;
const SHOP_GREEN_LIGHT = 0x3f7a5c;
const CARTON = 0xcbb389;

/** Vitrine de façade : cadre vert, vitre qui s'allume le soir, étagères de boîtes d'œufs et de paniers. */
function shopWindow(parts: Parts, windows: THREE.Mesh[], x: number, y: number, z: number, w: number, h: number) {
  parts.push(box(w + 0.05, h + 0.05, 0.02, 0x23262d, [x, y, z + 0.012]));
  windows.push(glassPane(w, h, [x, y, z + 0.028], 0, 0.012));
  // étagères : la marchandise se voit depuis la rue
  const shelves = h > 0.8 ? [y - h / 2 + 0.07, y + 0.03] : [y - h / 2 + 0.07];
  let k = 0;
  for (const sy of shelves) {
    parts.push(box(w - 0.05, 0.022, 0.07, 0x8b6240, [x, sy, z + 0.055]));
    for (let px = x - w / 2 + 0.14; px < x + w / 2 - 0.08; px += 0.3) {
      const r = rnd(k++ + x * 10);
      if (r < 0.55) {
        // boîte de six œufs, couvercle ouvert
        parts.push(box(0.23, 0.05, 0.07, CARTON, [px, sy + 0.035, z + 0.06]));
        for (let e = 0; e < 3; e++) parts.push(sph(0.024, 6, 4, e === 1 && r < 0.3 ? 0xd9a873 : 0xf6efe2, [px - 0.06 + e * 0.06, sy + 0.07, z + 0.066], [1, 1.25, 1]));
      } else if (r < 0.8) {
        // panier d'osier garni
        parts.push(cyl(0.085, 0.065, 0.07, 9, 0xb98a50, [px, sy + 0.046, z + 0.06]));
        for (let e = 0; e < 3; e++) parts.push(sph(0.024, 6, 4, 0xf6efe2, [px - 0.04 + e * 0.04, sy + 0.09, z + 0.06], [1, 1.25, 1]));
      } else {
        // pot de confiture à couvercle
        parts.push(cyl(0.04, 0.04, 0.09, 8, r < 0.9 ? 0xc0392b : 0xe6a23c, [px, sy + 0.055, z + 0.06]));
        parts.push(cyl(0.043, 0.043, 0.018, 8, 0xf3eee4, [px, sy + 0.108, z + 0.06]));
      }
    }
  }
  // cadre et petits-bois devant la vitrine
  parts.push(box(w + 0.14, 0.05, 0.05, SHOP_GREEN, [x, y + h / 2 + 0.025, z + 0.045]));
  parts.push(box(w + 0.2, 0.06, 0.1, SHOP_GREEN, [x, y - h / 2 - 0.03, z + 0.06]));
  for (const s2 of [-1, 1]) parts.push(box(0.05, h + 0.08, 0.05, SHOP_GREEN, [x + s2 * (w / 2 + 0.025), y, z + 0.045]));
  const bars = Math.max(1, Math.round(w / 0.75) - 1);
  for (let i = 1; i <= bars; i++) parts.push(box(0.022, h, 0.02, SHOP_GREEN, [x - w / 2 + (w * i) / (bars + 1), y, z + 0.1]));
}

/**
 * Le dernier niveau de l'étal : un vrai magasin de ferme, large de 8 m, sur sa terrasse de pierre.
 * Enduit crème sur soubassement de moellons, boiseries vertes, grandes vitrines garnies, porte vitrée
 * sous auvent, toit de tuiles et lucarne à pignon, et devant la façade le long comptoir où les
 * vendeurs servent les clients, côte à côte. Repères : l'origine du modèle est celle de l'étal,
 * le comptoir et la rangée des vendeurs sont calés sur standLayout(4).
 */
export function farmShop(parts: Parts, windows: THREE.Mesh[]) {
  const x0 = -1.3;
  const x1 = 6.9;
  const zb = -0.1;
  const zf = 2.4;
  const cx = (x0 + x1) / 2;
  const cz = (zb + zf) / 2;
  const y1 = 2.3;
  const plinth = 0.36;
  // terrasse de pierre et ses joints
  parts.push(box(x1 - x0 + 0.5, 0.09, 4.0, 0xd9cdb4, [cx, 0.045, 1.85]));
  for (let x = x0 - 0.1; x < x1 + 0.2; x += 0.62) parts.push(box(0.02, 0.006, 4.0, 0xc4b79d, [x, 0.092, 1.85]));
  for (let z = -0.1; z < 3.85; z += 0.62) parts.push(box(x1 - x0 + 0.5, 0.006, 0.02, 0xc4b79d, [cx, 0.092, z]));
  // murs : soubassement et enduit
  parts.push(box(x1 - x0, y1, zf - zb, PLASTER, [cx, y1 / 2, cz]));
  parts.push(box(x1 - x0 + 0.04, plinth, zf - zb + 0.04, STONE, [cx, plinth / 2, cz]));
  stones(parts, x0 - 0.02, x1 + 0.02, zb, zf + 0.02, plinth);
  for (const [x, z] of [
    [x0, zf],
    [x1, zf],
    [x1, zb],
  ])
    parts.push(box(0.1, y1, 0.1, SHOP_GREEN, [x, y1 / 2, z]));
  // vitrines et petite fenêtre de façade
  const wy = 1.02;
  shopWindow(parts, windows, 0.2, wy, zf, 2.3, 1.1);
  shopWindow(parts, windows, 2.8, wy, zf, 2.3, 1.1);
  shopWindow(parts, windows, 4.6, wy, zf, 0.76, 1.1);
  // porte vitrée, imposte, marche et auvent
  const dx = 5.8;
  parts.push(box(1.06, 1.62, 0.03, SHOP_GREEN, [dx, 0.85, zf + 0.018]));
  windows.push(glassPane(0.66, 0.9, [dx, 0.98, zf + 0.04], 0, 0.012));
  windows.push(glassPane(0.86, 0.18, [dx, 1.56, zf + 0.04], 0, 0.012));
  parts.push(box(0.05, 0.96, 0.02, SHOP_GREEN_LIGHT, [dx, 0.98, zf + 0.05]));
  parts.push(box(0.05, 0.05, 0.05, 0xd9b35a, [dx + 0.3, 0.86, zf + 0.06]));
  parts.push(box(1.2, 0.05, 0.42, 0xbfb29a, [dx, 0.115, zf + 0.21]));
  parts.push(box(1.32, 0.04, 0.6, SHOP_GREEN, [dx, 1.92, zf + 0.26], [0.22, 0, 0]));
  for (const s2 of [-1, 1]) parts.push(box(0.03, 0.03, 0.44, IRON, [dx + s2 * 0.56, 1.8, zf + 0.2], [-0.5, 0, 0]));
  // bandeau de boiserie au-dessus du store
  parts.push(box(5.9, 0.42, 0.05, SHOP_GREEN, [1.75, 2.02, zf + 0.025]));
  // store à rayures vertes et crème au-dessus des vitrines, volant festonné
  const stripes = 22;
  const awX0 = -1.15;
  const awX1 = 4.95;
  const awW = (awX1 - awX0) / stripes;
  for (let i = 0; i < stripes; i++) {
    const x = awX0 + awW * (i + 0.5);
    const c = i % 2 ? 0xf6f1e4 : SHOP_GREEN_LIGHT;
    parts.push(box(awW + 0.002, 0.025, 0.56, c, [x, 1.7, zf + 0.27], [0.33, 0, 0]));
    parts.push(box(awW + 0.002, 0.09, 0.015, c, [x, 1.55, zf + 0.53]));
  }
  for (const x of [awX0 + 0.1, cx - 0.6, awX1 - 0.1]) parts.push(box(0.02, 0.02, 0.56, IRON, [x, 1.68, zf + 0.26], [0.33, 0, 0]));
  // côté est : fenêtre à petits carreaux et volets, jardinière, caisses
  farmWindow(parts, windows, x1 + 0.052, 1.1, cz, 0.74, 0.74, true);
  for (const s2 of [-1, 1]) parts.push(box(0.03, 0.82, 0.32, SHOP_GREEN, [x1 + 0.07, 1.1, cz + s2 * 0.58]));
  parts.push(box(0.2, 0.14, 0.9, C.woodDark, [x1 + 0.13, 0.62, cz]));
  for (let i = 0; i < 7; i++) parts.push(ico(0.08, 0, i % 2 ? 0x7fb35a : 0x6ea84f, [x1 + 0.16, 0.74, cz - 0.36 + i * 0.12]));
  for (let i = 0; i < 7; i++) parts.push(ico(0.04, 0, GERANIUMS[i % 4], [x1 + 0.22, 0.8, cz - 0.36 + i * 0.12]));
  // toit de tuiles, lucarne à pignon, cheminée, girouette
  const roof = gableRoof(parts, { cx, cz, y: y1, w: x1 - x0, d: zf - zb, h: 1.15, over: 0.24, side: 0.2, a: 0xc96a4a, b: 0xb85c3f, n: 9, ridge: 0x8f4a33, rive: TIMBER, gable: PLASTER });
  const lx = 1.75;
  const [ly, lz] = roof.at(1, roof.len * 0.55, 0);
  parts.push(box(1.05, 0.72, 0.9, PLASTER, [lx, ly + 0.24, lz - 0.28]));
  parts.push(prism(1.25, 0.46, 1.08, 0xb85c3f, [lx, ly + 0.6, lz - 0.28], Math.PI / 2));
  windows.push(glassPane(0.52, 0.42, [lx, ly + 0.28, lz + 0.18], 0, 0.012));
  parts.push(box(0.64, 0.05, 0.05, SHOP_GREEN, [lx, ly + 0.52, lz + 0.2]));
  parts.push(box(0.68, 0.05, 0.08, SHOP_GREEN, [lx, ly + 0.05, lz + 0.21]));
  for (const s2 of [-1, 1]) parts.push(box(0.05, 0.46, 0.05, SHOP_GREEN, [lx + s2 * 0.3, ly + 0.28, lz + 0.2]));
  parts.push(box(0.02, 0.42, 0.02, SHOP_GREEN, [lx, ly + 0.28, lz + 0.205]));
  parts.push(box(0.4, 0.8, 0.4, 0xc9b9a0, [5.6, roof.ridgeY + 0.18, cz - 0.3]));
  parts.push(box(0.46, 0.06, 0.46, STONE_DARK, [5.6, roof.ridgeY + 0.6, cz - 0.3]));
  parts.push(cyl(0.07, 0.07, 0.16, 8, 0xa86b4a, [5.6, roof.ridgeY + 0.7, cz - 0.3]));
  weathervane(parts, -0.2, roof.ridgeY - 0.02, cz, 1.1);
  // grande enseigne dressée au bord du toit, bien visible de la rue (le nom de la ferme est peint
  // dessus, dans models.ts) : cadre vert, filet d'or, deux jambes de force
  parts.push(box(4.7, 0.62, 0.05, SHOP_GREEN, [1.75, 2.62, zf + 0.5]));
  parts.push(box(4.82, 0.04, 0.08, 0xd9b35a, [1.75, 2.95, zf + 0.5]));
  parts.push(box(4.82, 0.04, 0.08, 0xd9b35a, [1.75, 2.29, zf + 0.5]));
  for (const x of [-0.3, 3.8]) parts.push(box(0.05, 0.05, 0.9, IRON, [x, 2.72, zf + 0.1], [0.32, 0, 0]));
  // gouttière et lanternes
  const [ey, ez] = roof.at(1, roof.len, 0);
  parts.push(box(x1 - x0 + 0.34, 0.06, 0.08, 0xc9ccd1, [cx, ey - 0.05, ez - 0.02]));
  parts.push(cyl(0.028, 0.028, ey - 0.12, 8, 0xc9ccd1, [x1 + 0.1, (ey + 0.06) / 2, zf + 0.1]));
  lantern(parts, windows, 5.05, 1.5, zf + 0.01);
  lantern(parts, windows, 6.55, 1.5, zf + 0.01);

  // le long comptoir : façade de planches, plateau, marchandise et balance
  const c0 = 0.4;
  const c1 = 5.2;
  const cc = (c0 + c1) / 2;
  const cw = c1 - c0;
  const cZ = 3.25;
  parts.push(box(cw, 0.72, 0.4, 0x8a6a48, [cc, 0.44, cZ]));
  const boards = Math.round(cw / 0.2);
  for (let i = 0; i < boards; i++) parts.push(box(cw / boards - 0.012, 0.68, 0.015, i % 3 === 1 ? 0xb98a55 : C.wood, [c0 + (cw * (i + 0.5)) / boards, 0.44, cZ + 0.205]));
  parts.push(box(cw + 0.12, 0.05, 0.5, SHOP_GREEN, [cc, 0.815, cZ]));
  // à chaque guichet : des boîtes d'œufs ouvertes, et un panier entre deux
  for (let i = 0; i < 4; i++) {
    const x = cc + (i - 1.5) * 1.1;
    parts.push(box(0.44, 0.05, 0.22, CARTON, [x, 0.865, cZ - 0.02]));
    for (let e = 0; e < 8; e++) parts.push(sph(0.024, 6, 4, e % 5 === 2 ? 0xd9a873 : 0xf6efe2, [x - 0.16 + (e % 4) * 0.105, 0.9, cZ - 0.07 + Math.floor(e / 4) * 0.1], [1, 1.25, 1]));
  }
  for (const x of [cc - 2.2, cc + 2.2]) {
    parts.push(cyl(0.12, 0.09, 0.11, 10, 0xb98a50, [x, 0.895, cZ]));
    for (let e = 0; e < 5; e++) parts.push(sph(0.03, 6, 4, e % 2 ? 0xd9a873 : 0xf6efe2, [x - 0.06 + (e % 3) * 0.06, 0.96, cZ - 0.04 + (e % 2) * 0.07], [1, 1.25, 1]));
  }
  // balance et caisse
  parts.push(box(0.2, 0.05, 0.16, 0xd8dcdf, [cc + 0.55, 0.87, cZ + 0.1]));
  parts.push(cyl(0.03, 0.03, 0.1, 8, IRON, [cc + 0.55, 0.93, cZ + 0.1]));
  parts.push(cyl(0.09, 0.08, 0.015, 12, 0xd8dcdf, [cc + 0.55, 0.985, cZ + 0.1]));
  parts.push(box(0.26, 0.14, 0.2, 0x3a3f4a, [cc - 0.55, 0.91, cZ + 0.1]));
  parts.push(box(0.2, 0.05, 0.015, 0x48d47a, [cc - 0.55, 0.96, cZ + 0.015]));
  // ardoise des prix accrochée au comptoir
  for (const x of [cc - 1.65, cc + 1.65]) {
    parts.push(box(0.46, 0.34, 0.02, C.woodDark, [x, 0.52, cZ + 0.222]));
    parts.push(box(0.4, 0.28, 0.012, 0x37443b, [x, 0.52, cZ + 0.232]));
    for (let k = 0; k < 3; k++) parts.push(box(0.28 - k * 0.04, 0.012, 0.004, 0xf3eee4, [x - k * 0.02, 0.6 - k * 0.07, cZ + 0.24]));
  }
  // de chaque côté de la terrasse : caisses d'œufs et paille, arbustes en pot
  for (const [x, z, r] of [
    [-0.75, 3.1, 0.15],
    [-0.62, 3.46, -0.1],
  ] as const) {
    parts.push(box(0.5, 0.26, 0.34, 0xc9a26b, [x, 0.22, z], [0, r, 0]));
    parts.push(box(0.46, 0.03, 0.3, C.straw, [x, 0.36, z], [0, r, 0]));
    for (let e = 0; e < 4; e++) parts.push(sph(0.03, 6, 4, e % 2 ? 0xd9a873 : 0xf6efe2, [x - 0.12 + e * 0.08, 0.4, z], [1, 1.25, 1]));
  }
  // ardoise sur pied, tournée vers le trottoir
  parts.push(box(0.46, 0.66, 0.03, C.woodDark, [-0.95, 0.44, 3.72], [-0.14, 0.25, 0]));
  parts.push(box(0.38, 0.56, 0.012, 0x37443b, [-0.945, 0.45, 3.74], [-0.14, 0.25, 0]));
  for (const px of [5.1, 6.5]) {
    parts.push(cyl(0.17, 0.12, 0.26, 10, 0xa8613d, [px, 0.22, zf + 0.34]));
    parts.push(cyl(0.02, 0.03, 0.34, 6, C.trunk, [px, 0.5, zf + 0.34]));
    parts.push(ico(0.25, 1, 0x7fb35a, [px, 0.82, zf + 0.34]));
  }
}

// ======================================================== HÔTEL DE VILLE ====
/** Tronc de pyramide à base rectangulaire : les deux pentes d'un toit à la Mansart. */
function frustum(w0: number, d0: number, w1: number, d1: number, h: number, color: number, p: V3) {
  const g = new THREE.BoxGeometry(1, h, 1);
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const top = a.getY(i) > 0;
    a.setXYZ(i, a.getX(i) * (top ? w1 : w0), a.getY(i), a.getZ(i) * (top ? d1 : d0));
  }
  const out = finalizeExport(g, color, p);
  out.computeVertexNormals();
  return out;
}

/** Plaque gravée au fronton. */
function hallPlaque(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * h) / w);
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = () => {
    g.fillStyle = '#20364d';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#e3b23c';
    g.lineWidth = 7;
    g.strokeRect(10, 10, c.width - 20, c.height - 20);
    g.fillStyle = '#f7e6b2';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "700 88px Georgia, 'Times New Roman', serif";
    g.fillText('HÔTEL DE VILLE', c.width / 2, c.height / 2 + 5, c.width - 70);
    tex.needsUpdate = true;
  };
  draw();
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
}

/** Drapeau tricolore qui flotte au vent : on déforme ses sommets à chaque image. */
function hallFlag(w: number, h: number) {
  const n = 15;
  const geo = new THREE.PlaneGeometry(w, h, n, 4).toNonIndexed();
  geo.translate(w / 2, 0, 0);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const stripes = [new THREE.Color(0x24439c), new THREE.Color(0xf7f7f2), new THREE.Color(0xd9303a)];
  for (let i = 0; i < pos.count; i += 3) {
    const mid = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const col = stripes[Math.min(2, Math.floor((mid / w) * 3))];
    for (let k = 0; k < 3; k++) col.toArray(colors, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const base = Float32Array.from(pos.array as Float32Array);
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.castShadow = true;
  return {
    mesh: m,
    wave(t: number) {
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        const k = x / w;
        pos.setXYZ(i, x * (1 - 0.03 * Math.sin(t * 2.1)), base[i * 3 + 1] + Math.sin(x * 4.2 - t * 3.1) * 0.035 * k, Math.sin(x * 6.5 - t * 5.2) * 0.075 * k + Math.sin(x * 2.4 - t * 1.9) * 0.05 * k);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    },
  };
}

export interface TownHall {
  group: THREE.Group;
  /** Heure de jeu (0 à 24) et temps qui passe : l'horloge donne l'heure de la ferme, le drapeau flotte. */
  tick(hours: number, time: number): void;
}

/**
 * Hôtel de ville à la française, où logent les salariés de la ferme : rez-de-chaussée en pierre de
 * taille, étage enduit aux chaînages clairs, hautes fenêtres à volets et jardinières, toit à la
 * Mansart en ardoise et ses lucarnes, pavillon central à fronton, perron, colonnes et balcon de fer
 * forgé, beffroi à horloge, cloche dorée et drapeau. Origine : milieu de la façade, au sol.
 */
export function townHall(): TownHall {
  const parts: Parts = [];
  const windows: THREE.Mesh[] = [];
  const group = new THREE.Group();

  const CREAM = 0xf3e7cf;
  const ASHLAR = 0xdfd3bb;
  const ASHLAR_J = 0xc9bca3;
  const TUFFEAU = 0xfaf3e4;
  const PLINTH = 0xa99d8a;
  const SLATE = 0x56636f;
  const SLATE_D = 0x47535f;
  const ZINC = 0xa4afb9;
  const SHUTTER = 0x4f7f9c;
  const GOLD = 0xe3b23c;
  const DOOR = 0x23435a;
  const HEDGE = 0x5a8a45;

  const W = 4.5; // demi-largeur
  const D = 4.3; // profondeur
  const PW = 1.65; // demi-largeur du pavillon central
  const PZ = 0.42; // saillie du pavillon
  const H1 = 1.75; // haut du rez-de-chaussée
  const H2 = 3.25; // haut de l'étage
  const PH = 3.6; // haut du pavillon
  const cz = -D / 2;
  const pcz = (PZ - D) / 2;
  const pd = D + PZ;

  /** Un volume à deux niveaux : soubassement, pierre de taille à joints creux, bandeau, corniche. */
  const shell = (w: number, d: number, z: number, top: number) => {
    parts.push(box(w, top, d, CREAM, [0, top / 2, z]));
    parts.push(box(w + 0.12, 0.24, d + 0.12, PLINTH, [0, 0.12, z]));
    parts.push(box(w + 0.04, H1 - 0.24, d + 0.04, ASHLAR, [0, 0.24 + (H1 - 0.24) / 2, z]));
    for (let y = 0.44; y < H1 - 0.08; y += 0.22) parts.push(box(w + 0.06, 0.016, d + 0.06, ASHLAR_J, [0, y, z]));
    parts.push(box(w + 0.14, 0.09, d + 0.14, TUFFEAU, [0, H1 + 0.02, z]));
    parts.push(box(w + 0.16, 0.09, d + 0.16, TUFFEAU, [0, top - 0.02, z]));
    parts.push(box(w + 0.32, 0.07, d + 0.32, TUFFEAU, [0, top + 0.06, z]));
  };
  shell(W * 2, D, cz, H2);
  shell(PW * 2, pd, pcz, PH);

  // chaînages d'angle de l'étage, en harpe sur la façade et le côté
  let i = 0;
  for (let y = H1 + 0.16; y < H2 - 0.1; y += 0.2, i++) {
    const s = i % 2 ? 0.12 : 0.18;
    for (const sx of [-1, 1]) parts.push(box(s, 0.16, 0.03, TUFFEAU, [sx * (W - s / 2), y, 0.015]));
    parts.push(box(0.03, 0.16, s, TUFFEAU, [W + 0.015, y, -s / 2]));
    parts.push(box(0.03, 0.16, s, TUFFEAU, [W + 0.015, y, -D + s / 2]));
  }
  // pilastres du pavillon
  for (const sx of [-1, 1]) parts.push(box(0.16, PH - H1 - 0.1, 0.05, TUFFEAU, [sx * (PW - 0.08), (PH + H1) / 2, PZ + 0.025]));

  // ------------------------------------------------------------- Fenêtres ----
  const archWindow = (x: number, z: number, w: number, h: number) => {
    const y = 0.26 + 0.1 + h / 2;
    parts.push(cyl(w / 2 + 0.07, w / 2 + 0.07, 0.03, 14, TUFFEAU, [x, y + h / 2, z + 0.012], [Math.PI / 2, 0, 0]));
    const fan = new THREE.Mesh(new THREE.CircleGeometry(w / 2 - 0.01, 12, 0, Math.PI), GLOW);
    fan.position.set(x, y + h / 2 + 0.01, z + 0.03);
    windows.push(fan);
    parts.push(box(0.09, 0.13, 0.05, TUFFEAU, [x, y + h / 2 + w / 2 + 0.05, z + 0.03]));
    windowZ(parts, windows, x, y, z, w, h, TUFFEAU);
  };
  for (const sx of [-1, 1]) {
    for (const x of [2.15, 3.03, 3.91]) {
      archWindow(sx * x, 0, 0.4, 0.84);
      windowZ(parts, windows, sx * x, H1 + 0.72, 0, 0.32, 0.98, TUFFEAU, { shutters: SHUTTER, flowers: true });
    }
    archWindow(sx * 1.2, PZ, 0.38, 0.84);
    windowZ(parts, windows, sx * 1.16, H1 + 0.72, PZ, 0.38, 0.98, TUFFEAU);
    // fronton triangulaire au-dessus des fenêtres du pavillon
    parts.push(prism(0.08, 0.13, 0.62, TUFFEAU, [sx * 1.16, H1 + 1.27, PZ + 0.04], Math.PI / 2));
  }
  // côté tourné vers la caméra
  for (const z of [-0.8, -2.15, -3.5]) {
    windowX(parts, windows, W, 0.86, z, 0.42, 0.86, TUFFEAU);
    windowX(parts, windows, W, H1 + 0.72, z, 0.4, 0.98, TUFFEAU);
  }

  // ---------------------------------------------------- Porte, perron, balcon ----
  [
    [2.5, 0.7, 0.03],
    [2.2, 0.48, 0.09],
    [1.9, 0.26, 0.15],
  ].forEach(([w, d, y]) => parts.push(box(w, 0.06, d, 0xcfc5b2, [0, y, PZ + d / 2])));
  const doorW = 0.96;
  const doorH = 1.22;
  const sill = 0.18;
  parts.push(cyl(0.56, 0.56, 0.05, 18, TUFFEAU, [0, sill + doorH, PZ + 0.02], [Math.PI / 2, 0, 0]));
  parts.push(box(doorW + 0.22, doorH + 0.06, 0.06, TUFFEAU, [0, sill + (doorH + 0.06) / 2, PZ + 0.024]));
  for (const s of [-1, 1]) {
    parts.push(box(doorW / 2 - 0.012, doorH, 0.03, DOOR, [(s * doorW) / 4, sill + doorH / 2, PZ + 0.058]));
    for (const y of [0.34, 0.86]) parts.push(box(doorW / 2 - 0.13, 0.38, 0.012, shade(DOOR, 1.35), [(s * doorW) / 4, sill + y, PZ + 0.078]));
    parts.push(ico(0.024, 0, GOLD, [s * 0.05, sill + 0.6, PZ + 0.085]));
  }
  const fan = new THREE.Mesh(new THREE.CircleGeometry(0.47, 16, 0, Math.PI), GLOW);
  fan.position.set(0, sill + doorH + 0.02, PZ + 0.052);
  windows.push(fan);
  for (let k = -1; k <= 1; k++) parts.push(box(0.018, 0.46, 0.012, TUFFEAU, [k * 0.2, sill + doorH + 0.24, PZ + 0.058], [0, 0, -k * 0.5]));
  parts.push(box(0.13, 0.17, 0.08, TUFFEAU, [0, sill + doorH + 0.5, PZ + 0.05]));
  // colonnes de part et d'autre de la porte
  for (const s of [-1, 1]) {
    const cx = s * 0.74;
    parts.push(box(0.24, 0.1, 0.24, TUFFEAU, [cx, sill + 0.05, PZ + 0.2]));
    parts.push(cyl(0.07, 0.085, H1 - sill - 0.2, 10, TUFFEAU, [cx, (H1 + sill) / 2, PZ + 0.2]));
    parts.push(box(0.22, 0.09, 0.22, TUFFEAU, [cx, H1 - 0.1, PZ + 0.2]));
  }
  // balcon en fer forgé, sur les colonnes
  const by = H1 + 0.04;
  parts.push(box(1.9, 0.09, 0.6, TUFFEAU, [0, by, PZ + 0.28]));
  for (let x = -0.9; x <= 0.901; x += 0.1) parts.push(box(0.016, 0.38, 0.016, IRON, [x, by + 0.23, PZ + 0.55]));
  for (let z = 0.08; z < 0.54; z += 0.1) for (const s of [-1, 1]) parts.push(box(0.016, 0.38, 0.016, IRON, [s * 0.9, by + 0.23, PZ + z]));
  parts.push(box(1.86, 0.03, 0.03, IRON, [0, by + 0.42, PZ + 0.55]));
  for (const s of [-1, 1]) parts.push(box(0.03, 0.03, 0.5, IRON, [s * 0.9, by + 0.42, PZ + 0.3]));
  parts.push(box(1.84, 0.02, 0.02, GOLD, [0, by + 0.09, PZ + 0.55]));
  // porte-fenêtre du balcon
  windowZ(parts, windows, 0, H1 + 0.68, PZ, 0.56, 1.1, TUFFEAU);
  parts.push(prism(0.08, 0.15, 0.82, TUFFEAU, [0, H1 + 1.28, PZ + 0.04], Math.PI / 2));

  // plaque gravée, sous le fronton
  parts.push(box(2.54, 0.36, 0.04, TUFFEAU, [0, H1 + 1.62, PZ + 0.02]));
  const plaque = hallPlaque(2.42, 0.28);
  plaque.position.set(0, H1 + 1.62, PZ + 0.045);
  group.add(plaque);

  // ----------------------------------------------------------------- Toits ----
  const r0 = H2 + 0.1;
  parts.push(frustum(W * 2 + 0.22, D + 0.22, W * 2 - 0.9, D - 0.95, 1.0, SLATE, [0, r0 + 0.5, cz]));
  parts.push(frustum(W * 2 - 0.9, D - 0.95, W * 2 - 2.6, 1.1, 0.4, SLATE_D, [0, r0 + 1.2, cz]));
  for (const t of [0.2, 0.4, 0.6, 0.8]) parts.push(box(W * 2 + 0.22 - 1.12 * t + 0.01, 0.014, D + 0.22 - 1.17 * t + 0.01, SLATE_D, [0, r0 + t, cz]));
  parts.push(box(W * 2 - 0.86, 0.045, D - 0.91, ZINC, [0, r0 + 1.0, cz]));
  parts.push(box(W * 2 - 2.56, 0.04, 1.14, SLATE_D, [0, r0 + 1.42, cz]));
  parts.push(box(W * 2 - 2.5, 0.03, 0.06, ZINC, [0, r0 + 1.45, cz]));
  // crête de fer forgé et épis dorés sur le faîtage
  for (let x = -W + 1.4; x <= W - 1.399; x += 0.34) parts.push(box(0.018, 0.12, 0.018, IRON, [x, r0 + 1.5, cz]));
  parts.push(box(W * 2 - 2.8, 0.018, 0.018, IRON, [0, r0 + 1.55, cz]));
  for (const s of [-1, 1]) {
    parts.push(cyl(0.012, 0.022, 0.36, 6, IRON, [s * (W - 1.35), r0 + 1.6, cz]));
    parts.push(ico(0.042, 0, GOLD, [s * (W - 1.35), r0 + 1.8, cz]));
  }
  // lucarnes de la façade et du côté
  const dormerZ = (x: number) => {
    parts.push(box(0.52, 0.56, 0.52, CREAM, [x, r0 + 0.38, -0.26]));
    parts.push(prism(0.68, 0.22, 0.68, SLATE, [x, r0 + 0.66, -0.3], Math.PI / 2));
    parts.push(prism(0.04, 0.17, 0.56, TUFFEAU, [x, r0 + 0.66, 0.01], Math.PI / 2));
    windowZ(parts, windows, x, r0 + 0.37, 0, 0.26, 0.36, TUFFEAU);
  };
  for (const x of [2.59, 3.47]) for (const s of [-1, 1]) dormerZ(s * x);
  for (const z of [-1.35, -2.95]) {
    parts.push(box(0.52, 0.56, 0.52, CREAM, [W - 0.26, r0 + 0.38, z]));
    parts.push(prism(0.68, 0.22, 0.68, SLATE, [W - 0.3, r0 + 0.66, z]));
    windowX(parts, windows, W, r0 + 0.37, z, 0.26, 0.36, TUFFEAU);
  }

  // pavillon : toit à deux pans et fronton sculpté, médaillon doré
  parts.push(prism(pd - 0.1, 0.62, PW * 2 + 0.14, SLATE, [0, PH + 0.09, pcz], Math.PI / 2));
  parts.push(prism(0.16, 0.7, PW * 2 + 0.42, TUFFEAU, [0, PH + 0.08, PZ + 0.02], Math.PI / 2));
  parts.push(prism(0.04, 0.48, PW * 2 - 0.3, 0xe9dcc2, [0, PH + 0.16, PZ + 0.1], Math.PI / 2));
  parts.push(cyl(0.15, 0.15, 0.03, 18, GOLD, [0, PH + 0.34, PZ + 0.12], [Math.PI / 2, 0, 0]));
  parts.push(cyl(0.1, 0.1, 0.03, 18, 0xf6e5a8, [0, PH + 0.34, PZ + 0.13], [Math.PI / 2, 0, 0]));

  // --------------------------------------------------------------- Beffroi ----
  const tz = -1.75;
  const TS = 1.5; // côté de la tour
  const T0 = 3.5;
  const T1 = 6.28; // haut de l'étage de l'horloge : le cadran passe bien au-dessus du toit
  const half = TS / 2;
  parts.push(box(TS, T1 - T0, TS, CREAM, [0, (T0 + T1) / 2, tz]));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.18, T1 - T0, 0.18, TUFFEAU, [sx * (half - 0.05), (T0 + T1) / 2, tz + sz * (half - 0.05)]));
  parts.push(box(TS + 0.2, 0.08, TS + 0.2, TUFFEAU, [0, T1, tz]));
  parts.push(box(TS + 0.36, 0.06, TS + 0.36, TUFFEAU, [0, T1 + 0.07, tz]));
  // l'horloge, sur les quatre faces : un vrai cadran en relief, dans son encadrement de pierre
  const dialY = 5.5;
  // un cordon de pierre sépare le pied de la tour de l'étage de l'horloge
  parts.push(box(TS + 0.12, 0.09, TS + 0.12, TUFFEAU, [0, 4.78, tz]));
  const R = 0.44;
  const face = half;
  const dialMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const dials: THREE.BufferGeometry[] = [];
  const hands: Array<[THREE.Object3D, THREE.Object3D]> = [];
  /** Une aiguille en fer de lance, de la base à la pointe (axe y). */
  const handShape = (w: number, len: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(-w * 0.32, -len * 0.14);
    sh.lineTo(w * 0.32, -len * 0.14);
    sh.lineTo(w * 0.3, len * 0.66);
    sh.lineTo(w * 0.72, len * 0.76);
    sh.lineTo(0, len);
    sh.lineTo(-w * 0.72, len * 0.76);
    sh.lineTo(-w * 0.3, len * 0.66);
    sh.closePath();
    return finalizeExport(new THREE.ExtrudeGeometry(sh, { depth: 0.01, bevelEnabled: false }), 0x20242c, [0, 0, 0]);
  };
  const clockFace = (ry: number) => {
    const local: Parts = [];
    // la pierre qui s'avance sur le mur, puis la moulure qui l'entoure
    local.push(cyl(R + 0.15, R + 0.17, 0.12, 36, TUFFEAU, [0, 0, 0.06], [Math.PI / 2, 0, 0]));
    local.push(finalizeExport(new THREE.TorusGeometry(R + 0.135, 0.028, 8, 40), ASHLAR, [0, 0, 0.115]));
    // la lunette dorée, bien ronde et bombée
    local.push(finalizeExport(new THREE.TorusGeometry(R + 0.025, 0.036, 10, 44), GOLD, [0, 0, 0.135]));
    // les chiffres : un trait fort aux quarts, un plus fin aux heures
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const big = k % 3 === 0;
      const len = big ? 0.095 : 0.06;
      const r = R - 0.045 - len / 2;
      local.push(box(big ? 0.032 : 0.017, len, 0.008, 0x22262e, [Math.sin(a) * r, Math.cos(a) * r, 0.158], [0, 0, -a]));
    }
    // la minuterie
    local.push(finalizeExport(new THREE.TorusGeometry(R - 0.03, 0.0035, 4, 44), 0x22262e, [0, 0, 0.155]));
    parts.push(merge(local).rotateY(ry).translate(Math.sin(ry) * face, dialY, tz + Math.cos(ry) * face));
    // le cadran, légèrement bombé comme un verre de montre
    const dome = new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, 0.5);
    dome.rotateX(Math.PI / 2);
    dome.translate(0, 0, -Math.cos(0.5));
    dome.scale(R / Math.sin(0.5), R / Math.sin(0.5), 0.26);
    dome.translate(0, 0, 0.135);
    dials.push(finalizeExport(dome, 0xfff9e8, [0, 0, 0]).rotateY(ry).translate(Math.sin(ry) * face, dialY, tz + Math.cos(ry) * face));
    // les aiguilles, au-dessus du verre, et leur axe doré
    const p = new THREE.Group();
    p.position.set(Math.sin(ry) * (face + 0.168), dialY, tz + Math.cos(ry) * (face + 0.168));
    p.rotation.y = ry;
    const hour = new THREE.Mesh(merge([handShape(0.05, 0.25)]), MAT_HANDS);
    const minute = new THREE.Mesh(merge([handShape(0.034, 0.37)]), MAT_HANDS);
    minute.position.z = 0.012;
    const cap = new THREE.Mesh(merge([cyl(0.028, 0.028, 0.03, 12, GOLD, [0, 0, 0.018], [Math.PI / 2, 0, 0])]), MAT_HANDS);
    p.add(hour, minute, cap);
    group.add(p);
    hands.push([hour, minute]);
  };
  for (const ry of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) clockFace(ry);
  group.add(new THREE.Mesh(merge(dials), dialMat));

  // étage de la cloche, ajouré : quatre piliers, une cloche dorée
  const B0 = T1 + 0.1;
  const B1 = B0 + 0.66;
  parts.push(box(1.16, 0.05, 1.16, TUFFEAU, [0, B0 + 0.02, tz]));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.15, B1 - B0, 0.15, TUFFEAU, [sx * 0.46, (B0 + B1) / 2, tz + sz * 0.46]));
  parts.push(box(1.2, 0.07, 1.2, TUFFEAU, [0, B1, tz]));
  parts.push(box(0.05, 0.05, 0.86, TIMBER, [0, B1 - 0.09, tz]));
  parts.push(cone(0.17, 0.26, 10, GOLD, [0, B1 - 0.26, tz]));
  parts.push(ico(0.05, 0, GOLD, [0, B1 - 0.13, tz]));
  parts.push(ico(0.035, 0, 0x8a6a1c, [0, B1 - 0.4, tz]));
  // dôme d'ardoise à côtes de zinc, lanternon, épi doré
  const dome = new THREE.SphereGeometry(0.6, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  parts.push(finalizeExport(dome, SLATE, [0, B1 + 0.03, tz], [0, 0, 0], [1, 1.05, 1]));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    for (let t = 0.12; t < 1.45; t += 0.22) {
      parts.push(box(0.022, 0.13, 0.022, ZINC, [Math.sin(a) * Math.cos(t) * 0.605, B1 + 0.03 + Math.sin(t) * 0.63, tz + Math.cos(a) * Math.cos(t) * 0.605], [Math.cos(a) * -(t - 0.1), 0, Math.sin(a) * (t - 0.1)]));
    }
  }
  const L0 = B1 + 0.62;
  parts.push(cyl(0.12, 0.15, 0.22, 8, TUFFEAU, [0, L0 + 0.11, tz]));
  parts.push(cyl(0.16, 0.16, 0.03, 8, TUFFEAU, [0, L0 + 0.23, tz]));
  parts.push(cone(0.15, 0.2, 8, SLATE, [0, L0 + 0.34, tz]));
  parts.push(ico(0.045, 1, GOLD, [0, L0 + 0.46, tz]));
  // mât et drapeau
  const M1 = L0 + 1.32;
  parts.push(cyl(0.012, 0.02, M1 - L0 - 0.46, 6, IRON, [0, (M1 + L0 + 0.46) / 2, tz]));
  parts.push(ico(0.03, 0, GOLD, [0, M1 + 0.02, tz]));
  const flag = hallFlag(0.92, 0.58);
  flag.mesh.position.set(0, M1 - 0.32, tz);
  group.add(flag.mesh);

  // -------------------------------------------------- Parvis, massifs, lampadaires ----
  // massifs de buis fleuris au pied de la façade
  let seed = 3;
  for (const s of [-1, 1]) {
    const cx = s * (PW + 0.1 + 1.33);
    parts.push(box(2.66, 0.2, 0.42, HEDGE, [cx, 0.14, 0.27]));
    parts.push(box(2.72, 0.1, 0.48, 0xd8ccb4, [cx, 0.09, 0.27]));
    for (let k = 0; k < 16; k++) {
      const fx = cx - 1.24 + (k * 2.48) / 15;
      parts.push(ico(0.05, 0, GERANIUMS[seed++ % GERANIUMS.length], [fx, 0.27, 0.2 + rnd(seed) * 0.15]));
    }
    // buis taillé en boule dans son pot
    const bx = s * 1.55;
    const bz = 0.82;
    parts.push(cyl(0.15, 0.11, 0.22, 10, 0xc99a74, [bx, 0.13, bz]));
    parts.push(cyl(0.025, 0.03, 0.36, 6, TIMBER, [bx, 0.42, bz]));
    parts.push(ico(0.23, 1, HEDGE, [bx, 0.68, bz]));
    // lampadaire de ville
    const lx = s * 1.45;
    const lz = 1.55;
    parts.push(cyl(0.05, 0.08, 0.14, 8, IRON, [lx, 0.11, lz]));
    parts.push(cyl(0.022, 0.03, 1.28, 8, IRON, [lx, 0.8, lz]));
    parts.push(box(0.16, 0.02, 0.16, IRON, [lx, 1.44, lz]));
    parts.push(cone(0.13, 0.11, 4, IRON, [lx, 1.67, lz], [0, Math.PI / 4, 0]));
    parts.push(ico(0.02, 0, GOLD, [lx, 1.74, lz]));
    for (const a of [-1, 1]) for (const b of [-1, 1]) parts.push(box(0.012, 0.17, 0.012, IRON, [lx + a * 0.065, 1.53, lz + b * 0.065]));
    windows.push(glassPane(0.11, 0.16, [lx, 1.53, lz], 0, 0.11));
  }
  // allée de dalles jusqu'au chemin
  for (let z = PZ + 0.74, r = 0; z < 3.1; z += 0.34, r++) {
    for (let k = -1; k <= 1; k++) {
      const off = r % 2 ? 0.16 : 0;
      parts.push(box(0.6, 0.02, 0.3, (k + r) % 2 ? 0xd9ccb2 : 0xcbbda2, [k * 0.64 + off - 0.08, 0.054, z]));
    }
  }

  group.add(mesh(merge(parts)));
  // toutes les vitres en un seul maillage : elles s'allument ensemble le soir
  const glass = windows.map((m) => {
    m.updateMatrix();
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    g.deleteAttribute('uv');
    g.applyMatrix4(m.matrix);
    return g;
  });
  group.add(new THREE.Mesh(merge(glass), GLOW));

  let lastFlag = -1;
  return {
    group,
    tick(hours, time) {
      for (const [hour, minute] of hands) {
        hour.rotation.z = -((hours % 12) / 12) * Math.PI * 2;
        minute.rotation.z = -(hours % 1) * Math.PI * 2;
      }
      if (time - lastFlag > 0.04) {
        lastFlag = time;
        flag.wave(time);
      }
    },
  };
}

const MAT_HANDS = new THREE.MeshLambertMaterial({ vertexColors: true });
