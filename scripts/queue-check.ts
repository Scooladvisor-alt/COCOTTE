// Mesure de la file d'attente à l'étal sur une partie simulée (bot « bon gestionnaire »).
import { HOUR, TIME } from '../src/config/balance';
import { drainEvents } from '../src/sim/core';
import { farmLevel } from '../src/sim/economy';
import { standCounters } from '../src/sim/market';
import { step } from '../src/sim/simulation';
import { createNewGame } from '../src/sim/state';
import { goodPlayer } from './bot';

const s = createNewGame(42);
// ?étal amélioré : npx vite-node scripts/queue-check.ts -- 2
const lvlArg = Number(process.argv.at(-1));
if (lvlArg >= 2) for (const b of s.buildings) if (b.type === 'stand') b.level = lvlArg;
let acc = 0;
let maxQ = 0;
for (let day = 1; day <= 30; day++) {
  for (let t = 0; t < TIME.DAY; t += TIME.STEP) {
    step(s, TIME.STEP);
    drainEvents(s);
    maxQ = Math.max(maxQ, s.customers.filter((c) => c.state === 'queue').length);
    acc += TIME.STEP;
    if (acc >= HOUR * 2) {
      acc = 0;
      goodPlayer(s);
    }
  }
  if (day % 5 === 0) console.log(`J${day} niv ${farmLevel(s)} guichets ${standCounters(s)} servis ${s.stats.customersServed} perdus ${s.stats.customersLost} file max ${maxQ} CA ${(s.stats.salesRevenue / 100).toFixed(0)} €`);
}
