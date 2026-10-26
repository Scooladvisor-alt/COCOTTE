// Vignettes de la boutique et des listes : photos des vrais modèles 3D du jeu (rendu hors
// écran une seule fois, puis mis en cache sous forme d'image).
import * as THREE from 'three';
import { BLACK_SKIN, BREEDS } from '../config/breeds';
import type { BreedId, BuildingType, EggType, Hen } from '../sim/types';
import { C, SNOW_UNIFORM, box, cyl, merge, mesh, sph } from './geo';
import { ADULT_STAGE, EGG_MAT, HEN_MAT, HEN_PIVOT, buildingModel, eggGeometry, henGeometry, type HenKind } from './models';
import { growthStage } from '../sim/breeding';
import { createRobotView } from './robotModel';
import { applyDogPose, createDogView, dogPose } from './dogModel';

const SIZE = 256;
let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();

function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
  }
  return renderer;
}

/** Photo d'un objet, cadré sur sa sphère englobante, vu de trois quarts comme dans le jeu. */
export function snapshot(key: string, build: () => THREE.Object3D, opts: { pad?: number; yaw?: number; elev?: number } = {}): string {
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === 'undefined') return '';
  let url = '';
  try {
    const r = getRenderer();
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0xc6cfa0, 1.7));
    const sun = new THREE.DirectionalLight(0xfff2df, 2.1);
    sun.position.set(3, 6, 4);
    scene.add(sun);
    const obj = build();
    obj.updateMatrixWorld(true);
    scene.add(obj);
    const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
    const rad = Math.max(0.05, sphere.radius) * (opts.pad ?? 1.08);
    const cam = new THREE.OrthographicCamera(-rad, rad, rad, -rad, 0.01, rad * 20);
    const yaw = opts.yaw ?? Math.PI / 4;
    const elev = opts.elev ?? 0.5;
    cam.position.copy(sphere.center).add(new THREE.Vector3(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev)).multiplyScalar(rad * 6));
    cam.lookAt(sphere.center);
    // vignettes toujours sans neige (elles sont gardées en cache toute la session)
    const snow = SNOW_UNIFORM.value;
    SNOW_UNIFORM.value = 0;
    r.render(scene, cam);
    SNOW_UNIFORM.value = snow;
    url = r.domElement.toDataURL('image/png');
  } catch {
    url = '';
  }
  cache.set(key, url);
  return url;
}

function henModel(breed: BreedId, kind: HenKind = 'hen', stage = ADULT_STAGE, skin = 0) {
  const g = henGeometry(breed, kind, stage, skin);
  const root = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, HEN_MAT);
    m.position.set(x, y, z);
    root.add(m);
  };
  add(g.body, 0, HEN_PIVOT.body, 0);
  add(g.head, HEN_PIVOT.neck[0], HEN_PIVOT.neck[1], HEN_PIVOT.neck[2]);
  add(g.eyes, HEN_PIVOT.neck[0], HEN_PIVOT.neck[1], HEN_PIVOT.neck[2]);
  add(g.wingL, HEN_PIVOT.wing[0], HEN_PIVOT.wing[1], HEN_PIVOT.wing[2]);
  add(g.wingR, -HEN_PIVOT.wing[0], HEN_PIVOT.wing[1], HEN_PIVOT.wing[2]);
  add(g.leg, HEN_PIVOT.hip[0], HEN_PIVOT.hip[1], HEN_PIVOT.hip[2]);
  add(g.leg, -HEN_PIVOT.hip[0], HEN_PIVOT.hip[1], HEN_PIVOT.hip[2]);
  root.scale.setScalar(BREEDS[breed].scale * (kind === 'rooster' ? 1.1 : 1) * (stage < 3 ? 0.6 : 1));
  return root;
}

export const henThumb = (breed: BreedId, skin = 0) => snapshot(`hen:${breed}:${skin}`, () => henModel(breed, 'hen', ADULT_STAGE, skin), { yaw: 0.75, elev: 0.28, pad: 1.0 });
export const roosterThumb = (breed: BreedId, skin = 0) => snapshot(`rooster:${breed}:${skin}`, () => henModel(breed, 'rooster', ADULT_STAGE, skin), { yaw: 0.75, elev: 0.22, pad: 1.0 });
/** Vignette d'un oiseau de la ferme : poule, coq, ou jeune à son stade de croissance, avec son plumage. */
export const birdThumb = (h: { breed: BreedId; rooster?: boolean; young?: number; skin?: number; black?: boolean }) => {
  const kind: HenKind = h.rooster ? 'rooster' : 'hen';
  const stage = growthStage(h as Hen);
  const skin = h.black ? BLACK_SKIN : h.skin ?? 0;
  if (stage >= ADULT_STAGE) return kind === 'rooster' ? roosterThumb(h.breed, skin) : henThumb(h.breed, skin);
  return snapshot(`young:${h.breed}:${kind}:${stage}:${skin}`, () => henModel(h.breed, kind, stage, skin), { yaw: 0.75, elev: 0.28, pad: 1.0 });
};
export const buildingThumb = (type: BuildingType, level = 1) =>
  snapshot(
    `b:${type}:${level}`,
    () => {
      const v = buildingModel(type, level);
      // mangeoire, abreuvoir et compost photographiés bien garnis
      if (v.fill) {
        if (v.fillMode === 'scale') v.fill.scale.y = v.fillHeight ?? 0.1;
        else if (v.fillMode === 'heap') v.fill.scale.set(1, v.fillHeight ?? 0.5, 1);
        else v.fill.position.y = (v.fillBase ?? 0) + (v.fillHeight ?? 0.1);
      }
      return v.group;
    },
    { elev: 0.55 },
  );
