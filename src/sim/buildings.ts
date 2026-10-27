// Bâtiments : validation de placement, remplissages automatiques, encrassement.
import { COOP_HYGIENE, GRID_H, GRID_W, NATURE, TIME } from '../config/balance';
import { seasonIndex } from './seasons';
import { BUILDINGS, sizeOf } from '../config/buildings';
import { GATE, accessCells, cellIndex, cellX, cellZ, coopDoorCells, fenceValue, hIdx, inGrid, invalidateLayout, isOwnedCell, rt, vIdx } from './core';
import { coopOccupancy, lvl } from './queries';
import { takeGrain, takeWater } from './stocks';
import type { Building, BuildingType, GameState } from './types';

export interface PlaceCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Vérifie qu'un bâtiment peut être posé en (x,z) : sur des cases possédées et libres,
 * sans bloquer l'entrée ni l'accès aux autres installations.
 */
export function canPlace(s: GameState, type: BuildingType, x: number, z: number, ignoreId = -1, level = 1): PlaceCheck {
  const def = { ...BUILDINGS[type], ...sizeOf(type, level) };
  const r = rt(s);
  const fp = new Set<number>();
  for (let j = 0; j < def.d; j++)
    for (let i = 0; i < def.w; i++) {
      const cx = x + i;
      const cz = z + j;
      if (!inGrid(cx, cz) || !isOwnedCell(s, cx, cz)) return { ok: false, reason: 'Hors de votre terrain' };
      const occ = r.occupant[cellIndex(cx, cz)];
      if (occ >= 0 && occ !== ignoreId) return { ok: false, reason: 'Emplacement occupé' };
      if (cx === GATE.x && cz === GATE.z) return { ok: false, reason: 'Laissez l’entrée libre' };
      fp.add(cellIndex(cx, cz));
    }
  // pas de grillage au travers de l'emprise
  for (let j = 0; j < def.d; j++)
    for (let i = 0; i < def.w; i++) {
      if (j > 0 && fenceValue(s, hIdx(x + i, z + j))) return { ok: false, reason: 'Du grillage traverse l’emplacement' };
      if (i > 0 && fenceValue(s, -(vIdx(x + i, z + j) + 1))) return { ok: false, reason: 'Du grillage traverse l’emplacement' };
    }
  // la porte de chaque poulailler et l'avant de chaque pondoir doivent rester dégagés
  for (const b of s.buildings) {
    if (b.id === ignoreId) continue;
    if (b.type === 'coop' && coopDoorCells(b).some(([cx, cz]) => fp.has(cellIndex(cx, cz)))) return { ok: false, reason: 'Devant la porte d’un poulailler' };
    if (b.type === 'nest')
      for (let i = 0; i < BUILDINGS.nest.w; i++)
        if (fp.has(cellIndex(b.x + i, b.z + BUILDINGS.nest.d))) return { ok: false, reason: 'Devant un pondoir' };
  }

  // grille praticable hypothétique
  const walk = new Uint8Array(r.owned);
  for (const b of s.buildings) {
    if (b.id === ignoreId || b.type === 'stand') continue;
    const d = sizeOf(b.type, b.level);
    for (let j = 0; j < d.d; j++) for (let i = 0; i < d.w; i++) if (inGrid(b.x + i, b.z + j)) walk[cellIndex(b.x + i, b.z + j)] = 0;
  }
  for (const i of fp) walk[i] = 0;

  // l'accès du nouveau bâtiment doit exister
  const ownAccess = accessCells({ type, x, z, level }).filter(([ax, az]) => walk[cellIndex(ax, az)]);
  if (def.access !== 'none' && ownAccess.length === 0) return { ok: false, reason: 'Accès bloqué' };
  if (type === 'nest' && ownAccess.length < def.w) return { ok: false, reason: 'L’avant du pondoir doit rester libre' };
  if (type === 'coop' && coopDoorCells({ x, z }).some(([cx, cz]) => inGrid(cx, cz) && !walk[cellIndex(cx, cz)])) return { ok: false, reason: 'La porte doit rester dégagée' };

  // connexité : toutes les installations doivent rester accessibles depuis l'entrée
  const seen = new Uint8Array(GRID_W * GRID_H);
  const q: number[] = [];
  const g = cellIndex(GATE.x, GATE.z);
  if (!walk[g]) return { ok: false, reason: 'Laissez l’entrée libre' };
  seen[g] = 1;
  q.push(g);
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const cx = cellX(i);
    const cz = cellZ(i);
    const nb = [
      [cx + 1, cz],
      [cx - 1, cz],
      [cx, cz + 1],
      [cx, cz - 1],
    ];
    for (const [nx, nz] of nb) {
      if (!inGrid(nx, nz)) continue;
      const ni = cellIndex(nx, nz);
      if (walk[ni] && !seen[ni]) {
        seen[ni] = 1;
        q.push(ni);
      }
    }
  }
  const check = (bt: BuildingType, bx: number, bz: number, bl: number) => {
    if (BUILDINGS[bt].access === 'none') return true;
    return accessCells({ type: bt, x: bx, z: bz, level: bl }).some(([ax, az]) => seen[cellIndex(ax, az)]);
  };
  if (!check(type, x, z, level)) return { ok: false, reason: 'Inaccessible pour les poules' };
  for (const b of s.buildings) {
    if (b.id === ignoreId || b.type === 'stand') continue;
    if (!check(b.type, b.x, b.z, b.level)) return { ok: false, reason: `Bloquerait l’accès : ${BUILDINGS[b.type].name.toLowerCase()}` };
  }
  return { ok: true };
}

