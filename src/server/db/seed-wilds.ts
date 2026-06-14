/**
 * Wilds bestiary seed data: where the new wildlife/vermin monsters (the templates tagged
 * "Wilds bestiary" in src/server/mobs.ts) spawn and what they drop. Pure data — the seed
 * orchestrator (seed.ts) consumes these via the same idempotent upsert paths it uses for
 * the expansion's area_mobs / loot_entry content (ensureWildsContent).
 *
 * These creatures fill ecological gaps across the existing overworld zones rather than
 * adding new areas: a spider + satyr in Gloomwood, tomb rats in the crypt, a marsh
 * serpent, a mine ant, a frostpeak cockatrice, and a void-bloated worm in the Wastes.
 *
 * Loot follows the established loot_entry shape (see seedLoot in seed.ts and
 * src/server/drop-table.ts): an 'always' gold row, a weighted 'main' roll where the
 * is_nothing row is the blank, an optional 'rare' material row gated by `chance`, and
 * 'gear' rows where `chance` triggers one uniform pick from the group. Materials match
 * each mob's home zone (bone/pelt in Gloomwood & the crypt, venom_gland in the marsh,
 * ember_ore in the mines, frost_core on Frostpeak, rune_shards in the Wastes).
 */

/** Overworld spawn rosters for the wilds monsters (areas from src/shared/areas.ts). */
export const WILDS_AREA_MOBS: { areaId: string; templateId: string; count: number }[] = [
  // Gloomwood Wilderness (L2-5)
  { areaId: 'wilderness', templateId: 'gloomweb_spider', count: 4 },
  { areaId: 'wilderness', templateId: 'bramble_satyr', count: 2 },
  // Shadow Crypt (L5-7)
  { areaId: 'crypt', templateId: 'tomb_rat', count: 5 },
  // Rotfen Marsh (L8-12)
  { areaId: 'marsh', templateId: 'mire_serpent', count: 3 },
  // Emberdeep Mines (L12-16)
  { areaId: 'mines', templateId: 'cinder_ant', count: 4 },
  // Frostpeak Pass (L15-20)
  { areaId: 'frostpeak', templateId: 'wyrmcrag_cockatrice', count: 2 },
  // The Sundered Wastes (L20-26)
  { areaId: 'sundered_wastes', templateId: 'sundered_worm', count: 3 },
];

export interface WildsLootRow {
  mobTemplateId: string;
  grp: string;
  itemId: string;
  weight: number;
  minQty: number;
  maxQty: number;
  isNothing: 0 | 1;
  chance: number;
}

/**
 * Build one mob's loot_entry rows: a guaranteed gold pile, a weighted main roll of a zone
 * material vs nothing, an optional rare double-material roll, and an optional gear group
 * (chance triggers one uniform pick). Mirrors the hand-written tables in seed-acts.ts.
 */
function loot(
  mobTemplateId: string,
  gold: [number, number],
  main: { itemId: string; weight: number; min?: number; max?: number; rare?: number },
  gear?: { chance: number; items: string[] },
): WildsLootRow[] {
  const rows: WildsLootRow[] = [
    {
      mobTemplateId,
      grp: 'always',
      itemId: 'gold',
      weight: 1,
      minQty: gold[0],
      maxQty: gold[1],
      isNothing: 0,
      chance: 0,
    },
    {
      mobTemplateId,
      grp: 'main',
      itemId: main.itemId,
      weight: main.weight,
      minQty: main.min ?? 1,
      maxQty: main.max ?? 1,
      isNothing: 0,
      chance: 0,
    },
    {
      mobTemplateId,
      grp: 'main',
      itemId: 'gold',
      weight: 100 - main.weight,
      minQty: 1,
      maxQty: 1,
      isNothing: 1,
      chance: 0,
    },
  ];
  if (main.rare !== undefined) {
    rows.push({
      mobTemplateId,
      grp: 'rare',
      itemId: main.itemId,
      weight: 1,
      minQty: 1,
      maxQty: 2,
      isNothing: 0,
      chance: main.rare,
    });
  }
  for (const itemId of gear?.items ?? []) {
    rows.push({
      mobTemplateId,
      grp: 'gear',
      itemId,
      weight: 1,
      minQty: 1,
      maxQty: 1,
      isNothing: 0,
      chance: gear!.chance,
    });
  }
  return rows;
}

/**
 * loot_entry rows for the wilds bestiary. Item ids are all pre-existing content (materials
 * from seed.ts MATERIALS, equipment from src/shared/equipment.ts); gold ranges and weights
 * are tuned against same-level neighbours in src/server/loot.ts.
 */
export const WILDS_LOOT: WildsLootRow[] = [
  // --- Gloomwood (L2-5): bat/wolf-tier pocket change, the odd bone/pelt, starter gear. ---
  ...loot('gloomweb_spider', [2, 8], { itemId: 'bone', weight: 50 }),
  ...loot(
    'bramble_satyr',
    [3, 10],
    { itemId: 'wolf_pelt', weight: 55 },
    { chance: 0.25, items: ['rusty_sword', 'leather_armor'] },
  ),
  // --- Shadow Crypt (L5-7): skeleton-tier coins and bones. ---
  ...loot('tomb_rat', [2, 8], { itemId: 'bone', weight: 50 }),
  // --- Rotfen Marsh (L8-12): venom glands, the rare extra harvest. ---
  ...loot('mire_serpent', [8, 18], { itemId: 'venom_gland', weight: 55, rare: 0.1 }),
  // --- Emberdeep Mines (L12-16): ember ore plus a steel helm now and then. ---
  ...loot(
    'cinder_ant',
    [12, 26],
    { itemId: 'ember_ore', weight: 55 },
    { chance: 0.2, items: ['steel_helm'] },
  ),
  // --- Frostpeak Pass (L15-20): frost cores, rare extras, and steel gear. ---
  ...loot(
    'wyrmcrag_cockatrice',
    [16, 34],
    { itemId: 'frost_core', weight: 55, rare: 0.12 },
    { chance: 0.25, items: ['steel_sword', 'steel_armor'] },
  ),
  // --- The Sundered Wastes (L20-26): the gold-and-shards economy, with mithril gear. ---
  ...loot(
    'sundered_worm',
    [40, 90],
    { itemId: 'rune_shard', weight: 35, min: 1, max: 2 },
    { chance: 0.25, items: ['mithril_armor'] },
  ),
];
