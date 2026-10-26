// Joueurs automatiques pour tester l'équilibrage sans interface.
import { EGG_ORDER, GRAIN_SACKS, HOUR, MARKET, TIME, UNLOCKS, parcelPrice } from '../src/config/balance';
import { BREEDS, BREED_ORDER } from '../src/config/breeds';
import { BUILDINGS } from '../src/config/buildings';
import * as A from '../src/sim/actions';
import { grainCapacity, waterCapacity } from '../src/sim/stocks';
import { canPlace } from '../src/sim/buildings';
import { currentHour } from '../src/sim/core';
import { farmLevel, levelDef } from '../src/sim/economy';
import { acceptContract, acceptOrder, canDeliver, dailyProduction, deliverOrder, refPrice, sellWholesale, setPrice, maxContracts } from '../src/sim/market';
import { buildingsOf, coopCapacity, landCapacity, lvl, storageCapacity, storedCount } from '../src/sim/queries';
import { dailyCharges } from '../src/sim/simulation';
import { shootPredator } from '../src/sim/predators';
import type { BuildingType, GameState } from '../src/sim/types';

function findSpot(s: GameState, type: BuildingType): [number, number] | null {
  for (const key of s.parcels) {
    const [c, r] = key.split(',').map(Number);
    for (let z = r * 10 + 1; z < r * 10 + 9; z++)
      for (let x = c * 10 + 1; x < c * 10 + 9; x++) if (canPlace(s, type, x, z).ok) return [x, z];
  }
  return null;
}

