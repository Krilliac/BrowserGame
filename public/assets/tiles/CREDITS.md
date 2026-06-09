# Terrain Tileset Credits — public/assets/tiles/

Curated, license-clean top-down / 2.5D terrain tilesets for BrowserGame's
Diablo/RuneScape fantasy look (grass, dirt/path, stone/dungeon floor, water, cliffs).

License priority used: **CC0 first** (no attribution required), with one **CC-BY 3.0**
transitions sheet (attribution recorded below). **No GPL-only, no ripped commercial assets.**

Total curated set: ~320 KB.

---

## CC0 assets (no attribution legally required; credit appreciated)

### kenney_roguelike_rpg.png
- **Source:** https://kenney.nl/assets/roguelike-rpg-pack (Roguelike/RPG Pack)
- **Author:** Kenney Vleugels (www.kenney.nl), with Lynn Evers
- **License:** CC0 1.0 (public domain) — https://creativecommons.org/publicdomain/zero/1.0/
- **Sheet dimensions:** 968 x 526 px
- **Tile size:** 16 px tiles, **1 px margin + 1 px spacing** between tiles (Kenney standard)
  → 57 columns x 31 rows grid. Tile (col,row) pixel = `(col*17 + 1, row*17 + 1)`.
- **Content:** the broad terrain/town set — grass, dirt, sand, water edges, stone, walls,
  paths, trees, fences, props.
- **How to use:** master overworld atlas. Grass blocks are top-left; water/edges and
  stone/path tiles are further right/down. Use as the primary `town`/`wilderness` ground atlas.

### kenney_dungeon.png
- **Source:** https://kenney.nl/assets/roguelike-caves-dungeons (Roguelike Caves & Dungeons)
- **Author:** Kenney Vleugels (www.kenney.nl)
- **License:** CC0 1.0 (public domain)
- **Sheet dimensions:** 492 x 305 px
- **Tile size:** 16 px tiles, 1 px margin + 1 px spacing → 29 cols x 18 rows.
  Tile (col,row) pixel = `(col*17 + 1, row*17 + 1)`.
- **Content:** cave/dungeon floors, walls, rubble, stairs, doors — fits the `crypt` biome.
- **How to use:** stone/dungeon floor atlas for the crypt area. Floor tiles in the upper-left region.

### oga_grass_beach_water.png
- **Source:** https://lpc.opengameart.org/content/top-down-grass-beach-and-water-tileset
- **Author:** Matiaan
- **License:** CC0 (public domain)
- **Sheet dimensions:** 256 x 256 px
- **Tile size:** 32 px → 8 x 8 grid. Tile (col,row) pixel = `(col*32, row*32)`.
- **Content:** water↔beach↔grass transition tiles (top-down).
- **How to use:** coastline/shore transitions. Grass at (0,0); water and beach-edge
  transition tiles fill the sheet. (Identical to the pre-existing `grass_beach_water.png`.)

### oga_grass_water.png
- **Source:** https://opengameart.org/content/32x32-grass-with-water-tileset
- **Author:** GboxMikeFozzy
- **License:** CC0 (public domain)
- **Sheet dimensions:** 96 x 416 px
- **Tile size:** 32 px → 3 cols x 13 rows. Tile (col,row) pixel = `(col*32, row*32)`.
- **Content:** grass with water edges (full autotile-style edge set, single column strip).
- **How to use:** lake/pond edges. A compact 3-wide autotile column of grass→water corners/edges.

### oga_outdoor_cliffs.png
- **Source:** https://opengameart.org/content/outdoor-32x32-tileset
- **Author:** Buch (blog-buch.blogspot.com)
- **License:** CC0 (public domain)
- **Sheet dimensions:** 640 x 288 px
- **Tile size:** 32 px → 20 cols x 9 rows. Tile (col,row) pixel = `(col*32, row*32)`.
- **Content:** grass, **rock/cliffs**, water, stumps, signs — outdoor high-res-ish set.
- **How to use:** **primary cliff/elevation source.** Cliff-face and rock-edge tiles
  give the 2.5D height look; pair with grass tops for raised terrain.

---

## CC-BY assets (attribution REQUIRED)

### oga_grass_dirt_water_transitions.png
- **Source:** https://opengameart.org/content/top-down-32x32-2d-tileset
- **Author:** bearmetal
- **License:** **CC-BY 3.0** — https://creativecommons.org/licenses/by/3.0/
  **Attribution required:** "Tileset by bearmetal (OpenGameArt.org)".
- **Sheet dimensions:** 288 x 416 px
- **Tile size:** 32 px → 9 cols x 13 rows. Tile (col,row) pixel = `(col*32, row*32)`.
- **Content:** grass, dirt, and water with thin/wide corner transitions between all three.
- **How to use:** **dirt/path + transitions atlas.** Best source for grass→dirt path edges
  and muddy water-tide transitions. (Identical to the pre-existing `terrain_transitions.png`.)

---

## Coverage summary (for wiring a PixiJS / @pixi/tilemap layer)

| Terrain        | File                                  | Tile px | Grid (cols x rows) | Spacing |
|----------------|---------------------------------------|---------|--------------------|---------|
| Grass (master) | kenney_roguelike_rpg.png              | 16      | 57 x 31            | 1px m+s |
| Dirt / path    | oga_grass_dirt_water_transitions.png  | 32      | 9 x 13             | none    |
| Stone / dungeon| kenney_dungeon.png                    | 16      | 29 x 18            | 1px m+s |
| Water (coast)  | oga_grass_beach_water.png             | 32      | 8 x 8              | none    |
| Water (lake)   | oga_grass_water.png                   | 32      | 3 x 13             | none    |
| Cliffs / rock  | oga_outdoor_cliffs.png                | 32      | 20 x 9             | none    |

**PixiJS notes:**
- For the two Kenney sheets, set the tileset `margin: 1, spacing: 1` (or compute
  `x = col*17 + 1`) — Kenney sheets have 1px padding around every 16px tile.
- The OGA 32px sheets are tightly packed (margin/spacing 0): `x = col*32, y = row*32`.
- Mixing 16px (Kenney) and 32px (OGA) atlases: keep one logical tile = 32 world px and
  scale the 16px Kenney tiles x2, OR author the `town`/`wilderness` map purely from the
  16px Kenney atlas and use the 32px OGA sheets for water/cliff/dirt detail layers.

---

## Pre-existing files (not added by this pass)
`grass_beach_water.png`, `terrain_transitions.png`, `grass_dirt_path.png`,
`cliffs_rock.png`, `dungeon_floor.png` were already present.
- `grass_beach_water.png` is byte-identical to `oga_grass_beach_water.png` (Matiaan, CC0).
- `terrain_transitions.png` is byte-identical to `oga_grass_dirt_water_transitions.png` (bearmetal, **CC-BY 3.0** — attribution required).
- The remaining pre-existing files have unverified provenance; treat with caution until sourced.
- None are referenced in `src/` at the time of this pass.
