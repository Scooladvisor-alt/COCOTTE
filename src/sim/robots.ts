// Robots ramasseurs d'œufs : petits robots à roues dont tout l'avant est une bouche (tunnel, brosses
// et tapis roulant) qui avale les œufs. Ils sillonnent la ferme, ramassent d'abord les œufs pondus
// au sol (qui pourriraient), puis vident les pondoirs,
// déchargent au stockage et retournent se recharger chacun sur sa borne : une borne par robot,
// toujours les places les plus proches du stockage. Ils restent à l'intérieur des clôtures.
import { HOUR, ROBOT, TIME, gradeOf } from '../config/balance';
import { BUILDINGS, sizeOf } from '../config/buildings';
import { buildingCenter, canStand, crossesFence, emit, newId, notify, planPath, currentDay, rt, toWorld } from './core';
import { henMovable } from './hens';
import { addXp, earn, fmtMoney, spend } from './economy';
import { addToStorage, removeWorldEgg } from './eggs';
import { storage } from './queries';
import type { ActionResult, GameState, Robot } from './types';

export const hopperCount = (r: Robot) => r.hopper.reduce((a, l) => a + l.count, 0);
export const robotCapacity = (r: Robot) => (r.level === 2 ? ROBOT.capacity2 : ROBOT.capacity);
const robotSpeed = (r: Robot) => (r.level === 2 ? ROBOT.speed2 : ROBOT.speed);
const pickTime = (r: Robot) => (r.level === 2 ? ROBOT.pickTime2 : ROBOT.pickTime);

/** Niveau 2 : plus rapide, plus fluide, un plus grand plateau. */
export function upgradeRobot(s: GameState, id: number): ActionResult {
  const r = s.robots.find((x) => x.id === id);
  if (!r) return { ok: false, reason: 'Robot introuvable' };
  if (r.level === 2) return { ok: false, reason: 'Déjà amélioré' };
  if (!spend(s, ROBOT.upgradePrice, 'constructions', 'Robot ramasseur : niveau 2')) return { ok: false, reason: 'Fonds insuffisants' };
  r.level = 2;
  notify(s, 'Robot amélioré : il file droit vers les œufs, sans manœuvres inutiles, et avale les œufs deux fois plus vite.', 'good', '🤖');
  return { ok: true };
}

/** Une borne : où le robot se gare pour charger, et la direction du stockage vers lui. */
export type DockSpot = [x: number, z: number, nx: number, nz: number];

const dockCache = new WeakMap<GameState, { key: string; spots: DockSpot[] }>();

/**
 * Places possibles pour les bornes, de la plus proche du stockage à la plus lointaine : collées à
 * la façade d'abord, puis aux côtés, puis à l'arrière ; puis une deuxième rangée, une troisième...
 * Seules les places praticables comptent, assez espacées pour garer un robot sur chacune.
 */
export function dockSpots(s: GameState): DockSpot[] {
  const st = storage(s);
  if (!st) return [[14.5, 28.5, 0, 1]];
  const key = `${rt(s).version}:${st.x},${st.z},${st.level},${st.rot ?? 0}`;
  const hit = dockCache.get(s);
  if (hit && hit.key === key) return hit.spots;
  const c = buildingCenter(st);
  const { w, d } = sizeOf('storage', st.level, st.rot);
  const spots: DockSpot[] = [];
  const offsets = (half: number) => {
    const out = [0];
    for (let k = 1.05; k <= half + 0.3; k += 1.05) out.push(-k, k);
    return out;
  };
  // (assez loin du mur pour ne pas mordre sur le dallage du stockage, et assez espacées pour qu'on
  // gare un robot sur chacune sans qu'ils se touchent)
  for (const ring of [0.8, 1.95, 3.1, 4.25]) {
    const sides: Array<[number, number, number]> = [
      [0, 1, w / 2 - 0.2 + (ring > 1 ? ring - 0.8 : 0)],
      [1, 0, d / 2 - 0.2],
      [-1, 0, d / 2 - 0.2],
      [0, -1, w / 2 - 0.2 + (ring > 1 ? ring - 0.8 : 0)],
    ];
    for (const [nx, nz, half] of sides)
      for (const u of offsets(half)) {
        const x = c.x + nx * (w / 2 + ring) + (nz !== 0 ? u : 0);
        const z = c.z + nz * (d / 2 + ring) + (nx !== 0 ? u : 0);
        if (!canStand(s, x, z, 0.32)) continue;
        if (spots.some(([ox, oz]) => Math.hypot(ox - x, oz - z) < 0.95)) continue;
        // (aucune clôture entre le stockage et la borne : jamais de l'autre côté d'un grillage)
        if (crossesFence(s, c.x, c.z, x, z)) continue;
        spots.push([x, z, nx, nz]);
      }
  }
  if (!spots.length) spots.push([14.5, 28.5, 0, 1]);
  dockCache.set(s, { key, spots });
  return spots;
}

