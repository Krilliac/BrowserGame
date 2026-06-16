/**
 * Acts expansion seed data: the Act 2 combat road west of Duskhaven (the Grimfrost
 * Barrows → the Howling Barrens → the Sunken Pass, looping back to the Blighted Spire)
 * and all of Act 3 (Vhal'reth, the last city; the Ashveil Desert; the Shattered
 * Causeway; the Voidmarch; and the Unmade Court — the final dungeon). Pure data — the
 * seed orchestrator (seed.ts) consumes these via the same idempotent upsert paths it
 * uses for the frontier's npcs / decor / loot_entry / quests / vendor_stock content.
 *
 * The areas, themes, rosters, and the Court's DUNGEONS population live in
 * src/shared/areas.ts + src/server/mobs.ts; the monster templates live in mobs.ts.
 * Placement rules mirror seed-frontier.ts and are enforced by seed-acts.test.ts.
 */

import type { DecorRow } from './seed-decor.js';
import type { LootRow, NpcRow, QuestRow } from './seed-frontier.js';

/** vendor_stock-shaped rows (see the vendor shelf upserts in seed.ts). */
export interface VendorStockRow {
  areaId: string;
  npcName: string;
  itemId: string;
  price: number;
  sortOrder: number;
}

/**
 * Vhal'reth's full service row: every service the game has, on one plaza strip
 * (y 560, pitches 100 px apart) — the last city outfits the endgame.
 */
export const ACTS_NPCS: NpcRow[] = [
  { areaId: 'vhalreth', name: 'Quartermaster Ilenne', x: 540, y: 560, hue: 45, kind: 'vendor' },
  { areaId: 'vhalreth', name: 'Forgemistress Vekka', x: 640, y: 560, hue: 25, kind: 'artificer' },
  { areaId: 'vhalreth', name: 'High Mender Carys', x: 740, y: 560, hue: 140, kind: 'healer' },
  { areaId: 'vhalreth', name: 'Coinwright Damaris', x: 840, y: 560, hue: 40, kind: 'banker' },
  { areaId: 'vhalreth', name: 'Whisper the Oddsmaker', x: 940, y: 560, hue: 300, kind: 'gambler' },
  { areaId: 'vhalreth', name: 'Marshal Theron', x: 1040, y: 560, hue: 210, kind: 'recruiter' },
  {
    areaId: 'vhalreth',
    name: 'Aelith the Riftkeeper',
    x: 1140,
    y: 560,
    hue: 270,
    kind: 'riftkeeper',
  },
  { areaId: 'vhalreth', name: 'Chronicler Vade', x: 1240, y: 560, hue: 190, kind: 'questgiver' },
];

// Vhal'reth's palette: old grey stone walls, warm canvas in the market.
const CITY_STONE = '#6e6a62';
const CITY_STONE_DARK = '#5c5850';
const MARKET_CANVAS = '#c8a878';

/** Tag one area's props with its id (same helper shape as seed-decor.ts). */
function area(areaId: string, props: Omit<DecorRow, 'areaId'>[]): DecorRow[] {
  return props.map((p) => ({ areaId, ...p }));
}

/**
 * Set-dressing for the acts. Vhal'reth (1800x1200; spawn (900,640); NPC row y 560
 * x 540..1240; north portal center (900,25); east portal center (1770,650)) gets the
 * full walled-city treatment: a stone-grey palisade ring with a north gate, six houses,
 * a market strip behind the service row, braziers on the gate and plaza (6, under the
 * 10-light cap), and a hearth + shrine south of the spawn. The combat zones get sparse
 * landmark props in their themes' voice.
 */
