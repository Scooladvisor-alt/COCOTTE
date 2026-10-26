// Volailles : poules, coqs, poussins et jeunes, modelés en volumes lisses et doux.
// Chaque oiseau est sculpté (corps d'un seul tenant, poitrine bombée, dos qui remonte vers la
// queue), puis habillé de vraies plumes en ruban (queue en éventail, rémiges, faucilles du coq,
// lancettes du camail et de la selle). Les couleurs sont peintes sommet par sommet : plastron,
// camail, peau rouge de la face, petites marbrures du plumage et ombre douce sous le ventre.
// Mêmes pivots d'animation que l'ancien modèle : corps, cou, ailes, pattes.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { skinLook, type HenLook } from '../config/breeds';
import type { BreedId } from '../sim/types';

export interface HenGeo {
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  wingL: THREE.BufferGeometry;
  wingR: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  /** Yeux (repère du cou), à part pour pouvoir cligner : on les écrase verticalement autour de eyeAt. */
  eyes: THREE.BufferGeometry;
  /** Hauteur et profondeur du centre des yeux (repère du cou). */
  eyeAt: [number, number];
}

export type HenKind = 'hen' | 'rooster';

/** Stade de croissance : 0..6 jeune (voir growthStage), 7 adulte. */
export const ADULT_STAGE = 7;

/** Pivots (repère de la racine, sol = 0) */
export const HEN_PIVOT = {
  body: 0.16,
  neck: [0, 0.335, 0.115] as const,
  wing: [0.122, 0.315, 0.05] as const,
  hip: [0.062, 0.165, 0.0] as const,
};

// ------------------------------------------------------------- Matériau ----
/** Lueur de contour (lumière rasante sur le plumage), réglée selon l'heure par le rendu. */
export const HEN_RIM = { value: 0.16 };
/** Ombrage lisse (et non à facettes) : le plumage paraît doux et rond. */
export const HEN_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
HEN_MAT.onBeforeCompile = (sh) => {
  sh.uniforms.uRim = HEN_RIM;
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uRim;').replace(
    '#include <emissivemap_fragment>',
    `#include <emissivemap_fragment>
      vec3 rimV = isOrthographic ? vec3( 0.0, 0.0, 1.0 ) : normalize( vViewPosition );
      float rimK = pow( 1.0 - saturate( dot( normal, rimV ) ), 2.6 );
      totalEmissiveRadiance += diffuseColor.rgb * rimK * uRim;`,
  );
};

// ------------------------------------------------------------- Outils ----
type V3 = [number, number, number];
type Paint = number | ((p: THREE.Vector3, n: THREE.Vector3, c: THREE.Color) => void);

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Transition douce de a vers b (fonctionne aussi si a > b). */
const ss = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const TMP = new THREE.Color();
const mixIn = (c: THREE.Color, hex: number, t: number) => (t > 0 ? c.lerp(TMP.setHex(hex), Math.min(1, t)) : c);
const mixHex = (a: number, b: number, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
const lum = (hex: number) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l;

function hash(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
/** Bruit de valeur 3D lissé (0..1). */
function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (a: number, b: number, c: number) => hash(ix + a, iy + b, iz + c);
  return l(l(l(h(0, 0, 0), h(1, 0, 0), ux), l(h(0, 1, 0), h(1, 1, 0), ux), uy), l(l(h(0, 0, 1), h(1, 0, 1), ux), l(h(0, 1, 1), h(1, 1, 1), ux), uy), uz);
}

/** Marbrures du plumage : légères variations de clarté, comme des plumes qui se chevauchent. */
function mottle(c: THREE.Color, p: THREE.Vector3, amt: number, freq: number) {
  const k = 1 + (noise(p.x * freq, p.y * freq, p.z * freq) - 0.5) * amt;
  c.multiplyScalar(k);
}
/** Ombre douce : les faces tournées vers le sol s'assombrissent. */
function occlude(c: THREE.Color, n: THREE.Vector3, amt = 0.3) {
  c.multiplyScalar(1 - amt * (1 - ss(-0.85, 0.35, n.y)));
}

/** Géométrie lisse : sommets soudés, déformation libre, normales moyennées. */
function sculpt(base: THREE.BufferGeometry, shape?: (v: THREE.Vector3) => void) {
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const g = mergeVertices(base, 1e-4);
  base.dispose();
  if (shape) {
    const pos = g.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      shape(v);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return g;
}

function place(g: THREE.BufferGeometry, p: V3 = [0, 0, 0], r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2])), new THREE.Vector3(...s));
  g.applyMatrix4(m);
  return g;
}

function paint(g: THREE.BufferGeometry, c: Paint) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const arr = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const col = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    if (typeof c === 'number') col.setHex(c);
    else {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i);
      col.setRGB(1, 1, 1);
      c(p, n, col);
    }
    arr[i * 3] = col.r;
    arr[i * 3 + 1] = col.g;
    arr[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Ellipsoïde lisse peint (volume simple : cuisse, oreillon, œil…). */
function blob(r: V3, p: V3, color: Paint, seg = 12, shape?: (v: THREE.Vector3) => void, rot?: V3) {
  const g = sculpt(new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7))), (v) => {
    shape?.(v);
    v.set(v.x * r[0], v.y * r[1], v.z * r[2]);
  });
  return paint(place(g, p, rot), color);
}

/** Volume duveteux (soie, poussin) : sphère bosselée par un bruit. */
function fluff(r: V3, p: V3, color: Paint, amt = 0.14, seed = 0, seg = 18) {
  return blob(r, p, color, seg, (v) => {
    const k = 1 + (noise(v.x * 2.6 + seed, v.y * 2.6, v.z * 2.6) - 0.5) * amt * 2 + (noise(v.x * 6 + seed, v.y * 6, v.z * 6) - 0.5) * amt;
    v.multiplyScalar(k);
  });
}

/** Forme d'une plume : base étroite (le calamus), large au milieu, pointe arrondie. */
const featherW = (t: number) => (0.38 + 0.62 * ss(0, 0.32, t)) * (t > 0.78 ? Math.sqrt(Math.max(0, 1 - ((t - 0.78) / 0.22) ** 2)) : 1);
/** Plume effilée en pointe (lancettes du camail et de la selle, faucilles). */
const lancetW = (t: number) => (0.55 + 0.45 * ss(0, 0.2, t)) * (1 - ss(0.45, 1, t) * 0.92);

/**
 * Plume en ruban le long d'une courbe : deux faces, une nervure centrale bombée.
 * side : direction de l'épaisseur de la plume (sa normale, à peu près).
 */
