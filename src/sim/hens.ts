// Les poules : besoins, santé, bien-être, ponte et comportement (machine à états).
import {
  BREEDING,
  COMPOST,
  DAYTIME_SECONDS,
  FENCE,
  GRID_H,
  GRID_Z0,
  GRID_Z1,
  GRID_W,
  HEALTH,
  HOUR,
  LAYING,
  NEEDS,
  RARE,
  ROOSTER_FIGHTS,
  TIME,
  WELLBEING,
  WORLD,
  clamp,
  smoothstep,
} from '../config/balance';
import { BREEDS, HEN_NAMES, ROOSTER_NAMES, pickSkin, GANDER_NAMES, GOOSE_NAMES, isGoose } from '../config/breeds';
import { sizeOf } from '../config/buildings';
import { STAFF } from '../config/staff';
import { recordUse } from './stocks';
import { GATE, buildingCenter, canStand, coopDoor, crossesFence, exitSide, cellIndex, currentHour, distanceTo, emit, inGrid, isNightHour, flowField, isWalkable, lineClear, newId, planPath, nearestWalkable, notify, parcelCenter, parcelCoords, parcelKeyOfCell, parcelOrigin, pick, rand, randRange, rt, sameArea, isShelter, isShelterType } from './core';
import { fmtMoney } from './economy';
import { nearestTree, parcelPerks, perksAt } from './perks';
import { layEgg } from './eggs';
import { threatNear } from './predators';
import { eatGrass, grassAt, parcelGrass } from './grass';
import { buildingsOf, getBuilding, landCapacity, lvl, nestFree } from './queries';
import type { BreedId, Building, GameState, Genes, Hen, HenAct } from './types';
import { beautyValue, frailty, layingGene, shopGenes } from './genetics';
import { season } from './seasons';
import { feedLayout } from './feeding';

const DAY = TIME.DAY;

export interface NewHenOptions {
  rooster?: boolean;
  /** Jeune né à la ferme : jours avant l'âge adulte. */
  young?: number;
  /** Lieu d'apparition (sinon l'entrée de la ferme). */
  at?: [number, number];
  /** Qualités héritées (sinon celles d'une volaille du commerce). */
  genes?: Genes;
  /** Plumage imposé (sinon tiré au hasard). */
  skin?: number;
  /** Coq noir imposé (true / false) ; sinon tirage rarissime pour les coqs. */
  black?: boolean;
  /** Forcer (ou interdire) les plumes d'or. */
  golden?: boolean;
}

export function createHen(s: GameState, breed: BreedId, coop: Building, quickFirstEgg = false, opts: NewHenOptions = {}): Hen {
  const used = new Set(s.hens.map((h) => h.name));
  const names = isGoose(breed) ? (opts.rooster ? GANDER_NAMES : GOOSE_NAMES) : opts.rooster ? ROOSTER_NAMES : HEN_NAMES;
  const free = names.filter((n) => !used.has(n));
  let name = free.length ? pick(s, free) : `${pick(s, names)} ${s.hens.length + 1}`;
  if (!opts.rooster && !opts.young && !isGoose(breed) && s.stats.hensBought === 0 && !used.has('Cocotte')) name = 'Cocotte';
  const [sx, sz] = opts.at ?? [GATE.x + 0.5, GATE.z + 0.6];
  const h: Hen = {
    id: newId(s),
    name,
    breed,
    age: 0,
    health: 90 + rand(s) * 8,
    satiety: 80 + rand(s) * 15,
    hydration: 80 + rand(s) * 15,
    wellbeing: 68,
    protein: 0,
    layProgress: quickFirstEgg ? 0.8 : rand(s) * 0.45,
    eggsLaid: 0,
    coopId: coop.id,
    sick: false,
    dayBought: Math.floor(s.clock.t / DAY) + 1,
    x: sx,
    z: sz,
    heading: Math.PI,
    act: 'idle',
    actT: 0,
    tx: sx,
    tz: sz - 1,
    targetId: -1,
    ox: 0,
    oz: 0,
    thinkT: rand(s),
  };
  if (opts.rooster) h.rooster = true;
  h.genes = opts.genes ?? shopGenes(s, breed);
  // chaque poule a son plumage : les rousses ne se ressemblent pas toutes
  const skin = opts.skin ?? pickSkin(breed, rand(s));
  if (skin > 0) h.skin = skin;
  // rarissime : un coq entièrement noir
  // encore plus rare : une poussine aux plumes d'or, future poule aux œufs d'or
  if (!opts.rooster && !isGoose(breed) && (opts.golden ?? (!!opts.young && rand(s) < RARE.goldenHenHatch))) {
    h.golden = true;
    notify(
      s,
      `Incroyable : ${h.name} est une poussine aux plumes d’or ! Adulte, elle pondra des œufs d’or (${fmtMoney(RARE.goldEggPrice)} pièce chez le collectionneur). Elle-même vaut environ ${fmtMoney(goldenValue())}.`,
      'good',
      '✨',
    );
  }
  if (opts.rooster && !isGoose(breed) && (opts.black ?? rand(s) < (opts.young ? RARE.blackRoosterHatch : RARE.blackRoosterBuy))) {
    h.black = true;
    const v = fmtMoney(blackValue(h));
    notify(
      s,
      opts.young
        ? `Incroyable : ${h.name} est un coquelet entièrement noir, plumes, crête et pattes ! Une rareté qui vaudra environ ${v} adulte.`
        : `Incroyable : ${h.name} est un coq entièrement noir, plumes, crête et pattes ! Une rareté qui se revend environ ${v}.`,
      'good',
    );
  }
  if (opts.young) {
    h.young = opts.young;
    h.layProgress = 0;
  }
  if (!isWalkable(s, h.x, h.z)) {
    const p = nearestWalkable(s, h.x, h.z);
    if (p) [h.x, h.z] = p;
  }
  // Première action : avancer dans le pré (le poussin, lui, fait ses premiers pas sur place)
  if (opts.at) setAct(h, 'idle', randRange(s, 0.5, 2));
  else startWalk(h, h.x + randRange(s, -1.5, 1.5), h.z - randRange(s, 1.5, 3));
  return h;
}

// --------------------------------------------------------- Productivité ----
export function ageFactor(age: number) {
  if (age < LAYING.rampDays) return LAYING.rampStart + (1 - LAYING.rampStart) * (age / LAYING.rampDays);
  if (age <= LAYING.declineStart) return 1;
  const t = clamp((age - LAYING.declineStart) / (LAYING.declineEnd - LAYING.declineStart), 0, 1);
  return 1 - (1 - LAYING.declineFloor) * t;
}

/** Productivité 0..1 : multiplie la cadence de ponte nominale de la race. */
export function productivity(h: Hen) {
  const b = BREEDS[h.breed];
  const healthF = smoothstep(15, 70, h.health);
  const needF = smoothstep(12, 45, Math.min(h.satiety, h.hydration));
  const wellF = clamp(1 - b.sensitivity * 0.55 * (1 - h.wellbeing / 100), 0.2, 1);
  // les protéines du compost (vers, insectes) stimulent la ponte
  const proteinF = 1 + COMPOST.laying * ((h.protein ?? 0) / 100);
  return ageFactor(h.age) * healthF * needF * wellF * proteinF * layingGene(h) * (h.sick ? 0.3 : 1);
}

/** Poule en âge de pondre (ni coq, ni jeune). */
export const isLayer = (h: Hen) => !h.rooster && !h.young;

/** Ponte de base par jour : celle de la race, ou un œuf d'or tous les deux jours pour la poule dorée. */
export const baseLaying = (h: Hen) => (h.golden ? RARE.goldEggsPerDay : BREEDS[h.breed].eggsPerDay);

export function eggsPerDayOf(h: Hen) {
  return isLayer(h) ? baseLaying(h) * productivity(h) : 0;
}

/** Valeur d'une poule aux œufs d'or adulte en pleine santé : une vingtaine d'œufs d'or. */
export const goldenValue = () => RARE.goldEggPrice * RARE.goldHenEggs;

/** Valeur d'un coq noir adulte en pleine santé (fixe pour un oiseau donné, entre 600 et 700 €). */
export function blackValue(h: Pick<Hen, 'id'>) {
  const [a, b] = RARE.blackValue;
  const t = ((h.id * 7919) % 1000) / 1000;
  return Math.round((a + (b - a) * t) / 100) * 100;
}

export function henValue(h: Hen) {
  const b = BREEDS[h.breed];
  if (h.golden) {
    // la poule aux œufs d'or : le prix d'une vingtaine d'œufs d'or (moins si elle est encore poussine)
    const grown = h.young ? 0.35 + 0.65 * (1 - h.young / BREEDING.growthDays) : 1;
    return Math.round((goldenValue() * grown * (0.75 + 0.25 * h.health / 100)) / 100) * 100;
  }
  if (h.black) {
    // le coq noir vaut une fortune ; le coquelet prend de la valeur en grandissant
    const grown = h.young ? 0.35 + 0.65 * (1 - h.young / BREEDING.growthDays) : 1;
    return Math.round((blackValue(h) * grown * (0.75 + 0.25 * h.health / 100)) / 100) * 100;
  }
  const ageV = h.age < LAYING.declineStart ? 1 : clamp(1 - (h.age - LAYING.declineStart) / 250, 0.25, 1);
  const kind = h.young ? BREEDING.chickValue + (1 - BREEDING.chickValue) * (1 - h.young / BREEDING.growthDays) : 1;
  const sex = h.rooster ? BREEDING.roosterPriceMult : 1;
  return Math.round((b.price * sex * 0.55 * ageV * kind * beautyValue(h) * (0.4 + 0.6 * h.health / 100)) / 10) * 10;
}

export function henStatus(h: Hen): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (h.health < HEALTH.warnAt) return { label: h.sick ? 'Malade' : 'Fragile', tone: 'bad' };
  if (h.sick) return { label: 'Malade', tone: 'bad' };
  if (h.hydration < NEEDS.urgentAt) return { label: 'Assoiffée', tone: 'bad' };
  if (h.satiety < NEEDS.urgentAt) return { label: 'Affamée', tone: 'bad' };
  if (h.wellbeing < 40) return { label: 'Stressée', tone: 'warn' };
  if (h.hydration < NEEDS.thirstyAt) return { label: 'A soif', tone: 'warn' };
  if (h.satiety < NEEDS.hungryAt) return { label: 'A faim', tone: 'warn' };
  return { label: 'En forme', tone: 'good' };
}

