import type { House, Level, Room, V2, Wall } from './house';
import { pointInPolygon } from './placement';
import { compassName } from './sun';

/** richting (noord/oost/…) waarin de muur ligt, gezien vanuit de kamer */
export function faceDirection(house: House, w: Wall, side: 1 | -1): string {
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz) || 1;
  const n: V2 = [-dz / len, dx / len];
  // vanuit de kamer kijk je tegen de muur aan: tegengesteld aan de normaal die de kamer in wijst
  const v: V2 = [-n[0] * side, -n[1] * side];
  const north = house.north;
  const east: V2 = [-north[1], north[0]];
  const az = (Math.atan2(v[0] * east[0] + v[1] * east[1], v[0] * north[0] + v[1] * north[1]) * 180) / Math.PI;
  return compassName((az + 360) % 360);
}

/** het deel [u0, u1] van een muurvlak dat aan een bepaalde kamer grenst */
export function faceExtent(w: Wall, side: 1 | -1, room: Room): [number, number] | null {
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz) || 1;
  const d: V2 = [dx / len, dz / len];
  const n: V2 = [-d[1], d[0]];
  const off = w.thickness / 2 + 0.15;
  let u0: number | null = null;
  let u1 = 0;
  for (let u = 0.02; u < len; u += 0.04) {
    const p: V2 = [w.a[0] + d[0] * u + n[0] * off * side, w.a[1] + d[1] * u + n[1] * off * side];
    if (pointInPolygon(p, room.polygon)) {
      if (u0 === null) u0 = u - 0.02;
      u1 = u + 0.02;
    }
  }
  return u0 === null ? null : [Math.max(0, u0), Math.min(len, u1)];
}

export interface RoomFace {
  wallId: string;
  side: 1 | -1;
  /** windrichting van de muur vanuit de kamer */
  direction: string;
  /** lengte van het muurvlak in deze kamer (m) */
  length: number;
}

/** alle muurvlakken van een kamer (langer dan 30 cm) */
export function roomFaces(house: House, level: Level, room: Room): RoomFace[] {
  const out: RoomFace[] = [];
  for (const w of level.walls)
    for (const side of [1, -1] as const) {
      const ext = faceExtent(w, side, room);
      if (!ext || ext[1] - ext[0] < 0.3) continue;
      out.push({ wallId: w.id, side, direction: faceDirection(house, w, side), length: Math.round((ext[1] - ext[0]) * 100) / 100 });
    }
  return out;
}
