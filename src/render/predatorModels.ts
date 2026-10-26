// Prédateurs low-poly : renard (pattes, queue en panache, museau) et buse (ailes articulées),
// plus la proie emportée. Comme les salariés, ils restent repérables derrière un bâtiment
// (silhouette rouge dessinée au pochoir).
import * as THREE from 'three';
import { HEN_PIVOT, henGeometry } from './models';
import { box, cone, cyl, merge, sph } from './geo';
import type { BreedId, PredatorSpecies } from '../sim/types';

const PRED_MAT = new THREE.MeshLambertMaterial({
  vertexColors: true,
  flatShading: true,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc,
  stencilZPass: THREE.ReplaceStencilOp,
});
const PRED_XRAY = new THREE.MeshBasicMaterial({
  color: 0xff4a3d,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  depthFunc: THREE.GreaterDepth,
  stencilWrite: true,
  stencilRef: 1,
  stencilFunc: THREE.NotEqualStencilFunc,
  stencilFail: THREE.KeepStencilOp,
  stencilZFail: THREE.KeepStencilOp,
  stencilZPass: THREE.KeepStencilOp,
});

function part(geo: THREE.BufferGeometry, xray = true) {
  const m = new THREE.Mesh(geo, PRED_MAT);
  m.castShadow = true;
  m.renderOrder = 3;
  if (xray) {
    const x = new THREE.Mesh(geo, PRED_XRAY);
    x.renderOrder = 6;
    m.add(x);
  }
  return m;
}

export interface PredatorView {
  species: PredatorSpecies;
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  /** Renard : pattes (AG, AD, PG, PD). Buse : serres. */
  legs: THREE.Group[];
  /** Buse : ailes gauche / droite. */
  wings: THREE.Group[];
  /** Point d'attache de la proie (gueule ou serres). */
  mouth: THREE.Group;
  prey: THREE.Object3D | null;
  preyBreed: BreedId | null;
  /** Anneau de danger au sol et ombre (buse). */
  ring: THREE.Mesh;
  shadow: THREE.Mesh;
  phase: number;
  /** Position affichée (lissée) et état d'animation. */
  px: number;
  pz: number;
  py: number;
  gait: number;
  fade: number;
}

const RING_MAT = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.85, depthWrite: false });
const SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x1d2a12, transparent: true, opacity: 0.22, depthWrite: false });

function groundMarks() {
  const rg = new THREE.RingGeometry(0.48, 0.6, 28);
  rg.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(rg, RING_MAT.clone());
  ring.renderOrder = 2;
  const sg = new THREE.CircleGeometry(0.4, 18);
  sg.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(sg, SHADOW_MAT.clone());
  shadow.renderOrder = 1;
  return { ring, shadow };
}

// ------------------------------------------------------------------ Renard ----
const FOX = { fur: 0xd7692a, furDark: 0xb85420, white: 0xf5efe4, sock: 0x2e211b, nose: 0x1f1a17, eye: 0x2a1a0c };
let foxGeo: { body: THREE.BufferGeometry; head: THREE.BufferGeometry; tail: THREE.BufferGeometry; leg: THREE.BufferGeometry } | null = null;

