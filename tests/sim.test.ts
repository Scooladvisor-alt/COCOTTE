import { describe, expect, it } from 'vitest';
import { AUTO_DOOR, BIRD_ORDERS, PETSHOP, TRUCK_BAY, TRUCK_COURT, TRUCK_HATCH_CELLS, inTruckBay, BREEDING, DELIVERY, EGG_ORDER, EGG_TYPES, GRID_W, GRID_Z0, GRID_Z1, HOUR, LEVELS, levelAt, MARKET, PARCELS, START, TIME, WORLD, parcelPrice, tradeAt, waterPrice } from '../src/config/balance';
import { GATE_EDGE, TRUCK_GATE_EDGES, farmEnclosed, hCode, perimeter, truckHatchEdges } from '../src/sim/fences';
import { RAMP_FOOT, TRUCK_REAR, alongPath, boardPath, boardRoute } from '../src/sim/deliveries';
import { autoEnclose } from '../src/sim/fences';
import { waterCapacity } from '../src/sim/stocks';
import { BREEDS, BREED_ORDER, GOOSE_NAMES, isGoose } from '../src/config/breeds';
import { BUILDINGS, BUILD_ORDER, COOP_SCALE, HALL_ALLEY, HALL_BODY, HALL_COURT, HALL_DOOR, HALL_STEPS, PET_POS, STAND_POS, penGate, penHatch, petLane, petLayout, sizeOf, standLayout } from '../src/config/buildings';
import { BACKUP_KEY, SAVE_KEY, deserialize, loadGame, saveGame, serialize, type Storage } from '../src/save/save';
import * as A from '../src/sim/actions';
import { canPlace } from '../src/sim/buildings';
import { makeBuilding } from '../src/sim/state';
import { wildPlants } from '../src/sim/wild';
import { nearestTree } from '../src/sim/perks';
import { accessCells, blocksMover, buildingCenter, cellIndex, parcelKeyOfCell, coopDoor, coopDoorCells, crossesFence, currentDay, drainEvents, footprint, invalidateLayout, isOwnedCell, isWalkable, rt, toLocal, toWorld } from '../src/sim/core';
import { freeSeats, hostedIncubators, nurseryCount, nurseryPlan, nurseryWithRoom, readyToLeave } from '../src/sim/nursery';
import {
  birdOrdersNewDay,
  birdOrdersOpen,
  truckParcelOwned,
  birdWord,
  callTruck,
  checkCallTruck,
  flockOf,
  generateBirdOrders,
  orderLabel,
  orderStock,
  petBuyChance,
  petCustomersPerDay,
  petPrice,
  petShopHourly,
  petShopOf,
  priceBounds,
  sellable,
  setPetPrice,
  stockBird,
  stockBirds,
  stockOf,
  stockOfKind,
  suggestedPrice,
  firePetSeller,
  hirePetSeller,
  isRareBird,
  petKeep,
  setPetKeep,
  togglePetRestock,
  unstockBird,
  unstockBirds,
  putBlackOnSale,
  cancelTruckCall,
} from '../src/sim/petshop';
import { onlineIsNewer } from '../src/online/farms';
import { canAfford, farmLevel, spend, today } from '../src/sim/economy';
import { addToStorage, ageEggs, collectNest, layEgg, takeFromStorage } from '../src/sim/eggs';
import {
  acceptOrder,
  cancelContract,
  cancelOrder,
  checkOrdersReady,
  deliverContractNow,
  deliverContracts,
  deliverOrder,
  generateOrders,
  lostToday,
  marketNewDay,
  queueLength,
  refPrice,
  sellWholesale,
  setPrice,
  standCounters,
  updateCustomers,
  wholesaleQuote,
  sellGoldEggs,
  setGoldPrice,
  goldBuyChance,
  goldPrice,
  serveCustomerForTest,
  maxContracts,
  maxOrders,
  palletsPerDay,
} from '../src/sim/market';
import { FEED_REACH, feedLayout, feedPose } from '../src/sim/feeding';
import { updateVaults, vaultOf } from '../src/sim/vault';
import { buildingsOf, coopCapacity, coopOccupancy, flockCapacity, landCapacity, lvl, storageCapacity, storageFree, storedCount } from '../src/sim/queries';
import { advance, advanceRealtime, canSkipNight, closeDay, dailyCharges, simulateOffline, skipNight, step } from '../src/sim/simulation';
import { createNewGame } from '../src/sim/state';
import { newFarm } from '../src/sim/starter';
import { creditLimit, dailyDue, loanRate, pauseLoan, quoteLoan, repayLoan, takeLoan } from '../src/sim/bank';
import type { GameState, Hen } from '../src/sim/types';
import { goodPlayer, guard, lazyPlayer } from '../scripts/bot';
import { buyWorkerSkill, dailyWages, fire, herdSpot, hire, sellerSpot, workerSkillsHourly } from '../src/sim/workers';
import { enterNursery } from '../src/sim/hens';
import { catchable, distanceToFarm, shootPredator, spawnPredator } from '../src/sim/predators';
import { buyDog, kennelPoint } from '../src/sim/dog';
import { buyRobot, dockOf } from '../src/sim/robots';
import { crowdedChicks, dadCount, eggHatchIn, fertileStock, fertility, fertilize, incubatable, incubateAll, loadIncubator, nurseryRoom } from '../src/sim/breeding';
import { ageFactor, baseLaying, createHen, eggsPerDayOf, henValue, productivity, refreshVitals, slotSpots, wellbeingTarget } from '../src/sim/hens';
import { COMPOST, NATURE, RARE } from '../src/config/balance';
import { parcelPerks, shelteredByTree } from '../src/sim/perks';
import { inherit, shopGenes } from '../src/sim/genetics';
import { season } from '../src/sim/seasons';
import { regrowGrass } from '../src/sim/grass';
import { SHOW_TIERS, enterShow, nextShowDay, showScore } from '../src/sim/show';

function run(s: GameState, seconds: number, each?: (s: GameState) => void, everySec = HOUR) {
  let acc = 0;
  for (let t = 0; t < seconds - 1e-9; t += TIME.STEP) {
    step(s, TIME.STEP);
    drainEvents(s);
    acc += TIME.STEP;
    if (each && acc >= everySec) {
      acc = 0;
      each(s);
    }
  }
}

/** Avance le temps en gardant tous les événements émis. */
function runEvents(s: GameState, seconds: number) {
  const out: ReturnType<typeof drainEvents> = [];
  for (let t = 0; t < seconds - 1e-9; t += TIME.STEP) {
    step(s, TIME.STEP);
    out.push(...drainEvents(s));
  }
  return out;
}

/** Fixe l'heure au matin du jour courant (utile pour éviter la nuit). */
/** Pose un abri à oies au premier emplacement libre (les oies en ont besoin pour s'acheter). */
function buildGooseHouse(s: GameState) {
  for (let z = -29; z < 29; z++) for (let x = 0; x < 80; x++) if (canPlace(s, 'goosehouse', x, z).ok) return A.build(s, 'goosehouse', x, z).ok;
  return false;
}

function morning(s: GameState) {
  const day = Math.floor(s.clock.t / TIME.DAY);
  s.clock.t = day * TIME.DAY + 8 * HOUR;
  s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
}

function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe('Test 1 — première partie', () => {
  it('démarre avec un terrain, de l’argent et les installations de base', () => {
    const s = createNewGame(1);
    expect(s.money).toBe(START.money);
    expect(s.parcels).toEqual(['0,2']);
    expect(s.hens).toHaveLength(0);
    for (const t of ['coop', 'nest', 'feeder', 'drinker', 'storage', 'stand'] as const) expect(buildingsOf(s, t)).toHaveLength(1);
  });

  it('achète sa première poule : argent débité du prix exact, poule logée', () => {
    const s = createNewGame(1);
    const r = A.buyHen(s, 'rousse');
    expect(r.ok).toBe(true);
    expect(s.money).toBe(START.money - BREEDS.rousse.price);
    expect(s.hens).toHaveLength(1);
    const coop = buildingsOf(s, 'coop')[0];
    expect(s.hens[0].coopId).toBe(coop.id);
    expect(s.stats.hensBought).toBe(1);
    expect(s.finance.days.at(-1)!.expense.poules).toBe(BREEDS.rousse.price);
  });

  it('refuse une race non débloquée', () => {
    const s = createNewGame(1);
    expect(A.buyHen(s, 'marans').ok).toBe(false);
    expect(s.money).toBe(START.money);
  });
});

describe('Test 2 — production', () => {
  it('une poule bien soignée pond, l’œuf apparaît au pondoir et se ramasse une seule fois', () => {
    const s = createNewGame(2);
    A.buyHen(s, 'rousse');
    run(s, 60);
    expect(s.stats.eggsLaid).toBeGreaterThan(0);
    const nest = buildingsOf(s, 'nest')[0];
    const inNest = nest.eggIds.length;
    expect(inNest).toBeGreaterThan(0);
    expect(s.worldEggs.filter((e) => e.where === 'nest')).toHaveLength(inNest);
    const r = A.collectFromNest(s, nest.id);
    expect(r.ok).toBe(true);
    expect(storedCount(s)).toBe(inNest);
    expect(nest.eggIds).toHaveLength(0);
    // second ramassage : rien à prendre, aucun doublon
    expect(A.collectFromNest(s, nest.id).ok).toBe(false);
    expect(storedCount(s)).toBe(inNest);
  });

  it('une poule négligée (sans eau ni grain) cesse de pondre puis dépérit', () => {
    const s = createNewGame(3);
    A.buyHen(s, 'rousse');
    for (const b of s.buildings) if (b.type === 'feeder' || b.type === 'drinker') b.stock = 0;
    s.grain = 0;
    s.grass = s.grass.map(() => 0);
    run(s, TIME.DAY * 1.5);
    const h = s.hens[0];
    expect(h.hydration).toBeLessThan(15);
    run(s, TIME.DAY * 4);
    expect(s.hens).toHaveLength(0);
    expect(s.stats.hensDied).toBe(1);
  });

  it('pondoir plein : les poules pondent au sol', () => {
    const s = createNewGame(4);
    A.buyHen(s, 'rousse');
    A.buyHen(s, 'rousse');
    const nest = buildingsOf(s, 'nest')[0];
    // remplit artificiellement le pondoir
    const h = s.hens[0];
    for (let i = 0; i < BUILDINGS.nest.levels[0].capacity; i++) {
      h.layProgress = 1;
      const e = { id: s.nextId++, type: 'roux' as const, quality: 0.7, freshness: 100, where: 'nest' as const, nestId: nest.id, x: 0, z: 0, laidAt: 0 };
      s.worldEggs.push(e);
      nest.eggIds.push(e.id);
    }
    h.layProgress = 0;
    run(s, 80);
    expect(s.worldEggs.some((e) => e.where === 'ground')).toBe(true);
  });
});

