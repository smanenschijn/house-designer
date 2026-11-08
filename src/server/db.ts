import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Item, ItemInput, Placement, PlacementInput } from '../shared/recipe';
import { ItemInputSchema, PlacementInputSchema } from '../shared/recipe';
import { notifyChange } from './events';

const DB_PATH = resolve(process.env.DATA_DIR ?? 'data', 'house.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    recipe TEXT NOT NULL,
    meta TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS placements (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    level_id TEXT NOT NULL,
    variant_id TEXT NOT NULL DEFAULT 'standaard',
    x REAL NOT NULL,
    z REAL NOT NULL,
    y REAL NOT NULL DEFAULT 0,
    rotation REAL NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

const now = () => new Date().toISOString();

// ---------- versie (voor eenvoudige synchronisatie) ----------
export function getVersion(): number {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'version'`).get() as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}
export function bumpVersion(): number {
  const v = getVersion() + 1;
  db.prepare(`INSERT INTO meta(key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(v));
  notifyChange(v);
  return v;
}

// ---------- items ----------
interface ItemRow {
  id: string;
  name: string;
  category: string;
  recipe: string;
  meta: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
const toItem = (r: ItemRow): Item => ({
  id: r.id,
  name: r.name,
  category: r.category as Item['category'],
  recipe: JSON.parse(r.recipe),
  meta: JSON.parse(r.meta),
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listItems(): Item[] {
  return (db.prepare(`SELECT * FROM items ORDER BY updated_at DESC`).all() as unknown as ItemRow[]).map(toItem);
}
export function getItem(id: string): Item | null {
  const r = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow | undefined;
  return r ? toItem(r) : null;
}
export function createItem(input: ItemInput, userId: string | null): Item {
  const v = ItemInputSchema.parse(input);
  const id = randomUUID();
  const t = now();
  db.prepare(`INSERT INTO items (id, name, category, recipe, meta, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, v.name, v.category, JSON.stringify(v.recipe), JSON.stringify(v.meta), userId, t, t,
  );
  bumpVersion();
  return getItem(id)!;
}
export function updateItem(id: string, input: Partial<ItemInput>): Item | null {
  const cur = getItem(id);
  if (!cur) return null;
  const merged = ItemInputSchema.parse({
    name: input.name ?? cur.name,
    category: input.category ?? cur.category,
    recipe: input.recipe ?? cur.recipe,
    meta: { ...cur.meta, ...(input.meta ?? {}) },
  });
  db.prepare(`UPDATE items SET name = ?, category = ?, recipe = ?, meta = ?, updated_at = ? WHERE id = ?`).run(
    merged.name, merged.category, JSON.stringify(merged.recipe), JSON.stringify(merged.meta), now(), id,
  );
  bumpVersion();
  return getItem(id);
}
export function deleteItem(id: string): boolean {
  const r = db.prepare(`DELETE FROM items WHERE id = ?`).run(id);
  if (r.changes) bumpVersion();
  return r.changes > 0;
}

// ---------- plaatsingen ----------
interface PlacementRow {
  id: string;
  item_id: string;
  level_id: string;
  variant_id: string;
  x: number;
  z: number;
  y: number;
  rotation: number;
  created_by: string | null;
  updated_at: string;
}
const toPlacement = (r: PlacementRow): Placement => ({
  id: r.id,
  itemId: r.item_id,
  levelId: r.level_id,
  variantId: r.variant_id,
  x: r.x,
  z: r.z,
  y: r.y,
  rotation: r.rotation,
  createdBy: r.created_by,
  updatedAt: r.updated_at,
});

export function listPlacements(): Placement[] {
  return (db.prepare(`SELECT * FROM placements ORDER BY updated_at`).all() as unknown as PlacementRow[]).map(toPlacement);
}
export function getPlacement(id: string): Placement | null {
  const r = db.prepare(`SELECT * FROM placements WHERE id = ?`).get(id) as PlacementRow | undefined;
  return r ? toPlacement(r) : null;
}
/** bepaalt de variant van een plaatsing uit verdieping en positie (ingesteld door variants.ts) */
type VariantResolver = (levelId: string, x: number, z: number, current?: string) => string;
let resolveVariant: VariantResolver = () => 'buiten';
export function setVariantResolver(fn: VariantResolver) {
  resolveVariant = fn;
}

export function createPlacement(input: PlacementInput, userId: string | null): Placement {
  const v = PlacementInputSchema.parse(input);
  if (!getItem(v.itemId)) throw new Error('Onbekend meubel');
  const id = randomUUID();
  const variantId = v.variantId ?? resolveVariant(v.levelId, v.x, v.z);
  db.prepare(`INSERT INTO placements (id, item_id, level_id, variant_id, x, z, y, rotation, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, v.itemId, v.levelId, variantId, v.x, v.z, v.y, v.rotation, userId, now(),
  );
  bumpVersion();
  return getPlacement(id)!;
}
export function updatePlacement(id: string, input: Partial<PlacementInput>): Placement | null {
  const cur = getPlacement(id);
  if (!cur) return null;
  const v = PlacementInputSchema.parse({ ...cur, ...input, variantId: input.variantId });
  // naar een andere kamer verplaatst? dan hoort hij bij de actieve variant van die kamer
  const variantId = v.variantId ?? resolveVariant(v.levelId, v.x, v.z, cur.variantId);
  db.prepare(`UPDATE placements SET level_id = ?, variant_id = ?, x = ?, z = ?, y = ?, rotation = ?, updated_at = ? WHERE id = ?`).run(
    v.levelId, variantId, v.x, v.z, v.y, v.rotation, now(), id,
  );
  bumpVersion();
  return getPlacement(id);
}
export function deletePlacement(id: string): boolean {
  const r = db.prepare(`DELETE FROM placements WHERE id = ?`).run(id);
  if (r.changes) bumpVersion();
  return r.changes > 0;
}

// ---------- startinhoud ----------
/** De bibliotheek begint leeg; vaste inbouw (incl. overgenomen kasten, sierhaard en koelkast) zit in het huismodel. */
export function seedLibrary() {}
