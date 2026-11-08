import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Fence, FlatRoof, GableRoof, House, Level, Opening, Room, V2, Wall } from '../../shared/house';
import { buildRecipe } from './recipeMesh';
import { DEFAULT_WALL, wallFinishKey, type WallFinish } from '../../shared/variants';
import {
  HOUSE_COLORS,
  doorMaterial,
  fenceMaterial,
  floorMaterial,
  frameMaterial,
  glassMaterial,
  handleMaterial,
  innerSillMaterial,
  interiorDoorMaterial,
  neighborMaterial,
  outerSillMaterial,
  roofMaterial,
  shadowOnlyMaterial,
  slabEdgeMaterial,
} from './materials';

export type WallMode = 'up' | 'cutaway' | 'down';
export type WallLayer = 'paint' | 'brick' | 'party';

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

/** aan welke kant (+1/-1 langs n) zit de buitenkant van een gevel? */
const outSignOf = (w: Wall, f: WallFrame) => (w.outside ? (f.n.x * w.outside[0] + f.n.y * w.outside[1] > 0 ? 1 : -1) : 0);

export const STUB = 0.35;

/** stukken muur als polygonen in het (u, y)-vlak */
function wallPieces(w: Wall, level: Level, cut: number | null, extraBreaks: number[] = []): V2[][] {
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
  for (const u of extraBreaks) if (u > 0 && u < L) breaks.add(u);
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
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
}

