# Asset Credits

**All bundled art is original and license-free.** The game's visual assets are either produced by
this project's own deterministic generators (`tools/assetgen/*` → `sprites/`, `tiles/`, `fx/`,
`icons/`, `emitters/`) or shipped by the **Gloomwood design system** (`curated/`, `ui/`) as original,
procedurally-generated pixel art in the locked Gloomwood palette. None of it carries a third-party
license, and no attribution is required.

The earlier prototyping packs — **32rogues, CraftPix, Mana Seed, Szadi/RF, Kenney, and the
OpenGameArt LPC/OGA sprites & tiles** — have been **fully removed** and replaced (see
`wiki/` and the design system's `HANDOFF.md`). There are no attribution-required *art* assets left.

## Audio

Audio is **CC0** (public domain — no attribution required); see `audio/CREDITS.md` for sources.

| Files | License |
|---|---|
| `audio/ambient_forest.mp3`, `audio/ambient_dungeon.ogg` | CC0 (OpenGameArt.org) |
| `audio/swing.ogg`, `hit.ogg`, `hurt.ogg`, `death.ogg`, `pickup_coin.ogg`, `levelup.ogg` | CC0-consistent retro one-shots |

Combat cast/shoot SFX are now **synthesized at runtime** (`src/client/sound.ts`); the former
licensed `shoot_arrow.ogg` (CC-BY-SA) and `cast_fire.ogg` files were removed.

## What's where

- `sprites/` — generated N-direction adventurer + creature sheets (`*_gen.png`, `adventurer16*`).
- `tiles/` — generated 4×4 biome sheets (meadow, marsh, mine, frost, cave, dungeon, autumn, …).
- `curated/` — design-system original art: `decor/` (+`anim/`), `tiles/` (catacombs / cursed_ground /
  undead_ground / forest_spring), `mobs/` (the top-down roster + idle/walk/attack strips).
- `ui/` — design-system `gw_*` obsidian/gold chrome, spell-FX strips (`ui/fx/`), item/currency icons
  (`ui/items/`), `icons/` (gems / runes / materials).

See the per-folder `CREDITS.md` files for generation/format detail.
