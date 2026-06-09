import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { GameDatabase } from './db/database.js';

/**
 * Account access levels. Players are guests at level 0 until they authenticate with `/login`.
 * Chat/admin commands are gated by minimum access level (see commands.ts). The server is the sole
 * authority on a session's level — the client never asserts it.
 */
export enum AccessLevel {
  Player = 0,
  Moderator = 1,
  GameMaster = 2,
  Admin = 3,
  Developer = 4,
}

export const ACCESS_NAMES: Record<number, string> = {
  0: 'Player',
  1: 'Moderator',
  2: 'GameMaster',
  3: 'Admin',
  4: 'Developer',
};

export function accessName(level: number): string {
  return ACCESS_NAMES[level] ?? `Level ${level}`;
}

/** Hash a password with scrypt and a per-account salt. Returns hex hash + salt. */
export function hashPassword(
  password: string,
  salt: string = randomBytes(16).toString('hex'),
): { hash: string; salt: string } {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

/** Create or replace an account with the given password and access level. */
export function createAccount(
  db: GameDatabase,
  username: string,
  password: string,
  level: AccessLevel,
): void {
  const { hash, salt } = hashPassword(password);
  db.prepare(
    `INSERT INTO accounts (username, access_level, password_hash, salt, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       access_level = excluded.access_level,
       password_hash = excluded.password_hash,
       salt = excluded.salt`,
  ).run(username, level, hash, salt, new Date().toISOString());
}

interface AccountRow {
  access_level: number;
  password_hash: string | null;
  salt: string | null;
}

/** Verify credentials. Returns the account's access level, or null on failure. Timing-safe. */
export function verifyLogin(db: GameDatabase, username: string, password: string): number | null {
  const row = db
    .prepare('SELECT access_level, password_hash, salt FROM accounts WHERE username = ?')
    .get(username) as AccountRow | undefined;
  if (!row || !row.password_hash || !row.salt) return null;
  const { hash } = hashPassword(password, row.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(row.password_hash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return row.access_level;
}

/** Set an existing account's access level. Returns true if a row was updated. */
export function setAccess(db: GameDatabase, username: string, level: number): boolean {
  const r = db
    .prepare('UPDATE accounts SET access_level = ? WHERE username = ?')
    .run(level, username);
  return r.changes > 0;
}

/** True if any account exists (used to decide whether to seed the default developer account). */
export function accountCount(db: GameDatabase): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n;
}
