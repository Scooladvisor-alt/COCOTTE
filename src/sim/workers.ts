// Le personnel : des salariés visibles qui se déplacent dans la ferme et font réellement
// le travail (ramassage, remplissage, nettoyage, soins, arrosage, vente au comptoir).
import { FRESHNESS, GRAIN_SACKS, GRID_H, GRID_W, PREDATORS, WORLD, clamp, gradeOf, sackPrice } from '../config/balance';
import { BUILDINGS, STAND_POS } from '../config/buildings';
import { ROLES, STAFF, WORKER_NAMES } from '../config/staff';
import { buildingCenter, canStand, cellIndex, coopDoor, cellX, cellZ, crossesFence, currentDay, currentHour, emit, inGrid, isWalkable, nearestWalkable, newId, notify, pick, planPath, rand, randRange, rt } from './core';
import { PREDATOR_INFO, damagePredator, distanceToFarm, predatorAimY } from './predators';
import { henMovable } from './hens';
import { addXp, buyLevel, fmtMoney, spend } from './economy';
import { addToStorage, removeWorldEgg } from './eggs';
import { cleaningCost } from './buildings';
import { grainCapacity, grainPerDay, takeGrain, takeWater, waterCapacity } from './stocks';
import { buyGrain, fillTank } from './actions';
import { getBuilding, lvl, storage, storageFree } from './queries';
import type { ActionResult, Building, GameState, Predator, Worker, WorkerJob, WorkerJobKind, WorkerRole } from './types';

// Trajets extérieurs : maison → allée → chemin le long de la clôture → portail (ou arrière de l'étal)
const HOUSE: [number, number] = [-6.6, 26.3];
const LANE_Z = 31.35;
const TO_GATE: Array<[number, number]> = [HOUSE, [-6.0, 28.6], [-6.0, LANE_Z], [14.5, LANE_Z], [14.5, 30.4], [14.5, 29.5]];

/**
 * Le vendeur se tient sur le côté de l'étal, face aux clients : derrière le comptoir,
 * l'auvent et la table le cacheraient à la caméra.
 */
export function sellerSpot(s: GameState): [number, number] {
  const st = s.buildings.find((b) => b.type === 'stand');
  const level = st?.level ?? 1;
  if (level === 1) return [STAND_POS.x + 2.35, STAND_POS.z + 0.4];
  if (level === 2) return [STAND_POS.x + 2.45, STAND_POS.z + 0.6];
  return [STAND_POS.x + 2.6, STAND_POS.z + 1.05];
}
/** Cap du vendeur : tourné vers les clients qui s'arrêtent devant l'étal. */
function sellerHeading(s: GameState) {
  const [x, z] = sellerSpot(s);
  return Math.atan2(STAND_POS.x + 1 - x, STAND_POS.z + 1.25 - z);
}
function toCounter(s: GameState): Array<[number, number]> {
  const [x, z] = sellerSpot(s);
  return [HOUSE, [-6.0, 28.6], [-6.0, LANE_Z], [x, LANE_Z], [x, z]];
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
  return s.workers.reduce((a, w) => a + ROLES[w.role].wage, 0);
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
/** Poulaillers encore ouverts (le commis ne rentre pas tant qu'il en reste). */
function openCoops(s: GameState) {
  return s.buildings.filter((b) => b.type === 'coop' && !b.closed);
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
};

/** Le commis et le jardinier sont armés ; le vendeur et le soigneur restent à leur poste. */
export function isArmed(w: Worker) {
  return w.role === 'farmhand' || w.role === 'gardener';
}

// ------------------------------------------------------------ Embauche ----
export function checkHire(s: GameState, role: WorkerRole): ActionResult {
  const def = ROLES[role];
  const level = buyLevel(s);
  if (level < def.reqLevel) return { ok: false, reason: `Débloqué au niveau ${def.reqLevel}` };
  if (workersOf(s, role).length >= def.max(level)) return { ok: false, reason: `Maximum ${def.max(level)} à ce niveau` };
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
      const [x, z] = sellerSpot(s);
      w.x = x;
      w.z = WORLD.WALK_Z;
      w.heading = Math.PI;
      w.path = [x, z];
      w.job = { kind: 'commuteIn', targetId: -1, tx: x, tz: z, phase: 'walk', t: 0 };
    } else {
      w.x = 14.5;
      w.z = 29.4;
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
  if (!hasRole(s, 'farmhand')) for (const b of s.buildings) if (b.type === 'coop') b.closed = false;
  return { ok: true };
}

// --------------------------------------------------------- Trajectoires ----
function follow(w: Worker, dt: number, mult = 1): boolean {
  const commuting = w.job?.kind === 'commuteIn' || w.job?.kind === 'commuteOut';
  let budget = STAFF.walkSpeed * (commuting ? STAFF.commuteSpeed : 1) * mult * dt;
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
    w.x += (dx / d) * step;
    w.z += (dz / d) * step;
    budget -= step;
    if (step >= d) w.path.splice(0, 2);
  }
  return w.path.length < 2;
}

