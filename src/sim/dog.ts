// Le chien de la maison : couché devant la ferme, on peut l'adopter comme chien de garde.
// Il patrouille alors tout autour de l'enclos, toujours à l'extérieur (il n'entre jamais chez
// les poules), dort dans sa niche près de la maison la nuit, et dès qu'un renard ou une buse
// approche, il fonce en aboyant et le fait détaler.
import { DOG, GRID_H, GRID_W, GRID_Z0, GRID_Z1 } from '../config/balance';
import { STAND_POS } from '../config/buildings';
import { cellIndex, currentDay, currentHour, emit, inGrid, isNightHour, notify, pick, rand, randRange, rt } from './core';
import { buyLevel, spend } from './economy';
import { PREDATOR_INFO, distanceToFarm, scarePredator } from './predators';
import type { ActionResult, GameState, GuardDog } from './types';

/** Où dort le chien de la maison (devant le perron) et sa niche. */
export const HOUSE_DOG: [number, number] = [-5.1, 27.4];
export function kennelPoint(_s?: GameState): [number, number] {
  return [-3.9, 28.3];
}

export function checkBuyDog(s: GameState): ActionResult {
  if (s.dog) return { ok: false, reason: 'Vous avez déjà un chien de garde' };
  if (buyLevel(s) < DOG.reqLevel) return { ok: false, reason: `Débloqué au niveau ${DOG.reqLevel}` };
  if (s.money < DOG.price) return { ok: false, reason: 'Fonds insuffisants' };
  return { ok: true };
}

export function buyDog(s: GameState): ActionResult {
  const chk = checkBuyDog(s);
  if (!chk.ok) return chk;
  if (!spend(s, DOG.price, 'constructions', 'Chien de garde')) return { ok: false, reason: 'Fonds insuffisants' };
  s.dog = { name: pick(s, DOG.names), x: HOUSE_DOG[0], z: HOUSE_DOG[1], heading: 0.6, act: 'sit', t: 1.5, path: [], spd: 0, boughtDay: currentDay(s) };
  emit(s, { kind: 'purchase', amount: DOG.price, label: 'Chien de garde' });
  emit(s, { kind: 'dogBark', x: s.dog.x, z: s.dog.z });
  notify(s, `${s.dog.name} monte la garde autour de l’enclos : renards et buses vont se faire rares.`, 'good', '🐕');
  return { ok: true };
}

// ------------------------------------------------- Terrain de la ronde ----
// Grille propre au chien, un peu plus grande que la ferme : tout ce qui n'est ni le terrain des
// poules, ni la maison, ni l'étal.
const OX = -6;
const OZ = GRID_Z0 - 4;
const NW = GRID_W + 10;
const NH = GRID_H + 6;
interface DogNav {
  version: number;
  free: Uint8Array;
}
const navs = new WeakMap<GameState, DogNav>();

function nav(s: GameState) {
  const version = rt(s).version;
  let n = navs.get(s);
  if (n && n.version === version) return n;
  const free = new Uint8Array(NW * NH);
  const r = rt(s);
  const fenced = (x: number, z: number) => inGrid(x, z) && (r.owned[cellIndex(x, z)] === 1 || r.blocked[cellIndex(x, z)] === 1);
  for (let j = 0; j < NH; j++)
    for (let i = 0; i < NW; i++) {
      const x = i + OX;
      const z = j + OZ;
      const cx = x + 0.5;
      const cz = z + 0.5;
      let ok = true;
      // jamais dans l'enclos, ni contre le grillage : une case de marge tout autour, sinon le
      // museau ou la queue (le berger fait près d'un mètre) traversent la clôture
      for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1 && ok; dx++) if (fenced(x + dx, z + dz)) ok = false;
      if (cx > -9.6 && cx < -3.2 && cz > 22 && cz < 27.3) ok = false; // la maison
      if (cx > STAND_POS.x - 0.8 && cx < STAND_POS.x + 2.8 && cz > STAND_POS.z - 1.2) ok = false; // l'étal
      if (cz > GRID_Z1 + 1.8) ok = false; // pas sur la route
      free[j * NW + i] = ok ? 1 : 0;
    }
  n = { version, free };
  navs.set(s, n);
  return n;
}

