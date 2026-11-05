// Les camions du couvoir : chaque lot de poules commandé arrive par la route dans son camion. Le
// camion roule dans la circulation comme les autres véhicules (render/street.ts : il reste derrière
// la voiture qui le précède, freine, s'arrête au passage piéton), puis se gare à sa place le long du
// trottoir, feux de détresse allumés ; un convoi (jusqu'à trois camions) se gare l'un derrière
// l'autre et les voitures le doublent quand la voie d'en face est libre. Le hayon s'abaisse, les
// poules sautent une à une et trottinent jusqu'au portail, où la simulation les prend en charge
// (horaire dans sim/deliveries.ts). Puis le camion se réinsère dans le trafic et repart.
import * as THREE from 'three';
import { BREEDS } from '../config/breeds';
import { BIRD_ORDERS } from '../config/balance';
import { TRUCK_LANE, alongPath, boardPath, boardTime, hopPath, hopTime, jumpAt, leaveAt, rampProgress, truckStopX, unloadEnd } from '../sim/deliveries';
import type { Street } from './street';
import type { BreedId, Delivery, GameState } from '../sim/types';
import { C, box, cyl, merge, mesh, sph } from './geo';
import { ADULT_STAGE, HEN_MAT, HEN_PIVOT, henGeometryMid, textPanel } from './models';

function truckModel() {
  const g = new THREE.Group();
  const wheel = (x: number, z: number) => [cyl(0.22, 0.22, 0.14, 12, 0x2b2b31, [x, 0.22, z], [Math.PI / 2, 0, 0]), cyl(0.11, 0.11, 0.15, 8, 0xc9ccd1, [x, 0.22, z], [Math.PI / 2, 0, 0])];
  const parts = [
    // cabine (avant vers +x)
    box(0.9, 0.85, 1.06, C.white, [1.25, 0.72, 0]),
    box(0.92, 0.12, 1.08, 0x2f6bff, [1.25, 0.36, 0]),
    box(0.05, 0.38, 0.92, 0x9fc4dc, [1.71, 0.9, 0]),
    box(0.5, 0.32, 1.08, 0x9fc4dc, [1.35, 0.92, 0]),
    box(0.08, 0.1, 1.06, 0x55585f, [1.72, 0.4, 0]),
    // châssis et plateau
    box(2.3, 0.14, 1.0, 0x55585f, [-0.2, 0.36, 0]),
    box(2.0, 0.08, 1.1, C.woodDark, [-0.45, 0.48, 0]),
    ...wheel(1.15, 0.5),
    ...wheel(1.15, -0.5),
    ...wheel(-0.85, 0.5),
    ...wheel(-0.85, -0.5),
  ];
  // ridelles à claire-voie
  for (const z of [-0.53, 0.53]) for (let y = 0.6; y < 1.25; y += 0.16) parts.push(box(2.0, 0.07, 0.04, C.wood, [-0.45, y, z]));
  for (const x of [-1.42, -0.45, 0.52]) for (const z of [-0.53, 0.53]) parts.push(box(0.06, 0.8, 0.06, C.woodDark, [x, 0.9, z]));
  parts.push(box(0.04, 0.7, 1.1, C.woodDark, [0.53, 0.88, 0]));
  // cageots de poules empilés, quelques têtes qui dépassent
  for (let i = 0; i < 6; i++) {
    const x = -1.15 + (i % 3) * 0.55;
    const y = 0.64 + Math.floor(i / 3) * 0.3;
    parts.push(box(0.48, 0.26, 0.9, 0xd9b77a, [x, y, 0]));
    parts.push(sph(0.07, 6, 5, i % 2 ? 0xb5652e : C.white, [x, y + 0.17, 0.2]));
    parts.push(box(0.03, 0.04, 0.03, 0xd9534f, [x, y + 0.24, 0.2]));
  }
  // panneau du couvoir
  parts.push(box(0.04, 0.22, 0.8, 0xf0c94a, [1.71, 1.24, 0]));
  g.add(mesh(merge(parts)));
  // hayon arrière (charnière en bas) : il s'abaisse en rampe pendant le déchargement
  const gate = new THREE.Group();
  gate.position.set(-1.47, 0.5, 0);
  const plank = mesh(merge([box(0.05, 0.7, 1.04, C.wood, [0, 0.35, 0]), box(0.06, 0.06, 1.06, C.woodDark, [0, 0.68, 0]), box(0.06, 0.06, 1.06, C.woodDark, [0, 0.05, 0])]));
  gate.add(plank);
  g.add(gate);
  // feux de détresse (ils clignotent à l'arrêt)
  const blinkMat = new THREE.MeshBasicMaterial({ color: 0xf0a33a });
  const blink = new THREE.Group();
  for (const [x, z] of [
    [1.72, 0.45],
    [1.72, -0.45],
    [-1.47, 0.45],
    [-1.47, -0.45],
  ])
    blink.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.12), blinkMat).translateX(x).translateY(0.5).translateZ(z));
  g.add(blink);
  return { g, blink, gate };
}