describe('Grand terrain, mares et arbres', () => {
  it('une mare abreuve les poules sans puiser dans la cuve, puis la pluie la remplit', () => {
    const s = createNewGame(31);
    s.money = 1e6;
    s.xp = 2000;
    morning(s);
    expect(A.build(s, 'pond', 3, 13).ok).toBe(true);
    const pond = s.buildings.find((b) => b.type === 'pond')!;
    // plus d'abreuvoir : la mare est le seul point d'eau
    for (const b of [...s.buildings]) if (b.type === 'drinker') s.buildings.splice(s.buildings.indexOf(b), 1);
    invalidateLayout(s);
    const coop = buildingsOf(s, 'coop')[0];
    for (let i = 0; i < 3; i++) s.hens.push(createHen(s, 'rousse', coop, false, { at: [5 + i, 18] }));
    for (const h of s.hens) h.hydration = 20;
    const tank = s.water;
    const full = pond.stock;
    run(s, HOUR * 6);
    expect(s.hens.some((h) => h.hydration > 40)).toBe(true);
    expect(pond.stock).toBeLessThan(full + 1);
    expect(s.water).toBe(tank);
    pond.stock = 0;
    for (const h of s.hens) h.hydration = 100;
    run(s, TIME.DAY / 2);
    expect(pond.stock).toBeGreaterThan(5);
  });

  it('les arbres d’ombrage améliorent le bien-être de la parcelle (plafonné)', () => {
    const s = createNewGame(32);
    s.money = 1e6;
    const h = createHen(s, 'rousse', buildingsOf(s, 'coop')[0], false, { at: [6, 16] });
    s.hens.push(h);
    refreshVitals(s);
    const before = wellbeingTarget(s, h);
    let placed = 0;
    for (let x = 1; x < 9 && placed < 6; x += 2) for (let z = 11; z < 19 && placed < 6; z += 3) if (A.build(s, 'tree', x, z).ok) placed++;
    expect(placed).toBe(6);
    refreshVitals(s);
    const after = wellbeingTarget(s, h);
    expect(after - before).toBeGreaterThan(5);
    expect(after - before).toBeLessThanOrEqual(NATURE.shadeMax + 0.01);
  });

  it('une ancienne sauvegarde (parcelles 10 × 10) garde ses positions et passe aux grandes parcelles', () => {
    const s = createNewGame(33);
    const raw = JSON.parse(serialize(s));
    raw.version = 6;
    raw.parcels = ['1,2', '2,2', '1,0'];
    raw.grass = new Array(40 * 30).fill(0.33);
    const back = deserialize(JSON.stringify(raw))!;
    expect(back.parcels.sort()).toEqual(['0,1', '0,2', '1,2'].sort());
    // le poulailler (agrandi depuis) est reposé au plus près de sa place
    const [c0, c1] = [s, back].map((g) => g.buildings.find((b) => b.type === 'coop')!);
    expect(Math.abs(c1.x - c0.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(c1.z - c0.z)).toBeLessThanOrEqual(3);
    expect(back.grass[(25 - -30) * 80 + 15]).toBeCloseTo(0.33);
  });
});

describe('Marché et ponte : historiques', () => {
  it('le cours de l’œuf évolue doucement et chaque jour est enregistré', () => {
    const s = createNewGame(41);
    let prev = refPrice(s, 'roux');
    let worst = 0;
    for (let d = 0; d < 40; d++) {
      s.clock.t += TIME.DAY;
      marketNewDay(s);
      const p = refPrice(s, 'roux');
      worst = Math.max(worst, Math.abs(p - prev) / prev);
      prev = p;
    }
    expect(worst).toBeLessThan(0.08);
    expect(s.market.history!.length).toBe(40);
    expect(s.market.history!.at(-1)!.p[0]).toBe(refPrice(s, 'roux'));
  });

  it('le taux de ponte moyen et les œufs pondus sont relevés chaque jour', () => {
    const s = newFarm(42);
    morning(s);
    run(s, TIME.DAY * 2, goodPlayer, HOUR * 2);
    const d = s.finance.days.find((x) => (x.layN ?? 0) > 0)!;
    expect(d).toBeTruthy();
    expect(d.laySum! / d.layN!).toBeGreaterThan(0);
    expect(s.finance.days.some((x) => (x.eggs ?? 0) > 0)).toBe(true);
  });
});

describe('Aménagements : effets réels', () => {
  it('bain de poussière, mare et arbres changent vraiment la parcelle (maladies, soif, buses)', () => {
    const s = createNewGame(61);
    s.money = 1e7;
    const key = '0,2';
    expect(parcelPerks(s, key).sick).toBe(1);
    expect(parcelPerks(s, key).thirst).toBe(1);
    expect(A.build(s, 'dustbath', 2, 12).ok).toBe(true);
    expect(parcelPerks(s, key).sick).toBeCloseTo(NATURE.dustSick[1]);
    expect(A.build(s, 'pond', 6, 12).ok).toBe(true);
    for (const [x, z] of [[2, 16], [4, 16], [6, 16]]) expect(A.build(s, 'tree', x, z).ok).toBe(true);
    const p = parcelPerks(s, key);
    expect(p.thirst).toBeLessThan(0.8);
    expect(p.wellbeing).toBeGreaterThanOrEqual(10 + 6 + 12);
    // à l'abri sous un arbre, pas loin de l'abri : non
    expect(shelteredByTree(s, 4.5, 17)).toBe(true);
    expect(shelteredByTree(s, 15, 25)).toBe(false);
  });

  it('une buse renonce à une poule réfugiée sous un arbre', () => {
    const s = createNewGame(62);
    morning(s);
    s.money = 1e7;
    expect(A.build(s, 'tree', 5, 15).ok).toBe(true);
    const h = createHen(s, 'rousse', buildingsOf(s, 'coop')[0], false, { at: [5.6, 15.6] });
    s.hens.push(h);
    const hawk = spawnPredator(s, 'hawk');
    hawk.cx = 5.5;
    hawk.cz = 15.5;
    let grabbed = false;
    for (let t = 0; t < 40; t += TIME.STEP) {
      // la poule reste sous son arbre
      h.x = 5.6;
      h.z = 15.6;
      step(s, TIME.STEP);
      drainEvents(s);
      if (s.predators.some((p) => p.state === 'grab')) grabbed = true;
    }
    expect(grabbed).toBe(false);
  });

  it('le compost fait économiser du grain', () => {
    const a = createNewGame(63);
    const b = createNewGame(63);
    const ha = createHen(a, 'rousse', buildingsOf(a, 'coop')[0]);
    const hb = createHen(b, 'rousse', buildingsOf(b, 'coop')[0]);
    hb.protein = 100;
    a.hens.push(ha);
    b.hens.push(hb);
    ha.act = hb.act = 'sleep';
    ha.satiety = hb.satiety = 100;
    for (let t = 0; t < 10; t += TIME.STEP) {
      ha.act = hb.act = 'sleep';
      step(a, TIME.STEP);
      step(b, TIME.STEP);
    }
    const lostA = 100 - ha.satiety;
    const lostB = 100 - hb.satiety;
    expect(lostB).toBeLessThan(lostA * (1 - COMPOST.grainSaving * 0.6));
  });
});

describe('Coq noir et chien de garde', () => {
  it('le coq entièrement noir est rare et se revend entre 600 et 700 €', () => {
    const s = createNewGame(51);
    const coop = buildingsOf(s, 'coop')[0];
    let black = 0;
    for (let i = 0; i < 2000; i++) if (createHen(s, 'rousse', coop, false, { rooster: true }).black) black++;
    expect(black / 2000).toBeGreaterThan(RARE.blackRoosterBuy * 0.5);
    expect(black / 2000).toBeLessThan(RARE.blackRoosterBuy * 1.6);
    // jamais une poule
    for (let i = 0; i < 300; i++) expect(createHen(s, 'rousse', coop).black).toBeFalsy();
    const h = createHen(s, 'sussex', coop, false, { rooster: true, black: true });
    h.health = 100;
    expect(henValue(h)).toBeGreaterThanOrEqual(60000);
    expect(henValue(h)).toBeLessThanOrEqual(70000);
    s.hens.push(h);
    const back = deserialize(serialize(s))!;
    expect(back.hens.find((x) => x.id === h.id)?.black).toBe(true);
    const before = s.money;
    expect(A.sellHen(s, h.id).ok).toBe(true);
    expect(s.money - before).toBeGreaterThanOrEqual(60000);
  });

  it('le chien ne se colle jamais au grillage, même en chassant ou quand l’enclos s’agrandit', () => {
    const s = createNewGame(52);
    morning(s);
    s.money = 1e7;
    expect(buyDog(s).ok).toBe(true);
    let closest = Infinity;
    for (let t = 0; t < TIME.DAY * 1.5; t += TIME.STEP) {
      step(s, TIME.STEP);
      drainEvents(s);
      if (Math.abs(t - TIME.DAY * 0.3) < TIME.STEP / 2) spawnPredator(s, 'fox');
      if (Math.abs(t - TIME.DAY * 0.6) < TIME.STEP / 2) A.buyParcel(s, '1,2');
      const d = s.dog!;
      if (d.x > -9.6 && d.x < -3.2 && d.z > 22 && d.z < 30) continue; // devant sa niche, près de la maison
      closest = Math.min(closest, distanceToFarm(s, d.x, d.z));
    }
    expect(closest).toBeGreaterThan(0.6);
  });
});

describe('Plumages', () => {
  it('les rousses achetées n’ont pas toutes le même plumage, et il est sauvegardé', () => {
    const s = createNewGame(21);
    s.money = 1_000_000;
    s.xp = 5000;
    const coop = buildingsOf(s, 'coop')[0];
    const skins = new Set<number>();
    for (let i = 0; i < 40; i++) skins.add(createHen(s, 'rousse', coop).skin ?? 0);
    expect(skins.size).toBeGreaterThanOrEqual(3);
    const h = createHen(s, 'rousse', coop, false, { skin: 3 });
    s.hens.push(h);
    const back = deserialize(serialize(s))!;
    expect(back.hens.find((x) => x.id === h.id)?.skin).toBe(3);
  });
});

describe('Test 3 — vente', () => {
  it('vente à un client de l’étal : stock et argent varient du montant exact', () => {
    const s = createNewGame(5);
    morning(s);
    addToStorage(s, 'roux', 'A', 100, 20);
    setPrice(s, 'roux', 100);
    const before = s.money;
    // client au budget large, pile devant l'étal
    s.customers.push({ id: 999, kind: 'classique', want: 6, wtp: 3, state: 'toStand', x: 18.2, z: 32.5, dir: 1, t: 0, mood: 'none', bought: 0, look: 1 });
    for (let i = 0; i < 40 && s.customers[0]?.state !== 'shopping'; i++) updateCustomers(s, 0.1);
    const c = s.customers.find((x) => x.id === 999)!;
    expect(c.mood).toBe('happy');
    expect(c.bought).toBe(6);
    expect(storedCount(s)).toBe(14);
    expect(s.money - before).toBe(6 * 100);
    expect(s.stats.eggsSold).toBe(6);
  });

  it('file d’attente : un guichet sert un client à la fois, les impatients repartent', () => {
    const s = createNewGame(15);
    morning(s);
    // étal fermé aux nouveaux passants : seuls nos clients de test sont là
    s.clock.t = Math.floor(s.clock.t / TIME.DAY) * TIME.DAY + 21 * HOUR;
    addToStorage(s, 'roux', 'A', 100, 200);
    setPrice(s, 'roux', 100);
    expect(standCounters(s)).toBe(1);
    for (let i = 0; i < 5; i++)
      s.customers.push({ id: 900 + i, kind: 'classique', want: 2, wtp: 3, state: 'toStand', x: 18.2 + i * 0.1, z: 33.1, dir: 1, t: 0, mood: 'none', bought: 0, look: 1, patience: i < 2 ? 60 : 3, wait: 0, counter: -1 });
    let maxShopping = 0;
    for (let i = 0; i < 300; i++) {
      updateCustomers(s, 0.1);
      maxShopping = Math.max(maxShopping, s.customers.filter((c) => c.state === 'shopping').length);
    }
    expect(maxShopping).toBe(1);
    expect(s.stats.customersServed).toBeGreaterThanOrEqual(2);
    expect(s.stats.customersLost).toBeGreaterThan(0);
    expect(lostToday(s)).toBe(s.stats.customersLost);
    expect(s.stats.customersServed + s.stats.customersLost).toBe(5);
  });

  it('devant une file trop longue, le passant ne s’arrête pas', () => {
    const s = createNewGame(16);
    morning(s);
    s.clock.t = Math.floor(s.clock.t / TIME.DAY) * TIME.DAY + 21 * HOUR;
    for (let i = 0; i < MARKET.maxQueue + 1; i++)
      s.customers.push({ id: 800 + i, kind: 'classique', want: 2, wtp: 3, state: 'queue', x: 19.5 + i * 0.5, z: 32.7, dir: 1, t: 0, mood: 'none', bought: 0, look: 1, patience: 99, wait: 0, counter: -1, qt: i });
    updateCustomers(s, 0.1);
    expect(queueLength(s)).toBe(MARKET.maxQueue);
    s.customers.push({ id: 850, kind: 'classique', want: 2, wtp: 3, state: 'toStand', x: 17.5, z: 33.1, dir: 1, t: 0, mood: 'none', bought: 0, look: 1, patience: 99, wait: 0, counter: -1 });
    updateCustomers(s, 0.1);
    const c = s.customers.find((x) => x.id === 850)!;
    expect(c.state).toBe('leaving');
    expect(c.mood).toBe('impatient');
  });

  it('un prix trop élevé fait repartir le client sans vendre', () => {
    const s = createNewGame(6);
    morning(s);
    addToStorage(s, 'roux', 'A', 100, 20);
    setPrice(s, 'roux', 400);
    const before = s.money;
    s.customers.push({ id: 998, kind: 'classique', want: 6, wtp: 1, state: 'toStand', x: 18.2, z: 32.5, dir: 1, t: 0, mood: 'none', bought: 0, look: 1 });
    for (let i = 0; i < 40; i++) updateCustomers(s, 0.1);
    expect(s.customers.find((x) => x.id === 998)?.mood).toBe('expensive');
    expect(s.money).toBe(before);
    expect(storedCount(s)).toBe(20);
  });

  it('coopérative : montant conforme au devis', () => {
    const s = createNewGame(7);
    addToStorage(s, 'roux', 'A', 100, 30);
    const q = wholesaleQuote(s, 'roux', 30);
    const before = s.money;
    const got = sellWholesale(s, 'roux', 30);
    expect(got).toBe(q.total);
    expect(s.money - before).toBe(q.total);
    expect(storedCount(s)).toBe(0);
    expect(q.total).toBeLessThan(30 * EGG_TYPES.roux.ref);
  });

  it('les prix bas vendent plus vite que les prix hauts (demande dynamique)', () => {
    const sold = (price: number) => {
      const s = createNewGame(8);
      morning(s);
      addToStorage(s, 'roux', 'A', 100, 30);
      setPrice(s, 'roux', price);
      run(s, 10 * HOUR);
      return 30 - storedCount(s);
    };
    expect(sold(90)).toBeGreaterThan(sold(190));
  });
});

describe('Test 4 — dépenses', () => {
  it('les charges quotidiennes sont débitées exactement une fois par jour', () => {
    const s = createNewGame(9);
    A.buyHen(s, 'rousse');
    const charges = dailyCharges(s);
    const startDay = currentDay(s);
    const money = s.money;
    // jusqu'à juste avant minuit : aucune charge quotidienne
    s.clock.t = startDay * TIME.DAY - 0.05;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    step(s, 0.1);
    expect(s.clock.lastClosedDay).toBe(startDay);
    expect(money - s.money).toBe(charges.upkeep + charges.land);
    // relancer la clôture du même jour ne débite rien
    const m2 = s.money;
    closeDay(s, startDay);
    expect(s.money).toBe(m2);
    // plusieurs jours : une clôture par jour
    const closedBefore = s.clock.lastClosedDay;
    run(s, TIME.DAY * 3);
    expect(s.clock.lastClosedDay).toBe(closedBefore + 3);
  });

  it('mangeoires et abreuvoirs puisent dans la réserve de grain et la cuve d’eau', () => {
    const s = createNewGame(10);
    A.buyHen(s, 'rousse');
    const feeder = buildingsOf(s, 'feeder')[0];
    feeder.stock = 0;
    const grain = s.grain;
    expect(A.refillFeeder(s, feeder.id).ok).toBe(true);
    expect(s.grain).toBeCloseTo(grain - 15);
    const drinker = buildingsOf(s, 'drinker')[0];
    drinker.stock = 0;
    const water = s.water;
    expect(A.refillDrinker(s, drinker.id).ok).toBe(true);
    expect(s.water).toBeCloseTo(water - 8);
    // cuve vide : impossible de remplir l'abreuvoir
    s.water = 0;
    drinker.stock = 0;
    expect(A.refillDrinker(s, drinker.id).ok).toBe(false);
    expect(drinker.stock).toBe(0);
  });

  it('l’eau s’achète au litre, sans dépasser la capacité de la cuve', () => {
    const s = createNewGame(12);
    s.water = 0;
    const m = s.money;
    expect(A.buyWaterPack(s, 'w250').ok).toBe(true);
    expect(s.water).toBe(250);
    expect(m - s.money).toBe(waterPrice(250));
    expect(A.buyWaterPack(s, 'w250').ok).toBe(false); // 300 L max
    expect(A.fillTank(s).ok).toBe(true);
    expect(s.water).toBe(waterCapacity(s));
    expect(A.fillTank(s).ok).toBe(false);
    // la réserve de grain a aussi une limite
    s.grain = 240;
    expect(A.buyGrain(s, 'small').ok).toBe(false);
    s.xp = 400;
    s.money = 100000;
    expect(A.upgradeGrainBin(s).ok).toBe(true);
    expect(A.buyGrain(s, 'small').ok).toBe(true);
    expect(s.grain).toBe(265);
  });

  it('une poule sans eau en cuve finit par souffrir de la soif', () => {
    const s = createNewGame(13);
    A.buyHen(s, 'rousse');
    s.water = 0;
    for (const b of buildingsOf(s, 'drinker')) b.stock = 0;
    run(s, TIME.DAY * 1.5);
    expect(s.hens[0].hydration).toBeLessThan(20);
  });

  it('un solde négatif déclenche des agios et un avertissement', () => {
    const s = createNewGame(11);
    s.money = -1000;
    closeDay(s, 1);
    const d = s.finance.days.find((x) => x.day === 1)!;
    expect(d.expense.agios).toBeGreaterThan(0);
  });
});

describe('Test 5 — agrandissement', () => {
  it('acheter une parcelle débite son prix et agrandit réellement le terrain', () => {
    const s = createNewGame(12);
    s.xp = 50; // niveau 2
    s.money = 50000;
    const price = parcelPrice(1);
    const cap = landCapacity(s);
    expect(isOwnedCell(s, 25, 25)).toBe(false);
    expect(A.buyParcel(s, '1,2').ok).toBe(true);
    expect(s.money).toBe(50000 - price);
    expect(s.parcels).toContain('1,2');
    expect(landCapacity(s)).toBe(cap + PARCELS.hensPerParcel);
    expect(isOwnedCell(s, 25, 25)).toBe(true);
    // une parcelle fait 20 × 20 cases et la grille s'étend au nord de la route
    expect(isOwnedCell(s, 39, 10)).toBe(true);
    expect(isOwnedCell(s, 5, 9)).toBe(false);
  });

  it('refuse une parcelle non contiguë ou déjà possédée (aucun niveau requis)', () => {
    const s = createNewGame(13);
    s.money = 999999;
    expect(A.buyParcel(s, '3,0').ok).toBe(false); // non contiguë
    expect(A.buyParcel(s, '0,2').ok).toBe(false); // déjà possédée
    expect(s.parcels).toHaveLength(1);
    expect(A.buyParcel(s, '1,2').ok).toBe(true); // dès le niveau 1
  });
});

describe('Test 6 — capacité', () => {
  it('le poulailler limite le troupeau ; l’amélioration augmente la limite', () => {
    const s = createNewGame(14);
    s.money = 100000;
    const cap = coopCapacity(s);
    for (let i = 0; i < cap; i++) expect(A.buyHen(s, 'rousse').ok).toBe(true);
    const r = A.buyHen(s, 'rousse');
    expect(r.ok).toBe(false);
    expect(s.hens).toHaveLength(cap);
    const coop = buildingsOf(s, 'coop')[0];
    expect(A.upgrade(s, coop.id).ok).toBe(true); // aucun niveau requis : seul l'argent compte
    expect(coopCapacity(s)).toBe(BUILDINGS.coop.levels[1].capacity);
    expect(A.buyHen(s, 'rousse').ok).toBe(true);
  });

  it('le terrain limite aussi le troupeau', () => {
    const s = createNewGame(15);
    s.money = 1e7;
    s.xp = 99999;
    const coop = buildingsOf(s, 'coop')[0];
    while (A.upgrade(s, coop.id).ok);
    // assez de poulaillers (améliorés) pour dépasser la capacité du terrain
    const spots: Array<[number, number]> = [[17, 24], [2, 12], [7, 12], [12, 12], [2, 17], [7, 17]];
    for (const [x, z] of spots) {
      if (coopCapacity(s) > landCapacity(s)) break;
      const r = A.build(s, 'coop', x, z);
      if (!r.ok) continue;
      const c = s.buildings[s.buildings.length - 1];
      while (A.upgrade(s, c.id).ok);
    }
    expect(coopCapacity(s)).toBeGreaterThan(landCapacity(s));
    let n = 0;
    while (A.buyHen(s, 'rousse').ok) n++;
    expect(n).toBe(landCapacity(s));
    expect(flockCapacity(s)).toBe(landCapacity(s));
  });

  it('stockage plein : impossible de ramasser au-delà', () => {
    const s = createNewGame(16);
    addToStorage(s, 'roux', 'A', 100, storageCapacity(s));
    setPrice(s, 'roux', 100000); // aucun client n'achète : le stock reste plein
    A.buyHen(s, 'rousse');
    run(s, 60);
    const nest = buildingsOf(s, 'nest')[0];
    expect(nest.eggIds.length).toBeGreaterThan(0);
    expect(A.collectFromNest(s, nest.id).ok).toBe(false);
    expect(storedCount(s)).toBe(storageCapacity(s));
  });

  it('placement : impossible hors terrain, sur un bâtiment ou en bloquant un accès', () => {
    const s = createNewGame(17);
    s.money = 100000;
    s.xp = 50;
    expect(A.build(s, 'feeder', 2, 2).ok).toBe(false);
    expect(A.build(s, 'feeder', 7, 20).ok).toBe(false); // sur le poulailler
    expect(A.build(s, 'feeder', 8, 23).ok).toBe(false); // porte du poulailler
    expect(A.build(s, 'feeder', 18, 27).ok).toBe(true);
  });
});

describe('Test 7 — progression économique', () => {
  it('un bon gestionnaire développe une ferme rentable', () => {
    const s = createNewGame(42);
    run(s, TIME.DAY * 30, goodPlayer, HOUR * 2);
    expect(s.hens.length).toBeGreaterThanOrEqual(10);
    expect(farmLevel(s)).toBeGreaterThanOrEqual(4);
    expect(s.stats.salesRevenue).toBeGreaterThan(30000);
    expect(s.stats.hensDied).toBe(0);
    expect(s.money).toBeGreaterThan(0);
  });

  it('un gestionnaire négligent subit des conséquences claires', () => {
    const s = createNewGame(42);
    run(s, TIME.DAY * 16, lazyPlayer, HOUR * 2);
    // sans eau ni grain, ses poules finissent par mourir (plus résistantes, elles tiennent plus longtemps)
    expect(s.stats.hensDied + s.stats.hensEscaped).toBeGreaterThan(0);
    expect(s.stats.salesRevenue).toBe(0);
  });
});

describe('Test 8 — sauvegarde', () => {
  it('sérialise et restaure fidèlement la partie', () => {
    const s = createNewGame(18);
    run(s, TIME.DAY * 6, goodPlayer, HOUR * 2);
    const json = serialize(s);
    const r = deserialize(json)!;
    expect(r).not.toBeNull();
    expect(r.money).toBe(s.money);
    expect(r.xp).toBe(s.xp);
    expect(r.hens.map((h) => [h.id, h.name, h.breed, Math.round(h.health)])).toEqual(s.hens.map((h) => [h.id, h.name, h.breed, Math.round(h.health)]));
    expect(r.lots.reduce((a, l) => a + l.count, 0)).toBe(storedCount(s));
    expect(r.buildings.map((b) => [b.id, b.type, b.level, b.x, b.z])).toEqual(s.buildings.map((b) => [b.id, b.type, b.level, b.x, b.z]));
    expect(r.parcels).toEqual(s.parcels);
    expect(r.prices).toEqual(s.prices);
    expect(r.grass.length).toBe(s.grass.length);
    expect(r.clock.lastClosedDay).toBe(s.clock.lastClosedDay);
    expect(r.missionIndex).toBe(s.missionIndex);
    expect(r.worldEggs.length).toBe(s.worldEggs.length);
    // la partie restaurée continue à tourner
    run(r, TIME.DAY);
    expect(r.clock.t).toBeGreaterThan(s.clock.t);
  });

  it('tolère une sauvegarde corrompue ou incomplète et utilise la copie de secours', () => {
    expect(deserialize('{pas du json')).toBeNull();
    const partial = deserialize(JSON.stringify({ money: 1234, hens: [{ breed: 'inconnue' }, { breed: 'rousse', name: 'Test' }] }))!;
    expect(partial.money).toBe(1234);
    expect(partial.hens).toHaveLength(1);
    expect(buildingsOf(partial, 'storage')).toHaveLength(1);

    const st = memoryStorage();
    const s = createNewGame(19);
    s.money = 4242;
    saveGame(s, st);
    s.money = 5000;
    saveGame(s, st);
    st.data.set(SAVE_KEY, '{corrompu');
    const loaded = loadGame(st)!;
    expect(loaded.source).toBe('backup');
    expect(loaded.state.money).toBe(4242);
    expect(st.data.has(BACKUP_KEY)).toBe(true);
  });

  it('la progression hors ligne est plafonnée et ne facture chaque jour qu’une fois', () => {
    const s = createNewGame(20);
    A.buyHen(s, 'rousse');
    const day0 = s.clock.lastClosedDay;
    const sum = simulateOffline(s, 3600 * 24)!;
    expect(sum.seconds).toBe(TIME.OFFLINE_MAX_DAYS * TIME.DAY);
    expect(s.clock.lastClosedDay - day0).toBeLessThanOrEqual(TIME.OFFLINE_MAX_DAYS);
    expect(sum.eggsLaid).toBeGreaterThan(0);
    s.clock.speed = 0;
    expect(simulateOffline(s, 3600)).toBeNull(); // partie en pause : pas de progression
  });
});

describe('Test 9 — robustesse', () => {
  it('impossible de vendre plus que le stock, ni deux fois les mêmes œufs', () => {
    const s = createNewGame(21);
    addToStorage(s, 'roux', 'A', 100, 10);
    const m = s.money;
    expect(sellWholesale(s, 'roux', 11)).toBe(0);
    expect(s.money).toBe(m);
    expect(storedCount(s)).toBe(10);
    expect(takeFromStorage(s, 'roux', 11)).toBeNull();
    expect(storedCount(s)).toBe(10);
    expect(sellWholesale(s, 'roux', 10)).toBeGreaterThan(0);
    expect(sellWholesale(s, 'roux', 1)).toBe(0);
    expect(storedCount(s)).toBe(0);
  });

  it('impossible de dépenser de l’argent qu’on n’a pas', () => {
    const s = createNewGame(22);
    s.money = 500;
    expect(canAfford(s, 600)).toBe(false);
    expect(spend(s, 600, 'grain', 'test')).toBe(false);
    expect(s.money).toBe(500);
    expect(A.buyHen(s, 'rousse').ok).toBe(false);
    expect(A.buyGrain(s, 'small').ok).toBe(false);
    expect(s.hens).toHaveLength(0);
    expect(s.money).toBe(500);
    expect(spend(s, Number.NaN, 'grain', 'x')).toBe(false);
    expect(spend(s, -50, 'grain', 'x')).toBe(false);
    expect(s.money).toBe(500);
  });

  it('une commande ne peut être livrée qu’une fois', () => {
    const s = createNewGame(23);
    s.orders.push({ id: 500, client: 'Test', type: 'roux', qty: 12, minGrade: 'A', unitPrice: 150, deadlineDay: 9, status: 'offer', offerUntilDay: 9 });
    expect(acceptOrder(s, 500).ok).toBe(true);
    expect(deliverOrder(s, 500).ok).toBe(false); // pas de stock
    addToStorage(s, 'roux', 'A', 100, 24);
    const m = s.money;
    expect(deliverOrder(s, 500).ok).toBe(true);
    expect(s.money - m).toBe(12 * 150);
    expect(deliverOrder(s, 500).ok).toBe(false);
    expect(storedCount(s)).toBe(12);
  });

  it('pas de démolition d’un poulailler habité sans place ailleurs', () => {
    const s = createNewGame(24);
    A.buyHen(s, 'rousse');
    const coop = buildingsOf(s, 'coop')[0];
    expect(A.demolish(s, coop.id).ok).toBe(false);
    expect(A.demolish(s, buildingsOf(s, 'storage')[0].id).ok).toBe(false);
    expect(s.hens[0].coopId).toBe(coop.id);
  });

  it('le ramassage d’œufs ne duplique jamais un œuf', () => {
    const s = createNewGame(25);
    A.buyHen(s, 'rousse');
    A.buyHen(s, 'rousse');
    run(s, 100);
    const laid = s.stats.eggsLaid;
    const nest = buildingsOf(s, 'nest')[0];
    collectNest(s, nest);
    A.collectAll(s);
    A.collectAll(s);
    expect(storedCount(s) + s.worldEggs.length + s.stats.eggsLost).toBe(laid);
  });
});

describe('Test 10 — simulation stable', () => {
  it('le résultat ne dépend pas du nombre d’images par seconde', () => {
    const a = createNewGame(77);
    const b = createNewGame(77);
    A.buyHen(a, 'rousse');
    A.buyHen(b, 'rousse');
    let stepsA = 0;
    let stepsB = 0;
    for (let i = 0; i < 30 * 30; i++) stepsA += advance(a, 1 / 30);
    for (let i = 0; i < 30 * 144; i++) stepsB += advance(b, 1 / 144);
    expect(Math.abs(stepsA - stepsB)).toBeLessThanOrEqual(1);
    const target = Math.min(stepsA, stepsB);
    expect(target).toBeGreaterThan(290);
    const c = createNewGame(77);
    const d = createNewGame(77);
    A.buyHen(c, 'rousse');
    A.buyHen(d, 'rousse');
    for (let i = 0; i < target; i++) step(c, TIME.STEP), step(d, TIME.STEP);
    expect(JSON.stringify({ ...c, savedAt: 0 })).toBe(JSON.stringify({ ...d, savedAt: 0 }));
  });

  it('la pause gèle complètement la simulation', () => {
    const s = createNewGame(78);
    A.buyHen(s, 'rousse');
    s.clock.speed = 0;
    const t = s.clock.t;
    for (let i = 0; i < 100; i++) advance(s, 1 / 60);
    expect(s.clock.t).toBe(t);
  });

  it('longue partie sans valeur incohérente', () => {
    const s = createNewGame(79);
    run(s, TIME.DAY * 20, goodPlayer, HOUR * 2);
    for (const h of s.hens) {
      for (const v of [h.health, h.satiety, h.hydration, h.wellbeing]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
    for (const b of s.buildings) expect(b.stock).toBeGreaterThanOrEqual(0);
    for (const l of s.lots) expect(l.count).toBeGreaterThan(0);
    expect(storedCount(s)).toBeLessThanOrEqual(storageCapacity(s));
    expect(s.grass.every((g) => g >= 0 && g <= 1)).toBe(true);
    expect(Number.isInteger(s.money)).toBe(true);
  });
});

describe('Salariés', () => {
  it('embauché en journée, le salarié arrive tout de suite ; la nuit, il attend le matin', () => {
    const day = createNewGame(30);
    morning(day);
    day.xp = 200;
    expect(hire(day, 'farmhand').ok).toBe(true);
    expect(day.workers[0].onSite).toBe(true);
    const night = createNewGame(31);
    night.clock.t = 22.5 * HOUR;
    night.clock.lastHourTick = Math.floor(night.clock.t / HOUR);
    night.xp = 200;
    expect(hire(night, 'farmhand').ok).toBe(true);
    expect(night.workers[0].onSite).toBe(false);
    run(night, TIME.DAY * 0.45);
    expect(night.workers[0].onSite).toBe(true);
  });

  it('embauche possible dès le début, sans maximum : seul le salaire compte', () => {
    const s = createNewGame(32);
    s.money = 1e7;
    for (let i = 0; i < 12; i++) expect(hire(s, 'farmhand').ok).toBe(true);
    for (const r of ['seller', 'caretaker', 'gardener'] as const) for (let i = 0; i < 4; i++) expect(hire(s, r).ok).toBe(true);
    expect(s.workers).toHaveLength(24);
    s.money = 0;
    expect(hire(s, 'farmhand').ok).toBe(false);
  });

  it('le commis ramasse et range les œufs, sans jamais en perdre ni en dupliquer', () => {
    const s = createNewGame(33);
    morning(s);
    s.xp = 200;
    s.money = 100000;
    for (let i = 0; i < 4; i++) A.buyHen(s, 'rousse');
    setPrice(s, 'roux', 100000);
    hire(s, 'farmhand');
    run(s, TIME.DAY * 1.5);
    const w = s.workers[0];
    expect(w.total.eggs).toBeGreaterThan(0);
    expect(storedCount(s)).toBeGreaterThan(0);
    const inBaskets = s.workers.reduce((a, x) => a + x.basket.reduce((b, l) => b + l.count, 0), 0);
    expect(storedCount(s) + s.worldEggs.length + inBaskets + s.stats.eggsLost + s.stats.eggsSold + s.stats.eggsSpoiled).toBe(s.stats.eggsLaid);
  });

  it('les salaires sont prélevés une fois par jour', () => {
    const s = createNewGame(34);
    s.xp = 1000;
    s.money = 100000;
    hire(s, 'farmhand');
    hire(s, 'seller');
    const before = s.money;
    closeDay(s, 1);
    expect(s.finance.days.find((d) => d.day === 1)!.expense.salaires).toBe(600 + 900);
    closeDay(s, 1);
    expect(before - s.money).toBe(dailyCharges(s).upkeep + dailyCharges(s).land + 1500);
  });
});

describe('Commis : fermeture des poules et priorités', () => {
  function eveningFarm(seed: number) {
    const s = createNewGame(seed);
    s.xp = 900;
    s.money = 1_000_000;
    const coop = buildingsOf(s, 'coop')[0];
    A.upgrade(s, coop.id);
    A.upgrade(s, coop.id);
    for (let i = 0; i < 8; i++) A.buyHen(s, 'rousse');
    s.clock.t = 18 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    return s;
  }

  it('le commis attend que toutes les poules soient rentrées, ferme la trappe et part en dernier', () => {
    const s = eveningFarm(40);
    hire(s, 'farmhand');
    hire(s, 'caretaker');
    const fh = s.workers.find((w) => w.role === 'farmhand')!;
    const care = s.workers.find((w) => w.role === 'caretaker')!;
    let careLeftAt = -1;
    let fhLeftAt = -1;
    let closedWithHensOutside = false;
    for (let t = 0; t < TIME.DAY * 0.3; t += TIME.STEP) {
      step(s, TIME.STEP);
      drainEvents(s);
      const coop = buildingsOf(s, 'coop')[0];
      if (coop.closed && s.hens.some((h) => h.act !== 'sleep')) closedWithHensOutside = true;
      if (careLeftAt < 0 && care.job?.kind === 'commuteOut') careLeftAt = s.clock.t;
      if (fhLeftAt < 0 && fh.job?.kind === 'commuteOut') fhLeftAt = s.clock.t;
    }
    expect(buildingsOf(s, 'coop')[0].closed).toBe(true);
    expect(s.hens.every((h) => h.act === 'sleep')).toBe(true);
    expect(closedWithHensOutside).toBe(false);
    expect(careLeftAt).toBeGreaterThan(0);
    expect(fhLeftAt).toBeGreaterThan(careLeftAt);
    // il ne part qu'une fois la nuit tombée et les poules couchées
    expect(((fhLeftAt % TIME.DAY) / TIME.DAY) * 24).toBeGreaterThan(TIME.NIGHT_START);
  });

  it('le matin, les poules restent dedans jusqu’à ce que le commis ouvre la trappe', () => {
    const s = eveningFarm(41);
    hire(s, 'farmhand');
    let sawWaiting = false;
    let opened = false;
    for (let t = 0; t < TIME.DAY * 0.75; t += TIME.STEP) {
      step(s, TIME.STEP);
      drainEvents(s);
      const coop = buildingsOf(s, 'coop')[0];
      const hour = ((s.clock.t % TIME.DAY) / TIME.DAY) * 24;
      if (coop.closed && hour > 6.3 && hour < 12) {
        // réveillées mais enfermées : aucune ne sort
        expect(s.hens.every((h) => h.act === 'sleep')).toBe(true);
        sawWaiting = true;
      }
      if (!coop.closed && hour > 4 && hour < 12) opened = true;
    }
    expect(opened).toBe(true);
    expect(s.hens.some((h) => h.act !== 'sleep')).toBe(true);
    void sawWaiting;
  });

  it('une mangeoire à remplir passe avant le ramassage des œufs', () => {
    const s = createNewGame(42);
    morning(s);
    s.xp = 400;
    for (let i = 0; i < 3; i++) A.buyHen(s, 'rousse');
    const nest = buildingsOf(s, 'nest')[0];
    for (let i = 0; i < 4; i++) {
      const e = { id: s.nextId++, type: 'roux' as const, quality: 0.7, freshness: 100, where: 'nest' as const, nestId: nest.id, x: 0, z: 0, laidAt: 0 };
      s.worldEggs.push(e);
      nest.eggIds.push(e.id);
    }
    buildingsOf(s, 'feeder')[0].stock = 1;
    hire(s, 'farmhand');
    step(s, TIME.STEP);
    expect(s.workers[0].job?.kind).toBe('refillFeeder');
  });

  it('sans commis, les trappes ne sont jamais fermées', () => {
    const s = eveningFarm(43);
    run(s, TIME.DAY);
    expect(buildingsOf(s, 'coop').every((c) => !c.closed)).toBe(true);
  });
});

describe('Commis : l’eau d’abord, les œufs en dernier', () => {
  it('ordre des priorités : abreuvoir, puis mangeoire, puis propreté, puis œufs', () => {
    const s = createNewGame(50);
    morning(s);
    s.xp = 400;
    s.money = 100000;
    for (let i = 0; i < 3; i++) A.buyHen(s, 'rousse');
    const nest = buildingsOf(s, 'nest')[0];
    for (let i = 0; i < 5; i++) {
      const e = { id: s.nextId++, type: 'roux' as const, quality: 0.7, freshness: 100, where: 'nest' as const, nestId: nest.id, x: 0, z: 0, laidAt: 0 };
      s.worldEggs.push(e);
      nest.eggIds.push(e.id);
    }
    const feeder = buildingsOf(s, 'feeder')[0];
    const drinker = buildingsOf(s, 'drinker')[0];
    const coop = buildingsOf(s, 'coop')[0];
    feeder.stock = 2;
    drinker.stock = 3;
    coop.cleanliness = 30;
    hire(s, 'farmhand');
    const w = s.workers[0];
    const order: string[] = [];
    for (let t = 0; t < 60 && order.length < 4; t += TIME.STEP) {
      step(s, TIME.STEP);
      drainEvents(s);
      const k = w.job?.kind;
      if (k && k !== 'wander' && order[order.length - 1] !== k) order.push(k);
    }
    expect(order.slice(0, 3)).toEqual(['refillDrinker', 'refillFeeder', 'clean']);
  });

  it('le commis commande de l’eau quand la cuve est presque vide', () => {
    const s = createNewGame(51);
    morning(s);
    s.xp = 400;
    s.money = 100000;
    A.buyHen(s, 'rousse');
    s.water = 10;
    hire(s, 'farmhand');
    step(s, TIME.STEP);
    expect(s.water).toBeGreaterThan(200);
    expect(s.finance.days.at(-1)!.expense.eau).toBeGreaterThan(0);
  });

  it('il ramasse les œufs au passage devant un pondoir', () => {
    const s = createNewGame(52);
    morning(s);
    s.xp = 400;
    const nest = buildingsOf(s, 'nest')[0];
    const e = { id: s.nextId++, type: 'roux' as const, quality: 0.7, freshness: 100, where: 'nest' as const, nestId: nest.id, x: 0, z: 0, laidAt: 0 };
    s.worldEggs.push(e);
    nest.eggIds.push(e.id);
    hire(s, 'farmhand');
    const w = s.workers[0];
    // il passe juste devant le pondoir en allant ailleurs
    w.x = nest.x + 1;
    w.z = nest.z + 1.6;
    w.job = { kind: 'wander', targetId: -1, tx: nest.x + 4, tz: nest.z + 1.6, phase: 'walk', t: 2 };
    w.path = [nest.x + 4, nest.z + 1.6];
    step(s, TIME.STEP);
    expect(nest.eggIds).toHaveLength(0);
    expect(w.basket.reduce((a, l) => a + l.count, 0)).toBe(1);
  });
});

describe('Prédateurs', () => {
  /** Ferme éligible : niveau 5, poulailler isolé, 10 poules, jour 3 à l'heure voulue. */
  function farm(seed: number, hour: number, hens = 10) {
    const s = createNewGame(seed);
    s.xp = 900;
    s.money = 1_000_000;
    const coop = buildingsOf(s, 'coop')[0];
    A.upgrade(s, coop.id);
    A.upgrade(s, coop.id);
    for (let i = 0; i < hens; i++) A.buyHen(s, 'rousse');
    s.clock.t = 2 * TIME.DAY + hour * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    s.clock.lastClosedDay = 2;
    s.settings.predators = false; // apparitions aléatoires coupées : on les déclenche à la main
    run(s, 20);
    return s;
  }
  const until = (s: GameState, cond: () => boolean, max = 60) => {
    for (let t = 0; t < max && !cond(); t += TIME.STEP) {
      step(s, TIME.STEP);
      drainEvents(s);
    }
    return cond();
  };
  const asleepInCoop = (s: GameState) => {
    const coop = buildingsOf(s, 'coop')[0];
    for (const h of s.hens) {
      h.act = 'sleep';
      h.x = coop.x + BUILDINGS.coop.w / 2;
      h.z = coop.z + 1.15 * COOP_SCALE;
    }
    return coop;
  };

  it('sans défense, le renard emporte une poule (comptée à part des décès)', () => {
    const s = farm(1, 10);
    spawnPredator(s, 'fox');
    run(s, 40);
    expect(s.stats.hensTaken).toBe(1);
    expect(s.hens).toHaveLength(9);
    expect(s.stats.hensDied).toBe(0);
    expect(s.predators).toHaveLength(0); // reparti dans les bois
  });

  it('il laisse le temps de réagir : rien ne se passe pendant les premières secondes', () => {
    const s = farm(2, 10);
    spawnPredator(s, 'fox');
    run(s, 6);
    expect(s.stats.hensTaken).toBe(0);
  });

  it('deux tirs du joueur abattent le renard, une seule balle suffit pour la buse', () => {
    const s = farm(3, 10);
    const fox = spawnPredator(s, 'fox');
    const xp = s.xp;
    const money = s.money;
    expect(shootPredator(s, fox.id).ok).toBe(true);
    expect(fox.state).toBe('flee'); // blessé, il détale
    expect(s.money).toBe(money); // pas de prime tant qu'il court
    expect(shootPredator(s, fox.id).ok).toBe(true);
    expect(fox.state).toBe('dead');
    expect(s.money - money).toBe(500); // prime de 5 € par renard abattu
    expect(shootPredator(s, fox.id).ok).toBe(false); // on ne tire pas deux fois sur un cadavre
    expect(s.stats.predatorsKilled).toBe(1);
    expect(s.xp).toBeGreaterThan(xp);
    run(s, 8);
    expect(s.predators).toHaveLength(0);
    const hawk = spawnPredator(s, 'hawk');
    const before = s.money;
    shootPredator(s, hawk.id);
    expect(hawk.state).toBe('dead');
    expect(s.money).toBe(before); // la prime ne concerne que le renard
    expect(s.stats.predatorsKilled).toBe(2);
    expect(s.stats.hensTaken).toBe(0);
  });

  it('un tir pendant la prise arrache la poule aux crocs du renard (blessée mais vivante)', () => {
    const s = farm(4, 10);
    const fox = spawnPredator(s, 'fox');
    expect(until(s, () => fox.state === 'grab')).toBe(true);
    const hen = s.hens.find((h) => h.id === fox.targetHen)!;
    expect(hen.act).toBe('caught');
    const health = hen.health;
    shootPredator(s, fox.id);
    run(s, 5);
    expect(s.hens).toContain(hen);
    expect(hen.act).not.toBe('caught');
    expect(hen.health).toBeLessThan(health);
    expect(s.stats.hensTaken).toBe(0);
  });

  it('les poules s’enfuient devant le renard', () => {
    const s = farm(5, 10);
    spawnPredator(s, 'fox');
    expect(until(s, () => s.hens.some((h) => h.act === 'flee'), 30)).toBe(true);
  });

  it('commis et jardinier sortent le fusil et repoussent le renard', () => {
    let repelled = 0;
    let workerKills = 0;
    for (let k = 0; k < 8; k++) {
      const s = farm(100 + k, 10);
      hire(s, 'farmhand');
      hire(s, 'gardener');
      run(s, 5);
      spawnPredator(s, 'fox');
      let hunted = false;
      for (let t = 0; t < 40; t += TIME.STEP) {
        step(s, TIME.STEP);
        drainEvents(s);
        if (s.workers.some((w) => w.job?.kind === 'hunt')) hunted = true;
      }
      expect(hunted).toBe(true);
      if (s.stats.hensTaken === 0) repelled++;
      workerKills += s.workers.reduce((a, w) => a + w.total.kills, 0);
      // la menace écartée, ils reprennent leurs corvées
      expect(s.workers.every((w) => w.job?.kind !== 'hunt')).toBe(true);
    }
    expect(repelled).toBeGreaterThanOrEqual(7);
    expect(workerKills).toBeGreaterThanOrEqual(5);
  });

  it('le vendeur et le soigneur ne prennent pas les armes', () => {
    const s = farm(6, 10);
    hire(s, 'seller');
    hire(s, 'caretaker');
    run(s, 5);
    spawnPredator(s, 'fox');
    for (let t = 0; t < 15; t += TIME.STEP) {
      step(s, TIME.STEP);
      drainEvents(s);
      expect(s.workers.some((w) => w.job?.kind === 'hunt')).toBe(false);
    }
  });

  it('la nuit, une trappe fermée protège les poules ; ouverte, le renard se sert', () => {
    const closed = farm(7, 23.6);
    asleepInCoop(closed).closed = true;
    spawnPredator(closed, 'fox');
    run(closed, 40);
    expect(closed.stats.hensTaken).toBe(0);
    expect(closed.predators).toHaveLength(0);
    const open = farm(7, 23.6);
    asleepInCoop(open).closed = false;
    spawnPredator(open, 'fox');
    run(open, 40);
    expect(open.stats.hensTaken).toBe(1);
  });

  it('la buse tournoie puis pique ; sans défense, elle emporte une poule', () => {
    const s = farm(8, 11);
    const hawk = spawnPredator(s, 'hawk');
    expect(until(s, () => hawk.state === 'circle')).toBe(true);
    expect(hawk.y).toBeGreaterThan(4);
    run(s, 40);
    expect(s.stats.hensTaken).toBe(1);
  });

  it('les prédateurs reviennent de temps en temps, jamais hors ligne ni si l’option est coupée', () => {
    const s = farm(9, 8);
    s.settings.predators = true;
    let spawns = 0;
    let acc = 0;
    for (let t = 0; t < TIME.DAY * 6; t += TIME.STEP) {
      step(s, TIME.STEP);
      guard(s, 2);
      for (const e of drainEvents(s)) if (e.kind === 'predatorSpawn') spawns++;
      // troupeau bien entretenu (sinon il dépérit et n'attire plus personne)
      acc += TIME.STEP;
      if (acc >= HOUR) {
        acc = 0;
        s.grain = 200;
        s.water = 250;
        A.refillAll(s);
      }
    }
    expect(s.hens.length).toBeGreaterThanOrEqual(8);
    expect(spawns).toBeGreaterThanOrEqual(1);
    expect(spawns).toBeLessThanOrEqual(8);
    const off = farm(10, 8);
    off.settings.predators = false;
    run(off, TIME.DAY * 4);
    expect(off.stats.hensTaken + off.stats.predatorsKilled).toBe(0);
    const away = farm(11, 8);
    away.settings.predators = true;
    const before = away.lastPredatorT;
    simulateOffline(away, TIME.DAY * 2);
    expect(away.lastPredatorT).toBe(before);
    expect(away.stats.hensTaken).toBe(0);
    expect(away.predators).toHaveLength(0);
  });

  it('les prédateurs ne sont pas sauvegardés et la partie se recharge proprement', () => {
    const s = farm(12, 10);
    spawnPredator(s, 'fox');
    run(s, 3);
    const r = deserialize(serialize(s))!;
    expect(r.predators).toHaveLength(0);
    expect(r.settings.predators).toBe(false);
    run(r, 10);
    expect(r.hens.every((h) => h.act !== 'caught')).toBe(true);
  });
});

describe('Capacité d’élevage (rééquilibrage)', () => {
  it('dès le début, un terrain et deux cabanes accueillent 16 poules', () => {
    const s = createNewGame(60);
    s.money = 100000;
    expect(A.build(s, 'coop', 12, 11).ok).toBe(true);
    let n = 0;
    while (A.buyHen(s, 'rousse').ok) n++;
    expect(n).toBe(16);
  });

  it('à partir du niveau 2, la production maximale couvre la demande de l’étal', () => {
    for (const lv of LEVELS.filter((l) => l.level >= 2)) {
      const coopCap = Math.max(...BUILDINGS.coop.levels.filter((c) => c.reqLevel <= lv.level).map((c) => c.capacity));
      const flock = Math.min(lv.maxCoops * coopCap, lv.maxParcels * PARCELS.hensPerParcel);
      const stand = [...BUILDINGS.stand.levels].reverse().find((l) => l.reqLevel <= lv.level)!;
      const avgWant = MARKET.wantChoices.reduce((a, b) => a + b, 0) / MARKET.wantChoices.length;
      const demand = (stand.flow ?? 0) * MARKET.repFlow(50) * (TIME.SHOP_CLOSE - TIME.SHOP_OPEN) * avgWant * (stand.qtyMult ?? 1);
      const production = flock * BREEDS.rousse.eggsPerDay * 0.8;
      expect(production, `niveau ${lv.level}`).toBeGreaterThanOrEqual(demand);
    }
  });
});

describe('Œufs au sol et pondoirs', () => {
  it('un œuf pondu au sol et oublié pourrit au bout d’un jour : perte sèche', () => {
    const s = createNewGame(70);
    morning(s);
    s.settings.predators = false;
    const e = { id: s.nextId++, type: 'roux' as const, quality: 0.6, freshness: 100, where: 'ground' as const, nestId: -1, x: 14, z: 25, laidAt: s.clock.t };
    s.worldEggs.push(e);
    run(s, TIME.DAY * 0.9);
    expect(s.worldEggs).toContain(e); // encore ramassable avant la fin du jour
    run(s, TIME.DAY * 0.15);
    expect(s.worldEggs).not.toContain(e);
    expect(s.stats.eggsRotten).toBe(1);
    expect(storedCount(s)).toBe(0);
    expect(A.collectGroundEgg(s, e.id).ok).toBe(false);
  });

  it('les poules font la queue au pondoir plutôt que de pondre par terre', () => {
    const s = createNewGame(71);
    morning(s);
    s.money = 100000;
    s.settings.predators = false;
    for (let i = 0; i < 8; i++) A.buyHen(s, 'rousse');
    // toutes prêtes à pondre en même temps : 3 compartiments seulement
    for (const h of s.hens) h.layProgress = 1;
    let ground = 0;
    let nest = 0;
    for (let t = 0; t < TIME.DAY * 0.22; t += TIME.STEP) {
      step(s, TIME.STEP);
      for (const ev of drainEvents(s)) if (ev.kind === 'eggLaid') (ev.ground ? ground++ : nest++);
    }
    expect(nest).toBeGreaterThanOrEqual(6);
    expect(ground).toBeLessThanOrEqual(2);
  });
});

describe('Clôture automatique', () => {
  const day = (seed: number) => {
    const s = createNewGame(seed);
    morning(s);
    s.money = 1_000_000;
    s.xp = 900;
    s.settings.predators = false;
    return s;
  };
  const feed = (s: GameState) => {
    s.grain = 200;
    s.water = 250;
    A.refillAll(s);
  };

  it('la ferme est clôturée dès le départ, sans rien acheter : aucune poule ne s’échappe', () => {
    const s = day(81);
    expect(farmEnclosed(s)).toBe(true);
    expect(s.fenceH[GATE_EDGE]).toBe(3); // portail à l'entrée
    expect(s.money).toBe(1_000_000);
    for (let i = 0; i < 8; i++) A.buyHen(s, 'rousse');
    run(s, TIME.DAY * 2, feed);
    expect(s.stats.hensEscaped).toBe(0);
    expect(s.hens).toHaveLength(8);
  });

  it('la clôture suit gratuitement chaque nouvelle parcelle', () => {
    const s = day(82);
    const key = A.parcelNeighbours(s.parcels[0]).find((k) => A.checkBuyParcel(s, k).ok)!;
    const before = s.money;
    expect(A.buyParcel(s, key).ok).toBe(true);
    expect(before - s.money).toBe(parcelPrice(1));
    expect(farmEnclosed(s)).toBe(true);
    // plus de grillage entre l'ancienne et la nouvelle parcelle : seul le contour est clôturé
    const fenced = [...s.fenceH, ...s.fenceV].filter((v) => v > 0).length;
    expect(fenced).toBe(perimeter(s).length);
  });

  it('le grillage retient les poules, le renard se faufile dessous', () => {
    const s = day(83);
    // arête du bas de la ferme (côté route), hors du portail
    expect(crossesFence(s, 10.5, 29.5, 10.5, 30.5, 'hen')).toBe(true);
    expect(crossesFence(s, 10.5, 29.5, 10.5, 30.5, 'fox')).toBe(false);
    expect(crossesFence(s, 10.5, 29.5, 10.5, 30.5, 'human')).toBe(true);
  });

  it('le commis entre par le portail', () => {
    const s = createNewGame(84);
    s.xp = 900;
    s.money = 1_000_000;
    s.clock.t = 2 * TIME.DAY + 3.5 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    s.clock.lastClosedDay = 2;
    hire(s, 'farmhand');
    run(s, TIME.DAY * 0.2);
    const w = s.workers[0];
    expect(w.onSite).toBe(true);
    expect(isOwnedCell(s, Math.floor(w.x), Math.floor(w.z))).toBe(true);
  });
});

describe('Chien de garde', () => {
  const farm = (seed: number) => {
    const s = createNewGame(seed);
    s.xp = 900;
    s.money = 1_000_000;
    const coop = buildingsOf(s, 'coop')[0];
    A.upgrade(s, coop.id);
    A.upgrade(s, coop.id);
    for (let i = 0; i < 10; i++) A.buyHen(s, 'rousse');
    s.clock.t = 2 * TIME.DAY + 8 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    s.clock.lastClosedDay = 2;
    return s;
  };
  const feed = (s: GameState) => {
    s.grain = 200;
    s.water = 250;
    A.refillAll(s);
  };

  it('coûte 150 € et réduit fortement les apparitions de prédateurs', () => {
    let without = 0;
    let withDog = 0;
    for (let k = 0; k < 3; k++) {
      for (const dog of [false, true]) {
        const s = farm(90 + k);
        if (dog) {
          const m = s.money;
          expect(buyDog(s).ok).toBe(true);
          expect(m - s.money).toBe(15000);
          expect(buyDog(s).ok).toBe(false); // un seul chien
        }
        let spawns = 0;
        let acc = 0;
        for (let t = 0; t < TIME.DAY * 6; t += TIME.STEP) {
          step(s, TIME.STEP);
          guard(s, 1);
          for (const e of drainEvents(s)) if (e.kind === 'predatorSpawn') spawns++;
          acc += TIME.STEP;
          if (acc >= HOUR) {
            acc = 0;
            feed(s);
          }
        }
        if (dog) withDog += spawns;
        else without += spawns;
      }
    }
    expect(without).toBeGreaterThan(withDog * 3);
  });

  it('le chien fonce sur le renard et le fait fuir', () => {
    const s = farm(95);
    s.settings.predators = false;
    buyDog(s);
    run(s, 10);
    const fox = spawnPredator(s, 'fox');
    run(s, 30);
    // le renard détale toujours ; au pire il a eu le temps d'attraper une poule avant l'arrivée du chien
    expect(s.stats.hensTaken).toBeLessThanOrEqual(1);
    expect(fox.state === 'flee' || !s.predators.includes(fox)).toBe(true);
  });
});

describe('Reproduction : coqs, couveuse, poussins', () => {
  const farm = (seed: number) => {
    const s = createNewGame(seed);
    s.xp = 900;
    s.money = 1_000_000;
    s.settings.predators = false;
    const coop = buildingsOf(s, 'coop')[0];
    A.upgrade(s, coop.id);
    A.upgrade(s, coop.id);
    for (let i = 0; i < 10; i++) A.buyHen(s, 'rousse');
    s.clock.t = 2 * TIME.DAY + 8 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    s.clock.lastClosedDay = 2;
    return s;
  };
  /** La couveuse s'installe dans une poussinière : on en pose une d'abord s'il le faut. */
  const placeIncubator = (s: GameState) => {
    if (!buildingsOf(s, 'nursery').length) {
      let done = false;
      for (let z = 10; z < 30 && !done; z++) for (let x = 0; x < 20 && !done; x++) done = canPlace(s, 'nursery', x, z).ok && A.build(s, 'nursery', x, z).ok;
      if (!done) throw new Error('aucune place pour la poussinière');
    }
    if (!A.installIncubator(s).ok) throw new Error('aucune place pour la couveuse');
    return buildingsOf(s, 'incubator')[0];
  };

  it('un coq coûte 1,5 fois la poule, ne pond pas et féconde les œufs', () => {
    const s = farm(201);
    expect(fertility(s)).toBe(0);
    const m = s.money;
    expect(A.buyRooster(s, 'rousse').ok).toBe(true);
    expect(m - s.money).toBe(A.roosterPrice('rousse'));
    expect(A.roosterPrice('rousse')).toBe(Math.round((BREEDS.rousse.price * 1.5) / 10) * 10);
    const rooster = s.hens.find((h) => h.rooster)!;
    expect(rooster).toBeTruthy();
    // 1 coq pour 10 poules : la plupart des œufs sont fécondés
    expect(fertility(s)).toBeGreaterThan(0.8);
    let fertile = 0;
    const hen = s.hens.find((h) => !h.rooster)!;
    for (let i = 0; i < 300; i++) if (layEgg(s, hen, null).fertile) fertile++;
    expect(fertile / 300).toBeGreaterThan(0.75);
    expect(fertile / 300).toBeLessThan(0.98);
    // le coq lui-même ne pond jamais
    run(s, TIME.DAY, (st) => {
      st.grain = 200;
      st.water = 250;
      A.refillAll(st);
    });
    expect(rooster.eggsLaid).toBe(0);
  });

  it('les œufs fécondés passent en couveuse, éclosent à 15 jours et pondent à 30 jours', () => {
    const s = farm(202);
    const inc = placeIncubator(s);
    // sans œuf fécondé, rien à mettre en couveuse
    expect(loadIncubator(s, inc).ok).toBe(false);
    addToStorage(s, 'roux', 'A', 100, 6, 'rousse');
    addToStorage(s, 'roux', 'A', 100, 4);
    expect(fertileStock(s)).toBe(6);
    inc.auto = false;
    const r = loadIncubator(s, inc);
    expect(r.ok).toBe(true);
    expect(inc.hatch).toHaveLength(6);
    expect(fertileStock(s)).toBe(0);
    expect(storedCount(s)).toBe(4); // les œufs ordinaires restent au stockage
    const viable = inc.hatch!.filter((e) => e.ok).length;
    const before = s.hens.length;
    // 14 jours : pas encore d'éclosion
    for (const e of inc.hatch!) e.t = s.clock.t - 14 * TIME.DAY;
    run(s, 2);
    expect(s.hens.length).toBe(before);
    // 15 jours : les poussins sortent
    for (const e of inc.hatch!) e.t = s.clock.t - 15 * TIME.DAY;
    step(s, TIME.STEP);
    const ev = drainEvents(s);
    expect(inc.hatch).toHaveLength(0);
    expect(s.hens.length).toBe(before + viable);
    const chicks = s.hens.filter((h) => h.young);
    expect(chicks).toHaveLength(viable);
    if (viable) expect(ev.some((e) => e.kind === 'hatch')).toBe(true);
    for (const c of chicks) {
      expect(c.young).toBeCloseTo(BREEDING.growthDays, 1);
      expect(eggsPerDayOf(c)).toBe(0);
    }
    expect(s.stats.chicksHatched).toBe(viable);
    // à 30 jours, la poulette devient pondeuse
    const c = chicks.find((h) => !h.rooster) ?? chicks[0];
    if (c) {
      c.young = 0.001;
      run(s, 2);
      expect(c.young).toBeUndefined();
      if (!c.rooster) expect(eggsPerDayOf(c)).toBeGreaterThan(0);
    }
  });

  it('en automatique, l’œuf fécondé rangé au stockage part tout de suite en couveuse (et ça se voit)', () => {
    const s = farm(206);
    const inc = placeIncubator(s);
    addToStorage(s, 'roux', 'A', 100, 3, 'rousse');
    addToStorage(s, 'roux', 'A', 100, 5);
    step(s, TIME.STEP);
    const ev = drainEvents(s);
    expect(inc.hatch).toHaveLength(3);
    expect(fertileStock(s)).toBe(0);
    expect(storedCount(s)).toBe(5);
    expect(ev.some((e) => e.kind === 'incubated' && e.count === 3)).toBe(true);
  });

  it('le bouton du stockage met tous les œufs fécondés en couveuse', () => {
    const s = farm(207);
    expect(incubateAll(s).ok).toBe(false); // pas de couveuse
    const inc = placeIncubator(s);
    inc.auto = false;
    addToStorage(s, 'roux', 'A', 100, 4, 'rousse');
    step(s, TIME.STEP);
    expect(inc.hatch ?? []).toHaveLength(0); // automatique coupé : ils attendent
    const r = incubateAll(s);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(4);
    expect(inc.hatch).toHaveLength(4);
  });

  it('ferme pleine : la couveuse se remplit quand même jusqu’à sa capacité, avec un avertissement', () => {
    const s = farm(203);
    const inc = placeIncubator(s);
    inc.auto = false;
    // terrain presque plein (25 places pour une parcelle)
    while (s.hens.length < 24 && A.buyHen(s, 'rousse').ok);
    addToStorage(s, 'roux', 'A', 100, 40, 'rousse');
    expect(nurseryRoom(s)).toBeLessThan(BUILDINGS.incubator.levels[0].capacity);
    expect(loadIncubator(s, inc).ok).toBe(true);
    expect(inc.hatch!.length).toBe(BUILDINGS.incubator.levels[0].capacity);
    expect(crowdedChicks(s)).toBeGreaterThan(0);
    // à l'éclosion, tous les poussins viables naissent malgré tout
    const viable = inc.hatch!.filter((e) => e.ok).length;
    const before = s.hens.length;
    for (const e of inc.hatch!) e.t = s.clock.t - 15 * TIME.DAY;
    step(s, TIME.STEP);
    drainEvents(s);
    expect(s.hens.length).toBe(before + viable);
  });

  it('chaque œuf a son propre compte à rebours', () => {
    const s = farm(208);
    const inc = placeIncubator(s);
    inc.auto = false;
    addToStorage(s, 'roux', 'A', 100, 1, 'rousse');
    loadIncubator(s, inc);
    run(s, TIME.DAY * 3);
    addToStorage(s, 'roux', 'A', 100, 1, 'rousse');
    loadIncubator(s, inc);
    const [a, b] = inc.hatch!;
    expect(eggHatchIn(s, a)).toBeCloseTo(12, 0);
    expect(eggHatchIn(s, b)).toBeCloseTo(15, 0);
  });

  it('les œufs fécondés sont vendus en dernier', () => {
    const s = farm(204);
    addToStorage(s, 'roux', 'A', 60, 5, 'rousse');
    addToStorage(s, 'roux', 'A', 90, 5);
    takeFromStorage(s, 'roux', 5);
    expect(fertileStock(s)).toBe(5);
  });

  it('coqs, poussins, œufs fécondés et couvaison survivent à la sauvegarde', () => {
    const s = farm(205);
    expect(A.buyRooster(s, 'rousse').ok).toBe(true);
    const inc = placeIncubator(s);
    inc.auto = false;
    addToStorage(s, 'roux', 'A', 100, 3, 'rousse');
    loadIncubator(s, inc, 2);
    s.hens[0].young = 12;
    const back = deserialize(serialize(s))!;
    expect(back.hens.filter((h) => h.rooster)).toHaveLength(1);
    expect(back.hens[0].young).toBeCloseTo(12);
    expect(fertileStock(back)).toBe(1);
    const inc2 = buildingsOf(back, 'incubator')[0];
    expect(inc2.hatch).toHaveLength(2);
    expect(inc2.auto).toBe(false);
  });
});

describe('Passer la nuit', () => {
  it('saute jusqu’à 6 h 30 le lendemain, clôture la journée et ne laisse pas attaquer', () => {
    const s = createNewGame(301);
    s.money = 1_000_000;
    for (let i = 0; i < 6; i++) A.buyHen(s, 'rousse');
    // en journée : impossible
    morning(s);
    expect(canSkipNight(s)).toBe(false);
    expect(skipNight(s)).toBeNull();
    // à 21 h
    const day = Math.floor(s.clock.t / TIME.DAY);
    s.clock.t = day * TIME.DAY + 21 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    expect(canSkipNight(s)).toBe(true);
    const sum = skipNight(s)!;
    expect(sum).not.toBeNull();
    expect(Math.floor(s.clock.t / TIME.DAY)).toBe(day + 1);
    expect((s.clock.t % TIME.DAY) / HOUR).toBeCloseTo(6.5, 3);
    expect(s.clock.lastClosedDay).toBeGreaterThanOrEqual(day + 1);
    expect(s.predators).toHaveLength(0);
    expect(s.hens).toHaveLength(6);
    expect(canSkipNight(s)).toBe(false);
    // en pleine nuit (2 h), on va jusqu'au matin du même jour
    s.clock.t = (day + 2) * TIME.DAY + 2 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    skipNight(s);
    expect(s.clock.t / TIME.DAY).toBeCloseTo(day + 2 + 6.5 / 24, 3);
  });
});

describe('Onglet en arrière-plan', () => {
  it('la ferme avance du temps réel écoulé, à la vitesse choisie, sans rien perdre', () => {
    const s = createNewGame(302);
    s.money = 1_000_000;
    for (let i = 0; i < 6; i++) A.buyHen(s, 'rousse');
    morning(s);
    const t0 = s.clock.t;
    s.clock.speed = 3;
    advanceRealtime(s, 20);
    expect(s.clock.t - t0).toBeCloseTo(60, 1);
    s.clock.speed = 0;
    advanceRealtime(s, 50);
    expect(s.clock.t - t0).toBeCloseTo(60, 1);
    // très longue absence : plafonnée comme la progression hors ligne
    s.clock.speed = 1;
    const t1 = s.clock.t;
    advanceRealtime(s, 1e6);
    expect(s.clock.t - t1).toBeLessThanOrEqual(2 * TIME.DAY + 0.3);
    expect(s.hens.length).toBeGreaterThan(0);
  });
});

describe('Nouvelle partie du joueur', () => {
  it('commence avec Cocotte, trois poussins, un coq, et une poussinière équipée de sa couveuse offertes', () => {
    const s = newFarm(5);
    expect(s.hens.filter((h) => !h.rooster && !h.young).map((h) => h.name)).toEqual(['Cocotte']);
    expect(s.hens.filter((h) => h.young)).toHaveLength(3);
    expect(s.hens.filter((h) => h.rooster && !h.young)).toHaveLength(1);
    const inc = buildingsOf(s, 'incubator');
    expect(inc).toHaveLength(1);
    expect(inc[0].invested).toBe(0);
    const nursery = buildingsOf(s, 'nursery');
    expect(nursery).toHaveLength(1);
    expect(nursery[0].invested).toBe(0);
    expect(inc[0].hostId).toBe(nursery[0].id);
    // les poussins de Cocotte restent avec elle : la poussinière attend les prochains
    expect(s.hens.filter((h) => h.nursery)).toHaveLength(0);
    expect(fertility(s)).toBeGreaterThan(0.8);
  });
});

describe('Couveuses installées dans la poussinière', () => {
  const farm = (seed: number) => {
    const s = createNewGame(seed);
    s.money = 10_000_000;
    s.xp = 99999;
    s.settings.predators = false;
    return s;
  };
  const nurseryAt = (s: GameState) => {
    for (let z = 10; z < 30; z++) for (let x = 0; x < 20; x++) if (canPlace(s, 'nursery', x, z).ok && A.build(s, 'nursery', x, z).ok) return buildingsOf(s, 'nursery').at(-1)!;
    throw new Error('aucune place pour la poussinière');
  };

  it('sans poussinière, pas de couveuse : on ne peut la poser nulle part ailleurs', () => {
    const s = farm(1301);
    expect(A.checkBuild(s, 'incubator').ok).toBe(false);
    expect(A.build(s, 'incubator', 12, 14).ok).toBe(false);
    expect(buildingsOf(s, 'incubator')).toHaveLength(0);
    expect(BUILDINGS.incubator.movable).toBe(false);
  });

  it('un emplacement au niveau 1, deux au niveau 2, chacun acheté à part', () => {
    const s = farm(1302);
    const n = nurseryAt(s);
    const before = s.money;
    expect(A.installIncubator(s).ok).toBe(true);
    expect(before - s.money).toBe(BUILDINGS.incubator.levels[0].cost);
    expect(A.installIncubator(s).ok).toBe(false);
    expect(A.checkBuild(s, 'incubator').reason).toMatch(/emplacement/);
    expect(A.upgrade(s, n.id).ok).toBe(true);
    expect(A.installIncubator(s, n.id).ok).toBe(true);
    expect(A.installIncubator(s, n.id).ok).toBe(false);
    expect(hostedIncubators(s, n)).toHaveLength(2);
    // une autre poussinière offre de nouvelles places
    nurseryAt(s);
    expect(A.installIncubator(s).ok).toBe(true);
    expect(buildingsOf(s, 'incubator')).toHaveLength(3);
  });

  it('une couveuse n’occupe aucune case : elle ne gêne ni la pose ni les poules', () => {
    const s = farm(1303);
    nurseryAt(s);
    const walk = () => rt(s).walk.reduce((a: number, v: number) => a + v, 0);
    rt(s);
    const free = walk();
    A.installIncubator(s);
    invalidateLayout(s);
    expect(walk()).toBe(free);
    expect(sizeOf('incubator', 3)).toEqual({ w: 0, d: 0 });
  });

  it('les poussins naissent directement dans la poussinière de leur couveuse', () => {
    const s = farm(1304);
    const n = nurseryAt(s);
    A.installIncubator(s);
    const inc = hostedIncubators(s, n)[0];
    inc.hatch = [0, 1, 2].map(() => ({ breed: 'rousse' as const, t: s.clock.t - BREEDING.incubationDays * TIME.DAY, ok: true }));
    const before = s.hens.length;
    step(s, TIME.STEP);
    const born = s.hens.slice(before);
    expect(born).toHaveLength(3);
    for (const h of born) {
      expect(h.nursery).toBe(true);
      expect(h.coopId).toBe(n.id);
    }
  });

  it('elle suit sa poussinière quand on la déplace, la pivote ou l’agrandit', () => {
    const s = farm(1305);
    const n = nurseryAt(s);
    A.installIncubator(s);
    const inc = hostedIncubators(s, n)[0];
    const seatAt = () => toWorld(n, nurseryPlan(n.level).seats[0].x, nurseryPlan(n.level).seats[0].z);
    expect([inc.x, inc.z]).toEqual(seatAt());
    expect(A.rotate(s, n.id).ok).toBe(true);
    expect([inc.x, inc.z]).toEqual(seatAt());
    expect(inc.rot).toBe(((n.rot ?? 0) + nurseryPlan(n.level).seats[0].rot) % 4);
    expect(A.move(s, n.id, n.x + 1, n.z + 1).ok).toBe(true);
    expect([inc.x, inc.z]).toEqual(seatAt());
    // remise dans le sens de départ (elle prend plus de place en s'agrandissant) puis agrandie
    for (let k = 0; k < 3; k++) expect(A.rotate(s, n.id).ok).toBe(true);
    expect(n.rot ?? 0).toBe(0);
    expect(A.upgrade(s, n.id).ok).toBe(true);
    expect([inc.x, inc.z]).toEqual(seatAt());
    // elle ne se déplace pas toute seule
    expect(A.move(s, inc.id, 12, 14).ok).toBe(false);
  });

  it('améliorer ou démonter une couveuse reste possible, sans perdre ses œufs', () => {
    const s = farm(1306);
    const n = nurseryAt(s);
    A.installIncubator(s);
    const inc = hostedIncubators(s, n)[0];
    expect(A.upgrade(s, inc.id).ok).toBe(true);
    expect(inc.level).toBe(2);
    inc.auto = false;
    inc.hatch = [{ breed: 'rousse', t: s.clock.t, ok: true }];
    expect(A.demolish(s, inc.id).ok).toBe(true);
    expect(fertileStock(s)).toBe(1);
    expect(freeSeats(s, n)).toBe(1);
  });

  it('ancienne partie : la couveuse posée au sol rejoint sa poussinière, en gardant ses œufs', () => {
    const s = farm(1307);
    nurseryAt(s);
    const raw = JSON.parse(serialize(s));
    raw.buildings.push({ id: 900, type: 'incubator', level: 2, x: 12, z: 14, stock: 0, cleanliness: 100, closed: false, eggIds: [], invested: 26000, builtAt: 0, hatch: [{ breed: 'rousse', t: s.clock.t, ok: true }] });
    const back = deserialize(JSON.stringify(raw))!;
    const inc = buildingsOf(back, 'incubator');
    expect(inc).toHaveLength(1);
    expect(inc[0].hostId).toBe(buildingsOf(back, 'nursery')[0].id);
    expect(inc[0].hatch).toHaveLength(1);
    expect(inc[0].level).toBe(2);
    // la relecture ne change plus rien ensuite
    const again = deserialize(serialize(back))!;
    expect(buildingsOf(again, 'incubator')[0].hostId).toBe(inc[0].hostId);
  });

  it('ancienne partie sans poussinière : elle est offerte, et les couveuses de trop remboursées', () => {
    const s = farm(1308);
    const raw = JSON.parse(serialize(s));
    for (const id of [901, 902]) raw.buildings.push({ id, type: 'incubator', level: 1, x: 12, z: 14, stock: 0, cleanliness: 100, closed: false, eggIds: [], invested: 9000, builtAt: 0, hatch: id === 902 ? [{ breed: 'rousse', t: s.clock.t, ok: true }] : [] });
    const money = s.money;
    const back = deserialize(JSON.stringify(raw))!;
    expect(buildingsOf(back, 'nursery')).toHaveLength(1);
    expect(buildingsOf(back, 'incubator')).toHaveLength(1);
    expect(back.money).toBe(money + 9000);
    // l'œuf n'est pas perdu : il couve dans celle qui reste
    expect(buildingsOf(back, 'incubator')[0].hatch).toHaveLength(1);
  });
});

describe('Bain de poussière et poulaillers', () => {
  it('le grand bain de sable est un niveau de plus, sans toit, une case plus grand', () => {
    const levels = BUILDINGS.dustbath.levels;
    expect(levels).toHaveLength(3);
    expect(sizeOf('dustbath', 2)).toEqual({ w: 2, d: 2 });
    expect(sizeOf('dustbath', 3)).toEqual({ w: 3, d: 3 });
    expect(levels[2].wellbeing!).toBeGreaterThan(levels[1].wellbeing!);
    expect(levels[2].slots!).toBeGreaterThan(levels[1].slots!);
    expect(NATURE.dustSick[3]).toBeLessThan(NATURE.dustSick[2]);
  });

  it('on l’améliore jusqu’au grand bain, et ses places tiennent dans le bassin', () => {
    const s = createNewGame(1401);
    s.money = 10_000_000;
    s.xp = 99999;
    s.settings.predators = false;
    let ok = false;
    for (let z = 10; z < 28 && !ok; z++) for (let x = 0; x < 18 && !ok; x++) if (canPlace(s, 'dustbath', x, z).ok) ok = A.build(s, 'dustbath', x, z).ok;
    expect(ok).toBe(true);
    const b = buildingsOf(s, 'dustbath')[0];
    expect(A.upgrade(s, b.id).ok).toBe(true);
    expect(A.upgrade(s, b.id).ok).toBe(true);
    expect(b.level).toBe(3);
    // huit places, toutes dans le bassin (la margelle commence à 1,05 du centre)
    const c = buildingCenter(b);
    const spots = slotSpots(s, b);
    expect(spots).toHaveLength(8);
    for (const [x, z] of spots) {
      expect(Math.abs(x - c.x)).toBeLessThan(1.05);
      expect(Math.abs(z - c.z)).toBeLessThan(1.05);
    }
  });

  it('les poulaillers modernes forment une même famille, du niveau 4 au niveau 6', () => {
    const names = BUILDINGS.coop.levels.map((l) => l.name);
    expect(names[3]).toMatch(/moderne/);
    expect(names[4]).toMatch(/moderne/);
    expect(names[4]).not.toMatch(/ferme/);
  });
});

describe('Génétique et sélection', () => {
  it('les volailles du commerce plafonnent à 3 étoiles', () => {
    const s = createNewGame(401);
    s.money = 10_000_000;
    s.xp = 900;
    const coop = buildingsOf(s, 'coop')[0];
    A.upgrade(s, coop.id);
    A.upgrade(s, coop.id);
    for (let i = 0; i < 25; i++) A.buyHen(s, 'rousse');
    for (const h of s.hens) for (const v of Object.values(h.genes!)) expect(v).toBeGreaterThanOrEqual(1), expect(v).toBeLessThanOrEqual(3);
  });

  it('chaque race a son profil d’étoiles (points forts, faiblesses, rareté)', () => {
    const s = createNewGame(405);
    for (let i = 0; i < 60; i++) {
      const leg = shopGenes(s, 'leghorn');
      expect(leg.p).toBe(3); // grosse pondeuse
      expect(leg.r).toBeLessThanOrEqual(2); // nerveuse, fragile
      const soie = shopGenes(s, 'soie');
      expect(soie.p).toBe(1);
      expect(soie.b).toBe(3); // la poule d'ornement
      const sus = shopGenes(s, 'sussex');
      expect(sus.r).toBe(3); // rustique
      for (const b of BREED_ORDER) for (const v of Object.values(shopGenes(s, b))) expect(v).toBeLessThanOrEqual(3);
    }
  });

  it('le poussin hérite de ses parents : deux 5★ donnent surtout des 5★, deux 1★ surtout des 1★', () => {
    const s = createNewGame(402);
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < 400; i++) {
      hi += inherit(s, { p: 5, r: 5, b: 5 }, { p: 5, r: 5, b: 5 }).b;
      lo += inherit(s, { p: 1, r: 1, b: 1 }, { p: 1, r: 1, b: 1 }).b;
    }
    expect(hi / 400).toBeGreaterThan(4.7);
    expect(lo / 400).toBeLessThan(1.3);
    // des parents 3★ donnent parfois un 4★ (sélection possible), jamais au-delà de 5
    let four = 0;
    for (let i = 0; i < 400; i++) if (inherit(s, { p: 3, r: 3, b: 3 }, { p: 3, r: 3, b: 3 }).p === 4) four++;
    expect(four).toBeGreaterThan(30);
  });

  it('un œuf fécondé porte les qualités du futur poussin jusqu’à l’éclosion', () => {
    const s = createNewGame(403);
    s.money = 1_000_000;
    s.xp = 900;
    s.settings.predators = false;
    A.buyHen(s, 'rousse');
    A.buyRooster(s, 'rousse');
    const [hen, rooster] = s.hens;
    hen.genes = { p: 5, r: 5, b: 5 };
    rooster.genes = { p: 5, r: 5, b: 5 };
    let egg = layEgg(s, hen, null);
    for (let i = 0; i < 30 && !egg.fertile; i++) egg = layEgg(s, hen, null);
    expect(egg.genes).toMatch(/^[45][45][45]$/);
    // de l'œuf au poussin
    for (let z = 10; z < 30 && !buildingsOf(s, 'nursery').length; z++) for (let x = 0; x < 20; x++) if (canPlace(s, 'nursery', x, z).ok && A.build(s, 'nursery', x, z).ok) break;
    expect(A.installIncubator(s).ok).toBe(true);
    const inc = buildingsOf(s, 'incubator')[0];
    inc.auto = false;
    addToStorage(s, 'roux', 'A', 100, 1, 'rousse', egg.genes);
    loadIncubator(s, inc);
    inc.hatch![0].ok = true;
    inc.hatch![0].t -= 15 * TIME.DAY;
    step(s, TIME.STEP);
    drainEvents(s);
    const chick = s.hens.find((h) => h.young)!;
    expect(`${chick.genes!.p}${chick.genes!.r}${chick.genes!.b}`).toBe(egg.genes);
  });

  it('les étoiles comptent : ponte, résistance, valeur', () => {
    const s = createNewGame(404);
    s.money = 1_000_000;
    A.buyHen(s, 'rousse');
    const h = s.hens[0];
    h.genes = { p: 1, r: 1, b: 1 };
    const low = { prod: productivity(h), value: henValue(h) };
    h.genes = { p: 5, r: 5, b: 5 };
    expect(productivity(h) / low.prod).toBeCloseTo(1.5, 1);
    expect(henValue(h)).toBeGreaterThan(low.value);
  });
});

describe('Saisons', () => {
  it('quatre saisons de 7 jours : printemps, été, automne, hiver', () => {
    const s = createNewGame(410);
    const at = (day: number) => {
      s.clock.t = (day - 1) * TIME.DAY + 10 * HOUR;
      return season(s).id;
    };
    expect(at(1)).toBe('printemps');
    expect(at(8)).toBe('ete');
    expect(at(15)).toBe('automne');
    expect(at(22)).toBe('hiver');
    expect(at(29)).toBe('printemps');
  });

  it('l’hiver : l’herbe ne repousse presque plus, les œufs se vendent plus cher', () => {
    const s = createNewGame(411);
    const grow = (day: number) => {
      s.clock.t = (day - 1) * TIME.DAY + 10 * HOUR;
      s.grass.fill(0.3);
      regrowGrass(s, 1);
      return Math.max(...s.grass) - 0.3;
    };
    expect(grow(22)).toBeLessThan(grow(2) / 3);
    s.clock.t = 21 * TIME.DAY + 10 * HOUR;
    const winter = refPrice(s, 'roux');
    s.clock.t = 1 * TIME.DAY + 10 * HOUR;
    expect(winter).toBeGreaterThan(refPrice(s, 'roux'));
  });

  it('le changement de saison est annoncé', () => {
    const s = createNewGame(412);
    s.clock.t = 7 * TIME.DAY - 1;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    s.clock.lastClosedDay = 6;
    const ev = runEvents(s, 2);
    expect(ev.some((e) => e.kind === 'notify' && e.text.includes('L’été'))).toBe(true);
  });
});

describe('Concours agricole', () => {
  const ready = (seed: number) => {
    const s = createNewGame(seed);
    s.money = 1_000_000;
    s.xp = 900;
    s.settings.predators = false;
    for (let i = 0; i < 4; i++) A.buyHen(s, 'rousse');
    // jour 7, juste avant 15 h
    s.clock.t = 6 * TIME.DAY + 14.8 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    s.clock.lastClosedDay = 6;
    s.grain = 200;
    s.water = 200;
    A.refillAll(s);
    return s;
  };

  it('a lieu le dernier jour de la saison à 15 h, avec la volaille inscrite', () => {
    const s = ready(420);
    const star = s.hens[2];
    star.genes = { p: 5, r: 5, b: 5 };
    star.health = 100;
    star.wellbeing = 90;
    expect(enterShow(s, star.id).ok).toBe(true);
    const money = s.money;
    const ev = runEvents(s, 4);
    const res = ev.find((e) => e.kind === 'showResult');
    expect(res).toBeTruthy();
    if (res?.kind !== 'showResult') return;
    expect(res.result.henId).toBe(star.id);
    expect(res.result.place).toBe(1); // une 5★ écrase le concours du village
    expect(s.money - money).toBe(SHOW_TIERS[0].prize);
    expect(s.show.tier).toBe(1);
    expect(s.show.trophies).toHaveLength(1);
    expect(s.stats.showsWon).toBe(1);
    // une seule fois par concours
    expect(runEvents(s, HOUR * 2).some((e) => e.kind === 'showResult')).toBe(false);
  });

  it('sans inscription, la plus belle volaille est présentée d’office ; un poussin ne peut pas concourir', () => {
    const s = ready(421);
    const young = createHen(s, 'rousse', buildingsOf(s, 'coop')[0], false, { young: 20 });
    s.hens.push(young);
    expect(enterShow(s, young.id).ok).toBe(false);
    const res = runEvents(s, 4).find((e) => e.kind === 'showResult');
    expect(res?.kind === 'showResult' && res.result.auto).toBe(true);
    expect(nextShowDay(s)).toBe(14);
  });

  it('plus on monte de catégorie, plus les rivaux sont forts', () => {
    const scores = SHOW_TIERS.map((t) => t.rival);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    // une poule du commerce moyenne gagne au village mais pas au national
    const s = createNewGame(422);
    s.money = 1_000_000;
    A.buyHen(s, 'rousse');
    const h = s.hens[0];
    h.genes = { p: 3, r: 3, b: 3 };
    h.health = 95;
    h.wellbeing = 75;
    expect(showScore(h)).toBeGreaterThan(SHOW_TIERS[0].rival + 5);
    expect(showScore(h)).toBeLessThan(SHOW_TIERS[4].rival - 10);
  });
});

describe('Banque : prêts', () => {
  const at = (s: GameState, day: number, hour = 10) => {
    s.clock.t = (day - 1) * TIME.DAY + hour * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    s.clock.lastClosedDay = day - 1;
  };

  it('on peut toujours emprunter 50 €, même avec un compte à −5 000 €', () => {
    const s = createNewGame(501);
    at(s, 3);
    s.money = -500_000;
    expect(creditLimit(s)).toBeGreaterThanOrEqual(5000);
    expect(takeLoan(s, 5000, 7).ok).toBe(true);
    expect(s.money).toBe(-495_000);
    expect(s.loans).toHaveLength(1);
    // le prêt reçu n'est pas un revenu de la ferme
    expect(s.stats.totalIncome).toBe(0);
  });

  it('échéances chaque nuit : capital + intérêts = montant × taux × durée / 28 jours', () => {
    const s = createNewGame(502);
    at(s, 3);
    s.money = 100_000;
    const q = quoteLoan(s, 5000, 14);
    expect(q.interest).toBe(Math.round(5000 * q.rate * (14 / 28)));
    expect(q.daily).toBe(Math.ceil(q.total / 14));
    expect(takeLoan(s, 5000, 14).ok).toBe(true);
    const before = s.money;
    let paid = 0;
    for (let d = 3; d < 3 + 14; d++) {
      const m = s.money;
      closeDay(s, d);
      paid += m - s.money;
    }
    expect(s.loans).toHaveLength(0);
    // le compte a payé au total le capital et les intérêts (en plus des charges habituelles)
    const days = s.finance.days.filter((d) => d.day >= 3 && d.day < 17);
    const capital = days.reduce((a, d) => a + (d.expense.capital ?? 0), 0);
    const interest = days.reduce((a, d) => a + (d.expense.interets ?? 0), 0);
    expect(capital).toBe(5000);
    expect(interest).toBe(q.interest);
    expect(before - s.money).toBeGreaterThanOrEqual(q.total);
    expect(paid).toBeGreaterThan(0);
  });

  it('le taux varie : plus cher en hiver, à découvert et sur une longue durée', () => {
    const s = createNewGame(503);
    s.money = 100_000;
    at(s, 3); // printemps
    const spring = loanRate(s, 7).rate;
    at(s, 23); // hiver
    const winter = loanRate(s, 7).rate;
    expect(winter).toBeGreaterThan(spring);
    expect(loanRate(s, 28).rate).toBeGreaterThan(winter);
    s.money = -1000;
    expect(loanRate(s, 7).rate).toBeGreaterThan(winter);
  });

  it('remboursement anticipé : seul le capital restant est dû ; 5 prêts au maximum', () => {
    const s = createNewGame(504);
    at(s, 3);
    s.money = 1_000_000;
    s.xp = 5000;
    for (let i = 0; i < 5; i++) expect(takeLoan(s, 5000, 28).ok).toBe(true);
    expect(takeLoan(s, 5000, 28).ok).toBe(false);
    closeDay(s, 3);
    const loan = s.loans[0];
    const left = loan.capitalLeft;
    expect(loan.interestLeft).toBeGreaterThan(0);
    const m = s.money;
    expect(repayLoan(s, loan.id).ok).toBe(true);
    expect(m - s.money).toBe(left);
    expect(s.loans).toHaveLength(4);
  });

  it('pause des échéances : rien n’est prélevé pendant la pause, les intérêts courent, une seule fois', () => {
    const s = createNewGame(506);
    at(s, 3);
    s.money = 1_000_000;
    s.xp = 5000;
    expect(takeLoan(s, 20000, 14).ok).toBe(true);
    const loan = s.loans[0];
    const interest = loan.interestLeft;
    expect(pauseLoan(s, loan.id, 3).ok).toBe(true);
    expect(loan.interestLeft).toBeGreaterThan(interest);
    expect(pauseLoan(s, loan.id, 7).ok).toBe(false);
    expect(dailyDue(s)).toBe(0);
    for (let d = 3; d <= 5; d++) closeDay(s, d);
    expect(loan.paid).toBe(0);
    expect(loan.capitalLeft).toBe(20000);
    closeDay(s, 6);
    expect(loan.paid).toBe(1);
  });

  it('le plafond grandit avec la ferme et diminue avec les dettes', () => {
    const s = createNewGame(505);
    at(s, 3);
    s.money = 10_000_000;
    s.xp = 900;
    const small = creditLimit(s);
    for (let i = 0; i < 10; i++) A.buyHen(s, 'rousse');
    const coop = buildingsOf(s, 'coop')[0];
    A.upgrade(s, coop.id);
    expect(creditLimit(s)).toBeGreaterThan(small);
    const big = creditLimit(s);
    takeLoan(s, big, 7);
    expect(creditLimit(s)).toBe(5000); // tout est emprunté : il reste le minimum
  });
});

describe('Balade et rue passante', () => {
  it('les poules se dispersent sur tout leur terrain, pas seulement au pied des bâtiments', () => {
    const s = newFarm(5);
    s.money = 1e7;
    for (let i = 0; i < 8; i++) A.buyHen(s, i % 2 ? 'rousse' : 'leghorn');
    s.clock.t = TIME.DAY + 7 * HOUR;
    run(s, TIME.DAY);
    // distance au bord du bâtiment le plus proche
    const rects = s.buildings.filter((b) => b.type !== 'stand').map((b) => ({ x: b.x, z: b.z, w: BUILDINGS[b.type].w, d: BUILDINGS[b.type].d }));
    const near = (x: number, z: number) => Math.min(...rects.map((r) => Math.hypot(Math.max(r.x - x, 0, x - r.x - r.w), Math.max(r.z - z, 0, z - r.z - r.d))));
    let n = 0;
    let far = 0;
    const blocks = new Set<string>();
    run(
      s,
      8 * HOUR,
      (st) => {
        for (const h of st.hens) {
          if (!['walk', 'peck', 'scratch', 'rest', 'preen', 'idle'].includes(h.act)) continue;
          n++;
          if (near(h.x, h.z) > 3.5) far++;
          blocks.add(`${Math.floor(h.x / 4)},${Math.floor(h.z / 4)}`);
        }
      },
      1,
    );
    expect(n).toBeGreaterThan(100);
    // une bonne part du temps libre loin des bâtiments (0 % sans les balades ; 49 % pour des points au hasard)
    expect(far / n).toBeGreaterThan(0.08);
    expect(blocks.size).toBeGreaterThanOrEqual(12); // sur les 25 carrés de 4 m de la parcelle (dont les bâtiments)
  });

  it('les clients marchent sur le trottoir et s’arrêtent sur la place, jamais sur la chaussée', () => {
    const s = newFarm(9);
    s.reputation = 90;
    addToStorage(s, 'roux', 'A', 200, 20);
    s.clock.t = TIME.DAY + 9 * HOUR;
    let seen = 0;
    run(
      s,
      6 * HOUR,
      (st) => {
        for (const c of st.customers) {
          seen++;
          expect(c.z).toBeLessThan(WORLD.ROAD_Z - WORLD.ROAD_HALF);
          expect(c.z).toBeGreaterThan(STAND_POS.z);
        }
      },
      0.5,
    );
    expect(seen).toBeGreaterThan(5);
  });
});

describe('Poulaillers agrandis', () => {
  it('une ancienne sauvegarde (poulailler de 3 × 2) le repose sans chevaucher les autres bâtiments', () => {
    const s = createNewGame(71);
    const raw = JSON.parse(serialize(s));
    raw.version = 7;
    // l'ancienne cour : poulailler en 11,21, pondoir et réserve juste à côté
    for (const b of raw.buildings) {
      if (b.type === 'coop') [b.x, b.z] = [11, 21];
      if (b.type === 'nest') [b.x, b.z] = [15, 21];
      if (b.type === 'storage') [b.x, b.z] = [17, 21];
    }
    const back = deserialize(JSON.stringify(raw))!;
    const coop = back.buildings.find((b) => b.type === 'coop')!;
    expect(canPlace(back, 'coop', coop.x, coop.z, coop.id).ok).toBe(true);
    const cells = new Set<string>();
    for (const b of back.buildings) {
      if (b.type === 'stand') continue;
      const d = BUILDINGS[b.type];
      for (let j = 0; j < d.d; j++)
        for (let i = 0; i < d.w; i++) {
          const k = `${b.x + i},${b.z + j}`;
          expect(cells.has(k)).toBe(false);
          cells.add(k);
        }
    }
  });
});

describe('Commandes et contrats', () => {
  it('les offres de commandes vont de quelques œufs à près de 200', () => {
    const s = createNewGame(81);
    s.xp = 99999;
    A.buyHen(s, 'rousse');
    const sizes: number[] = [];
    for (let i = 0; i < 60; i++) {
      s.orders = [];
      generateOrders(s);
      sizes.push(...s.orders.map((o) => o.qty));
    }
    expect(Math.min(...sizes)).toBeLessThanOrEqual(12);
    expect(Math.max(...sizes)).toBeGreaterThanOrEqual(150);
    expect(new Set(sizes).size).toBeGreaterThan(8);
  });

  it('une commande acceptée peut être annulée, et le stock prêt est signalé avec un bouton « Livrer »', () => {
    const s = createNewGame(82);
    s.orders.push({ id: 900, client: 'Café', type: 'roux', qty: 10, minGrade: 'A', unitPrice: 160, deadlineDay: 9, status: 'offer', offerUntilDay: 9 });
    s.orders.push({ id: 901, client: 'Cantine', type: 'roux', qty: 200, minGrade: 'A', unitPrice: 130, deadlineDay: 12, status: 'offer', offerUntilDay: 9 });
    expect(acceptOrder(s, 900).ok).toBe(true);
    expect(acceptOrder(s, 901).ok).toBe(true);
    const rep0 = s.reputation;
    expect(cancelOrder(s, 901).ok).toBe(true);
    expect(s.orders.find((o) => o.id === 901)).toBeUndefined();
    expect(s.reputation).toBeLessThan(rep0);
    drainEvents(s);
    addToStorage(s, 'roux', 'A', 100, 10);
    checkOrdersReady(s);
    const ev = drainEvents(s).find((e) => e.kind === 'notify' && e.action?.kind === 'deliverOrder');
    expect(ev).toBeDefined();
    checkOrdersReady(s); // pas de doublon
    expect(drainEvents(s).some((e) => e.kind === 'notify')).toBe(false);
    expect(deliverOrder(s, 900).ok).toBe(true);
    expect(storedCount(s)).toBe(0);
  });

  it('un contrat se livre en avance (pas deux fois le même jour) et peut être résilié', () => {
    const s = createNewGame(83);
    s.contracts.push({ id: 950, client: 'Épicerie', type: 'roux', qtyPerDay: 12, unitPrice: 120, days: 5, daysLeft: 5, status: 'active', missed: 0, delivered: 0, offerUntilDay: 3 });
    addToStorage(s, 'roux', 'A', 100, 40);
    const m = s.money;
    expect(deliverContractNow(s, 950).ok).toBe(true);
    expect(s.money - m).toBe(12 * 120);
    expect(deliverContractNow(s, 950).ok).toBe(false);
    deliverContracts(s); // la livraison de 17 h ne reprend pas d'œufs
    expect(storedCount(s)).toBe(28);
    expect(s.contracts[0].daysLeft).toBe(4);
    const m2 = s.money;
    expect(cancelContract(s, 950).ok).toBe(true);
    expect(s.contracts).toHaveLength(0);
    expect(s.money).toBeLessThan(m2);
  });
});

describe('Basse-cour vivante', () => {
  it('les poussins naissent moitié coqs, moitié poules', () => {
    expect(BREEDING.roosterShare).toBe(0.5);
  });

  it('un nouveau coq se bat avec l’autre coq, puis chacun a trouvé sa place', () => {
    const s = newFarm(84);
    morning(s);
    const coop = buildingsOf(s, 'coop')[0];
    const old = s.hens.find((h) => h.rooster && !h.young)!;
    old.ranked = true;
    old.health = 100;
    const fresh = createHen(s, 'rousse', coop, false, { rooster: true, at: [old.x + 1.5, old.z] });
    s.hens.push(fresh);
    fresh.health = 100;
    let fought = false;
    run(
      s,
      40,
      (st) => {
        if (st.hens.some((h) => h.act === 'fight')) fought = true;
      },
      0.2,
    );
    expect(fought).toBe(true);
    expect(fresh.ranked).toBe(true);
  });

  it('à la mangeoire et à l’abreuvoir, le bec arrive dans le grain ou l’eau', () => {
    // places calées sur les modèles : pattes au bord, bec à moins de 4 cm du point visé
    for (const [type, level] of [
      ['feeder', 1],
      ['feeder', 2],
      ['feeder', 3],
      ['feeder', 4],
      ['feeder', 5],
      ['drinker', 1],
      ['drinker', 2],
      ['drinker', 3],
      ['drinker', 4],
      ['drinker', 5],
      ['pond', 1],
      ['pond', 2],
    ] as const) {
      const spots = feedLayout({ type, level });
      expect(spots.length).toBe(BUILDINGS[type].levels[level - 1].slots);
      const reach = FEED_REACH[feedPose({ type, level })];
      for (const f of spots) expect(Math.abs(Math.hypot(f.x - f.fx, f.z - f.fz) - reach)).toBeLessThan(0.04);
    }
    // et elles y boivent pour de vrai : pattes contre l'abreuvoir, plus à 70 cm de son centre
    const s = newFarm(85);
    morning(s);
    for (const h of s.hens) h.hydration = 20;
    const drinker = buildingsOf(s, 'drinker')[0];
    let near = 0;
    run(
      s,
      60,
      (st) => {
        for (const h of st.hens)
          if (h.act === 'drink' && h.targetId === drinker.id) near = Math.max(near, 0.6 - Math.hypot(h.x - drinker.x - 0.5, h.z - drinker.z - 0.5));
      },
      0.2,
    );
    expect(near).toBeGreaterThan(0.1);
  });
});

describe('Clôtures et santé', () => {
  it('le renard apparaît toujours hors de l’enclos', () => {
    const s = newFarm(91);
    for (let i = 0; i < 40; i++) {
      const p = spawnPredator(s, 'fox');
      const cx = Math.floor(p.x);
      const cz = Math.floor(p.z);
      expect(isOwnedCell(s, cx, cz)).toBe(false);
      s.predators = [];
    }
  });

  it('personne ne passe à travers le grillage : on saute par-dessus', () => {
    const s = newFarm(92);
    hire(s, 'farmhand');
    const w = s.workers[0];
    w.onSite = true;
    // juste à l'intérieur du bord sud de la ferme, puis un pas qui franchit le grillage
    w.x = 2.5;
    w.z = 29.7;
    updateVaults(s, TIME.STEP);
    w.z = 30.3;
    updateVaults(s, TIME.STEP);
    expect(vaultOf(w)).toBeDefined();
    expect(w.z).toBeLessThan(30);
    for (let i = 0; i < 20; i++) updateVaults(s, TIME.STEP);
    expect(vaultOf(w)).toBeUndefined();
    expect(w.z).toBeGreaterThan(30.2);
  });

  it('bien tenues, les poules ne tombent pas malades', () => {
    const s = newFarm(93);
    for (const b of s.buildings) b.cleanliness = 100;
    for (const h of s.hens) {
      h.wellbeing = 80;
      h.health = 100;
      h.satiety = 80;
      h.hydration = 80;
    }
    for (let d = 1; d <= 400; d++) {
      closeDay(s, s.clock.lastClosedDay + 1);
      expect(s.hens.some((h) => h.sick)).toBe(false);
    }
  });
});

describe('Poussins et réserve', () => {
  it('les poussins ne prennent pas la place d’une poule', () => {
    const s = createNewGame(95);
    s.money = 1e7;
    const coop = buildingsOf(s, 'coop')[0];
    const cap = BUILDINGS.coop.levels[coop.level - 1].capacity;
    for (let i = 0; i < 6; i++) s.hens.push(createHen(s, 'rousse', coop, false, { young: 20 }));
    let bought = 0;
    while (A.buyHen(s, 'rousse').ok) bought++;
    expect(bought).toBe(cap);
    expect(coopOccupancy(s, coop.id)).toBe(cap);
  });

  it('la réserve à œufs est plus grande', () => {
    expect(BUILDINGS.storage.levels.map((l) => l.capacity)).toEqual([100, 350, 900, 2500, 6000]);
  });
});

describe('Vieillesse et réforme', () => {
  it('une poule ne vieillit qu’à partir de 600 jours, puis pond moins', () => {
    expect(ageFactor(300)).toBe(1);
    expect(ageFactor(599)).toBe(1);
    expect(ageFactor(700)).toBeLessThan(1);
    expect(ageFactor(900)).toBeCloseTo(0.35);
    expect(BREEDING.incubationDays).toBeGreaterThan(0);
  });

  it('une vieille poule peut être confiée à une association', () => {
    const s = createNewGame(96);
    A.buyHen(s, 'rousse');
    const h = s.hens[0];
    h.age = 650;
    const rep = s.reputation;
    expect(A.rehomeHen(s, h.id).ok).toBe(true);
    expect(s.hens).toHaveLength(0);
    expect(s.stats.hensRehomed).toBe(1);
    expect(s.reputation).toBeGreaterThan(rep);
  });

  it('bien nourrie et abreuvée, une poule stressée ne meurt pas', () => {
    const s = createNewGame(97);
    A.buyHen(s, 'rousse');
    const h = s.hens[0];
    h.wellbeing = 5;
    h.health = 40;
    for (const b of s.buildings) if (b.type === 'coop') b.cleanliness = 5;
    for (let i = 0; i < TIME.DAY * 5; i += 1) {
      h.satiety = 60;
      h.hydration = 60;
      h.sick = false;
      h.wellbeing = 5;
      step(s, 1);
      drainEvents(s);
    }
    expect(s.hens).toHaveLength(1);
    expect(h.health).toBeGreaterThanOrEqual(35);
  });
});

describe('Achats sans limite et lots de poules', () => {
  it('on peut construire autant de bâtiments qu’on veut (sauf réserve et étal)', () => {
    const s = createNewGame(98);
    expect(A.maxCount(s, 'coop')).toBe(Infinity);
    expect(A.maxCount(s, 'drinker')).toBe(Infinity);
    expect(A.maxCount(s, 'storage')).toBe(1);
  });

  it('un lot coûte moins cher et arrive en camion au portail', () => {
    const s = createNewGame(99);
    s.money = 1e7;
    const coop = buildingsOf(s, 'coop')[0];
    while (A.upgrade(s, coop.id).ok);
    const price = A.henPackPrice('rousse', 12);
    expect(price).toBeLessThan(BREEDS.rousse.price * 12);
    const before = s.hens.length;
    const m = s.money;
    expect(A.buyHenPack(s, 'rousse', 12).ok).toBe(true);
    expect(m - s.money).toBe(price);
    expect(s.hens.length).toBe(before);
    expect(s.deliveries).toHaveLength(1);
    // pas de place réservée deux fois : la capacité tient compte du lot en route
    const room = A.coopRoom(s, 'rousse');
    run(s, DELIVERY.delay + 20);
    expect(s.deliveries).toHaveLength(0);
    expect(s.hens.length).toBe(before + 12);
    expect(A.coopRoom(s, 'rousse')).toBe(room);
  });

  it('un lot trop gros pour les poulaillers est refusé', () => {
    const s = createNewGame(100);
    s.money = 1e7;
    expect(A.buyHenPack(s, 'rousse', 24).ok).toBe(false);
  });
});

describe('Convois de camions et grandes auges', () => {
  const bigFarm = (seed: number) => {
    const s = createNewGame(seed);
    s.money = 1e8;
    s.xp = 99999;
    const coop = buildingsOf(s, 'coop')[0];
    while (A.upgrade(s, coop.id).ok);
    for (let i = 0; i < 3; i++) {
      for (let x = 2; x < 18; x += 7) if (A.build(s, 'coop', x, 11 + i * 0).ok) break;
    }
    for (const c of buildingsOf(s, 'coop')) while (A.upgrade(s, c.id).ok);
    return s;
  };

  it('plusieurs lots commandés d’un coup arrivent en convoi, un camion par lot', () => {
    const s = bigFarm(301);
    const m = s.money;
    expect(A.buyHenPack(s, 'rousse', 6, 3).ok).toBe(true);
    expect(m - s.money).toBe(A.henPackPrice('rousse', 6) * 3);
    expect(s.deliveries).toHaveLength(3);
    expect(s.deliveries.map((d) => d.slot)).toEqual([0, 1, 2]);
    expect(new Set(s.deliveries.map((d) => d.wave)).size).toBe(1);
    // le camion de tête arrive le premier, les autres le suivent de près ; ils repartent ensemble
    const [a, b, c] = s.deliveries;
    expect(b.eta).toBeGreaterThan(a.eta);
    expect(c.eta).toBeGreaterThan(b.eta);
    expect(c.eta - a.eta).toBeLessThan(4);
    expect(a.leave).toBeLessThan(b.leave!);
    // une commande passée juste après rejoint le convoi s'il reste de la place, sinon un convoi suivant
    expect(A.buyHenPack(s, 'rousse', 6).ok).toBe(true);
    const d = s.deliveries[3];
    expect(d.wave).toBe(a.wave! + 1);
    expect(d.eta).toBeGreaterThan(c.leave!);
  });

  it('les poules passent le portail une à une, sans se marcher dessus', () => {
    const s = bigFarm(302);
    const before = s.hens.length;
    expect(A.buyHenPack(s, 'rousse', 12).ok).toBe(true);
    const d = s.deliveries[0];
    const times: number[] = [];
    run(
      s,
      DELIVERY.delay + 25,
      (st) => {
        const n = st.hens.length - before - times.length;
        for (let k = 0; k < n; k++) times.push(st.clock.t);
      },
      0.1,
    );
    expect(s.hens.length).toBe(before + 12);
    expect(times).toHaveLength(12);
    // première entrée après le trajet depuis le hayon ; ensuite une toutes les ~0,5 s
    expect(times[0]).toBeGreaterThan(d.eta + DELIVERY.firstJump);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThan(DELIVERY.henGap * 0.6);
    expect(s.deliveries).toHaveLength(0);
  });

  it('la mangeoire et l’abreuvoir s’allongent aux niveaux 4 et 5 et accueillent plus de poules', () => {
    const s = newFarm(303);
    morning(s);
    s.money = 1e8;
    s.xp = 99999;
    for (const type of ['feeder', 'drinker'] as const) {
      const b = buildingsOf(s, type)[0];
      while (b.level < 3) expect(A.upgrade(s, b.id).ok).toBe(true);
      expect(A.upgrade(s, b.id).ok).toBe(true);
      expect(b.level).toBe(4);
      expect(feedLayout(b)).toHaveLength(14);
      expect(A.upgrade(s, b.id).ok).toBe(true);
      expect(b.level).toBe(5);
      expect(feedLayout(b)).toHaveLength(22);
      // la nouvelle emprise (4 cases de long) est bien occupée : on ne peut rien poser dessus
      expect(canPlace(s, 'tree', b.x + 3, b.z).ok).toBe(false);
    }
    // et les poules s'y servent pour de vrai
    for (const h of s.hens) (h.satiety = 20), (h.hydration = 20);
    const used = new Set<number>();
    run(s, 60, (st) => st.hens.forEach((h) => (h.act === 'eat' || h.act === 'drink') && used.add(h.targetId)), 0.2);
    expect(used.has(buildingsOf(s, 'feeder')[0].id)).toBe(true);
    expect(used.has(buildingsOf(s, 'drinker')[0].id)).toBe(true);
  });

  it('une auge qui ne tient pas à sa place est refusée sans rien coûter', () => {
    const s = createNewGame(304);
    s.money = 1e8;
    s.xp = 99999;
    const f = buildingsOf(s, 'feeder')[0];
    while (f.level < 3) A.upgrade(s, f.id);
    // on entoure la mangeoire d'arbres : plus de place pour l'allonger
    for (let dx = -4; dx <= 4; dx++) for (const dz of [-1, 0, 1]) if (dx || dz) A.build(s, 'tree', f.x + dx, f.z + dz);
    const m = s.money;
    const r = A.upgrade(s, f.id);
    if (!r.ok) {
      expect(r.reason).toMatch(/cases libres/);
      expect(s.money).toBe(m);
      expect(f.level).toBe(3);
    }
  });
});

describe('Une borne par robot', () => {
  it('chaque robot a sa propre borne et y recharge', () => {
    const s = newFarm(401);
    morning(s);
    s.money = 1e8;
    for (let i = 0; i < 4; i++) expect(buyRobot(s).ok).toBe(true);
    const docks = s.robots.map((r) => dockOf(s, r));
    // quatre bornes distinctes, bien séparées, le long du stockage
    for (let i = 0; i < docks.length; i++)
      for (let j = i + 1; j < docks.length; j++) expect(Math.hypot(docks[i][0] - docks[j][0], docks[i][1] - docks[j][1])).toBeGreaterThan(0.65);
    // batteries faibles : chacun rentre sur la sienne et charge
    for (const r of s.robots) (r.battery = 10), (r.task = 'idle'), (r.path = []);
    run(s, 120, undefined, 1);
    for (const r of s.robots) {
      const [x, z] = dockOf(s, r);
      expect(Math.hypot(r.x - x, r.z - z)).toBeLessThan(0.4);
      expect(r.battery).toBeGreaterThan(10);
    }
  });
});

describe('Grands poulaillers, oies, coqs en trop et poule aux œufs d’or', () => {
  it('les poulaillers des niveaux 5 et 6 sont plus grands et les poules y rentrent la nuit', () => {
    const s = newFarm(501);
    s.money = 1e8;
    s.xp = 99999;
    const coop = buildingsOf(s, 'coop')[0];
    while (coop.level < 6) expect(A.upgrade(s, coop.id).ok).toBe(true);
    expect(sizeOf('coop', 6)).toEqual({ w: 10, d: 6 });
    expect(coopCapacity(s)).toBeGreaterThanOrEqual(140);
    // l'emprise agrandie est bien occupée
    expect(canPlace(s, 'tree', coop.x + 9, coop.z + 5).ok).toBe(false);
    for (let i = 0; i < 6; i++) A.buyHen(s, 'rousse');
    // le soir venu, toutes rentrent par la trappe du grand bâtiment
    const day = Math.floor(s.clock.t / TIME.DAY);
    s.clock.t = day * TIME.DAY + 17.5 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    run(s, 6 * HOUR);
    expect(s.hens.every((h) => h.act === 'sleep')).toBe(true);
  });

  it('les oies ne s’achètent qu’au niveau 10 et pondent des œufs d’oie qui se vendent', () => {
    const s = newFarm(502);
    morning(s);
    s.money = 1e8;
    const coop = buildingsOf(s, 'coop')[0];
    s.xp = 99999;
    while (A.upgrade(s, coop.id).ok);
    s.xp = 0;
    expect(A.checkBuyHen(s, 'oie').ok).toBe(false);
    s.xp = 99999;
    expect(A.checkBuyHen(s, 'oie').reason).toMatch(/abri à oies/);
    expect(buildGooseHouse(s)).toBe(true);
    expect(A.buyHen(s, 'oie').ok).toBe(true);
    const goose = s.hens[s.hens.length - 1];
    expect(GOOSE_NAMES).toContain(goose.name);
    goose.layProgress = 1.2;
    run(s, 3 * HOUR, undefined, 0.5);
    expect(s.stats.eggsLaid).toBeGreaterThan(0);
    const laid = s.worldEggs.some((e) => e.type === 'oie') || s.lots.some((l) => l.type === 'oie');
    expect(laid).toBe(true);
    expect(EGG_ORDER).toContain('oie');
    expect(refPrice(s, 'oie')).toBeGreaterThan(refPrice(s, 'roux') * 3);
  });

  it('un coq ne féconde pas une oie (ni un jars une poule)', () => {
    const s = newFarm(503);
    s.money = 1e8;
    s.xp = 99999;
    const coop = buildingsOf(s, 'coop')[0];
    while (A.upgrade(s, coop.id).ok);
    buildGooseHouse(s);
    A.buyHen(s, 'oie');
    const goose = s.hens[s.hens.length - 1];
    // seuls des coqs de poule à la ferme : aucun œuf d'oie fécondé
    for (let i = 0; i < 200; i++) expect(fertilize(s, goose)).toBeUndefined();
  });

  it('« vendre les coqs en trop » garde le meilleur coq et le coq noir', () => {
    const s = newFarm(504);
    s.money = 1e8;
    s.xp = 99999;
    const coop = buildingsOf(s, 'coop')[0];
    while (A.upgrade(s, coop.id).ok);
    for (let i = 0; i < 4; i++) A.buyRooster(s, 'rousse');
    const roosters = () => s.hens.filter((h) => h.rooster && !h.young);
    const black = roosters()[1];
    black.black = true;
    const best = roosters().filter((h) => !h.black)[2];
    best.genes = { p: 3, r: 3, b: 3 };
    const before = s.money;
    expect(A.sellExtraRoosters(s).ok).toBe(true);
    expect(s.money).toBeGreaterThan(before);
    const left = roosters();
    expect(left).toHaveLength(2);
    expect(left).toContain(best);
    expect(left).toContain(black);
    expect(A.sellExtraRoosters(s).ok).toBe(false);
  });

  it('la poule aux œufs d’or pond des œufs d’or qu’on vend au collectionneur', () => {
    const s = newFarm(505);
    morning(s);
    const coop = buildingsOf(s, 'coop')[0];
    const h = createHen(s, 'rousse', coop, false, { golden: true });
    s.hens.push(h);
    expect(h.golden).toBe(true);
    // elle vaut une vingtaine d'œufs d'or
    expect(henValue(h)).toBeGreaterThan(RARE.goldEggPrice * 15);
    expect(henValue(h)).toBeLessThanOrEqual(RARE.goldEggPrice * RARE.goldHenEggs);
    // ses œufs vont au coffre, pas au stockage
    const stored = storedCount(s);
    addToStorage(s, 'or', 'extra', 100, 2);
    expect(s.goldEggs).toBe(2);
    expect(storedCount(s)).toBe(stored);
    const m = s.money;
    expect(sellGoldEggs(s, 1).ok).toBe(true);
    expect(s.money - m).toBe(RARE.goldCollectorPrice);
    expect(s.goldEggs).toBe(1);
    // à l'étal, on fixe son prix : plus il est doux, plus les amateurs craquent
    setGoldPrice(s, 8000);
    const cheap = goldBuyChance(s, goldPrice(s));
    setGoldPrice(s, 30000);
    expect(goldBuyChance(s, goldPrice(s))).toBeLessThan(cheap);
    setGoldPrice(s, 999999);
    expect(goldPrice(s)).toBe(40000);
    // un client de l'étal finit par l'acheter, au prix affiché
    setGoldPrice(s, 12000);
    const before = s.money;
    for (let i = 0; i < 400 && (s.goldEggs ?? 0) > 0; i++) serveCustomerForTest(s);
    expect(s.goldEggs).toBe(0);
    expect(s.money - before).toBeGreaterThanOrEqual(12000);
    // les poussines dorées restent très rares : dix fois moins que le coq noir
    expect(RARE.goldenHenHatch).toBeCloseTo(RARE.blackRoosterHatch / 10);
  });
});

describe('Plateforme frigorifique', () => {
  it('le stockage passe au niveau 5 : plus long, 6 000 œufs, fraîcheur prolongée', () => {
    const s = newFarm(601);
    s.money = 1e8;
    s.xp = 99999;
    const st = buildingsOf(s, 'storage')[0];
    while (st.level < 5) expect(A.upgrade(s, st.id).ok).toBe(true);
    expect(sizeOf('storage', 5)).toEqual({ w: 6, d: 4 });
    expect(storageCapacity(s)).toBe(6000);
    expect(BUILDINGS.storage.levels[4].decay).toBeLessThan(BUILDINGS.storage.levels[3].decay!);
    // toute la nouvelle longueur est occupée
    expect(canPlace(s, 'tree', st.x + 5, st.z + 1).ok).toBe(false);
  });
});

describe('Abri à oies', () => {
  const gooseFarm = (seed: number) => {
    const s = newFarm(seed);
    morning(s);
    s.money = 1e8;
    s.xp = 99999;
    return s;
  };

  it('il faut le niveau 10 et un abri à oies avant d’acheter des oies', () => {
    const s = gooseFarm(701);
    s.xp = 0;
    expect(A.checkBuild(s, 'goosehouse').ok).toBe(false);
    s.xp = 99999;
    expect(A.checkBuyHen(s, 'oie').ok).toBe(false);
    expect(A.checkBuyHenPack(s, 'oie', 6).reason).toMatch(/abri à oies/);
    expect(buildGooseHouse(s)).toBe(true);
    const house = buildingsOf(s, 'goosehouse')[0];
    for (let i = 0; i < 8; i++) expect(A.buyHen(s, 'oie').ok).toBe(true);
    // l'abri est plein : on l'agrandit pour en loger plus
    expect(A.checkBuyHen(s, 'oie').reason).toMatch(/plein/);
    expect(A.upgrade(s, house.id).ok).toBe(true);
    expect(A.buyHen(s, 'oie').ok).toBe(true);
    // toutes logent dans l'abri à oies, pas au poulailler
    for (const h of s.hens.filter((x) => x.breed === 'oie')) expect(h.coopId).toBe(house.id);
  });

  it('les oies dorment dans leur abri et restent près de chez elles le jour', () => {
    const s = gooseFarm(702);
    buildGooseHouse(s);
    const house = buildingsOf(s, 'goosehouse')[0];
    for (let i = 0; i < 5; i++) A.buyHen(s, 'oie');
    const geese = s.hens.filter((h) => h.breed === 'oie');
    const door = { x: house.x + sizeOf('goosehouse', 1).w / 2, z: house.z + sizeOf('goosehouse', 1).d };
    // elles arrivent au portail : on les laisse rejoindre leur abri avant de mesurer
    run(s, 2 * HOUR);
    let near = 0;
    let total = 0;
    run(
      s,
      6 * HOUR,
      () => {
        for (const g of geese) {
          // quand elles flânent (picorer, gratter, se reposer), c'est devant chez elles ; elles ne
          // s'éloignent que pour manger, boire ou pondre
          if (!['peck', 'scratch', 'rest', 'idle', 'preen'].includes(g.act)) continue;
          total++;
          if (Math.hypot(g.x - door.x, g.z - door.z) < 9) near++;
        }
      },
      0.5,
    );
    expect(total).toBeGreaterThan(20);
    expect(near / total).toBeGreaterThan(0.85);
    // le soir, elles rentrent dans l'abri à oies
    const day = Math.floor(s.clock.t / TIME.DAY);
    s.clock.t = day * TIME.DAY + 17.5 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    // (l'abri est loin de l'abreuvoir sur cette ferme : la dernière à boire rentre tard)
    run(s, 8.5 * HOUR);
    for (const g of geese) {
      expect(g.act).toBe('sleep');
      expect(g.coopId).toBe(house.id);
    }
  });

  it('les oies qui dormaient au poulailler emménagent dans le nouvel abri', () => {
    const s = gooseFarm(703);
    const coop = buildingsOf(s, 'coop')[0];
    const g = createHen(s, 'oie', coop);
    s.hens.push(g);
    expect(g.coopId).toBe(coop.id);
    buildGooseHouse(s);
    expect(g.coopId).toBe(buildingsOf(s, 'goosehouse')[0].id);
  });
});

describe('Niveaux sans plafond', () => {
  it('au-delà du niveau 10 on continue de monter, chaque niveau demandant plus d’XP', () => {
    const s = newFarm(801);
    s.xp = 9800;
    expect(farmLevel(s)).toBe(10);
    s.xp = 1_000_000;
    expect(farmLevel(s)).toBeGreaterThan(25);
    const gaps = [10, 11, 12, 13, 14].map((n) => levelAt(n + 1).xp - levelAt(n).xp);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
  });
});

describe('Bâtiments pivotés', () => {
  const evening = (s: GameState) => {
    const day = Math.floor(s.clock.t / TIME.DAY);
    s.clock.t = day * TIME.DAY + 17.5 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
  };

  it('un poulailler pivoté a sa façade à l’est et ses poules y rentrent puis en ressortent', () => {
    const s = newFarm(901);
    morning(s);
    s.money = 1e8;
    const coop = buildingsOf(s, 'coop')[0];
    const flat = sizeOf('coop', coop.level);
    expect(A.rotate(s, coop.id).ok).toBe(true);
    expect(coop.rot).toBe(1);
    // largeur et profondeur échangées, la trappe sur le côté est, au milieu
    expect(footprint(coop)).toMatchObject({ w: flat.d, d: flat.w });
    const door = coopDoor(coop);
    expect(door.x).toBe(coop.x + flat.d);
    expect(door.z).toBe(coop.z + flat.w / 2);
    for (let i = 0; i < 4; i++) A.buyHen(s, 'rousse');
    run(s, 2 * HOUR);
    evening(s);
    run(s, 6 * HOUR);
    for (const h of s.hens) {
      expect(h.act).toBe('sleep');
      expect(h.coopId).toBe(coop.id);
    }
    // au matin, elles sortent par la trappe de l'est et se retrouvent dehors (sauf au nid)
    run(s, 12 * HOUR);
    for (const h of s.hens) {
      expect(h.act).not.toBe('sleep');
      if (!['enter', 'lay', 'exit'].includes(h.act)) expect(isWalkable(s, h.x, h.z)).toBe(true);
    }
    // trois quarts de tour de plus : un tour complet, il revient droit
    for (const want of [2, 3]) {
      expect(A.rotate(s, coop.id).ok).toBe(true);
      expect(coop.rot).toBe(want);
    }
    expect(A.rotate(s, coop.id).ok).toBe(true);
    expect(coop.rot).toBeUndefined();
    expect(footprint(coop)).toMatchObject({ w: flat.w, d: flat.d });
  });

  it('dans les quatre orientations, la porte est dehors et les poules rentrent dormir', () => {
    for (const q of [0, 1, 2, 3]) {
      const s = newFarm(940 + q);
      morning(s);
      s.money = 1e8;
      const coop = buildingsOf(s, 'coop')[0];
      for (let k = 0; k < q; k++) expect(A.rotate(s, coop.id).ok).toBe(true);
      expect(coop.rot ?? 0).toBe(q);
      const fp = footprint(coop);
      const door = coopDoor(coop);
      // la porte est au milieu du côté sud, est, nord ou ouest
      const expected = [
        [fp.x + fp.w / 2, fp.z + fp.d],
        [fp.x + fp.w, fp.z + fp.d / 2],
        [fp.x + fp.w / 2, fp.z],
        [fp.x, fp.z + fp.d / 2],
      ][q];
      expect([door.x, door.z]).toEqual(expected);
      // les cases devant la trappe sont hors de l'emprise
      for (const [cx, cz] of coopDoorCells(coop)) expect(cx >= fp.x && cx < fp.x + fp.w && cz >= fp.z && cz < fp.z + fp.d).toBe(false);
      for (let i = 0; i < 4; i++) A.buyHen(s, 'rousse');
      run(s, 2 * HOUR);
      const day = Math.floor(s.clock.t / TIME.DAY);
      s.clock.t = day * TIME.DAY + 17.5 * HOUR;
      s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
      run(s, 6 * HOUR);
      for (const h of s.hens) expect(h.act).toBe('sleep');
      run(s, 12 * HOUR);
      // tout le monde est sorti (sauf une poule qui entre pondre au nid ou en ressort)
      for (const h of s.hens) {
        expect(h.act).not.toBe('sleep');
        if (!['enter', 'lay', 'exit'].includes(h.act)) expect(isWalkable(s, h.x, h.z)).toBe(true);
      }
    }
  });

  it('une auge et un pondoir pivotés gardent leurs places du bon côté', () => {
    const s = newFarm(902);
    morning(s);
    s.money = 1e8;
    s.xp = 99999;
    const feeder = buildingsOf(s, 'feeder')[0];
    while (feeder.level < 4) expect(A.upgrade(s, feeder.id).ok).toBe(true);
    expect(A.rotate(s, feeder.id).ok).toBe(true);
    const fp = footprint(feeder);
    expect(fp).toMatchObject({ w: 1, d: 3 });
    // les places longent l'auge selon z, de part et d'autre (à l'ouest et à l'est)
    const spots = slotSpots(s, feeder);
    expect(spots.length).toBeGreaterThan(8);
    for (const [x, z] of spots) {
      expect(z).toBeGreaterThan(fp.z - 0.1);
      expect(z).toBeLessThan(fp.z + fp.d + 0.1);
      expect(Math.abs(x - (fp.x + 0.5))).toBeGreaterThan(0.2);
    }
    // un pondoir construit pivoté : son avant (où l'on se tient) regarde l'est
    let built = false;
    for (let z = -20; z < 28 && !built; z++) for (let x = 0; x < 40 && !built; x++) if (canPlace(s, 'nest', x, z, -1, 1, 1).ok) built = A.build(s, 'nest', x, z, 1).ok;
    expect(built).toBe(true);
    const nest = s.buildings[s.buildings.length - 1];
    expect(footprint(nest)).toMatchObject({ w: 1, d: 2 });
    expect(accessCells(nest).every(([x]) => x === nest.x + 1)).toBe(true);
    // les poules affamées mangent bien à l'auge pivotée
    for (let i = 0; i < 6; i++) A.buyHen(s, 'rousse');
    for (const h of s.hens) h.satiety = 12;
    let eating = 0;
    run(s, 10 * HOUR, () => (eating += s.hens.filter((h) => h.act === 'eat' && h.targetId === feeder.id).length), 0.5);
    expect(eating).toBeGreaterThan(0);
  });

  it('l’orientation est gardée par la sauvegarde', () => {
    const s = newFarm(903);
    const coop = buildingsOf(s, 'coop')[0];
    expect(A.rotate(s, coop.id).ok).toBe(true);
    coop.autoDoor = true;
    const back = deserialize(serialize(s))!;
    const c2 = back.buildings.find((b) => b.id === coop.id)!;
    expect(c2.rot).toBe(1);
    A.rotate(s, coop.id);
    A.rotate(s, coop.id);
    expect(deserialize(serialize(s))!.buildings.find((b) => b.id === coop.id)!.rot).toBe(3);
    expect(c2.autoDoor).toBe(true);
  });
});

describe('Trappe automatique', () => {
  it('posée pour 50 €, elle se ferme la nuit, poules rentrées, et se rouvre au matin', () => {
    const s = newFarm(911);
    morning(s);
    s.money = 100000;
    const coop = buildingsOf(s, 'coop')[0];
    const money = s.money;
    expect(A.buyAutoDoor(s, coop.id).ok).toBe(true);
    expect(money - s.money).toBe(AUTO_DOOR.cost);
    expect(AUTO_DOOR.cost).toBe(5000);
    expect(A.buyAutoDoor(s, coop.id).ok).toBe(false);
    for (let i = 0; i < 4; i++) A.buyHen(s, 'rousse');
    run(s, 2 * HOUR);
    // en journée elle reste ouverte
    expect(coop.closed).toBe(false);
    const day = Math.floor(s.clock.t / TIME.DAY);
    s.clock.t = day * TIME.DAY + 17.5 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    let closedWhileOut = false;
    run(s, 6.5 * HOUR, () => {
      if (coop.closed && s.hens.some((h) => h.act !== 'sleep')) closedWhileOut = true;
    }, 0.25);
    // fermée seulement une fois toutes rentrées
    expect(coop.closed).toBe(true);
    expect(closedWhileOut).toBe(false);
    expect(s.hens.every((h) => h.act === 'sleep')).toBe(true);
    // au lever du jour, elle s'ouvre seule (sans commis) et les poules sortent
    run(s, 9 * HOUR);
    expect(coop.closed).toBe(false);
    expect(s.hens.some((h) => h.act !== 'sleep')).toBe(true);
    // refermée à la main en matinée, elle reste fermée jusqu'au lendemain
    A.toggleCoopDoor(s, coop.id);
    expect(coop.closed).toBe(true);
    run(s, 1 * HOUR);
    expect(coop.closed).toBe(true);
  });

  it('le commis ne monte plus la garde devant un poulailler à trappe automatique', () => {
    const s = newFarm(912);
    morning(s);
    s.money = 1e6;
    const coop = buildingsOf(s, 'coop')[0];
    A.buyAutoDoor(s, coop.id);
    hire(s, 'farmhand');
    for (let i = 0; i < 3; i++) A.buyHen(s, 'rousse');
    const day = Math.floor(s.clock.t / TIME.DAY);
    s.clock.t = day * TIME.DAY + 20.8 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    let waited = 0;
    run(s, 3 * HOUR, () => (waited += s.workers.filter((w) => w.job?.kind === 'waitCoop' || w.job?.kind === 'closeCoop').length), 0.25);
    expect(waited).toBe(0);
    expect(coop.closed).toBe(true);
  });
});

describe('Progression après le niveau 10', () => {
  it('contrats, commandes et palettes continuent d’augmenter avec le niveau', () => {
    expect(tradeAt(10).contracts).toBe(3);
    expect(tradeAt(11).contracts).toBe(4);
    expect(tradeAt(15).contracts).toBeGreaterThan(tradeAt(11).contracts);
    expect(tradeAt(20).orders).toBeGreaterThan(tradeAt(10).orders);
    expect(tradeAt(20).pallets).toBeGreaterThan(tradeAt(10).pallets);
    expect(tradeAt(20).contractOffers).toBeGreaterThan(tradeAt(10).contractOffers);
    const s = newFarm(921);
    s.xp = levelAt(15).xp;
    expect(farmLevel(s)).toBe(15);
    expect(maxContracts(s)).toBeGreaterThanOrEqual(6);
    expect(maxOrders(s)).toBeGreaterThan(3);
    expect(palletsPerDay(s)).toBeGreaterThan(MARKET.palletsPerDay);
    expect(levelAt(20).maxCoops).toBeGreaterThan(LEVELS[9].maxCoops);
  });
});

describe('Commis, jardinier et coucher des poules', () => {
  it('le commis recommande du grain dès que la réserve baisse, même occupé', () => {
    const s = newFarm(931);
    morning(s);
    s.money = 1e6;
    for (let i = 0; i < 10; i++) A.buyHen(s, 'rousse');
    hire(s, 'farmhand');
    run(s, 0.5 * HOUR);
    s.grain = 0;
    let emptyFor = 0;
    run(s, 4 * HOUR, () => (s.grain < 1 ? emptyFor++ : 0), HOUR / 4);
    // la réserve vide ne reste pas plus d'une demi-heure de jeu sans commande
    expect(emptyFor).toBeLessThanOrEqual(2);
    expect(s.grain).toBeGreaterThan(20);
  });

  it('le jardinier va reverdir les zones pelées d’abord', () => {
    const s = newFarm(932);
    morning(s);
    s.money = 1e6;
    hire(s, 'gardener');
    run(s, 0.5 * HOUR);
    // une large plaque pelée dans un coin de la ferme, le reste bien vert
    for (let i = 0; i < s.grass.length; i++) s.grass[i] = 0.95;
    const patch: number[] = [];
    for (let z = 12; z < 16; z++)
      for (let x = 2; x < 6; x++) {
        if (!isWalkable(s, x + 0.5, z + 0.5)) continue;
        const i = (z - GRID_Z0) * GRID_W + x;
        s.grass[i] = 0.1;
        patch.push(i);
      }
    expect(patch.length).toBeGreaterThan(8);
    const before = patch.reduce((a, i) => a + s.grass[i], 0);
    run(s, 3 * HOUR);
    const after = patch.reduce((a, i) => a + s.grass[i], 0);
    expect(after - before).toBeGreaterThan(patch.length * 0.25);
  });

  it('poulailler ouvert : même tard, toutes les poules finissent par aller se coucher', () => {
    const s = newFarm(933);
    morning(s);
    s.money = 1e7;
    s.xp = 99999;
    const coop = buildingsOf(s, 'coop')[0];
    while (coop.level < 4) A.upgrade(s, coop.id);
    for (let i = 0; i < 30; i++) A.buyHen(s, 'rousse');
    run(s, 2 * HOUR);
    // il est déjà tard : elles sont éparpillées dans le pré, la trappe est restée ouverte
    const day = Math.floor(s.clock.t / TIME.DAY);
    s.clock.t = day * TIME.DAY + 23.5 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    expect(coop.closed).toBe(false);
    run(s, 1.5 * HOUR);
    expect(s.hens.filter((h) => h.act !== 'sleep').length).toBe(0);
  });
});

describe('Le personnel se répartit et ne se traverse pas', () => {
  const closeOf = (s: GameState) => {
    let min = Infinity;
    const on = s.workers.filter((w) => w.onSite);
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) min = Math.min(min, Math.hypot(on[i].x - on[j].x, on[i].z - on[j].z));
    return min;
  };
  /** Une ferme à 3 poulaillers et 3 commis. */
  const threeCoops = (seed: number) => {
    const s = newFarm(seed);
    s.settings.predators = false;
    s.money = 1e7;
    s.xp = 99999;
    let n = 0;
    for (let z = 0; z < 28 && n < 2; z++) for (let x = 0; x < 30 && n < 2; x++) if (canPlace(s, 'coop', x, z).ok && A.build(s, 'coop', x, z).ok) n++;
    expect(n).toBe(2);
    for (let i = 0; i < 12; i++) A.buyHen(s, 'rousse');
    for (let i = 0; i < 3; i++) expect(hire(s, 'farmhand').ok).toBe(true);
    return s;
  };

  it('une journée dure 4 minutes', () => {
    expect(TIME.DAY).toBe(240);
    expect(HOUR).toBe(10);
  });

  it('le matin, chaque commis va ouvrir son poulailler', () => {
    const s = threeCoops(951);
    // on saute à la nuit : tout est fermé, on observe l'arrivée de 4 h
    run(s, TIME.DAY * 1.9);
    for (const b of buildingsOf(s, 'coop')) b.closed = true;
    const day = Math.floor(s.clock.t / TIME.DAY);
    let opening = 0;
    let maxTargets = 0;
    while (Math.floor(s.clock.t / TIME.DAY) === day || s.clock.t % TIME.DAY < 9 * HOUR) {
      step(s, TIME.STEP);
      drainEvents(s);
      const targets = new Set(s.workers.filter((w) => w.job?.kind === 'openCoop').map((w) => w.job!.targetId));
      const jobs = s.workers.filter((w) => w.job?.kind === 'openCoop').length;
      // jamais deux commis sur le même poulailler
      expect(targets.size).toBe(jobs);
      maxTargets = Math.max(maxTargets, jobs);
      if (jobs) opening++;
    }
    // les trois poulaillers en même temps
    expect(maxTargets).toBe(3);
    expect(opening).toBeGreaterThan(0);
    for (const b of buildingsOf(s, 'coop')) expect(b.closed).toBe(false);
  });

  it('les commis ne se superposent jamais, même en arrivant', () => {
    const s = threeCoops(952);
    let min = Infinity;
    for (let t = 0; t < 2 * TIME.DAY; t += TIME.STEP) {
      step(s, TIME.STEP);
      drainEvents(s);
      min = Math.min(min, closeOf(s));
    }
    // l'écart voulu est de 0,6 m : un pas de simulation peut l'entamer un instant, jamais les confondre
    expect(min).toBeGreaterThan(0.45);
  });

  it('désœuvrés, ils ne restent pas tous au même endroit', () => {
    const s = threeCoops(953);
    morning(s);
    run(s, TIME.DAY);
    morning(s);
    run(s, 2 * HOUR);
    const places: string[] = [];
    let spread = 0;
    let n = 0;
    run(
      s,
      8 * HOUR,
      () => {
        const on = s.workers.filter((w) => w.onSite);
        for (const w of on) places.push(`${Math.floor(w.x / 6)},${Math.floor(w.z / 6)}`);
        let far = 0;
        for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) far = Math.max(far, Math.hypot(on[i].x - on[j].x, on[i].z - on[j].z));
        spread += far;
        n++;
      },
      HOUR / 2,
    );
    expect(new Set(places).size).toBeGreaterThan(4);
    expect(spread / n).toBeGreaterThan(4);
  });

  it('les vendeurs se tiennent côte à côte, chacun à sa place', () => {
    const s = newFarm(954);
    morning(s);
    s.money = 1e7;
    s.xp = 99999;
    for (let i = 0; i < 3; i++) expect(hire(s, 'seller').ok).toBe(true);
    run(s, 2 * HOUR);
    const sellers = s.workers.filter((w) => w.role === 'seller');
    expect(sellers.every((w) => w.job?.kind === 'stand' && w.job.phase === 'work')).toBe(true);
    expect(closeOf(s)).toBeGreaterThanOrEqual(0.6);
    // en rang, à la même hauteur, tous tournés du même côté
    expect(new Set(sellers.map((w) => w.z.toFixed(2))).size).toBe(1);
    expect(new Set(sellers.map((w) => w.heading.toFixed(2))).size).toBe(1);
    sellers.forEach((w) => {
      const [x, z] = sellerSpot(s, w);
      expect(Math.hypot(w.x - x, w.z - z)).toBeLessThan(0.05);
    });
    // l'un s'en va : les autres se resserrent
    const third = sellers[2];
    fire(s, sellers[0].id);
    run(s, HOUR);
    const [x0, z0] = sellerSpot(s);
    expect(Math.min(...s.workers.map((w) => Math.hypot(w.x - x0, w.z - z0)))).toBeLessThan(0.05);
    expect(third.job?.kind).toBe('stand');
  });

  it('une ancienne sauvegarde (journée de 180 s) reste au même jour et à la même heure', () => {
    const s = newFarm(955);
    morning(s);
    run(s, 2 * HOUR);
    const egg = s.worldEggs[0] ?? (s.worldEggs.push({ ...layEgg(s, s.hens[0], null) }), s.worldEggs[0]);
    const raw = JSON.parse(serialize(s));
    // comme si elle avait été écrite avant l'allongement des journées
    const k = 180 / TIME.DAY;
    raw.version = 9;
    raw.clock.t *= k;
    raw.lastPredatorT *= k;
    for (const e of raw.worldEggs) e.laidAt *= k;
    for (const b of raw.buildings) b.builtAt *= k;
    const back = deserialize(JSON.stringify(raw))!;
    expect(back.clock.t).toBeCloseTo(s.clock.t, 3);
    expect(currentDay(back)).toBe(currentDay(s));
    expect(back.worldEggs.find((e) => e.id === egg.id)!.laidAt).toBeCloseTo(egg.laidAt, 3);
    expect(back.clock.lastHourTick).toBe(s.clock.lastHourTick);
    // et une sauvegarde récente n'est pas étirée une seconde fois
    expect(deserialize(serialize(back))!.clock.t).toBeCloseTo(back.clock.t, 3);
  });
});

