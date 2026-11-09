// Les prédateurs : le renard (crépuscule, nuit, aube) sort des hautes herbes, traque une poule
// et l'emporte ; la buse (en journée) tournoie au-dessus de la ferme puis pique sur sa proie.
// Le joueur les abat d'un clic ; le commis et le jardinier sortent le fusil (voir workers.ts).
import { DOG, GRID_H, GRID_W, GRID_Z0, GRID_Z1, HOUR, PREDATORS, WORLD, clamp } from '../config/balance';
import { blocksMover, cellIndex, cellX, cellZ, coopDoor, crossesFence, currentDay, facadeHeading, frontOf, currentHour, edgeBetween, emit, inGrid, newId, notify, parcelCoords, parcelOrigin, rand, randRange, rt, smoothPath, stepBlocked, type Mover, isShelter } from './core';
import { shelteredByTree } from './perks';
import { addXp, earn, farmLevel, fmtMoney } from './economy';
import { getBuilding } from './queries';
import type { ActionResult, Building, GameState, Hen, HenAct, Predator, PredatorSpecies, Worker } from './types';

export const PREDATOR_INFO: Record<PredatorSpecies, { name: string; a: string; the: string; female: boolean }> = {
  fox: { name: 'Renard', a: 'un renard', the: 'le renard', female: false },
  hawk: { name: 'Buse', a: 'une buse', the: 'la buse', female: true },
  wolf: { name: 'Loup', a: 'un loup', the: 'le loup', female: false },
};
/** Renard ou loup : les chasseurs au sol (la buse, elle, vole). */
const onGround = (p: Predator) => p.species !== 'hawk';
/** Les réglages de l'espèce au sol. */
const groundOf = (p: Predator) => (p.species === 'wolf' ? PREDATORS.wolf : PREDATORS.fox);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ------------------------------------------------------------- Requêtes ----
export const isAlive = (p: Predator) => p.state !== 'dead';
/** Le prédateur cherche encore une proie (ni mort, ni en train de repartir). */
export const isThreat = (p: Predator) => p.state !== 'dead' && p.state !== 'flee' && p.state !== 'leave' && p.state !== 'carry';
export function livePredators(s: GameState) {
  return s.predators.filter(isAlive);
}
/** Hauteur visée (centre du corps) : au sol pour le renard, en vol pour la buse. */
export function predatorAimY(p: Predator) {
  if (p.species === 'wolf') return p.state === 'dead' ? 0.2 : 0.46;
  return p.species === 'fox' ? (p.state === 'dead' ? 0.15 : 0.32) : Math.max(0.2, p.y);
}

/** Poules hors d'atteinte : couchées au poulailler, au nid, au bain ou déjà saisies. */
const SHELTERED = new Set<HenAct>(['sleep', 'enter', 'exit', 'lay', 'bathe', 'caught']);
export function catchable(h: Hen) {
  // à la poussinière, le grillage et le toit protègent les poussins
  // et aucun prédateur n'ose s'attaquer à la poule légendaire
  return !SHELTERED.has(h.act) && !h.nursery && !h.legendary;
}

/** Distance (en cases) entre un point et le terrain possédé. */
export function distanceToFarm(s: GameState, x: number, z: number) {
  let best = Infinity;
  for (const key of s.parcels) {
    const [c, r] = parcelCoords(key);
    const [x0, z0] = parcelOrigin(c, r);
    const dx = Math.max(x0 - x, 0, x - (x0 + WORLD.PARCEL));
    const dz = Math.max(z0 - z, 0, z - (z0 + WORLD.PARCEL));
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

/** Le prédateur menaçant le plus proche d'un point (les poules prennent la fuite). */
export function threatNear(s: GameState, x: number, z: number, scale = 1): Predator | null {
  let best: Predator | null = null;
  let bd = Infinity;
  for (const p of s.predators) {
    let r = 0;
    if (onGround(p)) {
      if (p.state === 'chase' || p.state === 'grab') r = PREDATORS.fleeRadius + 0.3;
      else if (p.state === 'stalk' || p.state === 'approach' || p.state === 'prowl' || p.state === 'carry' || p.state === 'dig') r = PREDATORS.fleeRadius * 0.75;
    } else if ((p.state === 'dive' && p.y < 3.2) || p.state === 'grab') r = PREDATORS.fleeRadius;
    if (r <= 0) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < r * scale && d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

// --------------------------------------------------- Déplacements (renard) ----
// Le renard contourne les bâtiments et se faufile sous le grillage de la ferme.
// Hors de la grille, il se déplace librement.
function blockedAt(s: GameState, x: number, z: number) {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  return inGrid(cx, cz) && rt(s).blocked[cellIndex(cx, cz)] === 1;
}
function clearAt(s: GameState, x: number, z: number, r = 0.2) {
  return !blockedAt(s, x, z) && !blockedAt(s, x + r, z) && !blockedAt(s, x - r, z) && !blockedAt(s, x, z + r) && !blockedAt(s, x, z - r);
}
function lineFree(s: GameState, x0: number, z0: number, x1: number, z1: number, who: Mover = 'fox') {
  if (crossesFence(s, x0, z0, x1, z1, who)) return false;
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.25));
  for (let i = 1; i <= n; i++) if (!clearAt(s, x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n)) return false;
  return true;
}
const inside = (x: number, z: number) => x >= 0 && z >= GRID_Z0 && x < GRID_W && z < GRID_Z1;

/** Côté d'une case du bord par lequel on rejoint l'extérieur de la grille, le plus proche de (ox, oz). */
function borderExit(s: GameState, x: number, z: number, ox: number, oz: number, who: Mover): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (inGrid(x + dx, z + dz) || blocksMover(edgeBetween(s, x, z, x + dx, z + dz), who)) continue;
    const px = x + 0.5 + dx * 0.9;
    const pz = z + 0.5 + dz * 0.9;
    const d = Math.hypot(px - ox, pz - oz);
    if (d < bd) {
      bd = d;
      best = [px, pz];
    }
  }
  return best;
}

