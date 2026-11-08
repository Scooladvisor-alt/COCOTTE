// Effets des aménagements sur les poules d'une parcelle : bains de poussière (parasites),
// mares (fraîcheur, eau gratuite), arbres d'ombrage et petit bois (ombre, abri contre les buses),
// fontaine, massifs de fleurs et jardin fleuri (bien-être). Le compost et la prairie aux insectes,
// eux, agissent sur chaque poule qui s'y régale (voir COMPOST et protéines) ; l'épouvantail tient
// les buses à distance ; fontaine et jardin fleuri font monter la réputation.
import { NATURE } from '../config/balance';
import { FOREST_TRUNKS } from '../config/buildings';
import { buildingCenter, parcelKeyOfCell, rt } from './core';
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
  /** Bien-être apporté par la décoration (fontaine, massifs, jardin, sous-bois). */
  deco: number;
}
const NONE: Perks = { wellbeing: 0, sick: 1, thirst: 1, dust: 0, pond: 0, shade: 0, trees: 0, deco: 0 };

interface Cache {
  version: number;
  season: number;
  map: Map<string, Perks>;
  trees: Array<[number, number]>;
  scarecrows: Array<[number, number]>;
  /** Réputation gagnée chaque jour grâce à la fontaine et aux jardins fleuris. */
  prestige: number;
}
const caches = new WeakMap<GameState, Cache>();

function cache(s: GameState): Cache {
  // (recalculé seulement quand la ferme ou la saison change : il peut y avoir des centaines d'arbres)
  const version = rt(s).version;
  const season = seasonIndex(s);
  let c = caches.get(s);
  if (c && c.version === version && c.season === season) return c;
  const map = new Map<string, Perks>();
  const trees: Array<[number, number]> = [];
  const scarecrows: Array<[number, number]> = [];
  let prestige = 0;
  const flowerbeds = new Map<string, number>();
  const get = (key: string) => {
    let p = map.get(key);
    if (!p) map.set(key, (p = { ...NONE }));
    return p;
  };
  const summer = season === 1;
  for (const b of s.buildings) {
    if (b.type === 'scarecrow') {
      const c = buildingCenter(b);
      scarecrows.push([c.x, c.z]);
      continue;
    }
    if (b.type !== 'dustbath' && b.type !== 'pond' && b.type !== 'tree' && b.type !== 'fountain' && b.type !== 'flowerbed' && b.type !== 'garden' && b.type !== 'forest') continue;
    const ctr = buildingCenter(b);
    const key = parcelKeyOfCell(Math.floor(ctr.x), Math.floor(ctr.z));
    const p = get(key);
    const w = lvl(b).wellbeing ?? 0;
    if (b.type === 'fountain') {
      p.deco += w;
      p.thirst *= 1 - NATURE.fountainThirst;
      prestige += NATURE.fountainPrestige;
    } else if (b.type === 'flowerbed') {
      // (trois massifs au plus comptent sur une parcelle)
      const n = (flowerbeds.get(key) ?? 0) + 1;
      flowerbeds.set(key, n);
      if (n <= NATURE.flowerbedMax) p.deco += w;
    } else if (b.type === 'garden') {
      p.deco += w;
      prestige += NATURE.gardenPrestige;
    } else if (b.type === 'forest') {
      // quatre grands arbres : leur ombre et leur abri, plus le calme du sous-bois
      p.deco += w;
      for (const [i, j] of FOREST_TRUNKS) {
        p.trees++;
        trees.push([b.x + i + 0.5, b.z + j + 0.5]);
      }
    } else if (b.type === 'dustbath') {
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
    p.deco = Math.min(NATURE.decoMax, p.deco);
    p.wellbeing = p.dust + p.pond + p.shade + p.deco;
  }
  c = { version, season, map, trees, scarecrows, prestige: Math.min(NATURE.prestigeMax, prestige) };
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

/** Une poule réfugiée sous un arbre (ou près d'un épouvantail) : une buse ne peut pas l'attraper. */
export function shelteredByTree(s: GameState, x: number, z: number) {
  const c = cache(s);
  const r2 = NATURE.shelterRadius * NATURE.shelterRadius;
  const s2 = NATURE.scarecrowRadius * NATURE.scarecrowRadius;
  return c.trees.some(([tx, tz]) => (tx - x) * (tx - x) + (tz - z) * (tz - z) < r2) || c.scarecrows.some(([tx, tz]) => (tx - x) * (tx - x) + (tz - z) * (tz - z) < s2);
}

/** Réputation gagnée chaque jour grâce à la décoration (fontaine, jardins fleuris), plafonnée. */
export const decoPrestige = (s: GameState) => cache(s).prestige;