function foxGeometry() {
  if (foxGeo) return foxGeo;
  const body = merge([
    sph(0.14, 10, 8, FOX.fur, [0, 0, -0.02], [0.9, 0.82, 2.25]),
    sph(0.1, 8, 6, FOX.white, [0, -0.05, 0.16], [0.8, 0.75, 1.35]),
    sph(0.1, 8, 6, FOX.furDark, [0, 0.06, -0.12], [0.85, 0.5, 1.6]),
    cyl(0.07, 0.09, 0.16, 8, FOX.fur, [0, 0.07, 0.27], [-0.7, 0, 0]),
  ]);
  const head = merge([
    sph(0.1, 10, 8, FOX.fur, [0, 0, 0], [1, 0.88, 1.05]),
    sph(0.06, 8, 6, FOX.white, [0.05, -0.035, 0.035]),
    sph(0.06, 8, 6, FOX.white, [-0.05, -0.035, 0.035]),
    cone(0.055, 0.19, 8, FOX.fur, [0, -0.025, 0.14], [Math.PI / 2, 0, 0]),
    box(0.06, 0.03, 0.12, FOX.white, [0, -0.06, 0.13]),
    sph(0.024, 6, 5, FOX.nose, [0, -0.02, 0.235]),
    sph(0.019, 6, 5, FOX.eye, [0.047, 0.025, 0.075]),
    sph(0.019, 6, 5, FOX.eye, [-0.047, 0.025, 0.075]),
    cone(0.042, 0.12, 4, FOX.fur, [0.055, 0.1, -0.015], [0, 0, -0.25]),
    cone(0.042, 0.12, 4, FOX.fur, [-0.055, 0.1, -0.015], [0, 0, 0.25]),
    cone(0.02, 0.05, 4, FOX.sock, [0.068, 0.16, -0.015], [0, 0, -0.25]),
    cone(0.02, 0.05, 4, FOX.sock, [-0.068, 0.16, -0.015], [0, 0, 0.25]),
  ]);
  const tail = merge([
    sph(0.09, 8, 6, FOX.fur, [0, -0.02, -0.2], [1, 0.95, 2.4]),
    sph(0.07, 8, 6, FOX.white, [0, -0.04, -0.4], [1, 1, 1.25]),
  ]);
  const leg = merge([box(0.05, 0.2, 0.055, FOX.furDark, [0, -0.08, 0]), box(0.048, 0.08, 0.05, FOX.sock, [0, -0.2, 0]), box(0.056, 0.03, 0.08, FOX.sock, [0, -0.245, 0.015])]);
  foxGeo = { body, head, tail, leg };
  return foxGeo;
}

function createFox(): PredatorView {
  const g = foxGeometry();
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.3;
  body.add(part(g.body));
  const head = new THREE.Group();
  head.position.set(0, 0.13, 0.33);
  head.add(part(g.head));
  body.add(head);
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.06, 0.2);
  head.add(mouth);
  const tail = new THREE.Group();
  tail.position.set(0, 0.04, -0.3);
  tail.add(part(g.tail));
  body.add(tail);
  const legs: THREE.Group[] = [];
  for (const [x, z] of [
    [0.075, 0.19],
    [-0.075, 0.19],
    [0.075, -0.19],
    [-0.075, -0.19],
  ]) {
    const l = new THREE.Group();
    l.position.set(x, 0.25, z);
    l.add(part(g.leg, false));
    root.add(l);
    legs.push(l);
  }
  root.add(body);
  const { ring, shadow } = groundMarks();
  shadow.visible = false;
  return { species: 'fox', root, body, head, tail, legs, wings: [], mouth, prey: null, preyBreed: null, ring, shadow, phase: Math.random() * 6, px: 0, pz: 0, py: 0, gait: 0, fade: 1 };
}

// -------------------------------------------------------------------- Buse ----
const HAWK = { back: 0x6e4a2e, wing: 0x7d5534, tip: 0x3b2a1e, belly: 0xeadbbd, streak: 0xa57a4f, head: 0x8a6142, beak: 0x2f2f33, cere: 0xe8c34a, talon: 0xe0b84a };
let hawkGeo: { body: THREE.BufferGeometry; wing: THREE.BufferGeometry; tail: THREE.BufferGeometry; claw: THREE.BufferGeometry } | null = null;

