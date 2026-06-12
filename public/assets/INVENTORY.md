# Asset Pack Inventory

Extracted pixel-art asset packs for the BrowserGame ARPG. Served from the web root
under `/assets/<slug>/...` (the repo's `public/` folder is the Vite web root, so a file at
`public/assets/undead/PNG/Objects.png` loads as `/assets/undead/PNG/Objects.png`).

This file is **inventory only** — no renderer code has been touched. Paths below are relative
to `public/assets/`. All dimensions in `WIDTHxHEIGHT` pixels.

> NOTE: Four folders here — `audio/`, `sprites/`, `tiles/`, `ui/` and `CREDITS.md` — are
> **pre-existing** (already tracked in git) and are NOT part of this extraction. The 13 packs
> below are the newly added ones.

---

## LICENSE SUMMARY (read before shipping)

| Pack(s) | Author | License | Commercial OK? | Attribution |
|---------|--------|---------|----------------|-------------|
| dungeon-objects, top-down-dungeon, cave-objects, mine-icons, minerals, cursed-land, undead, city-trader | **CraftPix.net** | CraftPix file license (see https://craftpix.net/file-licenses/) | **Yes (with conditions)** | Not strictly required for the standard free license, BUT free CraftPix assets generally **may not be redistributed/resold as-is** and some require you NOT to claim authorship. Verify the exact tier — link is the only license text shipped in each pack. |
| 32rogues | **Seth Boyles** (© 2024) | Custom permissive | **Yes** | Credit appreciated, not required. **EXCLUSIONS: no NFT/blockchain, and explicitly NO generative-AI / machine-learning projects.** No redistribution/resale. |
| breakable-pots, forest-spring, forest-autumn | **Seliel the Shaper** (forest = Mana Seed line) | Purchased-asset readme (no explicit grant text shipped) | Verify on itch | readme only points to author site/Patreon; **confirm the itch.io license tier before shipping.** seliel-the-shaper.itch.io |
| rf-catacombs | **Szadi art** | Public domain / free (personal + commercial) | **Yes** | Credit not required but appreciated. May edit. **May NOT resell** the pack (original or changed). |

**ACTION FLAG:** The CraftPix packs (8 of 13) and the Seliel/Mana Seed packs (3 of 13) ship
only a URL or a thank-you note as their "license" — none ship full grant text. Before a public
release, confirm each tier and add a proper attribution block to the repo `CREDITS.md`. The two
fully-clear-to-ship packs are **32rogues** (permissive, no-AI clause noted) and **rf-catacombs**
(public domain). The 32rogues no-AI clause is worth flagging given this project's workflow.

---

## CHARACTER / MONSTER SPRITES

### 32rogues  — `32rogues/`  (Seth Boyles, permissive, NO-AI clause)
Grid sheets, **32x32 per cell**, static single-frame sprites (no walk/idle/attack animation —
these are top-down/3-4 view standing poses, one sprite per character). Excellent for a large
roster with minimal memory. The nested folder is `32rogues/32rogues/`.

- `32rogues/32rogues/rogues.png` — 224x224 (7x7 grid). **PLAYER + NPC candidates.** Row-labeled
  in `rogues.txt`: knights, fighters, rangers, rogues, wizards, druids, monks, barbarians,
  blacksmith, shopkeep, peasants, etc.
- `32rogues/32rogues/monsters.png` — 384x416 (12x13 grid). **MONSTER roster.** `monsters.txt`
  lists them: orcs/goblins (row 1), ettins/trolls (2), slimes (3), skeletons/lich/death-knight/
  **zombie/ghoul (row 5 = UNDEAD)**, banshee/reaper/wraith/cultist (6), beasts & spiders (7),
  dryad/golem/minotaur (8), dragons/kobolds (9), etc.
- `32rogues/32rogues/animals.png` — 288x512 (9x16). Wildlife (bears, wolves, cats, livestock).
- `32rogues/32rogues/items.png` — 352x832 (11x26). **ITEM ICONS** (weapons, armor, rings,
  potions, scrolls, keys, coins, food) — see `items.txt` for the full labeled index.
- `32rogues/32rogues/items-palette-swaps.png` — 256x1376. Recolored item variants.
- `32rogues/32rogues/tiles.png` — 544x832 (17x26). Dungeon walls/floors/props/doors/chests —
  fully labeled in `tiles.txt`.
- `32rogues/32rogues/autotiles.png` — 384x256. Water + poison-swamp autotiles.
- `32rogues/32rogues/animated-tiles.png` — 352x384. Braziers/torches/fire/water/poison
  (lit+unlit, animation frames) — see `animated-tiles.txt`.
- `*.txt` next to each PNG = the authoritative row/cell label index. **Use these for slicing.**

### city-trader  — `city-trader/`  (CraftPix)
Side-view merchant NPCs, **128x128 per frame**, horizontal-strip animations. Three trader
variants (`Trader_1/`, `Trader_2/`, `Trader_3/`), each with the same set:
- `Idle.png` (6 frames, e.g. Trader_1 = 768x128), `Idle_2.png`, `Idle_3.png` (idle variants),
  `Approval.png` (e.g. 1024x128 = 8 frames), `Dialogue.png` (e.g. 2048x128 = 16 frames).
- Frame count = width / 128. **Best for town/vendor NPCs.** `.psd` source sheets in `PSD/`.
- Junk: `COUPON.pdf`/`COUPON.png` are ads, not assets. `Licens.txt`/`Font.txt` are pointers.

---

## TILESETS (ground / walls, per biome)

All CraftPix tilesets are **16x16 tiles** (confirmed from their bundled `.tmx`/`.tsx`).

### cursed-land  — `cursed-land/`  (CraftPix) — biome: CURSED / corrupted wasteland
- `cursed-land/PNG/Ground.png` — 720x560. **Primary ground tileset** (corrupted earth).
- `cursed-land/PNG/Objects.png` — 784x704. Packed objects sheet (also split out, see Decor).
- `cursed-land/PNG/Water_coasts.png` — 416x960. Water + coastline autotiles.
- `cursed-land/PNG/bridges.png` 672x304, `details.png` 176x144, `spots.png` 336x160,
  `water_detilazation.png` / `_v2.png` 688x576 (animated water detail).
- `cursed-land/Tiled_files/Cursed_land.tmx` + `Water_detilazation2.tsx` — Tiled refs (16x16).

### undead  — `undead/`  (CraftPix) — biome: UNDEAD / graveyard (largest pack, 262 png)
- `undead/PNG/Ground_rocks.png` — 496x592. **Primary ground tileset** (cracked dead earth + rock).
- `undead/PNG/Objects.png` — 768x704. Packed objects (split out under `Objects_separately/`).
- `undead/PNG/Water_coasts.png` — 1056x256. Water/coast autotiles.
- `undead/PNG/Details.png` — 576x176.
- `undead/PNG/Animation1..6.png` — animated environment props (e.g. `Animation1.png` 592x384 =
  6-frame swaying dead-tree). Frame rows visible; treat each as a multi-frame strip.
- `undead/Tiled_files/Undead_land.tmx` + `Water_detilazation2.tsx` (16x16).

### rf-catacombs  — `rf-catacombs/`  (Szadi art, public domain) — biome: CATACOMB / crypt
- `rf-catacombs/mainlevbuild.png` — 1024x640. **Catacomb tileset**: brick walls, arches,
  doorways, stairs, grates, sarcophagus, dark floor tiles. (Clean license — safe to ship.)
- `rf-catacombs/decorative.png` — 256x256. Extra crypt decor.
- Animated props as numbered frames: `candleA_01..04`, `candleB_01..04`, `torch_1..4`,
  `spike_0..4` (each ~16x16 region, 4-5 frame loops). `.psd` sources under `PSD/` and `PSD/Anim/`.

### forest-spring / forest-autumn  — `forest-spring/`, `forest-autumn/`  (Mana Seed / Seliel) — biome: FOREST
- `forest-spring/seasonal sample (spring).png` — 256x256. **Forest tileset sample** (16x16):
  grass, flowers, layered cliff faces, a big tree, cave entrance, water edges.
- `forest-autumn/seasonal sample (autumn).png` — 62.8KB autumn variant of the same.
- `*/seasonal water animations/*.png` — small animated water sparkle + waterfall strips.
- NOTE: these are **sample** tiles from the larger paid Mana Seed forest set (limited coverage).

### top-down-dungeon  — `top-down-dungeon/`  (CraftPix) — biome: GENERIC STONE DUNGEON
- `top-down-dungeon/PNG/walls_floor.png` — 208x368. **Dungeon walls + floor tileset** (16x16).
- `top-down-dungeon/PNG/Water_coasts_animation.png` — 352x448, `water_detilazation_v2.png` 688x576.
- `top-down-dungeon/PNG/decorative_cracks_floor.png` 128x240, `_walls.png` 128x512,
  `_cracks_coasts_animation.png` 256x336. Floor/wall crack overlays + animations.
- `top-down-dungeon/PNG/doors_lever_chest_animation.png` 160x192, `trap_animation.png` 144x400,
  `fire_animation.png` 176x288, `fire_animation2.png` 96x192. Interactive/animated props.
- `top-down-dungeon/PNG/Objects.png` — 384x96. Static dungeon props.
- `top-down-dungeon/Tiled_files/Dungeon1.tmx` confirms **16x16** tiles.

### 32rogues tiles (alternative dungeon, 32x32)
- `32rogues/32rogues/tiles.png` (544x832) + `tiles.txt` — a complete 32x32 dungeon tileset
  (dirt/stone/brick/igneous/catacomb walls, grass/dirt/bone/blood floors, doors, stairs, traps).
  Use if you want a uniform 32x32 pipeline instead of mixing 16x16 CraftPix tiles.

---

## OBJECTS / DECOR (props: pots, barrels, chests, bones, statues, plants)

### breakable-pots  — `breakable-pots/`  (Seliel the Shaper) — **BEST pot/destructible candidate**
- `breakable-pots/breakable pots.png` — 128x128. Pot break animation: intact → shatter shards,
  ~32x32 frames, top row = pots, lower rows = breaking/shard frames.
- Color variants: `breakable pots (gray|red|white|yellow).png` (~128x128 each).

### cave-objects  — `cave-objects/`  (CraftPix) — cave/mine decor, pre-split (best convenience)
- `cave-objects/PNG/Cave_objects_source.png` — 624x848. Full packed sheet (crystals, mushrooms,
  stalagmites, bones, pots, gems, a pentagram).
- `cave-objects/PNG/Objects_separately/` — **individual sprites already cut**, foldered by size:
  `16/` (4), `32/` (14), `64/` (44), `128/` (31), `256/` (8). Easiest to drop in directly.

### cursed-land objects  — `cursed-land/PNG/Objects_separetely/` (127 individual sprites)
Categories (name prefix): `Bones` (x22), `Rock1/2/3` (x22), `Rock_eyes` (x10), `Ruins` (x9),
`Veins` (x8), `Spike_plant` (x8), and fleshy horror plants: `Eye_plant`, `Fetus`, `Jaws_plant`,
`Many_eyes_plant`, `Meat_flower`, `Pustules`, `Tentacle_plant`, `Tubular_plant` (x6 each).
Each comes with `_shadow1/2` variants and numbered frames.

### undead objects  — `undead/PNG/Objects_separately/` (240 individual sprites) — **BEST graveyard decor**
Categories: `Grave` (x51 — headstones/tombs!), `Bones` (x54), `Rock`/`Ruin` (x15 each),
`Broken_tree`/`Dead_tree`/`Tree` (x30+), `Crystal` (x12), `Dead_arm` (x12), `Thorn_plant` (x18),
`Plant` (x15), `Pile_sculls`, `Scull_door`, `Lich`. `_shadow#` + numbered variants per object.

### dungeon-objects  — `dungeon-objects/`  (CraftPix) — traps + supplies (16x16)
- `dungeon-objects/PNG/full.png` — 1104x416. Full object sheet.
- `dungeon-objects/PNG/supplies_objects.png` — 208x592. **Barrels / crates / sacks / supplies.**
- `dungeon-objects/PNG/pedestals.png` 560x128, `Other_objects.png` 352x112.
- Animated traps: `fire_trap.png` 1008x128, `trap_saw.png` 384x256, `trap_plate.png` 112x240.
- `dungeon-objects/Tiled_files/Dungeon1_objects.tmx` confirms **16x16**.

### rf-catacombs props  — candles/torches/spikes (see Tilesets section above).

---

## ICONS (item / UI / mineral)

### minerals  — `minerals/`  (CraftPix) — **BEST gem/ore icon set** — **32x32**
- `minerals/PNG/Transperent/Icon1.png … Icon48.png` — 48 transparent mineral/gem icons, 32x32.
- `minerals/PNG/Background/` — same 48 with a framed background (UI slot style).

### mine-icons  — `mine-icons/`  (CraftPix) — mixed item/quest icons — **32x32**
- `mine-icons/1 Icons/Icons_01.png … Icons_40.png` — 40 icons, 32x32, transparent.
- `mine-icons/2 Icons with back/` — same 40 with backing.
- `mine-icons/Icons_name.txt` = the label index: coins, barrel, lantern, ruby, sapphire,
  emerald ring, gold key, chest, necklace, mana bottle, broadsword, pistol, map piece, etc.

### 32rogues items  — `32rogues/32rogues/items.png` (32x32, 286 labeled item icons via `items.txt`).

---

## BEST CANDIDATES (for renderer wiring)

| Need | Best file | Size / notes |
|------|-----------|--------------|
| **Player character** | `32rogues/32rogues/rogues.png` | 32x32 grid; pick a cell (e.g. knight 2.a, ranger 1.c). Static pose. For an animated alternative use `city-trader/Trader_1/Idle.png` (128px, but side-view merchant). |
| **Monsters (general)** | `32rogues/32rogues/monsters.png` | 32x32 grid, 80+ creatures, labeled |
| **Monsters (undead)** | `32rogues/32rogues/monsters.png` **row 5** (skeleton/archer/lich/death-knight/zombie/ghoul) + row 6 (banshee/wraith) | 32x32 |
| **Town/vendor NPC** | `city-trader/Trader_1..3/Idle.png` | 128x128, 6-frame idle |
| **Tileset — town/generic dungeon** | `top-down-dungeon/PNG/walls_floor.png` | 16x16 |
| **Tileset — cave/mine** | `cave-objects/PNG/Objects_separately/` (decor) + `32rogues` igneous/stone floors for ground | mixed |
| **Tileset — catacomb** | `rf-catacombs/mainlevbuild.png` | crypt walls/floors, **clean license** |
| **Tileset — cursed wasteland** | `cursed-land/PNG/Ground.png` (+ `Objects.png`) | 16x16 |
| **Tileset — forest** | `forest-spring/seasonal sample (spring).png` (+ autumn) | 16x16, sample coverage only |
| **Decor — pots (destructible)** | `breakable-pots/breakable pots.png` | 128x128, break animation |
| **Decor — barrels/crates/supplies** | `dungeon-objects/PNG/supplies_objects.png` | 16x16 |
| **Decor — graves/bones/dead trees** | `undead/PNG/Objects_separately/` (Grave x51, Bones x54) | individual sprites |
| **Decor — torches/candles/braziers** | `rf-catacombs/torch_1..4.png`, `candleA/B`, or `32rogues/32rogues/animated-tiles.png` | animated |
| **Item icons — gems/ore** | `minerals/PNG/Transperent/Icon1..48.png` | 32x32 |
| **Item icons — gear/loot** | `32rogues/32rogues/items.png` (labeled) or `mine-icons/1 Icons/` | 32x32 |

---

## CLEANUP DONE
- Removed extracted `__MACOSX/` junk folders and `.DS_Store` files from all packs.
- Leftover non-asset files left in place but flagged: `*/COUPON.png|.pdf` (CraftPix ads),
  `city-trader/PSD/*`, `rf-catacombs/PSD/*` (source .psd, large — optional to keep).
