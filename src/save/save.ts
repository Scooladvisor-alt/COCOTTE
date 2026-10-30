// Sauvegarde locale robuste : double emplacement (principal + secours), versionnage,
// et assainissement complet des données lues (valeurs manquantes, corrompues ou obsolètes).
import { DELIVERY, EGG_ORDER, EGG_TYPES, GRAIN_BINS, GRID_H, GRID_W, GRID_Z0, GRID_Z1, SAVE_VERSION, WATER, WATER_TANKS, WORLD, clamp } from '../config/balance';
import { BREEDS } from '../config/breeds';
import { BUILDINGS } from '../config/buildings';
import { MISSIONS } from '../config/missions';
import { invalidateLayout } from '../sim/core';
import { createNewGame, makeBuilding } from '../sim/state';
import type { BreedId, Building, Delivery, BuildingType, EggType, GameState, Grade, Hen, HenAct, Worker, WorkerRole } from '../sim/types';
import { ROLES } from '../config/staff';
import { createWorker } from '../sim/workers';
import { autoEnclose } from '../sim/fences';
import { refitCoops, refitStorage } from '../sim/buildings';
import { decodeGenes } from '../sim/genetics';

export const SAVE_KEY = 'cocotte-co.save';
export const BACKUP_KEY = 'cocotte-co.save.backup';

export interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function store(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function serialize(s: GameState): string {
  s.savedAt = Date.now();
  // l'herbe n'a pas besoin de plus de 3 décimales : sauvegarde 3× plus légère
  return JSON.stringify({ ...s, customers: [], predators: [], grass: s.grass.map((g) => Math.round(g * 1000) / 1000) });
}

export function saveGame(s: GameState, st: Storage | null = store()): boolean {
  if (!st) return false;
  try {
    const json = serialize(s);
    const prev = st.getItem(SAVE_KEY);
    if (prev) st.setItem(BACKUP_KEY, prev);
    st.setItem(SAVE_KEY, json);
    return true;
  } catch {
    return false;
  }
}

export function hasSave(st: Storage | null = store()) {
  try {
    return !!st?.getItem(SAVE_KEY) || !!st?.getItem(BACKUP_KEY);
  } catch {
    return false;
  }
}

export function loadGame(st: Storage | null = store()): { state: GameState; source: 'main' | 'backup' } | null {
  if (!st) return null;
  for (const [key, source] of [
    [SAVE_KEY, 'main'],
    [BACKUP_KEY, 'backup'],
  ] as const) {
    try {
      const raw = st.getItem(key);
      if (!raw) continue;
      const state = deserialize(raw);
      if (state) return { state, source };
    } catch {
      /* on essaie la sauvegarde suivante */
    }
  }
  return null;
}

export function deleteSave(st: Storage | null = store()) {
  try {
    st?.removeItem(SAVE_KEY);
    st?.removeItem(BACKUP_KEY);
  } catch {
    /* ignore */
  }
}

export function deserialize(json: string): GameState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  return sanitize(raw);
}

// ------------------------------------------------------------ Migration ----
type Raw = Record<string, unknown>;
function migrate(raw: Raw): Raw {
  const v = typeof raw.version === 'number' ? raw.version : 0;
  // v0 -> v1 : aucune différence structurelle connue, champ version ajouté
  if (v < 1) raw.version = 1;
  // v2 -> v3 : la musique d'ambiance arrive, activée par défaut
  if (v < 3 && raw.settings && typeof raw.settings === 'object') (raw.settings as Raw).music = true;
  // v4 -> v5 : plus de textes au-dessus des éléments par défaut (affichage épuré)
  if (v < 5 && raw.settings && typeof raw.settings === 'object') (raw.settings as Raw).labels = false;
  // v6 -> v7 : parcelles de 20 × 20 (au lieu de 10 × 10) et grille étendue vers le nord (z ≥ -30).
  // Les positions ne bougent pas ; chaque ancienne parcelle devient la (ou les) grande(s) parcelle(s)
  // qui la recouvrent, et la carte de l'herbe est recopiée à sa place dans la nouvelle grille.
  if (v < 7) {
    const keys = new Set<string>();
    for (const k of arr(raw.parcels)) {
      if (typeof k !== 'string' || !/^\d+,\d+$/.test(k)) continue;
      const [c, r] = k.split(',').map(Number);
      for (const x of [c * 10, c * 10 + 9])
        for (const z of [r * 10, r * 10 + 9]) keys.add(`${Math.floor(x / WORLD.PARCEL)},${Math.floor((z - GRID_Z0) / WORLD.PARCEL)}`);
    }
    raw.parcels = [...keys];
    const old = arr(raw.grass);
    if (old.length === 40 * 30) {
      const g: unknown[] = new Array(GRID_W * GRID_H).fill(0.85);
      old.forEach((v, i) => {
        const x = i % 40;
        const z = Math.floor(i / 40);
        g[(z - GRID_Z0) * GRID_W + x] = v;
      });
      raw.grass = g;
    }
    raw.fenceH = [];
    raw.fenceV = [];
  }
  return raw;
}

