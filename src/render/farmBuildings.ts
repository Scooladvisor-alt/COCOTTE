// Poulaillers et réserves à œufs, un modèle par niveau : cabane sur pilotis au toit de tôle,
// poulailler de planches rouges à volets verts et girouette, chaumière normande à colombages et
// lanternon, bâtiment d'élevage moderne (panneaux solaires, ventilateurs, trappe automatique) ;
// garde-manger en planches, cellier à persiennes et son étagère, chambre froide, entrepôt
// réfrigéré à quai de chargement. Volumes simples fusionnés, détails en légère saillie
// (planches, colombages, tuiles…) visibles sous l'angle de la caméra (façade +z, côté +x).
import * as THREE from 'three';
import { C, GLOW, box, cone, cyl, finalizeExport, ico, merge, prism, sph, type V3 } from './geo';

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
export function coopModern(parts: Parts, windows: THREE.Mesh[]) {
  const x0 = 0.1;
  const x1 = 2.9;
  const zb = 0.15;
  const zf = 1.75;
  const y0 = 0.1;
  const y1 = 1.28;
  const cz = (zb + zf) / 2;
  const PANEL = 0xeef1f4;
  const SEAM = 0xd3d9e0;
  const FRAME = 0x5b6170;
  parts.push(box(x1 - x0 + 0.06, y0, zf - zb + 0.06, 0x8e939b, [1.5, y0 / 2, cz]));
  parts.push(box(x1 - x0, y1 - y0, zf - zb, PANEL, [1.5, (y0 + y1) / 2, cz]));
  for (let x = x0 + 0.35; x < x1 - 0.1; x += 0.35) parts.push(box(0.022, y1 - y0, 0.016, SEAM, [x, (y0 + y1) / 2, zf + 0.008]));
  for (let z = zb + 0.32; z < zf - 0.1; z += 0.32) parts.push(box(0.016, y1 - y0, 0.022, SEAM, [x1 + 0.008, (y0 + y1) / 2, z]));
  parts.push(box(x1 - x0 + 0.02, 0.1, zf - zb + 0.02, 0x3d4a63, [1.5, y1 - 0.05, cz]));
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
  // trappe automatique : moteur, capteur, écran
  henDoor(parts, 1.5, 0.08, 0.46, 0.34, zf + 0.012, FRAME);
  parts.push(box(0.44, 0.13, 0.09, IRON, [1.5, 0.57, zf + 0.045]));
  parts.push(box(0.035, 0.035, 0.02, 0x4ade80, [1.66, 0.57, zf + 0.095]));
  parts.push(box(0.22, 0.17, 0.02, 0x2a2f3a, [1.98, 0.62, zf + 0.012]));
  windows.push(glassPane(0.17, 0.12, [1.98, 0.62, zf + 0.025], 0, 0.012));
  parts.push(box(0.56, 0.05, 0.4, 0xc4c7cb, [1.5, 0.05, 1.93]));
}

/** Fenêtre à petits carreaux et cadre blanc, sur une façade tournée vers +z (ou +x). */
function farmWindow(parts: Parts, windows: THREE.Mesh[], x: number, y: number, z: number, w: number, h: number, onX = false) {
  const ry = onX ? Math.PI / 2 : 0;
  const B = (bw: number, bh: number, bd: number, c: number, p: V3) => parts.push(onX ? box(bd, bh, bw, c, p) : box(bw, bh, bd, c, p));
  windows.push(glassPane(w, h, [x, y, z], ry, 0.02));
  const n = onX ? [z, y] : [x, y];
  const at = (u: number, v: number, o: number): V3 => (onX ? [x + o, v, u] : [u, v, z + o]);
  B(w + 0.08, 0.04, 0.035, TRIM, at(n[0], y + h / 2 + 0.02, 0.012));
  B(w + 0.12, 0.045, 0.06, TRIM, at(n[0], y - h / 2 - 0.02, 0.022));
  for (const s2 of [-1, 1]) B(0.04, h + 0.06, 0.035, TRIM, at(n[0] + s2 * (w / 2 + 0.02), y, 0.012));
  B(0.022, h, 0.03, TRIM, at(n[0], y, 0.016));
  B(w, 0.022, 0.03, TRIM, at(n[0], y + h * 0.1, 0.016));
}

/**
 * Niveau 5 — grand poulailler de ferme (dessiné sur 4 × 2,5) : longue grange sur soubassement de
 * pierre, bardage de planches rouge sombre aux angles blancs, grand toit de tuiles avec lanterneau
 * d'aération et girouette, fenêtres à carreaux, porte coulissante sur le côté, trappe et rampe au
 * centre de la façade, lampe, enseigne et bottes de paille.
 */
