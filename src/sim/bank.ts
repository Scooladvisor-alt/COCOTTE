// Banque : prêts express. L'argent est versé tout de suite ; on rembourse une échéance fixe chaque
// nuit à minuit (avec les autres charges), pendant 7, 14 ou 28 jours (28 jours = une année de jeu).
// Le taux annuel dépend de la saison (taux du moment), de la durée et de la situation de la ferme ;
// il est fixé à la signature. Coût du crédit = capital × taux × durée / 28 jours.
// Même sans le sou (compte à −5 000 €), 50 € sont toujours prêtables ; le plafond grandit avec les
// ventes et la valeur de la ferme. Remboursement anticipé possible, sans frais : seul le capital
// restant est dû.
import { currentDay, emit, newId, notify } from './core';
import { earn, farmLevel, fmtMoney, spend, today, withBookingDay } from './economy';
import { henValue } from './hens';
import { seasonIndex, SEASONS, YEAR_DAYS } from './seasons';
import type { ActionResult, GameState, Loan } from './types';

export const BANK = {
  /** Prêt minimum, toujours accordé (centimes). */
  minLoan: 5000,
  /** Pas du curseur (centimes). */
  step: 1000,
  durations: [7, 14, 28] as const,
  /** Prêts en cours au maximum. */
  maxLoans: 5,
  /** Taux annuel de base selon la saison (printemps, été, automne, hiver). */
  seasonRate: [0.06, 0.05, 0.07, 0.09],
  /** Majoration selon la durée. */
  durationRate: { 7: 0, 14: 0.01, 28: 0.02 } as Record<number, number>,
  /** Majoration quand le compte est à découvert. */
  overdraftRate: 0.05,
  /** Majoration quand on est déjà très endetté (plus de la moitié du plafond). */
  heavyDebtRate: 0.03,
  /** Pauses d'échéances possibles (jours), une seule fois par prêt. */
  pauses: [3, 7] as const,
};

export type Duration = (typeof BANK.durations)[number];

/** Capital restant dû sur tous les prêts. */
export const totalDebt = (s: GameState) => s.loans.reduce((a, l) => a + l.capitalLeft, 0);
/** Échéances à payer cette nuit. */
export const dailyDue = (s: GameState) => s.loans.reduce((a, l) => a + ((l.pausedUntil ?? 0) >= currentDay(s) ? 0 : Math.min(l.daily, l.capitalLeft + l.interestLeft)), 0);

/** Ventes moyennes par jour sur la dernière semaine (sert à évaluer la capacité de remboursement). */
function avgSales(s: GameState) {
  const days = s.finance.days.slice(-8, -1);
  if (!days.length) return 0;
  const sum = days.reduce((a, d) => a + (d.income.etal ?? 0) + (d.income.cooperative ?? 0) + (d.income.commandes ?? 0) + (d.income.contrats ?? 0), 0);
  return sum / days.length;
}

/** Valeur de la ferme : installations (prix payé) et volailles. */
function farmAssets(s: GameState) {
  return s.buildings.reduce((a, b) => a + b.invested, 0) + s.hens.reduce((a, h) => a + henValue(h), 0);
}

/** Ce que la banque accepterait de prêter au total (avant déduction des dettes). */
function grossLimit(s: GameState) {
  return BANK.minLoan + avgSales(s) * 14 + farmAssets(s) * 0.4 + farmLevel(s) * 3000;
}

/** Montant maximum empruntable maintenant (jamais moins de 50 €). */
export function creditLimit(s: GameState) {
  const raw = grossLimit(s) - totalDebt(s);
  return Math.max(BANK.minLoan, Math.floor(raw / BANK.step) * BANK.step);
}

/** Taux annuel proposé aujourd'hui pour une durée, avec le détail de son calcul. */
export function loanRate(s: GameState, days: Duration) {
  const sea = seasonIndex(s);
  const parts: Array<{ label: string; rate: number }> = [{ label: `Taux de base (${SEASONS[sea].name.toLowerCase()})`, rate: BANK.seasonRate[sea] }];
  if (BANK.durationRate[days]) parts.push({ label: `Durée ${days} jours`, rate: BANK.durationRate[days] });
  if (s.money < 0) parts.push({ label: 'Compte à découvert', rate: BANK.overdraftRate });
  if (totalDebt(s) > grossLimit(s) * 0.5) parts.push({ label: 'Déjà très endetté', rate: BANK.heavyDebtRate });
  return { rate: parts.reduce((a, p) => a + p.rate, 0), parts };
}

/** Simulation d'un prêt : échéance quotidienne, total remboursé, coût du crédit. */
export function quoteLoan(s: GameState, amount: number, days: Duration) {
  const { rate, parts } = loanRate(s, days);
  const interest = Math.round(amount * rate * (days / YEAR_DAYS));
  const daily = Math.ceil((amount + interest) / days);
  return { amount, days, rate, parts, interest, daily, total: amount + interest };
}