function colorize(g: THREE.BufferGeometry, side: THREE.Color, cap: THREE.Color, sides?: { n: THREE.Vector2; plus: THREE.Color; minus: THREE.Color }) {
  const normal = g.getAttribute('normal');
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i++) {
    let c = normal.getY(i) > 0.7 ? cap : side;
    if (sides && c === side) {
      const d = normal.getX(i) * sides.n.x + normal.getZ(i) * sides.n.y;
      c = d < -0.5 ? sides.minus : sides.plus;
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

const paintCache = new Map<string, THREE.Color>();
function paintColor(hex: string | null) {
  const key = hex ?? DEFAULT_WALL;
  let c = paintCache.get(key);
  if (!c) {
    c = new THREE.Color(key);
    paintCache.set(key, c);
  }
  return c;
}

function mergeOrNull(list: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!list.length) return null;
  const m = mergeGeometries(list, false);
  list.forEach((g) => g.dispose());
  return m;
}

/** afwerking (verf/behang) van één kant van een muur op punt (x, z), of null (buiten een kamer) */
export type FaceFinishAt = (wall: Wall, side: 1 | -1, x: number, z: number) => WallFinish | null;

export interface WallGeometry {
  paint: THREE.BufferGeometry | null;
  brick: THREE.BufferGeometry | null;
  party: THREE.BufferGeometry | null;
  /** behangbanen: dunne vlakken voor de muur, per behangsoort samengevoegd */
  wallpaper: { finish: Extract<WallFinish, { kind: 'wallpaper' }>; geometry: THREE.BufferGeometry }[];
}

/** muurgeometrie per laag (stuc / baksteen / buurmuur) plus behang, uv's in meters */
export function buildWalls(level: Level, cutFor: (w: Wall) => number | null, finishAt?: FaceFinishAt): WallGeometry {
  const lists: Record<WallLayer, THREE.BufferGeometry[]> = { paint: [], brick: [], party: [] };
  const papers = new Map<string, { finish: Extract<WallFinish, { kind: 'wallpaper' }>; geoms: THREE.BufferGeometry[] }>();
  for (const w of level.walls) {
    const cut = cutFor(w);
    const f = wallFrame(w);
    const t = w.thickness;
    // muur opknippen waar de afwerking aan een van beide kanten verandert (kamergrens)
    const colorBreaks: number[] = [];
    const keyOf = (fin: WallFinish | null) => (fin ? wallFinishKey(fin) : '-');
    if (finishAt) {
      const off = t / 2 + 0.15;
      let prev: string | null = null;
      for (let u = 0.05; u < f.len; u += 0.1) {
        const px = f.a.x + f.dir.x * u;
        const pz = f.a.y + f.dir.y * u;
        const key = `${keyOf(finishAt(w, 1, px + f.n.x * off, pz + f.n.y * off))}|${keyOf(finishAt(w, -1, px - f.n.x * off, pz - f.n.y * off))}`;
        if (prev !== null && key !== prev) colorBreaks.push(u - 0.05);
        prev = key;
      }
    }
    const polys = wallPieces(w, level, cut, colorBreaks);
    const cap = cut === null ? HOUSE_COLORS.capLight : HOUSE_COLORS.cap;
    const layers: [number, number, WallLayer][] = [];
    if (w.outside) {
      const out = outSignOf(w, f);
      const outer: WallLayer = w.party ? 'party' : 'brick';
      const skin = Math.min(0.1, t / 2);
      if (out > 0) {
        layers.push([-t / 2, t / 2 - skin, 'paint']);
        layers.push([t / 2 - skin, t / 2, outer]);
      } else {
        layers.push([-t / 2, -t / 2 + skin, outer]);
        layers.push([-t / 2 + skin, t / 2, 'paint']);
      }
    } else layers.push([-t / 2, t / 2, 'paint']);
    for (const [s0, s1, layer] of layers) {
      const m = wallMatrix(f, level.elevation, s0);
      for (const poly of polys) {
        const g = extrudePoly(poly, s1 - s0);
        g.applyMatrix4(m);
        if (layer === 'paint') {
          // afwerking per kant: welke kamer (en welk muurvlak) ligt aan deze kant van dit stuk muur?
          const uc = (poly[0][0] + poly[1][0]) / 2;
          const px = f.a.x + f.dir.x * uc;
          const pz = f.a.y + f.dir.y * uc;
          const off = t / 2 + 0.15;
          const fin = (sgn: 1 | -1) => finishAt?.(w, sgn, px + f.n.x * off * sgn, pz + f.n.y * off * sgn) ?? null;
          const plus = fin(1);
          const minus = fin(-1);
          const tint = (x: WallFinish | null) => paintColor(x ? x.color : null);
          colorize(g, HOUSE_COLORS.white, cap, { n: f.n, plus: tint(plus), minus: tint(minus) });
          // behang: dun vlak net voor de muur (alleen aan de kant van de kamer)
          for (const [sgn, x] of [
            [1, plus],
            [-1, minus],
          ] as const) {
            if (!x || x.kind !== 'wallpaper') continue;
            const face = sgn > 0 ? s1 : s0;
            const pg = new THREE.ShapeGeometry(new THREE.Shape(poly.map(([uu, yy]) => new THREE.Vector2(uu, yy))));
            pg.applyMatrix4(wallMatrix(f, level.elevation, face + sgn * 0.0015));
            const key = wallFinishKey(x);
            const b = papers.get(key) ?? { finish: x, geoms: [] };
            b.geoms.push(pg);
            papers.set(key, b);
          }
        } else colorize(g, HOUSE_COLORS.white, cap);
        lists[layer].push(g);
      }
    }
  }
  return {
    paint: mergeOrNull(lists.paint),
    brick: mergeOrNull(lists.brick),
    party: mergeOrNull(lists.party),
    wallpaper: [...papers.values()].map((b) => ({ finish: b.finish, geometry: mergeOrNull(b.geoms)! })),
  };
}

/** plinten langs alle binnenzijdes van muren (onderbroken bij deuren) */
export function buildSkirting(level: Level): THREE.BufferGeometry | null {
  const H = 0.07;
  const D = 0.012;
  const list: THREE.BufferGeometry[] = [];
  for (const w of level.walls) {
    const f = wallFrame(w);
    const out = outSignOf(w, f);
    const gaps = (w.openings ?? [])
      .filter((o) => (o.sill ?? 0) < 0.05)
      .map((o) => [o.at - o.width / 2, o.at + o.width / 2] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    const segs: [number, number][] = [];
    let u = 0;
    for (const [g0, g1] of gaps) {
      if (g0 > u) segs.push([u, g0]);
      u = Math.max(u, g1);
    }
    if (u < f.len) segs.push([u, f.len]);
    for (const side of [1, -1]) {
      if (side === out) continue; // buitenkant: geen plint
      if (w.id.startsWith('berging')) continue;
      for (const [u0, u1] of segs) {
        if (u1 - u0 < 0.05) continue;
        const g = new THREE.BoxGeometry(u1 - u0, H, D);
        g.translate((u0 + u1) / 2, H / 2, 0);
        g.applyMatrix4(wallMatrix(f, level.elevation, side * (w.thickness / 2 + D / 2)));
        list.push(g);
      }
    }
  }
  return mergeOrNull(list);
}

/** ramen, deuren, kozijnen en vensterbanken */
export function buildOpenings(level: Level, cutFor: (w: Wall) => number | null): THREE.Group {
  const group = new THREE.Group();
  for (const w of level.walls) {
    if (!w.openings?.length) continue;
    const cut = cutFor(w);
    const f = wallFrame(w);
    const out = outSignOf(w, f);
    const s = out * (w.thickness / 2 - 0.09);
    const theta = Math.atan2(-f.dir.y, f.dir.x);
    for (const o of w.openings) {
      const sill = o.sill ?? 0;
      const visTop = cut === null ? sill + o.height : Math.min(sill + o.height, cut);
      const h = visTop - sill;
      if (h < 0.03) continue;
      const clipped = cut !== null && cut < sill + o.height;
      const g = openingMesh(o, h, clipped, w.thickness, out, s);
      g.position.set(f.a.x + f.dir.x * o.at + f.n.x * s, level.elevation + sill, f.a.y + f.dir.y * o.at + f.n.y * s);
      g.rotation.y = theta;
      group.add(g);
    }
  }
  return group;
}

function openingMesh(o: Opening, h: number, clipped: boolean, t: number, out: number, s: number): THREE.Group {
  const g = new THREE.Group();
  const box = (w: number, hh: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };
  const fw = 0.065; // kozijnprofiel
  const fd = 0.09;
  // lokale z = n; binnenkant van de muur ligt op z = -out*t/2 - s
  const innerZ = (out === 0 ? -t / 2 : -out * t / 2) - s;
  const outerZ = (out === 0 ? t / 2 : out * t / 2) - s;

  if (o.kind === 'window' || o.kind === 'glassDoor') {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(o.width - 0.04, h, 0.012), glassMaterial);
    glass.position.y = h / 2;
    glass.renderOrder = 2;
    g.add(glass);
    box(fw, h, fd, -o.width / 2 + fw / 2, h / 2, 0, frameMaterial);
    box(fw, h, fd, o.width / 2 - fw / 2, h / 2, 0, frameMaterial);
    box(o.width, fw, fd, 0, fw / 2, 0, frameMaterial);
    if (!clipped) box(o.width, fw, fd, 0, h - fw / 2, 0, frameMaterial);
    const panes = Math.max(1, Math.round(o.width / (o.kind === 'glassDoor' ? 0.7 : 0.95)));
    for (let i = 1; i < panes; i++) box(fw * 0.8, h, fd * 0.9, -o.width / 2 + (o.width / panes) * i, h / 2, 0, frameMaterial);
    if (o.kind === 'window' && !clipped && o.height > 1.3) box(o.width, fw * 0.8, fd * 0.9, 0, h * 0.74, 0, frameMaterial);
    if (o.kind === 'window' && out !== 0 && (o.sill ?? 0) > 0.3) {
      // vensterbank binnen (steen, steekt 4 cm uit) en waterslag buiten
      const inDepth = Math.abs(innerZ) + 0.04;
      box(o.width + 0.08, 0.025, inDepth, 0, -0.0125, innerZ / 2 - out * 0.02, innerSillMaterial);
      const outDepth = Math.abs(outerZ) + 0.05;
      box(o.width + 0.04, 0.02, outDepth, 0, -0.03, outerZ / 2 + out * 0.025, outerSillMaterial);
    }
  } else if (o.kind === 'frontDoor') {
    box(fw, h, fd, -o.width / 2 + fw / 2, h / 2, 0, frameMaterial);
    box(fw, h, fd, o.width / 2 - fw / 2, h / 2, 0, frameMaterial);
    if (!clipped) box(o.width, fw, fd, 0, h - fw / 2, 0, frameMaterial);
    box(o.width - 2 * fw, h - fw, 0.05, 0, (h - fw) / 2, 0, doorMaterial);
    for (let i = 0; i < 4; i++) {
      const y = 0.45 + i * 0.42;
      if (y + 0.1 < h) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.06), glassMaterial);
        strip.position.set(0, y, 0);
        g.add(strip);
      }
    }
    box(0.03, 0.5, 0.06, o.width / 2 - 0.15, 1.05, out * 0.05, handleMaterial);
  } else if (o.kind === 'door' || o.kind === 'passage') {
    // binnendeur: witte stelkozijnen met deurblad dat op een kier van ~70° open staat
    const z0 = innerZ;
    const z1 = outerZ;
    const depth = Math.abs(z1 - z0) + 0.02;
    const zc = (z0 + z1) / 2;
    const post = 0.05;
    box(post, h, depth, -o.width / 2 + post / 2, h / 2, zc, interiorDoorMaterial);
    box(post, h, depth, o.width / 2 - post / 2, h / 2, zc, interiorDoorMaterial);
    if (!clipped) box(o.width, post, depth, 0, h - post / 2, zc, interiorDoorMaterial);
    if (o.kind === 'door' && !clipped) {
      const leafW = o.width - 2 * post - 0.01;
      const hinge = new THREE.Group();
      hinge.position.set(-o.width / 2 + post, 0, z0 === z1 ? 0 : Math.max(z0, z1) - 0.02);
      hinge.rotation.y = -Math.PI * 0.39;
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(leafW, h - post - 0.01, 0.04), interiorDoorMaterial);
      leaf.position.set(leafW / 2, (h - post) / 2, 0.02);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      hinge.add(leaf);
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.02), handleMaterial);
      knob.position.set(leafW - 0.08, 1.05, 0.06);
      hinge.add(knob);
      g.add(hinge);
    }
  }
  return g;
}

