// Logique financière centralisée : toutes les entrées/sorties d'argent passent ici.
import { LEVELS, LEVEL_GATES, WORLD, levelAt } from '../config/balance';
import { BREEDS } from '../config/breeds';
import { currentDay, currentHour, emit } from './core';
import type { DayFinance, ExpenseCat, GameState, IncomeCat, BreedId } from './types';

export const INCOME_LABELS: Record<IncomeCat, string> = {
  etal: 'Ventes à l’étal',
  cooperative: 'Coopérative',
  commandes: 'Commandes',
  contrats: 'Contrats',
  primes: 'Primes de mission',
  reventes: 'Reventes',
  emprunt: 'Prêts reçus',
};
export const EXPENSE_LABELS: Record<ExpenseCat, string> = {
  grain: 'Grain',
  eau: 'Eau',
  entretien: 'Entretien',
  foncier: 'Taxe foncière',
  salaires: 'Salaires',
  poules: 'Achat de poules',
  constructions: 'Constructions',
  terrain: 'Terrain',
  soins: 'Vétérinaire',
  litiere: 'Litière',
  penalites: 'Pénalités',
  agios: 'Agios',
  interets: 'Intérêts d’emprunt',
  capital: 'Remboursement du capital',
};
/** Charges de fonctionnement (vs investissements). */
export const OPERATING: ExpenseCat[] = ['grain', 'eau', 'entretien', 'foncier', 'salaires', 'soins', 'litiere', 'penalites', 'agios', 'interets'];
/**
 * Mouvements de financement (argent emprunté, capital remboursé) : ils passent par le compte
 * mais ne sont ni des revenus ni des dépenses de la ferme (les intérêts, eux, sont une charge).
 */
export const FINANCING_IN: IncomeCat[] = ['emprunt'];
export const FINANCING_OUT: ExpenseCat[] = ['capital'];

// Pendant la clôture d'une journée, les écritures sont imputées au jour clôturé.
let bookingDay: number | null = null;
export function withBookingDay<T>(day: number, fn: () => T): T {
  const prev = bookingDay;
  bookingDay = day;
  try {
    return fn();
  } finally {
    bookingDay = prev;
  }
}

export function today(s: GameState): DayFinance {
  const day = bookingDay ?? currentDay(s);
  const days = s.finance.days;
  let d: DayFinance | undefined = days[days.length - 1];
  if (!d || d.day !== day) {
    d = days.find((x) => x.day === day);
    if (!d) {
      d = { day, income: {}, expense: {}, cashStart: s.money, cashEnd: s.money, debtEnd: (s.loans ?? []).reduce((a, l) => a + l.capitalLeft, 0) };
      days.push(d);
      days.sort((a, b) => a.day - b.day);
      if (days.length > 40) days.splice(0, days.length - 40);
    }
  }
  return d;
}

function log(s: GameState, label: string, amount: number, cat: IncomeCat | ExpenseCat) {
  const day = bookingDay ?? currentDay(s);
  const hour = bookingDay !== null ? 24 : currentHour(s);
  const l = s.finance.log;
  const last = l[0];
  if (last && last.label === label && last.day === day && Math.abs(last.hour - hour) < 1.5 && Math.sign(last.amount) === Math.sign(amount)) {
    last.amount += amount;
    last.hour = hour;
  } else {
    l.unshift({ day, hour, label, amount, cat });
    if (l.length > 60) l.length = 60;
  }
}

export function canAfford(s: GameState, amount: number) {
  return Number.isFinite(amount) && amount >= 0 && s.money >= amount;
}

/**
 * Débite le compte. Refuse si le solde est insuffisant, sauf `force` (charges obligatoires
 * comme l'entretien ou les factures, qui peuvent creuser un découvert).
 */
export function spend(s: GameState, amount: number, cat: ExpenseCat, label: string, force = false): boolean {
  amount = Math.round(amount);
  if (!Number.isFinite(amount) || amount < 0) return false;
  if (amount === 0) return true;
  if (!force && s.money < amount) return false;
  s.money -= amount;
  const d = today(s);
  d.expense[cat] = (d.expense[cat] ?? 0) + amount;
  d.cashEnd = s.money;
  if (!FINANCING_OUT.includes(cat)) s.stats.totalExpense += amount;
  log(s, label, -amount, cat);
  return true;
}

