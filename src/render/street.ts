// La rue devant la ferme. Entre la clôture et la chaussée : la place pavée de l'étal (enseigne,
// bancs, jardinières, tilleul), le parking des clients et le trottoir où marchent les clients de
// la simulation. La chaussée a deux voies, un passage piéton face à la ruelle du village et un
// arrêt de car côté village. Tout cela vit : voitures, camionnettes, vélos, tracteur et car du
// village circulent (phares la nuit), des clients se garent puis repartent, des passants flânent
// et traversent. (Décor seul : rien ici n'influence la simulation.)
import * as THREE from 'three';
import { GRID_W, GRID_Z1, WORLD } from '../config/balance';
import { C, box, cyl, ico, merge, mesh } from './geo';
import { bench, createPerson, tractor, type PersonView } from './models';

const RZ = WORLD.ROAD_Z;
const RH = WORLD.ROAD_HALF;
const WZ = WORLD.WALK_Z;
const WALK = 1.2;
/** Trottoir côté village. */
const SZ = RZ + RH + 0.12 + WALK / 2;
/** On roule à droite : vers l'ouest côté ferme, vers l'est côté village. */
const LANE_W = RZ - RH / 2;
const LANE_E = RZ + RH / 2;
const laneZ = (dir: 1 | -1) => (dir > 0 ? LANE_E : LANE_W);
/** Étendue des trottoirs (le long de la ferme et du village). */
const X0 = -26;
const X1 = GRID_W + 10;
/** Place de l'étal puis parking des clients, entre la clôture et le trottoir. */
const PLACE = { x0: 11.2, x1: 26.6, z0: GRID_Z1 + 0.15, z1: WZ - WALK / 2 };
const PARK = { x0: 27, x1: 35.8 };
const BAY_W = (PARK.x1 - PARK.x0) / 3;
const BAYS = [0, 1, 2].map((i) => PARK.x0 + BAY_W * (i + 0.5));
const BAY_Z = GRID_Z1 + 1.95;
/** Passage piéton face à la ruelle du village ; arrêt de car sur le trottoir d'en face. */
const CROSS_X = 20;
const BUS_X = 5;
/** Tronçon où circulent les véhicules (au-delà, ils sont hors de vue). */
const T0 = -150;
const T1 = GRID_W + 150;
const FLOWERS = [0xe85d75, 0xf5c542, 0xffffff, 0x9a7ad6, 0xf08a3a];
const GLASS = 0x9fc4dc;

/** Petit panneau peint (texture dessinée dans un canevas). */
function paint(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function panel(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, ry = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: tex }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  return m;
}
const FONT = "'Nunito', system-ui, sans-serif";

