import type { Level, V2 } from './house';
import type { Category, Item, Placement } from './recipe';
import { corners, pointInPolygon } from './placement';

/**
 * Automatisch neerzetten: een meubel staat op de vloer, tenzij het helemaal op iets anders past
 * (een plant op de tafel, een lamp op het dressoir, een platenspeler op de lowboard).
 */

/** wat nooit vanzelf op iets anders wordt gezet */
const NEVER_ON_TOP: Category[] = ['bank', 'stoel', 'fauteuil', 'bed', 'tafel', 'vloerkleed'];
/** hoger dan dit zet je niets meer neer (bovenkant hoge kast) */
const MAX_SURFACE = 2.0;
/** speling: zo ver mag het meubel over de rand steken */
const OVERHANG = 0.03;

export interface Support {
  /** hoogte van het oppervlak boven de verdiepingsvloer (0 = vloer) */
  y: number;
  /** waar het op staat (null = vloer) */
  on: string | null;
}

export const FLOOR: Support = { y: 0, on: null };

/** mag dit meubel vanzelf op iets anders worden gezet? */
export function canStack(it: Item): boolean {
  if (NEVER_ON_TOP.includes(it.category)) return false;
  const r = it.recipe;
  if (r.mount === 'wall' || r.mount === 'ceiling' || (r.elevation ?? 0) > 0) return false; // hangt al op eigen hoogte
  return r.size.height > 0.03;
}

/** ligt een rechthoek helemaal binnen een polygoon (met wat speling)? */
function fitsOn(foot: V2[], center: V2, surface: V2[]): boolean {
  // polygoon iets vergroten met de toegestane overhang
  const cx = surface.reduce((s, p) => s + p[0], 0) / surface.length;
  const cz = surface.reduce((s, p) => s + p[1], 0) / surface.length;
  const grown = surface.map(([x, z]): V2 => {
    const dx = x - cx;
    const dz = z - cz;
    const l = Math.hypot(dx, dz) || 1;
    return [x + (dx / l) * OVERHANG * 1.42, z + (dz / l) * OVERHANG * 1.42];
  });
  return pointInPolygon(center, surface) && foot.every((p) => pointInPolygon(p, grown));
}

/**
 * Het hoogste oppervlak onder het meubel waar het helemaal op past: andere meubels (bovenkant)
 * en vaste inbouw. Anders de vloer.
 */
export function findSupport(
  level: Level,
  pos: { x: number; z: number; rotation: number },
  item: Item,
  self: string | null,
  placements: Placement[],
  items: Item[],
): Support {
  if (!canStack(item)) return FLOOR;
  const s = item.recipe.size;
  const foot = corners({ x: pos.x, z: pos.z, hw: s.width / 2, hd: s.depth / 2, rot: pos.rotation });
  const center: V2 = [pos.x, pos.z];
  const area = s.width * s.depth;
  let best: Support = FLOOR;
  const consider = (name: string, poly: V2[], top: number, surfaceArea: number) => {
    if (top <= best.y || top > MAX_SURFACE || surfaceArea < area * 0.9) return;
    if (fitsOn(foot, center, poly)) best = { y: Math.round(top * 1000) / 1000, on: name };
  };
  const itemMap = new Map(items.map((i) => [i.id, i]));
  for (const p of placements) {
    if (p.id === self || p.levelId !== level.id) continue;
    const it = itemMap.get(p.itemId);
    if (!it || it.recipe.size.height <= 0.03) continue; // vloerkleed
    const sz = it.recipe.size;
    const top = (p.y ?? 0) + (it.recipe.elevation ?? 0) + sz.height;
    consider(it.name, corners({ x: p.x, z: p.z, hw: sz.width / 2, hd: sz.depth / 2, rot: p.rotation }), top, sz.width * sz.depth);
  }
  for (const fx of level.fixtures) {
    const sz = fx.recipe.size;
    if (sz.height < 0.05 || fx.name === 'Trap' || fx.name.startsWith('Trap')) continue;
    const top = (fx.y ?? 0) + sz.height;
    consider(fx.name, corners({ x: fx.position[0], z: fx.position[1], hw: sz.width / 2, hd: sz.depth / 2, rot: fx.rotation ?? 0 }), top, sz.width * sz.depth);
  }
  return best;
}

/** staat het meubel nu ergens op (vloer of oppervlak), of hangt het bewust op een eigen hoogte? */
export function isResting(
  level: Level,
  p: Placement,
  item: Item,
  placements: Placement[],
  items: Item[],
): boolean {
  if ((p.y ?? 0) < 0.005) return true;
  const s = findSupport(level, p, item, p.id, placements, items);
  return Math.abs(s.y - (p.y ?? 0)) < 0.02;
}

/** staat `rider` op `carrier`? (midden binnen de bovenkant en op de juiste hoogte) */
export function isOnTop(rider: Placement, riderItem: Item, carrier: Placement, carrierItem: Item): boolean {
  if (rider.id === carrier.id || rider.levelId !== carrier.levelId || !canStack(riderItem)) return false;
  const top = (carrier.y ?? 0) + (carrierItem.recipe.elevation ?? 0) + carrierItem.recipe.size.height;
  if (Math.abs((rider.y ?? 0) - top) > 0.02) return false;
  const s = carrierItem.recipe.size;
  return pointInPolygon([rider.x, rider.z], corners({ x: carrier.x, z: carrier.z, hw: s.width / 2, hd: s.depth / 2, rot: carrier.rotation }));
}
