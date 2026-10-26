// Requêtes en lecture seule sur l'état (capacités, compteurs…).
import { PARCELS } from '../config/balance';
import { BREEDS } from '../config/breeds';
import { BUILDINGS, type BuildingLevel } from '../config/buildings';
import type { BreedId, Building, BuildingType, EggType, GameState, Grade } from './types';
import { GRADE_RANK } from '../config/balance';

export function lvl(b: Building): BuildingLevel {
  const levels = BUILDINGS[b.type].levels;
  return levels[Math.max(0, Math.min(levels.length - 1, b.level - 1))];
}
export function buildingsOf(s: GameState, type: BuildingType) {
  return s.buildings.filter((b) => b.type === type);
}
export function getBuilding(s: GameState, id: number) {
  return s.buildings.find((b) => b.id === id);
}
export function getHen(s: GameState, id: number) {
  return s.hens.find((h) => h.id === id);
}
export function storage(s: GameState) {
  return s.buildings.find((b) => b.type === 'storage');
}
export function stand(s: GameState) {
  return s.buildings.find((b) => b.type === 'stand');
}

/** Nombre de places de poulailler occupées par une poule. */
export function henSlots(_breed: BreedId) {
  return 1;
}
/** Places occupées dans un poulailler : les poussins se blottissent sous les adultes et n'en prennent pas. */
export function coopOccupancy(s: GameState, coopId: number) {
  let n = 0;
  for (const h of s.hens) if (h.coopId === coopId && !h.young) n += henSlots(h.breed);
  return n;
}
/** Volailles adultes (les poussins ne comptent ni dans les poulaillers ni sur le terrain). */
export function adultCount(s: GameState) {
  let n = 0;
  for (const h of s.hens) if (!h.young) n++;
  return n;
}
export function coopCapacity(s: GameState) {
  return buildingsOf(s, 'coop').reduce((a, b) => a + lvl(b).capacity, 0);
}
export function landCapacity(s: GameState) {
  return s.parcels.length * PARCELS.hensPerParcel;
}
/** Capacité effective du troupeau : le minimum entre les poulaillers et le terrain. */
export function flockCapacity(s: GameState) {
  return Math.min(coopCapacity(s), landCapacity(s));
}
/** Poulailler disposant d'une place compatible avec la race (le moins rempli d'abord). */
export function coopFor(s: GameState, breed: BreedId): Building | null {
  const need = BREEDS[breed].reqCoop;
  let best: Building | null = null;
  let bestFree = 0;
  for (const c of buildingsOf(s, 'coop')) {
    if (c.level < need) continue;
    const free = lvl(c).capacity - coopOccupancy(s, c.id);
    if (free >= henSlots(breed) && free > bestFree) {
      best = c;
      bestFree = free;
    }
  }
  return best;
}

export function storageCapacity(s: GameState) {
  const st = storage(s);
  return st ? lvl(st).capacity : 0;
}
export function storedCount(s: GameState, type?: EggType, minGrade?: Grade) {
  let n = 0;
  for (const l of s.lots) {
    if (type && l.type !== type) continue;
    if (minGrade && GRADE_RANK[l.grade] < GRADE_RANK[minGrade]) continue;
    n += l.count;
  }
  return n;
}
export function storageFree(s: GameState) {
  return Math.max(0, storageCapacity(s) - storedCount(s));
}
export function nestEggs(b: Building) {
  return b.eggIds.length;
}
export function nestFree(b: Building) {
  return lvl(b).capacity - b.eggIds.length;
}
export function eggsWaiting(s: GameState) {
  return s.worldEggs.length;
}

export function totalUpkeep(s: GameState) {
  return s.buildings.reduce((a, b) => a + lvl(b).upkeep, 0);
}

export function avgOf<T>(arr: T[], f: (t: T) => number) {
  if (arr.length === 0) return 0;
  let a = 0;
  for (const x of arr) a += f(x);
  return a / arr.length;
}
