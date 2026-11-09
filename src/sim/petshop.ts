// La vente de poules pondeuses (en interne : l'animalerie, petshop), à droite du parking, au niveau 15 et
// une fois la parcelle du bas à droite achetée : le joueur y met des poules et des oies en vente au prix qu'il veut, et
// les gens du village viennent avec leur carton et en emportent quelques-unes. À partir du niveau 15,
// des revendeurs et des associations passent aussi commande : un camion fermé quitte la route par le
// chemin de terre, entre dans la parcelle du bout, et les commis poussent les volailles sur sa rampe.
//
// Les volailles en vente ne font plus partie du troupeau (elles ne mangent pas et ne pondent pas) :
// elles attendent à la boutique, et on peut les reprendre tant qu'elles n'ont pas été vendues.
import { BIRD_ORDERS, BREEDING, HOUR, TRUCK_BAY, MARKET, PETSHOP, TIME, WORLD, XP, clamp } from '../config/balance';
import { BREEDS, BREED_ORDER, isGoose } from '../config/breeds';
import { BUILDINGS, penGate, petLayout } from '../config/buildings';
import { STAFF } from '../config/staff';
import { currentDay, currentHour, emit, invalidateLayout, isShopOpen, newId, notify, pick, rand, randInt, randNormal, randRange } from './core';
import { GATE_IN, RAMP_FOOT, TRUCK_Z, boardRoute, hatchTime, routeTime, truckBlockedBy } from './deliveries';
import { addXp, earn, farmLevel, fmtMoney, spend } from './economy';
import { henValue, productivity } from './hens';
import { coopFor, lvl } from './queries';
import { hasRole } from './workers';
import type { ActionResult, BirdOrder, BreedId, Customer, GameState, Hen } from './types';

const OK: ActionResult = { ok: true };
const fail = (reason: string): ActionResult => ({ ok: false, reason });

/**
 * Volailles qui se vendent ici : tous les adultes, poules, oies, coqs et jars, de n'importe quelle couleur
 * et où qu'ils soient sur le terrain. Seuls restent à part les jeunes et les deux trésors de la ferme (poule
 * d'or et poule légendaire). Les coqs noirs ne partent qu'avec les revendeurs, à leur vraie valeur.
 */
// (un jeune coq ou un jeune jars, lui, peut partir avant d'être adulte)
export const sellable = (h: Hen) => (!h.young || !!h.rooster) && !h.golden && !h.legendary && !h.ship && h.act !== 'caught';

export const petShopOf = (s: GameState) => s.buildings.find((b) => b.type === 'petshop');
/** Nom d'une volaille, jamais l'un pour l'autre : une oie n'est pas une poule. */
export const birdWord = (goose: boolean, n: number, male = false) => (male ? (goose ? 'jars' : `coq${n > 1 ? 's' : ''}`) : goose ? `oie${n > 1 ? 's' : ''}` : `poule${n > 1 ? 's' : ''}`);

// --------------------------------------------------------------- Le prix ----
const to10 = (v: number) => Math.round(v / 10) * 10;
/** Ce que vaut l'animal neuf : un coq ou un jars vaut un peu plus qu'une femelle. */
const refPrice = (breed: BreedId, male = false) => BREEDS[breed].price * (male ? BREEDING.roosterPriceMult : 1);
/** Prix conseillé : environ la moitié du prix d'achat. */
export const suggestedPrice = (breed: BreedId, male = false) => to10(refPrice(breed, male) * PETSHOP.priceShare);
export const petPrice = (s: GameState, breed: BreedId, male = false) => (male ? s.petShop.malePrices?.[breed] : s.petShop.prices[breed]) ?? suggestedPrice(breed, male);
export const priceBounds = (breed: BreedId, male = false): [number, number] => [to10(refPrice(breed, male) * PETSHOP.priceMin), to10(refPrice(breed, male) * PETSHOP.priceMax)];

export function setPetPrice(s: GameState, breed: BreedId, cents: number, male = false) {
  const [lo, hi] = priceBounds(breed, male);
  const v = to10(clamp(cents, lo, hi));
  const list = male ? (s.petShop.malePrices ??= {}) : s.petShop.prices;
  if (v === suggestedPrice(breed, male)) delete list[breed];
  else list[breed] = v;
}
/** Le prix affiché pour cette volaille (un coq noir vaut ce qu'il vaut : seuls les revendeurs le paient). */
export const birdPrice = (s: GameState, h: Hen) => (h.black ? henValue(h) : petPrice(s, h.breed, !!h.rooster));

/** Ce qu'un client accepte de payer (selon la race, la réputation de la ferme et son humeur). */
const willingToPay = (s: GameState, breed: BreedId, wtp: number, male = false) => refPrice(breed, male) * PETSHOP.wtpShare * wtp * MARKET.repWtp(s.reputation);

function normCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
/** Part des clients prêts à payer ce prix. */
export function petBuyChance(s: GameState, breed: BreedId, price = petPrice(s, breed), male = false) {
  const base = willingToPay(s, breed, 1, male);
  return 1 - normCdf(Math.log(Math.max(1, price) / base) / PETSHOP.wtpSigma);
}

// ------------------------------------------------------------- La vitrine ----
/** Les volailles disponibles : celles qui attendent le camion d'un revendeur ne sont plus à vendre. */
export const stockOf = (s: GameState, breed?: BreedId, male = false) => s.petShop.birds.filter((h) => !h.ship && !h.black && !!h.rooster === male && (!breed || h.breed === breed));
/** Les coqs noirs en vente : ils attendent un revendeur. */
export const stockBlack = (s: GameState) => s.petShop.birds.filter((h) => !h.ship && h.black);
export const flockBlack = (s: GameState) => s.hens.filter((h) => h.black && sellable(h));
/** Ce qu'un client peut acheter (tout, sauf les coqs noirs), pour une espèce. */
export const stockOfKind = (s: GameState, goose: boolean) => s.petShop.birds.filter((h) => !h.ship && !h.black && isGoose(h.breed) === goose);
export const petRoom = (s: GameState) => {
  const b = petShopOf(s);
  return b ? Math.max(0, lvl(b).capacity - s.petShop.birds.length) : 0;
};

