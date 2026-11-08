import type { FloorMaterial, House, Room } from './house';
import { pointInPolygon } from './placement';

/**
 * Varianten per ruimte. Elke kamer heeft minstens de variant "Standaard".
 * Een plaatsing hoort bij de variant van de kamer waar hij staat; alleen de actieve
 * variant van een kamer is zichtbaar. Meubels buiten een kamer (tuin) horen bij "buiten".
 */
export const WALLPAPERS = [
  { id: 'streep', name: 'Streep', tile: [0.36, 0.36], color: '#ece6db', accent: '#b9c9b4' },
  { id: 'stip', name: 'Stip', tile: [0.22, 0.22], color: '#f1ede6', accent: '#40513f' },
  { id: 'ruit', name: 'Ruit', tile: [0.3, 0.3], color: '#e8e2d7', accent: '#a69a86' },
  { id: 'botanisch', name: 'Botanisch', tile: [0.62, 0.62], color: '#2f3d32', accent: '#8fb39a' },
  { id: 'waaier', name: 'Art-deco waaier', tile: [0.3, 0.3], color: '#1f2a26', accent: '#c9a96a' },
  { id: 'linnen', name: 'Linnen', tile: [0.5, 0.5], color: '#d9cfc0', accent: '#bfb3a2' },
  { id: 'terrazzo', name: 'Terrazzo', tile: [0.6, 0.6], color: '#ebe6de', accent: '#c27d5c' },
] as const;
export type WallpaperId = (typeof WALLPAPERS)[number]['id'];

/** afwerking van een muurvlak: verf of behang */
export type WallFinish = { kind: 'paint'; color: string } | { kind: 'wallpaper'; pattern: WallpaperId; color: string; accent: string };

export interface RoomFinish {
  floor?: FloorMaterial;
  /** (oud) wandkleur binnen, #rrggbb — gebruikt als `wall` ontbreekt */
  wallColor?: string;
  /** standaard voor alle wanden van de kamer */
  wall?: WallFinish;
  /** afwijkende afwerking per muurvlak (sleutel: faceKey) */
  faces?: Record<string, WallFinish>;
}

/** sleutel van één kant van een muur */
export const faceKey = (wallId: string, side: number) => `${wallId}:${side > 0 ? '+' : '-'}`;

export function roomWallFinish(f: RoomFinish | null | undefined): WallFinish {
  return f?.wall ?? { kind: 'paint', color: f?.wallColor ?? DEFAULT_WALL };
}

export function faceFinish(f: RoomFinish | null | undefined, wallId: string, side: number): WallFinish {
  return f?.faces?.[faceKey(wallId, side)] ?? roomWallFinish(f);
}

export const wallFinishKey = (w: WallFinish) => (w.kind === 'paint' ? `p${w.color}` : `w${w.pattern}${w.color}${w.accent}`);

export function describeWallFinish(w: WallFinish) {
  if (w.kind === 'paint') return `verf ${WALL_COLORS.find((c) => c.hex === w.color.toLowerCase())?.name ?? w.color}`;
  return `behang ${WALLPAPERS.find((p) => p.id === w.pattern)?.name ?? w.pattern} (${w.color} / ${w.accent})`;
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