export const ACT_LABELS: Record<HenAct, string> = {
  idle: 'Observe les alentours',
  walk: 'Se promène',
  peck: 'Picore l’herbe',
  scratch: 'Gratte le sol',
  preen: 'Se lisse les plumes',
  flap: 'S’étire les ailes',
  enter: 'Entre',
  exit: 'Sort',
  rest: 'Se repose',
  goEat: 'Va à la mangeoire',
  eat: 'Mange du grain',
  goDrink: 'Va boire',
  drink: 'Boit',
  goNest: 'Cherche un nid',
  lay: 'Pond un œuf',
  goBath: 'Va au bain de poussière',
  bathe: 'Prend un bain de poussière',
  goCoop: 'Rentre au poulailler',
  sleep: 'Dort au poulailler',
  wait: 'Attend une place',
  flee: 'S’enfuit, paniquée !',
  caught: 'Saisie par un prédateur !',
  stray: 'S’échappe ! (cliquez pour la rattraper)',
  goCompost: 'Va gratter le compost',
  worms: 'Se régale de vers et d’insectes',
  fight: 'Se bat avec un autre coq !',
};

// ------------------------------------------------------- Vitalité (1 s) ----
interface VitalsCache {
  acc: number;
  parcelGrass: Map<string, number>;
  soieCoops: Set<number>;
  drinkerHealth: number;
  caretaker: boolean;
}
const vitals = new WeakMap<GameState, VitalsCache>();

function vitalsCache(s: GameState) {
  let v = vitals.get(s);
  if (!v) vitals.set(s, (v = { acc: 0, parcelGrass: new Map(), soieCoops: new Set(), drinkerHealth: 0, caretaker: false }));
  return v;
}

function refreshVitalsCache(s: GameState, v: VitalsCache) {
  v.parcelGrass.clear();
  for (const p of s.parcels) v.parcelGrass.set(p, parcelGrass(s, p));
  v.soieCoops.clear();
  for (const h of s.hens) if (h.breed === 'soie') v.soieCoops.add(h.coopId);
  const drinkers = buildingsOf(s, 'drinker');
  v.drinkerHealth = drinkers.length ? Math.max(...drinkers.map((d) => lvl(d).quality ?? 0)) : 0;
  v.caretaker = s.workers.some((w) => w.role === 'caretaker' && w.onSite);
}

/** Recalcule tout de suite les bonus par parcelle (herbe, bains, mares, arbres). */
export function refreshVitals(s: GameState) {
  refreshVitalsCache(s, vitalsCache(s));
}

export function wellbeingTarget(s: GameState, h: Hen, v = vitalsCache(s)) {
  const coop = getBuilding(s, h.coopId);
  const comfort = coop ? lvl(coop).comfort ?? 0 : 0;
  const clean = coop ? coop.cleanliness : 30;
  const key = parcelKeyOfCell(Math.floor(h.x), Math.floor(h.z));
  const grass = v.parcelGrass.get(key) ?? 0.5;
  // les poussins comptent peu dans la densité du troupeau
  const density = s.hens.reduce((a, o) => a + (o.young ? 0.25 : 1), 0) / Math.max(1, landCapacity(s));
  let t = WELLBEING.base;
  t += comfort * WELLBEING.comfortWeight;
  t += ((clean - 50) / 50) * WELLBEING.cleanWeight;
  t += (grass - 0.5) * 2 * WELLBEING.grassWeight;
  if (density > 0.75) t -= ((density - 0.75) / 0.25) * WELLBEING.crowdPenalty;
  // bains de poussière, mare et arbres de la parcelle
  t += parcelPerks(s, key).wellbeing;
  if (v.soieCoops.has(h.coopId)) t += WELLBEING.soieBonus;
  if (v.caretaker) t += STAFF.caretakerWellbeing;
  t += COMPOST.wellbeing * ((h.protein ?? 0) / 100);
  if (h.satiety < NEEDS.urgentAt) t -= WELLBEING.needPenalty;
  if (h.hydration < NEEDS.urgentAt) t -= WELLBEING.needPenalty;
  return clamp(t, 0, 100);
}

function vitalsTick(s: GameState, dt: number) {
  const v = vitalsCache(s);
  refreshVitalsCache(s, v);
  const dtDay = dt / DAY;
  const dead: Array<[Hen, string]> = [];
  const grown: Hen[] = [];
  for (const h of s.hens) {
    const b = BREEDS[h.breed];
    const target = wellbeingTarget(s, h, v);
    rtHen(h).thirst = perksAt(s, h.x, h.z).thirst;
    const maxStep = WELLBEING.approachPerDay * dtDay;
    h.wellbeing = clamp(h.wellbeing + clamp(target - h.wellbeing, -maxStep, maxStep), 0, 100);

    const coop = getBuilding(s, h.coopId);
    const clean = coop ? coop.cleanliness : 30;
    let dh = 0;
    const fed = h.satiety > 25 && h.hydration > 25;
    if (fed && clean > 35 && h.wellbeing > 40 && !h.sick) dh += HEALTH.regenPerDay + v.drinkerHealth;
    // bien tenue, une poule malade se remet d'elle-même (deux fois plus vite avec un soigneur)
    if (h.sick && fed && clean > 35 && h.wellbeing > 40 && rand(s) < HEALTH.recoverPerDay * (v.caretaker ? 2 : 1) * dtDay) {
      h.sick = false;
      notify(s, `${h.name} s’est remise de sa maladie.`, 'good', '💚');
    }
    if (v.caretaker) dh += STAFF.caretakerRegen;
    if (h.satiety < HEALTH.starvingAt) dh -= HEALTH.starvingLoss;
    if (h.hydration < HEALTH.starvingAt) dh -= HEALTH.thirstLoss;
    // une volaille robuste encaisse mieux la saleté, le stress et la maladie
    const frail = frailty(h);
    if (clean < 25) dh -= HEALTH.dirtyLoss * b.sensitivity * frail;
    if (h.wellbeing < 30) dh -= HEALTH.unhappyLoss * b.sensitivity * frail;
    if (h.sick) dh -= HEALTH.sickLoss * frail;
    // tant qu'elle n'est ni malade ni en manque, la fatigue ne descend pas sous un plancher : pas de mort sans raison
    const floor = !h.sick && h.satiety >= HEALTH.starvingAt && h.hydration >= HEALTH.starvingAt ? Math.min(h.health, HEALTH.safeFloor) : 0;
    h.health = clamp(h.health + dh * dtDay, floor, 100);
    h.protein = Math.max(0, (h.protein ?? 0) - COMPOST.proteinDecayPerDay * dtDay);
    h.age += dtDay;
    if (h.young) {
      h.young -= dtDay;
      if (h.young <= 0) {
        delete h.young;
        grown.push(h);
      }
    }
    if (h.health <= 0) {
      const cause = h.hydration < HEALTH.starvingAt ? 'de soif' : h.satiety < HEALTH.starvingAt ? 'de faim' : h.sick ? 'de maladie' : 'de mauvaises conditions';
      dead.push([h, cause]);
    }
  }
  for (const h of grown) {
    emit(s, { kind: 'grownUp', henId: h.id });
    notify(s, h.rooster ? `${h.name} est devenu un beau coq.` : `${h.name} est devenue une poule adulte : elle va commencer à pondre !`, 'good', h.rooster ? '🐓' : '🐔');
  }
  for (const [h, cause] of dead) {
    s.hens.splice(s.hens.indexOf(h), 1);
    s.stats.hensDied++;
    emit(s, { kind: 'henGone', henId: h.id, reason: 'died' });
    notify(s, `${h.name} est morte ${cause}. Surveillez l’eau, le grain et la propreté.`, 'bad', '🪦');
  }
}

// --------------------------------------------------------- Mise à jour ----
export function updateHens(s: GameState, dt: number) {
  const hour = currentHour(s);
  const night = isNightHour(hour);
  const dtDay = dt / DAY;
  prepareHenStep(s);
  const sea = season(s);
  for (const h of s.hens) {
    const b = BREEDS[h.breed];
    const sleeping = h.act === 'sleep';
    const f = (sleeping ? NEEDS.nightFactor : 1) * (h.young ? BREEDING.youngAppetite : 1);
    // les vers du compost remplacent une partie du grain ; l'ombre et la mare calment la soif
    const worms = 1 - COMPOST.grainSaving * ((h.protein ?? 0) / 100);
    h.satiety = Math.max(0, h.satiety - NEEDS.satietyPerDay * b.appetite * sea.appetite * worms * dtDay * f);
    h.hydration = Math.max(0, h.hydration - NEEDS.hydrationPerDay * sea.thirst * rtHen(h).thirst * dtDay * f);
    if (!night && !sleeping && !h.rooster && !h.young) {
      h.layProgress = Math.min(1.5, h.layProgress + (baseLaying(h) / DAYTIME_SECONDS) * productivity(h) * sea.laying * dt);
    }
    // à la tombée du jour, elles reprennent le chemin du poulailler (il faut le temps d'arriver)
    behave(s, h, dt, night || hour >= TIME.NIGHT_START - 1.8, hour);
  }
  for (const h of escaped.splice(0)) escapeHen(s, h);
  roosterRivalry(s, dt, night);
  resolveOverlaps(s);
  const v = vitalsCache(s);
  v.acc += dt;
  if (v.acc >= 1) {
    vitalsTick(s, v.acc);
    escapeTick(s, v.acc);
    v.acc = 0;
  }
}

// ------------------------------------------------------------- Fugues ----
// Sans clôture, une poule finit par s'éloigner : elle file vers le bord de la carte (la route
// ou les bois) et disparaît si personne ne la rattrape (un clic sur elle suffit).
const escaped: Hen[] = [];

function escapeTick(s: GameState, dt: number) {
  const r = rt(s);
  const p = FENCE.escapePerHour * (dt / HOUR);
  for (const h of s.hens) {
    const hr = rtHen(h);
    if (hr.strayCool > 0) {
      hr.strayCool -= dt;
      continue;
    }
    if (!STRAYABLE.has(h.act)) continue;
    const cx = Math.floor(h.x);
    const cz = Math.floor(h.z);
    if (!inGrid(cx, cz) || !r.open[cellIndex(cx, cz)]) continue;
    if (rand(s) < p) {
      h.act = 'stray';
      h.actT = 40;
      h.targetId = -1;
      hr.slot = -1;
      hr.strayOut = false;
      notify(s, `${h.name} s’éloigne de la ferme ! Cliquez sur elle pour la rattraper… et posez du grillage.`, 'warn', '🐔');
    }
  }
}

