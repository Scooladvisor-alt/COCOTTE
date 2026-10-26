// Faune sauvage de passage : de temps en temps (rarement), une laie et ses marcassins ou une
// biche et son faon sortent du bois, longent la ferme par l'extérieur du grillage, s'arrêtent
// pour fouiller le sol ou brouter, puis repartent. Décor seul : ils n'entrent jamais dans
// l'enclos et n'ont aucun effet sur la simulation.
import * as THREE from 'three';
import { GRID_W, GRID_Z0, GRID_Z1 } from '../config/balance';
import { isOwnedCell } from '../sim/core';
import type { GameState } from '../sim/types';
import { box, cone, cyl, merge, mesh, sph } from './geo';

type Kind = 'boar' | 'piglet' | 'doe' | 'fawn';

interface Animal {
  kind: Kind;
  root: THREE.Group;
  head: THREE.Object3D;
  legs: THREE.Object3D[];
  x: number;
  z: number;
  heading: number;
  spd: number;
  phase: number;
  /** Place dans le groupe, relative au meneur (x à droite, z devant). */
  ox: number;
  oz: number;
}

interface Herd {
  animals: Animal[];
  path: Array<[number, number]>;
  i: number;
  pause: number;
  speed: number;
  /** Fouille (sanglier) ou broute (biche) pendant les haltes. */
  grazing: boolean;
}

// ------------------------------------------------------------- Modèles ----
function leg(len: number, w: number, color: number, hoof: number) {
  const g = new THREE.Group();
  g.add(mesh(merge([box(w, len, w * 1.1, color, [0, -len / 2, 0]), box(w * 1.05, len * 0.12, w * 1.15, hoof, [0, -len + len * 0.06, 0])]), true, false));
  return g;
}

function boarModel(piglet: boolean) {
  const root = new THREE.Group();
  const body = piglet ? 0x9a7350 : 0x4a3b30;
  const dark = piglet ? 0x7a5a3c : 0x3a2e26;
  const parts = [
    sph(0.3, 12, 8, body, [0, 0.42, 0], [0.85, 0.82, 1.45]),
    sph(0.26, 10, 8, dark, [0, 0.52, 0.2], [0.92, 0.85, 1.0]),
    cyl(0.03, 0.02, 0.16, 5, dark, [0, 0.46, -0.45], [-0.9, 0, 0]),
  ];
  // crinière hérissée le long du dos
  for (let i = 0; i < 6; i++) parts.push(cone(0.04, 0.1, 4, dark, [0, 0.72 - i * 0.012, 0.32 - i * 0.12], [-0.3, 0, 0]));
  // rayures claires des marcassins
  if (piglet) for (const x of [-0.17, -0.07, 0.07, 0.17]) parts.push(box(0.035, 0.03, 0.62, 0xe9d9b0, [x, 0.58 - Math.abs(x) * 0.6, 0], [0, 0, x * 1.4]));
  root.add(mesh(merge(parts), true, false));
  const head = new THREE.Group();
  head.position.set(0, 0.48, 0.38);
  head.add(
    mesh(
      merge([
        sph(0.17, 10, 8, body, [0, 0, 0.06], [0.9, 0.95, 1.1]),
        cone(0.14, 0.32, 8, body, [0, -0.05, 0.24], [Math.PI / 2 + 0.25, 0, 0]),
        cyl(0.06, 0.065, 0.04, 8, 0x6b5048, [0, -0.09, 0.39], [Math.PI / 2 + 0.25, 0, 0]),
        cone(0.05, 0.1, 4, dark, [0.09, 0.1, 0.02], [0.3, 0, -0.3]),
        cone(0.05, 0.1, 4, dark, [-0.09, 0.1, 0.02], [0.3, 0, 0.3]),
        sph(0.018, 5, 4, 0x111111, [0.08, 0.02, 0.16]),
        sph(0.018, 5, 4, 0x111111, [-0.08, 0.02, 0.16]),
        ...(piglet ? [] : [cone(0.012, 0.05, 4, 0xf3eee4, [0.065, -0.07, 0.33], [-0.4, 0, 0.3]), cone(0.012, 0.05, 4, 0xf3eee4, [-0.065, -0.07, 0.33], [-0.4, 0, -0.3])]),
      ]),
      true,
      false,
    ),
  );
  root.add(head);
  const legs = [
    [0.13, 0.28],
    [-0.13, 0.28],
    [0.13, -0.28],
    [-0.13, -0.28],
  ].map(([x, z]) => {
    const l = leg(0.3, 0.07, dark, 0x221a15);
    l.position.set(x, 0.3, z);
    root.add(l);
    return l;
  });
  if (piglet) root.scale.setScalar(0.45);
  return { root, head, legs };
}

