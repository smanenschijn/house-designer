import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Category, Item, ItemMeta, ItemModel, Recipe } from '../shared/recipe';
import { createItem, deleteItem, getItem, setItemModel } from './db';

/**
 * 3D-modellen (GLB) bij meubels: opslaan, meten en eenmalige uploadlinks
 * (zodat Claude vanuit Blender op de Mac rechtstreeks een model kan uploaden).
 */

export const MODELS_DIR = resolve(process.env.DATA_DIR ?? 'data', 'models');
mkdirSync(MODELS_DIR, { recursive: true });

export const MAX_MODEL_BYTES = 40 * 1024 * 1024;

export class ModelError extends Error {}

// ---------- GLB lezen ----------
interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; mode?: number }[] }[];
  accessors?: { count: number; min?: number[]; max?: number[] }[];
}

// ---------- kleine 4×4-matrixrekening (kolom-major, zoals glTF) ----------
type M4 = number[];
const IDENTITY: M4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function compose(t: number[], q: number[], s: number[]): M4 {
  const [x, y, z, w] = q;
  const [sx, sy, sz] = s;
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    t[0], t[1], t[2], 1,
  ];
}
const apply = (m: M4, p: number[]) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);

/** buitengrenzen en aantal driehoeken uit de GLB-structuur (zonder de geometrie te decoderen) */
export function inspectGlb(buf: Buffer): { min: [number, number, number]; max: [number, number, number]; triangles: number } {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new ModelError('Dit is geen GLB-bestand (binaire glTF). Exporteer als .glb.');
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new ModelError('GLB zonder JSON-deel.');
  let gltf: Gltf;
  try {
    gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as Gltf;
  } catch {
    throw new ModelError('GLB is beschadigd (JSON onleesbaar).');
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  const visit = (ni: number, parent: M4, depth: number) => {
    const n = gltf.nodes?.[ni];
    if (!n || depth > 64) return;
    const local = n.matrix ?? compose(n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]);
    const world = mul(parent, local);
    if (n.mesh !== undefined)
      for (const prim of gltf.meshes?.[n.mesh]?.primitives ?? []) {
        const acc = gltf.accessors?.[prim.attributes.POSITION];
        if (!acc?.min || !acc.max) continue;
        for (let k = 0; k < 8; k++) {
          const p = apply(world, [k & 1 ? acc.max[0] : acc.min[0], k & 2 ? acc.max[1] : acc.min[1], k & 4 ? acc.max[2] : acc.min[2]]);
          for (let i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], p[i]);
            max[i] = Math.max(max[i], p[i]);
          }
        }
        if ((prim.mode ?? 4) === 4) triangles += Math.floor((prim.indices !== undefined ? gltf.accessors?.[prim.indices]?.count ?? 0 : acc.count) / 3);
      }
    for (const c of n.children ?? []) visit(c, world, depth + 1);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  for (const ni of scene?.nodes ?? []) visit(ni, IDENTITY, 0);
  if (!Number.isFinite(min[0])) throw new ModelError('Het model bevat geen geometrie.');
  return { min: min as [number, number, number], max: max as [number, number, number], triangles };
}

/** schaal raden: modellen in cm of mm zijn veel te groot voor een meubel */
function guessScale(min: number[], max: number[]): number {
  const largest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (largest > 300) return 0.001; // mm
  if (largest > 15) return 0.01; // cm
  return 1;
}

/** buitenmaten na schaal en draaiing */
export function modelSize(m: Pick<ItemModel, 'bounds' | 'scale' | 'rotation'>) {
  const sx = (m.bounds.max[0] - m.bounds.min[0]) * m.scale;
  const sy = (m.bounds.max[1] - m.bounds.min[1]) * m.scale;
  const sz = (m.bounds.max[2] - m.bounds.min[2]) * m.scale;
  const quarter = Math.round((((m.rotation % 360) + 360) % 360) / 90) % 2 === 1;
  const r = (v: number) => Math.max(0.01, Math.round(v * 1000) / 1000);
  return { width: r(quarter ? sz : sx), depth: r(quarter ? sx : sz), height: r(sy) };
}

/** eenvoudig recept (doos) met de buitenmaten van het model: voor botsingen en als terugval */
function boxRecipe(size: { width: number; depth: number; height: number }): Recipe {
  return {
    version: 1,
    size,
    materials: { model: { color: '#b9b4ab', finish: 'matte' } },
    parts: [{ shape: 'box', material: 'model', size: [size.width, size.height, size.depth], position: [0, size.height / 2, 0] }],
  };
}

