// Concours agricole : le dernier jour de chaque saison (tous les 7 jours), à 15 h, l'éleveur présente
// sa plus belle volaille. Elle est notée sur sa beauté, ses qualités, sa santé et sa forme, face à
// trois autres éleveurs. Le gagnant monte de catégorie (village → … → Concours général agricole) :
// les rivaux sont plus forts, les prix plus gros. Il faut sélectionner sa lignée pour aller au bout.
import { TIME } from '../config/balance';
import { BREED_ORDER } from '../config/breeds';
import { currentDay, currentHour, emit, notify, pick, rand, randNormal } from './core';
import { addXp, earn, fmtMoney } from './economy';
import { genesOf } from './genetics';
import { SEASON_DAYS } from './seasons';
import type { ActionResult, BreedId, GameState, Hen, ShowResult } from './types';

export const SHOW_HOUR = 15;

export const SHOW_TIERS = [
  { name: 'Concours du village', short: 'Village', rival: 50, prize: 3000, rep: 2 },
  { name: 'Concours cantonal', short: 'Canton', rival: 60, prize: 8000, rep: 3 },
  { name: 'Comice départemental', short: 'Département', rival: 70, prize: 20000, rep: 4 },
  { name: 'Salon régional', short: 'Région', rival: 80, prize: 50000, rep: 6 },
  { name: 'Concours général agricole', short: 'National', rival: 90, prize: 150000, rep: 10 },
];
/** Part du premier prix versée aux 2e et 3e. */
const PLACE_SHARE = [1, 0.4, 0.2];

const RIVAL_FARMS = [
  'Ferme des Tilleuls',
  'Élevage Garnier',
  'La Basse-Cour Dupuis',
  'Ferme du Moulin',
  'Les Plumes de Margot',
  'Domaine des Saules',
  'Ferme Perrin',
  'Le Poulailler d’Hortense',
  'Élevage des Trois Chênes',
  'Ferme de la Combe',
];
const RIVAL_NAMES = ['Duchesse', 'Rosalie', 'Perle', 'Câline', 'Églantine', 'Mirabelle', 'Opale', 'Praline', 'Violette', 'Cerise', 'Bergamote', 'Capucine'];

/** Jour du prochain concours (le dernier jour de la saison en cours). */
export function nextShowDay(s: GameState) {
  const d = currentDay(s);
  let show = Math.ceil(d / SEASON_DAYS) * SEASON_DAYS;
  if (show === d && (currentHour(s) >= SHOW_HOUR + 1 || s.show.lastDay >= d)) show += SEASON_DAYS;
  return show;
}

/** Une volaille peut concourir : adulte, en bonne santé, pas malade. */
export function eligible(h: Hen) {
  return !h.young && !h.sick && h.health >= 30;
}

/** Note de concours (sur ~110) : la beauté compte double, puis ponte, robustesse, santé, forme, race. */
export function showScore(h: Hen) {
  const g = genesOf(h);
  const prestige = (BREED_ORDER.indexOf(h.breed) / Math.max(1, BREED_ORDER.length - 1)) * 6;
  const prime = h.age > 150 ? -6 : 0; // les vieilles poules perdent de leur éclat
  return Math.round(10 * g.b + 4 * g.p + 4 * g.r + h.health * 0.08 + h.wellbeing * 0.07 + ((h.protein ?? 0) > 50 ? 3 : 0) + prestige + prime);
}

/** Meilleures candidates de la ferme, de la plus belle à la moins belle. */
export function showCandidates(s: GameState) {
  return s.hens
    .filter(eligible)
    .map((h) => ({ hen: h, score: showScore(h) }))
    .sort((a, b) => b.score - a.score);
}

/** Inscription (un seul animal par concours ; -1 : la meilleure, d'office). */
export function enterShow(s: GameState, henId: number): ActionResult {
  const h = s.hens.find((x) => x.id === henId);
  if (!h) return { ok: false, reason: 'Volaille introuvable' };
  if (h.young) return { ok: false, reason: 'Trop jeune pour concourir' };
  if (!eligible(h)) return { ok: false, reason: 'Elle doit être en bonne santé pour concourir' };
  s.show.entryId = h.id;
  notify(s, `${h.name} est inscrite au ${SHOW_TIERS[s.show.tier].name} (jour ${nextShowDay(s)}, ${SHOW_HOUR} h).`, 'good', '🏆');
  return { ok: true };
}