/**
 * Une borne par robot, ni plus ni moins : chaque robot garde la sienne, un robot vendu emporte la
 * sienne, et les bornes restent toujours les plus proches du stockage (un robot garé plus loin
 * reprend la place libérée devant).
 */
export function assignDocks(s: GameState) {
  const n = Math.min(s.robots.length, dockSpots(s).length);
  const used = new Set<number>();
  const loose: Robot[] = [];
  for (const r of s.robots) {
    if (r.dock !== undefined && r.dock < n && !used.has(r.dock)) used.add(r.dock);
    else loose.push(r);
  }
  let free = 0;
  for (const r of loose) {
    while (used.has(free)) free++;
    r.dock = free < n ? free : s.robots.indexOf(r);
    used.add(free);
  }
}

/** La borne de ce robot (chaque robot a la sienne ; sans robot : la prochaine place libre). */
export function dockOf(s: GameState, r?: Robot): DockSpot {
  const spots = dockSpots(s);
  if (!r) {
    const used = new Set(s.robots.map((o) => o.dock));
    let i = 0;
    while (used.has(i)) i++;
    return spots[i % spots.length];
  }
  const i = r.dock ?? Math.max(0, s.robots.indexOf(r));
  return spots[i % spots.length];
}

export function dockPoint(s: GameState, r?: Robot): [number, number] {
  const [x, z] = dockOf(s, r);
  return [x, z];
}

export function checkBuyRobot(s: GameState): ActionResult {
  // autant de robots qu'on veut, dès le début, tant qu'il reste de la place pour leur borne
  if (s.robots.length >= dockSpots(s).length) return { ok: false, reason: 'Plus de place pour une borne de recharge autour du stockage' };
  if (s.money < ROBOT.price) return { ok: false, reason: 'Fonds insuffisants' };
  return { ok: true };
}

export function buyRobot(s: GameState): ActionResult {
  const chk = checkBuyRobot(s);
  if (!chk.ok) return chk;
  if (!spend(s, ROBOT.price, 'constructions', ROBOT.name)) return { ok: false, reason: 'Fonds insuffisants' };
  assignDocks(s);
  const r: Robot = { id: newId(s), x: 0, z: 0, heading: Math.PI, battery: 100, hopper: [], task: 'idle', target: -1, tx: 0, tz: 0, path: [], total: 0, boughtDay: currentDay(s) };
  s.robots.push(r);
  assignDocks(s);
  const [x, z, nx, nz] = dockOf(s, r);
  Object.assign(r, { x, z, tx: x, tz: z, heading: Math.atan2(nx, nz) });
  emit(s, { kind: 'purchase', amount: ROBOT.price, label: ROBOT.name });
  notify(s, 'Votre robot ramasseur est en service : il ramasse les œufs tout seul.', 'good', '🤖');
  return { ok: true };
}

