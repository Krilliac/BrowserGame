/**
 * Per-biome ground tilesets for the renderer's tiled ground. Pure data + pure picking logic —
 * no Pixi, no DOM — so the mapping stays unit-testable (same pattern as rogues-sprites.ts).
 *
 * The renderer bakes a pattern canvas by stamping weighted random floor tiles from one of these
 * sets (one `pickTile` call per pattern cell), then TilingSprites it across the area. Weights let
 * a plain base tile dominate with occasional detail variants (cracks, flowers, rubble).
 *
 * Every tile below was picked by eye from the source sheet as a FULL floor tile (opaque, no wall
 * faces, no edge-shadows, no object overlays) and verified fully opaque. Regions used per sheet
 * (cell coordinates are 0-indexed {col,row} at the sheet's native tile size):
 *
 * - forest_spring.png / forest_autumn.png (Mana Seed seasonal sample, 16px): col 0 rows 1-5 are
 *   pure grass (left of the dirt-patch demo); rows 6-7 cols 0-3 are flower / fallen-leaf variants
 *   drawn on the same grass.
 * - dungeon_floor.png (CraftPix top-down-dungeon walls_floor.png, 16px): the plain slate floor —
 *   interior tiles of the floor demo at cols 3-5 rows 5-7 plus the platform interior (1,6)/(1,7).
 *   (3,6) was excluded: it contains a semi-transparent trim pixel.
 * - catacombs.png (Szadi rf-catacombs mainlevbuild.png, 16px): the floor-variant strip on the
 *   right of the sheet — 2x3 slab blocks at rows 13-15 and 2x2 cobble blocks at rows 17-18; this
 *   game uses the warm dark-grey family at cols 49-50.
 * - cursed_ground.png (CraftPix cursed-land Ground.png, 16px): solid interior tiles only — the
 *   plain dusty-mauve column 24 rows 4-7, plus full vein-overgrowth tiles at cols 19-20 rows 5-6.
 * - undead_ground.png (CraftPix undead Ground_rocks.png, 16px): the cracked dead-earth interior
 *   strip at row 22, cols 20 and 22-26 ((21,22) skipped — a prop shadow clips its bottom edge).
 * - rogues_tiles.png (32rogues tiles.png, 32px, labels in tiles.txt): floor rows — dark-grey
 *   blank + floor stones (txt row 7 = sheet row 6), dirt (row 9 = sheet 8), red stone floor
 *   (row 12 = sheet 11), blue stone floor (row 13 = sheet 12), green-bg dirt/grass (rows 14-15 =
 *   sheets 13-14).
 */

export interface GroundTileset {
  /** Web path of the sheet, served from the Vite web root (`public/`). */
  src: string;
  /** Source tile edge in px (16 for the CraftPix/Mana Seed/Szadi sheets, 32 for 32rogues). */
  tileSize: number;
  /** Stampable full-floor tiles; `weight` is the relative pick frequency. */
  tiles: { col: number; row: number; weight: number }[];
  /**
   * Optional patch-blend metadata (RENDER-04 — tile-edge blending / autotiling). When present, the
   * bake stops lattice-scattering detail tiles and instead clusters `patch` tiles into organic
   * blobs driven by deterministic value-noise, fading them in at the blob edges so transitions read
   * as soft patches rather than a hard grid of lone squares. Tilesets WITHOUT this field bake
   * byte-identically to before (the regression guard): the blend branch never runs for them.
   *
   * When a tileset opts in, its `tiles` array is the plain base floor (no detail variants) and the
   * detail tiles move here into `patch`.
   */
  blend?: {
    /** Detail tiles drawn as clustered patches over the base (e.g. wildflower beds, leaf piles). */
    patch: { col: number; row: number }[];
    /** Noise feature size in cells — larger makes bigger, smoother blobs. */
    scale: number;
    /** Noise cutoff 0..1; higher → smaller, rarer patches. */
    threshold: number;
    /** Edge softness 0..1 around the cutoff; the fade band where patches dither into the base. */
    margin?: number;
  };
}

const TILES = '/assets/curated/tiles';

