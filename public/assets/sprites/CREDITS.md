# Sprite Credits & Atlas Specs

Character + monster sprites for BrowserGame's top-down 2.5D fantasy look.
All entries verified as real PNGs (non-HTML). Total folder size: ~276 KB.

> LICENSE FLAGS:
> - **CC-BY-SA 3.0** = attribution **+ share-alike on DERIVED ART** (if you modify/recolor
>   these, the derivative art must also be CC-BY-SA 3.0). Your game *code* is unaffected.
> - **CC-BY 4.0 / OGA-BY 3.0** = attribution only, no share-alike.
> Keep this file shipped with the game to satisfy attribution.

---

## hero_walk_lpc.png  (player / hero)  — pre-existing, kept

- **Source page:** https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles  (LPC Universal base)
- **Author:** Liberated Pixel Cup contributors (base: Stephen "Redshrike" Challener & the LPC team)
- **License:** **CC-BY-SA 3.0** (dual with GPLv3) — ⚠ **SHARE-ALIKE on derived art**, attribution required
- **Image:** 832 × 1344, RGBA
- **Frame size:** 64 × 64
- **Layout (Universal LPC sheet):** 13 columns × 21 rows.
  - Rows are grouped by animation, and within each animation the 4 directions are in this order: **N (up), W (left), S (down), E (right)**.
  - Standard block order top→bottom: spellcast (7f), thrust (8f), **walk (9f: rows 8–11 = N/W/S/E)**, slash (6f), shoot (13f), then hurt/die (single row, 6f).
- **Usage:** Player avatar. For directional walk, use the 4 walk rows (N/W/S/E); col 0 = idle/stand, cols 1–8 = walk cycle.

## wolf_lpc.png  (monster: wolf / beast)

- **Source page:** https://opengameart.org/content/lpc-wolf-animation
- **Author:** art by Stephen "Redshrike" Challener; contributed by William.Thompsonj
- **License:** **CC-BY 4.0** (also offered CC-BY 3.0 / OGA-BY 3.0 / GPL) — attribution only, **no share-alike**
- **Attribution text:** "Stephen 'Redshrike' Challener (graphic artist) and William.Thompsonj (contributor), via OpenGameArt.org"
- **Image:** 640 × 384, RGBA
- **Frame size:** 64 × 64
- **Layout:** 10 columns × 6 rows. Rows are LPC directional animations in **N/W/S/E** order
  (rows 0–3 walk/run cycle, lower rows = bite/howl/die per the source). Use rows 0–3 for the 4-direction walk.
- **Usage:** Roaming beast mob. Matches the hero's LPC 64×64 scale exactly.

## skeleton_lpc.png  (monster: skeleton / undead)

- **Source page:** https://opengameart.org/content/lpc-skeleton
- **Author:** wulax (original LPC character art); submitted by rhimlock
- **License:** **CC-BY-SA 3.0** (dual with GPLv3) — ⚠ **SHARE-ALIKE on derived art**, attribution required
- **Image:** 832 × 1344, RGBA
- **Frame size:** 64 × 64
- **Layout:** Identical Universal LPC layout to the hero (13 cols × 21 rows, animation blocks,
  4 directions per block in **N/W/S/E** order, walk = rows 8–11). Includes spellcast/thrust/walk/slash/shoot/hurt.
- **Usage:** Undead mob. Drop-in compatible with the same animation indexing as the hero.

## bat.png  (monster: bat)

- **Source page:** https://opengameart.org/content/bat-sprite
- **Author:** bagzie
- **License:** **OGA-BY 3.0** — attribution only, **no share-alike**
- **Attribution text:** "Bat sprite by bagzie, via OpenGameArt.org"
- **Image:** 128 × 128, RGBA
- **Frame size:** 32 × 32
- **Layout:** 4 columns × 4 rows, fully populated. **Rows = directions, cols = animation frames**
  (4 directions × 4 flap frames). Direction order is the RPG-Maker-style **S, W, E, N** (down, left, right, up)
  — verify orientation in-engine and remap to your facing quantization if needed.
- **Usage:** Small flying mob. Note this is 32×32 (half the LPC scale) — scale ×2 in PixiJS to sit next to LPC mobs.

---

## Driving directional animation in PixiJS from `EntityState.facing`

`facing` is in radians. Quantize to a compass direction, then pick the matching sheet ROW.

```ts
// 4-direction quantization. facing: 0 = east (+x), increasing CCW (standard atan2).
// Map to LPC row order N, W, S, E:
function lpcRow(facing: number): number {
  const dir = ((Math.round(facing / (Math.PI / 2)) % 4) + 4) % 4; // 0=E,1=N,2=W,3=S
  return [3, 0, 1, 2][dir]; // E->row3, N->row0, W->row1, S->row2  (N,W,S,E layout)
}
```

- **LPC sheets (hero, wolf, skeleton):** frame = 64×64. Build a `Spritesheet`/`AnimatedSprite`
  by slicing `frame = { x: col*64, y: row*64, w:64, h:64 }`. Use the WALK rows (N/W/S/E) for movement;
  col 0 = idle, cols 1–8 (or 1–9) = walk loop. Trigger slash/cast rows as one-shots on `melee`/`cast` FxEvents.
- **bat.png:** frame = 32×32, grid 4×4, row=direction (S/W/E/N), col=flap frame; remap quantizer
  to that order or rotate the lookup table. Scale the sprite ×2 to match 64px LPC mobs.
- Idle vs walk: derive from whether interpolated position changed since last frame (client already interpolates snapshots).
