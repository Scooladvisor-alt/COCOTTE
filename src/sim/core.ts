// Briques de base : hasard déterministe, horloge, grille et caches de navigation.
import { GRID_H, GRID_W, GRID_Z0, GRID_Z1, HOUR, TIME, WORLD } from '../config/balance';
import { BUILDINGS, sizeOf } from '../config/buildings';
import type { Building, GameEvent, GameState, NotifyAction } from './types';

// ------------------------------------------------------------- Hasard ----
/** Mulberry32 : générateur déterministe dont l'état est sauvegardé avec la partie. */
export function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function randRange(s: GameState, a: number, b: number) {
  return a + (b - a) * rand(s);
}
export function randInt(s: GameState, a: number, b: number) {
  return Math.floor(a + (b - a + 1) * rand(s));
}
export function pick<T>(s: GameState, arr: readonly T[]): T {
  return arr[Math.floor(rand(s) * arr.length) % arr.length];
}
export function randNormal(s: GameState) {
  const u = Math.max(1e-9, rand(s));
  const v = rand(s);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export function newId(s: GameState) {
  return s.nextId++;
}

// ------------------------------------------------------------ Horloge ----
export function dayOf(t: number) {
  return Math.floor(t / TIME.DAY) + 1;
}
export function hourOf(t: number) {
  return ((t % TIME.DAY) + TIME.DAY) % TIME.DAY / HOUR;
}
export function currentDay(s: GameState) {
  return dayOf(s.clock.t);
}
export function currentHour(s: GameState) {
  return hourOf(s.clock.t);
}
export function isNightHour(h: number) {
  return h >= TIME.NIGHT_START || h < TIME.NIGHT_END;
}
export function isShopOpen(h: number) {
  return h >= TIME.SHOP_OPEN && h < TIME.SHOP_CLOSE;
}
export function fmtClock(t: number) {
  const h = hourOf(t);
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60 / 10) * 10;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ------------------------------------------------------- Évènements ----
// File d'évènements transitoires (non sauvegardés) lue par le rendu, l'UI et le son.
const eventQueues = new WeakMap<GameState, GameEvent[]>();
export function emit(s: GameState, e: GameEvent) {
  let q = eventQueues.get(s);
  if (!q) eventQueues.set(s, (q = []));
  if (q.length < 500) q.push(e);
}
export function drainEvents(s: GameState): GameEvent[] {
  const q = eventQueues.get(s);
  if (!q || q.length === 0) return [];
  eventQueues.set(s, []);
  return q;
}
export function notify(s: GameState, text: string, tone: 'info' | 'good' | 'warn' | 'bad' = 'info', icon?: string, action?: NotifyAction) {
  emit(s, { kind: 'notify', text, tone, icon, action });
}

// -------------------------------------------------------------- Grille ----
// la grille commence en z = GRID_Z0 (négatif : la ferme s'étend au nord de la route)
export const cellIndex = (x: number, z: number) => (z - GRID_Z0) * GRID_W + x;
export const cellX = (i: number) => i % GRID_W;
export const cellZ = (i: number) => ((i / GRID_W) | 0) + GRID_Z0;
export const inGrid = (x: number, z: number) => x >= 0 && z >= GRID_Z0 && x < GRID_W && z < GRID_Z1;
export function parcelKeyOfCell(x: number, z: number) {
  return `${Math.floor(x / WORLD.PARCEL)},${Math.floor((z - GRID_Z0) / WORLD.PARCEL)}`;
}
/** Coin nord-ouest d'une parcelle (coordonnées monde). */
export function parcelOrigin(c: number, r: number): [number, number] {
  return [c * WORLD.PARCEL, GRID_Z0 + r * WORLD.PARCEL];
}
/** Centre d'une parcelle (coordonnées monde). */
export function parcelCenter(c: number, r: number): [number, number] {
  return [c * WORLD.PARCEL + WORLD.PARCEL / 2, GRID_Z0 + r * WORLD.PARCEL + WORLD.PARCEL / 2];
}
export function parcelCoords(key: string): [number, number] {
  const [c, r] = key.split(',').map(Number);
  return [c, r];
}
/** Case de l'entrée de la ferme (portail), toujours réservée. */
export const GATE = { x: 14, z: 29 };

type Placed = Pick<Building, 'type' | 'x' | 'z'> & { level?: number };
export function footprint(b: Placed) {
  const { w, d } = sizeOf(b.type, b.level);
  return { x: b.x, z: b.z, w, d };
}
export function buildingCenter(b: Placed) {
  const { w, d } = sizeOf(b.type, b.level);
  return { x: b.x + w / 2, z: b.z + d / 2 };
}
/** Milieu de la trappe d'un poulailler (x) et pied de sa façade (z). */
export function coopDoor(b: Pick<Building, 'x' | 'z'>) {
  return { x: b.x + BUILDINGS.coop.w / 2, z: b.z + BUILDINGS.coop.d };
}
/** Cases juste devant la trappe d'un poulailler (à garder libres). */
export function coopDoorCells(b: Pick<Building, 'x' | 'z'>): Array<[number, number]> {
  const d = coopDoor(b);
  return [
    [Math.floor(d.x - 0.3), d.z],
    [Math.floor(d.x + 0.3), d.z],
  ];
}
/** Cases d'accès (où les poules se placent pour utiliser le bâtiment). */
export function accessCells(b: Placed): Array<[number, number]> {
  const def = { ...BUILDINGS[b.type], ...sizeOf(b.type, b.level) };
  const out: Array<[number, number]> = [];
  if (def.access === 'front') {
    for (let i = 0; i < def.w; i++) out.push([b.x + i, b.z + def.d]);
  } else if (def.access === 'around') {
    for (let i = 0; i < def.w; i++) {
      out.push([b.x + i, b.z - 1]);
      out.push([b.x + i, b.z + def.d]);
    }
    for (let j = 0; j < def.d; j++) {
      out.push([b.x - 1, b.z + j]);
      out.push([b.x + def.w, b.z + j]);
    }
  }
  return out.filter(([x, z]) => inGrid(x, z));
}

// -------------------------------------------- Caches de navigation ----
interface Runtime {
  dirty: boolean;
  owned: Uint8Array;
  blocked: Uint8Array;
  walk: Uint8Array;
  fields: Map<number, Int16Array>;
  /** Index des bâtiments occupant chaque case (-1 sinon). */
  occupant: Int32Array;
  /** Incrémenté à chaque changement de terrain (pour invalider les trajets). */
  version: number;
  /** Nombre d'arêtes de clôture qui arrêtent une poule (0 : aucun test de clôture). */
  fences: number;
  /** Cases d'où une poule peut quitter la carte sans franchir de clôture. */
  open: Uint8Array;
  /** Distance (en cases) jusqu'à la sortie de la carte, -1 si enclos. */
  exitDist: Int16Array;
  /** Enclos de chaque case (cases reliées sans franchir de clôture ni de bâtiment), -1 si bâtie. */
  area: Int32Array;
}
const runtimes = new WeakMap<GameState, Runtime>();
// accès éclair : la même partie interroge la grille des milliers de fois par pas
let lastState: GameState | null = null;
let lastRt: Runtime | null = null;

export function invalidateLayout(s: GameState) {
  const r = runtimes.get(s);
  if (r) r.dirty = true;
}

export function rt(s: GameState): Runtime {
  if (s === lastState && lastRt && !lastRt.dirty) return lastRt;
  let r = runtimes.get(s);
  if (!r) {
    r = {
      dirty: true,
      owned: new Uint8Array(GRID_W * GRID_H),
      blocked: new Uint8Array(GRID_W * GRID_H),
      walk: new Uint8Array(GRID_W * GRID_H),
      fields: new Map(),
      occupant: new Int32Array(GRID_W * GRID_H),
      version: 0,
      fences: 0,
      open: new Uint8Array(GRID_W * GRID_H),
      exitDist: new Int16Array(GRID_W * GRID_H),
      area: new Int32Array(GRID_W * GRID_H),
    };
    runtimes.set(s, r);
  }
  if (r.dirty) rebuild(s, r);
  lastState = s;
  lastRt = r;
  return r;
}

function rebuild(s: GameState, r: Runtime) {
  r.version++;
  r.owned.fill(0);
  r.blocked.fill(0);
  r.occupant.fill(-1);
  const P = WORLD.PARCEL;
  for (const key of s.parcels) {
    const [c, row] = parcelCoords(key);
    const [x0, z0] = parcelOrigin(c, row);
    for (let z = z0; z < z0 + P; z++)
      for (let x = x0; x < x0 + P; x++) if (inGrid(x, z)) r.owned[cellIndex(x, z)] = 1;
  }
  for (const b of s.buildings) {
    if (b.type === 'stand') continue;
    const f = footprint(b);
    for (let z = f.z; z < f.z + f.d; z++)
      for (let x = f.x; x < f.x + f.w; x++)
        if (inGrid(x, z)) {
          r.blocked[cellIndex(x, z)] = 1;
          r.occupant[cellIndex(x, z)] = b.id;
        }
  }
  // les poules peuvent aller partout hors des bâtiments : seules les clôtures les retiennent
  for (let i = 0; i < r.walk.length; i++) r.walk[i] = r.blocked[i] ? 0 : 1;
  r.fences = 0;
  for (const v of s.fenceH) if (blocksMover(v, 'hen')) r.fences++;
  for (const v of s.fenceV) if (blocksMover(v, 'hen')) r.fences++;
  r.fields.clear();
  r.dirty = false;
  computeExits(s, r);
  computeAreas(s, r);
}

/** Étiquette chaque enclos (remplissage par diffusion depuis chaque case libre non visitée). */
function computeAreas(s: GameState, r: Runtime) {
  r.area.fill(-1);
  const q: number[] = [];
  let label = 0;
  for (let i0 = 0; i0 < r.area.length; i0++) {
    if (r.area[i0] >= 0 || !r.walk[i0]) continue;
    r.area[i0] = label;
    q.length = 0;
    q.push(i0);
    for (let k = 0; k < q.length; k++) {
      const i = q[k];
      const x = cellX(i);
      const z = cellZ(i);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const nz = z + dz;
        if (!inGrid(nx, nz)) continue;
        const ni = cellIndex(nx, nz);
        if (r.area[ni] >= 0 || !r.walk[ni] || blocksMover(edgeBetween(s, x, z, nx, nz), 'hen')) continue;
        r.area[ni] = label;
        q.push(ni);
      }
    }
    label++;
  }
}