export const GROUND_TILESETS: Record<string, GroundTileset> = {
  // Generated meadow (tools/assetgen/tiles) — our own art, replacing the licensed Mana Seed grass for
  // the village green. Base-heavy weighted tiles + a clustered wildflower blend (RENDER-04).
  meadow: {
    src: `${TILES}/meadow.png`,
    tileSize: 32,
    tiles: [
      { col: 0, row: 0, weight: 60 },
      { col: 1, row: 0, weight: 6 },
      { col: 2, row: 0, weight: 6 },
      { col: 3, row: 0, weight: 6 },
      { col: 0, row: 1, weight: 6 },
      { col: 1, row: 1, weight: 6 },
      { col: 2, row: 1, weight: 6 },
    ],
    blend: {
      patch: [
        { col: 3, row: 1 },
        { col: 0, row: 2 },
        { col: 1, row: 2 },
        { col: 2, row: 2 },
        { col: 3, row: 2 },
        { col: 0, row: 3 },
        { col: 1, row: 3 },
        { col: 2, row: 3 },
        { col: 3, row: 3 },
      ],
      scale: 5,
      threshold: 0.6,
      margin: 0.1,
    },
  },
  // Aldermere village green — bright spring grass with wildflower patches clustered into beds.
  town: {
    src: `${TILES}/forest_spring.png`,
    tileSize: 16,
    tiles: [
      { col: 0, row: 1, weight: 18 },
      { col: 0, row: 2, weight: 18 },
      { col: 0, row: 3, weight: 18 },
      { col: 0, row: 4, weight: 18 },
      { col: 0, row: 5, weight: 18 },
    ],
    blend: {
      patch: [
        { col: 0, row: 6 }, // pink wildflowers
        { col: 1, row: 6 }, // blue wildflowers
        { col: 2, row: 7 },
        { col: 3, row: 7 },
      ],
      scale: 5,
      threshold: 0.62,
      margin: 0.1,
    },
  },
  // Gloomwood — the same grass, near-plain; the area's dark grade does the brooding.
  forest: {
    src: `${TILES}/forest_spring.png`,
    tileSize: 16,
    tiles: [
      { col: 0, row: 1, weight: 19 },
      { col: 0, row: 2, weight: 19 },
      { col: 0, row: 3, weight: 19 },
      { col: 0, row: 4, weight: 19 },
      { col: 0, row: 5, weight: 19 },
    ],
    blend: {
      patch: [
        { col: 1, row: 6 },
        { col: 3, row: 6 },
        { col: 0, row: 7 },
      ],
      scale: 6,
      threshold: 0.68,
      margin: 0.1,
    },
  },
  // Seasonal variant of the grass biomes (no area defaults to it; available to DB re-skins).
  forest_autumn: {
    src: `${TILES}/forest_autumn.png`,
    tileSize: 16,
    tiles: [
      { col: 0, row: 1, weight: 12 },
      { col: 0, row: 2, weight: 12 },
      { col: 0, row: 3, weight: 12 },
      { col: 0, row: 4, weight: 12 },
      { col: 0, row: 5, weight: 12 },
    ],
    blend: {
      patch: [
        { col: 0, row: 6 }, // fallen-leaf piles
        { col: 1, row: 6 },
        { col: 2, row: 6 },
        { col: 3, row: 6 },
        { col: 0, row: 7 },
        { col: 1, row: 7 },
        { col: 2, row: 7 },
        { col: 3, row: 7 },
      ],
      scale: 4,
      threshold: 0.5,
      margin: 0.12,
    },
  },
  // Rotfen Marsh — 32rogues dark-green floor with dirt clumps and grass tufts poking through.
  marsh: {
    src: `${TILES}/rogues_tiles.png`,
    tileSize: 32,
    tiles: [
      { col: 0, row: 13, weight: 70 },
      { col: 1, row: 13, weight: 5 }, // dirt on green
      { col: 2, row: 13, weight: 5 },
      { col: 3, row: 13, weight: 5 },
      { col: 1, row: 14, weight: 5 }, // grass tufts on green
      { col: 2, row: 14, weight: 5 },
      { col: 3, row: 14, weight: 5 },
    ],
  },
  // Emberdeep Mines / Infernal Forge — red-black volcanic stone floor.
  mine: {
    src: `${TILES}/rogues_tiles.png`,
    tileSize: 32,
    tiles: [
      { col: 0, row: 11, weight: 70 },
      { col: 1, row: 11, weight: 10 }, // red stone slabs
      { col: 2, row: 11, weight: 10 },
      { col: 3, row: 11, weight: 10 },
    ],
  },
  // Frostpeak Pass / Frozen Vault — blue-black glacial stone floor.
  frost: {
    src: `${TILES}/rogues_tiles.png`,
    tileSize: 32,
    tiles: [
      { col: 0, row: 12, weight: 70 },
      { col: 1, row: 12, weight: 10 }, // blue stone slabs
      { col: 2, row: 12, weight: 10 },
      { col: 3, row: 12, weight: 10 },
    ],
  },
  // Hollowroot Caverns — dark cave floor with loose stones and dirt.
  cave: {
    src: `${TILES}/rogues_tiles.png`,
    tileSize: 32,
    tiles: [
      { col: 0, row: 6, weight: 64 },
      { col: 1, row: 6, weight: 8 }, // floor stones
      { col: 2, row: 6, weight: 8 },
      { col: 3, row: 6, weight: 8 },
      { col: 1, row: 8, weight: 4 }, // dirt clumps
      { col: 2, row: 8, weight: 4 },
      { col: 3, row: 8, weight: 4 },
    ],
  },
  // Generic worked-stone floor (Blighted Spire citadel) — plain slate, all tiles equal.
  dungeon: {
    src: `${TILES}/dungeon_floor.png`,
    tileSize: 16,
    tiles: [
      { col: 3, row: 5, weight: 1 },
      { col: 4, row: 5, weight: 1 },
      { col: 5, row: 5, weight: 1 },
      { col: 3, row: 7, weight: 1 },
      { col: 1, row: 6, weight: 1 },
      { col: 1, row: 7, weight: 1 },
    ],
  },
  // Shadow Crypt / Forgotten Catacombs — dark stone slabs with patches of cobbled rubble.
  crypt: {
    src: `${TILES}/catacombs.png`,
    tileSize: 16,
    tiles: [
      { col: 49, row: 13, weight: 14 },
      { col: 50, row: 13, weight: 14 },
      { col: 49, row: 14, weight: 14 },
      { col: 50, row: 14, weight: 14 },
      { col: 49, row: 15, weight: 14 },
      { col: 50, row: 15, weight: 14 },
      { col: 49, row: 17, weight: 4 }, // cobbled rubble
      { col: 50, row: 17, weight: 4 },
      { col: 49, row: 18, weight: 4 },
      { col: 50, row: 18, weight: 4 },
    ],
  },
  // The Writhing Hive — dusty mauve earth overrun by patches of fleshy red veins.
  cursed: {
    src: `${TILES}/cursed_ground.png`,
    tileSize: 16,
    tiles: [
      { col: 24, row: 4, weight: 21 },
      { col: 24, row: 5, weight: 21 },
      { col: 24, row: 6, weight: 21 },
      { col: 24, row: 7, weight: 21 },
      { col: 19, row: 5, weight: 4 }, // vein overgrowth
      { col: 20, row: 5, weight: 4 },
      { col: 19, row: 6, weight: 4 },
      { col: 20, row: 6, weight: 4 },
    ],
  },
  // The Sundered Wastes — cracked, dead earth; every tile is a crack variant, equal mix.
  graveyard: {
    src: `${TILES}/undead_ground.png`,
    tileSize: 16,
    tiles: [
      { col: 20, row: 22, weight: 1 },
      { col: 22, row: 22, weight: 1 },
      { col: 23, row: 22, weight: 1 },
      { col: 24, row: 22, weight: 1 },
      { col: 25, row: 22, weight: 1 },
      { col: 26, row: 22, weight: 1 },
    ],
  },
};

