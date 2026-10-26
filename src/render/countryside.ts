// La campagne tout autour de la ferme, jusqu'au-delà de ce que la caméra peut montrer : une
// mosaïque de bois, de champs cultivés en rangs, de prés semés d'arbres isolés, de haies et de
// mares. Aucun bord vide : où que l'on regarde, le paysage continue.
// Tout est statique et instancié (quelques appels de rendu pour des milliers d'arbres).
import * as THREE from 'three';
import { GRID_W, GRID_Z0, GRID_Z1, WORLD } from '../config/balance';
import { MAT, box, cyl, ico, merge, mesh } from './geo';
import { bushGeometry, hayBale, pineGeometry, treeGeometry } from './models';

function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
const h2 = (a: number, b: number, k = 0) => hash(a * 73.13 + b * 19.71 + k * 5.31);

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
/** Zones déjà occupées par la ferme, la route, la maison, le village et les champs du nord. */
const RESERVED: Rect[] = [
  { x0: -7.5, x1: GRID_W + 6.5, z0: GRID_Z0 - 7, z1: GRID_Z1 + 1.2 }, // la ferme et sa ceinture d'arbres
  { x0: -12, x1: GRID_W + 8, z0: GRID_Z0 - 17.5, z1: GRID_Z0 - 6 }, // champs et chemin du nord
  { x0: -400, x1: 400, z0: WORLD.ROAD_Z - WORLD.ROAD_HALF - 1.7, z1: WORLD.ROAD_Z + WORLD.ROAD_HALF + 1.7 }, // la route et ses trottoirs
  { x0: -27, x1: GRID_W + 11, z0: GRID_Z1, z1: WORLD.ROAD_Z }, // la place de l'étal, le parking, le trottoir
  { x0: -17.5, x1: -0.5, z0: 1.5, z1: 33 }, // la maison, le moulin, la mare, le potager
  { x0: -23, x1: 65, z0: WORLD.ROAD_Z + 2.6, z1: WORLD.ROAD_Z + 31.1 }, // le village
];
const reserved = (x: number, z: number, m = 0) => RESERVED.some((r) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m);
const rectHitsReserved = (r: Rect) => RESERVED.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.z0 < q.z1 && r.z1 > q.z0);

/** Étendue du paysage : bien au-delà de ce que montre la caméra au zoom le plus éloigné. */
const AREA: Rect = { x0: -170, x1: GRID_W + 170, z0: GRID_Z0 - 150, z1: GRID_Z1 + 150 };
const CELL_W = 19;
const CELL_D = 15;

type Kind = 'forest' | 'wheat' | 'colza' | 'veg' | 'plough' | 'hay' | 'meadow' | 'pond' | 'orchard';
const CROP: Record<'wheat' | 'colza' | 'veg' | 'plough' | 'hay', { soil: number; a: number; b: number; h: number }> = {
  wheat: { soil: 0xc3a676, a: 0xe8c76a, b: 0xdcb85a, h: 0.3 },
  colza: { soil: 0xb7a07a, a: 0xf2d94a, b: 0xe4cc42, h: 0.32 },
  veg: { soil: 0xa88a62, a: 0x7fb35a, b: 0x6ea34c, h: 0.16 },
  plough: { soil: 0x9c7d58, a: 0x8a6c4a, b: 0x7d6142, h: 0.08 },
  hay: { soil: 0xd8cf8e, a: 0xd2c47c, b: 0xc9b96f, h: 0.04 },
};
const MEADOWS = [0xcadf98, 0xc2da8e, 0xd3e3a2, 0xbcd488];