/** Les deux points sont-ils dans le même enclos (une poule peut aller de l'un à l'autre) ? */
export function sameArea(s: GameState, x0: number, z0: number, x1: number, z1: number) {
  const a = Math.floor(x0);
  const b = Math.floor(z0);
  const c = Math.floor(x1);
  const d = Math.floor(z1);
  if (!inGrid(a, b) || !inGrid(c, d)) return false;
  const r = rt(s);
  const k = r.area[cellIndex(a, b)];
  return k >= 0 && k === r.area[cellIndex(c, d)];
}

/** Cases ouvertes sur l'extérieur : BFS depuis les bords de la carte sans franchir de clôture. */
function computeExits(s: GameState, r: Runtime) {
  r.exitDist.fill(-1);
  const q: number[] = [];
  for (let z = GRID_Z0; z < GRID_Z1; z++)
    for (let x = 0; x < GRID_W; x++) {
      if (x > 0 && z > GRID_Z0 && x < GRID_W - 1 && z < GRID_Z1 - 1) continue;
      const i = cellIndex(x, z);
      if (r.blocked[i] || exitSide(s, x, z) === null) continue;
      r.exitDist[i] = 0;
      q.push(i);
    }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const x = cellX(i);
    const z = cellZ(i);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (!inGrid(nx, nz)) continue;
      const ni = cellIndex(nx, nz);
      if (r.blocked[ni] || r.exitDist[ni] >= 0 || blocksMover(edgeBetween(s, x, z, nx, nz), 'hen')) continue;
      r.exitDist[ni] = r.exitDist[i] + 1;
      q.push(ni);
    }
  }
  for (let i = 0; i < r.open.length; i++) r.open[i] = r.exitDist[i] >= 0 ? 1 : 0;
}

