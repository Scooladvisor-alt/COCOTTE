// Le personnel : des salariés visibles qui se déplacent dans la ferme et font réellement
// le travail (ramassage, remplissage, nettoyage, soins, arrosage, vente au comptoir).
import { BIRD_ORDERS, PETSHOP, WORKER_SKILLS, FRESHNESS, TIME, GRAIN_SACKS, GRID_H, GRID_W, PREDATORS, WORLD, clamp, gradeOf, sackPrice } from '../config/balance';
import { BUILDINGS, STAND_POS, sizeOf, standLayout, HALL_ALLEY, HALL_DOOR } from '../config/buildings';
import { ROLES, STAFF, WORKER_NAMES } from '../config/staff';
import { buildingCenter, canStand, cellIndex, coopDoor, cellX, cellZ, crossesFence, currentDay, facadeHeading, frontOf, toWorld, currentHour, emit, inGrid, isWalkable, nearestWalkable, newId, notify, pick, planPath, rand, randRange, rt, isShelter } from './core';
import { PREDATOR_INFO, damagePredator, distanceToFarm, predatorAimY } from './predators';
import { RAMP_FOOT, TRUCK_Z } from './deliveries';
import { henMovable, henValue } from './hens';
import { addXp, buyLevel, fmtMoney, spend } from './economy';
import { addToStorage, removeWorldEgg } from './eggs';
import { cleaningCost } from './buildings';
import { grainCapacity, grainPerDay, takeGrain, takeWater, waterCapacity } from './stocks';
import { buyGrain, buyHen, checkBuyHen, extraRoosters, fillTank, maleWords, sellHen } from './actions';
import { getBuilding, lvl, storage, storageFree } from './queries';
import type { ActionResult, Building, GameState, Predator, Worker, WorkerJob, WorkerJobKind, WorkerRole, WorkerSkill } from './types';

// Trajets extérieurs : maison → allée → chemin le long de la clôture → portail (ou arrière de l'étal)
const HOUSE = HALL_DOOR;
const LANE_Z = 31.35;
/** De la porte de l'hôtel de ville à l'allée, en traversant la cour. */
const COURT_Z = 28.3;
const TO_LANE: Array<[number, number]> = [HOUSE, [HOUSE[0], COURT_Z], [HALL_ALLEY, COURT_Z], [HALL_ALLEY, LANE_Z]];
const TO_GATE: Array<[number, number]> = [...TO_LANE, [14.5, LANE_Z], [14.5, 30.4], [14.5, 29.5]];

/**
 * Le vendeur se tient sur le côté de l'étal, face aux clients : derrière le comptoir,
 * l'auvent et la table le cacheraient à la caméra. Plusieurs vendeurs s'alignent côte à côte
 * (chacun sa place, quatre par rangée, la rangée suivante juste derrière).
 */
const SELLER_GAP = 0.75;
const SELLERS_PER_ROW = 4;
export function sellerSpot(s: GameState, w?: Worker): [number, number] {
  const level = standLevel(s);
  const i = w ? Math.max(0, workersOf(s, 'seller').indexOf(w)) : 0;
  // au magasin : côte à côte derrière le long comptoir, en rang centré. Ils y entrent par l'ouest :
  // le premier arrivé va le plus à l'est, si bien que personne n'a à passer devant un collègue.
  if (level >= 4) {
    const { cx, sellerZ } = standLayout(level);
    const m = Math.max(1, workersOf(s, 'seller').length);
    return [cx + ((m - 1) / 2 - i) * SELLER_GAP, sellerZ];
  }
  const [x, z]: [number, number] =
    level === 1 ? [STAND_POS.x + 2.35, STAND_POS.z + 0.4] : level === 2 ? [STAND_POS.x + 2.45, STAND_POS.z + 0.6] : [STAND_POS.x + 2.6, STAND_POS.z + 1.05];
  return [x + (i % SELLERS_PER_ROW) * SELLER_GAP, z - Math.floor(i / SELLERS_PER_ROW) * SELLER_GAP];
}
const standLevel = (s: GameState) => s.buildings.find((b) => b.type === 'stand')?.level ?? 1;
/** Cap des vendeurs : tous tournés vers les clients qui s'arrêtent devant l'étal. */
function sellerHeading(s: GameState) {
  const [x, z] = sellerSpot(s);
  const { cx, stopZ } = standLayout(standLevel(s));
  return Math.atan2(cx - x, stopZ - z);
}
/** Le magasin barre le passage : on en fait le tour par l'ouest pour passer derrière le comptoir. */
const SHOP_WEST_X = 15.3;
function toCounter(s: GameState, w: Worker): Array<[number, number]> {
  const [x, z] = sellerSpot(s, w);
  if (standLevel(s) >= 4) return [...TO_LANE, [SHOP_WEST_X, LANE_Z], [SHOP_WEST_X, z], [x, z]];
  return [...TO_LANE, [x, LANE_Z], [x, z]];
}
const flat = (pts: Array<[number, number]>) => pts.flatMap(([x, z]) => [x, z]);

// ------------------------------------------------------------- Requêtes ----
export function workersOf(s: GameState, role: WorkerRole) {
  return s.workers.filter((w) => w.role === role);
}
export function hasRole(s: GameState, role: WorkerRole) {
  return s.workers.some((w) => w.role === role);
}
export function onDuty(s: GameState, role: WorkerRole) {
  return s.workers.some((w) => w.role === role && w.onSite && w.job?.kind !== 'commuteIn' && w.job?.kind !== 'commuteOut');
}
export function sellerAtStand(s: GameState) {
  return s.workers.some((w) => w.role === 'seller' && w.onSite && w.job?.kind === 'stand');
}
export function dailyWages(s: GameState) {
  return s.workers.reduce((a, w) => a + ROLES[w.role].wage, 0) + (s.petShop.seller ? PETSHOP.sellerWage : 0);
}
export function basketCount(w: Worker) {
  return w.basket.reduce((a, l) => a + l.count, 0);
}
export function eggsInBaskets(s: GameState) {
  return s.workers.reduce((a, w) => a + basketCount(w), 0);
}
function startHour(role: WorkerRole) {
  return role === 'seller' ? STAFF.sellerStart : role === 'farmhand' ? STAFF.farmhandStart : STAFF.startHour;
}
function endHour(role: WorkerRole) {
  return role === 'farmhand' ? STAFF.farmhandEnd : STAFF.endHour;
}
function workHours(role: WorkerRole, h: number) {
  return h >= startHour(role) && h < endHour(role);
}
/** « 4 h 30 », « 8 h »… : heure de prise de poste affichée au joueur. */
export function startLabel(role: WorkerRole) {
  const h = role === 'seller' ? 8 : startHour(role);
  const m = Math.round((h % 1) * 60);
  return `${Math.floor(h)} h${m ? ` ${String(m).padStart(2, '0')}` : ''}`;
}
export function endLabel(role: WorkerRole) {
  return role === 'farmhand' ? 'après la rentrée des poules' : `${endHour(role)} h`;
}
/** Un abri ouvert dont personne ne s'occupe encore de fermer la trappe ? */
function uncoveredAt(s: GameState) {
  return openCoops(s).some((b) => !s.workers.some((o) => o.onSite && (o.job?.kind === 'waitCoop' || o.job?.kind === 'closeCoop') && o.job.targetId === b.id));
}
/** Abris encore ouverts que le commis doit fermer (il ne rentre pas tant qu'il en reste ; une trappe automatique se ferme toute seule). */
function openCoops(s: GameState) {
  return s.buildings.filter((b) => isShelter(b) && !b.closed && !b.autoDoor);
}

export const JOB_LABELS: Record<WorkerJobKind, string> = {
  commuteIn: 'Arrive au travail',
  commuteOut: 'Rentre chez soi',
  collectNest: 'Ramasse les œufs du pondoir',
  collectGround: 'Ramasse un œuf au sol',
  deposit: 'Range les œufs au stockage',
  refillFeeder: 'Remplit une mangeoire',
  refillDrinker: 'Remplit un abreuvoir',
  clean: 'Nettoie le poulailler',
  heal: 'Soigne une poule',
  water: 'Arrose la prairie',
  stand: 'Tient le comptoir',
  wander: 'Fait sa ronde',
  waitCoop: 'Attend que les poules rentrent',
  closeCoop: 'Ferme la trappe du poulailler',
  openCoop: 'Ouvre la trappe du poulailler',
  hunt: 'Traque le prédateur, fusil en main',
  loadTruck: 'Pousse les volailles vers le camion',
};