describe('Poussinière', () => {
  /** Ferme avec une poussinière posée à la première place libre (orientation au choix). */
  const nurseryFarm = (seed: number, rot = 0) => {
    const s = newFarm(seed);
    morning(s);
    s.money = 1e7;
    s.xp = 99999;
    s.settings.predators = false;
    // on repart de zéro, sans la poussinière offerte au départ
    for (const n of buildingsOf(s, 'nursery')) A.demolish(s, n.id);
    let ok = false;
    for (let z = -10; z < 28 && !ok; z++) for (let x = 0; x < 30 && !ok; x++) if (canPlace(s, 'nursery', x, z, -1, 1, rot).ok) ok = A.build(s, 'nursery', x, z, rot).ok;
    expect(ok).toBe(true);
    return { s, b: buildingsOf(s, 'nursery')[0] };
  };
  /** Un œuf fécondé mûr dans une couveuse : il éclot au pas suivant. */
  const hatch = (s: GameState, n: number) => {
    const inc = buildingsOf(s, 'incubator')[0] ?? (A.installIncubator(s), buildingsOf(s, 'incubator')[0]);
    inc.hatch = Array.from({ length: n }, () => ({ breed: 'rousse' as const, t: s.clock.t - BREEDING.incubationDays * TIME.DAY, ok: true }));
    inc.level = 3;
    step(s, TIME.STEP);
    drainEvents(s);
  };
  const raised = (s: GameState) => s.hens.filter((h) => h.nursery);
  /** Poussins dehors, dans le parc (position locale dans le rectangle, à un souffle près). */
  const inPark = (b: ReturnType<typeof buildingsOf>[number], h: GameState['hens'][number]) => {
    const { park } = nurseryPlan(b.level);
    const [x, z] = toLocal(b, h.x, h.z);
    return x >= park.x0 - 0.05 && x <= park.x1 + 0.05 && z >= park.z0 - 0.5 && z <= park.z1 + 0.05;
  };

  it('les poussins éclos arrivent à la poussinière et y vivent à part, dans leur parc', () => {
    const { s, b } = nurseryFarm(961);
    const before = s.hens.length;
    // les jeunes de la ferme de départ s'y sont installés dès la construction
    const base = nurseryCount(s, b);
    expect(base).toBe(s.hens.filter((h) => h.young && !readyToLeave(h)).length);
    hatch(s, 5);
    expect(s.hens.length).toBe(before + 5);
    expect(nurseryCount(s, b)).toBe(base + 5);
    const chicks = raised(s);
    for (const h of chicks) expect(h.coopId).toBe(b.id);
    // tout l'enclos est dans l'emprise : aucune poule adulte ne peut y mettre la patte
    const fp = footprint(b);
    let out = 0;
    let insideFp = 0;
    let awake = 0;
    run(
      s,
      8 * HOUR,
      () => {
        for (const h of s.hens) {
          if (h.nursery) {
            if (h.act === 'sleep') continue;
            awake++;
            if (h.act !== 'enter' && h.act !== 'exit' && !inPark(b, h)) out++;
          } else if (h.act !== 'exit' && h.x > fp.x && h.x < fp.x + fp.w && h.z > fp.z && h.z < fp.z + fp.d) insideFp++;
        }
      },
      0.5,
    );
    expect(awake).toBeGreaterThan(100);
    expect(out).toBe(0);
    expect(insideFp).toBe(0);
    // ils ne se sont pas enfuis ni n'ont quitté la poussinière
    expect(raised(s).length).toBe(base + 5);
    expect(chicks.every((h) => h.nursery)).toBe(true);
  });

  it('ils dorment au chaud la nuit, ressortent le matin, et mangent et boivent à la réserve', () => {
    const { s, b } = nurseryFarm(962);
    const base = nurseryCount(s, b);
    hatch(s, 6);
    s.grain = 400;
    s.water = 400;
    for (const h of raised(s)) {
      h.satiety = 20;
      h.hydration = 20;
    }
    const grain = s.grain;
    const water = s.water;
    run(s, 4 * HOUR);
    expect(s.grain).toBeLessThan(grain);
    expect(s.water).toBeLessThan(water);
    for (const h of raised(s)) {
      expect(h.satiety).toBeGreaterThan(30);
      expect(h.hydration).toBeGreaterThan(30);
    }
    // la nuit : tout le monde dedans
    const day = Math.floor(s.clock.t / TIME.DAY);
    s.clock.t = day * TIME.DAY + 19 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    run(s, 3.5 * HOUR);
    for (const h of raised(s)) expect(h.act).toBe('sleep');
    // au matin : dehors
    run(s, 10 * HOUR);
    expect(raised(s).filter((h) => h.act !== 'sleep').length).toBeGreaterThan(3);
    expect(nurseryCount(s, b)).toBe(base + 6);
  });

  it('presque adultes, ils passent le portillon et rejoignent le troupeau', () => {
    const { s, b } = nurseryFarm(963);
    hatch(s, 4);
    const chicks = raised(s);
    // la croissance va plus vite à la poussinière
    const y0 = chicks[0].young!;
    run(s, TIME.DAY);
    expect(y0 - chicks[0].young!).toBeGreaterThan(1.05);
    for (const h of chicks) h.young = BREEDING.nurseryLeaveDays + 0.002;
    morning(s);
    const events = runEvents(s, 6 * HOUR);
    expect(events.some((e) => e.kind === 'notify' && /quittent la poussinière/.test(e.text))).toBe(true);
    for (const h of chicks) {
      expect(h.nursery).toBeUndefined();
      expect(readyToLeave(h)).toBe(true);
      expect(buildingsOf(s, 'coop').some((c) => c.id === h.coopId)).toBe(true);
    }
    expect(nurseryCount(s, b)).toBe(0);
    // une fois sortis, ils vivent avec les autres, sur les cases praticables
    run(s, 2 * HOUR);
    for (const h of chicks) if (!['enter', 'exit', 'lay', 'sleep'].includes(h.act)) expect(isWalkable(s, h.x, h.z)).toBe(true);
  });

  it('pleine, elle laisse les suivants grandir avec les poules ; les jeunes déjà là s’y installent', () => {
    const { s, b } = nurseryFarm(964);
    const cap = BUILDINGS.nursery.levels[0].capacity;
    hatch(s, cap + 3);
    expect(nurseryCount(s, b)).toBe(cap);
    expect(s.hens.filter((h) => h.young && !h.nursery && !readyToLeave(h)).length).toBeGreaterThanOrEqual(3);
    expect(nurseryWithRoom(s)).toBeNull();
    // on l'agrandit : ceux qui couraient dehors entrent
    expect(A.upgrade(s, b.id).ok).toBe(true);
    expect(sizeOf('nursery', 2)).toEqual({ w: 10, d: 8 });
    expect(s.hens.filter((h) => h.young && !h.nursery && !readyToLeave(h)).length).toBe(0);
  });

  it('fonctionne dans les quatre orientations, et le portillon donne dehors', () => {
    for (const rot of [0, 1, 2, 3]) {
      const { s, b } = nurseryFarm(970 + rot, rot);
      expect(b.rot ?? 0).toBe(rot);
      hatch(s, 3);
      run(s, 3 * HOUR);
      let out = 0;
      run(s, 2 * HOUR, () => {
        for (const h of raised(s)) if (h.act !== 'sleep' && h.act !== 'enter' && h.act !== 'exit' && !inPark(b, h)) out++;
      }, 0.5);
      expect(out).toBe(0);
      for (const h of raised(s)) h.young = BREEDING.nurseryLeaveDays - 0.1;
      morning(s);
      run(s, 5 * HOUR);
      expect(raised(s).length).toBe(0);
      run(s, 1 * HOUR);
      for (const h of s.hens) if (!['enter', 'exit', 'lay', 'sleep'].includes(h.act)) expect(isWalkable(s, h.x, h.z)).toBe(true);
    }
  });

  it('on peut la déplacer, la pivoter ou la démonter sans perdre un poussin', () => {
    const { s, b } = nurseryFarm(975);
    hatch(s, 4);
    run(s, HOUR);
    expect(A.rotate(s, b.id).ok).toBe(true);
    run(s, HOUR);
    for (const h of raised(s)) if (h.act !== 'sleep' && h.act !== 'enter' && h.act !== 'exit') expect(inPark(b, h)).toBe(true);
    const n = s.hens.length;
    expect(A.demolish(s, b.id).ok).toBe(true);
    expect(s.hens.length).toBe(n);
    expect(raised(s).length).toBe(0);
    for (const h of s.hens) expect(s.buildings.some((c) => c.id === h.coopId)).toBe(true);
    run(s, HOUR);
    for (const h of s.hens) if (!['enter', 'exit', 'lay', 'sleep'].includes(h.act)) expect(isWalkable(s, h.x, h.z)).toBe(true);
  });

  it('le renard ne touche pas aux poussins de la poussinière', () => {
    const { s } = nurseryFarm(976);
    hatch(s, 3);
    expect(raised(s).every((h) => !catchable(h))).toBe(true);
  });

  it('la sauvegarde garde les poussins à la poussinière, et les oies à leur abri', () => {
    const { s, b } = nurseryFarm(977);
    hatch(s, 3);
    const count = raised(s).length;
    expect(count).toBeGreaterThanOrEqual(3);
    let built = false;
    for (let z = -10; z < 28 && !built; z++) for (let x = 0; x < 30 && !built; x++) if (canPlace(s, 'goosehouse', x, z).ok) built = A.build(s, 'goosehouse', x, z).ok;
    expect(built).toBe(true);
    const house = buildingsOf(s, 'goosehouse')[0];
    expect(A.buyHen(s, 'oie').ok).toBe(true);
    const goose = s.hens.find((h) => h.breed === 'oie')!;
    expect(goose.coopId).toBe(house.id);
    const back = deserialize(serialize(s))!;
    expect(back.hens.filter((h) => h.nursery).length).toBe(count);
    for (const h of back.hens.filter((x) => x.nursery)) expect(h.coopId).toBe(b.id);
    // (régression) une oie gardait son abri à oies seulement jusqu'au rechargement
    expect(back.hens.find((h) => h.id === goose.id)!.coopId).toBe(house.id);
    // la poussinière et son orientation reviennent aussi, et la vie reprend
    run(back, HOUR);
    expect(back.hens.filter((h) => h.nursery).length).toBe(count);
  });

  it('démontée, ses poussins rejoignent les poules et ses couveuses repartent, sans perdre un œuf', () => {
    const { s, b } = nurseryFarm(978);
    hatch(s, 2);
    expect(raised(s).length).toBeGreaterThanOrEqual(2);
    const inc = buildingsOf(s, 'incubator')[0];
    inc.auto = false;
    inc.hatch = [{ breed: 'rousse', t: s.clock.t, ok: true }];
    const money = s.money;
    expect(A.demolish(s, b.id).ok).toBe(true);
    expect(raised(s).length).toBe(0);
    expect(buildingsOf(s, 'incubator')).toHaveLength(0);
    expect(s.money).toBeGreaterThan(money);
    expect(fertileStock(s)).toBe(1);
  });

  it('enterNursery place le poussin à l’intérieur, invisible, avant qu’il ne sorte', () => {
    const { s, b } = nurseryFarm(979);
    const h = createHen(s, 'rousse', buildingsOf(s, 'coop')[0], false, { young: BREEDING.growthDays });
    s.hens.push(h);
    enterNursery(s, h, b);
    expect(h.act).toBe('sleep');
    const [x, z] = toLocal(b, h.x, h.z);
    expect(x).toBeCloseTo(nurseryPlan(1).inside[0], 6);
    expect(z).toBeCloseTo(nurseryPlan(1).inside[1], 6);
    run(s, 8);
    expect(h.act).not.toBe('sleep');
  });
});