export const ACTS_DECOR: DecorRow[] = [
  ...area('vhalreth', [
    // --- The city wall (palisade lines tinted stone-grey), gate gap on the north road. ---
    { kind: 'palisade', x: 200, y: 120, x2: 740, y2: 120, color: CITY_STONE },
    { kind: 'palisade', x: 1060, y: 120, x2: 1600, y2: 120, color: CITY_STONE },
    { kind: 'palisade', x: 200, y: 120, x2: 200, y2: 1080, color: CITY_STONE },
    { kind: 'palisade', x: 200, y: 1080, x2: 1600, y2: 1080, color: CITY_STONE },
    { kind: 'palisade', x: 1600, y: 120, x2: 1600, y2: 460, color: CITY_STONE },
    { kind: 'palisade', x: 1600, y: 840, x2: 1600, y2: 1080, color: CITY_STONE },
    { kind: 'gate', x: 900, y: 120 },
    { kind: 'torch', x: 220, y: 140 },
    { kind: 'torch', x: 1580, y: 140 },
    { kind: 'torch', x: 220, y: 1060 },
    { kind: 'torch', x: 1580, y: 1060 },

    // --- Stone houses (footprint x,y → x2,y2): four ward corners + two by the gate road. ---
    { kind: 'house', x: 260, y: 200, x2: 460, y2: 360, color: CITY_STONE },
    { kind: 'house', x: 1340, y: 200, x2: 1540, y2: 360, color: CITY_STONE_DARK },
    { kind: 'house', x: 260, y: 760, x2: 460, y2: 920, color: CITY_STONE_DARK },
    { kind: 'house', x: 1340, y: 760, x2: 1540, y2: 920, color: CITY_STONE },
    { kind: 'house', x: 620, y: 160, x2: 790, y2: 300, color: CITY_STONE },
    { kind: 'house', x: 1010, y: 160, x2: 1180, y2: 300, color: CITY_STONE_DARK },

    // --- The market: canvas stalls behind the service row, supplies at both ends. ---
    { kind: 'tent', x: 560, y: 470, color: MARKET_CANVAS },
    { kind: 'tent', x: 760, y: 460, color: MARKET_CANVAS, scale: 1.1 },
    { kind: 'tent', x: 1040, y: 460, color: MARKET_CANVAS, scale: 1.1 },
    { kind: 'tent', x: 1240, y: 470, color: MARKET_CANVAS },
    { kind: 'crate', x: 500, y: 610 },
    { kind: 'crate', x: 530, y: 640 },
    { kind: 'barrel', x: 1260, y: 610 },
    { kind: 'barrel', x: 1290, y: 640 },
    { kind: 'pot', x: 480, y: 520 },
    { kind: 'pot', x: 1300, y: 520 },
    { kind: 'pot', x: 700, y: 840 },
    { kind: 'pot', x: 1090, y: 840 },
    { kind: 'hay', x: 560, y: 840 },
    { kind: 'hay', x: 1240, y: 840 },
    { kind: 'wagon', x: 1420, y: 620, color: '#6b4a2c' },

    // --- Braziers: gate posts, plaza, and the east road (6 lights, under the 10 cap). ---
    { kind: 'brazier', x: 840, y: 140 },
    { kind: 'brazier', x: 960, y: 140 },
    { kind: 'brazier', x: 700, y: 700 },
    { kind: 'brazier', x: 1100, y: 700 },
    { kind: 'brazier', x: 1560, y: 540 },
    { kind: 'brazier', x: 1560, y: 760 },

    // --- The great hearth south of the plaza (its blessing shrine + indoor chest live in
    // seed-decor.ts's exploration pass, which owns chest/shrine placement per area). ---
    { kind: 'bonfire', x: 900, y: 820 },
  ]),

  // --- The Grimfrost Barrows: grave rows in the ice, old bones, dead trees. ---
  ...area('grimfrost_barrow', [
    { kind: 'grave', x: 400, y: 400 },
    { kind: 'grave', x: 460, y: 440 },
    { kind: 'grave', x: 520, y: 380, scale: 1.1 },
    { kind: 'grave', x: 900, y: 1000 },
    { kind: 'grave', x: 960, y: 1040 },
    { kind: 'bones', x: 700, y: 500 },
    { kind: 'bones', x: 1200, y: 900 },
    { kind: 'dead_tree', x: 1400, y: 300 },
    { kind: 'dead_tree', x: 300, y: 1100 },
    { kind: 'rock', x: 600, y: 1200 },
    { kind: 'rock', x: 1500, y: 1100 },
  ]),

  // --- The Howling Barrens: leaning pine clusters, a kill site in the open. ---
  ...area('howling_barrens', [
    { kind: 'tree', x: 500, y: 300 },
    { kind: 'tree', x: 560, y: 340, scale: 1.1 },
    { kind: 'tree', x: 640, y: 280 },
    { kind: 'tree', x: 1200, y: 1100 },
    { kind: 'tree', x: 1260, y: 1140, scale: 0.9 },
    { kind: 'tree', x: 400, y: 1000 },
    { kind: 'dead_tree', x: 900, y: 700 },
    { kind: 'bones', x: 1500, y: 400 },
  ]),

  // --- The Sunken Pass: drowned ruins and rockfall along the flooded road. ---
  ...area('sunken_pass', [
    { kind: 'ruin', x: 800, y: 400 },
    { kind: 'ruin', x: 1000, y: 1000, scale: 1.2 },
    { kind: 'rock', x: 500, y: 800 },
    { kind: 'rock', x: 1300, y: 500 },
    { kind: 'bones', x: 700, y: 1100 },
  ]),

  // --- The Ashveil Desert: burned trees and bleached bones in the grey dunes. ---
  ...area('ashveil_desert', [
    { kind: 'dead_tree', x: 600, y: 400 },
    { kind: 'dead_tree', x: 1200, y: 1000, scale: 1.2 },
    { kind: 'bones', x: 900, y: 700 },
    { kind: 'bones', x: 400, y: 1100 },
    { kind: 'skull_pile', x: 1500, y: 400 },
  ]),

  // --- The Shattered Causeway: fallen spans and the toll of those who fell short. ---
  ...area('shattered_causeway', [
    { kind: 'ruin', x: 600, y: 400 },
    { kind: 'ruin', x: 1300, y: 500, scale: 1.2 },
    { kind: 'rock', x: 500, y: 1000 },
    { kind: 'skull_pile', x: 1100, y: 1100 },
    { kind: 'bones', x: 900, y: 800 },
  ]),

  // --- The Voidmarch: void crystals and things that should not grow. ---
  ...area('voidmarch', [
    { kind: 'crystal', x: 600, y: 400 },
    { kind: 'crystal', x: 1200, y: 900, scale: 1.2 },
    { kind: 'horror_plant', x: 900, y: 600 },
    { kind: 'thorn_plant', x: 400, y: 1100 },
    { kind: 'skull_pile', x: 1500, y: 500 },
  ]),

  // --- The Unmade Court: ruined grandeur, lit by what has not yet been unmade. ---
  ...area('the_unmade_court', [
    { kind: 'ruin', x: 500, y: 500 },
    { kind: 'ruin', x: 1000, y: 800, scale: 1.2 },
    { kind: 'skull_pile', x: 750, y: 600 },
    { kind: 'candle', x: 600, y: 400 },
    { kind: 'candle', x: 900, y: 400 },
  ]),
];

