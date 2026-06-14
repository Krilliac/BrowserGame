/**
 * Gambling vendor (a Diablo III "Kadala"-style gold sink): spend gold to roll a RANDOM item of a
 * chosen equipment slot. Unlike the floor-filling shop (always common), gambling rolls a normal
 * instance — so it can hit rare/epic/legendary just like a monster drop. That jackpot chance is
 * the whole appeal, and the level-scaling cost makes it a forever-relevant way to burn surplus gold.
 *
 * Pure by construction: the only randomness is the injected `rng` (defaulting to `Math.random`), so
 * the server can drive it deterministically and these functions are unit-tested. Networking and the
 * authoritative gold check live in the world/server, which calls these.
 */

import type { ItemSlot } from './equipment.js';
import { rollItemInstance, type BaseItem, type ItemInstance } from './items.js';

/** Gold per gamble pull, scaling with character level — a forever-scaling gold sink. */
export function gambleCost(level: number): number {
  return 50 + 30 * Math.max(1, Math.floor(level));
}

/**
 * The gamble pool is supplied by the caller (the server, from the content DB) rather than read from
 * a hardcoded const, so legendaries/gear stay database-driven. These helpers just filter + roll over
 * whatever equip bases they are given.
 */

/** True if `slot` has at least one base item to gamble for in the supplied pool. */
export function isGambleSlot(slot: string, bases: readonly BaseItem[]): boolean {
  return bases.some((b) => b.slot === slot);
}

/**
 * Roll a random gambled item for the given equip slot: pick a random base from `bases` whose `slot`
 * matches, then roll a normal instance (random rarity via {@link rollItemInstance} — gambling can
 * hit rare/epic just like a drop). Returns null if no base matches. `uid` is the unique id to
 * assign; `rng` is injected for determinism.
 */
export function rollGamble(
  uid: number,
  slot: string,
  bases: readonly BaseItem[],
  rng: () => number = Math.random,
): ItemInstance | null {
  const pool = bases.filter((b) => b.slot === slot);
  if (pool.length === 0) return null;
  const base = pool[Math.floor(rng() * pool.length)]!;
  return rollItemInstance(uid, base, rng);
}

/** Re-export for callers that want the slot type. */
export type { ItemSlot };