describe('Magasin de la ferme', () => {
  const shopFarm = (seed: number) => {
    const s = newFarm(seed);
    morning(s);
    s.money = 1e7;
    s.xp = 99999;
    const st = s.buildings.find((b) => b.type === 'stand')!;
    while (st.level < 4) expect(A.upgrade(s, st.id).ok).toBe(true);
    return { s, st };
  };

  it('l’étal a un quatrième niveau : plus de clients, plus de guichets', () => {
    const { s, st } = shopFarm(981);
    expect(BUILDINGS.stand.levels.length).toBe(4);
    expect(st.level).toBe(4);
    expect(standCounters(s)).toBe(3);
    hire(s, 'seller');
    run(s, HOUR);
    expect(standCounters(s)).toBe(4);
    expect(BUILDINGS.stand.levels[3].flow!).toBeGreaterThan(BUILDINGS.stand.levels[2].flow!);
  });

  it('les clients viennent au long comptoir, devant le magasin, sans traverser ses murs', () => {
    const { s } = shopFarm(982);
    s.reputation = 100;
    addToStorage(s, 'roux', 'A', 90, 200);
    const lay = standLayout(4);
    let served = 0;
    let inWalls = 0;
    run(
      s,
      5 * HOUR,
      () => {
        for (const c of s.customers) {
          if (c.x > lay.center.x - 4.1 && c.x < lay.center.x + 4.1 && c.z < lay.stopZ - 0.05) inWalls++;
          if (c.state === 'shopping') {
            served++;
            expect(c.z).toBeCloseTo(lay.stopZ, 1);
            expect(Math.abs(c.x - lay.cx)).toBeLessThan(2.5);
          }
        }
      },
      0.25,
    );
    expect(served).toBeGreaterThan(0);
    expect(inWalls).toBe(0);
  });

  it('les vendeurs se tiennent côte à côte derrière le comptoir, et y arrivent par le côté', () => {
    const { s } = shopFarm(983);
    const lay = standLayout(4);
    for (let i = 0; i < 3; i++) expect(hire(s, 'seller').ok).toBe(true);
    let minZ = Infinity;
    run(s, 2 * HOUR, () => {
      for (const w of s.workers) if (w.x > 15.9 && w.x < 24.1) minZ = Math.min(minZ, w.z);
    }, 0.1);
    // jamais dans le bâtiment
    expect(minZ).toBeGreaterThan(34.0);
    const sellers = s.workers.filter((w) => w.role === 'seller');
    expect(sellers.every((w) => w.job?.kind === 'stand' && w.job.phase === 'work')).toBe(true);
    for (const w of sellers) expect(w.z).toBeCloseTo(lay.sellerZ, 1);
    const xs = sellers.map((w) => w.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(0.6);
    // fin de journée : ils repartent et reviennent le lendemain par le même chemin
    run(s, TIME.DAY);
    for (const w of s.workers) if (w.onSite && w.x > 15.9 && w.x < 24.1) expect(w.z).toBeGreaterThan(34.0);
  });

  it('la route a reculé : la place est dégagée et les camions livrent toujours', () => {
    expect(WORLD.WALK_Z - WORLD.ROAD_Z).toBeLessThan(0);
    // la place fait au moins 7 m entre la clôture et le trottoir
    expect(WORLD.WALK_Z - 0.6 - 30).toBeGreaterThanOrEqual(7);
    const s = newFarm(984);
    morning(s);
    s.money = 1e7;
    const n = s.hens.length;
    expect(A.buyHenPack(s, 'rousse', 6).ok).toBe(true);
    run(s, 6 * HOUR);
    expect(s.hens.length).toBe(n + 6);
  });
});

describe('Inscription et sauvegarde en ligne', () => {
  it('on reprend la sauvegarde en ligne seulement si elle est plus récente que celle de l’appareil', () => {
    const now = 1_800_000_000_000;
    expect(onlineIsNewer(now, now)).toBe(false);
    expect(onlineIsNewer(now - 60_000, now)).toBe(false);
    expect(onlineIsNewer(now + 60_000, now)).toBe(true);
    // à quelques secondes près (envoi en cours), on garde celle de l'appareil
    expect(onlineIsNewer(now + 3000, now)).toBe(false);
  });

  it('la sauvegarde contient tout pour reprendre ailleurs : orientation, trappe, poussinière', () => {
    const s = newFarm(991);
    const coop = buildingsOf(s, 'coop')[0];
    expect(A.rotate(s, coop.id).ok).toBe(true);
    coop.autoDoor = true;
    s.farmName = 'Ferme du Test';
    const back = deserialize(serialize(s))!;
    expect(back.farmName).toBe('Ferme du Test');
    expect(back.buildings.find((b) => b.id === coop.id)!.rot).toBe(1);
    expect(back.buildings.find((b) => b.id === coop.id)!.autoDoor).toBe(true);
    expect(back.savedAt).toBeGreaterThan(0);
  });
});

describe('Les oies se reproduisent : couveuse à oies, jars, oisons', () => {
  const farm = (seed: number) => {
    const s = newFarm(seed);
    s.xp = 99999;
    s.money = 50000000;
    morning(s);
    buildGooseHouse(s);
    return s;
  };
  const buildAnywhere = (s: GameState, type: 'gooseincubator' | 'nursery' | 'incubator') => {
    for (let z = -29; z < 29; z++) for (let x = 0; x < 80; x++) if (canPlace(s, type, x, z).ok && A.build(s, type, x, z).ok) return buildingsOf(s, type).at(-1)!;
    throw new Error(`impossible de poser ${type}`);
  };

  it('il faut le niveau 10, comme pour les oies', () => {
    const s = farm(801);
    expect(A.checkBuild(s, 'gooseincubator').ok).toBe(true);
    s.xp = 0;
    expect(A.checkBuild(s, 'gooseincubator').ok).toBe(false);
  });

  it('chacun sa couveuse : œufs d’oie d’un côté, œufs de poule de l’autre', () => {
    const s = farm(802);
    const goose = buildAnywhere(s, 'gooseincubator');
    const chick = buildingsOf(s, 'incubator')[0] ?? buildAnywhere(s, 'incubator');
    goose.auto = false;
    chick.auto = false;
    addToStorage(s, 'oie', 'A', 100, 3, 'oie');
    addToStorage(s, 'roux', 'A', 100, 2, 'rousse');
    expect(fertileStock(s, true)).toBe(3);
    expect(fertileStock(s, false)).toBe(2);
    expect(incubatable(s)).toBe(5);
    expect(loadIncubator(s, goose).count).toBe(3);
    expect(loadIncubator(s, chick).count).toBe(2);
    expect(goose.hatch!.every((e) => e.breed === 'oie')).toBe(true);
    expect(chick.hatch!.every((e) => e.breed === 'rousse')).toBe(true);
  });

  it('sans couveuse à oies, les œufs d’oie restent au stockage', () => {
    const s = farm(803);
    const chick = buildingsOf(s, 'incubator')[0] ?? buildAnywhere(s, 'incubator');
    addToStorage(s, 'oie', 'A', 100, 3, 'oie');
    expect(incubatable(s)).toBe(0);
    expect(incubateAll(s).ok).toBe(false);
    expect(chick.hatch?.length ?? 0).toBe(0);
    expect(fertileStock(s, true)).toBe(3);
  });

  it('le remplissage automatique envoie chaque œuf dans la bonne couveuse', () => {
    const s = farm(804);
    const goose = buildAnywhere(s, 'gooseincubator');
    addToStorage(s, 'oie', 'A', 100, 2, 'oie');
    step(s, TIME.STEP);
    expect(goose.hatch!.length).toBe(2);
    expect(fertileStock(s, true)).toBe(0);
  });

  it('à l’éclosion, l’oison sort et vit avec les oies, jamais à la poussinière', () => {
    const s = farm(805);
    const house = buildingsOf(s, 'goosehouse')[0];
    const nursery = buildingsOf(s, 'nursery')[0] ?? buildAnywhere(s, 'nursery');
    const inc = buildAnywhere(s, 'gooseincubator');
    expect(nurseryWithRoom(s)?.id).toBe(nursery.id);
    inc.hatch = [
      { breed: 'oie', t: s.clock.t - BREEDING.incubationDays * TIME.DAY, ok: true },
      { breed: 'oie', t: s.clock.t - BREEDING.incubationDays * TIME.DAY, ok: true },
    ];
    const before = s.hens.length;
    step(s, TIME.STEP);
    const born = s.hens.slice(before);
    expect(born.length).toBe(2);
    for (const g of born) {
      expect(g.breed).toBe('oie');
      expect(g.young).toBeGreaterThan(0);
      expect(g.nursery).toBeFalsy();
      expect(g.coopId).toBe(house.id);
      expect(isWalkable(s, g.x, g.z)).toBe(true);
    }
    // une poussinière construite plus tard ne les adopte pas non plus
    buildAnywhere(s, 'nursery');
    expect(s.hens.some((h) => h.nursery && h.breed === 'oie')).toBe(false);
  });

  it('les œufs de poule continuent d’aller à la poussinière', () => {
    const s = farm(806);
    const nursery = buildingsOf(s, 'nursery')[0] ?? buildAnywhere(s, 'nursery');
    const inc = buildingsOf(s, 'incubator')[0] ?? buildAnywhere(s, 'incubator');
    const had = nurseryCount(s, nursery);
    inc.hatch = [{ breed: 'rousse', t: s.clock.t - BREEDING.incubationDays * TIME.DAY, ok: true }];
    step(s, TIME.STEP);
    expect(nurseryCount(s, nursery)).toBe(had + 1);
  });

  it('une ancienne partie : l’oison resté à la poussinière rejoint les oies au rechargement', () => {
    const s = farm(807);
    const house = buildingsOf(s, 'goosehouse')[0];
    const nursery = buildAnywhere(s, 'nursery');
    const g = createHen(s, 'oie', house, false, { young: 12 });
    s.hens.push(g);
    g.nursery = true;
    g.coopId = nursery.id;
    const back = deserialize(serialize(s))!;
    const again = back.hens.find((h) => h.id === g.id)!;
    expect(again.nursery).toBeFalsy();
    expect(again.coopId).toBe(house.id);
  });

  it('le jars féconde les oies sans compter les poules, et le coq l’inverse', () => {
    const s = farm(808);
    s.hens = s.hens.filter((h) => !h.rooster);
    expect(fertility(s, true)).toBe(0);
    const house = buildingsOf(s, 'goosehouse')[0];
    for (let i = 0; i < 4; i++) s.hens.push(createHen(s, 'oie', house));
    s.hens.push(createHen(s, 'oie', house, false, { rooster: true }));
    expect(dadCount(s, true)).toBe(1);
    expect(fertility(s, true)).toBeCloseTo(BREEDING.maxFertility);
    // les poules n'ont toujours pas de coq : leurs œufs ne sont pas fécondés
    expect(fertility(s, false)).toBe(0);
    // un œuf d'oie fécondé donne un oison
    const goose = s.hens.find((h) => h.breed === 'oie' && !h.rooster)!;
    let chick: ReturnType<typeof fertilize>;
    for (let i = 0; i < 200 && !chick; i++) chick = fertilize(s, goose);
    expect(chick?.breed).toBe('oie');
  });

  it('la couveuse à oies se sauvegarde avec ses œufs', () => {
    const s = farm(809);
    const inc = buildAnywhere(s, 'gooseincubator');
    addToStorage(s, 'oie', 'A', 100, 2, 'oie');
    expect(loadIncubator(s, inc).count).toBe(2);
    const back = deserialize(serialize(s))!;
    expect(buildingsOf(back, 'gooseincubator')[0].hatch!.length).toBe(2);
  });
});

describe('La poule légendaire', () => {
  const farm = (seed: number) => {
    const s = newFarm(seed);
    morning(s);
    return s;
  };

  it('est dix fois plus rare que la poule aux œufs d’or', () => {
    expect(RARE.legendaryHenHatch).toBeCloseTo(RARE.goldenHenHatch / 10);
    const s = farm(901);
    const coop = buildingsOf(s, 'coop')[0];
    let legend = 0;
    let gold = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const h = createHen(s, 'rousse', coop, false, { young: 10 });
      if (h.legendary) legend++;
      if (h.golden) gold++;
      expect(h.legendary && h.golden).toBeFalsy();
    }
    drainEvents(s);
    expect(gold).toBeGreaterThan(n * RARE.goldenHenHatch * 0.8);
    expect(gold).toBeLessThan(n * RARE.goldenHenHatch * 1.2);
    expect(legend).toBeGreaterThan(n * RARE.legendaryHenHatch * 0.55);
    expect(legend).toBeLessThan(n * RARE.legendaryHenHatch * 1.5);
    // jamais à l'achat, ni chez les coqs, ni chez les oies
    for (let i = 0; i < 3000; i++) {
      expect(createHen(s, 'rousse', coop).legendary).toBeFalsy();
      expect(createHen(s, 'rousse', coop, false, { young: 10, rooster: true }).legendary).toBeFalsy();
      expect(createHen(s, 'oie', coop, false, { young: 10 }).legendary).toBeFalsy();
    }
    drainEvents(s);
  });

  it('pond des œufs de phénix que le collectionneur achète aussitôt, même stockage plein', () => {
    const s = farm(902);
    const coop = buildingsOf(s, 'coop')[0];
    const h = createHen(s, 'rousse', coop, false, { legendary: true });
    s.hens.push(h);
    expect(baseLaying(h)).toBe(RARE.phoenixEggsPerDay);
    addToStorage(s, 'roux', 'A', 100, storageCapacity(s));
    expect(storageFree(s)).toBe(0);
    const egg = layEgg(s, h, null);
    expect(egg.type).toBe('phenix');
    expect(egg.fertile).toBeUndefined();
    const m = s.money;
    const stored = storedCount(s);
    expect(A.collectGroundEgg(s, egg.id).ok).toBe(true);
    expect(s.money - m).toBe(RARE.phoenixEggPrice);
    expect(storedCount(s)).toBe(stored);
    expect(s.stats.phoenixEggs).toBe(1);
  });

  it('son œuf ne pourrit pas, et ne se perd pas au rechargement', () => {
    const s = farm(903);
    const coop = buildingsOf(s, 'coop')[0];
    const h = createHen(s, 'rousse', coop, false, { legendary: true });
    s.hens.push(h);
    const egg = layEgg(s, h, null);
    const gold = layEgg(s, createHen(s, 'rousse', coop, false, { golden: true }), null);
    const back = deserialize(serialize(s))!;
    expect(back.hens.find((x) => x.id === h.id)?.legendary).toBe(true);
    expect(back.worldEggs.find((e) => e.id === egg.id)?.type).toBe('phenix');
    expect(back.worldEggs.find((e) => e.id === gold.id)?.type).toBe('or');
    egg.laidAt = s.clock.t - 40 * TIME.DAY;
    ageEggs(s, 40);
    expect(s.worldEggs.includes(egg)).toBe(true);
  });

  it('renaît de ses cendres au lieu de mourir', () => {
    const s = farm(904);
    const coop = buildingsOf(s, 'coop')[0];
    const h = createHen(s, 'rousse', coop, false, { legendary: true });
    s.hens.push(h);
    s.grain = 0;
    s.water = 0;
    h.health = 0.01;
    h.satiety = 0;
    h.hydration = 0;
    h.sick = true;
    const events = runEvents(s, 5);
    expect(s.hens.includes(h)).toBe(true);
    expect(h.health).toBeGreaterThan(90);
    expect(h.sick).toBe(false);
    expect(events.some((e) => e.kind === 'phoenix' && e.big)).toBe(true);
    expect(s.stats.hensDied).toBe(0);
  });

  it('aucun prédateur ne peut l’attraper, et elle ne tombe pas malade', () => {
    const s = farm(905);
    const coop = buildingsOf(s, 'coop')[0];
    const h = createHen(s, 'rousse', coop, false, { legendary: true });
    s.hens.push(h);
    expect(catchable(h)).toBe(false);
    coop.cleanliness = 0;
    h.wellbeing = 10;
    for (let d = 2; d < 80; d++) {
      closeDay(s, d);
      expect(h.sick).toBeFalsy();
      coop.cleanliness = 0;
    }
  });

  it('elle ne vieillit pas et son aura apaise tout le troupeau', () => {
    const s = farm(906);
    const coop = buildingsOf(s, 'coop')[0];
    const other = createHen(s, 'rousse', coop);
    s.hens.push(other);
    refreshVitals(s);
    const without = wellbeingTarget(s, other);
    const h = createHen(s, 'rousse', coop, false, { legendary: true });
    s.hens.push(h);
    refreshVitals(s);
    const target = wellbeingTarget(s, other);
    expect(target).toBeGreaterThan(without);
    expect(target - without).toBeLessThanOrEqual(RARE.phoenixWellbeing);
    h.age = 2000;
    other.age = 2000;
    expect(productivity(h)).toBeGreaterThan(productivity(other));
    // la poule la plus chère de la ferme
    const gold = createHen(s, 'rousse', coop, false, { golden: true });
    expect(henValue(h)).toBeGreaterThan(henValue(gold));
    drainEvents(s);
  });
});

