// Le marché : clients de l'étal, coopérative, commandes et contrats.
import {
  CONTRACTS,
  EGG_ORDER,
  EGG_TYPES,
  GRADES,
  GRADE_RANK,
  HOUR,
  MARKET,
  ORDERS,
  REPUTATION,
  TIME,
  UNLOCKS,
  WORLD,
  RARE,
  XP,
  clamp,
  freshnessFactor,
  tradeAt,
} from '../config/balance';
import { BREEDS } from '../config/breeds';
import { STAND_POS } from '../config/buildings';
import { currentDay, currentHour, emit, isShopOpen, newId, notify, pick, rand, randInt, randNormal, randRange } from './core';
import { addXp, earn, farmLevel, fmtMoney, spend } from './economy';
import { oldestLot, takeFromStorage } from './eggs';
import { eggsPerDayOf } from './hens';
import { lvl, stand, storedCount } from './queries';
import { sellerAtStand } from './workers';
import { STAFF } from '../config/staff';
import type { Contract, Customer, EggType, GameState, Grade, Order } from './types';
import { seasonalPrice } from './seasons';


/** Note le cours du jour (une entrée par jour, 60 jours gardés) : sert à tracer la courbe du marché. */
export function recordMarket(s: GameState) {
  const h = (s.market.history ??= []);
  const d = currentDay(s);
  const entry = { d, p: EGG_ORDER.map((t) => refPrice(s, t)) };
  if (h.length && h[h.length - 1].d === d) h[h.length - 1] = entry;
  else h.push(entry);
  if (h.length > 60) h.splice(0, h.length - 60);
}

export function refPrice(s: GameState, type: EggType) {
  // les œufs se font rares en hiver : les clients acceptent de payer plus cher
  return Math.round(EGG_TYPES[type].ref * (s.market.trend[type] ?? 1) * seasonalPrice(s));
}

function rep(s: GameState, delta: number) {
  s.reputation = clamp(s.reputation + delta, 0, 100);
}

// --------------------------------------------------------------- Étal ----
export function customersPerHour(s: GameState) {
  const st = stand(s);
  const flow = st ? lvl(st).flow ?? 0.9 : 0;
  return flow * MARKET.repFlow(s.reputation) * (sellerAtStand(s) ? STAFF.sellerFlow : 1);
}
export function customersPerDay(s: GameState) {
  return customersPerHour(s) * (TIME.SHOP_CLOSE - TIME.SHOP_OPEN);
}
const STAND_STOP_Z = STAND_POS.z + 1.25;

function spawnCustomer(s: GameState) {
  const dir: 1 | -1 = rand(s) < 0.5 ? 1 : -1;
  const c: Customer = {
    id: newId(s),
    kind: rand(s) < MARKET.gourmetShare ? 'gourmet' : 'classique',
    want: pick(s, MARKET.wantChoices),
    wtp: Math.exp(MARKET.wtpSigma * randNormal(s)),
    state: 'toStand',
    x: STAND_POS.x + 1 - dir * MARKET.spawnDistance,
    z: laneZ(dir) + randRange(s, -0.06, 0.06),
    dir,
    t: 0,
    mood: 'none',
    bought: 0,
    look: Math.floor(rand(s) * 1000),
    // une bonne réputation rend les clients plus patients ; les gourmets attendent volontiers
    patience: randRange(s, MARKET.patience[0], MARKET.patience[1]) * (0.8 + 0.4 * (s.reputation / 100)),
    wait: 0,
    counter: -1,
  };
  if (c.kind === 'gourmet') c.patience! *= 1.2;
  s.customers.push(c);
}

/** Guichets ouverts à l'étal : un seul au départ, deux à la boutique de la ferme, un de plus avec un vendeur. */
export function standCounters(s: GameState) {
  const st = stand(s);
  if (!st) return 0;
  return (st.level >= 3 ? 2 : 1) + (sellerAtStand(s) ? 1 : 0);
}
/** Durée de service d'un client (le vendeur va plus vite). */
export const serveTime = (s: GameState, c?: Pick<Customer, 'want'>) => MARKET.shopTime * (0.7 + 0.05 * (c?.want ?? 6)) * (sellerAtStand(s) ? MARKET.sellerServe : 1);
/** Clients qui attendent leur tour (sans guichet attribué). */
export const queueLength = (s: GameState) => s.customers.filter((c) => c.state === 'queue' && (c.counter ?? -1) < 0).length;
/** Clients perdus aujourd'hui à cause de l'attente. */
export const lostToday = (s: GameState) => (s.market.lostDay === currentDay(s) ? s.market.lost ?? 0 : 0);

