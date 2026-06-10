import type { ItemId } from './loot.js';

/**
 * Town vendor: a pure pricing module for selling loot back to a shopkeeper. The vendor pays a
 * fixed amount of gold per unit of each sellable item; ids not listed are unsellable. 'gold'
 * itself is currency, never sold. Deterministic and free of I/O — the World calls sellAll to
 * compute the payout and the map of stacks to remove from a player's bag.
 */

/** Gold a vendor pays for one unit of each sellable item. Items not listed are unsellable. */
export const SELL_VALUES: Record<string, number> = {
  wolf_pelt: 6,
  bone: 2,
  bat_wing: 4,
  rune_shard: 250,
  venom_gland: 9, // Rotfen Marsh
  ember_ore: 14, // Emberdeep Mines
  frost_core: 22, // Frostpeak Pass
} satisfies Partial<Record<ItemId, number>>;

/** Total gold for selling an entire loot bag, plus the list of items actually sold. */
export interface SellResult {
  gold: number;
  sold: Record<string, number>;
}

/** Gold value of a single item id (0 if unsellable). */
export function sellValue(itemId: string): number {
  return SELL_VALUES[itemId] ?? 0;
}

/**
 * Total gold for selling an entire loot bag. Sums quantity * sellValue over sellable items with
 * a positive quantity; unsellable items, 'gold', and non-positive stacks are ignored. Returns the
 * payout and the map of items actually sold so the caller can remove exactly those from the bag.
 */
export function sellAll(loot: Record<string, number>): SellResult {
  let gold = 0;
  const sold: Record<string, number> = {};
  for (const [itemId, qty] of Object.entries(loot)) {
    if (qty <= 0) continue;
    const value = sellValue(itemId);
    if (value <= 0) continue;
    gold += value * qty;
    sold[itemId] = qty;
  }
  return { gold, sold };
}