const cellOf = (x: number, z: number) => {
  const i = Math.floor(x) - OX;
  const j = Math.floor(z) - OZ;
  return i < 0 || j < 0 || i >= NW || j >= NH ? -1 : j * NW + i;
};
const center = (c: number): [number, number] => [(c % NW) + OX + 0.5, Math.floor(c / NW) + OZ + 0.5];

function nearestFree(n: DogNav, x: number, z: number) {
  const c = cellOf(x, z);
  if (c >= 0 && n.free[c]) return c;
  const ci = Math.floor(x) - OX;
  const cj = Math.floor(z) - OZ;
  for (let rad = 1; rad < 12; rad++)
    for (let dj = -rad; dj <= rad; dj++)
      for (let di = -rad; di <= rad; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i >= 0 && j >= 0 && i < NW && j < NH && n.free[j * NW + i]) return j * NW + i;
      }
  return -1;
}

function lineOk(n: DogNav, x0: number, z0: number, x1: number, z1: number) {
  // échantillons serrés et marge de 0,25 : il ne coupe jamais un coin de l'enclos
  const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.15));
  for (let i = 1; i <= k; i++) {
    const x = x0 + ((x1 - x0) * i) / k;
    const z = z0 + ((z1 - z0) * i) / k;
    for (const [dx, dz] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) {
      const c = cellOf(x + dx, z + dz);
      if (c < 0 || !n.free[c]) return false;
    }
  }
  return true;
}

/** Chemin du chien hors de l'enclos (BFS + lissage). */
function dogPath(s: GameState, fx: number, fz: number, tx: number, tz: number): number[] | null {
  const n = nav(s);
  const goal = nearestFree(n, tx, tz);
  const start = nearestFree(n, fx, fz);
  if (goal < 0 || start < 0) return null;
  const [gx, gz] = cellOf(tx, tz) === goal ? [tx, tz] : center(goal);
  if (lineOk(n, fx, fz, gx, gz)) return [gx, gz];
  const parent = new Int32Array(NW * NH).fill(-2);
  parent[goal] = -1;
  const q = [goal];
  let found = start === goal;
  for (let k = 0; k < q.length && !found; k++) {
    const c = q[k];
    const i = c % NW;
    const j = Math.floor(c / NW);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= NW || nj >= NH) continue;
      const nc = nj * NW + ni;
      if (!n.free[nc] || parent[nc] !== -2) continue;
      if (di && dj && (!n.free[j * NW + ni] || !n.free[nj * NW + i])) continue;
      parent[nc] = c;
      if (nc === start) found = true;
      q.push(nc);
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = start; c >= 0; c = parent[c]) cells.push(c);
  const out: number[] = [];
  let px = fx;
  let pz = fz;
  let i = 0;
  while (i < cells.length) {
    let best = i;
    for (let k = i + 1; k < cells.length && k - best <= 3; k++) {
      const [cx, cz] = center(cells[k]);
      if (lineOk(n, px, pz, cx, cz)) best = k;
    }
    [px, pz] = center(cells[best]);
    out.push(px, pz);
    i = best + 1;
  }
  out.push(gx, gz);
  return out;
}

/** Un point de ronde : le long de l'enclos, à une ou deux cases de la clôture, côté extérieur. */
function patrolPoint(s: GameState, near: { x: number; z: number } | null): [number, number] | null {
  const n = nav(s);
  for (let k = 0; k < 30; k++) {
    let x: number;
    let z: number;
    if (near && k < 15) {
      x = near.x + randRange(s, -6, 6);
      z = near.z + randRange(s, -6, 6);
    } else {
      x = randRange(s, OX, OX + NW);
      z = randRange(s, OZ, OZ + NH);
    }
    const c = cellOf(x, z);
    if (c < 0 || !n.free[c]) continue;
    const d = distanceToFarm(s, x, z);
    if (d > 1.3 && d < 3.4) return [x, z];
  }
  return null;
}

