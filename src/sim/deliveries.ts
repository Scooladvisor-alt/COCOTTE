// Livraisons de poules par le camion du couvoir. Plusieurs lots commandés ensemble arrivent en
// convoi (jusqu'à trois camions garés l'un derrière l'autre le long du trottoir). Les poules
// sautent du hayon une à une, trottinent sur le trottoir jusqu'au portail et entrent dans la
// ferme à la file. Tout l'horaire se lit sur le temps simulé : la simulation fait apparaître
// chaque poule au portail à l'instant où le rendu la montre arriver (render/delivery.ts).
import { DELIVERY, WORLD } from '../config/balance';
import { GATE } from './core';
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
