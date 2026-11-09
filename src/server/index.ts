import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { streamSSE } from 'hono/streaming';
import { bus, presence, presenceJoin, presenceLeave, setActor, type ChangeEvent } from './events';
import { AuthError, ensureFirstUser, initAuth, listUsers } from './auth';
import { accountRoutes, authRoutes, requireUser, userRoutes, type AuthEnv } from './authRoutes';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { bearerUser, initOAuth, oauthApp, oauthPublic, wwwAuthenticate } from './oauth';
import { buildMcpServer } from './mcp';
import { VariantError, activateVariant, activeMap, createVariant, deleteVariant, initVariants, listVariants, updateVariant } from './variants';
import { waalstraat16 } from '../shared/waalstraat16';
import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATEGORIES, type Category } from '../shared/recipe';
import { createShare, deleteShare, initShares, listShares, shareByToken } from './shares';
import type { Item } from '../shared/recipe';
import { MAX_MODEL_BYTES, ModelError, clearModel, deleteItemWithModel, readModelFile, redeemUploadTicket, saveModel, updateModelSettings } from './models';
import {
  createItem,
  createPlacement,
  deletePlacement,
  getVersion,
  listItems,
  listPlacements,
  seedLibrary,
  updateItem,
  updatePlacement,
} from './db';

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);

// Blender-scripts draaien als aparte gebruiker: die mag niet in de gegevensmap kijken
if (process.getuid?.() === 0) {
  try {
    chmodSync(resolve(process.env.DATA_DIR ?? 'data'), 0o700);
  } catch {
    /* geen rechten of map bestaat (nog) niet */
  }
}

initAuth();
initOAuth();
initVariants(waalstraat16);
initShares();
ensureFirstUser();
seedLibrary();

const app = new Hono<AuthEnv>();

app.onError((err, c) => {
  if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
  if (err instanceof VariantError) return c.json({ error: err.message }, 400);
  if (err instanceof ModelError) return c.json({ error: err.message }, 400);
  if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  console.error(err);
  return c.json({ error: err.message || 'Serverfout' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

// ---------- inloggen (zonder sessie) ----------
app.route('/api/auth', authRoutes);

// ---------- OAuth voor de MCP-koppeling (claude.ai) ----------
app.route('/', oauthPublic);

// ---------- MCP-server (Streamable HTTP, stateless, Bearer-token) ----------
app.all('/mcp', async (c) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', 'authorization, content-type, mcp-protocol-version, mcp-session-id');
  c.header('Access-Control-Expose-Headers', 'www-authenticate, mcp-session-id');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  const user = bearerUser(c.req.header('authorization'));
  if (!user) {
    c.header('WWW-Authenticate', wwwAuthenticate());
    return c.json({ error: 'invalid_token', error_description: 'Log in via OAuth' }, 401);
  }
  const server = buildMcpServer(user);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(c.req.raw);
  return res;
});

// ---------- eenmalige uploadlink voor 3D-modellen (bijv. vanuit Blender op de Mac) ----------
async function readGlb(req: Request): Promise<Buffer> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_MODEL_BYTES) throw new ModelError(`Model is te groot (max ${MAX_MODEL_BYTES / 1e6} MB).`);
  const ct = req.headers.get('content-type') ?? '';
  if (ct.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const f = [...form.values()].find((v): v is File => typeof v !== 'string');
    if (!f) throw new ModelError('Geen bestand in het formulier.');
    return Buffer.from(await f.arrayBuffer());
  }
  return Buffer.from(await req.arrayBuffer());
}
app.post('/api/upload/:token', async (c) => {
  setActor('Claude', 'model geüpload');
  const it = redeemUploadTicket(c.req.param('token'), await readGlb(c.req.raw));
  const s = it.recipe.size;
  return c.json({ item_id: it.id, name: it.name, size_cm: `${Math.round(s.width * 100)} × ${Math.round(s.depth * 100)} × ${Math.round(s.height * 100)}`, triangles: it.model?.triangles }, 201);
});

// ---------- meekijklink (alleen lezen, zonder account) ----------
/** voor gasten: geen prijzen, notities, links of scripts */
const guestItem = (it: Item): Item => ({
  ...it,
  meta: { status: it.meta.status },
  createdBy: null,
  model: it.model ? { ...it.model, script: null } : it.model,
});
app.get('/api/view/:token/state', (c) => {
  const share = shareByToken(c.req.param('token'), true);
  if (!share) return c.json({ error: 'Deze link werkt niet (meer).' }, 404);
  c.header('Cache-Control', 'no-store');
  return c.json({ label: share.label, items: listItems().map(guestItem), placements: listPlacements(), variants: listVariants(), active: activeMap(), version: getVersion() });
});
app.get('/api/view/:token/version', (c) => {
  if (!shareByToken(c.req.param('token'))) return c.json({ error: 'Deze link werkt niet (meer).' }, 404);
  c.header('Cache-Control', 'no-store');
  return c.json({ version: getVersion() });
});
app.get('/api/view/:token/models/:file', (c) => {
  if (!shareByToken(c.req.param('token'))) return c.json({ error: 'Deze link werkt niet (meer).' }, 404);
  const buf = readModelFile(c.req.param('file'));
  if (!buf) return c.json({ error: 'Niet gevonden' }, 404);
  c.header('Content-Type', 'model/gltf-binary');
  c.header('Cache-Control', 'private, max-age=86400');
  return c.body(new Uint8Array(buf));
});

// ---------- vanaf hier ingelogd ----------
app.use('/api/*', requireUser);
app.route('/api/account', accountRoutes);
app.route('/api/users', userRoutes);
app.route('/api/oauth', oauthApp);

app.get('/api/me', (c) => c.json(c.get('user')));

// meekijklinks beheren
app.get('/api/shares', (c) => c.json(listShares()));
app.post('/api/shares', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const days = b.days === null || b.days === undefined ? null : Number(b.days);
  if (days !== null && (!Number.isFinite(days) || days < 1 || days > 3650)) return c.json({ error: 'Geldigheid: 1 tot 3650 dagen, of onbeperkt.' }, 400);
  const { share, token } = createShare(String(b.label ?? ''), days, c.get('user').id);
  return c.json({ ...share, token }, 201);
});
app.delete('/api/shares/:id', (c) => (deleteShare(c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Niet gevonden' }, 404)));

// live-updates (Server-Sent Events)
app.get('/api/events', (c) => {
  const user = c.get('user');
  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('X-Accel-Buffering', 'no');
  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => undefined);
    const onChange = (e: ChangeEvent) => send('change', e);
    const onPresence = (p: unknown) => send('presence', p);
    bus.on('change', onChange);
    bus.on('presence', onPresence);
    presenceJoin(user.id, user.displayName);
    await send('hello', { version: getVersion(), online: presence() });
    let open = true;
    stream.onAbort(() => {
      open = false;
    });
    while (open) {
      await stream.sleep(25_000);
      if (open) await stream.writeSSE({ event: 'ping', data: '{}' }).catch(() => (open = false));
    }
    bus.off('change', onChange);
    bus.off('presence', onPresence);
    presenceLeave(user.id);
  });
});
app.get('/api/version', (c) => c.json({ version: getVersion() }));
app.get('/api/state', (c) =>
  c.json({ items: listItems(), placements: listPlacements(), users: listUsers(), variants: listVariants(), active: activeMap(), version: getVersion() }),
);

