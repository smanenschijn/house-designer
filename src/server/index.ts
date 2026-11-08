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
import {
  createItem,
  createPlacement,
  deleteItem,
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

initAuth();
initOAuth();
initVariants(waalstraat16);
ensureFirstUser();
seedLibrary();

const app = new Hono<AuthEnv>();

app.onError((err, c) => {
  if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
  if (err instanceof VariantError) return c.json({ error: err.message }, 400);
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

// ---------- vanaf hier ingelogd ----------
app.use('/api/*', requireUser);
app.route('/api/account', accountRoutes);
app.route('/api/users', userRoutes);
app.route('/api/oauth', oauthApp);

app.get('/api/me', (c) => c.json(c.get('user')));

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
  const it = updateItem(c.req.param('id'), await c.req.json());
  return it ? c.json(it) : c.json({ error: 'Niet gevonden' }, 404);
});
app.delete('/api/items/:id', (c) => (deleteItem(c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Niet gevonden' }, 404)));

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