/** Le commis et le jardinier sont armés ; le vendeur et le soigneur restent à leur poste. */
export function isArmed(w: Worker) {
  return w.role === 'farmhand' || w.role === 'gardener';
}

// ------------------------------------------------------------ Embauche ----
export function checkHire(s: GameState, role: WorkerRole): ActionResult {
  // on embauche à n'importe quel niveau, autant qu'on veut : seul le salaire compte
  const def = ROLES[role];
  if (s.money < def.wage) return { ok: false, reason: `Il faut ${fmtMoney(def.wage)} pour la première paie` };
  return { ok: true };
}

export function createWorker(s: GameState, role: WorkerRole): Worker {
  const used = new Set(s.workers.map((w) => w.name));
  const free = WORKER_NAMES.filter((n) => !used.has(n));
  return {
    id: newId(s),
    role,
    name: free.length ? pick(s, free) : `${pick(s, WORKER_NAMES)} ${s.workers.length + 1}`,
    look: Math.floor(rand(s) * 1000),
    x: HOUSE[0],
    z: HOUSE[1],
    heading: Math.PI,
    onSite: false,
    job: null,
    path: [],
    basket: [],
    today: { eggs: 0, refills: 0, cleans: 0, heals: 0, waterings: 0, kills: 0 },
    total: { eggs: 0, refills: 0, cleans: 0, heals: 0, waterings: 0, kills: 0 },
    hiredDay: currentDay(s),
  };
}

export function hire(s: GameState, role: WorkerRole): ActionResult {
  const chk = checkHire(s, role);
  if (!chk.ok) return chk;
  const w = createWorker(s, role);
  s.workers.push(w);
  if (workHours(role, currentHour(s))) {
    // embauché en journée : il franchit tout de suite le portail (ou rejoint le comptoir)
    w.onSite = true;
    if (role === 'seller') {
      const [x, z] = sellerSpot(s, w);
      const shop = standLevel(s) >= 4;
      w.x = shop ? SHOP_WEST_X : x;
      // embauchés coup sur coup, ils arrivent l'un derrière l'autre
      w.z = WORLD.WALK_Z + (shop ? Math.max(0, workersOf(s, 'seller').indexOf(w)) * 0.7 : 0);
      w.heading = Math.PI;
      w.path = shop ? [SHOP_WEST_X, z, x, z] : [x, z];
      w.job = { kind: 'commuteIn', targetId: -1, tx: x, tz: z, phase: 'walk', t: 0 };
    } else {
      [w.x, w.z] = freeSpot(s, w, 14.5, 29.4);
      w.heading = Math.PI;
    }
    emit(s, { kind: 'workerArrived', workerId: w.id, x: w.x, z: w.z });
    notify(s, `${w.name} (${ROLES[role].title.toLowerCase()}) arrive et se met au travail !`, 'good', ROLES[role].icon);
  } else {
    notify(s, `${w.name} est embauché·e : début du service demain à ${startLabel(role)}.`, 'info', ROLES[role].icon);
  }
  return { ok: true };
}

export function fire(s: GameState, id: number): ActionResult {
  const w = s.workers.find((x) => x.id === id);
  if (!w) return { ok: false, reason: 'Salarié introuvable' };
  const lost = depositBasket(s, w);
  if (lost > 0) {
    s.stats.eggsLost += lost;
    w.basket = [];
  }
  s.workers.splice(s.workers.indexOf(w), 1);
  notify(s, `${w.name} a quitté la ferme.`, 'info', '👋');
  // plus personne pour ouvrir les trappes : on les laisse ouvertes
  if (!hasRole(s, 'farmhand')) for (const b of s.buildings) if (isShelter(b)) b.closed = false;
  return { ok: true };
}

// --------------------------------------------------------- Trajectoires ----
function follow(s: GameState, w: Worker, dt: number, mult = 1): boolean {
  const commuting = w.job?.kind === 'commuteIn' || w.job?.kind === 'commuteOut';
  let budget = STAFF.walkSpeed * (commuting ? STAFF.commuteSpeed : 1) * mult * dt;
  unstick(w, dt);
  while (w.path.length >= 2 && budget > 0) {
    const dx = w.path[0] - w.x;
    const dz = w.path[1] - w.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      w.path.splice(0, 2);
      continue;
    }
    const want = Math.atan2(dx, dz);
    let diff = want - w.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    w.heading += Math.max(-8 * dt, Math.min(8 * dt, diff));
    const step = Math.min(d, budget);
    // un collègue juste devant : il ne lui rentre pas dedans, il le contourne (ou il attend)
    if (stallTime(w) < 0.7 && giveWay(s, w, dx / d, dz / d, step)) return false;
    w.x += (dx / d) * step;
    w.z += (dz / d) * step;
    budget -= step;
    if (step >= d) w.path.splice(0, 2);
  }
  return w.path.length < 2;
}

/**
 * Ce pas l'amènerait-il dans un collègue ? Si oui, il s'écarte par sa droite (les deux se croisent
 * ainsi sans se toucher), sauf derrière quelqu'un qui marche dans le même sens : il le suit.
 */
function giveWay(s: GameState, w: Worker, ux: number, uz: number, step: number) {
  const nx = w.x + ux * step;
  const nz = w.z + uz * step;
  for (const o of s.workers) {
    if (o === w || !o.onSite) continue;
    const after = Math.hypot(o.x - nx, o.z - nz);
    if (after >= HUMAN_GAP || after >= Math.hypot(o.x - w.x, o.z - w.z)) continue;
    if (o.path.length >= 2) {
      const ox = o.path[0] - o.x;
      const oz = o.path[1] - o.z;
      const ol = Math.hypot(ox, oz);
      if (ol > 1e-3 && (ox * ux + oz * uz) / ol > 0.5) return true;
    }
    if (!bump(s, w, uz * HUMAN_SIDESTEP, -ux * HUMAN_SIDESTEP)) bump(s, w, -uz * HUMAN_SIDESTEP, ux * HUMAN_SIDESTEP);
    return true;
  }
  return false;
}

/** Depuis combien de temps un salarié n'avance plus vers son prochain point de passage. */
const stalls = new WeakMap<Worker, { n: number; best: number; t: number }>();
const stallTime = (w: Worker) => stalls.get(w)?.t ?? 0;
/**
 * Les salariés sont solides : un collègue peut occuper un point de passage, ou la place visée.
 * Il passe alors au point suivant ; au bout du trajet, il travaille d'où il est, tout à côté.
 */
function unstick(w: Worker, dt: number) {
  if (w.path.length < 2) return;
  const d = Math.hypot(w.path[0] - w.x, w.path[1] - w.z);
  const st = stalls.get(w);
  if (!st || st.n !== w.path.length || d < st.best - 0.03) {
    stalls.set(w, { n: w.path.length, best: d, t: 0 });
    return;
  }
  st.t += dt;
  if (st.t > 0.7 && d < HUMAN_GAP + 0.4) {
    w.path.splice(0, 2);
    stalls.delete(w);
  }
}

function face(w: Worker, x: number, z: number) {
  if (Math.hypot(x - w.x, z - w.z) > 0.05) w.heading = Math.atan2(x - w.x, z - w.z);
}

/** Une place est-elle prise par un collègue (il s'y tient, ou il y va) ? */
function spotTaken(s: GameState, w: Worker, x: number, z: number) {
  return s.workers.some((o) => {
    if (o === w || !o.onSite) return false;
    if (Math.hypot(o.x - x, o.z - z) < HUMAN_GAP && o.path.length < 2) return true;
    return !!o.job && Math.hypot(o.job.tx - x, o.job.tz - z) < HUMAN_GAP;
  });
}
/** La place voulue, ou la plus proche qui soit libre : deux salariés ne visent jamais le même point. */
function freeSpot(s: GameState, w: Worker, tx: number, tz: number): [number, number] {
  if (!spotTaken(s, w, tx, tz)) return [tx, tz];
  for (const r of [0.7, 1.05, 1.5, 2])
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const x = tx + Math.sin(a) * r;
      const z = tz + Math.cos(a) * r;
      if (canStand(s, x, z, 0.16) && !spotTaken(s, w, x, z)) return [x, z];
    }
  return [tx, tz];
}

