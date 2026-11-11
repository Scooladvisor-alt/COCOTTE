// Nouvelle partie du joueur : la ferme de départ (clôturée) avec Cocotte, ses trois poussins,
// un coq, et une poussinière équipée de sa couveuse.
import { BREEDING } from '../config/balance';
import { createHen } from './hens';
import { inherit } from './genetics';
import { buildingsOf } from './queries';
import { createNewGame, makeBuilding } from './state';
import { offerNursery } from './actions';
import { seatIncubators } from './nursery';
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
  const hen = createHen(s, 'rousse', coop, true, { black: false, at: [x, z], genes: mother });
  hen.name = 'Cocotte';
  s.hens.push(hen);
  // ses poussins sont ordinaires : les raretés naissent à la couveuse
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    s.hens.push(createHen(s, 'rousse', coop, false, { young: BREEDING.growthDays, golden: false, legendary: false, black: false, at: [x + Math.cos(a) * 0.6, z + Math.sin(a) * 0.6], genes: capped(inherit(s, mother, { p: 3, r: 2, b: 3 })) }));
  }
}

/** Un coq pour féconder les œufs, une poussinière et sa petite couveuse offertes : les poussins peuvent arriver dès le début. */
export function addStarterBreeding(s: GameState) {
  const coop = buildingsOf(s, 'coop')[0];
  if (!coop) return;
  const rooster = createHen(s, 'rousse', coop, false, { rooster: true, black: false, at: [coop.x + 2.6, coop.z + 3.6], genes: { p: 3, r: 2, b: 3 } });
  s.hens.push(rooster);
  // (les poussins de Cocotte restent avec elle : la poussinière attend les prochains)
  const nursery = offerNursery(s, [[12, 11], [11, 11], [4, 11], [0, 23]], false);
  if (!nursery) return;
  const b = makeBuilding(s.nextId++, 'incubator', nursery.x, nursery.z, s.clock.t);
  b.invested = 0; // offerte : pas remboursée au démontage
  b.hostId = nursery.id;
  b.hatch = [];
  s.buildings.push(b);
  seatIncubators(s);
}

/** Ferme d'une nouvelle partie (le moteur de simulation et les tests partent, eux, d'une ferme vide). */
export function newFarm(seed?: number) {
  const s = createNewGame(seed);
  addStarterFlock(s);
  addStarterBreeding(s);
  return s;
}