// ---------- vloeren ----------
function shapeFromPolygon(poly: V2[]): THREE.Shape {
  // vormcoördinaten (x, -z) zodat rotatie -90° om x de juiste kant op ligt
  return new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
}

export function buildFloors(rooms: Room[], elevation: number, slab: number, yOffset = 0.004, stack = 0, floorFor?: (r: Room) => Room['floor']): THREE.Group {
  const group = new THREE.Group();
  for (const [i, room] of rooms.entries()) {
    const r = floorFor ? { ...room, floor: floorFor(room) } : room;
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

// ---------- plafonds (rondloopmodus) ----------
const ceilingMaterial = new THREE.MeshStandardMaterial({ color: '#f4f3f0', roughness: 0.95, side: THREE.BackSide });
const atticMaterial = new THREE.MeshStandardMaterial({ color: '#efede8', roughness: 0.95, side: THREE.DoubleSide });

export function buildCeilings(house: House, index: number): THREE.Group {
  const level = house.levels[index];
  const g = new THREE.Group();
  if (index === house.levels.length - 1) {
    // zolder: binnenkant van het dak
    const roofs = buildRoofs(house.roofs.filter((r) => r.kind === 'gable'), atticMaterial);
    roofs.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = true;
      }
    });
    g.add(roofs);
    return g;
  }
  for (const r of level.rooms) {
    const geo = new THREE.ShapeGeometry(shapeFromPolygon(r.polygon));
    const m = new THREE.Mesh(geo, ceilingMaterial);
    m.rotation.x = -Math.PI / 2;
    m.position.y = level.elevation + level.ceilingHeight;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
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
export function buildRoofs(roofs: House['roofs'], material: THREE.Material = roofMaterial, cast = false): THREE.Group {
  const group = new THREE.Group();
  for (const r of roofs) group.add(r.kind === 'gable' ? gableRoof(r, material, cast) : flatRoof(r, material === roofMaterial ? undefined : material, cast));
  return group;
}

function gableRoof(r: GableRoof, material: THREE.Material, cast: boolean): THREE.Group {
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
    const shape = new THREE.Shape([new THREE.Vector2(z0, y0), new THREE.Vector2(z1, y1), new THREE.Vector2(z1, y1 + T), new THREE.Vector2(z0, y0 + T)]);
    const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    // lokale x = wereld z, lokale y = y, lokale z = -wereld x
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0));
    m.setPosition(r.x1, 0, 0);
    geom.applyMatrix4(m);
    const pos = geom.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i);
      uv[i * 2 + 1] = pos.getZ(i) * 1.2;
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(geom, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = !cast || material !== shadowOnlyMaterial;
    g.add(mesh);
  }
  if (material !== shadowOnlyMaterial) {
    for (const s of r.skylights ?? []) {
      const zc = (s.z0 + s.z1) / 2;
      const yc = r.underside(zc) + T + 0.03;
      const slope = Math.atan((r.underside(zc + 0.01) - r.underside(zc - 0.01)) / 0.02);
      const len = (s.z1 - s.z0) / Math.cos(slope);
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0, 0.06, len), new THREE.MeshStandardMaterial({ color: '#2b3a44', roughness: 0.1, metalness: 0.4 }));
      m.position.set((s.x0 + s.x1) / 2, yc, zc);
      m.rotation.x = -slope;
      g.add(m);
    }
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(depth, 0.08, 0.25), new THREE.MeshStandardMaterial({ color: '#3a3533', roughness: 0.8 }));
    ridge.position.set((r.x0 + r.x1) / 2, r.underside(r.ridgeZ) + T + 0.02, r.ridgeZ);
    g.add(ridge);
  }
  return g;
}