// ------------------------------------------------------------ Décor fixe ----
function streetGeometry() {
  const g: THREE.BufferGeometry[] = [];
  const rw = WORLD.ROAD_MAX_X - WORLD.ROAD_MIN_X + 20;
  const rx = (WORLD.ROAD_MAX_X + WORLD.ROAD_MIN_X) / 2;
  // chaussée, lignes de rive, ligne médiane interrompue au passage piéton
  g.push(box(rw, 0.05, RH * 2, 0xaaa69d, [rx, 0.025, RZ]));
  for (const s of [-1, 1]) g.push(box(rw, 0.012, 0.07, 0xf2efe8, [rx, 0.056, RZ + s * (RH - 0.16)]));
  for (let x = WORLD.ROAD_MIN_X; x < WORLD.ROAD_MAX_X + 8; x += 2.4) if (Math.abs(x - CROSS_X) > 1.7) g.push(box(1.2, 0.012, 0.08, 0xf2efe8, [x, 0.056, RZ]));
  for (let k = 0; k < 4; k++) g.push(box(1.5, 0.012, 0.42, 0xf7f4ee, [CROSS_X, 0.057, RZ - RH + 0.43 + k * 0.85]));

  // bordures et trottoirs (dalles)
  const sw = X1 - X0;
  const sx = (X0 + X1) / 2;
  for (const s of [-1, 1]) g.push(box(sw, 0.09, 0.12, 0xd2cab9, [sx, 0.045, RZ + s * (RH + 0.06)]));
  for (const z of [WZ, SZ]) {
    g.push(box(sw, 0.065, WALK, 0xe3dac8, [sx, 0.0325, z]));
    for (let x = X0 + 1.6; x < X1; x += 1.6) g.push(box(0.035, 0.006, WALK - 0.06, 0xd0c6b2, [x, 0.067, z]));
  }

  // la place de l'étal : dalles calcaires et leurs joints
  const pw = PLACE.x1 - PLACE.x0;
  const pd = PLACE.z1 - PLACE.z0;
  const pcx = (PLACE.x0 + PLACE.x1) / 2;
  const pcz = (PLACE.z0 + PLACE.z1) / 2;
  g.push(box(pw, 0.06, pd, 0xeadfc6, [pcx, 0.03, pcz]));
  for (let x = PLACE.x0 + 0.8; x < PLACE.x1 - 0.2; x += 0.8) g.push(box(0.03, 0.006, pd - 0.1, 0xdacdb2, [x, 0.063, pcz]));
  for (let z = PLACE.z0 + 0.8; z < PLACE.z1 - 0.2; z += 0.8) g.push(box(pw - 0.1, 0.006, 0.03, 0xdacdb2, [pcx, 0.063, z]));
  g.push(box(0.14, 0.08, pd, 0xcdbfa5, [PLACE.x0 + 0.07, 0.04, pcz]));
  // tilleul dans son bac rond
  {
    const [x, z] = [12.7, 32.6];
    g.push(cyl(0.62, 0.66, 0.28, 14, 0xd2c6ae, [x, 0.14, z]));
    g.push(cyl(0.54, 0.54, 0.02, 14, 0x7a5a3a, [x, 0.285, z]));
    g.push(cyl(0.08, 0.11, 1.5, 7, C.trunk, [x, 0.95, z]));
    g.push(ico(0.85, 1, 0x8cc46e, [x, 2.0, z], [1, 0.85, 1]));
    g.push(ico(0.55, 1, 0x9ccf7e, [x + 0.45, 2.35, z + 0.2]));
    g.push(ico(0.5, 1, 0x84bf6c, [x - 0.4, 2.3, z - 0.25]));
  }
  // jardinières (demi-tonneaux fleuris)
  const planter = (x: number, z: number, seed: number) => {
    g.push(cyl(0.34, 0.27, 0.38, 10, C.woodDark, [x, 0.19, z]));
    g.push(cyl(0.355, 0.355, 0.05, 10, 0x6b5a48, [x, 0.3, z]));
    g.push(cyl(0.3, 0.3, 0.02, 10, 0x6b4a2f, [x, 0.38, z]));
    g.push(ico(0.15, 0, 0x7fb35a, [x, 0.5, z]));
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + seed;
      g.push(ico(0.12, 0, 0x6ea84f, [x + Math.cos(a) * 0.18, 0.45, z + Math.sin(a) * 0.18]));
      g.push(ico(0.055, 0, FLOWERS[(i + seed) % 5], [x + Math.cos(a) * 0.2, 0.55, z + Math.sin(a) * 0.2]));
    }
  };
  planter(11.75, 33.8, 0);
  planter(26.05, 33.8, 2);
  planter(16.3, 31.0, 4);
  // range-vélos et deux vélos garés
  g.push(box(0.05, 0.05, 1.3, 0x8e939b, [25.5, 0.36, 32.3]));
  for (const dz of [-0.62, 0.62]) g.push(box(0.05, 0.36, 0.05, 0x8e939b, [25.5, 0.18, 32.3 + dz]));
  for (const [dz, col] of [
    [-0.3, 0x3bb2c9],
    [0.3, 0xe85d75],
  ] as const) {
    const b = bikeFrame(col);
    b.rotateY(-Math.PI / 2);
    b.translate(25.75, 0, 32.3 + dz);
    g.push(b);
  }
  // haie basse entre la place et le parking
  g.push(box(0.36, 0.34, pd - 1.0, 0x7fb35a, [PLACE.x1 + 0.2, 0.17, pcz - 0.5]));
  // parking : enrobé, places tracées, butées
  const kw = PARK.x1 - PARK.x0;
  g.push(box(kw, 0.055, pd, 0xb9b5ab, [(PARK.x0 + PARK.x1) / 2, 0.0275, pcz]));
  for (let i = 0; i <= 3; i++) g.push(box(0.07, 0.008, 2.6, 0xf4f1ea, [PARK.x0 + i * BAY_W, 0.059, BAY_Z]));
  for (const bx of BAYS) g.push(box(1.0, 0.09, 0.16, 0xd8d1c3, [bx, 0.07, GRID_Z1 + 0.75]));
  g.push(box(0.36, 0.34, pd - 1.0, 0x7fb35a, [PARK.x1 + 0.2, 0.17, pcz - 0.5]));
  // abribus
  {
    const bz = SZ + 0.32;
    g.push(box(2.0, 0.06, 0.8, 0x4a4f58, [BUS_X, 1.55, bz]));
    for (const dx of [-0.95, 0.95]) g.push(box(0.06, 1.52, 0.06, 0x4a4f58, [BUS_X + dx, 0.78, bz + 0.3]));
    g.push(box(1.9, 1.1, 0.03, GLASS, [BUS_X, 0.85, bz + 0.33]));
    g.push(box(0.03, 1.0, 0.55, GLASS, [BUS_X - 0.95, 0.8, bz + 0.05]));
    g.push(box(1.3, 0.05, 0.28, C.wood, [BUS_X + 0.1, 0.42, bz + 0.15]));
    for (const dx of [-0.45, 0.65]) g.push(box(0.05, 0.4, 0.05, 0x4a4f58, [BUS_X + dx, 0.21, bz + 0.15]));
    g.push(cyl(0.035, 0.035, 1.9, 6, 0x4a4f58, [BUS_X - 1.5, 0.95, SZ - 0.35]));
  }
  return g;
}