/** On garde les meilleures : les moins bonnes reproductrices et les moins pondeuses partent d'abord. */
const weakestFirst = (a: Hen, b: Hen) => {
  const g = (h: Hen) => (h.genes ? h.genes.p + h.genes.r + h.genes.b : 9);
  return g(a) - g(b) || productivity(a) - productivity(b) || b.age - a.age;
};
export type SellTarget = { breed: BreedId; male: boolean };
const isTarget = (t: SellTarget) => (h: Hen) => h.breed === t.breed && !!h.rooster === t.male && !h.black;
export const flockOf = (s: GameState, breed: BreedId, male = false) => s.hens.filter((h) => h.breed === breed && !h.black && !!h.rooster === male && sellable(h)).sort(weakestFirst);

function moveToShop(s: GameState, h: Hen) {
  s.hens.splice(s.hens.indexOf(h), 1);
  h.act = 'idle';
  h.actT = 0;
  h.targetId = -1;
  delete h.nursery;
  s.petShop.birds.push(h);
  emit(s, { kind: 'henGone', henId: h.id, reason: 'moved' });
}

function backToFarm(s: GameState, h: Hen, coopId: number) {
  s.petShop.birds.splice(s.petShop.birds.indexOf(h), 1);
  h.coopId = coopId;
  h.x = GATE_IN[0] + (rand(s) - 0.5) * 0.3;
  h.z = GATE_IN[1] - 0.4;
  h.act = 'idle';
  h.actT = 0.3;
  h.targetId = -1;
  s.hens.push(h);
}

/** Met cette poule (ou cette oie) en vente. */
export function stockBird(s: GameState, henId: number): ActionResult {
  const shop = petShopOf(s);
  if (!shop) return fail('Construisez d’abord la vente de poules pondeuses, à droite du parking');
  const h = s.hens.find((x) => x.id === henId);
  if (!h) return fail('Volaille introuvable');
  if (!sellable(h)) return fail(h.young ? 'Trop jeune pour être vendue ici' : 'Celle-ci ne se vend pas ici');
  if (petRoom(s) <= 0) return fail(`Les parcs sont pleins (${lvl(shop).capacity} places)`);
  moveToShop(s, h);
  return OK;
}

/** Met en vente n volailles de cette race, en gardant les meilleures à la ferme. */
export function stockBirds(s: GameState, breed: BreedId, n: number, male = false): ActionResult & { count?: number } {
  const shop = petShopOf(s);
  if (!shop) return fail('Construisez d’abord la vente de poules pondeuses, à droite du parking');
  const room = petRoom(s);
  if (room <= 0) return fail(`Les parcs sont pleins (${lvl(shop).capacity} places)`);
  const list = flockOf(s, breed, male).slice(0, Math.min(n, room));
  if (!list.length) return fail(`Aucun ${male ? birdWord(isGoose(breed), 1, true) : isGoose(breed) ? 'oie' : 'poule'} adulte de cette race à mettre en vente`);
  for (const h of list) moveToShop(s, h);
  return { ok: true, count: list.length };
}

/** Reprend n volailles invendues : elles rentrent par le portail et retrouvent leur abri. */
export function unstockBirds(s: GameState, breed: BreedId, n: number, male = false): ActionResult & { count?: number } {
  const list = stockOf(s, breed, male).slice(0, n);
  if (!list.length) return fail('Aucune en vente');
  let back = 0;
  for (const h of list) {
    const coop = coopFor(s, breed);
    if (!coop) break;
    backToFarm(s, h, coop.id);
    back++;
  }
  if (!back) return fail(isGoose(breed) ? 'Plus de place à l’abri des oies' : 'Plus de place au poulailler pour cette race');
  return { ok: true, count: back };
}

/** Met en vente n coqs noirs : ils attendent dans leur parc le camion d'un revendeur. */
export function putBlackOnSale(s: GameState, n: number): ActionResult {
  const shop = petShopOf(s);
  if (!shop) return fail('Construisez d’abord la vente de poules pondeuses, à droite du parking');
  const list = flockBlack(s).slice(0, Math.min(n, petRoom(s)));
  if (!list.length) return fail(petRoom(s) <= 0 ? `Les parcs sont pleins (${lvl(shop).capacity} places)` : 'Aucun coq noir adulte à mettre en vente');
  for (const h of list) moveToShop(s, h);
  return OK;
}
export function takeBlackBack(s: GameState, n: number): ActionResult {
  const list = stockBlack(s).slice(0, n);
  if (!list.length) return fail('Aucun en vente');
  for (const h of list) {
    const coop = coopFor(s, h.breed);
    if (!coop) return fail('Plus de place au poulailler pour cette race');
    backToFarm(s, h, coop.id);
  }
  return OK;
}

/** Reprend cette volaille à la ferme (on l'a sélectionnée dans son parc). */
export function unstockBird(s: GameState, id: number): ActionResult {
  const h = s.petShop.birds.find((x) => x.id === id);
  if (!h) return fail('Elle n’est plus en vente');
  if (h.ship) return fail('Elle est réservée pour le camion du revendeur');
  const coop = coopFor(s, h.breed);
  if (!coop) return fail(isGoose(h.breed) ? 'Plus de place à l’abri des oies' : 'Plus de place au poulailler pour cette race');
  backToFarm(s, h, coop.id);
  return OK;
}

// ---------------------------------------------------------------- Le vendeur ----
export function hirePetSeller(s: GameState): ActionResult {
  if (!petShopOf(s)) return fail('Construisez d’abord la vente de poules pondeuses');
  if (s.petShop.seller) return fail('Le vendeur est déjà là');
  s.petShop.seller = true;
  return OK;
}
export function firePetSeller(s: GameState): ActionResult {
  delete s.petShop.seller;
  delete s.petShop.restock;
  return OK;
}
export function togglePetRestock(s: GameState) {
  if (!s.petShop.seller) return;
  s.petShop.restock = !s.petShop.restock;
  if (s.petShop.restock) petShopHourly(s);
}
export const petKeep = (s: GameState) => s.petShop.keep ?? PETSHOP.keepDefault;
export function setPetKeep(s: GameState, n: number) {
  s.petShop.keep = Math.max(0, Math.round(n));
}
/** Salaire du vendeur, par jour. */
export const petSellerWage = (s: GameState) => (s.petShop.seller && petShopOf(s) ? PETSHOP.sellerWage : 0);
/** Une volaille rare : le vendeur n'y touche jamais, même si le joueur peut la vendre lui-même. */
export const isRareBird = (h: Hen) => !!h.golden || !!h.legendary || !!h.black || (h.genes ? Math.max(h.genes.p, h.genes.r, h.genes.b) >= PETSHOP.rareStars : false);

