import * as THREE from 'three';
import type { ItemModel, Recipe } from '../../shared/recipe';
import { loadModelObject } from './glbModel';
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
  const g = buildRecipe(recipe, { shadows: false });
  const url = renderThumb(g, recipe.size);
  disposeGroup(g);
  cache.set(key, url);
  return url;
}

const modelThumbs = new Map<string, Promise<string>>();

/** voorvertoning van een GLB-model (asynchroon: het model moet eerst laden) */
export function modelThumbnail(model: ItemModel, size: Recipe['size']): Promise<string> {
  const key = `${model.file}:${model.scale}:${model.rotation}`;
  let p = modelThumbs.get(key);
  if (!p) {
    p = loadModelObject(model).then((obj) => renderThumb(obj, size));
    p.catch(() => modelThumbs.delete(key));
    modelThumbs.set(key, p);
  }
  return p;
}

/** voorvertoning van een los object (bijv. een GLB uit een lokaal bestand) */
export function objectThumbnail(obj: THREE.Object3D, size: Recipe['size']): string {
  return renderThumb(obj, size);
}

function renderThumb(g: THREE.Object3D, size: Recipe['size']): string {
  const r = getRenderer();
  const scene = new THREE.Scene();
  scene.environment = roomEnvironment(r);
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight('#ffffff', '#b9ad96', 1.8));
  const sun = new THREE.DirectionalLight('#ffffff', 2.2);
  sun.position.set(-2, 4, 3);
  scene.add(sun);
  scene.add(g);
  const { width, depth, height } = size;
  const radius = Math.max(0.3, Math.hypot(width, depth, height) / 2);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 100);
  const center = new THREE.Vector3(0, height / 2, 0);
  const dist = radius / Math.sin((30 * Math.PI) / 360) * 1.05;
  cam.position.copy(center).add(new THREE.Vector3(-0.55, 0.5, 0.75).normalize().multiplyScalar(dist));
  cam.lookAt(center);
  r.setClearColor(0x000000, 0);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  scene.remove(g);
  return url;
}
