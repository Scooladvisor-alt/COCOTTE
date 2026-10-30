// Boucle de simulation à pas fixe. Le temps simulé ne dépend jamais du nombre d'images :
// une machine rapide exécute exactement les mêmes pas qu'une machine lente.
import { COSTS, GRAIN_SACKS, HEALTH, HOUR, ROBOT, TIME, UNLOCKS, WATER } from '../config/balance';
import { grainCapacity, grainPerDay, waterCapacity, waterPerDay } from './stocks';
import { BREEDS } from '../config/breeds';
import { buyGrain, fillTank } from './actions';
import { autoRefill, compostTick, coopDirt } from './buildings';
import { autoIncubate, breedingHourly, incubatorTick } from './breeding';
import { currentDay, currentHour, emit, notify, rand, isShelter } from './core';
import { farmLevel, fmtMoney, levelReached, spend, today, withBookingDay } from './economy';
import { ageEggs, collectNest } from './eggs';
import { regrowGrass } from './grass';
import { isLayer, productivity, updateHens } from './hens';
import { perksAt } from './perks';
import { frailty } from './genetics';
import { SEASONS, YEAR_DAYS, seasonIndexOfDay } from './seasons';
import { showHourly } from './show';
import { dailyDue, payLoans } from './bank';
import { maybeSpawnPredator, setPredatorsQuiet, updatePredators } from './predators';
import { updateRobots } from './robots';
import { dogUpkeep, updateDog } from './dog';
import { updateVaults } from './vault';
import { updateDeliveries } from './actions';
import { autoWholesale, checkOrdersReady, deliverContracts, marketNewDay, updateCustomers } from './market';
import { checkMissions } from './progression';
import { dailyWages, hasRole, onDuty, resetWorkersDay, separateBodies, updateWorkers } from './workers';
import { ROLES, STAFF } from '../config/staff';
import { buildingsOf, lvl, storageFree, totalUpkeep } from './queries';
import type { GameState } from './types';

interface Acc {
  real: number;
  grass: number;
  missions: number;
  warn: Record<string, number>;
}
const accs = new WeakMap<GameState, Acc>();
function acc(s: GameState) {
  let a = accs.get(s);
  if (!a) accs.set(s, (a = { real: 0, grass: 0, missions: 0, warn: {} }));
  return a;
}

/** Avertissement limité à une fois toutes les `everyHours` heures de jeu. */
function warnOnce(s: GameState, key: string, text: string, everyHours: number, tone: 'warn' | 'bad' = 'warn', icon?: string) {
  const a = acc(s);
  const now = s.clock.t;
  if (a.warn[key] !== undefined && now - a.warn[key] < everyHours * HOUR) return;
  a.warn[key] = now;
  notify(s, text, tone, icon);
}

// ------------------------------------------------- Clôture quotidienne ----
export function dailyCharges(s: GameState) {
  const upkeep = totalUpkeep(s) + s.robots.length * ROBOT.upkeepPerDay + dogUpkeep(s);
  const land = s.parcels.length * COSTS.landTaxPerParcel;
  const wages = dailyWages(s);
  const loans = dailyDue(s);
  return { upkeep, land, wages, loans, total: upkeep + land + wages + loans };
}

