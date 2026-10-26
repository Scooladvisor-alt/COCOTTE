// Le village, de l'autre côté de la route : rues pavées, maisons de toutes les couleurs,
// église et son clocher, boulangerie, place à la fontaine, lampadaires. Les fenêtres
// s'allument le soir et les cheminées fument.
import * as THREE from 'three';
import { WORLD } from '../config/balance';
import { C, MAT, box, cone, cyl, ico, merge, mesh, prism, sph } from './geo';

/**
 * Le village est dessiné pour une route en z = 33,4 ; on le décale avec elle (elle s'est éloignée
 * de la ferme pour laisser place à la place de l'étal et aux trottoirs).
 */
const DZ = WORLD.ROAD_Z - 33.4;

function hash(i: number) {
  const x = Math.sin(i * 91.3 + 17.7) * 43758.5453;
  return x - Math.floor(x);
}

const WALLS = [0xf6ead6, 0xf3dcc2, 0xece6da, 0xf6e3b8, 0xdfe9e3, 0xf2d7d0, 0xe8e0f0, 0xf7efe0];
const ROOFS = [0xc96a4a, 0xb85a3e, 0x8d6a5a, 0x6f7f8f, 0xd08a55, 0xa9563f];
const DOORS = [C.blue, 0x3f7d4f, 0x8a5a30, 0xb5452f, 0x5b6e8f];
const SHUTTERS = [0x3f7d4f, 0x5b8fc9, 0xb5452f, 0x8a6fb0, 0x6b9b8a];

export interface Village {
  update(time: number, dt: number, day: number): void;
}

