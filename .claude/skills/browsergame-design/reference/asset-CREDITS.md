# Asset Credits — Gloomwood ARPG Design System

## Everything here is ORIGINAL. No third-party license applies.

Every file under **`assets/`** in this design system — `icons/`, `items/`, `fx/`,
`decor/` (+ `anim/`), `terrain/`, `ui/`, and `mobs/` — was **generated
procedurally** (Canvas2D drawing in the locked Gloomwood palette) specifically for
this project. There is **no attribution requirement, no share-alike, no
redistribution restriction**: the project owns this art outright and may ship,
edit, repaint, or relicense it freely.

The generator approach (palettes, faceted-gem / rune / FX / decor / mob routines)
is described in **`HANDOFF.md` → Asset generator pipeline** so it can be re-run,
tuned, or extended for new content.

## What this replaced

This set was created to **replace the placeholder third-party packs** the upstream
game repo (`Krilliac/BrowserGame`, `public/assets/`) was using during prototyping:

| Replaced pack | Was used for | Now |
|---|---|---|
| Kenney UI Pack: RPG Expansion (CC0) | panels, bars, buttons | original `gw_*` 9-slice chrome |
| CraftPix free packs (file-license) | decor, terrain, mineral icons | original decor / tilesheets / gem-rune icons |
| 32rogues — Seth Boyles (no-AI clause) | mob & item sprites | original mob roster + item icons |
| Mana Seed / Seliel (purchased-tier) | forest terrain, breakable pots | original grass tilesheet + pots |
| Szadi art — RF Catacombs (PD) | catacomb tileset | original catacomb tilesheet |

> The upstream **game repo** may still contain those packs on disk. Nothing in this
> design system depends on them, and the originals here are dimensioned and laid out
> to **drop in as direct replacements** (see `HANDOFF.md`). Once the game adopts
> these, the third-party packs (and their license obligations) can be deleted from
> the repo.

## Note on fonts

Type is a separate concern from art: **Cinzel** (display) and **Spectral** (lore)
are Google-Fonts substitutes pending a licensed brand face — see the README Caveats.
