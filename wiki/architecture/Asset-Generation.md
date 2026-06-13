# Procedural Asset Generation (`tools/assetgen/`)

In-repo, **zero-dependency** generators that synthesize game assets offline (CLI + CI + phone-friendly).
They are **never imported by `src/server`** — they only write to `public/assets/**` and emit manifests
that match the engine's real consumer types, so output deserializes without adaptation.

## Shared foundation (`tools/assetgen/shared/`)

| Module | Purpose |
|--------|---------|
| `rng.ts` | Seeded `mulberry32` PRNG (`Rng`) + `seedFromString`. Every random draw goes through it — that's the determinism guarantee. |
| `png.ts` | RGBA → PNG encoder using only Node's built-in `zlib` (no canvas/sharp dep). |
| `raster.ts` | A software RGBA canvas (`Raster`): alpha-over blend, rects, ellipses/discs, soft radial gradients, lines, polygons, paste (frame packing), `toPng()`. |
| `curves.ts` | Easing shared by the sprite + FX synths, mirroring `src/client/easing.ts` (linear, quadOut, cubicOut, cubicInOut, backOut, bounceOut, overshoot, oscillate). |
| `palette.ts` | `hslToRgba`, `numToRgba`, `shade`, and the loot `RARITY` tints. |
| `manifest.ts` | Atomic writes (temp + rename → no partial files) + a tiny zod-stand-in validator. |
| `cli.ts` | `--seed`, `--check` (dry run), `--out`; `emit()` writes/reports a batch all-or-nothing. |

**Determinism contract:** `(spec, seed)` → byte-identical output. Tested by generating twice and
comparing hashes (`tools/assetgen/test/assetgen.test.ts`, run under the project's vitest via the
`tools/**/*.test.ts` include).

## Generators

### `gen:sprites` — N-direction character sheets (RENDER-09)
`tools/assetgen/sprites/` renders a stylized billboard adventurer at N facings (clockwise from East, to
match the engine's `dirIndex`) across the full clip set (idle/walk/attack/cast/hurt/death), packed into
one sheet, plus a manifest matching the engine `Sheet`/`ClipSet`:

```
idle   rows 0..dirs-1          (1 col)
walk   rows dirs..2dirs-1      (8 cols)
attack rows 2dirs..3dirs-1     (6 cols)
cast   rows 3dirs..4dirs-1     (7 cols)
hurt   row 4dirs               (dirless)
death  row 4dirs+1             (dirless)
```

Direction reads from the figure's gaze (face vs back-of-head, profile eyes), a hood point toward the
facing, and a held item that orbits to the facing side; walk animates a leg cycle + bob; attack swings
the item, cast raises it with a glow, hurt flashes/recoils, death collapses. Lit upper-left to match the
game's baked-sun convention.

**Output:** `public/assets/sprites/adventurer16.png` + `.json` (force-added past the `public/assets/*/`
gitignore, like the other curated sprites). Wired in `pixi-renderer.ts` as the `hero` sheet with
`dirCount: 16`, which the player / NPCs / hirelings use — so they rotate in 16 increments (RENDER-09).
To regenerate: `npm run gen:sprites` (add `--check` for a dry run).

## Conventions for new generators
- One class per asset surface, output dir + manifest keyed to a real engine consumer type.
- Procedural/canvas backend primary (runs in CI); honor the `'low' | 'high'` quality split and
  `effectsEnabled` for anything that becomes runtime cost.
- No normal maps — RENDER-01 derives relief from albedo luminance at runtime.
- A root `gen:<class>` script (`tsx tools/assetgen/<class>/cli.ts`), `--check` dry-run on each.