function assign(s: GameState, w: Worker, kind: WorkerJobKind, targetId: number, tx0: number, tz0: number, workTime: number) {
  const [tx, tz] = freeSpot(s, w, tx0, tz0);
  const path = humanPath(s, w.x, w.z, tx, tz);
  if (!path) return false;
  w.job = { kind, targetId, tx, tz, phase: 'walk', t: workTime };
  w.path = path;
  return true;
}

/** Trajet d'un salarié : il passe par les portails ; sans portail, il enjambe le grillage. */
function humanPath(s: GameState, fx: number, fz: number, tx: number, tz: number) {
  return planPath(s, fx, fz, tx, tz, 0.16, 'human') ?? planPath(s, fx, fz, tx, tz, 0.16, 'free');
}

/** Point accessible devant un bâtiment, du côté du salarié. */
function besideBuilding(s: GameState, b: Building, w: Worker): [number, number] | null {
  if (isShelter(b)) return frontOf(b, 0.75);
  if (b.type === 'nest') return nestFront(b, 0.55);
  const c = buildingCenter(b);
  const { w: bw, d: bd0 } = sizeOf(b.type, b.level, b.rot);
  let best: [number, number] | null = null;
  let bd = Infinity;
  // points tout autour de l'emprise (les grandes auges sont longues : on longe leurs côtés)
  const n = 16 + 4 * (bw + bd0 - 2);
  for (let a = 0; a < n; a++) {
    const ang = (a / n) * Math.PI * 2;
    const ex = Math.sin(ang);
    const ez = Math.cos(ang);
    const k = 1 / Math.max(Math.abs(ex) / (bw / 2 + 0.55), Math.abs(ez) / (bd0 / 2 + 0.55));
    const x = c.x + ex * k;
    const z = c.z + ez * k;
    if (!canStand(s, x, z, 0.16)) continue;
    const d = Math.hypot(x - w.x, z - w.z);
    if (d < bd) {
      bd = d;
      best = [x, z];
    }
  }
  return best;
}

function reservedBy(s: GameState, self: Worker) {
  const set = new Set<string>();
  for (const o of s.workers) if (o !== self && o.job) set.add(`${o.job.kind}:${o.job.targetId}`);
  return set;
}

// ----------------------------------------------------------- Corvées ----
/** Point devant la trappe d'un poulailler (à droite de la rampe, pour ne pas gêner les poules). */
function coopDoorPoint(b: Building): [number, number] {
  return frontOf(b, 0.6, 0.75);
}
/** Point d'attente, à l'écart de la porte, en regardant les poules rentrer. */
function coopWaitPoint(s: GameState, b: Building): [number, number] {
  const half = sizeOf(b.type, b.level).w / 2;
  for (const [out, side] of [
    [0.4, half + 0.4],
    [0.4, -half - 0.4],
    [1.3, half + 0.2],
    [1.3, -half - 0.2],
    [1.6, 0],
  ]) {
    const [x, z] = frontOf(b, out, side);
    if (canStand(s, x, z, 0.2)) return [x, z];
  }
  return coopDoorPoint(b);
}
/** Devant un pondoir, au milieu, à `out` m de sa façade. */
function nestFront(b: Building, out: number): [number, number] {
  return toWorld(b, 1, BUILDINGS.nest.d + out);
}

type CareTask = { kind: WorkerJobKind; b: Building; at: [number, number]; time: number };

/**
 * Corvées d'entretien, dans l'ordre de priorité du commis :
 * l'eau d'abord, puis le grain, puis la propreté des poulaillers.
 */
function careTask(s: GameState, w: Worker): CareTask | null {
  const taken = reservedBy(s, w);
  const ratio = (b: Building) => b.stock / lvl(b).capacity;
  const drinkers = s.buildings
    .filter((b) => b.type === 'drinker' && !lvl(b).auto && s.water >= 1 && ratio(b) < STAFF.waterBelow && !taken.has(`refillDrinker:${b.id}`))
    .sort((a, b) => ratio(a) - ratio(b));
  for (const b of drinkers) {
    const at = besideBuilding(s, b, w);
    if (at) return { kind: 'refillDrinker', b, at, time: STAFF.refillTime };
  }
  const feeders = s.buildings
    .filter((b) => b.type === 'feeder' && !lvl(b).auto && s.grain >= 1 && ratio(b) < STAFF.feedBelow && !taken.has(`refillFeeder:${b.id}`))
    .sort((a, b) => ratio(a) - ratio(b));
  for (const b of feeders) {
    const at = besideBuilding(s, b, w);
    if (at) return { kind: 'refillFeeder', b, at, time: STAFF.refillTime };
  }
  const coops = s.buildings
    .filter((b) => isShelter(b) && b.cleanliness < STAFF.cleanBelow && s.money >= cleaningCost(b) && !taken.has(`clean:${b.id}`))
    .sort((a, b) => a.cleanliness - b.cleanliness);
  for (const b of coops) {
    const at = besideBuilding(s, b, w);
    if (at) return { kind: 'clean', b, at, time: STAFF.cleanTime };
  }
  return null;
}

const lastOrder = new WeakMap<GameState, { grain: number; water: number }>();
/**
 * Le commis commande l'eau et le grain dès que les réserves baissent (si le joueur l'autorise) :
 * il y veille tout au long de sa journée, quoi qu'il soit en train de faire, et remplit la réserve
 * à grain de plusieurs sacs d'un coup s'il le faut, pour qu'elle ne reste jamais vide.
 */
function restock(s: GameState, w: Worker) {
  if (!s.settings.staffRestock) return;
  let last = lastOrder.get(s);
  if (!last) lastOrder.set(s, (last = { grain: -Infinity, water: -Infinity }));
  const gap = (TIME.DAY / 24) * STAFF.restockEveryHours;
  if (s.clock.t - last.water >= gap && s.water < waterCapacity(s) * STAFF.restockWaterBelow) {
    const before = s.water;
    const money = s.money;
    if (fillTank(s).ok) {
      last.water = s.clock.t;
      notify(s, `${w.name} a commandé ${Math.round(s.water - before)} L d’eau (${fmtMoney(money - s.money)}).`, 'info', '💧');
    } else warnLowFunds(s, w, 'd’eau');
  }
  const rate = Math.max(grainPerDay(s), s.hens.length ? 1 : 0);
  const cap = grainCapacity(s);
  const low = s.grain < rate * STAFF.restockGrainDays || s.grain < cap * STAFF.restockGrainBelow;
  if (rate <= 0 || !low || s.clock.t - last.grain < gap) return;
  const level = buyLevel(s);
  const target = Math.min(cap, Math.max(rate * STAFF.restockGrainTarget, cap * 0.6));
  const bought = new Map<string, number>();
  let spent = 0;
  // le plus gros sac qui rentre, encore et encore, jusqu'à la provision voulue (ou plus de place / d'argent)
  for (let guard = 0; guard < 40 && s.grain < target; guard++) {
    const room = cap - s.grain;
    const sack = [...GRAIN_SACKS].reverse().find((g) => g.reqLevel <= level && g.rations <= room && sackPrice(g, s.market.grainIndex) <= s.money);
    if (!sack || !buyGrain(s, sack.id).ok) break;
    bought.set(sack.name, (bought.get(sack.name) ?? 0) + 1);
    spent += sackPrice(sack, s.market.grainIndex);
  }
  if (bought.size) {
    last.grain = s.clock.t;
    const what = [...bought].map(([name, n]) => (n > 1 ? `${n} × ${name.toLowerCase()}` : `un ${name.toLowerCase()}`)).join(' et ');
    notify(s, `${w.name} a commandé ${what} de grain (${fmtMoney(spent)}).`, 'info', '🌾');
  } else if (s.grain < rate * 0.5) warnLowFunds(s, w, 'de grain');
}
const lowFundsWarned = new WeakMap<GameState, number>();
function warnLowFunds(s: GameState, w: Worker, what: string) {
  const last = lowFundsWarned.get(s) ?? -Infinity;
  if (s.clock.t - last < TIME.DAY) return;
  lowFundsWarned.set(s, s.clock.t);
  notify(s, `${w.name} n’a pas pu commander ${what} : fonds insuffisants ou réserve trop petite.`, 'warn', '⚠️');
}

