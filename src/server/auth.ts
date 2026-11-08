import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db';

/**
 * Gebruikers, sessies en passkeys.
 * Opzet zoals in iptv-blaster: het eerste account wordt bij de eerste start aangemaakt uit
 * ADMIN_USERNAME / ADMIN_PASSWORD; daarna maak je in de app extra gebruikers aan.
 * Geen rollen: iedereen die kan inloggen mag alles.
 */

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  webauthn_user_id: string;
  created_at: string;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
}

export const toPublic = (u: UserRow): PublicUser => ({ id: u.id, username: u.username, displayName: u.display_name });

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---------- schema + migraties ----------
export function initAuth() {
  const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  const userCols = cols('users');
  if (!userCols.includes('webauthn_user_id')) db.exec(`ALTER TABLE users ADD COLUMN webauthn_user_id TEXT`);
  for (const u of db.prepare(`SELECT id FROM users WHERE webauthn_user_id IS NULL`).all() as { id: string }[])
    db.prepare(`UPDATE users SET webauthn_user_id = ? WHERE id = ?`).run(randomToken(16), u.id);

  // oude sessietabel (onversleutelde tokens) vervangen door gehashte tokens
  db.exec(`
    DROP TABLE IF EXISTS sessions;
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      last_used INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      name TEXT,
      created_at TEXT NOT NULL,
      last_used TEXT
    );
  `);
  db.prepare(`DELETE FROM auth_sessions WHERE expires_at < ?`).run(Date.now());
}

// ---------- wachtwoorden ----------
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const got = scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, got);
}

export const MIN_PASSWORD = 10;
export const USERNAME_RE = /^[a-z0-9._-]{2,32}$/;

// ---------- gebruikers ----------
export function getUser(id: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

export function findUser(username: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username.trim().toLowerCase()) as UserRow | undefined;
}

export function listUsers(): PublicUser[] {
  return (db.prepare(`SELECT * FROM users ORDER BY created_at`).all() as unknown as UserRow[]).map(toPublic);
}

export function listUsersDetailed() {
  const pk = db.prepare(`SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?`);
  return (db.prepare(`SELECT * FROM users ORDER BY created_at`).all() as unknown as UserRow[]).map((u) => ({
    ...toPublic(u),
    createdAt: u.created_at,
    passkeys: (pk.get(u.id) as { n: number }).n,
  }));
}

const userCount = () => (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;

export class AuthError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 503,
    message: string,
  ) {
    super(message);
  }
}

export function createUser(input: { username: string; displayName: string; password: string }): PublicUser {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) throw new AuthError(400, 'Gebruikersnaam: 2–32 tekens, kleine letters, cijfers, punt, streepje of underscore.');
  if (findUser(username)) throw new AuthError(409, 'Deze gebruikersnaam bestaat al.');
  if (input.password.length < MIN_PASSWORD) throw new AuthError(400, `Wachtwoord moet minstens ${MIN_PASSWORD} tekens zijn.`);
  const id = randomUUID();
  db.prepare(`INSERT INTO users (id, username, display_name, password_hash, webauthn_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, username, input.displayName.trim() || username, hashPassword(input.password), randomToken(16), new Date().toISOString(),
  );
  return toPublic(getUser(id)!);
}

export function updateUser(id: string, patch: { displayName?: string; password?: string }): PublicUser {
  const u = getUser(id);
  if (!u) throw new AuthError(404, 'Gebruiker niet gevonden.');
  if (patch.password !== undefined && patch.password.length < MIN_PASSWORD)
    throw new AuthError(400, `Wachtwoord moet minstens ${MIN_PASSWORD} tekens zijn.`);
  db.prepare(`UPDATE users SET display_name = ?, password_hash = ? WHERE id = ?`).run(
    patch.displayName?.trim() || u.display_name,
    patch.password !== undefined ? hashPassword(patch.password) : u.password_hash,
    id,
  );
  return toPublic(getUser(id)!);
}

export function deleteUser(id: string, actingUserId: string) {
  const u = getUser(id);
  if (!u) throw new AuthError(404, 'Gebruiker niet gevonden.');
  if (id === actingUserId) throw new AuthError(400, 'Je kunt jezelf niet verwijderen.');
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
}

/** Maakt het eerste account aan uit ADMIN_USERNAME / ADMIN_PASSWORD als er nog geen gebruikers zijn. */
export function ensureFirstUser() {
  if (userCount() > 0) return;
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.warn('[auth] nog geen gebruikers: zet ADMIN_PASSWORD (en optioneel ADMIN_USERNAME) om het eerste account aan te maken');
    return;
  }
  const username = (process.env.ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
  createUser({ username, displayName: process.env.ADMIN_DISPLAY_NAME ?? username, password });
  console.log(`[auth] eerste account aangemaakt: ${username}`);
}

// ---------- sessies ----------
const SESSION_MS = 60 * 864e5;

export function createSession(userId: string, ttl = SESSION_MS): string {
  const token = randomToken();
  const now = Date.now();
  db.prepare(`INSERT INTO auth_sessions (token_hash, user_id, created_at, last_used, expires_at) VALUES (?, ?, ?, ?, ?)`).run(
    sha256(token), userId, now, now, now + ttl,
  );
  return token;
}

export function sessionUser(token: string | undefined): PublicUser | null {
  if (!token) return null;
  const h = sha256(token);
  const row = db
    .prepare(`SELECT u.*, s.expires_at, s.last_used FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
    .get(h) as (UserRow & { expires_at: number; last_used: number }) | undefined;
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) {
    db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(h);
    return null;
  }
  if (now - row.last_used > 3600_000) db.prepare(`UPDATE auth_sessions SET last_used = ? WHERE token_hash = ?`).run(now, h);
  return toPublic(row);
}