/** Chemin du renard (BFS sur les cases libres de bâtiment, sans franchir de clôture), lissé. Null si inaccessible. */
export function foxPath(s: GameState, fx: number, fz: number, tx: number, tz: number, who: Mover = 'fox'): number[] | null {
  if (lineFree(s, fx, fz, tx, tz, who)) return [tx, tz];
  const fin = inside(fx, fz);
  const tin = inside(tx, tz);
  if (!fin && !tin) return [tx, tz];
  const r = rt(s);
  const free = (i: number) => r.blocked[i] === 0;
  const toCell = (x: number, z: number) => {
    const cx = clamp(Math.floor(x), 0, GRID_W - 1);
    const cz = clamp(Math.floor(z), GRID_Z0, GRID_Z1 - 1);
    if (free(cellIndex(cx, cz))) return cellIndex(cx, cz);
    for (let rad = 1; rad < 4; rad++)
      for (let dz = -rad; dz <= rad; dz++)
        for (let dx = -rad; dx <= rad; dx++) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (inGrid(nx, nz) && free(cellIndex(nx, nz))) return cellIndex(nx, nz);
        }
    return -1;
  };
  // BFS depuis l'extrémité située dans la grille
  const src = fin ? toCell(fx, fz) : toCell(tx, tz);
  if (src < 0) return null;
  const dist = new Int16Array(GRID_W * GRID_H).fill(-1);
  const parent = new Int32Array(GRID_W * GRID_H).fill(-1);
  dist[src] = 0;
  const q = [src];
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi];
    const x = cellX(i);
    const z = cellZ(i);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (!inGrid(nx, nz)) continue;
        const ni = cellIndex(nx, nz);
        if (!free(ni) || dist[ni] >= 0) continue;
        if (dx && dz && (!free(cellIndex(x + dx, z)) || !free(cellIndex(x, z + dz)))) continue;
        if (stepBlocked(s, x, z, nx, nz, who)) continue;
        dist[ni] = dist[i] + 1;
        parent[ni] = i;
        q.push(ni);
      }
  }
  const chain = (to: number) => {
    const out: number[] = [];
    for (let c = to; c >= 0; c = c === src ? -1 : parent[c]) out.push(c);
    return out.reverse(); // src → to
  };
  const clear = (x0: number, z0: number, x1: number, z1: number) => lineFree(s, x0, z0, x1, z1, who);
  if (fin && tin) {
    const goal = toCell(tx, tz);
    if (goal < 0 || dist[goal] < 0) return null;
    return smoothPath(chain(goal), fx, fz, tx, tz, clear);
  }
  // une extrémité hors de la grille : on passe par la case du bord la plus commode
  const ox = fin ? tx : fx;
  const oz = fin ? tz : fz;
  let bestCell = -1;
  let bestPt: [number, number] | null = null;
  let bestScore = Infinity;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] < 0) continue;
    const x = cellX(i);
    const z = cellZ(i);
    if (x > 0 && z > GRID_Z0 && x < GRID_W - 1 && z < GRID_Z1 - 1) continue;
    const pt = borderExit(s, x, z, ox, oz, who);
    if (!pt) continue;
    const score = dist[i] + Math.hypot(pt[0] - ox, pt[1] - oz);
    if (score < bestScore) {
      bestScore = score;
      bestCell = i;
      bestPt = pt;
    }
  }
  if (bestCell < 0 || !bestPt) return null;
  const cells = chain(bestCell);
  if (fin) return [...smoothPath(cells, fx, fz, bestPt[0], bestPt[1], clear), tx, tz];
  return [bestPt[0], bestPt[1], ...smoothPath(cells.reverse(), bestPt[0], bestPt[1], tx, tz, clear)];
}

