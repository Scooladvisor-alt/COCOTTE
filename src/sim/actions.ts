// Toutes les commandes du joueur. Chaque action valide ses préconditions AVANT de
// modifier l'état : une action refusée ne laisse aucune trace (ni argent, ni objet).
import { BREEDING, COSTS, DELIVERY, GRAIN_BINS, HEN_PACKS, GRAIN_SACKS, GRASS, HEALTH, PARCELS, REPUTATION, WATER_PACKS, WATER_TANKS, WORLD, parcelPrice, sackPrice, waterPrice } from '../config/balance';
import { grainCapacity, takeGrain, takeWater, waterCapacity } from './stocks';
import { BREEDS, ROOSTER_TITLES, isGoose } from '../config/breeds';
import { BUILDINGS, sizeOf } from '../config/buildings';
import { buildingCenter, emit, invalidateLayout, isShelter, isWalkable, nearestWalkable, newId, notify, parcelCoords, pick, rand } from './core';
import { GATE_IN, arriveAt, scheduleTruck, syncWaveLeave } from './deliveries';
import { addXp, breedUnlocked, earn, farmLevel, fmtMoney, levelReached, maxParcelsOf, spend } from './economy';
import { canPlace, cleaningCost, countOfType } from './buildings';
import { collectEggs, collectNest } from './eggs';
import { reseedParcel } from './grass';
import { createHen, henValue, recallHen, resetHenAfterLayout } from './hens';
import { autoEnclose } from './fences';
import { adultCount, coopFor, coopOccupancy, getBuilding, getHen, landCapacity, lvl, shelterType, storageFree } from './queries';
import { makeBuilding } from './state';
import type { ActionResult, BreedId, BuildingType, GameState } from './types';

const fail = (reason: string): ActionResult => ({ ok: false, reason });
const OK: ActionResult = { ok: true };

// ------------------------------------------------------------- Poules ----
export function checkBuyHen(s: GameState, breed: BreedId): ActionResult {
  const def = BREEDS[breed];
  if (!def) return fail('Race inconnue');
  if (!breedUnlocked(s, breed)) return fail(`Débloquée au niveau ${def.reqLevel}`);
  if (adultCount(s) + pendingHens(s) >= landCapacity(s)) return fail('Terrain plein : achetez une parcelle');
  if (coopRoom(s, breed) <= 0 || !coopFor(s, breed)) {
    if (isGoose(breed)) return fail(s.buildings.some((b) => b.type === 'goosehouse') ? 'Abri à oies plein : agrandissez-le ou construisez-en un autre' : 'Construisez d’abord un abri à oies');
    return fail(def.reqCoop > 1 ? `Il faut une place dans un poulailler niv. ${def.reqCoop}+` : 'Poulailler plein : améliorez-le ou construisez-en un');
  }
  if (s.money < def.price) return fail('Fonds insuffisants');
  return OK;
}

export function buyHen(s: GameState, breed: BreedId): ActionResult {
  const chk = checkBuyHen(s, breed);
  if (!chk.ok) return chk;
  const def = BREEDS[breed];
  const coop = coopFor(s, breed)!;
  if (!spend(s, def.price, 'poules', `Achat ${def.name}`)) return fail('Fonds insuffisants');
  const h = createHen(s, breed, coop, s.stats.hensBought === 0);
  s.hens.push(h);
  s.stats.hensBought++;
  s.stats.boughtBreeds[breed] = (s.stats.boughtBreeds[breed] ?? 0) + 1;
  emit(s, { kind: 'henArrived', henId: h.id });
  emit(s, { kind: 'purchase', amount: def.price, label: def.name });
  return OK;
}

// ------------------------------------------------------- Lots de poules ----
/** Poules commandées en lot, pas encore entrées dans la ferme. */
export function pendingHens(s: GameState) {
  return s.deliveries.reduce((a, d) => a + d.count - (d.out ?? 0), 0);
}
/** Places libres dans les poulaillers qui acceptent la race (moins les poules attendues). */
export function coopRoom(s: GameState, breed: BreedId) {
  let free = 0;
  const need = isGoose(breed) ? 1 : BREEDS[breed].reqCoop;
  for (const c of s.buildings) if (c.type === shelterType(breed) && c.level >= need) free += Math.max(0, lvl(c).capacity - coopOccupancy(s, c.id));
  return free - pendingHens(s);
}
/** Prix d'un lot : chaque poule revient moins cher. */
export function henPackPrice(breed: BreedId, count: number) {
  const pack = HEN_PACKS.find((p) => p.count === count);
  return Math.round((BREEDS[breed].price * count * (1 - (pack?.discount ?? 0))) / 10) * 10;
}

