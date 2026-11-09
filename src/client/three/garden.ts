import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Fence, Plant, Raised, V2 } from '../../shared/house';
import {
  barkMaterial,
  copingMaterial,
  fencePlankMaterial,
  fencePostMaterial,
  floorMaterial,
  foliageMaterial,
  gardenBrickMaterial,
  sleeperMaterial,
  stapelblokMaterial,
} from './materials';

/**
 * Tuin: verhoogde borders, schuttingen/tuinmuren en procedurele beplanting.
 * Alles wordt later met mergeByMaterial samengevoegd, dus losse meshes zijn hier prima.
 */

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------- hulpjes ----------

/** verticale strook langs a→b van y0 tot y1; uv in meters */
function quad(a: V2, b: V2, y0: number, y1: number, flip: boolean): THREE.BufferGeometry {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [p, q] = flip ? [b, a] : [a, b];
  const pos = [p[0], y0, p[1], q[0], y0, q[1], q[0], y1, q[1], p[0], y0, p[1], q[0], y1, q[1], p[0], y1, p[1]];
  const uv = [0, y0, len, y0, len, y1, 0, y0, len, y1, 0, y1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** horizontale vlakken van een polygoon op hoogte y (uv in meters) */
function cap(poly: V2[], y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

const signedArea = (poly: V2[]) => poly.reduce((s, p, i) => {
  const q = poly[(i + 1) % poly.length];
  return s + p[0] * q[1] - q[0] * p[1];
}, 0);

/** box met uv in meters op alle vlakken */
function meterBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // volgorde vlakken: +x, -x, +y, -y, +z, -z (4 hoekpunten elk)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  return g;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

// ---------- verhoogde borders ----------
export function buildRaised(items: Raised[]): THREE.Group {
  const g = new THREE.Group();
  for (const r of items) {
    const ccw = signedArea(r.polygon) > 0;
    const edgeMat = r.edge === 'stapelblok' ? stapelblokMaterial : sleeperMaterial;
    const rim = r.edge === 'stapelblok' ? 0.12 : 0.1;
    const n = r.polygon.length;
    // binnenrand: in verstek, zodat de stroken bovenop elkaar in de hoeken niet overlappen (geen z-fighting)
    const inwardOf = (i: number): V2 => {
      const a = r.polygon[i];
      const b = r.polygon[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return ccw ? [-(b[1] - a[1]) / len, (b[0] - a[0]) / len] : [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
    };
    const inner: V2[] = r.polygon.map((p, i) => {
      const n0 = inwardOf((i - 1 + n) % n);
      const n1 = inwardOf(i);
      const k = rim / Math.max(0.2, 1 + n0[0] * n1[0] + n0[1] * n1[1]);
      return [p[0] + (n0[0] + n1[0]) * k, p[1] + (n0[1] + n1[1]) * k];
    });
    for (let i = 0; i < n; i++) {
      const a = r.polygon[i];
      const b = r.polygon[(i + 1) % n];
      // buitenkant
      g.add(mesh(quad(a, b, -0.03, r.height, ccw), edgeMat));
      // rand bovenop: strook naar binnen
      const ia = inner[i];
      const ib = inner[(i + 1) % n];
      g.add(mesh(cap([a, b, ib, ia], r.height + 0.002), edgeMat, false));
      // binnenkant van de rand (zichtbaar boven de aarde)
      g.add(mesh(quad(ia, ib, r.height - 0.06, r.height, !ccw), edgeMat, false));
    }
    g.add(mesh(cap(r.polygon, r.height - 0.06), floorMaterial(r.top), false));
  }
  return g;
}

// ---------- schuttingen en tuinmuren ----------
export function buildGardenFences(fences: Fence[]): THREE.Group {
  const g = new THREE.Group();
  for (const f of fences) {
    const a = new THREE.Vector2(...f.a);
    const b = new THREE.Vector2(...f.b);
    const len = a.distanceTo(b);
    const ang = Math.atan2(-(b.y - a.y), b.x - a.x);
    const along = (t: number, y: number, o: THREE.Object3D) => {
      o.position.set(a.x + (b.x - a.x) * t, y, a.y + (b.y - a.y) * t);
      o.rotation.y = ang;
      g.add(o);
    };
    if (f.style === 'muur') {
      along(0.5, f.height / 2, mesh(meterBox(len, f.height, 0.22), gardenBrickMaterial));
      along(0.5, f.height + 0.03, mesh(new THREE.BoxGeometry(len + 0.04, 0.06, 0.27), copingMaterial));
      continue;
    }
    along(0.5, f.height / 2 + 0.03, mesh(meterBox(len, f.height - 0.06, 0.03), fencePlankMaterial));
    // afdeklat en palen om de 1,8 m
    along(0.5, f.height + 0.01, mesh(new THREE.BoxGeometry(len, 0.03, 0.09), fencePostMaterial));
    const posts = Math.max(1, Math.round(len / 1.8));
    for (let i = 0; i <= posts; i++) along(i / posts, f.height / 2, mesh(new THREE.BoxGeometry(0.07, f.height, 0.07), fencePostMaterial));
  }
  return g;
}

// ---------- beplanting ----------

/** onregelmatige bladbol: icosaëder met ruis langs de normaal en vertexkleur (onderkant donkerder) */
function blob(r: () => number, radius: number, color: THREE.Color, scale: [number, number, number] = [1, 1, 1], detail = 2): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const ph = [r() * 6.3, r() * 6.3, r() * 6.3, r() * 6.3];
  const f1 = 5 / radius;
  const f2 = 11 / radius;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const bump =
      0.16 * Math.sin(v.x * f1 + ph[0]) * Math.sin(v.y * f1 + ph[1]) * Math.sin(v.z * f1 + ph[2]) +
      0.08 * Math.sin(v.x * f2 + ph[3]) * Math.sin(v.z * f2 + ph[0]) +
      (r() - 0.5) * 0.07;
    v.addScaledVector(n, bump * radius);
    v.multiply(new THREE.Vector3(...scale));
    pos.setXYZ(i, v.x, v.y, v.z);
    // licht van boven, donker van onder en binnen
    const shade = 0.62 + 0.38 * (n.y * 0.5 + 0.5) + (r() - 0.5) * 0.12;
    c.copy(color).multiplyScalar(shade);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  // uv: bolprojectie, in meters zodat de bladtextuur overal even groot is
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    uv[i * 2] = (Math.atan2(v.z, v.x) + Math.PI) * radius;
    uv[i * 2 + 1] = v.y;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** stam of tak van p naar q */
function limb(p: THREE.Vector3, q: THREE.Vector3, r0: number, r1: number): THREE.Mesh {
  const dir = q.clone().sub(p);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, 8, 1);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.PI * 2 * r0, uv.getY(i) * len);
  const m = mesh(geo, barkMaterial);
  m.position.copy(p).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function leaves(geo: THREE.BufferGeometry, at: THREE.Vector3): THREE.Mesh {
  const m = mesh(geo, foliageMaterial);
  m.position.copy(at);
  return m;
}

const PALETTE: Record<Plant['kind'], string[]> = {
  bolboom: ['#7fa63e', '#6f9a35', '#8db24a'],
  esdoorn: ['#6f7d34', '#7c8738', '#748036', '#8a6a33', '#8f4f2c', '#76823a', '#839040'],
  bol: ['#3f6a2b', '#466f2e', '#3a6128'],
  struik: ['#517f35', '#5d8a3a', '#4a7631'],
  siergras: ['#a3ad6c', '#8f9c5c', '#b6b67a'],
  boom: ['#4f7a33', '#5a8538', '#46702d'],
  treurwilg: ['#8eab5c', '#9cb766', '#82a052'],
};

function buildPlant(p: Plant): THREE.Group {
  const g = new THREE.Group();
  const r = rng(p.seed ?? Math.round(p.position[0] * 131 + p.position[1] * 977));
  const col = () => new THREE.Color(PALETTE[p.kind][Math.floor(r() * PALETTE[p.kind].length)]);
  const H = p.height;
  const R = p.spread / 2;
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  switch (p.kind) {
    case 'bolboom': {
      // bolcatalpa: rechte stam, ronde dichte kroon
      const cy = H - R * 0.9;
      g.add(limb(v(0, 0, 0), v(0, cy, 0), 0.07, 0.05));
      g.add(leaves(blob(r, R * 0.8, col(), [1, 0.85, 1]), v(0, cy, 0)));
      for (let i = 0; i < 11; i++) {
        const th = r() * Math.PI * 2;
        const ph = Math.acos(1 - r() * 1.5);
        const d = R * 0.45;
        const at = v(Math.sin(ph) * Math.cos(th) * d, Math.cos(ph) * d * 0.75, Math.sin(ph) * Math.sin(th) * d).add(v(0, cy, 0));
        g.add(leaves(blob(r, R * (0.4 + r() * 0.15), col(), [1, 0.85, 1], 1), at));
      }
      break;
    }
    case 'esdoorn': {
      // Japanse esdoorn (dissectum): korte kronkelstam, brede hangende parasolkroon
      const top = v((r() - 0.5) * 0.2, H * 0.55, (r() - 0.5) * 0.2);
      const mid = v((r() - 0.5) * 0.15, H * 0.28, (r() - 0.5) * 0.15);
      g.add(limb(v(0, 0, 0), mid, 0.06, 0.05));
      g.add(limb(mid, top, 0.05, 0.035));
      for (let i = 0; i < 5; i++) {
        const th = (i / 5) * Math.PI * 2 + r();
        g.add(limb(top, v(Math.cos(th) * R * 0.55, H * 0.72, Math.sin(th) * R * 0.55), 0.03, 0.015));
      }
      g.add(leaves(blob(r, R * 0.5, new THREE.Color('#6f7d34'), [1.1, 0.42, 1.1]), v(0, H * 0.82, 0)));
      // gelaagde, hangende kroon van veel kleine platte plukken
      const n = 34;
      for (let i = 0; i < n; i++) {
        const th = r() * Math.PI * 2;
        const d = R * Math.sqrt(0.08 + r() * 0.92) * 0.88;
        const y = H * (0.86 - (d / R) * 0.42) - r() * 0.12;
        g.add(leaves(blob(r, R * (0.17 + r() * 0.08), col(), [1.15, 0.5, 1.15], 1), v(Math.cos(th) * d, y, Math.sin(th) * d)));
      }
      break;
    }
    case 'bol': {
      g.add(leaves(blob(r, R, col(), [1, H / (2 * R), 1]), v(0, H / 2, 0)));
      break;
    }
    case 'struik': {
      for (let i = 0; i < 5; i++) {
        const th = r() * Math.PI * 2;
        const d = R * 0.45 * r();
        const rr = R * (0.45 + r() * 0.2);
        g.add(leaves(blob(r, rr, col(), [1, (H / (2 * R)) * 1.1, 1], 1), v(Math.cos(th) * d, rr * (H / (2 * R)), Math.sin(th) * d)));
      }
      break;
    }
    case 'siergras': {
      const geo = new THREE.ConeGeometry(0.03, 1, 4, 1);
      geo.translate(0, 0.5, 0);
      for (let i = 0; i < 48; i++) {
        const blade = geo.clone();
        const h = H * (0.6 + r() * 0.4);
        blade.scale(1, h, 1);
        const th = r() * Math.PI * 2;
        const tilt = r() * 0.55;
        blade.rotateZ(tilt);
        blade.rotateY(th);
        const c = col().multiplyScalar(0.8 + r() * 0.3);
        const colors = new Float32Array(blade.getAttribute('position').count * 3);
        for (let k = 0; k < colors.length; k += 3) colors.set([c.r, c.g, c.b], k);
        blade.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        g.add(mesh(blade, foliageMaterial, false));
      }
      break;
    }
    case 'boom': {
      const cy = H * 0.62;
      g.add(limb(v(0, 0, 0), v(0, cy, 0), 0.22, 0.14));
      for (let i = 0; i < 4; i++) {
        const th = r() * Math.PI * 2;
        g.add(limb(v(0, cy * 0.75, 0), v(Math.cos(th) * R * 0.5, cy + R * 0.2, Math.sin(th) * R * 0.5), 0.1, 0.05));
      }
      g.add(leaves(blob(r, R * 0.7, col(), [1, 0.85, 1]), v(0, cy + R * 0.25, 0)));
      for (let i = 0; i < 12; i++) {
        const th = r() * Math.PI * 2;
        const ph = Math.acos(1 - r() * 1.6);
        const d = R * 0.55;
        g.add(leaves(blob(r, R * (0.35 + r() * 0.15), col(), [1, 0.85, 1], 1), v(Math.sin(ph) * Math.cos(th) * d, cy + R * 0.25 + Math.cos(ph) * d * 0.8, Math.sin(ph) * Math.sin(th) * d)));
      }
      break;
    }
    case 'treurwilg': {
      const cy = H * 0.55;
      g.add(limb(v(0, 0, 0), v(0, cy, 0), 0.25, 0.16));
      g.add(leaves(blob(r, R * 0.55, col(), [1, 0.8, 1]), v(0, cy + R * 0.35, 0)));
      for (let i = 0; i < 14; i++) {
        const th = (i / 14) * Math.PI * 2 + r() * 0.3;
        const d = R * (0.55 + r() * 0.3);
        // hangende gordijnen: langgerekt naar beneden
        g.add(leaves(blob(r, R * 0.28, col(), [0.8, 2.1, 0.8], 1), v(Math.cos(th) * d, cy - R * 0.05 + r() * 0.4, Math.sin(th) * d)));
      }
      break;
    }
  }
  g.position.set(p.position[0], p.y ?? 0, p.position[1]);
  g.rotation.y = r() * Math.PI * 2;
  return g;
}

export function buildPlants(plants: Plant[]): THREE.Group {
  const g = new THREE.Group();
  for (const p of plants) g.add(buildPlant(p));
  return g;
}
