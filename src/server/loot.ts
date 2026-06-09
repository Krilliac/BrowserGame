/**
 * Loot: RuneScape-flavored drop tables for monsters. Each monster template owns a table of
 * rows; rolling a drop is a pure function of an injected RNG so it's deterministic and
 * unit-tested (loot.test.ts). The World rolls loot on a mob death and spawns the stacks.
 */

/** A droppable item type. Keep ids short and lowercase. */
export type ItemId = 'gold' | 'wolf_pelt' | 'bone' | 'bat_wing' | 'rune_shard';

/** A stack of items produced by a drop roll. */
export interface ItemStack {
  item: ItemId;
  qty: number;
}

/** One row of a monster's loot table. */
export interface LootEntry {
  item: ItemId;
  chance: number; // 0..1 probability this row drops
  min: number; // inclusive min quantity when it drops
  max: number; // inclusive max quantity when it drops
}

/**
 * Loot tables keyed by monster template id (from src/server/mobs.ts). Every monster has a
 * high-chance gold drop plus a thematic material; the skeleton hides a rare rune_shard.
 */
export const LOOT_TABLES: Record<string, LootEntry[]> = {
  wolf: [
    { item: 'gold', chance: 0.9, min: 3, max: 12 },
    { item: 'wolf_pelt', chance: 0.6, min: 1, max: 2 },
  ],
  skeleton: [
    { item: 'gold', chance: 0.85, min: 5, max: 20 },
    { item: 'bone', chance: 0.7, min: 1, max: 3 },
    { item: 'rune_shard', chance: 0.05, min: 1, max: 1 },
  ],
  bat: [
    { item: 'gold', chance: 0.8, min: 1, max: 6 },
    { item: 'bat_wing', chance: 0.5, min: 1, max: 2 },
  ],
};

/**
 * Roll a monster's drops. Deterministic given `rng`. For each table row, draw once to decide
 * whether it drops, then (if it does) draw again for the quantity in [min, max]. Duplicate
 * item ids are merged into a single stack and non-positive quantities are skipped. An unknown
 * template id yields no loot (no throw).
 */
export function rollLoot(templateId: string, rng: () => number = Math.random): ItemStack[] {
  const table = LOOT_TABLES[templateId] ?? [];
  const byItem = new Map<ItemId, number>();

  for (const entry of table) {
    if (rng() >= entry.chance) continue;
    const span = entry.max - entry.min + 1;
    const qty = entry.min + Math.floor(rng() * span);
    if (qty <= 0) continue;
    byItem.set(entry.item, (byItem.get(entry.item) ?? 0) + qty);
  }

  return [...byItem].map(([item, qty]) => ({ item, qty }));
}