// ------------------------------------------------------------ Comportement ----
function follow(d: GuardDog, speed: number, dt: number) {
  let budget = speed * dt;
  let moved = 0;
  while (budget > 1e-6 && d.path.length >= 2) {
    const ex = d.path[0] - d.x;
    const ez = d.path[1] - d.z;
    const dist = Math.hypot(ex, ez);
    if (dist < 1e-3) {
      d.path.splice(0, 2);
      continue;
    }
    let diff = Math.atan2(ex, ez) - d.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    d.heading += Math.max(-9 * dt, Math.min(9 * dt, diff));
    const step = Math.min(dist, budget);
    d.x += (ex / dist) * step;
    d.z += (ez / dist) * step;
    budget -= step;
    moved += step;
    if (step >= dist) d.path.splice(0, 2);
  }
  d.spd = moved / Math.max(dt, 1e-6);
}

const barkT = new WeakMap<GuardDog, number>();
const repathT = new WeakMap<GuardDog, number>();

export function updateDog(s: GameState, dt: number) {
  const d = s.dog;
  if (!d) return;
  d.t -= dt;
  // l'enclos s'est agrandi sous ses pattes : il ressort par le chemin le plus court
  const here = cellOf(d.x, d.z);
  const n = nav(s);
  if (here >= 0 && !n.free[here] && d.act !== 'chase') {
    const out = nearestFree(n, d.x, d.z);
    if (out >= 0) [d.x, d.z] = center(out);
  }
  // un prédateur aux abords : il fonce en aboyant
  const prey = s.predators.find((p) => p.state !== 'dead' && p.state !== 'flee' && p.state !== 'leave' && distanceToFarm(s, p.x, p.z) < 9 && (p.species === 'fox' || p.y < 3));
  if (prey) {
    d.act = 'chase';
    const rp = (repathT.get(d) ?? 0) - dt;
    repathT.set(d, rp);
    if (rp <= 0 || !d.path.length) {
      repathT.set(d, 0.5);
      d.path = dogPath(s, d.x, d.z, prey.x, prey.z) ?? [];
    }
    follow(d, DOG.run, dt);
    const bt = (barkT.get(d) ?? 0) - dt;
    barkT.set(d, bt);
    if (bt <= 0) {
      barkT.set(d, 1.1);
      emit(s, { kind: 'dogBark', x: d.x, z: d.z });
    }
    // même à travers le grillage, ses aboiements font détaler le prédateur
    if (Math.hypot(prey.x - d.x, prey.z - d.z) < DOG.scare && scarePredator(s, prey))
      notify(s, `${d.name} a fait fuir ${PREDATOR_INFO[prey.species].the} ! Bon chien !`, 'good', '🐕');
    return;
  }
  if (d.act === 'chase') {
    d.act = 'walk';
    d.path = [];
  }
  const night = isNightHour(currentHour(s));
  const [kx, kz] = kennelPoint(s);
  if (night) {
    // il rentre dormir devant sa niche
    const bx = kx;
    const bz = kz + 0.6;
    if (Math.hypot(bx - d.x, bz - d.z) > 0.25) {
      if (!d.path.length) d.path = dogPath(s, d.x, d.z, bx, bz) ?? [bx, bz];
      d.act = 'walk';
      follow(d, DOG.walk, dt);
    } else {
      d.act = 'sleep';
      d.spd = 0;
      d.heading = 0.4;
    }
    return;
  }
  if (d.act === 'sleep') {
    d.act = 'sit';
    d.t = 1;
  }
  if (d.path.length) {
    d.act = 'walk';
    follow(d, DOG.walk, dt);
    return;
  }
  d.spd = 0;
  if (d.act === 'walk') {
    d.act = 'sit';
    d.t = randRange(s, 1.5, 4);
  }
  if (d.t > 0) return;
  // ronde : il longe l'enclos, côté extérieur, avec quelques pauses assis
  const hens = s.hens.filter((h) => h.act !== 'sleep');
  const near = hens.length && rand(s) < 0.6 ? hens[Math.floor(rand(s) * hens.length)] : null;
  const target = patrolPoint(s, near);
  const path = target ? dogPath(s, d.x, d.z, target[0], target[1]) : null;
  if (path) {
    d.path = path;
    d.act = 'walk';
  } else d.t = 2;
}

export const dogUpkeep = (s: GameState) => (s.dog ? DOG.upkeepPerDay : 0);
