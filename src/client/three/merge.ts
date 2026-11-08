import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Voegt alle meshes in een object samen tot één mesh per materiaal (en schaduwinstelling).
 * Minder tekenopdrachten = soepeler beeld, vooral op telefoons en iPads.
 * Transformaties worden in de geometrie "gebakken"; het resultaat staat in lokale
 * coördinaten van `root`.
 */
export function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; renderOrder: number; geoms: THREE.BufferGeometry[] }>();
  const keep: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (Array.isArray(m.material)) {
      // meerdere materialen: niet samenvoegen, wel meenemen (met gebakken transformatie)
      const c = new THREE.Mesh(m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)), m.material);
      c.castShadow = m.castShadow;
      c.receiveShadow = m.receiveShadow;
      c.userData = { ...m.userData };
      keep.push(c);
      return;
    }
    const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}`;
    let b = buckets.get(key);
    if (!b) {
      b = { material: m.material, cast: m.castShadow, receive: m.receiveShadow, renderOrder: m.renderOrder, geoms: [] };
      buckets.set(key, b);
    }
    const g = normalize(m.geometry, (m.material as THREE.Material & { vertexColors?: boolean }).vertexColors === true);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    b.geoms.push(g);
  });
  const out = new THREE.Group();
  for (const k of keep) out.add(k);
  for (const b of buckets.values()) {
    const geo = b.geoms.length === 1 ? b.geoms[0] : mergeGeometries(b.geoms, false);
    if (b.geoms.length > 1) b.geoms.forEach((g) => g.dispose());
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.renderOrder = b.renderOrder;
    out.add(mesh);
  }
  out.userData = { ...root.userData };
  return out;
}

/** gelijke attributen (position, normal, uv), niet-geïndexeerd, zodat samenvoegen altijd kan */
function normalize(src: THREE.BufferGeometry, keepColor: boolean): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(keepColor && name === 'color')) g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  g.clearGroups();
  return g;
}