/** Côté par lequel une case du bord donne sur l'extérieur sans clôture (route en priorité). */
export function exitSide(s: GameState, x: number, z: number): [number, number] | null {
  const sides: Array<[number, number]> = [[0, 1], [-1, 0], [1, 0], [0, -1]];
  for (const [dx, dz] of sides) {
    const nx = x + dx;
    const nz = z + dz;
    if (inGrid(nx, nz)) continue;
    if (!blocksMover(edgeBetween(s, x, z, nx, nz), 'hen')) return [dx, dz];
  }
  return null;
}

// ------------------------------------------------------------- Clôtures ----
/** Qui se déplace : les humains passent les portails ; « free » ignore les clôtures. */
export type Mover = 'hen' | 'fox' | 'foxDig' | 'human' | 'free';
export const hIdx = (x: number, z: number) => (z - GRID_Z0) * GRID_W + x;
export const vIdx = (x: number, z: number) => (z - GRID_Z0) * (GRID_W + 1) + x;

export function blocksMover(v: number, who: Mover) {
  if (!v || v === 4 || who === 'free') return false;
  if (who === 'human') return v !== 3;
  // le grillage retient les poules ; le renard, lui, se faufile dessous
  if (who === 'fox' || who === 'foxDig') return false;
  return true;
}