/** Vérifie une commande de `trucks` camions portant chacun un lot de `count` poules. */
export function checkBuyHenPack(s: GameState, breed: BreedId, count: number, trucks = 1): ActionResult {
  const def = BREEDS[breed];
  if (!def || !HEN_PACKS.some((p) => p.count === count)) return fail('Lot inconnu');
  if (!breedUnlocked(s, breed)) return fail(`Débloquée au niveau ${def.reqLevel}`);
  if (trucks < 1 || trucks > DELIVERY.slots) return fail('Trop de camions');
  const total = count * trucks;
  const land = landCapacity(s) - adultCount(s) - pendingHens(s);
  if (land < total) return fail(land > 0 ? `Terrain : place pour ${land} poule${land > 1 ? 's' : ''} seulement` : 'Terrain plein : achetez une parcelle');
  const room = coopRoom(s, breed);
  if (room < total) {
    if (isGoose(breed)) return fail(!s.buildings.some((b) => b.type === 'goosehouse') ? 'Construisez d’abord un abri à oies' : room > 0 ? `Abris à oies : place pour ${room} oie${room > 1 ? 's' : ''} seulement` : 'Abris à oies pleins');
    return fail(room > 0 ? `Poulaillers : place pour ${room} poule${room > 1 ? 's' : ''} seulement` : def.reqCoop > 1 ? `Il faut des places dans un poulailler niv. ${def.reqCoop}+` : 'Poulaillers pleins');
  }
  if (s.money < henPackPrice(breed, count) * trucks) return fail('Fonds insuffisants');
  return OK;
}

/**
 * Commande un ou plusieurs lots : un camion par lot. Les camions commandés ensemble (ou peu
 * avant l'arrivée du convoi) arrivent en convoi et se garent l'un derrière l'autre.
 */
export function buyHenPack(s: GameState, breed: BreedId, count: number, trucks = 1): ActionResult {
  const chk = checkBuyHenPack(s, breed, count, trucks);
  if (!chk.ok) return chk;
  const def = BREEDS[breed];
  const price = henPackPrice(breed, count) * trucks;
  if (!spend(s, price, 'poules', trucks > 1 ? `${trucks} lots de ${count} ${def.name}` : `Lot de ${count} ${def.name}`)) return fail('Fonds insuffisants');
  for (let k = 0; k < trucks; k++) {
    const at = scheduleTruck(s);
    s.deliveries.push({ id: newId(s), breed, count, out: 0, ...at });
    syncWaveLeave(s, at.wave ?? 0);
  }
  emit(s, { kind: 'purchase', amount: price, label: `Lot de ${count} ${def.name}` });
  notify(
    s,
    trucks > 1
      ? `Commande passée : ${trucks} camions du couvoir livrent vos ${count * trucks} ${def.name} au portail d’ici peu.`
      : `Commande passée : le camion du couvoir livre vos ${count} ${def.name} au portail d’ici peu.`,
    'good',
    '🚚',
  );
  return OK;
}

/**
 * Déchargement : chaque poule passe le portail à son tour (sim/deliveries.ts), puis part en
 * trottinant vers le pré ; le lot est soldé quand la dernière est entrée.
 */
