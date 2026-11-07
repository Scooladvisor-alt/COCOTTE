// Reproduction : les coqs fécondent une partie des œufs ; mis en couveuse (dans la poussinière, sur
// un de ses emplacements), ces œufs éclosent au bout de 15 jours ; les poussins naissent sur place,
// y grandissent (ou avec les poules s'il n'y a plus de place) et pondent à 30 jours. Les oies ont leur circuit à elles : le jars féconde leurs
// œufs, la couveuse à oies les fait éclore et les oisons en sortent pour suivre aussitôt le
// troupeau, sans passer par la poussinière.
import { BREEDING, TIME } from '../config/balance';
import { BREEDS, isGoose } from '../config/breeds';
import { sizeOf } from '../config/buildings';
import { buildingCenter, currentHour, emit, frontOf, notify, rand, randRange, toWorld } from './core';
import { createHen, enterNursery } from './hens';
import { leastCrowdedNursery, nurseryCount, nurseryWithRoom } from './nursery';
import { GENE_INFO, decodeGenes, encodeGenes, genesOf, inherit } from './genetics';
import { buildingsOf, coopCapacity, getBuilding, homeForYoung, landCapacity, lvl } from './queries';
import type { ActionResult, BreedId, Building, GameState, Hen } from './types';

export const isRooster = (h: Hen) => !!h.rooster && !h.young;
export const roosterCount = (s: GameState) => s.hens.reduce((a, h) => a + (isRooster(h) ? 1 : 0), 0);
export const layerCount = (s: GameState) => s.hens.reduce((a, h) => a + (!h.rooster && !h.young ? 1 : 0), 0);
export const youngCount = (s: GameState) => s.hens.reduce((a, h) => a + (h.young ? 1 : 0), 0);

/** Coqs (ou, pour les oies, jars) adultes de la ferme. */
export function dadCount(s: GameState, goose = false) {
  return s.hens.reduce((a, h) => a + (isRooster(h) && isGoose(h.breed) === goose ? 1 : 0), 0);
}

/** Couveuse à oies ou couveuse classique. */
export const isIncubator = (b: Pick<Building, 'type'>) => b.type === 'incubator' || b.type === 'gooseincubator';
/** Couve-t-elle des œufs d'oie ? */
export const hatchesGeese = (b: Pick<Building, 'type'>) => b.type === 'gooseincubator';

/**
 * Part des œufs qui seront fécondés : un coq suffit pour une dizaine de poules, un jars pour une
 * dizaine d'oies (les poules ne comptent pas pour le jars, ni les oies pour le coq).
 */
export function fertility(s: GameState, goose = false) {
  let dads = 0;
  let mothers = 0;
  for (const h of s.hens) {
    if (h.young || isGoose(h.breed) !== goose) continue;
    if (h.rooster) dads++;
    else mothers++;
  }
  if (!dads) return 0;
  return BREEDING.maxFertility * Math.min(1, (dads * BREEDING.hensPerRooster) / Math.max(1, mothers));
}

/** Au moment de la ponte : race du futur poussin si l'œuf est fécondé (il tient de sa mère ou du coq). */
export function fertilize(s: GameState, h: Hen): { breed: BreedId; genes: string } | undefined {
  if (h.rooster || h.young) return undefined;
  const p = fertility(s, isGoose(h.breed));
  if (p <= 0 || rand(s) >= p) return undefined;
  // les oies ne se croisent qu'avec un jars, les poules qu'avec un coq
  const dads = s.hens.filter((d) => isRooster(d) && isGoose(d.breed) === isGoose(h.breed));
  if (!dads.length) return undefined;
  const dad = dads[Math.floor(rand(s) * dads.length)];
  const breed = !dad || rand(s) < 0.5 ? h.breed : dad.breed;
  // le poussin hérite des qualités de sa mère et du coq
  const genes = encodeGenes(inherit(s, genesOf(h), dad ? genesOf(dad) : genesOf(h)));
  return { breed, genes };
}

/** Œufs fécondés disponibles au stockage (tous, ou seulement ceux d'oie ou de poule). */
export function fertileStock(s: GameState, goose?: boolean) {
  let n = 0;
  for (const l of s.lots) if (l.fertile && (goose === undefined || isGoose(l.fertile) === goose)) n += l.count;
  return n;
}

export const hatchList = (b: Building) => b.hatch ?? (b.hatch = []);

export function incubatingCount(s: GameState) {
  return s.buildings.reduce((a, b) => a + (isIncubator(b) ? b.hatch?.length ?? 0 : 0), 0);
}

