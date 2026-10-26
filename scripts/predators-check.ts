// Vérification rapide des prédateurs : npx vite-node scripts/predators-check.ts
import { HOUR, TIME } from '../src/config/balance';
import { BUILDINGS, COOP_SCALE } from '../src/config/buildings';
import * as A from '../src/sim/actions';
import { drainEvents } from '../src/sim/core';
import { spawnPredator } from '../src/sim/predators';
import { step } from '../src/sim/simulation';
import { createNewGame } from '../src/sim/state';
import { hire } from '../src/sim/workers';
import type { GameState, PredatorSpecies } from '../src/sim/types';

function farm(seed: number, hour: number, hens = 10) {
  const s = createNewGame(seed);
  s.xp = 900;
  s.money = 1_000_000;
  const coop = s.buildings.find((b) => b.type === 'coop')!;
  A.upgrade(s, coop.id);
  A.upgrade(s, coop.id);
  for (let i = 0; i < hens; i++) A.buyHen(s, 'rousse');
  s.clock.t = 2 * TIME.DAY + hour * HOUR;
  s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
  s.clock.lastClosedDay = 2;
  s.settings.predators = false;
  // les poules s'installent
  for (let t = 0; t < 20; t += TIME.STEP) step(s, TIME.STEP);
  drainEvents(s);
  return s;
}

function attack(s: GameState, species: PredatorSpecies, seconds = 60) {
  const p = spawnPredator(s, species);
  const log: string[] = [];
  let last = '';
  let minHenD = Infinity;
  for (let t = 0; t < seconds; t += TIME.STEP) {
    step(s, TIME.STEP);
    for (const e of drainEvents(s)) if (e.kind === 'notify') log.push(`${t.toFixed(1)}s ${e.text}`);
    const cur = s.predators.find((x) => x.id === p.id);
    const st = cur ? cur.state : 'gone';
    if (st !== last) {
      log.push(`${t.toFixed(1)}s état=${st}${cur ? ` (${cur.x.toFixed(1)},${cur.z.toFixed(1)},y${cur.y.toFixed(1)})` : ''}`);
      last = st;
    }
    if (cur) for (const h of s.hens) if (h.act !== 'sleep') minHenD = Math.min(minHenD, Math.hypot(h.x - cur.x, h.z - cur.z));
    if (!cur) break;
  }
  return { log, taken: s.stats.hensTaken, killed: s.stats.predatorsKilled, hens: s.hens.length, minHenD: minHenD.toFixed(2) };
}

console.log('--- Renard en plein jour, sans défense ---');
console.log(attack(farm(1, 10), 'fox'));
console.log('--- Renard, commis + jardinier armés ---');
{
  let saved = 0;
  let kills = 0;
  const N = 12;
  for (let k = 0; k < N; k++) {
    const s = farm(100 + k, 10);
    hire(s, 'farmhand');
    hire(s, 'gardener');
    for (let t = 0; t < 6; t += TIME.STEP) step(s, TIME.STEP);
    const r = attack(s, 'fox');
    if (r.taken === 0) saved++;
    kills += r.killed;
    if (k === 0) console.log(r.log.join('\n'));
  }
  console.log(`${saved}/${N} attaques repoussées, ${kills} renards abattus`);
}
console.log('--- Renard, commis seul ---');
{
  let saved = 0;
  const N = 12;
  for (let k = 0; k < N; k++) {
    const s = farm(200 + k, 10);
    hire(s, 'farmhand');
    for (let t = 0; t < 6; t += TIME.STEP) step(s, TIME.STEP);
    if (attack(s, 'fox').taken === 0) saved++;
  }
  console.log(`${saved}/${N} attaques repoussées`);
}
console.log('--- Nuit : trappe fermée ---');
{
  const s = farm(3, 23.6);
  const coop = s.buildings.find((b) => b.type === 'coop')!;
  for (const h of s.hens) {
    h.act = 'sleep';
    h.x = coop.x + BUILDINGS.coop.w / 2;
    h.z = coop.z + 1.15 * COOP_SCALE;
  }
  coop.closed = true;
  console.log(attack(s, 'fox'));
}
console.log('--- Nuit : trappe ouverte ---');
{
  const s = farm(4, 23.6);
  const coop = s.buildings.find((b) => b.type === 'coop')!;
  for (const h of s.hens) {
    h.act = 'sleep';
    h.x = coop.x + BUILDINGS.coop.w / 2;
    h.z = coop.z + 1.15 * COOP_SCALE;
  }
  coop.closed = false;
  console.log(attack(s, 'fox'));
}
console.log('--- Buse sans défense ---');
console.log(attack(farm(5, 11), 'hawk'));
console.log('--- Buse, commis + jardinier ---');
{
  let saved = 0;
  const N = 12;
  for (let k = 0; k < N; k++) {
    const s = farm(300 + k, 11);
    hire(s, 'farmhand');
    hire(s, 'gardener');
    for (let t = 0; t < 6; t += TIME.STEP) step(s, TIME.STEP);
    if (attack(s, 'hawk').taken === 0) saved++;
  }
  console.log(`${saved}/${N} attaques repoussées`);
}