function ribbon(pts: V3[], width: (t: number) => number, side: V3, color: (t: number, across: number, c: THREE.Color) => void, rows = 8, fold = 0.2) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const S = new THREE.Vector3(...side).normalize();
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const W = new THREE.Vector3();
  const N = new THREE.Vector3();
  const c = new THREE.Color();
  const thick = 0.0016;
  for (const face of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      curve.getPointAt(t, P);
      curve.getTangentAt(t, T);
      W.crossVectors(T, S);
      if (W.lengthSq() < 1e-8) W.set(0, 0, 1);
      W.normalize();
      N.crossVectors(W, T).normalize();
      const w = width(t);
      for (const j of [-1, 0, 1]) {
        const off = face * (thick + (j === 0 ? fold * w : 0));
        pos.push(P.x + W.x * j * w + N.x * off, P.y + W.y * j * w + N.y * off, P.z + W.z * j * w + N.z * off);
        c.setRGB(1, 1, 1);
        color(t, j, c);
        if (face < 0) c.multiplyScalar(0.82);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < 2; j++) {
        const a = base + i * 3 + j;
        const b = a + 1;
        const cc = a + 3;
        const d = a + 4;
        if (face > 0) idx.push(a, b, cc, b, d, cc);
        else idx.push(a, cc, b, b, cc, d);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Dégradé simple d'une plume : de la base à la pointe, nervure un peu plus claire. */
const grad = (a: number, b: number, rib = 1.06) => (t: number, j: number, c: THREE.Color) => {
  c.setHex(a);
  mixIn(c, b, ss(0.2, 1, t));
  if (j === 0) c.multiplyScalar(rib);
};

function merge(parts: THREE.BufferGeometry[]) {
  for (const p of parts) {
    if (!p.index) p.setIndex([...Array(p.attributes.position.count).keys()]);
    for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') p.deleteAttribute(k);
  }
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

// ------------------------------------------------------------- Couleurs ----
/** Duvet des poussins selon la race (le Marans naît sombre, l'Araucana rayé comme un tamia). */
const DOWN: Record<BreedId, { top: number; belly: number; stripe?: number }> = {
  rousse: { top: 0xefc04f, belly: 0xf9e3a0 },
  leghorn: { top: 0xf7e070, belly: 0xfbf0b8 },
  sussex: { top: 0xf6e49a, belly: 0xfbf3d0 },
  soie: { top: 0xfaf0c8, belly: 0xfdf8e6 },
  araucana: { top: 0xcfa766, belly: 0xf1deb2, stripe: 0x6e4b2a },
  marans: { top: 0x3b3431, belly: 0xe8d7a8 },
};

/** Iris : orangé chez la plupart, rouge-brun chez la Marans, noir chez la soie. */
const IRIS: Record<BreedId, number> = { rousse: 0xe2902a, leghorn: 0xe39a33, sussex: 0xd98a2b, soie: 0x1d1a1c, araucana: 0xd4932f, marans: 0xb4502a };

const CLAW = 0x5e4d3a;

function juvenileLook(L: HenLook, breed: BreedId, down: number): HenLook {
  if (down <= 0) return L;
  const D = L.down ?? DOWN[breed].top;
  const d = (c: number, k = 1) => mixHex(c, D, Math.min(1, down * k));
  return { ...L, body: d(L.body), breast: d(L.breast, 1.1), hackle: d(L.hackle), cape: d(L.cape), tail: d(L.tail, 0.6), tail2: d(L.tail2, 0.6), wing: d(L.wing, 0.7), primaries: d(L.primaries, 0.4), lobes: L.face ? L.lobes : mixHex(L.lobes, 0xf4c2b0, 0.5) };
}

/** Pointe des lancettes : éclaircie (or pâle), ou reflet vert pour un plumage tout noir. */
const lancetTip = (L: HenLook, c: number) => (L.face ? mixHex(c, 0x2f6a54, 0.4) : mixHex(c, 0xfff0c8, 0.24));

/** Taille relative de la crête, de la queue et des faucilles chez le jeune (stades 3 à 6). */
const JUVENILE: Record<number, { down: number; comb: number; tail: number; sickle: number }> = {
  3: { down: 0.55, comb: 0.25, tail: 0.3, sickle: 0.15 },
  4: { down: 0.3, comb: 0.45, tail: 0.5, sickle: 0.35 },
  5: { down: 0.12, comb: 0.65, tail: 0.7, sickle: 0.6 },
  6: { down: 0.03, comb: 0.85, tail: 0.88, sickle: 0.82 },
};
type Juv = (typeof JUVENILE)[number];

// =============================================================== CORPS ====
/** Silhouette du corps : point de la sphère unité (direction) → surface du corps (repère de la poule). */
function bodyMap(v: THREE.Vector3, rooster: boolean) {
  const x0 = v.x;
  const y0 = v.y;
  const z0 = v.z;
  const back = Math.max(0, -z0);
  const front = Math.max(0, z0);
  let x = x0 * 0.15;
  let y = y0 * 0.138;
  let z = z0 * 0.205;
  // dos qui remonte vers la queue (la selle)
  y += back * back * (0.07 + Math.max(0, y0) * 0.06);
  // l'arrière s'affine ; le dos se resserre vers le haut
  x *= 1 - back * back * 0.42 - Math.max(0, y0) * 0.16;
  // poitrine profonde et bombée (plus fière chez le coq)
  if (y0 < 0.5) z += front * front * (rooster ? 0.038 : 0.03) * (0.5 - y0);
  // épaules qui montent vers le cou
  const sh = ss(0.25, 0.95, z0) * ss(0.0, 0.85, y0);
  y += sh * (rooster ? 0.045 : 0.035);
  z -= sh * 0.012;
  // ventre un peu plus plat
  if (y0 < -0.2) y += (-0.2 - y0) * 0.025;
  // arrière duveteux sous la queue, fondu dans la silhouette (pas de boule rapportée)
  const rearLow = ss(0.15, 0.75, back) * ss(0.35, -0.45, y0);
  z -= rearLow * 0.022;
  y -= rearLow * 0.008;
  return v.set(x, y + 0.268, z - 0.025);
}

/** Couleur du plumage du corps en un point (repère de la poule). */
function bodyColor(L: HenLook, breed: BreedId, saddle: number, p: THREE.Vector3, c: THREE.Color) {
  c.setHex(L.body);
  // plastron
  mixIn(c, L.breast, ss(0.0, 0.15, p.z) * ss(0.37, 0.25, p.y));
  // haut de la poitrine sombre, dans le prolongement du cou
  if (L.chest) mixIn(c, L.chest, ss(0.06, 0.17, p.z) * ss(0.25, 0.34, p.y) * 0.9);
  // épaules (base du camail)
  mixIn(c, L.cape, ss(0.02, 0.13, p.z) * ss(0.33, 0.41, p.y) * 0.9);
  // ventre et bas des flancs plus clairs
  if (L.fluff) mixIn(c, L.fluff, ss(0.22, 0.14, p.y) * 0.6);
  // selle du coq : lancettes de la couleur du camail sur les reins
  if (saddle > 0 && breed !== 'sussex') mixIn(c, L.hackle, ss(-0.04, -0.15, p.z) * ss(0.33, 0.43, p.y) * 0.85 * saddle);
  // le Sussex a la base de la queue et les couvertures noires
  if (breed === 'sussex') mixIn(c, L.tail, ss(-0.17, -0.22, p.z) * ss(0.33, 0.4, p.y) * 0.8);
  return c;
}

function bodyShell(L: HenLook, breed: BreedId, rooster: boolean, J: Juv): THREE.BufferGeometry {
  const saddle = rooster ? J.sickle : 0;
  const g = sculpt(new THREE.SphereGeometry(1, 26, 18), (v) => bodyMap(v, rooster));
  return paint(g, (p, n, c) => {
    bodyColor(L, breed, saddle, p, c);
    mottle(c, p, 0.09, 48);
    occlude(c, n, 0.3);
  });
}

/**
 * Plumes de couverture en relief (races « écaillées ») : des rangées de petites plumes posées
 * sur le dos, les épaules et le haut des flancs, qui se chevauchent vers l'arrière ; chacune
 * a la couleur du plumage à sa base et un bord clair à sa pointe.
 */
function bodyScales(L: HenLook, breed: BreedId, rooster: boolean, J: Juv): THREE.BufferGeometry[] {
  if (!L.scales) return [];
  const parts: THREE.BufferGeometry[] = [];
  const saddle = rooster ? J.sickle : 0;
  const d = new THREE.Vector3();
  const P = new THREE.Vector3();
  const Q = new THREE.Vector3();
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const N = new THREE.Vector3();
  const center = new THREE.Vector3(0, 0.27, -0.03);
  const base = new THREE.Color();
  const rows = 9;
  for (let r = 0; r < rows; r++) {
    const z0 = 0.36 - r * 0.14;
    const ring = Math.sqrt(Math.max(0, 1 - z0 * z0));
    const n = Math.max(4, Math.round(8 * ring));
    for (let k = 0; k < n; k++) {
      // de l'épaule gauche à l'épaule droite en passant par le dos ; rangées décalées, un peu de désordre
      const jit = (hash(r, k, 1) - 0.5) * 0.18;
      const th = -1.2 + ((k + (r % 2 ? 0.5 : 0) + jit) / (n - 0.5)) * 2.4;
      const zz = z0 + (hash(r, k, 2) - 0.5) * 0.05;
      d.set(Math.sin(th) * ring, Math.cos(th) * ring, zz).normalize();
      if (d.y < 0.08) continue;
      bodyMap(P.copy(d), rooster);
      // normale de la surface (différences finies)
      bodyMap(A.copy(d).add(new THREE.Vector3(0.02, 0, 0)).normalize(), rooster);
      bodyMap(B.copy(d).add(new THREE.Vector3(0, 0, 0.02)).normalize(), rooster);
      N.crossVectors(A.sub(P), B.sub(P)).normalize();
      if (N.dot(Q.copy(P).sub(center)) < 0) N.negate();
      // la plume suit le corps vers l'arrière et un peu vers le bas
      const reach = 0.22 + hash(r, k, 4) * 0.06;
      bodyMap(Q.copy(d).add(new THREE.Vector3((hash(r, k, 5) - 0.5) * 0.06, -0.05 * Math.sign(d.y), -reach)).normalize(), rooster);
      const len = P.distanceTo(Q);
      const lift = 0.004 + len * 0.1;
      const p0: V3 = [P.x + N.x * 0.002, P.y + N.y * 0.002, P.z + N.z * 0.002];
      const p2: V3 = [Q.x + N.x * lift, Q.y + N.y * lift, Q.z + N.z * lift];
      const p1: V3 = [(p0[0] + p2[0]) / 2 + N.x * 0.005, (p0[1] + p2[1]) / 2 + N.y * 0.005, (p0[2] + p2[2]) / 2 + N.z * 0.005];
      bodyColor(L, breed, saddle, P, base);
      const shade = 0.9 + hash(r, k, 3) * 0.18;
      const root = base.clone().multiplyScalar(shade);
      const tip = root.clone().lerp(new THREE.Color(L.scales), 0.55);
      const w = 0.022 + ring * 0.012;
      parts.push(
        ribbon([p0, p1, p2], (t) => w * featherW(t), [N.x, N.y, N.z], (t, j, c) => {
          c.copy(root).lerp(tip, ss(0.55, 1, t));
          if (j === 0) c.multiplyScalar(1.04);
        }, 3, 0.1),
      );
    }
  }
  return parts;
}

/** Volumes du bas du corps : cuisses emplumées et duvet sous la queue. */
function bodyFluffs(L: HenLook): THREE.BufferGeometry[] {
  const col: Paint = (p, n, c) => {
    c.setHex(L.breast);
    mixIn(c, L.body, 0.35);
    // ventre chamois : le haut des cuisses garde la teinte du corps, le bas pâlit
    if (L.fluff) mixIn(c, L.fluff, 0.25 + ss(0.2, 0.1, p.y) * 0.4);
    mottle(c, p, 0.1, 60);
    occlude(c, n, 0.32);
  };
  return [
    blob([0.06, 0.078, 0.07], [0.066, 0.172, 0.004], col, 11),
    blob([0.06, 0.078, 0.07], [-0.066, 0.172, 0.004], col, 11),
  ];
}

/** Queue de poule : couvertures en dôme puis deux rangées de plumes en éventail (forme de tente). */
function henTail(L: HenLook, J: Juv): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    blob([0.056, 0.046, 0.08], [0, 0.346, -0.162], (p, n, c) => {
      c.setHex(L.body);
      mixIn(c, L.tail, ss(-0.17, -0.24, p.z) * 0.6);
      mottle(c, p, 0.1, 50);
      occlude(c, n, 0.25);
    }, 14),
  );
  // pointes plus sombres, ou bordées de clair chez les races écaillées
  const tip = L.scales ? L.tail2 : mixHex(L.tail, 0x000000, 0.25);
  const up = 1 - (L.tailUp ?? 0) * 0.45;
  // queue compacte en coin : les plumes se chevauchent, du dessus (droites) vers l'arrière
  for (const side of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const lean = (0.36 + k * 0.12) * up;
      const spread = 0.06 + k * 0.035;
      const len = (0.19 - k * 0.01) * J.tail;
      const b: V3 = [side * (0.008 + k * 0.002), 0.37 - k * 0.008, -0.19 + k * 0.006];
      const dir = new THREE.Vector3(side * Math.sin(spread) * 0.5, Math.cos(lean), -Math.sin(lean));
      const m: V3 = [b[0] + dir.x * len * 0.5, b[1] + dir.y * len * 0.5, b[2] + dir.z * len * 0.5 - 0.008];
      const e: V3 = [b[0] + dir.x * len, b[1] + dir.y * len - 0.008, b[2] + dir.z * len - 0.024];
      const base = k % 2 ? L.tail2 : L.tail;
      parts.push(ribbon([b, m, e], (t) => 0.038 * featherW(t), [1, 0, side * 0.15], grad(base, k % 2 ? L.tail2 : tip), 7, 0.16));
    }
  }
  return parts;
}

