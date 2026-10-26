// Chien de garde (berger allemand : robe feu à manteau noir, masque noir, oreilles dressées,
// queue touffue portée bas, collier rouge) et sa niche en bois.
// Squelette simple : corps → cou → tête ; quatre pattes à deux segments (épaule/hanche + genou) ;
// queue en deux segments (levée, balancement, courbure). Les postures sont calculées par dogPose().
import * as THREE from 'three';
import { C, CREATURE_MAT, box, cyl, merge, mesh, prism, sph } from './geo';

/** Le chien n'est jamais couvert de neige (sa niche, si). */
const cmesh = (g: THREE.BufferGeometry, cast = true, receive = true) => mesh(g, cast, receive, CREATURE_MAT);

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
}

export interface DogView {
  root: THREE.Group;
  body: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  tailLift: THREE.Group;
  tailWag: THREE.Group;
  tailTip: THREE.Group;
  legs: Leg[];
  kennel: THREE.Group;
  gait: number;
  px: number;
  pz: number;
}

const TAN = 0xb97b40;
const TAN_DARK = 0x9a6331;
const DARK = 0x231d1a;
const CREAM = 0xd9b07a;

/** Hauteur du centre du corps quand le chien est debout. */
export const DOG_STAND_Y = 0.37;

export function createDogView(): DogView {
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = DOG_STAND_Y;
  // tronc : poitrail profond, taille plus fine, croupe ; selle noire sur le dos
  body.add(
    cmesh(
      merge([
        sph(0.12, 12, 9, TAN, [0, -0.005, 0.12], [0.88, 1.08, 1.15]),
        sph(0.11, 12, 9, TAN, [0, 0, -0.04], [0.85, 0.9, 1.5]),
        sph(0.105, 12, 9, TAN, [0, 0.012, -0.2], [0.92, 0.95, 1.05]),
        sph(0.11, 12, 8, DARK, [0, 0.048, -0.06], [0.95, 0.58, 2.0]),
        sph(0.08, 8, 6, CREAM, [0, -0.045, 0.19], [0.9, 1.0, 0.8]),
        sph(0.075, 8, 6, CREAM, [0, -0.06, 0.0], [0.8, 0.6, 1.7]),
      ]),
    ),
  );
  // cou, incliné vers l'avant, collier rouge à sa base
  const neck = new THREE.Group();
  neck.position.set(0, 0.06, 0.17);
  neck.add(
    cmesh(
      merge([
        cyl(0.052, 0.072, 0.18, 10, TAN, [0, 0.07, 0.048], [0.6, 0, 0]),
        sph(0.055, 8, 6, TAN_DARK, [0, 0.085, 0.02], [0.9, 1.5, 0.8], [0.6, 0, 0]),
        cyl(0.068, 0.071, 0.026, 12, 0xc8352b, [0, 0.03, 0.02], [0.6, 0, 0]),
      ]),
    ),
  );
  body.add(neck);
  // tête : crâne, museau effilé au masque noir, truffe, yeux, oreilles droites en triangle
  const head = new THREE.Group();
  head.position.set(0, 0.15, 0.1);
  head.add(
    cmesh(
      merge([
        sph(0.072, 10, 8, TAN, [0, 0, 0], [0.95, 0.88, 1.08]),
        sph(0.066, 10, 6, TAN_DARK, [0, 0.022, -0.012], [0.9, 0.62, 0.95]),
        cyl(0.028, 0.046, 0.13, 8, DARK, [0, -0.026, 0.1], [Math.PI / 2, 0, 0]),
        sph(0.03, 8, 6, TAN, [0, -0.04, 0.075], [1.1, 0.6, 1.2]),
        sph(0.019, 6, 5, 0x0d0d0d, [0, -0.012, 0.166], [1.1, 0.85, 0.9]),
        sph(0.012, 6, 5, 0x120c08, [0.034, 0.016, 0.058]),
        sph(0.012, 6, 5, 0x120c08, [-0.034, 0.016, 0.058]),
        // oreilles : pyramides aplaties, pointe légèrement vers l'extérieur
        cyl(0, 0.038, 0.11, 4, DARK, [0.042, 0.095, -0.025], [-0.12, Math.PI / 4, -0.28], [1, 1, 0.45]),
        cyl(0, 0.038, 0.11, 4, DARK, [-0.042, 0.095, -0.025], [-0.12, Math.PI / 4, 0.28], [1, 1, 0.45]),
        cyl(0, 0.026, 0.08, 4, 0xd59b77, [0.04, 0.088, -0.014], [-0.12, Math.PI / 4, -0.28], [1, 1, 0.25]),
        cyl(0, 0.026, 0.08, 4, 0xd59b77, [-0.04, 0.088, -0.014], [-0.12, Math.PI / 4, 0.28], [1, 1, 0.25]),
      ]),
    ),
  );
  neck.add(head);
  // queue touffue : levée (x) → balancement latéral (z) → segment ; pointe courbée, plus sombre
  const tailLift = new THREE.Group();
  tailLift.position.set(0, 0.05, -0.29);
  const tailWag = new THREE.Group();
  tailLift.add(tailWag);
  tailWag.add(cmesh(merge([sph(0.04, 8, 6, TAN, [0, -0.07, 0], [0.9, 1.9, 0.9]), sph(0.032, 7, 5, DARK, [0, -0.06, -0.016], [0.9, 1.8, 0.7])]), false));
  const tailTip = new THREE.Group();
  tailTip.position.set(0, -0.13, 0);
  tailTip.add(cmesh(merge([sph(0.042, 8, 6, TAN_DARK, [0, -0.06, 0], [0.95, 1.8, 0.95]), sph(0.03, 7, 5, DARK, [0, -0.12, 0], [1, 1.4, 1])]), false));
  tailWag.add(tailTip);
  body.add(tailLift);
  // pattes : antérieures droites, postérieures coudées (cuisse musclée, jarret)
  const legs: Leg[] = [];
  const frontUpper = merge([cyl(0.03, 0.036, 0.15, 7, TAN, [0, -0.075, 0])]);
  const frontLower = merge([cyl(0.022, 0.026, 0.15, 7, TAN, [0, -0.075, 0]), sph(0.03, 7, 5, CREAM, [0, -0.152, 0.018], [0.9, 0.55, 1.35])]);
  const hindUpper = merge([sph(0.055, 8, 6, TAN, [0, -0.06, 0], [0.75, 1.55, 0.95]), sph(0.045, 7, 5, DARK, [0, -0.015, -0.012], [0.8, 0.9, 0.9])]);
  const hindLower = merge([cyl(0.022, 0.028, 0.17, 7, TAN, [0, -0.085, 0]), sph(0.03, 7, 5, CREAM, [0, -0.172, 0.02], [0.9, 0.55, 1.35])]);
  for (const [x, y, z, front] of [
    [0.06, -0.05, 0.15, true],
    [-0.06, -0.05, 0.15, true],
    [0.065, -0.04, -0.21, false],
    [-0.065, -0.04, -0.21, false],
  ] as const) {
    const hip = new THREE.Group();
    hip.position.set(x, y, z);
    hip.add(cmesh(front ? frontUpper : hindUpper, false));
    const knee = new THREE.Group();
    knee.position.y = front ? -0.15 : -0.16;
    knee.add(cmesh(front ? frontLower : hindLower, false));
    hip.add(knee);
    body.add(hip);
    legs.push({ hip, knee });
  }
  root.add(body);
  // niche
  const kennel = new THREE.Group();
  kennel.add(
    mesh(
      merge([
        box(0.7, 0.5, 0.75, C.wood, [0, 0.25, 0]),
        box(0.28, 0.32, 0.02, 0x3a2a1c, [0, 0.18, 0.38]),
        prism(0.8, 0.3, 0.86, C.roof, [0, 0.5, 0], 0),
        box(0.22, 0.05, 0.02, C.white, [0, 0.42, 0.385]),
        cyl(0.09, 0.08, 0.05, 10, 0x3d6db5, [0.42, 0.03, 0.42]),
        cyl(0.075, 0.075, 0.01, 10, 0x8a5a30, [0.42, 0.056, 0.42]),
      ]),
    ),
  );
  return { root, body, neck, head, tailLift, tailWag, tailTip, legs, kennel, gait: 0, px: 0, pz: 0 };
}

