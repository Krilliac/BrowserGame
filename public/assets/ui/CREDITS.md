# UI / Items / FX Asset Credits

> **Superseded — see `../CREDITS.md`.** The Kenney UI chrome and the licensed item/FX specimen sheets
> were removed; the game now uses the design system's original `gw_*` chrome, spell-FX strips, and
> item/gem icons (all original/license-free). Detail below is retained for historical context.

All assets under `public/assets/ui/` are license-clean for a distributable game.
Licenses used here: **CC0** (no obligations) and **CC-BY 4.0** (attribution required — satisfied by this file).
No GPL-only, ripped, or unclear-license assets are included.

Sourced 2026-06-09. Total payload ~320 KB (UI ~116 KB, items ~84 KB, fx ~108 KB).

---

## 1. UI elements (`public/assets/ui/*.png`, `*.xml`)

**Source pack:** Kenney — *UI Pack: RPG Expansion*
**Page:** https://kenney.nl/assets/ui-pack-rpg-expansion
**Download:** https://kenney.nl/media/pages/assets/ui-pack-rpg-expansion/7ec4a46657-1677661824/kenney_ui-pack-rpg-expansion.zip
**Author:** Kenney Vleugels (www.kenney.nl)
**License:** **CC0 1.0** (public domain, no attribution required) — see `kenney_ui_license.txt`

| File | Dimensions | Usage note |
|---|---|---|
| `kenney_uipack_rpg_sheet.png` + `kenney_uipack_rpg_sheet.xml` | 512×512 atlas | Full RPG UI atlas (Starling/Kenney XML format). Primary asset — load as a PixiJS spritesheet to get every panel/bar/button/slider frame from one texture. |
| `kenney_panel_brown.png`, `kenney_panel_beige.png`, `kenney_panel_blue.png` | 100×100 | 9-slice window/panel backgrounds for inventory, dialogs, HUD containers. Slice ~16 px borders. |
| `kenney_panelInset_brown.png`, `kenney_panelInset_beige.png` | 93×94 | Inset/recessed panels — ideal **hotbar slot frame** and inventory cell backgrounds (9-slice, ~12 px corners). |
| `kenney_barBack_horizontalLeft/Mid/Right.png` | 9×18 / 18×18 / 9×18 | Empty bar track (3-slice). The Left/Right caps are fixed-width; tile/stretch the Mid. Base for HP/MP bars. |
| `kenney_barRed_horizontalLeft/Mid/Right.png` | 9×18 / 18×18 / 9×18 | Red fill (3-slice) — **health bar**. Scale Mid horizontally to `hp/maxHp`. |
| `kenney_barBlue_horizontalLeft/Right.png` | 9×18 | Blue fill caps — **mana bar** (use atlas `barBlue_horizontalBlue` for the mid tile, or stretch the cap). |
| `kenney_buttonSquare_brown.png` / `_pressed.png` | 45×49 / 45×45 | Square action button (normal + pressed) — ability/hotbar buttons. |
| `kenney_buttonRound_brown.png` | 35×38 | Round button — close/icon buttons. |
| `kenney_buttonLong_brown.png` / `_pressed.png` | 190×49 / 190×45 | Wide button (normal + pressed) — menu/confirm. 9-slice horizontally to any width. |

> No dedicated "orb" art in this CC0 pack; build HP/MP **bars** from the 3-slice bar parts above. For round orbs, tint a circular mask in-renderer.

---

## 2. Item icons (`public/assets/ui/items/`)

### 2a. Gold coins / currency — CC0
**Pack:** OpenGameArt — *CC0 Currency Icons* (OpenClipart-derived set, "OCAL")
**Page:** https://opengameart.org/content/cc0-currency-icons
**Download:** https://opengameart.org/sites/default/files/currency-ocal_20201221.zip
**Author:** AntumDeluge (compilation); original art from OpenClipart contributors (see `items/currency_ocal_credit.txt` for per-coin OpenClipart source URLs)
**License:** **CC0 1.0**

| File | Dimensions | Usage note |
|---|---|---|
| `coin_gold.png` | 32×32 | Single gold coin — loot drop / currency icon. |
| `coin_gold_stack.png` | 32×32 | Small stack of gold. |
| `coin_gold_pile.png` | 32×32 | Gold pile (medium amount). |
| `coin_pile_large.png` | 32×32 | Large coin pile (big drop / treasure). |
| `currency_sheet_ocal.png` | 128×96 | Combined preview sheet of the full coin set (gold/silver variants). |

### 2b. Gems / shards — CC0
**Pack:** OpenGameArt — *CC0 Gem Icons* (7Soul1 set)
**Page:** https://opengameart.org/content/cc0-gem-icons
**Download:** https://opengameart.org/sites/default/files/gem-7soul1_20201212.zip
**Author:** 7Soul1 (original), compiled by AntumDeluge (see `items/gem_7soul1_credit.txt`)
**License:** **CC0 1.0**

| File | Dimensions | Usage note |
|---|---|---|
| `gem_ruby.png` | 32×32 | Red gem drop. |
| `gem_sapphire.png` | 32×32 | Blue gem drop. |
| `gem_diamond.png` | 32×32 | Clear/white gem. |
| `gem_amethyst.png` | 32×32 | Purple gem. |
| `gem_jade.png` | 32×32 | Green gem. |
| `gem_crystal_shard.png` | 32×32 | Crystal **shard** — generic magic-loot shard. |
| `gem_sheet_7soul1.png` | 128×96 | Combined preview sheet of all gem variants. |