/** Ramassage « au passage » : en passant devant un pondoir garni ou un œuf au sol. */
function pickupOnTheWay(s: GameState, w: Worker) {
  if (basketCount(w) >= STAFF.basketMax) return;
  for (const b of s.buildings) {
    if (b.type !== 'nest' || b.eggIds.length === 0) continue;
    const [fx, fz] = nestFront(b, 0.5);
    if (Math.hypot(fx - w.x, fz - w.z) > STAFF.pickupRadius) continue;
    const n = pickUp(s, w, [...b.eggIds]);
    if (n > 0) {
      w.lastPickT = s.clock.t;
      const c = buildingCenter(b);
      emit(s, { kind: 'eggsCollected', count: n, x: c.x, z: c.z });
    }
  }
  for (const e of s.worldEggs) {
    if (e.where !== 'ground' || Math.hypot(e.x - w.x, e.z - w.z) > 0.6) continue;
    if (pickUp(s, w, [e.id]) > 0) w.lastPickT = s.clock.t;
  }
}

/** Sa place dans la cour, à l'écart de la voie du camion et du passage des volailles, qu'il guide vers la rampe. */
export function herdSpot(s: GameState, w: Worker): [number, number] {
  return s.workers.filter((o) => o.job?.kind === 'loadTruck').indexOf(w) > 0 ? [77.6, 28.8] : [79.4, 27.3];
}

/** Va pousser les volailles vers la rampe du camion, garé dans la parcelle du bout. */
function goLoadTruck(s: GameState, w: Worker) {
  const L = s.birdLoad;
  if (!L || L.leave !== undefined || !L.called) return false;
  if (s.workers.filter((o) => o.job?.kind === 'loadTruck').length >= BIRD_ORDERS.helpers) return false;
  const [tx, tz] = herdSpot(s, w);
  w.path = humanPath(s, w.x, w.z, tx, tz) ?? [tx, tz];
  w.job = { kind: 'loadTruck', targetId: L.id, tx, tz, phase: 'walk', t: 0 };
  return true;
}

/** Dans la cour, bras écartés : les volailles qui arrivent avancent devant lui vers la rampe. */
function herd(s: GameState, w: Worker, dt: number) {
  const [tx, tz] = herdSpot(s, w);
  const dx = tx - w.x;
  const dz = tz - w.z;
  const l = Math.hypot(dx, dz);
  // de temps en temps, s'il est loin : y a-t-il un obstacle à contourner (le camion, un bâtiment) ?
  if (w.job) {
    w.job.t += dt;
    if (w.job.t > 1 && l > 2.5) {
      w.job.t = 0;
      const way = humanPath(s, w.x, w.z, tx, tz);
      if (way && way.length > 2) {
        w.path = way;
        w.job.phase = 'walk';
        return;
      }
    }
  }
  if (l > 0.15) {
    const step = Math.min(l, STAFF.walkSpeed * 0.75 * dt);
    const sx = (dx / l) * step;
    const sz = (dz / l) * step;
    // (il travaillait au pied d'un bâtiment : il s'en dégage d'abord)
    if (!canStand(s, w.x, w.z, 0.1)) {
      w.x += sx;
      w.z += sz;
    }
    // il longe ce qui le gêne (le camion, un bâtiment) ; bloqué pour de bon, il fait le tour
    else if (canStand(s, w.x + sx, w.z + sz, 0.1)) {
      w.x += sx;
      w.z += sz;
    } else if (canStand(s, w.x + sx, w.z, 0.1)) w.x += sx;
    else if (canStand(s, w.x, w.z + sz, 0.1)) w.z += sz;
  }
  face(w, RAMP_FOOT, TRUCK_Z);
}

/**
 * Chaque heure, les droits achetés pour un commis présent : il vend les coqs et les jars en trop (en
 * gardant le meilleur de chaque), et remplace les volailles malades quand c'est possible.
 */
export function workerSkillsHourly(s: GameState) {
  const on = (skill: WorkerSkill) => s.workers.find((w) => w.role === 'farmhand' && w.onSite && w.skills?.includes(skill));
  const r = on('roosters');
  if (r) {
    const extra = extraRoosters(s);
    if (extra.length) {
      let total = 0;
      for (const h of extra) {
        total += henValue(h);
        sellHen(s, h.id);
      }
      notify(s, `${r.name} a vendu ${maleWords(extra)} en trop : +${fmtMoney(total)}.`, 'good', '🐓');
    }
  }
  const c = on('sick');
  if (c) {
    const sick = s.hens.filter((h) => h.sick && !h.young && !h.rooster && !h.golden && !h.legendary && !h.ship && h.act !== 'caught');
    let sold = 0;
    let bought = 0;
    let total = 0;
    for (const h of sick) {
      total += henValue(h);
      sellHen(s, h.id);
      sold++;
      if (checkBuyHen(s, h.breed).ok && buyHen(s, h.breed).ok) bought++;
    }
    if (sold) notify(s, `${c.name} a vendu ${sold} volaille${sold > 1 ? 's' : ''} malade${sold > 1 ? 's' : ''} (+${fmtMoney(total)})${bought ? ` et en a racheté ${bought}` : ' mais n’a pas pu en racheter'}.`, bought ? 'good' : 'info', '🩺');
  }
}

/** Achète une option pour ce commis. */
export function buyWorkerSkill(s: GameState, id: number, skill: WorkerSkill): ActionResult {
  const w = s.workers.find((x) => x.id === id);
  if (!w || w.role !== 'farmhand') return { ok: false, reason: 'Réservé aux commis de ferme' };
  if (w.skills?.includes(skill)) return { ok: false, reason: 'Il sait déjà le faire' };
  const def = WORKER_SKILLS[skill];
  if (!spend(s, def.price, 'salaires', `${w.name} : ${def.name.toLowerCase()}`)) return { ok: false, reason: 'Fonds insuffisants' };
  (w.skills ??= []).push(skill);
  return { ok: true };
}

function chooseFarmhandJob(s: GameState, w: Worker) {
  // un camion à charger passe avant tout le reste
  if (goLoadTruck(s, w)) return;
  const taken = reservedBy(s, w);
  const carried = basketCount(w);
  const st = storage(s);
  const dist = (x: number, z: number) => Math.hypot(x - w.x, z - w.z);
  // les commis se répartissent : au plus près, mais pas là où un collègue s'active déjà
  const cost = (x: number, z: number) => dist(x, z) + crowdNear(s, w, x, z) * 8;
  // 1. le matin : ouvrir les trappes pour libérer les poules, chacun son poulailler (l'après-midi,
  //    une trappe fermée par le joueur le reste)
  if (currentHour(s) < 12) {
    const closed = s.buildings
      .filter((b) => isShelter(b) && b.closed && !b.autoDoor && !taken.has(`openCoop:${b.id}`))
      .map((b) => ({ b, c: cost(coopDoor(b).x, coopDoor(b).z) }))
      .sort((a, b) => a.c - b.c);
    for (const { b } of closed) {
      const [x, z] = coopDoorPoint(b);
      if (assign(s, w, 'openCoop', b.id, x, z, STAFF.openTime)) return;
    }
  }
  // 2. entretien : eau, grain, propreté
  const care = careTask(s, w);
  if (care && assign(s, w, care.kind, care.b.id, care.at[0], care.at[1], care.time)) return;
  // 3. panier plein : on le vide avant de continuer
  if (carried >= STAFF.basketMax * 0.8 && st) {
    const p = besideBuilding(s, st, w);
    if (p && assign(s, w, 'deposit', st.id, p[0], p[1], STAFF.depositTime)) return;
  }
  // 4. en dernier : les œufs (pondoirs garnis, puis œufs au sol)
  const nests = s.buildings
    .filter((b) => b.type === 'nest' && b.eggIds.length >= 2 && !taken.has(`collectNest:${b.id}`))
    .sort((a, b) => cost(a.x, a.z) - cost(b.x, b.z));
  if (nests.length && carried < STAFF.basketMax) {
    const n = nests[0];
    const p = besideBuilding(s, n, w)!;
    if (assign(s, w, 'collectNest', n.id, p[0], p[1], STAFF.collectTime)) return;
  }
  const ground = s.worldEggs.filter((e) => e.where === 'ground' && !taken.has(`collectGround:${e.id}`)).sort((a, b) => cost(a.x, a.z) - cost(b.x, b.z));
  if (ground.length && carried < STAFF.basketMax) {
    const e = ground[0];
    if (assign(s, w, 'collectGround', e.id, e.x, e.z + 0.35, STAFF.collectTime * 0.7)) return;
  }
  if (carried > 0 && st) {
    const p = besideBuilding(s, st, w);
    if (p && assign(s, w, 'deposit', st.id, p[0], p[1], STAFF.depositTime)) return;
  }
  // rien à faire : ronde de surveillance dans un coin de la ferme où personne ne se trouve
  patrol(s, w);
}