function deerModel(fawn: boolean) {
  const root = new THREE.Group();
  const coat = 0xb07a4a;
  const belly = 0xe6cfa8;
  const parts = [
    sph(0.3, 12, 8, coat, [0, 0.86, 0], [0.72, 0.78, 1.45]),
    sph(0.25, 10, 6, belly, [0, 0.78, 0], [0.66, 0.6, 1.3]),
    // miroir blanc et petite queue
    sph(0.12, 8, 6, 0xf6efe2, [0, 0.9, -0.4], [0.9, 1, 0.5]),
    box(0.06, 0.1, 0.05, coat, [0, 0.98, -0.45], [-0.4, 0, 0]),
  ];
  // taches blanches du faon
  if (fawn) for (let i = 0; i < 10; i++) parts.push(sph(0.025, 5, 4, 0xf6efe2, [((i % 3) - 1) * 0.1, 1.04 - (i % 2) * 0.03, 0.3 - i * 0.07]));
  root.add(mesh(merge(parts), true, false));
  // cou et tête sur un même pivot (à l'épaule) : il s'abaisse pour brouter
  const head = new THREE.Group();
  head.position.set(0, 0.98, 0.32);
  head.add(
    mesh(
      merge([
        cyl(0.065, 0.1, 0.5, 8, coat, [0, 0.2, 0.12], [0.55, 0, 0]),
        sph(0.1, 10, 8, coat, [0, 0.44, 0.3], [0.8, 0.85, 1.5]),
        sph(0.05, 8, 6, 0x3a2e26, [0, 0.41, 0.46], [0.9, 0.8, 1]),
        sph(0.07, 8, 6, coat, [0.09, 0.56, 0.2], [0.5, 1.3, 0.3], [0, 0, -0.5]),
        sph(0.07, 8, 6, coat, [-0.09, 0.56, 0.2], [0.5, 1.3, 0.3], [0, 0, 0.5]),
        sph(0.02, 5, 4, 0x111111, [0.065, 0.47, 0.34]),
        sph(0.02, 5, 4, 0x111111, [-0.065, 0.47, 0.34]),
      ]),
      true,
      false,
    ),
  );
  root.add(head);
  const legs = [
    [0.11, 0.3],
    [-0.11, 0.3],
    [0.11, -0.32],
    [-0.11, -0.32],
  ].map(([x, z]) => {
    const l = leg(0.66, 0.045, coat, 0x2b2422);
    l.position.set(x, 0.68, z);
    root.add(l);
    return l;
  });
  if (fawn) root.scale.setScalar(0.62);
  return { root, head, legs };
}

// ------------------------------------------------------------ Parcours ----
/** Hors du grillage et loin de la maison, de la rue et du village. */
function wild(s: GameState, x: number, z: number) {
  if (z > GRID_Z1 - 1) return false; // la place, la rue, le village
  if (x < 1 && z > 0) return false; // la maison, le moulin, la mare
  return !isOwnedCell(s, Math.floor(x), Math.floor(z));
}
function segmentWild(s: GameState, a: [number, number], b: [number, number]) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5);
  for (let i = 0; i <= n; i++) if (!wild(s, a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n)) return false;
  return true;
}

