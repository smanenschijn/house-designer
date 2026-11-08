import type { FloorMaterial, House, Room } from './house';
import { pointInPolygon } from './placement';

/**
 * Varianten per ruimte. Elke kamer heeft minstens de variant "Standaard".
 * Een plaatsing hoort bij de variant van de kamer waar hij staat; alleen de actieve
 * variant van een kamer is zichtbaar. Meubels buiten een kamer (tuin) horen bij "buiten".
 */
export interface RoomFinish {
  floor?: FloorMaterial;
  /** wandkleur binnen, #rrggbb */
  wallColor?: string;
}

export interface Variant {
  id: string;
  roomId: string;
  name: string;
  finish: RoomFinish;
  createdBy: string | null;
  createdAt: string;
}

export const OUTDOOR_VARIANT = 'buiten';
export const defaultVariantId = (roomId: string) => `${roomId}:standaard`;

export const FLOOR_LABELS: Record<FloorMaterial, string> = {
  visgraat: 'Visgraat (licht eiken)',
  laminaat: 'Laminaat (eiken)',
  'tegels-donker': 'Tegels antraciet',
  'tegels-licht': 'Tegels lichtgrijs',
  beton: 'Beton / gietvloer',
  tuintegels: 'Tuintegels',
  gras: 'Gras',
  asfalt: 'Asfalt',
  klinkers: 'Klinkers',
  grind: 'Grind',
};

/** vloeren die binnen zinvol zijn */
export const INDOOR_FLOORS: FloorMaterial[] = ['visgraat', 'laminaat', 'tegels-licht', 'tegels-donker', 'beton'];

export const DEFAULT_WALL = '#ede8e0';

export const WALL_COLORS: { name: string; hex: string }[] = [
  { name: 'Gebroken wit', hex: '#ede8e0' },
  { name: 'Zuiver wit', hex: '#f6f5f2' },
  { name: 'Greige', hex: '#d8cfc2' },
  { name: 'Zand', hex: '#d9c4a5' },
  { name: 'Saliegroen', hex: '#b9c9b4' },
  { name: 'Mintgroen', hex: '#cfe3d4' },
  { name: 'Olijf', hex: '#8c8f6a' },
  { name: 'Bosgroen', hex: '#40513f' },
  { name: 'Duifblauw', hex: '#aebdc6' },
  { name: 'Terracotta', hex: '#c27d5c' },
  { name: 'Oudroze', hex: '#d6aea6' },
  { name: 'Antraciet', hex: '#4a4c4f' },
];

export function roomAtPoint(house: House, levelId: string, x: number, z: number): Room | null {
  const level = house.levels.find((l) => l.id === levelId);
  return level?.rooms.find((r) => pointInPolygon([x, z], r.polygon)) ?? null;
}

export function allRooms(house: House) {
  return house.levels.flatMap((l) => l.rooms.map((r) => ({ level: l, room: r })));
}

/** actieve variant-id per kamer; ontbreekt een kamer, dan geldt de standaardvariant */
export type ActiveMap = Record<string, string>;

export function activeVariantFor(active: ActiveMap, roomId: string) {
  return active[roomId] ?? defaultVariantId(roomId);
}

export function isPlacementVisible(variantId: string, variants: Variant[], active: ActiveMap) {
  if (variantId === OUTDOOR_VARIANT) return true;
  const v = variants.find((x) => x.id === variantId);
  if (!v) return true;
  return activeVariantFor(active, v.roomId) === v.id;
}

/** afwerking die nu zichtbaar is per kamer */
export function activeFinishes(variants: Variant[], active: ActiveMap): Record<string, RoomFinish> {
  const out: Record<string, RoomFinish> = {};
  for (const v of variants) if (activeVariantFor(active, v.roomId) === v.id) out[v.roomId] = v.finish;
  return out;
}