export function updateDeliveries(s: GameState) {
  if (!s.deliveries.length) return;
  for (const d of [...s.deliveries]) {
    if (s.clock.t < d.eta) continue;
    let out = d.out ?? 0;
    while (out < d.count && s.clock.t >= arriveAt(d, out)) {
      const coop = coopFor(s, d.breed) ?? s.buildings.find((b) => b.type === shelterType(d.breed)) ?? s.buildings.find((b) => b.type === 'coop');
      if (!coop) {
        out = d.count;
        break;
      }
      const h = createHen(s, d.breed, coop, s.stats.hensBought === 0, { at: [GATE_IN[0] + (rand(s) - 0.5) * 0.16, GATE_IN[1]] });
      // elle s'écarte du portail pour laisser entrer la suivante
      h.act = 'walk';
      h.tx = GATE_IN[0] + (rand(s) - 0.5) * 2.4;
      h.tz = GATE_IN[1] - 1.4 - rand(s) * 2;
      h.actT = 8;
      h.heading = Math.PI;
      s.hens.push(h);
      s.stats.hensBought++;
      s.stats.boughtBreeds[d.breed] = (s.stats.boughtBreeds[d.breed] ?? 0) + 1;
      emit(s, { kind: 'henArrived', henId: h.id });
      out++;
    }
    d.out = out;
    if (out >= d.count) {
      s.deliveries.splice(s.deliveries.indexOf(d), 1);
      notify(s, `Livraison : ${d.count} ${BREEDS[d.breed].name} sont entrées et rejoignent le poulailler.`, 'good', '🚚');
    }
  }
}

export const roosterPrice = (breed: BreedId) => Math.round((BREEDS[breed].price * BREEDING.roosterPriceMult) / 10) * 10;

export function checkBuyRooster(s: GameState, breed: BreedId): ActionResult {
  const chk = checkBuyHen(s, breed);
  if (!chk.ok && chk.reason !== 'Fonds insuffisants') return chk;
  if (s.money < roosterPrice(breed)) return fail('Fonds insuffisants');
  return OK;
}

/** Coq : il ne pond pas, mais féconde les œufs d'une dizaine de poules (couveuse → poussins). */
export function buyRooster(s: GameState, breed: BreedId): ActionResult {
  const chk = checkBuyRooster(s, breed);
  if (!chk.ok) return chk;
  const price = roosterPrice(breed);
  const coop = coopFor(s, breed)!;
  if (!spend(s, price, 'poules', `Achat ${ROOSTER_TITLES[breed].toLowerCase()}`)) return fail('Fonds insuffisants');
  const h = createHen(s, breed, coop, false, { rooster: true });
  s.hens.push(h);
  s.stats.roostersBought++;
  emit(s, { kind: 'henArrived', henId: h.id });
  emit(s, { kind: 'purchase', amount: price, label: ROOSTER_TITLES[breed] });
  return OK;
}

export function sellHen(s: GameState, henId: number): ActionResult {
  const h = getHen(s, henId);
  if (!h) return fail('Poule introuvable');
  const value = henValue(h);
  s.hens.splice(s.hens.indexOf(h), 1);
  earn(s, value, 'reventes', `Revente de ${h.name}`);
  s.stats.hensSold++;
  emit(s, { kind: 'henGone', henId, reason: 'sold' });
  emit(s, { kind: 'money', amount: value, x: h.x, z: h.z });
  return OK;
}

/**
 * Coqs en trop : on garde le meilleur reproducteur (le plus beau, le plus pondeur, le plus robuste
 * et en bonne santé) — un coq pour les poules et un jars pour les oies — et on vend les autres.
 * Les coqs entièrement noirs, rarissimes, ne partent jamais d'office.
 */
export function extraRoosters(s: GameState) {
  const adults = s.hens.filter((h) => h.rooster && !h.young);
  const score = (h: (typeof adults)[number]) => {
    const g = h.genes ?? { p: 2, r: 2, b: 2 };
    return g.p + g.r + g.b + h.health / 100 + (h.sick ? -5 : 0);
  };
  const out: typeof adults = [];
  for (const goose of [false, true]) {
    const group = adults.filter((h) => isGoose(h.breed) === goose).sort((a, b) => score(b) - score(a));
    // le gardien : le meilleur coq ordinaire (s'il n'y a que des coqs noirs, l'un d'eux reste)
    const keeper = group.find((h) => !h.black) ?? group[0];
    for (const h of group) if (h !== keeper && !h.black) out.push(h);
  }
  return out;
}

export function sellExtraRoosters(s: GameState): ActionResult {
  const extra = extraRoosters(s);
  if (!extra.length) return fail('Un seul coq : rien à vendre');
  let total = 0;
  for (const h of extra) {
    total += henValue(h);
    sellHen(s, h.id);
  }
  notify(s, `${extra.length} coq${extra.length > 1 ? 's' : ''} vendu${extra.length > 1 ? 's' : ''} pour ${fmtMoney(total)} : vous gardez votre meilleur reproducteur.`, 'good', '🐓');
  return OK;
}

