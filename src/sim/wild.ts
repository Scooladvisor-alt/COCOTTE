// La nature sauvage des parcelles : leurs bosquets et leurs buissons, toujours aux mêmes endroits. Tant
// que la parcelle est à vendre, ils ne sont que du décor ; à l'achat, ils restent et deviennent de vrais
// éléments de la ferme : les arbres profitent aux poules comme un arbre acheté, et on peut les enlever.
import { GRID_W, GRID_Z0, GRID_Z1, WORLD, inTruckBay } from '../config/balance';
import { parcelCenter } from './core';

function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export interface WildPlant {
  kind: 'tree' | 'bush';
  /** Essence (pour le rendu) : chêne, tilleul, bouleau, pin. */
  sp: number;
  x: number;
  z: number;
  sc: number;
}

/** Ce qui pousse sur cette parcelle (au plus une plante par case, jamais sur la place du camion). */
export function wildPlants(c: number, r: number): WildPlant[] {
  const [ox, oz] = parcelCenter(c, r);
  const P = WORLD.PARCEL;
  const out: WildPlant[] = [];
  const taken = new Set<number>();
  const add = (kind: WildPlant['kind'], sp: number, x: number, z: number, sc: number) => {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const k = cx * 1000 + cz;
    if (taken.has(k) || inTruckBay(cx, cz)) return;
    taken.add(k);
    out.push({ kind, sp, x, z, sc });
  };
  const copses = 1 + Math.floor(hash(c * 31 + r * 7) * 2);
  for (let k = 0; k < copses; k++) {
    const bx = ox + (hash(c * 13 + r * 5 + k * 3) - 0.5) * (P - 6);
    const bz = oz + (hash(c * 17 + r * 11 + k * 7) - 0.5) * (P - 6);
    // l'écriteau « À vendre » reste dégagé, au centre
    if (Math.hypot(bx - ox, bz - oz) < 3) continue;
    const n = 4 + Math.floor(hash(c + r * 9 + k) * 5);
    for (let t = 0; t < n; t++) {
      const a = hash(c * 3 + r * 29 + k * 11 + t) * 6.28;
      const d = Math.sqrt(hash(c * 7 + r * 3 + k + t * 13)) * 2.4;
      const sp = hash(t * 5 + k + c) < 0.25 ? 3 : Math.floor(hash(t + r * 3 + k) * 3);
      add('tree', sp, bx + Math.cos(a) * d, bz + Math.sin(a) * d, (0.7 + hash(t * 9 + c) * 0.5) * 1.1);
    }
  }
  for (let k = 0; k < 7; k++) {
    const x = ox + (hash(c * 41 + r * 3 + k) - 0.5) * (P - 2);
    const z = oz + (hash(c * 43 + r * 19 + k) - 0.5) * (P - 2);
    add('bush', 0, x, z, 0.7 + hash(x * 2 + z) * 0.6);
  }
  return out;
}

/**
 * Les arbres plantés autour du domaine, au nord, à l'est et le long des maisons du village (le rendu les
 * dessine, le chien les contourne).
 */
export function ringTrees(): Array<[number, number, number]> {
  const spots: Array<[number, number, number]> = [];
  let k = 0;
  for (let x = -12; x <= GRID_W + 12; x += 3.1) {
    spots.push([x + hash(k++) * 1.5, GRID_Z0 - 3.2 - hash(k++) * 3, k]);
    // alignement d'arbres côté village, entre le trottoir et les maisons (sauf la ruelle et l'abribus)
    const tx = x + hash(k++) * 1.2;
    const tz = WORLD.ROAD_Z + WORLD.ROAD_HALF + 1.7 + hash(k++) * 2.2;
    if (Math.abs(tx - 20) > 2.2 && Math.abs(tx - 5) > 2.2) spots.push([tx, tz, k]);
  }
  for (let z = GRID_Z0 - 2; z <= GRID_Z1 + 1; z += 3.3) {
    spots.push([GRID_W + 3 + hash(k++) * 2.5, z + hash(k++), k]);
    if (z < 17) spots.push([-3.2 - hash(k++) * 3, z + hash(k++), k]);
  }
  return spots;
}
