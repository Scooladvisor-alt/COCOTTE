// La nature du décor : essences d'arbres (avec un modèle allégé pour les vues lointaines), buissons,
// ombres au pied des arbres, sol de la campagne et eau animée. Tout suit les saisons : feuillages
// d'automne, branches ternes en hiver, gel des mares, cultures qui poussent puis sont moissonnées.
import * as THREE from 'three';
import { GRASS_MAT, SNOW_UNIFORM, box, cone, cyl, finalizeExport, merge, type V3 } from './geo';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
function h3(x: number, y: number, z: number, seed: number) {
  // arrondi : deux sommets confondus reçoivent la même valeur (pas de fente entre deux facettes)
  const s = Math.sin(Math.round(x * 1000) * 0.0127 + Math.round(y * 1000) * 0.0311 + Math.round(z * 1000) * 0.0743 + seed * 1.37) * 43758.5453;
  return s - Math.floor(s);
}

// ---------------------------------------------------------------- Formes ----
/** Boule irrégulière : feuillage, roche, motte de terre. */
export function lump(r: number, detail: number, color: number, p: V3, s: V3 = [1, 1, 1], seed = 0, amp = 0.22) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = r * (1 + amp * (h3(x, y, z, seed) - 0.5) * 2);
    pos.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return finalizeExport(g, color, p, [0, 0, 0], s);
}

/** Dégradé vertical : le dessous du feuillage plus sombre, le dessus accroche la lumière. */
export function grade(g: THREE.BufferGeometry, y0: number, y1: number, low = 0.66, high = 1.2) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const col = g.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = clamp01((pos.getY(i) - y0) / (y1 - y0));
    const k = low + (high - low) * t;
    col.setXYZ(i, Math.min(1, col.getX(i) * k * (0.97 + 0.07 * t)), Math.min(1, col.getY(i) * k), Math.min(1, col.getZ(i) * k * (1.04 - 0.1 * t)));
  }
  return g;
}

