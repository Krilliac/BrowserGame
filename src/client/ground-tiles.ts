/**
 * Per-biome ground tilesets for the renderer's tiled ground. Pure data + pure picking logic —
 * no Pixi, no DOM — so the mapping stays unit-testable (same pattern as rogues-sprites.ts).
 *
 * The renderer bakes a pattern canvas by stamping weighted random floor tiles from one of these
 * sets (one `pickTile` call per pattern cell), then TilingSprites it across the area. Weights let
 * a plain base tile dominate with occasional detail variants (cracks, flowers, rubble).
 *
 * All terrain art is now original/license-free. Two kinds of sheet:
 *
 * 1. Generated 4×4 sheets (tools/assetgen/tiles → public/assets/tiles, 32px), built via the shared
 *    {@link generatedBiome} layout: meadow, marsh, mine, frost, cave, dungeon, autumn. tile (0,0) is
 *    the heavy base, (1,0)…(2,1) re-seeded variants, rows 2–3 the clustered RENDER-04 detail.
 * 2. Design-system pixel sheets under /assets/curated/tiles (drawn to match the renderer's existing
 *    cell expectations, so the picked coordinates below are stable):
 *    - forest_spring.png (16px): col 0 rows 1-5 pure grass; rows 6-7 cols 0-3 wildflower variants;
 *      col 4 rows 1-3 solid dirt for the worn-path layer.
 *    - catacombs.png (16px): warm dark-grey slab family at cols 49-50 rows 13-15, cobble rubble rows 17-18.
 *    - cursed_ground.png (16px): dusty-mauve col 24 rows 4-7, vein-overgrowth cols 19-20 rows 5-6.
 *    - undead_ground.png (16px): cracked dead-earth strip at row 22, cols 20 and 22-26.
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
    /**
     * Optional worn-dirt-path layer (RENDER toward the Diablo look): winding dirt trails baked UNDER
     * the detail patches, from a seamless ridged wave (see {@link pathCoverage}) so the trails tile
     * across the repeating ground pattern without a seam. Its `tiles` are full dirt floor tiles.
     */
    path?: {
      /** Full dirt floor tiles stamped along the trail (picked per-cell for variety). */
      tiles: { col: number; row: number }[];
      /** Trail coverage cutoff 0..1; higher → thinner, sparser trails. */
      threshold: number;
      /** Edge softness 0..1 — the worn band where dirt fades into the grass. */
      margin?: number;
    };
  };
}

/**
 * The bake stamps a PATTERN_TILES × PATTERN_TILES tile pattern that the renderer then TilingSprites
 * across the area. Anything meant to read as continuous ground (the dirt paths) must be periodic over
 * this span or it shows a seam at every repeat. The renderer imports this so the two never drift.
 */
export const PATTERN_TILES = 16;

const TILES = '/assets/curated/tiles';

/**
 * A generated 4×4 biome sheet (tools/assetgen/tiles → public/assets/tiles, all original/license-free):
 * tile (0,0) is the heavy base, (1,0)…(2,1) are subtle re-seeded base variants, and rows 2–3 are the
 * clustered detail tiles fed to the RENDER-04 blend. Every generated biome shares this layout, so the
 * manifest the generator emits is identical bar the `src` — captured here once instead of inlined.
 */
function generatedBiome(src: string): GroundTileset {
  return {
    src,
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
  };
}

export const GROUND_TILESETS: Record<string, GroundTileset> = {
  // Generated meadow — our own art for the village green (base-heavy + clustered wildflower blend).
  meadow: generatedBiome('/assets/tiles/meadow.png'),
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
      // Worn dirt trails winding through the village green (forest_spring's solid dirt, col 4).
      path: {
        tiles: [
          { col: 4, row: 1 },
          { col: 4, row: 2 },
          { col: 4, row: 3 },
        ],
        threshold: 0.82,
        margin: 0.14,
      },
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
      // Worn dirt trails through the gloom (same forest_spring dirt; a touch wider/more travelled).
      path: {
        tiles: [
          { col: 4, row: 1 },
          { col: 4, row: 2 },
          { col: 4, row: 3 },
        ],
        threshold: 0.6,
        margin: 0.2,
      },
    },
  },
  // Seasonal grass re-skin (no area defaults to it; available to DB re-skins) — generated amber turf.
  forest_autumn: generatedBiome('/assets/tiles/autumn.png'),
  // Rotfen Marsh / Sunken Pass — generated dark waterlogged green with grass-tuft patches.
  marsh: generatedBiome('/assets/tiles/marsh.png'),
  // Emberdeep Mines / Infernal Forge — generated red-black volcanic stone, fissured.
  mine: generatedBiome('/assets/tiles/mine.png'),
  // Frostpeak Pass / Frozen Vault — generated blue-black glacial stone with ice cracks.
  frost: generatedBiome('/assets/tiles/frost.png'),
  // Hollowroot Caverns — generated dark grey-brown cave floor with loose stones.
  cave: generatedBiome('/assets/tiles/cave.png'),
  // Worked-stone citadel floor (Blighted Spire / Vhal'reth) — generated cool slate.
  dungeon: generatedBiome('/assets/tiles/dungeon.png'),
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

/**
 * Worn-dirt-path coverage in [0, 1] for cell (gx, gy): 0 = clear grass, 1 = solid dirt trail,
 * fractional = the worn fade band at a trail edge (used as the draw alpha). Built from a **seamless**
 * ridged wave — a sine phase that winds with position — so the trails tile across the repeating
 * ground pattern (period {@link PATTERN_TILES} on each axis) with no seam, unlike the blob noise.
 * Returns 0 for tilesets without a `path` layer.
 */
export function pathCoverage(ts: GroundTileset, gx: number, gy: number): number {
  const p = ts.blend?.path;
  if (!p) return 0;
  const N = PATTERN_TILES;
  const TAU = Math.PI * 2;
  // A diagonal trail whose centerline meanders: the cos zero-crossings are the trail, warped by a
  // cross-axis sine for an organic wind. Integer frequencies over N keep it exactly periodic on both
  // axes (seamless across the repeat).
  const phase = (TAU / N) * (gx + gy) + 2.2 * Math.sin((TAU / N) * (gx - gy));
  const ridge = 1 - Math.abs(Math.cos(phase)); // 1 on the trail centerline, 0 away from it
  const m = p.margin ?? 0.12;
  const lo = p.threshold - m;
  const hi = p.threshold + m;
  if (ridge <= lo) return 0;
  if (ridge >= hi) return 1;
  return smooth((ridge - lo) / (hi - lo));
}

/** Which dirt tile to stamp along the trail at (gx, gy), or undefined when the set has no path. */
export function pathTileFor(
  ts: GroundTileset,
  gx: number,
  gy: number,
): { col: number; row: number } | undefined {
  const tiles = ts.blend?.path?.tiles;
  if (!tiles || tiles.length === 0) return undefined;
  const idx = Math.floor(hash2(gx + 4423, gy + 7919) * tiles.length) % tiles.length;
  return tiles[idx];
}
