// Les camions du couvoir : chaque lot de poules commandé arrive par la route dans son camion. Le
// camion roule dans la circulation comme les autres véhicules (render/street.ts : il reste derrière
// la voiture qui le précède, freine, s'arrête au passage piéton), puis se gare à sa place le long du
// trottoir, feux de détresse allumés ; un convoi (jusqu'à trois camions) se gare l'un derrière
// l'autre et les voitures le doublent quand la voie d'en face est libre. Le hayon s'abaisse, les
// poules sautent une à une et trottinent jusqu'au portail, où la simulation les prend en charge
// (horaire dans sim/deliveries.ts). Puis le camion se réinsère dans le trafic et repart.
import * as THREE from 'three';
import { BIRD_ORDERS } from '../config/balance';
import { alongPath, hopPath, hopTime, jumpAt, leaveAt, rampProgress, routeTime, truckStopX, unloadEnd } from '../sim/deliveries';
import type { Street } from './street';
import type { BreedId, Delivery, GameState } from '../sim/types';
import { C, box, cyl, finalizeExport, merge, mesh, sph } from './geo';
import { textPanel } from './models';
import { ENTRY, BACKUP, EXIT, EXIT_WAIT, YARD_GATE } from './truckRoad';

const GLASS = 0x8fb6cc;
const RUBBER = 0x24252a;
const STEEL = 0x55585f;
const DARK = 0x33363c;
const CHROME = 0xd5d9de;

/** Volume tiré d'un profil de côté (x, y), sur toute la largeur W. */
function profile(points: Array<[number, number]>, W: number, color: number) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) shape.lineTo(x, y);
  const g = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  g.translate(0, 0, -W / 2);
  return finalizeExport(g, color, [0, 0, 0]);
}

/** Le dessous d'une carrosserie, découpé en voûte autour d'une roue (de l'avant vers l'arrière du véhicule). */
function archEdge(wx: number, wy: number, r: number, floor: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const start = Math.acos(Math.min(1, (floor - wy) / r));
  for (let k = 0; k <= 10; k++) {
    const a = start * (1 - (2 * k) / 10);
    out.push([wx + Math.sin(a) * r, wy + Math.cos(a) * r]);
  }
  return out;
}

/** Une roue complète, sur le côté `side` : pneu, jante, moyeu et ses écrous. */
function wheel(x: number, z: number, r: number, w: number) {
  const parts = [cyl(r, r, w, 18, RUBBER, [x, r, z], [Math.PI / 2, 0, 0])];
  const out = z + (Math.sign(z) * w) / 2;
  parts.push(cyl(r * 0.62, r * 0.62, 0.012, 16, 0xbfc4ca, [x, r, out], [Math.PI / 2, 0, 0]));
  parts.push(cyl(r * 0.46, r * 0.46, 0.014, 14, 0x8e939b, [x, r, out + Math.sign(z) * 0.003], [Math.PI / 2, 0, 0]));
  parts.push(cyl(r * 0.2, r * 0.2, 0.03, 10, DARK, [x, r, out + Math.sign(z) * 0.01], [Math.PI / 2, 0, 0]));
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    parts.push(box(0.016, 0.016, 0.02, CHROME, [x + Math.cos(a) * r * 0.33, r + Math.sin(a) * r * 0.33, out + Math.sign(z) * 0.008]));
  }
  return parts;
}