/** Triangles libres (brins, pétales, épis) : toujours éclairés comme vus de dessus. */
export class Soup {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private c = new THREE.Color();
  tri(a: V3, b: V3, c: V3, color: number, up: V3 = [0.15, 0.97, 0.15]) {
    this.c.set(color);
    for (const v of [a, b, c]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nor.push(up[0], up[1], up[2]);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }
  quad(a: V3, b: V3, c: V3, d: V3, color: number, up?: V3) {
    this.tri(a, b, c, color, up);
    this.tri(a, c, d, color, up);
  }
  /** Losange vertical (épi, fleur de lavande) : base, côtés, sommet. */
  diamond(x: number, y0: number, y1: number, z: number, half: number, ang: number, color: number, tipX = x, tipZ = z) {
    const dx = Math.cos(ang) * half;
    const dz = Math.sin(ang) * half;
    const ym = y0 + (y1 - y0) * 0.45;
    this.quad([x, y0, z], [x + dx, ym, z + dz], [tipX, y1, tipZ], [x - dx, ym, z - dz], color);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ------------------------------------------------------------- Essences ----
const BARK = 0x8a6a4b;
const BARK_D = 0x6b503a;
type Lobe = [number, number, number, number, number?];

const cache = new Map<string, THREE.BufferGeometry>();
function memo(key: string, make: () => THREE.BufferGeometry) {
  let g = cache.get(key);
  if (!g) cache.set(key, (g = make()));
  return g;
}

function crown(lobes: Lobe[], colors: number[], seed: number, far: boolean, s: V3 = [1, 0.92, 1]) {
  // de près, seules les deux grosses masses sont bien rondes : le reste ne se distingue pas à l'écran
  const g = merge(lobes.map(([x, y, z, r], i) => lump(r, !far && i < 2 ? 1 : 0, colors[i % colors.length], [x, y, z], s, seed + i, far ? 0.2 : 0.11)));
  grade(g, Math.min(...lobes.map((l) => l[1] - l[3])), Math.max(...lobes.map((l) => l[1] + l[3])), 0.74, 1.2);
  return g;
}
function bole(top: number, foot: number, h: number, far: boolean, color = BARK) {
  const parts = [cyl(top, foot, h, far ? 4 : 6, color, [0, h / 2, 0])];
  if (!far) parts.push(cyl(foot, foot * 1.5, 0.12, 6, BARK_D, [0, 0.06, 0]));
  return parts;
}
const limb = (x: number, y: number, z: number, len: number, r: number, rx: number, rz: number) => cyl(r * 0.55, r, len, 4, BARK, [x, y, z], [rx, 0, rz]);

function oak(far: boolean) {
  const leaves = far
    ? ([[0, 1.42, 0, 0.8], [0.48, 1.2, 0.06, 0.48], [-0.46, 1.22, -0.06, 0.48], [0.06, 1.86, 0.04, 0.46]] as Lobe[])
    : ([[0, 1.42, 0, 0.68, 1], [0.48, 1.22, 0.14, 0.46, 1], [-0.46, 1.26, -0.14, 0.48, 1], [0.06, 1.18, -0.48, 0.42, 0], [-0.1, 1.16, 0.48, 0.42, 0], [0.14, 1.86, 0.06, 0.42, 1]] as Lobe[]);
  const parts = [...bole(0.08, 0.13, 1.0, far), crown(leaves, [0x6da34a, 0x7aae52, 0x62974a], 11, far)];
  if (!far) parts.push(limb(0.2, 1.0, 0.05, 0.5, 0.05, 0, -0.85), limb(-0.2, 1.02, -0.04, 0.5, 0.05, 0, 0.85));
  return merge(parts);
}
function lime(far: boolean) {
  const leaves = far
    ? ([[0, 1.6, 0, 0.66], [0.3, 1.26, 0.14, 0.42], [-0.3, 1.3, -0.14, 0.42], [0, 2.05, 0, 0.44]] as Lobe[])
    : ([[0, 1.6, 0, 0.62, 1], [0.32, 1.28, 0.2, 0.42, 1], [-0.34, 1.32, -0.16, 0.42, 0], [0.02, 1.24, -0.36, 0.38, 0], [-0.1, 2.02, 0.04, 0.44, 1]] as Lobe[]);
  return merge([...bole(0.06, 0.1, 1.1, far), crown(leaves, [0x82b857, 0x8fc15f, 0x76ad4f], 23, far, [1, 1, 1])]);
}
function birch(far: boolean) {
  const leaves = far
    ? ([[0, 1.74, 0, 0.46], [0.24, 1.42, 0.08, 0.32], [-0.24, 1.46, -0.08, 0.32], [0, 2.08, 0, 0.28]] as Lobe[])
    : ([[0, 1.74, 0, 0.42, 1], [0.27, 1.44, 0.1, 0.3, 0], [-0.26, 1.48, -0.1, 0.3, 0], [0.05, 1.24, 0.24, 0.26, 0], [-0.05, 1.27, -0.25, 0.26, 0], [0.05, 2.06, 0, 0.28, 0]] as Lobe[]);
  const parts = [cyl(0.035, 0.07, 1.5, far ? 4 : 6, 0xece7dc, [0, 0.75, 0]), crown(leaves, [0xa4c964, 0xb1d06e, 0x96bf5a], 37, far)];
  // écorce blanche marquée de stries sombres
  if (!far) for (let i = 0; i < 5; i++) parts.push(box(0.085 - i * 0.006, 0.025, 0.085 - i * 0.006, 0x4f4a44, [0, 0.22 + i * 0.22, 0], [0, i * 1.1, 0]));
  return merge(parts);
}
function tier(r: number, h: number, y: number, color: number, seed: number, seg: number) {
  const g = new THREE.ConeGeometry(r, h, seg);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // le bord de chaque étage ondule : des branches, pas un cône parfait
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > -h / 2 + 0.001) continue;
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = 0.88 + 0.26 * h3(Math.cos(a), 0, Math.sin(a), seed);
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  return finalizeExport(g, color, [0, y, 0]);
}
function pine(far: boolean) {
  const tiers: Array<[number, number, number, number]> = far
    ? [[0.62, 1.0, 0.75, 0x4c8c66], [0.46, 0.9, 1.35, 0x56966e], [0.3, 0.78, 1.9, 0x62a278]]
    : [[0.66, 0.9, 0.68, 0x478561], [0.54, 0.84, 1.14, 0x4c8c66], [0.42, 0.74, 1.56, 0x56966e], [0.3, 0.64, 1.94, 0x5d9d74], [0.17, 0.46, 2.3, 0x68a87e]];
  const leaves = merge(tiers.map(([r, h, y, c], i) => tier(r, h, y, c, 41 + i, far ? 6 : 9)));
  grade(leaves, 0.3, 2.5, 0.72, 1.14);
  return merge([cyl(0.06, 0.1, 0.5, far ? 4 : 6, BARK_D, [0, 0.25, 0]), leaves]);
}
function poplar(far: boolean) {
  const s: V3 = [0.86, 1.32, 0.86];
  const leaves: Lobe[] = far ? [[0, 1.2, 0, 0.42], [0, 2.1, 0, 0.42], [0, 2.95, 0, 0.26]] : [[0, 1.05, 0, 0.36, 1], [0.05, 1.68, 0.03, 0.42, 1], [-0.03, 2.38, -0.02, 0.37, 1], [0, 3.0, 0, 0.24, 0]];
  return merge([...bole(0.05, 0.1, 0.8, far), crown(leaves, [0x6b9f50, 0x77ab58, 0x628f49], 53, far, s)]);
}
function apple(far: boolean) {
  const leaves = far ? ([[0, 1.06, 0, 0.58], [0.26, 0.9, 0.1, 0.34], [-0.26, 0.92, -0.1, 0.34]] as Lobe[]) : ([[0, 1.08, 0, 0.52, 1], [0.3, 0.92, 0.12, 0.34, 0], [-0.3, 0.94, -0.1, 0.34, 0], [0.02, 0.9, -0.3, 0.3, 0], [0, 1.4, 0.02, 0.3, 0]] as Lobe[]);
  const parts = [...bole(0.05, 0.085, 0.7, far), crown(leaves, [0x7fb552, 0x8abd5a, 0x73a94a], 67, far)];
  if (!far) {
    parts.push(limb(0.1, 0.68, 0, 0.32, 0.035, 0, -0.7), limb(-0.1, 0.68, 0, 0.32, 0.035, 0, 0.7));
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39;
      const y = 0.82 + (i % 4) * 0.17;
      const rr = 0.52 - Math.abs(y - 1.0) * 0.35;
      parts.push(lump(0.045, 0, i % 3 ? 0xd2483a : 0xe6a93a, [Math.cos(a) * rr, y, Math.sin(a) * rr], [1, 1, 1], i, 0));
    }
  }
  return merge(parts);
}
function willow(far: boolean) {
  const dome: Lobe[] = far ? [[0, 1.75, 0, 0.8], [0.4, 1.5, 0.2, 0.46], [-0.4, 1.52, -0.2, 0.46]] : [[0, 1.78, 0, 0.74, 1], [0.44, 1.54, 0.2, 0.46, 0], [-0.44, 1.56, -0.2, 0.46, 0], [0.1, 1.5, -0.46, 0.44, 0], [-0.08, 1.5, 0.46, 0.44, 0]];
  const parts = [...bole(0.09, 0.15, 1.2, far), crown(dome, [0x9dbb56, 0xa9c563, 0x8fae4e], 79, far)];
  // rideaux de branches retombantes
  const n = far ? 5 : 12;
  const strands: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const r = 0.74 + (i % 2) * 0.14;
    strands.push(lump(0.2, 0, i % 2 ? 0x98b652 : 0x8aa84a, [Math.cos(a) * r, 1.02 - (i % 3) * 0.06, Math.sin(a) * r], [0.62, 2.3, 0.62], 90 + i, 0.14));
  }
  const curtain = merge(strands);
  grade(curtain, 0.45, 1.5, 0.72, 1.05);
  parts.push(curtain);
  return merge(parts);
}
function bush(far: boolean) {
  const leaves: Lobe[] = far
    ? [[0, 0.24, 0, 0.34], [0.2, 0.2, 0.06, 0.24]]
    : [[0, 0.25, 0, 0.3, 1], [0.25, 0.2, 0.08, 0.22, 0], [-0.22, 0.2, -0.08, 0.23, 0], [0.03, 0.42, -0.04, 0.2, 0]];
  return crown(leaves, [0x6a9e49, 0x78ad52, 0x5f9342], 101, far, [1, 0.88, 1]);
}