/**
 * Le camion des revendeurs : une caisse fermée, on ne voit rien de ce qu'elle contient. À l'arrière, un
 * rideau qui se relève sur un intérieur sombre, et un hayon à plancher qui s'abaisse en rampe.
 */
function bigTruckModel() {
  const g = new THREE.Group();
  const wheel = (x: number, z: number) => [cyl(0.25, 0.25, 0.16, 12, 0x2b2b31, [x, 0.25, z], [Math.PI / 2, 0, 0]), cyl(0.13, 0.13, 0.17, 8, 0xc9ccd1, [x, 0.25, z], [Math.PI / 2, 0, 0])];
  const COL = 0x2f6f4e;
  const BODY = 0xf3efe6;
  const parts = [
    // cabine (avant vers +x)
    box(1.05, 1.15, 1.26, COL, [2.0, 0.92, 0]),
    box(1.07, 0.14, 1.28, BODY, [2.0, 0.5, 0]),
    box(0.05, 0.46, 1.08, 0x9fc4dc, [2.53, 1.14, 0]),
    box(0.6, 0.38, 1.28, 0x9fc4dc, [2.1, 1.16, 0]),
    box(0.08, 0.12, 1.26, 0x55585f, [2.54, 0.45, 0]),
    box(0.9, 0.34, 1.16, BODY, [1.85, 1.66, 0]),
    // châssis, marchepied, garde-boue
    box(4.9, 0.16, 1.1, 0x55585f, [-0.1, 0.42, 0]),
    box(0.46, 0.05, 1.34, 0x3a3d43, [1.82, 0.34, 0]),
    ...wheel(2.0, 0.56),
    ...wheel(2.0, -0.56),
    ...wheel(-1.5, 0.56),
    ...wheel(-1.5, -0.56),
    ...wheel(-2.1, 0.56),
    ...wheel(-2.1, -0.56),
    box(1.34, 0.05, 1.3, 0x3a3d43, [-1.8, 0.56, 0]),
    // la caisse, entièrement fermée
    box(4.0, 1.42, 1.34, BODY, [-0.65, 1.29, 0]),
    box(4.04, 0.05, 1.38, 0xd8d2c4, [-0.65, 2.02, 0]),
    box(4.02, 0.28, 1.36, COL, [-0.65, 0.76, 0]),
    box(4.02, 0.05, 1.36, COL, [-0.65, 1.92, 0]),
  ];
  // nervures de la caisse, fentes d'aération tout en haut
  for (let x = -2.45; x < 1.3; x += 0.48) for (const z of [-0.675, 0.675]) parts.push(box(0.03, 1.42, 0.012, 0xe2dccd, [x, 1.29, z]));
  for (let x = -2.2; x < 1.2; x += 0.32) for (const z of [-0.678, 0.678]) parts.push(box(0.2, 0.035, 0.012, 0x6d6a62, [x, 1.78, z]));
  // l'arrière : cadre et intérieur sombre
  parts.push(box(0.03, 1.2, 1.14, 0x17140f, [-2.66, 1.28, 0]));
  parts.push(box(0.05, 1.42, 0.09, 0xd8d2c4, [-2.67, 1.29, 0.625]), box(0.05, 1.42, 0.09, 0xd8d2c4, [-2.67, 1.29, -0.625]), box(0.05, 0.1, 1.34, 0xd8d2c4, [-2.67, 1.94, 0]));
  // feux
  for (const z of [-0.55, 0.55]) parts.push(box(0.03, 0.09, 0.2, 0xc8352d, [-2.69, 0.56, z]));
  const body = mesh(merge(parts));
  g.add(body);
  // l'enseigne peinte sur les flancs de la caisse
  for (const z of [0.684, -0.684]) {
    const sign = textPanel('VOLAILLES VIVANTES', 2.6, 0.42, BODY, '#2f6f4e');
    sign.position.set(-0.65, 1.34, z);
    if (z < 0) sign.rotation.y = Math.PI;
    g.add(sign);
  }
  // le rideau : il remonte sous le toit (pivot en haut)
  const door = new THREE.Group();
  door.position.set(-2.69, 1.89, 0);
  const slats: THREE.BufferGeometry[] = [box(0.03, 1.2, 1.14, 0xe7e1d2, [0, -0.6, 0])];
  for (let k = 1; k < 8; k++) slats.push(box(0.035, 0.014, 1.14, 0xbdb7a8, [0, -k * 0.15, 0]));
  door.add(mesh(merge(slats)));
  g.add(door);
  // le hayon : il pivote sur le plancher de la caisse et se pose au sol
  const L = 1.25;
  const gate = new THREE.Group();
  gate.position.set(-2.72, 0.6, 0);
  const ramp: THREE.BufferGeometry[] = [box(0.05, L, 1.12, 0x8a6a48, [0, L / 2, 0])];
  for (let k = 0; k < 7; k++) ramp.push(box(0.03, 0.03, 1.08, 0xc9a26b, [0.035, 0.1 + k * 0.17, 0]));
  for (const z of [-0.56, 0.56]) ramp.push(box(0.14, L, 0.035, 0x55585f, [0.06, L / 2, z]));
  gate.add(mesh(merge(ramp)));
  g.add(gate);
  const blinkMat = new THREE.MeshBasicMaterial({ color: 0xf0a33a });
  const blink = new THREE.Group();
  for (const [x, z] of [
    [2.54, 0.5],
    [2.54, -0.5],
    [-2.7, 0.42],
    [-2.7, -0.42],
  ])
    blink.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.12), blinkMat).translateX(x).translateY(0.56).translateZ(z));
  g.add(blink);
  return { g, blink, gate, door };
}

