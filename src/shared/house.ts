import type { Recipe } from './recipe';

/**
 * Huismodel. Eenheden in meters.
 * Plattegrondcoördinaten [x, z]:
 *   x = van links (carportzijde, noord) naar rechts (buren, zuid)
 *   z = van achter (tuin, oost) naar voor (straat, west)
 *   y = omhoog
 */
export type V2 = [number, number];

export type OpeningKind = 'door' | 'frontDoor' | 'glassDoor' | 'window' | 'passage';

export interface Opening {
  kind: OpeningKind;
  /** afstand vanaf wandbegin (a) tot het midden van de opening */
  at: number;
  width: number;
  height: number;
  /** hoogte onderkant boven de vloer (borstwering) */
  sill?: number;
}

export interface Wall {
  id: string;
  a: V2;
  b: V2;
  thickness: number;
  /** hoogte boven de vloer van de verdieping (standaard: verdiepingshoogte) */
  height?: number;
  /** bovenkant als functie van z-positie (voor schuine daken); overschrijft height */
  topByZ?: (z: number) => number;
  /** buitenmuur: richting (normaal) van de buitenkant, bijv. [-1, 0] */
  outside?: V2;
  /** woningscheidende muur (buren) */
  party?: boolean;
  openings?: Opening[];
}

export type FloorMaterial =
  | 'visgraat'
  | 'laminaat'
  | 'tegels-donker'
  | 'tegels-licht'
  | 'beton'
  | 'tuintegels'
  | 'gras'
  | 'asfalt'
  | 'klinkers'
  | 'grind'
  | 'terrastegels'
  | 'kunstgras'
  | 'split'
  | 'aarde';

export interface Room {
  id: string;
  name: string;
  polygon: V2[];
  floor: FloorMaterial;
  label?: V2;
}

export interface Fixture {
  id: string;
  name: string;
  recipe: Recipe;
  position: V2;
  /** hoogte boven de verdiepingsvloer */
  y?: number;
  rotation?: number;
  /** verbergen als de muren omlaag staan (plafond-/wanddelen die anders zweven) */
  high?: boolean;
}

export interface Level {
  id: string;
  name: string;
  short: string;
  elevation: number;
  /** vloer-tot-vloerhoogte */
  storeyHeight: number;
  ceilingHeight: number;
  walls: Wall[];
  rooms: Room[];
  fixtures: Fixture[];
}

export interface GableRoof {
  kind: 'gable';
  /** nok loopt evenwijdig aan de x-as */
  x0: number;
  x1: number;
  /** onderkant dakvlak (binnenzijde) als functie van z */
  underside: (z: number) => number;
  zBack: number;
  zFront: number;
  ridgeZ: number;
  thickness: number;
  skylights?: { x0: number; x1: number; z0: number; z1: number }[];
}

export interface FlatRoof {
  kind: 'flat';
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  thickness: number;
  color?: string;
}

export interface Fence {
  a: V2;
  b: V2;
  height: number;
  /** 'planken' = dicht schutting (standaard), 'muur' = gemetselde tuinmuur */
  style?: 'planken' | 'muur';
}

/** verhoogde border of vloer: rand van stapelblokken/hout, bovenkant als vloermateriaal */
export interface Raised {
  id: string;
  polygon: V2[];
  height: number;
  edge: 'stapelblok' | 'hout';
  top: FloorMaterial;
}

export type PlantKind = 'esdoorn' | 'bolboom' | 'bol' | 'struik' | 'siergras' | 'boom' | 'treurwilg';

/** procedurele beplanting (geen meubel: staat vast in de tuin) */
export interface Plant {
  kind: PlantKind;
  position: V2;
  /** totale hoogte in meters */
  height: number;
  /** kroondiameter in meters */
  spread: number;
  /** hoogte van de voet (bijv. in een verhoogde border) */
  y?: number;
  seed?: number;
}

export interface House {
  name: string;
  /** richting van het noorden in planhoek: vector in [x, z] */
  north: V2;
  levels: Level[];
  roofs: (GableRoof | FlatRoof)[];
  /** buurpanden als eenvoudige massa (voor schaduw en context) */
  neighbors?: { name: string; x0: number; x1: number; z0: number; z1: number; height: number; roof?: GableRoof }[];
  outdoor: {
    bounds: { x0: number; x1: number; z0: number; z1: number };
    areas: Room[];
    fences: Fence[];
    fixtures: Fixture[];
    raised?: Raised[];
    plants?: Plant[];
  };
  assumptions: string[];
}
