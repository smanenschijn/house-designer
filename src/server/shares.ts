import { randomUUID } from 'node:crypto';
import { db } from './db';
import { randomToken, sha256 } from './auth';

/**
 * Meekijklinks: iedereen met de link mag het huis bekijken (rondlopen, plattegrond),
 * maar niets veranderen. Alleen de hash van het token wordt bewaard; de link zie je één keer.
 */

export interface ShareInfo {
  id: string;
  label: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsed: string | null;
  views: number;
}

interface ShareRow {
  id: string;
  token_hash: string;
  label: string;
  created_by: string | null;
  created_at: string;
  expires_at: number | null;
  last_used: number | null;
  views: number;
}

export function initShares() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS share_links (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      expires_at INTEGER,
      last_used INTEGER,
      views INTEGER NOT NULL DEFAULT 0
    );
  `);
}

const toInfo = (r: ShareRow): ShareInfo => ({
  id: r.id,
  label: r.label,
  createdBy: r.created_by,
  createdAt: r.created_at,
  expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null,
  lastUsed: r.last_used ? new Date(r.last_used).toISOString() : null,
  views: r.views,
});

export function listShares(): ShareInfo[] {
  return (db.prepare(`SELECT * FROM share_links ORDER BY created_at DESC`).all() as unknown as ShareRow[]).map(toInfo);
}

/** maakt een link; het token komt alleen hier terug */
export function createShare(label: string, days: number | null, userId: string): { share: ShareInfo; token: string } {
  const token = randomToken(24);
  const id = randomUUID();
  const clean = label.trim().slice(0, 80) || 'Meekijken';
  const expires = days && days > 0 ? Date.now() + days * 864e5 : null;
  db.prepare(`INSERT INTO share_links (id, token_hash, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, sha256(token), clean, userId, new Date().toISOString(), expires,
  );
  return { share: toInfo(db.prepare(`SELECT * FROM share_links WHERE id = ?`).get(id) as unknown as ShareRow), token };
}

export function deleteShare(id: string): boolean {
  return db.prepare(`DELETE FROM share_links WHERE id = ?`).run(id).changes > 0;
}

/** geldige link? (telt bezoeken bij het laden van de toestand) */
export function shareByToken(token: string | undefined, countView = false): ShareInfo | null {
  if (!token || token.length < 20 || token.length > 100) return null;
  const row = db.prepare(`SELECT * FROM share_links WHERE token_hash = ?`).get(sha256(token)) as ShareRow | undefined;
  if (!row) return null;
  if (row.expires_at && row.expires_at < Date.now()) return null;
  const now = Date.now();
  if (countView) db.prepare(`UPDATE share_links SET last_used = ?, views = views + 1 WHERE id = ?`).run(now, row.id);
  else if (!row.last_used || now - row.last_used > 600_000) db.prepare(`UPDATE share_links SET last_used = ? WHERE id = ?`).run(now, row.id);
  return toInfo(row);
}
