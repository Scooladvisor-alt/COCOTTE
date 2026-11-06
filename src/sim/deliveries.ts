// Livraisons de poules par le camion du couvoir. Plusieurs lots commandés ensemble arrivent en
// convoi (jusqu'à trois camions garés l'un derrière l'autre le long du trottoir). Les poules
// sautent du hayon une à une, trottinent sur le trottoir jusqu'au portail et entrent dans la
// ferme à la file. Tout l'horaire se lit sur le temps simulé : la simulation fait apparaître
// chaque poule au portail à l'instant où le rendu la montre arriver (render/delivery.ts).
import { BIRD_ORDERS, DELIVERY, TRUCK_BAY, TRUCK_COURT, WORLD } from '../config/balance';
import { FIRST_HATCH_X, penHatch } from '../config/buildings';
import { GATE, cellIndex, planPath, rt } from './core';
import type { Delivery, GameState } from './types';

/** Voie côté ferme (on roule à droite : vers l'ouest). */
export const TRUCK_LANE = WORLD.ROAD_Z - WORLD.ROAD_HALF / 2;

/** Arrêt du camion n° slot : le premier face au portail, les suivants derrière lui (à l'est, après le passage piéton). */
export const truckStopX = (slot: number) => GATE.x + 0.5 + DELIVERY.stops[Math.min(slot, DELIVERY.stops.length - 1)];

/** Où la poule entre dans la ferme (juste derrière le portail). */
export const GATE_IN: [number, number] = [GATE.x + 0.5, GATE.z + 0.6];

/** Trajet d'une poule : du hayon au trottoir, le long du trottoir jusqu'au portail, puis dedans. */
export function hopPath(slot: number): Array<[number, number]> {
  const tail = truckStopX(slot) + DELIVERY.tail;
  return [
    [tail, TRUCK_LANE],
    [tail, WORLD.WALK_Z],
    [GATE_IN[0], WORLD.WALK_Z],
    GATE_IN,
  ];
}

export function pathLength(p: Array<[number, number]>) {
  let l = 0;
  for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return l;
}

// ------------------------------------------------------- Le camion du revendeur ----
/** Ligne du camion garé, arrière de la caisse et pied de sa rampe (côté portail). */
export const TRUCK_Z = BIRD_ORDERS.yardZ;
export const TRUCK_REAR = BIRD_ORDERS.rearX;
export const RAMP_FOOT = TRUCK_REAR + 1.1;
/** Un bâtiment (d'une ancienne partie) gêne-t-il l'entrée du camion ? */
export function truckBlockedBy(s: GameState) {
  const r = rt(s);
  for (const A of [TRUCK_BAY, TRUCK_COURT])
    for (let z = A.z0; z <= A.z1; z++)
      for (let x = A.x0; x <= A.x1; x++) {
        const id = r.occupant[cellIndex(x, z)];
        if (id >= 0) return id;
      }
  // ... ou la sortie d'une trappe des parcs
  const shop = s.buildings.find((b) => b.type === 'petshop');
  if (shop)
    for (const goose of [false, true])
      for (const z of [28, 29]) {
        const id = r.occupant[cellIndex(Math.floor(penHatch(shop.level, goose).hatch), z)];
        if (id >= 0) return id;
      }
  return -1;
}
/** Le milieu du passage entre les deux grillages (couloir ou sas de la trappe). */
const LANE_Z = 30.52;
/** Juste derrière la trappe, puis le coin de la cour d'où l'on rejoint la rampe sans frôler le camion. */
const INSIDE_Z = 29.4;
const COURT: [number, number] = [78.5, 26.4];
const BOARD_SPEED = 1.8;
/** Où donne le couloir d'un parc : tout droit si le parc longe la parcelle, sinon à la première trappe. */
const hatchOf = (x: number) => Math.max(x, FIRST_HATCH_X);
/**
 * Trajet d'une volaille depuis la trappe de son parc : le passage entre les deux grillages, la trappe de la
 * parcelle, la cour, puis la rampe. Elle ne sort jamais à découvert.
 */
