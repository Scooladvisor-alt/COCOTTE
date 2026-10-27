import { describe, expect, it } from 'vitest';
import { BREEDING, DELIVERY, EGG_TYPES, HOUR, LEVELS, MARKET, PARCELS, START, TIME, WORLD, parcelPrice, waterPrice } from '../src/config/balance';
import { GATE_EDGE, farmEnclosed, perimeter } from '../src/sim/fences';
import { waterCapacity } from '../src/sim/stocks';
import { BREEDS, BREED_ORDER } from '../src/config/breeds';
import { BUILDINGS, COOP_SCALE, STAND_POS } from '../src/config/buildings';
import { BACKUP_KEY, SAVE_KEY, deserialize, loadGame, saveGame, serialize, type Storage } from '../src/save/save';
import * as A from '../src/sim/actions';
import { canPlace } from '../src/sim/buildings';
import { crossesFence, currentDay, drainEvents, invalidateLayout, isOwnedCell } from '../src/sim/core';
import { canAfford, farmLevel, spend } from '../src/sim/economy';
import { addToStorage, collectNest, layEgg, takeFromStorage } from '../src/sim/eggs';
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
} from '../src/sim/market';
import { FEED_REACH, feedLayout, feedPose } from '../src/sim/feeding';
import { updateVaults, vaultOf } from '../src/sim/vault';
import { buildingsOf, coopCapacity, coopOccupancy, flockCapacity, landCapacity, storageCapacity, storedCount } from '../src/sim/queries';
import { advance, advanceRealtime, canSkipNight, closeDay, dailyCharges, simulateOffline, skipNight, step } from '../src/sim/simulation';
import { createNewGame } from '../src/sim/state';
import { newFarm } from '../src/sim/starter';
import { creditLimit, dailyDue, loanRate, pauseLoan, quoteLoan, repayLoan, takeLoan } from '../src/sim/bank';
import type { GameState } from '../src/sim/types';
import { goodPlayer, guard, lazyPlayer } from '../scripts/bot';
import { hire } from '../src/sim/workers';
import { distanceToFarm, shootPredator, spawnPredator } from '../src/sim/predators';
import { buyDog } from '../src/sim/dog';
import { crowdedChicks, eggHatchIn, fertileStock, fertility, incubateAll, loadIncubator, nurseryRoom } from '../src/sim/breeding';
import { ageFactor, createHen, eggsPerDayOf, henValue, productivity, refreshVitals, wellbeingTarget } from '../src/sim/hens';
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
  const placeIncubator = (s: GameState) => {
    for (let z = 20; z < 30; z++) for (let x = 10; x < 20; x++) if (A.build(s, 'incubator', x, z).ok) return buildingsOf(s, 'incubator')[0];
    throw new Error('aucune place pour la couveuse');
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
  it('commence avec Cocotte, trois poussins, un coq et une couveuse offerte', () => {
    const s = newFarm(5);
    expect(s.hens.filter((h) => !h.rooster && !h.young).map((h) => h.name)).toEqual(['Cocotte']);
    expect(s.hens.filter((h) => h.young)).toHaveLength(3);
    expect(s.hens.filter((h) => h.rooster && !h.young)).toHaveLength(1);
    const inc = buildingsOf(s, 'incubator');
    expect(inc).toHaveLength(1);
    expect(inc[0].invested).toBe(0);
    expect(fertility(s)).toBeGreaterThan(0.8);
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
    for (let z = 20; z < 30 && !buildingsOf(s, 'incubator').length; z++) for (let x = 10; x < 20; x++) if (A.build(s, 'incubator', x, z).ok) break;
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
      ['drinker', 1],
      ['drinker', 2],
      ['drinker', 3],
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
    expect(BUILDINGS.storage.levels.map((l) => l.capacity)).toEqual([100, 350, 900, 2500]);
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
    run(s, DELIVERY.delay + 1);
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
