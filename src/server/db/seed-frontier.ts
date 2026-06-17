/**
 * Frontier expansion seed data: Duskhaven (the frontier village off Frostpeak — a second
 * rest point far from town) and the Abyssal Throne (the endgame dungeon beneath the
 * Blighted Spire). Pure data — the seed orchestrator (seed.ts) consumes these via the same
 * idempotent upsert paths it uses for the other npcs / decor / loot_entry / quests content.
 *
 * The areas, themes, and the Throne's DUNGEONS population live in src/shared/areas.ts; the
 * monster templates live in src/server/mobs.ts. Placement rules mirror seed-decor.ts and
 * are enforced by seed-frontier.test.ts.
 */

import type { DecorRow } from './seed-decor.js';

export interface NpcRow {
  areaId: string;
  name: string;
  x: number;
  y: number;
  hue: number;
  kind: string;
}

/** loot_entry-shaped rows (see seedLoot in seed.ts and src/server/drop-table.ts). */
export interface LootRow {
  mobTemplateId: string;
  grp: string;
  itemId: string;
  weight: number;
  minQty: number;
  maxQty: number;
  isNothing: 0 | 1;
  chance: number;
}

/** quests-table-shaped rows (see QUESTS + seedQuests in seed.ts). */
export interface QuestRow {
  id: string;
  name: string;
  description: string;
  targetMob: string | null;
  targetCount: number;
  rewardGold: number;
  rewardXp: number;
  rewardItem: string | null;
  turnInItem?: string;
  turnInCount?: number;
  /** Explore quests: the area id the player must discover to complete it. */
  exploreArea?: string;
  /** Chain quests: a prerequisite quest id that must be completed before this one unlocks. */
  requires?: string;
}

/**
 * Duskhaven's service NPCs: a plaza row near the spawn (y 560, like the town strip),
 * each pitch 100 px apart. Frontier folk with frontier names.
 */
export const FRONTIER_NPCS: NpcRow[] = [
  { areaId: 'duskhaven', name: 'Maela the Provisioner', x: 620, y: 560, hue: 45, kind: 'vendor' },
  { areaId: 'duskhaven', name: 'Hesta the Mendwife', x: 720, y: 560, hue: 140, kind: 'healer' },
  { areaId: 'duskhaven', name: 'Ledger-Keeper Voss', x: 820, y: 560, hue: 40, kind: 'banker' },
  {
    areaId: 'duskhaven',
    name: 'Old Wren the Wayfinder',
    x: 920,
    y: 560,
    hue: 200,
    kind: 'questgiver',
  },
];

// Dark frontier timber — colder than the town camp's canvas-and-oak palette.
const TIMBER = '#5b4630';
const TIMBER_DARK = '#54452f';
const SNOW_CANVAS = '#b8a888';

/** Tag one area's props with its id (same helper shape as seed-decor.ts). */
function area(areaId: string, props: Omit<DecorRow, 'areaId'>[]): DecorRow[] {
  return props.map((p) => ({ areaId, ...p }));
}

/**
 * Duskhaven set-dressing (1500x1100; spawn (750,620); NPC row y 560 x 620..920; east portal
 * rect 1440,470..730): a half-ring of palisade against the mountain wind, snow-dusted timber
 * houses, a central hearth-fire with a shrine, tents behind the NPC pitches, and supplies.
 * Plus a small marker camp in Frostpeak beside the new pass down to the village.
 */
