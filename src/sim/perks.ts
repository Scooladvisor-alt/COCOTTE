// Effets des aménagements sur les poules d'une parcelle : bains de poussière (parasites),
// mares (fraîcheur, eau gratuite), arbres d'ombrage (ombre, abri contre les buses). Le compost,
// lui, agit sur chaque poule qui s'y régale (voir COMPOST et protéines).
import { NATURE } from '../config/balance';
import { buildingCenter, parcelKeyOfCell } from './core';
import { lvl } from './queries';
import { seasonIndex } from './seasons';
import type { GameState } from './types';

export interface Perks {
  /** Bonus de bien-être (bains, mare, arbres). */
  wellbeing: number;
  /** Multiplicateur des risques de maladie (1 : aucun effet). */
  sick: number;
  /** Multiplicateur de la soif (1 : aucun effet). */
  thirst: number;
  dust: number;
  pond: number;
  shade: number;
  trees: number;
}
const NONE: Perks = { wellbeing: 0, sick: 1, thirst: 1, dust: 0, pond: 0, shade: 0, trees: 0 };

interface Cache {
  sig: string;
  map: Map<string, Perks>;
  trees: Array<[number, number]>;
}
const caches = new WeakMap<GameState, Cache>();

function cache(s: GameState): Cache {
  const parts: string[] = [];
  for (const b of s.buildings) if (b.type === 'dustbath' || b.type === 'pond' || b.type === 'tree') parts.push(`${b.type}${b.level}@${b.x},${b.z}`);
  const sig = `${seasonIndex(s)}|${parts.join(';')}`;
  let c = caches.get(s);
  if (c && c.sig === sig) return c;
  const map = new Map<string, Perks>();
  const trees: Array<[number, number]> = [];
  const get = (key: string) => {
    let p = map.get(key);
    if (!p) map.set(key, (p = { ...NONE }));
    return p;
  };
  const summer = seasonIndex(s) === 1;
  for (const b of s.buildings) {
    if (b.type !== 'dustbath' && b.type !== 'pond' && b.type !== 'tree') continue;
    const ctr = buildingCenter(b);
    const p = get(parcelKeyOfCell(Math.floor(ctr.x), Math.floor(ctr.z)));
    const w = lvl(b).wellbeing ?? 0;
    if (b.type === 'dustbath') {
      p.dust = Math.max(p.dust, w);
      p.sick = Math.min(p.sick, NATURE.dustSick[b.level] ?? 1);
    } else if (b.type === 'pond') {
      if (w > p.pond) {
        p.pond = w;
        p.thirst = 1 - (NATURE.pondThirst[b.level] ?? 0);
      }
    } else {
      p.trees++;
      trees.push([ctr.x, ctr.z]);
    }
  }
  for (const p of map.values()) {
    p.shade = Math.min(NATURE.shadeMax, p.trees * 4);
    const treeThirst = Math.min(NATURE.treeThirstMax, p.trees * NATURE.treeThirst * (summer ? 1.6 : 1));
    p.thirst *= 1 - treeThirst;
    p.wellbeing = p.dust + p.pond + p.shade;
  }
  c = { sig, map, trees };
  caches.set(s, c);
  return c;
}

/** Effets sur une parcelle (clé « colonne,rangée »). */
export function parcelPerks(s: GameState, key: string): Perks {
  return cache(s).map.get(key) ?? NONE;
}
/** Effets à l'endroit d'une poule. */
export function perksAt(s: GameState, x: number, z: number): Perks {
  return parcelPerks(s, parcelKeyOfCell(Math.floor(x), Math.floor(z)));
}
/** Arbre d'ombrage le plus proche (pour se réfugier dessous quand une buse rôde). */
export function nearestTree(s: GameState, x: number, z: number, maxD: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = maxD;
  for (const t of cache(s).trees) {
    const d = Math.hypot(t[0] - x, t[1] - z);
    if (d < bd) {
      bd = d;
      best = t;
    }
  }
  return best;
}

/** Une poule réfugiée sous un arbre : une buse ne peut pas l'attraper. */
export function shelteredByTree(s: GameState, x: number, z: number) {
  const r2 = NATURE.shelterRadius * NATURE.shelterRadius;
  return cache(s).trees.some(([tx, tz]) => (tx - x) * (tx - x) + (tz - z) * (tz - z) < r2);
}