describe('Longue vie d’un troupeau d’oies', () => {
  it('jars, couveuse à oies : les oisons naissent, grandissent et restent près de chez eux', () => {
    const s = newFarm(990);
    morning(s);
    s.xp = 99999;
    s.money = 1e9;
    s.settings.predators = false;
    expect(buildGooseHouse(s)).toBe(true);
    const house = buildingsOf(s, 'goosehouse')[0];
    A.upgrade(s, house.id);
    for (let i = 0; i < 6; i++) expect(A.buyHen(s, 'oie').ok).toBe(true);
    expect(A.buyRooster(s, 'oie').ok).toBe(true);
    let placed = false;
    for (let z = -29; z < 29 && !placed; z++) for (let x = 0; x < 80 && !placed; x++) if (canPlace(s, 'gooseincubator', x, z).ok) placed = A.build(s, 'gooseincubator', x, z).ok;
    expect(placed).toBe(true);
    for (let z = -29; z < 29 && !buildingsOf(s, 'nursery').length; z++) for (let x = 0; x < 80 && !buildingsOf(s, 'nursery').length; x++) if (canPlace(s, 'nursery', x, z).ok) A.build(s, 'nursery', x, z);
    const geese = () => s.hens.filter((h) => h.breed === 'oie');
    const start = geese().length;
    let hatchedGoslings = 0;
    const seen = new Set<number>();
    for (let day = 0; day < 55; day++) {
      s.grain = 2000;
      s.water = 2000;
      A.refillAll(s);
      A.collectAll(s);
      for (let t = 0; t < TIME.DAY; t += TIME.STEP) step(s, TIME.STEP);
      drainEvents(s);
      for (const g of geese()) {
        expect(g.nursery).toBeFalsy();
        expect(g.coopId).toBe(house.id);
        if (g.young && !seen.has(g.id)) {
          seen.add(g.id);
          hatchedGoslings++;
        }
      }
    }
    expect(hatchedGoslings).toBeGreaterThan(0);
    expect(geese().length).toBeGreaterThan(start);
    // certains sont déjà devenus adultes, et ils peuvent être jars ou oies
    expect(geese().some((g) => !g.young && g.dayBought > 1)).toBe(true);
    const door = coopDoor(house);
    const far = geese().filter((g) => Math.hypot(g.x - door.x, g.z - door.z) > 22);
    expect(far.length).toBe(0);
  }, 120000);
});

