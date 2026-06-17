import { getDb } from './content.js';
import type { ItemInstance } from '../shared/items.js';
import type { GuildRank } from './guild.js';

/**
 * Guild bank persistence + policy — a shared gold + item vault per guild. Backed by the content DB
 * (`getDb()`), with every parameter bound. Pure-ish: this module only reads/writes its two tables
 * (`guild_bank`, `guild_bank_items`); it never moves gold/gear into or out of a *player* — the host
 * (index.ts) handles custody (it takes gold/gear from the player before depositing here, and credits
 * the player after a successful withdraw/take).
 *
 * Policy (anti-grief): any member may DEPOSIT, but only officers/leader may WITHDRAW, so a rogue new
 * member cannot drain the vault. Item rows are scoped to their guild on take, so a member cannot pull
 * another guild's item by guessing a row id.
 */

/** Largest number of distinct item stacks a guild bank can hold. */
export const MAX_BANK_ITEMS = 100;

// --- Gold -----------------------------------------------------------------------------------------

/** Current banked gold for a guild (0 if it has no row yet). */
export function bankGold(guildId: number): number {
  const row = getDb().prepare('SELECT gold FROM guild_bank WHERE guild_id = ?').get(guildId) as
    | { gold: number }
    | undefined;
  return row?.gold ?? 0;
}

/**
 * Add `amount` gold to the guild's vault (UPSERT). The amount is assumed already taken from the
 * depositing player by the host. A non-positive amount is a no-op (clamped).
 */
export function depositGold(guildId: number, amount: number): void {
  if (amount <= 0) return;
  getDb()
    .prepare(
      `INSERT INTO guild_bank (guild_id, gold) VALUES (?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET gold = gold + excluded.gold`,
    )
    .run(guildId, amount);
}

/**
 * Withdraw `amount` gold from the vault. Returns false (no change) if the amount is non-positive or
 * the vault holds less than requested; otherwise subtracts it and returns true (the host then credits
 * the player).
 */
export function withdrawGold(guildId: number, amount: number): boolean {
  if (amount <= 0) return false;
  if (bankGold(guildId) < amount) return false;
  getDb().prepare('UPDATE guild_bank SET gold = gold - ? WHERE guild_id = ?').run(amount, guildId);
  return true;
}

// --- Items ----------------------------------------------------------------------------------------

/** Parse a stored item_json string into an ItemInstance, or null if corrupt. */
function parseItem(json: string): ItemInstance | null {
  try {
    return JSON.parse(json) as ItemInstance;
  } catch {
    return null;
  }
}

/** All banked items for a guild (corrupt rows skipped). Order is insertion order (row id). */
export function bankItems(guildId: number): ItemInstance[] {
  return bankItemsWithIds(guildId).map((e) => e.item);
}

/**
 * Banked items paired with their row ids — what the UI/host needs so a player can pick a specific
 * stack to withdraw. Corrupt rows are skipped.
 */
export function bankItemsWithIds(guildId: number): { id: number; item: ItemInstance }[] {
  const rows = getDb()
    .prepare('SELECT id, item_json FROM guild_bank_items WHERE guild_id = ? ORDER BY id')
    .all(guildId) as { id: number; item_json: string }[];
  const out: { id: number; item: ItemInstance }[] = [];
  for (const r of rows) {
    const item = parseItem(r.item_json);
    if (item) out.push({ id: r.id, item });
  }
  return out;
}

/** How many item rows a guild bank currently holds (includes any corrupt rows for the cap check). */
export function bankItemCount(guildId: number): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM guild_bank_items WHERE guild_id = ?')
    .get(guildId) as { n: number };
  return row.n;
}

/**
 * Add an item to the vault (the host removed it from the depositing player's bag first). Returns
 * false if the vault is already at {@link MAX_BANK_ITEMS}; otherwise inserts the serialized instance.
 */
export function addBankItem(guildId: number, item: ItemInstance): boolean {
  if (bankItemCount(guildId) >= MAX_BANK_ITEMS) return false;
  getDb()
    .prepare('INSERT INTO guild_bank_items (guild_id, item_json) VALUES (?, ?)')
    .run(guildId, JSON.stringify(item));
  return true;
}

/**
 * Fetch + delete one item row, scoped to `guildId` (so a member cannot take another guild's item by
 * id). Returns the parsed instance the host then grants the player, or null if the row is absent (or
 * not owned by this guild, or corrupt). The row is only deleted when it belonged to the guild.
 */
export function takeBankItem(guildId: number, rowId: number): ItemInstance | null {
  const db = getDb();
  const row = db
    .prepare('SELECT item_json FROM guild_bank_items WHERE id = ? AND guild_id = ?')
    .get(rowId, guildId) as { item_json: string } | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM guild_bank_items WHERE id = ? AND guild_id = ?').run(rowId, guildId);
  return parseItem(row.item_json);
}

// --- Policy ---------------------------------------------------------------------------------------

/** Anyone in the guild may deposit. */
export function canDeposit(_rank: GuildRank): boolean {
  return true;
}

/** Only the leader and officers may withdraw (members deposit but cannot drain — anti-grief). */
export function canWithdraw(rank: GuildRank): boolean {
  return rank === 'leader' || rank === 'officer';
}

// --- Lifecycle ------------------------------------------------------------------------------------

/** Delete a disbanded guild's bank rows (both gold and items). The host calls this on disband. */
export function clearBank(guildId: number): void {
  const db = getDb();
  db.prepare('DELETE FROM guild_bank_items WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM guild_bank WHERE guild_id = ?').run(guildId);
}
