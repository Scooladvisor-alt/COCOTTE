// Atelier de développement : toutes les races (poule, coq, jeunes) sous l'éclairage du jeu,
// en vue isométrique rapprochée. Ouvrir /dev/henlab.html (?stage=7&rot=1&zoom=…).
import * as THREE from 'three';
import { BREED_ORDER } from '../src/config/breeds';
import { ADULT_STAGE, HenBatch, createHenView, henGeometry, type HenKind } from '../src/render/models';

const q = new URLSearchParams(location.search);
const zoom = Number(q.get('zoom') ?? 1.6);
const rot = q.get('rot') === '1';
const az = Number(q.get('az') ?? 45);
const el = Number(q.get('el') ?? 40);
const stages = (q.get('stages') ?? '').split(',').filter(Boolean).map(Number);
const only = (q.get('only') ?? '').split(',').filter(Boolean);
const breeds = only.length ? BREED_ORDER.filter((b) => only.includes(b)) : BREED_ORDER;
const yaw = Number(q.get('yaw') ?? 0.9);

const host = document.getElementById('c')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe3a8);
const hemi = new THREE.HemisphereLight(0xfff6e8, 0xc6cfa0, 1.6);
const sun = new THREE.DirectionalLight(0xfff2df, 2.1);
sun.position.set(-3, 9, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(hemi, sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0x9fcd62 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const A = THREE.MathUtils.degToRad(az);
const E = THREE.MathUtils.degToRad(el);
cam.position.set(Math.sin(A) * Math.cos(E), Math.sin(E), Math.cos(A) * Math.cos(E)).multiplyScalar(40);
cam.lookAt(0, 0, 0);

type Entry = { view: ReturnType<typeof createHenView>; batch: HenBatch };
const entries: Entry[] = [];
const rows: Array<{ kind: HenKind; stage: number }> = stages.length ? stages.map((s) => ({ kind: 'hen' as HenKind, stage: s })) : [{ kind: 'hen', stage: ADULT_STAGE }, { kind: 'rooster', stage: ADULT_STAGE }];
rows.forEach((r, ri) => {
  breeds.forEach((breed, bi) => {
    const batch = new HenBatch(henGeometry(breed, r.kind, r.stage, Number(q.get('skin') ?? 0)), 1);
    for (const m of batch.meshes()) scene.add(m);
    const view = createHenView(breed, bi * 7 + ri);
    view.root.position.set((bi - (breeds.length - 1) / 2) * 0.85, 0, (ri - (rows.length - 1) / 2) * 1.0);
    view.root.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), A);
    view.root.rotation.y = A + yaw;
    entries.push({ view, batch });
  });
});
(window as never as { lab: unknown }).lab = { entries, scene, cam };

function resize() {
  const w = host.clientWidth;
  const h = host.clientHeight;
  renderer.setSize(w, h);
  const half = 3.2 / zoom;
  cam.left = (-half * w) / h;
  cam.right = (half * w) / h;
  cam.top = half;
  cam.bottom = -half;
  cam.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
resize();
let t = 0;
let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  t += dt;
  for (const e of entries) {
    if (rot) e.view.root.rotation.y += dt * 0.6;
    e.view.root.updateMatrixWorld(true);
    e.batch.begin();
    e.batch.push(e.view);
    e.batch.end();
  }
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ?thumbs=1 : vignettes de l'interface (boutique, fiches) pour chaque race
if (q.get('thumbs')) {
  const T = await import('../src/render/thumbs');
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;display:flex;flex-wrap:wrap;gap:12px;padding:16px;background:#fbfaf7;align-content:flex-start;z-index:5';
  for (const b of BREED_ORDER)
    for (const url of [T.henThumb(b), T.roosterThumb(b), T.birdThumb({ breed: b, young: 25 }), T.birdThumb({ breed: b, young: 10 })]) {
      const img = document.createElement('img');
      img.src = url;
      img.style.cssText = 'width:120px;height:120px;object-fit:contain;background:radial-gradient(circle at 50% 75%,#f4efe4,#fbfaf7);border-radius:16px';
      wrap.appendChild(img);
    }
  document.body.appendChild(wrap);
}
