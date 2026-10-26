// Où se tient une poule pour manger ou boire, et où plonge son bec. Chaque mangeoire, abreuvoir
// ou mare a ses places, calées sur son modèle 3D (render/models.ts) : la poule entre jusqu'au
// bord, le bec pique vraiment dans le grain ou trempe dans l'eau, sans mimer à côté.
import type { Building } from './types';

/**
 * Posture de la poule selon la hauteur de la nourriture (le rendu en tire l'inclinaison du corps
 * et du cou) et distance du bec devant ses pattes dans cette posture.
 */
export type FeedPose = 'mid' | 'low';
export const FEED_REACH: Record<FeedPose, number> = { mid: 0.285, low: 0.24 };

export interface FeedSpot {
  /** Place des pattes. */
  x: number;
  z: number;
  /** Point visé par le bec. */
  fx: number;
  fz: number;
}

/** Places réparties en cercle (rayon du bec rFood ; les pattes se tiennent plus loin, selon la posture). */
function ring(cx: number, cz: number, n: number, rFood: number, pose: FeedPose, a0 = 0.35, sz = 1, skip?: (a: number) => boolean): FeedSpot[] {
  const out: FeedSpot[] = [];
  const rHen = rFood + FEED_REACH[pose];
  for (let i = 0; out.length < n && i < n * 2; i++) {
    const a = a0 + (i * Math.PI * 2) / (skip ? n + 1 : n);
    if (skip?.(a)) continue;
    out.push({ x: cx + Math.sin(a) * rHen, z: cz + Math.cos(a) * rHen * sz, fx: cx + Math.sin(a) * rFood, fz: cz + Math.cos(a) * rFood * sz });
  }
  return out;
}

/** Places le long d'une auge allongée selon x (des deux côtés). */
function trough(xs: number[], side: 1 | -1, cz: number, half: number, pose: FeedPose): FeedSpot[] {
  return xs.map((x) => ({ x, z: cz + side * (half + FEED_REACH[pose]), fx: x, fz: cz + side * half }));
}

export function feedPose(b: Pick<Building, 'type' | 'level'>): FeedPose {
  // l'auge en planches et l'abreuvoir en long sont à hauteur de poitrine ; le reste est au ras du sol
  return (b.type === 'feeder' && b.level === 1) || (b.type === 'drinker' && b.level === 3) ? 'mid' : 'low';
}

/** Places (relatives au coin du bâtiment) ; vide si le bâtiment ne se mange ni ne se boit. */
export function feedLayout(b: Pick<Building, 'type' | 'level'>): FeedSpot[] {
  const pose = feedPose(b);
  if (b.type === 'feeder') {
    // auge sur tréteaux (z 0,37 → 0,63) ; trémie sur assiette ; couronne au pied du silo
    if (b.level === 1) return [...trough([0.3, 0.7], 1, 0.5, 0.07, pose), ...trough([0.5], -1, 0.5, 0.07, pose)];
    if (b.level === 2) return ring(0.5, 0.5, 5, 0.29, pose);
    return ring(0.5, 0.5, 8, 0.36, pose, 0.2);
  }
  if (b.type === 'drinker') {
    // bassine basse ; coupelle à niveau constant ; longue auge à niveau constant (x -0,15 → 1,15)
    if (b.level === 1) return ring(0.5, 0.5, 3, 0.17, pose);
    if (b.level === 2) return ring(0.5, 0.5, 5, 0.29, pose);
    return [...trough([0.04, 0.35, 0.66, 0.97], 1, 0.5, 0.07, pose), ...trough([0.04, 0.35, 0.66, 0.97], -1, 0.5, 0.07, pose)];
  }
  if (b.type === 'pond') {
    // sur la berge, le bec juste au-dessus de l'eau (on évite le ponton de la grande mare)
    if (b.level >= 2) return ring(1.5, 1.5, 9, 1.26, pose, 0.0, 1.22 / 1.26, (a) => Math.abs(a - 1.05) < 0.3);
    return ring(1.5, 1.5, 6, 1.18, pose, 0.0, 1.12 / 1.18);
  }
  return [];
}