const SPECIES = { oak, lime, birch, pine, poplar, apple, willow, bush };
export type Species = keyof typeof SPECIES;
/** Modèle d'une essence : `far` pour les vues d'ensemble, où les détails ne se verraient pas. */
export const speciesGeometry = (sp: Species, far = false) => memo(`${sp}${far ? ':far' : ''}`, () => SPECIES[sp](far));

const VARIANTS: Species[] = ['oak', 'lime', 'birch'];
export const treeGeometry = (variant: number, far = false) => speciesGeometry(VARIANTS[variant % 3], far);
export const pineGeometry = (far = false) => speciesGeometry('pine', far);
export const bushGeometry = (far = false) => speciesGeometry('bush', far);

/** Buisson fleuri (hortensia, rosier) : mêmes volumes, semés de fleurs. */
export function floweringBush(color: number, seed = 1) {
  return memo(`flb${color}${seed}`, () => {
    const parts = [speciesGeometry('bush').clone()];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.39 + seed;
      const y = 0.26 + (i % 4) * 0.08;
      const r = 0.36 - (y - 0.26) * 0.95;
      parts.push(lump(i % 3 ? 0.052 : 0.07, 0, color, [Math.cos(a) * r, y, Math.sin(a) * r], [1, 0.8, 1], i, 0.1));
    }
    return merge(parts);
  });
}