export function buildCountryside(scene: THREE.Scene) {
  const flat: THREE.BufferGeometry[] = [];
  const trees: Array<Array<[number, number, number, number]>> = [[], [], [], []];
  const bushes: Array<[number, number, number]> = [];
  const bales: Array<[number, number, number]> = [];
  const water: THREE.BufferGeometry[] = [];

  const tree = (x: number, z: number, k: number, pine = false) => {
    if (reserved(x, z, 1.2)) return;
    const v = pine ? 3 : Math.floor(h2(x, z, k) * 3);
    trees[v].push([x, z, h2(z, x, k) * 6.28, 0.75 + h2(x, k, z) * 0.6]);
  };

  for (let cz = AREA.z0, j = 0; cz < AREA.z1; cz += CELL_D, j++)
    for (let cx = AREA.x0, i = 0; cx < AREA.x1; cx += CELL_W, i++) {
      // parcelles de tailles inégales : chaque case de la mosaïque est un peu décalée
      const r: Rect = { x0: cx + h2(i, j, 1) * 1.5, x1: cx + CELL_W - h2(i, j, 2) * 1.5, z0: cz + h2(i, j, 3) * 1.2, z1: cz + CELL_D - h2(i, j, 4) * 1.2 };
      const blocked = rectHitsReserved(r);
      const n = h2(i, j, 7);
      // les bois se regroupent : un bruit à grande échelle décide des massifs forestiers
      const woods = Math.sin(i * 0.55 + 1.3) * Math.cos(j * 0.6 - 0.7) + (h2(Math.floor(i / 2), Math.floor(j / 2), 9) - 0.5);
      let kind: Kind = woods > 0.45 ? 'forest' : n < 0.16 ? 'wheat' : n < 0.27 ? 'colza' : n < 0.36 ? 'veg' : n < 0.44 ? 'plough' : n < 0.52 ? 'hay' : n < 0.58 ? 'orchard' : n < 0.62 ? 'pond' : 'meadow';
      // une case qui touche la ferme ou le village reste un pré (on y plante au cas par cas)
      if (blocked && kind !== 'forest') kind = 'meadow';
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      const mx = (r.x0 + r.x1) / 2;
      const mz = (r.z0 + r.z1) / 2;

      if (kind === 'meadow' || kind === 'pond' || kind === 'orchard') {
        // chaque pré à sa hauteur (léger décalage) : là où deux prés se chevauchent, pas de scintillement
        if (!blocked) flat.push(box(w + 1.4, 0.02, d + 1.2, MEADOWS[Math.floor(h2(i, j, 11) * MEADOWS.length)], [mx, 0.004 + ((i + 2 * j) % 4) * 0.004, mz]));
        // quelques arbres isolés et des buissons
        const nt = kind === 'orchard' ? 0 : 2 + Math.floor(h2(i, j, 12) * 4);
        for (let k = 0; k < nt; k++) tree(r.x0 + h2(i, j, 20 + k) * w, r.z0 + h2(i, j, 40 + k) * d, k);
        for (let k = 0; k < 3; k++) {
          const x = r.x0 + h2(i, j, 60 + k) * w;
          const z = r.z0 + h2(i, j, 70 + k) * d;
          if (!reserved(x, z, 0.8)) bushes.push([x, z, h2(k, i, j) * 6]);
        }
      }
      if (kind === 'orchard' && !blocked) {
        // verger : arbres en quinconce
        for (let z = r.z0 + 1.5, a = 0; z < r.z1 - 1; z += 2.6, a++)
          for (let x = r.x0 + 1.5 + (a % 2) * 1.3; x < r.x1 - 1; x += 2.6) trees[1].push([x, z, h2(x, z) * 6, 0.62 + h2(z, x) * 0.15]);
      }
      if (kind === 'pond' && !blocked) {
        const px = mx + (h2(i, j, 13) - 0.5) * 4;
        const pz = mz + (h2(i, j, 14) - 0.5) * 3;
        const sx = 2.6 + h2(i, j, 15) * 2;
        const sz = 1.8 + h2(i, j, 16) * 1.4;
        const bank = new THREE.CircleGeometry(1, 24);
        bank.rotateX(-Math.PI / 2);
        bank.scale(sx + 0.5, 1, sz + 0.5);
        bank.translate(px, 0.035, pz);
        flat.push(paintFlat(bank, 0xcfc09a));
        const pond = new THREE.CircleGeometry(1, 24);
        pond.rotateX(-Math.PI / 2);
        pond.scale(sx, 1, sz);
        pond.translate(px, 0.05, pz);
        water.push(pond);
        // roseaux et saules au bord
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2 + h2(i, k, 2) * 0.3;
          const x = px + Math.cos(a) * (sx + 0.25);
          const z = pz + Math.sin(a) * (sz + 0.25);
          if (k % 3) flat.push(cyl(0.015, 0.02, 0.5 + h2(k, i, 5) * 0.3, 3, 0x6f9d4a, [x, 0.3, z]));
          else flat.push(ico(0.16 + h2(k, j) * 0.1, 0, 0xb9b2a2, [x, 0.08, z], [1, 0.6, 1]));
        }
        for (let k = 0; k < 3; k++) tree(px + (h2(i, j, 80 + k) - 0.5) * (sx * 2 + 5), pz + sz + 1.6 + h2(i, j, 90 + k) * 2, k);
      }
      if (kind === 'forest') {
        // sous-bois sombre, arbres serrés (pins mêlés aux feuillus), lisière irrégulière
        if (!blocked) flat.push(box(w + 1.2, 0.02, d + 1.0, 0xa9c47a, [mx, 0.022, mz]));
        const count = Math.round((w * d) / 6.5);
        for (let k = 0; k < count; k++) {
          const x = r.x0 + h2(i * 7 + k, j, 1) * w;
          const z = r.z0 + h2(i, j * 7 + k, 2) * d;
          tree(x, z, k, h2(k, i + j, 3) < 0.3);
        }
      }
      if (kind === 'wheat' || kind === 'colza' || kind === 'veg' || kind === 'plough' || kind === 'hay') {
        const c = CROP[kind];
        flat.push(box(w, 0.04, d, c.soil, [mx, 0.02, mz]));
        // rangs orientés selon la parcelle (est-ouest ou nord-sud)
        const alongX = h2(i, j, 17) < 0.5;
        const len = (alongX ? w : d) - 0.6;
        const across = alongX ? d : w;
        for (let o = 0.5, k = 0; o < across - 0.3; o += kind === 'hay' ? 1.4 : 0.85, k++) {
          const p: [number, number, number] = alongX ? [mx, c.h / 2 + 0.03, r.z0 + o] : [r.x0 + o, c.h / 2 + 0.03, mz];
          flat.push(box(alongX ? len : 0.45, c.h, alongX ? 0.45 : len, k % 2 ? c.b : c.a, p));
        }
        if (kind === 'hay')
          for (let k = 0; k < 4; k++) bales.push([r.x0 + 1.5 + h2(i, j, 30 + k) * (w - 3), r.z0 + 1.5 + h2(i, j, 34 + k) * (d - 3), h2(k, j) * 6]);
        // haie le long d'un côté du champ
        if (h2(i, j, 18) < 0.6) {
          const south = h2(i, j, 19) < 0.5;
          for (let x = r.x0; x < r.x1; x += 1.1) {
            const z = south ? r.z1 + 0.4 : r.z0 - 0.4;
            if (!reserved(x, z, 0.6)) bushes.push([x + h2(x, z) * 0.3, z, h2(z, x) * 6]);
          }
        }
      }
    }

  // sol de la campagne : prés, sous-bois, champs (une seule géométrie)
  const flatMesh = mesh(merge(flat), false, true);
  scene.add(flatMesh);
  if (water.length) {
    const wm = new THREE.Mesh(merge(water.map((g) => paintFlat(g, 0x86c7e6))), new THREE.MeshLambertMaterial({ vertexColors: true }));
    wm.receiveShadow = true;
    scene.add(wm);
  }

  // arbres : instanciés par essence et par bloc de 40 × 40 (seuls les blocs à l'écran sont dessinés),
  // sans ombre portée (trop loin pour la carte d'ombres)
  const geos = [treeGeometry(0), treeGeometry(1), treeGeometry(2), pineGeometry()];
  const tmp = new THREE.Object3D();
  const CHUNK = 40;
  const chunked = (g: THREE.BufferGeometry, list: Array<[number, number, number, number]>) => {
    const groups = new Map<string, Array<[number, number, number, number]>>();
    for (const it of list) {
      const key = `${Math.floor(it[0] / CHUNK)},${Math.floor(it[1] / CHUNK)}`;
      let arr = groups.get(key);
      if (!arr) groups.set(key, (arr = []));
      arr.push(it);
    }
    for (const items of groups.values()) {
      const im = new THREE.InstancedMesh(g, MAT, items.length);
      im.receiveShadow = true;
      items.forEach(([x, z, rot, sc], k) => {
        tmp.position.set(x, 0, z);
        tmp.rotation.set(0, rot, 0);
        tmp.scale.setScalar(sc);
        tmp.updateMatrix();
        im.setMatrixAt(k, tmp.matrix);
      });
      im.computeBoundingSphere();
      scene.add(im);
    }
  };
  geos.forEach((g, v) => chunked(g, trees[v]));
  const instanced = (g: THREE.BufferGeometry, list: Array<[number, number, number]>, scale: (k: number) => number) =>
    chunked(g, list.map(([x, z, rot], k) => [x, z, rot, scale(k)] as [number, number, number, number]));
  instanced(bushGeometry(), bushes, (k) => 0.7 + hash(k * 3.3) * 0.6);
  instanced(hayBale(), bales, () => 1);
  return { trees: trees.reduce((a, l) => a + l.length, 0), bushes: bushes.length };
}

/** Géométrie plate (cercle) mise au format des autres pièces : sans uv, avec une couleur. */
function paintFlat(g: THREE.BufferGeometry, color: number) {
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = out.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) arr.set([c.r, c.g, c.b], k * 3);
  out.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return out;
}
