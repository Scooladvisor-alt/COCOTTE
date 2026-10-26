// Charge maximale : npx vite-node scripts/stress.ts — temps de calcul par pas avec un très grand troupeau.
import { TIME } from '../src/config/balance';
import * as A from '../src/sim/actions';
import { canPlace } from '../src/sim/buildings';
import { drainEvents } from '../src/sim/core';
import { flockCapacity } from '../src/sim/queries';
import { step } from '../src/sim/simulation';
import { createNewGame } from '../src/sim/state';
import { hire } from '../src/sim/workers';
import type { BuildingType, GameState } from '../src/sim/types';

function place(s: GameState, type: BuildingType, n: number) {
  let done = 0;
  for (let z = 1; z < 29 && done < n; z += 1)
    for (let x = 1; x < 39 && done < n; x += 1) if (canPlace(s, type, x, z).ok && A.build(s, type, x, z).ok) done++;
  return done;
}

const s = createNewGame(5);
s.xp = 99999;
s.money = 1e9;
for (const k of ['0,2', '2,2', '1,1', '0,1', '2,1', '3,2', '3,1', '1,0', '0,0', '2,0', '3,0']) A.buyParcel(s, k);
place(s, 'coop', 5);
for (const b of s.buildings) if (b.type === 'coop') while (A.upgrade(s, b.id).ok);
place(s, 'feeder', 10);
place(s, 'drinker', 10);
place(s, 'nest', 8);
for (const b of s.buildings) if (b.type !== 'coop') while (A.upgrade(s, b.id).ok);
s.grain = 2000;
s.water = 3000;
const breeds = ['rousse', 'leghorn', 'sussex', 'soie', 'araucana', 'marans'] as const;
for (let i = 0; i < 400; i++) if (!A.buyHen(s, breeds[i % 6]).ok && !A.buyHen(s, 'rousse').ok) break;
hire(s, 'farmhand');
hire(s, 'gardener');
console.log(`poules ${s.hens.length} / capacité ${flockCapacity(s)}, bâtiments ${s.buildings.length}`);
// échauffement puis mesure sur une journée complète
for (let i = 0; i < 200; i++) step(s, TIME.STEP), drainEvents(s);
const steps = Math.round(TIME.DAY / TIME.STEP);
const t0 = performance.now();
let worst = 0;
const spikes: string[] = [];
for (let i = 0; i < steps; i++) {
  const a = performance.now();
  const hourBefore = Math.floor(s.clock.t / (TIME.DAY / 24));
  step(s, TIME.STEP);
  drainEvents(s);
  const d = performance.now() - a;
  worst = Math.max(worst, d);
  if (d > 12) spikes.push(`${d.toFixed(0)}ms h=${((s.clock.t % TIME.DAY) / (TIME.DAY / 24)).toFixed(2)}${Math.floor(s.clock.t / (TIME.DAY / 24)) !== hourBefore ? ' (tâche horaire)' : ''}`);
}
if (spikes.length) console.log(`pics > 12 ms : ${spikes.length} — ${spikes.slice(0, 12).join(' | ')}`);
const ms = (performance.now() - t0) / steps;
console.log(`${ms.toFixed(3)} ms/pas en moyenne (pire ${worst.toFixed(1)} ms) → à ×10 : ${(ms * 100).toFixed(0)} ms de calcul par seconde réelle`);
console.log(`morts ${s.stats.hensDied}, œufs pondus ${s.stats.eggsLaid}`);