/** Achète de quoi rejoindre la parcelle du bout du chemin de terre, où le camion entre. */
function ownTruckParcel(s: GameState) {
  for (const k of ['1,2', '2,2', BIRD_ORDERS.parcel]) if (!s.parcels.includes(k)) s.parcels.push(k);
  autoEnclose(s);
}

describe('Vente de poules pondeuses', () => {
  const farm = (seed: number) => {
    const s = newFarm(seed);
    morning(s);
    s.money = 10_000_000;
    s.xp = 99999;
    s.settings.predators = false;
    ownTruckParcel(s);
    return s;
  };
  /** Ajoute des volailles adultes à la ferme. */
  const flock = (s: GameState, breed: 'rousse' | 'marans' | 'oie', n: number, rooster = false) => {
    const coop = buildingsOf(s, breed === 'oie' ? 'goosehouse' : 'coop')[0] ?? buildingsOf(s, 'coop')[0];
    for (let i = 0; i < n; i++) s.hens.push(createHen(s, breed, coop, false, { rooster, at: [coop.x + 1, coop.z + 5] }));
  };
  const open = (s: GameState) => {
    expect(A.openPetShop(s).ok).toBe(true);
    return petShopOf(s)!;
  };

  it('elle reste à sa place à droite du parking, même au rechargement d’une ancienne partie', () => {
    const s = farm(1513);
    const b = open(s);
    // les trois places du parking s'arrêtent à x = 41,8 ; le dallage de la boutique commence juste après
    expect(PET_POS.x).toBeGreaterThan(41.8);
    // les parcs ne mordent ni sur le trottoir ni sur la clôture de la ferme, jusqu'au dernier niveau
    for (let lv = 1; lv <= BUILDINGS.petshop.levels.length; lv++) {
      const L = petLayout(lv);
      expect(PET_POS.z).toBeGreaterThan(WORLD.Z0 + WORLD.ROWS * WORLD.PARCEL);
      expect(PET_POS.z + 6.7).toBeLessThanOrEqual(WORLD.WALK_Z - 0.6 + 1e-9);
      expect(L.hens.x0).toBeGreaterThan(L.bw);
      expect(L.geese.x0).toBeGreaterThan(L.hens.x1);
    }
    // une partie sauvegardée quand elle était à côté de l'étal
    const raw = JSON.parse(serialize(s));
    const old = raw.buildings.find((x: { id: number }) => x.id === b.id);
    old.x = 6;
    old.z = 34;
    const back = petShopOf(deserialize(JSON.stringify(raw))!)!;
    expect([back.x, back.z]).toEqual([PET_POS.x, PET_POS.z]);
  });

  it('ne s’ouvre qu’une fois, à droite du parking, sans prendre de case à la ferme', () => {
    const s = farm(1501);
    invalidateLayout(s);
    const walk = rt(s).walk.reduce((a: number, v: number) => a + v, 0);
    const b = open(s);
    invalidateLayout(s);
    expect(rt(s).walk.reduce((a: number, v: number) => a + v, 0)).toBe(walk);
    expect([b.x, b.z]).toEqual([PET_POS.x, PET_POS.z]);
    expect(A.openPetShop(s).ok).toBe(false);
  });

  it('le prix conseillé est la moitié du prix d’achat, et le joueur le change comme il veut', () => {
    const s = farm(1502);
    expect(suggestedPrice('rousse')).toBe(Math.round(BREEDS.rousse.price / 2));
    expect(petPrice(s, 'rousse')).toBe(suggestedPrice('rousse'));
    setPetPrice(s, 'rousse', 1000);
    expect(petPrice(s, 'rousse')).toBe(1000);
    // bornes : ni donné, ni hors de prix
    setPetPrice(s, 'rousse', 1);
    expect(petPrice(s, 'rousse')).toBe(priceBounds('rousse')[0]);
    setPetPrice(s, 'rousse', 1e7);
    expect(petPrice(s, 'rousse')).toBe(priceBounds('rousse')[1]);
    // plus c'est cher, moins les clients acceptent
    expect(petBuyChance(s, 'rousse', 400)).toBeGreaterThan(petBuyChance(s, 'rousse', 1200));
  });

  it('une volaille en vitrine quitte le troupeau, et on peut la reprendre', () => {
    const s = farm(1503);
    open(s);
    flock(s, 'rousse', 6);
    const before = s.hens.length;
    const r = stockBirds(s, 'rousse', 4);
    expect(r.count).toBe(4);
    expect(s.hens.length).toBe(before - 4);
    expect(stockOf(s, 'rousse')).toHaveLength(4);
    expect(unstockBirds(s, 'rousse', 2).count).toBe(2);
    expect(stockOf(s, 'rousse')).toHaveLength(2);
    expect(s.hens.length).toBe(before - 2);
    // elles reviennent par le portail, sur une case praticable
    const back = s.hens.at(-1)!;
    expect(isWalkable(s, back.x, back.z)).toBe(true);
  });

  it('coqs et jars vont en vente, mais ni les jeunes ni les trésors de la ferme', () => {
    const s = farm(1504);
    open(s);
    buildGooseHouse(s);
    flock(s, 'rousse', 1, true);
    flock(s, 'oie', 1, true);
    const coq = s.hens.at(-2)!;
    const jars = s.hens.at(-1)!;
    expect(stockBird(s, coq.id).ok).toBe(true);
    expect(stockBird(s, jars.id).ok).toBe(true);
    const chick = s.hens.find((h) => h.young)!;
    expect(stockBird(s, chick.id).ok).toBe(false);
    flock(s, 'rousse', 1);
    const gold = s.hens.at(-1)!;
    gold.golden = true;
    expect(stockBird(s, gold.id).ok).toBe(false);
  });

  it('les oies et les poules se comptent et se vendent à part', () => {
    const s = farm(1505);
    open(s);
    buildGooseHouse(s);
    flock(s, 'oie', 3);
    flock(s, 'rousse', 3);
    expect(stockBirds(s, 'oie', 10).count).toBe(3);
    expect(stockOfKind(s, true)).toHaveLength(3);
    expect(stockOfKind(s, false)).toHaveLength(0);
    expect(birdWord(true, 2)).toBe('oies');
    expect(birdWord(false, 1)).toBe('poule');
    // une oie vaut son prix d'oie
    expect(petPrice(s, 'oie')).toBe(suggestedPrice('oie'));
    expect(suggestedPrice('oie')).toBeGreaterThan(suggestedPrice('rousse'));
  });

  it('la vitrine a une capacité, et s’agrandit avec le niveau', () => {
    const s = farm(1506);
    const b = open(s);
    flock(s, 'rousse', 40);
    expect(stockBirds(s, 'rousse', 40).count).toBe(lvl(b).capacity);
    expect(stockBirds(s, 'rousse', 1).ok).toBe(false);
    expect(A.upgrade(s, b.id).ok).toBe(true);
    expect(stockBirds(s, 'rousse', 40).count).toBeGreaterThan(0);
    expect(s.petShop.birds.length).toBe(lvl(b).capacity);
  });

  it('les clients viennent avec leur carton, achètent plusieurs volailles et paient le prix fixé', () => {
    const s = farm(1507);
    open(s);
    hirePetSeller(s);
    flock(s, 'rousse', 12);
    stockBirds(s, 'rousse', 12);
    setPetPrice(s, 'rousse', 500);
    const money = s.money;
    const sold = s.stats.hensSold;
    let most = 0;
    run(s, 6 * HOUR, () => {
      most = Math.max(most, ...s.petCustomers.map((c) => c.bought));
    });
    const n = 12 - s.petShop.birds.length;
    expect(n).toBeGreaterThan(0);
    expect(s.stats.hensSold - sold).toBe(n);
    expect(most).toBeGreaterThan(1);
    expect(today(s).income.animalerie).toBe(n * 500);
    expect(s.money).toBeGreaterThan(money - 2000);
  });

  it('trop cher, personne n’achète ; vitrine vide, personne ne se déplace', () => {
    const s = farm(1508);
    open(s);
    run(s, 4 * HOUR);
    expect(s.petCustomers).toHaveLength(0);
    flock(s, 'rousse', 6);
    stockBirds(s, 'rousse', 6);
    setPetPrice(s, 'rousse', priceBounds('rousse')[1]);
    run(s, 6 * HOUR);
    // à 1,5 × le prix d'achat, plus personne ou presque
    expect(s.petShop.birds.length).toBeGreaterThanOrEqual(5);
  });

  it('elle ferme la nuit', () => {
    const s = farm(1509);
    open(s);
    flock(s, 'rousse', 10);
    stockBirds(s, 'rousse', 10);
    s.clock.t = Math.floor(s.clock.t / TIME.DAY) * TIME.DAY + 22 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    s.petCustomers = [];
    run(s, 3 * HOUR, () => expect(s.petCustomers).toHaveLength(0));
  });

  it('la sauvegarde garde la vitrine et les prix', () => {
    const s = farm(1510);
    open(s);
    flock(s, 'marans', 3);
    const ids = flockOf(s, 'marans').slice(0, 2).map((h) => h.id);
    stockBirds(s, 'marans', 2);
    setPetPrice(s, 'marans', 7000);
    hirePetSeller(s);
    togglePetRestock(s);
    setPetKeep(s, 12);
    const back = deserialize(serialize(s))!;
    expect(back.petShop.birds.map((h) => h.id).sort()).toEqual(ids.sort());
    expect(petPrice(back, 'marans')).toBe(7000);
    expect(back.petShop.seller).toBe(true);
    expect(back.petShop.restock).toBe(true);
    expect(petKeep(back)).toBe(12);
    // aucun identifiant réutilisé par la suite
    expect(back.nextId).toBeGreaterThan(Math.max(...back.petShop.birds.map((h) => h.id)));
  });

  it('elle n’est pas dans la boutique : on la construit sur son emplacement, au niveau 15', () => {
    expect(BUILD_ORDER).not.toContain('petshop');
    const s = newFarm(1514);
    s.money = 1e8;
    ownTruckParcel(s);
    while (farmLevel(s) < 14) s.xp += 500;
    expect(A.openPetShop(s).ok).toBe(false);
    while (farmLevel(s) < 15) s.xp += 500;
    expect(A.openPetShop(s).ok).toBe(true);
    expect(petShopOf(s)!.level).toBe(1);
    expect(BUILDINGS.petshop.levels.length).toBeGreaterThanOrEqual(5);
    const caps = BUILDINGS.petshop.levels.map((l) => l.capacity!);
    expect(caps).toEqual([...caps].sort((x, y) => x - y));
    expect(petShopOf(s)).toBeTruthy();
    expect(A.upgrade(s, petShopOf(s)!.id).ok).toBe(true);
    expect(lvl(petShopOf(s)!).capacity).toBe(caps[1]);
  });

  it('sans la parcelle du bas à droite, pas de vente de poules : le chemin de terre y arrive', () => {
    const s = newFarm(1519);
    s.money = 1e8;
    s.xp = 99999;
    expect(farmLevel(s)).toBeGreaterThanOrEqual(BIRD_ORDERS.reqLevel);
    expect(A.checkBuild(s, 'petshop').reason).toMatch(/parcelle D3/);
    expect(A.openPetShop(s).ok).toBe(false);
    expect(truckParcelOwned(s)).toBe(false);
    expect(birdOrdersOpen(s)).toBe(false);
    for (let i = 0; i < 20; i++) generateBirdOrders(s);
    expect(s.birdOrders).toHaveLength(0);
    // c'est bien la parcelle du bas, tout à droite
    expect(BIRD_ORDERS.parcel).toBe(`${WORLD.COLS - 1},${WORLD.ROWS - 1}`);
    ownTruckParcel(s);
    expect(A.openPetShop(s).ok).toBe(true);
    expect(birdOrdersOpen(s)).toBe(true);
  });

  it('on explique une seule fois comment vendre ses poules', () => {
    const s = farm(1515);
    drainEvents(s);
    birdOrdersNewDay(s);
    birdOrdersNewDay(s);
    const said = drainEvents(s).filter((e) => e.kind === 'notify' && /vente de poules/i.test(e.text));
    expect(said).toHaveLength(1);
  });

  it('une volaille reprise dans son parc revient à la ferme, à sa place', () => {
    const s = farm(1516);
    open(s);
    flock(s, 'rousse', 3);
    const n = s.hens.length;
    const h = stockOf(s, 'rousse').length ? stockOf(s, 'rousse')[0] : (stockBirds(s, 'rousse', 1), s.petShop.birds[0]);
    expect(s.hens).toHaveLength(n - 1);
    expect(unstockBird(s, h.id).ok).toBe(true);
    expect(s.hens).toHaveLength(n);
    expect(s.hens).toContain(h);
    expect(s.petShop.birds).not.toContain(h);
    expect(unstockBird(s, h.id).ok).toBe(false);
  });

  it('le vendeur coûte 15 € par jour et amène du monde', () => {
    const s = farm(1517);
    open(s);
    const flow = petCustomersPerDay(s);
    const wages = dailyWages(s);
    expect(hirePetSeller(s).ok).toBe(true);
    expect(hirePetSeller(s).ok).toBe(false);
    expect(dailyWages(s) - wages).toBe(1500);
    expect(petCustomersPerDay(s)).toBeGreaterThan(flow);
    firePetSeller(s);
    expect(dailyWages(s)).toBe(wages);
    expect(s.petShop.seller).toBeUndefined();
  });

  it('il ne remet des volailles que si c’est coché, jamais de rares, toujours les moins bonnes', () => {
    const s = farm(1518);
    open(s);
    A.upgrade(s, petShopOf(s)!.id);
    s.hens = s.hens.filter((h) => h.rooster || h.young);
    flock(s, 'rousse', 12);
    const list = s.hens.filter((h) => sellable(h));
    list.forEach((h, i) => (h.genes = { p: 1 + (i % 3), r: 1, b: 1 }));
    const rare = list[0];
    rare.genes = { p: 5, r: 3, b: 2 };
    const golden = list[1];
    golden.golden = true;
    setPetKeep(s, 2);
    // sans vendeur, ou sans la case cochée : rien
    petShopHourly(s);
    expect(s.petShop.birds).toHaveLength(0);
    hirePetSeller(s);
    petShopHourly(s);
    expect(s.petShop.birds).toHaveLength(0);
    togglePetRestock(s);
    expect(s.petShop.birds.length).toBeGreaterThan(0);
    expect(s.petShop.birds.length).toBeLessThanOrEqual(PETSHOP.sellerPerHour);
    for (const h of s.petShop.birds) expect(isRareBird(h)).toBe(false);
    expect(s.hens).toContain(rare);
    expect(s.hens).toContain(golden);
    // les premières sorties sont les moins performantes
    const out = Math.max(...s.petShop.birds.map((h) => h.genes!.p));
    const stay = Math.min(...s.hens.filter((h) => sellable(h) && !isRareBird(h)).map((h) => h.genes!.p));
    expect(out).toBeLessThanOrEqual(stay);
    // il laisse à la ferme ce qu'on lui a demandé
    for (let i = 0; i < 10; i++) petShopHourly(s);
    expect(s.hens.filter((h) => !h.young && !h.rooster).length).toBeGreaterThanOrEqual(2);
  });

  it('démontable seulement une fois vidée', () => {
    const s = farm(1512);
    const b = open(s);
    flock(s, 'rousse', 2);
    stockBirds(s, 'rousse', 2);
    expect(A.demolish(s, b.id).ok).toBe(false);
    unstockBirds(s, 'rousse', 2);
    expect(A.demolish(s, b.id).ok).toBe(true);
    expect(petShopOf(s)).toBeUndefined();
  });
});