/** Haie taillée : motte régulière posée sur une base (à répéter le long d'une bordure). */
export function hedgeRun(x0: number, z0: number, x1: number, z1: number, h = 0.36, depth = 0.38, color = 0x6e9f4c) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 0.42));
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const shade = i % 2 ? color : new THREE.Color(color).multiplyScalar(0.93).getHex();
    parts.push(lump(depth * 0.6, 0, shade, [x0 + (x1 - x0) * t, h * 0.56, z0 + (z1 - z0) * t], [1, (h / depth) * 0.95, 1], 200 + i, 0.16));
  }
  const g = merge(parts);
  grade(g, 0, h, 0.72, 1.14);
  return g;
}

// --------------------------------------------------------------- Saisons ----
/** Poids de chaque saison (fondu au changement) et neige au sol. */
export const SEASON = { spring: 1, summer: 0, autumn: 0, winter: 0, snow: 0 };

const TREE_U = { uAutumn: { value: 0 }, uWinter: { value: 0 }, uSpring: { value: 1 } };
/** Feuillages : même rendu que MAT (neige comprise), avec les couleurs de la saison. Les conifères gardent leurs aiguilles. */
export const TREE_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
TREE_MAT.onBeforeCompile = (shader) => {
  shader.uniforms.uSnow = SNOW_UNIFORM;
  Object.assign(shader.uniforms, TREE_U);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying float vSnowUp;\nvarying float vSnowY;\nvarying float vLeafSeed;').replace(
    '#include <project_vertex>',
    `#include <project_vertex>
    vec3 snowN = objectNormal;
    vec4 snowP = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      snowN = mat3( instanceMatrix ) * snowN;
      snowP = instanceMatrix * snowP;
      vLeafSeed = fract( instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.71 );
    #else
      vec4 leafW = modelMatrix * snowP;
      vLeafSeed = fract( floor( leafW.x * 0.45 ) * 0.37 + floor( leafW.z * 0.45 ) * 0.71 );
    #endif
    vSnowUp = normalize( mat3( modelMatrix ) * snowN ).y;
    vSnowY = ( modelMatrix * snowP ).y;`,
  );
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSnow;\nuniform float uAutumn;\nuniform float uWinter;\nuniform float uSpring;\nvarying float vSnowUp;\nvarying float vSnowY;\nvarying float vLeafSeed;').replace(
    '#include <color_fragment>',
    `#include <color_fragment>
    float leafK = smoothstep( 0.015, 0.05, diffuseColor.g - diffuseColor.r ) * step( diffuseColor.b, diffuseColor.r );
    float leafL = dot( diffuseColor.rgb, vec3( 0.3, 0.6, 0.1 ) ) / 0.34;
    vec3 autumnC = mix( vec3( 0.68, 0.46, 0.07 ), vec3( 0.68, 0.21, 0.04 ), smoothstep( 0.3, 0.62, vLeafSeed ) );
    autumnC = mix( autumnC, vec3( 0.44, 0.09, 0.03 ), smoothstep( 0.8, 1.0, vLeafSeed ) );
    vec3 leafC = diffuseColor.rgb;
    leafC = mix( leafC, vec3( 0.32, 0.56, 0.1 ) * leafL, uSpring * 0.3 );
    leafC = mix( leafC, autumnC * leafL, uAutumn * 0.92 );
    leafC = mix( leafC, vec3( 0.3, 0.25, 0.2 ) * leafL, uWinter * 0.9 );
    diffuseColor.rgb = mix( diffuseColor.rgb, leafC, leafK );
    float snowK = smoothstep( 0.12, 0.4, uSnow ) * 0.92 * smoothstep( 0.45, 0.8, vSnowUp ) * smoothstep( 0.5, 0.75, vSnowY );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95, 0.965, 0.985 ), snowK );`,
  );
};