export function sellRobot(s: GameState, id: number): ActionResult {
  const r = s.robots.find((x) => x.id === id);
  if (!r) return { ok: false, reason: 'Robot introuvable' };
  unload(s, r);
  s.stats.eggsLost += hopperCount(r);
  s.robots.splice(s.robots.indexOf(r), 1);
  // sa borne part avec lui ; les autres robots se rapprochent du stockage si une place s'est libérée
  assignDocks(s);
  earn(s, Math.round(ROBOT.price * ROBOT.resale), 'reventes', `Revente ${ROBOT.name}`);
  notify(s, `Robot revendu ${fmtMoney(Math.round(ROBOT.price * ROBOT.resale))}.`, 'info', '🤖');
  return { ok: true };
}

function pick(s: GameState, r: Robot, eggId: number) {
  if (hopperCount(r) >= robotCapacity(r)) return false;
  const e = s.worldEggs.find((x) => x.id === eggId);
  if (!e) return false;
  removeWorldEgg(s, e);
  const grade = gradeOf(e.quality);
  const lot = r.hopper.find((l) => l.type === e.type && l.grade === grade && l.fertile === e.fertile && l.genes === e.genes);
  if (lot) {
    lot.freshness = (lot.freshness * lot.count + e.freshness) / (lot.count + 1);
    lot.count++;
  } else r.hopper.push({ type: e.type, grade, freshness: e.freshness, count: 1, ...(e.fertile ? { fertile: e.fertile, genes: e.genes } : {}) });
  r.total++;
  return true;
}

function unload(s: GameState, r: Robot) {
  let stored = 0;
  for (const l of r.hopper) {
    const n = addToStorage(s, l.type, l.grade, l.freshness, l.count, l.fertile, l.genes);
    l.count -= n;
    stored += n;
  }
  r.hopper = r.hopper.filter((l) => l.count > 0);
  if (stored > 0) {
    s.stats.eggsCollected += stored;
    addXp(s, stored);
    emit(s, { kind: 'eggsCollected', count: stored, x: r.x, z: r.z });
  }
  return stored;
}

function go(s: GameState, r: Robot, task: Robot['task'], target: number, tx: number, tz: number) {
  const path = planPath(s, r.x, r.z, tx, tz, 0.2, 'hen');
  if (!path) return false;
  r.task = task;
  r.target = target;
  r.tx = tx;
  r.tz = tz;
  r.path = path;
  return true;
}

/** Choix de la prochaine tournée : œufs au sol, puis pondoirs, puis déchargement, puis borne. */
function plan(s: GameState, r: Robot) {
  const n = hopperCount(r);
  const [dx, dz] = dockPoint(s, r);
  if (r.battery < ROBOT.lowBattery) return go(s, r, 'dock', -1, dx, dz) || void (r.task = 'idle');
  if (n >= robotCapacity(r) * 0.8 && storage(s)) return go(s, r, 'unload', -1, dx, dz);
  const taken = new Set(s.robots.filter((o) => o !== r).map((o) => `${o.task}:${o.target}`));
  const dist = (x: number, z: number) => Math.hypot(x - r.x, z - r.z);
  if (n < robotCapacity(r)) {
    const eggs = s.worldEggs.filter((e) => e.where === 'ground' && !taken.has(`egg:${e.id}`)).sort((a, b) => dist(a.x, a.z) - dist(b.x, b.z));
    for (const e of eggs.slice(0, 6)) {
      // il s'arrête la bouche devant l'œuf, pour l'avaler (il ne roule jamais dessus)
      const d = Math.max(1e-3, dist(e.x, e.z));
      const back = Math.min(ROBOT.reach, d);
      const [ax, az] = [e.x - ((e.x - r.x) / d) * back, e.z - ((e.z - r.z) / d) * back];
      if (go(s, r, 'egg', e.id, canStand(s, ax, az, 0.2) ? ax : e.x, canStand(s, ax, az, 0.2) ? az : e.z)) return;
    }
    const nests = s.buildings
      .filter((b) => b.type === 'nest' && b.eggIds.length > 0 && !taken.has(`nest:${b.id}`))
      .sort((a, b) => b.eggIds.length - a.eggIds.length || dist(a.x, a.z) - dist(b.x, b.z));
    for (const b of nests) {
      // (assez loin devant le nid pour que l'œuf, en sortant, passe le perchoir avant de descendre dans la bouche)
      const [nx, nz] = toWorld(b, 1, BUILDINGS.nest.d + 0.75);
      if (go(s, r, 'nest', b.id, nx, nz)) return;
    }
  }
  if (n > 0 && storage(s)) return go(s, r, 'unload', -1, dx, dz);
  if (Math.hypot(dx - r.x, dz - r.z) > 0.3) return go(s, r, 'dock', -1, dx, dz);
  r.task = 'dock';
  r.path = [];
}

