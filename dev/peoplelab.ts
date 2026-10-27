// Atelier de développement : les salariés (4 métiers × plusieurs physiques) et les passants, sous
// l'éclairage du jeu, en vue isométrique rapprochée. Ouvrir /dev/peoplelab.html (?zoom=…&yaw=…).
import * as THREE from 'three';
import { ROLES, ROLE_ORDER } from '../src/config/staff';
import { createPerson, createWorkerView } from '../src/render/models';

const q = new URLSearchParams(location.search);
const zoom = Number(q.get('zoom') ?? 1.4);
const yaw = Number(q.get('yaw') ?? 0.6);
const looks = (q.get('looks') ?? '0,1,2,3,5,6').split(',').map(Number);

const host = document.getElementById('c')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xcfe3a8);
const sun = new THREE.DirectionalLight(0xfff2df, 2.1);
sun.position.set(-3, 9, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
scene.add(new THREE.HemisphereLight(0xfff6e8, 0xc6cfa0, 1.6), sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0x9fcd62 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const A = THREE.MathUtils.degToRad(45);
const E = THREE.MathUtils.degToRad(Number(q.get('el') ?? 30));
cam.position.set(Math.sin(A) * Math.cos(E), Math.sin(E), Math.cos(A) * Math.cos(E)).multiplyScalar(40);
cam.lookAt(0, 0.5, 0);

const right = new THREE.Vector3(1, 0, -1).normalize();
const back = new THREE.Vector3(-1, 0, -1).normalize();
const roles = q.get('roles') ? ROLE_ORDER.filter((r) => q.get('roles')!.split(',').includes(r)) : ROLE_ORDER;
roles.forEach((role, ri) => {
  looks.forEach((look, li) => {
    const v = createWorkerView(role, ROLES[role].outfit, look);
    const p = right.clone().multiplyScalar((li - (looks.length - 1) / 2) * 0.75).add(back.clone().multiplyScalar((ri - (roles.length - 1) / 2 + 0.6) * Number(q.get("gap") ?? 1.6)));
    v.root.position.copy(p);
    v.root.rotation.y = yaw;
    if (q.get('tool')) (v.tools as Record<string, THREE.Object3D>)[q.get('tool')!].visible = true;
    scene.add(v.root);
  });
});
looks.forEach((look, li) => {
  const v = createPerson(look * 7 + 3);
  const p = right.clone().multiplyScalar((li - (looks.length - 1) / 2) * 0.75).add(back.clone().multiplyScalar((-(roles.length - 1) / 2 - 0.5) * Number(q.get("gap") ?? 1.6)));
  v.root.position.copy(p);
  v.root.rotation.y = yaw;
  scene.add(v.root);
});

function resize() {
  const w = host.clientWidth;
  const h = host.clientHeight;
  renderer.setSize(w, h);
  const half = 3 / zoom;
  cam.left = (-half * w) / h;
  cam.right = (half * w) / h;
  cam.top = half;
  cam.bottom = -half;
  cam.updateProjectionMatrix();
}
resize();
addEventListener('resize', resize);
renderer.setAnimationLoop(() => renderer.render(scene, cam));
