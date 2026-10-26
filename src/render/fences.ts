// Rendu de la clôture de la ferme : grillage à mailles hexagonales sur poteaux de bois et portail.
import * as THREE from 'three';
import { edgeEnds, fencedEdges } from '../sim/fences';
import type { GameState } from '../sim/types';
import { C, MAT, box, cyl, ico, merge, mesh } from './geo';

const GROUND = 0.08;
const tmp = new THREE.Object3D();

function wireTexture(dense: boolean) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 64);
  g.strokeStyle = dense ? 'rgba(205,214,206,0.95)' : 'rgba(232,232,228,0.95)';
  g.lineWidth = 2;
  // mailles hexagonales (grillage à poules)
  const cw = dense ? 10 : 14;
  const ch = dense ? 9 : 12;
  for (let row = -1; row < 64 / ch + 1; row++)
    for (let col = -1; col < 128 / cw + 1; col++) {
      const x = col * cw + (row % 2 ? cw / 2 : 0);
      const y = row * ch;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + cw / 2, y + ch * 0.35);
      g.lineTo(x + cw / 2, y + ch);
      g.moveTo(x + cw / 2, y + ch * 0.35);
      g.lineTo(x + cw, y);
      g.stroke();
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class FenceLayer {
  group = new THREE.Group();
  private built = new THREE.Group();
  private wireSimple = new THREE.MeshLambertMaterial({ map: wireTexture(false), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide });
  private wireStrong = new THREE.MeshLambertMaterial({ map: wireTexture(true), transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, color: 0xd8e6d4 });

  constructor(scene: THREE.Scene) {
    this.group.add(this.built);
    scene.add(this.group);
  }

  /** Reconstruit toutes les clôtures (à chaque changement de terrain). */
  build(s: GameState) {
    for (const o of [...this.built.children]) {
      this.built.remove(o);
      if ((o as THREE.Mesh).geometry && !(o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.Mesh).geometry.dispose();
    }
    const edges = fencedEdges(s);
    if (!edges.length) return;
    const panels = { simple: [] as number[], strong: [] as number[], hole: [] as number[] };
    const gates: number[] = [];
    // poteaux : le plus robuste des grillages qui se rejoignent à ce sommet
    const posts = new Map<string, number>();
    for (const { code, v } of edges) {
      const [x0, z0, x1, z1] = edgeEnds(code);
      if (v === 3) gates.push(code);
      else if (v === 2) panels.strong.push(code);
      else if (v === 4) panels.hole.push(code);
      else panels.simple.push(code);
      for (const k of [`${x0},${z0}`, `${x1},${z1}`]) posts.set(k, Math.max(posts.get(k) ?? 0, v === 4 ? 1 : v));
    }
    const place = (im: THREE.InstancedMesh, codes: number[], y = 0, tilt = 0) => {
      codes.forEach((code, i) => {
        const [x0, z0, x1, z1] = edgeEnds(code);
        tmp.position.set((x0 + x1) / 2, GROUND + y, (z0 + z1) / 2);
        tmp.rotation.set(tilt, x0 === x1 ? Math.PI / 2 : 0, 0);
        tmp.scale.set(1, 1, 1);
        tmp.updateMatrix();
        im.setMatrixAt(i, tmp.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = true;
      im.receiveShadow = true;
      this.built.add(im);
    };
    const panelGeo = new THREE.PlaneGeometry(0.98, 0.5);
    panelGeo.translate(0, 0.27, 0);
    const wireTop = box(1, 0.025, 0.025, 0xb9bdb5, [0, 0.54, 0]);
    if (panels.simple.length) {
      place(new THREE.InstancedMesh(panelGeo, this.wireSimple, panels.simple.length), panels.simple);
      place(new THREE.InstancedMesh(wireTop, MAT, panels.simple.length), panels.simple);
    }
    if (panels.strong.length) {
      place(new THREE.InstancedMesh(panelGeo, this.wireStrong, panels.strong.length), panels.strong);
      place(new THREE.InstancedMesh(merge([box(1, 0.035, 0.035, 0x5d7a5a, [0, 0.55, 0]), box(1, 0.12, 0.05, C.woodDark, [0, 0.06, 0])]), MAT, panels.strong.length), panels.strong);
    }
    if (panels.hole.length) {
      // grillage soulevé au-dessus d'un trou : terre retournée au pied
      place(new THREE.InstancedMesh(panelGeo, this.wireSimple, panels.hole.length), panels.hole, 0.08, 0.32);
      place(
        new THREE.InstancedMesh(merge([ico(0.18, 0, 0x8a6a43, [0.12, 0.02, 0.14], [1.5, 0.45, 1]), ico(0.12, 0, 0x6f5435, [-0.15, 0.01, -0.1], [1.3, 0.4, 1]), box(0.3, 0.02, 0.24, 0x3e2f22, [0, 0, 0])]), MAT, panels.hole.length),
        panels.hole,
      );
    }
    // poteaux
    const wood: Array<[number, number]> = [];
    const metal: Array<[number, number]> = [];
    for (const [k, v] of posts) {
      if (v === 3) continue; // les portails ont leurs propres montants
      const [x, z] = k.split(',').map(Number);
      (v === 2 ? metal : wood).push([x, z]);
    }
    const postIm = (geo: THREE.BufferGeometry, list: Array<[number, number]>) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, MAT, list.length);
      list.forEach(([x, z], i) => {
        tmp.position.set(x, GROUND, z);
        tmp.rotation.set(0, (x * 7 + z * 3) % 3 * 0.2, 0);
        tmp.scale.set(1, 1, 1);
        tmp.updateMatrix();
        im.setMatrixAt(i, tmp.matrix);
      });
      im.castShadow = true;
      this.built.add(im);
    };
    postIm(merge([box(0.075, 0.64, 0.075, 0xb38a5c, [0, 0.32, 0]), box(0.085, 0.03, 0.085, 0x9a7449, [0, 0.64, 0])]), wood);
    postIm(merge([cyl(0.035, 0.035, 0.66, 6, 0x5d7a5a, [0, 0.33, 0]), cyl(0.045, 0.045, 0.03, 6, 0x4b6448, [0, 0.66, 0])]), metal);
    // portails
    for (const code of gates) {
      const [x0, z0, x1, z1] = edgeEnds(code);
      const g = mesh(
        merge([
          box(0.1, 0.8, 0.1, C.woodDark, [-0.5, 0.4, 0]),
          box(0.1, 0.8, 0.1, C.woodDark, [0.5, 0.4, 0]),
          box(0.86, 0.06, 0.05, C.wood, [0, 0.18, 0]),
          box(0.86, 0.06, 0.05, C.wood, [0, 0.52, 0]),
          box(0.06, 0.4, 0.05, C.wood, [-0.38, 0.35, 0]),
          box(0.06, 0.4, 0.05, C.wood, [0.38, 0.35, 0]),
          box(0.95, 0.05, 0.04, C.wood, [0, 0.35, 0], [0, 0, 0.42]),
          box(1.04, 0.09, 0.09, C.blue, [0, 0.78, 0]),
        ]),
      );
      g.position.set((x0 + x1) / 2, GROUND, (z0 + z1) / 2);
      g.rotation.y = x0 === x1 ? Math.PI / 2 : 0;
      this.built.add(g);
    }
  }
}
