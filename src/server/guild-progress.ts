import { getDb } from './content.js';

/**
 * Guild progression — a guild earns XP from the kills its members score, climbing GUILD LEVELS that
 * grant roster-wide perks (currently: a larger guild bank). Backed by the content DB (`getDb()`), one
 * row per guild in `guild_progress`; every parameter bound. Pure-ish: this module only reads/writes
 * its own table. The host (index.ts) feeds it kills via the World kill hook and reads the level for
 * perks/roster display.
 */

/** Member-kill XP (≈ summed killed-mob levels) needed per guild level. */
export const GUILD_XP_PER_LEVEL = 500;
/** Guild levels are capped here (keeps perks bounded). */
export const GUILD_MAX_LEVEL = 20;
/** Bonus guild-bank item slots granted per guild level above 1. */
export const GUILD_BANK_SLOTS_PER_LEVEL = 5;

/** The guild level for a given lifetime XP total (1-based, clamped to GUILD_MAX_LEVEL). */
export function guildLevelForXp(xp: number): number {
  if (xp <= 0) return 1;
  return Math.min(GUILD_MAX_LEVEL, 1 + Math.floor(xp / GUILD_XP_PER_LEVEL));
}

/** A guild's lifetime XP (0 if it has no row yet). */
export function guildXp(guildId: number): number {
  const row = getDb().prepare('SELECT xp FROM guild_progress WHERE guild_id = ?').get(guildId) as
    | { xp: number }
    | undefined;
  return row?.xp ?? 0;
}

/** A guild's current level (derived from its XP). */
export function guildLevel(guildId: number): number {
  return guildLevelForXp(guildXp(guildId));
}

/**
 * Add `amount` XP to a guild (UPSERT; non-positive is a no-op). Returns the level before and after so
 * the caller can announce a level-up. XP keeps accumulating past max level (the level just clamps).
 */
export function addGuildXp(guildId: number, amount: number): { before: number; after: number } {
  const before = guildLevel(guildId);
  if (amount <= 0) return { before, after: before };
  getDb()
    .prepare(
      `INSERT INTO guild_progress (guild_id, xp) VALUES (?, ?)
         ON CONFLICT(guild_id) DO UPDATE SET xp = xp + excluded.xp`,
    )
    .run(guildId, amount);
  return { before, after: guildLevel(guildId) };
}

/** XP into the current level, and the span of this level — for a "1234/5000 to level N" readout. */
export function guildLevelProgress(guildId: number): { into: number; span: number; level: number } {
  const level = guildLevel(guildId);
  if (level >= GUILD_MAX_LEVEL) return { into: 0, span: 0, level };
  const xp = guildXp(guildId);
  return { into: xp - (level - 1) * GUILD_XP_PER_LEVEL, span: GUILD_XP_PER_LEVEL, level };
}

/** Delete a disbanded guild's progression row. The host calls this on disband (with clearBank). */
export function clearGuildProgress(guildId: number): void {
  getDb().prepare('DELETE FROM guild_progress WHERE guild_id = ?').run(guildId);
}