function flatRoof(r: FlatRoof, material: THREE.Material | undefined, cast: boolean): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(r.x1 - r.x0, r.thickness, r.z1 - r.z0),
    material ?? new THREE.MeshStandardMaterial({ color: r.color ?? '#444444', roughness: 0.85 }),
  );
  m.position.set((r.x0 + r.x1) / 2, r.y + r.thickness / 2, (r.z0 + r.z1) / 2);
  m.castShadow = cast;
  m.receiveShadow = !material;
  return m;
}

// ---------- tuin & buren ----------
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

export function buildNeighbors(house: House, material: THREE.Material = neighborMaterial, cast = false): THREE.Group {
  const g = new THREE.Group();
  for (const n of house.neighbors ?? []) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(n.x1 - n.x0, n.height, n.z1 - n.z0), material);
    body.position.set((n.x0 + n.x1) / 2, n.height / 2, (n.z0 + n.z1) / 2);
    body.castShadow = cast;
    body.receiveShadow = material !== shadowOnlyMaterial;
    g.add(body);
    if (n.roof) g.add(buildRoofs([n.roof], material === shadowOnlyMaterial ? material : roofMaterial, cast));
  }
  return g;
}

/**
 * Onzichtbaar schaduwmodel van het hele huis: volle muren, verdiepingsvloeren (= plafonds),
 * daken en buren. Zo valt zonlicht alleen via ramen en deuren naar binnen, ongeacht
 * welke verdieping of muurstand je bekijkt.
 */
export function buildShadowProxy(house: House): THREE.Group {
  const g = new THREE.Group();
  const add = (o: THREE.Object3D) => {
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      if (m.isMesh) {
        m.material = shadowOnlyMaterial;
        m.castShadow = true;
        m.receiveShadow = false;
        m.raycast = () => undefined;
      }
    });
    g.add(o);
  };
  house.levels.forEach((level, i) => {
    const walls = buildWalls(level, () => null);
    for (const geo of [walls.paint, walls.brick, walls.party]) if (geo) add(new THREE.Mesh(geo));
    if (i > 0) add(buildFloors(level.rooms, level.elevation, 0.2));
  });
  add(buildRoofs(house.roofs, shadowOnlyMaterial, true));
  add(buildNeighbors(house, shadowOnlyMaterial, true));
  return g;
}

/** Welke buitenmuren moeten laag (cutaway) bij deze kijkrichting? Binnenmuren blijven altijd hoog. */
export function cutawaySet(level: Level, camDir: THREE.Vector2): Set<string> {
  const out = new Set<string>();
  for (const w of level.walls) {
    if (!w.outside) continue;
    if (-(w.outside[0] * camDir.x + w.outside[1] * camDir.y) > 0.2) out.add(w.id);
  }
  return out;
}
