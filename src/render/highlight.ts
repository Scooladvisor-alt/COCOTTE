// Mise en valeur de l'élément sélectionné, volontairement sobre : un léger éclaircissement,
// un fin liseré clair semi-transparent autour de la silhouette et un halo discret au sol
// (l'élément reste parfaitement lisible ; aucun texte dans la scène).
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Variante « illuminée » de chaque matériau (émissif animé), créée à la demande. */
const glowMats = new Map<THREE.Material, THREE.MeshLambertMaterial>();
function glowOf(m: THREE.MeshLambertMaterial) {
  let g = glowMats.get(m);
  if (!g) {
    g = m.clone();
    g.emissive = new THREE.Color(0xfff6e0);
    g.emissiveIntensity = 0.04;
    glowMats.set(m, g);
  }
  return g;
}

/** Coque de contour : sommets soudés et normales lissées, pour une silhouette sans fissure. */
const hulls = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
function hullOf(geo: THREE.BufferGeometry) {
  let h = hulls.get(geo);
  if (!h) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.getAttribute('position').clone());
    h = mergeVertices(g, 1e-3);
    h.computeVertexNormals();
    g.dispose();
    hulls.set(geo, h);
  }
  return h;
}

const OUTLINE_MAT = new THREE.ShaderMaterial({
  uniforms: { color: { value: new THREE.Color(0xfffaf0) }, width: { value: 0.022 }, opacity: { value: 0.5 } },
  vertexShader: /* glsl */ `
    uniform float width;
    void main() {
      vec3 p = position + normal * width;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform float opacity;
    void main() { gl_FragColor = vec4(color, opacity); }`,
  side: THREE.BackSide,
  transparent: true,
});

/** Halo doux (dégradé radial) réutilisé pour le sol sous la sélection. */
let haloTex: THREE.Texture | null = null;
export function haloTexture() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  haloTex = new THREE.CanvasTexture(c);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}

export class Highlight {
  private root: THREE.Object3D | null = null;
  private swapped: Array<[THREE.Mesh, THREE.Material]> = [];
  private shells: THREE.Mesh[] = [];

  /** Met en valeur `root` (ou retire la mise en valeur si null). */
  set(root: THREE.Object3D | null) {
    if (root === this.root) return;
    this.clear();
    if (!root) return;
    this.root = root;
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material instanceof THREE.MeshLambertMaterial && !m.userData.shell) meshes.push(m);
    });
    for (const m of meshes) {
      this.swapped.push([m, m.material as THREE.Material]);
      m.material = glowOf(m.material as THREE.MeshLambertMaterial);
      const shell = new THREE.Mesh(hullOf(m.geometry), OUTLINE_MAT);
      shell.userData.shell = true;
      shell.renderOrder = m.renderOrder;
      shell.castShadow = false;
      shell.receiveShadow = false;
      m.add(shell);
      this.shells.push(shell);
    }
  }

  clear() {
    for (const [m, mat] of this.swapped) m.material = mat;
    for (const s of this.shells) s.parent?.remove(s);
    this.swapped = [];
    this.shells = [];
    this.root = null;
  }

  /** Pulsation douce de l'éclat et du liseré. */
  update(time: number) {
    const k = 0.5 + 0.5 * Math.sin(time * 3.6);
    for (const g of glowMats.values()) g.emissiveIntensity = 0.03 + 0.03 * k;
    OUTLINE_MAT.uniforms.opacity.value = 0.42 + 0.14 * k;
  }
}
