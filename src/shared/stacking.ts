import type { Level, V2 } from './house';
import type { Category, Item, Placement } from './recipe';
import { corners, pointInPolygon } from './placement';

/**
 * Automatisch neerzetten: een meubel staat op de vloer, tenzij het helemaal op iets anders past
 * (een plant op de tafel, een lamp op het dressoir, een platenspeler op de lowboard).
 */

/** wat nooit vanzelf op iets anders wordt gezet */
const NEVER_ON_TOP: Category[] = ['bank', 'stoel', 'fauteuil', 'bed', 'tafel', 'vloerkleed'];
/** speling: zo ver mag het meubel over de rand steken */
const OVERHANG = 0.03;
/** kasten die lager dan dit beginnen (zwevende lowboard, tv-meubel) gelden als staand: iets eronder komt erop */
const LOW_HANGING = 1.0;

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
  // hangt aan de muur/het plafond of op een flinke eigen hoogte: niet verplaatsen.
  // Een kleine standaardhoogte (bijv. een platenspeler op 60 cm) mag wel: die gaat dan op wat eronder staat.
  if (r.mount === 'wall' || r.mount === 'ceiling' || (r.elevation ?? 0) >= 1.0) return false;
  return r.size.height > 0.03;
}

/** onderkant van een geplaatst meubel boven de verdiepingsvloer */
export const bottomOf = (p: Pick<Placement, 'y'>, it: Item) => (p.y ?? 0) + (it.recipe.elevation ?? 0);

/** de y van de plaatsing die hoort bij een ondergrond (rekening houdend met de standaardhoogte van het meubel) */
export function placementY(it: Item, s: Support): number {
  if (!s.on) return 0;
  return Math.max(0, Math.round((s.y - (it.recipe.elevation ?? 0)) * 1000) / 1000);
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
  /** huidige hoogte: staat het al op een hoge kast, dan blijft het daarop zolang het past */
  currentY = 0,
): Support {
  if (!canStack(item)) return FLOOR;
  const s = item.recipe.size;
  const foot = corners({ x: pos.x, z: pos.z, hw: s.width / 2, hd: s.depth / 2, rot: pos.rotation });
  const center: V2 = [pos.x, pos.z];
  const area = s.width * s.depth;
  // oppervlakken waar het helemaal op past, met hun onderkant
  const cands: { name: string; top: number; bottom: number }[] = [];
  const consider = (name: string, poly: V2[], bottom: number, top: number, surfaceArea: number) => {
    // moet er nog onder het plafond passen (ook bovenop een hoge kast of hangkast)
    if (top + s.height > level.ceilingHeight + 0.01 || surfaceArea < area * 0.9) return;
    if (fitsOn(foot, center, poly)) cands.push({ name, top, bottom });
  };
  const itemMap = new Map(items.map((i) => [i.id, i]));
  for (const p of placements) {
    if (p.id === self || p.levelId !== level.id) continue;
    const it = itemMap.get(p.itemId);
    if (!it || it.recipe.size.height <= 0.03) continue; // vloerkleed
    const sz = it.recipe.size;
    const bottom = (p.y ?? 0) + (it.recipe.elevation ?? 0);
    consider(it.name, corners({ x: p.x, z: p.z, hw: sz.width / 2, hd: sz.depth / 2, rot: p.rotation }), bottom, bottom + sz.height, sz.width * sz.depth);
  }
  for (const fx of level.fixtures) {
    const sz = fx.recipe.size;
    if (sz.height < 0.05 || fx.name === 'Trap' || fx.name.startsWith('Trap')) continue;
    const bottom = fx.y ?? 0;
    consider(fx.name, corners({ x: fx.position[0], z: fx.position[1], hw: sz.width / 2, hd: sz.depth / 2, rot: fx.rotation ?? 0 }), bottom, bottom + sz.height, sz.width * sz.depth);
  }
  // van de vloer omhoog "laten zakken": het komt op het eerste oppervlak waar het anders doorheen zou steken.
  // Lage zwevende kasten (lowboard, tv-meubel) tellen alsof ze tot de vloer lopen; een hoog hangende kast
  // alleen als het ding er al op stond (dan blijft het erop).
  cands.sort((p, q) => p.top - q.top);
  let best: Support = FLOOR;
  for (let changed = true; changed; ) {
    changed = false;
    for (const c of cands) {
      if (c.top <= best.y + 0.005) continue;
      const effBottom = c.bottom < LOW_HANGING ? 0 : c.bottom;
      const through = best.y + s.height > effBottom + 0.005;
      const wasOnIt = Math.abs(currentY - c.top) < 0.02;
      if (through || wasOnIt) {
        best = { y: Math.round(c.top * 1000) / 1000, on: c.name };
        changed = true;
      }
    }
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
  const s = findSupport(level, p, item, p.id, placements, items, bottomOf(p, item));
  return Math.abs(s.y - bottomOf(p, item)) < 0.02;
}

/** staat `rider` op `carrier`? (midden binnen de bovenkant en op de juiste hoogte) */
export function isOnTop(rider: Placement, riderItem: Item, carrier: Placement, carrierItem: Item): boolean {
  if (rider.id === carrier.id || rider.levelId !== carrier.levelId || !canStack(riderItem)) return false;
  const top = (carrier.y ?? 0) + (carrierItem.recipe.elevation ?? 0) + carrierItem.recipe.size.height;
  if (Math.abs(bottomOf(rider, riderItem) - top) > 0.02) return false;
  const s = carrierItem.recipe.size;
  return pointInPolygon([rider.x, rider.z], corners({ x: carrier.x, z: carrier.z, hw: s.width / 2, hd: s.depth / 2, rot: carrier.rotation }));
}

/**
 * Bestaande meubels rechtzetten: iets dat op de vloer staat maar dwars door een tafel, kast of
 * (zwevende) inbouw heen steekt waar het helemaal op past, komt erop te staan.
 * Alleen tegen meubels uit dezelfde indeling (variant) en vaste inbouw.
 */
export function liftOntoSupports(levels: Level[], placements: Placement[], items: Item[]): { id: string; y: number; on: string }[] {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const out: { id: string; y: number; on: string }[] = [];
  for (const p of placements) {
    if ((p.y ?? 0) > 0.005) continue;
    const it = itemMap.get(p.itemId);
    const level = levels.find((l) => l.id === p.levelId);
    if (!it || !level || !canStack(it)) continue;
    const same = placements.filter((q) => q.variantId === p.variantId);
    const s = findSupport(level, p, it, p.id, same, items);
    if (!s.on) continue;
    const y = placementY(it, s);
    // alleen als het daarmee echt op dat oppervlak komt te staan (en niet al goed staat)
    if (y <= 0.005 || Math.abs(y + (it.recipe.elevation ?? 0) - s.y) > 0.02) continue;
    out.push({ id: p.id, y, on: s.on });
  }
  return out;
}
