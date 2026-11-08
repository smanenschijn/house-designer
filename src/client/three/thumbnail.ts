import * as THREE from 'three';
import type { Recipe } from '../../shared/recipe';
import { buildRecipe, disposeGroup } from './recipeMesh';
import { roomEnvironment } from './environment';

/** Kleine voorvertoningen van recepten, met één gedeelde offscreen renderer. */
let renderer: THREE.WebGLRenderer | null = null;
const cache = new Map<string, string>();
const W = 240;
const H = 180;

function getRenderer() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }
  return renderer;
}

export function recipeThumbnail(key: string, recipe: Recipe): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const r = getRenderer();
  const scene = new THREE.Scene();
  scene.environment = roomEnvironment(r);
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight('#ffffff', '#b9ad96', 1.8));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(-2, 4, 3);
  scene.add(sun);
  const g = buildRecipe(recipe, { shadows: false });
  scene.add(g);
  const { width, depth, height } = recipe.size;
  const radius = Math.max(0.3, Math.hypot(width, depth, height) / 2);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 100);
  const center = new THREE.Vector3(0, height / 2, 0);
  const dist = radius / Math.sin((30 * Math.PI) / 360) * 1.05;
  cam.position.copy(center).add(new THREE.Vector3(-0.55, 0.5, 0.75).normalize().multiplyScalar(dist));
  cam.lookAt(center);
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  disposeGroup(g);
  cache.set(key, url);
  return url;
}
