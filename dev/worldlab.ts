// Atelier de développement : la ferme de départ et la campagne alentour, rendues dès le chargement.
// ?zoom=0.55&x=30&z=5&h=11 (heure) &parcels=0,2;1,2 (parcelles possédées) &showcase=1
import { FarmRenderer } from '../src/render/farmRenderer';
import { TIME, HOUR } from '../src/config/balance';
import { newFarm } from '../src/sim/starter';
import { makeBuilding } from '../src/sim/state';
import { createShowcase } from '../src/sim/showcase';
import { invalidateLayout } from '../src/sim/core';
import { autoEnclose } from '../src/sim/fences';
import * as A from '../src/sim/actions';
import { advance } from '../src/sim/simulation';
import { drainEvents } from '../src/sim/core';

const q = new URLSearchParams(location.search);
const s = q.get('showcase') ? createShowcase() : newFarm(7);
s.clock.t = TIME.DAY + Number(q.get('h') ?? 11) * HOUR;
if (q.get('parcels')) {
  s.parcels = q.get('parcels')!.split(';');
  invalidateLayout(s);
  autoEnclose(s);
}
// ?build=pond:3,13;tree:9,12 (bâtiments posés pour l'aperçu)
if (q.get('build')) {
  s.money = 1e7;
  s.xp = 99999;
  for (const item of q.get('build')!.split(';')) {
    // type:x,z ou type:x,z:niveau
    const [type, at, lv] = item.split(':');
    const [x, z] = at.split(',').map(Number);
    const r = A.build(s, type as never, x, z);
    if (!r.ok) console.warn(item, r.reason);
    const levels = Number(lv ?? q.get('lvl') ?? 1);
    for (let k = 1; k < levels; k++) A.upgrade(s, s.buildings[s.buildings.length - 1].id);
  }
}
// ?raw=storage:9,11:3 : bâtiment posé sans contrôle (pour comparer les niveaux d'un bâtiment unique)
if (q.get('raw')) {
  for (const item of q.get('raw')!.split(';')) {
    const [type, at, lv] = item.split(':');
    const [x, z] = at.split(',').map(Number);
    const b = makeBuilding(s.nextId++, type as never, x, z);
    b.level = Number(lv ?? 1);
    s.buildings.push(b);
  }
  invalidateLayout(s);
}
// ?hens=12 : des poules en plus (pour voir le troupeau se répartir sur le pré)
if (q.get('hens')) {
  s.money = 1e7;
  for (let i = 0; i < Number(q.get('hens')); i++) A.buyHen(s, i % 2 ? 'rousse' : 'leghorn');
}
// ?graze=1 : une zone broutée (pour voir la terre et l'herbe jaunie)
if (q.get('graze')) {
  for (let z = 14; z < 26; z++) for (let x = 2; x < 12; x++) s.grass[(z + 30) * 80 + x] = Math.max(0, Math.min(1, 0.05 + Math.hypot(x - 7, z - 20) / 7));
}
const host = document.getElementById('c')!;
const r = new FarmRenderer(host);
r.setZoom(Number(q.get('zoom') ?? 1));
r.focusOn(Number(q.get('x') ?? 15), Number(q.get('z') ?? 25));
(window as never as { lab: unknown }).lab = { r, s };
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // ?sim=1 : la simulation tourne (vitesse ?speed=)
  if (q.get('sim')) {
    s.clock.speed = Number(q.get('speed') ?? 1);
    advance(s, dt);
    drainEvents(s);
  }
  r.update(s, dt);
  r.render(dt);
  requestAnimationFrame(frame);
}
for (let i = 0; i < 30; i++) r.update(s, 1 / 30);
// ?adv=12 : fait tourner la simulation 12 s (temps réel à vitesse 1) avant la première image
if (q.get('adv')) {
  s.clock.speed = 1;
  for (let t = 0; t < Number(q.get('adv')); t += 1 / 30) {
    advance(s, 1 / 30);
    drainEvents(s);
    r.update(s, 1 / 30);
  }
  console.log('poules', s.hens.map((h) => `${h.act}:${h.x.toFixed(2)},${h.z.toFixed(2)}`).join(' '));
}
r.render(0);
requestAnimationFrame(frame);