export const FRONTIER_DECOR: DecorRow[] = [
  ...area('duskhaven', [
    // --- Palisade against the north and west winds (the east opens onto the Frostpeak road). ---
    { kind: 'palisade', x: 380, y: 240, x2: 1120, y2: 240 },
    { kind: 'palisade', x: 260, y: 420, x2: 260, y2: 860 },
    { kind: 'torch', x: 380, y: 256 },
    { kind: 'torch', x: 1120, y: 256 },

    // --- Snow-dusted timber houses (footprint x,y → x2,y2; town house row shapes). ---
    { kind: 'house', x: 300, y: 300, x2: 470, y2: 440, color: TIMBER },
    { kind: 'house', x: 1030, y: 300, x2: 1200, y2: 440, color: TIMBER_DARK },
    { kind: 'house', x: 560, y: 820, x2: 760, y2: 960, color: TIMBER },

    // --- The hearth: a central bonfire south of the plaza, with a blessing shrine beside it. ---
    { kind: 'bonfire', x: 750, y: 712 },
    { kind: 'shrine', x: 750, y: 772, color: '#7fd0ff' },

    // --- Tents behind the service NPCs, torches flanking the plaza row. ---
    { kind: 'tent', x: 600, y: 470, color: SNOW_CANVAS },
    { kind: 'tent', x: 770, y: 460, color: SNOW_CANVAS, scale: 1.1 },
    { kind: 'tent', x: 940, y: 470, color: SNOW_CANVAS },
    { kind: 'torch', x: 640, y: 520 },
    { kind: 'torch', x: 860, y: 520 },

    // --- Supplies: crates, barrels, hay, and smashable pots by the houses and the hearth. ---
    { kind: 'crate', x: 560, y: 700 },
    { kind: 'crate', x: 596, y: 728 },
    { kind: 'barrel', x: 930, y: 706 },
    { kind: 'barrel', x: 962, y: 680 },
    { kind: 'hay', x: 620, y: 752 },
    { kind: 'hay', x: 880, y: 752 },
    { kind: 'pot', x: 540, y: 664 },
    { kind: 'pot', x: 980, y: 730 },
    { kind: 'pot', x: 995, y: 716, scale: 0.9 },

    // --- The east road out: a provisioner's wagon and torch posts toward the Frostpeak gate. ---
    { kind: 'wagon', x: 1240, y: 640, color: '#6b4a2c' },
    { kind: 'crate', x: 1280, y: 560 },
    { kind: 'torch', x: 1380, y: 470 },
    { kind: 'torch', x: 1380, y: 730 },
  ]),

  // --- Frostpeak: a marker camp beside the new west pass down to Duskhaven. ---
  ...area('frostpeak', [
    { kind: 'torch', x: 140, y: 890 },
    { kind: 'torch', x: 140, y: 1110 },
    { kind: 'bones', x: 200, y: 1060 },
    { kind: 'rock', x: 100, y: 920 },
    { kind: 'crate', x: 210, y: 940 },
  ]),
];

/**
 * loot_entry rows for the Abyssal Throne bestiary. The Throne sits past the rune-shard
 * economy zones, so floor mobs roll shards on the main table (rift-tier) plus mithril-tier
 * gear; the throne guards drop big gold and the Sovereign drops the largest gold pile in
 * the game. Item ids are all pre-existing content.
 */