/** Clôture de la journée `day` : exécutée exactement une fois par jour (garde lastClosedDay). */
export function closeDay(s: GameState, day: number) {
  if (day <= s.clock.lastClosedDay) return;
  s.clock.lastClosedDay = day;
  const c = dailyCharges(s);
  // échéances des prêts (avant le calcul des agios)
  payLoans(s, day);
  withBookingDay(day, () => {
    spend(s, c.upkeep, 'entretien', 'Entretien des installations', true);
    spend(s, c.land, 'foncier', 'Taxe foncière', true);
    for (const w of s.workers) spend(s, ROLES[w.role].wage, 'salaires', `Salaire de ${w.name}`, true);
    if (s.money < 0) spend(s, Math.max(1, Math.round(-s.money * COSTS.overdraftRate)), 'agios', 'Agios (découvert)', true);
    today(s).cashEnd = s.money;
  });

  // maladies : seulement quand quelque chose ne va pas (poulailler sale, poule stressée, mal
  // nourrie ou affaiblie). Une poule bien soignée, au propre, nourrie et abreuvée ne tombe pas malade.
  for (const h of s.hens) {
    if (h.sick) continue;
    const coop = s.buildings.find((b) => b.id === h.coopId);
    const risk = (coop ? coop.cleanliness < 50 : true) || h.wellbeing < 45 || h.health < 50 || h.satiety < 15 || h.hydration < 15;
    if (!risk) continue;
    const dirty = coop && coop.cleanliness < 50 ? 2.5 : 1;
    const care = hasRole(s, 'caretaker') ? STAFF.caretakerSickFactor : 1;
    // un bain de poussière dans la parcelle du poulailler débarrasse des parasites
    const dust = coop ? perksAt(s, coop.x + 1.5, coop.z + 1).sick : 1;
    if (rand(s) < HEALTH.sickChancePerDay * dirty * care * dust * BREEDS[h.breed].sensitivity * frailty(h)) {
      h.sick = true;
      notify(s, `${h.name} est malade. Le vétérinaire peut la soigner.`, 'warn', '🤒');
    }
  }

  marketNewDay(s);
  resetWorkersDay(s);
  // les nouveaux enregistrements financiers démarrent avec le solde actuel
  today(s);
  emit(s, { kind: 'newDay', day: day + 1 });
  // changement de saison (et nouvelle année)
  if (seasonIndexOfDay(day + 1) !== seasonIndexOfDay(day)) {
    const sea = SEASONS[seasonIndexOfDay(day + 1)];
    const year = Math.floor(day / YEAR_DAYS) + 1;
    notify(s, `${sea.id === 'printemps' ? `Année ${year} · ` : ''}${sea.intro}`, 'info', sea.icon);
  }
  notify(s, `Jour ${day} clôturé — charges : ${fmtMoney(c.total)}`, 'info', '📒');
  if (s.money < 0) notify(s, `Compte à découvert (${fmtMoney(s.money)}) : des agios de ${Math.round(COSTS.overdraftRate * 100)} %/jour s’appliquent. Vendez des œufs !`, 'bad', '🏦');
  else if (s.money < dailyCharges(s).total * 2) notify(s, `Trésorerie basse : ${fmtMoney(s.money)} pour ${fmtMoney(dailyCharges(s).total)} de charges/jour.`, 'warn', '💶');
}