/** Rappels et déroulement du concours (appelé chaque heure). */
export function showHourly(s: GameState) {
  const day = currentDay(s);
  const h = currentHour(s);
  const tier = SHOW_TIERS[s.show.tier];
  const showToday = day % SEASON_DAYS === 0;
  // rappel la veille au soir, puis le matin du concours
  if ((showToday && h >= 8 && h < SHOW_HOUR) || (day % SEASON_DAYS === SEASON_DAYS - 1 && h >= 18)) {
    const key = showToday ? day * 2 + 1 : day * 2;
    if (s.show.remindDay !== key && s.hens.some(eligible)) {
      s.show.remindDay = key;
      const entry = s.hens.find((x) => x.id === s.show.entryId && eligible(x));
      notify(
        s,
        `${showToday ? 'Aujourd’hui' : 'Demain'} à ${SHOW_HOUR} h : ${tier.name} (1er prix ${fmtMoney(tier.prize)}). ${entry ? `${entry.name} est inscrite.` : 'Inscrivez votre plus belle poule (fiche de la poule ou Missions).'}`,
        'info',
        '🏆',
      );
    }
  }
  if (showToday && h >= SHOW_HOUR && s.show.lastDay < day) runShow(s);
}

function runShow(s: GameState) {
  const day = currentDay(s);
  s.show.lastDay = day;
  const cands = showCandidates(s);
  if (!cands.length) {
    notify(s, `${SHOW_TIERS[s.show.tier].name} : aucune volaille en état de concourir cette fois-ci.`, 'warn', '🏆');
    return;
  }
  let entry = cands.find((c) => c.hen.id === s.show.entryId);
  const auto = !entry;
  if (!entry) entry = cands[0];
  const tierIdx = s.show.tier;
  const tier = SHOW_TIERS[tierIdx];
  const hen = entry.hen;
  // le jour J, un peu de chance (la tenue, le juge…)
  const myScore = Math.round(entry.score + randNormal(s) * 3);
  const farms = [...RIVAL_FARMS];
  const rivals = [0, 1, 2].map(() => {
    const farm = farms.splice(Math.floor(rand(s) * farms.length), 1)[0];
    const breed = pick(s, BREED_ORDER) as BreedId;
    return { name: pick(s, RIVAL_NAMES), farm, breed, score: Math.round(tier.rival + randNormal(s) * 7), mine: false };
  });
  const ranking = [{ name: hen.name, farm: s.farmName, breed: hen.breed, score: myScore, mine: true }, ...rivals].sort((a, b) => b.score - a.score || (a.mine ? -1 : 1));
  const place = ranking.findIndex((r) => r.mine) + 1;
  const prize = place <= 3 ? Math.round((tier.prize * PLACE_SHARE[place - 1]) / 100) * 100 : 0;
  s.stats.showsEntered++;
  if (prize > 0) earn(s, prize, 'primes', `${tier.name} : ${place === 1 ? '1er' : `${place}e`} prix (${hen.name})`);
  if (place <= 3) {
    s.show.trophies.push({ day, tier: tierIdx, place, hen: hen.name, breed: hen.breed });
    s.reputation = Math.min(100, s.reputation + tier.rep / place);
  }
  addXp(s, Math.round((20 + 15 * tierIdx) / place));
  const promoted = place === 1 && tierIdx < SHOW_TIERS.length - 1;
  if (place === 1) s.stats.showsWon++;
  if (promoted) s.show.tier++;
  s.show.entryId = -1;
  const result: ShowResult = { day, tier: tierIdx, place, prize, henId: hen.id, henName: hen.name, breed: hen.breed, score: myScore, ranking, promoted, auto };
  emit(s, { kind: 'showResult', result });
  const medal = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '🎗️';
  notify(
    s,
    `${tier.name} : ${hen.name} termine ${place === 1 ? '1re' : `${place}e`} sur ${ranking.length}${prize ? ` (+${fmtMoney(prize)})` : ''}.${promoted ? ` Prochaine étape : ${SHOW_TIERS[s.show.tier].name} !` : ''}`,
    place <= 3 ? 'good' : 'info',
    medal,
  );
}

/** Pour l'affichage : dans combien de jours (et d'heures) a lieu le prochain concours. */
export function showCountdown(s: GameState) {
  const day = nextShowDay(s);
  const hoursLeft = (day - 1) * 24 + SHOW_HOUR - s.clock.t / (TIME.DAY / 24);
  return { day, hoursLeft, daysLeft: Math.max(0, Math.ceil(hoursLeft / 24 - 0.01)) };
}

export const trophyCount = (s: GameState, place: number) => s.show.trophies.filter((t) => t.place === place).length;