function turn(p: Predator, want: number, dt: number, rate = 10) {
  let d = want - p.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  p.heading += clamp(d, -rate * dt, rate * dt);
}

/** Avance le renard vers (tx,tz) ; renvoie la distance restante, ou -1 si une clôture l'en empêche. */
function moveFox(s: GameState, p: Predator, tx: number, tz: number, speed: number, dt: number, repath = 0.8, who: Mover = 'fox') {
  p.pathT -= dt;
  const n = p.path.length;
  if (p.pathT <= 0 || n < 2 || Math.hypot(p.path[n - 2] - tx, p.path[n - 1] - tz) > 0.6) {
    const path = foxPath(s, p.x, p.z, tx, tz, who);
    p.pathT = repath;
    if (!path) {
      p.path = [];
      p.spd = 0;
      return -1;
    }
    p.path = path;
  }
  let budget = speed * dt;
  while (budget > 1e-6 && p.path.length >= 2) {
    const dx = p.path[0] - p.x;
    const dz = p.path[1] - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) {
      p.path.splice(0, 2);
      continue;
    }
    turn(p, Math.atan2(dx, dz), dt);
    const step = Math.min(d, budget);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    budget -= step;
    if (step >= d) p.path.splice(0, 2);
  }
  p.spd = speed;
  return Math.hypot(tx - p.x, tz - p.z);
}

// ------------------------------------------------------------ Apparition ----
const quiet = new WeakSet<GameState>();
/** Hors ligne (ou onglet masqué), personne ne peut défendre la ferme : pas d'attaque. */
export function setPredatorsQuiet(s: GameState, on: boolean) {
  if (on) {
    quiet.add(s);
    s.predators = [];
  } else quiet.delete(s);
}

/** Tirage horaire : un prédateur surgit de temps en temps (jamais deux à la fois). */
export function maybeSpawnPredator(s: GameState) {
  if (!s.settings.predators || quiet.has(s) || s.predators.some(isAlive)) return;
  if (farmLevel(s) < PREDATORS.minLevel || currentDay(s) < PREDATORS.minDay || s.hens.length < PREDATORS.minHens) return;
  // un chien de garde décourage la plupart des prédateurs, et ils reviennent bien moins vite
  if (s.clock.t - s.lastPredatorT < PREDATORS.minGapHours * HOUR * (s.dog ? 2 : 1)) return;
  const h = currentHour(s);
  const k = s.dog ? DOG.predatorFactor : 1;
  const r = rand(s);
  if (h >= 19 || h < 6.5) {
    if (r < PREDATORS.foxNightChance * k) spawnPredator(s, 'fox');
  } else if (r < PREDATORS.foxDayChance * k) spawnPredator(s, 'fox');
  else if (h >= 9 && h < 17 && farmLevel(s) >= PREDATORS.hawkLevel && r < (PREDATORS.foxDayChance + PREDATORS.hawkChance) * k) spawnPredator(s, 'hawk');
}

/**
 * La meute de loups : à partir du niveau 20, une fois tous les 15 à 30 jours, en fin d'après-midi
 * (les poules sont dehors). Chien ou pas, elle vient : il faut des commis armés pour la repousser.
 */
export function maybeWolfPack(s: GameState) {
  const W = PREDATORS.wolf;
  if (!s.settings.predators || quiet.has(s) || farmLevel(s) < W.level) return;
  const day = currentDay(s);
  if (s.wolfDay === undefined) {
    s.wolfDay = day + W.gapMin + Math.floor(rand(s) * (W.gapMax - W.gapMin + 1));
    return;
  }
  if (day < s.wolfDay || s.predators.some((p) => p.species === 'wolf')) return;
  const h = currentHour(s);
  if (h < W.fromHour || h >= W.toHour || s.hens.filter(catchable).length < 4) return;
  spawnWolfPack(s);
  s.wolfDay = day + W.gapMin + Math.floor(rand(s) * (W.gapMax - W.gapMin + 1));
}

/** Fait sortir une meute du bois (tirage, ou directement pour les tests). */
export function spawnWolfPack(s: GameState, size?: number): Predator[] {
  const W = PREDATORS.wolf;
  const n = size ?? W.packMin + Math.floor(rand(s) * (W.packMax - W.packMin + 1));
  const outside = s.hens.filter(catchable);
  const focus = outside.length ? outside[Math.floor(rand(s) * outside.length)] : { x: 15, z: 25 };
  const [x0, z0] = foxSpawnPoint(s, focus);
  const pack: Predator[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.6 + rand(s) * 1.6;
    const p = blank(s, 'wolf', x0 + Math.sin(a) * r, z0 + Math.cos(a) * r);
    p.heading = Math.atan2(focus.x - p.x, focus.z - p.z);
    // (ils sortent du bois les uns après les autres)
    p.age = -i * 0.35;
    p.ex = x0;
    p.ez = z0;
    s.predators.push(p);
    pack.push(p);
  }
  s.lastPredatorT = s.clock.t;
  emit(s, { kind: 'predatorSpawn', id: pack[0].id, species: 'wolf', x: x0, z: z0 });
  notify(s, `Une meute de ${n} loups sort du bois ! Commis, aux fusils : il en faudra plusieurs pour la repousser.`, 'bad', '🐺');
  return pack;
}