/** Faucille de coq : longue plume qui monte, s'arrondit vers l'arrière puis retombe. */
function sicklePts(b: V3, len: number, side: number, sweep: number): V3[] {
  const pts: V3[] = [[...b]];
  const p = new THREE.Vector3(...b);
  const n = 7;
  for (let i = 1; i <= n; i++) {
    const a = -0.25 + (i / n) * sweep;
    p.x += side * 0.012;
    p.y += Math.cos(a) * (len / n);
    p.z -= Math.sin(a) * (len / n);
    pts.push([p.x, p.y, p.z]);
  }
  return pts;
}

function roosterTail(L: HenLook, breed: BreedId, J: Juv): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = [];
  // selle et couvertures : couleur du camail (blanches chez le Sussex herminé)
  const saddleCol = breed === 'sussex' ? L.body : L.hackle;
  const light = lum(L.tail) > 0.55;
  // queue noire à reflets verts (ou blanche chez les races claires)
  const main = light ? L.tail : 0x18211d;
  const sheen = light ? mixHex(L.tail, 0xffffff, 0.4) : 0x2f6a54;
  const sickleCol = (t: number, j: number, c: THREE.Color) => {
    c.setHex(main);
    mixIn(c, sheen, Math.sin(t * Math.PI) * 0.45 * (j === 0 ? 1.2 : 0.8));
  };
  parts.push(
    blob([0.062, 0.05, 0.085], [0, 0.35, -0.165], (p, n, c) => {
      c.setHex(saddleCol);
      mixIn(c, main, ss(-0.17, -0.25, p.z) * 0.85);
      mottle(c, p, 0.1, 50);
      occlude(c, n, 0.25);
    }, 14),
  );
  const s = J.sickle;
  // grandes faucilles
  for (const side of [-1, 1]) parts.push(ribbon(sicklePts([side * 0.01, 0.38, -0.2], 0.5 * s, side, 2.7), (t) => 0.034 * lancetW(t) * (0.6 + 0.4 * s), [1, 0, 0], sickleCol, 14, 0.12));
  if (s > 0.3) {
    // petites faucilles et couvertures de queue, en gradins
    for (const [x, len, sw] of [
      [0.022, 0.38, 2.4],
      [-0.022, 0.37, 2.35],
      [0.034, 0.3, 2.2],
      [-0.034, 0.29, 2.15],
      [0.04, 0.23, 2.0],
      [-0.04, 0.22, 1.95],
    ] as const)
      parts.push(ribbon(sicklePts([x, 0.37, -0.19], len * s, Math.sign(x), sw), (t) => 0.026 * lancetW(t), [1, 0, 0], sickleCol, 10, 0.12));
  }
  // rectrices droites sous les faucilles
  for (const side of [-1, 1])
    for (let k = 0; k < 3; k++) {
      const lean = 0.55 + k * 0.2;
      const len = 0.17 * Math.max(0.5, J.tail);
      const b: V3 = [side * 0.012, 0.365, -0.19];
      const e: V3 = [b[0] + side * 0.03, b[1] + Math.cos(lean) * len, b[2] - Math.sin(lean) * len];
      parts.push(ribbon([b, [(b[0] + e[0]) / 2, (b[1] + e[1]) / 2, (b[2] + e[2]) / 2 - 0.005], e], (t) => 0.024 * featherW(t), [1, 0, 0], grad(main, main), 6));
    }
  // lancettes de la selle : retombent sur les flancs, au-dessus des ailes
  if (s > 0.3)
    for (const side of [-1, 1])
      for (let k = 0; k < 4; k++) {
        const z = -0.07 - k * 0.028;
        const len = (0.11 + k * 0.012) * s;
        const b: V3 = [side * 0.05, 0.395 - k * 0.004, z];
        const m: V3 = [side * 0.095, 0.37 - len * 0.35, z - 0.03];
        const e: V3 = [side * 0.118, 0.37 - len * 0.85, z - 0.045];
        parts.push(ribbon([b, m, e], (t) => 0.021 * lancetW(t), [side, 0.2, 0], grad(saddleCol, lancetTip(L, saddleCol)), 7, 0.15));
      }
  return parts;
}