const GROUND_U = { uTint: { value: new THREE.Color(0x9fcd62) }, uAmt: { value: 0 }, uGSnow: { value: 0 } };
/** Sol de la campagne : ses marbrures suivent la couleur de la saison, puis la neige. */
export const GROUND_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
GROUND_MAT.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, GROUND_U);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint;\nuniform float uAmt;\nuniform float uGSnow;').replace(
    '#include <color_fragment>',
    `#include <color_fragment>
    diffuseColor.rgb = mix( diffuseColor.rgb, uTint * ( diffuseColor.g / 0.42 ), uAmt );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.94, 0.97 ), uGSnow );`,
  );
};

const SOIL_U = { uSoilSnow: { value: 0 } };
/** Terre des champs : elle blanchit sous la neige comme le reste du paysage. */
export const SOIL_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
SOIL_MAT.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, SOIL_U);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSoilSnow;').replace('#include <color_fragment>', '#include <color_fragment>\n    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.94, 0.97 ), uSoilSnow );');
};

// ------------------------------------------------------------------ Eau ----
export const WATER_U = { uTime: { value: 0 }, uFrozen: { value: 0 } };
/** Eau : reflets qui serpentent lentement ; elle gèle quand la neige s'installe. */
export const WATER_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
WATER_MAT.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, WATER_U);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWaterP;').replace('#include <project_vertex>', '#include <project_vertex>\n    vWaterP = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uFrozen;\nvarying vec2 vWaterP;').replace(
    '#include <color_fragment>',
    `#include <color_fragment>
    float w1 = sin( vWaterP.y * 5.2 + sin( vWaterP.x * 1.9 + uTime * 0.45 ) * 1.5 + uTime * 0.5 );
    float w2 = sin( vWaterP.x * 2.2 - uTime * 0.3 + sin( vWaterP.y * 1.3 ) * 1.2 );
    float glint = smoothstep( 0.965, 1.0, w1 ) * smoothstep( -0.1, 0.8, w2 ) * ( 1.0 - uFrozen );
    diffuseColor.rgb *= 0.95 + 0.07 * sin( vWaterP.x * 0.9 + vWaterP.y * 1.3 + uTime * 0.2 );
    diffuseColor.rgb += vec3( 0.26, 0.3, 0.32 ) * glint;
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.74, 0.86, 0.94 ) + 0.05 * sin( vWaterP.x * 3.1 + vWaterP.y * 2.3 ), uFrozen );`,
  );
};

/** Pourtour d'une mare : jamais une ellipse parfaite. */
const shoreline = (a: number, seed: number) => 1 + 0.13 * Math.sin(2 * a + seed) + 0.085 * Math.sin(3 * a + seed * 2.3) + 0.05 * Math.sin(5 * a + seed * 0.7);