/** Clôture entre deux cases orthogonalement voisines (y compris vers l'extérieur de la grille). */
export function edgeBetween(s: GameState, x: number, z: number, nx: number, nz: number): number {
  if (nx !== x) {
    const X = Math.max(x, nx);
    if (z < GRID_Z0 || z >= GRID_Z1 || X < 0 || X > GRID_W) return 0;
    return s.fenceV[vIdx(X, z)] ?? 0;
  }
  const Z = Math.max(z, nz);
  if (x < 0 || x >= GRID_W || Z < GRID_Z0 || Z > GRID_Z1) return 0;
  return s.fenceH[hIdx(x, Z)] ?? 0;
}

/** Passage d'une case à une voisine (diagonales comprises) interdit par une clôture ? */
export function stepBlocked(s: GameState, x: number, z: number, nx: number, nz: number, who: Mover) {
  if (who === 'free') return false;
  if (nx === x || nz === z) return blocksMover(edgeBetween(s, x, z, nx, nz), who);
  return (
    blocksMover(edgeBetween(s, x, z, nx, z), who) ||
    blocksMover(edgeBetween(s, x, z, x, nz), who) ||
    blocksMover(edgeBetween(s, nx, z, nx, nz), who) ||
    blocksMover(edgeBetween(s, x, nz, nx, nz), who)
  );
}

/** Un segment franchit-il une clôture ? (parcours exact des cases traversées) */
export function crossesFence(s: GameState, x0: number, z0: number, x1: number, z1: number, who: Mover = 'hen') {
  if (who === 'free' || rt(s).fences === 0) return false;
  return fenceHit(s, x0, z0, x1, z1, (v) => blocksMover(v, who)) !== null;
}

/**
 * Première arête de clôture franchie par un segment et vérifiant `test` : code de l'arête
 * (horizontale : index ≥ 0, verticale : -(index+1)) et point de franchissement.
 */
