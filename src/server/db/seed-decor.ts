/**
 * Hand-placed set-dressing for every area — the expansion pass over the original town camp
 * (TOWN_DECOR in seed.ts) and Hollowroot shrines/chests. Pure data: seed.ts inserts these
 * rows into the `decor` table; the client renderer decides how each kind looks
 * (sprite-backed kinds live in src/client/decor-sprites.ts, light props stay procedural).
 *
 * Placement rules honored throughout (enforced by seed-decor.test.ts):
 * - everything inside [60, width-60] x [60, height-60] of its area;
 * - nothing within 70 px of a portal rect center or the area spawn point;
 * - town props stay inside the palisade ring and clear of house footprints / the NPC strip;
 * - `candle` + `brazier` are light sources: at most 10 per area.
 *
 * Pots are breakable entities (walk over them to smash them for gold), so they cluster
 * Diablo-style by doorways, walls, and dungeon corners — densest in the dungeons.
 *
 * The EXPLORATION PASS at the bottom adds things to FIND: treasure chests in the far
 * corners (the World turns 'chest' decor into lootable entities), shrines beside new
 * landmarks ('shrine' decor grants timed buffs), and distinctive prop clusters to
 * navigate by. Chest/shrine rows are deliberately absent from town and hollowroot —
 * seed.ts already seeds those kinds there, and the per-(area,kind) seed guard would
 * silently drop any we added.
 */

export interface DecorRow {
  areaId: string;
  kind: string;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  color?: string;
  scale?: number;
}

/** Tag one area's props with its id (keeps the per-area blocks below readable). */
function area(areaId: string, props: Omit<DecorRow, 'areaId'>[]): DecorRow[] {
  return props.map((p) => ({ areaId, ...p }));
}