/** Œufs en train de couver dans les couveuses à oies : autant de futurs oisons. */
export function gooseIncubating(s: GameState) {
  return buildingsOf(s, 'gooseincubator').reduce((a, b) => a + (b.hatch?.length ?? 0), 0);
}

/** Oies à venir qui n'auront pas de place dans les abris (elles naîtront quand même, mais à l'étroit). */
export function crowdedGoslings(s: GameState) {
  const room = buildingsOf(s, 'goosehouse').reduce((a, b) => a + lvl(b).capacity, 0);
  return Math.max(0, s.hens.filter((h) => isGoose(h.breed)).length + gooseIncubating(s) - room);
}

/** Places encore libres pour de futurs poussins (poulaillers et terrain), œufs en couvaison déduits. */
export function nurseryRoom(s: GameState) {
  return Math.max(0, Math.min(coopCapacity(s), landCapacity(s)) - s.hens.length - incubatingCount(s));
}

/** Poussins à venir qui n'auront pas de place (ils naîtront quand même, mais à l'étroit). */
export function crowdedChicks(s: GameState) {
  return Math.max(0, s.hens.length + incubatingCount(s) - Math.min(coopCapacity(s), landCapacity(s)));
}

/** Jours restants avant l'éclosion d'un œuf précis. */
export function eggHatchIn(s: GameState, e: { t: number }) {
  return Math.max(0, BREEDING.incubationDays - (s.clock.t - e.t) / TIME.DAY);
}

/** Chances d'éclosion d'un œuf selon sa fraîcheur et la couveuse. */
export function hatchChance(b: Building, freshness: number) {
  return Math.min(0.98, BREEDING.hatchBase + BREEDING.hatchFresh * (freshness / 100) + (lvl(b).quality ?? 0));
}

/** Jours restants avant la prochaine éclosion (null si la couveuse est vide). */
export function nextHatchIn(s: GameState, b: Building) {
  const list = b.hatch ?? [];
  if (!list.length) return null;
  const first = Math.min(...list.map((e) => e.t));
  return Math.max(0, BREEDING.incubationDays - (s.clock.t - first) / TIME.DAY);
}

/** Met des œufs fécondés du stockage en couveuse (les plus frais d'abord). */
export function loadIncubator(s: GameState, b: Building, max = Infinity, silent = false): ActionResult & { count?: number } {
  if (!isIncubator(b)) return { ok: false, reason: 'Ce n’est pas une couveuse' };
  // chacun sa couveuse : les œufs d'oie, plus gros, ne vont que dans la couveuse à oies
  const goose = hatchesGeese(b);
  const stock = fertileStock(s, goose);
  if (stock <= 0) {
    if (dadCount(s, goose)) return { ok: false, reason: goose ? 'Aucun œuf d’oie fécondé au stockage pour l’instant' : 'Aucun œuf fécondé au stockage pour l’instant' };
    return { ok: false, reason: goose ? 'Aucun œuf d’oie fécondé : il faut un jars avec les oies' : 'Aucun œuf fécondé : il faut un coq dans la basse-cour' };
  }
  const list = hatchList(b);
  const space = lvl(b).capacity - list.length;
  if (space <= 0) return { ok: false, reason: 'La couveuse est pleine' };
  // la couveuse se remplit jusqu'à sa capacité ; si la ferme est pleine, les poussins seront à l'étroit (avertissement)
  let n = Math.min(stock, space, max);
  const lots = s.lots.filter((l) => l.fertile && l.count > 0 && isGoose(l.fertile) === goose).sort((a, c) => c.freshness - a.freshness);
  let put = 0;
  for (const l of lots) {
    while (n > 0 && l.count > 0) {
      l.count--;
      n--;
      put++;
      list.push({ breed: l.fertile!, t: s.clock.t, ok: rand(s) < hatchChance(b, l.freshness), ...(l.genes ? { genes: l.genes } : {}) });
    }
    if (n <= 0) break;
  }
  s.lots = s.lots.filter((l) => l.count > 0);
  if (put > 0 && !silent) notify(s, `${put} œuf${put > 1 ? 's' : ''} fécondé${put > 1 ? 's' : ''} mis en couveuse : éclosion dans ${BREEDING.incubationDays} jours.`, 'good', '🥚');
  return { ok: put > 0, count: put, reason: put > 0 ? undefined : 'Aucun œuf à mettre en couveuse' };
}

/** Place des œufs fécondés dans une couveuse et le montre au-dessus d'elle. */
function fill(s: GameState, b: Building) {
  const r = loadIncubator(s, b, Infinity, true);
  if (r.count) {
    const c = buildingCenter(b);
    emit(s, { kind: 'incubated', count: r.count, x: c.x, z: c.z });
  }
  return r;
}