export function fenceHit(s: GameState, x0: number, z0: number, x1: number, z1: number, test: (v: number) => boolean): { code: number; x: number; z: number } | null {
  let cx = Math.floor(x0);
  let cz = Math.floor(z0);
  const ex = Math.floor(x1);
  const ez = Math.floor(z1);
  if (cx === ex && cz === ez) return null;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const sx = Math.sign(dx);
  const sz = Math.sign(dz);
  let tMaxX = dx !== 0 ? (sx > 0 ? cx + 1 - x0 : x0 - cx) / Math.abs(dx) : Infinity;
  let tMaxZ = dz !== 0 ? (sz > 0 ? cz + 1 - z0 : z0 - cz) / Math.abs(dz) : Infinity;
  const tdx = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
  const tdz = dz !== 0 ? 1 / Math.abs(dz) : Infinity;
  const vCode = (x: number, z: number) => (z < GRID_Z0 || z >= GRID_Z1 || x < 0 || x > GRID_W ? null : -(vIdx(x, z) + 1));
  const hCode = (x: number, z: number) => (x < 0 || x >= GRID_W || z < GRID_Z0 || z > GRID_Z1 ? null : hIdx(x, z));
  const valueOf = (code: number) => (code >= 0 ? s.fenceH[code] : s.fenceV[-code - 1]) ?? 0;
  const at = (t: number) => ({ x: x0 + dx * t, z: z0 + dz * t });
  for (let guard = 0; (cx !== ex || cz !== ez) && guard < 400; guard++) {
    const xFirst = tMaxX <= tMaxZ;
    if (xFirst) {
      const code = vCode(Math.max(cx, cx + sx), cz);
      if (code !== null && test(valueOf(code))) return { code, ...at(tMaxX) };
    }
    if (tMaxZ <= tMaxX) {
      const code = hCode(cx, Math.max(cz, cz + sz));
      if (code !== null && test(valueOf(code))) return { code, ...at(tMaxZ) };
    }
    if (Math.abs(tMaxX - tMaxZ) < 1e-9) {
      // coin exact : on vérifie aussi les deux arêtes de l'autre côté
      const c1 = hCode(cx + sx, Math.max(cz, cz + sz));
      const c2 = vCode(Math.max(cx, cx + sx), cz + sz);
      if (c1 !== null && test(valueOf(c1))) return { code: c1, ...at(tMaxX) };
      if (c2 !== null && test(valueOf(c2))) return { code: c2, ...at(tMaxX) };
      cx += sx;
      cz += sz;
      tMaxX += tdx;
      tMaxZ += tdz;
    } else if (xFirst) {
      cx += sx;
      tMaxX += tdx;
    } else {
      cz += sz;
      tMaxZ += tdz;
    }
  }
  return null;
}

/** Valeur d'une arête codée (voir fenceHit) et modification. */
export function fenceValue(s: GameState, code: number) {
  return (code >= 0 ? s.fenceH[code] : s.fenceV[-code - 1]) ?? 0;
}
export function setFence(s: GameState, code: number, v: number) {
  if (code >= 0) s.fenceH[code] = v;
  else s.fenceV[-code - 1] = v;
}

/** Trop près d'une clôture pour s'y tenir (une poule ne se colle pas au grillage). */
function nearFence(s: GameState, x: number, z: number, r: number) {
  if (rt(s).fences === 0) return false;
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  const fx = x - cx;
  const fz = z - cz;
  return (
    (fx < r && blocksMover(edgeBetween(s, cx, cz, cx - 1, cz), 'hen')) ||
    (1 - fx < r && blocksMover(edgeBetween(s, cx, cz, cx + 1, cz), 'hen')) ||
    (fz < r && blocksMover(edgeBetween(s, cx, cz, cx, cz - 1), 'hen')) ||
    (1 - fz < r && blocksMover(edgeBetween(s, cx, cz, cx, cz + 1), 'hen'))
  );
}

export function isWalkable(s: GameState, x: number, z: number) {
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (!inGrid(cx, cz)) return false;
  return rt(s).walk[cellIndex(cx, cz)] === 1;
}
export function isOwnedCell(s: GameState, x: number, z: number) {
  if (!inGrid(x, z)) return false;
  return rt(s).owned[cellIndex(x, z)] === 1;
}

