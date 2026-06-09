import { randomBytes } from 'node:crypto';
import type { GameDatabase } from './db/database.js';
import type { PlayerSave } from './world.js';

/**
 * Persistent character saves keyed by an opaque per-client token. A new guest is issued a random
 * token (stored in their browser); on reconnect they present it and the server reloads their
 * character — so progress survives disconnects and server restarts. The token is a 144-bit random
 * secret, so it doubles as the (weak but adequate for guests) proof of ownership; it is only ever
 * used as a bound query parameter, never interpolated into SQL.
 */

const TOKEN_RE = /^[a-f0-9]{36}$/;

/** A fresh opaque token for a new guest. */
export function newPlayerToken(): string {
  return randomBytes(18).toString('hex'); // 36 hex chars
}

/** True if a client-supplied token is well-formed (defensive — it's untrusted input). */
export function isValidToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

/** Load a saved character by token, or null if there is none (or the row is corrupt). */
export function loadSave(db: GameDatabase, token: string): PlayerSave | null {
  const row = db.prepare('SELECT data FROM player_saves WHERE token = ?').get(token) as
    | { data: string }
    | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.data) as PlayerSave;
  } catch {
    return null;
  }
}

/** Insert or update the character save for a token. */
export function storeSave(db: GameDatabase, token: string, save: PlayerSave): void {
  db.prepare(
    `INSERT INTO player_saves (token, name, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(token, save.name, JSON.stringify(save), new Date().toISOString());
}