/** Every area seeded in shared/areas.ts → its biome key (dungeons reuse overworld biomes). */
const AREA_BIOME: Record<string, string> = {
  town: 'meadow', // generated meadow (our art) instead of the licensed grass pack
  wilderness: 'forest',
  marsh: 'marsh',
  crypt: 'crypt',
  mines: 'mine',
  frostpeak: 'frost',
  hollowroot: 'cave',
  forgotten_catacombs: 'crypt',
  writhing_hive: 'cursed',
  infernal_forge: 'mine',
  frozen_vault: 'frost',
  sundered_wastes: 'graveyard',
  blighted_spire: 'dungeon',
  rift: 'cursed', // the endgame rift — otherworldly corrupted ground fits its violet theme
  duskhaven: 'frost', // the mountain village sits on glacial stone
  abyssal_throne: 'cursed', // the deepest dark — corrupted ground under the Black Throne
  // Act 2 road (seed-acts.ts).
  grimfrost_barrow: 'frost', // a graveyard cut into glacial ice
  howling_barrens: 'forest', // wind-bent pines; the grey grade does the howling
  sunken_pass: 'marsh', // a drowned road — waterlogged dark ground
  // Act 3 (seed-acts.ts).
  vhalreth: 'dungeon', // the last city stands on worked stone
  ashveil_desert: 'graveyard', // cracked dead earth under the ash
  shattered_causeway: 'crypt', // broken stone slabs and rubble
  voidmarch: 'cursed', // the world fraying into the void
  the_unmade_court: 'cursed', // past the end of the world
};