const NB = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
] as const;

/** Champ de distances (BFS) vers les cases d'accès d'un bâtiment. -1 = inaccessible. */
export function flowField(s: GameState, b: Building): Int16Array {
  const r = rt(s);
  let f = r.fields.get(b.id);
  if (f) return f;
  f = new Int16Array(GRID_W * GRID_H).fill(-1);
  const queue: number[] = [];
  for (const [x, z] of accessCells(b)) {
    const i = cellIndex(x, z);
    if (r.walk[i] && f[i] < 0) {
      f[i] = 0;
      queue.push(i);
    }
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    const x = cellX(i);
    const z = cellZ(i);
    for (const [dx, dz] of NB) {
      const nx = x + dx;
      const nz = z + dz;
      if (!inGrid(nx, nz)) continue;
      const ni = cellIndex(nx, nz);
      if (!r.walk[ni] || f[ni] >= 0) continue;
      if (dx !== 0 && dz !== 0) {
        // pas de coupe de coin à travers un obstacle
        if (!r.walk[cellIndex(x + dx, z)] || !r.walk[cellIndex(x, z + dz)]) continue;
      }
      if (r.fences && stepBlocked(s, x, z, nx, nz, 'hen')) continue;
      f[ni] = f[i] + 1;
      queue.push(ni);
    }
  }
  r.fields.set(b.id, f);
  return f;
}

/** Prochaine case vers laquelle se diriger pour rejoindre un bâtiment. */
export function nextStep(s: GameState, b: Building, x: number, z: number): [number, number] | null {
  const f = flowField(s, b);
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (!inGrid(cx, cz)) return null;
  const here = f[cellIndex(cx, cz)];
  if (here === 0) return [cx, cz];
  const r = rt(s);
  let best = here < 0 ? 32767 : here;
  let bx = -1;
  let bz = -1;
  for (const [dx, dz] of NB) {
    const nx = cx + dx;
    const nz = cz + dz;
    if (!inGrid(nx, nz)) continue;
    const v = f[cellIndex(nx, nz)];
    if (v < 0) continue;
    if (dx !== 0 && dz !== 0) {
      if (!r.walk[cellIndex(cx + dx, cz)] || !r.walk[cellIndex(cx, cz + dz)]) continue;
    }
    if (v < best) {
      best = v;
      bx = nx;
      bz = nz;
    }
  }
  return bx < 0 ? null : [bx, bz];
}

export function distanceTo(s: GameState, b: Building, x: number, z: number) {
  const f = flowField(s, b);
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  if (!inGrid(cx, cz)) return -1;
  return f[cellIndex(cx, cz)];
}

/** Vérifie qu'un segment ne traverse que des cases praticables. */
export function lineWalkable(s: GameState, x0: number, z0: number, x1: number, z1: number) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / 0.3));
  for (let i = 1; i <= n; i++) {
    if (!isWalkable(s, x0 + (dx * i) / n, z0 + (dz * i) / n)) return false;
  }
  return true;
}

/** Case praticable la plus proche (pour replacer une poule délogée). */
export function nearestWalkable(s: GameState, x: number, z: number): [number, number] | null {
  const r = rt(s);
  const cx = Math.floor(x);
  const cz = Math.floor(z);
  for (let rad = 0; rad < Math.max(GRID_W, GRID_H); rad++) {
    for (let dz = -rad; dz <= rad; dz++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rad) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (inGrid(nx, nz) && r.walk[cellIndex(nx, nz)]) return [nx + 0.5, nz + 0.5];
      }
  }
  return null;
}

/** Une poule (rayon r) tient-elle debout ici sans toucher d'obstacle ? */
export function canStand(s: GameState, x: number, z: number, r = 0.14) {
  return (
    isWalkable(s, x, z) &&
    isWalkable(s, x + r, z) &&
    isWalkable(s, x - r, z) &&
    isWalkable(s, x, z + r) &&
    isWalkable(s, x, z - r) &&
    !nearFence(s, x, z, r * 0.8)
  );
}