/** Le grand portail à deux battants, au bout du chemin de terre (il s'ouvre vers l'enclos). */
function yardGate(scene: THREE.Object3D) {
  const leaf = () => {
    const W = 0.92;
    const parts: THREE.BufferGeometry[] = [];
    for (const y of [0.16, 0.5, 0.92]) parts.push(box(W, 0.07, 0.05, C.woodDark, [W / 2, y, 0]));
    for (const x of [0.03, W - 0.03]) parts.push(box(0.07, 0.86, 0.06, C.woodDark, [x, 0.54, 0]));
    for (let k = 0; k < 5; k++) parts.push(box(0.1, 0.78, 0.03, C.wood, [0.12 + k * 0.17, 0.54, 0]));
    const diag = Math.hypot(W, 0.76);
    parts.push(box(diag, 0.06, 0.04, C.woodDark, [W / 2, 0.54, 0.03], [0, 0, Math.atan2(0.76, W)]));
    for (const y of [0.2, 0.86]) parts.push(box(0.26, 0.03, 0.07, 0x3a3d43, [0.13, y, 0.012]));
    return mesh(merge(parts));
  };
  const posts: THREE.BufferGeometry[] = [];
  for (const x of [-0.04, 2.04]) posts.push(box(0.2, 1.22, 0.2, C.woodDark, [x, 0.71, 30]), box(0.26, 0.05, 0.26, 0x8e939b, [x, 1.34, 30]));
  const fixed = mesh(merge(posts));
  const a = leaf();
  const b = leaf();
  a.position.set(0.05, 0.1, 30);
  b.position.set(1.95, 0.1, 30);
  b.rotation.y = Math.PI;
  scene.add(fixed, a, b);
  return (open: number) => {
    a.rotation.y = (open * Math.PI) / 2;
    b.rotation.y = Math.PI - (open * Math.PI) / 2;
  };
}