// ================================================================ AILE ====
function wingGeo(L: HenLook, side: 1 | -1, fluffyBird: boolean): THREE.BufferGeometry {
  if (fluffyBird) {
    return merge([
      fluff([0.036, 0.075, 0.12], [side * 0.02, -0.05, -0.07], (p, n, c) => {
        c.setHex(L.wing);
        mottle(c, p, 0.1, 70);
        occlude(c, n, 0.25);
      }, 0.16, side * 3),
    ]);
  }
  const parts: THREE.BufferGeometry[] = [];
  const wing = sculpt(new THREE.SphereGeometry(1, 18, 12), (v) => {
    const back = Math.max(0, -v.z);
    let x = v.x * 0.034;
    let y = v.y * 0.074;
    const z = v.z * 0.138;
    y *= 1 - back * 0.38;
    y -= back * back * 0.02;
    x *= 1 - back * 0.3;
    v.set(x + side * 0.01, y - 0.048, z - 0.072);
  });
  parts.push(
    paint(wing, (p, n, c) => {
      c.setHex(L.wing);
      // couvertures sur le haut, rémiges vers le bas et l'arrière
      const low = ss(-0.05, -0.1, p.y) * 0.55 + ss(-0.11, -0.2, p.z) * 0.8;
      mixIn(c, L.primaries, low);
      // rangées de plumes qui se chevauchent
      const band = (p.z * 1.0 - p.y * 0.9) * 28;
      const f = band - Math.floor(band);
      if (p.y < -0.035) c.multiplyScalar(f < 0.28 ? 0.86 : 1);
      mottle(c, p, 0.08, 60);
      occlude(c, n, 0.25);
    }),
  );
  // couvertures en relief (races écaillées) : trois rangées de petites plumes bordées de clair,
  // puis les longues rémiges secondaires qui forment le bas de l'aile
  if (L.scales) {
    const tipC = new THREE.Color(L.wing).lerp(new THREE.Color(L.scales), 0.65);
    for (let r = 0; r < 4; r++) {
      const n = r < 3 ? 4 : 5;
      const len = r < 3 ? 0.034 : 0.07;
      for (let k = 0; k < n; k++) {
        const z = -0.005 - k * (r < 3 ? 0.032 : 0.03) - r * 0.012;
        const y = -0.012 - r * 0.022;
        const x = side * (0.03 - r * 0.002 - Math.max(0, -z - 0.1) * 0.12);
        const b: V3 = [x, y, z];
        const e: V3 = [x + side * 0.004, y - 0.008 - (r === 3 ? 0.012 : 0), z - len];
        const m: V3 = [(b[0] + e[0]) / 2 + side * 0.003, (b[1] + e[1]) / 2, (b[2] + e[2]) / 2];
        const root = new THREE.Color(L.wing).multiplyScalar(0.92 + hash(r, k, side) * 0.14);
        parts.push(
          ribbon([b, m, e], (t) => (r < 3 ? 0.016 : 0.014) * featherW(t), [side, 0.25, 0], (t, j, c) => {
            c.copy(root).lerp(r === 3 ? new THREE.Color(L.primaries) : tipC, ss(0.4, 1, t));
            if (j === 0) c.multiplyScalar(1.05);
          }, 3, 0.12),
        );
      }
    }
  }
  // rémiges primaires : pointes visibles à l'arrière, sous la queue
  for (let k = 0; k < 4; k++) {
    const y = -0.07 + k * 0.007;
    const b: V3 = [side * 0.024, y, -0.12 + k * 0.01];
    const e: V3 = [side * (0.021 - k * 0.002), y - 0.012 + k * 0.004, -0.225 + k * 0.012];
    parts.push(ribbon([b, [(b[0] + e[0]) / 2, (b[1] + e[1]) / 2 - 0.004, (b[2] + e[2]) / 2], e], (t) => 0.017 * featherW(t), [side, 0.15, 0], grad(L.primaries, mixHex(L.primaries, 0x000000, 0.2)), 6, 0.12));
  }
  return merge(parts);
}