function blank(s: GameState, species: PredatorSpecies, x: number, z: number): Predator {
  return {
    id: newId(s),
    species,
    x,
    z,
    y: 0,
    heading: 0,
    state: species === 'hawk' ? 'arrive' : 'approach',
    t: 0,
    age: 0,
    hp: species === 'wolf' ? PREDATORS.wolf.hp : species === 'fox' ? PREDATORS.fox.hp : PREDATORS.hawk.hp,
    targetHen: -1,
    targetCoop: -1,
    carrying: null,
    ex: x,
    ez: z,
    cx: x,
    cz: z,
    ang: 0,
    spd: 0,
    path: [],
    pathT: 0,
    spotted: false,
    digEdge: -1,
    digX: 0,
    digZ: 0,
  };
}

/** Lisière d'où sort le renard : hautes herbes ou bois voisins, jamais côté route ni maison. */
/** Hors de l'enclos : le grillage entoure exactement le terrain possédé. */
function outsideFence(s: GameState, x: number, z: number) {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  return !inGrid(cx, cz) || !rt(s).owned[cellIndex(cx, cz)];
}

function foxSpawnPoint(s: GameState, near: { x: number; z: number }): [number, number] {
  const r = rt(s);
  const cands: Array<{ x: number; z: number; dx: number; dz: number; d: number }> = [];
  for (let z = GRID_Z0; z < GRID_Z1; z++)
    for (let x = 0; x < GRID_W; x++) {
      if (!r.owned[cellIndex(x, z)]) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, -1]] as const) {
        const nx = x + dx;
        const nz = z + dz;
        if (inGrid(nx, nz) && r.owned[cellIndex(nx, nz)]) continue;
        cands.push({ x: x + 0.5, z: z + 0.5, dx, dz, d: Math.hypot(x + 0.5 - near.x, z + 0.5 - near.z) });
      }
    }
  // on ne garde que les points de départ valables (hors de l'enclos, ni maison ni route), puis
  // le renard surgit de l'un des plus proches des poules
  const ok = (x: number, z: number) =>
    x > -6 && x < GRID_W + 6 && z > GRID_Z0 - 6 && z < GRID_Z1 - 0.3 && !(x < 0.5 && z > 15) && outsideFence(s, x, z) && !blockedAt(s, x, z);
  const spots: Array<[number, number, number]> = [];
  for (const c of cands) {
    const out = randRange(s, 4, 6);
    const side = randRange(s, -1.5, 1.5);
    const x = c.x + c.dx * out + c.dz * side;
    const z = c.z + c.dz * out + c.dx * side;
    if (ok(x, z)) spots.push([x, z, c.d]);
  }
  spots.sort((a, b) => a[2] - b[2]);
  const pool = spots.slice(0, 8);
  if (pool.length) {
    const [x, z] = pool[Math.floor(rand(s) * pool.length)];
    return [x, z];
  }
  // à défaut : derrière la ferme, au nord, toujours hors de l'enclos
  return [clamp(near.x + randRange(s, -4, 4), 1, GRID_W - 1), GRID_Z0 - 3.5];
}

/** Fait surgir un prédateur (tirage horaire, ou directement pour les tests). */
export function spawnPredator(s: GameState, species: PredatorSpecies): Predator {
  const outside = s.hens.filter(catchable);
  const coops = s.buildings.filter((b) => isShelter(b));
  const focus = outside.length
    ? (() => {
        const h = outside[Math.floor(rand(s) * outside.length)];
        return { x: h.x, z: h.z };
      })()
    : coops.length
      ? coopDoor(coops[0])
      : { x: 15, z: 25 };
  let p: Predator;
  if (species === 'fox') {
    const [x, z] = foxSpawnPoint(s, focus);
    p = blank(s, 'fox', x, z);
    p.heading = Math.atan2(focus.x - x, focus.z - z);
  } else {
    // la buse arrive de loin, haut dans le ciel, et tourne au-dessus des poules
    const a = rand(s) * Math.PI * 2;
    const x = focus.x + Math.sin(a) * 24;
    const z = focus.z + Math.cos(a) * 24;
    p = blank(s, 'hawk', x, z);
    p.y = PREDATORS.hawk.altitude + 2.5;
    p.cx = focus.x;
    p.cz = focus.z;
    // elle repart du côté opposé
    p.ex = focus.x - Math.sin(a) * 30;
    p.ez = focus.z - Math.cos(a) * 30;
    p.heading = Math.atan2(focus.x - x, focus.z - z);
  }
  s.predators.push(p);
  s.lastPredatorT = s.clock.t;
  emit(s, { kind: 'predatorSpawn', id: p.id, species, x: p.x, z: p.z });
  return p;
}