export function deleteSession(token: string) {
  db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).run(sha256(token));
}

/** Alle sessies van een gebruiker beëindigen (bijv. na wachtwoordreset), behalve optioneel de huidige. */
export function deleteUserSessions(userId: string, exceptToken?: string) {
  if (exceptToken) db.prepare(`DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?`).run(userId, sha256(exceptToken));
  else db.prepare(`DELETE FROM auth_sessions WHERE user_id = ?`).run(userId);
}

// ---------- passkeys ----------
export interface PasskeyRow {
  id: string;
  user_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
  name: string | null;
  created_at: string;
  last_used: string | null;
}

export function listPasskeys(userId: string) {
  return (db.prepare(`SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at`).all(userId) as unknown as PasskeyRow[]).map((p) => ({
    id: p.id,
    name: p.name ?? 'Passkey',
    createdAt: p.created_at,
    lastUsed: p.last_used,
  }));
}

export function passkeyRows(userId: string): PasskeyRow[] {
  return db.prepare(`SELECT * FROM passkeys WHERE user_id = ?`).all(userId) as unknown as PasskeyRow[];
}

export function getPasskey(id: string): PasskeyRow | undefined {
  return db.prepare(`SELECT * FROM passkeys WHERE id = ?`).get(id) as PasskeyRow | undefined;
}

export function insertPasskey(p: { id: string; userId: string; publicKey: string; counter: number; transports?: string[]; name: string }) {
  db.prepare(`INSERT INTO passkeys (id, user_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    p.id, p.userId, p.publicKey, p.counter, p.transports ? JSON.stringify(p.transports) : null, p.name, new Date().toISOString(),
  );
}

export function touchPasskey(id: string, counter: number) {
  db.prepare(`UPDATE passkeys SET counter = ?, last_used = ? WHERE id = ?`).run(counter, new Date().toISOString(), id);
}

export function deletePasskey(userId: string, id: string): boolean {
  return db.prepare(`DELETE FROM passkeys WHERE user_id = ? AND id = ?`).run(userId, id).changes > 0;
}

// ---------- kortlevende opslag (challenges, 2FA) ----------
export class Ephemeral<T> {
  private map = new Map<string, { v: T; exp: number }>();
  constructor(private ttl: number) {}
  put(v: T): string {
    const id = randomToken(16);
    this.map.set(id, { v, exp: Date.now() + this.ttl });
    if (this.map.size > 500) for (const [k, e] of this.map) if (e.exp < Date.now()) this.map.delete(k);
    return id;
  }
  take(id: string | undefined): T | null {
    if (!id) return null;
    const e = this.map.get(id);
    this.map.delete(id);
    return e && e.exp > Date.now() ? e.v : null;
  }
}