export function takeLoan(s: GameState, amount: number, days: Duration): ActionResult {
  if (!BANK.durations.includes(days)) return { ok: false, reason: 'Durée invalide' };
  amount = Math.round(amount);
  if (!Number.isFinite(amount) || amount < BANK.minLoan) return { ok: false, reason: `Minimum ${fmtMoney(BANK.minLoan)}` };
  if (s.loans.length >= BANK.maxLoans) return { ok: false, reason: `${BANK.maxLoans} prêts en cours au maximum : remboursez-en un d’abord` };
  const limit = creditLimit(s);
  if (amount > limit) return { ok: false, reason: `La banque vous prête au plus ${fmtMoney(limit)}` };
  const q = quoteLoan(s, amount, days);
  const loan: Loan = { id: newId(s), principal: amount, rate: q.rate, days, daily: q.daily, paid: 0, capitalLeft: amount, interestLeft: q.interest, day: currentDay(s) };
  s.loans.push(loan);
  earn(s, amount, 'emprunt', `Prêt de ${fmtMoney(amount)} sur ${days} jours`);
  today(s).debtEnd = totalDebt(s);
  notify(s, `Prêt accordé : ${fmtMoney(amount)} versés. Échéance de ${fmtMoney(q.daily)} chaque nuit pendant ${days} jours.`, 'good', '🏦');
  emit(s, { kind: 'money', amount, x: 15, z: 26 });
  return { ok: true };
}

/** Rembourse un prêt par anticipation : seul le capital restant est dû (intérêts restants annulés). */
export function repayLoan(s: GameState, id: number): ActionResult {
  const loan = s.loans.find((l) => l.id === id);
  if (!loan) return { ok: false, reason: 'Prêt introuvable' };
  if (s.money < loan.capitalLeft) return { ok: false, reason: `Il faut ${fmtMoney(loan.capitalLeft)} sur le compte` };
  spend(s, loan.capitalLeft, 'capital', `Remboursement anticipé du prêt de ${fmtMoney(loan.principal)}`);
  s.loans = s.loans.filter((l) => l !== loan);
  today(s).debtEnd = totalDebt(s);
  notify(s, `Prêt remboursé par anticipation : ${fmtMoney(loan.interestLeft)} d’intérêts économisés.`, 'good', '🏦');
  return { ok: true };
}

/** Intérêts supplémentaires d'une pause : le capital restant continue de coûter pendant la pause. */
export function pauseCost(loan: Loan, days: number) {
  return Math.round(loan.capitalLeft * loan.rate * (days / YEAR_DAYS));
}

export const isPaused = (s: GameState, loan: Loan) => (loan.pausedUntil ?? 0) >= currentDay(s);

/**
 * Suspend les échéances d'un prêt pendant quelques jours (une fois par prêt). Les intérêts courent
 * toujours : leur surcoût est réparti sur les échéances restantes, qui reprennent ensuite.
 */
export function pauseLoan(s: GameState, id: number, days: number): ActionResult {
  const loan = s.loans.find((l) => l.id === id);
  if (!loan) return { ok: false, reason: 'Prêt introuvable' };
  if (!BANK.pauses.includes(days as 3 | 7)) return { ok: false, reason: 'Durée de pause invalide' };
  if (loan.paused) return { ok: false, reason: 'Ce prêt a déjà bénéficié d’une pause' };
  const extra = pauseCost(loan, days);
  loan.interestLeft += extra;
  loan.pausedUntil = currentDay(s) + days - 1;
  loan.paused = true;
  const left = Math.max(1, loan.days - loan.paid);
  loan.daily = Math.ceil((loan.capitalLeft + loan.interestLeft) / left);
  notify(s, `Échéances suspendues ${days} jours (jusqu’au jour ${loan.pausedUntil}). Intérêts en plus : ${fmtMoney(extra)} ; nouvelle échéance ensuite : ${fmtMoney(loan.daily)}.`, 'info');
  return { ok: true };
}

/** À minuit (clôture du jour) : prélèvement des échéances, même à découvert. */
export function payLoans(s: GameState, day: number) {
  withBookingDay(day, () => {
    for (const loan of [...s.loans]) {
      if ((loan.pausedUntil ?? 0) >= day) continue; // échéances suspendues
      const last = loan.paid === loan.days - 1;
      const capital = last ? loan.capitalLeft : Math.min(loan.capitalLeft, Math.round(loan.principal / loan.days));
      const interest = last ? loan.interestLeft : Math.min(loan.interestLeft, Math.max(0, loan.daily - capital));
      spend(s, capital, 'capital', `Échéance du prêt (${loan.paid + 1}/${loan.days})`, true);
      spend(s, interest, 'interets', `Intérêts du prêt (${loan.paid + 1}/${loan.days})`, true);
      loan.capitalLeft -= capital;
      loan.interestLeft -= interest;
      loan.paid++;
      if (loan.paid >= loan.days || loan.capitalLeft + loan.interestLeft <= 0) {
        s.loans = s.loans.filter((l) => l !== loan);
        notify(s, `Prêt de ${fmtMoney(loan.principal)} entièrement remboursé.`, 'good', '🏦');
      }
    }
    today(s).debtEnd = totalDebt(s);
  });
}