/** La sorte de volaille que le vendeur met en vente d'abord. */
export function setPetPriority(s: GameState, target: SellTarget | null) {
  if (target) s.petShop.priority = target;
  else delete s.petShop.priority;
  petShopHourly(s);
}
/** Ce que le vendeur a le droit de mettre en vente de cette sorte, les moins performantes d'abord. */
export function spareOf(s: GameState, t: SellTarget): Hen[] {
  const goose = isGoose(t.breed);
  const list = s.hens.filter((h) => isTarget(t)(h) && sellable(h) && !isRareBird(h)).sort(weakestFirst);
  if (t.male) {
    // il laisse toujours un mâle de l'espèce à la ferme : le meilleur, puisque les moins bons partent d'abord
    const males = s.hens.filter((h) => h.rooster && !h.black && isGoose(h.breed) === goose).length;
    return males > list.length ? list : list.slice(0, Math.max(0, males - 1));
  }
  const flock = s.hens.filter((h) => isGoose(h.breed) === goose && !h.young && !h.rooster).length;
  const keep = goose ? Math.min(petKeep(s), PETSHOP.keepGeese) : petKeep(s);
  return list.slice(0, Math.max(0, flock - keep));
}

/** L'option des commandes automatiques est-elle à l'œuvre ? */
export const sellerAutoOn = (s: GameState) => !!s.petShop.seller && !!s.petShop.autoBought && !!s.petShop.autoOn;
export function buyPetAuto(s: GameState): ActionResult {
  if (!s.petShop.seller) return fail('Embauchez d’abord le vendeur');
  if (s.petShop.autoBought) return fail('Option déjà achetée');
  if (!spend(s, PETSHOP.autoPrice, 'salaires', 'Vendeur de poules : commandes automatiques')) return fail('Fonds insuffisants');
  s.petShop.autoBought = true;
  s.petShop.autoOn = true;
  petShopHourly(s);
  return OK;
}
export function togglePetAuto(s: GameState) {
  if (!s.petShop.autoBought) return;
  s.petShop.autoOn = !s.petShop.autoOn;
  petShopHourly(s);
}

/** Une commande correspond-elle à ce que le vendeur a pour mission de vendre ? */
const matchesTarget = (o: BirdOrder, t: SellTarget) => !o.black && !!o.male === t.male && o.goose === isGoose(t.breed) && (!o.breed || o.breed === t.breed);

/** Le vendeur gère seul : il met en vente, trouve un revendeur, accepte, et fait venir le camion. */
function autoDealer(s: GameState, t: SellTarget) {
  let quota = PETSHOP.sellerPerHour;
  for (const h of spareOf(s, t)) {
    if (quota <= 0 || petRoom(s) <= 0) break;
    moveToShop(s, h);
    quota--;
  }
  // sans commis ou avec un camion qui ne passerait pas, il ne s'engage à rien
  if (!birdOrdersOpen(s) || !hasRole(s, 'farmhand') || truckBlockedBy(s) >= 0) return;
  const capacity = lvl(petShopOf(s)!).capacity;
  const onSale = () => s.petShop.birds.filter((h) => !h.ship && isTarget(t)(h)).length;
  const busy = () => s.birdOrders.filter((o) => o.status !== 'offer').length;
  // rien pour cette race à l'horizon : il appelle un revendeur
  const stock = onSale() + spareOf(s, t).length;
  if (stock >= PETSHOP.autoMinLot && busy() < BIRD_ORDERS.maxActive && !s.birdOrders.some((o) => matchesTarget(o, t))) {
    const goose = isGoose(t.breed);
    const qty = t.male ? BIRD_ORDERS.maleQty : goose ? BIRD_ORDERS.gooseQty : BIRD_ORDERS.henQty;
    const day = currentDay(s);
    s.birdOrders.push({
      id: newId(s),
      client: pick(s, BIRD_ORDERS.clients),
      goose,
      ...(goose ? {} : { breed: t.breed }),
      ...(t.male ? { male: true } : {}),
      count: Math.min(pick(s, qty), stock, capacity),
      unitPrice: to10(refPrice(t.breed, t.male) * randRange(s, BIRD_ORDERS.priceMin, BIRD_ORDERS.priceMax) * BIRD_ORDERS.breedBonus),
      deadlineDay: day + randInt(s, BIRD_ORDERS.daysMin, BIRD_ORDERS.daysMax),
      offerUntilDay: day + BIRD_ORDERS.offerDays,
      status: 'offer',
    });
  }
  // les offres pour cette race, s'il peut les honorer
  for (const o of s.birdOrders) {
    if (o.status !== 'offer' || !matchesTarget(o, t) || busy() >= BIRD_ORDERS.maxActive) continue;
    if (freeStock(s, o) + spareOf(s, t).length < Math.min(o.count, capacity)) continue;
    o.status = 'active';
    notify(s, `Le vendeur accepte la commande de ${o.client} : ${orderLabel(o)}.`, 'info', '🚚');
  }
  // et dès que tout est prêt, le camion
  for (const o of [...s.birdOrders]) {
    if (o.status !== 'active' || !matchesTarget(o, t)) continue;
    const have = freeStock(s, o);
    const need = Math.min(o.count, capacity);
    if (have < need && !spareOf(s, t).length) {
      // des clients sont passés entre-temps : il livre ce qu'il reste, ou prévient le revendeur
      if (have > 0) o.count = have;
      else {
        cancelBirdOrder(s, o.id);
        continue;
      }
    }
    if (checkCallTruck(s, o).ok) callTruck(s, o.id);
  }
}

/** Ce que le vendeur gère en mode automatique : la race demandée, sinon toutes celles dont il y a du surplus ou du stock. */
function autoTargets(s: GameState): SellTarget[] {
  if (s.petShop.priority) return [s.petShop.priority];
  const seen = new Map<string, SellTarget>();
  for (const h of [...s.hens, ...s.petShop.birds]) {
    if (h.black || h.young) continue;
    const t = { breed: h.breed, male: !!h.rooster };
    seen.set(`${t.breed}:${t.male}`, t);
  }
  return [...seen.values()].filter((t) => spareOf(s, t).length > 0 || s.petShop.birds.some((h) => !h.ship && isTarget(t)(h)));
}

