import { randomBytes } from 'node:crypto';
import type { GameDatabase } from './db/database.js';
import type { PlayerSave } from './world.js';
import type { ItemInstance } from '../shared/items.js';

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
    return normalizeSave(JSON.parse(row.data) as PlayerSave);
  } catch {
    return null;
  }
}

/**
 * Bring an older save up to the current shape so the sim, vendor, and UI (which all iterate these)
 * stay safe across deploys:
 *  - instances written before affixes get an empty `affixes` array;
 *  - saves with the old `{ weapon, armor }` shape migrate into the `equipment` doll-slot map.
 */
function normalizeSave(save: PlayerSave): PlayerSave {
  const fixAffixes = (i: ItemInstance | null): ItemInstance | null =>
    i && !Array.isArray(i.affixes) ? { ...i, affixes: [] } : i;
  save.gear = (save.gear ?? []).map((i) => fixAffixes(i) ?? i);

  const legacy = save as unknown as { weapon?: ItemInstance | null; armor?: ItemInstance | null };
  if (!save.equipment) {
    save.equipment = {};
    if (legacy.weapon) save.equipment.mainhand = legacy.weapon;
    if (legacy.armor) save.equipment.chest = legacy.armor;
  }
  for (const slot of Object.keys(save.equipment)) {
    save.equipment[slot] = fixAffixes(save.equipment[slot] ?? null);
  }
  return save;
}

/** Insert or update the character save for a token. */
export function storeSave(db: GameDatabase, token: string, save: PlayerSave): void {
  db.prepare(
    `INSERT INTO player_saves (token, name, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       name = excluded.name, data = excluded.data, updated_at = excluded.updated_at`,
  ).run(token, save.name, JSON.stringify(save), new Date().toISOString());
}

// --- Friends persistence (the durable side of the social system) ----------------------
// Friends are stored per owner token as friend display-names. The SocialRegistry resolves live
// presence at runtime; the DB only remembers who is on whose list. All params are bound, never
// interpolated.

/** Friend display-names on a player's list (empty if none). */
export function loadFriends(db: GameDatabase, token: string): string[] {
  const rows = db
    .prepare('SELECT friend_name FROM friends WHERE owner_token = ? ORDER BY friend_name')
    .all(token) as { friend_name: string }[];
  return rows.map((r) => r.friend_name);
}

/** Add a friend (idempotent — the PK prevents duplicates). */
export function addFriend(db: GameDatabase, token: string, name: string): void {
  db.prepare('INSERT OR IGNORE INTO friends (owner_token, friend_name) VALUES (?, ?)').run(
    token,
    name,
  );
}

/** Remove a friend by name (case-insensitive match on the stored name). */
export function removeFriend(db: GameDatabase, token: string, name: string): void {
  db.prepare('DELETE FROM friends WHERE owner_token = ? AND friend_name = ? COLLATE NOCASE').run(
    token,
    name,
  );
}

// --- Guild persistence (durable roster + ranks for the GuildRegistry) ------------------
// A guild is one `guilds` row; each member is one `guild_members` row keyed by owner_token (so a
// player is in at most one guild). All params are bound. The GuildRegistry holds the live logic;
// these are the dumb persistence primitives it injects.

/** One persisted guild member (identity token + display name + rank). */
export interface GuildMemberRow {
  token: string;
  name: string;
  rank: string;
}

/** Create a guild and return its new id, or null if the name is already taken (UNIQUE NOCASE). */
export function createGuildRow(db: GameDatabase, name: string): number | null {
  try {
    const info = db.prepare('INSERT INTO guilds (name) VALUES (?)').run(name);
    return Number(info.lastInsertRowid);
  } catch {
    return null; // UNIQUE violation — name taken
  }
}

/** Delete a guild and all its membership rows (called when the last member leaves / it disbands). */
export function deleteGuildRow(db: GameDatabase, guildId: number): void {
  db.prepare('DELETE FROM guild_members WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM guilds WHERE id = ?').run(guildId);
}

