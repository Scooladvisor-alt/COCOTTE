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
import { alongPath, boardPath, boardTime, hopPath, hopTime, jumpAt, leaveAt, truckStopX, unloadEnd } from '../sim/deliveries';
import type { Street } from './street';
import type { BreedId, Delivery, GameState } from '../sim/types';
import { C, MAT, box, cyl, merge, mesh, sph } from './geo';
import { ADULT_STAGE, HEN_MAT, HEN_PIVOT, henGeometry } from './models';

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

/** Le grand camion des revendeurs : long plateau à ridelles, les cageots s'y empilent au chargement. */
function bigTruckModel() {
  const g = new THREE.Group();
  const wheel = (x: number, z: number) => [cyl(0.25, 0.25, 0.16, 12, 0x2b2b31, [x, 0.25, z], [Math.PI / 2, 0, 0]), cyl(0.13, 0.13, 0.17, 8, 0xc9ccd1, [x, 0.25, z], [Math.PI / 2, 0, 0])];
  const COL = 0x2f6f4e;
  const parts = [
    // cabine (avant vers +x)
    box(1.05, 1.15, 1.2, COL, [2.0, 0.92, 0]),
    box(1.07, 0.14, 1.22, 0xf3efe6, [2.0, 0.5, 0]),
    box(0.05, 0.46, 1.04, 0x9fc4dc, [2.53, 1.14, 0]),
    box(0.6, 0.38, 1.22, 0x9fc4dc, [2.1, 1.16, 0]),
    box(0.08, 0.12, 1.2, 0x55585f, [2.54, 0.45, 0]),
    box(0.9, 0.18, 1.1, 0xf3efe6, [1.9, 1.6, 0]),
    // châssis et plateau
    box(4.9, 0.16, 1.1, 0x55585f, [-0.1, 0.42, 0]),
    box(4.0, 0.08, 1.24, C.woodDark, [-0.65, 0.54, 0]),
    ...wheel(2.0, 0.56),
    ...wheel(2.0, -0.56),
    ...wheel(-1.5, 0.56),
    ...wheel(-1.5, -0.56),
    ...wheel(-2.1, 0.56),
    ...wheel(-2.1, -0.56),
  ];
  // ridelles à claire-voie, poteaux, bandeau peint
  for (const z of [-0.6, 0.6]) for (let y = 0.68; y < 1.6; y += 0.17) parts.push(box(4.0, 0.08, 0.04, C.wood, [-0.65, y, z]));
  for (const x of [-2.62, -1.65, -0.65, 0.35, 1.34]) for (const z of [-0.6, 0.6]) parts.push(box(0.07, 1.14, 0.07, C.woodDark, [x, 1.1, z]));
  parts.push(box(0.05, 1.1, 1.24, C.woodDark, [1.36, 1.08, 0]));
  for (const z of [-0.625, 0.625]) parts.push(box(2.2, 0.2, 0.012, COL, [-0.65, 1.1, z]));
  g.add(mesh(merge(parts)));
  // les cageots, qui apparaissent à mesure du chargement
  const crates: THREE.Object3D[] = [];
  const crate = merge([box(0.62, 0.3, 1.0, 0xd9b77a, [0, 0, 0]), box(0.64, 0.03, 1.02, 0xb08a52, [0, 0.1, 0]), box(0.64, 0.03, 1.02, 0xb08a52, [0, -0.08, 0])]);
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(crate, MAT);
      c.castShadow = true;
      c.position.set(1.0 - i * 0.66, 0.74 + row * 0.32, 0);
      c.visible = false;
      g.add(c);
      crates.push(c);
    }
  const gate = new THREE.Group();
  gate.position.set(-2.66, 0.56, 0);
  gate.add(mesh(merge([box(0.05, 0.78, 1.18, C.wood, [0, 0.39, 0]), box(0.06, 0.06, 1.2, C.woodDark, [0, 0.76, 0]), box(0.06, 0.06, 1.2, C.woodDark, [0, 0.05, 0])])));
  g.add(gate);
  const blinkMat = new THREE.MeshBasicMaterial({ color: 0xf0a33a });
  const blink = new THREE.Group();
  for (const [x, z] of [
    [2.54, 0.5],
    [2.54, -0.5],
    [-2.66, 0.5],
    [-2.66, -0.5],
  ])
    blink.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.12), blinkMat).translateX(x).translateY(0.56).translateZ(z));
  g.add(blink);
  return { g, blink, gate, crates };
}