// ------------------------------------------------------------- Véhicules ----
type Kind = 'car' | 'van' | 'bike' | 'tractor' | 'bus';
const CAR_COLORS = [0xd9534f, 0x2f6bff, 0xf3efe6, 0x5aa36b, 0xf0c94a, 0x3a3f4a, 0x9fb4c8, 0xe58b3a, 0x8a6fd1, 0xc9ccd1];
const LIGHT_FRONT = 0xfff4d0;
const LIGHT_BACK = 0xff4a3a;

const wheel = (x: number, z: number, r: number) => [cyl(r, r, 0.12, 10, 0x2b2b31, [x, r, z], [Math.PI / 2, 0, 0]), cyl(r * 0.5, r * 0.5, 0.13, 8, 0xc9ccd1, [x, r, z], [Math.PI / 2, 0, 0])];
const lamps = (x: number, y: number, dz: number, back: number) => [
  box(0.03, 0.07, 0.16, LIGHT_FRONT, [x, y, dz]),
  box(0.03, 0.07, 0.16, LIGHT_FRONT, [x, y, -dz]),
  box(0.03, 0.07, 0.16, LIGHT_BACK, [-back, y, dz]),
  box(0.03, 0.07, 0.16, LIGHT_BACK, [-back, y, -dz]),
];

function bikeFrame(color: number) {
  return merge([
    cyl(0.21, 0.21, 0.03, 12, 0x2b2b31, [0.34, 0.21, 0], [Math.PI / 2, 0, 0]),
    cyl(0.21, 0.21, 0.03, 12, 0x2b2b31, [-0.34, 0.21, 0], [Math.PI / 2, 0, 0]),
    box(0.6, 0.035, 0.035, color, [0, 0.42, 0], [0, 0, -0.12]),
    box(0.035, 0.3, 0.035, color, [-0.12, 0.42, 0]),
    box(0.035, 0.4, 0.035, color, [0.3, 0.4, 0], [0, 0, 0.25]),
    box(0.04, 0.04, 0.36, 0x3a3f4a, [0.27, 0.6, 0]),
    box(0.15, 0.04, 0.08, 0x2b2b31, [-0.13, 0.59, 0]),
  ]);
}