/**
 * Les oies dorment dans leur abri, pas avec les poules : celles qui logeaient encore au poulailler
 * (anciennes parties, ou avant le premier abri) y déménagent dès qu'il y a de la place.
 */
export function rehouseGeese(s: GameState) {
  for (const h of s.hens) {
    if (!isGoose(h.breed)) continue;
    const cur = getBuilding(s, h.coopId);
    if (cur?.type === 'goosehouse') continue;
    const home = coopFor(s, h.breed);
    if (!home) continue;
    h.coopId = home.id;
    if (h.act === 'sleep' && cur) {
      h.act = 'idle';
      h.actT = 0;
    }
  }
}

/** Vieille poule confiée à une association ou à un particulier : elle coulera une retraite paisible. */
export function rehomeHen(s: GameState, henId: number): ActionResult {
  const h = getHen(s, henId);
  if (!h) return fail('Poule introuvable');
  if (h.young) return fail('Un poussin reste à la ferme');
  s.hens.splice(s.hens.indexOf(h), 1);
  s.stats.hensRehomed++;
  s.reputation = Math.min(100, s.reputation + REPUTATION.rehomed);
  emit(s, { kind: 'henGone', henId, reason: 'sold' });
  notify(s, `${h.name} part couler une retraite paisible ${pick(s, ADOPTERS)}.`, 'good', '🏡');
  return OK;
}
const ADOPTERS = ['chez une famille du village', 'dans un refuge de l’association « Poules heureuses »', 'chez une institutrice qui a un grand jardin', 'chez des particuliers qui voulaient des poules', 'dans la ferme pédagogique voisine'];

export function healHen(s: GameState, henId: number): ActionResult {
  const h = getHen(s, henId);
  if (!h) return fail('Poule introuvable');
  if (h.health >= 95 && !h.sick) return fail('Elle est en pleine santé');
  if (!spend(s, HEALTH.vetCost, 'soins', `Vétérinaire pour ${h.name}`)) return fail('Fonds insuffisants');
  h.health = Math.min(100, h.health + HEALTH.vetHeal);
  h.sick = false;
  return OK;
}

export function renameHen(s: GameState, henId: number, name: string): ActionResult {
  const h = getHen(s, henId);
  const clean = name.trim().slice(0, 18);
  if (!h || !clean) return fail('Nom invalide');
  h.name = clean;
  return OK;
}

// ------------------------------------------------------------ Ressources ----
export function buyGrain(s: GameState, sackId: string): ActionResult {
  const sack = GRAIN_SACKS.find((g) => g.id === sackId);
  if (!sack) return fail('Produit inconnu');
  if (!levelReached(s, sack.reqLevel)) return fail(`Disponible au niveau ${sack.reqLevel}`);
  const cap = grainCapacity(s);
  if (s.grain + sack.rations > cap + 0.01) return fail(`Réserve pleine (${Math.floor(s.grain)}/${cap}) : agrandissez-la`);
  const price = sackPrice(sack, s.market.grainIndex);
  if (!spend(s, price, 'grain', `${sack.name} de grain`)) return fail('Fonds insuffisants');
  s.grain += sack.rations;
  s.stats.grainBought += sack.rations;
  emit(s, { kind: 'purchase', amount: price, label: sack.name });
  return OK;
}

export function refillFeeder(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b || b.type !== 'feeder') return fail('Mangeoire introuvable');
  const missing = lvl(b).capacity - b.stock;
  if (missing < 0.5) return fail('Déjà pleine');
  if (s.grain <= 0) return fail('Plus de grain en réserve : achetez-en');
  b.stock += takeGrain(s, missing);
  s.stats.feederFills++;
  return OK;
}

export function refillDrinker(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b || b.type !== 'drinker') return fail('Abreuvoir introuvable');
  const missing = lvl(b).capacity - b.stock;
  if (missing < 0.3) return fail('Déjà plein');
  if (s.water < 0.3) return fail('Cuve d’eau vide : achetez de l’eau');
  b.stock += takeWater(s, missing);
  return OK;
}