function strayTick(s: GameState, h: Hen, r: HenRt, dt: number, night: boolean) {
  if (r.strayOut) {
    const res = steer(s, h, r, h.tx, h.tz, speedOf(h, 'go'), dt, true);
    if (res === 'arrived' || h.actT <= 0) escaped.push(h);
    return;
  }
  const g = rt(s);
  const cx = Math.floor(h.x);
  const cz = Math.floor(h.z);
  const d = inGrid(cx, cz) ? g.exitDist[cellIndex(cx, cz)] : 0;
  if (d < 0) return decide(s, h, night); // clôturée entre-temps
  if (d === 0) {
    const side = inGrid(cx, cz) ? exitSide(s, cx, cz) : [0, 1];
    if (!side) return decide(s, h, night);
    r.strayOut = true;
    h.tx = cx + 0.5 + side[0] * 3.2;
    h.tz = cz + 0.5 + side[1] * 3.2;
    h.actT = 15;
    return;
  }
  // elle descend vers la sortie la plus proche
  let best: [number, number] | null = null;
  for (const [dx, dz] of [[0, 1], [1, 0], [-1, 0], [0, -1]] as const) {
    const nx = cx + dx;
    const nz = cz + dz;
    if (inGrid(nx, nz) && g.exitDist[cellIndex(nx, nz)] === d - 1 && !crossesFence(s, cx + 0.5, cz + 0.5, nx + 0.5, nz + 0.5)) {
      best = [nx + 0.5, nz + 0.5];
      break;
    }
  }
  if (!best) return decide(s, h, night);
  const res = steer(s, h, r, best[0], best[1], speedOf(h, 'wander') * 1.4, dt);
  if (res === 'blocked' && r.stuckT > 1.5) return decide(s, h, night);
  if (h.actT <= 0) h.actT = 40;
}

function escapeHen(s: GameState, h: Hen) {
  const i = s.hens.indexOf(h);
  if (i < 0) return;
  s.hens.splice(i, 1);
  s.stats.hensEscaped++;
  emit(s, { kind: 'henGone', henId: h.id, reason: 'escaped' });
  const road = h.z > GRID_Z1 - 0.5;
  notify(s, `${h.name} s’est échappée ${road ? 'sur la route' : 'dans la campagne'} et ne reviendra pas. Clôturez la ferme avec du grillage !`, 'bad', '🐔');
}

/** Le joueur rattrape une poule en fugue : elle revient et se tient tranquille quelques heures. */
export function recallHen(s: GameState, h: Hen) {
  if (h.act !== 'stray') return false;
  const r = rtHen(h);
  if (!isWalkable(s, h.x, h.z)) {
    const p = nearestWalkable(s, h.x, h.z);
    if (p) [h.x, h.z] = p;
  }
  r.strayOut = false;
  r.strayCool = FENCE.recallHours * HOUR;
  setAct(h, 'idle', 0.4);
  return true;
}


// ============================================================ Locomotion ====
// Pilotage façon « steering » : la poule vise un point de passage, évite ses voisines et
// les obstacles (distance de sécurité), accélère et ralentit progressivement. Chaque poule
// réserve une place précise autour d'une mangeoire, d'un abreuvoir, d'un nid ou d'un bain :
// plus aucun empilement. Entrées et sorties (nid, poulailler, bain) sont de vrais trajets.

export interface HenRt {
  /** Position et cap au pas précédent : le rendu interpole entre les deux. */
  px: number;
  pz: number;
  ph: number;
  spd: number;
  slot: number;
  wx: number;
  wz: number;
  wT: number;
  sepX: number;
  sepZ: number;
  pauseT: number;
  stuckT: number;
  next: HenAct;
  nextT: number;
  /** Chemin planifié vers la place réservée (x0,z0,x1,z1…). */
  path: number[];
  pathKey: number;
  replans: number;
  progT: number;
  bestD: number;
  /** Fugue : déjà hors de la carte, et délai avant de pouvoir repartir. */
  strayOut: boolean;
  strayCool: number;
  /** Multiplicateur de soif de l'endroit (ombre des arbres, fraîcheur de la mare). */
  thirst: number;
  /** Adversaire pendant un combat de coqs. */
  foe: number;
  /**
   * Coin de pré du moment : la poule y retourne entre deux repas et en change de temps en temps
   * (herbe broutée, envie d'ailleurs, copines), si bien que tout le terrain est parcouru.
   */
  rangeX: number;
  rangeZ: number;
  rangeUntil: number;
}
const henRts = new WeakMap<Hen, HenRt>();
export function rtHen(h: Hen): HenRt {
  let r = henRts.get(h);
  if (!r) {
    r = {
      px: h.x, pz: h.z, ph: h.heading, spd: 0, slot: -1, wx: h.x, wz: h.z, wT: 0, sepX: 0, sepZ: 0, pauseT: 0, stuckT: 0,
      next: 'idle', nextT: 0, path: [], pathKey: -1, replans: 0, progT: 0, bestD: Infinity, strayOut: false, strayCool: 0, thirst: 1,
      rangeX: NaN, rangeZ: NaN, rangeUntil: -1, foe: -1,
    };
    henRts.set(h, r);
  }
  return r;
}

const SPEED = { wander: 0.5, go: 0.82, hurry: 1.3, inside: 0.55, flee: 1.6 };
const ANCHORED = new Set<HenAct>(['eat', 'drink', 'lay', 'bathe', 'sleep', 'enter', 'exit', 'caught', 'worms']);
/** Activités qu'une poule abandonne pour fuir un prédateur (pas au nid, au bain ni au poulailler). */
const SCARED = new Set<HenAct>(['idle', 'walk', 'peck', 'scratch', 'preen', 'flap', 'rest', 'wait', 'goEat', 'eat', 'goDrink', 'drink', 'goNest', 'goBath', 'goCoop', 'stray', 'goCompost', 'worms', 'fight']);
/** Activités pendant lesquelles une poule non clôturée peut prendre la clé des champs. */
const STRAYABLE = new Set<HenAct>(['idle', 'walk', 'peck', 'scratch', 'preen', 'flap', 'rest', 'wait']);
const USING = new Set<HenAct>(['goEat', 'eat', 'goDrink', 'drink', 'goNest', 'enter', 'lay', 'goBath', 'bathe', 'goCompost', 'worms']);
const DIRS8: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.707, 0.707], [0.707, -0.707], [-0.707, 0.707], [-0.707, -0.707],
];
const SEP_R = 0.46;

function wrap(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function speedOf(h: Hen, kind: keyof typeof SPEED) {
  const urgent = kind === 'go' && (h.satiety < NEEDS.urgentAt || h.hydration < NEEDS.urgentAt || h.act === 'goCoop');
  return (BREEDS[h.breed].speed / 0.85) * (urgent ? SPEED.hurry : SPEED[kind]);
}

/**
 * Grille de voisinage réutilisée d'un pas à l'autre : listes chaînées dans des tableaux typés,
 * aucune allocation (indispensable avec des centaines de poules en vitesse ×10).
 */
class Neighbours {
  head: Int32Array;
  next = new Int32Array(256);
  readonly w: number;
  readonly h: number;
  private inv: number;
  constructor(cell: number) {
    this.inv = 1 / cell;
    this.w = Math.ceil((GRID_W + 8) * this.inv);
    this.h = Math.ceil((GRID_H + 8) * this.inv);
    this.head = new Int32Array(this.w * this.h);
  }
  cx(x: number) {
    return Math.floor((x + 4) * this.inv);
  }
  /** Rangée de la table pour une coordonnée z (la grille commence en GRID_Z0). */
  cz(z: number) {
    return Math.floor((z - GRID_Z0 + 4) * this.inv);
  }
  fill(hens: Hen[], skip: (h: Hen) => boolean) {
    this.head.fill(-1);
    if (this.next.length < hens.length) this.next = new Int32Array(hens.length * 2);
    for (let i = 0; i < hens.length; i++) {
      const h = hens[i];
      if (skip(h)) continue;
      const cx = this.cx(h.x);
      const cz = this.cz(h.z);
      if (cx < 0 || cz < 0 || cx >= this.w || cz >= this.h) continue;
      const k = cz * this.w + cx;
      this.next[i] = this.head[k];
      this.head[k] = i;
    }
  }
  /** Premier occupant de la case (cx,cz), ou -1. */
  first(cx: number, cz: number) {
    return cx < 0 || cz < 0 || cx >= this.w || cz >= this.h ? -1 : this.head[cz * this.w + cx];
  }
}
const sepGrid = new Neighbours(1);
const overlapGrid = new Neighbours(0.5);

/** Répulsion entre poules (et envers le personnel) via une grille de voisinage. */
function computeSeparation(s: GameState) {
  const hens = s.hens;
  sepGrid.fill(hens, (h) => h.act === 'sleep');
  const next = sepGrid.next;
  for (let i = 0; i < hens.length; i++) {
    const h = hens[i];
    const r = rtHen(h);
    r.sepX = 0;
    r.sepZ = 0;
    // en route vers le poulailler : elles se serrent pour passer la trappe, sans s'écarter
    if (ANCHORED.has(h.act) || h.act === 'goCoop') continue;
    const cx = sepGrid.cx(h.x);
    const cz = sepGrid.cz(h.z);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        for (let j = sepGrid.first(cx + dx, cz + dz); j >= 0; j = next[j]) {
          if (j === i) continue;
          const o = hens[j];
          if (o.act === 'enter' || o.act === 'exit') continue;
          const ox = h.x - o.x;
          const oz = h.z - o.z;
          const d2 = ox * ox + oz * oz;
          if (d2 >= SEP_R * SEP_R) continue;
          const d = Math.sqrt(d2);
          if (d < 1e-4) {
            r.sepX += Math.sin(h.id) * 0.5;
            r.sepZ += Math.cos(h.id) * 0.5;
            continue;
          }
          const k = (1 - d / SEP_R) * (ANCHORED.has(o.act) ? 1.4 : 1);
          r.sepX += (ox / d) * k;
          r.sepZ += (oz / d) * k;
        }
      }
    for (const rb of s.dog ? [...s.robots, s.dog] : s.robots) {
      const ox = h.x - rb.x;
      const oz = h.z - rb.z;
      const d = Math.hypot(ox, oz);
      if (d < 0.6 && d > 1e-4) {
        const k = (1 - d / 0.6) * 1.4;
        r.sepX += (ox / d) * k;
        r.sepZ += (oz / d) * k;
      }
    }
    for (const w of s.workers) {
      if (!w.onSite) continue;
      const ox = h.x - w.x;
      const oz = h.z - w.z;
      const d = Math.hypot(ox, oz);
      if (d < 0.75 && d > 1e-4) {
        const k = (1 - d / 0.75) * 1.6;
        r.sepX += (ox / d) * k;
        r.sepZ += (oz / d) * k;
      }
    }
  }
}

/**
 * Avance vers (tx,tz) en pilotant : cap limité en vitesse angulaire, accélération progressive,
 * évitement des voisines et des obstacles. `free` : déplacement à l'intérieur d'un bâtiment.
 */
