// Le village, de l'autre côté de la route : un vrai bourg de campagne. Grand-rue goudronnée
// bordée de trottoirs, maisons en enduit coloré, en pierre ou à colombages (toits débordants à
// tuiles ou ardoises, lucarnes, cheminées, gouttières, fenêtres à carreaux et volets, jardinières),
// jardins vivants derrière (potagers, linge qui sèche, abris, balançoires, voitures dans l'allée),
// place pavée avec fontaine, platanes, monument et terrasse de café, mairie pavoisée, commerces
// à enseigne, église et son petit cimetière. Les fenêtres s'allument le soir, les cheminées fument.
import * as THREE from 'three';
import { WORLD } from '../config/balance';
import { C, box, cone, cyl, finalizeExport, ico, merge, mesh, sph, type V3 } from './geo';
import { strip } from './people';
import { LANTERN_GLOW } from './models';

/**
 * Le village est dessiné pour une route en z = 33,4 ; on le décale avec elle (elle s'est éloignée
 * de la ferme pour laisser place à la place de l'étal et aux trottoirs).
 */
const DZ = WORLD.ROAD_Z - 33.4;

function hash(i: number) {
  const x = Math.sin(i * 91.3 + 17.7) * 43758.5453;
  return x - Math.floor(x);
}
const pick = <T,>(a: T[], r: number) => a[Math.floor(r * a.length) % a.length];
const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

const RENDERS = [0xf6ead6, 0xf3dcc2, 0xece6da, 0xf6e3b8, 0xdfe9e3, 0xf2d7d0, 0xe8e0f0, 0xf7efe0, 0xefd9b5];
const STONES = [0xd9ccb2, 0xcfc0a1, 0xe0d5bf];
const STONE_BITS = [0xc2b394, 0xb8a888, 0xd6c9ad, 0xa99a7c, 0xcbbf9f];
const TILES = [0xc96a4a, 0xb85a3e, 0xa9563f, 0xd08a55, 0xb4664a];
const SLATE = [0x5f6b78, 0x6f7f8f, 0x55606b];
const DOORS = [0x2f5d8c, 0x3f7d4f, 0x8a5a30, 0xb5452f, 0x5b6e8f, 0x6b4a6f, 0x2b2b31];
const SHUTTERS = [0x3f7d4f, 0x5b8fc9, 0xb5452f, 0x8a6fb0, 0x6b9b8a, 0xd8cfa8, 0x7a8f9e];
const FLOWERS = [0xe85d75, 0xf5c542, 0xffffff, 0x9a7ad6, 0xf08a3a, 0xd9534f];
const CARS = [0xd9534f, 0x2f6bff, 0xf3efe6, 0x5aa36b, 0x3a3f4a, 0x9fb4c8, 0xe58b3a, 0x8a6fd1, 0xc9ccd1];
const FRAME = 0xf7f4ee;
const TRIM = 0xe2d8c4;
const TIMBER = 0x6b4a32;
const BRICK = 0xb8644a;
const IRON = 0x34383f;

export interface Village {
  update(time: number, dt: number, day: number): void;
}

/** 0 : façade vers +z, 1 : vers -z, 2 : vers +x, 3 : vers -x. */
type Face = 0 | 1 | 2 | 3;

