// Robots ramasseurs d'œufs : comme un aspirateur robot, ils sillonnent la ferme, ramassent
// d'abord les œufs pondus au sol (qui pourriraient), puis vident les pondoirs, déchargent au
// stockage et retournent se recharger sur leur borne. Ils restent à l'intérieur des clôtures.
import { HOUR, ROBOT, gradeOf } from '../config/balance';
import { BUILDINGS } from '../config/buildings';
import { buildingCenter, canStand, crossesFence, emit, newId, notify, planPath, currentDay } from './core';
import { henMovable } from './hens';
import { addXp, buyLevel, earn, fmtMoney, spend } from './economy';
import { addToStorage, removeWorldEgg } from './eggs';
import { storage } from './queries';
import type { ActionResult, GameState, Robot } from './types';

export const hopperCount = (r: Robot) => r.hopper.reduce((a, l) => a + l.count, 0);

/** Borne de recharge : à côté du stockage. */
export function dockPoint(s: GameState): [number, number] {
  const st = storage(s);
  if (st) {
    const c = buildingCenter(st);
    const d = BUILDINGS.storage;
    for (const [dx, dz] of [
      [0, d.d / 2 + 0.55],
      [d.w / 2 + 0.55, 0],
      [-d.w / 2 - 0.55, 0],
      [0, -d.d / 2 - 0.55],
    ])
      if (canStand(s, c.x + dx, c.z + dz, 0.22)) return [c.x + dx, c.z + dz];
  }
  return [14.5, 28.5];
}

export function checkBuyRobot(s: GameState): ActionResult {
  const level = buyLevel(s);
  if (level < ROBOT.reqLevel) return { ok: false, reason: `Débloqué au niveau ${ROBOT.reqLevel}` };
  if (s.robots.length >= ROBOT.max(level)) return { ok: false, reason: `Maximum ${ROBOT.max(level)} à ce niveau` };
  if (s.money < ROBOT.price) return { ok: false, reason: 'Fonds insuffisants' };
  return { ok: true };
}

export function buyRobot(s: GameState): ActionResult {
  const chk = checkBuyRobot(s);
  if (!chk.ok) return chk;
  if (!spend(s, ROBOT.price, 'constructions', ROBOT.name)) return { ok: false, reason: 'Fonds insuffisants' };
  const [x, z] = dockPoint(s);
  s.robots.push({ id: newId(s), x, z, heading: Math.PI, battery: 100, hopper: [], task: 'idle', target: -1, tx: x, tz: z, path: [], total: 0, boughtDay: currentDay(s) });
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
  earn(s, Math.round(ROBOT.price * ROBOT.resale), 'reventes', `Revente ${ROBOT.name}`);
  notify(s, `Robot revendu ${fmtMoney(Math.round(ROBOT.price * ROBOT.resale))}.`, 'info', '🤖');
  return { ok: true };
}

function pick(s: GameState, r: Robot, eggId: number) {
  if (hopperCount(r) >= ROBOT.capacity) return false;
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
  const [dx, dz] = dockPoint(s);
  if (r.battery < ROBOT.lowBattery) return go(s, r, 'dock', -1, dx, dz) || void (r.task = 'idle');
  if (n >= ROBOT.capacity * 0.8 && storage(s)) return go(s, r, 'unload', -1, dx, dz);
  const taken = new Set(s.robots.filter((o) => o !== r).map((o) => `${o.task}:${o.target}`));
  const dist = (x: number, z: number) => Math.hypot(x - r.x, z - r.z);
  if (n < ROBOT.capacity) {
    const eggs = s.worldEggs.filter((e) => e.where === 'ground' && !taken.has(`egg:${e.id}`)).sort((a, b) => dist(a.x, a.z) - dist(b.x, b.z));
    for (const e of eggs.slice(0, 6)) if (go(s, r, 'egg', e.id, e.x, e.z)) return;
    const nests = s.buildings
      .filter((b) => b.type === 'nest' && b.eggIds.length > 0 && !taken.has(`nest:${b.id}`))
      .sort((a, b) => b.eggIds.length - a.eggIds.length || dist(a.x, a.z) - dist(b.x, b.z));
    for (const b of nests) if (go(s, r, 'nest', b.id, b.x + 1, b.z + BUILDINGS.nest.d + 0.45)) return;
  }
  if (n > 0 && storage(s)) return go(s, r, 'unload', -1, dx, dz);
  if (Math.hypot(dx - r.x, dz - r.z) > 0.3) return go(s, r, 'dock', -1, dx, dz);
  r.task = 'dock';
  r.path = [];
}

function arrive(s: GameState, r: Robot) {
  switch (r.task) {
    case 'egg':
      pick(s, r, r.target);
      break;
    case 'nest': {
      const b = s.buildings.find((x) => x.id === r.target);
      if (b) {
        let n = 0;
        for (const id of [...b.eggIds]) if (pick(s, r, id)) n++;
        if (n) emit(s, { kind: 'eggsCollected', count: n, x: b.x + 1, z: b.z + 0.5 });
      }
      break;
    }
    case 'unload':
    case 'dock':
      unload(s, r);
      break;
  }
}

const thinkT = new WeakMap<Robot, number>();

export function updateRobots(s: GameState, dt: number) {
  for (const r of s.robots) {
    for (const l of r.hopper) l.freshness = Math.max(1, l.freshness - (9 * dt) / 180);
    const [dx, dz] = dockPoint(s);
    const docked = r.task === 'dock' && !r.path.length && Math.hypot(dx - r.x, dz - r.z) < 0.35;
    if (docked) {
      // en charge sur sa borne ; il repart dès qu'il y a du travail et assez d'énergie
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
      if (r.task !== 'idle') arrive(s, r);
      plan(s, r);
      if (!r.path.length && r.task !== 'dock') {
        r.task = 'idle';
        thinkT.set(r, 2);
      }
      continue;
    }
    // déplacement : il roule doucement et pivote sur place
    let budget = ROBOT.speed * dt;
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
      r.heading += Math.max(-4 * dt, Math.min(4 * dt, diff));
      if (Math.abs(diff) > 0.6) break; // il s'oriente avant d'avancer
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
    // œufs au sol croisés en chemin
    if (hopperCount(r) < ROBOT.capacity)
      for (const e of s.worldEggs) if (e.where === 'ground' && Math.hypot(e.x - r.x, e.z - r.z) < 0.4) pick(s, r, e.id);
  }
}