// ----------------------------------------------------------------- Eau ----
/** Achète de l'eau livrée dans la cuve (tarif dégressif). */
export function buyWater(s: GameState, liters: number, label = 'Eau'): ActionResult {
  const room = waterCapacity(s) - s.water;
  liters = Math.floor(Math.min(liters, room));
  if (liters < 1) return fail('Cuve pleine');
  const price = waterPrice(liters);
  if (!spend(s, price, 'eau', `${label} (${liters} L)`)) return fail('Fonds insuffisants');
  s.water += liters;
  emit(s, { kind: 'purchase', amount: price, label });
  return OK;
}

export function buyWaterPack(s: GameState, id: string): ActionResult {
  const pack = WATER_PACKS.find((p) => p.id === id);
  if (!pack) return fail('Produit inconnu');
  if (!levelReached(s, pack.reqLevel)) return fail(`Disponible au niveau ${pack.reqLevel}`);
  if (s.water + pack.liters > waterCapacity(s) + 0.01) return fail(`Pas assez de place dans la cuve (${Math.floor(s.water)}/${waterCapacity(s)} L)`);
  return buyWater(s, pack.liters, pack.name);
}

/** Remplit la cuve à ras bord. */
export function fillTank(s: GameState): ActionResult {
  return buyWater(s, waterCapacity(s) - s.water, 'Remplissage de la cuve');
}

export function upgradeGrainBin(s: GameState): ActionResult {
  const next = GRAIN_BINS[s.grainBin];
  if (!next) return fail('Capacité maximale atteinte');
  if (!levelReached(s, next.reqLevel)) return fail(`Niveau de ferme ${next.reqLevel} requis`);
  if (!spend(s, next.cost, 'constructions', next.name)) return fail('Fonds insuffisants');
  s.grainBin++;
  emit(s, { kind: 'purchase', amount: next.cost, label: next.name });
  return OK;
}

export function upgradeWaterTank(s: GameState): ActionResult {
  const next = WATER_TANKS[s.waterTank];
  if (!next) return fail('Capacité maximale atteinte');
  if (!levelReached(s, next.reqLevel)) return fail(`Niveau de ferme ${next.reqLevel} requis`);
  if (!spend(s, next.cost, 'constructions', next.name)) return fail('Fonds insuffisants');
  s.waterTank++;
  emit(s, { kind: 'purchase', amount: next.cost, label: next.name });
  return OK;
}

export function refillAll(s: GameState): ActionResult {
  let any = false;
  for (const b of s.buildings) {
    if (b.type === 'feeder' && lvl(b).capacity - b.stock >= 0.5 && s.grain > 0) any = refillFeeder(s, b.id).ok || any;
    if (b.type === 'drinker' && lvl(b).capacity - b.stock >= 0.3 && s.water >= 0.3) any = refillDrinker(s, b.id).ok || any;
  }
  return any ? OK : fail('Rien à remplir');
}

export function cleanCoop(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b || !isShelter(b)) return fail('Poulailler introuvable');
  if (b.cleanliness > 92) return fail('Déjà propre');
  if (!spend(s, cleaningCost(b), 'litiere', `Litière ${lvl(b).name}`)) return fail('Fonds insuffisants');
  b.cleanliness = 100;
  s.stats.coopsCleaned++;
  return OK;
}

/** Le joueur ferme (ou rouvre) lui-même la trappe : à l'abri du renard pour la nuit. */
export function toggleCoopDoor(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b || !isShelter(b)) return fail('Poulailler introuvable');
  b.closed = !b.closed;
  if (b.closed) {
    const outside = s.hens.filter((h) => h.coopId === b.id && h.act !== 'sleep' && h.act !== 'enter').length;
    if (outside > 0) notify(s, `${outside} poule${outside > 1 ? 's sont' : ' est'} encore dehors : elle${outside > 1 ? 's' : ''} ne pourr${outside > 1 ? 'ont' : 'a'} plus rentrer.`, 'warn', '🔒');
  }
  return OK;
}

/** Rattraper une poule qui s'enfuit (clic sur elle). */
export function recallStray(s: GameState, henId: number): ActionResult {
  const h = getHen(s, henId);
  if (!h || !recallHen(s, h)) return fail('Elle n’est pas en train de s’enfuir');
  notify(s, `${h.name} est rattrapée ! Posez du grillage pour qu’elle ne reparte pas.`, 'good', '🐔');
  return OK;
}

