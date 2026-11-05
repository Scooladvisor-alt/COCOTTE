// La poussinière : son plan (repères du modèle 3D, en coordonnées locales du bâtiment, façade et
// portillon vers +z) et ce qu'il faut savoir d'elle. Les poussins y vivent à part : le bâtiment au
// fond pour dormir au chaud, le petit parc grillagé devant pour se promener, picorer et boire.
// Tout l'enclos fait partie de l'emprise : les poules adultes ne peuvent pas y entrer.
import { BREEDING } from '../config/balance';
import { buildingsOf, lvl } from './queries';
import type { Building, GameState, Hen } from './types';

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
