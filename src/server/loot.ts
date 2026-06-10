import { rollDropTable, type DropTable } from './drop-table.js';

/**
 * Loot: RuneScape-flavored drop tables for monsters, built on the generic weighted
 * drop-table engine (drop-table.ts) — a guaranteed gold drop, one weighted "main" roll, and
 * an optional nested rare sub-table for ultra-rares. Pure given an injected RNG; the World
 * rolls loot on a mob death and spawns the resulting stacks.
 */

/** A droppable item type. Keep ids short and lowercase. */
export type ItemId =
  | 'gold'
  | 'wolf_pelt'
  | 'bone'
  | 'bat_wing'
  | 'rune_shard'
  | 'venom_gland' // Rotfen Marsh
  | 'ember_ore' // Emberdeep Mines
  | 'frost_core'; // Frostpeak Pass

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

  // --- Rotfen Marsh (L8–12) ---
  marsh_leech: {
    always: [{ value: 'gold', weight: 1, min: 6, max: 18 }],
    main: [
      { value: 'venom_gland', weight: 55, min: 1, max: 2 },
      { value: 'gold', weight: 45, nothing: true },
    ],
  },
  bog_shambler: {
    always: [{ value: 'gold', weight: 1, min: 12, max: 30 }],
    main: [
      { value: 'venom_gland', weight: 60, min: 1, max: 3 },
      { value: 'gold', weight: 40, nothing: true },
    ],
    rare: { chance: 0.06, table: [{ value: 'rune_shard', weight: 1, min: 1, max: 1 }] },
  },
  mire_spitter: {
    always: [{ value: 'gold', weight: 1, min: 10, max: 24 }],
    main: [
      { value: 'venom_gland', weight: 65, min: 1, max: 2 },
      { value: 'gold', weight: 35, nothing: true },
    ],
  },
  fen_strangler: {
    always: [{ value: 'gold', weight: 1, min: 16, max: 36 }],
    main: [
      { value: 'venom_gland', weight: 50, min: 1, max: 3 },
      { value: 'gold', weight: 50, nothing: true },
    ],
    rare: { chance: 0.08, table: [{ value: 'rune_shard', weight: 1, min: 1, max: 1 }] },
  },

  // --- Emberdeep Mines (L12–16) ---
  cinder_imp: {
    always: [{ value: 'gold', weight: 1, min: 10, max: 26 }],
    main: [
      { value: 'ember_ore', weight: 55, min: 1, max: 2 },
      { value: 'gold', weight: 45, nothing: true },
    ],
  },
  magma_crawler: {
    always: [{ value: 'gold', weight: 1, min: 18, max: 40 }],
    main: [
      { value: 'ember_ore', weight: 60, min: 1, max: 3 },
      { value: 'gold', weight: 40, nothing: true },
    ],
    rare: { chance: 0.08, table: [{ value: 'rune_shard', weight: 1, min: 1, max: 2 }] },
  },
  deep_cultist: {
    always: [{ value: 'gold', weight: 1, min: 14, max: 32 }],
    main: [
      { value: 'ember_ore', weight: 55, min: 1, max: 2 },
      { value: 'gold', weight: 45, nothing: true },
    ],
  },

  // --- Frostpeak Pass (L15–20) ---
  frost_wolf: {
    always: [{ value: 'gold', weight: 1, min: 16, max: 34 }],
    main: [
      { value: 'frost_core', weight: 50, min: 1, max: 2 },
      { value: 'gold', weight: 50, nothing: true },
    ],
  },
  rime_archer: {
    always: [{ value: 'gold', weight: 1, min: 18, max: 38 }],
    main: [
      { value: 'frost_core', weight: 55, min: 1, max: 2 },
      { value: 'gold', weight: 45, nothing: true },
    ],
  },
  avalanche_shade: {
    always: [{ value: 'gold', weight: 1, min: 22, max: 46 }],
    main: [
      { value: 'frost_core', weight: 55, min: 1, max: 3 },
      { value: 'gold', weight: 45, nothing: true },
    ],
    rare: { chance: 0.1, table: [{ value: 'rune_shard', weight: 1, min: 1, max: 2 }] },
  },
  tundra_behemoth: {
    always: [{ value: 'gold', weight: 1, min: 28, max: 60 }],
    main: [
      { value: 'frost_core', weight: 60, min: 2, max: 4 },
      { value: 'gold', weight: 40, nothing: true },
    ],
    rare: { chance: 0.12, table: [{ value: 'rune_shard', weight: 1, min: 1, max: 3 }] },
  },
};

/** Roll a monster's drops. Deterministic given `rng`. Unknown template id yields no loot. */
export function rollLoot(templateId: string, rng: () => number = Math.random): ItemStack[] {
  const table = LOOT_TABLES[templateId];
  if (!table) return [];
  return rollDropTable(table, rng).map((drop) => ({ item: drop.value, qty: drop.qty }));
}