/** Remplissage automatique (trémies, abreuvoirs raccordés). */
export function autoRefill(s: GameState) {
  for (const b of s.buildings) {
    if (b.type !== 'feeder' && b.type !== 'drinker') continue;
    const L = lvl(b);
    if (!L.auto) continue;
    const missing = L.capacity - b.stock;
    if (missing <= 0.01) continue;
    if (b.type === 'feeder') b.stock += takeGrain(s, missing);
    else b.stock += takeWater(s, missing);
  }
}

/** Le compost se repeuple de vers et d'insectes ; la pluie remplit les mares (selon la saison). */
export function compostTick(s: GameState, dt: number) {
  const rain = NATURE.rainBySeason[seasonIndex(s)];
  for (const b of s.buildings) {
    if (b.type !== 'compost' && b.type !== 'pond') continue;
    const L = lvl(b);
    const k = b.type === 'pond' ? rain : 1;
    b.stock = Math.min(L.capacity, b.stock + ((L.regen ?? 0) * k * dt) / TIME.DAY);
  }
}

/**
 * Anciennes parties : les poulaillers mesuraient 3 × 2 cases, ils en mesurent 6 × 4. Chacun est
 * reposé là où il tient, au plus près de sa place (trappe au même endroit si possible).
 */
export function refitCoops(s: GameState) {
  const { w, d } = BUILDINGS.coop;
  for (const b of s.buildings) {
    if (b.type !== 'coop') continue;
    invalidateLayout(s);
    // trappe de l'ancien modèle : milieu de la façade de 3 × 2
    const doorX = b.x + 1.5;
    const front = b.z + 2;
    const x0 = Math.round(doorX - w / 2);
    const z0 = front - d;
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let dz = -12; dz <= 12; dz++)
      for (let dx = -14; dx <= 14; dx++) {
        const dist = Math.hypot(dx, dz * 1.2);
        if (dist >= bd) continue;
        if (canPlace(s, 'coop', x0 + dx, z0 + dz, b.id).ok) {
          bd = dist;
          best = [x0 + dx, z0 + dz];
        }
      }
    if (best) [b.x, b.z] = best;
  }
  invalidateLayout(s);
}

/** Anciennes parties : la réserve à œufs passe de 2 × 2 à 4 × 4 cases, reposée au plus près. */
export function refitStorage(s: GameState) {
  const { w, d } = BUILDINGS.storage;
  for (const b of s.buildings) {
    if (b.type !== 'storage') continue;
    invalidateLayout(s);
    const x0 = Math.round(b.x + 1 - w / 2);
    const z0 = Math.round(b.z + 1 - d / 2);
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let dz = -12; dz <= 12; dz++)
      for (let dx = -14; dx <= 14; dx++) {
        const dist = Math.hypot(dx, dz);
        if (dist >= bd) continue;
        if (canPlace(s, 'storage', x0 + dx, z0 + dz, b.id).ok) {
          bd = dist;
          best = [x0 + dx, z0 + dz];
        }
      }
    if (best) [b.x, b.z] = best;
  }
  invalidateLayout(s);
}

export function coopDirt(s: GameState, dt: number) {
  const dtDay = dt / TIME.DAY;
  for (const b of s.buildings) {
    if (b.type !== 'coop') continue;
    const L = lvl(b);
    const occ = coopOccupancy(s, b.id) / Math.max(1, L.capacity);
    b.cleanliness = Math.max(0, b.cleanliness - COOP_HYGIENE.dirtPerDay * occ * (L.dirtFactor ?? 1) * dtDay);
  }
}

export function cleaningCost(b: Building) {
  return COOP_HYGIENE.cleanBase + COOP_HYGIENE.cleanPerSlot * lvl(b).capacity;
}

export function countOfType(s: GameState, type: BuildingType) {
  return s.buildings.filter((b) => b.type === type).length;
}