function face(w: Worker, x: number, z: number) {
  if (Math.hypot(x - w.x, z - w.z) > 0.05) w.heading = Math.atan2(x - w.x, z - w.z);
}

function assign(s: GameState, w: Worker, kind: WorkerJobKind, targetId: number, tx: number, tz: number, workTime: number) {
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
  const def = BUILDINGS[b.type];
  if (b.type === 'coop') return [coopDoor(b).x, coopDoor(b).z + 0.75];
  if (b.type === 'nest') return [b.x + 1, b.z + def.d + 0.55];
  const c = buildingCenter(b);
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const rad = Math.max(def.w, def.d) / 2 + 0.55;
    const x = c.x + Math.sin(ang) * rad;
    const z = c.z + Math.cos(ang) * rad;
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
  const d = coopDoor(b);
  return [d.x + 0.75, d.z + 0.6];
}
/** Point d'attente, à l'écart de la porte, en regardant les poules rentrer. */
function coopWaitPoint(s: GameState, b: Building): [number, number] {
  const { w } = BUILDINGS.coop;
  const d = coopDoor(b);
  for (const [x, z] of [
    [b.x + w + 0.4, d.z + 0.4],
    [b.x - 0.4, d.z + 0.4],
    [b.x + w + 0.2, d.z + 1.3],
    [b.x - 0.2, d.z + 1.3],
    [d.x, d.z + 1.6],
  ] as Array<[number, number]>)
    if (canStand(s, x, z, 0.2)) return [x, z];
  return coopDoorPoint(b);
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
    .filter((b) => b.type === 'coop' && b.cleanliness < STAFF.cleanBelow && s.money >= cleaningCost(b) && !taken.has(`clean:${b.id}`))
    .sort((a, b) => a.cleanliness - b.cleanliness);
  for (const b of coops) {
    const at = besideBuilding(s, b, w);
    if (at) return { kind: 'clean', b, at, time: STAFF.cleanTime };
  }
  return null;
}

const lastOrder = new WeakMap<GameState, number>();
/** Le commis commande l'eau et le grain quand les réserves baissent (si le joueur l'autorise). */
function restock(s: GameState, w: Worker) {
  if (!s.settings.staffRestock) return;
  const last = lastOrder.get(s) ?? -Infinity;
  if (s.clock.t - last < (180 / 24) * 2) return;
  if (s.water < waterCapacity(s) * STAFF.restockWaterBelow) {
    const before = s.water;
    const money = s.money;
    if (fillTank(s).ok) {
      lastOrder.set(s, s.clock.t);
      notify(s, `${w.name} a commandé ${Math.round(s.water - before)} L d’eau (${fmtMoney(money - s.money)}).`, 'info', '💧');
    } else warnLowFunds(s, w, 'd’eau');
  }
  const rate = grainPerDay(s);
  if (rate > 0.1 && s.grain < rate * STAFF.restockGrainDays) {
    const level = buyLevel(s);
    const room = grainCapacity(s) - s.grain;
    const sack = [...GRAIN_SACKS].reverse().find((g) => g.reqLevel <= level && g.rations <= room && sackPrice(g, s.market.grainIndex) <= s.money);
    if (sack && buyGrain(s, sack.id).ok) {
      lastOrder.set(s, s.clock.t);
      notify(s, `${w.name} a commandé un ${sack.name.toLowerCase()} de grain (${fmtMoney(sackPrice(sack, s.market.grainIndex))}).`, 'info', '🌾');
    } else if (!sack) warnLowFunds(s, w, 'de grain');
  }
}
const lowFundsWarned = new WeakMap<GameState, number>();
function warnLowFunds(s: GameState, w: Worker, what: string) {
  const last = lowFundsWarned.get(s) ?? -Infinity;
  if (s.clock.t - last < 180) return;
  lowFundsWarned.set(s, s.clock.t);
  notify(s, `${w.name} n’a pas pu commander ${what} : fonds insuffisants ou réserve trop petite.`, 'warn', '⚠️');
}