function steer(s: GameState, h: Hen, r: HenRt, tx: number, tz: number, maxSpd: number, dt: number, free = false) {
  const dx = tx - h.x;
  const dz = tz - h.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.045) {
    r.spd = 0;
    return 'arrived' as const;
  }
  let vx = dx / dist;
  let vz = dz / dist;
  if (!free) {
    const w = Math.min(1, dist / 0.6) * 0.8;
    vx += r.sepX * w;
    vz += r.sepZ * w;
    for (const [ax, az] of DIRS8) {
      if (!isWalkable(s, h.x + ax * 0.3, h.z + az * 0.3)) {
        vx -= ax * 0.4;
        vz -= az * 0.4;
      }
    }
    const l = Math.hypot(vx, vz) || 1;
    vx /= l;
    vz /= l;
  }
  const diff = wrap(Math.atan2(vx, vz) - h.heading);
  h.heading = wrap(h.heading + clamp(diff, -9 * dt, 9 * dt));
  const align = Math.max(0, Math.cos(diff));
  const target = maxSpd * clamp(dist / 0.3, 0.3, 1) * (0.12 + 0.88 * align);
  r.spd += (target - r.spd) * Math.min(1, dt * 7);
  const len = Math.min(r.spd * dt, dist);
  const nx = h.x + Math.sin(h.heading) * len;
  const nz = h.z + Math.cos(h.heading) * len;
  const strict = !free && canStand(s, h.x, h.z, 0.1);
  const ok = (x: number, z: number) => free || ((strict ? canStand(s, x, z, 0.1) : isWalkable(s, x, z)) && !crossesFence(s, h.x, h.z, x, z));
  const ox = h.x;
  const oz = h.z;
  if (ok(nx, nz)) {
    h.x = nx;
    h.z = nz;
  } else if (ok(nx, h.z)) h.x = nx;
  else if (ok(h.x, nz)) h.z = nz;
  const moved = Math.hypot(h.x - ox, h.z - oz);
  if (len > 1e-4 && moved < len * 0.3) {
    r.spd *= 0.6;
    r.stuckT += dt;
    return 'blocked' as const;
  }
  r.stuckT = 0;
  return 'moving' as const;
}

/** Les poules immobiles s'écartent doucement si elles se marchent dessus. */
function nudge(s: GameState, h: Hen, r: HenRt, dt: number) {
  const m = Math.hypot(r.sepX, r.sepZ);
  if (m < 0.05) return;
  const nx = h.x + r.sepX * 0.45 * dt;
  const nz = h.z + r.sepZ * 0.45 * dt;
  if (canStand(s, nx, nz, 0.1) && !crossesFence(s, h.x, h.z, nx, nz)) {
    h.x = nx;
    h.z = nz;
  }
}

// --------------------------------------------------------------- Places ----
function nestCompartments(b: Building) {
  return b.level === 1 ? 3 : b.level === 2 ? 4 : 5;
}

/** Places où une poule se tient pour utiliser un bâtiment (mémorisées tant que le terrain ne change pas). */
/** Mangeoire, abreuvoir, mare : point d'approche (dehors) et point visé par le bec de chaque place. */
interface FeedInfo {
  ax: number;
  az: number;
  fx: number;
  fz: number;
}
const spotCache = new WeakMap<Building, { key: number; spots: Array<[number, number]>; feed?: FeedInfo[]; reach: number }>();
function spotEntry(s: GameState, b: Building) {
  const key = ((rt(s).version * 8 + b.level) * 128 + b.x + 8) * 128 + b.z + 8;
  let c = spotCache.get(b);
  if (!c || c.key !== key) {
    const layout = feedLayout(b);
    if (layout.length) {
      // la poule entre jusqu'au bord ; on garde les places d'où elle peut repartir dehors
      const spots: Array<[number, number]> = [];
      const feed: FeedInfo[] = [];
      for (const f of layout) {
        const x = b.x + f.x;
        const z = b.z + f.z;
        const fx = b.x + f.fx;
        const fz = b.z + f.fz;
        const d = Math.hypot(x - fx, z - fz) || 1;
        for (let k = 0.08; k <= 2.4; k += 0.06) {
          const ax = x + ((x - fx) / d) * k;
          const az = z + ((z - fz) / d) * k;
          if (canStand(s, ax, az, 0.13)) {
            spots.push([x, z]);
            feed.push({ ax, az, fx, fz });
            break;
          }
        }
      }
      spotCache.set(b, (c = { key, spots, feed, reach: -1 }));
    } else spotCache.set(b, (c = { key, spots: computeSlotSpots(s, b), reach: -1 }));
  }
  return c;
}
/** Infos de la place i d'une mangeoire, d'un abreuvoir ou d'une mare (sinon undefined). */
function feedInfo(s: GameState, b: Building, i: number) {
  return spotEntry(s, b).feed?.[i];
}
export function slotSpots(s: GameState, b: Building): Array<[number, number]> {
  return spotEntry(s, b).spots;
}

function computeSlotSpots(s: GameState, b: Building): Array<[number, number]> {
  const c = buildingCenter(b);
  const L = lvl(b);
  if (b.type === 'compost') {
    const n = L.slots ?? 3;
    const rad = 1.25;
    const out: Array<[number, number]> = [];
    for (let i = 0; i < n * 3 && out.length < n; i++) {
      const a = 0.35 + (i * Math.PI * 2) / n + (i >= n ? Math.PI / n : 0) + (i >= 2 * n ? Math.PI / (2 * n) : 0);
      const x = c.x + Math.sin(a) * rad;
      const z = c.z + Math.cos(a) * rad;
      if (canStand(s, x, z, 0.12) && !out.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < 0.4)) out.push([x, z]);
    }
    return out;
  }
  if (b.type === 'nest') {
    const n = nestCompartments(b);
    return Array.from({ length: n }, (_, i) => [b.x + 0.1 + ((i + 0.5) * 1.8) / n, b.z + 0.5] as [number, number]);
  }
  if (b.type === 'dustbath') {
    const n = L.slots ?? 3;
    return Array.from({ length: n }, (_, i) => {
      const a = 0.6 + (i * Math.PI * 2) / n;
      return [c.x + Math.sin(a) * 0.42, c.z + Math.cos(a) * 0.42] as [number, number];
    });
  }
  // poulailler : au pied de la rampe, face à la trappe
  const door = coopDoor(b);
  return [[door.x, door.z + 0.32]];
}

/** Point d'approche (à l'extérieur) correspondant à une place. */
function approachPoint(s: GameState, b: Building, spot: [number, number]): [number, number] {
  const e = spotEntry(s, b);
  if (e.feed && e.spots.length) {
    // la place elle-même (ou, à défaut, la plus proche du point donné)
    let i = e.spots.indexOf(spot);
    if (i < 0) {
      let bd = Infinity;
      e.spots.forEach(([x, z], k) => {
        const d = Math.hypot(x - spot[0], z - spot[1]);
        if (d < bd) {
          bd = d;
          i = k;
        }
      });
    }
    return [e.feed[i].ax, e.feed[i].az];
  }
  if (b.type === 'nest') return [spot[0], b.z + 1.34];
  if (b.type === 'dustbath') {
    const c = buildingCenter(b);
    const dx = spot[0] - c.x;
    const dz = spot[1] - c.z;
    const d = Math.hypot(dx, dz) || 1;
    return [c.x + (dx / d) * 1.38, c.z + (dz / d) * 1.38];
  }
  return spot;
}

function coopInside(b: Building): [number, number] {
  // au milieu du perchoir, un peu en arrière de la façade (quelle que soit la taille du poulailler)
  return [coopDoor(b).x, b.z + sizeOf(b.type, b.level).d * 0.575];
}

/** Une place est utilisable si son point d'approche est praticable et relié au bâtiment. */
function slotReachable(s: GameState, b: Building, spot: [number, number]) {
  const [ax, az] = approachPoint(s, b, spot);
  const cx = Math.floor(ax);
  const cz = Math.floor(az);
  if (!inGrid(cx, cz) || !canStand(s, ax, az, 0.1)) return false;
  return flowField(s, b)[cellIndex(cx, cz)] >= 0;
}