/** Combien d'œufs fécondés peuvent entrer en couveuse maintenant (place dans les couveuses et pour les poussins). */
export function incubatable(s: GameState) {
  const space = (type: 'incubator' | 'gooseincubator') => buildingsOf(s, type).reduce((a, b) => a + Math.max(0, lvl(b).capacity - (b.hatch?.length ?? 0)), 0);
  return Math.min(fertileStock(s, false), space('incubator')) + Math.min(fertileStock(s, true), space('gooseincubator'));
}

/** Bouton du stockage : tous les œufs fécondés partent dans les couveuses (les moins pleines d'abord). */
export function incubateAll(s: GameState): ActionResult & { count?: number } {
  const incs = s.buildings.filter(isIncubator).sort((a, b) => (a.hatch?.length ?? 0) / lvl(a).capacity - (b.hatch?.length ?? 0) / lvl(b).capacity);
  if (!incs.length) return { ok: false, reason: 'Il faut d’abord une poussinière et une couveuse (Boutique → Bâtiments)' };
  if (fertileStock(s) <= 0) return { ok: false, reason: 'Aucun œuf fécondé au stockage' };
  let total = 0;
  let reason = '';
  for (const b of incs) {
    const r = fill(s, b);
    total += r.count ?? 0;
    if (!r.ok && r.reason) reason = r.reason;
  }
  if (!total) return { ok: false, reason: reason || 'Les couveuses sont pleines' };
  const left = fertileStock(s);
  const why = left ? ` ${left} reste${left > 1 ? 'nt' : ''} au garde-manger, faute de place dans la bonne couveuse.` : '';
  const crowd = crowdedChicks(s) ? ' Attention : la ferme sera pleine, des poussins seront à l’étroit.' : '';
  notify(s, `${total} œuf${total > 1 ? 's' : ''} fécondé${total > 1 ? 's' : ''} mis en couveuse : éclosion dans ${BREEDING.incubationDays} jours.${why}${crowd}`, 'good', '🥚');
  return { ok: true, count: total };
}

/**
 * Remplissage automatique : dès qu'un œuf fécondé arrive au stockage, il part en couveuse
 * (on le voit s'y ajouter). Appelé à chaque pas, ne coûte presque rien sans œuf fécondé.
 */
export function autoIncubate(s: GameState) {
  if (fertileStock(s) <= 0) return;
  for (const b of s.buildings) if (isIncubator(b) && b.auto !== false && fertileStock(s, hatchesGeese(b)) > 0) fill(s, b);
}

export function toggleIncubatorAuto(s: GameState, b: Building): ActionResult {
  if (!isIncubator(b)) return { ok: false, reason: 'Ce n’est pas une couveuse' };
  b.auto = b.auto === false;
  if (b.auto) fill(s, b);
  return { ok: true };
}

