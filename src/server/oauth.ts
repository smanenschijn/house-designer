import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { AuthError, Ephemeral, getUser, randomToken, sha256, toPublic, type PublicUser } from './auth';
import type { AuthEnv } from './authRoutes';
import { mcpResource, origin } from './config';
import { db } from './db';

/**
 * Minimale OAuth 2.1-autorisatieserver voor de MCP-koppeling met claude.ai:
 * - dynamische clientregistratie (RFC 7591)
 * - authorization code + PKCE (S256)
 * - refresh tokens met rotatie
 * - metadata (RFC 8414 en RFC 9728)
 * Het toestemmingsscherm draait in de React-app (met de gewone login en passkeys).
 */

const ACCESS_TTL = 60 * 60 * 1000; // 1 uur
const REFRESH_TTL = 90 * 864e5; // 90 dagen
export const SCOPE = 'house';

export function initOAuth() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id TEXT PRIMARY KEY,
      client_name TEXT,
      redirect_uris TEXT NOT NULL,
      secret_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id TEXT PRIMARY KEY,
      access_hash TEXT UNIQUE NOT NULL,
      refresh_hash TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
      scope TEXT,
      access_expires INTEGER NOT NULL,
      refresh_expires INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      last_used TEXT
    );
  `);
  db.prepare(`DELETE FROM oauth_tokens WHERE refresh_expires < ?`).run(Date.now());
}

interface ClientRow {
  client_id: string;
  client_name: string | null;
  redirect_uris: string;
  secret_hash: string | null;
}

const getClient = (id: string) => db.prepare(`SELECT * FROM oauth_clients WHERE client_id = ?`).get(id) as ClientRow | undefined;

interface PendingCode {
  userId: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope: string;
}
const codes = new Ephemeral<PendingCode>(10 * 60_000);

// ---------- metadata ----------
export const oauthPublic = new Hono();

const asMetadata = () => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  revocation_endpoint: `${origin}/oauth/revoke`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
  scopes_supported: [SCOPE],
});
const prMetadata = () => ({
  resource: mcpResource,
  authorization_servers: [origin],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ['header'],
  resource_name: 'Waalstraat 16 — huis inrichten',
});

const cors = (c: Context) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', 'authorization, content-type, mcp-protocol-version');
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
};
oauthPublic.use('*', async (c, next) => {
  cors(c);
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
  await next();
});

oauthPublic.get('/.well-known/oauth-authorization-server', (c) => c.json(asMetadata()));
oauthPublic.get('/.well-known/oauth-authorization-server/*', (c) => c.json(asMetadata()));
oauthPublic.get('/.well-known/openid-configuration', (c) => c.json(asMetadata()));
oauthPublic.get('/.well-known/oauth-protected-resource', (c) => c.json(prMetadata()));
oauthPublic.get('/.well-known/oauth-protected-resource/*', (c) => c.json(prMetadata()));

// ---------- dynamische clientregistratie ----------
oauthPublic.post('/oauth/register', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const uris: unknown = body.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || !uris.every((u) => typeof u === 'string' && isAllowedRedirect(u)))
    return c.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris moeten https zijn (of localhost)' }, 400);
  const clientId = randomUUID();
  const method = body.token_endpoint_auth_method ?? 'none';
  const secret = method === 'none' ? null : randomToken(32);
  db.prepare(`INSERT INTO oauth_clients (client_id, client_name, redirect_uris, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    clientId, String(body.client_name ?? 'MCP-client').slice(0, 100), JSON.stringify(uris), secret ? sha256(secret) : null, new Date().toISOString(),
  );
  return c.json(
    {
      client_id: clientId,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: body.client_name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: secret ? method : 'none',
    },
    201,
  );
});