/** Une poule ou une oie immobile, d'un seul tenant (celles de la vitrine de l'animalerie). */
const puppetGeo = new Map<string, THREE.BufferGeometry>();
export function henPuppet(breed: BreedId, skin = 0) {
  const key = `${breed}:${skin}`;
  let g = puppetGeo.get(key);
  if (!g) {
    const h = henGeometry(breed, 'hen', ADULT_STAGE, skin);
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
  const m = new THREE.Mesh(g, HEN_MAT);
  m.castShadow = true;
  return m;
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
    const h = henGeometry(breed, 'hen', ADULT_STAGE, 0);
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
export function buildDeliveryTruck(street: Street): DeliveryTruck {
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
  /** Le grand camion du revendeur en cours (un seul à la fois). */
  let pickup: { id: number; truck?: ReturnType<typeof bigTruckModel>; called: boolean; released: boolean; open: number; loaded: number; count: number } | null = null;
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
      // ---- le grand camion : il vient se garer devant l'animalerie, charge, et repart
      const L = s.birdLoad;
      if (L && (!pickup || pickup.id !== L.id)) pickup = { id: L.id, called: false, released: false, open: 0, loaded: 0, count: 1 };
      if (pickup) {
        const P = pickup;
        const o = L ? s.birdOrders.find((x) => x.id === L.orderId) : undefined;
        if (L && L.id === P.id) {
          P.loaded = L.loaded;
          P.count = Math.max(1, o?.count ?? 1);
        }
        const still = !!L && L.id === P.id;
        if (still && !P.called && spd > 0) {
          const remain = ((L!.eta - t) * Math.min(2, spd)) / spd;
          if ((remain - 1) * 4.6 <= 75) {
            const truck = bigTruckModel();
            const ahead = Math.max(14, Math.min(75, (remain - 1) * 4.6));
            if (street.callDelivery(P.id, truck.g, 5.4, BIRD_ORDERS.stopX, ahead)) {
              P.truck = truck;
              P.called = true;
            }
          }
        }
        const st = P.called ? street.delivery(P.id) : null;
        if (P.called && !st && (P.released || !still)) pickup = null;
        else if (!P.called && !still) pickup = null;
        else if (P.called && !P.released && (!still || L!.leave !== undefined)) {
          street.releaseDelivery(P.id);
          P.released = true;
        }
        // la circulation décide de son heure d'arrivée : on le dit à la simulation, qui l'attend
        if (still) L!.late = !st?.parked;
        if (P.truck && st) {
          P.truck.blink.visible = st.parked && Math.floor(now / 420) % 2 === 0;
          const want = st.parked && !P.released ? 1 : 0;
          P.open += (want - P.open) * Math.min(1, rdt * 3.5);
          P.truck.gate.rotation.z = P.open * 1.95;
          if (!scene) scene = P.truck.g.parent;
          const fill = Math.ceil((Math.min(1, P.loaded / P.count) * P.truck.crates.length));
          P.truck.crates.forEach((c, i) => (c.visible = i < fill));
        }
      }
      if (L && scene) {
        // volailles en route vers le camion : du portail au trottoir, puis la rampe du hayon
        for (let i = 0; i < L.gone.length; i++) {
          const q = L.gone[i];
          const dur = boardTime(q.x, q.z);
          if (t < q.t || t > q.t + dur) continue;
          const n = used.get(q.breed) ?? 0;
          used.set(q.breed, n + 1);
          const w = walkerAt(q.breed, n);
          const k = (t - q.t) / dur;
          const p = alongPath(boardPath(q.x, q.z), k);
          const hop = k > 0.9 ? ((k - 0.9) / 0.1) * 0.5 : 0;
          const step = (t - q.t) * 13 + i;
          w.root.visible = true;
          w.root.position.set(p.x, 0.07 + hop + Math.abs(Math.sin(step)) * 0.035, p.z);
          w.root.rotation.y = Math.atan2(p.dx, p.dz);
          w.legL.rotation.x = Math.sin(step) * 0.7;
          w.legR.rotation.x = -Math.sin(step) * 0.7;
        }
      }
      for (const [breed, list] of walkers) for (let i = used.get(breed) ?? 0; i < list.length; i++) list[i].root.visible = false;
    },
  };
}

