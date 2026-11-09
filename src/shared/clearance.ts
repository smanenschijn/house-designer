import type { House, Level, V2 } from './house';
import type { Item, Placement } from './recipe';
import { axes, corners, rectsOverlap, roomAt, wallRects } from './placement';

/**
 * Loopruimte rond een meubel: per zijkant de vrije afstand tot de dichtstbijzijnde muur,
 * vaste inbouw of ander meubel, en of het meubel voor een deur staat.
 */

/** advies: minimaal 70 cm voor een doorgang (60 cm is écht krap) */
export const PASSAGE_OK = 0.7;
export const PASSAGE_TIGHT = 0.6;
/** vrije ruimte die een deur nodig heeft aan beide kanten van de muur */
const DOOR_CLEAR = 0.8;
/** alleen dingen waar je tegenaan loopt: onderkant lager dan dit */
const WALK_HEIGHT = 0.9;
const MAX_DIST = 3;

export interface Gap {
  side: 'voor' | 'achter' | 'links' | 'rechts';
  /** begin (rand van het meubel) en eind (obstakel) op de vloer */
  from: V2;
  to: V2;
  dist: number;
  obstacle: string;
}

export interface ClearanceResult {
  gaps: Gap[];
  /** deuren waar het meubel voor staat */
  doors: string[];
}

interface Obstacle {
  name: string;
  poly: V2[];
}

function obstaclesFor(level: Level, self: Placement, placements: Placement[], items: Map<string, Item>): Obstacle[] {
  const out: Obstacle[] = level.walls.flatMap((w) => wallRects(w).map((poly) => ({ name: 'muur', poly })));
  for (const fx of level.fixtures)
    if ((fx.y ?? 0) < WALK_HEIGHT && fx.recipe.size.height > 0.05)
      out.push({
        name: fx.name,
        poly: corners({ x: fx.position[0], z: fx.position[1], hw: fx.recipe.size.width / 2, hd: fx.recipe.size.depth / 2, rot: fx.rotation ?? 0 }),
      });
  for (const p of placements) {
    if (p.id === self.id || p.levelId !== level.id) continue;
    const it = items.get(p.itemId);
    if (!it || it.recipe.size.height <= 0.03) continue; // vloerkleed
    if ((p.y ?? 0) + (it.recipe.elevation ?? 0) >= WALK_HEIGHT) continue; // wandplank, hanglamp
    out.push({ name: it.name, poly: corners({ x: p.x, z: p.z, hw: it.recipe.size.width / 2, hd: it.recipe.size.depth / 2, rot: p.rotation }) });
  }
  return out;
}

/** afstand langs een straal tot de rand van een polygoon (of Infinity) */
function rayHit(o: V2, d: V2, poly: V2[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const den = d[0] * ez - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - o[0]) * ez - (a[1] - o[1]) * ex) / den;
    const s = ((a[0] - o[0]) * d[1] - (a[1] - o[1]) * d[0]) / den;
    if (t >= -1e-6 && s >= -1e-6 && s <= 1 + 1e-6 && t < best) best = Math.max(0, t);
  }
  return best;
}