/** Cabine avancée (l'avant vers +x), avec son vrai passage de roue. */
function cabin(o: { x0: number; x1: number; W: number; floor: number; top: number; wx: number; r: number; col: number; trim: number; fairing?: number }) {
  const { x0, x1, W, floor, top, wx, r, col, trim } = o;
  const belt = floor + (top - floor) * 0.48;
  const rake = (top - belt) * 0.26;
  const arch = r + 0.055;
  const parts: THREE.BufferGeometry[] = [
    // la coque : le dessous suit la voûte de la roue, le pare-brise est incliné, le toit arrondi vers l'avant
    profile(
      [
        [x0, floor],
        ...archEdge(wx, r, arch, floor).reverse(),
        [x1, floor],
        [x1, floor + 0.12],
        [x1 + 0.015, belt - 0.05],
        [x1, belt + 0.02],
        [x1 - rake, top - 0.05],
        [x1 - rake - 0.07, top],
        [x0 + 0.04, top],
        [x0, top - 0.04],
      ],
      W,
      col,
    ),
    // l'intérieur du passage de roue, pour qu'on ne voie pas à travers
    box(arch * 2, 0.5, W - 0.44, RUBBER, [wx, floor + 0.14, 0]),
    // les vitres de côté, sur toute la largeur de la cabine
    profile(
      [
        [x0 + 0.2, belt + 0.05],
        [x1 - 0.1, belt + 0.05],
        [x1 - rake - 0.04, top - 0.13],
        [x0 + 0.2, top - 0.13],
      ],
      W + 0.012,
      GLASS,
    ),
    // le montant de la portière
    box(0.04, top - belt - 0.17, W + 0.016, col, [x0 + 0.52, belt + (top - belt - 0.08) / 2, 0]),
  ];
  // le pare-brise, posé sur la pente
  const dy = top - 0.07 - (belt + 0.02);
  const len = Math.hypot(rake, dy);
  const tilt = Math.atan2(rake, dy);
  const mid: [number, number, number] = [x1 - rake / 2 + 0.008, belt + 0.02 + dy / 2, 0];
  parts.push(box(0.018, len, W * 0.9, GLASS, mid, [0, 0, tilt]));
  for (const z of [-W * 0.18, W * 0.26]) parts.push(box(0.012, len * 0.42, 0.018, DARK, [x1 - rake * 0.16 + 0.018, belt + 0.02 + dy * 0.2, z], [0, 0, tilt + 0.5]));
  // pare-soleil, feuillure du toit
  parts.push(box(0.1, 0.03, W + 0.02, DARK, [x1 - rake - 0.02, top - 0.03, 0]));
  // la portière : son contour, sa poignée, le marchepied
  for (const side of [-1, 1]) {
    const z = side * (W / 2 + 0.004);
    const dx0 = Math.max(x0 + 0.1, wx - arch - 0.42);
    parts.push(box(0.012, top - floor - 0.12, 0.008, DARK, [x0 + 0.13, (top + floor) / 2 - 0.02, z]));
    parts.push(box(0.012, belt - floor + 0.1, 0.008, DARK, [x1 - 0.1, (belt + floor) / 2 + 0.04, z]));
    parts.push(box(0.1, 0.022, 0.018, DARK, [x0 + 0.3, belt - 0.05, z + side * 0.006]));
    parts.push(box(x1 - x0 - 0.02, 0.05, 0.012, trim, [(x0 + x1) / 2, belt - 0.12, z + side * 0.002]));
    parts.push(box(0.26, 0.035, 0.1, DARK, [dx0 + 0.13, floor - 0.02, side * (W / 2 + 0.02)]));
    // le rétroviseur, au bout de son bras
    parts.push(box(0.02, 0.02, 0.17, DARK, [x1 - 0.14, belt + 0.26, side * (W / 2 + 0.08)]));
    parts.push(box(0.03, 0.24, 0.09, RUBBER, [x1 - 0.14, belt + 0.22, side * (W / 2 + 0.17)]));
    // l'optique : le phare, le clignotant
    parts.push(box(0.02, 0.1, 0.22, 0xfff4cf, [x1 + 0.012, floor + 0.2, side * (W / 2 - 0.17)]));
    parts.push(box(0.02, 0.1, 0.06, 0xf0a33a, [x1 + 0.012, floor + 0.2, side * (W / 2 - 0.03)]));
    parts.push(box(0.03, 0.04, 0.09, 0xfff4cf, [x1 + 0.04, floor + 0.03, side * (W / 2 - 0.2)]));
    // le garde-boue au-dessus de la roue
    parts.push(box(0.012, 0.16, 0.14, RUBBER, [wx - arch, floor - 0.08, side * (W / 2 - 0.09)]));
  }
  // la calandre et ses barres, le pare-chocs et la plaque
  parts.push(box(0.02, belt - floor - 0.26, W * 0.5, DARK, [x1 + 0.012, (belt + floor + 0.11) / 2 + 0.02, 0]));
  for (let k = 0; k < 4; k++) parts.push(box(0.012, 0.018, W * 0.5, CHROME, [x1 + 0.024, floor + 0.17 + k * ((belt - floor - 0.28) / 3), 0]));
  parts.push(box(0.1, 0.13, W + 0.04, DARK, [x1 + 0.02, floor + 0.03, 0]), box(0.012, 0.055, 0.24, 0xf6f4ec, [x1 + 0.075, floor + 0.03, 0]));
  // le déflecteur sur le toit
  if (o.fairing !== undefined) parts.push(profile([[x1 - rake - 0.12, top], [x0 + 0.02, top], [x0 + 0.02, top + 0.26], [x0 + 0.34, top + 0.26]], W - 0.06, o.fairing));
  return parts;
}