// -------------------------------------------------------------- Proies ----
function nearestPrey(s: GameState, p: Predator, maxD = Infinity, avoid = -1): Hen | null {
  let best: Hen | null = null;
  let bd = maxD;
  for (const h of s.hens) {
    if (!catchable(h) || h.id === avoid) continue;
    // sous les branches d'un arbre, une buse ne peut pas piquer
    if (p.species === 'hawk' && shelteredByTree(s, h.x, h.z)) continue;
    if (s.predators.some((o) => o !== p && o.targetHen === h.id && (o.state === 'grab' || (p.species === 'wolf' && o.species === 'wolf' && o.state !== 'dead')))) continue;
    const d = Math.hypot(h.x - p.x, h.z - p.z);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

function coopDoorFront(b: Building): [number, number] {
  return frontOf(b, 0.4);
}

function grab(s: GameState, p: Predator, h: Hen, time: number) {
  p.state = 'grab';
  p.t = time;
  p.targetHen = h.id;
  h.act = 'caught';
  h.actT = 0.5;
  h.targetId = -1;
  emit(s, { kind: 'cluck', henId: h.id });
}

/** La proie est emportée : la poule quitte le troupeau. */
function takeHen(s: GameState, p: Predator, h: Hen) {
  const i = s.hens.indexOf(h);
  if (i < 0) return;
  s.hens.splice(i, 1);
  s.stats.hensTaken++;
  p.carrying = h.breed;
  p.targetHen = -1;
  p.state = 'carry';
  p.path = [];
  p.pathT = 0;
  emit(s, { kind: 'henTaken', henId: h.id, species: p.species, x: h.x, z: h.z });
  emit(s, { kind: 'henGone', henId: h.id, reason: 'died' });
  notify(s, `${cap(PREDATOR_INFO[p.species].the)} a emporté ${h.name} !`, 'bad', p.species === 'fox' ? '🦊' : p.species === 'wolf' ? '🐺' : '🦅');
}

/** Libère une poule saisie (le prédateur a été touché à temps) : elle s'enfuit, blessée. */
function release(s: GameState, p: Predator) {
  const h = s.hens.find((x) => x.id === p.targetHen);
  if (!h || h.act !== 'caught') return;
  h.health = Math.max(5, h.health - PREDATORS.rescueDamage);
  h.act = 'idle';
  h.actT = 0.1;
  emit(s, { kind: 'henRescued', henId: h.id, x: h.x, z: h.z });
  notify(s, `${h.name} a été arrachée de justesse aux griffes ${p.species === 'fox' ? 'du renard' : p.species === 'wolf' ? 'du loup' : 'de la buse'} !`, 'good', '🐔');
}

// --------------------------------------------------------------- Renard ----
function updateFox(s: GameState, p: Predator, dt: number) {
  const F = groundOf(p);
  switch (p.state) {
    case 'approach':
    case 'stalk':
    case 'chase': {
      if (p.state === 'approach' && p.age < F.lurk) {
        // tapi à la lisière, il observe la basse-cour
        p.spd = 0;
        return;
      }
      let hen = p.targetHen >= 0 ? s.hens.find((h) => h.id === p.targetHen) : undefined;
      p.t -= dt;
      if (!hen || !catchable(hen) || p.t <= 0) {
        // nouvelle cible : la plus proche (on garde la proie actuelle si elle reste la meilleure)
        const best = nearestPrey(s, p);
        const keep = hen && best && catchable(hen) && Math.hypot(hen.x - p.x, hen.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) * 1.5;
        if (!keep) hen = best ?? undefined;
        p.targetHen = hen?.id ?? -1;
        p.t = 1;
      }
      if (!hen) {
        // personne dehors : un poulailler resté ouvert ? sinon il rôde devant une trappe fermée
        const coops = s.buildings.filter((b) => isShelter(b) && s.hens.some((h) => h.coopId === b.id && h.act === 'sleep'));
        const open = coops.filter((b) => !b.closed);
        const pickNear = (list: Building[]) => list.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
        const target = open.length ? pickNear(open) : coops.length ? pickNear(coops) : null;
        if (!target) return leave(s, p);
        p.targetCoop = target.id;
        p.state = target.closed ? 'prowl' : 'raid';
        p.t = -1;
        return;
      }
      const d = Math.hypot(hen.x - p.x, hen.z - p.z);
      if (p.state === 'chase') {
        p.ang += dt; // (renard) `ang` mesure la durée de la poursuite
        if (p.ang > F.chaseMax) {
          // la poule lui échappe : il en cherche une autre
          p.state = 'stalk';
          p.ang = 0;
          const other = nearestPrey(s, p, Infinity, hen.id);
          p.targetHen = other?.id ?? -1;
          p.t = 2;
          return;
        }
      } else if (d <= F.chaseAt) {
        p.state = 'chase';
        p.ang = 0;
      } else p.state = d <= F.stalkAt ? 'stalk' : 'approach';
      const speed = p.state === 'chase' ? F.chase : p.state === 'stalk' ? F.stalk : F.trot;
      const left = moveFox(s, p, hen.x, hen.z, speed, dt, p.state === 'chase' ? 0.25 : 0.7);
      if (left < 0) return blockedByFence(s, p);
      if (left <= F.grabAt) grab(s, p, hen, F.grabTime);
      return;
    }
    case 'dig': {
      // (ancien creusement sous le grillage) : le renard se faufile désormais sous la clôture
      p.state = 'stalk';
      p.t = 0;
      p.path = [];
      return;
    }
    case 'grab': {
      const hen = s.hens.find((h) => h.id === p.targetHen);
      p.spd = 0;
      if (!hen) {
        p.state = 'stalk';
        p.targetHen = -1;
        p.t = 0;
        return;
      }
      // il secoue sa proie dans la gueule (celle du loup est bien plus loin devant)
      const reach = p.species === 'wolf' ? 0.62 : 0.42;
      hen.act = 'caught';
      hen.actT = 0.5;
      hen.x = p.x + Math.sin(p.heading) * reach;
      hen.z = p.z + Math.cos(p.heading) * reach;
      p.t -= dt;
      if (p.t <= 0) takeHen(s, p, hen);
      return;
    }
    case 'raid':
    case 'prowl': {
      const b = getBuilding(s, p.targetCoop);
      if (!b) return leave(s, p);
      // une poule repasse dehors à portée : elle redevient la cible
      const prey = nearestPrey(s, p, 7);
      if (prey) {
        p.state = 'stalk';
        p.targetHen = prey.id;
        p.t = 1;
        return;
      }
      if (p.state === 'raid' && b.closed) {
        p.state = 'prowl';
        p.t = -1;
      }
      const [dx, dz] = coopDoorFront(b);
      if (p.t < 0) {
        // en route vers la trappe
        const left = moveFox(s, p, dx, dz, F.stalk, dt);
        if (left < 0) return blockedByFence(s, p);
        if (left < 0.12) {
          p.t = p.state === 'raid' ? F.raidTime : F.prowlTime;
          p.path = [];
        }
        return;
      }
      p.spd = 0;
      // museau vers la trappe
      turn(p, facadeHeading(b) + Math.PI, dt, 6);
      p.t -= dt;
      if (p.t > 0) return;
      if (p.state === 'raid') {
        const sleepers = s.hens.filter((h) => h.coopId === b.id && h.act === 'sleep' && !h.legendary);
        if (!sleepers.length) return leave(s, p);
        const h = sleepers[Math.floor(rand(s) * sleepers.length)];
        h.x = dx;
        h.z = dz;
        takeHen(s, p, h);
      } else {
        notify(s, 'Le renard a trouvé les trappes fermées : il repart bredouille.', 'good', '🔒');
        leave(s, p);
      }
      return;
    }
    case 'carry':
    case 'flee':
    case 'leave': {
      const speed = p.state === 'flee' ? F.run : p.state === 'carry' ? F.chase * 0.85 : F.trot;
      let left = moveFox(s, p, p.ex, p.ez, speed, dt);
      // enfermé (trou rebouché derrière lui) : il saute par-dessus pour s'enfuir
      if (left < 0) left = moveFox(s, p, p.ex, p.ez, speed, dt, 0.8, 'free');
      if (left < 0.3) despawn(s, p);
      return;
    }
    case 'dead':
      p.spd = 0;
      p.t -= dt;
      if (p.t <= 0) despawn(s, p);
      return;
  }
}

/** Aucun passage jusqu'à la proie (bâtiments) : le renard renonce. */
function blockedByFence(s: GameState, p: Predator) {
  leave(s, p);
}

/** Le chien fonce sur le prédateur : il lâche sa proie et détale (sans être blessé). */
export function scarePredator(s: GameState, p: Predator) {
  if (p.state === 'dead' || p.state === 'flee' || p.state === 'leave' || p.state === 'carry') return false;
  if (p.state === 'grab') release(s, p);
  p.state = 'flee';
  p.path = [];
  p.pathT = 0;
  p.targetHen = -1;
  return true;
}

function leave(s: GameState, p: Predator) {
  if (p.state === 'grab') release(s, p);
  p.state = 'leave';
  p.path = [];
  p.pathT = 0;
  p.targetHen = -1;
}

function despawn(s: GameState, p: Predator) {
  const i = s.predators.indexOf(p);
  if (i >= 0) s.predators.splice(i, 1);
}

// ----------------------------------------------------------------- Buse ----
function updateHawk(s: GameState, p: Predator, dt: number) {
  const H = PREDATORS.hawk;
  const toward = (tx: number, tz: number, speed: number) => {
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const k = Math.min(d, speed * dt) / d;
      p.x += dx * k;
      p.z += dz * k;
      turn(p, Math.atan2(dx, dz), dt, 3);
    }
    p.spd = speed;
    return d;
  };
  switch (p.state) {
    case 'arrive': {
      p.y += (H.altitude - p.y) * Math.min(1, dt * 0.8);
      const d = Math.hypot(p.cx - p.x, p.cz - p.z);
      // rejoint la tangente du cercle
      toward(p.cx, p.cz, H.fly);
      if (d <= H.radius + 0.3) {
        p.state = 'circle';
        p.ang = Math.atan2(p.x - p.cx, p.z - p.cz);
        p.t = randRange(s, H.circleMin, H.circleMax);
      }
      return;
    }
    case 'circle': {
      p.ang += H.spin * dt;
      p.x = p.cx + Math.sin(p.ang) * H.radius;
      p.z = p.cz + Math.cos(p.ang) * H.radius;
      p.heading = p.ang + Math.PI / 2;
      p.y += (H.altitude + Math.sin(p.age * 0.9) * 0.35 - p.y) * Math.min(1, dt * 2);
      p.spd = H.spin * H.radius;
      p.t -= dt;
      if (p.t > 0) return;
      const prey = nearestPrey(s, { ...p, x: p.cx, z: p.cz }, 10);
      if (!prey) return leave(s, p);
      p.state = 'dive';
      p.targetHen = prey.id;
      p.t = H.diveTime;
      return;
    }
    case 'dive': {
      const hen = s.hens.find((h) => h.id === p.targetHen);
      if (!hen || !catchable(hen) || shelteredByTree(s, hen.x, hen.z)) {
        // proie à l'abri (poulailler, arbre) : elle remonte et tournoie encore un peu
        p.state = 'circle';
        p.ang = Math.atan2(p.x - p.cx, p.z - p.cz);
        p.t = 4;
        p.targetHen = -1;
        return;
      }
      const remain = Math.max(0.12, p.t);
      const d = Math.hypot(hen.x - p.x, hen.z - p.z);
      toward(hen.x, hen.z, d / remain + 0.5);
      p.y = Math.max(0.3, p.y - ((p.y - 0.3) * dt) / remain);
      p.t -= dt;
      if (Math.hypot(hen.x - p.x, hen.z - p.z) < 0.4 && p.y < 0.7) {
        grab(s, p, hen, H.grabTime);
      } else if (p.t <= -0.6) {
        // manquée : elle remonte
        p.state = 'circle';
        p.ang = Math.atan2(p.x - p.cx, p.z - p.cz);
        p.t = 3;
      }
      return;
    }
    case 'grab': {
      const hen = s.hens.find((h) => h.id === p.targetHen);
      p.spd = 0;
      p.y = 0.3;
      if (!hen) return leave(s, p);
      hen.act = 'caught';
      hen.actT = 0.5;
      hen.x = p.x;
      hen.z = p.z;
      p.t -= dt;
      if (p.t <= 0) takeHen(s, p, hen);
      return;
    }
    case 'carry':
    case 'flee':
    case 'leave': {
      p.y += (9 - p.y) * Math.min(1, dt * (p.state === 'carry' ? 0.45 : 0.8));
      toward(p.ex, p.ez, p.state === 'carry' ? H.fly * 0.75 : H.fly);
      if (Math.hypot(p.ex - p.x, p.ez - p.z) < 1) despawn(s, p);
      return;
    }
    case 'dead': {
      // chute, puis la buse reste au sol quelques instants
      if (p.y > 0.12) {
        p.spd += 9 * dt;
        p.y = Math.max(0.12, p.y - p.spd * dt);
        p.heading += dt * 6;
      } else {
        p.t -= dt;
        if (p.t <= 0) despawn(s, p);
      }
      return;
    }
  }
}

// ---------------------------------------------------------- Mise à jour ----
export function updatePredators(s: GameState, dt: number) {
  if (!s.predators.length) return;
  for (const p of [...s.predators]) {
    p.age += dt;
    // chasse trop longue : il abandonne
    if (p.age > (p.species === 'wolf' ? PREDATORS.wolf.maxLife : PREDATORS.maxLife) && isThreat(p) && p.state !== 'grab') leave(s, p);
    if (onGround(p)) updateFox(s, p, dt);
    else updateHawk(s, p, dt);
  }
  separatePack(s);
}

/** Corps au sol (renard, loup) : ils ne se traversent jamais, ils s'écartent l'un de l'autre. */
function separatePack(s: GameState) {
  const live = s.predators.filter((p) => onGround(p) && p.state !== 'dead');
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const gap = (a.species === 'wolf' ? 0.34 : 0.24) + (b.species === 'wolf' ? 0.34 : 0.24);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d >= gap) continue;
      const ux = d > 1e-4 ? dx / d : Math.sin(a.id);
      const uz = d > 1e-4 ? dz / d : Math.cos(a.id);
      const push = (gap - d) / 2;
      // (celui qui tient une proie ne bouge pas : c'est l'autre qui s'écarte)
      const ka = a.state === 'grab' ? 0 : b.state === 'grab' ? 2 : 1;
      const kb = 2 - ka;
      const ax = a.x - ux * push * ka;
      const az = a.z - uz * push * ka;
      const bx = b.x + ux * push * kb;
      const bz = b.z + uz * push * kb;
      if (ka && clearAt(s, ax, az, 0.15)) {
        a.x = ax;
        a.z = az;
      }
      if (kb && clearAt(s, bx, bz, 0.15)) {
        b.x = bx;
        b.z = bz;
      }
    }
}