// ---------------------------------------------------- Tâches horaires ----
function hourly(s: GameState) {
  const level = farmLevel(s);

  // relevé du taux de ponte moyen des pondeuses (pour la courbe de la page Poules)
  const layers = s.hens.filter(isLayer);
  if (layers.length) {
    const d = today(s);
    d.laySum = (d.laySum ?? 0) + layers.reduce((a, h) => a + productivity(h), 0) / layers.length;
    d.layN = (d.layN ?? 0) + 1;
  }

  // Réapprovisionnement automatique du grain
  if (s.settings.autoGrain && level >= UNLOCKS.autoGrain && s.grain < s.settings.autoGrainThreshold) {
    // le sac choisi, ou un plus petit s'il ne rentre pas dans la réserve
    const wanted = GRAIN_SACKS.findIndex((g) => g.id === s.settings.autoGrainSack);
    const candidates = GRAIN_SACKS.slice(0, Math.max(1, wanted + 1)).filter((g) => levelReached(s, g.reqLevel)).reverse();
    const sack = candidates.find((g) => s.grain + g.rations <= grainCapacity(s));
    if (sack) {
      const r = buyGrain(s, sack.id);
      if (!r.ok) warnOnce(s, 'autograin', 'Achat automatique de grain impossible : fonds insuffisants.', 6, 'bad', '🌾');
    }
  }

  // Raccordement : la cuve se remplit automatiquement sous le seuil choisi
  if (s.settings.autoWater && level >= WATER.autoUnlock && s.water < (waterCapacity(s) * s.settings.autoWaterThreshold) / 100) {
    const r = fillTank(s);
    if (!r.ok) warnOnce(s, 'autowater', 'Achat automatique d’eau impossible : fonds insuffisants.', 6, 'bad', '💧');
  }

  // Pondoirs à rouleau : collecte automatique
  for (const n of buildingsOf(s, 'nest')) if (lvl(n).autoCollect && n.eggIds.length > 0) collectNest(s, n);

  autoWholesale(s);
  // commandes dont le stock est prêt : on propose de livrer
  checkOrdersReady(s);

  // De temps en temps, un renard ou une buse tente sa chance
  maybeSpawnPredator(s);
  breedingHourly(s);
  showHourly(s);

  // Alertes de gestion
  if (s.hens.length > 0) {
    const feeders = buildingsOf(s, 'feeder');
    if (feeders.length && feeders.every((f) => f.stock < 1) && s.grain < 1)
      warnOnce(s, 'grain', 'Mangeoires vides et plus de grain : vos poules vont avoir faim !', 4, 'bad', '🌾');
    else if (feeders.some((f) => f.stock < 1) && !feeders.every((f) => lvl(f).auto))
      warnOnce(s, 'feeder', 'Une mangeoire est vide : remplissez-la.', 4, 'warn', '🌾');
    const drinkers = buildingsOf(s, 'drinker');
    if (drinkers.length && drinkers.every((d) => d.stock < 0.5) && s.water < 0.5)
      warnOnce(s, 'water', 'Abreuvoirs vides et cuve à sec : achetez de l’eau tout de suite !', 3, 'bad', '💧');
    else if (drinkers.length && drinkers.some((d) => d.stock < 0.5)) warnOnce(s, 'water', 'Un abreuvoir est vide : vos poules ont soif !', 3, 'bad', '💧');
    if (s.water < waterPerDay(s) * 0.6 && s.water < waterCapacity(s) * 0.3) warnOnce(s, 'tank', 'La cuve d’eau est presque vide : pensez à la remplir.', 8, 'warn', '💧');
    if (s.grain < grainPerDay(s) * 0.6 && s.grain < grainCapacity(s) * 0.3) warnOnce(s, 'bin', 'La réserve de grain est presque vide.', 8, 'warn', '🌾');
    if (storageFree(s) <= 0) warnOnce(s, 'storage', 'Stockage plein : vendez des œufs ou agrandissez-le.', 5, 'warn', '📦');
    const onGround = s.worldEggs.filter((e) => e.where === 'ground').length;
    if (onGround >= 3)
      warnOnce(s, 'ground', `${onGround} œufs pondus par terre : ramassez-les dans la journée avant qu’ils ne pourrissent${buildingsOf(s, 'nest').length ? ', et ajoutez un pondoir si les vôtres débordent' : ''}.`, 8, 'warn', '🥚');
    const dirty = s.buildings.find((c) => isShelter(c) && c.cleanliness < 35);
    if (dirty) warnOnce(s, 'dirty', 'Un poulailler est sale : nettoyez-le pour éviter les maladies.', 6, 'warn', '🧹');
    const fragile = s.hens.find((x) => x.health < HEALTH.warnAt);
    if (fragile) warnOnce(s, 'health', `${fragile.name} est en mauvaise santé.`, 6, 'bad', '❤️');
  }
}

// ------------------------------------------------------------- Pas fixe ----
export function step(s: GameState, dt: number) {
  s.clock.t += dt;
  const day = currentDay(s);
  while (s.clock.lastClosedDay < day - 1) closeDay(s, s.clock.lastClosedDay + 1);

  const hourIdx = Math.floor(s.clock.t / HOUR);
  if (hourIdx - s.clock.lastHourTick > 48) s.clock.lastHourTick = hourIdx - 48;
  while (s.clock.lastHourTick < hourIdx) {
    s.clock.lastHourTick++;
    hourly(s);
  }
  if (currentHour(s) >= TIME.CONTRACT_HOUR && s.clock.lastContractDay < day) {
    s.clock.lastContractDay = day;
    deliverContracts(s);
  }

  updatePredators(s, dt);
  updateHens(s, dt);
  updateWorkers(s, dt);
  updateRobots(s, dt);
  updateDeliveries(s);
  updateDog(s, dt);
  // personne ne traverse le grillage : on saute par-dessus
  updateVaults(s, dt);
  separateBodies(s);
  updateCustomers(s, dt);
  autoRefill(s);
  compostTick(s, dt);
  autoIncubate(s);
  incubatorTick(s);
  coopDirt(s, dt);
  ageEggs(s, dt / TIME.DAY);

  const a = acc(s);
  a.grass += dt;
  if (a.grass >= 1) {
    regrowGrass(s, (a.grass / TIME.DAY) * (onDuty(s, 'gardener') ? STAFF.gardenerRegrowth : 1));
    a.grass = 0;
  }
  a.missions += dt;
  if (a.missions >= 0.5) {
    a.missions = 0;
    checkMissions(s);
  }
}

/**
 * Avance la simulation d'un intervalle réel (secondes), à la vitesse choisie.
 * Retourne le nombre de pas exécutés.
 */
