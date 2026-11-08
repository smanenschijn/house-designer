import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFileSync, existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { AuthError, ensureFirstUser, initAuth, listUsers } from './auth';
import { accountRoutes, authRoutes, requireUser, userRoutes, type AuthEnv } from './authRoutes';
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
ensureFirstUser();
seedLibrary();

const app = new Hono<AuthEnv>();

app.onError((err, c) => {
  if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
  if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  console.error(err);
  return c.json({ error: err.message || 'Serverfout' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

// ---------- inloggen (zonder sessie) ----------
app.route('/api/auth', authRoutes);

// ---------- vanaf hier ingelogd ----------
app.use('/api/*', requireUser);
app.route('/api/account', accountRoutes);
app.route('/api/users', userRoutes);

app.get('/api/me', (c) => c.json(c.get('user')));
app.get('/api/version', (c) => c.json({ version: getVersion() }));
app.get('/api/state', (c) => c.json({ items: listItems(), placements: listPlacements(), users: listUsers(), version: getVersion() }));

app.get('/api/items', (c) => c.json(listItems()));
app.post('/api/items', async (c) => c.json(createItem(await c.req.json(), c.get('user').id), 201));
app.put('/api/items/:id', async (c) => {
  const it = updateItem(c.req.param('id'), await c.req.json());
  return it ? c.json(it) : c.json({ error: 'Niet gevonden' }, 404);
});
app.delete('/api/items/:id', (c) => (deleteItem(c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Niet gevonden' }, 404)));

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
