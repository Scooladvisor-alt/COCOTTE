// Cycle de vie des œufs : ponte → (pondoir | sol) → ramassage → stockage (lots) → vente.
// Un œuf n'existe qu'à un seul endroit à la fois : son retrait précède toujours son ajout ailleurs.
import { COMPOST, FRESHNESS, GRADE_RANK, RARE, TIME, XP, clamp, gradeOf } from '../config/balance';
import { BREEDS } from '../config/breeds';
import { currentDay, emit, newId, buildingCenter, notify } from './core';
import { addXp, fmtMoney, today } from './economy';
import { getBuilding, lvl, storage, storageFree } from './queries';
import type { BreedId, Building, EggType, GameState, Grade, Hen, WorldEgg } from './types';
import { fertilize } from './breeding';

export function eggQuality(s: GameState, h: Hen, nest: Building | null): number {
  const coop = getBuilding(s, h.coopId);
  const clean = coop ? coop.cleanliness : 50;
  let q =
    0.32 * (h.health / 100) +
    0.22 * (h.satiety / 100) +
    0.14 * (h.hydration / 100) +
    0.2 * (h.wellbeing / 100) +
    0.12 * (clean / 100);
  q += BREEDS[h.breed].qualityBonus;
  // œufs plus riches quand la poule s'est régalée au compost
  q += COMPOST.quality * (h.protein / 100);
  if (nest) q += lvl(nest).quality ?? 0;
  else q -= 0.22;
  return clamp(q, 0, 1);
}

export function layEgg(s: GameState, h: Hen, nest: Building | null): WorldEgg {
  const type: EggType = h.golden ? 'or' : BREEDS[h.breed].egg;
  const egg: WorldEgg = {
    id: newId(s),
    type,
    quality: eggQuality(s, h, nest),
    freshness: 100,
    where: nest ? 'nest' : 'ground',
    nestId: nest ? nest.id : -1,
    x: h.x,
    z: h.z,
    laidAt: s.clock.t,
  };
  // un coq dans la basse-cour : l'œuf peut être fécondé (pas un œuf d'or)
  const chick = h.golden ? null : fertilize(s, h);
  if (chick) {
    egg.fertile = chick.breed;
    egg.genes = chick.genes;
  }
  if (nest) {
    const c = buildingCenter(nest);
    egg.x = c.x;
    egg.z = c.z;
    nest.eggIds.push(egg.id);
  }
  s.worldEggs.push(egg);
  h.eggsLaid++;
  s.stats.eggsLaid++;
  const day = today(s);
  day.eggs = (day.eggs ?? 0) + 1;
  emit(s, { kind: 'eggLaid', eggId: egg.id, x: egg.x, z: egg.z, ground: !nest });
  return egg;
}

/** Ajoute des œufs au stockage (fusion par type / catégorie / jour / fécondation). Retourne le nombre réellement stocké. */
export function addToStorage(s: GameState, type: EggType, grade: Grade, freshness: number, count: number, fertile?: BreedId, genes?: string): number {
  if (type === 'or') {
    // l'or ne se périme pas et ne prend pas de place : il rejoint le coffre, en attendant le collectionneur
    s.goldEggs = (s.goldEggs ?? 0) + count;
    s.stats.goldEggs = (s.stats.goldEggs ?? 0) + count;
    notify(s, `${count > 1 ? `${count} œufs d’or ramassés` : 'Un œuf d’or ramassé'} ! Il est exposé à l’étal : fixez son prix dans l’onglet Vente (ou cédez-le au collectionneur, ${fmtMoney(RARE.goldCollectorPrice)}).`, 'good', '✨');
    return count;
  }
  const n = Math.min(count, storageFree(s));
  if (n <= 0) return 0;
  const day = currentDay(s);
  if (!fertile) genes = undefined;
  const lot = s.lots.find((l) => l.type === type && l.grade === grade && l.day === day && l.fertile === fertile && l.genes === genes);
  if (lot) {
    lot.freshness = (lot.freshness * lot.count + freshness * n) / (lot.count + n);
    lot.count += n;
  } else {
    s.lots.push({ id: newId(s), type, grade, count: n, freshness, day, ...(fertile ? { fertile } : {}), ...(genes ? { genes } : {}) });
  }
  return n;
}

export function removeWorldEgg(s: GameState, egg: WorldEgg) {
  const i = s.worldEggs.indexOf(egg);
  if (i >= 0) s.worldEggs.splice(i, 1);
  if (egg.where === 'nest') {
    const nest = getBuilding(s, egg.nestId);
    if (nest) {
      const j = nest.eggIds.indexOf(egg.id);
      if (j >= 0) nest.eggIds.splice(j, 1);
    }
  }
}

