# Gloomwood asset generator (`tools/assetgen`)

Deterministic, procedural generator for the **original, license-free** Gloomwood
ARPG art set — icons, FX, terrain, UI chrome, decor and the mob roster. Pure
Canvas2D (node-canvas); no source images, no third-party packs. Re-running produces
the same art, so it's safe to commit the output or regenerate in CI.

## Use

```bash
cd tools/assetgen
npm install            # one native dep: canvas
node build.js          # build everything → ../../public/assets
node build.js mobs     # build a single group
OUT=/tmp/art node build.js   # override the output root
```

Groups: `icons`, `fx`, `terrain`, `ui`, `decor`, `mobs`, `anim`, `rig`.

## Layout

| File | What it generates | Output |
|---|---|---|
| `core.js` | palette + Canvas helpers (`makeIcon`, `glow`, `grain`, `shadow`, `mix`, RNG) | — |
| `icons.js` | faceted gems, carved-stone runes, materials | `icons/*.png` (64²) |
| `fx.js` | spell strips, explosion grid, arrows sheet | `fx/*.png` |
| `terrain.js` | 16px biome tilesheets (catacomb/cursed/undead/forest) | `terrain/*.png` |
| `ui.js` | obsidian+gold 9-slice panels, bars, buttons | `ui/gw_*.png` |
| `decor.js` | ~50 props + animated braziers/candles | `decor/*.png`, `decor/anim/*.png` |
| `mobs.js` | 29 sprites (hero ×3 facings, undead, demons, brutes, beasts, vermin) | `mobs/*.png` |
| `anim.js` | 4-frame idle/walk/attack loops (transform-based) | `mobs/*_{idle,walk,attack}.png` |
| `rig.js` | true per-limb articulated cycles for hero-class bipeds (overrides anim) | `mobs/{hero,skeleton,orc,goblin}_*.png` |
| `build.js` | orchestrator (renders every job → PNG) | — |

Each generator module exports `jobs()` → `[{ path, w, h, ss, grain?, draw(ctx,w,h) }]`.
`build.js` renders each at `ss`× and downscales for clean edges.

## Extending

- **New gem:** add a palette to `GEMS` in `icons.js` and a job for it.
- **New rune:** add a glyph (array of polylines in −1..1 space) to `RUNES`.
- **New mob:** add a `draw(ctx,w,h)` to `MOBS` in `mobs.js` (helpers: `limb`,
  `eyes`, `glow`, `shadow`, `lg`, `poly`). It auto-emits at 64².
- **New decor:** add a `draw` to `DECOR` + its canonical size to `DIMS` in `decor.js`.
- **Palette:** all colors flow from `core.js → P` (mirror of `tokens/colors.css`).

## Notes for the renderer

- **Dimensions are deliberate** — decor/anim/UI/terrain match what `decor-sprites.ts`,
  `ground-tiles.ts` and the HUD expect (see the design-system `HANDOFF.md`).
- **Atlas packing / preload** are not done here — emit individual PNGs, then pack
  with your preferred Pixi `Spritesheet` step once the set stabilizes.
- The mob layer is **new** to the renderer; `HANDOFF.md §3.1` describes the
  `mob-sprites.ts` archetype map that consumes `mobs/*.png`.
