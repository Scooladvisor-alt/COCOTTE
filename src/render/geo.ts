// Petite boîte à outils de géométrie low-poly : primitives colorées (couleurs de sommets)
// fusionnées en un seul maillage pour limiter les appels de rendu.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type V3 = [number, number, number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function finalize(geo: THREE.BufferGeometry, color: number, p: V3, r: V3 = [0, 0, 0], s: V3 = [1, 1, 1]) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.clearGroups();
  g.deleteAttribute('uv');
  _e.set(r[0], r[1], r[2]);
  _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(...p), _q, new THREE.Vector3(...s));
  g.applyMatrix4(_m);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g = g as THREE.BufferGeometry;
  return g;
}

export const finalizeExport = finalize;

// Les primitives partent de modèles unitaires gardés en mémoire : le monde en compte des dizaines de
// milliers, et les recréer une à une avec three.js coûtait l'essentiel du temps de chargement.
interface Tpl {
  pos: Float32Array;
  nor: Float32Array;
}
const templates = new Map<string, Tpl>();
function template(key: string, make: () => THREE.BufferGeometry) {
  let t = templates.get(key);
  if (!t) {
    const g0 = make();
    const g = g0.index ? g0.toNonIndexed() : g0;
    t = { pos: g.attributes.position.array as Float32Array, nor: g.attributes.normal.array as Float32Array };
    templates.set(key, t);
    g.dispose();
    if (g !== g0) g0.dispose();
  }
  return t;
}
const _nm = new THREE.Matrix3();
const _tp = new THREE.Vector3();
const _ts = new THREE.Vector3();
const _c = new THREE.Color();

