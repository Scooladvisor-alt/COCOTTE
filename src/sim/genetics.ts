// Génétique et sélection : chaque volaille a trois qualités héréditaires notées de 1 à 5 étoiles
// (ponte, robustesse, beauté). Le poussin hérite de la moyenne de ses parents, avec une petite
// part de hasard : en choisissant ses reproducteurs, l'éleveur améliore sa lignée génération après
// génération. Les volailles du commerce plafonnent à 3 étoiles ; les 4 et 5 étoiles se méritent.
import { clamp } from '../config/balance';
import { BREEDS } from '../config/breeds';
import { rand } from './core';
import type { BreedId, Genes, GameState, Hen } from './types';

export type GeneKey = keyof Genes;

export const GENE_INFO: Record<GeneKey, { label: string; short: string; icon: string; help: string }> = {
  p: { label: 'Ponte', short: 'Ponte', icon: '🥚', help: 'Nombre d’œufs : de −20 % (1★) à +20 % (5★).' },
  r: { label: 'Robustesse', short: 'Robust.', icon: '💪', help: 'Résiste aux maladies et aux mauvaises conditions.' },
  b: { label: 'Beauté', short: 'Beauté', icon: '✨', help: 'Fait gagner les concours et vaut plus cher à la revente.' },
};
export const GENE_KEYS: GeneKey[] = ['p', 'r', 'b'];

/** Chances de gagner (ou de perdre) une étoile à la naissance, pour chaque qualité. */
export const MUTATION = { up: 0.18, down: 0.12 };

const NEUTRAL: Genes = { p: 3, r: 3, b: 3 };

/** Qualités d'une volaille (3 étoiles partout pour les anciennes sauvegardes). */
export function genesOf(h: Pick<Hen, 'genes'>): Genes {
  return h.genes ?? NEUTRAL;
}

/**
 * Volaille du commerce : ses étoiles dépendent de sa race (points forts, faiblesses, rareté),
 * tirées au hasard dans la fourchette de la race ; jamais mieux que 3 étoiles.
 */
export function shopGenes(s: GameState, breed: BreedId): Genes {
  const R = BREEDS[breed].genes;
  const one = ([lo, hi]: [number, number]) => clamp(lo + Math.floor(rand(s) * (hi - lo + 1)), 1, 3);
  return { p: one(R.p), r: one(R.r), b: one(R.b) };
}

/** Le poussin hérite de la moyenne de ses parents (arrondie au hasard), puis une étoile peut s'ajouter ou se perdre. */
export function inherit(s: GameState, mother: Genes, father: Genes): Genes {
  const one = (a: number, b: number) => {
    const avg = (a + b) / 2;
    let v = Math.floor(avg) + (rand(s) < avg - Math.floor(avg) ? 1 : 0);
    const x = rand(s);
    if (x < MUTATION.up) v++;
    else if (x < MUTATION.up + MUTATION.down) v--;
    return clamp(v, 1, 5);
  };
  return { p: one(mother.p, father.p), r: one(mother.r, father.r), b: one(mother.b, father.b) };
}

export const encodeGenes = (g: Genes) => `${g.p}${g.r}${g.b}`;
export function decodeGenes(code: string | undefined): Genes | undefined {
  if (!code || !/^[1-5]{3}$/.test(code)) return undefined;
  return { p: Number(code[0]), r: Number(code[1]), b: Number(code[2]) };
}

/** Multiplicateur de ponte : 0,8 (1★) … 1,2 (5★). */
export const layingGene = (h: Pick<Hen, 'genes'>) => 0.8 + 0.1 * (genesOf(h).p - 1);
/** Multiplicateur des risques (maladies, pertes de santé) : 1,3 (1★) … 0,7 (5★). */
export const frailty = (h: Pick<Hen, 'genes'>) => 1.3 - 0.15 * (genesOf(h).r - 1);
/** Valeur à la revente : 0,8 (1★) … 1,2 (5★). */
export const beautyValue = (h: Pick<Hen, 'genes'>) => 0.8 + 0.1 * (genesOf(h).b - 1);

/** Total des étoiles (3 à 15). */
export const geneTotal = (g: Genes) => g.p + g.r + g.b;
/** Meilleure étoile de la ferme (toutes qualités confondues). */
export function bestStar(s: GameState) {
  let best = 0;
  for (const h of s.hens) {
    const g = genesOf(h);
    best = Math.max(best, g.p, g.r, g.b);
  }
  return best;
}

export const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