/** Un client renonce : file trop longue en arrivant, ou trop longue attente. */
function loseCustomer(s: GameState, c: Customer) {
  c.state = 'leaving';
  c.mood = 'impatient';
  c.t = 0;
  c.counter = -1;
  rep(s, REPUTATION.leftQueue);
  s.stats.customersLost++;
  const day = currentDay(s);
  if (s.market.lostDay !== day) {
    s.market.lostDay = day;
    s.market.lost = 0;
  }
  s.market.lost = (s.market.lost ?? 0) + 1;
  emit(s, { kind: 'customerMood', customerId: c.id, mood: c.mood });
}

/** Sert un client fictif tout de suite (tests). */
export function serveCustomerForTest(s: GameState) {
  serveCustomer(s, { id: -1, state: 'shopping', mood: 'happy', want: 6, wtp: 1, kind: 'classique' } as unknown as Customer);
}

/** Prix affiché de l'œuf d'or à l'étal. */
export const goldPrice = (s: GameState) => s.prices.or ?? RARE.goldEggPrice;

/** Chance qu'un client de l'étal achète un œuf d'or à ce prix (plus le prix est doux, plus il part vite). */
export function goldBuyChance(s: GameState, price: number) {
  const base = RARE.goldEggPrice * MARKET.repWtp(s.reputation);
  const x = price / base;
  return RARE.goldCustomerShare * (1 - normCdf(Math.log(x) / MARKET.wtpSigma));
}

/** Ventes d'œufs d'or attendues par jour à l'étal, à ce prix. */
export const goldDemand = (s: GameState, price: number) => customersPerDay(s) * goldBuyChance(s, price);

/** Prix de l'œuf d'or à l'étal : de 50 à 400 €. */
export function setGoldPrice(s: GameState, cents: number) {
  s.prices.or = Math.round(clamp(cents, 5000, 40000) / 100) * 100;
  s.stats.priceSet = true;
}

/** Position du guichet i (sur n) devant l'étal. */
const counterX = (i: number, n: number) => STAND_POS.x + 1 + (i - (n - 1) / 2) * 0.62;
/** Place k dans la file, le long du trottoir, à droite des guichets. */
const queueSpot = (k: number, n: number): [number, number] => [STAND_POS.x + 1 + n * 0.31 + 0.5 + k * 0.5, STAND_STOP_Z + 0.24];

interface Choice {
  type: EggType;
  utility: number;
  wtp: number;
}

/** Évalue ce que ferait un client face au stock et aux prix actuels. */
export function customerChoice(s: GameState, c: Pick<Customer, 'kind' | 'wtp'>): { best: Choice | null; anyStock: boolean } {
  let best: Choice | null = null;
  let anyStock = false;
  for (const type of EGG_ORDER) {
    const def = EGG_TYPES[type];
    if (c.kind === 'classique' && def.specialty) continue;
    const lot = oldestLot(s, type);
    if (!lot) continue;
    anyStock = true;
    const ref = refPrice(s, type);
    const bonus = c.kind === 'gourmet' && def.specialty ? MARKET.gourmetSpecialtyBonus : 1;
    const wtp = ref * c.wtp * MARKET.repWtp(s.reputation) * GRADES[lot.grade].mult * freshnessFactor(lot.freshness) * bonus * (sellerAtStand(s) ? STAFF.sellerWtp : 1);
    const utility = (wtp - s.prices[type]) / ref;
    if (!best || utility > best.utility) best = { type, utility, wtp };
  }
  return { best, anyStock };
}