export function coopFarm(parts: Parts, windows: THREE.Mesh[]) {
  const x0 = 0.12;
  const x1 = 3.88;
  const zb = 0.18;
  const zf = 2.18;
  const yb = 0.34;
  const y1 = 1.42;
  const cx = 2;
  const cz = (zb + zf) / 2;
  const RED = 0x9c3f2c;
  const RED2 = 0x873524;
  // soubassement de pierre (moellons en relief sur la façade et le côté)
  parts.push(box(x1 - x0 + 0.06, yb, zf - zb + 0.06, STONE, [cx, yb / 2, cz]));
  for (let i = 0; i < 26; i++) {
    const x = x0 + 0.1 + rnd(i) * (x1 - x0 - 0.2);
    parts.push(box(0.14 + rnd(i + 40) * 0.1, 0.07 + rnd(i + 80) * 0.04, 0.02, rnd(i + 9) < 0.5 ? STONE_DARK : 0xcabfad, [x, 0.06 + rnd(i + 3) * (yb - 0.12), zf + 0.035]));
  }
  for (let i = 0; i < 14; i++) {
    const z = zb + 0.1 + rnd(i + 200) * (zf - zb - 0.2);
    parts.push(box(0.02, 0.07 + rnd(i + 230) * 0.04, 0.14 + rnd(i + 260) * 0.1, rnd(i + 290) < 0.5 ? STONE_DARK : 0xcabfad, [x1 + 0.035, 0.06 + rnd(i + 300) * (yb - 0.12), z]));
  }
  // murs de planches
  parts.push(box(x1 - x0, y1 - yb, zf - zb, RED2, [cx, (yb + y1) / 2, cz]));
  boardsZ(parts, x0, x1, yb, y1, zf, RED, RED2, 0.15);
  boardsX(parts, zb, zf, yb, y1, x1, RED, RED2, 0.15);
  for (const [x, z] of [
    [x0, zf],
    [x1, zf],
    [x1, zb],
  ])
    parts.push(box(0.07, y1 - yb + 0.02, 0.07, TRIM, [x, (yb + y1) / 2, z]));
  parts.push(box(x1 - x0 + 0.02, 0.06, 0.05, TRIM, [cx, yb + 0.02, zf + 0.03]));
  // grand toit de tuiles, lanterneau d'aération sur le faîtage, girouette
  const roof = gableRoof(parts, { cx, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.78, over: 0.16, side: 0.14, a: 0xb5573b, b: 0xa24b33, n: 8, ridge: 0x8a3c29, rive: TIMBER, gable: RED });
  const ry = roof.ridgeY;
  parts.push(box(0.62, 0.36, 0.46, RED, [cx, ry + 0.16, cz]));
  for (const s2 of [-1, 1]) for (let k = 0; k < 4; k++) parts.push(box(0.5, 0.025, 0.04, TRIM, [cx, ry + 0.06 + k * 0.08, cz + s2 * 0.235], [s2 * 0.5, 0, 0]));
  parts.push(prism(0.78, 0.26, 0.64, 0xa24b33, [cx, ry + 0.34, cz]));
  weathervane(parts, cx, ry + 0.6, cz, 1.1);
  // fenêtres à carreaux sur la façade et le côté
  for (const x of [0.62, 1.32, 2.68, 3.38]) farmWindow(parts, windows, x, 0.98, zf + 0.012, 0.36, 0.34);
  for (const z of [0.7, 1.66]) farmWindow(parts, windows, x1 + 0.012, 0.98, z, 0.34, 0.32, true);
  // porte coulissante sur le côté (rail, croix de Saint-André)
  const dz = 1.18;
  parts.push(box(0.04, 0.82, 0.72, 0xb04a33, [x1 + 0.03, yb + 0.41, dz]));
  parts.push(box(0.05, 0.05, 0.74, TRIM, [x1 + 0.055, yb + 0.41, dz]));
  for (const a of [0.85, -0.85]) parts.push(box(0.05, 0.05, 1.0, TRIM, [x1 + 0.055, yb + 0.41, dz], [a, 0, 0]));
  for (const y of [yb + 0.02, yb + 0.8]) parts.push(box(0.05, 0.05, 0.76, TRIM, [x1 + 0.055, y, dz]));
  parts.push(box(0.04, 0.04, 1.2, IRON, [x1 + 0.065, yb + 0.86, dz - 0.18]));
  // trappe et rampe au centre, lampe, enseigne
  henDoor(parts, cx, 0.12, 0.62, 0.44, zf + 0.012, TRIM);
  ramp(parts, cx, 0.12, zf + 0.02, 2.62, 0.4, C.wood, C.woodDark);
  parts.push(box(0.09, 0.14, 0.09, IRON, [cx + 0.42, 0.86, zf + 0.06]));
  windows.push(glassPane(0.06, 0.08, [cx + 0.42, 0.85, zf + 0.11], 0, 0.06));
  eggSign(parts, cx, 1.3, zf + 0.04, 0xe7d5b0);
  // gouttière, descente, bottes de paille contre le pignon
  const [ey, ez] = roof.at(1, roof.len, 0);
  parts.push(box(x1 - x0 + 0.3, 0.06, 0.08, 0x9aa0a6, [cx, ey - 0.045, ez - 0.02]));
  parts.push(cyl(0.025, 0.025, ey - 0.05, 8, 0x9aa0a6, [x1 + 0.08, ey / 2, zf + 0.08]));
  for (const [x, y] of [
    [0.42, 0.13],
    [0.82, 0.13],
    [0.62, 0.38],
  ]) {
    parts.push(box(0.36, 0.24, 0.24, C.straw, [x, y, zf + 0.2]));
    for (const dx of [-0.08, 0.08]) parts.push(box(0.012, 0.25, 0.25, 0xc9a640, [x + dx, y, zf + 0.2]));
  }
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
  const PANEL = 0xdfe6df;
  const SEAM = 0xc6cfc7;
  const FRAME = 0x55606b;
  parts.push(box(x1 - x0 + 0.08, y0, zf - zb + 0.08, 0x9aa0a6, [cx, y0 / 2, cz]));
  parts.push(box(x1 - x0, y1 - y0, zf - zb, PANEL, [cx, (y0 + y1) / 2, cz]));
  for (let x = x0 + 0.3; x < x1 - 0.1; x += 0.3) parts.push(box(0.02, y1 - y0, 0.014, SEAM, [x, (y0 + y1) / 2, zf + 0.007]));
  for (let z = zb + 0.3; z < zf - 0.1; z += 0.3) parts.push(box(0.014, y1 - y0, 0.02, SEAM, [x1 + 0.007, (y0 + y1) / 2, z]));
  parts.push(box(x1 - x0 + 0.02, 0.08, zf - zb + 0.02, 0x3f6b4f, [cx, y1 - 0.04, cz]));
  parts.push(box(x1 - x0 + 0.02, 0.06, 0.04, 0x3f6b4f, [cx, y0 + 0.06, zf + 0.02]));
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
    henDoor(parts, x, 0.1, 0.5, 0.38, zf + 0.012, FRAME);
    parts.push(box(0.42, 0.03, 0.1, 0x8e939b, [x, 0.55, zf + 0.06], [0.6, 0, 0]));
  }
  ramp(parts, 2.5, 0.1, zf + 0.02, 3.1, 0.42, 0xb7c0c7, 0x8e939b);
  for (const x of [1.0, 3.6]) parts.push(box(0.5, 0.04, 0.32, 0xc4c7cb, [x, 0.02, zf + 0.2]));
  // toit en bac acier : cheminées d'extraction, panneaux solaires, faîtière
  const roof = gableRoof(parts, { cx, cz, y: y1, w: x1 - x0, d: zf - zb, h: 0.5, over: 0.12, side: 0.1, a: 0x8c979f, b: 0x7c868e, style: 'ribs', ridge: 0x5f6870, rive: 0x5f6870, gable: PANEL });
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
  for (let i = 0; i < 6; i++) parts.push(cyl(0.313, 0.313, 0.02, 20, i === 3 ? 0x3f6b4f : 0xc9ced3, [sx, 0.92 + i * 0.25, sz]));
  parts.push(cone(0.34, 0.32, 20, 0xc9ced3, [sx, 2.43, sz]));
  for (const dx of [-0.07, 0.07]) parts.push(box(0.015, 1.9, 0.015, 0x8e939b, [sx + dx, 1.45, sz + 0.33]));
  for (let i = 0; i < 11; i++) parts.push(box(0.15, 0.012, 0.012, 0x8e939b, [sx, 0.6 + i * 0.17, sz + 0.33]));
  parts.push(cyl(0.04, 0.04, 0.8, 8, 0x8e939b, [sx - 0.42, 1.3, sz], [0, 0, 1.0]));
  // trappe du centre : moteur et capteur de la porte automatique
  parts.push(box(0.4, 0.11, 0.08, IRON, [2.5, 0.6, zf + 0.045]));
  parts.push(box(0.03, 0.03, 0.02, 0x4ade80, [2.66, 0.6, zf + 0.09]));
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