export interface SaveModelOptions {
  itemId?: string;
  name?: string;
  category?: Category;
  meta?: Partial<ItemMeta>;
  source: ItemModel['source'];
  script?: string | null;
  scale?: number;
  rotation?: number;
}

/** slaat een GLB op bij een bestaand meubel, of maakt een nieuw meubel aan */
export function saveModel(buf: Buffer, opts: SaveModelOptions, userId: string | null): Item {
  if (buf.length > MAX_MODEL_BYTES) throw new ModelError(`Model is te groot (${Math.round(buf.length / 1e6)} MB, max ${MAX_MODEL_BYTES / 1e6} MB).`);
  const info = inspectGlb(buf);
  const existing = opts.itemId ? getItem(opts.itemId) : null;
  if (opts.itemId && !existing) throw new ModelError('Meubel niet gevonden.');
  const file = `${randomUUID()}.glb`;
  writeFileSync(resolve(MODELS_DIR, file), buf);
  const model: ItemModel = {
    file,
    bytes: buf.length,
    triangles: info.triangles,
    source: opts.source,
    bounds: { min: info.min, max: info.max },
    scale: opts.scale ?? existing?.model?.scale ?? guessScale(info.min, info.max),
    rotation: opts.rotation ?? 0,
    script: opts.script ?? null,
    updatedAt: new Date().toISOString(),
  };
  const recipe = boxRecipe(modelSize(model));
  let item = existing;
  if (!item)
    item = createItem(
      { name: opts.name ?? 'Nieuw model', category: opts.category ?? 'overig', recipe, meta: { status: 'overwegen', ...(opts.meta ?? {}) } },
      userId,
    );
  const old = item.model?.file;
  const out = setItemModel(item.id, model, recipe)!;
  if (old) removeFile(old);
  return out;
}

/** schaal of draaiing van een bestaand model aanpassen */
export function updateModelSettings(itemId: string, patch: { scale?: number; rotation?: number }): Item {
  const it = getItem(itemId);
  if (!it?.model) throw new ModelError('Dit meubel heeft geen 3D-model.');
  const model: ItemModel = { ...it.model, ...patch, updatedAt: new Date().toISOString() };
  if (!(model.scale > 0)) throw new ModelError('Schaal moet groter dan 0 zijn.');
  return setItemModel(itemId, model, boxRecipe(modelSize(model)))!;
}

/** model weghalen: het meubel wordt weer door zijn recept getekend */
export function clearModel(itemId: string) {
  const it = getItem(itemId);
  if (!it?.model) return;
  setItemModel(itemId, null);
  removeFile(it.model.file);
}

export function deleteItemWithModel(id: string): boolean {
  const file = getItem(id)?.model?.file;
  const ok = deleteItem(id);
  if (ok && file) removeFile(file);
  return ok;
}

function removeFile(file: string) {
  try {
    rmSync(resolve(MODELS_DIR, file), { force: true });
  } catch {
    /* al weg */
  }
}

export function readModelFile(file: string): Buffer | null {
  if (!/^[0-9a-f-]{36}\.glb$/.test(file)) return null;
  const p = resolve(MODELS_DIR, file);
  return existsSync(p) ? readFileSync(p) : null;
}

// ---------- eenmalige uploadlinks ----------
interface UploadTicket {
  userId: string;
  opts: Omit<SaveModelOptions, 'source'>;
  expires: number;
}
const tickets = new Map<string, UploadTicket>();
export const UPLOAD_TTL_MS = 30 * 60_000;

export function createUploadTicket(userId: string, opts: Omit<SaveModelOptions, 'source'>): string {
  const now = Date.now();
  for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k);
  const token = randomBytes(24).toString('base64url');
  tickets.set(token, { userId, opts, expires: now + UPLOAD_TTL_MS });
  return token;
}

/** verzilvert een uploadlink (eenmalig) */
export function redeemUploadTicket(token: string, buf: Buffer): Item {
  const t = tickets.get(token);
  if (!t || t.expires < Date.now()) {
    tickets.delete(token);
    throw new ModelError('Uploadlink is verlopen of al gebruikt. Vraag een nieuwe aan met prepare_model_upload.');
  }
  const item = saveModel(buf, { ...t.opts, source: 'upload' }, t.userId);
  tickets.delete(token);
  return item;
}