app.get('/api/items', (c) => c.json(listItems()));
// wie doet de wijziging (voor meldingen bij de ander)
app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'GET') setActor(c.get('user')?.displayName);
  await next();
});

app.post('/api/items', async (c) => c.json(createItem(await c.req.json(), c.get('user').id), 201));
app.put('/api/items/:id', async (c) => {
  const body = await c.req.json();
  // een nieuw recept vervangt het 3D-model
  if (body?.recipe) clearModel(c.req.param('id'));
  const it = updateItem(c.req.param('id'), body);
  return it ? c.json(it) : c.json({ error: 'Niet gevonden' }, 404);
});
app.delete('/api/items/:id', (c) => (deleteItemWithModel(c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Niet gevonden' }, 404)));

// 3D-modellen (GLB)
app.get('/api/models/:file', (c) => {
  const buf = readModelFile(c.req.param('file'));
  if (!buf) return c.json({ error: 'Niet gevonden' }, 404);
  c.header('Content-Type', 'model/gltf-binary');
  c.header('Cache-Control', 'private, max-age=31536000, immutable');
  return c.body(new Uint8Array(buf));
});
app.post('/api/models', async (c) => {
  const name = c.req.query('name')?.trim() || 'Nieuw model';
  const cat = c.req.query('category');
  const category = (CATEGORIES as readonly string[]).includes(cat ?? '') ? (cat as Category) : 'overig';
  return c.json(saveModel(await readGlb(c.req.raw), { name, category, source: 'upload' }, c.get('user').id), 201);
});
app.post('/api/items/:id/model', async (c) => c.json(saveModel(await readGlb(c.req.raw), { itemId: c.req.param('id'), source: 'upload' }, c.get('user').id)));
app.put('/api/items/:id/model', async (c) => {
  const b = await c.req.json();
  return c.json(updateModelSettings(c.req.param('id'), { scale: b.scale === undefined ? undefined : Number(b.scale), rotation: b.rotation === undefined ? undefined : Number(b.rotation) }));
});

// varianten per kamer
app.post('/api/variants', async (c) => {
  const b = await c.req.json();
  setActor(c.get('user').displayName, `nieuwe variant “${b.name}”`);
  return c.json(createVariant({ roomId: String(b.roomId), name: String(b.name ?? ''), copyFrom: b.copyFrom, activate: b.activate }, c.get('user').id), 201);
});
app.put('/api/variants/:id', async (c) => c.json(updateVariant(c.req.param('id'), await c.req.json())));
app.post('/api/variants/:id/activate', (c) => {
  const v = activateVariant(c.req.param('id'));
  return c.json(v);
});
app.delete('/api/variants/:id', (c) => {
  deleteVariant(c.req.param('id'));
  return c.body(null, 204);
});

app.get('/api/placements', (c) => c.json(listPlacements()));
app.post('/api/placements', async (c) => c.json(createPlacement(await c.req.json(), c.get('user').id), 201));
app.put('/api/placements/:id', async (c) => {
  const p = updatePlacement(c.req.param('id'), await c.req.json());
  return p ? c.json(p) : c.json({ error: 'Niet gevonden' }, 404);
});
app.delete('/api/placements/:id', (c) => (deletePlacement(c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Niet gevonden' }, 404)));

// ---------- statische frontend (productie) ----------
if (PROD && existsSync('dist/index.html')) {
  const index = readFileSync('dist/index.html', 'utf8');
  app.use('/assets/*', serveStatic({ root: './dist', onFound: (_p, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }));
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', (c) => c.html(index));
}

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`House designer API op http://localhost:${info.port}${PROD ? '' : ' (dev)'}`);
});