describe('Commandes de revendeurs et camion', () => {
  const farm = (seed: number, level = 16) => {
    const s = newFarm(seed);
    morning(s);
    s.money = 10_000_000;
    s.settings.predators = false;
    while (farmLevel(s) < level) s.xp += 1000;
    ownTruckParcel(s);
    // la boutique au grand complet : le camion ne prend que ce qui y est en vente
    if (level >= BIRD_ORDERS.reqLevel) {
      expect(A.openPetShop(s).ok).toBe(true);
      while (A.upgrade(s, petShopOf(s)!.id).ok);
    }
    return s;
  };
  /** Des volailles à la ferme, puis (sauf demande contraire) en vente dans les parcs. */
  const flock = (s: GameState, breed: 'rousse' | 'marans' | 'oie', n: number, sell = true) => {
    const coop = buildingsOf(s, breed === 'oie' ? 'goosehouse' : 'coop')[0] ?? buildingsOf(s, 'coop')[0];
    for (let i = 0; i < n; i++) s.hens.push(createHen(s, breed, coop, false, { at: [coop.x + 1 + (i % 4), coop.z + 5] }));
    if (sell) expect(stockBirds(s, breed, n).ok).toBe(true);
  };
  const order = (s: GameState, o: Partial<import('../src/sim/types').BirdOrder> = {}) => {
    const b: import('../src/sim/types').BirdOrder = { id: 900000 + s.birdOrders.length, client: 'Volailles du Val', goose: false, count: 6, unitPrice: 700, deadlineDay: currentDay(s) + 3, offerUntilDay: currentDay(s) + 2, status: 'active', ...o };
    s.birdOrders.push(b);
    return b;
  };

  it('il faut le niveau 15, même sans déblocages', () => {
    const low = farm(1601, 14);
    generateBirdOrders(low);
    expect(low.birdOrders).toHaveLength(0);
    const s = farm(1602);
    expect(farmLevel(s)).toBeGreaterThanOrEqual(BIRD_ORDERS.reqLevel);
    for (let i = 0; i < 40 && !s.birdOrders.length; i++) generateBirdOrders(s);
    expect(s.birdOrders.length).toBeGreaterThan(0);
    for (const o of s.birdOrders) {
      expect(o.status).toBe('offer');
      expect(o.count).toBeGreaterThan(0);
      expect(o.client.length).toBeGreaterThan(0);
    }
  });

  it('pas de commande d’oies tant que la ferme n’en élève pas', () => {
    const s = farm(1603);
    for (let i = 0; i < 80; i++) {
      s.birdOrders = [];
      generateBirdOrders(s);
      for (const o of s.birdOrders) expect(o.goose).toBe(false);
    }
  });

  it('il faut un commis de ferme et assez de volailles pour appeler le camion', () => {
    const s = farm(1604);
    const o = order(s);
    expect(checkCallTruck(s, o).reason).toMatch(/commis/);
    hire(s, 'farmhand');
    // des poules à la ferme ne suffisent pas : il les faut en vente
    flock(s, 'rousse', 6, false);
    expect(checkCallTruck(s, o).reason).toMatch(/en vente/);
    stockBirds(s, 'rousse', 6);
    expect(checkCallTruck(s, o).ok).toBe(true);
    expect(callTruck(s, o.id).ok).toBe(true);
    // un autre camion peut être appelé aussi, mais pas pour des volailles déjà promises au premier
    const other = order(s);
    expect(checkCallTruck(s, other).reason).toMatch(/Pas assez/);
  });

  it('le camion vient, le commis charge, les volailles partent et le paiement tombe', () => {
    const s = farm(1605);
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'rousse', 10);
    const o = order(s, { count: 6, unitPrice: 700 });
    const money = s.money;
    const farmHens = s.hens.length;
    expect(callTruck(s, o.id).ok).toBe(true);
    expect(o.status).toBe('loading');
    let helped = false;
    let went = false;
    for (let i = 0; i < 1200 && s.birdLoad; i++) {
      run(s, 0.1);
      if (s.workers.some((w) => w.job?.kind === 'loadTruck' && w.job.phase === 'work')) helped = true;
      if (s.petShop.birds.some((h) => h.ship)) went = true;
    }
    expect(went).toBe(true);
    expect(helped).toBe(true);
    expect(s.birdLoad).toBeNull();
    expect(s.birdOrders.find((x) => x.id === o.id)).toBeUndefined();
    // seules celles qui étaient en vente sont parties : le troupeau de la ferme n'a pas bougé
    expect(s.hens.length).toBe(farmHens);
    expect(s.petShop.birds).toHaveLength(4);
    expect(s.petShop.birds.some((h) => h.ship)).toBe(false);
    expect(s.stats.birdOrdersDone).toBe(1);
    expect(s.stats.birdsSoldDealers).toBe(6);
    expect(s.money).toBeGreaterThan(money);
    expect(today(s).income.animalerie).toBeGreaterThanOrEqual(6 * 700);
    // le commis est rentré par le portail et reprend son travail
    run(s, 2 * HOUR);
    for (const w of s.workers) expect(w.job?.kind).not.toBe('loadTruck');
  });

  it('une commande d’oies n’emporte que des oies', () => {
    const s = farm(1606);
    buildGooseHouse(s);
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'oie', 4);
    flock(s, 'rousse', 6);
    const o = order(s, { goose: true, count: 3, unitPrice: 4000 });
    expect(orderLabel(o)).toBe('3 oies');
    expect(callTruck(s, o.id).ok).toBe(true);
    run(s, 16 * HOUR);
    expect(s.birdLoad).toBeNull();
    expect(s.petShop.birds.filter((h) => !isGoose(h.breed))).toHaveLength(6);
    expect(s.petShop.birds.filter((h) => isGoose(h.breed))).toHaveLength(1);
  });

  it('une commande d’une race précise n’emporte que cette race', () => {
    const s = farm(1607);
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'marans', 3);
    flock(s, 'rousse', 5);
    const o = order(s, { breed: 'marans', count: 3 });
    expect(orderStock(s, o)).toBe(3);
    callTruck(s, o.id);
    run(s, 16 * HOUR);
    expect(s.petShop.birds.filter((h) => h.breed === 'marans')).toHaveLength(0);
    expect(s.petShop.birds.filter((h) => h.breed === 'rousse')).toHaveLength(5);
  });

  it('il faut la parcelle du bout du chemin pour appeler le camion', () => {
    const s = newFarm(1619);
    morning(s);
    s.money = 10_000_000;
    s.settings.predators = false;
    while (farmLevel(s) < 16) s.xp += 1000;
    hire(s, 'farmhand');
    const o = order(s);
    expect(checkCallTruck(s, o).reason).toMatch(/parcelle D3/);
    ownTruckParcel(s);
    expect(checkCallTruck(s, o).reason).toMatch(/vente de poules/);
    expect(A.openPetShop(s).ok).toBe(true);
    A.upgrade(s, petShopOf(s)!.id);
    flock(s, 'rousse', 6);
    expect(checkCallTruck(s, o).ok).toBe(true);
  });

  it('le camion entre par le grand portail : son chemin reste libre, et le portail retient les poules', () => {
    const s = farm(1620);
    // rien ne se construit sur son chemin ni dans la cour devant la rampe
    expect(canPlace(s, 'tree', TRUCK_BAY.x0, TRUCK_BAY.z1).ok).toBe(false);
    expect(canPlace(s, 'tree', TRUCK_BAY.x1, TRUCK_BAY.z0).ok).toBe(false);
    expect(canPlace(s, 'tree', TRUCK_COURT.x0, TRUCK_COURT.z0).ok).toBe(false);
    expect(canPlace(s, 'tree', TRUCK_BAY.x0, TRUCK_BAY.z0 - 3).ok).toBe(true);
    // le portail est une vraie clôture : les poules et le personnel ne passent pas
    expect(farmEnclosed(s)).toBe(true);
    const edge = (st: GameState, c: number) => st.fenceV[-c - 1];
    for (const c of TRUCK_GATE_EDGES) {
      expect(edge(s, c)).toBe(5);
      expect(blocksMover(edge(s, c), 'hen')).toBe(true);
      expect(blocksMover(edge(s, c), 'human')).toBe(true);
    }
    // ... et il est à sa place sur une ancienne partie
    const back = deserialize(serialize(s))!;
    expect(edge(back, TRUCK_GATE_EDGES[0])).toBe(5);
    // pendant le chargement, le camion prend de la place dans la parcelle
    invalidateLayout(s);
    expect(rt(s).blocked[cellIndex(TRUCK_BAY.x0 + 2, TRUCK_BAY.z0)]).toBe(0);
    hire(s, 'farmhand');
    flock(s, 'rousse', 6);
    expect(callTruck(s, order(s).id).ok).toBe(true);
    for (let i = 0; i < 200 && !s.birdLoad!.called; i++) run(s, 1);
    expect(s.birdLoad!.called).toBe(true);
    // la trappe des volailles est fermée au reste du troupeau
    for (const c of truckHatchEdges(s)) expect(s.fenceH[c]).toBe(5);
    run(s, 0.2);
    expect(rt(s).blocked[cellIndex(TRUCK_BAY.x0 + 2, TRUCK_BAY.z0)]).toBe(1);
    // personne sur la voie du camion, jusqu'au portail ; le passage des volailles, à côté, reste libre
    expect(rt(s).blocked[cellIndex(TRUCK_BAY.x1, TRUCK_BAY.z0)]).toBe(1);
    expect(rt(s).blocked[cellIndex(TRUCK_COURT.x0, TRUCK_BAY.z1 + 2)]).toBe(0);
  });

  it('un bâtiment d’une ancienne partie sur le chemin empêche d’appeler le camion, avec un message clair', () => {
    const s = farm(1621);
    hire(s, 'farmhand');
    flock(s, 'rousse', 6);
    const o = order(s);
    expect(checkCallTruck(s, o).ok).toBe(true);
    s.buildings.push(makeBuilding(s.nextId++, 'tree', TRUCK_BAY.x0, TRUCK_BAY.z0, s.clock.t));
    invalidateLayout(s);
    expect(checkCallTruck(s, o).reason).toMatch(/gêne le camion/);
  });

  it('seules les volailles en vente partent : elles passent la trappe, le commis les guide jusqu’à la rampe', () => {
    const s = farm(1622);
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'rousse', 12, false);
    const farmHens = s.hens.length;
    stockBirds(s, 'rousse', 8);
    const inShop = s.petShop.birds.map((h) => h.id);
    const o = order(s, { count: 8 });
    expect(callTruck(s, o.id).ok).toBe(true);
    while (!s.birdLoad!.called) run(s, 1);
    run(s, 0.2);
    // réservées : plus question de les vendre à un client ni de les reprendre
    expect(s.birdLoad!.henIds.sort()).toEqual([...inShop].sort());
    expect(stockOf(s, 'rousse')).toHaveLength(0);
    expect(unstockBird(s, inShop[0]).ok).toBe(false);
    let sawBehind = false;
    let inside = true;
    for (let i = 0; i < 1500 && s.birdLoad; i++) {
      run(s, 0.1);
      for (const w of s.workers)
        if (w.job?.kind === 'loadTruck' && w.job.phase === 'work') {
          sawBehind = true;
          if (w.z > 30 || w.x > 80) inside = false;
        }
      const L = s.birdLoad;
      if (L)
        for (const q of L.gone) {
          expect(inShop).toContain(q.id);
          const p = q.route;
          expect(p[p.length - 1][0]).toBeLessThan(TRUCK_REAR);
          expect(p.some(([x, z]) => x === penHatch(petShopOf(s)!.level, false).hatch && z < 30)).toBe(true);
          expect(p[p.length - 3][0]).toBe(RAMP_FOOT);
        }
    }
    expect(sawBehind).toBe(true);
    expect(inside).toBe(true);
    expect(s.birdLoad).toBeNull();
    expect(s.birdOrders.find((x) => x.id === o.id)).toBeUndefined();
    expect(s.petShop.birds).toHaveLength(0);
    // la ferme n'a perdu que les huit mises en vente
    expect(s.hens.length).toBe(farmHens - 8);
  });

  it('n’importe quelle poule adulte peut être mise en vente, où qu’elle soit et quelle que soit sa couleur', () => {
    const s = farm(1623);
    const coop = buildingsOf(s, 'coop')[0];
    const mk = (over: Partial<Hen>) => {
      const h = createHen(s, 'rousse', coop, false, { at: [coop.x + 1, coop.z + 5] });
      Object.assign(h, over);
      s.hens.push(h);
      return h;
    };
    for (const h of [mk({ skin: 3 }), mk({ nursery: true }), mk({ act: 'stray' }), mk({ black: true }), mk({ x: 70, z: 12 })]) {
      expect(sellable(h)).toBe(true);
      expect(stockBird(s, h.id).ok).toBe(true);
      expect(h.nursery).toBeUndefined();
    }
    // les jeunes et les deux trésors restent à part
    for (const h of [mk({ young: 3 }), mk({ golden: true }), mk({ legendary: true })]) expect(sellable(h)).toBe(false);
    // le vendeur, lui, ne met jamais une rareté en vente de lui-même
    const rare = mk({ black: true });
    expect(isRareBird(rare)).toBe(true);
  });

  it('coqs et jars se mettent en vente à leur propre prix, sans se mêler aux femelles', () => {
    const s = farm(1630);
    s.hens.length = 0;
    const coop = buildingsOf(s, 'coop')[0];
    const mk = (breed: Hen['breed'], over: Partial<Hen>) => {
      const h = createHen(s, breed, coop, false, { at: [coop.x + 1, coop.z + 5] });
      Object.assign(h, over);
      s.hens.push(h);
      return h;
    };
    for (let i = 0; i < 3; i++) mk('rousse', {});
    for (let i = 0; i < 2; i++) mk('rousse', { rooster: true });
    mk('oie', { rooster: true });
    expect(flockOf(s, 'rousse', true).length).toBe(2);
    expect(flockOf(s, 'rousse').length).toBe(3);
    expect(suggestedPrice('rousse', true)).toBeGreaterThan(suggestedPrice('rousse'));
    setPetPrice(s, 'rousse', 900, true);
    expect(petPrice(s, 'rousse', true)).not.toBe(petPrice(s, 'rousse'));
    expect(stockBirds(s, 'rousse', 5, true).ok).toBe(true);
    expect(stockBirds(s, 'oie', 1, true).ok).toBe(true);
    expect(stockOf(s, 'rousse', true).length).toBe(2);
    expect(stockOf(s, 'rousse').length).toBe(0);
    expect(s.petShop.birds.length).toBe(3);
    // une commande de poules ne prend pas les coqs, une commande de coqs pas les jars
    expect(orderStock(s, { goose: false })).toBe(0);
    expect(orderStock(s, { goose: false, male: true })).toBe(2);
    expect(orderStock(s, { goose: true, male: true })).toBe(1);
    // le vendeur ne touche pas aux coqs de lui-même
    expect(unstockBirds(s, 'rousse', 2, true).ok).toBe(true);
    s.petShop.seller = true;
    s.petShop.restock = true;
    s.petShop.keep = 0;
    petShopHourly(s);
    expect(s.petShop.birds.filter((h) => h.rooster && !isGoose(h.breed)).length).toBe(0);
    expect(stockOf(s, 'rousse').length).toBe(3);
  });

  it('la sauvegarde garde les prix des coqs et les commandes de coqs noirs', () => {
    const s = farm(1633);
    setPetPrice(s, 'rousse', 900, true);
    s.birdOrders.push({ id: 987, client: 'Volailles du Val', goose: false, male: true, black: true, count: 2, unitPrice: 60000, deadlineDay: 9, offerUntilDay: 5, status: 'offer' });
    const back = deserialize(serialize(s))!;
    expect(petPrice(back, 'rousse', true)).toBe(petPrice(s, 'rousse', true));
    const o = back.birdOrders.find((x) => x.id === 987)!;
    expect(o.male).toBe(true);
    expect(o.black).toBe(true);
  });

  it('les clients achètent aussi des coqs', () => {
    const s = farm(1631);
    s.hens.length = 0;
    const coop = buildingsOf(s, 'coop')[0];
    for (let i = 0; i < 40; i++) {
      const h = createHen(s, 'rousse', coop, false, { at: [coop.x + 1, coop.z + 5] });
      h.rooster = true;
      s.hens.push(h);
    }
    expect(stockBirds(s, 'rousse', 40, true).ok).toBe(true);
    setPetPrice(s, 'rousse', priceBounds('rousse', true)[0], true);
    expect(hirePetSeller(s).ok).toBe(true);
    const before = s.money;
    for (let i = 0; i < 2400 && s.petShop.birds.length === 40; i++) run(s, 0.1);
    for (let i = 0; i < 4000 && s.petShop.birds.length === 40; i++) run(s, 0.1);
    expect(s.petShop.birds.length).toBeLessThan(40);
    expect(s.money).not.toBe(before);
  });

  it('les commandes de coqs reviennent souvent, à la mesure de ce que la ferme en a', () => {
    let males = 0;
    let days = 0;
    for (let seed = 0; seed < 60; seed++) {
      const s = farm(1700 + seed);
      const coop = buildingsOf(s, 'coop')[0];
      for (let i = 0; i < 7; i++) {
        const h = createHen(s, 'rousse', coop, false, { at: [coop.x + 1, coop.z + 5] });
        h.rooster = true;
        s.hens.push(h);
      }
      s.birdOrders.length = 0;
      generateBirdOrders(s);
      days++;
      const o = s.birdOrders.find((x) => x.male);
      if (o) {
        males++;
        expect(o.count).toBeLessThanOrEqual(s.hens.filter((h) => h.rooster && !h.young).length);
      }
    }
    expect(males / days).toBeGreaterThan(0.7);
  });

  it('le camion emmène un lot de coqs noirs à leur prix, et ne touche pas aux poules en vente', () => {
    const s = farm(1632);
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'rousse', 4);
    const coop = buildingsOf(s, 'coop')[0];
    for (let i = 0; i < 3; i++) {
      const h = createHen(s, 'rousse', coop, false, { at: [coop.x + 1, coop.z + 5] });
      h.rooster = true;
      h.black = true;
      s.hens.push(h);
    }
    expect(putBlackOnSale(s, 3).ok).toBe(true);
    const o = order(s, { count: 2, unitPrice: 60000, black: true });
    const money = s.money;
    expect(callTruck(s, o.id).ok).toBe(true);
    for (let i = 0; i < 1200 && s.birdLoad; i++) run(s, 0.1);
    expect(s.birdLoad).toBeNull();
    expect(s.money - money).toBeGreaterThanOrEqual(2 * 60000 - 5000);
    expect(s.petShop.birds.filter((h) => h.black)).toHaveLength(1);
    expect(s.petShop.birds.filter((h) => !h.black)).toHaveLength(4);
  });

  it('les coqs noirs partent par lots, à leur vraie valeur, et avec les revendeurs seulement', () => {
    let found = false;
    for (let seed = 0; seed < 40 && !found; seed++) {
      const s = farm(1800 + seed);
      s.hens.length = 0;
      const coop = buildingsOf(s, 'coop')[0];
      for (let i = 0; i < 6; i++) {
        const h = createHen(s, 'rousse', coop, false, { at: [coop.x + 1, coop.z + 5] });
        h.rooster = true;
        h.black = true;
        s.hens.push(h);
      }
      const value = henValue(s.hens[0]);
      s.birdOrders.length = 0;
      generateBirdOrders(s);
      const o = s.birdOrders.find((x) => x.black);
      if (!o) continue;
      found = true;
      expect(o.count).toBeGreaterThanOrEqual(2);
      expect(o.unitPrice).toBeGreaterThan(value * 0.8);
      expect(o.unitPrice).toBeLessThan(value * 1.2);
      // les clients n'y ont pas accès, et une commande de coqs ordinaires non plus
      expect(putBlackOnSale(s, 3).ok).toBe(true);
      expect(stockOfKind(s, false).length).toBe(0);
      expect(orderStock(s, { goose: false, male: true })).toBe(0);
      expect(orderStock(s, o)).toBe(3);
    }
    expect(found).toBe(true);
  });

  it('à chaque niveau, chaque parc a sa trappe : les volailles ne sortent jamais à découvert', () => {
    for (let level = 1; level <= 5; level++) {
      const L = petLayout(level);
      for (const goose of [false, true]) {
        const pen = goose ? L.geese : L.hens;
        const h = penHatch(level, goose);
        const [x0, x1] = [PET_POS.x + pen.x0, PET_POS.x + pen.x1];
        const zFence = PET_POS.z + pen.z0;
        // la trappe tient dans la clôture du parc, et donne sur la parcelle du camion
        expect(h.door - h.w / 2).toBeGreaterThan(x0);
        expect(h.door + h.w / 2).toBeLessThanOrEqual(x1 + 0.01);
        expect(h.hatch).toBeGreaterThanOrEqual(60);
        expect(h.hatch).toBeLessThan(80);
        expect(TRUCK_HATCH_CELLS).toContain(Math.floor(h.hatch));
        expect(penGate(level, goose)[0]).toBe(h.door);
        // tout droit dès que le parc longe la parcelle ; sinon, un couloir fermé y mène
        const lane = petLane(level);
        if (h.direct) expect(h.door).toBe(h.hatch);
        else {
          expect(lane).not.toBeNull();
          expect(h.door).toBeGreaterThan(lane!.x0);
          expect(h.hatch).toBeLessThan(lane!.x1);
        }
        // de la clôture du parc à celle de la ferme, puis dans la parcelle : jamais à côté du passage
        const route = boardPath(h.door, zFence);
        for (let k = 0; k <= 400; k++) {
          const p = alongPath(route, k / 400);
          if (p.z >= 30) {
            expect(p.z).toBeLessThanOrEqual(zFence + 0.001);
            expect(p.z).toBeGreaterThan(30);
            if (h.direct) expect(p.x).toBe(h.door);
            else expect(p.x >= lane!.x0 && p.x <= lane!.x1).toBe(true);
          }
        }
      }
    }
    // niveau 1 : un couloir ; dernier niveau : plus besoin, les deux parcs longent la parcelle
    expect(petLane(1)).not.toBeNull();
    expect(petLane(5)).toBeNull();
  });

  it('les trappes suivent les parcs quand la boutique grandit, et la clôture reste fermée ailleurs', () => {
    const s = newFarm(1640);
    morning(s);
    s.money = 10_000_000;
    while (farmLevel(s) < 16) s.xp += 1000;
    ownTruckParcel(s);
    // sans boutique, pas de trou dans la clôture
    expect(truckHatchEdges(s)).toEqual([]);
    expect(s.fenceH.includes(5)).toBe(false);
    expect(A.openPetShop(s).ok).toBe(true);
    const shop = petShopOf(s)!;
    const opened = () => s.fenceH.flatMap((v, i) => (v === 5 ? [i] : []));
    for (let level = 1; level <= 5; level++) {
      expect(shop.level).toBe(level);
      const want = [...new Set([false, true].map((g) => hCode(Math.floor(penHatch(level, g).hatch), GRID_Z1)))].sort((a, b) => a - b);
      expect(opened()).toEqual(want);
      if (level < 5) expect(A.upgrade(s, shop.id).ok).toBe(true);
    }
    // à la relecture d'une partie aussi
    const back = deserialize(serialize(s))!;
    expect(back.fenceH.flatMap((v, i) => (v === 5 ? [i] : []))).toEqual(opened());
  });

  it('le trajet ne touche jamais le camion garé, et contourne ce qui encombre la parcelle', () => {
    const s = farm(1641);
    hire(s, 'farmhand');
    flock(s, 'rousse', 4);
    const o = order(s, { count: 2 });
    expect(callTruck(s, o.id).ok).toBe(true);
    for (let i = 0; i < 200 && !s.birdLoad!.called; i++) run(s, 1);
    run(s, 0.2);
    const [x, z] = penGate(petShopOf(s)!.level, false);
    // un bâtiment en plein sur la ligne droite
    const tree = makeBuilding(s.nextId++, 'tree', 74, 27, s.clock.t);
    s.buildings.push(tree);
    invalidateLayout(s);
    run(s, 0.2);
    const route = boardRoute(s, x, z);
    for (let k = 0; k <= 600; k++) {
      const p = alongPath(route, k / 600);
      // le corps du camion, sur sa voie
      if (p.x < TRUCK_REAR - 0.6) expect(p.z > 26.1 || p.x < 70).toBe(true);
      // l'arbre
      expect(p.x > 74 && p.x < 75 && p.z > 27 && p.z < 28).toBe(false);
    }
  });

  it('les commis se placent à l’écart de la voie du camion et du passage des volailles', () => {
    const s = farm(1642);
    hire(s, 'farmhand');
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'rousse', 30);
    const o = order(s, { count: 12 });
    expect(callTruck(s, o.id).ok).toBe(true);
    let seen = 0;
    for (let i = 0; i < 1500 && s.birdLoad; i++) {
      run(s, 0.1);
      for (const w of s.workers)
        if (w.job?.kind === 'loadTruck' && w.job.phase === 'work') {
          seen++;
          const [x, z] = herdSpot(s, w);
          expect(z).toBeGreaterThan(TRUCK_BAY.z1 + 1.2);
          for (const goose of [false, true]) {
            const route = boardPath(...penGate(petShopOf(s)!.level, goose));
            for (let k = 0; k <= 200; k++) {
              const p = alongPath(route, k / 200);
              expect(Math.hypot(p.x - x, p.z - z)).toBeGreaterThan(0.6);
            }
          }
        }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('une poule qui traîne sur la voie du camion s’écarte avant qu’il arrive', () => {
    const s = farm(1643);
    hire(s, 'farmhand');
    flock(s, 'rousse', 6);
    const coop = buildingsOf(s, 'coop')[0];
    const stray = createHen(s, 'rousse', coop, false, { at: [74, 25.2] });
    s.hens.push(stray);
    const o = order(s, { count: 6 });
    expect(callTruck(s, o.id).ok).toBe(true);
    const inLane = () => stray.x > TRUCK_BAY.x0 - 0.3 && stray.x < TRUCK_BAY.x1 + 1 && stray.z > TRUCK_BAY.z0 - 0.3 && stray.z < TRUCK_BAY.z1 + 1.3;
    for (let i = 0; i < 1000 && s.clock.t < s.birdLoad!.eta; i++) run(s, 0.1);
    expect(inLane()).toBe(false);
  });

  it('plusieurs camions : le suivant attend son tour, sans jamais gêner celui qui est là', () => {
    const s = farm(1644);
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'rousse', 12);
    const a = order(s, { id: 900100, count: 3, unitPrice: 700 });
    const b = order(s, { id: 900101, count: 3, unitPrice: 800 });
    const c = order(s, { id: 900102, count: 3, unitPrice: 900 });
    expect(callTruck(s, a.id).ok).toBe(true);
    const first = s.birdLoad!.id;
    const eta = s.birdLoad!.eta;
    expect(a.status).toBe('loading');
    // on peut appeler les autres tout de suite : ils prennent la file, le premier n'en sait rien
    expect(callTruck(s, b.id).ok).toBe(true);
    expect(callTruck(s, c.id).ok).toBe(true);
    expect(b.status).toBe('queued');
    expect(c.status).toBe('queued');
    expect(s.birdQueue).toEqual([b.id, c.id]);
    expect(s.birdLoad!.id).toBe(first);
    expect(s.birdLoad!.eta).toBe(eta);
    // il n'y a pas de quoi charger un quatrième : ce qui est promis n'est plus disponible
    const d = order(s, { id: 900103, count: 4 });
    expect(checkCallTruck(s, d).reason).toMatch(/Pas assez/);
    s.birdOrders.splice(s.birdOrders.indexOf(d), 1);
    const seen: number[] = [];
    for (let i = 0; i < 12000 && (s.birdLoad || s.birdQueue.length); i++) {
      run(s, 0.1);
      const L = s.birdLoad;
      if (L && !seen.includes(L.orderId)) seen.push(L.orderId);
      if (L) expect(s.birdOrders.filter((o) => o.status === 'loading')).toHaveLength(1);
    }
    expect(seen).toEqual([a.id, b.id, c.id]);
    expect(s.birdOrders.filter((o) => o.client === a.client && [a.id, b.id, c.id].includes(o.id))).toHaveLength(0);
    expect(s.stats.birdOrdersDone).toBe(3);
    expect(s.petShop.birds).toHaveLength(3);
  });

  it('on peut renoncer à un camion qui attend son tour, et la file survit à la sauvegarde', () => {
    const s = farm(1645);
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'rousse', 12);
    const a = order(s, { id: 900110, count: 3 });
    const b = order(s, { id: 900111, count: 3 });
    const c = order(s, { id: 900112, count: 3 });
    callTruck(s, a.id);
    callTruck(s, b.id);
    callTruck(s, c.id);
    const back = deserialize(serialize(s))!;
    expect(back.birdQueue).toEqual([b.id, c.id]);
    expect(back.birdOrders.find((o) => o.id === b.id)!.status).toBe('queued');
    expect(cancelTruckCall(s, b.id).ok).toBe(true);
    expect(b.status).toBe('active');
    expect(s.birdQueue).toEqual([c.id]);
  });

  it('sans commis, le camion repart à vide et la commande reste à livrer', () => {
    const s = farm(1608);
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'rousse', 8);
    const o = order(s, { count: 4 });
    callTruck(s, o.id);
    // le commis est renvoyé juste après l'appel
    fire(s, s.workers[0].id);
    const hens = s.hens.length;
    run(s, 22 * HOUR);
    expect(s.birdLoad).toBeNull();
    const left = s.birdOrders.find((x) => x.id === o.id)!;
    expect(left.status).toBe('active');
    expect(left.count).toBe(4);
    expect(s.hens.some((h) => h.ship)).toBe(false);
    expect(s.hens.length).toBe(hens);
  });

  it('une volaille disparue entre-temps est remplacée', () => {
    const s = farm(1609);
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'rousse', 8);
    const o = order(s, { count: 4 });
    callTruck(s, o.id);
    run(s, BIRD_ORDERS.delay - BIRD_ORDERS.prep + 1);
    const first = s.petShop.birds.find((h) => h.ship)!;
    expect(first).toBeTruthy();
    s.petShop.birds.splice(s.petShop.birds.indexOf(first), 1);
    run(s, 16 * HOUR);
    expect(s.birdOrders.find((x) => x.id === o.id)).toBeUndefined();
    expect(s.stats.birdsSoldDealers).toBe(4);
  });

  it('trop tard pour les commis : le camion passe le lendemain matin', () => {
    const s = farm(1610);
    hire(s, 'farmhand');
    flock(s, 'rousse', 5);
    const o = order(s, { count: 3, deadlineDay: currentDay(s) + 3 });
    const day = Math.floor(s.clock.t / TIME.DAY);
    s.clock.t = day * TIME.DAY + 20 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    callTruck(s, o.id);
    // le lendemain : assez tôt pour que tout soit fini avant le soir, et jamais avant le lever du jour
    expect(s.birdLoad!.eta).toBeGreaterThanOrEqual((day + 1) * TIME.DAY + BIRD_ORDERS.morningHour * HOUR);
    expect(s.birdLoad!.eta).toBeLessThan((day + 1) * TIME.DAY + 14 * HOUR);
    // la nuit, les poules dorment normalement
    run(s, 4 * HOUR);
    expect(s.birdLoad!.called).toBe(false);
  });

  it('une commande acceptée et oubliée coûte de la réputation', () => {
    const s = farm(1611);
    const o = order(s, { deadlineDay: currentDay(s) - 1 });
    const rep = s.reputation;
    birdOrdersNewDay(s);
    expect(s.birdOrders.find((x) => x.id === o.id)).toBeUndefined();
    expect(s.reputation).toBeLessThan(rep);
  });

  it('la sauvegarde pendant un chargement reprend là où on en était', () => {
    const s = farm(1612);
    hire(s, 'farmhand');
    run(s, 2 * HOUR);
    flock(s, 'rousse', 8);
    const o = order(s, { count: 5 });
    callTruck(s, o.id);
    run(s, BIRD_ORDERS.delay + 2);
    const back = deserialize(serialize(s))!;
    expect(back.birdLoad?.orderId).toBe(o.id);
    expect(back.petShop.birds.filter((h) => h.ship).length).toBe(back.birdLoad!.henIds.length);
    run(back, 16 * HOUR);
    expect(back.birdLoad).toBeNull();
    expect(back.birdOrders.find((x) => x.id === o.id)).toBeUndefined();
  });

  it('un jars n’est pas un coq, même dans les messages', () => {
    const s = farm(1613);
    buildGooseHouse(s);
    const coop = buildingsOf(s, 'coop')[0];
    const house = buildingsOf(s, 'goosehouse')[0];
    const male = (breed: 'rousse' | 'oie', c: typeof coop) => createHen(s, breed, c, false, { rooster: true, black: false });
    expect(A.maleWords([male('rousse', coop), male('rousse', coop), male('oie', house)])).toBe('2 coqs et 1 jars');
    expect(A.maleWords([male('oie', house), male('oie', house)])).toBe('2 jars');
    expect(A.maleWords([male('rousse', coop)])).toBe('1 coq');
  });
});