// ------------------------------------------------------- Assainissement ----
const num = (v: unknown, def: number, min = -Infinity, max = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : def;
const int = (v: unknown, def: number, min = -Infinity, max = Infinity) => Math.round(num(v, def, min, max));
const str = (v: unknown, def: string, maxLen = 40) => (typeof v === 'string' && v.length > 0 ? v.slice(0, maxLen) : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// 'enter', 'exit', 'flee' et 'caught' sont des états transitoires : la poule repart de « idle »
const HEN_ACTS: HenAct[] = ['idle', 'walk', 'peck', 'scratch', 'preen', 'flap', 'rest', 'goEat', 'eat', 'goDrink', 'drink', 'goNest', 'lay', 'goBath', 'bathe', 'goCoop', 'sleep', 'wait'];
const GRADES: Grade[] = ['extra', 'A', 'B'];

export function sanitize(input: unknown): GameState | null {
  if (!input || typeof input !== 'object') return null;
  const raw = migrate(input as Raw);
  if (typeof raw.version === 'number' && raw.version > SAVE_VERSION + 5) return null;
  const fromVersion = typeof raw.version === 'number' ? raw.version : 0;
  const s = createNewGame(int(raw.seed, 12345) >>> 0);
  s.buildings = [];
  s.fenceH.fill(0);
  s.fenceV.fill(0);
  s.farmName = str(raw.farmName, s.farmName, 32);
  s.rng = int(raw.rng, s.rng);
  const clock = obj(raw.clock);
  s.clock.t = num(clock.t, s.clock.t, 0);
  s.clock.speed = [0, 1, 3, 10].includes(clock.speed as number) ? (clock.speed as number) : 1;
  s.clock.lastClosedDay = int(clock.lastClosedDay, Math.floor(s.clock.t / 180), 0);
  s.clock.lastContractDay = int(clock.lastContractDay, 0, 0);
  s.clock.lastHourTick = int(clock.lastHourTick, Math.floor(s.clock.t / 7.5), 0);
  s.money = int(raw.money, s.money, -1e9, 1e12);
  s.xp = int(raw.xp, 0, 0, 1e9);
  s.reputation = num(raw.reputation, s.reputation, 0, 100);
  s.grain = num(raw.grain, s.grain, 0, 1e7);
  s.water = num(raw.water, WATER.start, 0, 1e7);
  s.grainBin = int(raw.grainBin, 1, 1, GRAIN_BINS.length);
  s.waterTank = int(raw.waterTank, 1, 1, WATER_TANKS.length);
  // une ancienne partie peut contenir plus de grain que la réserve de base : on l'agrandit d'office
  while (s.grainBin < GRAIN_BINS.length && s.grain > GRAIN_BINS[s.grainBin - 1].capacity) s.grainBin++;
  s.grain = Math.min(s.grain, GRAIN_BINS[s.grainBin - 1].capacity);
  while (s.waterTank < WATER_TANKS.length && s.water > WATER_TANKS[s.waterTank - 1].capacity) s.waterTank++;
  s.water = Math.min(s.water, WATER_TANKS[s.waterTank - 1].capacity);
  const usage = obj(raw.usage);
  s.usage = {
    day: int(usage.day, 1, 0),
    grain: num(usage.grain, 0, 0, 1e7),
    water: num(usage.water, 0, 0, 1e7),
    lastGrain: num(usage.lastGrain, -1, -1, 1e7),
    lastWater: num(usage.lastWater, -1, -1, 1e7),
  };

  // Parcelles
  const parcels = arr(raw.parcels).filter(
    (k): k is string => typeof k === 'string' && /^\d+,\d+$/.test(k) && Number(k.split(',')[0]) < WORLD.COLS && Number(k.split(',')[1]) < WORLD.ROWS,
  );
  s.parcels = [...new Set([WORLD.START_PARCEL, ...parcels])];

  // Clôture : toujours posée d'office autour du terrain (les grillages posés à la main ne sont plus gardés)
  autoEnclose(s);

  // Herbe
  const grass = arr(raw.grass);
  if (grass.length === GRID_W * GRID_H) s.grass = grass.map((g) => num(g, 0.8, 0, 1));

  // race d'un œuf fécondé (absente sinon)
  // œuf fécondé : race et qualités héritées du futur poussin (absentes sinon)
  const fert = (v: unknown, g?: unknown) =>
    typeof v === 'string' && BREEDS[v as BreedId] ? { fertile: v as BreedId, ...(typeof g === 'string' && decodeGenes(g) ? { genes: g } : {}) } : {};

  // Bâtiments
  for (const rb of arr(raw.buildings)) {
    const b = obj(rb);
    const type = b.type as BuildingType;
    if (!BUILDINGS[type]) continue;
    const def = BUILDINGS[type];
    const nb: Building = makeBuilding(int(b.id, s.nextId++), type, int(b.x, 0, -5, GRID_W + 5), int(b.z, 0, GRID_Z0 - 5, GRID_Z1 + 10));
    nb.level = int(b.level, 1, 1, def.levels.length);
    const cap = def.levels[nb.level - 1].capacity;
    nb.stock = num(b.stock, nb.stock, 0, cap);
    nb.cleanliness = num(b.cleanliness, 100, 0, 100);
    nb.closed = type === 'coop' && bool(b.closed, false);
    nb.invested = int(b.invested, 0, 0, 1e10);
    nb.builtAt = num(b.builtAt, 0);
    nb.eggIds = [];
    if (type === 'incubator') {
      nb.auto = bool(b.auto, true);
      nb.hatch = arr(b.hatch)
        .map((re) => {
          const e = obj(re);
          return { breed: e.breed as BreedId, t: num(e.t, 0), ok: bool(e.ok, true), ...(typeof e.genes === 'string' && decodeGenes(e.genes) ? { genes: e.genes } : {}) };
        })
        .filter((e) => !!BREEDS[e.breed])
        .slice(0, cap);
    }
    if (s.buildings.some((o) => o.id === nb.id)) nb.id = 100000 + s.buildings.length;
    if (def.unique && s.buildings.some((o) => o.type === type)) continue;
    s.buildings.push(nb);
  }
  const ref = createNewGame(1);
  for (const t of ['storage', 'stand', 'coop'] as BuildingType[]) {
    if (!s.buildings.some((b) => b.type === t)) {
      const d = ref.buildings.find((b) => b.type === t)!;
      s.buildings.push({ ...d, id: 200000 + s.buildings.length });
    }
  }

  // Poules
  const coops = s.buildings.filter((b) => b.type === 'coop');
  for (const rh of arr(raw.hens)) {
    const h = obj(rh);
    // l'Isa Brown, d'abord race à part, est devenue un plumage de la Rousse des prés
    const wasIsa = h.breed === 'isa';
    const breed = (wasIsa ? 'rousse' : h.breed) as Hen['breed'];
    if (!BREEDS[breed]) continue;
    const coopId = coops.some((c) => c.id === h.coopId) ? (h.coopId as number) : coops[0].id;
    const hen: Hen = {
      id: int(h.id, 0),
      name: str(h.name, 'Poulette', 18),
      breed,
      age: num(h.age, 0, 0, 5000),
      health: num(h.health, 80, 0, 100),
      satiety: num(h.satiety, 70, 0, 100),
      hydration: num(h.hydration, 70, 0, 100),
      wellbeing: num(h.wellbeing, 60, 0, 100),
      protein: num(h.protein, 0, 0, 100),
      layProgress: num(h.layProgress, 0, 0, 1.5),
      eggsLaid: int(h.eggsLaid, 0, 0),
      coopId,
      sick: bool(h.sick, false),
      dayBought: int(h.dayBought, 1, 0),
      x: num(h.x, 14.5, 0, GRID_W),
      z: num(h.z, 28, GRID_Z0, GRID_Z1),
      heading: num(h.heading, 0),
      act: HEN_ACTS.includes(h.act as HenAct) ? (h.act as HenAct) : 'idle',
      actT: num(h.actT, 0, 0, 60),
      tx: num(h.tx, 14.5),
      tz: num(h.tz, 28),
      targetId: int(h.targetId, -1),
      ox: num(h.ox, 0, -1, 1),
      oz: num(h.oz, 0, -1, 1),
      thinkT: num(h.thinkT, 0, 0, 5),
    };
    if (bool(h.rooster, false)) hen.rooster = true;
    if (hen.rooster && bool(h.black, false)) hen.black = true;
    if (!hen.rooster && bool(h.golden, false)) hen.golden = true;
    if (hen.rooster && bool(h.ranked, false)) hen.ranked = true;
    const skin = wasIsa ? 3 : int(h.skin, 0, 0, Math.max(0, (BREEDS[breed].skins?.length ?? 1) - 1));
    if (skin > 0) hen.skin = skin;
    const g = obj(h.genes);
    // anciennes sauvegardes : 3 étoiles partout
    hen.genes = { p: int(g.p, 3, 1, 5), r: int(g.r, 3, 1, 5), b: int(g.b, 3, 1, 5) };
    const young = num(h.young, 0, 0, 365);
    if (young > 0) hen.young = young;
    s.hens.push(hen);
  }

  // Œufs dans le monde (et cohérence avec les pondoirs)
  const seen = new Set<number>();
  for (const re of arr(raw.worldEggs)) {
    const e = obj(re);
    const type = e.type as EggType;
    if (!EGG_ORDER.includes(type)) continue;
    const id = int(e.id, -1);
    if (id < 0 || seen.has(id)) continue;
    seen.add(id);
    const nest = s.buildings.find((b) => b.id === e.nestId && b.type === 'nest');
    const where = e.where === 'nest' && nest ? 'nest' : 'ground';
    s.worldEggs.push({
      id,
      type,
      quality: num(e.quality, 0.6, 0, 1),
      freshness: num(e.freshness, 80, 0, 100),
      where,
      nestId: where === 'nest' ? nest!.id : -1,
      x: num(e.x, 14.5, -2, GRID_W + 2),
      z: num(e.z, 25, GRID_Z0 - 2, GRID_Z1 + 2),
      laidAt: num(e.laidAt, 0),
      ...fert(e.fertile, e.genes),
    });
    if (where === 'nest') nest!.eggIds.push(id);
  }

  // Lots stockés
  for (const rl of arr(raw.lots)) {
    const l = obj(rl);
    const type = l.type as EggType;
    const grade = l.grade as Grade;
    const count = int(l.count, 0, 0, 1e6);
    if (!EGG_ORDER.includes(type) || !GRADES.includes(grade) || count <= 0) continue;
    s.lots.push({ id: int(l.id, 0), type, grade, count, freshness: num(l.freshness, 80, 0, 100), day: int(l.day, 1), ...fert(l.fertile, l.genes) });
  }

  // Prix et marché
  const prices = obj(raw.prices);
  for (const t of EGG_ORDER) s.prices[t] = int(prices[t], s.prices[t], 1, 100000);
  s.prices.or = int(prices.or, EGG_TYPES.or.ref, 5000, 40000);
  const market = obj(raw.market);
  const trend = obj(market.trend);
  for (const t of EGG_ORDER) s.market.trend[t] = num(trend[t], 1, 0.5, 2);
  s.market.grainIndex = num(market.grainIndex, 1, 0.5, 2);
  s.market.palletDay = int(market.palletDay, 0);
  s.market.pallets = int(market.pallets, 0, 0, 100);
  const vel = obj(market.vel);
  s.market.vel = Object.fromEntries(EGG_ORDER.map((t) => [t, num(vel[t], 0, -0.2, 0.2)]));
  s.market.history = arr(market.history)
    .map((rh) => {
      const h = obj(rh);
      const p = arr(h.p).map((v) => int(v, 0, 0, 100000));
      // un type d'œuf ajouté depuis (œuf d'oie) : on complète l'historique avec son prix de référence
      while (p.length < EGG_ORDER.length) p.push(EGG_TYPES[EGG_ORDER[p.length]].ref);
      return { d: int(h.d, 1, 0), p };
    })
    .filter((h) => h.p.length === EGG_ORDER.length)
    .slice(-60);

  // Commandes et contrats (les clients de passage ne sont pas restaurés)
  for (const ro of arr(raw.orders)) {
    const o = obj(ro);
    if (!EGG_ORDER.includes(o.type as EggType)) continue;
    if (!['offer', 'active'].includes(o.status as string)) continue;
    s.orders.push({
      id: int(o.id, 0),
      client: str(o.client, 'Client', 40),
      type: o.type as EggType,
      qty: int(o.qty, 12, 1, 10000),
      minGrade: GRADES.includes(o.minGrade as Grade) ? (o.minGrade as Grade) : 'A',
      unitPrice: int(o.unitPrice, 100, 1, 100000),
      deadlineDay: int(o.deadlineDay, 1),
      status: o.status as 'offer' | 'active',
      offerUntilDay: int(o.offerUntilDay, 1),
      ready: bool(o.ready, false),
    });
  }
  for (const rc of arr(raw.contracts)) {
    const c = obj(rc);
    if (!EGG_ORDER.includes(c.type as EggType)) continue;
    if (!['offer', 'active'].includes(c.status as string)) continue;
    s.contracts.push({
      id: int(c.id, 0),
      client: str(c.client, 'Client', 40),
      type: c.type as EggType,
      qtyPerDay: int(c.qtyPerDay, 6, 1, 10000),
      unitPrice: int(c.unitPrice, 100, 1, 100000),
      days: int(c.days, 7, 1, 100),
      daysLeft: int(c.daysLeft, 7, 0, 100),
      status: c.status as 'offer' | 'active',
      missed: int(c.missed, 0, 0),
      delivered: int(c.delivered, 0, 0),
      offerUntilDay: int(c.offerUntilDay, 1),
      ...(typeof c.lastDay === 'number' ? { lastDay: int(c.lastDay, 0) } : {}),
    });
  }

  // Personnel (v2) — ou migration des anciens commis/vendeur abstraits (v1)
  for (const rw of arr(raw.workers)) {
    const w = obj(rw);
    const role = w.role as WorkerRole;
    if (!ROLES[role]) continue;
    const nw = createWorker(s, role);
    nw.id = int(w.id, nw.id);
    nw.name = str(w.name, nw.name, 20);
    nw.look = int(w.look, nw.look, 0, 100000);
    nw.hiredDay = int(w.hiredDay, 1);
    const basket = arr(w.basket)
      .map((rl) => {
        const l = obj(rl);
        return { type: l.type as EggType, grade: l.grade as Grade, freshness: num(l.freshness, 80, 0, 100), count: int(l.count, 0, 0, 1000), ...fert(l.fertile, l.genes) };
      })
      .filter((l) => EGG_ORDER.includes(l.type) && GRADES.includes(l.grade) && l.count > 0);
    nw.basket = basket;
    const tot = obj(w.total);
    for (const k of Object.keys(nw.total) as Array<keyof Worker['total']>) nw.total[k] = int(tot[k], 0, 0);
    s.workers.push(nw);
  }
  const staff = obj(raw.staff);
  if (!Array.isArray(raw.workers)) {
    if (bool(staff.farmhand, false)) s.workers.push(createWorker(s, 'farmhand'));
    if (bool(staff.seller, false)) s.workers.push(createWorker(s, 'seller'));
  }

  // Lots de poules en route
  for (const rd of arr(raw.deliveries).slice(0, 30)) {
    const d = obj(rd);
    if (!BREEDS[d.breed as BreedId]) continue;
    const count = int(d.count, 1, 1, 200);
    const eta = num(d.eta, s.clock.t, 0);
    const dl: Delivery = { id: int(d.id, s.nextId++), breed: d.breed as BreedId, count, eta, slot: int(d.slot, 0, 0, DELIVERY.slots - 1), wave: int(d.wave, 0, 0), out: int(d.out, 0, 0, count) };
    if (d.leave !== undefined) dl.leave = num(d.leave, eta, eta);
    s.deliveries.push(dl);
  }
  // Œufs d'or en réserve
  s.goldEggs = int(raw.goldEggs, 0, 0, 100000);

  // Robots ramasseurs
  for (const rr of arr(raw.robots).slice(0, 60)) {
    const r = obj(rr);
    s.robots.push({
      id: int(r.id, s.nextId++),
      x: num(r.x, 18, -2, GRID_W + 2),
      z: num(r.z, 23, GRID_Z0 - 2, GRID_Z1 + 2),
      heading: num(r.heading, 0),
      battery: num(r.battery, 100, 0, 100),
      hopper: arr(r.hopper)
        .map((rl) => {
          const l = obj(rl);
          return { type: l.type as EggType, grade: l.grade as Grade, freshness: num(l.freshness, 80, 0, 100), count: int(l.count, 0, 0, 1000), ...fert(l.fertile, l.genes) };
        })
        .filter((l) => EGG_ORDER.includes(l.type) && GRADES.includes(l.grade) && l.count > 0),
      task: 'idle',
      target: -1,
      tx: 0,
      tz: 0,
      path: [],
      total: int(r.total, 0, 0),
      boughtDay: int(r.boughtDay, 1),
    });
  }

  // Chien de garde
  // Prêts en cours
  s.loans = arr(raw.loans)
    .map((rl) => {
      const l = obj(rl);
      const days = [7, 14, 28].includes(int(l.days, 7)) ? int(l.days, 7) : 7;
      return {
        id: int(l.id, s.nextId++),
        principal: int(l.principal, 0, 0, 1e9),
        rate: num(l.rate, 0.08, 0, 1),
        days,
        daily: int(l.daily, 0, 0, 1e9),
        paid: int(l.paid, 0, 0, days),
        capitalLeft: int(l.capitalLeft, 0, 0, 1e9),
        interestLeft: int(l.interestLeft, 0, 0, 1e9),
        day: int(l.day, 1, 0),
        ...(int(l.pausedUntil, 0, 0) > 0 ? { pausedUntil: int(l.pausedUntil, 0, 0) } : {}),
        ...(bool(l.paused, false) ? { paused: true } : {}),
      };
    })
    .filter((l) => l.principal > 0 && l.capitalLeft + l.interestLeft > 0 && l.paid < l.days)
    .slice(0, 5);

  // Concours agricole
  const sh = obj(raw.show);
  s.show = {
    tier: int(sh.tier, 0, 0, 4),
    entryId: int(sh.entryId, -1),
    lastDay: int(sh.lastDay, 0, 0),
    remindDay: int(sh.remindDay, 0, 0),
    trophies: arr(sh.trophies)
      .map((rt) => {
        const t = obj(rt);
        return { day: int(t.day, 1, 0), tier: int(t.tier, 0, 0, 4), place: int(t.place, 3, 1, 3), hen: str(t.hen, 'Poule', 18), breed: t.breed as BreedId };
      })
      .filter((t) => !!BREEDS[t.breed])
      .slice(-60),
  };

  if (raw.dog && typeof raw.dog === 'object') {
    const d = obj(raw.dog);
    s.dog = { name: str(d.name, 'Rex', 16), x: num(d.x, 15, -2, GRID_W + 2), z: num(d.z, 25, GRID_Z0 - 2, GRID_Z1 + 2), heading: num(d.heading, 0), act: 'sit', t: 1, path: [], spd: 0, boughtDay: int(d.boughtDay, 1) };
  }

  // Finances
  const fin = obj(raw.finance);
  s.finance.days = arr(fin.days)
    .map((rd) => {
      const d = obj(rd);
      const clean = (o: unknown) => Object.fromEntries(Object.entries(obj(o)).filter(([, v]) => typeof v === 'number' && Number.isFinite(v)));
      return {
        day: int(d.day, 1),
        income: clean(d.income),
        expense: clean(d.expense),
        cashStart: int(d.cashStart, 0),
        cashEnd: int(d.cashEnd, 0),
        debtEnd: int(d.debtEnd, 0, 0),
        ...(typeof d.eggs === 'number' ? { eggs: int(d.eggs, 0, 0) } : {}),
        ...(typeof d.laySum === 'number' && typeof d.layN === 'number' ? { laySum: num(d.laySum, 0, 0, 1e4), layN: int(d.layN, 0, 0, 1000) } : {}),
      };
    })
    .filter((d, i, all) => all.findIndex((x) => x.day === d.day) === i)
    .sort((a, b) => a.day - b.day)
    .slice(-40);
  s.finance.log = arr(fin.log)
    .map((rl) => {
      const l = obj(rl);
      return { day: int(l.day, 1), hour: num(l.hour, 0), label: str(l.label, '—', 60), amount: int(l.amount, 0), cat: str(l.cat, 'etal') as never };
    })
    .slice(0, 60);

  // Statistiques
  const st = obj(raw.stats);
  for (const k of Object.keys(s.stats) as Array<keyof GameState['stats']>) {
    const cur = s.stats[k];
    if (typeof cur === 'number') (s.stats as unknown as Raw)[k] = int(st[k], 0, 0);
    else if (typeof cur === 'boolean') (s.stats as unknown as Raw)[k] = bool(st[k], false);
    else (s.stats as unknown as Raw)[k] = Object.fromEntries(Object.entries(obj(st[k])).filter(([, v]) => typeof v === 'number'));
  }

  s.missionsDone = arr(raw.missionsDone).filter((x): x is string => typeof x === 'string');
  // mission en cours : la première pas encore accomplie (de nouvelles missions peuvent avoir été ajoutées)
  const done = new Set(s.missionsDone);
  const firstOpen = MISSIONS.findIndex((m) => !done.has(m.id));
  s.missionIndex = done.size ? (firstOpen < 0 ? MISSIONS.length : firstOpen) : int(raw.missionIndex, 0, 0, MISSIONS.length);
  const tut = obj(raw.tutorial);
  s.tutorial = { step: int(tut.step, 0, 0, 50), done: bool(tut.done, false) };
  const set = obj(raw.settings);
  s.settings = {
    sound: bool(set.sound, true),
    music: bool(set.music, true),
    musicVolume: num(set.musicVolume, 0.5, 0, 1),
    offline: bool(set.offline, true),
    autoGrain: bool(set.autoGrain, false),
    autoGrainThreshold: int(set.autoGrainThreshold, 20, 0, 5000),
    autoGrainSack: str(set.autoGrainSack, 'small', 12),
    autoWater: bool(set.autoWater, false),
    staffRestock: bool(set.staffRestock, true),
    autoWaterThreshold: int(set.autoWaterThreshold, 25, 0, 100),
    autoWholesale: bool(set.autoWholesale, false),
    autoWholesaleThreshold: int(set.autoWholesaleThreshold, 120, 0, 100000),
    labels: bool(set.labels, false),
    predators: bool(set.predators, true),
    predatorSlowdown: bool(set.predatorSlowdown, true),
  };
  s.lastPredatorT = num(raw.lastPredatorT, 0, 0, s.clock.t);
  s.savedAt = num(raw.savedAt, Date.now());
  s.unlockedSeen = arr(raw.unlockedSeen).filter((x): x is string => typeof x === 'string');

  // Identifiants : le prochain doit dépasser tous ceux existants
  let maxId = int(raw.nextId, 1, 1);
  for (const x of [...s.hens, ...s.buildings, ...s.worldEggs, ...s.lots, ...s.orders, ...s.contracts, ...s.workers, ...s.robots, ...s.loans]) maxId = Math.max(maxId, x.id + 1);
  s.nextId = maxId;
  // v7 -> v8 : poulaillers deux fois plus grands, reposés là où ils tiennent
  if (fromVersion < 8) refitCoops(s);
  // v8 -> v9 : réserve à œufs deux fois plus grande
  if (fromVersion < 9) refitStorage(s);
  s.version = SAVE_VERSION;
  invalidateLayout(s);
  return s;
}