/** Collègues du même métier qui travaillent (ou vont travailler) près de ce point. */
function crowdNear(s: GameState, w: Worker, x: number, z: number, r = 6) {
  let n = 0;
  for (const o of s.workers) {
    if (o === w || !o.onSite || o.role !== w.role) continue;
    if (Math.hypot((o.job?.tx ?? o.x) - x, (o.job?.tz ?? o.z) - z) < r) n++;
  }
  return n;
}

/** Coin de ronde de chaque salarié désœuvré : il y reste un moment, puis va voir ailleurs. */
const patrols = new WeakMap<Worker, { x: number; z: number; r: number; until: number }>();
function patrol(s: GameState, w: Worker) {
  let p = patrols.get(w);
  if (!p || s.clock.t >= p.until) {
    const others = s.workers.filter((o) => o !== w && o.onSite && o.role !== 'seller');
    let best: Building | null = null;
    let bs = -Infinity;
    for (const b of s.buildings) {
      if (b.type === 'stand' || b.type === 'tree' || b.type === 'bush') continue;
      const c = buildingCenter(b);
      // loin des collègues, sans traverser toute la ferme, avec une part de hasard
      const near = others.reduce((m, o) => Math.min(m, Math.hypot((o.job?.tx ?? o.x) - c.x, (o.job?.tz ?? o.z) - c.z)), 14);
      const score = near + rand(s) * 6 - Math.hypot(c.x - w.x, c.z - w.z) * 0.12;
      if (score > bs) {
        bs = score;
        best = b;
      }
    }
    if (!best) return wander(s, w, { x: 14.5, z: 26 }, 4);
    const c = buildingCenter(best);
    const { w: bw, d: bd } = sizeOf(best.type, best.level, best.rot);
    p = { x: c.x, z: c.z, r: Math.max(bw, bd) / 2 + 2, until: s.clock.t + randRange(s, 20, 40) };
    patrols.set(w, p);
  }
  wander(s, w, p, p.r);
}

function chooseCaretakerJob(s: GameState, w: Worker) {
  const taken = reservedBy(s, w);
  const patients = s.hens
    .filter((h) => (h.sick || h.health < STAFF.healBelow) && !h.nursery && h.act !== 'sleep' && h.act !== 'enter' && !taken.has(`heal:${h.id}`))
    .sort((a, b) => a.health - b.health);
  if (patients.length) {
    const h = patients[0];
    if (assign(s, w, 'heal', h.id, h.x, h.z + 0.45, STAFF.healTime)) return;
  }
  const awake = s.hens.filter((h) => h.act !== 'sleep' && !h.nursery);
  if (awake.length) {
    const h = awake[Math.floor(rand(s) * awake.length)];
    return wander(s, w, { x: h.x, z: h.z }, 1.5);
  }
  wander(s, w, { x: 14.5, z: 25 }, 4);
}

/**
 * Le jardinier s'occupe d'abord des zones déverdies : il cherche sur tout le terrain le coin où
 * l'herbe manque le plus (rase, jaunie, terre à nu), sans courir trop loin ni arroser là où un
 * collègue travaille déjà ; l'herbe encore verte attend que le pire soit réparé.
 */
function chooseGardenerJob(s: GameState, w: Worker) {
  const r = rt(s);
  const R = 2;
  const others = s.workers.filter((o) => o !== w && o.job?.kind === 'water').map((o) => [o.job!.tx, o.job!.tz]);
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    if (!r.walk[i] || !r.owned[i] || s.grass[i] > 0.7) continue;
    const x = cellX(i);
    const z = cellZ(i);
    // herbe qui manque autour (ce qu'un arrosage peut faire repousser)
    let lack = 0;
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R + 1 || !inGrid(x + dx, z + dz)) continue;
        const j = cellIndex(x + dx, z + dz);
        if (r.owned[j] && !r.blocked[j]) lack += Math.max(0, 0.9 - s.grass[j]);
      }
    if (others.some(([ox, oz]) => Math.hypot(ox - x - 0.5, oz - z - 0.5) < 3.5)) continue;
    const score = lack - Math.hypot(x + 0.5 - w.x, z + 0.5 - w.z) * 0.04;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  // assez d'herbe à refaire pousser pour que le déplacement vaille la peine
  if (best >= 0 && bestScore > 0.6) {
    const x = cellX(best) + 0.5;
    const z = cellZ(best) + 0.5;
    if (assign(s, w, 'water', best, x, z, STAFF.waterTime)) return;
  }
  patrol(s, w);
}

function wander(s: GameState, w: Worker, around: { x: number; z: number }, radius: number) {
  for (let k = 0; k < 8; k++) {
    const a = rand(s) * Math.PI * 2;
    const d = rand(s) * radius;
    const x = around.x + Math.sin(a) * d;
    const z = around.z + Math.cos(a) * d;
    if (canStand(s, x, z, 0.2) && assign(s, w, 'wander', -1, x, z, randRange(s, 2, 4.5))) return;
  }
  w.job = { kind: 'wander', targetId: -1, tx: w.x, tz: w.z, phase: 'work', t: 2 };
  w.path = [];
  // perdu hors du terrain (sur la route…) : il rejoint d'abord l'entrée de la ferme
  if (!inGrid(Math.floor(w.x), Math.floor(w.z))) {
    const back = humanPath(s, w.x, w.z, 14.5, 29.3);
    if (back) {
      w.job = { kind: 'wander', targetId: -1, tx: 14.5, tz: 29.3, phase: 'walk', t: 1 };
      w.path = back;
    }
  }
}

/** Vide le panier dans le stockage ; renvoie le nombre d'œufs qui n'ont pas trouvé de place. */
function depositBasket(s: GameState, w: Worker) {
  let stored = 0;
  for (const l of w.basket) {
    const n = addToStorage(s, l.type, l.grade, l.freshness, l.count, l.fertile, l.genes);
    l.count -= n;
    stored += n;
  }
  w.basket = w.basket.filter((l) => l.count > 0);
  if (stored > 0) {
    s.stats.eggsCollected += stored;
    addXp(s, stored);
    const st = storage(s);
    if (st) {
      const c = buildingCenter(st);
      emit(s, { kind: 'eggsCollected', count: stored, x: c.x, z: c.z });
    }
  }
  return basketCount(w);
}

function pickUp(s: GameState, w: Worker, eggIds: number[]) {
  let n = 0;
  for (const id of eggIds) {
    if (basketCount(w) >= STAFF.basketMax) break;
    const e = s.worldEggs.find((x) => x.id === id);
    if (!e) continue;
    removeWorldEgg(s, e);
    const grade = gradeOf(Math.min(1, e.quality + STAFF.farmhandQuality));
    const lot = w.basket.find((l) => l.type === e.type && l.grade === grade && l.fertile === e.fertile && l.genes === e.genes);
    if (lot) {
      lot.freshness = (lot.freshness * lot.count + e.freshness) / (lot.count + 1);
      lot.count++;
    } else w.basket.push({ type: e.type, grade, freshness: e.freshness, count: 1, ...(e.fertile ? { fertile: e.fertile, genes: e.genes } : {}) });
    n++;
  }
  w.today.eggs += n;
  w.total.eggs += n;
  return n;
}