export function advance(s: GameState, realDt: number, maxSteps = 240) {
  const a = acc(s);
  a.real += Math.min(realDt, 0.25) * s.clock.speed;
  let n = 0;
  while (a.real >= TIME.STEP && n < maxSteps) {
    step(s, TIME.STEP);
    a.real -= TIME.STEP;
    n++;
  }
  if (n >= maxSteps) a.real = 0; // machine trop lente : on ralentit plutôt que de geler
  return n;
}

/**
 * Onglet en arrière-plan : le navigateur suspend l'affichage, mais la ferme continue de vivre.
 * On avance du temps réel écoulé (à la vitesse choisie), par pas un peu plus grands qu'à l'écran
 * pour ménager le processeur. Plafonné comme la progression hors ligne.
 */
export function advanceRealtime(s: GameState, realSeconds: number) {
  const a = acc(s);
  a.real += Math.min(Math.max(0, realSeconds) * s.clock.speed, TIME.OFFLINE_MAX_DAYS * TIME.DAY);
  let n = 0;
  while (a.real >= TIME.STEP) {
    const dt = a.real >= TIME.OFFLINE_STEP ? TIME.OFFLINE_STEP : TIME.STEP;
    step(s, dt);
    a.real -= dt;
    n++;
  }
  return n;
}

/** Fraction (0..1) du pas en cours : sert au rendu pour interpoler entre deux pas. */
export function simAlpha(s: GameState) {
  return Math.max(0, Math.min(1, acc(s).real / TIME.STEP));
}

export interface OfflineSummary {
  seconds: number;
  money: number;
  eggsLaid: number;
  eggsSold: number;
  hensLost: number;
}

/** Progression hors ligne : temps réel écoulé, plafonné, via les mêmes règles que le jeu. */
export function simulateOffline(s: GameState, realSeconds: number): OfflineSummary | null {
  if (!s.settings.offline || s.clock.speed === 0 || realSeconds < 20) return null;
  const seconds = Math.min(realSeconds, TIME.OFFLINE_MAX_DAYS * TIME.DAY);
  const before = { money: s.money, laid: s.stats.eggsLaid, sold: s.stats.eggsSold, died: s.stats.hensDied };
  let t = 0;
  // absent, le joueur ne peut pas défendre la ferme : aucun prédateur pendant ce temps
  setPredatorsQuiet(s, true);
  try {
    while (t < seconds) {
      const dt = Math.min(TIME.OFFLINE_STEP, seconds - t);
      step(s, dt);
      t += dt;
    }
  } finally {
    setPredatorsQuiet(s, false);
  }
  return {
    seconds,
    money: s.money - before.money,
    eggsLaid: s.stats.eggsLaid - before.laid,
    eggsSold: s.stats.eggsSold - before.sold,
    hensLost: s.stats.hensDied - before.died,
  };
}

// ------------------------------------------------------- Passer la nuit ----
/** Le soir (dès 20 h) et pendant la nuit, le joueur peut sauter jusqu'au matin. */
export function canSkipNight(s: GameState) {
  const h = currentHour(s);
  return h >= TIME.SKIP_FROM || h < TIME.WAKE_HOUR - 0.25;
}

export interface NightSummary {
  eggsLaid: number;
  hatched: number;
  hensLost: number;
  money: number;
}

/**
 * Fait passer la nuit d'un coup jusqu'au réveil (6 h 30), avec exactement les mêmes règles que
 * le jeu (pas fixes) : les poules dorment, la journée est clôturée à minuit, les œufs du matin
 * sont pondus… Aucun prédateur n'attaque pendant ce temps (le joueur ne peut pas défendre).
 */
export function skipNight(s: GameState): NightSummary | null {
  if (!canSkipNight(s)) return null;
  const dayStart = Math.floor(s.clock.t / TIME.DAY) * TIME.DAY;
  let target = dayStart + TIME.WAKE_HOUR * HOUR;
  if (currentHour(s) >= TIME.WAKE_HOUR) target += TIME.DAY;
  const before = { money: s.money, laid: s.stats.eggsLaid, hatched: s.stats.chicksHatched, lost: s.stats.hensDied + s.stats.hensTaken };
  setPredatorsQuiet(s, true);
  try {
    while (s.clock.t < target - 1e-6) step(s, Math.min(TIME.STEP, target - s.clock.t));
  } finally {
    setPredatorsQuiet(s, false);
  }
  return {
    eggsLaid: s.stats.eggsLaid - before.laid,
    hatched: s.stats.chicksHatched - before.hatched,
    hensLost: s.stats.hensDied + s.stats.hensTaken - before.lost,
    money: s.money - before.money,
  };
}