/** Sortie du bois, deux ou trois haltes le long de la ferme (dehors), puis retour au bois. */
function planRoute(s: GameState): Array<[number, number]> | null {
  const cx = GRID_W / 2;
  const cz = (GRID_Z0 + GRID_Z1) / 2;
  // depuis l'ouest, le nord ou l'est (au sud, ce sont la route et le village)
  const far = (): [number, number] => {
    const a = -Math.PI - 0.25 + Math.random() * (Math.PI + 0.5);
    return [cx + Math.cos(a) * 85, cz + Math.sin(a) * 60];
  };
  // première halte tout près du grillage, là où la caméra peut la voir
  const nearFarm = (): [number, number] => [-8 + Math.random() * (GRID_W + 14), GRID_Z0 - 8 + Math.random() * (GRID_Z1 - GRID_Z0 + 6)];
  for (let attempt = 0; attempt < 40; attempt++) {
    const start = far();
    const pts: Array<[number, number]> = [start];
    let ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      let found = false;
      for (let t = 0; t < 30 && !found; t++) {
        const prev = pts[pts.length - 1];
        const p: [number, number] = k === 0 ? nearFarm() : [prev[0] + (Math.random() - 0.5) * 18, prev[1] + (Math.random() - 0.5) * 18];
        if (wild(s, ...p) && segmentWild(s, prev, p)) {
          pts.push(p);
          found = true;
        }
      }
      if (!found) ok = k > 0;
      if (!found) break;
    }
    if (!ok || pts.length < 2) continue;
    const end = far();
    if (!segmentWild(s, pts[pts.length - 1], end)) continue;
    pts.push(end);
    return pts;
  }
  return null;
}

// --------------------------------------------------------------- Module ----
export interface Wildlife {
  update(s: GameState, dt: number, hour: number): void;
  /** Fait sortir un groupe tout de suite (atelier de développement). */
  spawnNow(s: GameState, boars?: boolean): void;
}

