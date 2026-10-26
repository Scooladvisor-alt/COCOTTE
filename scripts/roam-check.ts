// Diagnostic de la balade des poules : npx vite-node scripts/roam-check.ts
// Sur le temps libre des poules (ni repas, ni ponte, ni trajet vers un bâtiment), mesure la part
// du terrain parcourue et la distance aux bâtiments, comparée à des points tirés au hasard.
import { HOUR, TIME, WORLD } from '../src/config/balance';
import * as A from '../src/sim/actions';
import { buildingCenter, canStand, currentHour, drainEvents, parcelCoords, parcelOrigin } from '../src/sim/core';
import { step } from '../src/sim/simulation';
import { newFarm } from '../src/sim/starter';
import type { GameState } from '../src/sim/types';

const FREE = ['walk', 'peck', 'scratch', 'rest', 'preen', 'idle', 'flap'];
const B = 2;

function nearestBuilding(s: GameState, x: number, z: number) {
  let d = Infinity;
  for (const b of s.buildings) {
    if (b.type === 'stand') continue;
    const c = buildingCenter(b);
    d = Math.min(d, Math.hypot(c.x - x, c.z - z));
  }
  return d;
}

function run(seed: number) {
  const s = newFarm(seed);
  s.money = 1e7;
  for (let i = 0; i < 10; i++) A.buyHen(s, i % 2 ? 'rousse' : 'leghorn');
  s.clock.t = TIME.DAY + 7 * HOUR;
  // une journée pour s'installer, puis on observe le lendemain de 9 h à 18 h
  for (let t = 0; t < TIME.DAY; t += TIME.STEP) step(s, TIME.STEP);
  drainEvents(s);
  const [c, r] = parcelCoords(s.parcels[0]);
  const [x0, z0] = parcelOrigin(c, r);
  const seen = new Set<string>();
  let n = 0;
  let dist = 0;
  let far = 0;
  for (let k = 0; k < 9 * HOUR / TIME.STEP; k++) {
    step(s, TIME.STEP);
    drainEvents(s);
    if (k % 10 || currentHour(s) < 9) continue;
    for (const h of s.hens) {
      if (!FREE.includes(h.act)) continue;
      n++;
      seen.add(`${Math.floor((h.x - x0) / B)},${Math.floor((h.z - z0) / B)}`);
      const d = nearestBuilding(s, h.x, h.z);
      dist += d;
      if (d > 5) far++;
    }
  }
  // référence : des points tirés au hasard sur le terrain libre
  let ref = 0;
  let rn = 0;
  for (let i = 0; i < 3000; i++) {
    const x = x0 + Math.random() * WORLD.PARCEL;
    const z = z0 + Math.random() * WORLD.PARCEL;
    if (!canStand(s, x, z, 0.2)) continue;
    ref += nearestBuilding(s, x, z);
    rn++;
  }
  return [seen.size / (WORLD.PARCEL / B) ** 2, dist / n, far / n, ref / rn];
}

const runs = [1, 2, 3, 4, 5, 6].map(run);
const avg = (k: number) => runs.reduce((a, r) => a + r[k], 0) / runs.length;
console.log(
  `blocs de ${B} m visités ${(avg(0) * 100).toFixed(0)} %, distance moyenne aux bâtiments ${avg(1).toFixed(2)} m ` +
    `(au hasard : ${avg(3).toFixed(2)} m), à plus de 5 m ${(avg(2) * 100).toFixed(0)} %`,
);