/** Le chemin du camion, de la route jusqu'à sa place dans l'enclos : un virage, puis tout droit. */
function truckRoute() {
  const X0 = BIRD_ORDERS.stopX;
  const X1 = BIRD_ORDERS.laneX;
  const Z0 = TRUCK_LANE;
  const Z1 = 34.5;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const u = 1 - t;
    pts.push([u * u * X0 + 2 * u * t * X1 + t * t * X1, u * u * Z0 + 2 * u * t * Z0 + t * t * Z1]);
  }
  pts.push([X1, BIRD_ORDERS.rearZ - BIRD_ORDERS.tail]);
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = lens[lens.length - 1];
  const at = (s: number) => {
    const d = Math.max(0, Math.min(total, s));
    let i = 1;
    while (i < lens.length - 1 && lens[i] < d) i++;
    const k = (d - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
    const dx = pts[i][0] - pts[i - 1][0];
    const dz = pts[i][1] - pts[i - 1][1];
    return { x: pts[i - 1][0] + dx * k, z: pts[i - 1][1] + dz * k, heading: Math.atan2(-dz, dx) };
  };
  // il attend ici, nez dans le chemin, que la route soit libre pour ressortir à reculons
  let wait = 0;
  while (wait < total && at(wait).z > 36.2) wait += 0.1;
  return { total, at, wait };
}

/** Une poule ou une oie d'un seul tenant (celles des parcs de l'animalerie). */
const puppetGeo = new Map<string, THREE.BufferGeometry>();
export function henSolidGeometry(breed: BreedId, skin = 0) {
  const key = `${breed}:${skin}`;
  let g = puppetGeo.get(key);
  if (!g) {
    const h = henGeometryMid(breed, 'hen', ADULT_STAGE, skin);
    const at = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => geo.clone().translate(x, y, z);
    g = merge([
      at(h.body, 0, HEN_PIVOT.body, 0),
      at(h.head, HEN_PIVOT.neck[0], HEN_PIVOT.neck[1], HEN_PIVOT.neck[2]),
      at(h.eyes, HEN_PIVOT.neck[0], HEN_PIVOT.neck[1], HEN_PIVOT.neck[2]),
      at(h.wingL, HEN_PIVOT.wing[0], HEN_PIVOT.wing[1], HEN_PIVOT.wing[2]),
      at(h.wingR, -HEN_PIVOT.wing[0], HEN_PIVOT.wing[1], HEN_PIVOT.wing[2]),
      at(h.leg, HEN_PIVOT.hip[0], HEN_PIVOT.hip[1], HEN_PIVOT.hip[2]),
      at(h.leg, -HEN_PIVOT.hip[0], HEN_PIVOT.hip[1], HEN_PIVOT.hip[2]),
    ]);
    puppetGeo.set(key, g);
  }
  return g;
}