function hatchOut(s: GameState, b: Building) {
  const list = b.hatch;
  if (!list?.length) return;
  const due = list.filter((e) => s.clock.t - e.t >= BREEDING.incubationDays * TIME.DAY);
  if (!due.length) return;
  b.hatch = list.filter((e) => !due.includes(e));
  const c = buildingCenter(b);
  let born = 0;
  let raised = 0;
  let goslings = 0;
  const promising: string[] = [];
  const { w, d } = sizeOf(b.type, b.level);
  const host = b.hostId === undefined ? undefined : getBuilding(s, b.hostId);
  for (const e of due) {
    if (!e.ok) continue;
    // l'oison sort de sa couveuse et rejoint les oies ; le poussin naît dans la poussinière de sa
    // couveuse, ou dans une autre qui a de la place : il ne sort jamais avec les poules, même si
    // toutes sont pleines (il y sera à l'étroit)
    const gosling = isGoose(e.breed);
    const room = gosling ? null : host && lvl(host).capacity > nurseryCount(s, host) ? host : nurseryWithRoom(s) ?? host ?? leastCrowdedNursery(s);
    const coop = room ?? homeForYoung(s, e.breed);
    if (!coop) continue;
    const at = host ? frontOf(host, 0.6 + rand(s) * 0.4, randRange(s, -0.5, 0.5)) : toWorld(b, w / 2 + randRange(s, -0.7, 0.7), d + 0.35 + randRange(s, 0, 0.5));
    const h = createHen(s, e.breed, coop, false, { young: BREEDING.growthDays, rooster: rand(s) < BREEDING.roosterShare, at, genes: decodeGenes(e.genes) });
    s.hens.push(h);
    if (room) {
      enterNursery(s, h, room);
      raised++;
    }
    born++;
    if (gosling) goslings++;
    const g = genesOf(h);
    const top = Math.max(g.p, g.r, g.b);
    if (top >= 4) promising.push(`${h.name} (${top}★ en ${GENE_INFO[g.p === top ? 'p' : g.b === top ? 'b' : 'r'].label.toLowerCase()})`);
  }
  s.stats.chicksHatched += born;
  const lost = due.length - born;
  if (born > 0) {
    emit(s, { kind: 'hatch', count: born, x: c.x, z: c.z });
    const chicks = born - goslings;
    const rest = lost ? ` · ${lost} œuf${lost > 1 ? 's' : ''} n’${lost > 1 ? 'ont' : 'a'} pas éclos` : '';
    if (goslings) notify(s, `${goslings} oison${goslings > 1 ? 's sortent' : ' sort'} de la couveuse et ${goslings > 1 ? 'rejoignent' : 'rejoint'} les oies${chicks ? '' : rest}. Adulte${goslings > 1 ? 's' : ''} dans ${BREEDING.growthDays} jours !`, 'good', '🪿');
    const breeds = [...new Set(due.filter((e) => e.ok && !isGoose(e.breed)).map((e) => BREEDS[e.breed].name))].join(', ');
    const packed = raised > 0 && buildingsOf(s, 'nursery').some((n) => nurseryCount(s, n) > lvl(n).capacity);
    const where = packed ? ' La poussinière est surpeuplée : ils sont à l’étroit, leur confort et leur santé en souffrent. Agrandissez-la !' : raised === chicks ? ' Ils grandissent à la poussinière.' : raised ? ` ${raised} restent à la poussinière (pleine), les autres grandissent avec les poules.` : buildingsOf(s, 'nursery').length ? ' Poussinière pleine : ils grandissent avec les poules.' : '';
    if (chicks) notify(s, `${chicks} poussin${chicks > 1 ? 's sont nés' : ' est né'} (${breeds})${rest}. Pondeuses dans ${BREEDING.growthDays} jours !${where}`, 'good', '🐣');
    if (promising.length) notify(s, `Poussin${promising.length > 1 ? 's' : ''} prometteur${promising.length > 1 ? 's' : ''} : ${promising.join(', ')}. Gardez-le${promising.length > 1 ? 's' : ''} pour la reproduction !`, 'good', '🌟');
  } else notify(s, `Aucun des ${due.length} œuf${due.length > 1 ? 's' : ''} de la couveuse n’a éclos. Des œufs plus frais éclosent mieux.`, 'warn', '🥚');
}

/** À chaque pas : éclosions. */
export function incubatorTick(s: GameState) {
  for (const b of s.buildings) if (isIncubator(b)) hatchOut(s, b);
}

/** Chaque heure : chant du coq au lever du jour. */
export function breedingHourly(s: GameState) {
  const h = currentHour(s);
  if (h >= 5 && h < 9) {
    const roosters = s.hens.filter(isRooster); // il chante dès l'aube, même depuis le poulailler
    if (roosters.length && rand(s) < (h < 7 ? 0.9 : 0.4)) {
      const r = roosters[Math.floor(rand(s) * roosters.length)];
      emit(s, { kind: 'crow', x: r.x, z: r.z });
    }
  }
}

// ------------------------------------------------------------ Croissance ----
/** Seuils (part de la croissance accomplie) des stades 1 à 6 ; 7 = adulte. */
const STAGE_AT = [0.12, 0.24, 0.36, 0.52, 0.68, 0.84];
const STAGE_LABELS = [
  'Petit poussin en duvet',
  'Premières plumes au bout des ailes',
  'Plumes sur le dos, petite queue',
  'Jeune emplumé : le duvet tombe',
  'La crête commence à pousser',
  'Plumage presque complet',
  'Presque adulte',
];

/** Part de la croissance accomplie (0 à l'éclosion, 1 adulte). */
export function growth(h: Hen) {
  return h.young ? Math.max(0, Math.min(1, 1 - h.young / BREEDING.growthDays)) : 1;
}

/** Stade de croissance : 0..6 jeune, 7 adulte (sert au modèle 3D et aux fiches). */
export function growthStage(h: Hen) {
  if (!h.young) return 7;
  const g = growth(h);
  let st = 0;
  while (st < STAGE_AT.length && g >= STAGE_AT[st]) st++;
  return st;
}

export function growthLabel(h: Hen) {
  return STAGE_LABELS[Math.min(STAGE_LABELS.length - 1, growthStage(h))];
}
