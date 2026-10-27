// Corps humains (salariés de la ferme, clients et passants) : proportions d'adulte, visage
// (yeux, sourcils, nez, oreilles, bouche), coiffures variées, barbes, lunettes, et des tenues de
// métier détaillées. Toutes les pièces sont des primitives colorées fusionnées (voir geo.ts).
import * as THREE from 'three';
import { box, cyl, finalizeExport, ico, sph, type V3 } from './geo';

type Parts = THREE.BufferGeometry[];

export const SKIN_TONES = [0xf1c7a5, 0xe0a982, 0xc68863, 0x8d5a3b, 0xf5d5bd, 0xb87a55, 0x6e4530];
const HAIR_YOUNG = [0x3a2a20, 0x6b4a2f, 0xd9b26a, 0x1f1f1f, 0xa0522d, 0x8a6a45, 0x2b1d16];
const HAIR_OLD = [0x9a9690, 0xd8d4cc];

export type HairStyle = 'short' | 'crop' | 'curly' | 'bald' | 'ponytail' | 'bun' | 'long' | 'pixie';

export interface Look {
  skin: number;
  hair: number;
  style: HairStyle;
  beard: 'none' | 'full' | 'mustache' | 'stubble';
  glasses: boolean;
  /** Carrure (largeur du buste) et taille. */
  build: number;
  height: number;
}