describe('Options du commis', () => {
  const farm = (seed: number) => {
    const s = newFarm(seed);
    morning(s);
    s.money = 10_000_000;
    s.xp = 99999;
    s.settings.predators = false;
    return s;
  };
  const coq = (s: GameState, p: number) => {
    const coop = buildingsOf(s, 'coop')[0];
    const h = createHen(s, 'rousse', coop, false, { rooster: true, at: [coop.x + 1, coop.z + 5] });
    h.genes = { p, r: 2, b: 2 };
    s.hens.push(h);
    return h;
  };
  const onDutyFarmhand = (s: GameState) => {
    expect(hire(s, 'farmhand').ok).toBe(true);
    const w = s.workers[0];
    w.onSite = true;
    return w;
  };

  it('chaque option se paie une fois, à son prix, et reste acquise après une sauvegarde', () => {
    const s = farm(1701);
    const w = onDutyFarmhand(s);
    const money = s.money;
    expect(buyWorkerSkill(s, w.id, 'roosters').ok).toBe(true);
    expect(money - s.money).toBe(100000);
    expect(buyWorkerSkill(s, w.id, 'roosters').ok).toBe(false);
    const m2 = s.money;
    expect(buyWorkerSkill(s, w.id, 'sick').ok).toBe(true);
    expect(m2 - s.money).toBe(300000);
    expect(deserialize(serialize(s))!.workers[0].skills).toEqual(['roosters', 'sick']);
    s.money = 100;
    const other = farm(1702);
    const w2 = onDutyFarmhand(other);
    other.money = 100;
    expect(buyWorkerSkill(other, w2.id, 'sick').ok).toBe(false);
    expect(w2.skills).toBeUndefined();
  });

  it('réservées aux commis de ferme', () => {
    const s = farm(1703);
    expect(hire(s, 'gardener').ok).toBe(true);
    expect(buyWorkerSkill(s, s.workers[0].id, 'sick').ok).toBe(false);
  });

  it('il vend les coqs en trop et garde le meilleur, sans l’option rien ne bouge', () => {
    const s = farm(1704);
    const w = onDutyFarmhand(s);
    s.hens = s.hens.filter((h) => !h.rooster);
    const a = coq(s, 1);
    const b = coq(s, 5);
    const c = coq(s, 2);
    workerSkillsHourly(s);
    expect(s.hens.filter((h) => h.rooster)).toHaveLength(3);
    buyWorkerSkill(s, w.id, 'roosters');
    const money = s.money;
    workerSkillsHourly(s);
    expect(s.hens).toContain(b);
    expect(s.hens).not.toContain(a);
    expect(s.hens).not.toContain(c);
    expect(s.money).toBeGreaterThan(money);
    // absent de la ferme : il attendra son retour
    const d = coq(s, 1);
    w.onSite = false;
    workerSkillsHourly(s);
    expect(s.hens).toContain(d);
  });

  it('il vend les malades et en rachète de la même race quand c’est possible', () => {
    const s = farm(1705);
    const w = onDutyFarmhand(s);
    buyWorkerSkill(s, w.id, 'sick');
    const coop = buildingsOf(s, 'coop')[0];
    const h = createHen(s, 'rousse', coop, false, { at: [coop.x + 1, coop.z + 5] });
    h.sick = true;
    s.hens.push(h);
    const n = s.hens.length;
    workerSkillsHourly(s);
    expect(s.hens).not.toContain(h);
    expect(s.hens.length + s.deliveries.reduce((x, d) => x + d.count, 0)).toBe(n);
    // ni la poule d'or ni les fonds vides ne le font faire de bêtise
    const g = createHen(s, 'rousse', coop, false, { at: [coop.x + 1, coop.z + 5] });
    g.sick = true;
    g.golden = true;
    s.hens.push(g);
    const v = createHen(s, 'rousse', coop, false, { at: [coop.x + 1, coop.z + 5] });
    v.sick = true;
    s.hens.push(v);
    s.money = 0;
    workerSkillsHourly(s);
    expect(s.hens).toContain(g);
    expect(s.hens).not.toContain(v);
    expect(s.money).toBeGreaterThanOrEqual(0);
  });
});

describe('Arbres et buissons des parcelles', () => {
  const farm = (seed: number) => {
    const s = newFarm(seed);
    morning(s);
    s.money = 10_000_000;
    s.xp = 99999;
    s.settings.predators = false;
    return s;
  };
  const planted = (s: GameState) => s.buildings.filter((b) => b.wild);

  it('ils restent en achetant la parcelle, exactement là où ils étaient', () => {
    const s = farm(1801);
    const [c, r] = [1, 2];
    const wild = wildPlants(c, r);
    expect(wild.length).toBeGreaterThan(5);
    expect(A.buyParcel(s, `${c},${r}`).ok).toBe(true);
    const list = planted(s);
    expect(list).toHaveLength(wild.length);
    for (const b of list) {
      expect(b.invested).toBe(0);
      expect(parcelKeyOfCell(b.x, b.z)).toBe(`${c},${r}`);
      const near = wild.find((p) => Math.abs(p.x - (b.x + b.wild!.ox)) < 1e-9 && Math.abs(p.z - (b.z + b.wild!.oz)) < 1e-9);
      expect(near?.kind).toBe(b.type);
      // on ne construit pas dessus
      expect(canPlace(s, 'tree', b.x, b.z).ok).toBe(false);
    }
    // une seule plante par case
    expect(new Set(list.map((b) => `${b.x},${b.z}`)).size).toBe(list.length);
  });

  it('leurs arbres donnent les mêmes bienfaits qu’un arbre acheté', () => {
    const s = farm(1802);
    const key = ['1,2', '0,1', '2,2'].find((k) => {
      const [c, r] = k.split(',').map(Number);
      return wildPlants(c, r).some((p) => p.kind === 'tree');
    })!;
    expect(parcelPerks(s, key).trees).toBe(0);
    const [c, r] = key.split(',').map(Number);
    const n = wildPlants(c, r).filter((p) => p.kind === 'tree').length;
    // (le terrain doit toucher le vôtre)
    if (key === '2,2') A.buyParcel(s, '1,2');
    expect(A.buyParcel(s, key).ok).toBe(true);
    const p = parcelPerks(s, key);
    expect(p.trees).toBe(n);
    expect(p.wellbeing).toBeGreaterThan(0);
    expect(p.thirst).toBeLessThan(1);
    const t = planted(s).find((b) => b.type === 'tree')!;
    expect(nearestTree(s, t.x + 0.5, t.z + 0.5, 1)).not.toBeNull();
  });

  it('enlever un arbre coûte 10 €, un buisson 5 € : plus rien ne gêne ensuite', () => {
    const s = farm(1803);
    A.buyParcel(s, '1,2');
    const bush = planted(s).find((b) => b.type === 'bush')!;
    let money = s.money;
    expect(A.demolish(s, bush.id).ok).toBe(true);
    expect(money - s.money).toBe(500);
    expect(canPlace(s, 'tree', bush.x, bush.z).ok).toBe(true);
    const tree = planted(s).find((b) => b.type === 'tree')!;
    money = s.money;
    expect(A.demolish(s, tree.id).ok).toBe(true);
    expect(money - s.money).toBe(1000);
    // sans le sou, l'arbre reste
    const other = planted(s).find((b) => b.type === 'tree')!;
    s.money = 500;
    expect(A.checkDemolish(s, other.id).ok).toBe(false);
    expect(A.demolish(s, other.id).ok).toBe(false);
    expect(s.buildings).toContain(other);
    // même tarif pour un arbre acheté, sans remboursement
    s.money = 100000;
    let spot: [number, number] | null = null;
    for (let x = 1; x < 19 && !spot; x++) for (let z = 11; z < 29 && !spot; z++) if (canPlace(s, 'tree', x, z).ok) spot = [x, z];
    expect(A.build(s, 'tree', spot![0], spot![1]).ok).toBe(true);
    const bought = s.buildings.at(-1)!;
    expect(A.demolishRefund(s, bought.id)).toBe(0);
    money = s.money;
    expect(A.demolish(s, bought.id).ok).toBe(true);
    expect(money - s.money).toBe(1000);
  });

  it('rien ne pousse sur la place du camion, dans la parcelle du bout du chemin', () => {
    const [c, r] = BIRD_ORDERS.parcel.split(',').map(Number);
    for (const p of wildPlants(c, r)) expect(inTruckBay(Math.floor(p.x), Math.floor(p.z))).toBe(false);
  });

  it('ils sont gardés à la sauvegarde et ne bloquent pas les poules', () => {
    const s = farm(1804);
    A.buyParcel(s, '1,2');
    const list = planted(s);
    const back = deserialize(serialize(s))!;
    expect(back.buildings.filter((b) => b.wild)).toHaveLength(list.length);
    const b0 = list[0];
    const b1 = back.buildings.find((b) => b.id === b0.id)!;
    expect(b1.type).toBe(b0.type);
    expect(b1.wild!.sc).toBeCloseTo(b0.wild!.sc, 5);
    // le troupeau continue de vivre normalement sur la parcelle
    const coop = buildingsOf(s, 'coop')[0];
    for (let i = 0; i < 6; i++) s.hens.push(createHen(s, 'rousse', coop, false, { at: [coop.x + 1 + i, coop.z + 6] }));
    run(s, 6 * HOUR);
    for (const h of s.hens) {
      expect(Number.isFinite(h.x)).toBe(true);
      expect(Number.isFinite(h.z)).toBe(true);
    }
  });
});

describe('L’hôtel de ville et le chien', () => {
  const dogFarm = (seed: number) => {
    const s = newFarm(seed);
    morning(s);
    s.money = 10_000_000;
    s.xp = 99999;
    s.settings.predators = false;
    expect(buyDog(s).ok).toBe(true);
    return s;
  };
  const inside = (r: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

  it('l’hôtel de ville a reculé : sa cour ne touche plus la clôture, et l’allée y mène toujours', () => {
    expect(HALL_COURT.x1).toBeLessThan(-5);
    expect(HALL_BODY.x1).toBeLessThan(-6);
    expect(HALL_DOOR[0]).toBeGreaterThan(HALL_COURT.x0);
    expect(HALL_ALLEY).toBeGreaterThan(HALL_COURT.x0);
    expect(HALL_ALLEY).toBeLessThan(HALL_COURT.x1);
    // le personnel arrive par la porte, traverse la cour et rejoint le portail sans passer par les murs
    const s = newFarm(1900);
    morning(s);
    expect(hire(s, 'farmhand').ok).toBe(true);
    let crossed = false;
    let atDoor = false;
    run(s, 26 * HOUR, () => {
      for (const w of s.workers) {
        if (inside(HALL_BODY, w.x, w.z) && w.z < HALL_DOOR[1] - 1) crossed = true;
        if (Math.hypot(w.x - HALL_DOOR[0], w.z - HALL_DOOR[1]) < 1) atDoor = true;
      }
    });
    expect(crossed).toBe(false);
    expect(atDoor).toBe(true);
    expect(s.workers[0].x).toBeGreaterThan(HALL_ALLEY);
  });

  it('le chien ne traverse jamais l’hôtel de ville, ni un bâtiment, ni la vente de poules, en ronde comme la nuit', () => {
    const s = dogFarm(1901);
    for (const k of ['1,2', '2,2', '3,2']) expect(A.buyParcel(s, k).ok).toBe(true);
    expect(A.openPetShop(s).ok).toBe(true);
    const shop = petShopOf(s)!;
    const L = petLayout(shop.level);
    const shopRect = { x0: PET_POS.x, x1: PET_POS.x + L.w, z0: PET_POS.z, z1: PET_POS.z + 6.7 };
    const seen = new Set<string>();
    let nights = 0;
    for (let i = 0; i < 26000; i++) {
      step(s, 0.1);
      drainEvents(s);
      const d = s.dog!;
      seen.add(`${Math.round(d.x / 5)},${Math.round(d.z / 5)}`);
      if (d.act === 'sleep') nights++;
      expect(inside(HALL_BODY, d.x, d.z)).toBe(false);
      expect(inside(HALL_STEPS, d.x, d.z)).toBe(false);
      expect(inside(shopRect, d.x, d.z)).toBe(false);
      for (const b of s.buildings) {
        if (b.type === 'petshop' || b.type === 'stand') continue;
        const f = sizeOf(b.type, b.level, b.rot);
        expect(inside({ x0: b.x, x1: b.x + f.w, z0: b.z, z1: b.z + f.d }, d.x, d.z)).toBe(false);
      }
    }
    // il a vraiment tourné autour de la ferme, et il a dormi devant sa niche
    expect(seen.size).toBeGreaterThan(8);
    expect(nights).toBeGreaterThan(0);
    const [kx, kz] = kennelPoint(s);
    expect(inside(HALL_COURT, kx, kz)).toBe(true);
  });

  it('il rejoint sa niche par le tour de la cour, depuis l’autre bout de la ferme', () => {
    const s = dogFarm(1902);
    const d = s.dog!;
    d.x = 21;
    d.z = 24;
    d.path = [];
    d.act = 'sit';
    d.t = 0;
    const day = Math.floor(s.clock.t / TIME.DAY);
    s.clock.t = day * TIME.DAY + 21.5 * HOUR;
    s.clock.lastHourTick = Math.floor(s.clock.t / HOUR);
    let touched = false;
    for (let i = 0; i < 1400 && (d.act as string) !== 'sleep'; i++) {
      step(s, 0.1);
      drainEvents(s);
      if (inside(HALL_BODY, d.x, d.z) || inside(HALL_STEPS, d.x, d.z)) touched = true;
      // jamais à travers l'enclos de départ non plus
      if (inside({ x0: 0, x1: 20, z0: 10, z1: 30 }, d.x, d.z)) touched = true;
    }
    expect(touched).toBe(false);
    const [kx, kz] = kennelPoint(s);
    expect(Math.hypot(d.x - kx, d.z - kz)).toBeLessThan(1.6);
    expect(d.act).toBe('sleep');
  });
});

describe('Prix de vente et grandes bassines', () => {
  const rich = (seed: number) => {
    const s = newFarm(seed);
    morning(s);
    s.money = 100_000_000;
    s.xp = 99999;
    s.settings.predators = false;
    return s;
  };

  it('dès le début, on peut revendre une poule, mais 4 à 5 fois moins cher que son prix d’achat', () => {
    const s = newFarm(2001);
    morning(s);
    const coop = buildingsOf(s, 'coop')[0];
    const h = createHen(s, 'rousse', coop, false, { at: [coop.x + 1, coop.z + 5] });
    h.health = 100;
    h.age = 1;
    h.genes = undefined;
    s.hens.push(h);
    const v = henValue(h);
    expect(v).toBeLessThanOrEqual(BREEDS.rousse.price / 4);
    expect(v).toBeGreaterThanOrEqual(BREEDS.rousse.price / 5.5);
    const money = s.money;
    expect(A.sellHen(s, h.id).ok).toBe(true);
    expect(s.money - money).toBe(v);
    // la boutique rapporte bien plus
    expect(suggestedPrice('rousse')).toBeGreaterThanOrEqual(v * 2);
  });

  it('sans vendeur, la boutique ne vend rien ; dès qu’il arrive, les clients viennent', () => {
    const s = rich(2002);
    for (const k of ['1,2', '2,2', '3,2']) expect(A.buyParcel(s, k).ok).toBe(true);
    expect(A.openPetShop(s).ok).toBe(true);
    const coop = buildingsOf(s, 'coop')[0];
    A.upgrade(s, coop.id);
    for (let i = 0; i < 12; i++) s.hens.push(createHen(s, 'rousse', coop, false, { at: [coop.x + 1 + (i % 4), coop.z + 5] }));
    stockBirds(s, 'rousse', 10);
    const n = s.petShop.birds.length;
    expect(n).toBeGreaterThan(0);
    expect(petCustomersPerDay(s)).toBe(0);
    run(s, 8 * HOUR);
    expect(s.petCustomers).toHaveLength(0);
    expect(s.petShop.birds).toHaveLength(n);
    expect(hirePetSeller(s).ok).toBe(true);
    expect(petCustomersPerDay(s)).toBeGreaterThan(0);
    morning(s);
    run(s, 8 * HOUR);
    expect(s.petShop.birds.length).toBeLessThan(n);
  });

  it('les parcelles et les améliorations coûtent plus cher, sans toucher au premier niveau', () => {
    expect(parcelPrice(1)).toBe(45000);
    expect(parcelPrice(2)).toBeGreaterThan(parcelPrice(1) * 1.4);
    expect(BUILDINGS.coop.levels[0].cost).toBe(3500);
    expect(BUILDINGS.coop.levels[1].cost).toBeGreaterThan(4500);
    expect(BUILDINGS.stand.levels[3].cost).toBeGreaterThan(240000);
  });

  it.each(['feeder', 'drinker'] as const)('la longue bassine (%s) : 6 cases, 30 places, et les poules s’en servent', (type) => {
    const s = rich(2003);
    const top = BUILDINGS[type].levels.length;
    expect(top).toBe(6);
    expect(sizeOf(type, 6)).toEqual({ w: 6, d: 1 });
    expect(BUILDINGS[type].levels[5].slots).toBe(30);
    const b = buildingsOf(s, type)[0];
    // on lui fait de la place : tout le reste a été déplacé
    s.buildings = s.buildings.filter((o) => o === b || o.type === 'coop' || o.type === 'stand' || o.type === 'storage' || (o.type !== type && o.type !== 'nest' && (o.type === 'feeder' || o.type === 'drinker')));
    invalidateLayout(s);
    let guard = 0;
    while (b.level < 6 && guard++ < 8) {
      const r = A.upgrade(s, b.id);
      if (!r.ok) {
        // (la place manque au pied du bâtiment : on le recule d'une rangée)
        expect(A.move(s, b.id, 2, 12 + guard).ok).toBe(true);
      }
    }
    expect(b.level).toBe(6);
    const spots = feedLayout(b);
    expect(spots).toHaveLength(30);
    for (const p of spots) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(6);
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.z).toBeLessThanOrEqual(1);
      // le bec tombe dans la bassine, la poule reste dehors
      expect(Math.abs(p.fz - 0.5)).toBeLessThan(0.3);
      expect(Math.abs(p.z - 0.5)).toBeGreaterThan(0.3);
    }
    const coop = buildingsOf(s, 'coop')[0];
    A.upgrade(s, coop.id);
    for (let i = 0; i < 6; i++) {
      const h = createHen(s, 'rousse', coop, false, { at: [b.x + 1 + i * 0.6, b.z + 2] });
      // (une seule envie à la fois : il n'y a que cette bassine sur le terrain)
      h.satiety = type === 'feeder' ? 20 : 100;
      h.hydration = type === 'drinker' ? 20 : 100;
      s.hens.push(h);
    }
    let used = false;
    for (let i = 0; i < 400 && !used; i++) {
      run(s, 0.1);
      if (s.hens.some((h) => h.targetId === b.id && (h.act === 'eat' || h.act === 'drink'))) used = true;
    }
    expect(used).toBe(true);
  });
});
