import { z } from 'zod';

/**
 * Meubelrecept: een declaratieve beschrijving van een 3D-meubel.
 *
 * Coördinaten (meters): oorsprong = midden van de onderkant van het meubel.
 *   x = breedte (links -, rechts +), y = omhoog, z = diepte (voorkant = +z).
 * Rotaties in graden.
 */

const num = z.number().finite();
export const Vec3 = z.tuple([num, num, num]);
export const Vec2 = z.tuple([num, num]);

export const FINISHES = [
  'matte', 'satin', 'gloss', 'metal', 'glass', 'fabric', 'velvet', 'leather',
  'wood', 'stone', 'plastic', 'ceramic', 'plant', 'light',
] as const;

export const MaterialSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'kleur als #rrggbb'),
  finish: z.enum(FINISHES).default('matte'),
  opacity: z.number().min(0).max(1).optional(),
});
export type MaterialDef = z.infer<typeof MaterialSchema>;

const PartBase = {
  name: z.string().optional(),
  position: Vec3.default([0, 0, 0]),
  rotation: Vec3.optional(),
  material: z.string(),
};

export const PartSchema = z.discriminatedUnion('shape', [
  z.object({
    shape: z.literal('box'),
    size: Vec3,
    /** afronding van de randen in meters (0 = scherp) */
    radius: z.number().min(0).optional(),
    ...PartBase,
  }),
  z.object({
    shape: z.literal('cylinder'),
    radius: z.number().positive().optional(),
    radiusTop: z.number().min(0).optional(),
    radiusBottom: z.number().min(0).optional(),
    height: z.number().positive(),
    segments: z.number().int().min(3).max(64).optional(),
    ...PartBase,
  }),
  z.object({
    shape: z.literal('sphere'),
    radius: z.number().positive(),
    /** schaal per as voor ellipsoïden */
    scale: Vec3.optional(),
    ...PartBase,
  }),
  z.object({
    shape: z.literal('torus'),
    radius: z.number().positive(),
    tube: z.number().positive(),
    arc: z.number().positive().max(360).optional(),
    ...PartBase,
  }),
  z.object({
    shape: z.literal('extrude'),
    /** profiel in het XY-vlak, wordt geëxtrudeerd langs z (gecentreerd) */
    points: z.array(Vec2).min(3),
    depth: z.number().positive(),
    bevel: z.number().min(0).optional(),
    ...PartBase,
  }),
  z.object({
    shape: z.literal('lathe'),
    /** profiel [straal, hoogte] dat rond de y-as wordt gedraaid */
    points: z.array(Vec2).min(2),
    segments: z.number().int().min(3).max(64).optional(),
    ...PartBase,
  }),
]);
export type Part = z.infer<typeof PartSchema>;

export const RecipeSchema = z.object({
  version: z.literal(1).default(1),
  /** buitenmaten in meters: breedte (x), diepte (z), hoogte (y) */
  size: z.object({ width: z.number().positive(), depth: z.number().positive(), height: z.number().positive() }),
  materials: z.record(z.string(), MaterialSchema),
  parts: z.array(PartSchema).min(1).max(400),
  /** standaard hoogte boven de vloer bij plaatsen (bijv. wandplank, hanglamp) */
  elevation: z.number().min(0).optional(),
  mount: z.enum(['floor', 'wall', 'ceiling']).optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;
export type RecipeInput = z.input<typeof RecipeSchema>;

export const CATEGORIES = [
  'bank', 'stoel', 'fauteuil', 'tafel', 'salontafel', 'bed', 'kast', 'tv-meubel',
  'bureau', 'opslag', 'verlichting', 'decoratie', 'plant', 'vloerkleed', 'apparaat',
  'fitness', 'buiten', 'overig',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const STATUSES = ['hebben', 'overwegen', 'favoriet', 'gekocht', 'afgevallen'] as const;
export type ItemStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<ItemStatus, string> = {
  hebben: 'Hebben we al',
  overwegen: 'Overwegen',
  favoriet: 'Favoriet',
  gekocht: 'Gekocht',
  afgevallen: 'Afgevallen',
};

export const ItemMetaSchema = z.object({
  status: z.enum(STATUSES).default('overwegen'),
  price: z.number().min(0).nullable().optional(),
  shop: z.string().max(200).nullable().optional(),
  url: z.string().max(2000).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  /** template-instellingen als het item met de editor is gemaakt */
  template: z
    .object({ id: z.string(), params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])) })
    .nullable()
    .optional(),
});
export type ItemMeta = z.infer<typeof ItemMetaSchema>;

export const ItemInputSchema = z.object({
  name: z.string().min(1).max(200),
  category: z.enum(CATEGORIES).default('overig'),
  recipe: RecipeSchema,
  meta: ItemMetaSchema.default({ status: 'overwegen' }),
});
export type ItemInput = z.input<typeof ItemInputSchema>;

/**
 * 3D-model (GLB) bij een meubel, gemaakt in Blender of geüpload. Het recept blijft bestaan als
 * eenvoudige doos met de buitenmaten (voor botsingen, maten en als terugval).
 */
export interface ItemModel {
  /** bestandsnaam onder /api/models/ */
  file: string;
  bytes: number;
  triangles: number;
  source: 'blender' | 'upload';
  /** grenzen van het model zoals aangeleverd (m, y omhoog) */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  /** schaal (bijv. 0.01 als het model in cm is) */
  scale: number;
  /** extra draaiing om y in graden (0/90/180/270) als de voorkant niet naar +z wijst */
  rotation: number;
  /** Blender-script waarmee het model is gemaakt (om aan te passen) */
  script?: string | null;
  updatedAt: string;
}

export interface Item {
  id: string;
  name: string;
  category: Category;
  recipe: Recipe;
  meta: ItemMeta;
  model?: ItemModel | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PlacementInputSchema = z.object({
  itemId: z.string(),
  levelId: z.string(),
  x: num,
  z: num,
  /** extra hoogte boven de vloer (m) */
  y: z.number().min(0).default(0),
  /** rotatie om de verticale as, graden */
  rotation: num.default(0),
  /** wordt door de server bepaald uit de kamer en de actieve variant, tenzij expliciet opgegeven */
  variantId: z.string().optional(),
});
export type PlacementInput = z.input<typeof PlacementInputSchema>;

export interface Placement {
  id: string;
  itemId: string;
  levelId: string;
  variantId: string;
  x: number;
  z: number;
  y: number;
  rotation: number;
  createdBy: string | null;
  updatedAt: string;
}