// ================================================================ TÊTE ====
/** Crête simple dentelée (découpée puis épaissie), dans le plan y-z, base à l'origine. */
function singleComb(color: number, spikes = 5) {
  const s = new THREE.Shape();
  const U = spikes === 5 ? [0.044, 0.021, -0.002, -0.025, -0.046] : [0.046, 0.026, 0.006, -0.014, -0.033, -0.051];
  const H = spikes === 5 ? [0.034, 0.048, 0.054, 0.048, 0.036] : [0.03, 0.044, 0.052, 0.052, 0.044, 0.034];
  s.moveTo(0.05, 0);
  s.quadraticCurveTo(0.064, 0.008, 0.058, 0.021);
  for (let i = 0; i < U.length; i++) {
    s.quadraticCurveTo(U[i] + 0.009, H[i] * 0.86, U[i], H[i]);
    s.quadraticCurveTo(U[i] - 0.006, H[i] * 0.78, U[i] - 0.0115, 0.024);
  }
  s.quadraticCurveTo(-0.074, 0.032, -0.064, 0.012);
  s.lineTo(-0.045, 0);
  s.lineTo(0.05, 0);
  const ex = new THREE.ExtrudeGeometry(s, { depth: 0.011, bevelEnabled: true, bevelThickness: 0.0045, bevelSize: 0.0035, bevelSegments: 2, curveSegments: 3 });
  ex.translate(0, 0, -0.0055);
  ex.rotateY(-Math.PI / 2);
  const g = sculpt(ex);
  return paint(g, (p, _n, c) => {
    c.setHex(color);
    c.multiplyScalar(0.8 + 0.25 * ss(0.0, 0.05, p.y));
    mottle(c, p, 0.08, 160);
  });
}

const EYE_AT: [number, number] = [0.162, 0.089];