function freeSlot(s: GameState, h: Hen, b: Building): number {
  const spots = slotSpots(s, b);
  const taken = new Set<number>();
  for (const o of s.hens) {
    if (o === h || o.targetId !== b.id || !(USING.has(o.act) || o.act === 'exit')) continue;
    const r = henRts.get(o);
    if (r && r.slot >= 0) taken.add(r.slot);
  }
  let best = -1;
  let bd = Infinity;
  spots.forEach((sp, i) => {
    const [x, z] = sp;
    if (taken.has(i) || !slotReachable(s, b, sp)) return;
    const d = Math.hypot(x - h.x, z - h.z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

// Occupation des bâtiments, recomptée une fois par pas (et tenue à jour à chaque nouvel engagement)
let stepStamp = 0;
interface Occupancy {
  stamp: number;
  using: Map<number, number>;
  nesting: Map<number, number>;
}
const occupancies = new WeakMap<GameState, Occupancy>();
function occupancy(s: GameState) {
  let u = occupancies.get(s);
  if (u && u.stamp === stepStamp) return u;
  if (!u) occupancies.set(s, (u = { stamp: -1, using: new Map(), nesting: new Map() }));
  u.stamp = stepStamp;
  u.using.clear();
  u.nesting.clear();
  for (const o of s.hens) {
    if (o.targetId < 0) continue;
    if (USING.has(o.act)) u.using.set(o.targetId, (u.using.get(o.targetId) ?? 0) + 1);
    if (o.act === 'goNest' || o.act === 'enter' || o.act === 'lay') u.nesting.set(o.targetId, (u.nesting.get(o.targetId) ?? 0) + 1);
  }
  return u;
}

function slotsFree(s: GameState, b: Building) {
  const e = spotEntry(s, b);
  if (e.reach < 0) e.reach = e.spots.filter((sp) => slotReachable(s, b, sp)).length;
  return e.reach - (occupancy(s).using.get(b.id) ?? 0);
}

// ------------------------------------------------------------ Activités ----
function startWalk(h: Hen, tx: number, tz: number) {
  h.act = 'walk';
  h.tx = tx;
  h.tz = tz;
  h.actT = 14;
  h.targetId = -1;
  rtHen(h).pathKey = -1;
}

/** Marqueur du chemin d'une grande balade (contournant bâtiments et clôtures intérieures). */
const ROAM_PATH = -7;
/** Rayon du coin de pré autour de son centre. */
const RANGE_R = 3.5;

/** Poules (éveillées) dans un rayon donné. */
function henCount(s: GameState, x: number, z: number, rad: number, self: Hen) {
  let n = 0;
  for (const o of s.hens) if (o !== self && o.act !== 'sleep' && (o.x - x) ** 2 + (o.z - z) ** 2 < rad * rad) n++;
  return n;
}

/**
 * Nouveau coin de pré, n'importe où dans son enclos : de l'herbe haute, un peu d'ombre sous un
 * arbre, pas trop de monde, ou bien le coin d'une copine (les poules vont par petits groupes).
 */
function chooseRange(s: GameState, h: Hen) {
  const r = rtHen(h);
  const P = WORLD.PARCEL;
  let best: [number, number] | null = null;
  let bs = -Infinity;
  // les parcelles de son enclos (toutes, si leur centre est bâti ou si l'enclos est partagé)
  const mine = s.parcels.filter((k) => {
    const [cx, cz] = parcelCenter(...parcelCoords(k));
    return sameArea(s, h.x, h.z, cx, cz);
  });
  const pool = mine.length ? mine : s.parcels;
  const evening = currentHour(s) >= TIME.NIGHT_START - 4;
  const coop = getBuilding(s, h.coopId);
  const home = coop ? coopDoor(coop) : null;
  // les oies ne sont pas aventurières : elles restent en bande près de leur abri
  const homebody = isGoose(h.breed) && coop?.type === 'goosehouse';
  for (let i = 0; i < 12; i++) {
    let tx: number;
    let tz: number;
    const friend = i < 3;
    if (friend) {
      const o = s.hens[Math.floor(rand(s) * s.hens.length)];
      if (!o || o === h || o.act === 'sleep' || isGoose(o.breed) !== isGoose(h.breed)) continue;
      const or = rtHen(o);
      const ok = Number.isFinite(or.rangeX);
      tx = (ok ? or.rangeX : o.x) + randRange(s, -2, 2);
      tz = (ok ? or.rangeZ : o.z) + randRange(s, -2, 2);
    } else if (homebody && home) {
      // devant l'abri, dans un rayon de quelques mètres
      const a = rand(s) * Math.PI * 2;
      const d = 1.2 + rand(s) * GOOSE_HOME_R;
      tx = home.x + Math.sin(a) * d;
      tz = home.z + 0.8 + Math.abs(Math.cos(a)) * d * 0.9;
    } else if (evening && home) {
      // en fin d'après-midi, elles se rapprochent de leur poulailler
      const a = rand(s) * Math.PI * 2;
      const d = 1.5 + rand(s) * 6;
      // devant la trappe (pas derrière le bâtiment, d'où il faudrait en faire le tour)
      tx = home.x + Math.sin(a) * d;
      tz = home.z + 0.8 + Math.abs(Math.cos(a)) * d;
    } else {
      const [c, row] = parcelCoords(pick(s, pool));
      const [x0, z0] = parcelOrigin(c, row);
      tx = x0 + 0.8 + rand(s) * (P - 1.6);
      tz = z0 + 0.8 + rand(s) * (P - 1.6);
    }
    if (!canStand(s, tx, tz, 0.2) || !sameArea(s, h.x, h.z, tx, tz)) continue;
    const crowd = henCount(s, tx, tz, 2.5, h);
    const score =
      grassAt(s, tx, tz) * 1.4 + (nearestTree(s, tx, tz, 3) ? 0.3 : 0) - Math.max(0, crowd - 2) * 0.25 - (besideBuilding(s, tx, tz) ? 0.4 : 0) + (friend ? 0.15 : 0) + rand(s) * 0.6;
    if (score > bs) {
      bs = score;
      best = [tx, tz];
    }
  }
  r.rangeX = best ? best[0] : h.x;
  r.rangeZ = best ? best[1] : h.z;
  r.rangeUntil = s.clock.t + randRange(s, 35, 80);
}

/** Rayon (m) dans lequel les oies broutent autour de leur abri, hors repas et boisson. */
const GOOSE_HOME_R = 5.5;

/** Point où aller pour rejoindre son coin de pré (null : elle y est déjà). */
function roamTarget(s: GameState, h: Hen): [number, number] | null {
  const r = rtHen(h);
  const evening = currentHour(s) >= TIME.NIGHT_START - 4;
  const own = getBuilding(s, h.coopId);
  const homebody = isGoose(h.breed) && own?.type === 'goosehouse';
  const coop = evening || homebody ? own : undefined;
  const farFromHome = coop ? Math.hypot(r.rangeX - coopDoor(coop).x, r.rangeZ - coopDoor(coop).z) > (homebody ? GOOSE_HOME_R + 2 : 9) : false;
  if (!(s.clock.t < r.rangeUntil) || farFromHome || grassAt(s, r.rangeX, r.rangeZ) < 0.22 || !sameArea(s, h.x, h.z, r.rangeX, r.rangeZ)) chooseRange(s, h);
  if (Math.hypot(r.rangeX - h.x, r.rangeZ - h.z) < RANGE_R) return null;
  for (let k = 0; k < 6; k++) {
    const a = rand(s) * Math.PI * 2;
    const d = rand(s) * RANGE_R * 0.8;
    const tx = r.rangeX + Math.sin(a) * d;
    const tz = r.rangeZ + Math.cos(a) * d;
    if (canStand(s, tx, tz, 0.16)) return [tx, tz];
  }
  return null;
}

/** Grande balade : chemin planifié à travers l'enclos, d'un pas plus décidé. */
function startRoam(s: GameState, h: Hen, tx: number, tz: number) {
  const path = planPath(s, h.x, h.z, tx, tz, 0.14);
  if (!path || !path.length) return false;
  startWalk(h, tx, tz);
  const r = rtHen(h);
  r.path = path;
  r.pathKey = ROAM_PATH;
  h.actT = 8 + Math.hypot(tx - h.x, tz - h.z) / 0.3;
  return true;
}

function setAct(h: Hen, act: HenAct, t: number, targetId = -1) {
  h.act = act;
  h.actT = t;
  h.targetId = targetId;
}

/** Entrée/sortie : trajet libre (sans collision) vers un point, puis activité suivante. */
function move(h: Hen, kind: 'enter' | 'exit', tx: number, tz: number, next: HenAct, nextT: number, targetId: number) {
  const r = rtHen(h);
  h.act = kind;
  h.tx = tx;
  h.tz = tz;
  h.actT = 6;
  h.targetId = targetId;
  r.next = next;
  r.nextT = nextT;
}

function crowdAt(s: GameState, x: number, z: number, self: Hen) {
  let n = 0;
  for (const o of s.hens) if (o !== self && o.act !== 'sleep' && Math.abs(o.x - x) < 1 && Math.abs(o.z - z) < 1) n++;
  return n;
}

/** Cible de promenade : préfère l'herbe haute, les endroits peu fréquentés et dégagés. */
function pickForageTarget(s: GameState, h: Hen, radius: number, preferGrass: boolean) {
  const r = rtHen(h);
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  // les oies tiennent à leur abri : pas un pas de plus au-delà de leur coin, et retour si elles s'en sont éloignées
  const house = isGoose(h.breed) ? getBuilding(s, h.coopId) : undefined;
  const home = house?.type === 'goosehouse' ? coopDoor(house) : null;
  const homeD = home ? Math.hypot(h.x - home.x, h.z - home.z) : 0;
  for (let i = 0; i < 8; i++) {
    const a = rand(s) * Math.PI * 2;
    const d = 0.8 + rand(s) * radius;
    const tx = h.x + Math.sin(a) * d;
    const tz = h.z + Math.cos(a) * d;
    if (!canStand(s, tx, tz, 0.16) || !lineClear(s, h.x, h.z, tx, tz, 0.12)) continue;
    // on reste dans son coin de pré
    const out = Number.isFinite(r.rangeX) ? Math.max(0, Math.hypot(tx - r.rangeX, tz - r.rangeZ) - RANGE_R) : 0;
    let leash = 0;
    if (home) {
      const d2 = Math.hypot(tx - home.x, tz - home.z);
      if (d2 > GOOSE_HOME_R + 1.5 && d2 >= homeD) continue;
      leash = Math.max(0, d2 - GOOSE_HOME_R) * 0.5;
    }
    const score = (preferGrass ? grassAt(s, tx, tz) : 0.5) + rand(s) * 0.35 - crowdAt(s, tx, tz, h) * 0.25 - out * 0.12 - leash;
    if (score > bestScore) {
      bestScore = score;
      best = [tx, tz];
    }
  }
  return best;
}

/** Poules en route vers ce pondoir, en train d'y entrer ou d'y pondre. */
function nesting(s: GameState, b: Building) {
  return occupancy(s).nesting.get(b.id) ?? 0;
}

function nearest(s: GameState, h: Hen, list: Building[]): Building | null {
  let best: Building | null = null;
  let bd = Infinity;
  for (const b of list) {
    const d = distanceTo(s, b, h.x, h.z);
    if (d < 0) continue;
    const score = d + Math.max(0, -slotsFree(s, b) + 1) * 3;
    if (score < bd) {
      bd = score;
      best = b;
    }
  }
  return best;
}

function findFeeder(s: GameState, h: Hen) {
  return nearest(s, h, buildingsOf(s, 'feeder').filter((b) => b.stock >= 0.05));
}
function findDrinker(s: GameState, h: Hen) {
  // abreuvoirs et mares : la poule va au point d'eau le plus proche
  return nearest(s, h, [...buildingsOf(s, 'drinker'), ...buildingsOf(s, 'pond')].filter((b) => b.stock >= 0.05));
}
function findNest(s: GameState, h: Hen) {
  const nests = buildingsOf(s, 'nest').filter((b) => nestFree(b) - nesting(s, b) > 0 && slotsFree(s, b) > 0);
  let best: Building | null = null;
  let bd = Infinity;
  for (const b of nests) {
    const d = distanceTo(s, b, h.x, h.z);
    if (d >= 0 && d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

function goTo(s: GameState, h: Hen, act: HenAct, b: Building) {
  const r = rtHen(h);
  setAct(h, act, 45, b.id);
  // l'engagement compte tout de suite pour les poules qui décident après elle
  const occ = occupancy(s);
  occ.using.set(b.id, (occ.using.get(b.id) ?? 0) + 1);
  if (act === 'goNest') occ.nesting.set(b.id, (occ.nesting.get(b.id) ?? 0) + 1);
  r.slot = isShelter(b) ? -1 : freeSlot(s, h, b);
  r.wT = 0;
  r.stuckT = 0;
  if (!isShelter(b) && r.slot < 0) waitNear(s, h, b);
}

/** Toutes les places sont prises : la poule patiente à côté. */
function waitNear(s: GameState, h: Hen, b: Building) {
  // mangeoire ou abreuvoir complet : sans urgence, elle va gratter un peu plus loin et reviendra
  if ((b.type === 'feeder' || b.type === 'drinker' || b.type === 'pond') && h.satiety > 12 && h.hydration > 12) {
    const t = pickForageTarget(s, h, 3, true);
    if (t) return startWalk(h, t[0], t[1]);
  }
  const c = buildingCenter(b);
  for (let i = 0; i < 8; i++) {
    const a = rand(s) * Math.PI * 2;
    const d = 1.3 + rand(s) * 0.7;
    const x = c.x + Math.sin(a) * d;
    const z = c.z + Math.cos(a) * d;
    if (canStand(s, x, z, 0.16) && lineClear(s, h.x, h.z, x, z, 0.12)) {
      h.act = 'wait';
      h.tx = x;
      h.tz = z;
      h.actT = randRange(s, 1.5, 3);
      h.targetId = -1;
      return;
    }
  }
  setAct(h, 'peck', randRange(s, 1.5, 3));
}

/** Tournée vers le grain ou l'eau de sa place. */
function faceFood(s: GameState, h: Hen, b: Building) {
  const f = feedInfo(s, b, rtHen(h).slot);
  if (f) h.heading = Math.atan2(f.fx - h.x, f.fz - h.z);
}
/** Repue ou désaltérée : elle recule hors de la mangeoire (ou de la berge) avant de repartir. */
function leaveFeeder(s: GameState, h: Hen, b: Building | undefined, night: boolean) {
  const f = b ? feedInfo(s, b, rtHen(h).slot) : undefined;
  if (b && f) return move(h, 'exit', f.ax, f.az, 'idle', 0, b.id);
  return decide(s, h, night);
}

/** Activités au pied d'un bâtiment : en repartant, la poule regagne volontiers son coin de pré. */
const AT_BUILDING = new Set<HenAct>(['eat', 'drink', 'lay', 'bathe', 'worms', 'exit', 'wait']);

/** Au pied d'un bâtiment (poulailler, mangeoire…) ; l'ombre d'un arbre ou la mare ne comptent pas. */
function besideBuilding(s: GameState, x: number, z: number) {
  const occ = rt(s).occupant;
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      if (!inGrid(cx + dx, cz + dz)) continue;
      const id = occ[cellIndex(cx + dx, cz + dz)];
      if (id < 0) continue;
      const b = getBuilding(s, id);
      if (b && b.type !== 'tree' && b.type !== 'pond') return true;
    }
  return false;
}

function decide(s: GameState, h: Hen, night: boolean) {
  // une poule ne traîne pas au pied des bâtiments (ni sur la place d'une autre à la mangeoire) :
  // elle regagne son coin de pré
  const leaving = AT_BUILDING.has(h.act);
  const beside = !leaving && besideBuilding(s, h.x, h.z);
  const r = rtHen(h);
  r.slot = -1;
  r.pauseT = 0;
  r.pathKey = -1;
  if (night) {
    // assoiffée ou affamée au crépuscule : un dernier passage à l'abreuvoir ou à la mangeoire
    if (currentHour(s) < TIME.NIGHT_START && currentHour(s) > 12) {
      if (h.hydration < 45) {
        const d = findDrinker(s, h);
        if (d && slotsFree(s, d) > 0) return goTo(s, h, 'goDrink', d);
      }
      if (h.satiety < 35) {
        const f = findFeeder(s, h);
        if (f && slotsFree(s, f) > 0) return goTo(s, h, 'goEat', f);
      }
    }
    const coop = getBuilding(s, h.coopId);
    // trappe fermée par le commis : la retardataire passe la nuit dehors
    if (coop && !coop.closed && distanceTo(s, coop, h.x, h.z) >= 0) return goTo(s, h, 'goCoop', coop);
    return setAct(h, 'rest', 6);
  }
  // en fin de journée, une dernière gorgée et quelques grains avant d'aller se coucher
  const evening = currentHour(s) >= TIME.NIGHT_START - 2.5;
  if (h.hydration < NEEDS.thirstyAt || (evening && h.hydration < 75)) {
    const d = findDrinker(s, h);
    if (d) return goTo(s, h, 'goDrink', d);
  }
  if (evening && h.satiety < 65) {
    const f = findFeeder(s, h);
    if (f) return goTo(s, h, 'goEat', f);
  }
  if (h.satiety < NEEDS.hungryAt) {
    const f = findFeeder(s, h);
    // l'herbe d'abord : la mangeoire seulement si le pré est maigre ou la faim pressante
    if (f && (grassAt(s, h.x, h.z) < 0.55 || h.satiety < NEEDS.urgentAt + 6 || rand(s) < 0.35)) return goTo(s, h, 'goEat', f);
    const t = pickForageTarget(s, h, 5, true);
    if (t) return startWalk(h, t[0], t[1]);
    return setAct(h, 'scratch', randRange(s, 1.5, 3));
  }
  // en soirée, la poule garde son œuf pour le lendemain matin (elles pondent surtout le matin)
  if (h.layProgress >= 1 && currentHour(s) < LAYING.lastLayHour) {
    const n = findNest(s, h);
    if (n) return goTo(s, h, 'goNest', n);
    // pondoirs occupés : elle fait la queue à côté plutôt que de pondre par terre
    const nests = buildingsOf(s, 'nest');
    if (nests.length && h.layProgress < LAYING.holdUntil) {
      const near = nearest(s, h, nests.filter((b) => nestFree(b) > 0)) ?? nearest(s, h, nests);
      if (near) return waitNear(s, h, near);
    }
    // pas de pondoir, ou elle ne peut plus se retenir : ponte au sol
    return setAct(h, 'lay', LAYING.layDuration, -1);
  }
  // une gorgée en passant, si un point d'eau est tout près (sinon elle attendra d'avoir soif)
  if (h.hydration < 62 && rand(s) < 0.14) {
    const d = findDrinker(s, h);
    if (d && distanceTo(s, d, h.x, h.z) < 5) return goTo(s, h, 'goDrink', d);
  }
  // envie de protéines : un tour au compost pour gratter vers et insectes
  if ((h.protein ?? 0) < COMPOST.seekBelow && rand(s) < COMPOST.seekChance) {
    const heaps = buildingsOf(s, 'compost').filter((b) => b.stock >= 1 && slotsFree(s, b) > 0);
    const c = nearest(s, h, heaps);
    if (c && distanceTo(s, c, h.x, h.z) < 18) return goTo(s, h, 'goCompost', c);
  }
  // le poussin ne quitte pas les poules d'une semelle : il trottine dans les pattes d'une adulte
  if (h.young && rand(s) < 0.6) {
    const m = motherOf(s, h);
    if (m) {
      const a = rand(s) * Math.PI * 2;
      const d = randRange(s, 0.35, 0.8);
      const tx = m.x + Math.cos(a) * d;
      const tz = m.z + Math.sin(a) * d;
      if (isWalkable(s, tx, tz)) return startWalk(h, tx, tz);
    }
  }
  const x = rand(s);
  if (x < 0.5 || leaving || (beside && x < 0.88)) {
    // retour vers son coin de pré (au besoin à l'autre bout du terrain), sinon on picore alentour
    const far = roamTarget(s, h);
    if (far && startRoam(s, h, far[0], far[1])) return;
    const t = pickForageTarget(s, h, far ? 4.5 : 2.6, true);
    if (t) return startWalk(h, t[0], t[1]);
  }
  // gratter et picorer le sol : l'essentiel de sa journée
  if (x < 0.6) return setAct(h, 'peck', randRange(s, 2, 4.5));
  if (x < 0.72) return setAct(h, 'scratch', randRange(s, 2.5, 5));
  if (x < 0.77) return setAct(h, 'rest', randRange(s, 3, 7));
  if (x < 0.8) return setAct(h, 'preen', randRange(s, 2, 4));
  if (x < 0.82) return setAct(h, 'flap', 1.1);
  if (x < 0.88) {
    const baths = buildingsOf(s, 'dustbath').filter((b) => slotsFree(s, b) > 0);
    const bath = nearest(s, h, baths);
    if (bath && distanceTo(s, bath, h.x, h.z) < 14) return goTo(s, h, 'goBath', bath);
  }
  if (x < 0.94) return setAct(h, 'idle', randRange(s, 0.8, 2));
  const t = pickForageTarget(s, h, 3.5, false);
  if (t) return startWalk(h, t[0], t[1]);
  setAct(h, 'peck', 2);
}

/** Poule adulte la plus proche (de préférence de la même race) : le poussin la suit. */
function motherOf(s: GameState, h: Hen): Hen | null {
  let best: Hen | null = null;
  let bd = 12 * 12;
  for (const o of s.hens) {
    if (o === h || o.young || o.rooster || o.act === 'sleep') continue;
    const d = (o.x - h.x) ** 2 + (o.z - h.z) ** 2 * (o.breed === h.breed ? 1 : 1.6);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

function forage(s: GameState, h: Hen, dt: number, rate: number) {
  const want = NEEDS.forageRate * BREEDS[h.breed].forage * grassAt(s, h.x, h.z) * dt * rate;
  const room = 100 - h.satiety;
  if (room > 0) h.satiety += eatGrass(s, h.x, h.z, Math.min(want, room), NEEDS.grassPoints);
}

/** Arrivée à la place réservée d'un bâtiment. */
function arrive(s: GameState, h: Hen, b: Building, spot: [number, number]) {
  const c = buildingCenter(b);
  switch (h.act) {
    case 'goCoop': {
      if (b.closed) return setAct(h, 'rest', 6);
      const [ix, iz] = coopInside(b);
      return move(h, 'enter', ix, iz, 'sleep', 0, b.id);
    }
    case 'goNest':
      if (nestFree(b) > 0) return move(h, 'enter', spot[0], spot[1], 'lay', LAYING.layDuration, b.id);
      // pondoir rempli entre-temps : elle cherche une autre place (ou attend)
      if (h.layProgress < LAYING.holdUntil) return decide(s, h, false);
      return setAct(h, 'lay', LAYING.layDuration, -1);
    case 'goBath':
      return move(h, 'enter', spot[0], spot[1], 'bathe', randRange(s, 5, 9), b.id);
    case 'goEat':
    case 'goDrink':
      // elle s'avance jusqu'au bord : le bec arrivera dans le grain ou dans l'eau
      if (spotEntry(s, b).feed) return move(h, 'enter', spot[0], spot[1], h.act === 'goEat' ? 'eat' : 'drink', 20, b.id);
      h.heading = Math.atan2(c.x - h.x, c.z - h.z);
      return setAct(h, h.act === 'goEat' ? 'eat' : 'drink', 20, b.id);
    case 'goCompost':
      h.heading = Math.atan2(c.x - h.x, c.z - h.z);
      return setAct(h, 'worms', randRange(s, 5, 9), b.id);
  }
}

function goTick(s: GameState, h: Hen, r: HenRt, dt: number, night: boolean) {
  const b = getBuilding(s, h.targetId);
  if (!b || h.actT <= 0) return decide(s, h, night);
  if ((h.act === 'goEat' || h.act === 'goDrink' || h.act === 'goCompost') && b.stock < 0.05) return decide(s, h, night);
  if (h.act === 'goCoop' && b.closed) return setAct(h, 'rest', 6);
  const spots = slotSpots(s, b);
  if (!isShelter(b) && (r.slot < 0 || r.slot >= spots.length)) {
    r.slot = freeSlot(s, h, b);
    if (r.slot < 0) return waitNear(s, h, b);
  }
  const spot = spots[isShelter(b) ? 0 : r.slot];
  const [px, pz] = approachPoint(s, b, spot);
  // chemin planifié vers la place précise (et non vers « n'importe quel » côté du bâtiment)
  const key = b.id * 64 + r.slot + 1;
  if (r.pathKey !== key) {
    r.pathKey = key;
    r.path = planPath(s, h.x, h.z, px, pz, 0.12) ?? [];
    r.replans = 0;
    r.progT = 0;
    r.bestD = Infinity;
    if (!r.path.length) return waitNear(s, h, b);
  }
  while (r.path.length > 2 && Math.hypot(r.path[0] - h.x, r.path[1] - h.z) < 0.16) r.path.splice(0, 2);
  const wx = r.path.length ? r.path[0] : px;
  const wz = r.path.length ? r.path[1] : pz;
  steer(s, h, r, wx, wz, speedOf(h, 'go'), dt);
  const d = Math.hypot(px - h.x, pz - h.z);
  if (d < (isShelter(b) ? 0.6 : 0.09)) {
    r.spd = 0;
    r.pathKey = -1;
    return arrive(s, h, b, spot);
  }
  // pas de progrès : on recalcule le chemin, puis on renonce
  if (d < r.bestD - 0.02) {
    r.bestD = d;
    r.progT = 0;
  } else r.progT += dt;
  // coincée tout près du poulailler (un coin, la foule) : elle se faufile jusqu'au pied de la rampe
  if (isShelter(b) && d < 4 && r.progT > 0.8) {
    r.pathKey = -1;
    r.progT = 0;
    return move(h, 'enter', px, pz, 'goCoop', 45, b.id);
  }
  if (r.progT > 1.4) {
    r.progT = 0;
    r.bestD = d;
    r.replans++;
    r.path = planPath(s, h.x, h.z, px, pz, 0.12) ?? [];
    if (r.replans > 3 || !r.path.length) {
      r.pathKey = -1;
      // le soir, personne ne reste dehors : coincée entre deux bâtiments, elle se faufile jusqu'à sa porte
      if (isShelter(b)) return move(h, 'enter', px, pz, 'goCoop', 45, b.id);
      return waitNear(s, h, b);
    }
  }
}

/** Contrainte de non-chevauchement : les poules trop proches sont écartées. */
function resolveOverlaps(s: GameState) {
  // les poules sont des corps solides : jamais l'une dans l'autre
  const MIN = 0.32;
  const hens = s.hens;
  const fixed = (h: Hen) => h.act === 'eat' || h.act === 'drink' || h.act === 'lay' || h.act === 'enter' || h.act === 'exit' || h.act === 'bathe' || h.act === 'caught' || h.act === 'worms';
  // le soir, devant la trappe, elles se pressent pour rentrer : on les laisse se serrer
  const atDoor = (h: Hen) => {
    if (h.act !== 'goCoop') return false;
    const c = getBuilding(s, h.targetId);
    if (!c) return false;
    const d = coopDoor(c);
    return Math.hypot(h.x - d.x, h.z - d.z - 0.3) < 1.8;
  };
  overlapGrid.fill(hens, (h) => h.act === 'sleep' || atDoor(h));
  const next = overlapGrid.next;
  for (let i = 0; i < hens.length; i++) {
    const h = hens[i];
    if (h.act === 'sleep' || fixed(h) || atDoor(h)) continue;
    const bx = overlapGrid.cx(h.x);
    const bz = overlapGrid.cz(h.z);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        for (let j = overlapGrid.first(bx + dx, bz + dz); j >= 0; j = next[j]) {
          if (j === i) continue;
          const o = hens[j];
          const ox = h.x - o.x;
          const oz = h.z - o.z;
          const d2 = ox * ox + oz * oz;
          if (d2 >= MIN * MIN) continue;
          const d = Math.sqrt(d2);
          const nx = d > 1e-4 ? ox / d : Math.sin(h.id);
          const nz = d > 1e-4 ? oz / d : Math.cos(h.id);
          const push = (MIN - d) * (fixed(o) ? 1 : 0.5);
          const x = h.x + nx * push;
          const z = h.z + nz * push;
          if (canStand(s, x, z, 0.08) && !crossesFence(s, h.x, h.z, x, z)) {
            h.x = x;
            h.z = z;
          }
        }
      }
  }
}

// ----------------------------------------------------------- Coqs rivaux ----
/** Un coq disponible pour se quereller (ni à table, ni au poulailler, ni en fuite). */
const FIGHT_READY = new Set<HenAct>(['idle', 'walk', 'peck', 'scratch', 'preen', 'rest', 'flap', 'wait']);

/**
 * Deux coqs dans la même basse-cour finissent par se battre : un nouveau venu se mesure tout de
 * suite au coq le plus proche, puis une querelle éclate de loin en loin. Un seul combat à la fois.
 */
function roosterRivalry(s: GameState, dt: number, night: boolean) {
  if (night || s.hens.some((h) => h.act === 'fight')) return;
  const cocks = s.hens.filter((h) => h.rooster && !h.young && h.health > 35 && FIGHT_READY.has(h.act));
  if (cocks.length < 2) return;
  const pick2 = (a: Hen) => {
    let best: Hen | null = null;
    let bd = Infinity;
    for (const o of cocks) {
      if (o === a || !sameArea(s, a.x, a.z, o.x, o.z)) continue;
      const d = Math.hypot(o.x - a.x, o.z - a.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  };
  // le nouveau venu cherche querelle dans les secondes qui suivent son arrivée
  const fresh = cocks.find((h) => !h.ranked);
  if (fresh) {
    const foe = rand(s) < dt / 3 ? pick2(fresh) : null;
    if (foe) startFight(s, fresh, foe, true);
    return;
  }
  const pairs = (cocks.length * (cocks.length - 1)) / 2;
  if (rand(s) < (pairs * ROOSTER_FIGHTS.perPairPerDay * dt) / DAY) {
    const a = cocks[Math.floor(rand(s) * cocks.length)];
    const foe = pick2(a);
    if (foe) startFight(s, a, foe, false);
  }
}

function startFight(s: GameState, a: Hen, b: Hen, first: boolean) {
  const t = randRange(s, ROOSTER_FIGHTS.duration[0], ROOSTER_FIGHTS.duration[1]) + Math.hypot(a.x - b.x, a.z - b.z) / 1.2;
  for (const [h, o] of [
    [a, b],
    [b, a],
  ] as const) {
    const r = rtHen(h);
    h.act = 'fight';
    h.actT = t;
    h.targetId = -1;
    r.foe = o.id;
    r.slot = -1;
    r.pathKey = -1;
  }
  emit(s, { kind: 'cluck', henId: a.id });
  emit(s, { kind: 'cluck', henId: b.id });
  if (first) notify(s, `${a.name} et ${b.name} se disputent la basse-cour : chaque coq doit trouver sa place.`, 'info', '🐓');
}

/** Face-à-face : chacun se tient à une demi-longueur de l'autre et tourne autour en le toisant. */
function fightTick(s: GameState, h: Hen, r: HenRt, dt: number, night: boolean) {
  const foe = s.hens.find((o) => o.id === r.foe);
  if (!foe || foe.act !== 'fight' || night) return decide(s, h, night);
  const dx = foe.x - h.x;
  const dz = foe.z - h.z;
  const d = Math.hypot(dx, dz) || 1;
  if (d > 0.62) {
    steer(s, h, r, foe.x - (dx / d) * 0.5, foe.z - (dz / d) * 0.5, speedOf(h, 'go'), dt);
  } else {
    // pas chassés autour de l'adversaire
    const side = Math.sin(s.clock.t * 1.7 + h.id) > 0 ? 1 : -1;
    const tx = h.x + (-dz / d) * 0.25 * side + (dx / d) * (d - 0.5);
    const tz = h.z + (dx / d) * 0.25 * side + (dz / d) * (d - 0.5);
    steer(s, h, r, tx, tz, speedOf(h, 'wander') * 0.8, dt);
  }
  h.heading = Math.atan2(foe.x - h.x, foe.z - h.z);
  if (h.actT <= 0) endFight(s, h, foe);
}

/** Fin du combat : le vaincu détale, le vainqueur bat des ailes et chante. */
function endFight(s: GameState, a: Hen, b: Hen) {
  const score = (h: Hen) => h.health * (h.black ? 1.1 : 1) * randRange(s, 0.6, 1.4);
  const [win, lose] = score(a) >= score(b) ? [a, b] : [b, a];
  for (const h of [a, b]) {
    h.ranked = true;
    h.wellbeing = Math.max(0, h.wellbeing - ROOSTER_FIGHTS.wellbeingLoss);
    rtHen(h).foe = -1;
  }
  lose.health = Math.max(1, lose.health - ROOSTER_FIGHTS.loserHealthLoss);
  setAct(win, 'flap', 1.4);
  emit(s, { kind: 'cluck', henId: win.id });
  startFlee(s, lose, win.x, win.z);
  if (lose.act !== 'flee') setAct(lose, 'idle', 1);
}

/** Une poule qu'on peut bousculer (elle n'est ni à table, ni au nid, ni dans un bâtiment). */
export function henMovable(h: Hen) {
  return !ANCHORED.has(h.act);
}

/** Panique : la poule détale à l'opposé du prédateur, en évitant les obstacles. */
function startFlee(s: GameState, h: Hen, px: number, pz: number, hawk = false) {
  const r = rtHen(h);
  // une buse au-dessus : elle court se cacher sous l'arbre le plus proche, s'il y en a un
  if (hawk) {
    const t = nearestTree(s, h.x, h.z, 8);
    if (t) {
      for (let k = 0; k < 6; k++) {
        const a = rand(s) * Math.PI * 2;
        const d = 0.7 + rand(s) * 0.9;
        const tx = t[0] + Math.sin(a) * d;
        const tz = t[1] + Math.cos(a) * d;
        if (canStand(s, tx, tz, 0.14)) {
          if (h.act !== 'flee' && rand(s) < 0.3) emit(s, { kind: 'cluck', henId: h.id });
          h.act = 'flee';
          h.tx = tx;
          h.tz = tz;
          h.actT = Math.max(1.3, Math.hypot(tx - h.x, tz - h.z) / 1.4);
          h.targetId = -1;
          r.slot = -1;
          r.pathKey = -1;
          return;
        }
      }
    }
  }
  const base = Math.atan2(h.x - px, h.z - pz);
  for (const off of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2.0, -2.0]) {
    const a = base + off;
    const tx = h.x + Math.sin(a) * 2.2;
    const tz = h.z + Math.cos(a) * 2.2;
    if (canStand(s, tx, tz, 0.14) && lineClear(s, h.x, h.z, tx, tz, 0.12)) {
      if (h.act !== 'flee' && rand(s) < 0.3) emit(s, { kind: 'cluck', henId: h.id });
      h.act = 'flee';
      h.tx = tx;
      h.tz = tz;
      h.actT = 1.3;
      h.targetId = -1;
      r.slot = -1;
      r.pathKey = -1;
      return;
    }
  }
  // acculée : elle bat des ailes sur place
  setAct(h, 'flap', 0.6);
}

function behave(s: GameState, h: Hen, dt: number, night: boolean, hour: number) {
  const r = rtHen(h);
  h.actT -= dt;
  h.thinkT -= dt;

  // un renard ou une buse approche : sauve qui peut !
  if (s.predators.length && SCARED.has(h.act)) {
    const p = threatNear(s, h.x, h.z);
    if (p) return startFlee(s, h, p.x, p.z, p.species === 'hawk');
  }

  // Délogée par une construction ? On la replace sur la case libre la plus proche.
  if (!ANCHORED.has(h.act) && h.act !== 'stray' && !isWalkable(s, h.x, h.z)) {
    const p = nearestWalkable(s, h.x, h.z);
    if (p) [h.x, h.z] = p;
  }

  if (h.thinkT <= 0) {
    h.thinkT = 1.2 + rand(s) * 0.6;
    const interruptible = ['walk', 'peck', 'scratch', 'preen', 'flap', 'rest', 'idle', 'goBath', 'wait'].includes(h.act);
    if (night && interruptible) return decide(s, h, night);
    if (interruptible && (h.satiety < NEEDS.urgentAt || h.hydration < NEEDS.urgentAt || (h.layProgress >= 1 && hour < LAYING.lastLayHour))) return decide(s, h, night);
    if (rand(s) < 0.004) emit(s, { kind: 'cluck', henId: h.id });
  }

  switch (h.act) {
    case 'idle':
    case 'rest':
    case 'preen':
    case 'flap':
      nudge(s, h, r, dt);
      if (h.actT <= 0) decide(s, h, night);
      break;
    case 'walk': {
      if (r.pauseT > 0) {
        // petite halte pour regarder autour (allure saccadée des poules)
        r.pauseT -= dt;
        r.spd *= Math.max(0, 1 - dt * 10);
        break;
      }
      const roam = r.pathKey === ROAM_PATH;
      if (rand(s) < dt * (roam ? 0.2 : 0.45)) r.pauseT = randRange(s, 0.25, 0.7);
      let wx = h.tx;
      let wz = h.tz;
      if (roam) {
        while (r.path.length > 2 && Math.hypot(r.path[0] - h.x, r.path[1] - h.z) < 0.2) r.path.splice(0, 2);
        if (r.path.length) [wx, wz] = r.path;
      }
      // une longue traversée se fait d'un pas plus vif (elle ralentit en arrivant)
      const far = roam && Math.hypot(h.tx - h.x, h.tz - h.z) > 2.5;
      const res = steer(s, h, r, wx, wz, far ? speedOf(h, 'go') : speedOf(h, 'wander'), dt);
      const done = Math.hypot(h.tx - h.x, h.tz - h.z) < 0.06 || (res === 'arrived' && !(roam && r.path.length > 2));
      if (done) {
        r.pathKey = -1;
        setAct(h, rand(s) < 0.4 ? 'scratch' : 'peck', randRange(s, 2, 4.5));
      } else if ((res === 'blocked' && r.stuckT > 0.5) || h.actT <= 0) decide(s, h, night);
      break;
    }
    case 'wait': {
      if (Math.hypot(h.tx - h.x, h.tz - h.z) > 0.1) steer(s, h, r, h.tx, h.tz, speedOf(h, 'wander'), dt);
      else nudge(s, h, r, dt);
      if (h.actT <= 0 || r.stuckT > 1) decide(s, h, night);
      break;
    }
    case 'peck':
      forage(s, h, dt, 1);
      nudge(s, h, r, dt);
      if (h.actT <= 0) decide(s, h, night);
      break;
    case 'scratch':
      forage(s, h, dt, 0.5);
      nudge(s, h, r, dt);
      if (h.actT <= 0) setAct(h, 'peck', randRange(s, 1.2, 2.5));
      break;
    case 'goEat':
    case 'goDrink':
    case 'goNest':
    case 'goBath':
    case 'goCoop':
    case 'goCompost':
      goTick(s, h, r, dt, night);
      break;
    case 'worms': {
      const b = getBuilding(s, h.targetId);
      if (!b || b.stock <= 0 || h.protein >= 98 || h.actT <= 0) return decide(s, h, night);
      const eaten = Math.min(COMPOST.eatRate * dt, b.stock);
      b.stock -= eaten;
      h.protein = Math.min(100, h.protein + eaten * COMPOST.proteinPerPortion);
      h.satiety = Math.min(100, h.satiety + eaten * 5);
      break;
    }
    case 'flee': {
      const res = steer(s, h, r, h.tx, h.tz, speedOf(h, 'flee'), dt);
      if (res === 'arrived' || h.actT <= 0 || (res === 'blocked' && r.stuckT > 0.3)) {
        const p = threatNear(s, h.x, h.z, 1.4);
        if (p) startFlee(s, h, p.x, p.z, p.species === 'hawk');
        else decide(s, h, night);
      }
      break;
    }
    case 'stray':
      strayTick(s, h, r, dt, night);
      break;
    case 'fight':
      fightTick(s, h, r, dt, night);
      break;
    case 'caught':
      // tenue par le prédateur : il impose sa position ; relâchée, elle repart
      r.spd = 0;
      if (h.actT <= 0) decide(s, h, night);
      break;
    case 'enter':
    case 'exit': {
      // la rampe du poulailler se gravit d'un pas décidé (il fait nuit)
      const intoCoop = h.act === 'enter' && isShelterType(getBuilding(s, h.targetId)?.type ?? 'nest');
      const res = steer(s, h, r, h.tx, h.tz, intoCoop ? speedOf(h, 'go') * 1.2 : speedOf(h, 'inside'), dt, true);
      if (res === 'arrived' || h.actT <= 0) {
        h.x = h.tx;
        h.z = h.tz;
        const next = r.next;
        if (next === 'idle') return decide(s, h, night);
        setAct(h, next, r.nextT, h.targetId);
        if (next === 'lay' || next === 'sleep') h.heading = 0;
      }
      break;
    }
    case 'eat': {
      const b = getBuilding(s, h.targetId);
      if (!b || b.stock <= 0 || h.satiety >= NEEDS.fullAt || h.actT <= 0) return leaveFeeder(s, h, b, night);
      faceFood(s, h, b);
      const gain = Math.min(NEEDS.eatRate * dt, 100 - h.satiety);
      const waste = lvl(b).waste ?? 0;
      const need = (gain / NEEDS.pointsPerRation) * (1 + waste);
      const used = Math.min(need, b.stock);
      b.stock -= used;
      recordUse(s, 'grain', used);
      h.satiety += gain * (used / need);
      break;
    }
    case 'drink': {
      const b = getBuilding(s, h.targetId);
      if (!b || b.stock <= 0 || h.hydration >= NEEDS.fullAt || h.actT <= 0) return leaveFeeder(s, h, b, night);
      faceFood(s, h, b);
      const gain = Math.min(NEEDS.drinkRate * dt, 100 - h.hydration);
      const need = gain / NEEDS.pointsPerLiter;
      const used = Math.min(need, b.stock);
      b.stock -= used;
      // l'eau de la mare est de l'eau de pluie : elle ne compte pas dans la consommation de la cuve
      if (b.type === 'drinker') recordUse(s, 'water', used);
      h.hydration += gain * (used / need);
      break;
    }
    case 'bathe': {
      h.wellbeing = Math.min(100, h.wellbeing + (6 * dt) / 10);
      if (h.actT > 0) break;
      const b = getBuilding(s, h.targetId);
      if (!b) return decide(s, h, night);
      const [ax, az] = approachPoint(s, b, [h.x, h.z]);
      move(h, 'exit', ax, az, 'idle', 0, b.id);
      break;
    }
    case 'lay': {
      if (h.actT > 0) break;
      const nest = h.targetId >= 0 ? getBuilding(s, h.targetId) : undefined;
      h.layProgress = Math.max(0, h.layProgress - 1);
      if (nest && nest.type === 'nest' && nestFree(nest) > 0) {
        layEgg(s, h, nest);
        move(h, 'exit', h.x, nest.z + 1.34, 'idle', 0, nest.id);
      } else {
        const egg = layEgg(s, h, null);
        egg.x = h.x + Math.sin(h.heading + Math.PI) * 0.2;
        egg.z = h.z + Math.cos(h.heading + Math.PI) * 0.2;
        if (nest) move(h, 'exit', h.x, nest.z + 1.34, 'idle', 0, nest.id);
        else decide(s, h, night);
      }
      break;
    }
    case 'sleep': {
      // réveil échelonné au petit matin : la poule sort par la porte
      const wake = TIME.NIGHT_END + ((h.id * 37) % 60) / 80;
      const shut = getBuilding(s, h.coopId)?.closed;
      // trappe encore fermée : la poule attend que le commis vienne ouvrir
      if (!night && hour >= wake && !shut) {
        const coop = getBuilding(s, h.coopId);
        if (!coop) return decide(s, h, false);
        const [ix, iz] = coopInside(coop);
        h.x = ix;
        h.z = iz;
        h.heading = 0;
        const door = coopDoor(coop);
        move(h, 'exit', door.x + randRange(s, -0.3, 0.3), door.z + 0.55 + rand(s) * 0.3, 'idle', 0, coop.id);
      }
      break;
    }
  }
}

/** Replace les poules après une modification du terrain (construction, déplacement…). */
export function resetHenAfterLayout(s: GameState) {
  const r = rt(s);
  for (const h of s.hens) {
    if (h.act === 'sleep') {
      const coop = getBuilding(s, h.coopId);
      if (coop) [h.x, h.z] = coopInside(coop);
      continue;
    }
    const cx = Math.floor(h.x);
    const cz = Math.floor(h.z);
    if (!inGrid(cx, cz) || !r.walk[cellIndex(cx, cz)]) {
      const p = nearestWalkable(s, h.x, h.z);
      if (p) [h.x, h.z] = p;
    }
    setAct(h, 'idle', 0.2);
    rtHen(h).slot = -1;
  }
}

export function prepareHenStep(s: GameState) {
  stepStamp++;
  for (const h of s.hens) {
    const r = rtHen(h);
    r.px = h.x;
    r.pz = h.z;
    r.ph = h.heading;
  }
  computeSeparation(s);
}