/** Ramasse une liste d'œufs vers le stockage, dans la limite de la place disponible. */
export function collectEggs(s: GameState, eggs: WorldEgg[], silent = false): number {
  let collected = 0;
  for (const egg of [...eggs]) {
    if (!s.worldEggs.includes(egg)) continue; // déjà ramassé : jamais deux fois
    if (storageFree(s) <= 0) break;
    removeWorldEgg(s, egg);
    collected += addToStorage(s, egg.type, gradeOf(egg.quality), egg.freshness, 1, egg.fertile, egg.genes);
  }
  if (collected > 0) {
    s.stats.eggsCollected += collected;
    addXp(s, collected * XP.eggCollected);
    const ref = eggs[0];
    if (!silent) emit(s, { kind: 'eggsCollected', count: collected, x: ref.x, z: ref.z });
  }
  return collected;
}

export function collectNest(s: GameState, nest: Building, silent = false): number {
  const eggs = nest.eggIds.map((id) => s.worldEggs.find((e) => e.id === id)).filter((e): e is WorldEgg => !!e);
  return collectEggs(s, eggs, silent);
}

/**
 * Retire des œufs du stockage (les plus anciens d'abord). Opération atomique : si la
 * quantité demandée n'est pas disponible, rien n'est retiré et null est retourné.
 */
export function takeFromStorage(
  s: GameState,
  type: EggType,
  qty: number,
  minGrade: Grade = 'B',
): { count: number; value: number; grades: Record<Grade, number>; freshness: number } | null {
  if (qty <= 0) return null;
  const lots = s.lots
    .filter((l) => l.type === type && GRADE_RANK[l.grade] >= GRADE_RANK[minGrade] && l.count > 0)
    // les œufs fécondés sont gardés pour la couveuse : vendus en dernier
    .sort((a, b) => (a.fertile ? 1 : 0) - (b.fertile ? 1 : 0) || a.freshness - b.freshness);
  const available = lots.reduce((a, l) => a + l.count, 0);
  if (available < qty) return null;
  let left = qty;
  const grades: Record<Grade, number> = { extra: 0, A: 0, B: 0 };
  let fresh = 0;
  for (const l of lots) {
    if (left <= 0) break;
    const n = Math.min(l.count, left);
    l.count -= n;
    left -= n;
    grades[l.grade] += n;
    fresh += l.freshness * n;
  }
  s.lots = s.lots.filter((l) => l.count > 0);
  return { count: qty, value: 0, grades, freshness: fresh / qty };
}

/** Lot le plus ancien d'un type (celui qui sera vendu en premier). */
export function oldestLot(s: GameState, type: EggType) {
  let best = null as null | (typeof s.lots)[number];
  for (const l of s.lots) if (l.type === type && l.count > 0 && (!best || l.freshness < best.freshness)) best = l;
  return best;
}

/** Vieillissement continu des œufs (stockés, au pondoir, au sol). */
export function ageEggs(s: GameState, dtDays: number) {
  const st = storage(s);
  const decay = st ? lvl(st).decay ?? 1 : 1;
  let spoiled = 0;
  for (const l of s.lots) {
    l.freshness -= FRESHNESS.decayPerDay * decay * dtDays;
    if (l.freshness <= 0) {
      spoiled += l.count;
      l.count = 0;
    }
  }
  if (spoiled > 0) {
    s.lots = s.lots.filter((l) => l.count > 0);
    s.stats.eggsSpoiled += spoiled;
    notify(s, `${spoiled} œuf${spoiled > 1 ? 's' : ''} périmé${spoiled > 1 ? 's' : ''} jeté${spoiled > 1 ? 's' : ''} du stockage`, 'warn', '🥚');
  }
  let lost = 0;
  let rotten = 0;
  for (const e of [...s.worldEggs]) {
    e.freshness -= (e.where === 'ground' ? FRESHNESS.groundDecayPerDay : FRESHNESS.nestDecayPerDay) * dtDays;
    // pondu par terre et oublié un jour entier : il pourrit, invendable (l'œuf d'or, lui, attend)
    if (e.type === 'or') e.freshness = 100;
    else if (e.where === 'ground' && s.clock.t - e.laidAt >= FRESHNESS.groundRotDays * TIME.DAY) {
      removeWorldEgg(s, e);
      rotten++;
      emit(s, { kind: 'eggRotten', x: e.x, z: e.z });
    } else if (e.freshness <= 0) {
      removeWorldEgg(s, e);
      lost++;
    }
  }
  if (rotten > 0) {
    s.stats.eggsLost += rotten;
    s.stats.eggsRotten += rotten;
    notify(s, `${rotten} œuf${rotten > 1 ? 's' : ''} pondu${rotten > 1 ? 's' : ''} au sol ${rotten > 1 ? 'ont' : 'a'} pourri : perte sèche. Ramassez-les dans la journée.`, 'bad', '🥚');
  }
  if (lost > 0) {
    s.stats.eggsLost += lost;
    notify(s, `${lost} œuf${lost > 1 ? 's' : ''} non ramassé${lost > 1 ? 's' : ''} perdu${lost > 1 ? 's' : ''}`, 'warn', '🥚');
  }
}