function headGeo(L: HenLook, breed: BreedId, rooster: boolean, J: Juv, stage: number, combCol: number): { head: THREE.BufferGeometry; eyes: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [];
  const eyeParts: THREE.BufferGeometry[] = [];
  const silkie = !!L.fluffy;
  const C: V3 = [0, 0.152, 0.055];
  const headFeather = breed === 'sussex' ? L.body : silkie ? L.body : L.hackle;
  const face = L.face ?? (silkie ? mixHex(L.comb, 0x2a1830, 0.2) : mixHex(L.comb, 0xf08a78, 0.22));
  const hackleLen = rooster ? 0.4 + 0.6 * J.sickle : 0.6;

  // ---- cou : tube incurvé, plumes du camail rayées ----
  const neck = sculpt(new THREE.CylinderGeometry(1, 1, 1, 14, 6, true), (v) => {
    const t = v.y + 0.5;
    const r = 0.058 - t * 0.02 + Math.max(0, 0.3 - t) * 0.05;
    const cz = 0.005 + t * 0.045 - Math.sin(t * Math.PI) * 0.012;
    v.set(v.x * r * 0.92, t * 0.15 - 0.005, cz + v.z * r);
  });
  const hackleCol: Paint = (p, n, c) => {
    c.setHex(L.hackle);
    const a = Math.atan2(p.x, p.z);
    const stripe = 0.5 + 0.5 * Math.sin(a * 13 + p.y * 40);
    // plumes du camail : bordure plus claire ou plus sombre selon la race
    if (breed === 'sussex') mixIn(c, L.body, stripe * 0.38 * ss(0.11, 0.04, p.y));
    else mixIn(c, L.cape, stripe * 0.3);
    // le devant du cou se fond dans le plastron (pas d'effet d'écharpe)
    const front = ss(-0.01, 0.045, p.z);
    if (breed === 'sussex') mixIn(c, L.body, Math.max(ss(0.1, 0.14, p.y), front * 0.95));
    else mixIn(c, L.chest ?? L.breast, front * ss(0.07, 0.0, p.y) * 0.75);
    mottle(c, p, 0.08, 80);
    occlude(c, n, 0.22);
  };
  parts.push(paint(neck, hackleCol));

  // ---- camail : collerette dont le bord tombe en pointes sur les épaules ----
  if (!silkie) {
    const collar = sculpt(new THREE.SphereGeometry(1, 22, 9), (v) => {
      const a = Math.atan2(v.x, v.z);
      const down = Math.max(0, -v.y);
      const spikes = 0.5 + 0.5 * Math.cos(a * 11);
      // les pointes tombent sur le dos et les épaules, pas sur la poitrine
      const backK = ss(0.6, -0.4, v.z);
      let y = v.y * 0.048;
      y -= down * spikes * (0.02 + 0.04 * hackleLen) * backK;
      const r = 0.064 - Math.max(0, v.z) * 0.012;
      v.set(v.x * r, y + 0.04, v.z * r - 0.012);
    });
    parts.push(paint(collar, hackleCol));
    // lancettes du coq : longues plumes du cou qui couvrent les épaules
    if (rooster && J.sickle > 0.3) {
      for (let k = 0; k < 9; k++) {
        const a = Math.PI + (k - 4) * 0.42;
        const sx = Math.sin(a);
        const sz = Math.cos(a);
        const len = 0.1 * J.sickle;
        const b: V3 = [sx * 0.045, 0.075, sz * 0.042 + 0.012];
        const m: V3 = [sx * 0.066, 0.02, sz * 0.062];
        const e: V3 = [sx * 0.074, 0.075 - len * 1.3, sz * 0.07 - 0.016];
        parts.push(ribbon([b, m, e], (t) => 0.026 * lancetW(t), [sx, 0.1, sz], grad(L.hackle, lancetTip(L, L.hackle)), 7, 0.15));
      }
    }
  }

  // ---- tête ----
  const head = sculpt(new THREE.SphereGeometry(1, 18, 13), (v) => {
    let x = v.x * 0.05;
    let y = v.y * 0.056;
    const z = v.z * 0.066;
    if (v.z > 0) x *= 1 - v.z * 0.2;
    if (v.y > 0.3) y -= (v.y - 0.3) * 0.008;
    v.set(x + C[0], y + C[1], z + C[2]);
  });
  parts.push(
    paint(head, (p, n, c) => {
      const dx = Math.abs(p.x - C[0]);
      const dy = p.y - C[1];
      const dz = p.z - C[2];
      c.setHex(headFeather);
      mottle(c, p, 0.08, 90);
      // peau nue de la face, autour de l'œil et sous le bec
      const cheek = ss(-0.004, 0.026, dz) * ss(0.016, 0.038, dx) * ss(0.032, 0.006, dy);
      const throat = ss(-0.012, -0.04, dy) * ss(0.008, 0.04, dz);
      mixIn(c, face, Math.max(cheek, throat) * (silkie ? 0.7 : 0.95));
      occlude(c, n, 0.2);
    }),
  );

  // ---- yeux : iris, pupille et petit reflet, à fleur de tête (lentilles aplaties) ----
  const iris = L.iris ?? IRIS[breed];
  for (const sx of [1, -1]) {
    const E: V3 = [sx * 0.0362, EYE_AT[0], EYE_AT[1]];
    eyeParts.push(blob([0.0058, 0.0112, 0.0112], E, iris, 9, undefined, [0, -sx * 0.45, 0]));
    eyeParts.push(blob([0.0032, 0.0068, 0.0068], [E[0] + sx * 0.0036, E[1] + 0.0004, E[2] + 0.0016], 0x0d0d10, 7, undefined, [0, -sx * 0.45, 0]));
    eyeParts.push(blob([0.0018, 0.0022, 0.0022], [E[0] + sx * 0.0058, E[1] + 0.0038, E[2] + 0.0036], 0xffffff, 5));
    // oreillon
    parts.push(blob([0.004, 0.011, 0.009], [sx * 0.046, 0.128, 0.058], (_p, n, c) => {
      c.setHex(L.lobes);
      occlude(c, n, 0.2);
    }, 6));
  }

  // ---- bec : mandibule supérieure crochue et mandibule inférieure ----
  const beak = (len: number, rx: number, ry: number, hook: number, p: V3) =>
    paint(
      place(
        sculpt(new THREE.ConeGeometry(1, 1, 10, 4), (v) => {
          const t = v.y + 0.5;
          v.set(v.x * rx, v.z * ry - t * t * hook, t * len);
        }),
        p,
        [0.22, 0, 0],
      ),
      (q, n, c) => {
        c.setHex(L.beak);
        mixIn(c, 0x6b5232, ss(0.12, 0.1, q.z) * 0.25);
        occlude(c, n, 0.25);
      },
    );
  parts.push(beak(0.054, 0.0165, 0.0125, 0.018, [0, 0.146, 0.1]));
  parts.push(beak(0.036, 0.012, 0.007, 0.004, [0, 0.133, 0.1]));

  // ---- crête et barbillons ----
  const k = (rooster ? 1.6 : L.combType === 'big' ? 1.4 : 1) * J.comb;
  if (L.combType === 'single' || L.combType === 'big') {
    const big = L.combType === 'big';
    const tilt = big && !rooster && J.comb > 0.6 ? 0.5 : 0;
    parts.push(place(singleComb(combCol, rooster ? 6 : 5), [big && tilt ? 0.008 : 0, 0.196, 0.068], [0, 0, tilt], [k, k * (rooster ? 1.08 : 1), k]));
    const wk = (rooster ? 1.7 : big ? 1.3 : 1) * Math.max(0.35, J.comb);
    for (const sx of [1, -1])
      parts.push(
        blob([0.011 * wk, 0.021 * wk, 0.014 * wk], [sx * 0.0095, 0.104 - (wk - 1) * 0.016, 0.106], (_p, n, c) => {
          c.setHex(combCol);
          occlude(c, n, 0.25);
        }, 10, (v) => {
          const low = Math.max(0, -v.y);
          v.x *= 1 + low * 0.35;
          v.z *= 1 + low * 0.25;
        }),
      );
  } else if (L.combType === 'pea') {
    const kk = Math.max(0.45, k);
    parts.push(
      blob([0.012 * kk, 0.011 * kk, 0.036 * kk], [0, 0.202, 0.083], (p, n, c) => {
        c.setHex(combCol);
        c.multiplyScalar(0.85 + 0.3 * noise(p.x * 400, p.y * 400, p.z * 400));
        occlude(c, n, 0.2);
      }, 14, (v) => v.multiplyScalar(1 + (noise(v.x * 4, v.y * 4, v.z * 4) - 0.5) * 0.5)),
    );
    parts.push(blob([0.009 * kk, 0.014 * kk, 0.01 * kk], [0, 0.112, 0.105], combCol, 10));
  } else {
    // crête en noix (soie) : petite masse bosselée, sombre
    const kk = Math.max(0.45, k);
    parts.push(fluff([0.017 * kk, 0.013 * kk, 0.016 * kk], [0, 0.198, 0.1], combCol, 0.3, 7, 10));
  }
  if (L.tufts) {
    // touffes d'oreilles de l'Araucana
    for (const sx of [1, -1])
      parts.push(ribbon([[sx * 0.045, 0.126, 0.062], [sx * 0.066, 0.135, 0.04], [sx * 0.08, 0.15, 0.012]], (t) => 0.014 * featherW(t), [sx, 0.3, 0], grad(L.cape, mixHex(L.cape, 0xffffff, 0.15)), 6, 0.25));
  }
  if (silkie) {
    // huppe en pompon, barbe et favoris
    const soft: Paint = (p, n, c) => {
      c.setHex(L.body);
      mottle(c, p, 0.08, 120);
      occlude(c, n, 0.22);
    };
    parts.push(fluff([0.064, 0.056, 0.062], [0, 0.205, 0.04], soft, 0.18, 11));
    parts.push(fluff([0.044, 0.032, 0.036], [0, 0.118, 0.082], soft, 0.18, 5));
    parts.push(fluff([0.062, 0.07, 0.06], [0, 0.07, 0.01], soft, 0.16, 13));
  }
  void stage;
  return { head: merge(parts), eyes: merge(eyeParts) };
}