function rings(cx: number, cz: number, rx: number, rz: number, seed: number, stops: Array<[number, number, number]>, seg = 48) {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const ca = new THREE.Color();
  const cb = new THREE.Color();
  const at = (a: number, t: number, y: number): V3 => {
    const r = shoreline(a, seed) * t;
    return [cx + Math.cos(a) * rx * r, y, cz + Math.sin(a) * rz * r];
  };
  for (let s = 0; s < stops.length - 1; s++) {
    const [t0, y0, c0] = stops[s];
    const [t1, y1, c1] = stops[s + 1];
    ca.set(c0);
    cb.set(c1);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p00 = at(a0, t0, y0);
      const p01 = at(a1, t0, y0);
      const p10 = at(a0, t1, y1);
      const p11 = at(a1, t1, y1);
      // sens direct vu du ciel
      for (const [p, c] of [[p00, ca], [p01, ca], [p10, cb], [p01, ca], [p11, cb], [p10, cb]] as Array<[V3, THREE.Color]>) {
        pos.push(p[0], p[1], p[2]);
        col.push(c.r, c.g, c.b);
        nor.push(0, 1, 0);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Une mare : la pièce d'eau (du plus profond au bord) et sa berge qui se fond dans l'herbe. */
export function pondGeometry(cx: number, cz: number, rx: number, rz: number, seed: number, grass = 0x8fbb5c) {
  return {
    water: rings(cx, cz, rx, rz, seed, [
      [0, 0.058, 0x4a97bf],
      [0.55, 0.058, 0x5cabd0],
      [0.86, 0.058, 0x86cbdc],
      [1.02, 0.058, 0xaddcdd],
    ]),
    bank: rings(cx, cz, rx, rz, seed, [
      [0.95, 0.045, 0x6f6448],
      [1.03, 0.07, 0x9c8d66],
      [1.1, 0.078, 0xc4b48a],
      [1.22, 0.05, 0xa9b678],
      [1.42, 0.004, grass],
    ]),
    shore: (a: number) => shoreline(a, seed),
  };
}

// --------------------------------------------------------------- Cultures ----
export type CropClass = 'cereal' | 'colza' | 'garden';
type CropStage = { g: number; y: number; s: number };
/** Printemps, été, automne, hiver : hauteur, teinte de jeune pousse, teinte de chaume. */
const CROP_YEAR: Record<CropClass, CropStage[]> = {
  cereal: [
    { g: 0.6, y: 0.88, s: 0 },
    { g: 1, y: 0, s: 0 },
    { g: 0.2, y: 0, s: 0.9 },
    { g: 0.07, y: 0, s: 1 },
  ],
  colza: [
    { g: 1, y: 0, s: 0 },
    { g: 0.9, y: 0.82, s: 0 },
    { g: 0.28, y: 0.2, s: 0.55 },
    { g: 0.3, y: 0.72, s: 0.1 },
  ],
  garden: [
    { g: 0.82, y: 0.06, s: 0 },
    { g: 1, y: 0, s: 0 },
    { g: 0.92, y: 0, s: 0.24 },
    { g: 0.5, y: 0, s: 0.62 },
  ],
};
const CROP_U: Record<CropClass, { uGrow: { value: number }; uYoung: { value: number }; uStraw: { value: number } }> = {
  cereal: { uGrow: { value: 1 }, uYoung: { value: 0 }, uStraw: { value: 0 } },
  colza: { uGrow: { value: 1 }, uYoung: { value: 0 }, uStraw: { value: 0 } },
  garden: { uGrow: { value: 1 }, uYoung: { value: 0 }, uStraw: { value: 0 } },
};
const CROP_SHARED = { uCropSnow: { value: 0 }, uCropWind: { value: 0 } };

function cropMaterial(cls: CropClass, clump: boolean) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: !clump, side: clump ? THREE.DoubleSide : THREE.FrontSide });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, CROP_U[cls], CROP_SHARED);
    if (clump) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal );');
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uGrow;\nuniform float uCropWind;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed.y *= uGrow;
      #ifdef USE_INSTANCING
        vec3 tuftPos = instanceMatrix[3].xyz;
        float bladeH = max( position.y, 0.0 );
        float gust = 0.6 + 0.4 * sin( uCropWind * 0.35 + tuftPos.x * 0.08 );
        float sway = ( sin( uCropWind * 1.5 + tuftPos.x * 0.45 + tuftPos.z * 0.3 ) * 0.7 + sin( uCropWind * 2.7 + tuftPos.x * 1.1 - tuftPos.z * 0.7 ) * 0.2 ) * gust;
        transformed.x += sway * bladeH * bladeH * 0.32;
        transformed.z += sway * bladeH * bladeH * 0.16;
      #endif`,
    );
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uYoung;\nuniform float uStraw;\nuniform float uCropSnow;').replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float cropL = dot( diffuseColor.rgb, vec3( 0.3, 0.6, 0.1 ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.15, 0.36, 0.07 ) * ( 0.65 + cropL * 1.1 ), uYoung );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.6, 0.46, 0.22 ) * ( 0.72 + cropL * 0.55 ), uStraw );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.94, 0.97 ), uCropSnow );`,
    );
  };
  return m;
}
export const CROP_ROWS: Record<CropClass, THREE.MeshLambertMaterial> = { cereal: cropMaterial('cereal', false), colza: cropMaterial('colza', false), garden: cropMaterial('garden', false) };
export const CROP_CLUMPS: Record<CropClass, THREE.MeshLambertMaterial> = { cereal: cropMaterial('cereal', true), colza: cropMaterial('colza', true), garden: cropMaterial('garden', true) };