export const FRONTIER_LOOT: LootRow[] = [
  // Abyssal Thrall (L30) — floor fodder: shards and the odd mithril piece.
  {
    mobTemplateId: 'abyss_thrall',
    grp: 'always',
    itemId: 'gold',
    weight: 1,
    minQty: 40,
    maxQty: 90,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'abyss_thrall',
    grp: 'main',
    itemId: 'rune_shard',
    weight: 35,
    minQty: 1,
    maxQty: 2,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'abyss_thrall',
    grp: 'main',
    itemId: 'gold',
    weight: 65,
    minQty: 1,
    maxQty: 1,
    isNothing: 1,
    chance: 0,
  },
  {
    mobTemplateId: 'abyss_thrall',
    grp: 'gear',
    itemId: 'mithril_blade',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.3,
  },
  {
    mobTemplateId: 'abyss_thrall',
    grp: 'gear',
    itemId: 'mithril_armor',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.3,
  },

  // Duskfire Hexer (L31) — caster: shard-heavy, with a rare double-shard roll.
  {
    mobTemplateId: 'duskfire_hexer',
    grp: 'always',
    itemId: 'gold',
    weight: 1,
    minQty: 45,
    maxQty: 95,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'duskfire_hexer',
    grp: 'main',
    itemId: 'rune_shard',
    weight: 35,
    minQty: 1,
    maxQty: 2,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'duskfire_hexer',
    grp: 'main',
    itemId: 'gold',
    weight: 65,
    minQty: 1,
    maxQty: 1,
    isNothing: 1,
    chance: 0,
  },
  {
    mobTemplateId: 'duskfire_hexer',
    grp: 'rare',
    itemId: 'rune_shard',
    weight: 1,
    minQty: 1,
    maxQty: 2,
    isNothing: 0,
    chance: 0.12,
  },

  // Thronespawn Ravager (L33) — the floor heavy: the richest non-guard gear group.
  {
    mobTemplateId: 'thronespawn_ravager',
    grp: 'always',
    itemId: 'gold',
    weight: 1,
    minQty: 55,
    maxQty: 115,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'thronespawn_ravager',
    grp: 'main',
    itemId: 'rune_shard',
    weight: 40,
    minQty: 1,
    maxQty: 2,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'thronespawn_ravager',
    grp: 'main',
    itemId: 'gold',
    weight: 60,
    minQty: 1,
    maxQty: 1,
    isNothing: 1,
    chance: 0,
  },
  {
    mobTemplateId: 'thronespawn_ravager',
    grp: 'gear',
    itemId: 'mithril_blade',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.35,
  },
  {
    mobTemplateId: 'thronespawn_ravager',
    grp: 'gear',
    itemId: 'tower_shield',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.35,
  },
  {
    mobTemplateId: 'thronespawn_ravager',
    grp: 'gear',
    itemId: 'runed_band',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.35,
  },

  // Sentinel of the Black Throne (L34 guard) — big gold, half-odds mithril gear.
  {
    mobTemplateId: 'throne_sentinel',
    grp: 'always',
    itemId: 'gold',
    weight: 1,
    minQty: 350,
    maxQty: 750,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'throne_sentinel',
    grp: 'main',
    itemId: 'rune_shard',
    weight: 50,
    minQty: 1,
    maxQty: 3,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'throne_sentinel',
    grp: 'main',
    itemId: 'gold',
    weight: 50,
    minQty: 1,
    maxQty: 1,
    isNothing: 1,
    chance: 0,
  },
  {
    mobTemplateId: 'throne_sentinel',
    grp: 'gear',
    itemId: 'mithril_blade',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.5,
  },
  {
    mobTemplateId: 'throne_sentinel',
    grp: 'gear',
    itemId: 'mithril_armor',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.5,
  },
  {
    mobTemplateId: 'throne_sentinel',
    grp: 'gear',
    itemId: 'tower_shield',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.5,
  },
  {
    mobTemplateId: 'throne_sentinel',
    grp: 'gear',
    itemId: 'runed_band',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.5,
  },

  // Magus of the Black Throne (L36 guard) — big gold, caster-leaning gear.
  {
    mobTemplateId: 'throne_magus',
    grp: 'always',
    itemId: 'gold',
    weight: 1,
    minQty: 350,
    maxQty: 750,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'throne_magus',
    grp: 'main',
    itemId: 'rune_shard',
    weight: 50,
    minQty: 1,
    maxQty: 3,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'throne_magus',
    grp: 'main',
    itemId: 'gold',
    weight: 50,
    minQty: 1,
    maxQty: 1,
    isNothing: 1,
    chance: 0,
  },
  {
    mobTemplateId: 'throne_magus',
    grp: 'gear',
    itemId: 'mithril_armor',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.5,
  },
  {
    mobTemplateId: 'throne_magus',
    grp: 'gear',
    itemId: 'runed_band',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.5,
  },

  // Nyxathor, the Abyssal Sovereign (L40 apex) — the largest gold pile in the game.
  {
    mobTemplateId: 'nyxathor',
    grp: 'always',
    itemId: 'gold',
    weight: 1,
    minQty: 2000,
    maxQty: 4000,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'nyxathor',
    grp: 'main',
    itemId: 'rune_shard',
    weight: 60,
    minQty: 2,
    maxQty: 4,
    isNothing: 0,
    chance: 0,
  },
  {
    mobTemplateId: 'nyxathor',
    grp: 'main',
    itemId: 'gold',
    weight: 40,
    minQty: 1,
    maxQty: 1,
    isNothing: 1,
    chance: 0,
  },
  {
    mobTemplateId: 'nyxathor',
    grp: 'gear',
    itemId: 'mithril_blade',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.8,
  },
  {
    mobTemplateId: 'nyxathor',
    grp: 'gear',
    itemId: 'mithril_armor',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.8,
  },
  {
    mobTemplateId: 'nyxathor',
    grp: 'gear',
    itemId: 'tower_shield',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.8,
  },
  {
    mobTemplateId: 'nyxathor',
    grp: 'gear',
    itemId: 'runed_band',
    weight: 1,
    minQty: 1,
    maxQty: 1,
    isNothing: 0,
    chance: 0.8,
  },
];

/**
 * Quests handed out from Duskhaven (Old Wren the Wayfinder): a mid bounty on the Throne's
 * floor, and the apex bounty on the Sovereign — the largest reward in the game, sized for
 * the exponential late-game XP curve.
 */
export const FRONTIER_QUESTS: QuestRow[] = [
  {
    id: 'throne_thralls',
    name: 'Break the Thralls',
    description: 'Destroy 10 Abyssal Thralls shambling the halls of the Abyssal Throne.',
    targetMob: 'abyss_thrall',
    targetCount: 10,
    rewardGold: 2500,
    rewardXp: 9000,
    rewardItem: null,
  },
  {
    id: 'throne_sovereign',
    name: 'The Abyssal Sovereign',
    description:
      'Descend to the deepest corner of the world and slay Nyxathor, the Abyssal Sovereign.',
    targetMob: 'nyxathor',
    targetCount: 1,
    rewardGold: 8000,
    rewardXp: 50000,
    rewardItem: null,
  },
];