/**
 * Resolve an area to its ground tileset, or undefined to keep the renderer's procedural ground.
 * Accepts instance ids too (`${areaId}#${seq}`, see server/instance-manager.ts). Areas the map
 * doesn't know (added live via the content DB) are classified coarsely from their theme's
 * groundBase color so a brand-new green zone still gets grass instead of speckle.
 */
export function groundTilesetFor(areaId: string, groundBase: string): GroundTileset | undefined {
  const baseId = areaId.split('#', 1)[0] ?? areaId;
  const biome = AREA_BIOME[baseId];
  if (biome) return GROUND_TILESETS[biome];

  const m = /^#?([0-9a-f]{6})$/i.exec(groundBase.trim());
  if (!m) return undefined;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  if ((r + g + b) / 3 > 150) return GROUND_TILESETS['frost']; // pale → snow/ice
  if (g > r && g >= b) return GROUND_TILESETS['forest']; // green-dominant → grass
  return undefined;
}

/** Same integer hash the renderer uses for prop scatter — keeps pattern bakes deterministic. */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 1000) / 1000;
}

/** Deterministic weighted tile pick for pattern cell (gx, gy). */
export function pickTile(ts: GroundTileset, gx: number, gy: number): { col: number; row: number } {
  let total = 0;
  for (const t of ts.tiles) total += t.weight;
  let roll = hash2(gx, gy) * total;
  for (const t of ts.tiles) {
    roll -= t.weight;
    if (roll < 0) return { col: t.col, row: t.row };
  }
  // Unreachable for non-empty tile lists (hash2 < 1), but keeps the function total.
  const last = ts.tiles[ts.tiles.length - 1];
  return last ? { col: last.col, row: last.row } : { col: 0, row: 0 };
}

/** Smoothstep weight for value-noise interpolation (Perlin's 3t²−2t³ fade). */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Deterministic smooth value-noise in [0, 1), built from the same `hash2` lattice as the prop
 * scatter so a bake stays reproducible. `scale` is the feature size in cells: bilinear-interpolating
 * the integer lattice at `1/scale` resolution turns the white-noise hash into coherent blobs, which
 * is what lets patches cluster instead of speckling one cell at a time. (RENDER-04.)
 */
export function valueNoise(gx: number, gy: number, scale: number): number {
  const s = Math.max(1, scale);
  const fx = gx / s;
  const fy = gy / s;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const n00 = hash2(x0, y0);
  const n10 = hash2(x0 + 1, y0);
  const n01 = hash2(x0, y0 + 1);
  const n11 = hash2(x0 + 1, y0 + 1);
  const nx0 = n00 + (n10 - n00) * tx;
  const nx1 = n01 + (n11 - n01) * tx;
  return nx0 + (nx1 - nx0) * ty;
}

/**
 * Patch coverage in [0, 1] for cell (gx, gy): 0 = pure base ground, 1 = solid patch, fractional =
 * the soft dither band at a patch edge (used as the draw alpha so patch tiles fade into the base).
 * Returns 0 for tilesets that didn't opt into blending — the regression guard for un-annotated sets.
 */
export function patchCoverage(ts: GroundTileset, gx: number, gy: number): number {
  const b = ts.blend;
  if (!b) return 0;
  const n = valueNoise(gx, gy, b.scale);
  const m = b.margin ?? 0.1;
  const lo = b.threshold - m;
  const hi = b.threshold + m;
  if (n <= lo) return 0;
  if (n >= hi) return 1;
  return smooth((n - lo) / (hi - lo));
}

/**
 * Which patch tile to stamp at cell (gx, gy), or undefined when the tileset has no patch tiles.
 * Deterministic and offset off the base hash so the patch-variant choice is independent of which
 * base grass tile landed underneath.
 */
export function patchTileFor(
  ts: GroundTileset,
  gx: number,
  gy: number,
): { col: number; row: number } | undefined {
  const patch = ts.blend?.patch;
  if (!patch || patch.length === 0) return undefined;
  const idx = Math.floor(hash2(gx + 9173, gy + 1471) * patch.length) % patch.length;
  return patch[idx];
}