// ------------------------------------------------------------ Herbes folles ----
/** Touffes de la prairie autour de la ferme : mêmes brins que les parcelles à vendre. */
export const MEADOW_GRASS = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
MEADOW_GRASS.onBeforeCompile = GRASS_MAT.onBeforeCompile;
/** Fleurs des champs : elles n'ont lieu qu'au printemps et en été. */
export const MEADOW_FLOWERS = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
MEADOW_FLOWERS.onBeforeCompile = GRASS_MAT.onBeforeCompile;

const SNOW_C = new THREE.Color(0xf7f9fc);

/** À appeler quand la saison avance : a → b au fondu k, avec la teinte d'herbe et la neige du moment. */
export function setNatureSeason(a: number, b: number, k: number, tint: THREE.Color, amt: number, snow: number) {
  const w = (i: number) => (a === i ? 1 - k : 0) + (b === i ? k : 0);
  SEASON.spring = w(0);
  SEASON.summer = w(1);
  SEASON.autumn = w(2);
  SEASON.winter = w(3);
  SEASON.snow = snow;
  TREE_U.uSpring.value = SEASON.spring;
  TREE_U.uAutumn.value = SEASON.autumn;
  TREE_U.uWinter.value = SEASON.winter;
  GROUND_U.uTint.value.copy(tint);
  GROUND_U.uAmt.value = amt;
  GROUND_U.uGSnow.value = snow * 0.88;
  SOIL_U.uSoilSnow.value = snow * 0.72;
  CROP_SHARED.uCropSnow.value = snow * 0.72;
  WATER_U.uFrozen.value = clamp01((snow - 0.08) * 3.2);
  for (const cls of Object.keys(CROP_YEAR) as CropClass[]) {
    const A = CROP_YEAR[cls][a];
    const B = CROP_YEAR[cls][b];
    CROP_U[cls].uGrow.value = A.g + (B.g - A.g) * k;
    CROP_U[cls].uYoung.value = A.y + (B.y - A.y) * k;
    CROP_U[cls].uStraw.value = A.s + (B.s - A.s) * k;
  }
  MEADOW_GRASS.color.setRGB(1, 1, 1).lerp(tint, amt * 0.55).lerp(SNOW_C, snow * 0.6);
  MEADOW_FLOWERS.visible = SEASON.spring + SEASON.summer > 0.4 && snow < 0.1;
}

export const setCropWind = (t: number) => {
  CROP_SHARED.uCropWind.value = t;
};

// -------------------------------------------------------------- Plantation ----
export type Plant = [x: number, z: number, rot: number, scale: number];

const _o = new THREE.Object3D();
const _c = new THREE.Color();
const lod: Array<{ m: THREE.InstancedMesh; near: THREE.BufferGeometry; far: THREE.BufferGeometry }> = [];
/** Herbes, fleurs, épis : ils n'existent à l'écran qu'assez près pour qu'on les voie. */
const details: THREE.Object3D[] = [];
let lodNear = true;
let detailsOn = true;
/** En dessous de ce zoom, les arbres passent au modèle allégé… */
let NEAR_ZOOM = 0.8;
/** … et en dessous de celui-ci, herbes et plantes des champs ne se verraient plus. */
const DETAIL_ZOOM = 0.55;

export const registerDetail = (o: THREE.Object3D) => {
  details.push(o);
  o.visible = detailsOn;
};

/** En qualité réduite, les arbres gardent leur modèle allégé même de près. */
export const setVegetationQuality = (low: boolean) => {
  NEAR_ZOOM = low ? 99 : 0.8;
};

/** Selon le zoom : modèles complets de près, allégés de loin (seuls les blocs à l'écran sont dessinés). */
export function setVegetationZoom(zoom: number) {
  const near = zoom >= NEAR_ZOOM;
  if (near !== lodNear) {
    lodNear = near;
    for (const e of lod) e.m.geometry = near ? e.near : e.far;
  }
  const show = zoom >= DETAIL_ZOOM;
  if (show !== detailsOn) {
    detailsOn = show;
    for (const o of details) o.visible = show;
  }
}

function tintOf(x: number, z: number, spread: number) {
  const r = h3(x, 0, z, 3);
  const g = h3(x, 0, z, 7);
  const k = 1 - spread + r * spread * 2;
  return _c.setRGB(k * (0.97 + (g - 0.5) * spread), k, k * (0.98 - (g - 0.5) * spread));
}