/** Ramassage « au passage » : en passant devant un pondoir garni ou un œuf au sol. */
function pickupOnTheWay(s: GameState, w: Worker) {
  if (basketCount(w) >= STAFF.basketMax) return;
  for (const b of s.buildings) {
    if (b.type !== 'nest' || b.eggIds.length === 0) continue;
    const fx = b.x + 1;
    const fz = b.z + BUILDINGS.nest.d + 0.5;
    if (Math.hypot(fx - w.x, fz - w.z) > STAFF.pickupRadius) continue;
    const n = pickUp(s, w, [...b.eggIds]);
    if (n > 0) {
      w.lastPickT = s.clock.t;
      emit(s, { kind: 'eggsCollected', count: n, x: b.x + 1, z: b.z + 0.5 });
    }
  }
  for (const e of s.worldEggs) {
    if (e.where !== 'ground' || Math.hypot(e.x - w.x, e.z - w.z) > 0.6) continue;
    if (pickUp(s, w, [e.id]) > 0) w.lastPickT = s.clock.t;
  }
}

function chooseFarmhandJob(s: GameState, w: Worker) {
  const taken = reservedBy(s, w);
  const carried = basketCount(w);
  const st = storage(s);
  // 1. le matin : ouvrir les trappes pour libérer les poules (l'après-midi, une trappe
  //    fermée par le joueur le reste)
  for (const b of s.buildings) {
    if (currentHour(s) >= 12 || b.type !== 'coop' || !b.closed || taken.has(`openCoop:${b.id}`)) continue;
    const [x, z] = coopDoorPoint(b);
    if (assign(s, w, 'openCoop', b.id, x, z, STAFF.openTime)) return;
  }
  // 2. réserves d'eau et de grain suffisantes (commande si besoin)
  restock(s, w);
  // 3. entretien : eau, grain, propreté
  const care = careTask(s, w);
  if (care && assign(s, w, care.kind, care.b.id, care.at[0], care.at[1], care.time)) return;
  // 4. panier plein : on le vide avant de continuer
  if (carried >= STAFF.basketMax * 0.8 && st) {
    const p = besideBuilding(s, st, w);
    if (p && assign(s, w, 'deposit', st.id, p[0], p[1], STAFF.depositTime)) return;
  }
  // 5. en dernier : les œufs (pondoirs garnis, puis œufs au sol)
  const dist = (x: number, z: number) => Math.hypot(x - w.x, z - w.z);
  const nests = s.buildings
    .filter((b) => b.type === 'nest' && b.eggIds.length >= 2 && !taken.has(`collectNest:${b.id}`))
    .sort((a, b) => dist(a.x, a.z) - dist(b.x, b.z));
  if (nests.length && carried < STAFF.basketMax) {
    const n = nests[0];
    const p = besideBuilding(s, n, w)!;
    if (assign(s, w, 'collectNest', n.id, p[0], p[1], STAFF.collectTime)) return;
  }
  const ground = s.worldEggs.filter((e) => e.where === 'ground' && !taken.has(`collectGround:${e.id}`)).sort((a, b) => dist(a.x, a.z) - dist(b.x, b.z));
  if (ground.length && carried < STAFF.basketMax) {
    const e = ground[0];
    if (assign(s, w, 'collectGround', e.id, e.x, e.z + 0.35, STAFF.collectTime * 0.7)) return;
  }
  if (carried > 0 && st) {
    const p = besideBuilding(s, st, w);
    if (p && assign(s, w, 'deposit', st.id, p[0], p[1], STAFF.depositTime)) return;
  }
  // rien à faire : ronde de surveillance autour des points d'eau
  const drinker = s.buildings.find((b) => b.type === 'drinker');
  wander(s, w, drinker ? buildingCenter(drinker) : st ? buildingCenter(st) : { x: 14.5, z: 26 }, 3);
}