export const EXPANSION_DECOR: DecorRow[] = [
  // --- Aldermere (town, 1600x1200) — all inside the palisade ring (x 470..1130, y 440..820),
  // outside the three house footprints, and >=30 px from every service NPC on the y~560 strip.
  ...area('town', [
    // Pots tucked behind the vendor strip, in the gaps between NPC pitches.
    { kind: 'pot', x: 612, y: 534 },
    { kind: 'pot', x: 630, y: 540 },
    { kind: 'pot', x: 621, y: 552, scale: 0.9 },
    { kind: 'pot', x: 896, y: 532 },
    { kind: 'pot', x: 912, y: 540, scale: 1.1 },
    // Pots by the supply corners (next to the existing crates/barrels/hay).
    { kind: 'pot', x: 596, y: 716 },
    { kind: 'pot', x: 610, y: 728, scale: 0.9 },
    { kind: 'pot', x: 1032, y: 688 },
    { kind: 'pot', x: 1046, y: 676 },
    // Inside the gate, off the road: a smashable welcome.
    { kind: 'pot', x: 1086, y: 668 },
    { kind: 'pot', x: 1072, y: 680, scale: 1.15 },
    // Extra supplies stacked by the merchant's wagon, toward the gate.
    { kind: 'crate', x: 1090, y: 520 },
    { kind: 'barrel', x: 1104, y: 538 },
    // Braziers flanking the gate road just inside the palisade gap.
    { kind: 'brazier', x: 1096, y: 572 },
    { kind: 'brazier', x: 1096, y: 628 },
  ]),

  // --- Gloomwood (wilderness, 2400x2000) — tree clusters along the edges and the west road,
  // rocks and bones in mob territory, thorns warning of the crypt portal in the southeast.
  ...area('wilderness', [
    // North-edge treeline.
    { kind: 'tree', x: 320, y: 140 },
    { kind: 'tree', x: 410, y: 180, scale: 1.1 },
    { kind: 'tree', x: 520, y: 120 },
    { kind: 'tree', x: 680, y: 160, scale: 0.9 },
    // Trees flanking the west road out of town.
    { kind: 'tree', x: 340, y: 560 },
    { kind: 'tree', x: 560, y: 520, scale: 1.2 },
    { kind: 'tree', x: 420, y: 840 },
    { kind: 'tree', x: 640, y: 860 },
    // Southwest copse.
    { kind: 'tree', x: 520, y: 1560 },
    { kind: 'tree', x: 600, y: 1680, scale: 1.1 },
    { kind: 'tree', x: 440, y: 1760 },
    // East treeline near the cavern mouth.
    { kind: 'tree', x: 1900, y: 560 },
    { kind: 'tree', x: 2040, y: 480, scale: 0.9 },
    // The wood goes sicker toward the middle: dead trees.
    { kind: 'dead_tree', x: 1040, y: 520 },
    { kind: 'dead_tree', x: 1160, y: 640, scale: 1.15 },
    { kind: 'dead_tree', x: 980, y: 1240 },
    { kind: 'dead_tree', x: 1450, y: 1500 },
    // Rock outcrops.
    { kind: 'rock', x: 760, y: 1100 },
    { kind: 'rock', x: 1700, y: 300, scale: 1.2 },
    { kind: 'rock', x: 1840, y: 1180 },
    { kind: 'rock', x: 2200, y: 900 },
    // Thorn tangles creeping out from the Shadow Crypt portal (southeast).
    { kind: 'thorn_plant', x: 2180, y: 1760 },
    { kind: 'thorn_plant', x: 2230, y: 1640, scale: 1.1 },
    { kind: 'thorn_plant', x: 2120, y: 1880 },
    // Bones where the mob packs roam mid-map.
    { kind: 'bones', x: 1320, y: 980 },
    { kind: 'bones', x: 1390, y: 1040 },
    { kind: 'bones', x: 1750, y: 720 },
    { kind: 'bones', x: 900, y: 1700 },
    { kind: 'skull_pile', x: 1980, y: 1560 },
    // --- The Gloomwood Pass (RENDER terrain): a cliff ridge across the mid-map with a single
    // walkable GAP you funnel through; the gap lines up with the Catacombs (top) + Marsh (bottom)
    // portals so the pass connects them. Footprints are kept landmark-sized (not screen-filling) —
    // they read as imposing terrain, not walls. `cliff` = solid rect face; `mountain`/`boulder` =
    // solid circle you walk around. Live-editable in the DB; server + client collide identically.
    { kind: 'cliff', x: 860, y: 1238, x2: 980, y2: 1280 }, // west cliff of the ridge
    { kind: 'cliff', x: 1180, y: 1238, x2: 1300, y2: 1280 }, // east cliff of the ridge
    { kind: 'boulder', x: 992, y: 1214, x2: 1064, y2: 1276 }, // boulders pinch the gap mouth
    { kind: 'boulder', x: 1108, y: 1250, x2: 1180, y2: 1312 },
    { kind: 'boulder', x: 772, y: 1004, x2: 844, y2: 1068 }, // a scattered rock in mob territory
    { kind: 'mountain', x: 1740, y: 840, x2: 1900, y2: 1000 }, // a rounded massif to skirt around
  ]),

  // --- Shadow Crypt (1400x1400) — a graveyard heart, ruin arches by both stairways,
  // pots by the doorways, candles along the side walls.
  ...area('crypt', [
    // Western grave cluster.
    { kind: 'grave', x: 300, y: 500 },
    { kind: 'grave', x: 360, y: 540, scale: 1.1 },
    { kind: 'grave', x: 420, y: 490 },
    { kind: 'grave', x: 330, y: 610 },
    { kind: 'grave', x: 450, y: 580, scale: 0.9 },
    // Eastern grave cluster.
    { kind: 'grave', x: 1000, y: 800 },
    { kind: 'grave', x: 1060, y: 840 },
    { kind: 'grave', x: 950, y: 880, scale: 1.15 },
    { kind: 'grave', x: 1100, y: 760 },
    // Bones scatter + skull piles in the far corners.
    { kind: 'bones', x: 600, y: 700 },
    { kind: 'bones', x: 800, y: 900 },
    { kind: 'bones', x: 250, y: 1000 },
    { kind: 'skull_pile', x: 120, y: 120 },
    { kind: 'skull_pile', x: 1280, y: 1240 },
    // Ruined arches framing the north entrance and the south stair to the mines.
    { kind: 'ruin', x: 560, y: 160 },
    { kind: 'ruin', x: 840, y: 160, scale: 1.1 },
    { kind: 'ruin', x: 560, y: 1240 },
    { kind: 'ruin', x: 840, y: 1240 },
    // Pots by the doorways.
    { kind: 'pot', x: 520, y: 200 },
    { kind: 'pot', x: 536, y: 212, scale: 0.9 },
    { kind: 'pot', x: 880, y: 200 },
    { kind: 'pot', x: 896, y: 212 },
    { kind: 'pot', x: 540, y: 1280 },
    { kind: 'pot', x: 556, y: 1292, scale: 1.1 },
    // Candles guttering along the side walls (6 lights, under the 10 cap).
    { kind: 'candle', x: 100, y: 400 },
    { kind: 'candle', x: 100, y: 700 },
    { kind: 'candle', x: 100, y: 1000 },
    { kind: 'candle', x: 1300, y: 400 },
    { kind: 'candle', x: 1300, y: 700 },
    { kind: 'candle', x: 1300, y: 1000 },
  ]),

  // --- Rotfen Marsh (2200x1800) — drowned trees, thorn brakes, mushroom pockets,
  // one sunken ruin with pots still intact beside it.
  ...area('marsh', [
    { kind: 'dead_tree', x: 480, y: 420 },
    { kind: 'dead_tree', x: 560, y: 520, scale: 1.1 },
    { kind: 'dead_tree', x: 1620, y: 380 },
    { kind: 'dead_tree', x: 1750, y: 460 },
    { kind: 'dead_tree', x: 900, y: 980, scale: 1.2 },
    { kind: 'dead_tree', x: 1320, y: 1180 },
    { kind: 'thorn_plant', x: 760, y: 700 },
    { kind: 'thorn_plant', x: 820, y: 760, scale: 0.9 },
    { kind: 'thorn_plant', x: 1500, y: 820 },
    { kind: 'thorn_plant', x: 1880, y: 1100 },
    { kind: 'bones', x: 1040, y: 620 },
    { kind: 'bones', x: 1230, y: 640 },
    { kind: 'bones', x: 660, y: 1320 },
    // Mushroom pockets glowing in the murk.
    { kind: 'mushroom', x: 380, y: 900 },
    { kind: 'mushroom', x: 430, y: 960 },
    { kind: 'mushroom', x: 395, y: 1020, scale: 1.15 },
    { kind: 'mushroom', x: 1700, y: 1500 },
    { kind: 'mushroom', x: 1760, y: 1560 },
    // A sunken shrine-house of some older faith, pots unbroken beside it.
    { kind: 'ruin', x: 1450, y: 1400, scale: 1.1 },
    { kind: 'pot', x: 1480, y: 1440 },
    { kind: 'pot', x: 1500, y: 1424 },
    { kind: 'skull_pile', x: 980, y: 1560 },
    // Toxic bog pools — stand in one and the venom seeps in (hazard zones).
    { kind: 'poison_pool', x: 1080, y: 900, scale: 1.2 },
    { kind: 'poison_pool', x: 700, y: 1100 },
  ]),

  // --- Emberdeep Mines (1900x1700) — stalagmites along the walls, crystal seams,
  // miners' supply caches (pots + crates), two braziers at the junctions.
  ...area('mines', [
    { kind: 'stalagmite', x: 140, y: 300 },
    { kind: 'stalagmite', x: 180, y: 420, scale: 1.15 },
    { kind: 'stalagmite', x: 120, y: 1100 },
    { kind: 'stalagmite', x: 220, y: 1400 },
    { kind: 'stalagmite', x: 1740, y: 500 },
    { kind: 'stalagmite', x: 1760, y: 640, scale: 0.9 },
    { kind: 'stalagmite', x: 1700, y: 1300 },
    { kind: 'crystal', x: 480, y: 760 },
    { kind: 'crystal', x: 1400, y: 420, scale: 1.2 },
    { kind: 'crystal', x: 1500, y: 1480 },
    { kind: 'rock', x: 700, y: 1200 },
    { kind: 'rock', x: 1100, y: 900 },
    // The stranded miners' supply cache, east of the entrance shaft.
    { kind: 'pot', x: 1060, y: 300 },
    { kind: 'pot', x: 1076, y: 316 },
    { kind: 'pot', x: 1048, y: 326, scale: 0.9 },
    { kind: 'crate', x: 1100, y: 330 },
    { kind: 'crate', x: 680, y: 520 },
    { kind: 'barrel', x: 660, y: 540 },
    // A forgotten cache deep in the southwest gallery.
    { kind: 'pot', x: 400, y: 1500 },
    { kind: 'pot', x: 420, y: 1512, scale: 1.1 },
    { kind: 'brazier', x: 860, y: 820 },
    { kind: 'brazier', x: 1300, y: 1100 },
  ]),

  // --- Frostpeak Pass (2200x2000) — rock clusters, ice crystal, frozen bones,
  // a few trees that died standing.
  ...area('frostpeak', [
    { kind: 'rock', x: 400, y: 400 },
    { kind: 'rock', x: 470, y: 460, scale: 1.2 },
    { kind: 'rock', x: 360, y: 520 },
    { kind: 'rock', x: 1600, y: 500 },
    { kind: 'rock', x: 1680, y: 560 },
    { kind: 'rock', x: 600, y: 1400 },
    { kind: 'rock', x: 680, y: 1460, scale: 0.9 },
    { kind: 'rock', x: 1500, y: 1300 },
    { kind: 'rock', x: 2000, y: 1700, scale: 1.25 },
    { kind: 'crystal', x: 900, y: 800 },
    { kind: 'crystal', x: 1800, y: 1100 },
    { kind: 'crystal', x: 300, y: 1100, scale: 1.1 },
    { kind: 'bones', x: 1200, y: 700 },
    { kind: 'bones', x: 1300, y: 760 },
    { kind: 'bones', x: 800, y: 1700 },
    { kind: 'dead_tree', x: 500, y: 900 },
    { kind: 'dead_tree', x: 1900, y: 300, scale: 0.9 },
    { kind: 'dead_tree', x: 1400, y: 1700 },
  ]),

  // --- The Forgotten Catacombs (1500x1300) — dense grave field, ruin arch at the entrance,
  // pots by the doorways and a cache deep in, candles along the walls.
  ...area('forgotten_catacombs', [
    { kind: 'grave', x: 350, y: 450 },
    { kind: 'grave', x: 410, y: 500, scale: 1.1 },
    { kind: 'grave', x: 300, y: 560 },
    { kind: 'grave', x: 440, y: 420 },
    { kind: 'grave', x: 380, y: 620, scale: 0.9 },
    { kind: 'grave', x: 1050, y: 700 },
    { kind: 'grave', x: 1110, y: 750 },
    { kind: 'grave', x: 990, y: 780, scale: 1.2 },
    { kind: 'bones', x: 650, y: 600 },
    { kind: 'bones', x: 900, y: 500 },
    { kind: 'bones', x: 500, y: 1000 },
    { kind: 'bones', x: 1100, y: 1100 },
    { kind: 'skull_pile', x: 120, y: 1180 },
    { kind: 'skull_pile', x: 1380, y: 120 },
    // Broken arches framing the way down from Gloomwood.
    { kind: 'ruin', x: 580, y: 150 },
    { kind: 'ruin', x: 920, y: 150, scale: 1.1 },
    // Pots by the entry hall, plus a cache by the southeast crypt wall.
    { kind: 'pot', x: 600, y: 330 },
    { kind: 'pot', x: 616, y: 342 },
    { kind: 'pot', x: 584, y: 350, scale: 0.9 },
    { kind: 'pot', x: 1180, y: 950 },
    { kind: 'pot', x: 1196, y: 962 },
    // Candles along the walls (6 lights, under the 10 cap).
    { kind: 'candle', x: 90, y: 300 },
    { kind: 'candle', x: 90, y: 650 },
    { kind: 'candle', x: 1410, y: 300 },
    { kind: 'candle', x: 1410, y: 650 },
    { kind: 'candle', x: 420, y: 1210 },
    { kind: 'candle', x: 750, y: 1210 },
  ]),

  // --- The Shattered Rift (1500x1300) — void crystal, broken architecture, horror growths,
  // violet candlelight, pots by the entrance and the deep corner.
  ...area('rift', [
    { kind: 'crystal', x: 300, y: 400 },
    { kind: 'crystal', x: 360, y: 460, scale: 1.2 },
    { kind: 'crystal', x: 1150, y: 400 },
    { kind: 'crystal', x: 1200, y: 460 },
    { kind: 'crystal', x: 700, y: 900, scale: 1.3 },
    { kind: 'crystal', x: 200, y: 1100 },
    { kind: 'ruin', x: 550, y: 600 },
    { kind: 'ruin', x: 1000, y: 700, scale: 1.1 },
    { kind: 'ruin', x: 800, y: 1100 },
    { kind: 'horror_plant', x: 450, y: 800 },
    { kind: 'horror_plant', x: 1250, y: 900 },
    { kind: 'horror_plant', x: 900, y: 500, scale: 0.9 },
    { kind: 'skull_pile', x: 130, y: 250 },
    { kind: 'skull_pile', x: 1370, y: 1150 },
    // Candles that should not still be burning (6 lights, under the 10 cap).
    { kind: 'candle', x: 600, y: 300 },
    { kind: 'candle', x: 950, y: 300 },
    { kind: 'candle', x: 200, y: 700 },
    { kind: 'candle', x: 1300, y: 700 },
    { kind: 'candle', x: 400, y: 1200 },
    { kind: 'candle', x: 1100, y: 1200 },
    // Pots flanking the entry hall + a far-corner cache.
    { kind: 'pot', x: 580, y: 340 },
    { kind: 'pot', x: 596, y: 352 },
    { kind: 'pot', x: 910, y: 340 },
    { kind: 'pot', x: 926, y: 352, scale: 1.1 },
    { kind: 'pot', x: 1320, y: 1230 },
    { kind: 'pot', x: 1336, y: 1218 },
  ]),

  // --- The Writhing Hive (1500x1300) — fleshy horror growths everywhere, the husk of an
  // older ruin being digested, pots by the entrance.
  ...area('writhing_hive', [
    { kind: 'horror_plant', x: 300, y: 500 },
    { kind: 'horror_plant', x: 360, y: 560, scale: 1.15 },
    { kind: 'horror_plant', x: 1150, y: 450 },
    { kind: 'horror_plant', x: 1100, y: 900 },
    { kind: 'horror_plant', x: 500, y: 1050 },
    { kind: 'horror_plant', x: 900, y: 700, scale: 1.3 },
    { kind: 'horror_plant', x: 700, y: 1150 },
    { kind: 'horror_plant', x: 1300, y: 800, scale: 0.9 },
    { kind: 'ruin', x: 550, y: 160 },
    { kind: 'ruin', x: 1000, y: 1150 },
    { kind: 'rock', x: 200, y: 900 },
    { kind: 'rock', x: 1350, y: 300 },
    { kind: 'skull_pile', x: 130, y: 1170 },
    { kind: 'skull_pile', x: 1370, y: 1180 },
    { kind: 'bones', x: 600, y: 700 },
    { kind: 'bones', x: 850, y: 950 },
    { kind: 'bones', x: 400, y: 300 },
    { kind: 'pot', x: 600, y: 340 },
    { kind: 'pot', x: 616, y: 352, scale: 0.9 },
    { kind: 'pot', x: 890, y: 340 },
    { kind: 'pot', x: 906, y: 352 },
    // Pools of digestive bile in the hive floor — corrosive to stand in (hazard zones).
    { kind: 'poison_pool', x: 760, y: 820, scale: 1.25 },
    { kind: 'poison_pool', x: 1050, y: 600 },
  ]),

  // --- The Infernal Forge (1500x1300) — stalagmite walls, ember crystal, smashable pot
  // caches in the corridors and corners, braziers still lit by something.
  ...area('infernal_forge', [
    { kind: 'stalagmite', x: 120, y: 400 },
    { kind: 'stalagmite', x: 160, y: 540, scale: 1.15 },
    { kind: 'stalagmite', x: 1340, y: 380 },
    { kind: 'stalagmite', x: 1380, y: 520 },
    { kind: 'stalagmite', x: 130, y: 1000 },
    { kind: 'stalagmite', x: 1360, y: 1060, scale: 0.9 },
    { kind: 'crystal', x: 400, y: 800 },
    { kind: 'crystal', x: 1100, y: 760, scale: 1.2 },
    { kind: 'rock', x: 600, y: 1100 },
    { kind: 'rock', x: 900, y: 1140 },
    // Pot caches: entry corridor, mid hall, and the far corners.
    { kind: 'pot', x: 620, y: 340 },
    { kind: 'pot', x: 636, y: 352 },
    { kind: 'pot', x: 610, y: 360, scale: 0.9 },
    { kind: 'pot', x: 880, y: 340 },
    { kind: 'pot', x: 896, y: 352 },
    { kind: 'pot', x: 1320, y: 1180 },
    { kind: 'pot', x: 1336, y: 1168 },
    { kind: 'pot', x: 110, y: 1180, scale: 1.1 },
    { kind: 'crate', x: 560, y: 980 },
    { kind: 'crate', x: 584, y: 996 },
    { kind: 'skull_pile', x: 760, y: 980 },
    { kind: 'bones', x: 300, y: 700 },
    { kind: 'bones', x: 1200, y: 500 },
    // Forge braziers (3 lights, under the 10 cap).
    { kind: 'brazier', x: 500, y: 200 },
    { kind: 'brazier', x: 1000, y: 200 },
    { kind: 'brazier', x: 750, y: 640 },
    // Open lava fissures across the forge floor — searing to cross (hazard zones).
    { kind: 'lava_crack', x: 720, y: 880, scale: 1.2 },
    { kind: 'lava_crack', x: 980, y: 1000 },
    { kind: 'lava_crack', x: 300, y: 460 },
  ]),

  // --- The Frozen Vault (1500x1300) — rimed rock and ice crystal, frozen dead,
  // pots preserved perfectly by the cold.
  ...area('frozen_vault', [
    { kind: 'rock', x: 200, y: 500 },
    { kind: 'rock', x: 260, y: 560, scale: 1.15 },
    { kind: 'rock', x: 1240, y: 480 },
    { kind: 'rock', x: 1300, y: 540 },
    { kind: 'crystal', x: 500, y: 900 },
    { kind: 'crystal', x: 1000, y: 860, scale: 1.25 },
    { kind: 'crystal', x: 180, y: 1100 },
    { kind: 'bones', x: 700, y: 700 },
    { kind: 'bones', x: 760, y: 740 },
    { kind: 'skull_pile', x: 400, y: 1150 },
    // Vault stores, flash-frozen: pots by the entry pillars and the deep shelf.
    { kind: 'pot', x: 560, y: 360 },
    { kind: 'pot', x: 576, y: 372 },
    { kind: 'pot', x: 552, y: 384, scale: 0.9 },
    { kind: 'pot', x: 940, y: 360 },
    { kind: 'pot', x: 956, y: 372 },
    { kind: 'pot', x: 1280, y: 1160 },
    { kind: 'pot', x: 1264, y: 1172, scale: 1.1 },
  ]),

  // --- Hollowroot Caverns (1700x1500) — stalagmite forest, glowing mushroom pockets,
  // crystal landmarks, pots near the mouth and the deep gallery. (The existing shrines at
  // (400,820)/(1320,1040) and chests at (760,560)/(1180,980) from seed.ts stay clear.)
  ...area('hollowroot', [
    { kind: 'stalagmite', x: 150, y: 350 },
    { kind: 'stalagmite', x: 200, y: 470, scale: 1.15 },
    { kind: 'stalagmite', x: 1500, y: 400 },
    { kind: 'stalagmite', x: 1560, y: 520 },
    { kind: 'stalagmite', x: 150, y: 1200 },
    { kind: 'stalagmite', x: 1540, y: 1240, scale: 0.9 },
    { kind: 'stalagmite', x: 900, y: 1000 },
    { kind: 'stalagmite', x: 500, y: 1300 },
    { kind: 'mushroom', x: 350, y: 650 },
    { kind: 'mushroom', x: 390, y: 690 },
    { kind: 'mushroom', x: 370, y: 730, scale: 1.2 },
    { kind: 'mushroom', x: 1200, y: 600 },
    { kind: 'mushroom', x: 1240, y: 640 },
    { kind: 'mushroom', x: 1000, y: 1320 },
    { kind: 'crystal', x: 600, y: 900 },
    { kind: 'crystal', x: 1400, y: 800, scale: 1.3 },
    { kind: 'crystal', x: 250, y: 1000 },
    { kind: 'crystal', x: 950, y: 400 },
    { kind: 'bones', x: 700, y: 1150 },
    { kind: 'bones', x: 1100, y: 500 },
    { kind: 'pot', x: 560, y: 330 },
    { kind: 'pot', x: 576, y: 342, scale: 0.9 },
    { kind: 'pot', x: 1300, y: 1240 },
    { kind: 'pot', x: 1316, y: 1252 },
  ]),

  // --- The Sundered Wastes (2400x2000) — void-warped growths, the bones of a dead
  // civilization, crystal scars.
  ...area('sundered_wastes', [
    { kind: 'horror_plant', x: 600, y: 600 },
    { kind: 'horror_plant', x: 660, y: 650, scale: 1.15 },
    { kind: 'horror_plant', x: 1400, y: 400 },
    { kind: 'horror_plant', x: 1800, y: 1500 },
    { kind: 'horror_plant', x: 1000, y: 1200, scale: 1.3 },
    { kind: 'horror_plant', x: 2000, y: 600 },
    { kind: 'ruin', x: 900, y: 800 },
    { kind: 'ruin', x: 950, y: 860, scale: 0.9 },
    { kind: 'ruin', x: 1600, y: 1100 },
    { kind: 'rock', x: 400, y: 400 },
    { kind: 'rock', x: 1200, y: 1700 },
    { kind: 'rock', x: 2100, y: 300, scale: 1.2 },
    { kind: 'rock', x: 700, y: 1600 },
    { kind: 'skull_pile', x: 1300, y: 900 },
    { kind: 'skull_pile', x: 500, y: 1300 },
    { kind: 'bones', x: 800, y: 500 },
    { kind: 'bones', x: 1700, y: 800 },
    { kind: 'bones', x: 1100, y: 1500 },
    { kind: 'bones', x: 2200, y: 1400 },
    { kind: 'crystal', x: 1500, y: 600, scale: 1.25 },
    { kind: 'crystal', x: 900, y: 1750 },
  ]),

  // --- The Blighted Spire (2400x2000) — corrupted citadel: ruined grandeur, horror
  // overgrowth, braziers the blight keeps burning, pots in the old storerooms.
  ...area('blighted_spire', [
    { kind: 'horror_plant', x: 700, y: 700 },
    { kind: 'horror_plant', x: 760, y: 760, scale: 1.15 },
    { kind: 'horror_plant', x: 1500, y: 500 },
    { kind: 'horror_plant', x: 1200, y: 1300 },
    { kind: 'horror_plant', x: 2000, y: 1000, scale: 1.3 },
    { kind: 'horror_plant', x: 1800, y: 400 },
    { kind: 'horror_plant', x: 900, y: 1600 },
    { kind: 'ruin', x: 500, y: 500 },
    { kind: 'ruin', x: 1100, y: 900, scale: 1.2 },
    { kind: 'ruin', x: 1700, y: 1500 },
    { kind: 'ruin', x: 2100, y: 700 },
    { kind: 'skull_pile', x: 1400, y: 1100 },
    { kind: 'skull_pile', x: 600, y: 1500 },
    { kind: 'bones', x: 900, y: 400 },
    { kind: 'bones', x: 1600, y: 900 },
    { kind: 'bones', x: 1300, y: 1700 },
    { kind: 'rock', x: 400, y: 1400 },
    { kind: 'rock', x: 2200, y: 1600 },
    // Citadel braziers along the processional way (4 lights, under the 10 cap).
    { kind: 'brazier', x: 500, y: 1000 },
    { kind: 'brazier', x: 1000, y: 600 },
    { kind: 'brazier', x: 1500, y: 1200 },
    { kind: 'brazier', x: 2000, y: 1400 },
    // Storeroom pots.
    { kind: 'pot', x: 350, y: 700 },
    { kind: 'pot', x: 366, y: 712, scale: 0.9 },
    { kind: 'pot', x: 1900, y: 800 },
    { kind: 'pot', x: 1916, y: 812 },
  ]),

  // ===================================================================================
  // EXPLORATION PASS — rewards for walking to the far corners. Chests are lootable
  // entities (gold + gear + potions, sometimes runes); shrines grant timed buffs and
  // sit beside a landmark cluster so the buff marks a destination worth remembering.
  // Skipped areas (seed.ts already seeds these kinds; the per-(area,kind) guard would
  // drop duplicates): town has a chest + shrine, hollowroot has 2 chests + 2 shrines.
  // Town also keeps its palisade-ring-only dressing — no landmark clusters there.
  // ===================================================================================

  // --- Gloomwood exploration: chests in three far corners, a stone ring in the
  // southwest, a crystal garden in the northeast, ruins north, a skull grove east,
  // and a thorn hollow on the south edge.
  ...area('wilderness', [
    // Far-corner chests.
    { kind: 'chest', x: 130, y: 130, color: '#b9863f' },
    { kind: 'chest', x: 170, y: 1870, color: '#b9863f' },
    { kind: 'chest', x: 2300, y: 1080, color: '#b9863f' },
    // The Old Ring: standing stones in the deep southwest, a shrine at their heart.
    { kind: 'rock', x: 700, y: 1610 },
    { kind: 'rock', x: 790, y: 1700, scale: 1.1 },
    { kind: 'rock', x: 700, y: 1790 },
    { kind: 'rock', x: 610, y: 1700 },
    { kind: 'rock', x: 764, y: 1636, scale: 0.9 },
    { kind: 'rock', x: 636, y: 1764 },
    { kind: 'shrine', x: 690, y: 1690, color: '#7fd0ff' },
    { kind: 'pot', x: 820, y: 1660 },
    { kind: 'pot', x: 836, y: 1672, scale: 0.9 },
    // Crystal garden on the northeast cliff, shrine glittering among the spars.
    { kind: 'crystal', x: 2010, y: 150 },
    { kind: 'crystal', x: 2090, y: 160 },
    { kind: 'crystal', x: 2050, y: 240 },
    { kind: 'crystal', x: 1980, y: 220 },
    { kind: 'crystal', x: 2110, y: 230, scale: 1.3 },
    { kind: 'shrine', x: 2080, y: 170, color: '#9a7fff' },
    // The Hanging Grove: dead trees and a skull pile, east of center.
    { kind: 'dead_tree', x: 1610, y: 1190 },
    { kind: 'dead_tree', x: 1700, y: 1230, scale: 1.15 },
    { kind: 'dead_tree', x: 1640, y: 1320 },
    { kind: 'skull_pile', x: 1660, y: 1260 },
    { kind: 'bones', x: 1590, y: 1280 },
    // A ruined arch circle on the north road, pots still stacked inside.
    { kind: 'ruin', x: 700, y: 220 },
    { kind: 'ruin', x: 820, y: 220, scale: 1.1 },
    { kind: 'ruin', x: 700, y: 300 },
    { kind: 'ruin', x: 820, y: 300 },
    { kind: 'pot', x: 760, y: 340 },
    { kind: 'pot', x: 776, y: 352, scale: 0.9 },
    // Thorn hollow along the south edge, between the marsh road and the crypt.
    { kind: 'thorn_plant', x: 1520, y: 1780 },
    { kind: 'thorn_plant', x: 1610, y: 1800 },
    { kind: 'thorn_plant', x: 1540, y: 1870 },
    { kind: 'thorn_plant', x: 1620, y: 1860, scale: 1.1 },
    { kind: 'bones', x: 1570, y: 1830 },
  ]),

  // --- Shadow Crypt exploration: corner chests, and a grave-ring shrine in the
  // south hall lit by two extra candles (8 lights total, under the 10 cap).
  ...area('crypt', [
    { kind: 'chest', x: 1290, y: 130, color: '#b9863f' },
    { kind: 'chest', x: 130, y: 1290, color: '#b9863f' },
    { kind: 'shrine', x: 700, y: 900, color: '#8c93a8' },
    { kind: 'grave', x: 640, y: 840 },
    { kind: 'grave', x: 760, y: 840 },
    { kind: 'grave', x: 640, y: 960, scale: 1.1 },
    { kind: 'grave', x: 760, y: 960 },
    { kind: 'candle', x: 660, y: 900 },
    { kind: 'candle', x: 740, y: 900 },
  ]),

  // --- Rotfen Marsh exploration: corner chests, a mushroom fairy ring southwest,
  // witch-stones east, a drowned grove northeast, causeway ruins west, a bone fen south.
  ...area('marsh', [
    { kind: 'chest', x: 140, y: 140, color: '#b9863f' },
    { kind: 'chest', x: 2070, y: 1660, color: '#b9863f' },
    { kind: 'chest', x: 2060, y: 170, color: '#b9863f' },
    // The fairy ring: glowing mushrooms in a perfect circle, a shrine at the center.
    { kind: 'mushroom', x: 380, y: 1410 },
    { kind: 'mushroom', x: 450, y: 1450 },
    { kind: 'mushroom', x: 450, y: 1540, scale: 1.2 },
    { kind: 'mushroom', x: 380, y: 1580 },
    { kind: 'mushroom', x: 310, y: 1540 },
    { kind: 'mushroom', x: 310, y: 1450 },
    { kind: 'shrine', x: 370, y: 1500, color: '#9fd86a' },
    // The witch-stones: four leaning rocks east, a second shrine between them.
    { kind: 'rock', x: 1820, y: 770 },
    { kind: 'rock', x: 1905, y: 800, scale: 1.15 },
    { kind: 'rock', x: 1900, y: 890 },
    { kind: 'rock', x: 1815, y: 870 },
    { kind: 'shrine', x: 1862, y: 832, color: '#7fffd0' },
    // Drowned grove in the northeast shallows.
    { kind: 'dead_tree', x: 1930, y: 250 },
    { kind: 'dead_tree', x: 2040, y: 270 },
    { kind: 'dead_tree', x: 1960, y: 360, scale: 1.15 },
    { kind: 'dead_tree', x: 2050, y: 380 },
    { kind: 'bones', x: 1990, y: 320 },
    // The old causeway: ruined arches west, pots unlooted between them.
    { kind: 'ruin', x: 250, y: 760 },
    { kind: 'ruin', x: 360, y: 760, scale: 0.9 },
    { kind: 'ruin', x: 250, y: 860 },
    { kind: 'ruin', x: 360, y: 860 },
    { kind: 'pot', x: 300, y: 810 },
    { kind: 'pot', x: 316, y: 822 },
    // Bone fen south of center — something feeds here.
    { kind: 'bones', x: 860, y: 1560 },
    { kind: 'bones', x: 950, y: 1580 },
    { kind: 'bones', x: 880, y: 1650 },
    { kind: 'skull_pile', x: 920, y: 1620 },
    { kind: 'thorn_plant', x: 820, y: 1620 },
  ]),

  // --- Emberdeep Mines exploration: chests in the deep southeast gallery and the
  // northwest dead-end, and a crystal-garden shrine on the east wall.
  ...area('mines', [
    { kind: 'chest', x: 1760, y: 1560, color: '#b9863f' },
    { kind: 'chest', x: 140, y: 150, color: '#b9863f' },
    { kind: 'shrine', x: 1700, y: 900, color: '#ff8a3a' },
    { kind: 'crystal', x: 1650, y: 850 },
    { kind: 'crystal', x: 1760, y: 860, scale: 1.2 },
    { kind: 'crystal', x: 1680, y: 960 },
    { kind: 'crystal', x: 1770, y: 950 },
    { kind: 'pot', x: 1720, y: 1590 },
    { kind: 'pot', x: 1736, y: 1602, scale: 1.1 },
  ]),

  // --- Frostpeak Pass exploration: corner chests, a frozen monolith ring northwest,
  // an ice garden southeast, a dead stand southwest, cairns north, an avalanche
  // bonefield on the south edge.
  ...area('frostpeak', [
    { kind: 'chest', x: 140, y: 150, color: '#b9863f' },
    { kind: 'chest', x: 150, y: 1850, color: '#b9863f' },
    { kind: 'chest', x: 2060, y: 1860, color: '#b9863f' },
    // The monolith ring: rimed stones and ice spars, a shrine frozen at the center.
    { kind: 'rock', x: 340, y: 210 },
    { kind: 'rock', x: 425, y: 300, scale: 1.1 },
    { kind: 'rock', x: 340, y: 390 },
    { kind: 'rock', x: 255, y: 300 },
    { kind: 'crystal', x: 400, y: 240, scale: 1.1 },
    { kind: 'crystal', x: 280, y: 360 },
    { kind: 'shrine', x: 340, y: 300, color: '#cfe6ff' },
    // The ice garden: crystal spars in the southeast lee, a second shrine among them.
    { kind: 'crystal', x: 1900, y: 1480 },
    { kind: 'crystal', x: 2010, y: 1500 },
    { kind: 'crystal', x: 1930, y: 1600 },
    { kind: 'crystal', x: 2020, y: 1590, scale: 1.25 },
    { kind: 'crystal', x: 1860, y: 1560 },
    { kind: 'shrine', x: 1950, y: 1540, color: '#7fd0ff' },
    // A stand that died on its feet, southwest.
    { kind: 'dead_tree', x: 310, y: 1650 },
    { kind: 'dead_tree', x: 400, y: 1680 },
    { kind: 'dead_tree', x: 330, y: 1760, scale: 1.1 },
    { kind: 'bones', x: 380, y: 1740 },
    { kind: 'skull_pile', x: 300, y: 1710 },
    // Cairn field along the north ridge, travellers' pots beside the markers.
    { kind: 'rock', x: 1660, y: 150 },
    { kind: 'rock', x: 1750, y: 170 },
    { kind: 'rock', x: 1690, y: 250 },
    { kind: 'rock', x: 1780, y: 240, scale: 0.9 },
    { kind: 'skull_pile', x: 1720, y: 200 },
    { kind: 'pot', x: 1630, y: 230 },
    { kind: 'pot', x: 1646, y: 242, scale: 0.9 },
    // Avalanche bonefield on the south edge — what the slide buried.
    { kind: 'bones', x: 1260, y: 1810 },
    { kind: 'bones', x: 1350, y: 1830 },
    { kind: 'bones', x: 1280, y: 1890 },
    { kind: 'dead_tree', x: 1380, y: 1880 },
    { kind: 'rock', x: 1220, y: 1860, scale: 1.2 },
  ]),

  // --- The Forgotten Catacombs exploration: corner chests and a grave-flanked shrine
  // deep in the south hall.
  ...area('forgotten_catacombs', [
    { kind: 'chest', x: 1390, y: 1190, color: '#b9863f' },
    { kind: 'chest', x: 130, y: 150, color: '#b9863f' },
    { kind: 'shrine', x: 750, y: 1100, color: '#9a7fff' },
    { kind: 'grave', x: 690, y: 1040 },
    { kind: 'grave', x: 810, y: 1040 },
    { kind: 'grave', x: 750, y: 1160, scale: 1.1 },
  ]),

  // --- The Shattered Rift exploration: corner chests and a void-crystal shrine at the
  // bottom of the rift.
  ...area('rift', [
    { kind: 'chest', x: 1380, y: 160, color: '#b9863f' },
    { kind: 'chest', x: 140, y: 1180, color: '#b9863f' },
    { kind: 'shrine', x: 750, y: 1230, color: '#b08aff' },
    { kind: 'crystal', x: 690, y: 1180 },
    { kind: 'crystal', x: 810, y: 1180, scale: 1.2 },
  ]),

  // --- The Writhing Hive exploration: chests in the southeast nook and the west wall
  // dead-end, and a shrine the growths have not yet swallowed.
  ...area('writhing_hive', [
    { kind: 'chest', x: 1310, y: 1230, color: '#b9863f' },
    { kind: 'chest', x: 130, y: 640, color: '#b9863f' },
    { kind: 'shrine', x: 770, y: 1180, color: '#9fd86a' },
    { kind: 'horror_plant', x: 710, y: 1230 },
    { kind: 'horror_plant', x: 830, y: 1210, scale: 0.9 },
  ]),

  // --- The Infernal Forge exploration: corner chests and a forge-shrine kept lit by
  // one more brazier (4 lights total, under the 10 cap).
  ...area('infernal_forge', [
    { kind: 'chest', x: 1390, y: 150, color: '#b9863f' },
    { kind: 'chest', x: 140, y: 640, color: '#b9863f' },
    { kind: 'shrine', x: 750, y: 1180, color: '#ff8a3a' },
    { kind: 'stalagmite', x: 690, y: 1130 },
    { kind: 'stalagmite', x: 810, y: 1140, scale: 1.1 },
    { kind: 'brazier', x: 750, y: 1120 },
  ]),

  // --- Duskhaven (frontier village, 1500x1100): a modest refuge cache — one chest
  // tucked behind the southwest huts, and a cairn shrine on the northwest rise.
  ...area('duskhaven', [
    { kind: 'chest', x: 140, y: 960, color: '#b9863f' },
    { kind: 'shrine', x: 200, y: 210, color: '#cfe6ff' },
    { kind: 'rock', x: 150, y: 160 },
    { kind: 'rock', x: 255, y: 170, scale: 1.1 },
    { kind: 'rock', x: 160, y: 265 },
    { kind: 'pot', x: 260, y: 230 },
    { kind: 'pot', x: 276, y: 242, scale: 0.9 },
  ]),

  // --- The Abyssal Throne exploration: chests in the deep south corners, and a
  // skull-flanked shrine on the approach to the Sovereign.
  ...area('abyssal_throne', [
    { kind: 'chest', x: 1390, y: 1190, color: '#b9863f' },
    { kind: 'chest', x: 130, y: 1180, color: '#b9863f' },
    { kind: 'shrine', x: 750, y: 1150, color: '#ff5a3a' },
    { kind: 'skull_pile', x: 690, y: 1100 },
    { kind: 'skull_pile', x: 810, y: 1110, scale: 1.2 },
    { kind: 'ruin', x: 640, y: 1180 },
    { kind: 'ruin', x: 860, y: 1180 },
  ]),

  // --- The Frozen Vault exploration: corner chests and an ice-crystal shrine in the
  // deep south chamber.
  ...area('frozen_vault', [
    { kind: 'chest', x: 1390, y: 1190, color: '#b9863f' },
    { kind: 'chest', x: 130, y: 150, color: '#b9863f' },
    { kind: 'shrine', x: 750, y: 1150, color: '#7fffd0' },
    { kind: 'crystal', x: 690, y: 1100 },
    { kind: 'crystal', x: 810, y: 1110, scale: 1.2 },
  ]),

  // --- The Sundered Wastes exploration: corner chests, a ruin circle north, a
  // void-crystal garden south, a horror grove northeast, a titan ribcage west, and a
  // shattered monolith field southeast.
  ...area('sundered_wastes', [
    { kind: 'chest', x: 2280, y: 160, color: '#b9863f' },
    { kind: 'chest', x: 2260, y: 1880, color: '#b9863f' },
    { kind: 'chest', x: 300, y: 150, color: '#b9863f' },
    // A circle of broken arches on the north rim, a shrine at the focus.
    { kind: 'ruin', x: 1140, y: 250 },
    { kind: 'ruin', x: 1260, y: 250 },
    { kind: 'ruin', x: 1140, y: 360 },
    { kind: 'ruin', x: 1260, y: 360, scale: 1.1 },
    { kind: 'shrine', x: 1200, y: 300, color: '#c08adf' },
    { kind: 'pot', x: 1300, y: 300 },
    { kind: 'pot', x: 1316, y: 312, scale: 0.9 },
    // Void-crystal garden in the deep south, a second shrine humming among the spars.
    { kind: 'crystal', x: 1650, y: 1700 },
    { kind: 'crystal', x: 1760, y: 1720, scale: 1.3 },
    { kind: 'crystal', x: 1680, y: 1810 },
    { kind: 'crystal', x: 1770, y: 1800 },
    { kind: 'crystal', x: 1620, y: 1770 },
    { kind: 'shrine', x: 1700, y: 1750, color: '#b08aff' },
    // Horror grove on the northeast rim.
    { kind: 'horror_plant', x: 2060, y: 350 },
    { kind: 'horror_plant', x: 2150, y: 380 },
    { kind: 'horror_plant', x: 2080, y: 460, scale: 1.2 },
    { kind: 'bones', x: 2140, y: 440 },
    { kind: 'skull_pile', x: 2020, y: 420 },
    // The titan ribcage: the bones of something civilization-sized, west of the road.
    { kind: 'bones', x: 460, y: 460 },
    { kind: 'bones', x: 540, y: 470 },
    { kind: 'bones', x: 470, y: 550 },
    { kind: 'bones', x: 550, y: 540 },
    { kind: 'skull_pile', x: 505, y: 505, scale: 1.3 },
    // Shattered monolith field, southeast.
    { kind: 'rock', x: 1960, y: 1450 },
    { kind: 'rock', x: 2050, y: 1480, scale: 1.25 },
    { kind: 'rock', x: 1980, y: 1560 },
    { kind: 'crystal', x: 2060, y: 1550 },
    { kind: 'bones', x: 1920, y: 1520 },
  ]),

  // --- The Blighted Spire exploration: chests at the far corners from the west gate,
  // a ruined chapel north (2 more candles: 6 lights total, under the 10 cap), an
  // overgrown cloister southwest, a skull cairn northeast, a blight garden east, and
  // a fallen colonnade northwest.
  ...area('blighted_spire', [
    { kind: 'chest', x: 2280, y: 150, color: '#b9863f' },
    { kind: 'chest', x: 2290, y: 1870, color: '#b9863f' },
    { kind: 'chest', x: 1200, y: 1880, color: '#b9863f' },
    // The ruined chapel: four arches, a shrine still tended by candlelight.
    { kind: 'ruin', x: 1790, y: 195 },
    { kind: 'ruin', x: 1910, y: 195, scale: 1.2 },
    { kind: 'ruin', x: 1790, y: 315 },
    { kind: 'ruin', x: 1910, y: 315 },
    { kind: 'shrine', x: 1850, y: 255, color: '#aef07a' },
    { kind: 'candle', x: 1820, y: 255 },
    { kind: 'candle', x: 1880, y: 255 },
    // The overgrown cloister: blight eating the old stone, a second shrine inside.
    { kind: 'ruin', x: 650, y: 1750 },
    { kind: 'ruin', x: 760, y: 1760 },
    { kind: 'horror_plant', x: 680, y: 1850, scale: 1.2 },
    { kind: 'horror_plant', x: 740, y: 1820 },
    { kind: 'shrine', x: 700, y: 1795, color: '#9fd86a' },
    { kind: 'pot', x: 620, y: 1800 },
    { kind: 'pot', x: 636, y: 1812, scale: 0.9 },
    // Skull cairn on the northeast battlement.
    { kind: 'skull_pile', x: 2110, y: 460 },
    { kind: 'skull_pile', x: 2190, y: 480, scale: 1.2 },
    { kind: 'bones', x: 2130, y: 540 },
    { kind: 'bones', x: 2200, y: 530 },
    { kind: 'rock', x: 2070, y: 510 },
    // Blight garden east of the processional way.
    { kind: 'horror_plant', x: 1460, y: 1550 },
    { kind: 'horror_plant', x: 1550, y: 1570 },
    { kind: 'horror_plant', x: 1480, y: 1650 },
    { kind: 'bones', x: 1540, y: 1630 },
    { kind: 'skull_pile', x: 1500, y: 1600 },
    // Fallen colonnade, northwest of the gate road.
    { kind: 'ruin', x: 440, y: 200 },
    { kind: 'ruin', x: 560, y: 200 },
    { kind: 'ruin', x: 440, y: 300 },
    { kind: 'ruin', x: 560, y: 300, scale: 0.9 },
    { kind: 'pot', x: 500, y: 250 },
    { kind: 'pot', x: 516, y: 262 },
  ]),

  // ===================================================================================
  // Acts exploration pass — chests + shrines for the Act 2 road and Act 3 areas
  // (seed-acts.ts owns their landmark dressing; ONLY the chest/shrine kinds live here
  // so the per-(area,kind) seed guards never collide between the two packs).
  // ===================================================================================
  ...area('grimfrost_barrow', [
    { kind: 'chest', x: 1640, y: 160, color: '#b9863f' },
    { kind: 'chest', x: 1650, y: 1240, color: '#b9863f' },
    { kind: 'shrine', x: 460, y: 500, color: '#cfe6ff' }, // beside the grave rows
  ]),
  ...area('howling_barrens', [
    { kind: 'chest', x: 1640, y: 160, color: '#b9863f' },
    { kind: 'chest', x: 160, y: 1240, color: '#b9863f' },
    { kind: 'shrine', x: 640, y: 340, color: '#9fd8c0' }, // in the leaning pines
  ]),
  ...area('sunken_pass', [
    { kind: 'chest', x: 160, y: 160, color: '#b9863f' },
    { kind: 'chest', x: 1640, y: 1240, color: '#b9863f' },
    { kind: 'shrine', x: 1000, y: 940, color: '#7fa8c0' }, // above the drowned ruin
  ]),
  // Vhal'reth: the chest waits inside the southwest house; the shrine flanks the hearth.
  ...area('vhalreth', [
    { kind: 'chest', x: 360, y: 860, color: '#b9863f' },
    { kind: 'shrine', x: 820, y: 860, color: '#ffd9a0' },
  ]),
  ...area('ashveil_desert', [
    { kind: 'chest', x: 1640, y: 160, color: '#b9863f' },
    { kind: 'chest', x: 300, y: 1240, color: '#b9863f' },
    { kind: 'shrine', x: 900, y: 760, color: '#d8c0a0' }, // by the bleached bones
  ]),
  ...area('shattered_causeway', [
    { kind: 'chest', x: 1640, y: 160, color: '#b9863f' },
    { kind: 'chest', x: 160, y: 1240, color: '#b9863f' },
    { kind: 'shrine', x: 1300, y: 560, color: '#a8a0c8' }, // under the fallen span
  ]),
  ...area('voidmarch', [
    { kind: 'chest', x: 1640, y: 160, color: '#b9863f' },
    { kind: 'chest', x: 1640, y: 1240, color: '#b9863f' },
    { kind: 'shrine', x: 1200, y: 960, color: '#b07ae8' }, // beneath the void crystal
  ]),
  ...area('the_unmade_court', [
    { kind: 'chest', x: 1390, y: 1190, color: '#b9863f' },
    { kind: 'chest', x: 130, y: 1180, color: '#b9863f' },
    { kind: 'shrine', x: 750, y: 1150, color: '#c89aff' }, // the approach to the Court
  ]),
];