export function buildWildlife(scene: THREE.Scene, announce: (text: string) => void): Wildlife {
  const group = new THREE.Group();
  scene.add(group);
  let herd: Herd | null = null;
  // première visite au bout de quelques minutes, puis rarement
  let wait = 120 + Math.random() * 120;

  function spawn(s: GameState, force?: boolean) {
    const path = planRoute(s);
    if (!path) return;
    const boars = force ?? Math.random() < 0.5;
    const young = boars ? 2 + Math.floor(Math.random() * 3) : Math.random() < 0.7 ? 1 : 0;
    const adults = boars ? 1 : 1 + (Math.random() < 0.3 ? 1 : 0);
    const animals: Animal[] = [];
    const add = (kind: Kind, ox: number, oz: number) => {
      const m = kind === 'boar' || kind === 'piglet' ? boarModel(kind === 'piglet') : deerModel(kind === 'fawn');
      group.add(m.root);
      animals.push({ kind, root: m.root, head: m.head, legs: m.legs, x: path[0][0] + ox, z: path[0][1] + oz, heading: 0, spd: 0, phase: Math.random() * 6, ox, oz });
    };
    for (let i = 0; i < adults; i++) add(boars ? 'boar' : 'doe', i * 0.9, -i * 1.2);
    for (let i = 0; i < young; i++) add(boars ? 'piglet' : 'fawn', (i % 2 ? 0.5 : -0.5) * (1 + Math.floor(i / 2) * 0.6), -0.9 - Math.floor(i / 2) * 0.6);
    herd = { animals, path, i: 1, pause: 0, speed: boars ? 0.95 : 1.15, grazing: false };
    announce(
      boars
        ? young
          ? `Une laie et ses ${young} marcassins passent au bord de la ferme.`
          : 'Un sanglier passe au bord de la ferme.'
        : young
          ? 'Une biche et son faon sortent du bois, près de la ferme.'
          : adults > 1
            ? 'Deux biches broutent au bord de la ferme.'
            : 'Une biche passe au bord de la ferme.',
    );
  }

  return {
    spawnNow(s, boars) {
      if (herd) for (const a of herd.animals) group.remove(a.root);
      herd = null;
      spawn(s, boars);
      // on le fait arriver tout de suite à sa première halte
      if (herd) {
        const h = herd as Herd;
        const [x, z] = h.path[1];
        for (const a of h.animals) {
          a.x = x + a.ox;
          a.z = z + a.oz;
        }
      }
    },
    update(s, dt, hour) {
      if (dt <= 0) return;
      if (!herd) {
        wait -= dt;
        if (wait <= 0) {
          wait = 200 + Math.random() * 260;
          if (hour > 5.5 && hour < 21) spawn(s);
        }
        return;
      }
      const h = herd;
      const lead = h.animals[0];
      // le meneur suit le parcours, avec des haltes pour fouiller ou brouter
      if (h.pause > 0) {
        h.pause -= dt;
        h.grazing = true;
      } else {
        h.grazing = false;
        const [tx, tz] = h.path[h.i];
        const dx = tx - lead.x;
        const dz = tz - lead.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.3) {
          h.i++;
          if (h.i >= h.path.length) {
            for (const a of h.animals) group.remove(a.root);
            herd = null;
            return;
          }
          if (h.i < h.path.length - 1) h.pause = 5 + Math.random() * 7;
        } else {
          lead.heading = Math.atan2(dx, dz);
          lead.x += (dx / d) * h.speed * dt;
          lead.z += (dz / d) * h.speed * dt;
          lead.spd = h.speed;
        }
      }
      if (h.grazing) lead.spd = 0;
      // les autres suivent leur place derrière le meneur (en flânant pendant les haltes)
      for (const a of h.animals.slice(1)) {
        const c = Math.cos(lead.heading);
        const sn = Math.sin(lead.heading);
        const drift = h.grazing ? Math.sin(performance.now() / 1400 + a.phase) * 0.35 : 0;
        const tx = lead.x + (a.ox + drift) * c + a.oz * sn;
        const tz = lead.z - (a.ox + drift) * sn + a.oz * c;
        const dx = tx - a.x;
        const dz = tz - a.z;
        const d = Math.hypot(dx, dz);
        const sp = Math.min(h.speed * 1.4, d * 1.5);
        if (d > 0.05 && wild(s, a.x + (dx / d) * sp * dt, a.z + (dz / d) * sp * dt)) {
          a.x += (dx / d) * sp * dt;
          a.z += (dz / d) * sp * dt;
          a.heading = Math.atan2(dx, dz);
        }
        a.spd = d > 0.08 ? sp : 0;
      }
      // animation : pas, tête qui fouille ou broute
      const t = performance.now() / 1000;
      for (const a of h.animals) {
        a.root.position.set(a.x, 0.08, a.z);
        let dh = a.heading - a.root.rotation.y;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        a.root.rotation.y += dh * Math.min(1, dt * 5);
        const moving = a.spd > 0.05;
        a.phase += dt * (moving ? a.spd * (a.kind === 'piglet' ? 16 : 9) : 0);
        const sw = moving ? Math.sin(a.phase) * 0.5 : 0;
        a.legs[0].rotation.x = sw;
        a.legs[3].rotation.x = sw;
        a.legs[1].rotation.x = -sw;
        a.legs[2].rotation.x = -sw;
        const boar = a.kind === 'boar' || a.kind === 'piglet';
        const down = h.grazing ? (boar ? 0.45 + Math.sin(t * 5 + a.phase) * 0.12 : 1.15 + Math.sin(t * 1.3 + a.phase) * 0.1) : boar ? 0.05 : -0.05;
        a.head.rotation.x += (down - a.head.rotation.x) * Math.min(1, dt * 4);
      }
    },
  };
}
