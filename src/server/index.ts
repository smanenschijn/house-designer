import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { readFileSync, existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { bootstrapUsers, createSession, deleteSession, findUser, listUsers, sessionUser, verifyPassword, type PublicUser } from './auth';
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
const COOKIE = 'hd_session';

bootstrapUsers();
seedLibrary();

type Env = { Variables: { user: PublicUser } };
const app = new Hono<Env>();

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, 400);
  console.error(err);
  return c.json({ error: err.message || 'Serverfout' }, 500);
});

// ---------- login ----------
const attempts = new Map<string, { n: number; t: number }>();
app.post('/api/login', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local';
  const a = attempts.get(ip);
  if (a && Date.now() - a.t < 60_000 && a.n >= 10) return c.json({ error: 'Te veel pogingen, probeer het over een minuut opnieuw.' }, 429);
  const body = await c.req.json().catch(() => ({}));
  const u = typeof body.username === 'string' ? findUser(body.username.trim().toLowerCase()) ?? findUser(body.username.trim()) : undefined;
  if (!u || typeof body.password !== 'string' || !verifyPassword(body.password, u.password_hash)) {
    attempts.set(ip, { n: (a && Date.now() - a.t < 60_000 ? a.n : 0) + 1, t: a && Date.now() - a.t < 60_000 ? a.t : Date.now() });
    return c.json({ error: 'Onbekende gebruiker of verkeerd wachtwoord' }, 401);
  }
  attempts.delete(ip);
  const sid = createSession(u.id);
  setCookie(c, COOKIE, sid, { httpOnly: true, sameSite: 'Lax', secure: PROD, path: '/', maxAge: 60 * 86400 });
  return c.json({ id: u.id, username: u.username, displayName: u.display_name });
});

app.post('/api/logout', (c) => {
  const sid = getCookie(c, COOKIE);
  if (sid) deleteSession(sid);
  deleteCookie(c, COOKIE, { path: '/' });
  return c.body(null, 204);
});

app.get('/api/health', (c) => c.json({ ok: true }));

// ---------- vanaf hier ingelogd ----------
app.use('/api/*', async (c, next) => {
  const user = sessionUser(getCookie(c, COOKIE));
  if (!user) return c.json({ error: 'Niet ingelogd' }, 401);
  c.set('user', user);
  await next();
});

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
