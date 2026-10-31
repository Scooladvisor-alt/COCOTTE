// Missions et déblocages.
import { LEVEL_GATES, UNLOCKS, tradeAt } from '../config/balance';
import { BREEDS, BREED_ORDER } from '../config/breeds';
import { BUILDINGS } from '../config/buildings';
import { MISSIONS } from '../config/missions';
import { ROLES, ROLE_ORDER } from '../config/staff';
import { emit, notify } from './core';
import { addXp, earn, farmLevel } from './economy';
import type { GameState } from './types';

/** Passe les missions déjà accomplies (missions ajoutées après coup dans une partie en cours). */
function skipDone(s: GameState) {
  while (MISSIONS[s.missionIndex] && s.missionsDone.includes(MISSIONS[s.missionIndex].id)) s.missionIndex++;
}

export function currentMission(s: GameState) {
  skipDone(s);
  return MISSIONS[s.missionIndex] ?? null;
}

export function missionProgress(s: GameState) {
  const m = currentMission(s);
  if (!m) return null;
  const p = m.progress(s);
  return { mission: m, ...p, ratio: p.target > 0 ? p.cur / p.target : 1 };
}

/** Valide la mission en cours (et les suivantes déjà remplies), verse la prime. */
export function checkMissions(s: GameState) {
  for (let guard = 0; guard < 4; guard++) {
    const m = currentMission(s);
    if (!m) return;
    const p = m.progress(s);
    if (p.cur < p.target) return;
    s.missionIndex++;
    s.missionsDone.push(m.id);
    if (m.money > 0) earn(s, m.money, 'primes', `Prime : ${m.title}`);
    addXp(s, m.xp);
    emit(s, { kind: 'mission', id: m.id, title: m.title });
  }
}

/** Liste lisible de ce que débloque chaque niveau (affichée lors d'un passage de niveau). */
export function unlocksAt(level: number): string[] {
  const out: string[] = [];
  // sans niveaux requis, tout s'achète dès le début : seuls les débouchés commerciaux se débloquent
  if (LEVEL_GATES) for (const id of BREED_ORDER) if (BREEDS[id].reqLevel === level) out.push(`Race : ${BREEDS[id].name}`);
  if (LEVEL_GATES) for (const def of Object.values(BUILDINGS)) {
    def.levels.forEach((l, i) => {
      if (l.reqLevel === level && !(i === 0 && !def.buildable && level === 1)) out.push(i === 0 ? `Construction : ${l.name}` : `Amélioration : ${l.name}`);
    });
  }
  const f: Record<string, string> = {
    wholesale: 'Vente à la coopérative',
    orders: 'Commandes de clients',
    autoGrain: 'Réapprovisionnement automatique du grain',
    contracts: 'Contrats avec les commerçants',
    autoWholesale: 'Vente automatique du surplus',
    pallets: 'Vente en volume (palettes)',
  };
  for (const [k, v] of Object.entries(UNLOCKS)) if (v === level) out.push(f[k]);
  // les débouchés grandissent encore : plus de contrats, de commandes et de palettes
  if (level > 1) {
    const now = tradeAt(level);
    const before = tradeAt(level - 1);
    if (level > UNLOCKS.contracts && now.contracts > before.contracts) out.push(`${now.contracts} contrats en même temps`);
    if (now.contractOffers > before.contractOffers) out.push(`${now.contractOffers} offres de contrat`);
    if (now.orders > before.orders) out.push(`${now.orders} commandes en cours`);
    if (now.pallets > before.pallets) out.push(`${now.pallets} palettes par jour`);
  }
  if (LEVEL_GATES) for (const r of ROLE_ORDER) if (ROLES[r].reqLevel === level) out.push(`Embauche : ${ROLES[r].title.toLowerCase()}`);
  return out;
}

export function announceLevel(s: GameState, level: number) {
  const list = unlocksAt(level);
  notify(s, `Niveau ${level} atteint !${list.length ? ' Nouveautés : ' + list.slice(0, 3).join(', ') : ''}`, 'good', '⭐');
}

export function isUnlocked(s: GameState, feature: keyof typeof UNLOCKS) {
  return farmLevel(s) >= UNLOCKS[feature];
}
