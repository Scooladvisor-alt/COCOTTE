// La poussinière : son plan (repères du modèle 3D, en coordonnées locales du bâtiment, façade et
// portillon vers +z) et ce qu'il faut savoir d'elle. Les poussins y vivent à part : le bâtiment au
// fond pour dormir au chaud, le petit parc grillagé devant pour se promener, picorer et boire.
// Tout l'enclos fait partie de l'emprise : les poules adultes ne peuvent pas y entrer. Sur les côtés
// du bâtiment, derrière le grillage du parc : les emplacements des couveuses (un par niveau).
import { BREEDING } from '../config/balance';
import { toWorld } from './core';
import { buildingsOf, getBuilding, lvl } from './queries';
import type { Building, GameState, Hen } from './types';

/** Emplacement de couveuse : centre, orientation (quarts de tour) et échelle du meuble posé là. */
export interface IncubatorSeat {
  x: number;
  z: number;
  rot: number;
  k: number;
}

export interface NurseryPlan {
  /** Parc où les poussins se promènent (le grillage est juste au-delà). */
  park: { x0: number; x1: number; z0: number; z1: number };
  /** Bâtiment (x0..x1 en largeur, z0..z1 en profondeur ; z1 est sa façade, côté parc). */
  house: { x0: number; x1: number; z0: number; z1: number };
  /** Trappe des poussins : milieu de l'ouverture en x, façade en z. */
  doorX: number;
  /** Où ils dorment, derrière la façade. */
  inside: [number, number];
  /** Portillon du parc (au milieu du grillage de devant). */
  gate: [number, number];
  /** Mangeoires et abreuvoirs à poussins : centre et rayon de la nourriture. */
  feeders: Array<[number, number, number]>;
  drinkers: Array<[number, number, number]>;
  /** Emplacements des couveuses. */
  seats: IncubatorSeat[];
}

const PLANS: Record<number, NurseryPlan> = {
  1: {
    house: { x0: 1.6, x1: 5.4, z0: 0.3, z1: 2.2 },
    park: { x0: 0.5, x1: 6.5, z0: 2.5, z1: 5.5 },
    doorX: 3.5,
    inside: [3.5, 1.3],
    gate: [3.5, 5.72],
    feeders: [[1.9, 3.9, 0.17]],
    drinkers: [[5.1, 3.9, 0.15]],
    seats: [{ x: 6.2, z: 1.35, rot: 1, k: 0.95 }],
  },
  2: {
    house: { x0: 2, x1: 8, z0: 0.3, z1: 2.9 },
    park: { x0: 0.5, x1: 9.5, z0: 3.2, z1: 7.5 },
    doorX: 5,
    inside: [5, 1.7],
    gate: [5, 7.72],
    feeders: [
      [2.4, 4.7, 0.2],
      [7.4, 6.2, 0.2],
    ],
    drinkers: [
      [7.6, 4.5, 0.17],
      [2.5, 6.3, 0.17],
    ],
    seats: [
      { x: 9.0, z: 1.6, rot: 1, k: 1 },
      { x: 1.0, z: 2.35, rot: 0, k: 0.86 },
    ],
  },
};
export const nurseryPlan = (level: number) => PLANS[level] ?? PLANS[1];

/** Places autour d'une mangeoire ou d'un abreuvoir. */
export const NURSERY_RING = 8;
/** Distance du bec au bord de la nourriture : les pattes restent à cet écart. */
export const NURSERY_REACH = 0.17;

/** Âge de quitter la poussinière : il reste si peu de croissance qu'ils vont bientôt pondre. */
export const readyToLeave = (h: Pick<Hen, 'young'>) => (h.young ?? 0) <= BREEDING.nurseryLeaveDays;

/** Poussins élevés dans cette poussinière. */
export function nurseryCount(s: GameState, b: Building) {
  let n = 0;
  for (const h of s.hens) if (h.nursery && h.coopId === b.id) n++;
  return n;
}

/** Poussinière qui a encore de la place (la moins remplie d'abord), sinon null. */
export function nurseryWithRoom(s: GameState): Building | null {
  let best: Building | null = null;
  let bestFree = 0;
  for (const b of buildingsOf(s, 'nursery')) {
    const free = lvl(b).capacity - nurseryCount(s, b);
    if (free > bestFree) {
      best = b;
      bestFree = free;
    }
  }
  return best;
}

/** La poussinière la moins remplie, même pleine (null s'il n'y en a aucune). */
export function leastCrowdedNursery(s: GameState): Building | null {
  let best: Building | null = null;
  let bestRatio = Infinity;
  for (const b of buildingsOf(s, 'nursery')) {
    const ratio = nurseryCount(s, b) / Math.max(1, lvl(b).capacity);
    if (ratio < bestRatio) {
      best = b;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Surpeuplement d'une poussinière : 0 si elle n'est pas pleine, 1 s'il y a deux fois trop de poussins. */
export function nurseryCrowding(s: GameState, b: Building) {
  return Math.max(0, nurseryCount(s, b) / Math.max(1, lvl(b).capacity) - 1);
}

// ---------------------------------------------------------- Couveuses ----
/** Couveuses installées dans cette poussinière (toujours dans le même ordre). */
export const hostedIncubators = (s: GameState, b: Building) => s.buildings.filter((c) => c.type === 'incubator' && c.hostId === b.id).sort((a, c) => a.id - c.id);
/** Emplacements libres de cette poussinière. */
export const freeSeats = (s: GameState, b: Building) => Math.max(0, nurseryPlan(b.level).seats.length - hostedIncubators(s, b).length);
/** Poussinière où installer une couveuse (celle qui en a le moins), sinon null. */
export function nurseryWithSeat(s: GameState): Building | null {
  let best: Building | null = null;
  for (const b of buildingsOf(s, 'nursery')) {
    if (!freeSeats(s, b)) continue;
    if (!best || hostedIncubators(s, b).length < hostedIncubators(s, best).length) best = b;
  }
  return best;
}

/** L'emplacement qu'occupe cette couveuse, et sa poussinière (null si elle n'en a pas). */
export function incubatorSeat(s: GameState, inc: Building): { host: Building; seat: IncubatorSeat } | null {
  const host = inc.hostId === undefined ? undefined : getBuilding(s, inc.hostId);
  if (!host || host.type !== 'nursery') return null;
  const seat = nurseryPlan(host.level).seats[hostedIncubators(s, host).indexOf(inc)];
  return seat ? { host, seat } : null;
}

/** Remet chaque couveuse à sa place : à appeler quand une poussinière bouge, pivote ou s'agrandit. */
export function seatIncubators(s: GameState) {
  for (const b of s.buildings) {
    if (b.type !== 'incubator') continue;
    const at = incubatorSeat(s, b);
    if (!at) continue;
    [b.x, b.z] = toWorld(at.host, at.seat.x, at.seat.z);
    const rot = ((at.host.rot ?? 0) + at.seat.rot) % 4;
    if (rot) b.rot = rot;
    else delete b.rot;
  }
}