/** Le feu arrière, la plaque et le pare-cycliste. */
function rearEnd(x: number, W: number, y: number) {
  const parts: THREE.BufferGeometry[] = [box(0.06, 0.08, W - 0.02, DARK, [x, y, 0])];
  for (const side of [-1, 1]) {
    parts.push(box(0.03, 0.08, 0.1, 0xc8352d, [x - 0.025, y + 0.09, side * (W / 2 - 0.1)]), box(0.03, 0.08, 0.06, 0xf0a33a, [x - 0.025, y + 0.09, side * (W / 2 - 0.2)]), box(0.03, 0.08, 0.05, 0xf6f4ec, [x - 0.025, y + 0.09, side * (W / 2 - 0.27)]));
    parts.push(box(0.1, 0.16, 0.05, STEEL, [x + 0.04, y + 0.06, side * (W / 2 - 0.34)]));
  }
  parts.push(box(0.012, 0.055, 0.24, 0xf6f4ec, [x - 0.035, y - 0.002, 0]));
  return parts;
}

/** Le camion du couvoir : une petite cabine et un plateau à ridelles, chargé de cageots. */
function truckModel() {
  const g = new THREE.Group();
  const R = 0.22;
  const W = 1.08;
  const front = 1.15;
  const rear = -0.85;
  const parts: THREE.BufferGeometry[] = [
    ...cabin({ x0: 0.66, x1: 1.74, W, floor: 0.27, top: 1.3, wx: front, r: R, col: C.white, trim: 0x2f6bff }),
    // châssis : longerons, traverses, plancher
    box(2.1, 0.09, 0.09, STEEL, [-0.38, 0.36, 0.34]),
    box(2.1, 0.09, 0.09, STEEL, [-0.38, 0.36, -0.34]),
    box(2.0, 0.07, 1.12, C.woodDark, [-0.45, 0.48, 0]),
    box(2.04, 0.05, 1.14, STEEL, [-0.45, 0.43, 0]),
    // réservoir
    cyl(0.1, 0.1, 0.6, 12, 0xbfc4ca, [0.15, 0.28, 0.42], [0, 0, Math.PI / 2]),
    ...wheel(front, W / 2 - 0.09, R, 0.17),
    ...wheel(front, -W / 2 + 0.09, R, 0.17),
    ...wheel(rear, W / 2 - 0.09, R, 0.22),
    ...wheel(rear, -W / 2 + 0.09, R, 0.22),
    ...rearEnd(-1.47, W, 0.34),
  ];
  // l'essieu arrière et son garde-boue, bien au-dessus du pneu
  for (const side of [-1, 1]) parts.push(profile(archBand(rear, R, R + 0.05, R + 0.11), 0.27, DARK).translate(0, 0, side * (W / 2 - 0.09)));
  // ridelles à claire-voie
  for (const z of [-0.53, 0.53]) for (let y = 0.6; y < 1.25; y += 0.16) parts.push(box(2.0, 0.07, 0.04, C.wood, [-0.45, y, z]));
  for (const x of [-1.42, -0.45, 0.52]) for (const z of [-0.53, 0.53]) parts.push(box(0.06, 0.8, 0.06, C.woodDark, [x, 0.9, z]));
  parts.push(box(0.04, 0.78, 1.1, C.woodDark, [0.56, 0.9, 0]));
  // cageots de poules empilés, à claire-voie, quelques têtes qui dépassent
  for (let i = 0; i < 6; i++) {
    const x = -1.15 + (i % 3) * 0.55;
    const y = 0.65 + Math.floor(i / 3) * 0.3;
    parts.push(box(0.46, 0.26, 0.88, 0x8d6a3e, [x, y, 0]));
    for (let k = 0; k < 3; k++) for (const z of [-0.445, 0.445]) parts.push(box(0.44, 0.04, 0.012, 0xe2c48c, [x, y - 0.09 + k * 0.09, z]));
    for (const dx of [-0.225, 0.225]) parts.push(box(0.04, 0.27, 0.9, 0xd9b77a, [x + dx, y, 0]));
    parts.push(box(0.46, 0.03, 0.9, 0x8d6a3e, [x, y + 0.125, 0]));
    for (let k = -1; k <= 1; k++) parts.push(box(0.44, 0.012, 0.2, 0xe2c48c, [x, y + 0.14, k * 0.3]));
    parts.push(sph(0.07, 6, 5, i % 2 ? 0xb5652e : C.white, [x, y + 0.2, 0.15]));
    parts.push(box(0.03, 0.04, 0.03, 0xd9534f, [x, y + 0.27, 0.15]));
  }
  g.add(mesh(merge(parts)));
  // le nom du couvoir, sur le fronton
  const sign = textPanel('COUVOIR', 0.62, 0.15, 0xf0c94a, '#3a2f1a');
  sign.position.set(1.48, 1.37, 0);
  sign.rotation.y = Math.PI / 2;
  g.add(sign, mesh(merge([box(0.02, 0.19, 0.67, 0xf0c94a, [1.46, 1.37, 0]), box(0.03, 0.08, 0.03, STEEL, [1.46, 1.3, 0.2]), box(0.03, 0.08, 0.03, STEEL, [1.46, 1.3, -0.2])])));
  // hayon arrière (charnière en bas) : il s'abaisse en rampe pendant le déchargement
  const gate = new THREE.Group();
  gate.position.set(-1.47, 0.5, 0);
  const plank = mesh(merge([box(0.05, 0.7, 1.04, C.wood, [0, 0.35, 0]), box(0.06, 0.06, 1.06, C.woodDark, [0, 0.68, 0]), box(0.06, 0.06, 1.06, C.woodDark, [0, 0.05, 0])]));
  gate.add(plank);
  g.add(gate);
  // feux de détresse (ils clignotent à l'arrêt)
  const blinkMat = new THREE.MeshBasicMaterial({ color: 0xf0a33a });
  const blink = new THREE.Group();
  for (const [x, y, z] of [
    [1.76, 0.47, 0.51],
    [1.76, 0.47, -0.51],
    [-1.5, 0.43, 0.34],
    [-1.5, 0.43, -0.34],
  ])
    blink.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.07), blinkMat).translateX(x).translateY(y).translateZ(z));
  g.add(blink);
  return { g, blink, gate };
}

