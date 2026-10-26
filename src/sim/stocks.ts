// Stocks de consommables : réserve à grain et cuve d'eau. Toute sortie de stock passe ici
// (mangeoires, abreuvoirs, commis…) pour mesurer la consommation et l'autonomie restante.
import { GRAIN_BINS, NEEDS, WATER_TANKS } from '../config/balance';
import { BREEDS } from '../config/breeds';
import { currentDay } from './core';
import type { GameState } from './types';

export function grainBinDef(s: GameState) {
  return GRAIN_BINS[Math.max(0, Math.min(GRAIN_BINS.length - 1, s.grainBin - 1))];
}
export function waterTankDef(s: GameState) {
  return WATER_TANKS[Math.max(0, Math.min(WATER_TANKS.length - 1, s.waterTank - 1))];
}
export const grainCapacity = (s: GameState) => grainBinDef(s).capacity;
export const waterCapacity = (s: GameState) => waterTankDef(s).capacity;

function roll(s: GameState) {
  const day = currentDay(s);
  if (s.usage.day === day) return;
  // nouvelle journée : la consommation d'hier sert de référence
  s.usage.lastGrain = s.usage.day === day - 1 ? s.usage.grain : -1;
  s.usage.lastWater = s.usage.day === day - 1 ? s.usage.water : -1;
  s.usage.grain = 0;
  s.usage.water = 0;
  s.usage.day = day;
}

/** Prélève du grain dans la réserve ; renvoie la quantité réellement prise. */
export function takeGrain(s: GameState, wanted: number) {
  const n = Math.max(0, Math.min(wanted, s.grain));
  if (n > 0) s.grain -= n;
  return n;
}

/** Prélève de l'eau dans la cuve ; renvoie la quantité réellement prise. */
export function takeWater(s: GameState, wanted: number) {
  const n = Math.max(0, Math.min(wanted, s.water));
  if (n > 0) s.water -= n;
  return n;
}

/** Consommation réelle du troupeau (grain mangé gaspillage compris, eau bue). */
export function recordUse(s: GameState, kind: 'grain' | 'water', n: number) {
  if (n <= 0) return;
  roll(s);
  s.usage[kind] += n;
}

/** Consommation journalière : mesurée la veille, sinon estimée d'après le troupeau. */
// Estimations théoriques (le sommeil réduit les besoins d'environ un quart)
const grainEstimate = (s: GameState) => s.hens.reduce((a, h) => a + BREEDS[h.breed].appetite, 0) * 0.55;
const waterEstimate = (s: GameState) => (s.hens.length * NEEDS.hydrationPerDay * 0.78) / NEEDS.pointsPerLiter;

export function grainPerDay(s: GameState) {
  roll(s);
  const est = grainEstimate(s);
  if (s.usage.lastGrain > 0 && s.hens.length > 0) return Math.max(s.usage.lastGrain, s.usage.grain, est * 0.6);
  return est;
}
export function waterPerDay(s: GameState) {
  roll(s);
  const est = waterEstimate(s);
  if (s.usage.lastWater > 0 && s.hens.length > 0) return Math.max(s.usage.lastWater, s.usage.water, est * 0.6);
  return est;
}

/** Jours d'autonomie (stock en réserve + contenu des mangeoires / abreuvoirs). */
export function grainDays(s: GameState) {
  const inFeeders = s.buildings.reduce((a, b) => a + (b.type === 'feeder' ? b.stock : 0), 0);
  const rate = grainPerDay(s);
  return rate > 0.05 ? (s.grain + inFeeders) / rate : Infinity;
}
export function waterDays(s: GameState) {
  const inDrinkers = s.buildings.reduce((a, b) => a + (b.type === 'drinker' ? b.stock : 0), 0);
  const rate = waterPerDay(s);
  return rate > 0.05 ? (s.water + inDrinkers) / rate : Infinity;
}
