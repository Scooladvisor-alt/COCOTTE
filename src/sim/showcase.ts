// Ferme vitrine de la page d'accueil : une petite exploitation vivante (poules de plusieurs races,
// coq, poussins, chien, commis, compost, couveuse) qui tourne en arrière-plan derrière le titre.
// Elle n'a rien à voir avec la partie du joueur et n'est jamais sauvegardée.
import { HOUR, TIME } from '../config/balance';
import * as A from './actions';
import { isWalkable, nearestWalkable } from './core';
import { buyDog } from './dog';
import { buildingsOf } from './queries';
import { addStarterFlock } from './starter';
import { createNewGame } from './state';
import type { BreedId, GameState } from './types';
import { hire } from './workers';

export function createShowcase(): GameState {
  const s = createNewGame(20251);
  s.money = 10_000_000;
  s.xp = 4000;
  s.settings.predators = false;
  s.settings.sound = false;
  s.settings.music = false;
  s.tutorial.done = true;
  const coop = buildingsOf(s, 'coop')[0];
  A.upgrade(s, coop.id);
  A.upgrade(s, coop.id);
  addStarterFlock(s);
  const breeds: BreedId[] = ['rousse', 'rousse', 'leghorn', 'sussex', 'rousse', 'marans', 'araucana', 'soie', 'sussex', 'rousse'];
  for (const b of breeds) A.buyHen(s, b);
  A.buyRooster(s, 'rousse');
  // un peu de vie autour : compost, couveuse, chien de garde
  const place = (type: 'compost' | 'incubator', spots: Array<[number, number]>) => spots.some(([x, z]) => A.build(s, type, x, z).ok);
  place('compost', [[11, 27], [10, 27], [12, 27]]);
  place('incubator', [[16, 28], [15, 28], [17, 28]]);
  buyDog(s);
  // en milieu de matinée, le commis déjà au travail, l'étal ouvert
  s.clock.t = TIME.DAY + 9 * HOUR;
  s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
  s.clock.lastClosedDay = 1;
  s.clock.speed = 1;
  hire(s, 'farmhand');
  for (const w of s.workers) {
    w.onSite = true;
    w.x = 14.5;
    w.z = 27.5;
  }
  s.grain = 250;
  s.water = 300;
  A.refillAll(s);
  // quelques poules déjà dans le pré, éparpillées
  for (const h of s.hens) {
    h.x = 11 + ((h.id * 37) % 70) / 10;
    h.z = 23.6 + ((h.id * 53) % 40) / 10;
    if (!isWalkable(s, h.x, h.z)) {
      const p = nearestWalkable(s, h.x, h.z);
      if (p) [h.x, h.z] = p;
    }
    h.tx = h.x;
    h.tz = h.z;
    h.layProgress = Math.min(h.layProgress, 0.6);
  }
  return s;
}