// ---------------------------------------------------------------- Œufs ----
export function collectFromNest(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b || b.type !== 'nest') return fail('Pondoir introuvable');
  if (b.eggIds.length === 0) return fail('Aucun œuf à ramasser');
  if (storageFree(s) <= 0) return fail('Stockage plein : vendez des œufs ou agrandissez-le');
  const n = collectNest(s, b);
  return n > 0 ? OK : fail('Stockage plein');
}

export function collectGroundEgg(s: GameState, eggId: number): ActionResult {
  const e = s.worldEggs.find((x) => x.id === eggId);
  if (!e) return fail('Œuf déjà ramassé');
  if (storageFree(s) <= 0) return fail('Stockage plein');
  return collectEggs(s, [e]) > 0 ? OK : fail('Stockage plein');
}

export function collectAll(s: GameState): ActionResult {
  if (s.worldEggs.length === 0) return fail('Aucun œuf à ramasser');
  if (storageFree(s) <= 0) return fail('Stockage plein');
  const n = collectEggs(s, [...s.worldEggs]);
  return n > 0 ? OK : fail('Stockage plein');
}

// ----------------------------------------------------------- Bâtiments ----
/** Nombre maximal d'un bâtiment : aucune limite, sauf pour les installations uniques (réserve, étal). */
export function maxCount(_s: GameState, type: BuildingType) {
  return BUILDINGS[type].unique ? 1 : Infinity;
}

export function checkBuild(s: GameState, type: BuildingType): ActionResult {
  const def = BUILDINGS[type];
  if (!def.buildable) return fail('Non constructible');
  const L = def.levels[0];
  if (def.strictLevel ? farmLevel(s) < L.reqLevel : !levelReached(s, L.reqLevel)) return fail(`Débloqué au niveau ${L.reqLevel}`);
  if (countOfType(s, type) >= maxCount(s, type)) return fail(`Maximum atteint (${maxCount(s, type)})`);
  if (s.money < L.cost) return fail('Fonds insuffisants');
  return OK;
}

export function build(s: GameState, type: BuildingType, x: number, z: number): ActionResult {
  const chk = checkBuild(s, type);
  if (!chk.ok) return chk;
  const place = canPlace(s, type, x, z);
  if (!place.ok) return fail(place.reason ?? 'Emplacement invalide');
  const L = BUILDINGS[type].levels[0];
  if (!spend(s, L.cost, 'constructions', `Construction : ${L.name}`)) return fail('Fonds insuffisants');
  const b = makeBuilding(newId(s), type, x, z, s.clock.t);
  b.invested = L.cost;
  if (type === 'feeder') b.stock = takeGrain(s, L.capacity);
  if (type === 'drinker') b.stock = takeWater(s, L.capacity);
  s.buildings.push(b);
  invalidateLayout(s);
  relocateGroundEggs(s);
  resetHenAfterLayout(s);
  emit(s, { kind: 'build', buildingId: b.id });
  addXp(s, 5);
  // un nouvel abri à oies : les oies qui dormaient au poulailler y emménagent
  if (type === 'goosehouse') rehouseGeese(s);
  return OK;
}

export function checkUpgrade(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return fail('Bâtiment introuvable');
  const next = BUILDINGS[b.type].levels[b.level];
  if (!next) return fail('Niveau maximum atteint');
  if (!levelReached(s, next.reqLevel)) return fail(`Niveau de ferme ${next.reqLevel} requis`);
  if (growSpot(s, b) === null) {
    const { w, d } = sizeOf(b.type, b.level + 1);
    return fail(`Il faut ${w} × ${d} cases libres autour`);
  }
  if (s.money < next.cost) return fail('Fonds insuffisants');
  return OK;
}

/**
 * Où poser le bâtiment amélioré quand il s'agrandit (grandes auges) : sur place si la place est
 * libre, sinon décalé de quelques cases ; null s'il n'y a pas la place. Même emprise : sur place.
 */