function complete(s: GameState, w: Worker, j: WorkerJob) {
  switch (j.kind) {
    case 'commuteIn':
      if (w.role === 'seller') w.job = { kind: 'stand', targetId: -1, tx: w.x, tz: w.z, phase: 'work', t: 1e9 };
      return;
    case 'commuteOut':
      w.onSite = false;
      return;
    case 'collectNest': {
      const b = getBuilding(s, j.targetId);
      if (b && b.type === 'nest') {
        const n = pickUp(s, w, [...b.eggIds]);
        const c = buildingCenter(b);
        if (n > 0) emit(s, { kind: 'eggsCollected', count: n, x: c.x, z: c.z });
      }
      return;
    }
    case 'collectGround': {
      const e = s.worldEggs.find((x) => x.id === j.targetId);
      if (e && Math.hypot(e.x - w.x, e.z - w.z) < 1.2) pickUp(s, w, [e.id]);
      return;
    }
    case 'deposit': {
      const left = depositBasket(s, w);
      if (left > 0 && storageFree(s) <= 0) notify(s, `${w.name} ne peut plus ranger d’œufs : stockage plein !`, 'warn', '📦');
      return;
    }
    case 'refillFeeder': {
      const b = getBuilding(s, j.targetId);
      if (!b) return;
      const n = takeGrain(s, lvl(b).capacity - b.stock);
      if (n > 0) {
        b.stock += n;
        s.stats.feederFills++;
        w.today.refills++;
        w.total.refills++;
      }
      return;
    }
    case 'refillDrinker': {
      const b = getBuilding(s, j.targetId);
      if (!b) return;
      const n = takeWater(s, lvl(b).capacity - b.stock);
      if (n > 0) {
        b.stock += n;
        w.today.refills++;
        w.total.refills++;
      }
      return;
    }
    case 'clean': {
      const b = getBuilding(s, j.targetId);
      if (!b || !isShelter(b)) return;
      if (spend(s, cleaningCost(b), 'litiere', `Litière (${w.name})`)) {
        b.cleanliness = 100;
        s.stats.coopsCleaned++;
        w.today.cleans++;
        w.total.cleans++;
      }
      return;
    }
    case 'heal': {
      const h = s.hens.find((x) => x.id === j.targetId);
      if (!h || Math.hypot(h.x - w.x, h.z - w.z) > 1.3) return;
      h.health = Math.min(100, h.health + STAFF.healAmount);
      if (h.sick) notify(s, `${w.name} a soigné ${h.name}.`, 'good', '💊');
      h.sick = false;
      w.today.heals++;
      w.total.heals++;
      return;
    }
    case 'water': {
      const r = rt(s);
      const R = STAFF.waterRadius;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const x = Math.floor(j.tx) + dx;
          const z = Math.floor(j.tz) + dz;
          if (!inGrid(x, z) || !r.owned[cellIndex(x, z)]) continue;
          const d = Math.hypot(x + 0.5 - j.tx, z + 0.5 - j.tz);
          if (d > R) continue;
          const i = cellIndex(x, z);
          s.grass[i] = Math.min(1, s.grass[i] + STAFF.waterBoost * (1 - d / R) + 0.05);
        }
      w.today.waterings++;
      w.total.waterings++;
      return;
    }
    case 'closeCoop': {
      const b = getBuilding(s, j.targetId);
      if (!b || !isShelter(b) || b.closed) return;
      b.closed = true;
      const outside = s.hens.filter((h) => h.coopId === b.id && h.act !== 'sleep' && h.act !== 'enter');
      if (outside.length)
        notify(s, `${outside.length} poule${outside.length > 1 ? 's sont restées' : ' est restée'} dehors cette nuit (${outside.map((h) => h.name).slice(0, 3).join(', ')}).`, 'warn', '🌙');
      if (openCoops(s).length === 0) notify(s, `${w.name} a fermé tous les poulaillers et rentre à la maison. Bonne nuit !`, 'info', '🌙');
      return;
    }
    case 'openCoop': {
      const b = getBuilding(s, j.targetId);
      if (b && isShelter(b)) b.closed = false;
      return;
    }
    case 'stand':
    case 'wander':
    case 'waitCoop':
    case 'hunt':
    case 'loadTruck':
      return;
  }
}

/** Le soir : le commis attend que chaque poulailler soit plein avant de fermer sa trappe. */
function eveningRound(s: GameState, w: Worker) {
  const st = storage(s);
  if (basketCount(w) > 0 && st && storageFree(s) > 0) {
    const p = besideBuilding(s, st, w);
    if (p && assign(s, w, 'deposit', st.id, p[0], p[1], STAFF.depositTime)) return true;
  }
  const taken = reservedBy(s, w);
  const coops = openCoops(s)
    .filter((b) => !taken.has(`waitCoop:${b.id}`) && !taken.has(`closeCoop:${b.id}`))
    .sort((a, b) => Math.hypot(a.x - w.x, a.z - w.z) - Math.hypot(b.x - w.x, b.z - w.z));
  if (coops.length) {
    const [x, z] = coopWaitPoint(s, coops[0]);
    if (assign(s, w, 'waitCoop', coops[0].id, x, z, 0)) return true;
  }
  // un collègue s'occupe du dernier poulailler : inutile de traîner dans le noir, il rentre
  return false;
}

/** Tous les occupants du poulailler dorment-ils à l'intérieur ? */
function coopFull(s: GameState, b: Building) {
  return s.hens.every((h) => h.coopId !== b.id || h.act === 'sleep');
}

// ------------------------------------------------------ Mission commando ----
// Le salarié armé « sent » le prédateur, lâche tout, court se mettre à portée et tire.
interface Hunt {
  aim: number;
  repath: number;
}
const hunts = new WeakMap<Worker, Hunt>();

/** Prédateur à traquer : le plus proche, repéré, et encore aux abords de la ferme. */
function pickPrey(s: GameState, w: Worker): Predator | null {
  let best: Predator | null = null;
  let bd = Infinity;
  for (const p of s.predators) {
    if (p.state === 'dead' || p.age < PREDATORS.staff.detectDelay) continue;
    if (p.species === 'hawk' && p.state === 'arrive') continue;
    if (distanceToFarm(s, p.x, p.z) > 7) continue;
    const d = Math.hypot(p.x - w.x, p.z - w.z);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

function startHunt(s: GameState, w: Worker, p: Predator) {
  if (!p.spotted) {
    p.spotted = true;
    notify(s, `${w.name} a repéré ${PREDATOR_INFO[p.species].a} et sort son fusil !`, 'warn', '🎯');
  }
  w.job = { kind: 'hunt', targetId: p.id, tx: p.x, tz: p.z, phase: 'walk', t: 0 };
  w.path = [];
  hunts.set(w, { aim: 0, repath: 0 });
}

function shootAt(s: GameState, w: Worker, p: Predator, d: number) {
  const H = PREDATORS.staff;
  let chance = H.hitNear + (H.hitFar - H.hitNear) * clamp((d - 2) / (H.range - 2), 0, 1);
  if (p.species === 'hawk' && p.y > 1.5) chance *= H.airFactor;
  if (p.species === 'wolf') chance *= H.wolfFactor;
  const hit = rand(s) < chance;
  // à genoux pour les tirs lointains (position du tireur d'élite)
  const y0 = d > 4 ? 0.6 : 0.9;
  const py = predatorAimY(p);
  const x1 = hit ? p.x : p.x + randRange(s, -0.7, 0.7);
  const z1 = hit ? p.z : p.z + randRange(s, -0.7, 0.7);
  const y1 = hit ? py : p.species === 'hawk' && p.y > 1 ? py + randRange(s, 0.5, 1.2) : 0.1;
  emit(s, { kind: 'shot', by: w.id, x0: w.x + Math.sin(w.heading) * 0.5, y0, z0: w.z + Math.cos(w.heading) * 0.5, x1, y1, z1, hit });
  w.lastShotT = s.clock.t;
  if (hit) damagePredator(s, p, H.damage, w);
}

/**
 * Ligne de tir dégagée ? Aucun bâtiment (poulailler, réserve, arbre…) entre le tireur et sa cible ;
 * le grillage, lui, ne gêne pas. Une buse haut dans le ciel se vise par-dessus les toits.
 */
export function lineOfFire(s: GameState, x0: number, z0: number, p: { x: number; z: number; y?: number; species?: string }) {
  if (p.species === 'hawk' && (p.y ?? 0) > 2.5) return true;
  const r = rt(s);
  const dx = p.x - x0;
  const dz = p.z - z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / 0.2));
  for (let i = 1; i < n; i++) {
    const x = Math.floor(x0 + (dx * i) / n);
    const z = Math.floor(z0 + (dz * i) / n);
    if (inGrid(x, z) && r.blocked[cellIndex(x, z)]) return false;
  }
  return true;
}

