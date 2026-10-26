// Saisons : une année de 28 jours (4 saisons de 7 jours). Elles rythment la ferme : le printemps
// fait pondre et pousser l'herbe, l'été assoiffe, l'automne ralentit, l'hiver gèle l'herbe et
// réduit la ponte… mais les œufs se vendent plus cher. Il faut anticiper (grain, eau, stock).
import { TIME } from '../config/balance';
import { currentDay } from './core';
import type { GameState } from './types';

export interface SeasonDef {
  id: 'printemps' | 'ete' | 'automne' | 'hiver';
  name: string;
  icon: string;
  /** Multiplicateurs appliqués à la ferme. */
  laying: number;
  grass: number;
  thirst: number;
  appetite: number;
  /** Prix de référence des œufs (ce que les clients acceptent de payer). */
  price: number;
  /** Ce qui change, en une phrase (annonce du changement de saison). */
  intro: string;
}

export const SEASON_DAYS = 7;
export const YEAR_DAYS = SEASON_DAYS * 4;

export const SEASONS: SeasonDef[] = [
  {
    id: 'printemps',
    name: 'Printemps',
    icon: '🌸',
    laying: 1.15,
    grass: 1.35,
    thirst: 1,
    appetite: 1,
    price: 0.95,
    intro: 'Le printemps est là : les poules pondent davantage et l’herbe repousse vite.',
  },
  {
    id: 'ete',
    name: 'Été',
    icon: '☀️',
    laying: 1.05,
    grass: 0.7,
    thirst: 1.35,
    appetite: 0.95,
    price: 1,
    intro: 'L’été commence : il fait chaud, les poules boivent beaucoup plus et l’herbe sèche.',
  },
  {
    id: 'automne',
    name: 'Automne',
    icon: '🍂',
    laying: 0.95,
    grass: 0.95,
    thirst: 1,
    appetite: 1.05,
    price: 1.05,
    intro: 'L’automne arrive : la ponte ralentit un peu, les œufs se vendent mieux.',
  },
  {
    id: 'hiver',
    name: 'Hiver',
    icon: '❄️',
    laying: 0.8,
    grass: 0.2,
    thirst: 0.9,
    appetite: 1.18,
    price: 1.18,
    intro: 'L’hiver s’installe : l’herbe ne repousse presque plus, les poules mangent plus de grain et pondent moins. Les œufs se vendent cher !',
  },
];

/** Année (1, 2…) et saison d'un jour donné. */
export function seasonIndexOfDay(day: number) {
  return Math.floor((Math.max(1, day) - 1) / SEASON_DAYS) % 4;
}
export const seasonIndex = (s: GameState) => seasonIndexOfDay(currentDay(s));
export const season = (s: GameState) => SEASONS[seasonIndex(s)];
export const yearOf = (s: GameState) => Math.floor((currentDay(s) - 1) / YEAR_DAYS) + 1;
/** Jour dans la saison (1 à 7). */
export const seasonDay = (s: GameState) => ((currentDay(s) - 1) % SEASON_DAYS) + 1;

/**
 * Pour le rendu : saison actuelle, saison suivante et avancement du fondu entre les deux
 * (la nature change doucement pendant le dernier jour de la saison).
 */
export function seasonBlend(s: GameState) {
  const a = seasonIndex(s);
  const dayFrac = (s.clock.t % TIME.DAY) / TIME.DAY;
  const k = seasonDay(s) === SEASON_DAYS ? dayFrac : 0;
  return { a, b: (a + 1) % 4, k };
}

/**
 * Facteur de prix des œufs selon la saison, fondu sur les cinq derniers jours de chaque saison
 * (le marché glisse d'une saison à l'autre au lieu de sauter du jour au lendemain).
 */
export function seasonalPrice(s: GameState) {
  const a = seasonIndex(s);
  const d = seasonDay(s);
  const frac = (s.clock.t % TIME.DAY) / TIME.DAY;
  const k = Math.min(1, Math.max(0, (d - 1 + frac - (SEASON_DAYS - 5)) / 5));
  const t = 0.5 * k + 0.5 * k * k * (3 - 2 * k);
  return SEASONS[a].price + (SEASONS[(a + 1) % 4].price - SEASONS[a].price) * t;
}

/** Petit hasard déterministe par jour (la météo d'un jour ne change pas en cours de journée). */
function dayNoise(day: number, salt: number) {
  const x = Math.sin(day * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Météo du jour (pour le rendu) : intensité de la neige en hiver, des feuilles mortes en automne.
 * Certains jours d'hiver le ciel est dégagé, d'autres il tombe de gros flocons ; en automne, des
 * jours calmes et des jours de vent.
 */
export function weatherOf(s: GameState) {
  const day = currentDay(s);
  const si = seasonIndex(s);
  const n = dayNoise(day, 1);
  const snow = si === 3 ? (n < 0.22 ? 0 : n < 0.5 ? 0.35 : 0.65 + 0.35 * dayNoise(day, 2)) : 0;
  const leaves = si === 2 ? 0.35 + 0.65 * n : 0;
  return { snow, leaves };
}

/**
 * Neige au sol (0..1) : elle s'accumule au fil de l'hiver (plus vite les jours de neige) et fond
 * pendant le dernier jour de la saison.
 */
export function snowCover(s: GameState) {
  if (seasonIndex(s) !== 3) return 0;
  const d = seasonDay(s);
  const frac = (s.clock.t % TIME.DAY) / TIME.DAY;
  const start = currentDay(s) - (d - 1);
  let cover = 0.18;
  for (let k = 0; k < d; k++) {
    const day = start + k;
    const n = dayNoise(day, 1);
    const fall = n < 0.22 ? 0 : n < 0.5 ? 0.35 : 0.65 + 0.35 * dayNoise(day, 2);
    cover += fall * 0.32 * (k === d - 1 ? frac : 1);
  }
  cover = Math.min(0.95, cover);
  if (d === SEASON_DAYS) cover *= 1 - Math.max(0, frac - 0.3) / 0.7; // dégel
  return cover;
}