### 2c. Crafting materials / pelts / generic loot — CC-BY 4.0 (attribution required)
**Pack:** OpenGameArt — *RPG Crafting Material Icons*
**Page:** https://opengameart.org/content/rpg-crafting-material-icons
**Download:** https://opengameart.org/sites/default/files/nails.png
**Author:** BizmasterStudios
**License:** **CC-BY 4.0** — attribution to BizmasterStudios required (satisfied here).

| File | Dimensions | Usage note |
|---|---|---|
| `crafting-materials_bizmaster.png` | 128×128 (4×4 grid of 32×32) | 16 crafting/loot icons: nails, wood plank, wooden rod, **cloth**, copper/iron ore, silver/gold nugget, copper/iron/silver/gold bar, **feather**, dragonscale, gem, **leather**. Use `leather`/`cloth`/`dragonscale` as pelt/hide-style monster drops; ores+bars as generic loot. Slice on a 32 px grid. |

### 2d. Generic fantasy items — CC0
**Pack:** OpenGameArt — *Generic Fantasy RPG Items*
**Page:** https://opengameart.org/content/generic-fantasy-rpg-items
**Downloads:** https://opengameart.org/sites/default/files/items_28.png , https://opengameart.org/sites/default/files/item2.png
**Author:** HomoHikka
**License:** **CC0 1.0**

| File | Dimensions | Usage note |
|---|---|---|
| `generic-fantasy-items_28.png` | 102×68 | Small sheet of fantasy inventory items (swords, shields, rings, etc.) — generic equipment/loot icons (~34 px tiles). |
| `generic-fantasy-item2.png` | 68×68 | Additional fantasy item icons (helmets/armor/misc). |

> "Bones" specifically were not available from a clean CC0 source in the curated budget; `gem_crystal_shard`, `leather`/`cloth` (pelts/hides), and the generic-fantasy sheets cover the monster-drop / loot category.

---

## 3. Spell / projectile FX (`public/assets/ui/fx/`)

### 3a. Projectile & spell strips — CC0
**Pack:** OpenGameArt — *Pixel Art Spells*
**Page:** https://opengameart.org/content/pixel-art-spells
**Download:** https://opengameart.org/sites/default/files/pixelart_spells_1.zip
**Author:** DevWizard
**License:** **CC0 1.0**
**Format:** horizontal animation strips, **16 px frame height** (each strip = N frames of 16×16, except `splash` = 32 px). Slice by width / 16 (or /32 for splash).

| File | Dimensions | Frames | Maps to ability |
|---|---|---|---|
| `spell_fireball.png` | 96×16 | 6 × 16×16 | **Fireball** projectile. |
| `spell_firebomb.png` | 96×16 | 6 × 16×16 | Fireball impact / AoE variant. |
| `spell_ice_lance.png` | 64×16 | 4 × 16×16 | **Frostbolt** projectile. |
| `spell_water_bolt.png` | 96×16 | 6 × 16×16 | Alt frost/water projectile. |
| `spell_arcane_bolt.png` | 96×16 | 6 × 16×16 | Generic magic bolt. |
| `spell_magic_orb.png` | 96×16 | 6 × 16×16 | Charged/orb projectile. |
| `spell_magic_sparks.png` | 96×16 | 6 × 16×16 | **Cast** spark FX / magic hit spark. |
| `spell_splash.png` | 192×32 | 6 × 32×32 | Impact splash (water/frost shatter). |
| `spell_rock_sling.png` | 16×16 | 1 × 16×16 | Single rock/pebble projectile. |

### 3b. Arrow projectiles — CC0
**Pack:** OpenGameArt — *CC0 Arrows*
**Page:** https://opengameart.org/content/cc0-arrows
**Download:** https://opengameart.org/sites/default/files/arrow_sprites_even_cc0.png
**Author:** knekko
**License:** **CC0 1.0** (attribution appreciated but not required)

| File | Dimensions | Usage note |
|---|---|---|
| `spell_arrows.png` | 352×448 (22×28 grid of 16×16) | Arrow sprites on a **16×16 grid**, multiple styles & rotations. Pick a row/cell for the **Arrow** ability projectile; rotate in-renderer to match `facing`. |

### 3c. Explosion / hit impact — CC0
**Pack:** OpenGameArt — *Explosion*
**Page:** https://opengameart.org/content/explosion
**Download:** https://opengameart.org/sites/default/files/exp2_0.png
**Author:** Cuzco
**License:** **CC0 1.0**

| File | Dimensions | Usage note |
|---|---|---|
| `explosion-cuzco.png` | 256×256 (4×4 grid of 64×64) | 16-frame explosion sheet — fireball/firebomb **impact**, death burst, generic hit FX. Slice on a 64 px grid, play once on a `hit`/`death` FxEvent. |

---

## Attribution summary (for an in-game credits screen)
- **Kenney** — UI Pack: RPG Expansion (CC0)
- **AntumDeluge / OpenClipart contributors** — CC0 Currency Icons (CC0)
- **7Soul1 / AntumDeluge** — CC0 Gem Icons (CC0)
- **HomoHikka** — Generic Fantasy RPG Items (CC0)
- **DevWizard** — Pixel Art Spells (CC0)
- **knekko** — CC0 Arrows (CC0)
- **Cuzco** — Explosion (CC0)
- **BizmasterStudios** — RPG Crafting Material Icons (**CC-BY 4.0** — attribution required)