/** Le prochain œuf à cueillir sur place : celui visé au sol, ou le suivant du pondoir. */
function nextPick(s: GameState, r: Robot) {
  if (hopperCount(r) >= robotCapacity(r)) return null;
  if (r.task === 'egg') return s.worldEggs.find((e) => e.id === r.target) ?? null;
  if (r.task === 'nest') {
    const b = s.buildings.find((x) => x.id === r.target);
    const id = b?.eggIds[0];
    return id === undefined ? null : s.worldEggs.find((e) => e.id === id) ?? null;
  }
  return null;
}

/** Arrivé devant l'œuf (ou le pondoir) : il commence à l'avaler. */
function startPick(s: GameState, r: Robot) {
  const e = nextPick(s, r);
  if (!e) return false;
  r.pick = { t: 0, dur: pickTime(r), eggId: e.id, type: e.type, grabbed: false };
  return true;
}

/** Il avale l'œuf : face à lui, la bouche au ras du sol, la brosse l'aspire jusque dans le réservoir. */
function updatePick(s: GameState, r: Robot, dt: number) {
  const p = r.pick!;
  const e = s.worldEggs.find((x) => x.id === p.eggId);
  if (!p.grabbed) {
    if (!e) {
      delete r.pick;
      return;
    }
    // face à l'œuf d'abord (au sol ; devant un pondoir, il est déjà tourné vers lui)
    if (e.where === 'ground') {
      const want = Math.atan2(e.x - r.x, e.z - r.z);
      let diff = want - r.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      r.heading += Math.max(-6 * dt, Math.min(6 * dt, diff));
      if (Math.abs(diff) > 0.25) return;
    }
  }
  p.t += dt;
  // (dès qu'il lui fait face, les brosses le prennent : tout le reste du temps, l'œuf entre dans la bouche)
  if (!p.grabbed && p.t >= p.dur * 0.05) {
    if (!pick(s, r, p.eggId)) {
      delete r.pick;
      return;
    }
    p.grabbed = true;
    if (r.task === 'nest') {
      const b = s.buildings.find((x) => x.id === r.target);
      if (b) {
        const c = buildingCenter(b);
        emit(s, { kind: 'eggsCollected', count: 1, x: c.x, z: c.z });
      }
    }
  }
  if (p.t >= p.dur) {
    delete r.pick;
    // un pondoir : œuf suivant ; sinon, nouvelle tournée
    if (!(r.task === 'nest' && startPick(s, r))) plan(s, r);
  }
}

function arrive(s: GameState, r: Robot) {
  switch (r.task) {
    case 'egg':
    case 'nest':
      if (startPick(s, r)) return true;
      break;
    case 'unload':
    case 'dock':
      unload(s, r);
      break;
  }
  return false;
}

const thinkT = new WeakMap<Robot, number>();