/** Trajet rectiligne praticable en gardant une distance de sécurité r. */
export function lineClear(s: GameState, x0: number, z0: number, x1: number, z1: number, r = 0.14, who: Mover = 'hen') {
  if (crossesFence(s, x0, z0, x1, z1, who)) return false;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  const n = Math.max(1, Math.ceil(len / 0.22));
  for (let i = 1; i <= n; i++) if (!canStand(s, x0 + (dx * i) / n, z0 + (dz * i) / n, r)) return false;
  return true;
}

/** Chemin dans la ferme (BFS sur la grille, lissé en lignes droites). */
export function planPath(s: GameState, fx: number, fz: number, tx: number, tz: number, radius = 0.16, who: Mover = 'hen'): number[] | null {
  if (lineClear(s, fx, fz, tx, tz, radius, who)) return [tx, tz];
  const fenced = rt(s).fences > 0 && who !== 'free';
  const r = rt(s);
  const toCell = (x: number, z: number) => {
    // un point hors de la grille (route, chemin de la maison) part de la case du bord la plus proche
    const cx = Math.max(0, Math.min(GRID_W - 1, Math.floor(x)));
    const cz = Math.max(GRID_Z0, Math.min(GRID_Z1 - 1, Math.floor(z)));
    if (inGrid(cx, cz) && r.walk[cellIndex(cx, cz)]) return cellIndex(cx, cz);
    let best = -1;
    let bd = Infinity;
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (!inGrid(nx, nz) || !r.walk[cellIndex(nx, nz)]) continue;
        const d = Math.hypot(nx + 0.5 - x, nz + 0.5 - z);
        if (d < bd) {
          bd = d;
          best = cellIndex(nx, nz);
        }
      }
    return best;
  };
  const start = toCell(fx, fz);
  const goal = toCell(tx, tz);
  if (start < 0 || goal < 0) return null;
  const parent = new Int32Array(GRID_W * GRID_H).fill(-2);
  parent[goal] = -1;
  const q = [goal];
  let found = start === goal;
  for (let qi = 0; qi < q.length && !found; qi++) {
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
        if (!r.walk[ni] || parent[ni] !== -2) continue;
        if (dx && dz && (!r.walk[cellIndex(x + dx, z)] || !r.walk[cellIndex(x, z + dz)])) continue;
        if (fenced && stepBlocked(s, x, z, nx, nz, who)) continue;
        parent[ni] = i;
        if (ni === start) found = true;
        q.push(ni);
      }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = start; c >= 0; c = parent[c]) cells.push(c);
  return smoothPath(cells, fx, fz, tx, tz, (x0, z0, x1, z1) => lineClear(s, x0, z0, x1, z1, radius, who));
}

/**
 * Lissage d'un chemin de cases : depuis le point courant, on avance tant que la case suivante
 * reste visible (avec un petit regard au-delà d'un obstacle ponctuel). Coût linéaire en longueur,
 * contrairement à une recherche du point visible le plus lointain depuis la fin du chemin.
 */
export function smoothPath(cells: number[], fx: number, fz: number, tx: number, tz: number, clear: (x0: number, z0: number, x1: number, z1: number) => boolean) {
  const out: number[] = [];
  const cxOf = (c: number) => cellX(c) + 0.5;
  const czOf = (c: number) => cellZ(c) + 0.5;
  let px = fx;
  let pz = fz;
  let i = 0;
  while (i < cells.length) {
    let best = i;
    for (let k = i + 1; k < cells.length && k - best <= 3; k++) if (clear(px, pz, cxOf(cells[k]), czOf(cells[k]))) best = k;
    px = cxOf(cells[best]);
    pz = czOf(cells[best]);
    out.push(px, pz);
    i = best + 1;
  }
  out.push(tx, tz);
  return out;
}

