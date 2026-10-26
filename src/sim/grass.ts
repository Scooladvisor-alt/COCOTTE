// L'herbe : ressource alimentaire naturelle qui s'épuise sous le picorage et repousse lentement.
import { GRASS, WORLD, clamp } from '../config/balance';
import { cellIndex, inGrid, parcelCoords, parcelOrigin, rt } from './core';
import type { GameState } from './types';
import { season } from './seasons';

/** Repousse logistique : lente sur sol nu, plus rapide quand l'herbe est à mi-hauteur. */
export function regrowGrass(s: GameState, dtDays: number) {
  dtDays *= season(s).grass; // vite au printemps, presque rien en hiver
  const r = rt(s);
  const g = s.grass;
  for (let i = 0; i < g.length; i++) {
    if (!r.owned[i]) continue;
    const v = g[i];
    if (v >= 1) continue;
    g[i] = Math.min(1, v + (GRASS.regrowBase + GRASS.regrowLogistic * v * (1 - v)) * dtDays);
  }
}

/** Herbe sous une position (0 si hors terrain ou sous un bâtiment). */
export function grassAt(s: GameState, x: number, z: number) {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (!inGrid(cx, cz)) return 0;
  return s.grass[cellIndex(cx, cz)];
}

/** Consomme de l'herbe et renvoie les points de satiété réellement obtenus. */
export function eatGrass(s: GameState, x: number, z: number, wanted: number, pointsPerUnit: number) {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (!inGrid(cx, cz)) return 0;
  const i = cellIndex(cx, cz);
  const available = s.grass[i] * pointsPerUnit;
  const got = Math.max(0, Math.min(wanted, available));
  s.grass[i] = clamp(s.grass[i] - got / pointsPerUnit, 0, 1);
  return got;
}

export function parcelGrass(s: GameState, key: string) {
  const [c, r] = parcelCoords(key);
  const P = WORLD.PARCEL;
  const [x0, z0] = parcelOrigin(c, r);
  const run = rt(s);
  let sum = 0;
  let n = 0;
  for (let z = z0; z < z0 + P; z++)
    for (let x = x0; x < x0 + P; x++) {
      const i = cellIndex(x, z);
      if (run.blocked[i]) continue;
      sum += s.grass[i];
      n++;
    }
  return n ? sum / n : 0;
}

export function farmGrass(s: GameState) {
  const r = rt(s);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < s.grass.length; i++) {
    if (!r.walk[i]) continue;
    sum += s.grass[i];
    n++;
  }
  return n ? sum / n : 0;
}

/** Ressemis d'une parcelle : relance immédiate de l'herbe. */
export function reseedParcel(s: GameState, key: string) {
  const [c, r] = parcelCoords(key);
  const P = WORLD.PARCEL;
  const [x0, z0] = parcelOrigin(c, r);
  for (let z = z0; z < z0 + P; z++)
    for (let x = x0; x < x0 + P; x++) {
      const i = cellIndex(x, z);
      s.grass[i] = Math.min(1, s.grass[i] + GRASS.reseedBoost);
    }
}
