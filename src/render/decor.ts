// Décor vivant autour de la ferme : champs cultivés, mare et canards, moulin, potager,
// puits, lampadaires, massifs de fleurs, chien et chat, papillons, lucioles, oiseaux.
import * as THREE from 'three';
import { GRID_H, GRID_W, GRID_Z0, GRID_Z1, WORLD } from '../config/balance';
import { C, MAT, box, cone, cyl, ico, merge, mesh, prism, sph } from './geo';

const tmp = new THREE.Object3D();
function hash(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Zones où l'on ne plante pas d'arbres (décor dédié). */
export const DECOR_ZONES = [
  { x0: -15, x1: -5.5, z0: 3, z1: 12.5 }, // mare
  { x0: -16, x1: -10, z0: 12.5, z1: 18.5 }, // moulin
];
export function inDecorZone(x: number, z: number) {
  return DECOR_ZONES.some((d) => x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1);
}

export interface Decor {
  update(time: number, dt: number, day: number): void;
}

export function buildDecor(scene: THREE.Scene): Decor {
  const statics: THREE.BufferGeometry[] = [];

  // ---------------------------------------------------- Champs cultivés ----
  // au-delà du bord nord de la ferme (la grille s'étend jusqu'à GRID_Z0)
  const N0 = GRID_Z0 - 16;
  const N1 = GRID_Z0 - 8;
  const fields = [
    { x0: -10, x1: 6, z0: N0, z1: N1, kind: 'wheat' },
    { x0: 7.2, x1: 20, z0: N0, z1: N1, kind: 'veg' },
    { x0: 21.2, x1: 36, z0: N0, z1: N1, kind: 'colza' },
    { x0: 37.2, x1: 52, z0: N0, z1: N1, kind: 'wheat' },
    { x0: 53.2, x1: 68, z0: N0, z1: N1, kind: 'veg' },
    { x0: 69.2, x1: 86, z0: N0, z1: N1, kind: 'colza' },
  ] as const;
  for (const f of fields) {
    statics.push(box(f.x1 - f.x0, 0.05, f.z1 - f.z0, 0xb79a6b, [(f.x0 + f.x1) / 2, 0.025, (f.z0 + f.z1) / 2]));
    const color = f.kind === 'wheat' ? 0xe8c76a : f.kind === 'colza' ? 0xf2d94a : 0x7fb35a;
    const alt = f.kind === 'wheat' ? 0xdcb85a : f.kind === 'colza' ? 0x9cc265 : 0x6ea34c;
    for (let z = f.z0 + 0.5, k = 0; z < f.z1 - 0.3; z += 0.85, k++) {
      statics.push(box(f.x1 - f.x0 - 0.6, f.kind === 'veg' ? 0.16 : 0.32, 0.45, k % 2 ? alt : color, [(f.x0 + f.x1) / 2, f.kind === 'veg' ? 0.1 : 0.17, z]));
      if (f.kind === 'veg') for (let x = f.x0 + 0.6; x < f.x1 - 0.4; x += 0.7) statics.push(ico(0.16, 0, k % 2 ? 0x5e9a46 : 0x86c063, [x, 0.22, z]));
    }
  }
  // chemin de terre entre les champs et la ferme
  statics.push(box(GRID_W + 30, 0.05, 1.1, 0xe2d2b0, [GRID_W / 2, 0.03, GRID_Z0 - 7.1]));

  // --------------------------------------------------------------- Mare ----
  const pondC = { x: -10.2, z: 7.6 };
  const pond = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshLambertMaterial({ color: 0x86c7e6 }));
  pond.rotation.x = -Math.PI / 2;
  pond.scale.set(3.4, 2.4, 1);
  pond.position.set(pondC.x, 0.06, pondC.z);
  pond.receiveShadow = true;
  scene.add(pond);
  const bank = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshLambertMaterial({ color: 0xcfc09a }));
  bank.rotation.x = -Math.PI / 2;
  bank.scale.set(3.9, 2.9, 1);
  bank.position.set(pondC.x, 0.04, pondC.z);
  scene.add(bank);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + hash(i) * 0.2;
    const r = 1 + hash(i * 3) * 0.08;
    const x = pondC.x + Math.cos(a) * 3.7 * r;
    const z = pondC.z + Math.sin(a) * 2.7 * r;
    if (i % 3 === 0) statics.push(ico(0.18 + hash(i) * 0.12, 0, 0xb9b2a2, [x, 0.1, z], [1, 0.6, 1]));
    else
      for (let k = 0; k < 3; k++)
        statics.push(cyl(0.012, 0.018, 0.5 + hash(i * 7 + k) * 0.3, 3, 0x6f9d4a, [x + (k - 1) * 0.09, 0.3, z + hash(k + i) * 0.1], [0.08 * (k - 1), 0, 0.1]));
  }
  // nénuphars
  for (let i = 0; i < 6; i++) {
    const lily = new THREE.Mesh(new THREE.CircleGeometry(0.22, 8), new THREE.MeshLambertMaterial({ color: 0x5fa35a }));
    lily.rotation.x = -Math.PI / 2;
    lily.position.set(pondC.x + (hash(i * 5) - 0.5) * 4, 0.07, pondC.z + (hash(i * 9) - 0.5) * 2.8);
    scene.add(lily);
  }
  // canards
  const duckGeo = merge([
    sph(0.13, 8, 6, 0xf4f1ea, [0, 0.1, 0], [0.9, 0.7, 1.35]),
    sph(0.075, 7, 5, 0x2f7a4a, [0, 0.24, 0.13]),
    box(0.05, 0.02, 0.08, 0xf0a33a, [0, 0.22, 0.22]),
    cone(0.05, 0.1, 4, 0xe9e4d8, [0, 0.16, -0.17], [-1.1, 0, 0]),
  ]);
  const ducks = [0, 1, 2].map((i) => {
    const d = mesh(duckGeo.clone(), true, false);
    d.scale.setScalar(i === 2 ? 0.7 : 1);
    scene.add(d);
    return d;
  });

  // -------------------------------------------------------------- Moulin ----
  const mill = new THREE.Group();
  mill.position.set(-13, 0, 15.4);
  mill.add(
    mesh(
      merge([
        cyl(0.9, 1.25, 3.4, 8, 0xf4ece0, [0, 1.7, 0]),
        cone(1.15, 1.1, 8, 0xc0573f, [0, 3.95, 0]),
        box(0.5, 0.85, 0.08, C.woodDark, [0, 0.45, 1.2]),
        box(0.36, 0.36, 0.06, C.glass, [0, 2.3, 1.02]),
        cyl(1.6, 1.6, 0.06, 10, 0xe6d9bf, [0, 0.03, 0]),
      ]),
    ),
  );
  const blades = new THREE.Group();
  blades.position.set(0, 3.15, 1.15);
  for (let i = 0; i < 4; i++) {
    const arm = new THREE.Group();
    arm.rotation.z = (i * Math.PI) / 2;
    arm.add(mesh(merge([box(0.08, 2.0, 0.05, C.woodDark, [0, 1.0, 0]), box(0.55, 1.5, 0.03, 0xfaf6ee, [0.3, 1.2, 0.02])]), true, false));
    blades.add(arm);
  }
  blades.add(mesh(cyl(0.14, 0.14, 0.22, 8, C.woodDark, [0, 0, 0], [Math.PI / 2, 0, 0])));
  mill.add(blades);
  scene.add(mill);

  // ------------------------------------------------------------ Potager ----
  for (let i = 0; i < 3; i++) {
    const z = 28.9 + i * 0.85;
    statics.push(box(3.6, 0.18, 0.6, C.woodDark, [-10.3, 0.09, z]));
    statics.push(box(3.4, 0.06, 0.48, 0x7a5a3a, [-10.3, 0.19, z]));
    for (let k = 0; k < 6; k++) {
      const x = -11.85 + k * 0.62;
      if (i === 0) statics.push(ico(0.15, 0, 0x8cc46b, [x, 0.3, z], [1, 0.8, 1]));
      else if (i === 1) {
        statics.push(cone(0.04, 0.12, 4, 0xf0882e, [x, 0.27, z], [Math.PI, 0, 0]));
        statics.push(cone(0.06, 0.16, 4, 0x5aa34b, [x, 0.33, z]));
      } else statics.push(ico(0.11, 0, k % 2 ? 0xe85d4a : 0xf2c23a, [x, 0.3, z]));
    }
  }
  // épouvantail
  statics.push(cyl(0.03, 0.03, 1.5, 5, C.woodDark, [-8.1, 0.75, 30.6]));
  statics.push(box(0.9, 0.05, 0.05, C.woodDark, [-8.1, 1.15, 30.6]));
  statics.push(box(0.32, 0.45, 0.18, 0x5b7fb5, [-8.1, 1.05, 30.6]));
  statics.push(sph(0.14, 7, 5, 0xe9d7a8, [-8.1, 1.42, 30.6]));
  statics.push(cyl(0.24, 0.24, 0.03, 10, 0xe2c06a, [-8.1, 1.53, 30.6]));
  statics.push(cyl(0.1, 0.13, 0.13, 10, 0xe2c06a, [-8.1, 1.6, 30.6]));

  // --------------------------------------------------------------- Puits ----
  statics.push(cyl(0.48, 0.5, 0.55, 12, 0xbdb4a4, [-1.7, 0.28, 28.8]));
  statics.push(cyl(0.38, 0.38, 0.04, 12, 0x5a8fb3, [-1.7, 0.5, 28.8]));
  for (const x of [-2.12, -1.28]) statics.push(box(0.07, 1.0, 0.07, C.woodDark, [x, 0.9, 28.8]));
  statics.push(prism(1.1, 0.42, 0.9, C.roof, [-1.7, 1.38, 28.8], Math.PI / 2));
  statics.push(cyl(0.05, 0.05, 0.8, 6, C.wood, [-1.7, 1.15, 28.8], [0, 0, Math.PI / 2]));

  // ---------------------------------------------- Massifs de fleurs ----
  const flowerColors = [0xe85d75, 0xf5c542, 0xffffff, 0x9a7ad6, 0xf08a3a];
  for (const [x0, x1] of [
    [10.2, 13.4],
    [20.4, 24.6],
    [-3.6, -0.6],
  ]) {
    statics.push(box(x1 - x0, 0.12, 0.62, 0x8a6a48, [(x0 + x1) / 2, 0.06, 30.75]));
    for (let x = x0 + 0.25; x < x1 - 0.1; x += 0.32) {
      statics.push(ico(0.13, 0, 0x6ea84f, [x, 0.2, 30.75]));
      statics.push(ico(0.06, 0, flowerColors[Math.floor(hash(x * 13) * 5)], [x + 0.03, 0.33, 30.7]));
    }
  }

  // ----------------------------------------------- Chien et chat ----
  // (le chien de la maison est géré par le rendu de la ferme : il peut être adopté)
  const cat = mesh(
    merge([
      sph(0.12, 7, 5, 0x6b6b74, [0, 0.12, 0], [0.9, 1.1, 1.1]),
      sph(0.09, 7, 5, 0x6b6b74, [0, 0.3, 0.06]),
      cone(0.035, 0.07, 3, 0x6b6b74, [0.05, 0.4, 0.05]),
      cone(0.035, 0.07, 3, 0x6b6b74, [-0.05, 0.4, 0.05]),
      cyl(0.02, 0.025, 0.3, 5, 0x6b6b74, [0.1, 0.12, -0.12], [0.3, 0, -0.9]),
    ]),
  );
  cat.position.set(-2.5, 0.45, 19.4);
  cat.rotation.y = 0.9;
  scene.add(cat);

  // -------------------------------------------------------- Lampadaires ----
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
  const lampGlow = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false });
  const lampPositions: Array<[number, number]> = [];
  // au bord du trottoir côté ferme, la crosse penchée au-dessus des passants (pas sur le parking)
  for (let x = -12; x <= GRID_W + 12; x += 9) if (x < 26.5 || x > 36.5) lampPositions.push([x, WORLD.WALK_Z - 0.75]);
  for (const [x, z] of lampPositions) {
    statics.push(cyl(0.05, 0.07, 2.2, 6, 0x4a4f58, [x, 1.1, z]));
    statics.push(box(0.05, 0.05, 0.5, 0x4a4f58, [x, 2.18, z + 0.22]));
    statics.push(cone(0.16, 0.14, 6, 0x4a4f58, [x, 2.15, z + 0.45]));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lampMat);
    bulb.position.set(x, 2.06, z + 0.45);
    scene.add(bulb);
    const halo = new THREE.Mesh(new THREE.CircleGeometry(1.3, 20), lampGlow);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(x, 0.075, z + 0.6);
    scene.add(halo);
  }

  // cailloux et touffes dans la prairie sauvage
  const tufts = new THREE.InstancedMesh(merge([cone(0.05, 0.2, 3, 0xb8c77d, [0, 0.1, 0]), cone(0.045, 0.16, 3, 0xa9bb6d, [0.06, 0.08, 0.02], [0, 0, -0.35])]), MAT, 260);
  let n = 0;
  for (let i = 0; i < 900 && n < 260; i++) {
    const x = -16 + hash(i * 3.1) * (GRID_W + 34);
    const z = GRID_Z0 - 6 + hash(i * 7.7) * (GRID_H + 14);
    const insideFarm = x > -0.5 && x < GRID_W + 0.5 && z > GRID_Z0 - 0.5 && z < GRID_Z1 + 0.5;
    const onRoad = z > GRID_Z1 + 0.3 && z < WORLD.ROAD_Z + WORLD.ROAD_HALF + 1.4;
    if (insideFarm || onRoad || inDecorZone(x, z) || (x > -10.5 && x < -3 && z > 21.5 && z < 32)) continue;
    tmp.position.set(x, 0, z);
    tmp.rotation.set(0, hash(i) * 6, 0);
    tmp.scale.setScalar(0.7 + hash(i * 2) * 0.8);
    tmp.updateMatrix();
    tufts.setMatrixAt(n++, tmp.matrix);
  }
  tufts.count = n;
  scene.add(tufts);

  const st = mesh(merge(statics), true, true);
  scene.add(st);

  // ------------------------------------------- Papillons et lucioles ----
  const flyGeo = merge([box(0.12, 0.005, 0.07, 0xffffff, [0.06, 0, 0]), box(0.12, 0.005, 0.07, 0xffffff, [-0.06, 0, 0])]);
  const butterflies = Array.from({ length: 12 }, (_, i) => {
    const m = new THREE.Mesh(flyGeo, new THREE.MeshBasicMaterial({ color: [0xffd23f, 0xffffff, 0xf49ac1, 0x8ec5ff][i % 4], side: THREE.DoubleSide }));
    scene.add(m);
    return { m, cx: 2 + hash(i) * (GRID_W - 4), cz: GRID_Z0 + 2 + hash(i * 3) * (GRID_H - 4), r: 1 + hash(i * 5) * 2.5, s: 0.3 + hash(i * 7) * 0.4, p: hash(i * 11) * 10 };
  });
  const fireflyMat = new THREE.MeshBasicMaterial({ color: 0xfff27a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const fireflyGeo = new THREE.SphereGeometry(0.05, 6, 4);
  const fireflies = Array.from({ length: 36 }, (_, i) => {
    const m = new THREE.Mesh(fireflyGeo, fireflyMat);
    scene.add(m);
    const nearPond = i < 14;
    return {
      m,
      cx: nearPond ? pondC.x + (hash(i) - 0.5) * 7 : hash(i * 2) * GRID_W,
      cz: nearPond ? pondC.z + (hash(i * 3) - 0.5) * 5 : GRID_Z0 + hash(i * 4) * GRID_H,
      p: hash(i * 9) * 20,
    };
  });

  // ------------------------------------------------------------ Oiseaux ----
  const birdGeo = merge([box(0.28, 0.02, 0.07, 0x3a3f4a, [0.12, 0, 0], [0, 0, 0.35]), box(0.28, 0.02, 0.07, 0x3a3f4a, [-0.12, 0, 0], [0, 0, -0.35])]);
  const flock = new THREE.Group();
  const birds = Array.from({ length: 5 }, (_, i) => {
    const b = new THREE.Mesh(birdGeo, MAT);
    b.position.set((i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.6, 0, -Math.ceil(i / 2) * 0.7);
    flock.add(b);
    return b;
  });
  flock.visible = false;
  scene.add(flock);
  let flockT = 8;

  return {
    update(time, dt, day) {
      // canards en ronde lente
      ducks.forEach((d, i) => {
        const a = time * (0.12 + i * 0.03) + i * 2.1;
        d.position.set(pondC.x + Math.cos(a) * (2.0 - i * 0.4), 0.05 + Math.sin(time * 2 + i) * 0.01, pondC.z + Math.sin(a) * (1.3 - i * 0.25));
        d.rotation.y = -a;
      });
      blades.rotation.z -= dt * 0.6;
      // lampadaires et lucioles la nuit
      const night = 1 - day;
      lampMat.color.setRGB(0.55 + 0.45 * night, 0.55 + 0.4 * night, 0.5 + 0.25 * night);
      lampGlow.opacity = night * 0.45;
      fireflyMat.opacity = Math.max(0, night - 0.3) * 1.2;
      for (const f of fireflies) {
        f.m.visible = night > 0.35;
        if (!f.m.visible) continue;
        f.m.position.set(f.cx + Math.sin(time * 0.4 + f.p) * 1.2, 0.35 + Math.sin(time * 1.3 + f.p * 2) * 0.2, f.cz + Math.cos(time * 0.35 + f.p) * 1.1);
        f.m.scale.setScalar(0.6 + Math.max(0, Math.sin(time * 3 + f.p * 5)) * 0.8);
      }
      for (const b of butterflies) {
        b.m.visible = day > 0.6;
        if (!b.m.visible) continue;
        const a = time * b.s + b.p;
        b.m.position.set(b.cx + Math.cos(a) * b.r + Math.sin(a * 2.7) * 0.3, 0.6 + Math.sin(a * 3.1) * 0.25, b.cz + Math.sin(a * 1.3) * b.r);
        b.m.rotation.set(0, -a, Math.sin(time * 26 + b.p) * 0.9);
      }
      // vol d'oiseaux de temps en temps
      flockT -= dt;
      if (flockT <= 0 && !flock.visible && day > 0.5) {
        flock.visible = true;
        flock.position.set(-40, 7 + Math.random() * 2, GRID_Z0 - 8 + Math.random() * (GRID_H + 10));
        flock.userData.vz = (Math.random() - 0.5) * 2;
      }
      if (flock.visible) {
        flock.position.x += dt * 5;
        flock.position.z += dt * flock.userData.vz;
        flock.rotation.y = Math.PI / 2 - Math.atan2(flock.userData.vz, 5) * 0.6;
        birds.forEach((b, i) => (b.rotation.z = Math.sin(time * 10 + i) * 0.5));
        if (flock.position.x > GRID_W + 40) {
          flock.visible = false;
          flockT = 25 + Math.random() * 35;
        }
      }
    },
  };
}