function hawkGeometry() {
  if (hawkGeo) return hawkGeo;
  const body = merge([
    sph(0.1, 10, 8, HAWK.back, [0, 0, 0], [1, 0.9, 2.2]),
    sph(0.085, 8, 6, HAWK.belly, [0, -0.035, 0.04], [0.92, 0.72, 1.7]),
    box(0.1, 0.012, 0.03, HAWK.streak, [0, -0.085, 0.07]),
    box(0.1, 0.012, 0.03, HAWK.streak, [0, -0.08, -0.03]),
    sph(0.075, 8, 6, HAWK.head, [0, 0.05, 0.23]),
    cone(0.026, 0.075, 6, HAWK.beak, [0, 0.03, 0.31], [Math.PI / 2 + 0.5, 0, 0]),
    box(0.04, 0.02, 0.03, HAWK.cere, [0, 0.055, 0.29]),
    sph(0.016, 5, 4, 0xf3c623, [0.045, 0.07, 0.27]),
    sph(0.016, 5, 4, 0xf3c623, [-0.045, 0.07, 0.27]),
  ]);
  // aile droite (côté +x), le pivot est à l'épaule
  const wing = merge([
    box(0.3, 0.025, 0.2, HAWK.wing, [0.15, 0, -0.01]),
    box(0.2, 0.022, 0.17, HAWK.wing, [0.39, 0, -0.03]),
    box(0.12, 0.02, 0.16, HAWK.tip, [0.54, 0, -0.05]),
    box(0.24, 0.026, 0.06, HAWK.belly, [0.17, -0.004, 0.065]),
  ]);
  const tail = merge([box(0.16, 0.02, 0.2, HAWK.wing, [0, 0, -0.1]), box(0.17, 0.022, 0.03, HAWK.tip, [0, 0, -0.06]), box(0.18, 0.022, 0.03, HAWK.tip, [0, 0, -0.16])]);
  const claw = merge([cyl(0.012, 0.012, 0.1, 5, HAWK.talon, [0, -0.05, 0]), box(0.05, 0.015, 0.05, HAWK.talon, [0, -0.1, 0.01])]);
  hawkGeo = { body, wing, tail, claw };
  return hawkGeo;
}

function createHawk(): PredatorView {
  const g = hawkGeometry();
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.add(part(g.body));
  const head = new THREE.Group();
  head.position.set(0, 0.05, 0.23);
  body.add(head);
  const wings: THREE.Group[] = [];
  for (const side of [1, -1]) {
    const w = new THREE.Group();
    w.position.set(side * 0.07, 0.035, 0.02);
    const m = part(g.wing);
    if (side < 0) m.scale.x = -1;
    w.add(m);
    body.add(w);
    wings.push(w);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.01, -0.2);
  tail.add(part(g.tail));
  body.add(tail);
  const legs: THREE.Group[] = [];
  for (const x of [0.035, -0.035]) {
    const l = new THREE.Group();
    l.position.set(x, -0.06, 0.03);
    l.add(part(g.claw, false));
    body.add(l);
    legs.push(l);
  }
  const mouth = new THREE.Group();
  mouth.position.set(0, -0.2, 0.02);
  body.add(mouth);
  root.add(body);
  const { ring, shadow } = groundMarks();
  return { species: 'hawk', root, body, head, tail, legs, wings, mouth, prey: null, preyBreed: null, ring, shadow, phase: Math.random() * 6, px: 0, pz: 0, py: 0, gait: 0, fade: 1 };
}

export function createPredatorView(species: PredatorSpecies): PredatorView {
  return species === 'fox' ? createFox() : createHawk();
}

/** Poule emportée : un petit modèle inerte, couché sur le flanc. */
export function preyModel(breed: BreedId): THREE.Object3D {
  const g = henGeometry(breed);
  const hen = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, PRED_MAT);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.renderOrder = 3;
    hen.add(m);
  };
  add(g.body, 0, HEN_PIVOT.body, 0);
  add(g.head, HEN_PIVOT.neck[0], HEN_PIVOT.neck[1], HEN_PIVOT.neck[2]);
  add(g.eyes, HEN_PIVOT.neck[0], HEN_PIVOT.neck[1], HEN_PIVOT.neck[2]);
  add(g.wingL, HEN_PIVOT.wing[0], HEN_PIVOT.wing[1], HEN_PIVOT.wing[2]);
  add(g.wingR, -HEN_PIVOT.wing[0], HEN_PIVOT.wing[1], HEN_PIVOT.wing[2]);
  const holder = new THREE.Group();
  hen.rotation.set(0, Math.PI / 2, Math.PI / 2);
  hen.position.set(0.12, -0.08, 0);
  hen.scale.setScalar(0.8);
  holder.add(hen);
  return holder;
}