/** Physique tiré du numéro d'apparence (stable d'une partie à l'autre). */
export function lookOf(look: number, fem?: boolean): Look {
  const r = (k: number) => {
    const x = Math.sin((look + 1) * 12.9898 + k * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const f = fem ?? r(1) < 0.5;
  const old = r(2) < 0.16;
  const skin = SKIN_TONES[Math.floor(r(3) * SKIN_TONES.length)];
  const dark = skin === 0x8d5a3b || skin === 0x6e4530;
  const hair = old ? HAIR_OLD[Math.floor(r(4) * HAIR_OLD.length)] : dark ? (r(4) < 0.8 ? 0x1f1f1f : 0x2b1d16) : HAIR_YOUNG[Math.floor(r(4) * HAIR_YOUNG.length)];
  const fs: HairStyle[] = ['ponytail', 'bun', 'long', 'pixie', 'ponytail', 'curly'];
  const ms: HairStyle[] = ['short', 'crop', 'short', 'curly', old ? 'bald' : 'short', 'crop'];
  const style = (f ? fs : ms)[Math.floor(r(5) * 6)];
  const bk = r(6);
  const beard = f ? 'none' : bk < 0.22 ? 'full' : bk < 0.36 ? 'mustache' : bk < 0.52 ? 'stubble' : 'none';
  return { skin, hair, style, beard, glasses: r(7) < (old ? 0.6 : 0.18), build: (f ? 0.93 : 1.0) + r(8) * 0.08, height: (f ? 0.95 : 0.99) + r(9) * 0.06 };
}

const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();

/**
 * Tête centrée sur son pivot (le cou en dessous) ; visage vers +z. Rayon du crâne ~0,1.
 * `hat` : la coiffure reste plaquée sous un chapeau (pas de chignon ni de mèches qui dépassent).
 */
export function headParts(l: Look, o: { hat?: boolean } = {}): Parts {
  const p: Parts = [];
  const skinD = shade(l.skin, 0.86);
  // crâne un peu ovale, mâchoire et menton
  p.push(sph(0.1, 12, 10, l.skin, [0, 0.04, 0], [0.92, 1.05, 0.98]));
  p.push(sph(0.07, 10, 6, l.skin, [0, -0.012, 0.024], [1.0, 0.8, 1.0]));
  // oreilles
  for (const s of [1, -1]) p.push(sph(0.022, 6, 5, skinD, [s * 0.09, 0.035, -0.004], [0.5, 1, 0.75]));
  // nez
  p.push(cyl(0.006, 0.019, 0.045, 6, skinD, [0, 0.026, 0.098], [Math.PI / 2 - 0.25, 0, 0]));
  // yeux (blanc, iris sombre) et sourcils
  for (const s of [1, -1]) {
    p.push(sph(0.016, 8, 6, 0xf7f3ec, [s * 0.034, 0.05, 0.083], [1, 0.75, 0.5]));
    p.push(sph(0.0095, 6, 5, 0x2a2622, [s * 0.034, 0.05, 0.09], [1, 1, 0.5]));
    p.push(box(0.034, 0.009, 0.012, shade(l.hair, 0.9), [s * 0.035, 0.077, 0.088], [0, 0, s * -0.12]));
  }
  // bouche
  p.push(box(0.034, 0.007, 0.01, 0xa65a52, [0, -0.012, 0.091]));
  // coiffure : une calotte un peu plus grande que le crâne, décalée vers le haut et l'arrière
  const hair = l.hair;
  if (l.style !== 'bald') p.push(sph(0.1, 12, 8, hair, [0, 0.074, -0.014], [0.98, l.style === 'crop' ? 0.82 : 0.9, 1.04]));
  else p.push(sph(0.1, 12, 6, hair, [0, 0.03, -0.03], [0.98, 0.5, 1.0]));
  if (l.style === 'short' || l.style === 'crop' || l.style === 'pixie')
    for (const s of [1, -1]) p.push(box(0.012, 0.035, 0.028, hair, [s * 0.087, 0.045, 0.03])); // pattes
  if (l.style === 'curly' && !o.hat) for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    p.push(ico(0.032, 0, hair, [Math.sin(a) * 0.06, 0.13 + (i % 2) * 0.012, Math.cos(a) * 0.055 - 0.02]));
  }
  if (l.style === 'pixie') p.push(sph(0.05, 8, 5, hair, [0.03, 0.115, 0.05], [1.2, 0.5, 0.8], [0, 0, -0.3])); // mèche
  if (l.style === 'ponytail') {
    p.push(cyl(0.02, 0.02, 0.025, 6, shade(hair, 0.7), [0, 0.07, -0.108], [0.5, 0, 0]));
    p.push(cyl(0.028, 0.012, 0.17, 7, hair, [0, -0.02, -0.13], [0.35, 0, 0]));
  }
  if (l.style === 'bun' && !o.hat) p.push(sph(0.045, 8, 6, hair, [0, 0.135, -0.06]));
  if (l.style === 'bun' && o.hat) p.push(sph(0.04, 8, 6, hair, [0, 0.06, -0.11]));
  if (l.style === 'long') {
    // cheveux qui tombent dans le dos et encadrent le visage
    p.push(sph(0.1, 10, 8, hair, [0, -0.02, -0.035], [1.0, 1.25, 0.72]));
    for (const s of [1, -1]) p.push(box(0.022, 0.13, 0.05, hair, [s * 0.088, 0.0, 0.035]));
  }
  // barbe, moustache, ombre de barbe
  if (l.beard === 'full') {
    p.push(sph(0.074, 10, 6, hair, [0, -0.022, 0.03], [1.1, 0.9, 1.0]));
    p.push(box(0.034, 0.007, 0.01, 0xa65a52, [0, -0.012, 0.104]));
  }
  if (l.beard === 'full' || l.beard === 'mustache') p.push(box(0.052, 0.014, 0.016, hair, [0, 0.002, 0.097]));
  if (l.beard === 'stubble') p.push(sph(0.071, 10, 6, shade(l.skin, 0.72), [0, -0.016, 0.022], [1.02, 0.78, 1.0]));
  // lunettes : deux cercles fins et un pont
  if (l.glasses) {
    for (const s of [1, -1]) {
      const ring = finalizeExport(new THREE.TorusGeometry(0.019, 0.003, 4, 12), 0x2b2b31, [s * 0.034, 0.05, 0.097]);
      p.push(ring);
      p.push(box(0.004, 0.004, 0.09, 0x2b2b31, [s * 0.056, 0.055, 0.05]));
    }
    p.push(box(0.03, 0.004, 0.004, 0x2b2b31, [0, 0.055, 0.098]));
  }
  return p;
}

export interface Outfit {
  shirt: number;
  pants: number;
  shoes: number;
  /** Manches retroussées (avant-bras nus). */
  rolled?: boolean;
  gloves?: number;
  /** Bottes montantes (couvrent le mollet). */
  boots?: boolean;
  /** Tissu à carreaux : bandes plus sombres sur la chemise. */
  check?: boolean;
}

/** Jambe pendant sous la hanche (pivot à 0) : cuisse, genou, mollet, chaussure ; pied à y = -len. */
export function legParts(o: Outfit, len = 0.42): Parts {
  const k = len / 0.42;
  const p: Parts = [
    cyl(0.06, 0.05, 0.23 * k, 8, o.pants, [0, -0.1 * k, 0]),
    cyl(0.05, 0.043, 0.19 * k, 8, o.pants, [0, -0.28 * k, 0.004]),
  ];
  if (o.boots) {
    p.push(cyl(0.055, 0.05, 0.2 * k, 8, o.shoes, [0, -0.3 * k, 0.004]));
    p.push(cyl(0.057, 0.057, 0.02, 8, shade(o.shoes, 0.8), [0, -0.205 * k, 0.004]));
  }
  // chaussure : talon, empeigne arrondie, semelle
  p.push(box(0.088, 0.06, 0.12, o.shoes, [0, -len + 0.035, 0.012]));
  p.push(sph(0.046, 8, 5, o.shoes, [0, -len + 0.03, 0.07], [0.95, 0.65, 1.1]));
  p.push(box(0.094, 0.018, 0.17, shade(o.shoes, 0.55), [0, -len + 0.009, 0.03]));
  return p;
}

/** Bras pendant sous l'épaule (pivot à 0) : manche, avant-bras, main ; main vers y = -0,36. */
export function armParts(o: Outfit, skin: number, len = 0.36): Parts {
  const k = len / 0.36;
  const p: Parts = [sph(0.05, 8, 6, o.shirt, [0, -0.012, 0], [1, 0.9, 1]), cyl(0.047, 0.04, 0.2 * k, 8, o.shirt, [0, -0.1 * k, 0])];
  if (o.check) for (const y of [-0.04, -0.12]) p.push(cyl(0.047, 0.045, 0.014, 8, shade(o.shirt, 0.7), [0, y * k, 0]));
  if (o.rolled) {
    p.push(cyl(0.047, 0.047, 0.035, 8, o.shirt, [0, -0.19 * k, 0])); // revers de manche
    p.push(cyl(0.037, 0.031, 0.15 * k, 8, skin, [0, -0.27 * k, 0]));
  } else p.push(cyl(0.04, 0.034, 0.15 * k, 8, o.shirt, [0, -0.26 * k, 0]));
  const hand = o.gloves ?? skin;
  if (o.gloves) p.push(cyl(0.038, 0.034, 0.05, 8, hand, [0, -0.31 * k, 0]));
  p.push(sph(0.036, 8, 6, hand, [0, -0.355 * k, 0.004], [0.78, 1.15, 0.6]));
  p.push(sph(0.014, 5, 4, hand, [0, -0.335 * k, 0.03], [0.8, 1.3, 0.8])); // pouce
  return p;
}

/**
 * Buste au-dessus de la hanche (pivot à 0) : bassin, ceinture, torse aplati, épaules, col et cou.
 * Les épaules sont à y ≈ 0,39, x ≈ ±0,17 (là où s'accrochent les bras).
 */
export function torsoParts(o: Outfit, skin: number, opts: { belt?: number; collar?: number; tuck?: boolean } = {}): Parts {
  const p: Parts = [];
  p.push(cyl(0.125, 0.13, 0.13, 12, o.pants, [0, 0.02, 0], undefined, [1, 1, 0.76]));
  p.push(cyl(0.145, 0.122, 0.32, 12, o.shirt, [0, 0.24, 0], undefined, [1, 1, 0.7]));
  p.push(sph(0.145, 12, 6, o.shirt, [0, 0.39, 0], [1, 0.3, 0.7]));
  for (const s of [1, -1]) p.push(sph(0.06, 8, 6, o.shirt, [s * 0.14, 0.37, 0], [1, 0.8, 0.95]));
  if (o.check)
    for (const y of [0.13, 0.22, 0.31]) p.push(cyl(0.146 - (0.31 - y) * 0.07, 0.143 - (0.31 - y) * 0.07, 0.014, 12, shade(o.shirt, 0.7), [0, y, 0], undefined, [1, 1, 0.71]));
  if (opts.belt !== undefined) {
    p.push(cyl(0.128, 0.128, 0.032, 12, opts.belt, [0, 0.09, 0], undefined, [1, 1, 0.77]));
    p.push(box(0.035, 0.028, 0.012, 0xc9a646, [0, 0.09, 0.1]));
  }
  // col de chemise et cou
  p.push(cyl(0.05, 0.064, 0.04, 10, opts.collar ?? o.shirt, [0, 0.43, 0]));
  for (const s of [1, -1]) p.push(box(0.045, 0.012, 0.035, opts.collar ?? shade(o.shirt, 0.95), [s * 0.03, 0.43, 0.055], [0.5, 0, s * 0.5]));
  p.push(cyl(0.041, 0.047, 0.1, 8, skin, [0, 0.47, 0]));
  return p;
}

/** Petite aide : barre fine entre deux points (sangles, tubes, ficelles). */
export function strip(a: V3, b: V3, w: number, t: number, color: number): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.BoxGeometry(w, len, t);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  const e = new THREE.Euler().setFromQuaternion(q);
  const mid = va.add(vb).multiplyScalar(0.5);
  return finalizeExport(g, color, [mid.x, mid.y, mid.z], [e.x, e.y, e.z]);
}
