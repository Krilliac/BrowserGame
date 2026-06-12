# Asset Credits

Consolidated attribution for all bundled art and audio. Per-folder manifests
(`tiles/CREDITS.md`, `sprites/CREDITS.md`, `ui/CREDITS.md`, `audio/CREDITS.md`) carry the full
per-file detail (source URL, dimensions, frame layout). **This file must ship with the game** to
satisfy the attribution-required licenses below.

Most assets are **CC0** (public domain — no attribution required). The following require
attribution and are credited here.

## Attribution-required assets

| Asset | License | Credit |
|---|---|---|
| `sprites/hero_walk_lpc.png` | CC-BY-SA 3.0 | Universal LPC Sprite (OpenGameArt.org) — see `sprites/CREDITS.md` |
| `sprites/skeleton_lpc.png` | CC-BY-SA 3.0 | Universal LPC Sprite (OpenGameArt.org) — see `sprites/CREDITS.md` |
| `sprites/wolf_lpc.png` | CC-BY 4.0 | Stephen "Redshrike" Challener & William.Thompsonj, via OpenGameArt.org |
| `sprites/bat.png` | OGA-BY 3.0 | Bat sprite by bagzie, via OpenGameArt.org |
| `tiles/oga_grass_dirt_water_transitions.png` | CC-BY 3.0 | Tileset by bearmetal (OpenGameArt.org) |
| `ui/items/crafting-materials_bizmaster.png` | CC-BY 4.0 | RPG Crafting Material Icons by BizmasterStudios |
| `audio/shoot_arrow.ogg` | CC-BY-SA 3.0 | "Bow & Arrow Shot" by dorkster (FLARE project), OpenGameArt.org |

### Share-alike note (CC-BY-SA)

The LPC sprites (`hero_walk_lpc.png`, `skeleton_lpc.png`) and `audio/shoot_arrow.ogg` are
**CC-BY-SA 3.0**. If we **modify/recolor** that *art/audio*, the derived asset must also be
released under CC-BY-SA 3.0. **Game source code is unaffected** — share-alike applies only to the
derived media. If this obligation becomes inconvenient, swap these few files for CC0 equivalents.

## Curated pack sprites (`curated/`)

Cutouts and sheets the renderer actually loads, curated from the extracted packs inventoried in
`INVENTORY.md` (raw packs stay un-committed on disk). Per-pack terms:

| Files | Pack / Author | License notes |
|---|---|---|
| `curated/rogues.png`, `monsters.png`, `animals.png`, `items.png`, `tiles/rogues_tiles.png` | **32rogues** — Seth Boyles (© 2024) | Permissive; credit appreciated. No NFT/blockchain use; the author excludes generative-AI/ML *training* uses; no redistribution as a pack. |
| `curated/tiles/catacombs.png` | **RF Catacombs** — Szadi art | Public domain / free for commercial use; may edit; may not resell the pack. |
| `curated/tiles/dungeon_floor.png`, `cursed_ground.png`, `undead_ground.png`; `curated/decor/*` (graves, bones, trees, rocks, ruins, crystals, horror plants, cave objects, barrel, crate) | **CraftPix free packs** (top-down dungeon, cursed land, undead, cave objects, dungeon objects) | CraftPix file license (craftpix.net/file-licenses) — commercial use OK; no redistribution/resale of the assets as-is; verify tier before public release. |
| `curated/tiles/forest_spring.png`, `forest_autumn.png`; `curated/decor/pot-*.png` | **Mana Seed forest samples / breakable pots** — Seliel the Shaper | Purchased-pack readmes ship no grant text — confirm the itch.io tier before public release. |
| `curated/icons/*` (gems, runes, materials) | **Minerals icons** — CraftPix | As CraftPix above. |

## CC0 assets (no attribution required)

- `tiles/`: Kenney roguelike + dungeon sheets; OGA coast/lake/cliff tiles.
- `ui/`: Kenney UI Pack RPG Expansion (atlas + bars/panels/buttons); coin & gem icons; spell-FX
  strips, arrows, and explosion sheet.
- `audio/`: `cast_fire.ogg`, `ambient_forest.mp3`, `ambient_dungeon.ogg`.

See the per-folder `CREDITS.md` files for exact sources and usage specs.

## Provenance pruning

Files sourced during exploration whose provenance/license could not be verified were **removed**
before commit (some terrain tiles, generic gem icons, and the pre-existing combat SFX). Combat
one-shot SFX (hit/swing/death/pickup) are a re-source TODO from a documented CC0 origin.
