// Simulation d'équilibrage : npm run balance
import { HOUR, TIME } from '../src/config/balance';
import { farmLevel, fmtMoney, sumExpense, sumIncome } from '../src/sim/economy';
import { step } from '../src/sim/simulation';
import { createNewGame } from '../src/sim/state';
import { drainEvents } from '../src/sim/core';
import { productivity } from '../src/sim/hens';
import { goodPlayer, guard, lazyPlayer } from './bot';
import type { GameState } from '../src/sim/types';

function run(name: string, bot: (s: GameState) => void, days: number, seed = 42, reaction = 3) {
  const s = createNewGame(seed);
  console.log(`\n=== ${name} (${days} jours) ===`);
  console.log('jour | argent      | poules | niv | rép | parc | ventes/j  | charges/j | œufs pondus | stock | prod | bien-être');
  let lastDay = 1;
  const actEvery = HOUR * 2;
  let acc = 0;
  const total = days * TIME.DAY;
  for (let t = 0; t < total; t += TIME.STEP) {
    step(s, TIME.STEP);
    if (reaction > 0) guard(s, reaction);
    acc += TIME.STEP;
    if (acc >= actEvery) {
      acc = 0;
      bot(s);
    }
    drainEvents(s);
    const day = Math.floor(s.clock.t / TIME.DAY) + 1;
    if (day !== lastDay) {
      const d = s.finance.days.find((x) => x.day === lastDay);
      if (lastDay % 2 === 0 || lastDay < 6)
        console.log(
          `${String(lastDay).padStart(4)} | ${fmtMoney(s.money).padStart(11)} | ${String(s.hens.length).padStart(6)} | ${String(farmLevel(s)).padStart(3)} | ${s.reputation.toFixed(0).padStart(3)} | ${String(s.parcels.length).padStart(4)} | ${fmtMoney(d ? sumIncome(d) : 0).padStart(9)} | ${fmtMoney(d ? sumExpense(d) : 0).padStart(9)} | ${String(s.stats.eggsLaid).padStart(11)} | ${s.lots.reduce((a, l) => a + l.count, 0)} | ${(s.hens.reduce((a, h) => a + productivity(h), 0) / Math.max(1, s.hens.length)).toFixed(2)} | ${(s.hens.reduce((a, h) => a + h.wellbeing, 0) / Math.max(1, s.hens.length)).toFixed(0)}`,
        );
      lastDay = day;
    }
  }
  console.log(
    `Fin : ${fmtMoney(s.money)}, ${s.hens.length} poules, niveau ${farmLevel(s)}, missions ${s.missionIndex}, mortes ${s.stats.hensDied}, emportées ${s.stats.hensTaken}, prédateurs abattus ${s.stats.predatorsKilled}, œufs vendus ${s.stats.eggsSold}, perdus ${s.stats.eggsLost}, périmés ${s.stats.eggsSpoiled}, CA ${fmtMoney(s.stats.salesRevenue)}`,
  );
  const breeds: Record<string, number> = {};
  for (const h of s.hens) breeds[h.breed] = (breeds[h.breed] ?? 0) + 1;
  console.log('Races :', JSON.stringify(breeds), 'Bâtiments :', s.buildings.map((b) => `${b.type}${b.level}`).join(' '));
  return s;
}

const days = Number(process.argv[2] ?? 40);
run('Bon gestionnaire', goodPlayer, days);
run('Gestionnaire négligent', lazyPlayer, 8);