/** Bande en arc au-dessus d'une roue (le garde-boue) : de rayon r0 à r1, centrée sur la roue. */
function archBand(wx: number, wy: number, r0: number, r1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k <= 12; k++) {
    const a = -1.45 + (k / 12) * 2.9;
    out.push([wx + Math.sin(a) * r1, wy + Math.cos(a) * r1]);
  }
  for (let k = 12; k >= 0; k--) {
    const a = -1.45 + (k / 12) * 2.9;
    out.push([wx + Math.sin(a) * r0, wy + Math.cos(a) * r0]);
  }
  return out;
}

/**
 * Le camion des revendeurs : une caisse fermée, on ne voit rien de ce qu'elle contient. À l'arrière, un
 * rideau qui se relève sur un intérieur sombre, et un hayon à plancher qui s'abaisse en rampe.
 */
function bigTruckModel() {
  const g = new THREE.Group();
  g.name = 'dealerTruck';
  const R = 0.27;
  const W = 1.28;
  const front = 2.02;
  const COL = 0x2f6f4e;
  const BODY = 0xf3efe6;
  const ALU = 0xc9cbc8;
  const parts: THREE.BufferGeometry[] = [
    ...cabin({ x0: 1.42, x1: 2.62, W, floor: 0.33, top: 1.76, wx: front, r: R, col: COL, trim: BODY, fairing: BODY }),
    // châssis : deux longerons et leurs traverses, le dessous de la caisse
    box(4.3, 0.13, 0.1, STEEL, [-0.4, 0.46, 0.4]),
    box(4.3, 0.13, 0.1, STEEL, [-0.4, 0.46, -0.4]),
    box(4.04, 0.07, W + 0.02, DARK, [-0.65, 0.58, 0]),
    // réservoir, boîte à outils, bonbonnes d'air, entre les essieux
    cyl(0.15, 0.15, 0.82, 14, 0xbfc4ca, [0.72, 0.36, 0.5], [0, 0, Math.PI / 2]),
    box(0.03, 0.31, 0.03, DARK, [0.48, 0.38, 0.45]),
    box(0.03, 0.31, 0.03, DARK, [0.96, 0.38, 0.45]),
    box(0.72, 0.28, 0.3, 0x3a3d43, [0.72, 0.38, -0.5]),
    cyl(0.08, 0.08, 0.5, 10, STEEL, [-0.38, 0.38, 0.46], [0, 0, Math.PI / 2]),
    cyl(0.08, 0.08, 0.5, 10, STEEL, [-0.38, 0.38, -0.46], [0, 0, Math.PI / 2]),
    // les roues : une à l'avant, deux essieux jumelés à l'arrière
    ...wheel(front, W / 2 - 0.1, R, 0.19),
    ...wheel(front, -W / 2 + 0.1, R, 0.19),
    ...wheel(-1.32, W / 2 - 0.1, R, 0.26),
    ...wheel(-1.32, -W / 2 + 0.1, R, 0.26),
    ...wheel(-1.96, W / 2 - 0.1, R, 0.26),
    ...wheel(-1.96, -W / 2 + 0.1, R, 0.26),
    ...rearEnd(-2.72, W, 0.4),
    // la caisse, entièrement fermée, avec ses baguettes d'aluminium
    box(4.0, 1.4, 1.34, BODY, [-0.65, 1.31, 0]),
    box(4.04, 0.05, 1.38, ALU, [-0.65, 2.03, 0]),
    box(4.04, 0.06, 1.38, ALU, [-0.65, 0.61, 0]),
    box(4.02, 0.24, 1.36, COL, [-0.65, 0.76, 0]),
    box(4.02, 0.05, 1.36, COL, [-0.65, 1.94, 0]),
    box(0.12, 1.42, 1.3, DARK, [1.38, 1.31, 0]),
  ];
  // les garde-boue arrière et les bavettes
  for (const side of [-1, 1]) {
    const z = side * (W / 2 - 0.1);
    parts.push(profile(archBand(-1.32, R, R + 0.05, R + 0.1), 0.3, DARK).translate(0, 0, z), profile(archBand(-1.96, R, R + 0.05, R + 0.1), 0.3, DARK).translate(0, 0, z));
    parts.push(box(0.012, 0.22, 0.26, RUBBER, [-2.3, 0.2, z]));
    // le garde-corps entre les essieux, comme sur les vrais camions
    for (const y of [0.32, 0.46]) parts.push(box(1.12, 0.03, 0.02, ALU, [0.1, y, side * 0.67]));
    for (const x of [-0.42, 0.62]) parts.push(box(0.03, 0.2, 0.02, STEEL, [x, 0.39, side * 0.66]));
    // les feux de gabarit, en bas de caisse
    for (let x = -2.3; x < 1.2; x += 0.86) parts.push(box(0.07, 0.03, 0.012, 0xf0a33a, [x, 0.67, side * 0.684]));
  }
  // nervures de la caisse, fentes d'aération tout en haut
  for (let x = -2.45; x < 1.3; x += 0.48) for (const z of [-0.675, 0.675]) parts.push(box(0.03, 1.42, 0.012, 0xe2dccd, [x, 1.31, z]));
  for (let x = -2.2; x < 1.2; x += 0.32) for (const z of [-0.678, 0.678]) parts.push(box(0.2, 0.035, 0.012, 0x6d6a62, [x, 1.8, z]));
  // l'arrière : cadre et intérieur sombre
  parts.push(box(0.03, 1.2, 1.14, 0x17140f, [-2.66, 1.3, 0]));
  parts.push(box(0.05, 1.42, 0.09, ALU, [-2.67, 1.31, 0.625]), box(0.05, 1.42, 0.09, ALU, [-2.67, 1.31, -0.625]), box(0.05, 0.1, 1.34, ALU, [-2.67, 1.96, 0]));
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
  door.position.set(-2.69, 1.91, 0);
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
  for (const [x, y, z] of [
    [2.65, 0.53, 0.61],
    [2.65, 0.53, -0.61],
    [-2.76, 0.49, 0.44],
    [-2.76, 0.49, -0.44],
  ])
    blink.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.07), blinkMat).translateX(x).translateY(y).translateZ(z));
  g.add(blink);
  return { g, blink, gate, door };
}