/** Poule qui trottine du camion au portail (rendu seul ; la simulation la crée au portail). */
interface Walker {
  root: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
}
const walkerGeo = new Map<BreedId, { body: THREE.BufferGeometry; leg: THREE.BufferGeometry }>();
function makeWalker(breed: BreedId): Walker {
  let g = walkerGeo.get(breed);
  if (!g) {
    const h = henGeometryMid(breed, 'hen', ADULT_STAGE, 0);
    const at = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => geo.clone().translate(x, y, z);
    g = {
      body: merge([
        at(h.body, 0, HEN_PIVOT.body, 0),
        at(h.head, HEN_PIVOT.neck[0], HEN_PIVOT.neck[1], HEN_PIVOT.neck[2]),
        at(h.eyes, HEN_PIVOT.neck[0], HEN_PIVOT.neck[1], HEN_PIVOT.neck[2]),
        at(h.wingL, HEN_PIVOT.wing[0], HEN_PIVOT.wing[1], HEN_PIVOT.wing[2]),
        at(h.wingR, -HEN_PIVOT.wing[0], HEN_PIVOT.wing[1], HEN_PIVOT.wing[2]),
      ]),
      leg: h.leg,
    };
    walkerGeo.set(breed, g);
  }
  const root = new THREE.Group();
  const body = new THREE.Mesh(g.body, HEN_MAT);
  body.castShadow = true;
  const legL = new THREE.Mesh(g.leg, HEN_MAT);
  const legR = new THREE.Mesh(g.leg, HEN_MAT);
  legL.position.set(HEN_PIVOT.hip[0], HEN_PIVOT.hip[1], HEN_PIVOT.hip[2]);
  legR.position.set(-HEN_PIVOT.hip[0], HEN_PIVOT.hip[1], HEN_PIVOT.hip[2]);
  root.add(body, legL, legR);
  root.scale.setScalar(BREEDS[breed].scale);
  return { root, legL, legR };
}

export interface DeliveryTruck {
  update(s: GameState): void;
}

/**
 * Le camion entre dans la circulation assez tôt pour être garé à l'heure prévue par la simulation ;
 * ensuite c'est la rue qui le conduit (il reste derrière la voiture qui le précède, freine, se gare,
 * puis se réinsère dans le trafic quand il repart).
 */