export function clearance(house: House, placement: Placement, placements: Placement[], itemList: Item[]): ClearanceResult {
  const level = house.levels.find((l) => l.id === placement.levelId);
  const items = new Map(itemList.map((i) => [i.id, i]));
  const item = items.get(placement.itemId);
  if (!level || !item) return { gaps: [], doors: [] };
  const bottom = (placement.y ?? 0) + (item.recipe.elevation ?? 0);
  if (item.recipe.size.height <= 0.03 || bottom >= WALK_HEIGHT) return { gaps: [], doors: [] };

  const obstacles = obstaclesFor(level, placement, placements, items);
  const { ax, az } = axes(placement.rotation);
  const hw = item.recipe.size.width / 2;
  const hd = item.recipe.size.depth / 2;
  const at = (u: number, v: number): V2 => [placement.x + ax[0] * u + az[0] * v, placement.z + ax[1] * u + az[1] * v];
  const sides: { side: Gap['side']; dir: V2; pts: V2[] }[] = [
    { side: 'voor', dir: az, pts: [-0.9, -0.5, 0, 0.5, 0.9].map((k) => at(k * hw, hd)) },
    { side: 'achter', dir: [-az[0], -az[1]], pts: [-0.9, -0.5, 0, 0.5, 0.9].map((k) => at(k * hw, -hd)) },
    { side: 'rechts', dir: ax, pts: [-0.9, -0.5, 0, 0.5, 0.9].map((k) => at(hw, k * hd)) },
    { side: 'links', dir: [-ax[0], -ax[1]], pts: [-0.9, -0.5, 0, 0.5, 0.9].map((k) => at(-hw, k * hd)) },
  ];

  const gaps: Gap[] = [];
  for (const s of sides) {
    let best: Gap | null = null;
    for (const p of s.pts)
      for (const ob of obstacles) {
        const t = rayHit(p, s.dir, ob.poly);
        if (t <= MAX_DIST && (!best || t < best.dist))
          best = { side: s.side, from: p, to: [p[0] + s.dir[0] * t, p[1] + s.dir[1] * t], dist: t, obstacle: ob.name };
      }
    if (best) gaps.push(best);
  }

  // deuren: vrije zone van de deurbreedte, 80 cm diep aan beide kanten van de muur
  const doors: string[] = [];
  const poly = corners({ x: placement.x, z: placement.z, hw, hd, rot: placement.rotation });
  for (const w of level.walls)
    for (const o of w.openings ?? []) {
      if (o.kind === 'window' || (o.sill ?? 0) > 0.05) continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
      const d: V2 = [(w.b[0] - w.a[0]) / len, (w.b[1] - w.a[1]) / len];
      const n: V2 = [-d[1], d[0]];
      const c: V2 = [w.a[0] + d[0] * o.at, w.a[1] + d[1] * o.at];
      const reach = w.thickness / 2 + DOOR_CLEAR;
      const hwD = o.width / 2 - 0.02;
      const zone: V2[] = [
        [c[0] - d[0] * hwD - n[0] * reach, c[1] - d[1] * hwD - n[1] * reach],
        [c[0] + d[0] * hwD - n[0] * reach, c[1] + d[1] * hwD - n[1] * reach],
        [c[0] + d[0] * hwD + n[0] * reach, c[1] + d[1] * hwD + n[1] * reach],
        [c[0] - d[0] * hwD + n[0] * reach, c[1] - d[1] * hwD + n[1] * reach],
      ];
      if (!rectsOverlap(poly, zone, 0.01)) continue;
      const probe = (s: number) => roomAt(level, [c[0] + n[0] * s * (w.thickness / 2 + 0.3), c[1] + n[1] * s * (w.thickness / 2 + 0.3)])?.name;
      const names = [probe(1), probe(-1)].filter((x): x is string => !!x);
      const label =
        o.kind === 'frontDoor' ? 'de voordeur' : o.kind === 'passage' ? 'een doorgang' : o.kind === 'glassDoor' ? (w.outside ? 'de tuindeur' : 'de glazen deur') : 'de deur';
      const where = names.length === 2 ? ` tussen ${names[0]} en ${names[1]}` : names.length === 1 ? ` van ${names[0]}` : '';
      const text = `${label}${where}`;
      if (!doors.includes(text)) doors.push(text);
    }
  return { gaps, doors };
}

/** korte waarschuwingen voor de selectiebalk en voor Claude */
export function clearanceWarnings(r: ClearanceResult): string[] {
  const out = r.doors.map((d) => `Staat voor ${d}`);
  const tight = r.gaps.filter((g) => g.dist > 0.05 && g.dist < PASSAGE_TIGHT).sort((a, b) => a.dist - b.dist)[0];
  if (tight) out.push(`Smalle doorgang: ${Math.round(tight.dist * 100)} cm tot ${tight.obstacle === 'muur' ? 'de muur' : tight.obstacle} (advies ≥ ${PASSAGE_OK * 100} cm)`);
  return out;
}
