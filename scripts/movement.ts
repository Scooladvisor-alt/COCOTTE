// Diagnostic des déplacements : npx vite-node scripts/movement.ts
// Mesure les anomalies de locomotion des poules sur une ferme chargée.
import { TIME } from '../src/config/balance';
import { BUILDINGS } from '../src/config/buildings';
import * as A from '../src/sim/actions';
import { cellIndex, drainEvents, inGrid, rt } from '../src/sim/core';
import { step } from '../src/sim/simulation';
import { createNewGame } from '../src/sim/state';
import type { GameState, HenAct } from '../src/sim/types';

export function buildBusyFarm(seed = 7): GameState {
  const s = createNewGame(seed);
  s.xp = 4300;
  s.money = 10_000_000;
  A.buyParcel(s, '0,2');
  A.buyParcel(s, '2,2');
  A.buyParcel(s, '1,1');
  for (const b of s.buildings) if (b.type === 'coop') for (let i = 0; i < 3; i++) A.upgrade(s, b.id);
  A.build(s, 'coop', 2, 11);
  A.build(s, 'coop', 22, 21);
  for (const b of s.buildings) if (b.type === 'coop') for (let i = 0; i < 3; i++) A.upgrade(s, b.id);
  A.build(s, 'feeder', 5, 26);
  A.build(s, 'drinker', 7, 26);
  A.build(s, 'nest', 25, 26);
  A.build(s, 'feeder', 26, 23);
  A.build(s, 'drinker', 23, 27);
  A.build(s, 'dustbath', 14, 14);
  const breeds = ['rousse', 'leghorn', 'sussex', 'soie'] as const;
  for (let i = 0; i < 44; i++) A.buyHen(s, breeds[i % 4]);
  return s;
}

const ANCHORED: HenAct[] = ['eat', 'drink', 'lay', 'sleep', 'bathe', 'enter', 'exit'];
const GOING: HenAct[] = ['goEat', 'goDrink', 'goNest', 'goCoop', 'goBath'];

export function measure(s: GameState, seconds: number) {
  const r = rt(s);
  const m = { samples: 0, inside: 0, nearWall: 0, overlaps: 0, pairs: 0, teleports: 0, stuck: 0, goingSamples: 0, failsToPeck: 0 };
  const last = new Map<number, { x: number; z: number; still: number; act: HenAct }>();
  for (let t = 0; t < seconds; t += TIME.STEP) {
    step(s, TIME.STEP);
    drainEvents(s);
    const awake = s.hens.filter((h) => h.act !== 'sleep');
    for (const h of awake) {
      m.samples++;
      const cx = Math.floor(h.x);
      const cz = Math.floor(h.z);
      const occ = inGrid(cx, cz) ? r.occupant[cellIndex(cx, cz)] : -1;
      if (occ >= 0 && occ !== h.targetId && !['enter', 'exit'].includes(h.act)) m.inside++;
      // proximité d'un obstacle (bâtiment ou clôture) à moins de 0,12
      if (!ANCHORED.includes(h.act) && !GOING.includes(h.act)) {
        for (const [dx, dz] of [[0.12, 0], [-0.12, 0], [0, 0.12], [0, -0.12]]) {
          const x = Math.floor(h.x + dx);
          const z = Math.floor(h.z + dz);
          if (!inGrid(x, z) || !r.walk[cellIndex(x, z)]) {
            m.nearWall++;
            break;
          }
        }
      }
      const p = last.get(h.id);
      if (p) {
        const d = Math.hypot(h.x - p.x, h.z - p.z);
        if (d > 0.45 && h.act === p.act) m.teleports++;
        if (GOING.includes(h.act)) {
          m.goingSamples++;
          p.still = d < 0.004 ? p.still + TIME.STEP : 0;
          if (p.still > 3) m.stuck++;
        }
        if (h.act === 'peck' && GOING.includes(p.act) && h.actT > 1.3) m.failsToPeck++;
        p.x = h.x;
        p.z = h.z;
        p.act = h.act;
      } else last.set(h.id, { x: h.x, z: h.z, still: 0, act: h.act });
    }
    // chevauchements (échantillonnés)
    if (Math.round(t / TIME.STEP) % 10 === 0) {
      const free = awake.filter((h) => !['sleep', 'lay', 'enter', 'exit'].includes(h.act));
      for (let i = 0; i < free.length; i++)
        for (let j = i + 1; j < free.length; j++) {
          m.pairs++;
          if (Math.hypot(free[i].x - free[j].x, free[i].z - free[j].z) < 0.22) m.overlaps++;
        }
    }
  }
  return {
    insideBuildingPct: ((m.inside / m.samples) * 100).toFixed(2),
    nearWallPct: ((m.nearWall / m.samples) * 100).toFixed(2),
    overlapPairsPct: ((m.overlaps / Math.max(1, m.pairs)) * 100).toFixed(3),
    teleports: m.teleports,
    stuckSamplesPct: ((m.stuck / Math.max(1, m.goingSamples)) * 100).toFixed(2),
    navFailures: m.failsToPeck,
    hens: s.hens.length,
  };
}

{
  const s = buildBusyFarm();
  void BUILDINGS;
  console.log(measure(s, TIME.DAY * 2));
}
