import { rollDropTable, type DropTable } from './drop-table.js';

/**
 * Loot: RuneScape-flavored drop tables for monsters, built on the generic weighted
 * drop-table engine (drop-table.ts) — a guaranteed gold drop, one weighted "main" roll, and
 * an optional nested rare sub-table for ultra-rares. Pure given an injected RNG; the World
 * rolls loot on a mob death and spawns the resulting stacks.
 */

/** A droppable item type. Keep ids short and lowercase. */
export type ItemId = 'gold' | 'wolf_pelt' | 'bone' | 'bat_wing' | 'rune_shard';

/** A stack of items produced by a drop roll. */
export interface ItemStack {
  item: ItemId;
  qty: number;
}

/** Loot tables keyed by monster template id (from src/server/mobs.ts). */
export const LOOT_TABLES: Record<string, DropTable<ItemId>> = {
  wolf: {
    always: [{ value: 'gold', weight: 1, min: 3, max: 12 }],
    main: [
      { value: 'wolf_pelt', weight: 60, min: 1, max: 2 },
      { value: 'gold', weight: 40, nothing: true },
    ],
  },
  skeleton: {
    always: [{ value: 'gold', weight: 1, min: 5, max: 20 }],
    main: [
      { value: 'bone', weight: 70, min: 1, max: 3 },
      { value: 'gold', weight: 30, nothing: true },
    ],
    rare: { chance: 0.05, table: [{ value: 'rune_shard', weight: 1, min: 1, max: 1 }] },
  },
  bat: {
    always: [{ value: 'gold', weight: 1, min: 1, max: 6 }],
    main: [
      { value: 'bat_wing', weight: 50, min: 1, max: 2 },
      { value: 'gold', weight: 50, nothing: true },
    ],
  },
};

/** Roll a monster's drops. Deterministic given `rng`. Unknown template id yields no loot. */
export function rollLoot(templateId: string, rng: () => number = Math.random): ItemStack[] {
  const table = LOOT_TABLES[templateId];
  if (!table) return [];
  return rollDropTable(table, rng).map((drop) => ({ item: drop.value, qty: drop.qty }));
}