export function buildVillage(scene: THREE.Scene): Village {
  const solid: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const warm: THREE.BufferGeometry[] = [];
  const chimneys: Array<[number, number, number]> = [];
  const lamps: Array<[number, number, number]> = [];
  const signs: Array<{ text: string; bg: string; fg: string; w: number; h: number; p: V3; ry: number }> = [];

  /**
   * Repère d'un mur : u le long du mur (vers la droite quand on le regarde), y en hauteur, n vers
   * l'extérieur. `bx` pose une boîte plaquée sur ce mur (largeur le long du mur, épaisseur selon n).
   */
  const wallOf = (f: Face, cx: number, cz: number, w: number, d: number) => {
    const at = (u: number, y: number, n: number): V3 =>
      f === 0 ? [cx + u, y, cz + d / 2 + n] : f === 1 ? [cx - u, y, cz - d / 2 - n] : f === 2 ? [cx + w / 2 + n, y, cz - u] : [cx - w / 2 - n, y, cz + u];
    const bx = (wu: number, h: number, t: number, color: number, u: number, y: number, n: number, to: THREE.BufferGeometry[] = solid, tilt = 0) => {
      const r: V3 = f === 0 ? [tilt, 0, 0] : f === 1 ? [-tilt, 0, 0] : f === 2 ? [0, 0, -tilt] : [0, 0, tilt];
      to.push(f < 2 ? box(wu, h, t, color, at(u, y, n), r) : box(t, h, wu, color, at(u, y, n), r));
    };
    return { at, bx, f, len: f < 2 ? w : d };
  };
  type Wall = ReturnType<typeof wallOf>;

  /** Fenêtre à carreaux : vitre, cadre, croisillons, appui, linteau, volets et jardinière en option. */
  const win = (W: Wall, u: number, y: number, ww: number, wh: number, o: { shut?: number; flowers?: number; lintel?: boolean; frame?: number } = {}) => {
    const fr = o.frame ?? FRAME;
    W.bx(ww, wh, 0.04, 0xffffff, u, y, 0.01, glass);
    W.bx(ww + 0.07, 0.045, 0.05, fr, u, y + wh / 2, 0.02);
    W.bx(ww + 0.07, 0.045, 0.05, fr, u, y - wh / 2, 0.02);
    W.bx(0.045, wh, 0.05, fr, u - ww / 2, y, 0.02);
    W.bx(0.045, wh, 0.05, fr, u + ww / 2, y, 0.02);
    W.bx(0.028, wh, 0.045, fr, u, y, 0.03);
    W.bx(ww, 0.028, 0.045, fr, u, y + wh * 0.12, 0.03);
    W.bx(ww + 0.16, 0.05, 0.12, TRIM, u, y - wh / 2 - 0.045, 0.05);
    if (o.lintel) W.bx(ww + 0.14, 0.07, 0.035, TRIM, u, y + wh / 2 + 0.065, 0.01);
    if (o.shut !== undefined) {
      const sw = ww * 0.52;
      for (const s of [-1, 1]) {
        const su = u + s * (ww / 2 + sw / 2 + 0.05);
        W.bx(sw, wh + 0.05, 0.035, o.shut, su, y, 0.025);
        for (let k = -1; k <= 1; k++) W.bx(sw - 0.04, 0.02, 0.012, shade(o.shut, 0.78), su, y + k * wh * 0.28, 0.045);
      }
    }
    if (o.flowers !== undefined) {
      W.bx(ww + 0.04, 0.09, 0.12, 0x8a5a30, u, y - wh / 2 - 0.11, 0.08);
      for (let k = 0; k < 4; k++) {
        const p = W.at(u - ww / 2 + 0.07 + (k * (ww - 0.14)) / 3, y - wh / 2 - 0.04, 0.09);
        solid.push(ico(0.055, 0, k % 2 ? 0x6faa52 : pick(FLOWERS, hash(o.flowers + k)), p));
      }
    }
  };

  /** Porte d'entrée : vantail, imposte vitrée, encadrement, poignée, marche ; auvent et applique en option. */
  const door = (W: Wall, u: number, color: number, o: { canopy?: number; lamp?: boolean; dh?: number; dw?: number } = {}) => {
    const dw = o.dw ?? 0.52;
    const dh = o.dh ?? 0.92;
    W.bx(dw, dh, 0.05, color, u, 0.12 + dh / 2, 0.015);
    W.bx(dw * 0.7, 0.16, 0.05, 0xffffff, u, 0.12 + dh - 0.13, 0.03, glass);
    for (let k = 0; k < 2; k++) W.bx(dw * 0.62, 0.22, 0.012, shade(color, 0.82), u, 0.32 + k * 0.3, 0.045);
    W.bx(dw + 0.1, 0.06, 0.06, TRIM, u, 0.12 + dh + 0.03, 0.02);
    W.bx(0.05, dh, 0.06, TRIM, u - dw / 2 - 0.025, 0.12 + dh / 2, 0.02);
    W.bx(0.05, dh, 0.06, TRIM, u + dw / 2 + 0.025, 0.12 + dh / 2, 0.02);
    W.bx(0.04, 0.04, 0.05, 0xd9b35a, u + dw * 0.32, 0.12 + dh * 0.48, 0.06);
    W.bx(dw + 0.36, 0.1, 0.32, 0xcfc6b3, u, 0.05, 0.16);
    if (o.canopy !== undefined) {
      W.bx(dw + 0.5, 0.05, 0.42, o.canopy, u, 0.12 + dh + 0.24, 0.2, solid, 0.32);
      for (const s of [-1, 1]) solid.push(strip(W.at(u + s * (dw / 2 + 0.18), 0.12 + dh + 0.05, 0), W.at(u + s * (dw / 2 + 0.18), 0.12 + dh + 0.2, 0.36), 0.025, 0.025, IRON));
    }
    if (o.lamp) {
      W.bx(0.08, 0.13, 0.08, IRON, u + dw / 2 + 0.2, 0.12 + dh + 0.05, 0.06);
      W.bx(0.06, 0.08, 0.06, 0xffffff, u + dw / 2 + 0.2, 0.12 + dh + 0.04, 0.07, warm);
    }
  };

  /**
   * Toit à deux pans (faîtage selon x) : vrais pans débordants, rangs de tuiles, faîtière, pignons
   * maçonnés ; ou toit à quatre pans pour les maisons presque carrées.
   */
  const roof = (x: number, z: number, w: number, d: number, base: number, rh: number, color: number, wall: number, hip: boolean) => {
    if (hip) {
      const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
      solid.push(finalizeExport(g, color, [x, base + rh / 2, z], undefined, [w + 0.45, rh, d + 0.45]));
      solid.push(box(w + 0.42, 0.06, d + 0.42, shade(color, 0.8), [x, base + 0.02, z]));
      return;
    }
    const half = (d + 0.5) / 2;
    const a = Math.atan2(rh, half);
    const len = Math.hypot(half, rh);
    const dark = shade(color, 0.82);
    // pignons (triangles de maçonnerie sous les pans)
    const tri = new THREE.Shape();
    tri.moveTo(-d / 2, 0);
    tri.lineTo(d / 2, 0);
    tri.lineTo(0, rh * (d / 2 / half));
    const gab = new THREE.ExtrudeGeometry(tri, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2).rotateY(Math.PI / 2);
    solid.push(finalizeExport(gab, wall, [x, base, z]));
    for (const s of [1, -1]) {
      const cz = z + s * half / 2;
      const cy = base + rh / 2 + 0.03;
      solid.push(box(w + 0.38, 0.07, len + 0.02, color, [x, cy, cz], [s * a, 0, 0]));
      for (let k = 1; k <= 4; k++) {
        const t = k / 5;
        solid.push(box(w + 0.4, 0.022, 0.05, dark, [x, base + t * rh + 0.07, z + s * (1 - t) * half], [s * a, 0, 0]));
      }
      // gouttière
      solid.push(cyl(0.035, 0.035, w + 0.36, 6, 0x9aa0a6, [x, base - 0.02, z + s * (half + 0.02)], [0, 0, Math.PI / 2]));
    }
    solid.push(box(w + 0.42, 0.08, 0.16, dark, [x, base + rh + 0.04, z]));
    // planches de rive sur les pignons
    for (const sx of [1, -1])
      for (const s of [1, -1]) solid.push(box(0.05, 0.09, len, shade(color, 0.7), [x + sx * (w / 2 + 0.19), base + rh / 2 + 0.01, z + (s * half) / 2], [s * a, 0, 0]));
  };

  /** Petite voiture garée. */
  const car = (x: number, z: number, ry: number, color: number) => {
    const c = Math.cos(ry);
    const sn = Math.sin(ry);
    const P = (lx: number, y: number, lz: number): V3 => [x + lx * c + lz * sn, y, z - lx * sn + lz * c];
    solid.push(box(1.5, 0.32, 0.72, color, P(0, 0.3, 0), [0, ry, 0]));
    solid.push(box(0.8, 0.26, 0.66, color, P(-0.1, 0.58, 0), [0, ry, 0]));
    glass.push(box(0.82, 0.18, 0.68, 0xffffff, P(-0.1, 0.6, 0), [0, ry, 0]));
    for (const [wx, wz] of [
      [0.48, 0.34],
      [0.48, -0.34],
      [-0.48, 0.34],
      [-0.48, -0.34],
    ])
      solid.push(cyl(0.15, 0.15, 0.1, 10, 0x2b2b31, P(wx, 0.15, wz), Math.abs(Math.sin(ry)) > 0.5 ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]));
    solid.push(box(0.04, 0.08, 0.6, 0xf3efe6, P(0.76, 0.34, 0), [0, ry, 0]));
  };

  /** Arbre feuillu (fruitier : quelques fruits colorés). */
  const tree = (x: number, z: number, r: number, i: number, fruit?: number) => {
    solid.push(cyl(0.06 * r + 0.03, 0.09 * r + 0.03, 0.9 * r, 6, C.trunk, [x, 0.45 * r, z]));
    const leaf = pick([C.leaf, 0xa8d68a, 0x8cc46f, 0x7fb35a], hash(i));
    solid.push(ico(0.62 * r, 1, leaf, [x, 1.15 * r, z]));
    solid.push(ico(0.42 * r, 1, shade(leaf, 0.92), [x + 0.3 * r, 1.45 * r, z - 0.15 * r]));
    if (fruit !== undefined) for (let k = 0; k < 7; k++) {
      const a = k * 2.4 + i;
      solid.push(sph(0.06, 5, 4, fruit, [x + Math.cos(a) * 0.5 * r, 1.0 * r + (k % 3) * 0.15, z + Math.sin(a) * 0.5 * r]));
    }
  };

  /** Jardin derrière la maison (côté +n du mur f) : pelouse et deux ou trois choses de la vie de tous les jours. */
  const garden = (W: Wall, wlen: number, depth: number, i: number) => {
    const lawn = pick([0xcfe0a2, 0xc6dc96, 0xd6e4ad, 0xbfd78e], hash(i));
    W.bx(wlen + 0.9, 0.025, depth, lawn, 0, 0.02, depth / 2);
    // clôture du fond (planches, grillage ou haie)
    const kind = Math.floor(hash(i + 1) * 3);
    if (kind === 0) for (let k = 0; k <= 10; k++) W.bx(0.06, 0.42, 0.05, 0xc8a46f, -wlen / 2 - 0.4 + (k * (wlen + 0.8)) / 10, 0.21, depth);
    if (kind === 0) for (const y of [0.14, 0.32]) W.bx(wlen + 0.85, 0.04, 0.04, 0xb08a58, 0, y, depth - 0.03);
    if (kind === 1) {
      W.bx(wlen + 0.85, 0.42, 0.02, 0x9db08a, 0, 0.23, depth);
      for (let k = 0; k <= 4; k++) W.bx(0.04, 0.48, 0.04, 0x6b6f63, -wlen / 2 - 0.4 + (k * (wlen + 0.8)) / 4, 0.24, depth);
    }
    if (kind === 2) for (let k = 0; k < 7; k++) solid.push(ico(0.32, 1, 0x7fb35a, W.at(-wlen / 2 - 0.2 + (k * (wlen + 0.4)) / 6, 0.3, depth)));
    const feats = [0, 1, 2, 3, 4, 5, 6].sort((a, b) => hash(i * 3 + a) - hash(i * 3 + b)).slice(0, 2 + (hash(i + 2) < 0.4 ? 1 : 0));
    const slot = [-wlen * 0.28, wlen * 0.3, 0];
    feats.forEach((fk, j) => {
      const u = slot[j];
      const n = depth * (j === 2 ? 0.75 : 0.5);
      if (fk === 0) {
        // potager : terre, rangs de légumes, tuteurs
        W.bx(1.1, 0.05, 0.8, 0x7a5a3a, u, 0.04, n);
        for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) solid.push(ico(0.075, 0, q % 2 ? 0x5f9e45 : 0x7cbf5a, W.at(u - 0.4 + q * 0.27, 0.1, n - 0.26 + r * 0.26)));
        for (let q = 0; q < 3; q++) W.bx(0.02, 0.35, 0.02, 0xb08a58, u + 0.45, 0.18, n - 0.25 + q * 0.25);
      } else if (fk === 1) {
        // fil à linge et linge qui sèche
        for (const s of [-1, 1]) W.bx(0.05, 0.8, 0.05, 0xa9a9a9, u + s * 0.6, 0.4, n);
        W.bx(1.2, 0.012, 0.012, 0xdddddd, u, 0.76, n);
        for (let q = 0; q < 4; q++) W.bx(0.2, 0.26 - (q % 2) * 0.08, 0.02, pick([0xffffff, 0x7fa6ff, 0xe85d75, 0xf5c542, 0x9fd3c7], hash(i + q * 5)), u - 0.42 + q * 0.28, 0.62 - (q % 2) * 0.04, n);
      } else if (fk === 2) {
        // abri de jardin
        const sc = pick([0x8a6a4a, 0x7d9b8a, 0xa9784e], hash(i + 7));
        W.bx(0.8, 0.7, 0.6, sc, u, 0.38, n);
        for (let q = 0; q < 4; q++) W.bx(0.012, 0.66, 0.01, shade(sc, 0.8), u - 0.3 + q * 0.2, 0.38, n + 0.305);
        W.bx(0.95, 0.06, 0.78, 0x4e5560, u, 0.76, n, solid, 0.12);
        W.bx(0.26, 0.5, 0.02, shade(sc, 0.72), u + 0.15, 0.3, n + 0.31);
      } else if (fk === 3) {
        // table de jardin, parasol et chaises
        const p = W.at(u, 0, n);
        solid.push(cyl(0.3, 0.3, 0.04, 12, 0xf3efe6, [p[0], 0.4, p[2]]), cyl(0.03, 0.03, 0.4, 6, 0xf3efe6, [p[0], 0.2, p[2]]));
        solid.push(cyl(0.02, 0.02, 1.0, 5, 0xdddddd, [p[0], 0.75, p[2]]), cone(0.62, 0.26, 8, pick([0xd9534f, 0x2f6bff, 0xf0c94a, 0x5aa36b], hash(i + 9)), [p[0], 1.28, p[2]]));
        for (let q = 0; q < 3; q++) {
          const a = q * 2.1 + i;
          solid.push(box(0.2, 0.05, 0.2, 0xf3efe6, [p[0] + Math.cos(a) * 0.45, 0.25, p[2] + Math.sin(a) * 0.45]));
          solid.push(box(0.2, 0.25, 0.03, 0xf3efe6, [p[0] + Math.cos(a) * 0.55, 0.38, p[2] + Math.sin(a) * 0.55], [0, -a + Math.PI / 2, 0]));
        }
      } else if (fk === 4) {
        // tas de bûches contre la clôture, sous un petit toit
        for (let r = 0; r < 3; r++) for (let q = 0; q < 5 - r; q++) solid.push(cyl(0.07, 0.07, 0.5, 7, q % 2 ? 0xb07a45 : 0x9b6b3d, W.at(u - 0.3 + q * 0.15 + r * 0.075, 0.08 + r * 0.13, depth - 0.3), f2rot(W)));
        W.bx(0.9, 0.04, 0.6, 0x6b5a48, u, 0.55, depth - 0.3, solid, 0.15);
      } else if (fk === 5) tree(W.at(u, 0, n)[0], W.at(u, 0, n)[2], 0.9, i, pick([0xd9534f, 0xf0a33a, 0xc7d64a], hash(i + 11)));
      else {
        // balançoire
        for (const s of [-1, 1]) {
          solid.push(strip(W.at(u + s * 0.45, 0, n - 0.3), W.at(u + s * 0.45, 0.95, n), 0.05, 0.05, 0x5b8fc9));
          solid.push(strip(W.at(u + s * 0.45, 0, n + 0.3), W.at(u + s * 0.45, 0.95, n), 0.05, 0.05, 0x5b8fc9));
        }
        W.bx(1.0, 0.05, 0.05, 0x5b8fc9, u, 0.96, n);
        for (const s of [-1, 1]) W.bx(0.012, 0.6, 0.012, 0xcccccc, u + s * 0.13, 0.64, n);
        W.bx(0.32, 0.04, 0.14, 0xd9534f, u, 0.34, n);
      }
    });
  };
  /** Rotation qui couche une bûche le long d'un mur. */
  const f2rot = (W: Wall): V3 => (W.f < 2 ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]);

  /** Une maison. `facing` : côté de la rue (façade et entrée) ; le jardin est de l'autre côté. */
  const house = (x: number, z: number, i: number, facing: 1 | -1, scale = 1, o: { shop?: { name: string; color: number; bg: string; fg: string }; noGarden?: boolean } = {}) => {
    const w = (2.3 + hash(i) * 1.2) * scale;
    const d = (2.1 + hash(i + 1) * 0.7) * scale;
    const floors = o.shop || hash(i + 2) < 0.5 ? 2 : 1;
    const fh = (o.shop ? 1.15 : 1.0) * scale;
    const h = floors * fh + 0.15;
    const kindR = hash(i + 3);
    const kind = o.shop ? 'render' : kindR < 0.58 ? 'render' : kindR < 0.84 ? 'stone' : 'timber';
    const wall = kind === 'stone' ? pick(STONES, hash(i + 13)) : kind === 'timber' ? 0xf3ead8 : pick(RENDERS, hash(i + 13));
    const slate = hash(i + 4) < 0.25;
    const roofC = slate ? pick(SLATE, hash(i + 5)) : pick(TILES, hash(i + 5));
    const shut = pick(SHUTTERS, hash(i + 6));
    const hip = !o.shop && Math.abs(w - d) < 0.45 && hash(i + 14) < 0.6;
    const rh = (hip ? 1.0 : 0.85 + hash(i + 15) * 0.35) * scale;
    // soubassement et murs
    solid.push(box(w + 0.08, 0.16, d + 0.08, kind === 'stone' ? 0xa99a7c : 0xb9ab93, [x, 0.08, z]));
    solid.push(box(w, h - 0.06, d, wall, [x, (h - 0.06) / 2 + 0.06, z]));
    const faces: Face[] = [0, 1, 2, 3];
    const walls = faces.map((f) => wallOf(f, x, z, w, d));
    // chaînes d'angle en pierre (enduit) ou pierres apparentes
    if (kind !== 'timber')
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          for (let y = 0.26, q = 0; y < h - 0.12; y += 0.22, q++) {
            const la = q % 2 ? 0.16 : 0.28;
            const lb = q % 2 ? 0.28 : 0.16;
            solid.push(box(la, 0.19, 0.03, TRIM, [x + sx * (w / 2 - la / 2), y, z + sz * (d / 2 + 0.01)]));
            solid.push(box(0.03, 0.19, lb, TRIM, [x + sx * (w / 2 + 0.01), y, z + sz * (d / 2 - lb / 2)]));
          }
    if (kind === 'stone')
      for (const W of walls) for (let k = 0; k < Math.round(W.len * 4); k++) W.bx(0.12 + hash(i * 7 + k) * 0.16, 0.07 + hash(i * 5 + k) * 0.05, 0.02, pick(STONE_BITS, hash(i * 3 + k)), (hash(i * 11 + k) - 0.5) * (W.len - 0.4), 0.25 + hash(i * 13 + k) * (h - 0.4), 0.005);
    if (kind === 'timber')
      for (const W of walls) {
        for (let fl = 0; fl <= floors; fl++) W.bx(W.len, 0.07, 0.03, TIMBER, 0, 0.15 + fl * fh - (fl === floors ? 0.04 : 0), 0.01);
        const n = Math.max(2, Math.round(W.len / 0.55));
        for (let k = 0; k <= n; k++) W.bx(0.07, h - 0.15, 0.03, TIMBER, -W.len / 2 + 0.035 + (k * (W.len - 0.07)) / n, h / 2 + 0.07, 0.012);
        for (let fl = 0; fl < floors; fl++)
          for (const s of [-1, 1]) solid.push(strip(W.at(s * (W.len / 2 - 0.05), 0.2 + fl * fh, 0.012), W.at(s * (W.len / 2 - 0.55), 0.1 + (fl + 1) * fh, 0.012), 0.06, 0.03, TIMBER));
      }
    const front = walls[facing > 0 ? 0 : 1];
    const back = walls[facing > 0 ? 1 : 0];
    const lintel = kind !== 'timber';
    const flowers = hash(i + 16) < 0.45 ? i : undefined;
    // façade sur rue : porte et fenêtres (vitrine pour les commerces)
    const du = -w * 0.22;
    if (o.shop) {
      // vitrine, son cadre peint, l'étal devant
      front.bx(w * 0.62, 0.62, 0.04, 0xffffff, w * 0.12, 0.54, 0.01, glass);
      front.bx(w * 0.66, 0.06, 0.06, o.shop.color, w * 0.12, 0.87, 0.02);
      front.bx(w * 0.66, 0.1, 0.07, o.shop.color, w * 0.12, 0.2, 0.02);
      front.bx(0.04, 0.62, 0.05, o.shop.color, w * 0.12, 0.54, 0.03);
      // store banne rayé
      for (let k = 0; k < 8; k++) front.bx((w * 0.7) / 8, 0.035, 0.6, k % 2 ? 0xffffff : o.shop.color, w * 0.12 - w * 0.35 + (k + 0.5) * ((w * 0.7) / 8), 0.98, 0.28, solid, 0.36);
      front.bx(w * 0.7, 0.08, 0.02, o.shop.color, w * 0.12, 0.85, 0.58);
      signs.push({ text: o.shop.name, bg: o.shop.bg, fg: o.shop.fg, w: w * 0.8, h: 0.3, p: front.at(0, 1.26 * scale, 0.04), ry: facing > 0 ? 0 : Math.PI });
      door(front, -w * 0.36, shade(o.shop.color, 0.8), { dw: 0.46 });
    } else {
      door(front, du, pick(DOORS, hash(i + 7)), { canopy: hash(i + 17) < 0.5 ? roofC : undefined, lamp: hash(i + 18) < 0.7 });
      win(front, w * 0.2, 0.62 * scale, 0.42 * scale, 0.5 * scale, { shut, lintel });
      if (w > 3) win(front, -w * 0.42 + 0.05, 0.62 * scale, 0.36 * scale, 0.5 * scale, { shut, lintel });
    }
    if (floors === 2) {
      const ups = w > 3 ? [-w * 0.28, w * 0.04, w * 0.32] : [-w * 0.22, w * 0.2];
      for (const u of ups) win(front, u, fh + 0.62 * scale, 0.4 * scale, 0.5 * scale, { shut, lintel, flowers });
    }
    // côté jardin : porte-fenêtre, fenêtres à chaque étage
    back.bx(0.55, 0.85, 0.04, 0xffffff, w * 0.24, 0.55, 0.01, glass);
    back.bx(0.03, 0.85, 0.05, FRAME, w * 0.24, 0.55, 0.03);
    back.bx(0.62, 0.05, 0.05, FRAME, w * 0.24, 0.99, 0.02);
    back.bx(0.9, 0.06, 0.6, 0xcfc6b3, w * 0.24, 0.03, 0.3);
    win(back, -w * 0.22, 0.62 * scale, 0.4 * scale, 0.48 * scale, { shut, lintel });
    if (floors === 2) for (const u of [-w * 0.22, w * 0.22]) win(back, u, fh + 0.62 * scale, 0.4 * scale, 0.48 * scale, { shut, lintel, flowers });
    // pignons : une fenêtre par étage, un œil-de-bœuf sous le toit
    for (const W of [walls[2], walls[3]]) {
      win(W, 0, 0.62 * scale, 0.36 * scale, 0.44 * scale, { shut, lintel });
      if (floors === 2) win(W, 0, fh + 0.62 * scale, 0.36 * scale, 0.44 * scale, { shut, lintel });
      if (!hip) W.bx(0.22, 0.22, 0.04, 0xffffff, 0, h + rh * 0.4, 0.01, glass);
    }
    // descente de gouttière
    solid.push(cyl(0.025, 0.025, h, 6, 0x9aa0a6, [x + w / 2 - 0.05, h / 2, z + facing * (d / 2 + 0.06)]));
    roof(x, z, w, d, h, rh, roofC, wall, hip);
    // lucarne sur rue (maisons à étage, toit à deux pans)
    if (floors === 2 && !hip && hash(i + 19) < 0.6) {
      const half = (d + 0.5) / 2;
      const lz = z + facing * half * 0.45;
      const ly = h + rh * 0.55 * (1 - 0.45) + 0.12;
      solid.push(box(0.55, 0.5, 0.55, wall, [x - w * 0.1, ly, lz]));
      solid.push(box(0.68, 0.06, 0.66, roofC, [x - w * 0.1 - 0.17, ly + 0.36, lz], [0, 0, 0.6]));
      solid.push(box(0.68, 0.06, 0.66, roofC, [x - w * 0.1 + 0.17, ly + 0.36, lz], [0, 0, -0.6]));
      glass.push(box(0.3, 0.3, 0.04, 0xffffff, [x - w * 0.1, ly, lz + facing * 0.28]));
      solid.push(box(0.36, 0.04, 0.05, FRAME, [x - w * 0.1, ly - 0.16, lz + facing * 0.29]));
    }
    // cheminée en briques, chapeau et pots
    const cx = x + w * (hash(i + 8) < 0.5 ? -0.3 : 0.3);
    const cz = z - facing * d * 0.12;
    const top = h + rh * 0.85 + 0.25;
    solid.push(box(0.3, top - h + 0.1, 0.3, kind === 'stone' ? 0xc2b394 : BRICK, [cx, (top + h) / 2, cz]));
    solid.push(box(0.38, 0.06, 0.38, TRIM, [cx, top + 0.03, cz]));
    for (const s of [-1, 1]) solid.push(cyl(0.045, 0.05, 0.14, 6, 0xb5652e, [cx + s * 0.07, top + 0.13, cz]));
    chimneys.push([cx, top + 0.25, cz]);
    // devant : muret de pierre, palissade blanche ou haie, avec un portillon face à la porte
    const fd = 1.05;
    const fk = o.shop ? -1 : Math.floor(hash(i + 9) * 3);
    const segs: Array<[number, number]> = [
      [-w / 2 - 0.3, du - 0.35],
      [du + 0.35, w / 2 + 0.3],
    ];
    for (const [u0, u1] of segs) {
      const L = u1 - u0;
      const mu = (u0 + u1) / 2;
      if (L <= 0.05) continue;
      if (fk === 0) {
        front.bx(L, 0.32, 0.2, pick(STONE_BITS, hash(i + 20)), mu, 0.16, fd);
        front.bx(L, 0.05, 0.24, TRIM, mu, 0.34, fd);
      } else if (fk === 1) {
        for (let k = 0; k <= Math.round(L / 0.16); k++) front.bx(0.05, 0.4, 0.03, 0xf6f2ea, u0 + k * 0.16, 0.2, fd);
        front.bx(L, 0.04, 0.03, 0xf6f2ea, mu, 0.3, fd - 0.03);
      } else if (fk === 2) for (let k = 0; k <= Math.round(L / 0.42); k++) solid.push(ico(0.24, 1, 0x7fb35a, front.at(u0 + k * 0.42, 0.24, fd)));
    }
    if (fk === 0 || fk === 1) for (const s of [-1, 1]) front.bx(0.14, 0.5, 0.14, TRIM, du + s * 0.38, 0.25, fd);
    if (fk >= 0) front.bx(0.5, 0.025, fd, 0xd9cdb5, du, 0.025, fd / 2); // allée
    // massif de fleurs le long de la façade
    if (fk >= 0 && hash(i + 21) < 0.55) for (let k = 0; k < 5; k++) solid.push(ico(0.1, 0, k % 2 ? 0x6faa52 : pick(FLOWERS, hash(i + k * 3)), front.at(w * 0.05 + k * 0.17, 0.08, 0.22)));
    // voiture dans l'allée sur le côté
    if (!o.shop && w < 2.9 && hash(i + 22) < 0.35) {
      const side = walls[hash(i + 23) < 0.5 ? 2 : 3];
      const p = side.at(0, 0, 0.75);
      car(p[0], p[2], Math.PI / 2, pick(CARS, hash(i + 24)));
    }
    if (!o.noGarden) garden(back, w, 1.4, i);
  };

  // ------------------------------------------------------------------ sol et rues
  solid.push(box(84, 0.03, 26.6, 0xdfe8bb, [21, 0.015, 49.7]));
  // grand-rue goudronnée, bordures et trottoirs
  solid.push(box(84, 0.05, 1.5, 0x9f9b93, [21, 0.035, 46]));
  for (const s of [-1, 1]) {
    solid.push(box(84, 0.07, 0.12, 0xcfc6b3, [21, 0.045, 46 + s * 0.8]));
    solid.push(box(84, 0.06, 0.35, 0xd8cfbd, [21, 0.04, 46 + s * 1.03]));
  }
  for (let x = -18; x < 62; x += 1.6) solid.push(box(0.7, 0.054, 0.06, 0xf1ece0, [x, 0.04, 46]));
  // ruelles pavées vers la route, entre les rangées, et la ruelle de derrière
  solid.push(box(1.6, 0.05, 6.6, 0xd8cfbd, [20, 0.035, 39.7]));
  solid.push(box(1.6, 0.05, 12, 0xd8cfbd, [20, 0.035, 53]));
  solid.push(box(1.6, 0.05, 12, 0xd8cfbd, [44, 0.035, 53]));
  for (const [x0, x1] of [
    [-16, 28.6],
    [34.6, 60],
  ])
    solid.push(box(x1 - x0, 0.04, 0.9, 0xd9cdb5, [(x0 + x1) / 2, 0.03, 52.75]));

  // ------------------------------------------------------------------ la place
  {
    const x0 = 15.5;
    const z0 = 43.2;
    for (let i = 0; i < 18; i++)
      for (let j = 0; j < 11; j++) {
        if (j >= 4 && j <= 5) continue; // la grand-rue traverse la place
        solid.push(box(0.49, 0.05, 0.49, (i + j) % 2 ? 0xe3dac6 : 0xd6ccb5, [x0 + i * 0.5 + 0.25, 0.04, z0 + j * 0.5 + 0.25 + (j > 5 ? 0.6 : 0)]));
      }
    // fontaine à deux vasques
    const fx = 20;
    const fz = 48.0;
    solid.push(cyl(1.0, 1.08, 0.38, 18, 0xcfc6b3, [fx, 0.2, fz]));
    solid.push(cyl(0.88, 0.88, 0.04, 18, 0x86c7e6, [fx, 0.37, fz]));
    solid.push(cyl(0.12, 0.18, 0.7, 10, 0xcfc6b3, [fx, 0.65, fz]));
    solid.push(cyl(0.42, 0.14, 0.14, 14, 0xcfc6b3, [fx, 1.0, fz]));
    solid.push(cyl(0.36, 0.36, 0.03, 14, 0x86c7e6, [fx, 1.06, fz]));
    solid.push(cyl(0.05, 0.08, 0.32, 8, 0xcfc6b3, [fx, 1.2, fz]));
    solid.push(sph(0.09, 8, 6, 0xcfc6b3, [fx, 1.38, fz]));
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      solid.push(sph(0.04, 5, 4, 0xbfe6f7, [fx + Math.cos(a) * 0.5, 0.75 - 0.15, fz + Math.sin(a) * 0.5]));
    }
    // platanes (troncs tachetés) et bancs tournés vers la fontaine
    for (const [px, pz] of [
      [15.9, 49.5],
      [24.1, 49.5],
      [15.6, 47.5],
    ]) {
      solid.push(cyl(0.12, 0.16, 1.6, 7, 0xb9b08f, [px, 0.8, pz]));
      for (let q = 0; q < 5; q++) solid.push(box(0.1, 0.16, 0.02, 0x8f8a6a, [px + Math.cos(q * 1.3) * 0.13, 0.4 + q * 0.25, pz + Math.sin(q * 1.3) * 0.13], [0, -q * 1.3, 0]));
      solid.push(ico(0.95, 1, 0x86bf62, [px, 2.1, pz]));
      solid.push(ico(0.65, 1, 0x7aae58, [px + 0.4, 2.45, pz - 0.2]));
      solid.push(ico(0.6, 1, 0x93c96e, [px - 0.45, 2.3, pz + 0.25]));
      solid.push(cyl(0.45, 0.45, 0.06, 14, 0xb9ab93, [px, 0.06, pz]));
    }
    for (const bx of [18.2, 21.8]) {
      const bz = 49.6;
      solid.push(box(1.0, 0.06, 0.32, C.wood, [bx, 0.38, bz]));
      solid.push(box(1.0, 0.24, 0.05, C.wood, [bx, 0.6, bz + 0.15]));
      for (const sx of [-1, 1]) solid.push(box(0.06, 0.38, 0.32, IRON, [bx + sx * 0.42, 0.19, bz]));
    }
    // monument aux morts
    {
      const mx = 23.3;
      const mz = 47.9;
      solid.push(box(1.2, 0.14, 1.2, 0xcfc6b3, [mx, 0.08, mz]));
      solid.push(box(0.9, 0.14, 0.9, 0xd9d1bf, [mx, 0.22, mz]));
      solid.push(box(0.5, 0.7, 0.5, 0xe2dccd, [mx, 0.64, mz]));
      solid.push(cyl(0.0, 0.3, 1.6, 4, 0xe8e2d3, [mx, 1.78, mz], [0, Math.PI / 4, 0]));
      solid.push(box(0.36, 0.08, 0.02, 0xc9a646, [mx, 0.75, mz + 0.26]));
      for (let q = 0; q < 6; q++) solid.push(ico(0.07, 0, q % 2 ? 0x3f7d4f : 0xd9534f, [mx - 0.2 + q * 0.08, 0.35, mz + 0.42]));
      for (const [ox, oz] of [
        [-0.65, -0.65],
        [0.65, -0.65],
        [-0.65, 0.65],
        [0.65, 0.65],
      ]) solid.push(cyl(0.035, 0.035, 0.4, 6, IRON, [mx + ox, 0.2, mz + oz]));
    }
    // terrasse du café : tables, chaises, parasols
    for (const tx of [16.3, 17.6]) {
      const tz = 44.25;
      solid.push(cyl(0.22, 0.22, 0.03, 10, 0xf3efe6, [tx, 0.42, tz]), cyl(0.025, 0.025, 0.4, 5, IRON, [tx, 0.21, tz]));
      solid.push(cyl(0.015, 0.015, 1.05, 5, IRON, [tx, 0.7, tz]), cone(0.55, 0.22, 8, 0x9c2f35, [tx, 1.25, tz]));
      for (const sx of [-1, 1]) {
        solid.push(box(0.17, 0.04, 0.17, 0xc8a46f, [tx + sx * 0.33, 0.26, tz]));
        solid.push(box(0.03, 0.22, 0.17, 0xc8a46f, [tx + sx * 0.42, 0.38, tz]));
        for (const q of [-1, 1]) solid.push(box(0.02, 0.26, 0.02, IRON, [tx + sx * 0.33 + q * 0.07, 0.13, tz]));
      }
    }
    // boîte aux lettres jaune, poubelles, bornes, jardinières
    solid.push(box(0.3, 0.42, 0.22, 0xf2c230, [25.7, 0.65, 44.5]), box(0.06, 0.45, 0.06, IRON, [25.7, 0.22, 44.5]), box(0.18, 0.025, 0.02, 0x2b2b31, [25.7, 0.75, 44.62]));
    for (const [bx, bz] of [
      [14.8, 44.55],
      [25.2, 49.4],
    ]) solid.push(cyl(0.16, 0.14, 0.48, 10, 0x3f6b4f, [bx, 0.26, bz]), cyl(0.17, 0.17, 0.04, 10, 0x2f4f3a, [bx, 0.52, bz]));
    for (let q = 0; q < 6; q++) solid.push(cyl(0.05, 0.06, 0.4, 7, 0x5a5f66, [15.4 + q * 1.75, 0.2, 45.0]), sph(0.06, 6, 4, 0x5a5f66, [15.4 + q * 1.75, 0.42, 45.0]));
    for (const px of [18.7, 21.3]) {
      const pz = 44.3;
      solid.push(box(0.6, 0.32, 0.4, 0xc9bfa9, [px, 0.18, pz]));
      for (let q = 0; q < 6; q++) solid.push(ico(0.1, 0, q % 2 ? 0x6faa52 : pick(FLOWERS, hash(px * 3 + q)), [px - 0.22 + q * 0.09, 0.42, pz + (q % 2 ? 0.08 : -0.06)]));
    }
  }

  // ------------------------------------------------------------------ la mairie (face à la place)
  {
    const x = 23.2;
    const z = 41.9;
    const w = 3.8;
    const d = 2.6;
    const h = 2.35;
    solid.push(box(w + 0.1, 0.18, d + 0.1, 0xb9ab93, [x, 0.09, z]));
    solid.push(box(w, h, d, 0xf1e8d6, [x, h / 2 + 0.06, z]));
    const W = wallOf(0, x, z, w, d);
    // chaînes d'angle, bandeau d'étage, perron, porte à double vantail
    for (const s of [-1, 1]) for (let y = 0.2, k = 0; y < h; y += 0.24, k++) W.bx(k % 2 ? 0.18 : 0.3, 0.2, 0.05, TRIM, s * (w / 2 - (k % 2 ? 0.09 : 0.15)), y + 0.1, 0.01);
    W.bx(w, 0.08, 0.06, TRIM, 0, 1.2, 0.02);
    for (let k = 0; k < 3; k++) W.bx(1.3 - k * 0.2, 0.08, 0.7 - k * 0.2, 0xd6ccb5, 0, 0.04 + k * 0.08, 0.35 - k * 0.1);
    door(W, 0, 0x2f4a6b, { dw: 0.7, dh: 1.0, lamp: true });
    for (const u of [-1.25, -0.7, 0.7, 1.25]) win(W, u, 0.68, 0.36, 0.56, { lintel: true });
    for (const u of [-1.25, -0.7, 0, 0.7, 1.25]) win(W, u, 1.75, 0.36, 0.56, { lintel: true, flowers: Math.round(u * 10) + 40 });
    for (const W2 of [wallOf(2, x, z, w, d), wallOf(1, x, z, w, d)]) for (const u of [-0.6, 0.6]) {
      win(W2, u, 0.68, 0.36, 0.56, { lintel: true });
      win(W2, u, 1.75, 0.36, 0.56, { lintel: true });
    }
    // toit à quatre pans en ardoise, horloge au fronton, drapeaux
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
    solid.push(finalizeExport(g, 0x5f6b78, [x, h + 0.06 + 0.6, z], undefined, [w + 0.4, 1.2, d + 0.4]));
    solid.push(box(1.0, 0.75, 0.3, 0xf1e8d6, [x, h + 0.42, z + d / 2 - 0.05]));
    solid.push(box(1.1, 0.06, 0.4, 0x5f6b78, [x, h + 0.8, z + d / 2 - 0.05]));
    solid.push(cyl(0.24, 0.24, 0.04, 16, 0xffffff, [x, h + 0.45, z + d / 2 + 0.11], [Math.PI / 2, 0, 0]));
    solid.push(box(0.03, 0.17, 0.02, 0x2b2b31, [x, h + 0.5, z + d / 2 + 0.14]), box(0.12, 0.03, 0.02, 0x2b2b31, [x + 0.05, h + 0.45, z + d / 2 + 0.14]));
    signs.push({ text: 'MAIRIE', bg: '#f1e8d6', fg: '#2f4a6b', w: 1.2, h: 0.22, p: W.at(0, 1.34, 0.06), ry: 0 });
    for (const s of [-1, 1]) {
      solid.push(strip(W.at(s * 0.55, 1.25, 0.05), W.at(s * 0.85, 1.6, 0.55), 0.03, 0.03, 0xd9d9d9));
      const p = W.at(s * 0.78, 1.47, 0.42);
      solid.push(box(0.1, 0.24, 0.02, 0x2f5fb0, [p[0] - 0.1 * s + (s < 0 ? 0.2 : 0) - 0.1, p[1], p[2]]));
      solid.push(box(0.1, 0.24, 0.02, 0xffffff, [p[0] + (s < 0 ? 0.2 : 0) - 0.1 * s + 0.0, p[1], p[2]]));
      solid.push(box(0.1, 0.24, 0.02, 0xe0413f, [p[0] + (s < 0 ? 0.2 : 0) - 0.1 * s + 0.1, p[1], p[2]]));
    }
  }

  // ------------------------------------------------------------------ les maisons
  // rangée sud de la grand-rue (façades vers la rue) ; on laisse la place, la ruelle et la mairie
  let k = 1;
  const shops = [
    { at: 1, name: 'Pharmacie', color: 0x3f9b5a, bg: '#2f8a4c', fg: '#ffffff' },
    { at: 30, name: 'Épicerie', color: 0x5d8f3a, bg: '#f3ead2', fg: '#4a6b2a' },
    { at: 41, name: 'Coiffure', color: 0x8a6fb0, bg: '#f6eefb', fg: '#6b4a8f' },
  ];
  for (let x = -12; x < 56; x += 4.1 + hash(k) * 0.8) {
    k += 13;
    const x2 = x + 1.2;
    if (Math.abs(x2 - 20) > 2.6 && Math.abs(x2 - 44) > 2.6 && (x2 < 13.5 || x2 > 35.6)) house(x2, 49.6, k + 7, -1);
    if (x > 9 && x < 27.4) continue;
    const si = shops.findIndex((sh) => x > sh.at);
    const shop = si >= 0 ? shops.splice(si, 1)[0] : undefined;
    house(x, 42.4, k, 1, 1, { shop, noGarden: true });
  }
  // rangée du fond, le long de la ruelle de derrière (on laisse l'église et le cimetière)
  for (let x = -14; x < 58; x += 3.7 + hash(k) * 1.2) {
    k += 13;
    if (x > 27.6 && x < 36.2) continue;
    if (Math.abs(x - 20) < 1.9 || Math.abs(x - 44) < 1.9) continue;
    house(x, 55.4, k, -1, 0.88);
  }
  // boulangerie et café-tabac en bordure de place
  house(13.0, 42.4, 901, 1, 1, { shop: { name: 'Boulangerie', color: 0xb5452f, bg: '#f6e3b8', fg: '#8a3a22' }, noGarden: true });
  house(16.9, 42.3, 905, 1, 0.95, { shop: { name: 'Café · Tabac', color: 0x9c2f35, bg: '#9c2f35', fg: '#ffffff' }, noGarden: true });

  // ------------------------------------------------------------------ l'église, son parvis et le cimetière
  {
    const x = 31.5;
    const z = 51.2;
    const stone = 0xe6dccb;
    solid.push(box(4.4, 0.16, 6.6, 0xb9ab93, [x, 0.08, z]));
    solid.push(box(3.6, 2.6, 5.6, stone, [x, 1.4, z]));
    // contreforts et grandes baies en arc
    for (const s of [-1, 1])
      for (const dz of [-1.9, -0.6, 0.7, 2.0]) {
        solid.push(box(0.28, 1.9, 0.3, 0xd6ccb5, [x + s * 1.9, 0.95, z + dz]));
        solid.push(box(0.2, 0.4, 0.3, 0xd6ccb5, [x + s * 1.86, 2.05, z + dz], [0, 0, s * 0.5]));
      }
    for (const dz of [-1.25, 0.05, 1.35])
      for (const s of [-1, 1]) {
        glass.push(box(0.06, 1.0, 0.42, 0xffffff, [x + s * 1.82, 1.5, z + dz]));
        glass.push(cyl(0.21, 0.21, 0.06, 10, 0xffffff, [x + s * 1.82, 2.0, z + dz], [0, 0, Math.PI / 2]));
        solid.push(box(0.07, 1.1, 0.06, 0x8a7a6a, [x + s * 1.84, 1.5, z + dz]));
      }
    // toit d'ardoise à forte pente et chevet arrondi
    const half = 2.05;
    const a = Math.atan2(1.7, half);
    for (const s of [1, -1]) {
      solid.push(box(0.07, Math.hypot(half, 1.7), 6.0, 0x5f6b78, [x + (s * half) / 2, 2.72 + 0.85, z], [0, 0, s * (Math.PI / 2 - a)]));
    }
    const tri = new THREE.Shape();
    tri.moveTo(-1.8, 0);
    tri.lineTo(1.8, 0);
    tri.lineTo(0, 1.6);
    solid.push(finalizeExport(new THREE.ExtrudeGeometry(tri, { depth: 5.6, bevelEnabled: false }).translate(0, 0, -2.8), stone, [x, 2.7, z]));
    solid.push(box(0.14, 0.1, 6.1, 0x4e5560, [x, 4.42, z]));
    solid.push(cyl(1.5, 1.5, 2.2, 16, stone, [x, 1.2, z + 2.8], undefined, [1, 1, 0.75]));
    solid.push(cone(1.6, 1.2, 16, 0x5f6b78, [x, 2.9, z + 2.8]));
    // clocher : chaînes d'angle, horloges, abat-sons au-dessus du toit, flèche d'ardoise, coq
    const tz = z - 3.3;
    const th = 5.6;
    solid.push(box(1.8, th, 1.8, stone, [x, th / 2 + 0.05, tz]));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (let y = 0.3, q = 0; y < th - 0.2; y += 0.3, q++) {
          const la = q % 2 ? 0.2 : 0.34;
          solid.push(box(la, 0.26, 0.03, 0xd6ccb5, [x + sx * (0.9 - la / 2), y, tz + sz * 0.915]));
          solid.push(box(0.03, 0.26, q % 2 ? 0.34 : 0.2, 0xd6ccb5, [x + sx * 0.915, y, tz + sz * (0.9 - (q % 2 ? 0.17 : 0.1))]));
        }
    // abat-sons sur les quatre faces, sous la corniche
    const T = (f: Face) => wallOf(f, x, tz, 1.8, 1.8);
    for (const f of [0, 1, 2, 3] as Face[]) {
      const W = T(f);
      W.bx(0.62, 0.78, 0.04, 0x3a3530, 0, 4.95, 0.0);
      for (let q = 0; q < 5; q++) W.bx(0.56, 0.05, 0.08, 0x7a6a58, 0, 4.66 + q * 0.14, 0.03, solid, 0.5);
      W.bx(0.74, 0.07, 0.1, TRIM, 0, 4.52, 0.03);
      if (f === 1 || f === 2) {
        // horloge
        W.bx(0.82, 0.82, 0.03, 0xc9a646, 0, 3.7, 0.01);
        solid.push(cyl(0.38, 0.38, 0.05, 18, C.white, W.at(0, 3.7, 0.03), f === 2 ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]));
        W.bx(0.04, 0.26, 0.02, 0x2b2b31, 0, 3.8, 0.06);
        W.bx(0.2, 0.035, 0.02, 0x2b2b31, 0.08, 3.7, 0.06);
      }
    }
    solid.push(box(2.0, 0.12, 2.0, TRIM, [x, th + 0.08, tz]));
    solid.push(cone(1.3, 2.9, 8, 0x5f6b78, [x, th + 1.6, tz], [0, Math.PI / 8, 0]));
    solid.push(box(0.05, 0.7, 0.05, 0xd9b35a, [x, th + 3.35, tz]), box(0.34, 0.05, 0.05, 0xd9b35a, [x, th + 3.4, tz]));
    solid.push(box(0.16, 0.12, 0.05, 0xd9b35a, [x, th + 3.75, tz]), cone(0.05, 0.12, 4, 0xd9b35a, [x - 0.07, th + 3.8, tz]));
    // portail en arc sur la rue, marches, et une rosace au-dessus
    {
      const W = T(1);
      W.bx(1.2, 1.5, 0.1, 0xd6ccb5, 0, 0.85, 0.02);
      W.bx(0.86, 1.2, 0.06, 0x7a4c28, 0, 0.72, 0.08);
      solid.push(cyl(0.43, 0.43, 0.06, 12, 0x7a4c28, W.at(0, 1.32, 0.08), [Math.PI / 2, 0, 0]));
      for (let q = 0; q < 3; q++) W.bx(1.8 - q * 0.3, 0.08, 0.5 - q * 0.12, 0xd6ccb5, 0, 0.04 + q * 0.08, 0.3 - q * 0.08);
      solid.push(cyl(0.36, 0.36, 0.05, 16, 0xd6ccb5, W.at(0, 2.4, 0.02), [Math.PI / 2, 0, 0]));
      glass.push(cyl(0.28, 0.28, 0.06, 14, 0xffffff, W.at(0, 2.4, 0.03), [Math.PI / 2, 0, 0]));
    }
    // vitrail du chevet (côté jardin)
    glass.push(box(0.4, 0.9, 0.06, 0xffffff, [x, 1.3, z + 2.8 + 1.12]));
    // cimetière derrière : mur de pierre, croix et tombes, cyprès
    const cx0 = 29.0;
    const cx1 = 35.6;
    const cz0 = 55.5;
    const cz1 = 59.8;
    solid.push(box(cx1 - cx0, 0.02, cz1 - cz0, 0xc9d79a, [(cx0 + cx1) / 2, 0.02, (cz0 + cz1) / 2]));
    solid.push(box(cx1 - cx0, 0.55, 0.2, 0xcfc0a1, [(cx0 + cx1) / 2, 0.28, cz1]));
    for (const zz of [cz0]) {
      solid.push(box(2.6, 0.55, 0.2, 0xcfc0a1, [cx0 + 1.3, 0.28, zz]));
      solid.push(box(2.6, 0.55, 0.2, 0xcfc0a1, [cx1 - 1.3, 0.28, zz]));
      for (const s of [-1, 1]) solid.push(box(0.3, 0.8, 0.3, TRIM, [(cx0 + cx1) / 2 + s * 0.7, 0.4, zz]));
      for (let q = 0; q < 5; q++) solid.push(box(0.04, 0.5, 0.03, IRON, [(cx0 + cx1) / 2 - 0.5 + q * 0.25, 0.28, zz]));
    }
    for (const s of [-1, 1]) solid.push(box(0.2, 0.55, cz1 - cz0, 0xcfc0a1, [s > 0 ? cx1 : cx0, 0.28, (cz0 + cz1) / 2]));
    for (let r = 0; r < 3; r++)
      for (let q = 0; q < 7; q++) {
        if (q === 3) continue;
        const gx = cx0 + 0.7 + q * 0.87;
        const gz = cz0 + 1.0 + r * 1.15;
        const kk = r * 7 + q;
        solid.push(box(0.5, 0.06, 0.85, 0xbdb5a4, [gx, 0.05, gz]));
        if (hash(kk + 300) < 0.5) {
          solid.push(box(0.05, 0.5, 0.05, 0xd6d0c2, [gx, 0.3, gz - 0.38]), box(0.26, 0.05, 0.05, 0xd6d0c2, [gx, 0.42, gz - 0.38]));
        } else solid.push(box(0.4, 0.42, 0.08, pick([0x9a9690, 0xb3ada2, 0x7d7a74], hash(kk + 301)), [gx, 0.25, gz - 0.38]));
        if (hash(kk + 302) < 0.4) solid.push(ico(0.09, 0, pick(FLOWERS, hash(kk + 303)), [gx + 0.1, 0.13, gz]));
      }
    for (const [px, pz] of [
      [cx0 + 0.4, cz1 - 0.4],
      [cx1 - 0.4, cz1 - 0.4],
      [cx0 + 0.4, cz0 + 0.5],
    ]) solid.push(cone(0.32, 2.2, 7, 0x3f6b3f, [px, 1.2, pz]), cyl(0.06, 0.06, 0.2, 5, C.trunk, [px, 0.1, pz]));
  }

  // ------------------------------------------------------------------ boulodrome et parvis
  {
    // terrain de pétanque derrière la place : gravier, bordures de bois, boules et cochonnet
    const x0 = 15.6;
    const x1 = 19.4;
    const z0 = 50.6;
    const z1 = 52.1;
    solid.push(box(x1 - x0, 0.04, z1 - z0, 0xe0cfa8, [(x0 + x1) / 2, 0.03, (z0 + z1) / 2]));
    for (const zz of [z0, z1]) solid.push(box(x1 - x0 + 0.1, 0.1, 0.08, 0x9b7653, [(x0 + x1) / 2, 0.06, zz]));
    for (const xx of [x0, x1]) solid.push(box(0.08, 0.1, z1 - z0, 0x9b7653, [xx, 0.06, (z0 + z1) / 2]));
    for (let q = 0; q < 6; q++) solid.push(sph(0.045, 6, 5, 0x9aa0a6, [x0 + 1.8 + Math.cos(q * 1.9) * 0.35, 0.09, 51.3 + Math.sin(q * 1.9) * 0.3]));
    solid.push(sph(0.025, 5, 4, 0xd9534f, [x0 + 1.75, 0.07, 51.3]));
    solid.push(box(1.0, 0.06, 0.3, C.wood, [17.5, 0.38, 52.45]), box(1.0, 0.22, 0.05, C.wood, [17.5, 0.58, 52.6]));
    // tilleuls et massifs sur le parvis de l'église
    for (const [tx, tz, r] of [
      [26.2, 48.6, 1.0],
      [26.6, 51.4, 0.9],
      [22.6, 51.6, 1.05],
    ]) tree(tx, tz, r, Math.round(tx * 7 + tz));
    for (let q = 0; q < 7; q++) solid.push(ico(0.16, 0, q % 2 ? 0x6faa52 : pick(FLOWERS, hash(q + 500)), [27.6 + q * 0.2, 0.12, 47.45]));
  }

  // ------------------------------------------------------------------ lampadaires de la grand-rue
  for (let x = -10; x < 56; x += 6) {
    if (x > 14 && x < 26) continue;
    for (const lz of [44.8]) {
      solid.push(cyl(0.035, 0.06, 1.7, 7, IRON, [x, 0.85, lz]));
      solid.push(cyl(0.08, 0.08, 0.12, 7, IRON, [x, 0.12, lz]));
      solid.push(cone(0.15, 0.12, 6, IRON, [x, 1.95, lz]));
      solid.push(cyl(0.08, 0.05, 0.08, 6, IRON, [x, 1.7, lz]));
      lamps.push([x, 1.8, lz]);
    }
  }
  for (const [x, z] of [
    [15.3, 49.0],
    [24.7, 47.3],
  ]) {
    solid.push(cyl(0.035, 0.06, 1.7, 7, IRON, [x, 0.85, z]), cone(0.15, 0.12, 6, IRON, [x, 1.95, z]), cyl(0.08, 0.05, 0.08, 6, IRON, [x, 1.7, z]));
    lamps.push([x, 1.8, z]);
  }

  // ------------------------------------------------------------------ assemblage
  const solidMesh = mesh(merge(solid).translate(0, 0, DZ), true, true);
  scene.add(solidMesh);
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x9fb4c8 });
  const glassMesh = new THREE.Mesh(merge(glass).translate(0, 0, DZ), glassMat);
  scene.add(glassMesh);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
  const warmMesh = new THREE.Mesh(merge(warm).translate(0, 0, DZ), lampMat);
  scene.add(warmMesh);
  const bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.17, 0.15), lampMat, lamps.length);
  lamps.forEach(([x, y, z], i) => bulbs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z + DZ)));
  scene.add(bulbs);
  // flaques de lumière des lampadaires, la nuit
  const poolMat = new THREE.MeshBasicMaterial({ map: LANTERN_GLOW.map, color: 0xffe2a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.4, 3.4).rotateX(-Math.PI / 2), poolMat, lamps.length);
  lamps.forEach(([x, , z], i) => pools.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0.07, z + DZ)));
  pools.renderOrder = 2;
  scene.add(pools);
  // enseignes peintes
  for (const sg of signs) {
    const c = document.createElement('canvas');
    const px = 320;
    c.width = Math.round(sg.w * px);
    c.height = Math.round(sg.h * px);
    const g = c.getContext('2d')!;
    g.fillStyle = sg.bg;
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = sg.fg;
    g.globalAlpha = 0.5;
    g.lineWidth = Math.max(3, c.height * 0.05);
    g.strokeRect(c.height * 0.08, c.height * 0.08, c.width - c.height * 0.16, c.height * 0.16 > 0 ? c.height - c.height * 0.16 : 0);
    g.globalAlpha = 1;
    g.fillStyle = sg.fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 ${Math.round(c.height * 0.62)}px 'Fredoka', 'Nunito', system-ui, sans-serif`;
    g.fillText(sg.text, c.width / 2, c.height * 0.54, c.width - c.height * 0.4);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sg.w, sg.h), new THREE.MeshLambertMaterial({ map: tex }));
    m.position.set(sg.p[0], sg.p[1], sg.p[2] + DZ);
    m.rotation.y = sg.ry;
    scene.add(m);
  }

  // fumée des cheminées : quelques bouffées qui montent et s'effacent
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.5, depthWrite: false });
  const puffGeo = new THREE.IcosahedronGeometry(0.16, 0);
  const smokers = chimneys.filter((_, i) => i % 3 === 0).map(([x, y, z]): [number, number, number] => [x, y, z + DZ]);
  const puffs = smokers.flatMap((c, i) =>
    [0, 1, 2].map((j) => {
      const m = new THREE.Mesh(puffGeo, puffMat);
      scene.add(m);
      return { m, c, p: (i * 0.37 + j / 3) % 1 };
    }),
  );

  return {
    update(time, _dt, day) {
      const night = 1 - day;
      // vitres : reflet bleuté le jour, lumière chaude le soir
      glassMat.color.setRGB(0.62 + 0.38 * night, 0.7 + 0.12 * night, 0.78 - 0.32 * night);
      lampMat.color.setRGB(0.6 + 0.4 * night, 0.6 + 0.35 * night, 0.55 + 0.2 * night);
      poolMat.opacity = 0.55 * Math.max(0, night - 0.15);
      pools.visible = night > 0.15;
      for (const pf of puffs) {
        const k = (time * 0.12 + pf.p) % 1;
        pf.m.position.set(pf.c[0] + Math.sin(time * 0.6 + pf.p * 9) * 0.15 + k * 0.5, pf.c[1] + k * 2.2, pf.c[2] - k * 0.3);
        pf.m.scale.setScalar(0.6 + k * 1.8);
      }
      puffMat.opacity = 0.35 + 0.1 * day;
    },
  };
}
