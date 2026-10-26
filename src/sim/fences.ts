// Clôture de la ferme : un grillage posé d'office tout autour du terrain possédé, portail côté
// route. Il suit automatiquement les parcelles achetées.
// Une arête est codée par un entier : horizontale (ligne z) → hIdx ≥ 0 ; verticale → -(vIdx + 1).
import { GRID_W, GRID_Z0, GRID_Z1 } from '../config/balance';
import { GATE, hIdx, invalidateLayout, isOwnedCell, rt, setFence, vIdx } from './core';
import type { GameState } from './types';

export const hCode = (x: number, z: number) => hIdx(x, z);
export const vCode = (x: number, z: number) => -(vIdx(x, z) + 1);

/** Les deux cases séparées par une arête (l'une peut être hors de la grille). */
export function edgeCells(code: number): [[number, number], [number, number]] {
  if (code >= 0) {
    const x = code % GRID_W;
    const z = Math.floor(code / GRID_W) + GRID_Z0;
    return [
      [x, z - 1],
      [x, z],
    ];
  }
  const i = -code - 1;
  const x = i % (GRID_W + 1);
  const z = Math.floor(i / (GRID_W + 1)) + GRID_Z0;
  return [
    [x - 1, z],
    [x, z],
  ];
}

/** Extrémités (sommets de la grille) d'une arête, pour le rendu. */
export function edgeEnds(code: number): [number, number, number, number] {
  if (code >= 0) {
    const x = code % GRID_W;
    const z = Math.floor(code / GRID_W) + GRID_Z0;
    return [x, z, x + 1, z];
  }
  const i = -code - 1;
  const x = i % (GRID_W + 1);
  const z = Math.floor(i / (GRID_W + 1)) + GRID_Z0;
  return [x, z, x, z + 1];
}

/** Toutes les arêtes portant une clôture (pour le rendu et les écriteaux). */
export function fencedEdges(s: GameState) {
  const out: Array<{ code: number; v: number }> = [];
  s.fenceH.forEach((v, i) => v && out.push({ code: i, v }));
  s.fenceV.forEach((v, i) => v && out.push({ code: -(i + 1), v }));
  return out;
}

/** Arête du portail d'entrée (côté route, sous la case d'entrée). */
export const GATE_EDGE = hCode(GATE.x, GATE.z + 1);

/** Contour du terrain possédé (arêtes entre une case possédée et une case qui ne l'est pas). */
export function perimeter(s: GameState) {
  const out: number[] = [];
  for (let z = GRID_Z0; z < GRID_Z1; z++)
    for (let x = 0; x < GRID_W; x++) {
      if (!isOwnedCell(s, x, z)) continue;
      if (!isOwnedCell(s, x, z - 1)) out.push(hCode(x, z));
      if (!isOwnedCell(s, x, z + 1)) out.push(hCode(x, z + 1));
      if (!isOwnedCell(s, x - 1, z)) out.push(vCode(x, z));
      if (!isOwnedCell(s, x + 1, z)) out.push(vCode(x + 1, z));
    }
  return out;
}

/**
 * La ferme est toujours clôturée : grillage tout autour du terrain possédé, portail côté route.
 * Recalculée à chaque achat de parcelle (rien à acheter ni à poser pour le joueur).
 */
export function autoEnclose(s: GameState) {
  s.fenceH.fill(0);
  s.fenceV.fill(0);
  for (const c of perimeter(s)) setFence(s, c, c === GATE_EDGE ? 3 : 1);
  invalidateLayout(s);
}

/** Toute la partie praticable du terrain possédé est-elle à l'abri des fugues ? */
export function farmEnclosed(s: GameState) {
  const r = rt(s);
  for (let i = 0; i < r.open.length; i++) if (r.open[i] && r.owned[i] && r.walk[i]) return false;
  return true;
}