export function buildDeliveryTruck(street: Street, world: THREE.Object3D): DeliveryTruck {
  type Truck = ReturnType<typeof truckModel>;
  interface Track {
    d: Delivery;
    truck?: Truck;
    called: boolean;
    released: boolean;
    open: number;
  }
  const tracks = new Map<number, Track>();
  const walkers = new Map<BreedId, Walker[]>();
  /** Le camion du revendeur en cours (un seul à la fois). */
  type Big = ReturnType<typeof bigTruckModel>;
  let pickup: { id: number; truck?: Big; phase: 'wait' | 'road' | 'in' | 'bay' | 'out'; s: number; open: number; held: boolean } | null = null;
  const route = truckRoute();
  const setGate = yardGate(world);
  let gate = 0;
  let scene: THREE.Object3D | null = null;
  let last = performance.now();

  const walkerAt = (breed: BreedId, i: number) => {
    let list = walkers.get(breed);
    if (!list) walkers.set(breed, (list = []));
    while (list.length <= i) {
      const w = makeWalker(breed);
      w.root.visible = false;
      scene?.add(w.root);
      list.push(w);
    }
    return list[i];
  };

  return {
    update(s) {
      const now = performance.now();
      const rdt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = s.clock.t;
      const spd = s.clock.speed;
      for (const d of s.deliveries) {
        const tr = tracks.get(d.id);
        if (tr) tr.d = { ...d };
        else tracks.set(d.id, { d: { ...d }, called: false, released: false, open: 0 });
      }
      const used = new Map<BreedId, number>();
      for (const [id, tr] of tracks) {
        const d = tr.d;
        const slot = d.slot ?? 0;
        const leave = leaveAt(d);
        if (!tr.called) {
          // trop tard pour le voir passer (jeu très accéléré, partie rechargée) : on l'oublie
          if (t > leave || !s.deliveries.some((x) => x.id === id)) {
            if (t > leave) tracks.delete(id);
            continue;
          }
          // le convoi garde son ordre : un camion n'entre qu'après celui qui le précède
          const before = [...tracks.values()].some((o) => o !== tr && (o.d.wave ?? 0) === (d.wave ?? 0) && (o.d.slot ?? 0) < slot && !o.called);
          if (spd > 0 && !before) {
            // temps qu'il reste, compté au rythme de la rue (elle va au plus 2× plus vite que nature)
            const remain = ((d.eta - t) * Math.min(2, spd)) / spd;
            const ahead = Math.max(12, Math.min(75, (remain - 1) * 4.6));
            if ((remain - 1) * 4.6 <= 75) {
              const truck = truckModel();
              if (street.callDelivery(id, truck.g, 3.4, truckStopX(slot), ahead)) {
                tr.truck = truck;
                tr.called = true;
              }
            }
          }
        }
        const st = tr.called ? street.delivery(id) : null;
        if (tr.called && !st) {
          // sorti de la route : livraison terminée côté rendu
          if (tr.released || t > leave) tracks.delete(id);
          continue;
        }
        if (tr.called && !tr.released && t >= leave) {
          street.releaseDelivery(id);
          tr.released = true;
        }
        if (tr.truck && st) {
          tr.truck.blink.visible = st.parked && Math.floor(now / 420) % 2 === 0;
          // hayon : il s'abaisse à l'arrêt, se relève quand la dernière poule est descendue
          const want = st.parked && t >= d.eta - 0.2 && t < unloadEnd(d) - 0.3 ? 1 : 0;
          tr.open += (want - tr.open) * Math.min(1, rdt * 3.5);
          tr.truck.gate.rotation.z = tr.open * 1.95;
          if (!scene) scene = tr.truck.g.parent;
        }
        // poules en route vers le portail
        const path = hopPath(slot);
        const dur = hopTime(slot);
        for (let i = 0; i < d.count; i++) {
          const j = jumpAt(d, i);
          if (t < j || t > j + dur || !scene) continue;
          const n = used.get(d.breed) ?? 0;
          used.set(d.breed, n + 1);
          const w = walkerAt(d.breed, n);
          const k = (t - j) / dur;
          const p = alongPath(path, k);
          // saut du hayon au début, puis trot sautillant
          const jump = k < 0.08 ? Math.sin((k / 0.08) * Math.PI) * 0.35 + (1 - k / 0.08) * 0.45 : 0;
          const step = (t - j) * 13 + i;
          w.root.visible = true;
          w.root.position.set(p.x, 0.07 + jump + Math.abs(Math.sin(step)) * 0.035, p.z);
          w.root.rotation.y = Math.atan2(p.dx, p.dz);
          w.legL.rotation.x = Math.sin(step) * 0.7;
          w.legR.rotation.x = -Math.sin(step) * 0.7;
        }
      }
      // ---- le camion du revendeur : il tourne dans le chemin de terre, passe le grand portail, s'arrête
      // dans l'enclos, abaisse sa rampe... puis ressort à reculons quand tout le monde est à bord
      const L = s.birdLoad;
      if (L && (!pickup || pickup.id !== L.id)) {
        pickup = { id: L.id, phase: 'wait', s: 0, open: 0, held: false };
        // partie rechargée en plein chargement : il est déjà sur place
        if (t > L.eta + 1) {
          pickup.truck = bigTruckModel();
          world.add(pickup.truck.g);
          pickup.phase = 'bay';
          pickup.s = route.total;
        }
      }
      let gateWant = 0;
      if (pickup) {
        const P = pickup;
        const still = !!L && L.id === P.id;
        const pace = rdt * Math.min(3, spd);
        const speed = (toEnd: number, fromStart: number) => 2.4 * pace * Math.max(0.25, Math.min(1, (Math.min(toEnd, fromStart) + 0.4) / 1.8));
        if (P.phase === 'wait') {
          if (!still) pickup = null;
          else if (spd > 0) {
            const remain = ((L!.eta - t) * Math.min(2, spd)) / spd;
            if ((remain - 1) * 4.6 <= 75) {
              const truck = bigTruckModel();
              const ahead = Math.max(14, Math.min(75, (remain - 1) * 4.6));
              if (street.callDelivery(P.id, truck.g, 5.4, BIRD_ORDERS.stopX, ahead)) {
                P.truck = truck;
                P.phase = 'road';
              }
            }
          }
        } else if (P.phase === 'road') {
          const st = street.delivery(P.id);
          if (!st) pickup = null;
          else if (!still) {
            street.releaseDelivery(P.id);
            pickup = null;
          } else if (st.parked) {
            street.detachDelivery(P.id);
            world.add(P.truck!.g);
            P.held = true;
            P.phase = 'in';
          }
        } else if (P.phase === 'in') {
          P.s = Math.min(route.total, P.s + speed(route.total - P.s, P.s));
          if (P.held && route.at(P.s).z < 37.2) {
            street.freeLane(P.id);
            P.held = false;
          }
          if (P.s >= route.total) P.phase = 'bay';
        } else if (P.phase === 'bay') {
          if (!still && P.open < 0.02) P.phase = 'out';
        } else if (P.phase === 'out') {
          // à reculons jusqu'au bord de la route, puis il attend que la voie soit libre
          if (P.s > route.wait || P.held) {
            P.s = Math.max(0, P.s - speed(P.s, route.total - P.s));
            if (P.s <= 0) {
              street.freeLane(P.id);
              street.resumeDelivery(P.id, P.truck!.g, 5.4, BIRD_ORDERS.stopX);
              pickup = null;
            }
          } else if (street.laneClear(BIRD_ORDERS.stopX - 8, BIRD_ORDERS.stopX + 22) && pace > 0) {
            street.holdLane(P.id, BIRD_ORDERS.stopX, 5.4);
            P.held = true;
          }
        }
        // la simulation attend qu'il soit garé pour faire monter les volailles
        if (still) L!.late = P.phase !== 'bay';
        if (pickup && P.truck) {
          if (!scene) scene = P.truck.g.parent;
          const moving = P.phase === 'in' || P.phase === 'bay' || P.phase === 'out';
          if (moving) {
            const q = route.at(P.s);
            const up = Math.max(0, Math.min(1, (31 - q.z) / 2.6));
            P.truck.g.position.set(q.x, 0.06 + 0.04 * up, q.z);
            P.truck.g.rotation.y = q.heading;
            if (q.z < 36.2 && q.z > BIRD_ORDERS.rearZ - BIRD_ORDERS.tail + 2.2) gateWant = 1;
          }
          P.truck.blink.visible = (P.phase === 'road' ? !!street.delivery(P.id)?.parked : P.phase === 'bay' || P.phase === 'out') && Math.floor(now / 420) % 2 === 0;
          const open = P.phase === 'bay' && still && gate < 0.04 && (L!.leave === undefined || t < L!.leave - BIRD_ORDERS.closeUp * 0.5) ? 1 : 0;
          P.open += (open - P.open) * Math.min(1, rdt * 2.6 * Math.max(1, Math.min(3, spd)));
          if (P.open < 0.004) P.open = 0;
          P.truck.gate.rotation.z = P.open * 2.07;
          P.truck.door.scale.y = 1 - P.open * 0.92;
        }
      }
      gate += (gateWant - gate) * Math.min(1, rdt * 3.4 * Math.max(1, Math.min(3, spd)));
      if (gate < 0.004 && !gateWant) gate = 0;
      setGate(gate);
      if (L) {
        // volailles qui montent : elles rejoignent le pied de la rampe, grimpent et disparaissent dans le noir
        for (let i = 0; i < L.gone.length; i++) {
          const q = L.gone[i];
          const dur = boardTime(q.x, q.z);
          if (t < q.t || t > q.t + dur) continue;
          const n = used.get(q.breed) ?? 0;
          used.set(q.breed, n + 1);
          if (!scene) scene = world;
          const w = walkerAt(q.breed, n);
          const k = (t - q.t) / dur;
          const p = alongPath(boardPath(q.x, q.z), k);
          const step = (t - q.t) * 13 + i;
          w.root.visible = true;
          w.root.position.set(p.x, 0.1 + rampProgress(q.x, q.z, k) * 0.6 + Math.abs(Math.sin(step)) * 0.035, p.z);
          w.root.rotation.y = Math.atan2(p.dx, p.dz);
          w.legL.rotation.x = Math.sin(step) * 0.7;
          w.legR.rotation.x = -Math.sin(step) * 0.7;
        }
      }
      for (const [breed, list] of walkers) for (let i = used.get(breed) ?? 0; i < list.length; i++) list[i].root.visible = false;
    },
  };
}

