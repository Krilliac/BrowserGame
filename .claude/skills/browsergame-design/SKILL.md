---
name: browsergame-design
description: Use this skill to generate well-branded interfaces and assets for BrowserGame (the Gloomwood dark ARPG), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `README.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Where things are
- `styles.css` → `tokens/` — link `styles.css` for every CSS custom property (colors, the loot-rarity ladder, type, spacing, slot sizes, glows, motion).
- `assets/` — `icons/` (gem/rune/material loot icons), `items/`, `fx/` (spell strips), `decor/` (+ `anim/`), `terrain/`, `ui/` (`gw_*` obsidian/gold chrome), `mobs/` (top-down roster + hero). **All original, license-free.** Render with `image-rendering: pixelated`.
- `components/` — React primitives on `window.BrowserGameARPGDesignSystem_aa965c`: Button, Panel, IconSlot, RarityName, Badge, ItemTooltip, OrbGauge, ResourceBar, AbilitySlot, Nameplate. Each has a `.prompt.md` with usage.
- `ui_kits/gloomwood-hud/` — the full interactive in-game HUD to copy from.
- `templates/game-hud/` — a HUD-screen scaffold.
- `reference/*.txt` — verbatim game source (rarity, theme, areas, item-icons) — the rules to match.
- `HANDOFF.md` — wiring the original art into the game repo + the engine/rendering additions (mob sprites, animated FX, emissive lighting, atlas packing) needed to fully use it.

## Non-negotiables
- Dark-first. Obsidian surfaces, one gold accent (`#c9a24b`), parchment text.
- Rarity = color (common grey · magic blue · rare yellow · epic violet · legendary orange · corrupted pink-red · unique tan). Never label rarity in words.
- Engraved Cinzel uppercase for titles/item names; system-ui for HUD; Spectral italic for lore.
- Pixel art only; no emoji; sharp corners; glow means meaning; weighty (non-bouncy) motion.
- **All bundled art is original and license-free** — it replaced the old Kenney/CraftPix/32rogues/Mana Seed packs. It's procedurally generated (programmatic, not hand-painted): ship it, edit it, or treat it as an art-direction base. See `HANDOFF.md` to extend or repaint.