export function goodPlayer(s: GameState) {
  const level = farmLevel(s);
  const h = currentHour(s);
  // ramassage & soins de base
  A.collectAll(s);
  for (const b of s.buildings) {
    if (b.type === 'feeder' && b.stock < lvl(b).capacity * 0.5) A.refillFeeder(s, b.id);
    if (b.type === 'drinker' && b.stock < lvl(b).capacity * 0.5) A.refillDrinker(s, b.id);
    if (b.type === 'coop' && b.cleanliness < 50) A.cleanCoop(s, b.id);
  }
  for (const hen of s.hens) if (hen.sick || hen.health < 45) A.healHen(s, hen.id);
  const need = Math.max(15, s.hens.length * 1.5);
  if (s.grain < need) {
    const room = grainCapacity(s) - s.grain;
    const sack = [...GRAIN_SACKS].reverse().find((g) => g.reqLevel <= level && g.price < s.money * 0.5 && g.rations <= room) ?? GRAIN_SACKS[0];
    if (!A.buyGrain(s, sack.id).ok && s.money > 20000) A.upgradeGrainBin(s);
  }
  if (s.water < Math.max(40, s.hens.length * 3)) {
    if (!A.fillTank(s).ok && s.money > 15000) A.upgradeWaterTank(s);
  }
  if (s.hens.length * 4 > waterCapacity(s) && s.money > 20000) A.upgradeWaterTank(s);
  if (s.hens.length * 2.5 > grainCapacity(s) && s.money > 20000) A.upgradeGrainBin(s);
  // prix : selon le stock
  for (const t of EGG_ORDER) {
    const prod = dailyProduction(s, t);
    const stock = storedCount(s, t);
    const f = stock > prod * 1.5 ? 0.88 : stock < prod * 0.5 ? 1.12 : 1.0;
    setPrice(s, t, Math.round(refPrice(s, t) * f));
  }
  // commandes / contrats
  for (const o of s.orders) {
    if (o.status === 'offer' && storedCount(s, o.type) + dailyProduction(s, o.type) * 1.5 > o.qty) acceptOrder(s, o.id);
    if (o.status === 'active' && canDeliver(s, o)) deliverOrder(s, o.id);
  }
  for (const c of s.contracts)
    if (c.status === 'offer' && s.contracts.filter((x) => x.status === 'active').length < maxContracts(s) && dailyProduction(s, c.type) > c.qtyPerDay * 1.6)
      acceptContract(s, c.id);
  // coopérative si stock presque plein
  if (level >= UNLOCKS.wholesale && storedCount(s) > storageCapacity(s) * 0.8 && h > 16) {
    for (const t of EGG_ORDER) {
      const n = Math.floor(storedCount(s, t) * 0.4);
      if (n > 0) sellWholesale(s, t, n);
    }
  }
  // investissements
  const reserve = dailyCharges(s).total * 3 + 2000;
  const avail = s.money - reserve;
  const coops = buildingsOf(s, 'coop');
  // améliorer stockage si trop petit
  const st = buildingsOf(s, 'storage')[0];
  const nextSt = BUILDINGS.storage.levels[st.level];
  if (nextSt && dailyProduction(s) * 2.5 > lvl(st).capacity && nextSt.reqLevel <= level && avail > nextSt.cost) A.upgrade(s, st.id);
  // équipements automatiques
  for (const b of s.buildings) {
    if ((b.type === 'feeder' || b.type === 'drinker') && b.level === 1 && level >= 2 && s.money - reserve > BUILDINGS[b.type].levels[1].cost) A.upgrade(s, b.id);
    if (b.type === 'nest' && b.level < 3 && s.hens.length > b.level * 5 && BUILDINGS.nest.levels[b.level].reqLevel <= level && s.money - reserve > BUILDINGS.nest.levels[b.level].cost)
      A.upgrade(s, b.id);
    if (b.type === 'stand' && BUILDINGS.stand.levels[b.level] && BUILDINGS.stand.levels[b.level].reqLevel <= level && s.money - reserve > BUILDINGS.stand.levels[b.level].cost * 1.5)
      A.upgrade(s, b.id);
  }
  const full = s.hens.length >= coopCapacity(s);
  if (full) {
    const up = coops.find((c) => BUILDINGS.coop.levels[c.level] && BUILDINGS.coop.levels[c.level].reqLevel <= level && s.money - reserve > BUILDINGS.coop.levels[c.level].cost);
    if (up) A.upgrade(s, up.id);
    else if (coops.length < levelDef(s).maxCoops && s.money - reserve > BUILDINGS.coop.levels[0].cost) {
      const p = findSpot(s, 'coop');
      if (p) A.build(s, 'coop', p[0], p[1]);
    }
  }
  if (s.hens.length >= landCapacity(s) - 1 && s.parcels.length < levelDef(s).maxParcels && s.money - reserve > parcelPrice(s.parcels.length)) {
    for (const k of ['0,2', '2,2', '1,1', '0,1', '2,1', '3,2', '3,1', '1,0', '0,0', '2,0', '3,0']) if (A.buyParcel(s, k).ok) break;
  }
  // mangeoires / abreuvoirs supplémentaires
  const feeders = buildingsOf(s, 'feeder');
  const slots = feeders.reduce((a, b) => a + (lvl(b).slots ?? 3), 0);
  if (s.hens.length > slots * 2.2 && s.money - reserve > 6000) {
    const p = findSpot(s, 'feeder');
    if (p) A.build(s, 'feeder', p[0], p[1]);
  }
  const drinkers = buildingsOf(s, 'drinker');
  const dslots = drinkers.reduce((a, b) => a + (lvl(b).slots ?? 3), 0);
  if (s.hens.length > dslots * 2.2 && s.money - reserve > 5000) {
    const p = findSpot(s, 'drinker');
    if (p) A.build(s, 'drinker', p[0], p[1]);
  }
  const nests = buildingsOf(s, 'nest');
  if (s.hens.length > nests.length * 9 && s.money - reserve > 6000) {
    const p = findSpot(s, 'nest');
    if (p) A.build(s, 'nest', p[0], p[1]);
  }
  // acheter des poules (meilleure race disponible, avec diversité)
  for (let k = 0; k < 3; k++) {
    const options = BREED_ORDER.filter((b) => A.checkBuyHen(s, b).ok && BREEDS[b].price < s.money - reserve);
    if (!options.length) break;
    const pickB = options.sort((a, b) => BREEDS[b].price - BREEDS[a].price)[(s.hens.length % 3 === 0 ? 1 : 0) % options.length];
    A.buyHen(s, pickB);
  }
}

/** Réflexes du joueur : abat les prédateurs `reaction` secondes après leur apparition. */
export function guard(s: GameState, reaction = 3) {
  for (const p of [...s.predators]) if (p.state !== 'dead' && p.age >= reaction) shootPredator(s, p.id);
}

/** Joueur négligent : achète des poules mais ne nourrit ni n'abreuve. */
export function lazyPlayer(s: GameState) {
  A.collectAll(s);
  setPrice(s, 'roux', 400);
  if (s.hens.length < 3) A.buyHen(s, 'rousse');
}

export { HOUR, TIME, MARKET };