function chooseCaretakerJob(s: GameState, w: Worker) {
  const taken = reservedBy(s, w);
  const patients = s.hens
    .filter((h) => (h.sick || h.health < STAFF.healBelow) && h.act !== 'sleep' && h.act !== 'enter' && !taken.has(`heal:${h.id}`))
    .sort((a, b) => a.health - b.health);
  if (patients.length) {
    const h = patients[0];
    if (assign(s, w, 'heal', h.id, h.x, h.z + 0.45, STAFF.healTime)) return;
  }
  const awake = s.hens.filter((h) => h.act !== 'sleep');
  if (awake.length) {
    const h = awake[Math.floor(rand(s) * awake.length)];
    return wander(s, w, { x: h.x, z: h.z }, 1.5);
  }
  wander(s, w, { x: 14.5, z: 25 }, 4);
}

function chooseGardenerJob(s: GameState, w: Worker) {
  const r = rt(s);
  let best = -1;
  let bestG = 0.85;
  for (let k = 0; k < 50; k++) {
    const i = Math.floor(rand(s) * GRID_W * GRID_H);
    if (!r.walk[i]) continue;
    const x = cellX(i);
    const z = cellZ(i);
    let sum = 0;
    let n = 0;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        if (inGrid(x + dx, z + dz) && r.owned[cellIndex(x + dx, z + dz)]) {
          sum += s.grass[cellIndex(x + dx, z + dz)];
          n++;
        }
    const g = n ? sum / n : 1;
    if (g < bestG) {
      bestG = g;
      best = i;
    }
  }
  if (best >= 0) {
    const x = cellX(best) + 0.5;
    const z = cellZ(best) + 0.5;
    if (assign(s, w, 'water', best, x, z, STAFF.waterTime)) return;
  }
  wander(s, w, { x: 14.5, z: 25 }, 5);
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
        if (n > 0) emit(s, { kind: 'eggsCollected', count: n, x: b.x + 1, z: b.z + 0.5 });
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
      if (!b || b.type !== 'coop') return;
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
      if (!b || b.type !== 'coop' || b.closed) return;
      b.closed = true;
      const outside = s.hens.filter((h) => h.coopId === b.id && h.act !== 'sleep' && h.act !== 'enter');
      if (outside.length)
        notify(s, `${outside.length} poule${outside.length > 1 ? 's sont restées' : ' est restée'} dehors cette nuit (${outside.map((h) => h.name).slice(0, 3).join(', ')}).`, 'warn', '🌙');
      if (openCoops(s).length === 0) notify(s, `${w.name} a fermé tous les poulaillers et rentre à la maison. Bonne nuit !`, 'info', '🌙');
      return;
    }
    case 'openCoop': {
      const b = getBuilding(s, j.targetId);
      if (b && b.type === 'coop') b.closed = false;
      return;
    }
    case 'stand':
    case 'wander':
    case 'waitCoop':
    case 'hunt':
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
  // un collègue s'occupe du dernier poulailler : on l'attend en faisant une petite ronde
  if (openCoops(s).length) {
    wander(s, w, { x: w.x, z: w.z }, 1.5);
    return true;
  }
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