/**
 * Build one mob's loot_entry rows: a guaranteed gold pile, a weighted main roll of rune
 * shards vs nothing, an optional rare double-shard roll, and an optional gear group
 * (chance triggers one uniform pick). Mirrors the hand-written tables in seed-frontier.ts.
 */
function loot(
  mobTemplateId: string,
  gold: [number, number],
  shard: { weight: number; min?: number; max?: number; rare?: number },
  gear?: { chance: number; items: string[] },
): LootRow[] {
  const rows: LootRow[] = [
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
      itemId: 'rune_shard',
      weight: shard.weight,
      minQty: shard.min ?? 1,
      maxQty: shard.max ?? 2,
      isNothing: 0,
      chance: 0,
    },
    {
      mobTemplateId,
      grp: 'main',
      itemId: 'gold',
      weight: 100 - shard.weight,
      minQty: 1,
      maxQty: 1,
      isNothing: 1,
      chance: 0,
    },
  ];
  if (shard.rare !== undefined) {
    rows.push({
      mobTemplateId,
      grp: 'rare',
      itemId: 'rune_shard',
      weight: 1,
      minQty: 1,
      maxQty: 2,
      isNothing: 0,
      chance: shard.rare,
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
 * loot_entry rows for the acts bestiary. Both acts sit in the gold-and-shards economy;
 * gear scales steel/mithril on the Act 2 road up to the runed/frostforged/doomspike top
 * bases in Act 3 (floor mobs there drop 80-200 gold; Athraxis drops the new largest pile).
 */
export const ACTS_LOOT: LootRow[] = [
  // --- Act 2 road (L21-31) ---
  ...loot(
    'barrow_wight',
    [22, 50],
    { weight: 30 },
    { chance: 0.3, items: ['steel_armor', 'steel_helm'] },
  ),
  ...loot('cairn_banshee', [24, 55], { weight: 32, rare: 0.1 }),
  ...loot(
    'barrens_warg',
    [26, 58],
    { weight: 30 },
    { chance: 0.3, items: ['steel_sword', 'tower_shield'] },
  ),
  ...loot('hexpine_shaman', [28, 62], { weight: 34, rare: 0.1 }),
  ...loot(
    'drowned_hulk',
    [32, 70],
    { weight: 32 },
    { chance: 0.3, items: ['mithril_armor', 'tower_shield'] },
  ),
  ...loot(
    'tidegrave_lurker',
    [34, 75],
    { weight: 34 },
    { chance: 0.3, items: ['mithril_blade', 'runed_band'] },
  ),
  ...loot(
    'maelgor',
    [250, 550],
    { weight: 50, min: 1, max: 3 },
    { chance: 0.5, items: ['mithril_blade', 'mithril_armor', 'tower_shield', 'runed_band'] },
  ),

  // --- Act 3 (L40-60) ---
  ...loot(
    'ash_dire_wolf',
    [80, 130],
    { weight: 35 },
    { chance: 0.3, items: ['mithril_blade', 'mithril_armor'] },
  ),
  ...loot('cinderbone_archer', [85, 140], { weight: 35, rare: 0.12 }),
  ...loot(
    'ashveil_gorgon',
    [90, 150],
    { weight: 36 },
    { chance: 0.3, items: ['moonsilver_saber', 'mithril_visage'] },
  ),
  ...loot(
    'causeway_golem',
    [100, 170],
    { weight: 36 },
    { chance: 0.3, items: ['runed_aegis_plate', 'mithril_gauntlets'] },
  ),
  ...loot(
    'voidtouched_centaur',
    [100, 170],
    { weight: 36 },
    { chance: 0.3, items: ['frostforged_glaive', 'mithril_legplates'] },
  ),
  ...loot(
    'null_revenant',
    [120, 200],
    { weight: 40 },
    { chance: 0.3, items: ['doomspike_partisan', 'runed_crown_of_vigil'] },
  ),
  ...loot(
    'sarghul',
    [450, 900],
    { weight: 55, min: 2, max: 4 },
    {
      chance: 0.6,
      items: [
        'frostforged_glaive',
        'runed_aegis_plate',
        'frostforged_pauldrons',
        'runed_crown_of_vigil',
      ],
    },
  ),
  ...loot(
    'vessirah',
    [500, 1000],
    { weight: 55, min: 2, max: 4 },
    {
      chance: 0.6,
      items: [
        'doomspike_partisan',
        'runed_belt_of_wards',
        'stormbound_grasp',
        'runed_crown_of_vigil',
      ],
    },
  ),
  ...loot(
    'court_executioner',
    [700, 1400],
    { weight: 60, min: 2, max: 4 },
    { chance: 0.65, items: ['doomspike_partisan', 'runed_aegis_plate', 'warden_greaves'] },
  ),
  ...loot(
    'court_oracle',
    [700, 1400],
    { weight: 60, min: 2, max: 4 },
    { chance: 0.65, items: ['frostforged_glaive', 'runed_crown_of_vigil', 'stormbound_grasp'] },
  ),
  ...loot(
    'athraxis',
    [5000, 9000],
    { weight: 70, min: 3, max: 6 },
    {
      chance: 0.85,
      items: [
        'doomspike_partisan',
        'runed_aegis_plate',
        'runed_crown_of_vigil',
        'frostforged_pauldrons',
        'warden_greaves',
        'bulwark_of_the_pale_moon',
      ],
    },
  ),
];

/**
 * Quests across the acts (handed out by Old Wren in Duskhaven and Chronicler Vade in
 * Vhal'reth): the road's mid-boss bounties, two kill-N culls, and the apex bounty on
 * Athraxis — the largest reward in the game, sized for the exponential late-game curve.
 */
export const ACTS_QUESTS: QuestRow[] = [
  {
    id: 'barrens_wargs',
    name: 'Howl of the Barrens',
    description: 'Cull 8 Barrens Wargs hunting the pines of the Howling Barrens.',
    targetMob: 'barrens_warg',
    targetCount: 8,
    rewardGold: 1800,
    rewardXp: 6000,
    rewardItem: null,
  },
  {
    id: 'pass_tidewarden',
    name: 'The Tidewarden',
    description: 'Break Maelgor, the Tidewarden, who holds the drowned gate of the Sunken Pass.',
    targetMob: 'maelgor',
    targetCount: 1,
    rewardGold: 3000,
    rewardXp: 12000,
    rewardItem: null,
  },
  {
    id: 'ash_tyrant',
    name: 'Ash and Tyranny',
    description: 'Cast down Sarghul, the Ash-Tyrant, lord of the Ashveil Desert.',
    targetMob: 'sarghul',
    targetCount: 1,
    rewardGold: 4500,
    rewardXp: 25000,
    rewardItem: null,
  },
  {
    id: 'null_cull',
    name: 'Silence the Null',
    description: 'Destroy 10 Null Revenants stalking the fraying edge of the Voidmarch.',
    targetMob: 'null_revenant',
    targetCount: 10,
    rewardGold: 3500,
    rewardXp: 18000,
    rewardItem: null,
  },
  {
    id: 'void_matron',
    name: 'The Void Matron',
    description: "Hunt Vess'irah, the Void Hag, where the world unravels in the Voidmarch.",
    targetMob: 'vessirah',
    targetCount: 1,
    rewardGold: 6000,
    rewardXp: 40000,
    rewardItem: null,
  },
  {
    id: 'unmade_god',
    name: 'The Unmaking',
    description:
      'Enter the Unmade Court and end Athraxis, the Unmade God — the true end of the long road.',
    targetMob: 'athraxis',
    targetCount: 1,
    rewardGold: 20000,
    rewardXp: 150000,
    rewardItem: null,
  },
  // Wayfinder bounties — Old Wren pays for charting the road ahead. Explore quests complete the
  // instant you set foot in the named area (no kill, no turn-in); the reward grows with the distance.
  {
    id: 'scout_sunken_pass',
    name: 'Chart the Sunken Pass',
    description: 'Push past the Barrens and lay eyes on the drowned gate of the Sunken Pass.',
    targetMob: null,
    targetCount: 0,
    rewardGold: 900,
    rewardXp: 3000,
    rewardItem: null,
    exploreArea: 'sunken_pass',
  },
  {
    id: 'chart_ashveil',
    name: 'Brave the Ashveil',
    description: 'Cross into the burning Ashveil Desert and mark a path for those who follow.',
    targetMob: null,
    targetCount: 0,
    rewardGold: 1500,
    rewardXp: 6000,
    rewardItem: null,
    exploreArea: 'ashveil_desert',
  },
  {
    id: 'witness_voidmarch',
    name: 'The Fraying Edge',
    description: 'Walk the Voidmarch, where the world unravels, and live to report what you saw.',
    targetMob: null,
    targetCount: 0,
    rewardGold: 2500,
    rewardXp: 12000,
    rewardItem: null,
    exploreArea: 'voidmarch',
  },
];

/**
 * The Quartermaster's shelf in Vhal'reth: the priciest base gear in the game plus the
 * late drop-only tomes (seed-spells.ts NEW_SPELLBOOKS) — the last city is the endgame
 * gold sink, escalating the town Merchant / Duskhaven Provisioner progression.
 */
const QUARTERMASTER_SHELF: [string, number][] = [
  ['doomspike_partisan', 6800],
  ['frostforged_glaive', 4600],
  ['runed_aegis_plate', 5400],
  ['bulwark_of_the_pale_moon', 3400],
  ['runed_crown_of_vigil', 3000],
  ['warden_greaves', 2900],
  ['frostforged_pauldrons', 2700],
  ['stormbound_grasp', 2300],
  ['emberstride_boots', 2100],
  ['runed_belt_of_wards', 1900],
  ['tome_galeburst', 550],
  ['tome_earthshatter', 750],
  ['tome_starfall', 1500],
  ['tome_maelstrom_orb', 1600],
];

export const ACTS_VENDOR_STOCK: VendorStockRow[] = QUARTERMASTER_SHELF.map(
  ([itemId, price], i) => ({
    areaId: 'vhalreth',
    npcName: 'Quartermaster Ilenne',
    itemId,
    price,
    sortOrder: i,
  }),
);
