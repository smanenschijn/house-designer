import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Fence, FlatRoof, GableRoof, House, Level, Opening, Room, V2, Wall } from '../../shared/house';
import { buildRecipe } from './recipeMesh';
import {
  HOUSE_COLORS,
  doorMaterial,
  fenceMaterial,
  floorMaterial,
  frameMaterial,
  glassMaterial,
  roofMaterial,
  slabEdgeMaterial,
} from './materials';

export type WallMode = 'up' | 'cutaway' | 'down';

export interface WallFrame {
  a: THREE.Vector2;
  dir: THREE.Vector2;
  n: THREE.Vector2; // normaal (lokale +z)
  len: number;
}

export function wallFrame(w: Wall): WallFrame {
  const a = new THREE.Vector2(w.a[0], w.a[1]);
  const b = new THREE.Vector2(w.b[0], w.b[1]);
  const len = a.distanceTo(b);
  const dir = b.clone().sub(a).divideScalar(len || 1);
  const n = new THREE.Vector2(-dir.y, dir.x);
  return { a, dir, n, len };
}

function wallMatrix(f: WallFrame, elevation: number, s: number): THREE.Matrix4 {
  const theta = Math.atan2(-f.dir.y, f.dir.x);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), theta);
  const p = new THREE.Vector3(f.a.x + f.n.x * s, elevation, f.a.y + f.n.y * s);
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
}

const STUB = 0.3;

/** stukken muur als polygonen in het (u, y)-vlak */
function wallPieces(w: Wall, level: Level, cut: number | null): V2[][] {
  const f = wallFrame(w);
  const L = f.len;
  const top = (u: number) => {
    const t = w.topByZ ? w.topByZ(w.a[1] + f.dir.y * u) : (w.height ?? level.storeyHeight);
    return cut === null ? t : Math.min(t, cut);
  };
  const openings = (w.openings ?? []).map((o) => ({ ...o, u0: Math.max(0, o.at - o.width / 2), u1: Math.min(L, o.at + o.width / 2) }));
  const breaks = new Set<number>([0, L]);
  for (const o of openings) {
    breaks.add(o.u0);
    breaks.add(o.u1);
  }
  if (w.topByZ) for (let u = 0; u < L; u += 0.1) breaks.add(u);
  const us = [...breaks].sort((x, y) => x - y);
  const polys: V2[][] = [];
  const quad = (u0: number, u1: number, yb: number, t0: number, t1: number) => {
    if (t0 - yb < 0.005 && t1 - yb < 0.005) return;
    polys.push([
      [u0, yb],
      [u1, yb],
      [u1, Math.max(yb + 0.001, t1)],
      [u0, Math.max(yb + 0.001, t0)],
    ]);
  };
  for (let i = 0; i < us.length - 1; i++) {
    const u0 = us[i];
    const u1 = us[i + 1];
    if (u1 - u0 < 1e-4) continue;
    const mid = (u0 + u1) / 2;
    const op = openings.find((o) => mid > o.u0 && mid < o.u1);
    const t0 = top(u0);
    const t1 = top(u1);
    if (!op) {
      quad(u0, u1, 0, t0, t1);
      continue;
    }
    const sill = op.sill ?? 0;
    if (sill > 0) quad(u0, u1, 0, Math.min(sill, t0), Math.min(sill, t1));
    const head = sill + op.height;
    if (t0 > head + 0.005 || t1 > head + 0.005) quad(u0, u1, head, Math.max(head, t0), Math.max(head, t1));
  }
  return polys;
}