interface Model {
  body: THREE.BufferGeometry;
  lights: THREE.BufferGeometry;
  len: number;
  vmax: [number, number];
}
const models = new Map<string, Model>();
function model(kind: Kind, color: number): Model {
  const key = `${kind}${color}`;
  let m = models.get(key);
  if (m) return m;
  if (kind === 'car') {
    m = {
      body: merge([
        box(1.9, 0.3, 0.9, color, [0, 0.34, 0]),
        box(1.94, 0.1, 0.92, 0x55585f, [0, 0.21, 0]),
        box(1.08, 0.32, 0.84, color, [-0.12, 0.64, 0]),
        box(0.9, 0.2, 0.86, GLASS, [-0.12, 0.66, 0]),
        box(0.04, 0.22, 0.74, GLASS, [0.43, 0.65, 0]),
        box(0.04, 0.2, 0.74, GLASS, [-0.67, 0.66, 0]),
        ...wheel(0.6, 0.42, 0.17),
        ...wheel(0.6, -0.42, 0.17),
        ...wheel(-0.6, 0.42, 0.17),
        ...wheel(-0.6, -0.42, 0.17),
      ]),
      lights: merge(lamps(0.955, 0.38, 0.3, 0.955)),
      len: 1.95,
      vmax: [4.8, 6.2],
    };
  } else if (kind === 'van') {
    const stripe = color === 0xf0c94a ? C.blue : color === 0xf3efe6 ? 0x5aa36b : C.white;
    m = {
      body: merge([
        box(2.2, 0.8, 0.98, color, [0, 0.62, 0]),
        box(2.24, 0.12, 1.0, 0x55585f, [0, 0.24, 0]),
        box(0.04, 0.32, 0.86, GLASS, [1.11, 0.84, 0]),
        box(0.42, 0.28, 1.0, GLASS, [0.8, 0.86, 0]),
        box(1.3, 0.12, 1.0, stripe, [-0.35, 0.56, 0]),
        ...wheel(0.72, 0.45, 0.2),
        ...wheel(0.72, -0.45, 0.2),
        ...wheel(-0.72, 0.45, 0.2),
        ...wheel(-0.72, -0.45, 0.2),
      ]),
      lights: merge(lamps(1.125, 0.42, 0.33, 1.125)),
      len: 2.25,
      vmax: [4.4, 5.6],
    };
  } else if (kind === 'bus') {
    m = {
      body: merge([
        box(4.0, 0.98, 1.06, 0xf3efe6, [0, 0.74, 0]),
        box(4.04, 0.16, 1.08, C.blue, [0, 0.3, 0]),
        box(4.04, 0.07, 1.08, C.blue, [0, 0.6, 0]),
        box(3.3, 0.36, 1.08, GLASS, [-0.2, 0.94, 0]),
        box(0.04, 0.52, 0.96, GLASS, [2.01, 0.86, 0]),
        box(0.5, 0.72, 0.02, GLASS, [1.45, 0.62, 0.54]),
        box(3.9, 0.08, 1.0, 0xdcd6ca, [0, 1.27, 0]),
        box(0.6, 0.14, 0.03, 0xf0c94a, [1.5, 1.12, 0.545]),
        ...wheel(1.3, 0.5, 0.24),
        ...wheel(1.3, -0.5, 0.24),
        ...wheel(-1.3, 0.5, 0.24),
        ...wheel(-1.3, -0.5, 0.24),
      ]),
      lights: merge(lamps(2.025, 0.42, 0.36, 2.025)),
      len: 4.05,
      vmax: [4.2, 4.8],
    };
  } else if (kind === 'tractor') {
    m = {
      body: tractor(),
      lights: merge([box(0.03, 0.08, 0.12, LIGHT_FRONT, [0.61, 0.66, 0.28]), box(0.03, 0.08, 0.12, LIGHT_FRONT, [0.61, 0.66, -0.28]), box(0.12, 0.08, 0.12, 0xf0a33a, [-0.35, 1.42, 0])]),
      len: 1.7,
      vmax: [2.4, 2.9],
    };
  } else {
    m = {
      body: bikeFrame(color),
      lights: merge([box(0.05, 0.05, 0.05, LIGHT_FRONT, [0.33, 0.56, 0]), box(0.04, 0.04, 0.04, LIGHT_BACK, [-0.42, 0.45, 0])]),
      len: 0.9,
      vmax: [2.6, 3.3],
    };
  }
  models.set(key, m);
  return m;
}

type VState = 'drive' | 'toBay' | 'parked' | 'leave';
interface Veh {
  kind: Kind;
  g: THREE.Group;
  beam: THREE.Mesh;
  rider?: PersonView;
  dir: 1 | -1;
  x: number;
  z: number;
  v: number;
  vmax: number;
  len: number;
  state: VState;
  /** Place de parking visée ou occupée (-1 : aucune). */
  bay: number;
  /** Paramètre de la manœuvre (0 → 1) ou temps de stationnement restant. */
  t: number;
  p0: [number, number];
  /** Car : arrêt déjà desservi ; temps d'arrêt restant. */
  served: boolean;
  dwell: number;
  /** Écart latéral pour dépasser un vélo. */
  swerve: number;
  phase: number;
}

// --------------------------------------------------------------- Passants ----
interface Walker {
  p: PersonView;
  pts: Array<[number, number]>;
  i: number;
  x: number;
  z: number;
  sp: number;
  phase: number;
  /** Index du point d'où l'on traverse (on attend que la voie soit libre). */
  crossFrom: number;
  crossing: boolean;
}

export interface Street {
  update(dt: number, hour: number, day: number): void;
}

const bez = (a: number, b: number, c: number, t: number) => (1 - t) * (1 - t) * a + 2 * t * (1 - t) * b + t * t * c;
const bezD = (a: number, b: number, c: number, t: number) => 2 * (1 - t) * (b - a) + 2 * t * (c - b);

/** Véhicules par seconde et par sens selon l'heure (pointes du matin, du midi et du soir). */
function trafficRate(h: number) {
  if (h < 5.5 || h >= 22.5) return 0.015;
  const base = h < 7 ? 0.06 : h < 21 ? 0.15 : 0.05;
  const rush = Math.exp(-(((h - 8) / 0.8) ** 2)) + Math.exp(-(((h - 17.8) / 1.0) ** 2)) + 0.5 * Math.exp(-(((h - 12.3) / 0.7) ** 2));
  return base + 0.11 * rush;
}
function walkerRate(h: number) {
  if (h < 6.5 || h >= 22) return 0.01;
  return h < 8 || h >= 20 ? 0.05 : 0.14;
}