/** Le grand portail à deux battants, au bout du chemin de terre (il s'ouvre vers la parcelle). */
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
  const X = YARD_GATE.x;
  const Z0 = YARD_GATE.z - 1;
  const Z1 = YARD_GATE.z + 1;
  const posts: THREE.BufferGeometry[] = [];
  for (const z of [Z0 - 0.04, Z1 + 0.04]) posts.push(box(0.2, 1.22, 0.2, C.woodDark, [X, 0.71, z]), box(0.26, 0.05, 0.26, 0x8e939b, [X, 1.34, z]));
  const fixed = mesh(merge(posts));
  const a = leaf();
  const b = leaf();
  a.position.set(X, 0.1, Z0 + 0.05);
  b.position.set(X, 0.1, Z1 - 0.05);
  scene.add(fixed, a, b);
  const set = (open: number) => {
    a.rotation.y = -Math.PI / 2 - (open * Math.PI) / 2;
    b.rotation.y = Math.PI / 2 + (open * Math.PI) / 2;
  };
  set(0);
  return set;
}

/**
 * Une volaille en chemin, hors de la simulation : qui descend d'un camion du couvoir, ou qui monte dans
 * celui du revendeur. Le rendu la dessine exactement comme les poules de la ferme.
 */
export interface BirdOnTheWay {
  rooster?: boolean;
  black?: boolean;
  seed: number;
  breed: BreedId;
  skin: number;
  x: number;
  z: number;
  /** Direction de marche. */
  dx: number;
  dz: number;
  /** Hauteur au-dessus du sol, et pente sur laquelle elle marche. */
  lift: number;
  slope: number;
  /** Depuis combien de temps elle marche (secondes). */
  age: number;
}

