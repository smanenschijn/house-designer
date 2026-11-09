import { viewToken } from '../viewMode';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ItemModel } from '../../shared/recipe';
import { mergeByMaterial } from './merge';

/**
 * GLB-modellen (uit Blender of geüpload): één keer laden per bestand, daarna klonen per plaatsing.
 * Het model wordt geschaald, gedraaid en zo verschoven dat de onderkant-midden in de oorsprong ligt
 * (zelfde afspraak als bij recepten).
 */

const loader = new GLTFLoader();
const sources = new Map<string, Promise<THREE.Group>>();
let pending = 0;
const listeners = new Set<() => void>();

export const modelUrl = (m: Pick<ItemModel, 'file'>) => (viewToken ? `/api/view/${viewToken}/models/${m.file}` : `/api/models/${m.file}`);

/** aantal modellen dat nog laadt (de rendermodus wacht hierop) */
export const pendingModels = () => pending;
export function onModelsSettled(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function loadSource(url: string): Promise<THREE.Group> {
  let p = sources.get(url);
  if (!p) {
    pending++;
    p = loader
      .loadAsync(url)
      .then((gltf) => {
        const merged = mergeByMaterial(gltf.scene);
        merged.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
            const std = mat as THREE.MeshStandardMaterial;
            if (std.map) std.map.anisotropy = 8;
            if ('envMapIntensity' in std) std.envMapIntensity = 1;
          }
        });
        return merged;
      })
      .finally(() => {
        pending--;
        listeners.forEach((fn) => fn());
      });
    p.catch(() => sources.delete(url));
    sources.set(url, p);
  }
  return p;
}

/** kloon van het model, genormaliseerd (schaal, draaiing, onderkant-midden in de oorsprong) */
export async function loadModelObject(model: ItemModel, url = modelUrl(model)): Promise<THREE.Group> {
  const src = await loadSource(url);
  const inner = src.clone(true);
  inner.scale.setScalar(model.scale);
  inner.rotation.y = (model.rotation * Math.PI) / 180;
  const wrap = new THREE.Group();
  wrap.add(inner);
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(inner);
  inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  return wrap;
}

/** model laden uit een lokaal bestand (voorvertoning vóór het uploaden) */
export async function loadFileObject(file: File): Promise<{ object: THREE.Group; size: THREE.Vector3; triangles: number }> {
  const buf = await file.arrayBuffer();
  const gltf = await loader.parseAsync(buf, '');
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  let triangles = 0;
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) triangles += (m.geometry.index?.count ?? m.geometry.getAttribute('position').count) / 3;
  });
  return { object: gltf.scene, size, triangles: Math.round(triangles) };
}
