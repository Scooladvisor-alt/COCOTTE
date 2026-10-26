// Étiquettes HTML ancrées dans le monde 3D (style « pastilles » de la référence)
// et textes flottants (+1,20 €, +3 œufs…).
import * as THREE from 'three';

interface Label {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  html: string;
  cls: string;
  seen: boolean;
  w: number;
  h: number;
  /** Décalage vertical lissé pour éviter les chevauchements. */
  dy: number;
}

interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  t: number;
  life: number;
}

const v = new THREE.Vector3();

export class LabelLayer {
  root: HTMLDivElement;
  private labels = new Map<string, Label>();
  private floaters: Floater[] = [];
  onClick: ((key: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'world-labels';
    parent.appendChild(this.root);
    this.root.addEventListener('pointerdown', (e) => {
      const t = (e.target as HTMLElement).closest('[data-key]') as HTMLElement | null;
      if (t && this.onClick) {
        e.stopPropagation();
        this.onClick(t.dataset.key!);
      }
    });
  }

  begin() {
    for (const l of this.labels.values()) l.seen = false;
  }

  set(key: string, x: number, y: number, z: number, html: string, cls = '') {
    let l = this.labels.get(key);
    if (!l) {
      const el = document.createElement('div');
      el.dataset.key = key;
      this.root.appendChild(el);
      l = { el, pos: new THREE.Vector3(), html: '', cls: '', seen: true, w: 0, h: 0, dy: 0 };
      this.labels.set(key, l);
    }
    l.seen = true;
    l.pos.set(x, y, z);
    let dirty = false;
    if (l.html !== html) {
      l.el.innerHTML = html;
      l.html = html;
      dirty = true;
    }
    const c = `wl ${cls}`;
    if (l.cls !== c) {
      l.el.className = c;
      l.cls = c;
      dirty = true;
    }
    if (dirty || l.w === 0) {
      l.w = l.el.offsetWidth;
      l.h = l.el.offsetHeight;
    }
  }

  end() {
    for (const [k, l] of this.labels) {
      if (!l.seen) {
        l.el.remove();
        this.labels.delete(k);
      }
    }
  }

  float(x: number, y: number, z: number, text: string, cls = '') {
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.root.appendChild(el);
    this.floaters.push({ el, pos: new THREE.Vector3(x, y, z), t: 0, life: 1.6 });
    if (this.floaters.length > 40) this.floaters.shift()!.el.remove();
  }

  update(camera: THREE.Camera, w: number, h: number, dt: number) {
    // projection, puis écartement vertical des étiquettes qui se chevauchent
    const placed: Array<{ l: Label; x: number; y: number }> = [];
    for (const l of this.labels.values()) {
      v.copy(l.pos).project(camera);
      placed.push({ l, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h });
    }
    placed.sort((a, b) => b.y - a.y);
    const boxes: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    for (const p of placed) {
      const lw = p.l.w || 80;
      const lh = (p.l.h || 24) + 3;
      let target = 0;
      if (!/bubble|mood|need|egg-dot/.test(p.l.cls)) {
        for (let k = 0; k < 6; k++) {
          const y1 = p.y + target;
          const y0 = y1 - lh;
          const hit = boxes.find((b) => p.x - lw / 2 < b.x1 && p.x + lw / 2 > b.x0 && y0 < b.y1 && y1 > b.y0);
          if (!hit) break;
          target -= y1 - hit.y0;
        }
        boxes.push({ x0: p.x - lw / 2, x1: p.x + lw / 2, y0: p.y + target - lh, y1: p.y + target });
      }
      p.l.dy += (target - p.l.dy) * Math.min(1, dt * 12);
      const sy = p.y + p.l.dy;
      const off = p.x < -80 || p.x > w + 80 || sy < -40 || sy > h + 40;
      p.l.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
      p.l.el.style.display = off ? 'none' : '';
    }
    this.floaters = this.floaters.filter((f) => {
      f.t += dt;
      if (f.t >= f.life) {
        f.el.remove();
        return false;
      }
      v.copy(f.pos).project(camera);
      const sx = (v.x * 0.5 + 0.5) * w;
      const sy = (-v.y * 0.5 + 0.5) * h - f.t * 38;
      const k = f.t / f.life;
      f.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%) scale(${(k < 0.15 ? 0.6 + k * 2.6 : 1).toFixed(2)})`;
      f.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
      return true;
    });
  }
}
