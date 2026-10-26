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

/** Boîte centrée en p. */
export const box = (w: number, h: number, d: number, color: number, p: V3, r?: V3) =>
  finalize(new THREE.BoxGeometry(w, h, d), color, p, r);

/** Cylindre (ou cône si rt=0) centré en p. */
export const cyl = (rt: number, rb: number, h: number, seg: number, color: number, p: V3, r?: V3, s?: V3) =>
  finalize(new THREE.CylinderGeometry(rt, rb, h, seg), color, p, r, s);

export const sph = (rad: number, ws: number, hs: number, color: number, p: V3, s?: V3, r?: V3) =>
  finalize(new THREE.SphereGeometry(rad, ws, hs), color, p, r, s);

export const ico = (rad: number, detail: number, color: number, p: V3, s?: V3, r?: V3) =>
  finalize(new THREE.IcosahedronGeometry(rad, detail), color, p, r, s);

export const cone = (rad: number, h: number, seg: number, color: number, p: V3, r?: V3) =>
  finalize(new THREE.ConeGeometry(rad, h, seg), color, p, r);

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
