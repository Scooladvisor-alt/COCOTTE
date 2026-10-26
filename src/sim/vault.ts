// Franchir une clôture : personne ne passe au travers du grillage. Le renard bondit par-dessus
// avec agilité, les salariés l'enjambent d'un saut, comme des commandos ; les portails, eux, se
// franchissent à pied. Les déplacements de chacun restent calculés ailleurs : ici, on détecte le
// passage d'une clôture entre deux pas, on ramène le marcheur devant le grillage et on joue le
// saut (position imposée pendant sa durée, hauteur lue par le rendu).
import { blocksMover, fenceHit } from './core';
import type { GameState } from './types';

export interface Vault {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  t: number;
  dur: number;
}
type Body = { x: number; z: number };
const vaults = new WeakMap<Body, Vault>();
const last = new WeakMap<Body, [number, number]>();
/** Fin du dernier saut : juste après, on ne repasse pas le grillage dans l'autre sens (pas de va-et-vient). */
const landed = new WeakMap<Body, number>();

/** Saut en cours (pour le rendu : progression t / dur). */
export const vaultOf = (o: Body) => vaults.get(o);

export function updateVaults(s: GameState, dt: number) {
  const movers: Array<[Body, number]> = [];
  for (const w of s.workers) if (w.onSite) movers.push([w, 0.8]);
  for (const p of s.predators) if (p.species === 'fox' && p.state !== 'dead') movers.push([p, 0.5]);
  for (const [o, dur] of movers) {
    const v = vaults.get(o);
    if (v) {
      v.t += dt;
      const k = Math.min(1, v.t / v.dur);
      o.x = v.x0 + (v.x1 - v.x0) * k;
      o.z = v.z0 + (v.z1 - v.z0) * k;
      if (k >= 1) {
        vaults.delete(o);
        landed.set(o, s.clock.t);
      }
      last.set(o, [o.x, o.z]);
      continue;
    }
    const p0 = last.get(o);
    last.set(o, [o.x, o.z]);
    if (!p0) continue;
    const dx = o.x - p0[0];
    const dz = o.z - p0[1];
    const d = Math.hypot(dx, dz);
    // un pas normal (pas une téléportation : arrivée sur le site, chargement…)
    if (d < 1e-4 || d > 1.5) continue;
    const hit = fenceHit(s, p0[0], p0[1], o.x, o.z, (val) => blocksMover(val, 'human'));
    if (!hit) continue;
    if (s.clock.t - (landed.get(o) ?? -99) < 2.5) {
      // vient de sauter : il reste de ce côté-ci du grillage
      o.x = p0[0];
      o.z = p0[1];
      last.set(o, [o.x, o.z]);
      continue;
    }
    const ux = dx / d;
    const uz = dz / d;
    const jump: Vault = { x0: hit.x - ux * 0.3, z0: hit.z - uz * 0.3, x1: hit.x + ux * 0.4, z1: hit.z + uz * 0.4, t: 0, dur };
    o.x = jump.x0;
    o.z = jump.z0;
    vaults.set(o, jump);
    last.set(o, [o.x, o.z]);
  }
}
