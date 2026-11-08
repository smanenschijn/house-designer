import type { Level, V2, Wall } from './house';

/** Rechthoek op de vloer: midden, halve maten en rotatie (graden, om de verticale as). */
export interface Rect2 {
  x: number;
  z: number;
  hw: number; // halve breedte (lokale x)
  hd: number; // halve diepte (lokale z)
  rot: number;
}

const DEG = Math.PI / 180;

/** lokale assen in wereld-xz voor rotatie θ om y (three.js-conventie) */
export function axes(rotDeg: number): { ax: V2; az: V2 } {
  const t = rotDeg * DEG;
  // lokale x -> (cos, -sin), lokale z -> (sin, cos)
  return { ax: [Math.cos(t), -Math.sin(t)], az: [Math.sin(t), Math.cos(t)] };
}

export function corners(r: Rect2): V2[] {
  const { ax, az } = axes(r.rot);
  const out: V2[] = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    out.push([r.x + ax[0] * r.hw * sx + az[0] * r.hd * sz, r.z + ax[1] * r.hw * sx + az[1] * r.hd * sz]);
  return out;
}

function project(pts: V2[], axis: V2): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of pts) {
    const d = p[0] * axis[0] + p[1] * axis[1];
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** overlappen twee rechthoeken (met kleine marge zodat raken mag)? */
export function rectsOverlap(a: V2[], b: V2[], margin = 0.005): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
      const axis: V2 = [-(q[1] - p[1]) / len, (q[0] - p[0]) / len];
      const [a0, a1] = project(a, axis);
      const [b0, b1] = project(b, axis);
      if (a1 - margin <= b0 || b1 - margin <= a0) return false;
    }
  }
  return true;
}

/** rechthoek van een wand (exclusief deur-/doorgangopeningen tot op de vloer) */
export function wallRects(w: Wall): V2[][] {
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz) || 1;
  const d: V2 = [dx / len, dz / len];
  const n: V2 = [-d[1], d[0]];
  const t = w.thickness / 2;
  // segmenten zonder openingen die tot de vloer komen
  const gaps = (w.openings ?? [])
    .filter((o) => (o.sill ?? 0) < 0.05 && o.kind !== 'window')
    .map((o) => [o.at - o.width / 2, o.at + o.width / 2] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  const segs: [number, number][] = [];
  let u = 0;
  for (const [g0, g1] of gaps) {
    if (g0 > u) segs.push([u, g0]);
    u = Math.max(u, g1);
  }
  if (u < len) segs.push([u, len]);
  return segs.map(([u0, u1]) => [
    [w.a[0] + d[0] * u0 + n[0] * t, w.a[1] + d[1] * u0 + n[1] * t],
    [w.a[0] + d[0] * u1 + n[0] * t, w.a[1] + d[1] * u1 + n[1] * t],
    [w.a[0] + d[0] * u1 - n[0] * t, w.a[1] + d[1] * u1 - n[1] * t],
    [w.a[0] + d[0] * u0 - n[0] * t, w.a[1] + d[1] * u0 - n[1] * t],
  ]);
}

export interface SnapResult {
  x: number;
  z: number;
  rot: number;
  snappedTo: string[];
}

/**
 * Magnetisch tegen muren: als een zijkant van het meubel evenwijdig ligt aan een muurvlak
 * en er binnen `dist` meter vanaf staat, schuift het meubel er strak tegenaan.
 * Bij een bijna-evenwijdige stand (binnen 8°) draait het meubel ook recht.
 */
export function snapToWalls(r: Rect2, level: Level, dist = 0.15): SnapResult {
  let { x, z, rot } = r;
  const snappedTo: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const w of level.walls) {
      const dx = w.b[0] - w.a[0];
      const dz = w.b[1] - w.a[1];
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      const d: V2 = [dx / len, dz / len];
      const wallAngle = Math.atan2(-d[1], d[0]) / DEG; // rotatie waarbij lokale x langs de muur loopt
      // hoek uitlijnen (modulo 90°)
      const diff = ((((rot - wallAngle) % 90) + 135) % 90) - 45;
      for (const side of [1, -1]) {
        const n: V2 = [-d[1] * side, d[0] * side]; // normaal van muurvlak naar de kamer
        const off = w.thickness / 2;
        const fp: V2 = [w.a[0] + n[0] * off, w.a[1] + n[1] * off]; // punt op muurvlak
        // afstand van meubel tot vlak
        const cs = corners({ x, z, hw: r.hw, hd: r.hd, rot });
        const ds = cs.map((c) => (c[0] - fp[0]) * n[0] + (c[1] - fp[1]) * n[1]);
        const minD = Math.min(...ds);
        const centerD = (x - fp[0]) * n[0] + (z - fp[1]) * n[1];
        if (centerD <= 0) continue; // meubel staat aan de andere kant
        if (Math.abs(minD) > dist) continue;
        // overlap langs de muur?
        const us = cs.map((c) => (c[0] - w.a[0]) * d[0] + (c[1] - w.a[1]) * d[1]);
        if (Math.max(...us) < 0.05 || Math.min(...us) > len - 0.05) continue;
        if (Math.abs(diff) > 0.01 && Math.abs(diff) < 8) {
          rot = rot - diff;
          const cs2 = corners({ x, z, hw: r.hw, hd: r.hd, rot });
          const ds2 = cs2.map((c) => (c[0] - fp[0]) * n[0] + (c[1] - fp[1]) * n[1]);
          const m2 = Math.min(...ds2);
          x -= n[0] * m2;
          z -= n[1] * m2;
        } else if (Math.abs(diff) <= 0.01) {
          x -= n[0] * minD;
          z -= n[1] * minD;
        } else continue;
        if (!snappedTo.includes(w.id)) snappedTo.push(w.id);
      }
    }
  }
  return { x, z, rot, snappedTo };
}

/** punt-in-polygoon (ray casting) */
export function pointInPolygon(p: V2, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function roomAt(level: Level, p: V2) {
  return level.rooms.find((r) => pointInPolygon(p, r.polygon)) ?? null;
}
