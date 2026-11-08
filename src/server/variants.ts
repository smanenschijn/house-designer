import { randomUUID } from 'node:crypto';
import type { House } from '../shared/house';
import {
  DEFAULT_WALL,
  OUTDOOR_VARIANT,
  activeVariantFor,
  allRooms,
  defaultVariantId,
  roomAtPoint,
  type ActiveMap,
  type RoomFinish,
  type Variant,
} from '../shared/variants';
import { FLOOR_LABELS } from '../shared/variants';
import { bumpVersion, db, setVariantResolver } from './db';

interface VariantRow {
  id: string;
  room_id: string;
  name: string;
  finish: string;
  created_by: string | null;
  created_at: string;
}
const toVariant = (r: VariantRow): Variant => ({
  id: r.id,
  roomId: r.room_id,
  name: r.name,
  finish: JSON.parse(r.finish),
  createdBy: r.created_by,
  createdAt: r.created_at,
});

let houseRef: House;

export class VariantError extends Error {}

export function initVariants(house: House) {
  houseRef = house;
  db.exec(`
    CREATE TABLE IF NOT EXISTS variants (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      name TEXT NOT NULL,
      finish TEXT NOT NULL DEFAULT '{}',
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS room_active (room_id TEXT PRIMARY KEY, variant_id TEXT NOT NULL);
  `);
  // standaardvariant voor elke kamer (met de huidige vloer)
  const ins = db.prepare(`INSERT OR IGNORE INTO variants (id, room_id, name, finish, created_by, created_at) VALUES (?, ?, 'Standaard', ?, NULL, ?)`);
  for (const { room } of allRooms(house)) ins.run(defaultVariantId(room.id), room.id, JSON.stringify({ floor: room.floor, wallColor: DEFAULT_WALL }), new Date(0).toISOString());
  // bestaande plaatsingen (van vóór varianten) aan de juiste variant koppelen
  const known = new Set((db.prepare(`SELECT id FROM variants`).all() as { id: string }[]).map((r) => r.id));
  const rows = db.prepare(`SELECT id, level_id, x, z, variant_id FROM placements`).all() as { id: string; level_id: string; x: number; z: number; variant_id: string }[];
  const upd = db.prepare(`UPDATE placements SET variant_id = ? WHERE id = ?`);
  for (const p of rows)
    if (p.variant_id !== OUTDOOR_VARIANT && !known.has(p.variant_id)) {
      const room = roomAtPoint(house, p.level_id, p.x, p.z);
      upd.run(room ? activeVariantFor(activeMap(), room.id) : OUTDOOR_VARIANT, p.id);
    }
  setVariantResolver((levelId, x, z, current) => {
    const room = roomAtPoint(houseRef, levelId, x, z);
    if (!room) return OUTDOOR_VARIANT;
    // in dezelfde kamer gebleven: variant houden
    if (current && getVariant(current)?.roomId === room.id) return current;
    return activeVariantFor(activeMap(), room.id);
  });
}

export function listVariants(): Variant[] {
  return (db.prepare(`SELECT * FROM variants ORDER BY created_at, name`).all() as unknown as VariantRow[]).map(toVariant);
}

export function getVariant(id: string): Variant | null {
  const r = db.prepare(`SELECT * FROM variants WHERE id = ?`).get(id) as VariantRow | undefined;
  return r ? toVariant(r) : null;
}

export function activeMap(): ActiveMap {
  return Object.fromEntries((db.prepare(`SELECT room_id, variant_id FROM room_active`).all() as { room_id: string; variant_id: string }[]).map((r) => [r.room_id, r.variant_id]));
}

function assertRoom(roomId: string) {
  if (!allRooms(houseRef).some(({ room }) => room.id === roomId)) throw new VariantError(`Onbekende kamer: ${roomId}`);
}

function sanitizeFinish(f: RoomFinish | undefined): RoomFinish {
  const out: RoomFinish = {};
  if (f?.floor && f.floor in FLOOR_LABELS) out.floor = f.floor;
  if (f?.wallColor && /^#[0-9a-fA-F]{6}$/.test(f.wallColor)) out.wallColor = f.wallColor.toLowerCase();
  return out;
}

/** nieuwe variant; met copyFrom worden meubels en afwerking van die variant gekopieerd */
export function createVariant(input: { roomId: string; name: string; copyFrom?: string; activate?: boolean }, userId: string | null): Variant {
  assertRoom(input.roomId);
  const id = randomUUID();
  const source = input.copyFrom ? getVariant(input.copyFrom) : null;
  if (input.copyFrom && (!source || source.roomId !== input.roomId)) throw new VariantError('Bronvariant hoort niet bij deze kamer');
  const room = allRooms(houseRef).find(({ room }) => room.id === input.roomId)!.room;
  const finish = source?.finish ?? { floor: room.floor, wallColor: DEFAULT_WALL };
  db.prepare(`INSERT INTO variants (id, room_id, name, finish, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, input.roomId, input.name.trim().slice(0, 60) || 'Nieuwe variant', JSON.stringify(finish), userId, new Date().toISOString(),
  );
  if (source) {
    const rows = db.prepare(`SELECT * FROM placements WHERE variant_id = ?`).all(source.id) as Record<string, string | number>[];
    const ins = db.prepare(`INSERT INTO placements (id, item_id, level_id, variant_id, x, z, y, rotation, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rows) ins.run(randomUUID(), r.item_id, r.level_id, id, r.x, r.z, r.y, r.rotation, userId, new Date().toISOString());
  }
  if (input.activate !== false) db.prepare(`INSERT INTO room_active (room_id, variant_id) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET variant_id = excluded.variant_id`).run(input.roomId, id);
  bumpVersion();
  return getVariant(id)!;
}

export function updateVariant(id: string, patch: { name?: string; finish?: RoomFinish }): Variant {
  const v = getVariant(id);
  if (!v) throw new VariantError('Variant niet gevonden');
  const finish = patch.finish ? { ...v.finish, ...sanitizeFinish(patch.finish) } : v.finish;
  db.prepare(`UPDATE variants SET name = ?, finish = ? WHERE id = ?`).run(patch.name?.trim().slice(0, 60) || v.name, JSON.stringify(finish), id);
  bumpVersion();
  return getVariant(id)!;
}

export function activateVariant(id: string) {
  const v = getVariant(id);
  if (!v) throw new VariantError('Variant niet gevonden');
  db.prepare(`INSERT INTO room_active (room_id, variant_id) VALUES (?, ?) ON CONFLICT(room_id) DO UPDATE SET variant_id = excluded.variant_id`).run(v.roomId, id);
  bumpVersion();
  return v;
}

export function deleteVariant(id: string) {
  const v = getVariant(id);
  if (!v) throw new VariantError('Variant niet gevonden');
  if (id === defaultVariantId(v.roomId)) throw new VariantError('De standaardvariant kan niet weg');
  db.prepare(`DELETE FROM placements WHERE variant_id = ?`).run(id);
  db.prepare(`DELETE FROM variants WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM room_active WHERE room_id = ? AND variant_id = ?`).run(v.roomId, id);
  bumpVersion();
}
