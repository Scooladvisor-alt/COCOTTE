// Nombre de triangles par partie de chaque modèle de volaille (contrôle du coût de rendu).
import type * as THREE from 'three';
import { BREED_ORDER } from '../src/config/breeds';
import { henGeometry } from '../src/render/henModel';

const tri = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
for (const b of BREED_ORDER)
  for (const [kind, stage] of [['hen', 7], ['rooster', 7], ['hen', 1]] as const) {
    const g = henGeometry(b, kind, stage);
    const t = { body: tri(g.body), head: tri(g.head), wings: tri(g.wingL) * 2, legs: tri(g.leg) * 2 };
    const total = Object.values(t).reduce((a, x) => a + x, 0);
    console.log(`${b.padEnd(9)} ${kind.padEnd(7)} st${stage}  total ${total}  ${JSON.stringify(t)}`);
  }