export function updateRobots(s: GameState, dt: number) {
  assignDocks(s);
  for (const r of s.robots) {
    for (const l of r.hopper) l.freshness = Math.max(1, l.freshness - (9 * dt) / TIME.DAY);
    const [dx, dz] = dockPoint(s, r);
    // il avale un œuf : il ne bouge pas tant que la brosse travaille
    if (r.pick) {
      updatePick(s, r, dt);
      continue;
    }
    const docked = r.task === 'dock' && !r.path.length && Math.hypot(dx - r.x, dz - r.z) < 0.35;
    if (docked) {
      // en charge sur sa borne, dos à la colonne ; il repart dès qu'il y a du travail et assez d'énergie
      const [, , nx, nz] = dockOf(s, r);
      r.heading = Math.atan2(nx, nz);
      r.battery = Math.min(100, r.battery + (ROBOT.chargePerHour * dt) / HOUR);
      if (hopperCount(r) > 0) unload(s, r);
      const t = (thinkT.get(r) ?? 0) - dt;
      thinkT.set(r, t);
      if (t <= 0) {
        thinkT.set(r, 1.5);
        const work = s.worldEggs.length > 0;
        if (work && r.battery > ROBOT.lowBattery + 25) plan(s, r);
      }
      continue;
    }
    // la cible a disparu (ramassée par quelqu'un d'autre) : nouvelle tournée
    const t = (thinkT.get(r) ?? 0) - dt;
    thinkT.set(r, t);
    if (t <= 0) {
      thinkT.set(r, 1);
      const gone =
        (r.task === 'egg' && !s.worldEggs.some((e) => e.id === r.target)) ||
        (r.task === 'nest' && !s.buildings.some((b) => b.id === r.target && b.eggIds.length > 0)) ||
        r.task === 'idle';
      if (gone) plan(s, r);
    }
    if (!r.path.length) {
      // à l'arrêt sans rien à faire : il patiente avant de réessayer (pas de calcul à chaque pas)
      if (r.task === 'idle' && t > 0) continue;
      if (r.task !== 'idle' && arrive(s, r)) continue;
      plan(s, r);
      if (!r.path.length && r.task !== 'dock') {
        r.task = 'idle';
        thinkT.set(r, 2);
      }
      continue;
    }
    // déplacement. Niveau 1 : il roule doucement et pivote sur place avant chaque virage.
    // Niveau 2 : il vire en roulant, en ralentissant à peine, et file droit vers sa cible.
    const smooth = r.level === 2;
    let budget = robotSpeed(r) * dt;
    let turned = false;
    while (budget > 1e-6 && r.path.length >= 2) {
      const ex = r.path[0] - r.x;
      const ez = r.path[1] - r.z;
      const d = Math.hypot(ex, ez);
      if (d < 1e-3) {
        r.path.splice(0, 2);
        continue;
      }
      const want = Math.atan2(ex, ez);
      let diff = want - r.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (!turned) {
        const rate = (smooth ? 7 : 4) * dt;
        r.heading += Math.max(-rate, Math.min(rate, diff));
        turned = true;
      }
      if (!smooth && Math.abs(diff) > 0.6) break; // il s'oriente avant d'avancer
      if (smooth && Math.abs(diff) > 1.4) budget *= 0.35; // demi-tour : il ralentit dans la courbe
      const step = Math.min(d, budget);
      r.x += (ex / d) * step;
      r.z += (ez / d) * step;
      budget -= step;
      if (step >= d) r.path.splice(0, 2);
    }
    r.battery = Math.max(0, r.battery - (ROBOT.drainPerHour * dt) / HOUR);
    // il écarte doucement les poules sur son passage
    for (const h of s.hens) {
      if (!henMovable(h) || h.act === 'sleep') continue;
      const ex = h.x - r.x;
      const ez = h.z - r.z;
      const d = Math.hypot(ex, ez);
      if (d >= 0.44 || d < 1e-4) continue;
      const nx = h.x + (ex / d) * (0.44 - d);
      const nz = h.z + (ez / d) * (0.44 - d);
      if (canStand(s, nx, nz, 0.1) && !crossesFence(s, h.x, h.z, nx, nz)) {
        h.x = nx;
        h.z = nz;
      }
    }
    // un œuf au sol juste devant sa bouche, en chemin : il s'arrête et l'avale au passage
    if (hopperCount(r) < robotCapacity(r)) {
      const fx = r.x + Math.sin(r.heading) * ROBOT.reach;
      const fz = r.z + Math.cos(r.heading) * ROBOT.reach;
      const near = s.worldEggs.find((e) => e.where === 'ground' && Math.hypot(e.x - fx, e.z - fz) < 0.1 && !s.robots.some((o) => o !== r && o.pick?.eggId === e.id));
      if (near) r.pick = { t: 0, dur: pickTime(r), eggId: near.id, type: near.type, grabbed: false };
    }
  }
}