// =============================================================== PATTE ====
function legGeo(L: HenLook, rooster: boolean, stage: number, chick = false): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const legC = chick ? 0xf0a23c : L.legs;
  const legPaint: Paint = (p, n, c) => {
    c.setHex(legC);
    // écailles du tarse
    const band = p.y * 95;
    const f = band - Math.floor(band);
    c.multiplyScalar(f < 0.25 ? 0.88 : 1);
    occlude(c, n, 0.25);
  };
  const thin = chick ? 0.82 : 1;
  // jarret
  parts.push(blob([0.016 * thin, 0.019, 0.016 * thin], [0, -0.035, 0.002], legPaint, 8));
  // tarse
  parts.push(
    paint(
      sculpt(new THREE.CylinderGeometry(1, 1, 1, 8, 8, true), (v) => {
        const t = v.y + 0.5;
        const r = (0.0112 + t * 0.003) * thin;
        v.set(v.x * r, -0.158 + t * 0.125, 0.004 + (1 - t) * 0.006 + v.z * r * 0.95);
      }),
      legPaint,
    ),
  );
  // doigts : trois devant, un derrière, avec griffes plus sombres
  const toe = (len: number, yaw: number, p: V3) =>
    paint(
      place(
        sculpt(new THREE.CylinderGeometry(1, 1, 1, 6, 4), (v) => {
          const t = v.y + 0.5;
          const r = 0.0068 * (1 - t * 0.5) * thin;
          v.set(v.x * r, v.z * r * 0.75 - t * t * 0.004, t * len);
        }),
        p,
        [0, yaw, 0],
      ),
      (q, n, c) => {
        c.setHex(legC);
        const d = Math.hypot(q.x - p[0], q.z - p[2]);
        mixIn(c, CLAW, ss(len * 0.82, len * 0.95, d) * 0.85);
        occlude(c, n, 0.25);
      },
    );
  const foot: V3 = [0, -0.158, 0.008];
  for (const [len, yaw] of [
    [0.058, -0.5],
    [0.07, 0],
    [0.058, 0.5],
  ] as const)
    parts.push(toe(len * (chick ? 0.85 : 1), yaw, foot));
  parts.push(toe(0.03, Math.PI, [0, -0.156, -0.002]));
  // ergot du coq, pointé vers l'arrière
  if (rooster && stage >= 6) {
    const sl = 0.03 * (stage >= ADULT_STAGE ? 1 : 0.5);
    parts.push(
      paint(
        place(
          sculpt(new THREE.ConeGeometry(1, 1, 8, 2), (v) => {
            const t = v.y + 0.5;
            v.set(v.x * 0.0065, v.z * 0.0065 + t * t * 0.006, -t * sl);
          }),
          [0, -0.112, -0.008],
        ),
        mixHex(legC, CLAW, 0.4),
      ),
    );
  }
  if (L.featheredLegs && !chick) {
    const f = L.featheredLegs;
    if (f === 2) {
      parts.push(fluff([0.026, 0.05, 0.026], [0.006, -0.1, 0.004], (p, n, c) => {
        c.setHex(L.body);
        mottle(c, p, 0.08, 120);
        occlude(c, n, 0.25);
      }, 0.2, 3, 12));
      parts.push(fluff([0.02, 0.012, 0.034], [0.022, -0.152, 0.022], L.body, 0.2, 9, 10));
    } else {
      // Marans : quelques plumes sur le côté du tarse
      // Marans : un fin duvet de plumes collé au côté du tarse
      for (let k = 0; k < 3; k++)
        for (const sx of [1, -1])
          parts.push(ribbon([[sx * 0.009, -0.06 - k * 0.03, 0.002], [sx * 0.015, -0.08 - k * 0.03, -0.001], [sx * 0.018, -0.095 - k * 0.03, -0.004]], (t) => 0.008 * featherW(t), [sx, 0, 0.3], grad(L.body, mixHex(L.body, 0xffffff, 0.08)), 4, 0.25));
    }
  }
  return merge(parts);
}

// ================================================================ SOIE ====
function silkieBody(L: HenLook, rooster: boolean): THREE.BufferGeometry[] {
  const soft: Paint = (p, n, c) => {
    c.setHex(L.body);
    mottle(c, p, 0.1, 70);
    occlude(c, n, 0.3);
  };
  const parts = [
    fluff([0.172, 0.15, 0.205], [0, 0.265, -0.02], soft, 0.14, 1, 26),
    // coussin de la queue, plus haut chez le coq
    fluff([0.1, rooster ? 0.1 : 0.085, 0.1], [0, rooster ? 0.37 : 0.345, -0.16], soft, 0.2, 4, 16),
    fluff([0.06, 0.07, 0.066], [0.066, 0.18, 0.005], soft, 0.18, 2, 12),
    fluff([0.06, 0.07, 0.066], [-0.066, 0.18, 0.005], soft, 0.18, 6, 12),
  ];
  if (rooster) {
    // le coq soie porte une queue duveteuse, plus haute et retombante
    parts.push(fluff([0.07, 0.085, 0.06], [0, 0.45, -0.2], soft, 0.22, 9, 14));
    parts.push(fluff([0.06, 0.07, 0.055], [0, 0.42, -0.26], soft, 0.22, 12, 12));
  }
  return parts;
}

// ============================================================= POUSSIN ====
/**
 * Poussin (stades 0 à 2) : boule de duvet, grosse tête, gros yeux noirs brillants. Au fil des
 * jours, les premières plumes de la race poussent au bout des ailes, puis sur le dos et la queue.
 */