export function buildStreet(scene: THREE.Scene): Street {
  scene.add(mesh(merge(streetGeometry()), true, true));
  for (const [x, z] of [
    [22.4, 31.5],
    [24.2, 31.5],
  ]) {
    const b = mesh(bench());
    b.position.set(x, 0.06, z);
    scene.add(b);
  }

  // enseigne de la ferme, face à la rue
  {
    const x = 13.6;
    const z = 33.95;
    scene.add(mesh(merge([box(0.08, 1.4, 0.08, C.woodDark, [x - 0.72, 0.7, z]), box(0.08, 1.4, 0.08, C.woodDark, [x + 0.72, 0.7, z]), box(1.62, 0.78, 0.07, C.woodDark, [x, 1.0, z]), box(1.8, 0.05, 0.28, C.roof, [x, 1.43, z])])));
    const tex = paint(512, 248, (g) => {
      g.fillStyle = '#f6efe0';
      g.fillRect(0, 0, 512, 248);
      g.strokeStyle = '#2f6bff';
      g.lineWidth = 10;
      g.strokeRect(14, 14, 484, 220);
      g.fillStyle = '#2f6bff';
      g.textAlign = 'center';
      g.font = `900 74px ${FONT}`;
      g.fillText('ŒUFS FRAIS', 256, 112, 470);
      g.fillStyle = '#a86f3c';
      g.font = `800 34px ${FONT}`;
      g.fillText('de la ferme · vente directe', 256, 176, 380);
      for (const [ex, ey] of [
        [58, 205],
        [454, 205],
      ]) {
        g.fillStyle = '#f0d9b5';
        g.beginPath();
        g.ellipse(ex, ey, 15, 19, 0, 0, Math.PI * 2);
        g.fill();
      }
    });
    scene.add(panel(tex, 1.48, 0.7, x, 1.0, z + 0.04));
  }
  // panneau du parking
  {
    const tex = paint(128, 128, (g) => {
      g.fillStyle = '#2f6bff';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#ffffff';
      g.lineWidth = 6;
      g.strokeRect(8, 8, 112, 112);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.font = `900 96px ${FONT}`;
      g.fillText('P', 64, 100);
    });
    scene.add(mesh(cyl(0.035, 0.035, 1.6, 6, 0x8e939b, [PARK.x1 - 0.2, 0.8, PLACE.z1 - 0.25])));
    scene.add(panel(tex, 0.42, 0.42, PARK.x1 - 0.2, 1.45, PLACE.z1 - 0.21));
  }
  // panneau de l'arrêt de car
  {
    const tex = paint(160, 128, (g) => {
      g.fillStyle = '#f0c94a';
      g.fillRect(0, 0, 160, 128);
      g.fillStyle = '#2f3b4f';
      g.textAlign = 'center';
      g.font = `900 58px ${FONT}`;
      g.fillText('CAR', 80, 62);
      g.font = `800 26px ${FONT}`;
      g.fillText('Le Bourg', 80, 104);
    });
    scene.add(panel(tex, 0.5, 0.4, BUS_X - 1.5, 1.7, SZ - 0.31));
  }

  // ------------------------------------------------- Circulation ----
  const beamTex = paint(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,240,200,1)');
    r.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
  const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const beamGeo = new THREE.PlaneGeometry(1, 1);
  beamGeo.rotateX(-Math.PI / 2);
  const group = new THREE.Group();
  scene.add(group);

  const vehs: Veh[] = [];
  const bays: Array<Veh | null> = [null, null, null];
  const walkers: Walker[] = [];
  const spawnAcc = { [1]: 0, [-1]: 0 } as Record<1 | -1, number>;
  let busT = 25;
  let walkAcc = 0;
  let warmed = false;

  function addVehicle(kind: Kind, dir: 1 | -1, x: number): Veh {
    const color =
      kind === 'van' ? [0xf3efe6, 0xf0c94a, 0x9fb4c8][Math.floor(Math.random() * 3)] : kind === 'bike' ? [0x3bb2c9, 0xe85d75, 0x5aa36b, 0x2f3b4f][Math.floor(Math.random() * 4)] : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    const m = model(kind, color);
    const g = new THREE.Group();
    const body = mesh(m.body, true, false);
    g.add(body, mesh(m.lights, false, false, lightMat));
    const beam = new THREE.Mesh(beamGeo, beamMat);
    const big = kind === 'bike' ? 0.45 : 1;
    beam.scale.set(2.4 * big, 1, 1.4 * big);
    beam.position.set(m.len / 2 + 1.2 * big, 0.015, 0);
    beam.visible = false;
    beam.renderOrder = 1;
    g.add(beam);
    let rider: PersonView | undefined;
    if (kind === 'bike') {
      rider = createPerson(Math.floor(Math.random() * 64));
      rider.root.position.set(-0.08, 0.26, 0);
      rider.root.rotation.y = Math.PI / 2;
      g.add(rider.root);
    }
    group.add(g);
    const v: Veh = {
      kind,
      g,
      beam,
      rider,
      dir,
      x,
      z: laneZ(dir),
      v: 0,
      vmax: m.vmax[0] + Math.random() * (m.vmax[1] - m.vmax[0]),
      len: m.len,
      state: 'drive',
      bay: -1,
      t: 0,
      p0: [0, 0],
      served: false,
      dwell: 0,
      swerve: 0,
      phase: Math.random() * 6,
    };
    v.v = v.vmax;
    vehs.push(v);
    return v;
  }
  function removeVehicle(v: Veh) {
    group.remove(v.g);
    if (v.bay >= 0 && bays[v.bay] === v) bays[v.bay] = null;
    vehs.splice(vehs.indexOf(v), 1);
  }
  const laneFree = (dir: 1 | -1, x0: number, x1: number, except?: Veh) => !vehs.some((o) => o !== except && Math.abs(o.z - laneZ(dir)) < 0.85 && o.x > x0 && o.x < x1);
  const maneuvering = (except: Veh) => vehs.some((o) => o !== except && (o.state === 'toBay' || o.state === 'leave'));

  function spawnVehicles(dt: number, hour: number) {
    for (const dir of [1, -1] as const) {
      spawnAcc[dir] += trafficRate(hour) * dt * (0.7 + Math.random() * 0.6);
      if (spawnAcc[dir] < 1) continue;
      const x = dir > 0 ? T0 : T1;
      if (!laneFree(dir, x - 9, x + 9)) continue;
      spawnAcc[dir] -= 1;
      const r = Math.random();
      const day = hour > 6 && hour < 20.5;
      const kind: Kind = r < 0.08 && day ? 'bike' : r < 0.11 && day ? 'tractor' : r < 0.25 ? 'van' : 'car';
      const v = addVehicle(kind, dir, x);
      // certains clients viennent en voiture et se garent devant l'étal
      if (dir < 0 && (kind === 'car' || kind === 'van') && hour > 7.5 && hour < 19.5 && Math.random() < 0.22) {
        const free = bays.map((b, i) => (b ? -1 : i)).filter((i) => i >= 0);
        if (free.length) {
          v.bay = free[Math.floor(Math.random() * free.length)];
          bays[v.bay] = v;
        }
      }
    }
    // le car du village, de l'arrêt du Bourg vers l'est
    busT -= dt;
    if (busT <= 0) {
      busT = 80 + Math.random() * 50;
      if (hour > 6.3 && hour < 20.8 && laneFree(1, T0 - 9, T0 + 12)) addVehicle('bus', 1, T0);
    }
  }

  function driveVehicle(v: Veh, dt: number, crossBusy: boolean) {
    const lz = laneZ(v.dir);
    let gap = Infinity;
    let leadV = 0;
    let bikeNear = false;
    for (const o of vehs) {
      if (o === v || Math.abs(o.z - lz) > 0.8) continue;
      const d = (o.x - v.x) * v.dir;
      // on double les vélos en se décalant dans sa voie
      if (o.kind === 'bike' && v.kind !== 'bike' && o.state === 'drive') {
        if (d > -1.2 && d < v.len / 2 + 2.2) bikeNear = true;
        continue;
      }
      if (d <= 0) continue;
      const gp = d - (v.len + o.len) / 2;
      if (gp < gap) {
        gap = gp;
        leadV = o.state === 'drive' && o.dir === v.dir ? o.v : 0;
      }
    }
    // on laisse traverser les piétons
    if (crossBusy) {
      const d = (CROSS_X - v.x) * v.dir - 1.0 - v.len / 2;
      if (d > -0.4) gap = Math.min(gap, d + 0.9);
    }
    let cap = v.vmax;
    // le car marque l'arrêt
    if (v.kind === 'bus' && !v.served) {
      const d = (BUS_X - v.x) * v.dir;
      if (d > -0.3) {
        gap = Math.min(gap, d + 0.9);
        if (d < 0.25 && v.v < 0.2) {
          v.served = true;
          v.dwell = 4 + Math.random() * 2;
          for (let k = Math.floor(Math.random() * 3); k > 0; k--) spawnWalker('bus');
        }
      }
    }
    if (v.dwell > 0) {
      v.dwell -= dt;
      cap = 0;
    }
    // client qui se gare : il ralentit avant de tourner
    if (v.bay >= 0) {
      const tp = BAYS[v.bay] + 3.2;
      const d = (tp - v.x) * v.dir;
      if (maneuvering(v)) gap = Math.min(gap, d + 0.9);
      else cap = Math.min(cap, 1.8 + Math.sqrt(2 * 3 * Math.max(0, d)));
      if (d <= 0.05 && !maneuvering(v)) {
        v.state = 'toBay';
        v.t = 0;
        v.p0 = [v.x, v.z];
        return;
      }
    }
    const desired = Math.max(0, Math.min(cap, leadV + 1.1 * (gap - 0.9 - leadV * 0.7)));
    if (desired < v.v) v.v = Math.max(desired, v.v - 9 * dt);
    else v.v = Math.min(desired, v.v + 2.4 * dt);
    v.x += v.dir * v.v * dt;
    v.swerve += ((bikeNear ? 0.3 : 0) - v.swerve) * Math.min(1, dt * 3);
    v.z = v.kind === 'bike' ? lz + v.dir * 0.5 : lz - v.dir * v.swerve;
    v.g.rotation.y = v.dir > 0 ? 0 : Math.PI;
  }

  function step(dt: number, hour: number) {
    spawnVehicles(dt, hour);
    const crossBusy = walkers.some((w) => w.crossing);
    for (const v of [...vehs]) {
      if (v.state === 'drive') {
        driveVehicle(v, dt, crossBusy);
        if ((v.dir > 0 && v.x > T1 + 5) || (v.dir < 0 && v.x < T0 - 5)) removeVehicle(v);
      } else if (v.state === 'toBay') {
        const bx = BAYS[v.bay];
        const [ax, az] = v.p0;
        v.t = Math.min(1, v.t + (dt * 1.7) / 6);
        v.x = bez(ax, bx, bx, v.t);
        v.z = bez(az, az, BAY_Z, v.t);
        v.g.rotation.y = Math.atan2(-bezD(az, az, BAY_Z, v.t), bezD(ax, bx, bx, v.t));
        if (v.t >= 1) {
          v.state = 'parked';
          v.t = 25 + Math.random() * 35;
          v.v = 0;
        }
      } else if (v.state === 'parked') {
        v.t -= dt;
        const bx = BAYS[v.bay];
        if (v.t <= 0 && !maneuvering(v) && laneFree(-1, bx - 3, bx + 14, v) && laneFree(1, bx - 16, bx + 3, v)) {
          v.state = 'leave';
          v.t = 0;
        }
      } else {
        // marche arrière jusque dans la voie vers l'est, puis il repart
        const bx = BAYS[v.bay];
        v.t = Math.min(1, v.t + (dt * 1.3) / 7.5);
        v.x = bez(bx, bx, bx - 2.6, v.t);
        v.z = bez(BAY_Z, LANE_E, LANE_E, v.t);
        v.g.rotation.y = Math.atan2(bezD(BAY_Z, LANE_E, LANE_E, v.t), -bezD(bx, bx, bx - 2.6, v.t));
        if (v.t >= 1) {
          bays[v.bay] = null;
          v.bay = -1;
          v.state = 'drive';
          v.dir = 1;
          v.v = 0;
          v.served = true;
        }
      }
      v.g.position.set(v.x, 0.06, v.z);
      if (v.rider) {
        v.phase += dt * v.v * 3.2;
        v.rider.legL.rotation.x = -0.9 + Math.sin(v.phase) * 0.5;
        v.rider.legR.rotation.x = -0.9 - Math.sin(v.phase) * 0.5;
      }
    }
    stepWalkers(dt, hour);
  }

  // ------------------------------------------------------ Passants ----
  const sideLane = (z: number, dir: 1 | -1) => z + dir * 0.22;
  function spawnWalker(from?: 'bus') {
    const r = Math.random();
    const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    const start = dir > 0 ? X0 : X1;
    const end = dir > 0 ? X1 : X0;
    const PLAZA = SZ + 8.2;
    let pts: Array<[number, number]>;
    let crossFrom = -1;
    if (from === 'bus') {
      pts = [
        [BUS_X + 1.4 + Math.random() * 0.4, SZ - 0.35],
        [BUS_X + 1.6, sideLane(SZ, dir)],
        [end, sideLane(SZ, dir)],
      ];
    } else if (r < 0.42) {
      pts = [
        [start, sideLane(SZ, dir)],
        [end, sideLane(SZ, dir)],
      ];
    } else if (r < 0.62) {
      pts = [
        [CROSS_X + 0.4, PLAZA],
        [CROSS_X + 0.4, sideLane(SZ, dir)],
        [end, sideLane(SZ, dir)],
      ];
    } else if (r < 0.78) {
      pts = [
        [start, sideLane(SZ, dir)],
        [CROSS_X - 0.4, sideLane(SZ, dir)],
        [CROSS_X - 0.4, PLAZA],
      ];
    } else if (r < 0.89) {
      // de la ruelle vers le trottoir de la ferme
      pts = [
        [CROSS_X + 0.3, PLAZA],
        [CROSS_X + 0.3, SZ - 0.45],
        [CROSS_X + 0.3, WZ + 0.45],
        [CROSS_X + 0.3, sideLane(WZ, dir)],
        [end, sideLane(WZ, dir)],
      ];
      crossFrom = 1;
    } else {
      pts = [
        [start, sideLane(WZ, dir)],
        [CROSS_X - 0.3, sideLane(WZ, dir)],
        [CROSS_X - 0.3, WZ + 0.45],
        [CROSS_X - 0.3, SZ - 0.45],
        [CROSS_X - 0.3, PLAZA],
      ];
      crossFrom = 2;
    }
    const p = createPerson(Math.floor(Math.random() * 64));
    p.basket.visible = Math.random() < 0.25;
    group.add(p.root);
    walkers.push({ p, pts, i: 1, x: pts[0][0], z: pts[0][1], sp: 1.0 + Math.random() * 0.35, phase: Math.random() * 6, crossFrom, crossing: false });
  }
  /** La chaussée est-elle libre aux abords du passage piéton ? */
  const roadClear = () =>
    !vehs.some((o) => {
      if (o.state !== 'drive') return Math.abs(o.x - CROSS_X) < 4;
      const d = (CROSS_X - o.x) * o.dir;
      return (d > -o.len / 2 - 0.9 && d < 2.5) || (d >= 2.5 && d < 11 && o.v > 0.5);
    });
  function stepWalkers(dt: number, hour: number) {
    walkAcc += walkerRate(hour) * dt;
    if (walkAcc >= 1) {
      walkAcc -= 1;
      if (walkers.length < 18) spawnWalker();
    }
    for (const w of [...walkers]) {
      const [tx, tz] = w.pts[w.i];
      if (w.i === w.crossFrom + 1 && !w.crossing) {
        if (!roadClear()) {
          w.p.legL.rotation.x = w.p.legR.rotation.x = 0;
          continue;
        }
        w.crossing = true;
      }
      const dx = tx - w.x;
      const dz = tz - w.z;
      const d = Math.hypot(dx, dz);
      const stepLen = w.sp * dt * (w.crossing ? 1.25 : 1);
      if (d <= stepLen) {
        w.x = tx;
        w.z = tz;
        if (w.crossing && w.i === w.crossFrom + 1) w.crossing = false;
        w.i++;
        if (w.i >= w.pts.length) {
          group.remove(w.p.root);
          walkers.splice(walkers.indexOf(w), 1);
          continue;
        }
      } else {
        w.x += (dx / d) * stepLen;
        w.z += (dz / d) * stepLen;
        w.p.root.rotation.y = Math.atan2(dx, dz);
      }
      w.phase += dt * 8 * w.sp;
      const sw = Math.sin(w.phase) * 0.5;
      w.p.legL.rotation.x = sw;
      w.p.legR.rotation.x = -sw;
      w.p.root.position.set(w.x, 0.06, w.z);
    }
  }

  function parkNow(i: number) {
    const v = addVehicle(Math.random() < 0.8 ? 'car' : 'van', -1, BAYS[i]);
    v.bay = i;
    bays[i] = v;
    v.state = 'parked';
    v.x = BAYS[i];
    v.z = BAY_Z;
    v.v = 0;
    v.t = 5 + Math.random() * 40;
    v.g.rotation.y = Math.PI / 2;
    v.g.position.set(v.x, 0.06, v.z);
  }

  return {
    update(dt, hour, day) {
      if (!warmed) {
        // la rue est déjà animée quand on arrive : quelques minutes simulées d'un coup
        warmed = true;
        for (let i = 0; i < 360; i++) step(0.25, hour);
        if (hour > 8 && hour < 19) for (let i = 0; i < 3; i++) if (!bays[i] && Math.random() < 0.5) parkNow(i);
      }
      if (dt > 0) step(Math.min(dt, 0.1), hour);
      const night = 1 - day;
      lightMat.color.setScalar(0.78 + 0.22 * night);
      beamMat.opacity = night * 0.55;
      const lit = night > 0.08;
      for (const v of vehs) v.beam.visible = lit && v.state !== 'parked';
    },
  };
}