/** Copie un modèle unitaire : mise à l'échelle (sx, sy, sz), rotation r, puis position p. */
function stamp(t: Tpl, color: number, p: V3, r: V3 | undefined, sx: number, sy: number, sz: number) {
  const src = t.pos;
  const srn = t.nor;
  const count = src.length;
  const pos = new Float32Array(count);
  const nor = new Float32Array(count);
  const col = new Float32Array(count);
  _c.set(color);
  const cr = _c.r;
  const cg = _c.g;
  const cb = _c.b;
  if (r) _e.set(r[0], r[1], r[2]);
  else _e.set(0, 0, 0);
  _q.setFromEuler(_e);
  _m.compose(_tp.set(p[0], p[1], p[2]), _q, _ts.set(sx, sy, sz));
  _nm.getNormalMatrix(_m);
  const e = _m.elements;
  const n = _nm.elements;
  for (let i = 0; i < count; i += 3) {
    const x = src[i];
    const y = src[i + 1];
    const z = src[i + 2];
    pos[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    pos[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    pos[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    const a = srn[i];
    const b = srn[i + 1];
    const c = srn[i + 2];
    const nx = n[0] * a + n[3] * b + n[6] * c;
    const ny = n[1] * a + n[4] * b + n[7] * c;
    const nz = n[2] * a + n[5] * b + n[8] * c;
    const l = Math.hypot(nx, ny, nz) || 1;
    nor[i] = nx / l;
    nor[i + 1] = ny / l;
    nor[i + 2] = nz / l;
    col[i] = cr;
    col[i + 1] = cg;
    col[i + 2] = cb;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Boîte centrée en p. */
export const box = (w: number, h: number, d: number, color: number, p: V3, r?: V3) => stamp(template('b', () => new THREE.BoxGeometry(1, 1, 1)), color, p, r, w, h, d);

/** Cylindre (ou cône si rt=0) centré en p. */
export function cyl(rt: number, rb: number, h: number, seg: number, color: number, p: V3, r?: V3, s?: V3) {
  const big = Math.max(rt, rb) || 1;
  const a = Math.round((rt / big) * 500) / 500;
  const b = Math.round((rb / big) * 500) / 500;
  const t = template(`c${seg}:${a}:${b}`, () => new THREE.CylinderGeometry(a, b, 1, seg));
  return stamp(t, color, p, r, big * (s ? s[0] : 1), h * (s ? s[1] : 1), big * (s ? s[2] : 1));
}

export function sph(rad: number, ws: number, hs: number, color: number, p: V3, s?: V3, r?: V3) {
  return stamp(template(`s${ws}:${hs}`, () => new THREE.SphereGeometry(1, ws, hs)), color, p, r, rad * (s ? s[0] : 1), rad * (s ? s[1] : 1), rad * (s ? s[2] : 1));
}

export function ico(rad: number, detail: number, color: number, p: V3, s?: V3, r?: V3) {
  return stamp(template(`i${detail}`, () => new THREE.IcosahedronGeometry(1, detail)), color, p, r, rad * (s ? s[0] : 1), rad * (s ? s[1] : 1), rad * (s ? s[2] : 1));
}

export function cone(rad: number, h: number, seg: number, color: number, p: V3, r?: V3) {
  return stamp(template(`k${seg}`, () => new THREE.ConeGeometry(1, 1, seg)), color, p, r, rad, h, rad);
}

/** Prisme triangulaire (toit à deux pans) : longueur w le long de x, largeur d, hauteur h, base en p.y. */
export function prism(w: number, h: number, d: number, color: number, p: V3, ry = 0) {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(0, h);
  shape.lineTo(-d / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2 + ry);
  return finalize(g, color, p);
}

export function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/**
 * Fusionne un grand ensemble de pièces par secteurs de `cell` mètres : seuls les secteurs à l'écran
 * sont dessinés. Les très grandes pièces (routes, sols) restent dans un secteur à part.
 */
export function mergeChunks(parts: THREE.BufferGeometry[], cell: number) {
  const groups = new Map<string, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const a = p.attributes.position.array as ArrayLike<number>;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < x0) x0 = a[i];
      if (a[i] > x1) x1 = a[i];
      if (a[i + 2] < z0) z0 = a[i + 2];
      if (a[i + 2] > z1) z1 = a[i + 2];
    }
    const key = x1 - x0 > cell || z1 - z0 > cell ? 'big' : `${Math.floor((x0 + x1) / 2 / cell)},${Math.floor((z0 + z1) / 2 / cell)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(p);
  }
  return [...groups.values()].map(merge);
}

export const MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
/** Animaux et personnages : même rendu que MAT, mais jamais couverts de neige. */
export const CREATURE_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/**
 * Neige sur le décor (0..1) : les faces tournées vers le ciel et en hauteur (toits, haut des
 * poteaux, cimes des arbres) blanchissent avec la neige au sol. Réglée chaque image par le rendu.
 */
export const SNOW_UNIFORM = { value: 0 };
MAT.onBeforeCompile = (shader) => {
  shader.uniforms.uSnow = SNOW_UNIFORM;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying float vSnowUp;\nvarying float vSnowY;')
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vec3 snowN = objectNormal;
      vec4 snowP = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        snowN = mat3( instanceMatrix ) * snowN;
        snowP = instanceMatrix * snowP;
      #endif
      vSnowUp = normalize( mat3( modelMatrix ) * snowN ).y;
      vSnowY = ( modelMatrix * snowP ).y;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uSnow;\nvarying float vSnowUp;\nvarying float vSnowY;')
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      // les toits passent franchement au blanc (pas de teinte rosée à mi-chemin)
      float snowK = smoothstep( 0.12, 0.4, uSnow ) * 0.92 * smoothstep( 0.45, 0.8, vSnowUp ) * smoothstep( 0.5, 0.75, vSnowY );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95, 0.965, 0.985 ), snowK );`,
    );
};
/**
 * Herbe et fleurs : les brins ondulent au vent (plus le haut du brin est haut, plus il bouge),
 * avec un décalage selon la position de chaque touffe pour que la prairie ondoie par vagues.
 */
export const GRASS_WIND = { value: 0 };
export const GRASS_MAT = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
GRASS_MAT.onBeforeCompile = (shader) => {
  shader.uniforms.uWind = GRASS_WIND;
  // brins vus des deux côtés, mais toujours éclairés comme vus de dessus (pas de revers sombre)
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize( vNormal );');
  shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;').replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    #ifdef USE_INSTANCING
      vec3 tuftPos = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
    #else
      vec3 tuftPos = vec3( 0.0 );
    #endif
    float bladeH = max( position.y, 0.0 );
    float gust = 0.6 + 0.4 * sin( uWind * 0.35 + tuftPos.x * 0.08 );
    float sway = ( sin( uWind * 1.7 + tuftPos.x * 0.55 + tuftPos.z * 0.35 ) * 0.65 + sin( uWind * 2.9 + tuftPos.x * 1.3 - tuftPos.z * 0.8 ) * 0.25 ) * gust;
    transformed.x += sway * bladeH * bladeH * 2.2;
    transformed.z += sway * bladeH * bladeH * 1.1;`,
  );
};

/** Matériau des fenêtres : s'illumine la nuit. */
export const GLOW = new THREE.MeshBasicMaterial({ color: 0xbfe3ff });

export function mesh(geo: THREE.BufferGeometry, cast = true, receive = true, mat: THREE.Material = MAT) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// Palette inspirée de la référence (pastels chauds, bois, bleu vif d'accent)
export const C = {
  wood: 0xd39a5c,
  woodDark: 0xa86f3c,
  woodLight: 0xe8c08a,
  plank: 0xc4874c,
  roof: 0xc0573f,
  roofDark: 0x9c4433,
  white: 0xf6f2ea,
  cream: 0xefe5d0,
  grey: 0xc9ccd1,
  greyDark: 0x8e939b,
  steel: 0xb7c0c7,
  blue: 0x2f6bff,
  blueSoft: 0x7fa6ff,
  water: 0x7cc7ee,
  straw: 0xebcf72,
  grain: 0xe2b752,
  sand: 0xe8d4a4,
  leaf: 0x9ccf7e,
  leafDark: 0x84bf6c,
  trunk: 0x9b7653,
  red: 0xe0412f,
  orange: 0xf0a33a,
  black: 0x2b2b31,
  glass: 0xbfe3ff,
};

/** Déforme les sommets d'une géométrie (silhouettes organiques). */
export function deform(geo: THREE.BufferGeometry, fn: (v: THREE.Vector3) => void) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    fn(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Plume : cône aplati, orienté par une rotation, de couleur unie. */
export function feather(len: number, width: number, color: number, p: V3, r: V3) {
  const g = finalizeExport(new THREE.ConeGeometry(width, len, 4), color, [0, 0, 0], [0, 0, 0], [1, 1, 0.32]);
  g.translate(0, len / 2, 0);
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0], r[1], r[2]));
  g.applyMatrix4(m);
  g.translate(p[0], p[1], p[2]);
  return g;
}