function huntTick(s: GameState, w: Worker, p: Predator, dt: number) {
  const H = PREDATORS.staff;
  const j = w.job!;
  let st = hunts.get(w);
  if (!st) hunts.set(w, (st = { aim: 0, repath: 0 }));
  j.t = Math.max(0, j.t - dt);
  j.tx = p.x;
  j.tz = p.z;
  const d = Math.hypot(p.x - w.x, p.z - w.z);
  if (d > H.range) {
    // il court se mettre à portée (sans franchir la clôture)
    j.phase = 'walk';
    st.aim = 0;
    st.repath -= dt;
    if (st.repath <= 0 || w.path.length < 2) {
      st.repath = 0.7;
      const goal = isWalkable(s, p.x, p.z) ? ([p.x, p.z] as [number, number]) : nearestWalkable(s, p.x, p.z);
      w.path = goal ? humanPath(s, w.x, w.z, goal[0], goal[1]) ?? [] : [];
    }
    follow(w, dt, H.runFactor);
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
    const closed = s.buildings.filter((b) => b.type === 'coop' && b.closed);
    if (closed.length) {
      for (const b of closed) b.closed = false;
      notify(s, 'Les trappes des poulaillers ont été rouvertes (aucun commis sur place).', 'info', '🔓');
    }
  }
  for (const w of s.workers) {
    for (const l of w.basket) l.freshness = Math.max(1, l.freshness - (FRESHNESS.nestDecayPerDay * dt) / 180);
    const working = workHours(w.role, hour);
    if (!w.onSite) {
      if (working) {
        w.onSite = true;
        w.x = HOUSE[0];
        w.z = HOUSE[1];
        w.path = flat(w.role === 'seller' ? toCounter(s) : TO_GATE);
        w.job = { kind: 'commuteIn', targetId: -1, tx: w.path[w.path.length - 2], tz: w.path[w.path.length - 1], phase: 'walk', t: 0 };
      }
      continue;
    }
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
    // fin de journée : on range le panier puis on rentre
    const busyClosing = w.job?.kind === 'waitCoop' || w.job?.kind === 'closeCoop' || (w.role === 'farmhand' && openCoops(s).length > 0 && w.job?.kind === 'wander');
    if (!working && !busyClosing && w.job?.kind !== 'commuteOut' && w.job?.kind !== 'commuteIn' && w.job?.kind !== 'deposit') {
      const st = storage(s);
      if (basketCount(w) > 0 && st && storageFree(s) > 0) {
        const p = besideBuilding(s, st, w);
        if (p && assign(s, w, 'deposit', st.id, p[0], p[1], STAFF.depositTime)) continue;
      }
      if (w.role === 'seller') {
        w.path = flat([...toCounter(s)].reverse());
      } else {
        const inside = humanPath(s, w.x, w.z, 14.5, 29.5) ?? [14.5, 29.5];
        w.path = [...inside, ...flat([...TO_GATE].reverse())];
      }
      w.job = { kind: 'commuteOut', targetId: -1, tx: HOUSE[0], tz: HOUSE[1], phase: 'walk', t: 0 };
    }
    if (!w.job) {
      if (w.role === 'farmhand') chooseFarmhandJob(s, w);
      else if (w.role === 'caretaker') chooseCaretakerJob(s, w);
      else if (w.role === 'gardener') chooseGardenerJob(s, w);
      else if (w.role === 'seller') {
        const [x, z] = sellerSpot(s);
        w.job = { kind: 'stand', targetId: -1, tx: x, tz: z, phase: 'walk', t: 1e9 };
        w.path = [x, z];
      }
      if (!w.job) continue;
    }
    const j = w.job;
    // le comptoir a changé de place (amélioration de l'étal, ancienne sauvegarde) : le vendeur s'y rend
    if (j.kind === 'stand' && j.phase === 'work') {
      const [x, z] = sellerSpot(s);
      if (Math.hypot(x - w.x, z - w.z) > 0.25) {
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
      if (follow(w, dt)) {
        j.phase = 'work';
        if (j.kind === 'stand') w.heading = sellerHeading(s);
        else if (j.kind === 'collectNest' || j.kind === 'clean' || j.kind === 'closeCoop' || j.kind === 'openCoop') w.heading = Math.PI;
        else if (j.kind === 'waitCoop') {
          const b = getBuilding(s, j.targetId);
          if (b) face(w, b.x + 1.5, b.z + 2.3);
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
        const waited = (j.t / 180) * 24;
        const night = hour >= STAFF.farmhandEnd || hour < STAFF.farmhandStart;
        if (night && (coopFull(s, b) || lateNight || waited > STAFF.waitMaxHours)) {
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

function shove(s: GameState, o: { x: number; z: number }, nx: number, nz: number, inFarm: boolean) {
  if (!inFarm || (canStand(s, nx, nz, 0.1) && !crossesFence(s, o.x, o.z, nx, nz, 'human'))) {
    o.x = nx;
    o.z = nz;
    return true;
  }
  return false;
}

export function separateBodies(s: GameState) {
  // Les salariés se traversent entre eux (sinon ils se bloquent dans les couloirs étroits) ;
  // ce sont les poules libres qui s'écartent sur leur passage, jamais l'inverse.
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