function serveCustomer(s: GameState, c: Customer) {
  const { best, anyStock } = customerChoice(s, c);
  if (!anyStock || !best) {
    c.mood = 'empty';
    rep(s, REPUTATION.outOfStock);
  } else if (best.utility < 0) {
    c.mood = 'expensive';
    rep(s, REPUTATION.tooExpensive);
  } else {
    const st = stand(s);
    const want = Math.max(1, Math.round(c.want * (st ? lvl(st).qtyMult ?? 1 : 1)));
    const qty = Math.min(want, storedCount(s, best.type));
    const taken = takeFromStorage(s, best.type, qty);
    if (!taken) {
      c.mood = 'empty';
    } else {
      const price = s.prices[best.type];
      const amount = qty * price;
      earn(s, amount, 'etal', 'Ventes à l’étal');
      s.stats.eggsSold += qty;
      s.stats.soldByType[best.type] = (s.stats.soldByType[best.type] ?? 0) + qty;
      s.stats.customersServed++;
      const q = (taken.grades.extra * 1.5 + taken.grades.A + taken.grades.B * 0.5) / qty;
      rep(s, REPUTATION.sale * q);
      addXp(s, Math.floor(qty / 2) * XP.perTwoSold + (qty % 2 && rand(s) < 0.5 ? 1 : 0));
      c.mood = 'happy';
      c.bought = qty;
      emit(s, { kind: 'sale', amount, qty, x: STAND_POS.x + 1, z: STAND_POS.z, channel: 'etal' });
    }
  }
  // l'œuf d'or exposé sur l'étal : un client sur quelques dizaines craque, d'autant plus que le prix est doux
  if ((s.goldEggs ?? 0) > 0 && rand(s) < goldBuyChance(s, goldPrice(s))) {
    const price = goldPrice(s);
    s.goldEggs = (s.goldEggs ?? 0) - 1;
    s.stats.goldEggsSold = (s.stats.goldEggsSold ?? 0) + 1;
    earn(s, price, 'etal', 'Œuf d’or vendu à l’étal');
    addXp(s, 5);
    c.mood = 'happy';
    c.bought = (c.bought ?? 0) + 1;
    emit(s, { kind: 'sale', amount: price, qty: 1, x: STAND_POS.x + 1, z: STAND_POS.z, channel: 'etal' });
    notify(s, `Un client repart avec un œuf d’or : +${fmtMoney(price)} !`, 'good', '✨');
  }
  emit(s, { kind: 'customerMood', customerId: c.id, mood: c.mood });
}

/** Les passants marchent sur le trottoir, chaque sens de son côté : ils se croisent sans se traverser. */
const laneZ = (dir: 1 | -1) => WORLD.WALK_Z + (dir > 0 ? 0.25 : -0.25);

export function updateCustomers(s: GameState, dt: number) {
  const hour = currentHour(s);
  if (isShopOpen(hour) && stand(s)) {
    const lambda = customersPerHour(s) / HOUR;
    if (rand(s) < lambda * dt) spawnCustomer(s);
  }
  const speed = MARKET.walkSpeed;
  const n = Math.max(1, standCounters(s));
  // guichets libres : on appelle les suivants, dans l'ordre d'arrivée
  const busy = new Set(s.customers.filter((c) => (c.state === 'shopping' || c.state === 'queue') && (c.counter ?? -1) >= 0).map((c) => c.counter!));
  const waiting = s.customers.filter((c) => c.state === 'queue' && (c.counter ?? -1) < 0).sort((a, b) => (a.qt ?? 0) - (b.qt ?? 0));
  for (let i = 0; i < n && waiting.length; i++) {
    if (busy.has(i)) continue;
    const next = waiting.shift()!;
    next.counter = i;
    busy.add(i);
  }
  const walkTo = (c: Customer, x: number, z: number) => {
    const dx = x - c.x;
    const dz = z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.04) return true;
    const step = Math.min(d, speed * dt);
    c.x += (dx / d) * step;
    c.z += (dz / d) * step;
    return false;
  };
  for (const c of s.customers) {
    c.t += dt;
    if (c.state === 'toStand') {
      // il longe le trottoir jusqu'à l'étal ; en arrivant, il regarde la file
      const ex = STAND_POS.x + 1;
      if (Math.abs(c.x - ex) > 3) {
        c.x += Math.sign(ex - c.x) * Math.min(Math.abs(ex - c.x), speed * dt);
        c.z += (laneZ(c.dir) - c.z) * Math.min(1, dt * 2);
      } else if (queueLength(s) >= MARKET.maxQueue) {
        loseCustomer(s, c);
      } else {
        c.state = 'queue';
        c.qt = s.clock.t + c.id * 1e-6;
        c.wait = 0;
        c.counter = -1;
      }
    } else if (c.state === 'queue') {
      if ((c.counter ?? -1) >= 0) {
        if (walkTo(c, counterX(c.counter!, n), STAND_STOP_Z)) {
          c.state = 'shopping';
          c.t = 0;
          serveCustomer(s, c);
        }
      } else {
        c.wait = (c.wait ?? 0) + dt;
        if (c.wait > (c.patience ?? 12)) {
          loseCustomer(s, c);
          continue;
        }
        const k = waiting.indexOf(c);
        const [qx, qz] = queueSpot(Math.max(0, k), n);
        walkTo(c, qx, qz);
      }
    } else if (c.state === 'shopping') {
      if (c.t > serveTime(s, c)) {
        c.state = 'leaving';
        c.t = 0;
        c.counter = -1;
      }
    } else {
      const lz = laneZ(c.dir);
      if (Math.abs(c.z - lz) > 0.05) c.z += Math.sign(lz - c.z) * Math.min(Math.abs(lz - c.z), speed * dt);
      else c.x += c.dir * speed * dt;
    }
  }
  s.customers = s.customers.filter((c) => Math.abs(c.x - STAND_POS.x - 1) <= MARKET.spawnDistance + 1 && c.t < 120);
}

