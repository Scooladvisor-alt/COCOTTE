import { EGG_ORDER, EGG_TYPES, GRASS, GRID_H, GRID_W, GRID_Z0, HOUR, SAVE_VERSION, START, TIME, WATER, WORLD } from '../config/balance';
import { BUILDINGS, STAND_POS } from '../config/buildings';
import type { Building, BuildingType, EggType, GameState } from './types';
import { autoEnclose } from './fences';

export function makeBuilding(id: number, type: BuildingType, x: number, z: number, t = 0): Building {
  const lvl = BUILDINGS[type].levels[0];
  return {
    id,
    type,
    level: 1,
    x,
    z,
    stock: type === 'feeder' || type === 'drinker' || type === 'pond' ? lvl.capacity : type === 'compost' ? lvl.capacity * 0.5 : 0,
    cleanliness: 100,
    closed: false,
    eggIds: [],
    invested: lvl.cost,
    builtAt: t,
  };
}

export function defaultPrices(): Record<EggType, number> {
  const p = {} as Record<EggType, number>;
  for (const t of EGG_ORDER) p[t] = EGG_TYPES[t].ref;
  return p;
}
export function defaultTrend(): Record<EggType, number> {
  const p = {} as Record<EggType, number>;
  for (const t of EGG_ORDER) p[t] = 1;
  return p;
}

export function createNewGame(seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0): GameState {
  const t0 = TIME.START_HOUR * HOUR;
  const s: GameState = {
    version: SAVE_VERSION,
    farmName: 'Ferme des Coquelicots',
    seed,
    rng: seed | 0,
    nextId: 1,
    clock: { t: t0, speed: 1, lastClosedDay: 0, lastContractDay: 0, lastHourTick: Math.floor(t0 / HOUR) },
    money: START.money,
    xp: 0,
    reputation: START.reputation,
    grain: START.grain,
    water: WATER.start,
    grainBin: 1,
    waterTank: 1,
    usage: { day: 1, grain: 0, water: 0, lastGrain: -1, lastWater: -1 },
    hens: [],
    buildings: [],
    worldEggs: [],
    lots: [],
    parcels: [WORLD.START_PARCEL],
    grass: [],
    prices: defaultPrices(),
    market: { trend: defaultTrend(), grainIndex: 1, palletDay: 0, pallets: 0 },
    customers: [],
    orders: [],
    contracts: [],
    workers: [],
    predators: [],
    lastPredatorT: 0,
    fenceH: new Array(GRID_W * (GRID_H + 1)).fill(0),
    fenceV: new Array((GRID_W + 1) * GRID_H).fill(0),
    robots: [],
    deliveries: [],
    dog: null,
    loans: [],
    show: { tier: 0, entryId: -1, lastDay: 0, remindDay: 0, trophies: [] },
    finance: { days: [], log: [] },
    stats: {
      eggsLaid: 0,
      eggsCollected: 0,
      eggsSold: 0,
      eggsSpoiled: 0,
      eggsLost: 0,
      salesRevenue: 0,
      totalIncome: 0,
      totalExpense: 0,
      customersServed: 0,
      customersLost: 0,
      ordersDelivered: 0,
      ordersFailed: 0,
      contractsCompleted: 0,
      hensBought: 0,
      hensDied: 0,
      hensSold: 0,
      hensRehomed: 0,
      coopsCleaned: 0,
      feederFills: 0,
      hensTaken: 0,
      predatorsKilled: 0,
      eggsRotten: 0,
      hensEscaped: 0,
      chicksHatched: 0,
      roostersBought: 0,
      showsEntered: 0,
      showsWon: 0,
      grainBought: 0,
      priceSet: false,
      soldByType: {},
      boughtBreeds: {},
    },
    missionIndex: 0,
    missionsDone: [],
    tutorial: { step: 0, done: false },
    settings: {
      sound: true,
      music: true,
      musicVolume: 0.5,
      offline: true,
      autoGrain: false,
      autoGrainThreshold: 20,
      autoGrainSack: 'small',
      autoWater: false,
      staffRestock: true,
      autoWaterThreshold: 25,
      autoWholesale: false,
      autoWholesaleThreshold: 120,
      labels: false,
      predators: true,
      predatorSlowdown: true,
    },
    savedAt: Date.now(),
    unlockedSeen: [],
  };

  // Herbe : légère variation naturelle
  s.grass = new Array(GRID_W * GRID_H);
  for (let i = 0; i < s.grass.length; i++) {
    const x = i % GRID_W;
    const z = Math.floor(i / GRID_W) + GRID_Z0;
    const n = Math.sin(x * 0.7 + seed * 0.001) * Math.cos(z * 0.6) * 0.04;
    s.grass[i] = Math.min(1, Math.max(0.5, GRASS.start + n));
  }

  // Installations de départ dans la parcelle (0,2) : x 0..19, z 10..29 (la cour est en bas, près de la route)
  const add = (type: BuildingType, x: number, z: number) => {
    const b = makeBuilding(s.nextId++, type, x, z, t0);
    s.buildings.push(b);
    return b;
  };
  add('coop', 5, 19);
  add('nest', 15, 21);
  add('storage', 17, 21);
  add('feeder', 12, 26);
  add('drinker', 16, 26);
  const stand = add('stand', Math.floor(STAND_POS.x), Math.floor(STAND_POS.z));
  stand.invested = 0;
  // Les installations offertes ne sont pas remboursables à la démolition
  for (const b of s.buildings) b.invested = 0;
  // la ferme est clôturée d'office
  autoEnclose(s);
  return s;
}
