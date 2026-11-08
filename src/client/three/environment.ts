import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const cache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/** Omgevingstextuur zonder netwerk (RoomEnvironment), één per renderer. */
export function roomEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const hit = cache.get(renderer);
  if (hit) return hit;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  cache.set(renderer, tex);
  return tex;
}