export function growSpot(s: GameState, b: { id: number; type: BuildingType; x: number; z: number; level: number }): [number, number] | null {
  const cur = sizeOf(b.type, b.level);
  const nxt = sizeOf(b.type, b.level + 1);
  if (cur.w === nxt.w && cur.d === nxt.d) return [b.x, b.z];
  const tries: Array<[number, number]> = [];
  for (let dx = 0; dx <= nxt.w - cur.w; dx++) for (const dz of [0, -1, 1]) tries.push([b.x - dx, b.z + dz]);
  for (const dx of [1, -(nxt.w - cur.w) - 1]) tries.push([b.x + dx, b.z]);
  for (const [x, z] of tries) if (canPlace(s, b.type, x, z, b.id, b.level + 1).ok) return [x, z];
  return null;
}

export function upgrade(s: GameState, id: number): ActionResult {
  const chk = checkUpgrade(s, id);
  if (!chk.ok) return chk;
  const b = getBuilding(s, id)!;
  const next = BUILDINGS[b.type].levels[b.level];
  const spot = growSpot(s, b)!;
  if (!spend(s, next.cost, 'constructions', `Amélioration : ${next.name}`)) return fail('Fonds insuffisants');
  const grows = sizeOf(b.type, b.level + 1).w !== sizeOf(b.type, b.level).w || sizeOf(b.type, b.level + 1).d !== sizeOf(b.type, b.level).d;
  b.level++;
  if (grows) {
    // l'équipement s'allonge : nouvelle emprise, les poules qui s'en servaient recommencent
    [b.x, b.z] = spot;
    for (const h of s.hens) if (h.targetId === b.id && h.act !== 'sleep') (h.act = 'idle'), (h.actT = 0), (h.targetId = -1);
    invalidateLayout(s);
    relocateGroundEggs(s);
    resetHenAfterLayout(s);
  }
  b.invested += next.cost;
  if (isShelter(b)) b.cleanliness = Math.max(b.cleanliness, 90);
  emit(s, { kind: 'upgrade', buildingId: b.id });
  addXp(s, 8 + b.level * 4);
  return OK;
}

export function move(s: GameState, id: number, x: number, z: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return fail('Bâtiment introuvable');
  if (!BUILDINGS[b.type].movable) return fail('Ce bâtiment ne se déplace pas');
  if (b.x === x && b.z === z) return OK;
  const place = canPlace(s, b.type, x, z, b.id, b.level);
  if (!place.ok) return fail(place.reason ?? 'Emplacement invalide');
  b.x = x;
  b.z = z;
  // les œufs du pondoir suivent
  if (b.type === 'nest') {
    const c = buildingCenter(b);
    for (const e of s.worldEggs) if (e.nestId === b.id) (e.x = c.x), (e.z = c.z);
  }
  // les poules en train d'utiliser le bâtiment reprennent leur activité
  for (const h of s.hens) if (h.targetId === b.id && h.act !== 'sleep') (h.act = 'idle'), (h.actT = 0), (h.targetId = -1);
  invalidateLayout(s);
  relocateGroundEggs(s);
  resetHenAfterLayout(s);
  emit(s, { kind: 'build', buildingId: b.id });
  return OK;
}

export function demolishRefund(s: GameState, id: number) {
  const b = getBuilding(s, id);
  return b ? Math.round(b.invested * COSTS.demolishRefund) : 0;
}

export function checkDemolish(s: GameState, id: number): ActionResult {
  const b = getBuilding(s, id);
  if (!b) return fail('Bâtiment introuvable');
  if (BUILDINGS[b.type].unique) return fail('Installation indispensable');
  if (isShelter(b)) {
    const hens = s.hens.filter((h) => h.coopId === b.id);
    if (hens.length > 0) {
      // les autres abris de la même espèce peuvent-ils accueillir ces volailles ?
      const free = new Map<number, number>();
      for (const c of s.buildings) if (c.type === b.type && c.id !== b.id) free.set(c.id, lvl(c).capacity - coopOccupancy(s, c.id));
      for (const h of hens) {
        const target = [...free.entries()].find(([cid, f]) => f > 0 && (b.type === 'goosehouse' || getBuilding(s, cid)!.level >= BREEDS[h.breed].reqCoop));
        if (!target) return fail(b.type === 'goosehouse' ? 'Relogez ou vendez d’abord ses oies' : 'Relogez ou vendez d’abord ses poules');
        free.set(target[0], target[1] - 1);
      }
    }
  }
  return OK;
}