export function boardPath(x: number, z: number): Array<[number, number]> {
  const hx = hatchOf(x);
  return [[x, z], [x, LANE_Z], ...(hx !== x ? [[hx, LANE_Z] as [number, number]] : []), [hx, INSIDE_Z], COURT, [RAMP_FOOT, TRUCK_Z], [TRUCK_REAR, TRUCK_Z], [TRUCK_REAR - 0.5, TRUCK_Z]];
}
/** Le même trajet, qui contourne ce qui encombre la parcelle (bâtiments, arbres, camion). */
export function boardRoute(s: GameState, x: number, z: number): Array<[number, number]> {
  const base = boardPath(x, z);
  const hx = hatchOf(x);
  const way = planPath(s, hx, INSIDE_Z, COURT[0], COURT[1], 0.16, 'human');
  if (!way || way.length <= 2) return base;
  const i = base.indexOf(COURT);
  const detour: Array<[number, number]> = [];
  for (let k = 0; k + 1 < way.length - 2; k += 2) detour.push([way[k], way[k + 1]]);
  return [...base.slice(0, i), ...detour, ...base.slice(i)];
}
export const routeTime = (route: Array<[number, number]>) => pathLength(route) / BOARD_SPEED;
/** Quand la volaille a passé la trappe de la parcelle (secondes après son départ). */
export const hatchTime = (x: number) => (Math.abs(hatchOf(x) - x) + 2.2) / BOARD_SPEED;
/** Hauteur de la volaille sur la rampe, à la fraction k de son trajet (0 au sol, 1 dans le camion). */
export function rampProgress(route: Array<[number, number]>, k: number) {
  const total = pathLength(route);
  const up = RAMP_FOOT - TRUCK_REAR;
  return Math.max(0, Math.min(1, (k * total - (total - up - 0.5)) / up));
}

/** Point du trajet à la fraction k (0 → 1) et direction de marche. */
export function alongPath(p: Array<[number, number]>, k: number): { x: number; z: number; dx: number; dz: number } {
  let rest = Math.max(0, Math.min(1, k)) * pathLength(p);
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1];
    const [bx, bz] = p[i];
    const seg = Math.hypot(bx - ax, bz - az);
    if (rest <= seg || i === p.length - 1) {
      const u = seg > 0 ? Math.min(1, rest / seg) : 1;
      return { x: ax + (bx - ax) * u, z: az + (bz - az) * u, dx: (bx - ax) / (seg || 1), dz: (bz - az) / (seg || 1) };
    }
    rest -= seg;
  }
  const [x, z] = p[p.length - 1];
  return { x, z, dx: 0, dz: -1 };
}

/** Durée du trajet d'une poule depuis le camion n° slot. */
export const hopTime = (slot: number) => pathLength(hopPath(slot)) / DELIVERY.henSpeed;
/** Instant où la i-ème poule saute du camion. */
export const jumpAt = (d: Delivery, i: number) => d.eta + DELIVERY.firstJump + i * DELIVERY.henGap;
/** Instant où elle passe le portail (la simulation la crée alors). */
export const arriveAt = (d: Delivery, i: number) => jumpAt(d, i) + hopTime(d.slot ?? 0);
/** Hayon refermé après la dernière poule. */
export const unloadEnd = (d: Delivery) => jumpAt(d, d.count - 1) + DELIVERY.closeUp;
/** Départ du camion (le convoi repart ensemble, le camion de tête d'abord). */
export const leaveAt = (d: Delivery) => d.leave ?? unloadEnd(d);

/**
 * Place un nouveau camion : il rejoint le convoi en préparation s'il reste une place et qu'il
 * n'est pas encore arrivé ; sinon un nouveau convoi part après le précédent.
 */
export function scheduleTruck(s: GameState): Pick<Delivery, 'eta' | 'slot' | 'wave'> {
  const t = s.clock.t;
  const lastWave = s.deliveries.reduce((a, d) => Math.max(a, d.wave ?? 0), 0);
  const wave = s.deliveries.filter((d) => (d.wave ?? 0) === lastWave);
  const head = wave.find((d) => (d.slot ?? 0) === 0);
  if (head && wave.length < DELIVERY.slots && head.eta - t > DELIVERY.joinMargin) {
    const slot = wave.length;
    return { eta: head.eta + slot * DELIVERY.convoyGap, slot, wave: lastWave };
  }
  // le convoi précédent doit être reparti (et hors de vue) avant que le suivant se gare
  const gone = s.deliveries.reduce((a, d) => Math.max(a, leaveAt(d) + DELIVERY.drive + 1), 0);
  return { eta: Math.max(t + DELIVERY.delay, gone + DELIVERY.drive), slot: 0, wave: lastWave + 1 };
}

/** Le convoi repart quand tous ses camions sont vidés : le camion de tête d'abord. */
export function syncWaveLeave(s: GameState, wave: number) {
  const members = s.deliveries.filter((d) => (d.wave ?? 0) === wave);
  const end = members.reduce((a, d) => Math.max(a, unloadEnd(d)), 0);
  for (const d of members) d.leave = end + (d.slot ?? 0) * DELIVERY.convoyGap;
}