function chickGeometry(breed: BreedId, stage: number, skin = 0): HenGeo {
  const L = skinLook(breed, skin);
  const D = L.down ? { top: L.down, belly: L.downBelly ?? L.down, stripe: undefined } : DOWN[breed];
  const st = Math.max(0, Math.min(2, stage));
  const feathered = st === 0 ? 0 : st === 1 ? 0.25 : 0.55;
  const downPaint =
    (featherCol: number, featherK: number): Paint =>
    (p, n, c) => {
      c.setHex(D.top);
      // ventre et face plus clairs
      mixIn(c, D.belly, ss(0.28, 0.18, p.y) * 0.8 + ss(0.04, 0.16, p.z) * 0.4);
      // rayures du poussin Araucana
      if (D.stripe && p.y > 0.26) {
        const ax = Math.abs(p.x);
        const s = Math.max(1 - ss(0.0, 0.02, ax), 1 - ss(0, 0.012, Math.abs(ax - 0.07)));
        mixIn(c, D.stripe, s * 0.8);
      }
      mixIn(c, featherCol, featherK * ss(0.28, 0.36, p.y));
      mottle(c, p, 0.12, 70);
      occlude(c, n, 0.3);
    };
  const bodyParts = [
    fluff([0.168, 0.15, 0.175 + st * 0.016], [0, 0.27, -0.02 - st * 0.01], downPaint(L.body, feathered), 0.07, 2, 22),
    fluff([0.05, 0.055, 0.055], [0.06, 0.19, 0.0], downPaint(L.body, 0), 0.1, 5, 10),
    fluff([0.05, 0.055, 0.055], [-0.06, 0.19, 0.0], downPaint(L.body, 0), 0.1, 8, 10),
  ];
  if (st >= 1) {
    // premières plumes de queue
    const n = st === 1 ? 2 : 4;
    for (let k = 0; k < n; k++) {
      const sx = (k - (n - 1) / 2) * 0.012;
      const len = 0.04 + st * 0.025;
      bodyParts.push(ribbon([[sx, 0.33, -0.17], [sx * 1.5, 0.33 + len * 0.6, -0.17 - len * 0.6], [sx * 2, 0.33 + len * 0.9, -0.17 - len]], (t) => 0.014 * featherW(t), [1, 0, 0], grad(k % 2 ? L.tail2 : L.tail, L.tail), 5));
    }
  }
  const body = merge(bodyParts);
  body.translate(0, -HEN_PIVOT.body, 0);

  const hr = 0.108 - st * 0.01;
  const hy = 0.062 + st * 0.008;
  const hz = 0.03 + st * 0.006;
  const headParts = [fluff([hr, hr * 0.98, hr * 1.02], [0, hy, hz], downPaint(L.hackle, feathered * 0.6), 0.06, 4, 18)];
  // gros yeux noirs brillants, posés sur la tête (à part pour cligner)
  const eyeParts: THREE.BufferGeometry[] = [];
  const eyeY = hy + 0.018;
  const eyeZ = hz + hr * 0.6;
  for (const sx of [1, -1]) {
    const E: V3 = [sx * hr * 0.66, eyeY, eyeZ];
    eyeParts.push(blob([0.011, 0.0185, 0.0175], E, 0x111114, 10, undefined, [0, -sx * 0.75, 0]));
    eyeParts.push(blob([0.0035, 0.0042, 0.0042], [E[0] + sx * 0.0085, E[1] + 0.007, E[2] + 0.007], 0xffffff, 6));
  }
  const beakCol = L.face ? L.beak : mixHex(0xe8912c, L.beak, 0.3);
  headParts.push(
    paint(
      place(
        sculpt(new THREE.ConeGeometry(1, 1, 10, 3), (v) => {
          const t = v.y + 0.5;
          v.set(v.x * 0.02, v.z * 0.016 - t * t * 0.006, t * (0.042 + st * 0.005));
        }),
        [0, hy - 0.006, hz + hr * 0.92],
        [0.15, 0, 0],
      ),
      (_q, n, c) => {
        c.setHex(beakCol);
        occlude(c, n, 0.25);
      },
    ),
  );
  // bouton de crête rosé
  if (st >= 2) headParts.push(blob([0.007, 0.008, 0.02], [0, hy + hr * 0.98, hz + 0.035], L.face ? L.comb : mixHex(L.comb, 0xf4c2b0, 0.5), 8));
  const head = merge(headParts);

  const wing = (side: 1 | -1) => {
    const parts = [
      fluff([0.034 + st * 0.004, 0.06 + st * 0.006, 0.08 + st * 0.012], [side * 0.012, -0.035, -0.04], downPaint(L.wing, feathered), 0.12, side * 2, 12),
    ];
    // rémiges : les toutes premières vraies plumes, au bout des ailes
    if (st >= 1)
      for (let k = 0; k < 2 + st; k++) {
        const y = -0.05 + k * 0.006;
        parts.push(ribbon([[side * 0.02, y, -0.08], [side * 0.022, y - 0.004, -0.1 - st * 0.012], [side * 0.02, y - 0.006, -0.12 - st * 0.025]], (t) => 0.012 * featherW(t), [side, 0.1, 0], grad(L.primaries, L.primaries), 4));
      }
    return merge(parts);
  };
  return { body, head, wingL: wing(1), wingR: wing(-1), leg: legGeo(L, false, 0, true), eyes: merge(eyeParts), eyeAt: [eyeY, eyeZ] };
}

// =========================================================== ASSEMBLAGE ====
const henCache = new Map<string, HenGeo>();

export function henGeometry(breed: BreedId, kind: HenKind = 'hen', stage = ADULT_STAGE, skin = 0): HenGeo {
  const ck = `${breed}:${kind}:${stage}:${skin}`;
  const cached = henCache.get(ck);
  if (cached) return cached;
  if (stage < 3) {
    const g = chickGeometry(breed, stage, skin);
    henCache.set(ck, g);
    return g;
  }
  const rooster = kind === 'rooster';
  const J = JUVENILE[stage] ?? { down: 0, comb: 1, tail: 1, sickle: 1 };
  const L = juvenileLook(skinLook(breed, skin), breed, J.down);
  // crête : petite et rose pâle chez le jeune, elle rougit en grandissant
  // (le coq noir garde une crête sombre à tout âge)
  const combCol = J.comb < 1 && !L.face ? mixHex(L.comb, 0xf2b8a4, (1 - J.comb) * 0.7) : L.comb;

  const body: THREE.BufferGeometry[] = [];
  if (L.fluffy) body.push(...silkieBody(L, rooster));
  else {
    body.push(bodyShell(L, breed, rooster, J), ...bodyFluffs(L), ...bodyScales(L, breed, rooster, J));
    if (L.rumpless) {
      // Araucana sans croupion : un dos arrondi, sans queue
      body.push(blob([0.066, 0.05, 0.07], [0, 0.322, -0.162], (p, n, c) => {
        c.setHex(L.body);
        mottle(c, p, 0.1, 50);
        occlude(c, n, 0.25);
      }, 14));
    } else if (rooster) body.push(...roosterTail(L, breed, J));
    else body.push(...henTail(L, J));
  }
  const bodyGeo = merge(body);
  bodyGeo.translate(0, -HEN_PIVOT.body, 0);

  const g: HenGeo = {
    body: bodyGeo,
    ...(() => {
      const hg = headGeo(L, breed, rooster, J, stage, combCol);
      return { head: hg.head, eyes: hg.eyes, eyeAt: EYE_AT };
    })(),
    wingL: wingGeo(L, 1, !!L.fluffy),
    wingR: wingGeo(L, -1, !!L.fluffy),
    leg: legGeo(L, rooster, stage),
  };
  henCache.set(ck, g);
  return g;
}