/**
 * Toutes les dix minutes de jeu (et aussitôt qu'on change un réglage) : le vendeur remet en vente ce
 * qu'on lui a demandé, ou gère tout en mode automatique. Il est réactif : pas besoin d'attendre l'heure.
 */
export function petShopHourly(s: GameState) {
  if (!s.petShop.seller || !petShopOf(s)) return;
  if (sellerAutoOn(s)) {
    for (const t of autoTargets(s)) autoDealer(s, t);
    // (en plus, avec « remettre en vente » coché, il garnit les parcs comme d'habitude)
    if (!s.petShop.restock) return;
  }
  if (!s.petShop.restock) return;
  let quota = PETSHOP.sellerPerHour;
  // d'abord la race qu'on lui a demandée, puis le reste comme d'habitude
  if (s.petShop.priority)
    for (const h of spareOf(s, s.petShop.priority)) {
      if (quota <= 0 || petRoom(s) <= 0) break;
      moveToShop(s, h);
      quota--;
    }
  for (const goose of [false, true]) {
    const flock = s.hens.filter((h) => isGoose(h.breed) === goose && !h.young && !h.rooster);
    const keep = goose ? Math.min(petKeep(s), PETSHOP.keepGeese) : petKeep(s);
    let spare = flock.length - keep;
    const list = flock.filter((h) => sellable(h) && !isRareBird(h)).sort(weakestFirst);
    for (const h of list) {
      if (spare <= 0 || quota <= 0 || petRoom(s) <= 0) break;
      moveToShop(s, h);
      spare--;
      quota--;
    }
  }
}

// ------------------------------------------------------------- Les clients ----
export const petCustomersPerHour = (s: GameState) => {
  const b = petShopOf(s);
  // sans vendeur, personne pour servir : la boutique reste fermée
  return b && s.petShop.seller ? (lvl(b).flow ?? 0.6) * MARKET.repFlow(s.reputation) : 0;
};
export const petCustomersPerDay = (s: GameState) => petCustomersPerHour(s) * (TIME.SHOP_CLOSE - TIME.SHOP_OPEN);
const counters = (s: GameState) => layoutOf(s).counters;
const layoutOf = (s: GameState) => petLayout(petShopOf(s)?.level ?? 1);
const laneZ = (dir: 1 | -1) => WORLD.WALK_Z + (dir > 0 ? 0.25 : -0.25);
/** Rangée juste devant la boutique, le long du trottoir (d'où l'on entre dans l'allée centrale). */
const FRONT_Z = WORLD.WALK_Z - 0.75;

function spawnPetCustomer(s: GameState) {
  const dir: 1 | -1 = rand(s) < 0.5 ? 1 : -1;
  const c: Customer = {
    id: newId(s),
    // « gourmet » : ici, celui qui vient plutôt pour une oie
    kind: rand(s) < PETSHOP.gooseShare ? 'gourmet' : 'classique',
    want: pick(s, PETSHOP.wantChoices),
    wtp: Math.exp(PETSHOP.wtpSigma * randNormal(s)),
    state: 'toStand',
    x: layoutOf(s).cx - dir * MARKET.spawnDistance,
    z: laneZ(dir) + randRange(s, -0.06, 0.06),
    dir,
    t: 0,
    mood: 'none',
    bought: 0,
    look: Math.floor(rand(s) * 1000),
    patience: randRange(s, PETSHOP.patience[0], PETSHOP.patience[1]),
    wait: 0,
    counter: -1,
  };
  s.petCustomers.push(c);
}

function servePetCustomer(s: GameState, c: Customer) {
  // chacun vient pour une espèce, et se rabat sur l'autre s'il n'y en a plus ; certains viennent pour un mâle
  const wanted = c.kind === 'gourmet';
  const kinds = stockOfKind(s, wanted).length ? wanted : !wanted;
  const wantMale = rand(s) < PETSHOP.maleShare;
  const inStock = (male: boolean) => BREED_ORDER.filter((b) => isGoose(b) === kinds && stockOf(s, b, male).length > 0);
  const sex = inStock(wantMale).length ? wantMale : !wantMale;
  const breeds = inStock(sex);
  if (!breeds.length) {
    c.mood = 'empty';
    emit(s, { kind: 'customerMood', customerId: c.id, mood: c.mood });
    return;
  }
  let best: BreedId | null = null;
  let bestU = -Infinity;
  for (const b of breeds) {
    const u = (willingToPay(s, b, c.wtp, sex) - petPrice(s, b, sex)) / refPrice(b, sex);
    if (u > bestU) {
      bestU = u;
      best = b;
    }
  }
  if (!best || bestU < 0) {
    c.mood = 'expensive';
    emit(s, { kind: 'customerMood', customerId: c.id, mood: c.mood });
    return;
  }
  // une oie ou un coq, on n'en emporte pas six dans un carton : un ou deux à la fois
  const want = kinds || sex ? Math.min(2, c.want) : c.want;
  const stock = stockOf(s, best, sex);
  const qty = Math.min(want, stock.length);
  const price = petPrice(s, best, sex);
  for (const h of stock.slice(0, qty)) s.petShop.birds.splice(s.petShop.birds.indexOf(h), 1);
  const amount = qty * price;
  earn(s, amount, 'animalerie', `Vente de poules : ${qty} ${birdWord(kinds, qty, sex)}`);
  s.stats.hensSold += qty;
  s.stats.birdsSoldRetail = (s.stats.birdsSoldRetail ?? 0) + qty;
  const day = currentDay(s);
  if (s.petShop.soldDay !== day) {
    s.petShop.soldDay = day;
    s.petShop.soldToday = 0;
  }
  s.petShop.soldToday = (s.petShop.soldToday ?? 0) + qty;
  addXp(s, qty * XP.perTwoSold);
  c.mood = 'happy';
  c.bought = qty;
  emit(s, { kind: 'sale', amount, qty, x: layoutOf(s).cx, z: layoutOf(s).stopZ - 1, channel: 'animalerie' });
  emit(s, { kind: 'customerMood', customerId: c.id, mood: c.mood });
}