export type DogAct = 'stand' | 'walk' | 'run' | 'sit' | 'sleep';

/** Posture cible : [corps y, tangage corps, cou, tête, queue levée, balancement, courbure, 4 × (épaule, genou)]. */
export interface DogPose {
  y: number;
  pitch: number;
  neck: number;
  head: number;
  lift: number;
  wag: number;
  curl: number;
  legs: [number, number][];
}

/**
 * Angles en radians, rotation autour de x : positif = vers l'arrière pour une patte pendante,
 * vers le bas pour le corps et la tête. Les pattes sont dans l'ordre AVD, AVG, ARD, ARG.
 */
export function dogPose(act: DogAct, t: number, gait: number): DogPose {
  switch (act) {
    case 'walk': {
      // pas : diagonales opposées (AVD + ARG, puis AVG + ARD)
      const a = Math.sin(gait);
      const b = Math.sin(gait + Math.PI);
      const front = (s: number, c: number) => [-s * 0.42, Math.max(0, c) * 0.55] as [number, number];
      const hind = (s: number, c: number) => [-0.3 - s * 0.32, 0.65 + Math.max(0, -c) * 0.35] as [number, number];
      return {
        y: DOG_STAND_Y + Math.abs(Math.cos(gait)) * 0.008,
        pitch: 0,
        neck: 0.38 + Math.sin(t * 2.1) * 0.08, // museau vers le sol : il renifle
        head: 0.18,
        lift: 0.55,
        wag: Math.sin(gait * 0.5) * 0.18,
        curl: 0.45,
        legs: [front(a, Math.cos(gait)), front(b, Math.cos(gait + Math.PI)), hind(b, Math.cos(gait + Math.PI)), hind(a, Math.cos(gait))],
      };
    }
    case 'run': {
      // galop : les antérieures ensemble, puis les postérieures ; le dos ondule
      const f = Math.sin(gait);
      const h = Math.sin(gait + 2.4);
      return {
        y: DOG_STAND_Y - 0.02 + Math.max(0, Math.cos(gait)) * 0.05,
        pitch: Math.sin(gait + 0.6) * 0.1,
        neck: 0.15 + Math.sin(gait) * 0.08,
        head: -0.05,
        lift: 1.15,
        wag: Math.sin(t * 9) * 0.12,
        curl: 0.2,
        legs: [
          [-f * 0.85, Math.max(0, Math.cos(gait)) * 1.0],
          [-Math.sin(gait + 0.35) * 0.85, Math.max(0, Math.cos(gait + 0.35)) * 1.0],
          [-0.3 - h * 0.8, 0.65 + Math.max(0, -Math.cos(gait + 2.4)) * 0.7],
          [-0.3 - Math.sin(gait + 2.75) * 0.8, 0.65 + Math.max(0, -Math.cos(gait + 2.75)) * 0.7],
        ],
      };
    }
    case 'sit':
      // assis : croupe au sol, antérieures tendues, postérieures repliées sous lui, queue posée derrière
      return {
        y: 0.24,
        pitch: -0.75,
        neck: 0.32,
        head: 0.38 + Math.sin(t * 0.7) * 0.06,
        lift: 2.15,
        wag: Math.sin(t * 1.3) * 0.25,
        curl: 0.05,
        legs: [
          [0.5, 0],
          [0.5, 0],
          [-0.82, 2.85],
          [-0.82, 2.85],
        ],
      };
    case 'sleep':
      // couché : ventre au sol, antérieures allongées devant, tête posée sur les pattes, queue posée au sol
      return {
        y: 0.12,
        pitch: 0,
        neck: 1.15,
        head: -0.98 + Math.sin(t * 1.1) * 0.015,
        lift: 0.95,
        wag: 0.3,
        curl: 0.6,
        legs: [
          [-1.45, 0.05],
          [-1.45, 0.05],
          [-1.22, 2.65],
          [-1.22, 2.65],
        ],
      };
    default:
      // debout, à l'arrêt : queue basse qui se balance doucement
      return {
        y: DOG_STAND_Y,
        pitch: 0,
        neck: Math.sin(t * 0.6) * 0.06,
        head: 0.05,
        lift: 0.4,
        wag: Math.sin(t * 2.2) * 0.12,
        curl: 0.5,
        legs: [
          [0, 0],
          [0, 0],
          [-0.3, 0.65],
          [-0.3, 0.65],
        ],
      };
  }
}

/** Rapproche la posture affichée de la posture cible (k = 1 : immédiat). */
export function applyDogPose(v: DogView, p: DogPose, k: number, kLegs = k) {
  const ease = (o: { x: number }, to: number, f: number) => (o.x += (to - o.x) * f);
  v.body.position.y += (p.y - v.body.position.y) * k;
  ease(v.body.rotation, p.pitch, k);
  ease(v.neck.rotation, p.neck, k);
  ease(v.head.rotation, p.head, k);
  ease(v.tailLift.rotation, p.lift, k);
  v.tailWag.rotation.z += (p.wag - v.tailWag.rotation.z) * Math.min(1, k * 2);
  ease(v.tailTip.rotation, p.curl, k);
  v.legs.forEach((l, i) => {
    ease(l.hip.rotation, p.legs[i][0], kLegs);
    ease(l.knee.rotation, p.legs[i][1], kLegs);
  });
}