export function demolish(s: GameState, id: number): ActionResult {
  const chk = checkDemolish(s, id);
  if (!chk.ok) return chk;
  const b = getBuilding(s, id)!;
  if (isShelter(b)) {
    for (const h of s.hens.filter((x) => x.coopId === b.id)) {
      const others = s.buildings.filter((c) => c.type === b.type && c.id !== b.id && (b.type === 'goosehouse' || c.level >= BREEDS[h.breed].reqCoop));
      const target = others.find((c) => lvl(c).capacity - coopOccupancy(s, c.id) > 0);
      if (target) h.coopId = target.id;
    }
  }
  if (b.type === 'nest') {
    // les œufs restés dans le pondoir tombent au sol à côté
    for (const e of s.worldEggs) if (e.nestId === b.id) (e.where = 'ground'), (e.nestId = -1), (e.z += 1);
  }
  const refund = Math.round(b.invested * COSTS.demolishRefund);
  s.buildings.splice(s.buildings.indexOf(b), 1);
  if (refund > 0) earn(s, refund, 'reventes', `Démontage : ${lvl(b).name}`);
  for (const h of s.hens) if (h.targetId === b.id) (h.act = 'idle'), (h.actT = 0), (h.targetId = -1);
  invalidateLayout(s);
  relocateGroundEggs(s);
  resetHenAfterLayout(s);
  const c = buildingCenter(b);
  emit(s, { kind: 'demolish', buildingId: b.id, x: c.x, z: c.z });
  return OK;
}

/** Les œufs au sol recouverts par une construction sont déplacés à côté. */
function relocateGroundEggs(s: GameState) {
  for (const e of s.worldEggs) {
    if (e.where !== 'ground' || isWalkable(s, e.x, e.z)) continue;
    const p = nearestWalkable(s, e.x, e.z);
    if (p) [e.x, e.z] = p;
  }
}

// -------------------------------------------------------------- Terrain ----
export function parcelNeighbours(key: string) {
  const [c, r] = parcelCoords(key);
  return [
    [c + 1, r],
    [c - 1, r],
    [c, r + 1],
    [c, r - 1],
  ]
    .filter(([x, y]) => x >= 0 && y >= 0 && x < WORLD.COLS && y < WORLD.ROWS)
    .map(([x, y]) => `${x},${y}`);
}

export function checkBuyParcel(s: GameState, key: string): ActionResult {
  const [c, r] = parcelCoords(key);
  if (!(c >= 0 && r >= 0 && c < WORLD.COLS && r < WORLD.ROWS)) return fail('Parcelle invalide');
  if (s.parcels.includes(key)) return fail('Déjà à vous');
  if (!parcelNeighbours(key).some((k) => s.parcels.includes(k))) return fail('Doit toucher votre terrain');
  const max = maxParcelsOf(s);
  if (s.parcels.length >= max) return fail(`Niveau de ferme insuffisant (max ${max} parcelle${max > 1 ? 's' : ''})`);
  if (s.money < parcelPrice(s.parcels.length)) return fail('Fonds insuffisants');
  return OK;
}

export function buyParcel(s: GameState, key: string): ActionResult {
  const chk = checkBuyParcel(s, key);
  if (!chk.ok) return chk;
  const price = parcelPrice(s.parcels.length);
  if (!spend(s, price, 'terrain', `Parcelle ${key}`)) return fail('Fonds insuffisants');
  s.parcels.push(key);
  invalidateLayout(s);
  autoEnclose(s); // la clôture s'agrandit d'elle-même autour de la nouvelle parcelle
  emit(s, { kind: 'parcel', key });
  addXp(s, 15);
  notify(s, `Nouvelle parcelle ! Capacité du terrain : ${landCapacity(s)} poules.`, 'good', '🌱');
  return OK;
}

export function reseed(s: GameState, key: string): ActionResult {
  if (!s.parcels.includes(key)) return fail('Parcelle non possédée');
  if (!spend(s, GRASS.reseedCost, 'entretien', `Ressemis parcelle ${key}`)) return fail('Fonds insuffisants');
  reseedParcel(s, key);
  return OK;
}

export { parcelPrice, PARCELS };

// ------------------------------------------------------------ Personnel ----
export function setSpeed(s: GameState, speed: number) {
  s.clock.speed = speed;
}