function isAllowedRedirect(u: string) {
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// ---------- autorisatie: door naar het toestemmingsscherm in de app ----------
function validateAuthorize(q: URLSearchParams): { client: ClientRow; redirectUri: string } {
  const client = getClient(q.get('client_id') ?? '');
  if (!client) throw new AuthError(400, 'Onbekende client. Verwijder de connector en voeg hem opnieuw toe.');
  const redirectUri = q.get('redirect_uri') ?? '';
  const allowed = JSON.parse(client.redirect_uris) as string[];
  if (!allowed.includes(redirectUri)) throw new AuthError(400, 'Ongeldige redirect_uri.');
  if (q.get('response_type') !== 'code') throw new AuthError(400, 'Alleen response_type=code wordt ondersteund.');
  if (!q.get('code_challenge') || (q.get('code_challenge_method') ?? 'S256') !== 'S256') throw new AuthError(400, 'PKCE (S256) is verplicht.');
  return { client, redirectUri };
}

oauthPublic.get('/oauth/authorize', (c) => {
  const q = new URL(c.req.url).searchParams;
  try {
    validateAuthorize(q);
  } catch (e) {
    return c.html(`<!doctype html><meta charset="utf-8"><body style="background:#0a0c0b;color:#edf2ee;font-family:system-ui;padding:40px"><h2>Koppelen mislukt</h2><p>${(e as Error).message}</p></body>`, 400);
  }
  return c.redirect(`/?oauth=${encodeURIComponent(q.toString())}`);
});

// ---------- tokens ----------
function issueTokens(userId: string, clientId: string, scope: string) {
  const access = randomToken(32);
  const refresh = randomToken(32);
  const now = Date.now();
  db.prepare(
    `INSERT INTO oauth_tokens (id, access_hash, refresh_hash, user_id, client_id, scope, access_expires, refresh_expires, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), sha256(access), sha256(refresh), userId, clientId, scope, now + ACCESS_TTL, now + REFRESH_TTL, new Date().toISOString());
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope };
}

function clientAuthOk(c: Context, client: ClientRow, form: Record<string, string>) {
  if (!client.secret_hash) return true;
  let secret = form.client_secret;
  const auth = c.req.header('authorization');
  if (!secret && auth?.startsWith('Basic ')) {
    const [, s] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
    secret = decodeURIComponent(s ?? '');
  }
  if (!secret) return false;
  const a = Buffer.from(sha256(secret));
  const b = Buffer.from(client.secret_hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

oauthPublic.post('/oauth/token', async (c) => {
  const ct = c.req.header('content-type') ?? '';
  const form: Record<string, string> = ct.includes('application/json')
    ? await c.req.json().catch(() => ({}))
    : Object.fromEntries(Object.entries(await c.req.parseBody().catch(() => ({}))).map(([k, v]) => [k, String(v)]));
  const err = (error: string, description: string, status: 400 | 401 = 400) => c.json({ error, error_description: description }, status);

  let clientId = form.client_id;
  const basic = c.req.header('authorization');
  if (!clientId && basic?.startsWith('Basic ')) clientId = decodeURIComponent(Buffer.from(basic.slice(6), 'base64').toString().split(':')[0]);
  const client = getClient(clientId ?? '');
  if (!client) return err('invalid_client', 'Onbekende client', 401);
  if (!clientAuthOk(c, client, form)) return err('invalid_client', 'Clientgeheim klopt niet', 401);

  if (form.grant_type === 'authorization_code') {
    const pending = codes.take(form.code);
    if (!pending || pending.clientId !== client.client_id) return err('invalid_grant', 'Code ongeldig of verlopen');
    if (form.redirect_uri && form.redirect_uri !== pending.redirectUri) return err('invalid_grant', 'redirect_uri klopt niet');
    const verifier = form.code_verifier ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (challenge !== pending.challenge) return err('invalid_grant', 'PKCE-controle mislukt');
    return c.json(issueTokens(pending.userId, client.client_id, pending.scope));
  }
  if (form.grant_type === 'refresh_token') {
    const row = db.prepare(`SELECT * FROM oauth_tokens WHERE refresh_hash = ?`).get(sha256(form.refresh_token ?? '')) as
      | { id: string; user_id: string; client_id: string; scope: string; refresh_expires: number }
      | undefined;
    if (!row || row.client_id !== client.client_id || row.refresh_expires < Date.now()) return err('invalid_grant', 'Refresh token ongeldig');
    db.prepare(`DELETE FROM oauth_tokens WHERE id = ?`).run(row.id); // rotatie
    return c.json(issueTokens(row.user_id, client.client_id, row.scope));
  }
  return err('unsupported_grant_type', 'Alleen authorization_code en refresh_token');
});

oauthPublic.post('/oauth/revoke', async (c) => {
  const form = Object.fromEntries(Object.entries(await c.req.parseBody().catch(() => ({}))).map(([k, v]) => [k, String(v)]));
  const h = sha256(form.token ?? '');
  db.prepare(`DELETE FROM oauth_tokens WHERE access_hash = ? OR refresh_hash = ?`).run(h, h);
  return c.body(null, 200);
});

// ---------- bearer-token voor /mcp ----------
export function bearerUser(header: string | undefined): PublicUser | null {
  if (!header?.startsWith('Bearer ')) return null;
  const row = db.prepare(`SELECT id, user_id, access_expires FROM oauth_tokens WHERE access_hash = ?`).get(sha256(header.slice(7).trim())) as
    | { id: string; user_id: string; access_expires: number }
    | undefined;
  if (!row || row.access_expires < Date.now()) return null;
  db.prepare(`UPDATE oauth_tokens SET last_used = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
  const u = getUser(row.user_id);
  return u ? toPublic(u) : null;
}

export const wwwAuthenticate = () => `Bearer realm="mcp", resource_metadata="${origin}/.well-known/oauth-protected-resource"`;

// ================= ingelogd: toestemming en gekoppelde apps =================
export const oauthApp = new Hono<AuthEnv>();

oauthApp.post('/describe', async (c) => {
  const { query } = await c.req.json().catch(() => ({ query: '' }));
  const { client } = validateAuthorize(new URLSearchParams(String(query)));
  return c.json({ clientName: client.client_name ?? 'Onbekende app', redirectHost: new URL(new URLSearchParams(String(query)).get('redirect_uri')!).host });
});

oauthApp.post('/approve', async (c) => {
  const { query } = await c.req.json().catch(() => ({ query: '' }));
  const q = new URLSearchParams(String(query));
  const { client, redirectUri } = validateAuthorize(q);
  const code = codes.put({
    userId: c.get('user').id,
    clientId: client.client_id,
    redirectUri,
    challenge: q.get('code_challenge')!,
    scope: SCOPE,
  });
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (q.get('state')) url.searchParams.set('state', q.get('state')!);
  return c.json({ redirect: url.toString() });
});

oauthApp.post('/deny', async (c) => {
  const { query } = await c.req.json().catch(() => ({ query: '' }));
  const q = new URLSearchParams(String(query));
  const { redirectUri } = validateAuthorize(q);
  const url = new URL(redirectUri);
  url.searchParams.set('error', 'access_denied');
  if (q.get('state')) url.searchParams.set('state', q.get('state')!);
  return c.json({ redirect: url.toString() });
});

oauthApp.get('/connections', (c) => {
  const rows = db
    .prepare(
      `SELECT t.client_id, c.client_name, MIN(t.created_at) AS created_at, MAX(t.last_used) AS last_used
       FROM oauth_tokens t JOIN oauth_clients c ON c.client_id = t.client_id
       WHERE t.user_id = ? GROUP BY t.client_id ORDER BY created_at`,
    )
    .all(c.get('user').id) as { client_id: string; client_name: string | null; created_at: string; last_used: string | null }[];
  return c.json(rows.map((r) => ({ clientId: r.client_id, name: r.client_name ?? 'App', createdAt: r.created_at, lastUsed: r.last_used })));
});

oauthApp.delete('/connections/:clientId', (c) => {
  db.prepare(`DELETE FROM oauth_tokens WHERE user_id = ? AND client_id = ?`).run(c.get('user').id, c.req.param('clientId'));
  return c.body(null, 204);
});