function extrudePoly(poly: V2[], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map(([u, y]) => new THREE.Vector2(u, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.deleteAttribute('uv');
  return g;
}

function colorize(g: THREE.BufferGeometry, side: THREE.Color, cap: THREE.Color) {
  const normal = g.getAttribute('normal');
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    const c = normal.getY(i) > 0.7 ? cap : side;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** muurgeometrie (samengevoegd) voor een verdieping */
export function buildWalls(level: Level, cutFor: (w: Wall) => number | null): THREE.BufferGeometry | null {
  const geoms: THREE.BufferGeometry[] = [];
  for (const w of level.walls) {
    const cut = cutFor(w);
    const polys = wallPieces(w, level, cut);
    const f = wallFrame(w);
    const t = w.thickness;
    // lagen: [s0, s1, kleur]
    const layers: [number, number, THREE.Color][] = [];
    if (w.outside) {
      const out = f.n.x * w.outside[0] + f.n.y * w.outside[1] > 0 ? 1 : -1;
      const outer = w.party ? HOUSE_COLORS.party : HOUSE_COLORS.brick;
      const skin = Math.min(0.1, t / 2);
      if (out > 0) {
        layers.push([-t / 2, t / 2 - skin, HOUSE_COLORS.paint]);
        layers.push([t / 2 - skin, t / 2, outer]);
      } else {
        layers.push([-t / 2, -t / 2 + skin, outer]);
        layers.push([-t / 2 + skin, t / 2, HOUSE_COLORS.paint]);
      }
    } else layers.push([-t / 2, t / 2, HOUSE_COLORS.paint]);
    for (const [s0, s1, color] of layers) {
      const m = wallMatrix(f, level.elevation, s0);
      for (const poly of polys) {
        const g = extrudePoly(poly, s1 - s0);
        g.applyMatrix4(m);
        colorize(g, color, HOUSE_COLORS.cap);
        geoms.push(g);
      }
    }
  }
  if (!geoms.length) return null;
  const merged = mergeGeometries(geoms, false);
  geoms.forEach((g) => g.dispose());
  return merged;
}

/** ramen, deuren en kozijnen */
export function buildOpenings(level: Level, cutFor: (w: Wall) => number | null): THREE.Group {
  const group = new THREE.Group();
  for (const w of level.walls) {
    if (!w.openings?.length) continue;
    const cut = cutFor(w);
    const f = wallFrame(w);
    const outSign = w.outside ? (f.n.x * w.outside[0] + f.n.y * w.outside[1] > 0 ? 1 : -1) : 0;
    const s = outSign * (w.thickness / 2 - 0.09);
    const theta = Math.atan2(-f.dir.y, f.dir.x);
    for (const o of w.openings) {
      const sill = o.sill ?? 0;
      const visTop = cut === null ? sill + o.height : Math.min(sill + o.height, cut);
      const h = visTop - sill;
      if (h < 0.03) continue;
      const g = openingMesh(o, h, cut !== null && cut < sill + o.height);
      g.position.set(f.a.x + f.dir.x * o.at + f.n.x * s, level.elevation + sill, f.a.y + f.dir.y * o.at + f.n.y * s);
      g.rotation.y = theta;
      group.add(g);
    }
  }
  return group;
}

function openingMesh(o: Opening, h: number, clipped: boolean): THREE.Group {
  const g = new THREE.Group();
  const bar = (w: number, hh: number, x: number, y: number, mat: THREE.Material = frameMaterial, d = 0.07) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
    m.position.set(x, y, 0);
    m.castShadow = true;
    g.add(m);
  };
  const fw = 0.055;
  if (o.kind === 'window' || o.kind === 'glassDoor') {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(o.width - 0.02, h, 0.012), glassMaterial);
    glass.position.y = h / 2;
    glass.renderOrder = 2;
    g.add(glass);
    bar(fw, h, -o.width / 2 + fw / 2, h / 2);
    bar(fw, h, o.width / 2 - fw / 2, h / 2);
    bar(o.width, fw, 0, fw / 2);
    if (!clipped) bar(o.width, fw, 0, h - fw / 2);
    const panes = Math.max(1, Math.round(o.width / (o.kind === 'glassDoor' ? 0.7 : 1.0)));
    for (let i = 1; i < panes; i++) bar(fw * 0.8, h, -o.width / 2 + (o.width / panes) * i, h / 2);
    if (o.kind === 'window' && !clipped && o.height > 1.3) bar(o.width, fw * 0.8, 0, h * 0.72);
  } else if (o.kind === 'frontDoor') {
    bar(o.width - 0.04, h, 0, h / 2, doorMaterial, 0.05);
    for (let i = 0; i < 4; i++) {
      const y = 0.45 + i * 0.42;
      if (y + 0.1 < h) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.06), glassMaterial);
        strip.position.set(0, y, 0);
        g.add(strip);
      }
    }
  }
  return g;
}

// ---------- vloeren ----------
function shapeFromPolygon(poly: V2[]): THREE.Shape {
  // vormcoördinaten (x, -z) zodat rotatie -90° om x de juiste kant op ligt
  return new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
}

export function buildFloors(rooms: Room[], elevation: number, slab: number, yOffset = 0.004, stack = 0): THREE.Group {
  const group = new THREE.Group();
  for (const [i, r] of rooms.entries()) {
    const shape = shapeFromPolygon(r.polygon);
    let mesh: THREE.Mesh;
    if (slab > 0) {
      const g = new THREE.ExtrudeGeometry(shape, { depth: slab, bevelEnabled: false });
      mesh = new THREE.Mesh(g, [floorMaterial(r.floor), slabEdgeMaterial]);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = elevation - slab + yOffset;
    } else {
      const g = new THREE.ShapeGeometry(shape);
      mesh = new THREE.Mesh(g, floorMaterial(r.floor));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = elevation + yOffset + i * stack;
    }
    mesh.receiveShadow = true;
    mesh.userData = { roomId: r.id, floor: true };
    group.add(mesh);
  }
  return group;
}

