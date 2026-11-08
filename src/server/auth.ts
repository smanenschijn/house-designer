import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from './db';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
}

export const toPublic = (u: UserRow): PublicUser => ({ id: u.id, username: u.username, displayName: u.display_name });

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

export function upsertUser(username: string, displayName: string, password: string): PublicUser {
  const existing = db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as UserRow | undefined;
  if (existing) {
    db.prepare(`UPDATE users SET display_name = ?, password_hash = ? WHERE id = ?`).run(displayName, hashPassword(password), existing.id);
    return toPublic({ ...existing, display_name: displayName });
  }
  const id = randomUUID();
  db.prepare(`INSERT INTO users (id, username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)`).run(
    id, username, displayName, hashPassword(password), new Date().toISOString(),
  );
  return { id, username, displayName };
}

export function findUser(username: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as UserRow | undefined;
}

export function listUsers(): PublicUser[] {
  return (db.prepare(`SELECT * FROM users ORDER BY created_at`).all() as unknown as UserRow[]).map(toPublic);
}

const SESSION_DAYS = 60;

export function createSession(userId: string): string {
  const id = randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`).run(id, userId, Date.now() + SESSION_DAYS * 864e5);
  return id;
}

export function sessionUser(sessionId: string | undefined): PublicUser | null {
  if (!sessionId) return null;
  const row = db
    .prepare(`SELECT u.* , s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`)
    .get(sessionId) as (UserRow & { expires_at: number }) | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
    return null;
  }
  return toPublic(row);
}

export function deleteSession(sessionId: string) {
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}

/** BOOTSTRAP_USERS="gebruiker:Weergavenaam:wachtwoord;gebruiker2:Naam:wachtwoord" */
export function bootstrapUsers() {
  const spec = process.env.BOOTSTRAP_USERS;
  if (!spec) return;
  for (const entry of spec.split(';').map((s) => s.trim()).filter(Boolean)) {
    const [username, displayName, ...rest] = entry.split(':');
    const password = rest.join(':');
    if (!username || !displayName || !password) continue;
    if (!findUser(username.toLowerCase())) {
      upsertUser(username.toLowerCase(), displayName, password);
      console.log(`Gebruiker aangemaakt: ${username}`);
    }
  }
}
