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
];