// ---------- vaste inbouw ----------
export function buildFixtures(fixtures: Level['fixtures'], elevation: number, showHigh: boolean): THREE.Group {
  const group = new THREE.Group();
  for (const fx of fixtures) {
    if (fx.high && !showHigh) continue;
    const g = buildRecipe(fx.recipe);
    g.position.set(fx.position[0], elevation + (fx.y ?? 0), fx.position[1]);
    g.rotation.y = ((fx.rotation ?? 0) * Math.PI) / 180;
    g.userData = { fixture: fx.id, name: fx.name };
    group.add(g);
  }
  return group;
}

// ---------- daken ----------
export function buildRoofs(roofs: House['roofs']): THREE.Group {
  const group = new THREE.Group();
  for (const r of roofs) group.add(r.kind === 'gable' ? gableRoof(r) : flatRoof(r));
  return group;
}

function gableRoof(r: GableRoof): THREE.Group {
  const g = new THREE.Group();
  const T = r.thickness;
  const slopes: [number, number][] = [
    [r.zBack, r.ridgeZ],
    [r.ridgeZ, r.zFront],
  ];
  const depth = r.x1 - r.x0;
  for (const [z0, z1] of slopes) {
    const y0 = r.underside(z0);
    const y1 = r.underside(z1);
    const shape = new THREE.Shape([
      new THREE.Vector2(z0, y0),
      new THREE.Vector2(z1, y1),
      new THREE.Vector2(z1, y1 + T),
      new THREE.Vector2(z0, y0 + T),
    ]);
    const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    // lokale x = wereld z, lokale y = y, lokale z = -wereld x
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0));
    m.setPosition(r.x1, 0, 0);
    geom.applyMatrix4(m);
    // uv's: gebruik wereldcoördinaten langs het dakvlak
    const pos = geom.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i);
      uv[i * 2 + 1] = pos.getZ(i) * 1.2;
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geom, roofMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  for (const s of r.skylights ?? []) {
    const zc = (s.z0 + s.z1) / 2;
    const yc = r.underside(zc) + T + 0.03;
    const slope = Math.atan((r.underside(zc + 0.01) - r.underside(zc - 0.01)) / 0.02);
    const len = (s.z1 - s.z0) / Math.cos(slope);
    const m = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0, 0.06, len), new THREE.MeshStandardMaterial({ color: '#2b3a44', roughness: 0.15, metalness: 0.3 }));
    m.position.set((s.x0 + s.x1) / 2, yc, zc);
    m.rotation.x = -slope;
    g.add(m);
  }
  // nokvorst
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(depth, 0.08, 0.25), new THREE.MeshStandardMaterial({ color: '#3a3533', roughness: 0.8 }));
  ridge.position.set((r.x0 + r.x1) / 2, r.underside(r.ridgeZ) + T + 0.02, r.ridgeZ);
  g.add(ridge);
  return g;
}

function flatRoof(r: FlatRoof): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(r.x1 - r.x0, r.thickness, r.z1 - r.z0),
    new THREE.MeshStandardMaterial({ color: r.color ?? '#444444', roughness: 0.85 }),
  );
  m.position.set((r.x0 + r.x1) / 2, r.y + r.thickness / 2, (r.z0 + r.z1) / 2);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------- tuin ----------
export function buildFences(fences: Fence[]): THREE.Group {
  const g = new THREE.Group();
  for (const f of fences) {
    const a = new THREE.Vector2(...f.a);
    const b = new THREE.Vector2(...f.b);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, f.height, 0.04), fenceMaterial);
    m.position.set((a.x + b.x) / 2, f.height / 2, (a.y + b.y) / 2);
    m.rotation.y = Math.atan2(-(b.y - a.y), b.x - a.x);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
}

/** Bepaalt welke muren laag moeten (cutaway) op basis van de kijkrichting. */
export function cutawaySet(level: Level, camDir: THREE.Vector2): Set<string> {
  const cx = level.rooms.reduce((s, r) => s + r.polygon.reduce((a, p) => a + p[0], 0) / r.polygon.length, 0) / Math.max(1, level.rooms.length);
  const cz = level.rooms.reduce((s, r) => s + r.polygon.reduce((a, p) => a + p[1], 0) / r.polygon.length, 0) / Math.max(1, level.rooms.length);
  const out = new Set<string>();
  for (const w of level.walls) {
    const f = wallFrame(w);
    if (w.outside) {
      // buitenmuur: omlaag als de buitenkant naar de camera wijst
      if (-(w.outside[0] * camDir.x + w.outside[1] * camDir.y) > 0.2) out.add(w.id);
      continue;
    }
    const mx = (w.a[0] + w.b[0]) / 2 - cx;
    const mz = (w.a[1] + w.b[1]) / 2 - cz;
    const front = mx * camDir.x + mz * camDir.y; // < 0: aan camerazijde
    const facing = Math.abs(f.n.x * camDir.x + f.n.y * camDir.y);
    if (front < -0.3 && facing > 0.3) out.add(w.id);
  }
  return out;
}

export { STUB };