/** A guild's display name by id, or undefined. */
export function guildName(db: GameDatabase, guildId: number): string | undefined {
  const row = db.prepare('SELECT name FROM guilds WHERE id = ?').get(guildId) as
    | { name: string }
    | undefined;
  return row?.name;
}

/** The guild membership for a player by token, or undefined if guildless. */
export function guildOf(
  db: GameDatabase,
  token: string,
): { guildId: number; rank: string } | undefined {
  const row = db
    .prepare('SELECT guild_id, rank FROM guild_members WHERE owner_token = ?')
    .get(token) as { guild_id: number; rank: string } | undefined;
  return row ? { guildId: row.guild_id, rank: row.rank } : undefined;
}

/** All members of a guild (token + name + rank), leader/officer/member order then name. */
export function guildMembers(db: GameDatabase, guildId: number): GuildMemberRow[] {
  return db
    .prepare(
      `SELECT owner_token AS token, name, rank FROM guild_members WHERE guild_id = ?
       ORDER BY CASE rank WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, name COLLATE NOCASE`,
    )
    .all(guildId) as GuildMemberRow[];
}

/** Add (or re-add, refreshing name/rank) a member to a guild. */
export function addGuildMemberRow(
  db: GameDatabase,
  guildId: number,
  token: string,
  name: string,
  rank: string,
): void {
  db.prepare(
    `INSERT INTO guild_members (owner_token, guild_id, name, rank) VALUES (?, ?, ?, ?)
     ON CONFLICT(owner_token) DO UPDATE SET guild_id = excluded.guild_id,
       name = excluded.name, rank = excluded.rank`,
  ).run(token, guildId, name, rank);
}

/** Remove a player from their guild (by token). */
export function removeGuildMemberRow(db: GameDatabase, token: string): void {
  db.prepare('DELETE FROM guild_members WHERE owner_token = ?').run(token);
}

/** Set a member's rank (by token). */
export function setGuildRankRow(db: GameDatabase, token: string, rank: string): void {
  db.prepare('UPDATE guild_members SET rank = ? WHERE owner_token = ?').run(rank, token);
}

// --- Mail persistence (deferred gold/item delivery; also the auction delivery channel) -----
// One row per piece of mail, addressed by the recipient's owner token. Collecting deletes the row.
// item_json is a serialized ItemInstance (or NULL for gold-only). All params bound.

/** One inbox entry. `itemJson` is the serialized ItemInstance, or null for gold-only mail. */
export interface MailRow {
  id: number;
  senderName: string;
  gold: number;
  itemJson: string | null;
  subject: string;
}

/** The most-recent owner token saved under a (case-insensitive) character name, or null. */
export function tokenForName(db: GameDatabase, name: string): string | null {
  // ONLY resolve when exactly one save holds the name. Display names are client-chosen and not
  // unique, so picking "most-recent" would let a name-squatter divert mailed gold/items meant for an
  // offline player (SEC-001). Ambiguous or unknown → null; callers prefer a live presence token.
  const rows = db
    .prepare('SELECT token FROM player_saves WHERE name = ? COLLATE NOCASE')
    .all(name.trim()) as { token: string }[];
  return rows.length === 1 ? rows[0]!.token : null;
}

/** Send mail (insert an inbox row for the recipient). */
export function sendMail(
  db: GameDatabase,
  recipientToken: string,
  senderName: string,
  gold: number,
  itemJson: string | null,
  subject = '',
): void {
  db.prepare(
    'INSERT INTO mail (recipient_token, sender_name, gold, item_json, subject) VALUES (?, ?, ?, ?, ?)',
  ).run(recipientToken, senderName, gold, itemJson, subject);
}