export interface DeliveryTruck {
  update(s: GameState): void;
  /** Les volailles qui marchent entre un camion et la ferme, à cet instant. */
  birds(s: GameState, draw: (b: BirdOnTheWay) => void): void;
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
  /** Les camions des revendeurs : celui de la commande en cours, et ceux qui repartent, chacun sa vie. */
  type Big = ReturnType<typeof bigTruckModel>;
  type Pickup = { id: number; truck?: Big; phase: 'wait' | 'road' | 'in' | 'bay' | 'back' | 'out'; s: number; open: number; held: boolean };
  const pickups: Pickup[] = [];
  const setGate = yardGate(world);
  let gate = 0;
  let last = performance.now();

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
        }
      }
      // ---- le camion du revendeur : il quitte la route par la branche de terre, passe le grand portail et
      // s'arrête dans la parcelle ; une fois tout le monde à bord, il ressort à reculons, fait demi-tour
      // dans l'aire devant le portail et reprend le chemin jusqu'à la route
      const L = s.birdLoad;
      if (L && !pickups.some((p) => p.id === L.id)) {
        const P: Pickup = { id: L.id, phase: 'wait', s: 0, open: 0, held: false };
        // partie rechargée en plein chargement : il est déjà sur place
        if (t > L.eta + 1 && !pickups.length) {
          P.truck = bigTruckModel();
          world.add(P.truck.g);
          P.phase = 'bay';
          P.s = ENTRY.total;
        }
        pickups.push(P);
      }
      let gateWant = 0;
      for (const P of [...pickups]) {
        const still = !!L && L.id === P.id;
        let gone = false;
        const pace = rdt * Math.min(3, spd);
        const speed = (v: number, toEnd: number, fromStart: number) => v * pace * Math.max(0.22, Math.min(1, (Math.min(toEnd, fromStart) + 0.4) / 2));
        if (P.phase === 'wait') {
          if (!still) gone = true;
          // le chemin n'a qu'une voie : il ne prend la route qu'une fois le camion précédent reparti pour de bon
          else if (spd > 0 && !pickups.some((o) => o !== P)) {
            // il prend la route assez tôt pour arriver au portail à l'heure dite
            const remain = ((L!.eta - t - ENTRY.total / 3.2) * Math.min(2, spd)) / spd;
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
          if (!st) gone = true;
          else if (!still) {
            street.releaseDelivery(P.id);
            gone = true;
          } else if (st.parked) {
            street.detachDelivery(P.id);
            world.add(P.truck!.g);
            P.held = true;
            P.s = 0;
            P.phase = 'in';
          }
        } else if (P.phase === 'in') {
          P.s = Math.min(ENTRY.total, P.s + speed(3.2, ENTRY.total - P.s, P.s));
          if (P.held && ENTRY.at(P.s).z < 38) {
            street.freeLane(P.id);
            P.held = false;
          }
          if (P.s >= ENTRY.total) P.phase = 'bay';
        } else if (P.phase === 'bay') {
          if (!still && P.open < 0.02) {
            P.phase = 'back';
            P.s = 0;
          }
        } else if (P.phase === 'back') {
          P.s = Math.min(BACKUP.total, P.s + speed(2.2, BACKUP.total - P.s, P.s));
          if (P.s >= BACKUP.total) {
            P.phase = 'out';
            P.s = 0;
          }
        } else if (P.phase === 'out') {
          // jusqu'au bord de la route, où il attend que les deux voies soient libres pour traverser
          if (P.s < EXIT_WAIT || P.held) {
            P.s = Math.min(EXIT.total, P.s + speed(3.2, P.held ? EXIT.total - P.s : EXIT_WAIT - P.s + 0.2, P.s));
            if (P.s >= EXIT.total) {
              street.freeLane(P.id);
              street.resumeDelivery(P.id, P.truck!.g, 5.4, EXIT.at(EXIT.total).x, 1);
              gone = true;
            }
          } else if (pace > 0 && street.laneClear(-1, BIRD_ORDERS.stopX - 10, BIRD_ORDERS.stopX + 14) && street.laneClear(1, BIRD_ORDERS.stopX - 18, BIRD_ORDERS.stopX + 8)) {
            street.holdLane(P.id, BIRD_ORDERS.stopX - 3, 5.4, -1);
            street.holdLane(P.id, BIRD_ORDERS.stopX + 1, 5.4, 1);
            P.held = true;
          }
        }
        if (gone) {
          pickups.splice(pickups.indexOf(P), 1);
          continue;
        }
        // la simulation attend qu'il soit garé pour faire monter les volailles
        if (still) L!.late = P.phase !== 'bay';
        if (P.truck) {
          const q = P.phase === 'in' || P.phase === 'bay' ? ENTRY.at(P.s) : P.phase === 'back' ? BACKUP.at(P.s) : P.phase === 'out' ? EXIT.at(P.s) : null;
          if (q) {
            // (à reculons, le camion regarde à l'opposé de sa marche)
            const heading = P.phase === 'back' ? q.heading + Math.PI : q.heading;
            // (sur le chemin, puis sur le sol de la parcelle, un peu plus haut : les roues restent toujours au-dessus)
            P.truck.g.position.set(q.x, 0.05 + 0.085 * Math.max(0, Math.min(1, (83.4 - q.x) / 2.4)), q.z);
            P.truck.g.rotation.y = heading;
            // le portail s'ouvre devant lui et se referme derrière
            const fx = Math.cos(heading) * 2.7;
            const fz = -Math.sin(heading) * 2.7;
            const ax = q.x - fx;
            const az = q.z - fz;
            const k = Math.max(0, Math.min(1, ((YARD_GATE.x - ax) * (fx * 2) + (YARD_GATE.z - az) * (fz * 2)) / (5.4 * 5.4)));
            if (P.phase !== 'bay' && Math.hypot(ax + fx * 2 * k - YARD_GATE.x, az + fz * 2 * k - YARD_GATE.z) < 3.2) gateWant = 1;
          }
          P.truck.blink.visible = (P.phase === 'road' ? !!street.delivery(P.id)?.parked : P.phase === 'bay' || P.phase === 'back') && Math.floor(now / 420) % 2 === 0;
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
    },
    birds(s, draw) {
      const t = s.clock.t;
      // les poules du couvoir : elles sautent du hayon et trottinent jusqu'au portail de la ferme
      for (const tr of tracks.values()) {
        const d = tr.d;
        const slot = d.slot ?? 0;
        const path = hopPath(slot);
        const dur = hopTime(slot);
        for (let i = 0; i < d.count; i++) {
          const j = jumpAt(d, i);
          if (t < j || t > j + dur) continue;
          const k = (t - j) / dur;
          const p = alongPath(path, k);
          const jump = k < 0.08 ? Math.sin((k / 0.08) * Math.PI) * 0.35 + (1 - k / 0.08) * 0.45 : 0;
          draw({ seed: 1e7 + d.id * 200 + i, breed: d.breed, skin: 0, x: p.x, z: p.z, dx: p.dx, dz: p.dz, lift: jump - 0.03, slope: 0, age: t - j });
        }
      }
      // celles du revendeur : elles rejoignent le pied de la rampe, grimpent et disparaissent dans le noir
      const L = s.birdLoad;
      if (!L) return;
      for (const q of L.gone) {
        const dur = routeTime(q.route);
        if (t < q.t || t > q.t + dur) continue;
        const k = (t - q.t) / dur;
        const p = alongPath(q.route, k);
        const up = rampProgress(q.route, k);
        draw({ seed: q.id, breed: q.breed, skin: q.skin ?? 0, rooster: q.rooster, black: q.black, x: p.x, z: p.z, dx: p.dx, dz: p.dz, lift: up * 0.6, slope: up > 0 && up < 1 ? 0.5 : 0, age: t - q.t });
      }
    },
  };
}