export function buildVillage(scene: THREE.Scene): Village {
  const solid: THREE.BufferGeometry[] = [];
  const glass: THREE.BufferGeometry[] = [];
  const chimneys: Array<[number, number, number]> = [];
  const lamps: Array<[number, number]> = [];

  // sol : pelouses, rues pavées, trottoirs
  solid.push(box(84, 0.03, 26.6, 0xdfe8bb, [21, 0.015, 49.7]));
  solid.push(box(84, 0.05, 1.8, 0xd8cfbd, [21, 0.035, 46])); // grand-rue
  solid.push(box(84, 0.06, 0.25, 0xc9bfa9, [21, 0.04, 45]));
  solid.push(box(84, 0.06, 0.25, 0xc9bfa9, [21, 0.04, 47]));
  solid.push(box(1.6, 0.05, 6.6, 0xd8cfbd, [20, 0.035, 39.7])); // ruelle vers la route (et son passage piéton)
  solid.push(box(1.6, 0.05, 12, 0xd8cfbd, [20, 0.035, 53]));
  solid.push(box(1.6, 0.05, 12, 0xd8cfbd, [44, 0.035, 53]));
  // place du village
  solid.push(box(8, 0.055, 6, 0xe3dac6, [20, 0.04, 46]));
  solid.push(cyl(0.9, 1.0, 0.35, 16, 0xcfc6b3, [20, 0.2, 46]));
  solid.push(cyl(0.78, 0.78, 0.05, 16, 0x86c7e6, [20, 0.36, 46]));
  solid.push(cyl(0.12, 0.16, 0.7, 8, 0xcfc6b3, [20, 0.6, 46]));
  solid.push(cyl(0.32, 0.12, 0.1, 10, 0xcfc6b3, [20, 0.95, 46]));
  solid.push(sph(0.1, 8, 6, 0x86c7e6, [20, 1.06, 46]));
  for (const [x, z] of [
    [17, 44],
    [23, 44],
    [17, 48],
    [23, 48],
  ]) {
    solid.push(box(0.9, 0.06, 0.25, C.wood, [x, 0.32, z]));
    solid.push(box(0.06, 0.3, 0.2, C.woodDark, [x - 0.38, 0.15, z]));
    solid.push(box(0.06, 0.3, 0.2, C.woodDark, [x + 0.38, 0.15, z]));
  }

  const house = (x: number, z: number, i: number, facing: 1 | -1, scale = 1) => {
    const w = (2.2 + hash(i) * 1.2) * scale;
    const d = (2.0 + hash(i + 1) * 0.8) * scale;
    const floors = hash(i + 2) < 0.45 ? 2 : 1;
    const h = (floors === 2 ? 2.3 : 1.5) * scale;
    const wall = WALLS[Math.floor(hash(i + 3) * WALLS.length)];
    const roof = ROOFS[Math.floor(hash(i + 4) * ROOFS.length)];
    const shut = SHUTTERS[Math.floor(hash(i + 6) * SHUTTERS.length)];
    solid.push(box(w + 0.1, 0.12, d + 0.1, 0xb9ab93, [x, 0.06, z])); // soubassement
    solid.push(box(w, h, d, wall, [x, h / 2 + 0.06, z]));
    solid.push(prism(w + 0.3, 0.9 * scale + hash(i + 5) * 0.4, d + 0.4, roof, [x, h + 0.06, z]));
    const fz = z + (facing * d) / 2;
    // porte, marche, volets et fenêtres (côté rue)
    solid.push(box(0.5 * scale, 0.85 * scale, 0.06, DOORS[Math.floor(hash(i + 7) * DOORS.length)], [x - w * 0.18, 0.5 * scale, fz + facing * 0.02]));
    solid.push(box(0.8 * scale, 0.08, 0.3, 0xcfc6b3, [x - w * 0.18, 0.05, fz + facing * 0.15]));
    const winRows = floors === 2 ? [0.6, 1.6] : [0.75];
    for (const y of winRows)
      for (const wx of y === 0.6 || floors === 1 ? [x + w * 0.22] : [x - w * 0.22, x + w * 0.22]) {
        glass.push(box(0.42 * scale, 0.45 * scale, 0.05, 0xffffff, [wx, y * scale + 0.2, fz + facing * 0.03]));
        solid.push(box(0.12 * scale, 0.5 * scale, 0.05, shut, [wx - 0.3 * scale, y * scale + 0.2, fz + facing * 0.04]));
        solid.push(box(0.12 * scale, 0.5 * scale, 0.05, shut, [wx + 0.3 * scale, y * scale + 0.2, fz + facing * 0.04]));
        solid.push(box(0.5 * scale, 0.06, 0.12, 0xcfc6b3, [wx, y * scale - 0.05, fz + facing * 0.06]));
      }
    // fenêtres à l'arrière (on voit souvent le dos des maisons)
    glass.push(box(0.42 * scale, 0.45 * scale, 0.05, 0xffffff, [x, 0.95 * scale, z - (facing * d) / 2 - facing * 0.03]));
    // cheminée
    const cx = x + w * (hash(i + 8) < 0.5 ? -0.28 : 0.28);
    const top = h + 0.06 + 0.75 * scale;
    solid.push(box(0.28, 0.9, 0.28, 0xd9cfc2, [cx, top - 0.2, z - d * 0.1]));
    chimneys.push([cx, top + 0.3, z - d * 0.1]);
    // jardinet : haie ou barrière, un arbre de temps en temps
    if (hash(i + 9) < 0.5) solid.push(box(w + 0.6, 0.35, 0.3, 0x7fb35a, [x, 0.18, fz + facing * 1.1]));
    else for (let k = 0; k < 5; k++) solid.push(box(0.06, 0.4, 0.06, C.white, [x - w / 2 + (k * w) / 4, 0.2, fz + facing * 1.1]));
    if (hash(i + 10) < 0.4) {
      const tx = x + (w / 2 + 0.8) * (hash(i + 11) < 0.5 ? -1 : 1);
      solid.push(cyl(0.07, 0.1, 0.8, 6, C.trunk, [tx, 0.4, z]));
      solid.push(ico(0.6, 1, hash(i + 12) < 0.5 ? C.leaf : 0xa8d68a, [tx, 1.25, z]));
    }
  };

  // grand-rue : une rangée de chaque côté (on saute la place)
  let k = 1;
  for (let x = -12; x < 56; x += 3.9 + hash(k) * 0.8) {
    k += 13;
    if (Math.abs(x - 20) < 5.5) continue;
    house(x, 42.6, k, 1);
    if (Math.abs(x - 26) > 3 && Math.abs(x - 44) > 2.2) house(x + 1.2, 49.6, k + 7, -1);
  }
  // rangée du fond, plus modeste
  for (let x = -14; x < 58; x += 3.4 + hash(k) * 1.2) {
    k += 13;
    house(x, 55.5, k, -1, 0.85);
  }

  // l'église et son clocher
  {
    const x = 27.5;
    const z = 51.2;
    solid.push(box(4.2, 0.15, 6.4, 0xb9ab93, [x, 0.075, z]));
    solid.push(box(3.6, 2.6, 5.6, 0xeee6d6, [x, 1.4, z]));
    solid.push(prism(3.9, 1.5, 6.0, 0x7d6a64, [x, 2.7, z], Math.PI / 2));
    solid.push(box(1.7, 4.6, 1.7, 0xeee6d6, [x, 2.4, z - 3.3]));
    solid.push(cone(1.25, 2.6, 4, 0x6f7f8f, [x, 6.0, z - 3.3], [0, Math.PI / 4, 0]));
    solid.push(cyl(0.38, 0.38, 0.05, 16, C.white, [x, 3.9, z - 2.43], [Math.PI / 2, 0, 0]));
    solid.push(box(0.05, 0.28, 0.03, 0x2b2b31, [x, 3.98, z - 2.39]));
    solid.push(box(0.2, 0.04, 0.03, 0x2b2b31, [x + 0.08, 3.9, z - 2.39]));
    solid.push(box(0.06, 0.6, 0.06, 0xd9b35a, [x, 7.55, z - 3.3]));
    solid.push(box(0.36, 0.06, 0.06, 0xd9b35a, [x, 7.65, z - 3.3]));
    solid.push(box(1.2, 1.6, 0.08, 0x8a5a30, [x, 0.9, z + 2.82]));
    for (const dz of [-1.5, 0, 1.5]) {
      glass.push(box(0.06, 1.1, 0.5, 0xffffff, [x - 1.82, 1.6, z + dz]));
      glass.push(box(0.06, 1.1, 0.5, 0xffffff, [x + 1.82, 1.6, z + dz]));
    }
  }
  // la boulangerie (store rayé) et le café de la place
  {
    const x = 13.4;
    const z = 42.8;
    solid.push(box(3.4, 2.0, 2.6, 0xf6e3b8, [x, 1.06, z]));
    solid.push(prism(3.7, 1.0, 3.0, ROOFS[0], [x, 2.06, z]));
    for (let i = 0; i < 6; i++) solid.push(box(0.56, 0.06, 0.8, i % 2 ? C.white : 0xd9534f, [x - 1.4 + i * 0.56, 1.45, z + 1.6], [0.35, 0, 0]));
    glass.push(box(2.2, 0.8, 0.05, 0xffffff, [x + 0.3, 0.75, z + 1.31]));
    solid.push(box(2.0, 0.3, 0.06, 0x8a5a30, [x, 1.8, z + 1.32]));
    solid.push(box(1.5, 0.12, 0.07, 0xf6e3b8, [x, 1.8, z + 1.35]));
    chimneys.push([x + 1, 3.3, z]);
  }
  for (const [px, pz] of [
    [25.2, 45],
    [26.6, 47],
  ]) {
    solid.push(cyl(0.04, 0.04, 1.0, 5, C.greyDark, [px, 0.5, pz]));
    solid.push(cone(0.6, 0.3, 8, pz < 46 ? 0xd9534f : C.blue, [px, 1.1, pz]));
    solid.push(cyl(0.28, 0.28, 0.04, 10, C.white, [px, 0.42, pz]));
  }
  // lampadaires de la grand-rue
  for (let x = -10; x < 56; x += 7) {
    solid.push(cyl(0.04, 0.05, 1.5, 6, 0x3a3f4a, [x, 0.75, 44.8]));
    solid.push(box(0.22, 0.05, 0.22, 0x3a3f4a, [x, 1.52, 44.8]));
    lamps.push([x, 44.8]);
  }

  const solidMesh = mesh(merge(solid).translate(0, 0, DZ), true, true);
  scene.add(solidMesh);
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x9fb4c8 });
  const glassMesh = new THREE.Mesh(merge(glass).translate(0, 0, DZ), glassMat);
  scene.add(glassMesh);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1c9 });
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), lampMat, lamps.length);
  lamps.forEach(([x, z], i) => bulbs.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 1.42, z + DZ)));
  scene.add(bulbs);

  // fumée des cheminées : quelques bouffées qui montent et s'effacent
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.5, depthWrite: false });
  const puffGeo = new THREE.IcosahedronGeometry(0.16, 0);
  const smokers = chimneys.filter((_, i) => i % 3 === 0).map(([x, y, z]): [number, number, number] => [x, y, z + DZ]);
  const puffs = smokers.flatMap((c, i) =>
    [0, 1, 2].map((j) => {
      const m = new THREE.Mesh(puffGeo, puffMat);
      scene.add(m);
      return { m, c, p: (i * 0.37 + j / 3) % 1 };
    }),
  );
  void MAT;

  return {
    update(time, _dt, day) {
      const night = 1 - day;
      // vitres : reflet bleuté le jour, lumière chaude le soir
      glassMat.color.setRGB(0.62 + 0.38 * night, 0.7 + 0.12 * night, 0.78 - 0.32 * night);
      lampMat.color.setRGB(0.6 + 0.4 * night, 0.6 + 0.35 * night, 0.55 + 0.2 * night);
      for (const pf of puffs) {
        const k = (time * 0.12 + pf.p) % 1;
        pf.m.position.set(pf.c[0] + Math.sin(time * 0.6 + pf.p * 9) * 0.15 + k * 0.5, pf.c[1] + k * 2.2, pf.c[2] - k * 0.3);
        pf.m.scale.setScalar(0.6 + k * 1.8);
      }
      puffMat.opacity = 0.35 + 0.1 * day;
    },
  };
}