function huntTick(s: GameState, w: Worker, p: Predator, dt: number) {
  const H = PREDATORS.staff;
  const j = w.job!;
  let st = hunts.get(w);
  if (!st) hunts.set(w, (st = { aim: 0, repath: 0 }));
  j.t = Math.max(0, j.t - dt);
  j.tx = p.x;
  j.tz = p.z;
  const d = Math.hypot(p.x - w.x, p.z - w.z);
  // un bâtiment entre lui et la bête : il ne tire pas au travers, il va la chercher derrière
  const clear = lineOfFire(s, w.x, w.z, p);
  if (d > H.range || !clear) {
    // il court se mettre à portée (sans franchir la clôture)
    j.phase = 'walk';
    st.aim = 0;
    st.repath -= dt;
    if (st.repath <= 0 || w.path.length < 2) {
      st.repath = 0.7;
      const goal = isWalkable(s, p.x, p.z) ? ([p.x, p.z] as [number, number]) : nearestWalkable(s, p.x, p.z);
      w.path = goal ? humanPath(s, w.x, w.z, goal[0], goal[1]) ?? [] : [];
    }
    follow(s, w, dt, H.runFactor);
    return;
  }
  // à portée : il s'arrête, épaule et tire
  j.phase = 'work';
  w.path = [];
  face(w, p.x, p.z);
  st.aim += dt;
  if (st.aim >= H.aimTime && j.t <= 0) {
    shootAt(s, w, p, d);
    j.t = H.cooldown;
    st.aim = H.aimTime * 0.4;
  }
}

// ----------------------------------------------------------- Mise à jour ----
const layoutSeen = new WeakMap<GameState, number>();

export function updateWorkers(s: GameState, dt: number) {
  const hour = currentHour(s);
  // le terrain a changé : les trajets en cours sont recalculés
  const version = rt(s).version;
  if (layoutSeen.get(s) !== version) {
    layoutSeen.set(s, version);
    for (const w of s.workers) {
      if (!w.onSite || !w.job || w.job.kind === 'commuteIn' || w.job.kind === 'commuteOut' || w.job.kind === 'stand') continue;
      w.job = null;
      w.path = [];
      if (inGrid(Math.floor(w.x), Math.floor(w.z)) && !rt(s).walk[cellIndex(Math.floor(w.x), Math.floor(w.z))]) {
        w.x = 14.5;
        w.z = 29.5;
      }
    }
  }
  // filet de sécurité : sans commis sur place, les trappes sont rouvertes le matin
  if (hour >= 7.5 && hour < 12 && !s.workers.some((w) => w.role === 'farmhand' && w.onSite)) {
    const closed = s.buildings.filter((b) => isShelter(b) && b.closed && !b.autoDoor);
    if (closed.length) {
      for (const b of closed) b.closed = false;
      notify(s, 'Les trappes des poulaillers ont été rouvertes (aucun commis sur place).', 'info', '🔓');
    }
  }
  for (const w of s.workers) {
    for (const l of w.basket) l.freshness = Math.max(1, l.freshness - (FRESHNESS.nestDecayPerDay * dt) / TIME.DAY);
    const working = workHours(w.role, hour);
    if (!w.onSite) {
      if (working) {
        // ils partent de la maison l'un après l'autre, à la file : jamais l'un dans l'autre
        if (s.workers.some((o) => o !== w && o.onSite && Math.hypot(o.x - HOUSE[0], o.z - HOUSE[1]) < HUMAN_GAP * 1.8)) continue;
        w.onSite = true;
        w.x = HOUSE[0];
        w.z = HOUSE[1];
        w.path = flat(w.role === 'seller' ? toCounter(s, w) : TO_GATE);
        w.job = { kind: 'commuteIn', targetId: -1, tx: w.path[w.path.length - 2], tz: w.path[w.path.length - 1], phase: 'walk', t: 0 };
      }
      continue;
    }
    // le commis surveille les réserves tout au long de sa journée, même occupé ailleurs
    if (w.role === 'farmhand' && working && w.job?.kind !== 'commuteIn') restock(s, w);
    // un prédateur aux abords de la ferme : le commis et le jardinier passent en mode commando
    if (isArmed(w) && w.job?.kind !== 'commuteIn' && w.job?.kind !== 'commuteOut') {
      const prey = pickPrey(s, w);
      if (prey) {
        if (w.job?.kind !== 'hunt' || w.job.targetId !== prey.id) startHunt(s, w, prey);
        huntTick(s, w, prey, dt);
        continue;
      }
      if (w.job?.kind === 'hunt') {
        // menace écartée : il range le fusil et reprend ses corvées
        w.job = null;
        w.path = [];
      }
    }
    // au camion : il rejoint le groupe de volailles et le pousse vers la rampe
    if (w.job?.kind === 'loadTruck') {
      const L = s.birdLoad;
      if (!L || L.id !== w.job.targetId || L.leave !== undefined || !working) {
        w.job = null;
        w.path = [];
        continue;
      }
      if (w.job.phase === 'walk') {
        if (follow(s, w, dt)) w.job.phase = 'work';
      } else herd(s, w, dt);
      continue;
    }
    // le commis ne rentre jamais avant d'avoir enfermé les poules : il part en dernier
    const evening = w.role === 'farmhand' && !working && hour >= STAFF.farmhandEnd - 0.01;
    const lateNight = hour >= STAFF.closeDeadline || hour < STAFF.farmhandStart;
    if (
      w.role === 'farmhand' &&
      !working &&
      (evening || lateNight) &&
      openCoops(s).length > 0 &&
      w.job?.kind !== 'waitCoop' &&
      w.job?.kind !== 'closeCoop' &&
      w.job?.kind !== 'deposit' &&
      w.job?.kind !== 'commuteOut' &&
      w.job?.kind !== 'commuteIn' &&
      !(w.job?.kind === 'wander' && w.job.phase === 'work')
    ) {
      if (eveningRound(s, w)) continue;
    }
    if (w.role === 'farmhand' && !working && !uncoveredAt(s) && w.job?.kind === 'wander') w.job = null;
    // fin de journée : on range le panier puis on rentre
    // (seul le commis qui ferme un abri reste : les autres, s'il n'y a plus d'abri sans personne
    // pour le fermer, rentrent chez eux au lieu de traîner dans la ferme la nuit)
    const uncovered = w.role === 'farmhand' && uncoveredAt(s);
    const busyClosing = w.job?.kind === 'waitCoop' || w.job?.kind === 'closeCoop' || (uncovered && w.job?.kind === 'wander');
    if (!working && !busyClosing && w.job?.kind !== 'commuteOut' && w.job?.kind !== 'commuteIn' && w.job?.kind !== 'deposit') {
      const st = storage(s);
      if (basketCount(w) > 0 && st && storageFree(s) > 0) {
        const p = besideBuilding(s, st, w);
        if (p && assign(s, w, 'deposit', st.id, p[0], p[1], STAFF.depositTime)) continue;
      }
      if (w.role === 'seller') {
        w.path = flat([...toCounter(s, w)].reverse());
      } else {
        const inside = humanPath(s, w.x, w.z, 14.5, 29.5) ?? [14.5, 29.5];
        w.path = [...inside, ...flat([...TO_GATE].reverse())];
      }
      w.job = { kind: 'commuteOut', targetId: -1, tx: HOUSE[0], tz: HOUSE[1], phase: 'walk', t: 0 };
    }
    // une ronde ou des œufs au sol peuvent attendre : le camion, non
    if (w.role === 'farmhand' && working && (w.job?.kind === 'wander' || w.job?.kind === 'collectGround') && goLoadTruck(s, w)) continue;
    if (!w.job) {
      if (w.role === 'farmhand') chooseFarmhandJob(s, w);
      else if (w.role === 'caretaker') chooseCaretakerJob(s, w);
      else if (w.role === 'gardener') chooseGardenerJob(s, w);
      else if (w.role === 'seller') {
        const [x, z] = sellerSpot(s, w);
        w.job = { kind: 'stand', targetId: -1, tx: x, tz: z, phase: 'walk', t: 1e9 };
        w.path = [x, z];
      }
      if (!w.job) continue;
    }
    const j = w.job;
    // le comptoir a changé de place (amélioration de l'étal, ancienne sauvegarde) : le vendeur s'y rend
    if (j.kind === 'stand' && j.phase === 'work') {
      const [x, z] = sellerSpot(s, w);
      if (Math.hypot(x - w.x, z - w.z) > 0.25) {
        // l'étal vient de devenir un magasin : il sort de ses murs et passe derrière le comptoir
        if (standLevel(s) >= 4 && w.z < z - 0.2) {
          w.x = SHOP_WEST_X;
          w.z = z;
        }
        j.phase = 'walk';
        j.tx = x;
        j.tz = z;
        w.path = [x, z];
      }
    }
    if (w.role === 'farmhand' && working && j.phase === 'walk' && j.kind !== 'commuteIn' && j.kind !== 'commuteOut') {
      // les œufs croisés en chemin sont ramassés sans détour
      pickupOnTheWay(s, w);
      // une corvée d'entretien (eau, grain, propreté) passe toujours avant les œufs et la ronde
      if ((j.kind === 'collectNest' || j.kind === 'collectGround' || j.kind === 'wander') && careTask(s, w)) {
        w.job = null;
        w.path = [];
        chooseFarmhandJob(s, w);
        continue;
      }
    }
    if (j.phase === 'walk') {
      // une poule à soigner peut avoir bougé
      if (j.kind === 'heal' && w.path.length <= 2) {
        const h = s.hens.find((x) => x.id === j.targetId);
        if (!h || h.act === 'sleep') {
          w.job = null;
          continue;
        }
        if (Math.hypot(h.x - j.tx, h.z + 0.45 - j.tz) > 0.8) {
          j.tx = h.x;
          j.tz = h.z + 0.45;
          w.path = humanPath(s, w.x, w.z, j.tx, j.tz) ?? [];
          if (!w.path.length) {
            w.job = null;
            continue;
          }
        }
      }
      if (follow(s, w, dt)) {
        j.phase = 'work';
        if (j.kind === 'stand') w.heading = sellerHeading(s);
        else if (j.kind === 'collectNest' || j.kind === 'clean' || j.kind === 'closeCoop' || j.kind === 'openCoop') {
          // face au bâtiment (sa façade regarde le sud, ou l'est s'il est pivoté)
          const b = getBuilding(s, j.targetId);
          w.heading = (b ? facadeHeading(b) : 0) + Math.PI;
        } else if (j.kind === 'waitCoop') {
          const b = getBuilding(s, j.targetId);
          if (b) {
            const d = coopDoor(b);
            face(w, d.x, d.z);
          }
        }
        else if (j.kind === 'heal') {
          const h = s.hens.find((x) => x.id === j.targetId);
          if (h) face(w, h.x, h.z);
        } else if (j.kind === 'refillFeeder' || j.kind === 'refillDrinker' || j.kind === 'deposit') {
          const b = getBuilding(s, j.targetId);
          if (b) {
            const c = buildingCenter(b);
            face(w, c.x, c.z);
          }
        }
        if (j.kind === 'commuteIn' || j.kind === 'commuteOut') {
          complete(s, w, j);
          if (w.job === j) w.job = null;
        }
      }
    } else {
      // la poule soignée reste tranquille pendant les soins
      if (j.kind === 'heal') {
        const h = s.hens.find((x) => x.id === j.targetId);
        if (h && (h.act === 'idle' || h.act === 'peck' || h.act === 'walk' || h.act === 'rest' || h.act === 'scratch' || h.act === 'preen')) {
          h.act = 'idle';
          h.actT = Math.max(h.actT, 0.5);
          h.heading = Math.atan2(w.x - h.x, w.z - h.z);
        }
      }
      if (j.kind === 'stand') {
        if (!working) w.job = null;
        continue;
      }
      if (j.kind === 'waitCoop') {
        const b = getBuilding(s, j.targetId);
        if (!b || b.closed) {
          w.job = null;
          continue;
        }
        j.t += dt;
        const waited = (j.t / TIME.DAY) * 24;
        const night = hour >= STAFF.farmhandEnd || hour < STAFF.farmhandStart;
        // il ne ferme pas au nez d'une poule qui grimpe la rampe ou arrive à la porte
        const d = coopDoor(b);
        const arriving = s.hens.some((h) => h.coopId === b.id && (h.act === 'enter' || (h.act === 'goCoop' && Math.hypot(h.x - d.x, h.z - d.z) < 4)));
        if (night && (coopFull(s, b) || lateNight || (waited > STAFF.waitMaxHours && !arriving))) {
          const [x, z] = coopDoorPoint(b);
          assign(s, w, 'closeCoop', b.id, x, z, STAFF.closeTime);
        }
        continue;
      }
      j.t -= dt;
      if (j.t <= 0) {
        complete(s, w, j);
        if (w.job === j) w.job = null;
      }
    }
  }
}