export function earn(s: GameState, amount: number, cat: IncomeCat, label: string) {
  amount = Math.round(amount);
  if (!Number.isFinite(amount) || amount <= 0) return;
  s.money += amount;
  const d = today(s);
  d.income[cat] = (d.income[cat] ?? 0) + amount;
  d.cashEnd = s.money;
  if (!FINANCING_IN.includes(cat)) s.stats.totalIncome += amount;
  if (cat === 'etal' || cat === 'cooperative' || cat === 'commandes' || cat === 'contrats') s.stats.salesRevenue += amount;
  log(s, label, amount, cat);
}

/** Revenus de la ferme (hors argent emprunté). */
export function sumIncome(d: DayFinance) {
  return Object.entries(d.income).reduce((a, [k, v]) => a + (FINANCING_IN.includes(k as IncomeCat) ? 0 : v ?? 0), 0);
}
/** Dépenses de la ferme (hors capital remboursé). */
export function sumExpense(d: DayFinance, only?: ExpenseCat[]) {
  return Object.entries(d.expense).reduce((a, [k, v]) => a + ((only ? only.includes(k as ExpenseCat) : !FINANCING_OUT.includes(k as ExpenseCat)) ? v ?? 0 : 0), 0);
}

// ---------------------------------------------------------------- XP ----
export function levelOf(xp: number) {
  let lvl = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.xp) lvl = l;
  // au-delà du dernier palier de la table : les niveaux continuent sans fin
  if (lvl.level === LEVELS[LEVELS.length - 1].level) {
    let n = lvl.level;
    while (n < 999 && xp >= levelAt(n + 1).xp) n++;
    if (n > lvl.level) return levelAt(n);
  }
  return lvl;
}
export function farmLevel(s: GameState) {
  return levelOf(s.xp).level;
}
export function levelDef(s: GameState) {
  return levelOf(s.xp);
}
/** Niveau pris en compte pour les achats : le plus haut quand les niveaux requis sont désactivés. */
export function buyLevel(s: GameState) {
  return LEVEL_GATES ? farmLevel(s) : LEVELS[LEVELS.length - 1].level;
}
/** Niveau suffisant pour un achat ? (toujours vrai quand les niveaux requis sont désactivés) */
export function levelReached(s: GameState, req: number) {
  return !LEVEL_GATES || farmLevel(s) >= req;
}
/** Une race s'achète-t-elle déjà ? (les oies exigent vraiment le niveau 10) */
export function breedUnlocked(s: GameState, breed: BreedId) {
  const def = BREEDS[breed];
  return def.strictLevel ? farmLevel(s) >= def.reqLevel : levelReached(s, def.reqLevel);
}
/** Niveau qui verrouille l'achat d'une race, ou undefined. */
export function breedLockedAt(s: GameState, breed: BreedId): number | undefined {
  return breedUnlocked(s, breed) ? undefined : BREEDS[breed].reqLevel;
}
/** Niveau qui verrouille un achat, ou undefined s'il est accessible. */
export function lockedAt(s: GameState, req: number): number | undefined {
  return levelReached(s, req) ? undefined : req;
}
/** Parcelles et poulaillers autorisés (toute la carte et le maximum quand il n'y a pas de limite de niveau). */
export function maxParcelsOf(s: GameState) {
  return LEVEL_GATES ? levelDef(s).maxParcels : WORLD.COLS * WORLD.ROWS;
}
export function maxCoopsOf(s: GameState) {
  return LEVEL_GATES ? levelDef(s).maxCoops : Math.max(...LEVELS.map((l) => l.maxCoops));
}
export function nextLevelDef(s: GameState) {
  const cur = levelOf(s.xp);
  return levelAt(cur.level + 1);
}
export function addXp(s: GameState, amount: number) {
  if (amount <= 0) return;
  const before = farmLevel(s);
  s.xp += Math.round(amount);
  const after = farmLevel(s);
  for (let l = before + 1; l <= after; l++) emit(s, { kind: 'levelUp', level: l });
}

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EUR0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
export function fmtMoney(cents: number, compact = false) {
  if (compact && Math.abs(cents) >= 1000000) return EUR0.format(Math.round(cents / 100));
  return EUR.format(cents / 100);
}
export function fmtSigned(cents: number) {
  return (cents > 0 ? '+' : cents < 0 ? '−' : '') + fmtMoney(Math.abs(cents));
}