/** All inbox entries for a token (oldest first). */
export function loadMail(db: GameDatabase, token: string): MailRow[] {
  return (
    db
      .prepare(
        'SELECT id, sender_name AS senderName, gold, item_json AS itemJson, subject FROM mail WHERE recipient_token = ? ORDER BY id',
      )
      .all(token) as MailRow[]
  ).map((r) => ({ ...r, itemJson: r.itemJson ?? null }));
}

/** One inbox entry by id, scoped to the recipient token (so a client can't claim others' mail). */
export function getMail(db: GameDatabase, id: number, token: string): MailRow | undefined {
  const r = db
    .prepare(
      'SELECT id, sender_name AS senderName, gold, item_json AS itemJson, subject FROM mail WHERE id = ? AND recipient_token = ?',
    )
    .get(id, token) as MailRow | undefined;
  return r ? { ...r, itemJson: r.itemJson ?? null } : undefined;
}

/** How many inbox entries a token holds (for the per-recipient cap). */
export function mailCount(db: GameDatabase, token: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM mail WHERE recipient_token = ?').get(token) as {
      n: number;
    }
  ).n;
}

/** Delete a piece of mail (after its contents are delivered). */
export function deleteMail(db: GameDatabase, id: number): void {
  db.prepare('DELETE FROM mail WHERE id = ?').run(id);
}

// --- Auction house persistence (player-to-player buyout market) ------------------------------
// One row per listing: a gear instance held in escrow + a buyout price. The host orchestrates the
// gold/item moves (reusing the World inventory + mail), these are the dumb row primitives.

/** The house cut on a sale — the gold sink. The seller receives the rest. */
export const AUCTION_CUT = 0.05;
/** Most concurrent listings one seller may hold. */
export const MAX_AUCTIONS_PER_SELLER = 10;

/** Gold the seller nets from a sale at `price` after the house cut (floored). */
export function auctionPayout(price: number): number {
  return Math.max(0, Math.floor(price * (1 - AUCTION_CUT)));
}

/** One active listing. `itemJson` is the serialized ItemInstance in escrow. */
export interface AuctionRow {
  id: number;
  sellerToken: string;
  sellerName: string;
  itemJson: string;
  price: number;
}

/** List a gear instance for sale; returns the new listing id. */
export function createAuction(
  db: GameDatabase,
  sellerToken: string,
  sellerName: string,
  itemJson: string,
  price: number,
): number {
  const info = db
    .prepare(
      'INSERT INTO auctions (seller_token, seller_name, item_json, price) VALUES (?, ?, ?, ?)',
    )
    .run(sellerToken, sellerName, itemJson, price);
  return Number(info.lastInsertRowid);
}

/** All active listings (oldest first), for the browse view. */
export function loadAuctions(db: GameDatabase): AuctionRow[] {
  return db
    .prepare(
      'SELECT id, seller_token AS sellerToken, seller_name AS sellerName, item_json AS itemJson, price FROM auctions ORDER BY id',
    )
    .all() as AuctionRow[];
}

/** One listing by id, or undefined. */
export function getAuction(db: GameDatabase, id: number): AuctionRow | undefined {
  return db
    .prepare(
      'SELECT id, seller_token AS sellerToken, seller_name AS sellerName, item_json AS itemJson, price FROM auctions WHERE id = ?',
    )
    .get(id) as AuctionRow | undefined;
}

/** A seller's own active listings. */
export function auctionsBySeller(db: GameDatabase, token: string): AuctionRow[] {
  return db
    .prepare(
      'SELECT id, seller_token AS sellerToken, seller_name AS sellerName, item_json AS itemJson, price FROM auctions WHERE seller_token = ? ORDER BY id',
    )
    .all(token) as AuctionRow[];
}

/** How many active listings a seller holds (for the cap). */
export function auctionCountBySeller(db: GameDatabase, token: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM auctions WHERE seller_token = ?').get(token) as {
      n: number;
    }
  ).n;
}

/** Remove a listing (after sale or cancellation). */
export function deleteAuction(db: GameDatabase, id: number): void {
  db.prepare('DELETE FROM auctions WHERE id = ?').run(id);
}