// ----------------------------------------------------- Estimations UI ----
function normCdf(x: number) {
  // approximation d'Abramowitz & Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Probabilité qu'un client (de passage) accepte un prix donné pour ce type d'œuf. */
export function buyProbability(s: GameState, type: EggType, price: number, grade: Grade = 'A', freshness = 90) {
  const def = EGG_TYPES[type];
  const ref = refPrice(s, type);
  const base = ref * MARKET.repWtp(s.reputation) * GRADES[grade].mult * freshnessFactor(freshness);
  const p = (bonus: number) => {
    const x = price / (base * bonus);
    if (x <= 0) return 1;
    return 1 - normCdf(Math.log(x) / MARKET.wtpSigma);
  };
  if (def.specialty) return MARKET.gourmetShare * p(MARKET.gourmetSpecialtyBonus);
  return p(1);
}

/** Demande estimée (œufs/jour) à ce prix si l'étal ne proposait que ce type. */
export function estimatedDemand(s: GameState, type: EggType, price: number) {
  const lot = oldestLot(s, type);
  const prob = buyProbability(s, type, price, lot?.grade ?? 'A', lot?.freshness ?? 90);
  const st = stand(s);
  const avgWant = MARKET.wantChoices.reduce((a, b) => a + b, 0) / MARKET.wantChoices.length;
  return customersPerDay(s) * prob * avgWant * (st ? lvl(st).qtyMult ?? 1 : 1);
}

export function dailyProduction(s: GameState, type?: EggType) {
  let n = 0;
  for (const h of s.hens) if (!h.golden && (!type || BREEDS[h.breed].egg === type)) n += eggsPerDayOf(h);
  return n;
}

export function setPrice(s: GameState, type: EggType, cents: number) {
  const ref = EGG_TYPES[type].ref;
  s.prices[type] = Math.round(clamp(cents, Math.round(ref * 0.3), ref * 4));
  s.stats.priceSet = true;
}

// --------------------------------------------------------- Coopérative ----
function gradeUnit(s: GameState, type: EggType, grade: Grade, freshness: number, factor: number) {
  return Math.max(1, Math.round(refPrice(s, type) * factor * GRADES[grade].mult * freshnessFactor(freshness)));
}

/** Devis sans modification de l'état (pour l'affichage). */
export function wholesaleQuote(s: GameState, type: EggType, qty: number, factor = MARKET.wholesaleFactor) {
  const lots = s.lots.filter((l) => l.type === type && l.count > 0).sort((a, b) => a.freshness - b.freshness);
  let left = qty;
  let total = 0;
  let n = 0;
  for (const l of lots) {
    if (left <= 0) break;
    const k = Math.min(l.count, left);
    total += k * gradeUnit(s, type, l.grade, l.freshness, factor);
    left -= k;
    n += k;
  }
  return { qty: n, total };
}

export function sellWholesale(s: GameState, type: EggType, qty: number, factor = MARKET.wholesaleFactor, label = 'Coopérative') {
  qty = Math.floor(qty);
  if (qty <= 0 || storedCount(s, type) < qty) return 0;
  // calcul du montant à partir des lots effectivement retirés
  const lots = s.lots.filter((l) => l.type === type && l.count > 0).sort((a, b) => a.freshness - b.freshness);
  let left = qty;
  let total = 0;
  for (const l of lots) {
    if (left <= 0) break;
    const k = Math.min(l.count, left);
    total += k * gradeUnit(s, type, l.grade, l.freshness, factor);
    left -= k;
  }
  const taken = takeFromStorage(s, type, qty);
  if (!taken) return 0;
  earn(s, total, 'cooperative', label);
  s.stats.eggsSold += qty;
  s.stats.soldByType[type] = (s.stats.soldByType[type] ?? 0) + qty;
  addXp(s, Math.floor(qty / 4));
  emit(s, { kind: 'sale', amount: total, qty, x: STAND_POS.x + 1, z: STAND_POS.z, channel: 'cooperative' });
  return total;
}

/** Palettes que la centrale d'achat prend par jour (davantage aux hauts niveaux). */
export function palletsPerDay(s: GameState) {
  return tradeAt(farmLevel(s)).pallets;
}

export function palletsLeft(s: GameState) {
  const day = currentDay(s);
  const per = palletsPerDay(s);
  return day === s.market.palletDay ? Math.max(0, per - s.market.pallets) : per;
}

export function sellPallet(s: GameState, type: EggType) {
  if (farmLevel(s) < UNLOCKS.pallets || palletsLeft(s) <= 0) return 0;
  const total = sellWholesale(s, type, MARKET.palletSize, MARKET.palletFactor, 'Palette centrale d’achat');
  if (total > 0) {
    const day = currentDay(s);
    if (s.market.palletDay !== day) {
      s.market.palletDay = day;
      s.market.pallets = 0;
    }
    s.market.pallets++;
  }
  return total;
}

/** Vente automatique du surplus (au-delà du seuil fixé). */
export function autoWholesale(s: GameState) {
  if (!s.settings.autoWholesale || farmLevel(s) < UNLOCKS.autoWholesale) return;
  let excess = storedCount(s) - s.settings.autoWholesaleThreshold;
  if (excess <= 0) return;
  const lots = [...s.lots].sort((a, b) => a.freshness - b.freshness);
  const plan = new Map<EggType, number>();
  for (const l of lots) {
    if (excess <= 0) break;
    const k = Math.min(l.count, excess);
    plan.set(l.type, (plan.get(l.type) ?? 0) + k);
    excess -= k;
  }
  for (const [type, qty] of plan) sellWholesale(s, type, qty, MARKET.wholesaleFactor, 'Vente auto. coopérative');
}

// ---------------------------------------------------------- Commandes ----
function producedTypes(s: GameState): EggType[] {
  const set = new Set<EggType>();
  for (const h of s.hens) set.add(BREEDS[h.breed].egg);
  if (set.size === 0) set.add('roux');
  return [...set];
}

export function generateOrders(s: GameState) {
  if (farmLevel(s) < UNLOCKS.orders) return;
  const day = currentDay(s);
  const offers = s.orders.filter((o) => o.status === 'offer');
  for (let i = offers.length; i < tradeAt(farmLevel(s)).orderOffers; i++) {
    if (rand(s) < 0.25) continue;
    const type = pick(s, producedTypes(s));
    // tailles variées, au hasard : la douzaine du café du coin comme les 200 œufs de la cantine ;
    // les petites commandes paient mieux l'œuf et pressent davantage, les grosses laissent du temps
    const r = rand(s);
    const size = r < 0.4 ? 0 : r < 0.75 ? 1 : 2;
    const qty = size === 0 ? pick(s, ORDERS.smallQty) : size === 1 ? 12 * randInt(s, 3, 8) : pick(s, ORDERS.largeQty);
    const days = size === 0 ? randInt(s, 1, 3) : size === 1 ? randInt(s, ORDERS.daysMin, ORDERS.daysMax) : randInt(s, 4, 7);
    const premium = size === 0 ? randRange(s, 1.25, 1.5) : size === 1 ? randRange(s, ORDERS.priceMin, ORDERS.priceMax) : randRange(s, 1.08, 1.28);
    const extra = rand(s) < 0.2;
    const o: Order = {
      id: newId(s),
      client: pick(s, ORDERS.clients),
      type,
      qty,
      minGrade: extra ? 'extra' : 'A',
      unitPrice: Math.round(refPrice(s, type) * premium * (extra ? 1.15 : 1)),
      deadlineDay: day + days,
      status: 'offer',
      offerUntilDay: day + ORDERS.offerDays,
    };
    s.orders.push(o);
  }
}

/** Commandes acceptées en même temps (davantage aux hauts niveaux). */
export function maxOrders(s: GameState) {
  return tradeAt(farmLevel(s)).orders;
}

export function acceptOrder(s: GameState, id: number) {
  const o = s.orders.find((x) => x.id === id);
  if (!o || o.status !== 'offer') return { ok: false, reason: 'Offre introuvable.' };
  if (s.orders.filter((x) => x.status === 'active').length >= maxOrders(s)) return { ok: false, reason: `Maximum ${maxOrders(s)} commandes en cours.` };
  o.status = 'active';
  return { ok: true };
}

export function declineOrder(s: GameState, id: number) {
  const o = s.orders.find((x) => x.id === id);
  if (!o || o.status !== 'offer') return { ok: false };
  s.orders.splice(s.orders.indexOf(o), 1);
  return { ok: true };
}

/** Annule une commande acceptée : le client est prévenu, un peu de réputation est perdue. */
export function cancelOrder(s: GameState, id: number) {
  const o = s.orders.find((x) => x.id === id);
  if (!o || o.status !== 'active') return { ok: false, reason: 'Commande introuvable.' };
  s.orders.splice(s.orders.indexOf(o), 1);
  rep(s, REPUTATION.orderCancelled);
  notify(s, `Commande de ${o.client} annulée : le client est prévenu.`, 'info', '📦');
  return { ok: true };
}

/** Prévient le joueur dès que le stock permet de livrer une commande (avec un bouton « Livrer »). */
export function checkOrdersReady(s: GameState) {
  for (const o of s.orders) {
    if (o.status !== 'active') continue;
    const ok = canDeliver(s, o);
    if (ok && !o.ready) notify(s, `Commande ${o.client} prête : ${o.qty} œufs ${EGG_TYPES[o.type].short.toLowerCase()} en stock, vous pouvez livrer.`, 'good', '📦', { kind: 'deliverOrder', id: o.id, label: 'Livrer' });
    o.ready = ok;
  }
}

export function deliverOrder(s: GameState, id: number) {
  const o = s.orders.find((x) => x.id === id);
  if (!o || o.status !== 'active') return { ok: false, reason: 'Commande introuvable.' };
  const taken = takeFromStorage(s, o.type, o.qty, o.minGrade);
  if (!taken) {
    return { ok: false, reason: `Stock insuffisant : ${storedCount(s, o.type, o.minGrade)} / ${o.qty} ${EGG_TYPES[o.type].name.toLowerCase()}s (${GRADES[o.minGrade].name} ou mieux).` };
  }
  o.status = 'done';
  const amount = o.qty * o.unitPrice;
  earn(s, amount, 'commandes', `Commande ${o.client}`);
  s.stats.eggsSold += o.qty;
  s.stats.soldByType[o.type] = (s.stats.soldByType[o.type] ?? 0) + o.qty;
  s.stats.ordersDelivered++;
  rep(s, REPUTATION.orderDone);
  addXp(s, XP.orderDelivered + Math.floor(o.qty / 10));
  emit(s, { kind: 'sale', amount, qty: o.qty, x: STAND_POS.x + 1, z: STAND_POS.z, channel: 'commandes' });
  return { ok: true };
}

export function canDeliver(s: GameState, o: Order) {
  return storedCount(s, o.type, o.minGrade) >= o.qty;
}

// ----------------------------------------------------------- Contrats ----
export function maxContracts(s: GameState) {
  return tradeAt(farmLevel(s)).contracts;
}

export function generateContracts(s: GameState) {
  if (farmLevel(s) < UNLOCKS.contracts) return;
  const day = currentDay(s);
  const offers = s.contracts.filter((c) => c.status === 'offer');
  for (let i = offers.length; i < tradeAt(farmLevel(s)).contractOffers; i++) {
    if (rand(s) < 0.35) continue;
    const type = pick(s, producedTypes(s));
    const prod = Math.max(6, dailyProduction(s, type));
    const qty = Math.max(6, Math.round((prod * randRange(s, 0.25, 0.6)) / 6) * 6);
    const days = randInt(s, CONTRACTS.daysMin, CONTRACTS.daysMax);
    s.contracts.push({
      id: newId(s),
      client: pick(s, CONTRACTS.clients),
      type,
      qtyPerDay: qty,
      unitPrice: Math.round(refPrice(s, type) * randRange(s, CONTRACTS.priceMin, CONTRACTS.priceMax)),
      days,
      daysLeft: days,
      status: 'offer',
      missed: 0,
      delivered: 0,
      offerUntilDay: day + CONTRACTS.offerDays,
    });
  }
}

export function acceptContract(s: GameState, id: number) {
  const c = s.contracts.find((x) => x.id === id);
  if (!c || c.status !== 'offer') return { ok: false, reason: 'Offre introuvable.' };
  if (s.contracts.filter((x) => x.status === 'active').length >= maxContracts(s))
    return { ok: false, reason: `Votre niveau permet ${maxContracts(s)} contrat(s) simultané(s).` };
  c.status = 'active';
  return { ok: true };
}

export function declineContract(s: GameState, id: number) {
  const c = s.contracts.find((x) => x.id === id);
  if (!c || c.status !== 'offer') return { ok: false };
  s.contracts.splice(s.contracts.indexOf(c), 1);
  return { ok: true };
}

/** Livre tout de suite la quantité du jour d'un contrat (si le stock le permet). */
export function deliverContractNow(s: GameState, id: number) {
  const c = s.contracts.find((x) => x.id === id);
  if (!c || c.status !== 'active') return { ok: false, reason: 'Contrat introuvable.' };
  if (c.lastDay === currentDay(s)) return { ok: false, reason: 'La livraison du jour est déjà faite.' };
  if (storedCount(s, c.type) < c.qtyPerDay) return { ok: false, reason: `Stock insuffisant : ${storedCount(s, c.type)} / ${c.qtyPerDay} ${EGG_TYPES[c.type].name.toLowerCase()}s.` };
  deliverContractDay(s, c);
  return { ok: true };
}

/** Résilie un contrat en cours : pénalité d'une journée manquée et perte de réputation. */
export function cancelContract(s: GameState, id: number) {
  const c = s.contracts.find((x) => x.id === id);
  if (!c || c.status !== 'active') return { ok: false, reason: 'Contrat introuvable.' };
  const penalty = Math.round(c.qtyPerDay * c.unitPrice * CONTRACTS.missPenalty);
  spend(s, penalty, 'penalites', `Résiliation ${c.client}`, true);
  rep(s, REPUTATION.contractCancelled);
  s.contracts.splice(s.contracts.indexOf(c), 1);
  notify(s, `Contrat ${c.client} résilié (pénalité ${fmtMoney(penalty)}).`, 'warn', '📝');
  return { ok: true };
}

/** Livraison de la journée d'un contrat (quantité prévue, ou ce qu'il reste en stock). */
function deliverContractDay(s: GameState, c: Contract) {
  c.lastDay = currentDay(s);
  const have = storedCount(s, c.type);
  const n = Math.min(have, c.qtyPerDay);
  if (n > 0) {
    takeFromStorage(s, c.type, n);
    const amount = n * c.unitPrice;
    earn(s, amount, 'contrats', `Contrat ${c.client}`);
    s.stats.eggsSold += n;
    s.stats.soldByType[c.type] = (s.stats.soldByType[c.type] ?? 0) + n;
    c.delivered += n;
    addXp(s, CONTRACTS.xpPerDay);
    emit(s, { kind: 'sale', amount, qty: n, x: STAND_POS.x + 1, z: STAND_POS.z, channel: 'contrats' });
  }
  return n;
}

/** Livraison quotidienne des contrats (une seule fois par jour, à 17 h ; sauf si déjà livrés en avance). */
export function deliverContracts(s: GameState) {
  for (const c of s.contracts) {
    if (c.status !== 'active') continue;
    if (c.lastDay === currentDay(s)) {
      // déjà livré plus tôt dans la journée : on compte simplement le jour
      rep(s, REPUTATION.contractDay);
      c.daysLeft--;
      if (c.daysLeft <= 0) finishContract(s, c);
      continue;
    }
    const n = deliverContractDay(s, c);
    const missing = c.qtyPerDay - n;
    if (missing > 0) {
      const penalty = Math.round(missing * c.unitPrice * CONTRACTS.missPenalty);
      spend(s, penalty, 'penalites', `Pénalité ${c.client}`, true);
      c.missed++;
      rep(s, REPUTATION.contractMiss);
      notify(s, `Contrat ${c.client} : ${missing} œufs manquants, pénalité ${(penalty / 100).toFixed(2).replace('.', ',')} €`, 'bad', '📉');
    } else {
      rep(s, REPUTATION.contractDay);
    }
    c.daysLeft--;
    if (c.daysLeft <= 0) finishContract(s, c);
  }
  s.contracts = s.contracts.filter((c) => c.status !== 'done' || c.daysLeft > -1);
}

function finishContract(s: GameState, c: Contract) {
  c.status = 'done';
  s.stats.contractsCompleted++;
  addXp(s, 20);
  notify(s, `Contrat ${c.client} terminé ! ${c.delivered} œufs livrés.`, 'good', '🤝');
}

/** Expirations et rafraîchissement journaliers. */
export function marketNewDay(s: GameState) {
  const day = currentDay(s);
  // tendances du marché
  // tendances : chaque cours garde son élan d'un jour à l'autre (hausses et baisses progressives)
  const vel = (s.market.vel ??= {});
  for (const t of EGG_ORDER) {
    const cur = s.market.trend[t] ?? 1;
    let v = (vel[t] ?? 0) * MARKET.trendMomentum + randRange(s, -MARKET.trendStep, MARKET.trendStep);
    const next = clamp(cur + v + (1 - cur) * MARKET.trendReversion, MARKET.trendMin, MARKET.trendMax);
    if (next === MARKET.trendMin || next === MARKET.trendMax) v = 0;
    vel[t] = v;
    s.market.trend[t] = next;
  }
  recordMarket(s);
  s.market.grainIndex = clamp(s.market.grainIndex + randRange(s, -0.04, 0.04) + (1 - s.market.grainIndex) * 0.2, MARKET.grainMin, MARKET.grainMax);
  // commandes expirées
  for (const o of s.orders) {
    if (o.status === 'active' && o.deadlineDay < day) {
      o.status = 'failed';
      s.stats.ordersFailed++;
      rep(s, REPUTATION.orderFailed);
      notify(s, `Commande de ${o.client} non livrée à temps : réputation en baisse.`, 'bad', '📦');
    }
  }
  s.orders = s.orders.filter((o) => (o.status === 'offer' && o.offerUntilDay >= day) || o.status === 'active');
  s.contracts = s.contracts.filter((c) => (c.status === 'offer' && c.offerUntilDay >= day) || c.status === 'active');
  generateOrders(s);
  generateContracts(s);
  if (s.reputation < REPUTATION.floor) rep(s, REPUTATION.floorRecoveryPerDay);
  // les poules soie font parler de la ferme
  const soies = s.hens.filter((h) => h.breed === 'soie').length;
  if (soies > 0) rep(s, Math.min(3, soies * REPUTATION.soiePerDay));
}

export function gradeAtLeast(g: Grade, min: Grade) {
  return GRADE_RANK[g] >= GRADE_RANK[min];
}

/** Le collectionneur rachète les œufs d'or (tous, ou n), à prix fixe : ils ne passent pas par le marché. */
export function sellGoldEggs(s: GameState, n = s.goldEggs ?? 0): { ok: boolean; reason?: string } {
  const have = s.goldEggs ?? 0;
  n = Math.min(Math.floor(n), have);
  if (n <= 0) return { ok: false, reason: 'Aucun œuf d’or en réserve' };
  s.goldEggs = have - n;
  s.stats.goldEggsSold = (s.stats.goldEggsSold ?? 0) + n;
  const amount = n * RARE.goldCollectorPrice;
  earn(s, amount, 'reventes', n > 1 ? `${n} œufs d’or (collectionneur)` : 'Œuf d’or (collectionneur)');
  emit(s, { kind: 'sale', amount, qty: n, x: STAND_POS.x + 1, z: STAND_POS.z, channel: 'reventes' });
  addXp(s, 5 * n);
  notify(s, `Le collectionneur vous achète ${n > 1 ? `${n} œufs d’or` : 'un œuf d’or'} : +${fmtMoney(amount)} !`, 'good', '✨');
  return { ok: true };
}
