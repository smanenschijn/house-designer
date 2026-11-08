import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Part, Recipe } from '../../shared/recipe';
import { recipeMaterial } from './materials';

const DEG = Math.PI / 180;

function partGeometry(p: Part): THREE.BufferGeometry {
  switch (p.shape) {
    case 'box': {
      const [x, y, z] = p.size;
      const r = Math.min(p.radius ?? 0, Math.min(x, y, z) / 2 - 1e-4);
      return r > 0.001 ? new RoundedBoxGeometry(x, y, z, 3, r) : new THREE.BoxGeometry(x, y, z);
    }
    case 'cylinder': {
      const rt = p.radiusTop ?? p.radius ?? 0.05;
      const rb = p.radiusBottom ?? p.radius ?? 0.05;
      return new THREE.CylinderGeometry(rt, rb, p.height, p.segments ?? 24);
    }
    case 'sphere':
      return new THREE.SphereGeometry(p.radius, 32, 16);
    case 'torus':
      return new THREE.TorusGeometry(p.radius, p.tube, 12, 48, (p.arc ?? 360) * DEG);
    case 'extrude': {
      const shape = new THREE.Shape(p.points.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: p.depth,
        bevelEnabled: (p.bevel ?? 0) > 0,
        bevelSize: p.bevel ?? 0,
        bevelThickness: p.bevel ?? 0,
        bevelSegments: 2,
      });
      g.translate(0, 0, -p.depth / 2);
      return g;
    }
    case 'lathe':
      return new THREE.LatheGeometry(
        p.points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)),
        p.segments ?? 32,
      );
  }
}

/** Bouwt een Three.js-groep uit een recept. Oorsprong = midden onderkant. */
export function buildRecipe(recipe: Recipe, opts: { shadows?: boolean } = {}): THREE.Group {
  const group = new THREE.Group();
  for (const p of recipe.parts) {
    const geom = partGeometry(p);
    const mesh = new THREE.Mesh(geom, recipeMaterial(recipe.materials[p.material]));
    mesh.position.set(...(p.position ?? [0, 0, 0]));
    if (p.rotation) mesh.rotation.set(p.rotation[0] * DEG, p.rotation[1] * DEG, p.rotation[2] * DEG);
    if (p.shape === 'sphere' && p.scale) mesh.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    if (opts.shadows !== false) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    if (p.name) mesh.name = p.name;
    group.add(mesh);
  }
  return group;
}

export function disposeGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
  });
}

/** Werkelijke afmetingen van het gebouwde model (ter controle tegen recipe.size). */
export function measure(group: THREE.Object3D) {
  const b = new THREE.Box3().setFromObject(group);
  const s = new THREE.Vector3();
  b.getSize(s);
  return { width: s.x, height: s.y, depth: s.z, min: b.min.clone(), max: b.max.clone() };
}