export const eggThumb = (type: EggType) =>
  snapshot(
    `egg:${type}`,
    () => {
      const m = new THREE.Mesh(eggGeometry(type), EGG_MAT);
      m.rotation.set(0.35, 0, 0.25);
      return m;
    },
    { elev: 0.35, pad: 1.15 },
  );
export const robotThumb = () => snapshot('robot', () => createRobotView().root, { elev: 0.6, pad: 1.05 });
export const dogThumb = () =>
  snapshot(
    'dog',
    () => {
      const v = createDogView();
      applyDogPose(v, dogPose('sit', 0, 0), 1);
      return v.root;
    },
    { yaw: 0.9, elev: 0.3, pad: 1.0 },
  );

/** Sacs de grain (petit, moyen, big bag). */
export const sackThumb = (size: 'small' | 'medium' | 'bigbag') =>
  snapshot(`sack:${size}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    if (size === 'bigbag') {
      parts.push(box(0.9, 0.85, 0.9, 0xeae3cf, [0, 0.43, 0]));
      parts.push(box(0.92, 0.06, 0.92, 0xcfc4a6, [0, 0.86, 0]));
      for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) parts.push(box(0.08, 0.18, 0.02, 0x3d6db5, [x, 0.95, z]));
      parts.push(box(0.5, 0.25, 0.01, 0x3d6db5, [0, 0.45, 0.455]));
      parts.push(box(1.1, 0.1, 1.1, C.wood, [0, 0.0, 0]));
    } else {
      const n = size === 'medium' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 0.42;
        // sac de toile : corps ventru, col resserré et noué, étiquette rouge
        parts.push(cyl(0.17, 0.21, 0.46, 12, 0xd8c08a, [x, 0.25, 0], undefined, [1, 1, 0.72]));
        parts.push(sph(0.2, 12, 6, 0xd8c08a, [x, 0.02, 0], [1.05, 0.35, 0.76]));
        parts.push(cyl(0.07, 0.17, 0.1, 12, 0xcfb47c, [x, 0.53, 0], undefined, [1, 1, 0.72]));
        parts.push(cyl(0.075, 0.075, 0.035, 10, 0x8a5a30, [x, 0.59, 0]));
        parts.push(cyl(0.05, 0.09, 0.08, 10, 0xc7ab70, [x, 0.65, 0]));
        parts.push(box(0.22, 0.16, 0.01, 0xb5452f, [x, 0.26, 0.152]));
        parts.push(box(0.14, 0.03, 0.012, 0xf6f2ea, [x, 0.29, 0.158]));
        parts.push(sph(0.09, 6, 4, C.grain, [x + 0.22, 0.03, 0.16], [1.4, 0.35, 1]));
      }
    }
    return mesh(merge(parts));
  });

/** Eau : bidons, livraison, camion-citerne (cuve IBC). */
export const waterThumb = (kind: 'w50' | 'w250' | 'w1000' | 'fill') =>
  snapshot(`water:${kind}`, () => {
    const parts: THREE.BufferGeometry[] = [];
    const can = (x: number, z: number) => {
      parts.push(box(0.26, 0.36, 0.16, 0x3d8fd6, [x, 0.18, z]));
      parts.push(box(0.1, 0.05, 0.05, 0x2d6fb0, [x - 0.04, 0.39, z]));
      parts.push(box(0.12, 0.04, 0.04, 0x2d6fb0, [x + 0.04, 0.37, z]));
    };
    if (kind === 'w50') {
      can(-0.15, 0);
      can(0.15, 0.05);
    } else if (kind === 'w250') {
      for (const [x, z] of [[-0.3, 0], [0, 0.05], [0.3, 0], [-0.15, -0.25], [0.15, -0.22]]) can(x, z);
    } else {
      // cuve IBC dans sa cage
      parts.push(box(0.8, 0.7, 0.8, 0xd9eef8, [0, 0.42, 0]));
      parts.push(box(0.74, 0.5, 0.74, 0x6fb6e3, [0, 0.33, 0]));
      for (const y of [0.1, 0.42, 0.77]) parts.push(box(0.84, 0.03, 0.84, 0x9aa3ab, [0, y, 0]));
      for (const [x, z] of [[-0.41, -0.41], [0.41, -0.41], [-0.41, 0.41], [0.41, 0.41]]) parts.push(box(0.04, 0.72, 0.04, 0x9aa3ab, [x, 0.42, z]));
      parts.push(cyl(0.1, 0.1, 0.05, 10, 0x2d6fb0, [0, 0.8, 0]));
      parts.push(box(0.9, 0.1, 0.9, C.wood, [0, 0.03, 0]));
      if (kind === 'fill') parts.push(cyl(0.03, 0.03, 0.5, 6, 0x3a3f4a, [0.45, 0.6, 0], [0, 0, 1.2]));
    }
    return mesh(merge(parts));
  });

/** Parcelle de prairie (onglet Terrain). */
export const parcelThumb = () =>
  snapshot('parcel', () => {
    const parts: THREE.BufferGeometry[] = [box(1.6, 0.12, 1.6, 0x9fcd62, [0, 0.06, 0]), box(1.62, 0.06, 1.62, 0xc8ab7a, [0, 0.0, 0])];
    for (let i = 0; i < 14; i++) parts.push(box(0.04, 0.12, 0.04, 0x84bf6c, [Math.sin(i * 2.1) * 0.6, 0.16, Math.cos(i * 1.7) * 0.6]));
    parts.push(box(0.05, 0.5, 0.05, C.woodDark, [0.5, 0.37, -0.5]), box(0.36, 0.22, 0.03, C.white, [0.5, 0.6, -0.48]), box(0.3, 0.06, 0.035, C.blue, [0.5, 0.64, -0.465]));
    return mesh(merge(parts));
  });
