// Nouvelle partie du joueur : la ferme de départ (clôturée) avec Cocotte, ses trois poussins,
// un coq et une couveuse.
import { BREEDING } from '../config/balance';
import { createHen } from './hens';
import { inherit } from './genetics';
import { buildingsOf } from './queries';
import { createNewGame, makeBuilding } from './state';
import { canPlace } from './buildings';
import { invalidateLayout } from './core';
import type { GameState, Genes } from './types';

/** Les volailles de départ restent des « fermières » ordinaires (3★ au plus) : les 4★ se méritent. */
const capped = (g: Genes): Genes => ({ p: Math.min(3, g.p), r: Math.min(3, g.r), b: Math.min(3, g.b) });

/** Une poule adulte et trois poussins devant le poulailler. */
export function addStarterFlock(s: GameState) {
  const coop = buildingsOf(s, 'coop')[0];
  if (!coop) return;
  const x = coop.x + 1.5;
  const z = coop.z + 3.2;
  // Cocotte : une bonne poule fermière, 3 étoiles partout ; ses poussins en héritent
  const mother = { p: 3, r: 3, b: 3 };
  const hen = createHen(s, 'rousse', coop, true, { at: [x, z], genes: mother });
  hen.name = 'Cocotte';
  s.hens.push(hen);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    s.hens.push(createHen(s, 'rousse', coop, false, { young: BREEDING.growthDays, at: [x + Math.cos(a) * 0.6, z + Math.sin(a) * 0.6], genes: capped(inherit(s, mother, { p: 3, r: 2, b: 3 })) }));
  }
}

/** Un coq pour féconder les œufs et une petite couveuse offerte : les poussins peuvent arriver dès le début. */
export function addStarterBreeding(s: GameState) {
  const coop = buildingsOf(s, 'coop')[0];
  if (!coop) return;
  const rooster = createHen(s, 'rousse', coop, false, { rooster: true, black: false, at: [coop.x + 2.6, coop.z + 3.6], genes: { p: 3, r: 2, b: 3 } });
  s.hens.push(rooster);
  // couveuse posée sur le premier emplacement libre, près des installations
  const spots: Array<[number, number]> = [[17, 28], [13, 28], [11, 28], [17, 24], [13, 24], [18, 23], [10, 25]];
  for (const [x, z] of spots) {
    if (!canPlace(s, 'incubator', x, z).ok) continue;
    const b = makeBuilding(s.nextId++, 'incubator', x, z, s.clock.t);
    b.invested = 0; // offerte : pas remboursée à la démolition
    b.hatch = [];
    s.buildings.push(b);
    invalidateLayout(s);
    break;
  }
}

/** Ferme d'une nouvelle partie (le moteur de simulation et les tests partent, eux, d'une ferme vide). */
export function newFarm(seed?: number) {
  const s = createNewGame(seed);
  addStarterFlock(s);
  addStarterBreeding(s);
  return s;
}