// ------------------------------------------------------------ Collisions ----
// Les poules sont des corps solides : les salariés les écartent doucement sur leur passage.
const HUMAN_HEN_GAP = 0.38;
/** Écart minimal entre deux salariés (ils ne se traversent jamais). */
const HUMAN_GAP = 0.6;
/** Pas de côté d'un salarié qui en contourne un autre (par pas de simulation). */
const HUMAN_SIDESTEP = 0.09;

function shove(s: GameState, o: { x: number; z: number }, nx: number, nz: number, inFarm: boolean) {
  if (!inFarm || (canStand(s, nx, nz, 0.1) && !crossesFence(s, o.x, o.z, nx, nz, 'human'))) {
    o.x = nx;
    o.z = nz;
    return true;
  }
  return false;
}

/** Les murs du magasin et son comptoir, sur la place (hors de la grille de la ferme). */
function inShop(s: GameState, x: number, z: number) {
  if (standLevel(s) < 4) return false;
  return (x > 15.8 && x < 24.2 && z > 31.4 && z < 34.05) || (x > 17.5 && x < 22.5 && z > 34.6 && z < 35.1);
}

/** Déplace un salarié s'il en a le droit (pas dans un bâtiment, pas à travers le grillage), en glissant au besoin. */
function bump(s: GameState, w: Worker, dx: number, dz: number) {
  const go = (x: number, z: number) => {
    if ((inGrid(Math.floor(x), Math.floor(z)) && !canStand(s, x, z, 0.1)) || inShop(s, x, z) || crossesFence(s, w.x, w.z, x, z, 'human')) return false;
    w.x = x;
    w.z = z;
    return true;
  };
  return go(w.x + dx, w.z + dz) || go(w.x + dx, w.z) || go(w.x, w.z + dz);
}

/**
 * Les salariés sont solides, comme les poules : jamais l'un dans l'autre (voir aussi giveWay). S'ils
 * se retrouvent trop près, qui marche s'écarte de qui travaille ; deux marcheurs s'écartent chacun
 * de son côté. Un marcheur coincé dans un couloir étroit fait se pousser son collègue.
 */
function separateWorkers(s: GameState) {
  const on = s.workers.filter((w) => w.onSite);
  for (let i = 0; i < on.length; i++)
    for (let j = i + 1; j < on.length; j++) {
      const a = on[i];
      const b = on[j];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      let d = Math.hypot(dx, dz);
      if (d >= HUMAN_GAP) continue;
      if (d < 1e-4) {
        // exactement au même endroit : on écarte toujours du même côté (partie déterministe)
        const ang = a.id * 2.4 + b.id * 1.1;
        dx = Math.sin(ang);
        dz = Math.cos(ang);
        d = 1;
        a.x -= dx * 1e-3;
        b.x += dx * 1e-3;
      }
      const nx = dx / d;
      const nz = dz / d;
      const push = HUMAN_GAP - Math.hypot(b.x - a.x, b.z - a.z);
      const wa = a.path.length >= 2;
      const wb = b.path.length >= 2;
      const ka = wa === wb ? 0.5 : wa ? (stallTime(a) > 0.5 ? 0.5 : 1) : stallTime(b) > 0.5 ? 0.5 : 0;
      if (ka > 0 && !bump(s, a, -nx * push * ka, -nz * push * ka)) bump(s, b, nx * push * ka, nz * push * ka);
      if (ka < 1 && !bump(s, b, nx * push * (1 - ka), nz * push * (1 - ka))) bump(s, a, -nx * push * (1 - ka), -nz * push * (1 - ka));
    }
}

export function separateBodies(s: GameState) {
  separateWorkers(s);
  // ce sont les poules libres qui s'écartent sur le passage des salariés, jamais l'inverse
  for (const w of s.workers) {
    if (!w.onSite) continue;
    for (const h of s.hens) {
      if (h.act === 'sleep' || h.act === 'enter' || h.act === 'exit' || h.act === 'caught') continue;
      const dx = h.x - w.x;
      const dz = h.z - w.z;
      const d = Math.hypot(dx, dz);
      if (d >= HUMAN_HEN_GAP || d < 1e-4) continue;
      if (!henMovable(h)) continue;
      const push = HUMAN_HEN_GAP - d;
      shove(s, h, h.x + (dx / d) * push, h.z + (dz / d) * push, true);
    }
  }
}

export function resetWorkersDay(s: GameState) {
  for (const w of s.workers) w.today = { eggs: 0, refills: 0, cleans: 0, heals: 0, waterings: 0, kills: 0 };
}