// ------------------------------------------------------------------ Tirs ----
/** Dégâts infligés (coup de fusil du joueur ou d'un salarié). */
export function damagePredator(s: GameState, p: Predator, dmg: number, by: Worker | null) {
  if (p.state === 'dead') return;
  p.hp -= dmg;
  const info = PREDATOR_INFO[p.species];
  const wasGrabbing = p.state === 'grab';
  if (wasGrabbing) release(s, p);
  if (p.hp <= 0) {
    p.state = 'dead';
    p.t = PREDATORS.corpseTime;
    p.spd = 0;
    p.path = [];
    p.targetHen = -1;
    s.stats.predatorsKilled++;
    addXp(s, PREDATORS.xpKill);
    emit(s, { kind: 'predatorHit', id: p.id, species: p.species, x: p.x, y: predatorAimY(p), z: p.z, killed: true });
    // prime au renard abattu (par le joueur ou par un salarié)
    let bounty = '';
    if (p.species !== 'hawk') {
      const amount = p.species === 'wolf' ? PREDATORS.wolf.bounty : PREDATORS.foxBounty;
      earn(s, amount, 'primes', p.species === 'wolf' ? 'Prime : loup abattu' : 'Prime : renard abattu');
      emit(s, { kind: 'money', amount, x: p.x, z: p.z });
      bounty = ` Prime : +${fmtMoney(amount)}.`;
    }
    if (by) {
      by.today.kills++;
      by.total.kills++;
    }
    if (p.species === 'wolf') {
      // la meute tient tant que la moitié des loups est debout ; au-delà, elle bat en retraite
      const pack = s.predators.filter((o) => o.species === 'wolf');
      const standing = pack.filter((o) => o.state !== 'dead' && o.state !== 'flee' && o.state !== 'leave');
      if (standing.length && standing.length * 2 <= pack.length) {
        for (const o of standing) {
          if (o.state === 'grab') release(s, o);
          if (o.state !== 'carry') {
            o.state = 'flee';
            o.path = [];
            o.pathT = 0;
            o.targetHen = -1;
          }
        }
        notify(s, `La meute bat en retraite : ${pack.length - standing.length} loups abattus !${bounty}`, 'good', '🐺');
      } else if (by) notify(s, `${by.name} a abattu un loup ! Il en reste ${standing.length}.${bounty}`, 'good', '🎯');
      else notify(s, `Un loup abattu ! Il en reste ${standing.length}.${bounty}`, 'good', '🎯');
      return;
    }
    if (by) notify(s, `${by.name} a abattu ${info.the} ! Le troupeau est sauf.${bounty}`, 'good', '🎯');
    else notify(s, `${cap(info.the)} est abattu${info.female ? 'e' : ''} ! Le troupeau est sauf.${bounty}`, 'good', '🎯');
    return;
  }
  emit(s, { kind: 'predatorHit', id: p.id, species: p.species, x: p.x, y: predatorAimY(p), z: p.z, killed: false });
  // blessé, le renard lâche tout et détale (le loup, lui, revient à la charge)
  if (p.species === 'wolf') {
    if (p.state === 'grab' || wasGrabbing) {
      p.state = 'stalk';
      p.targetHen = -1;
      p.t = 0;
    }
    return;
  }
  if (p.state !== 'carry') {
    p.state = 'flee';
    p.path = [];
    p.pathT = 0;
    p.targetHen = -1;
  }
}

/** Le joueur tire (clic sur le prédateur) : chaque tir touche. */
export function shootPredator(s: GameState, id: number): ActionResult {
  const p = s.predators.find((x) => x.id === id);
  if (!p || p.state === 'dead') return { ok: false, reason: 'Plus rien à viser' };
  const y = predatorAimY(p);
  emit(s, { kind: 'shot', by: -1, x0: p.x, y0: y + 6, z0: p.z, x1: p.x, y1: y, z1: p.z, hit: true });
  damagePredator(s, p, 1, null);
  return { ok: true };
}