export function updatePetCustomers(s: GameState, dt: number) {
  const shop = petShopOf(s);
  const hour = currentHour(s);
  // on ne vient pas pour rien : tant que la vitrine est vide, personne ne se déplace
  if (shop && isShopOpen(hour) && s.petShop.birds.length > 0 && rand(s) < (petCustomersPerHour(s) / HOUR) * dt) spawnPetCustomer(s);
  if (!s.petCustomers.length) return;
  const L = layoutOf(s);
  const n = counters(s);
  const speed = MARKET.walkSpeed;
  const busy = new Set(s.petCustomers.filter((c) => (c.state === 'shopping' || c.state === 'queue') && (c.counter ?? -1) >= 0).map((c) => c.counter!));
  const waiting = s.petCustomers.filter((c) => c.state === 'queue' && (c.counter ?? -1) < 0).sort((a, b) => (a.qt ?? 0) - (b.qt ?? 0));
  for (let i = 0; i < n && waiting.length; i++) {
    if (busy.has(i)) continue;
    waiting.shift()!.counter = i;
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
  for (const c of s.petCustomers) {
    c.t += dt;
    if (c.state === 'toStand') {
      if (Math.abs(c.x - L.cx) > 2.4) {
        c.x += Math.sign(L.cx - c.x) * Math.min(Math.abs(L.cx - c.x), speed * dt);
        c.z += (laneZ(c.dir) - c.z) * Math.min(1, dt * 2);
      } else if (s.petCustomers.filter((o) => o.state === 'queue' && (o.counter ?? -1) < 0).length >= PETSHOP.maxQueue) {
        c.state = 'leaving';
        c.t = 0;
      } else {
        c.state = 'queue';
        c.qt = s.clock.t + c.id * 1e-6;
        c.wait = 0;
        c.counter = -1;
      }
    } else if (c.state === 'queue') {
      if ((c.counter ?? -1) >= 0) {
        const cx = L.cx + (c.counter! - (n - 1) / 2) * L.gap;
        // il longe la boutique jusqu'à l'allée, puis la remonte jusqu'au comptoir
        if (Math.abs(c.x - cx) > 0.08 && c.z > L.stopZ + 0.3) walkTo(c, cx, FRONT_Z);
        else if (walkTo(c, cx, L.stopZ)) {
          c.state = 'shopping';
          c.t = 0;
          servePetCustomer(s, c);
        }
      } else {
        c.wait = (c.wait ?? 0) + dt;
        if (c.wait > (c.patience ?? 12)) {
          c.state = 'leaving';
          c.mood = 'impatient';
          c.t = 0;
          emit(s, { kind: 'customerMood', customerId: c.id, mood: c.mood });
          continue;
        }
        walkTo(c, L.cx + 1.2 + Math.max(0, waiting.indexOf(c)) * 0.55, FRONT_Z);
      }
    } else if (c.state === 'shopping') {
      if (c.t > PETSHOP.serveTime + c.bought * PETSHOP.servePerBird) {
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
  s.petCustomers = s.petCustomers.filter((c) => Math.abs(c.x - L.cx) <= MARKET.spawnDistance + 1 && c.t < 120);
}

// ----------------------------------------------------- Commandes de revendeurs ----
/** La parcelle où arrive le chemin de terre : il faut l'avoir achetée pour vendre ses volailles. */
export const truckParcelOwned = (s: GameState) => s.parcels.includes(BIRD_ORDERS.parcel);
/** Les revendeurs n'achètent que ce qui est en vente : il faut la boutique et la parcelle du camion. */
export const birdOrdersOpen = (s: GameState) => farmLevel(s) >= BIRD_ORDERS.reqLevel && truckParcelOwned(s) && !!petShopOf(s);
type OrderKind = Pick<BirdOrder, 'goose' | 'breed' | 'male' | 'black'>;
const orderHens = (o: OrderKind) => (h: Hen) => !h.ship && (o.black ? !!h.black : !h.black && !!h.rooster === !!o.male && isGoose(h.breed) === o.goose && (!o.breed || h.breed === o.breed));
/** Volailles en vente qui conviennent à cette commande : le camion ne prend rien d'autre. */
export const orderStock = (s: GameState, o: OrderKind) => s.petShop.birds.filter(orderHens(o)).length;
/** Comment la commande se nomme, sans jamais prendre une oie pour une poule. */
export const orderWord = (o: OrderKind & { count: number }) => (o.black ? `coq${o.count > 1 ? 's' : ''} noir${o.count > 1 ? 's' : ''}` : birdWord(o.goose, o.count, !!o.male));
export function orderLabel(o: OrderKind & { count: number }) {
  if (o.black) return `${o.count} ${orderWord(o)}`;
  if (o.male) return `${o.count} ${orderWord(o)}${o.breed ? ` ${BREEDS[o.breed].name}` : ''}`;
  if (o.goose) return `${o.count} ${birdWord(true, o.count)}`;
  return o.breed ? `${o.count} ${BREEDS[o.breed].name}` : `${o.count} ${birdWord(false, o.count)} pondeuses`;
}

export function generateBirdOrders(s: GameState) {
  if (!birdOrdersOpen(s)) return;
  const day = currentDay(s);
  const offers = s.birdOrders.filter((o) => o.status === 'offer').length;
  for (let i = offers; i < BIRD_ORDERS.maxOffers; i++) {
    if (rand(s) < 0.3) continue;
    // on ne propose que ce que la ferme élève : pas d'oies sans oies
    const all = [...s.hens, ...s.petShop.birds].filter((h) => !h.young);
    const capacity = lvl(petShopOf(s)!).capacity;
    const already = (test: (o: BirdOrder) => boolean) => s.birdOrders.some((o) => o.status === 'offer' && test(o));
    const offer = (o: Pick<BirdOrder, 'goose' | 'count' | 'unitPrice' | 'male' | 'black'>) =>
      s.birdOrders.push({ id: newId(s), client: pick(s, BIRD_ORDERS.clients), ...o, deadlineDay: day + randInt(s, BIRD_ORDERS.daysMin, BIRD_ORDERS.daysMax), offerUntilDay: day + BIRD_ORDERS.offerDays, status: 'offer' });
    // les coqs noirs : par petits lots, au prix qu'ils valent vraiment
    const blacks = all.filter((h) => h.black);
    if (blacks.length && !already((o) => !!o.black) && rand(s) < BIRD_ORDERS.blackShare) {
      const value = blacks.reduce((a, h) => a + henValue(h), 0) / blacks.length;
      offer({ goose: false, black: true, count: Math.min(pick(s, BIRD_ORDERS.blackQty), blacks.length, capacity), unitPrice: to10(value) });
      continue;
    }
    // les coqs et les jars en trop : une commande presque toujours à l'affiche, à la mesure de ce qu'on a
    const males = all.filter((h) => h.rooster && !h.black);
    if (males.length && !already((o) => !!o.male) && rand(s) < BIRD_ORDERS.maleShare) {
      const jars = males.filter((h) => isGoose(h.breed));
      const coqs = males.filter((h) => !isGoose(h.breed));
      const goose = jars.length > 0 && (!coqs.length || rand(s) < BIRD_ORDERS.jarsShare);
      const list = goose ? jars : coqs;
      const base = Math.min(...list.map((h) => refPrice(h.breed, true)));
      offer({ goose, male: true, count: Math.min(pick(s, BIRD_ORDERS.maleQty), list.length, capacity), unitPrice: to10(base * randRange(s, BIRD_ORDERS.priceMin, BIRD_ORDERS.priceMax)) });
      continue;
    }
    const hasGeese = all.some((h) => isGoose(h.breed) && !h.rooster);
    const goose = hasGeese && rand(s) < BIRD_ORDERS.gooseShare;
    // jamais plus que ce que les parcs peuvent contenir
    const count = Math.min(pick(s, goose ? BIRD_ORDERS.gooseQty : BIRD_ORDERS.henQty), capacity);
    const breeds = [...new Set(all.filter((h) => !isGoose(h.breed) && !h.rooster).map((h) => h.breed))];
    const breed = goose ? 'oie' : breeds.length && rand(s) < BIRD_ORDERS.breedShare ? pick(s, breeds) : undefined;
    // « toutes races » : au tarif de la moins chère des races de la ferme
    const base = breed ? BREEDS[breed].price : Math.min(...(breeds.length ? breeds : (['rousse'] as BreedId[])).map((b) => BREEDS[b].price));
    const share = randRange(s, BIRD_ORDERS.priceMin, BIRD_ORDERS.priceMax) * (breed && !goose ? BIRD_ORDERS.breedBonus : 1);
    s.birdOrders.push({
      id: newId(s),
      client: pick(s, BIRD_ORDERS.clients),
      goose,
      ...(breed && !goose ? { breed } : {}),
      count,
      unitPrice: to10(base * share),
      deadlineDay: day + randInt(s, BIRD_ORDERS.daysMin, BIRD_ORDERS.daysMax),
      offerUntilDay: day + BIRD_ORDERS.offerDays,
      status: 'offer',
    });
  }
}

export function acceptBirdOrder(s: GameState, id: number): ActionResult {
  const o = s.birdOrders.find((x) => x.id === id);
  if (!o || o.status !== 'offer') return fail('Offre introuvable');
  if (s.birdOrders.filter((x) => x.status !== 'offer').length >= BIRD_ORDERS.maxActive) return fail(`Maximum ${BIRD_ORDERS.maxActive} commandes de volailles en cours`);
  o.status = 'active';
  return OK;
}
export function declineBirdOrder(s: GameState, id: number): ActionResult {
  const i = s.birdOrders.findIndex((x) => x.id === id && x.status === 'offer');
  if (i < 0) return fail('Offre introuvable');
  s.birdOrders.splice(i, 1);
  return OK;
}
export function cancelBirdOrder(s: GameState, id: number): ActionResult {
  const o = s.birdOrders.find((x) => x.id === id);
  if (!o || o.status !== 'active') return fail('Commande introuvable');
  s.birdOrders.splice(s.birdOrders.indexOf(o), 1);
  s.reputation = clamp(s.reputation - 1, 0, 100);
  notify(s, `Commande de ${o.client} annulée : le client est prévenu.`, 'info', '🚚');
  return OK;
}

/** Ce qui reste en vente pour cette commande, une fois servis les camions déjà appelés. */
export function freeStock(s: GameState, o: OrderKind) {
  const free = new Set(s.petShop.birds.filter((h) => !h.ship));
  const claim = (id: number) => {
    const q = s.birdOrders.find((x) => x.id === id);
    if (!q) return;
    const match = orderHens(q);
    let left = q.count;
    for (const h of free) {
      if (left <= 0) break;
      if (match(h)) {
        free.delete(h);
        left--;
      }
    }
  };
  if (s.birdLoad && !s.birdLoad.called) claim(s.birdLoad.orderId);
  for (const id of s.birdQueue) claim(id);
  const match = orderHens(o);
  let n = 0;
  for (const h of free) if (match(h)) n++;
  return n;
}

/** Peut-on appeler le camion pour cette commande ? */
export function checkCallTruck(s: GameState, o: BirdOrder): ActionResult {
  if (o.status !== 'active') return fail('Commande déjà en cours de livraison');
  if (!truckParcelOwned(s)) return fail(`Achetez d’abord la parcelle ${BIRD_ORDERS.parcelName}, en bas à droite : le chemin de terre y arrive`);
  if (!petShopOf(s)) return fail('Construisez d’abord la vente de poules pondeuses : le camion ne prend que ce qui y est en vente');
  if (!hasRole(s, 'farmhand')) return fail('Il faut au moins un commis de ferme pour charger le camion');
  // (ce que les camions déjà appelés vont emporter n'est plus disponible)
  const have = freeStock(s, o);
  const need = Math.min(o.count, lvl(petShopOf(s)!).capacity);
  if (have < need) return fail(`Pas assez de ${orderWord({ ...o, count: 2 })} en vente : ${have} / ${need}. Mettez-en dans les parcs`);
  const gene = truckBlockedBy(s);
  if (gene >= 0) {
    const b = s.buildings.find((x) => x.id === gene);
    return fail(`Déplacez ${b ? `« ${BUILDINGS[b.type].levels[b.level - 1].name} »` : 'ce bâtiment'} : il gêne le camion, derrière le grand portail de la parcelle ${BIRD_ORDERS.parcelName}`);
  }
  return OK;
}

/** Quand le camion peut passer : à l'heure où les commis travaillent, sinon le lendemain matin. */
function truckEta(s: GameState) {
  const t = s.clock.t;
  const h = currentHour(s);
  const dayStart = Math.floor(t / TIME.DAY) * TIME.DAY;
  if (h >= BIRD_ORDERS.earliestHour && h + BIRD_ORDERS.delay / HOUR < STAFF.farmhandEnd - BIRD_ORDERS.marginHours) return t + BIRD_ORDERS.delay;
  const morning = dayStart + BIRD_ORDERS.morningHour * HOUR;
  return h < BIRD_ORDERS.earliestHour ? morning : morning + TIME.DAY;
}

export function callTruck(s: GameState, id: number): ActionResult {
  const o = s.birdOrders.find((x) => x.id === id);
  if (!o) return fail('Commande introuvable');
  const chk = checkCallTruck(s, o);
  if (!chk.ok) return chk;
  // un camion est déjà là ou en route : celui-ci prend la suite, sans déranger personne
  if (s.birdLoad || s.birdQueue.length) {
    o.status = 'queued';
    s.birdQueue.push(o.id);
    notify(s, `Le camion de ${o.client} passera dès que le précédent aura quitté le chemin.`, 'info', '🚚');
    return OK;
  }
  startTruck(s, o);
  return OK;
}

function startTruck(s: GameState, o: BirdOrder) {
  const eta = truckEta(s);
  o.status = 'loading';
  s.birdLoad = { id: newId(s), orderId: o.id, eta, called: false, henIds: [], loaded: 0, gone: [], nextT: eta };
  const later = eta - s.clock.t > BIRD_ORDERS.delay + 1;
  notify(s, later ? `Le camion de ${o.client} passera demain matin : les commis ne sont plus là ce soir.` : `Le camion de ${o.client} est en route : il va prendre le chemin de terre jusqu’au grand portail. Les ${orderWord({ ...o, count: 2 })} passeront par la trappe de leur parc.`, 'info', '🚚');
}

/** On renonce à un camion qui attendait son tour : la commande reste à livrer. */
export function cancelTruckCall(s: GameState, id: number): ActionResult {
  const o = s.birdOrders.find((x) => x.id === id);
  if (!o || o.status !== 'queued') return fail('Ce camion n’est plus dans la file');
  s.birdQueue = s.birdQueue.filter((x) => x !== id);
  o.status = 'active';
  return OK;
}

/** Le camion précédent est parti : au suivant de la file, s'il y a encore de quoi le charger. */
function nextTruck(s: GameState) {
  while (s.birdQueue.length) {
    const o = s.birdOrders.find((x) => x.id === s.birdQueue[0]);
    s.birdQueue.shift();
    if (!o || o.status !== 'queued') continue;
    if (orderStock(s, o) > 0) {
      startTruck(s, o);
      return;
    }
    o.status = 'active';
    notify(s, `Le camion de ${o.client} ne vient pas : plus rien à lui charger. La commande reste à livrer.`, 'warn', '🚚');
  }
}

/** Personne sur la voie du camion : ceux qui s'y trouvent s'écartent de là, du côté le plus proche. */
function clearTruckLane(s: GameState) {
  const step = 0.16;
  const inLane = (x: number, z: number) => x > TRUCK_BAY.x0 - 0.3 && x < TRUCK_BAY.x1 + 1 && z > TRUCK_BAY.z0 - 0.3 && z < TRUCK_BAY.z1 + 1.3;
  for (const h of s.hens) if (inLane(h.x, h.z)) h.z += h.z < TRUCK_Z ? -step : step;
  for (const w of s.workers) if (inLane(w.x, w.z)) w.z += w.z < TRUCK_Z ? -step : step;
}

/** Intervalle entre deux volailles chargées : les grosses commandes vont plus vite, deux commis aussi. */
const loadGap = (count: number, helpers: number) => clamp(BIRD_ORDERS.loadSeconds / count, BIRD_ORDERS.gapMin, BIRD_ORDERS.gapMax) * (helpers > 1 ? 0.7 : 1);
/** Les commis au camion : ceux qui poussent les volailles, ou qui en font le tour pour les rejoindre. */
export const loadersAtTruck = (s: GameState) => s.workers.filter((w) => w.job?.kind === 'loadTruck' && (w.job.phase === 'work' || Math.hypot(w.x - RAMP_FOOT, w.z - TRUCK_Z) < 14)).length;

function finishLoad(s: GameState) {
  const L = s.birdLoad!;
  const o = s.birdOrders.find((x) => x.id === L.orderId);
  for (const h of s.petShop.birds) if (h.ship) delete h.ship;
  s.birdLoad = null;
  // il repart à reculons : sa voie reste libre le temps qu'il sorte
  s.truckOutAt = s.clock.t + BIRD_ORDERS.backOut;
  invalidateLayout(s);
  if (!o) return;
  const amount = L.loaded * o.unitPrice;
  if (amount > 0) {
    earn(s, amount, 'animalerie', `Livraison à ${o.client}`);
    emit(s, { kind: 'sale', amount, qty: L.loaded, x: RAMP_FOOT, z: TRUCK_Z, channel: 'animalerie' });
    s.stats.hensSold += L.loaded;
    s.stats.birdsSoldDealers = (s.stats.birdsSoldDealers ?? 0) + L.loaded;
    addXp(s, BIRD_ORDERS.xp + Math.floor(L.loaded / 4));
  }
  const rest = o.count - L.loaded;
  if (rest <= 0) {
    s.birdOrders.splice(s.birdOrders.indexOf(o), 1);
    s.stats.birdOrdersDone = (s.stats.birdOrdersDone ?? 0) + 1;
    s.reputation = clamp(s.reputation + BIRD_ORDERS.repDone, 0, 100);
    notify(s, `Le camion repart : ${orderLabel({ ...o, count: L.loaded })} livrées à ${o.client}, +${fmtMoney(amount)}.`, 'good', '🚚');
  } else {
    // chargé en partie : on le paie pour ce qui est parti, le reste de la commande attend un autre camion
    o.count = rest;
    o.status = 'active';
    notify(s, amount > 0 ? `Le camion repart avec ${L.loaded} volailles seulement (+${fmtMoney(amount)}). Il en reste ${rest} à livrer à ${o.client}.` : `Le camion de ${o.client} repart à vide : personne pour le charger.`, 'warn', '🚚');
  }
}

/** La volaille prend le chemin du camion. */
function reserve(s: GameState, o: BirdOrder, need: number, ids: number[]) {
  // (en mode automatique, ce que le vendeur a pour mission de vendre part en premier)
  const first = sellerAutoOn(s) ? s.petShop.priority : undefined;
  const rank = (h: Hen) => (first && isTarget(first)(h) ? 0 : 1);
  const list = s.petShop.birds.filter(orderHens(o)).sort((a, b) => rank(a) - rank(b) || weakestFirst(a, b)).slice(0, need);
  for (const h of list) {
    h.ship = true;
    ids.push(h.id);
  }
}

/** Une trappe de ce parc doit-elle être ouverte : un commis est là et il reste des volailles à passer ? */
export function hatchWanted(s: GameState, goose: boolean) {
  const L = s.birdLoad;
  if (!L?.called || L.late || s.clock.t < L.eta - 1) return false;
  if (L.gone.some((q) => isGoose(q.breed) === goose && s.clock.t < q.t + hatchTime(q.x))) return true;
  return L.leave === undefined && s.petShop.birds.some((h) => h.ship && isGoose(h.breed) === goose) && loadersAtTruck(s) > 0;
}

export function updateBirdLoad(s: GameState) {
  if (s.truckOutAt !== undefined && s.clock.t >= s.truckOutAt) {
    delete s.truckOutAt;
    invalidateLayout(s);
  }
  if (s.birdLoad?.called || s.truckOutAt !== undefined) clearTruckLane(s);
  const L = s.birdLoad;
  if (!L) {
    nextTruck(s);
    return;
  }
  const o = s.birdOrders.find((x) => x.id === L.orderId);
  if (!o) {
    finishLoad(s);
    return;
  }
  const t = s.clock.t;
  if (L.leave !== undefined) {
    if (t >= L.leave) finishLoad(s);
    return;
  }
  if (!L.called) {
    if (t < L.eta - BIRD_ORDERS.prep) return;
    L.called = true;
    invalidateLayout(s);
    reserve(s, o, o.count, L.henIds);
  }
  // une volaille vendue ou croquée entre-temps est remplacée si possible
  L.henIds = L.henIds.filter((id) => s.petShop.birds.some((h) => h.id === id && h.ship));
  const missing = o.count - L.loaded - L.henIds.length;
  if (missing > 0) reserve(s, o, missing, L.henIds);
  if (t < L.eta) return;
  // (coincé dans la circulation, ou le camion précédent n'a pas fini de partir : les volailles l'attendent
  // derrière leur trappe, personne ne monte dans le vide)
  if (L.late) return;
  L.since ??= t;
  const helpers = loadersAtTruck(s);
  if (!helpers) {
    // personne pour charger : le chauffeur patiente un moment, puis s'en va
    if (t > L.since + BIRD_ORDERS.maxWait) L.leave = t + BIRD_ORDERS.closeUp;
    else if (!L.warned && t > L.since + 6) {
      L.warned = true;
      if (!hasRole(s, 'farmhand')) notify(s, 'Le camion attend : il faut un commis de ferme pour le charger.', 'warn', '🚚');
    }
    return;
  }
  if (t >= L.nextT && L.henIds.length) {
    // la suivante passe son portillon : les autres attendent leur tour derrière
    const h = s.petShop.birds.find((x) => x.id === L.henIds[0]);
    L.henIds.shift();
    if (h) {
      s.petShop.birds.splice(s.petShop.birds.indexOf(h), 1);
      const [x, z] = penGate(petShopOf(s)?.level ?? 1, isGoose(h.breed));
      L.gone.push({ t, id: h.id, breed: h.breed, skin: h.skin, ...(h.rooster ? { rooster: true } : {}), ...(h.black ? { black: true } : {}), x, z, route: boardRoute(s, x, z) });
      if (L.gone.length > 120) L.gone.splice(0, L.gone.length - 120);
      L.loaded++;
      L.lastT = t;
      L.nextT = t + loadGap(o.count, helpers);
    }
  }
  if (L.loaded >= o.count || (!L.henIds.length && missing > 0)) {
    const last = L.gone[L.gone.length - 1];
    L.leave = (last ? last.t + routeTime(last.route) : t) + BIRD_ORDERS.closeUp;
  }
}

/** Chaque matin : offres périmées, commandes en retard, nouvelles offres. */
export function birdOrdersNewDay(s: GameState) {
  const day = currentDay(s);
  if (petShopOf(s) && s.petShop.birds.length && !s.petShop.seller) notify(s, 'Vos volailles attendent dans leurs parcs, mais personne ne les vend : embauchez un vendeur.', 'warn', '🐔');
  // le jour où le niveau est atteint : on explique comment vendre ses volailles
  if (farmLevel(s) >= BIRD_ORDERS.reqLevel && !s.petShop.announced) {
    s.petShop.announced = true;
    if (!truckParcelOwned(s)) notify(s, `Niveau ${BIRD_ORDERS.reqLevel} : pour vendre vos poules pondeuses, achetez la parcelle ${BIRD_ORDERS.parcelName}, en bas à droite, où arrive le chemin de terre.`, 'good', '🐔');
    else if (!petShopOf(s)) notify(s, 'Vous pouvez construire la vente de poules pondeuses sur l’emplacement à droite du parking. Cliquez dessus !', 'good', '🐔');
  }
  for (const o of [...s.birdOrders]) {
    if (o.status === 'active' && o.deadlineDay < day) {
      s.birdOrders.splice(s.birdOrders.indexOf(o), 1);
      s.reputation = clamp(s.reputation - BIRD_ORDERS.repLate, 0, 100);
      notify(s, `Commande de ${o.client} non livrée à temps : réputation en baisse.`, 'bad', '🚚');
    } else if (o.status === 'offer' && o.offerUntilDay < day) s.birdOrders.splice(s.birdOrders.indexOf(o), 1);
  }
  generateBirdOrders(s);
}