export interface PlantOpts {
  mat?: THREE.Material;
  cast?: boolean;
  receive?: boolean;
  chunk?: number;
  /** Écart de teinte d'une plante à l'autre. */
  spread?: number;
  /** Ne s'affiche que de près. */
  detail?: boolean;
}

/** Plante des instances par blocs (seuls les blocs à l'écran sont dessinés). */
export function plant(scene: THREE.Object3D, near: THREE.BufferGeometry, far: THREE.BufferGeometry | null, items: Plant[], opts: PlantOpts = {}) {
  const { mat = TREE_MAT, cast = false, receive = true, chunk = 40, spread = 0.1, detail = false } = opts;
  const groups = new Map<string, Plant[]>();
  for (const it of items) {
    const key = `${Math.floor(it[0] / chunk)},${Math.floor(it[1] / chunk)}`;
    let arr = groups.get(key);
    if (!arr) groups.set(key, (arr = []));
    arr.push(it);
  }
  for (const list of groups.values()) {
    const im = new THREE.InstancedMesh(lodNear || !far ? near : far, mat, list.length);
    im.castShadow = cast;
    im.receiveShadow = receive;
    list.forEach(([x, z, rot, sc], k) => {
      _o.position.set(x, 0, z);
      _o.rotation.set(0, rot, 0);
      _o.scale.setScalar(sc);
      _o.updateMatrix();
      im.setMatrixAt(k, _o.matrix);
      if (spread > 0) im.setColorAt(k, tintOf(x, z, spread));
    });
    im.computeBoundingSphere();
    scene.add(im);
    if (far) lod.push({ m: im, near, far });
    if (detail) registerDetail(im);
  }
}

// -------------------------------------------------------- Ombres de contact ----
let discTex: THREE.Texture | null = null;
function softDisc() {
  if (discTex) return discTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.55, 'rgba(255,255,255,0.62)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  discTex = new THREE.CanvasTexture(c);
  return discTex;
}
let shadowMat: THREE.MeshBasicMaterial | null = null;

/** Ombre douce au pied de chaque arbre : le paysage reste posé au sol, même hors de la carte d'ombres. */
export function contactShadows(items: Array<[number, number, number]>) {
  shadowMat ??= new THREE.MeshBasicMaterial({ map: softDisc(), color: 0x24331a, transparent: true, opacity: 0.32, depthWrite: false });
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), shadowMat, items.length);
  items.forEach(([x, z, r], k) => {
    _o.position.set(x, 0.056, z);
    _o.rotation.set(0, 0, 0);
    _o.scale.set(r * 2, 1, r * 2);
    _o.updateMatrix();
    im.setMatrixAt(k, _o.matrix);
  });
  im.frustumCulled = false;
  return im;
}

export const SHADOW_RADIUS: Record<Species, number> = { oak: 1.05, lime: 0.92, birch: 0.72, pine: 0.82, poplar: 0.62, apple: 0.78, willow: 1.2, bush: 0.46 };

// ---------------------------------------------------------- Petites pièces ----
/** Roseaux : tige et massette brune. */
export function reed(x: number, z: number, h: number, parts: THREE.BufferGeometry[], lean = 0, head = true) {
  parts.push(cyl(0.008, 0.016, h, 3, 0x6f9d4a, [x, h / 2, z], [lean * 0.5, 0, lean]));
  if (head) parts.push(cyl(0.024, 0.024, 0.13, 4, 0x6b4a2c, [x - lean * h * 0.5, h - 0.02, z + lean * h * 0.25], [lean * 0.5, 0, lean]));
}

/** Petit toit conique en écailles : anneaux empilés, un ton sur deux. */
export function shingledCone(r: number, h: number, y: number, x: number, z: number, a: number, b: number, bands = 4, seg = 10) {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands;
    const t1 = (i + 1) / bands;
    const rb = r * (1 - t0) + 0.02;
    const rt = i === bands - 1 ? 0 : r * (1 - t1) + 0.02 + 0.015;
    if (i === bands - 1) parts.push(cone(rb, h / bands, seg, i % 2 ? a : b, [x, y + (t0 + t1) * 0.5 * h, z]));
    else parts.push(cyl(rt, rb, h / bands, seg, i % 2 ? a : b, [x, y + (t0 + t1) * 0.5 * h, z]));
  }
  return merge(parts);
}
