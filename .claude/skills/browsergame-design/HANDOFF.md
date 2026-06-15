# HANDOFF — wiring the original art into BrowserGame

**Audience:** a Claude Code session (or engineer) working in
[`Krilliac/BrowserGame`](https://github.com/Krilliac/BrowserGame).
**Goal:** drop the original, license-free Gloomwood art shipped in this design
system into the running game, and make the renderer additions needed to *fully*
use it (mob sprites, animated FX, emissive lighting, packed atlases).

Everything under this design system's `assets/` is **original and carries no
license** — it replaces the Kenney / CraftPix / 32rogues / Mana Seed / Szadi packs
the repo used while prototyping. Filenames and pixel dimensions were chosen to
**match the renderer's existing expectations** so most of it is a literal file swap.

---

## 0. TL;DR — what to do

1. Copy the asset folders to the web root as mapped in **§1** (mostly same names →
   same paths; the renderer data modules don't change).
2. Re-point three `*-sprites.ts` / icon `src` strings only where the path differs
   (FX, items, UI — they live under `ui/` in the repo) — **§1**.
3. Wire the **new** capabilities the repo doesn't have yet — mob sprites, animated
   projectiles, emissive light from braziers/FX, packed atlases — **§3 (engine
   additions)**. These are the high-leverage work; everything else is a copy.
4. Delete the old third-party packs from `public/assets/` and prune their
   `CREDITS.md` entries. **§4**.

---

## 1. Drop-in map (source → repo destination)

> "DS" = path in this design system. "Repo" = path in `Krilliac/BrowserGame`
> (`public/` is the Vite web root, served as `/assets/...`).

| Category | DS path | Repo destination | Consumed by | Change needed |
|---|---|---|---|---|
| **Decor props** | `assets/decor/*.png` (+ `anim/`) | `public/assets/curated/decor/` (+ `anim/`) | `src/client/decor-sprites.ts` | **None** — same filenames, same content-box dimensions, foot-anchored, baked soft shadow. The existing `DECOR_SPRITES` `scale`/`anchorY` values stay valid. |
| **Terrain tilesheets** | `assets/terrain/{catacombs,cursed_ground,undead_ground,forest_spring}.png` | `public/assets/curated/tiles/` | `src/client/ground-tiles.ts` | **None** — 16px grid, identical sheet dimensions; the exact floor/detail cells `GROUND_TILESETS` references are valid (see §2). |
| **Loot icons (gems/runes/materials)** | `assets/icons/*.png` | regenerate `public/assets/icons/items_gen.png` via `tools/assetgen/icons`, **or** load individually | `src/client/item-icons.ts` | Pack into the 8-col sheet in `ICON_KEYS` order, **or** add an individual-file loader (see §3.5). |
| **Item / currency sheets** | `assets/items/*.png` | `public/assets/ui/items/` | inventory/vault/merchant panels | Same filenames; verify any hard-coded sub-rects (these are specimen sheets — prefer the generated `items_gen.png` for live icons). |
| **Spell / projectile FX** | `assets/fx/*.png` | `public/assets/ui/fx/` | projectile/FX renderer | Same filenames + **frame counts** (see §2 table). |
| **UI chrome** | `assets/ui/gw_*.png` | `public/assets/ui/` | HUD CSS / Canvas2D panels | Re-point references from `kenney_*` → `gw_*` (rename map in §1a). 9-slice border widths in §2. |
| **Mobs + hero** | `assets/mobs/*.png` | `public/assets/mobs/` | **new** mob-sprite layer | New module + renderer hook — **§3.1**. |

### 1a. UI filename rename map (kenney_ → gw_)
```
kenney_panel_brown / _beige          → gw_panel.png            (100×100, slice 18)
kenney_panelInset_brown / _beige     → gw_panel_inset.png      (93×94,  slice ~12)
kenney_barBack_horizontal{L,Mid,R}   → gw_bar_back_{left,mid,right}.png   (9/18/9 × 18)
kenney_barRed_horizontal{L,Mid,R}    → gw_bar_red_{left,mid,right}.png    (9/18/9 × 18)
kenney_barBlue_horizontal{L,R}       → gw_bar_blue_{left,mid,right}.png   (+ new mid)
kenney_buttonLong_brown              → gw_button.png           (190×49, slice 16/24)
kenney_buttonLong_brown_pressed      → gw_button_pressed.png   (190×45)
kenney_buttonRound_brown             → gw_button_round.png     (35×38)
```
Grep the repo for `kenney_` and swap to the `gw_` name. (If you prefer zero code
change, just rename the `gw_*` files back to the `kenney_*` names — the art is
drop-in either way.)

---

## 2. Frame & tile layout reference

**FX strips** (`assets/fx/`, 16px square frames unless noted — `frames = width / height`):

| File | Size | Frames | Animation |
|---|---|---|---|
| `spell_fireball.png` | 96×16 | 6 | growing flickering fireball |
| `spell_firebomb.png` | 96×16 | 6 | bomb (0–2) → burst (3–5) |
| `spell_ice_lance.png` | 64×16 | 4 | shard + frost trail (travels +x) |
| `spell_arcane_bolt.png` | 96×16 | 6 | violet orb w/ crackle |
| `spell_water_bolt.png` | 96×16 | 6 | water droplet + trail |
| `spell_magic_orb.png` | 96×16 | 6 | pulsing orb (loop) |
| `spell_magic_sparks.png` | 96×16 | 6 | cast burst (expand+fade) |
| `spell_splash.png` | 192×32 | 6 | impact ring (32px frames) |
| `spell_rock_sling.png` | 16×16 | 1 | single tumbling rock |
| `spell_arrows.png` | 352×448 | 11×14 grid, 32px | arrows in 8 dirs × 7 tints |
| `explosion-cuzco.png` | 256×256 | 4×4 grid, 64px | 16-frame explosion → smoke |

**Animated decor** (`assets/decor/anim/`, 16×16, 4-frame flicker loops):
`brazier-1..4.png`, `candle-1..4.png`. Play at ~8 fps; light-emitters (see §3.3).

**Terrain cells** (16px grid; the cells `ground-tiles.ts` already reads are valid):

| Sheet | Base floor cells | Detail cells (placed) |
|---|---|---|
| `catacombs.png` (64×40) | slabs everywhere; `crypt` reads cols 49–50 rows 13–15 | cobbled rubble at cols 49–50 rows 17–18 |
| `cursed_ground.png` (45×35) | mauve earth; `cursed` reads col 24 rows 4–7 | red veins at cols 19–20 rows 5–6 |
| `undead_ground.png` (31×37) | cracked earth; `graveyard` reads row 22 cols 20,22–26 | heavy-crack variants on row 22 |
| `forest_spring.png` (16×16) | grass at col 0 rows 1–5 | flowers rows 6–7 cols 0–3; dirt path col 4 rows 1–3 |

**Mob animation strips** (`assets/mobs/<name>_<state>.png`): 4 frames × 64px = **256×64**,
states `idle` / `walk` / `attack`, for all 29 mobs. Play at ~7fps (`steps(4)`); attack is a
one-shot, idle/walk loop.

**9-slice chrome** (`assets/ui/gw_*`): `border-image-slice` = panel **18**,
inset **12**, button **16** (top/bottom) / **24** (left/right). Bars are 3-slice:
fixed-width L/R caps (9px) + stretchable mid (18px).

**Loot icons** (`assets/icons/`): faceted gems `gem-{amethyst,diamond,emerald,jade,
onyx,opal,ruby,sapphire,topaz}.png`; runes `rune-{el,dol,nef,ort,ral,sol,thul,tir,
vex,zod}.png` (vex/zod use the hotter "high rune" tint); materials
`material-{ember-ore,frost-core,rune-shard}.png`. All 64×64, centered, transparent.

---

## 3. Engine / rendering additions (the work worth doing)

These are the changes that let the renderer **fully exploit** the new art beyond a
file swap. Ordered by leverage.

### 3.1 Mob sprite layer (highest impact — the repo currently draws mobs as procedural shapes)
Today `rogues-sprites.ts` maps mob *names* → grid cells in the (now-removed)
32rogues sheets, and `pixi-renderer.ts` falls back to procedural tokens. Replace
that with the original archetype sprites:

- Add **`src/client/mob-sprites.ts`** (mirror `decor-sprites.ts`): an archetype map
  `{ src, scale, anchorY }` keyed by the same archetype labels `MOB_RULES` already
  resolves to, pointing at `/assets/mobs/*.png`. **29 sprites ship** (hero ×3 facings
  + skeleton, zombie, ghoul, wraith, banshee, reaper, lich, cultist, demon, imp, orc,
  goblin, troll, minotaur, golem, naga, gorgon, hellhound, bat, spider, slime, kobold,
  myconid, giant-rat, giant-worm, giant-centipede) — enough to cover every archetype
  `MOB_RULES` resolves to. Reuse the existing `MOB_RULES` regex table to turn a DB
  display-name into an archetype, then this map to a sprite.
- **Animation:** each mob also ships **4-frame loops** `mobs/<name>_{idle,walk,attack}.png`
  (256×64, frame = 64²). Drive them through `animation-controller.ts`: idle on spawn/wait,
  walk while the entity is moving, attack one-shot on swing (then back to idle). Flyers
  (`bat`) and stationary mobs (`slime`, `giant-worm`) use a hover/pulse instead of a stride.
  The static `mobs/<name>.png` stays the portrait / fallback frame. **hero, skeleton, orc and
  goblin** ship **true per-limb cycles** (swinging legs with knee bend, counter-swinging arms,
  weapon arc) instead of the whole-sprite transform — same 256×64 layout, so they wire identically.

  ```ts
  export const MOB_SPRITES: Record<string, {src:string; scale:number; anchorY?:number}> = {
    skeleton:  { src:'/assets/mobs/skeleton.png',  scale:0.5 },
    zombie:    { src:'/assets/mobs/zombie.png',    scale:0.5 },  // + ghoul
    wraith:    { src:'/assets/mobs/wraith.png',    scale:0.5 },  // + banshee/reaper/shade/wight
    cultist:   { src:'/assets/mobs/cultist.png',   scale:0.5 },  // + acolyte/faceless-monk
    demon:     { src:'/assets/mobs/demon.png',     scale:0.55 },// + imp/devil
    hellhound: { src:'/assets/mobs/hellhound.png', scale:0.5 },  // + dire-wolf/warg/hound
    bat:       { src:'/assets/mobs/bat.png',       scale:0.45 },
    spider:    { src:'/assets/mobs/spider.png',    scale:0.5 },  // + brood
    slime:     { src:'/assets/mobs/slime.png',     scale:0.5 },  // + ooze
  };
  ```
- In the entity render path: foot-anchor + y-sort + soft shadow exactly like
  `makeDecorProp` already does for decor; that machinery exists — point it at mobs.
- **Player:** `hero.png` replaces the procedural player token (and the old
  `rogues.png` knight cell). It's front-facing; for 8-direction facing either author
  directional variants (`hero_{n,ne,e,…}.png`) or billboard + horizontal flip for
  left/right as a cheap first pass.
- Anything without an archetype keeps the procedural shape (no regression).

### 3.2 Animated projectiles + impacts
`animation-controller.ts` already exists for frame stepping. Wire it to the FX
strips: a projectile entity plays its strip on loop (e.g. `spell_fireball` 6 frames)
oriented along its velocity, and on hit swaps to a one-shot impact
(`explosion-cuzco` 16f for fire, `spell_splash` 6f for frost/water). Draw FX with
**additive blend** (`lighter`) so the baked glows read against the dark ground.
Map element → strip via the `--fx-*` palette (fire/frost/arcane/poison/holy/blood).

### 3.3 Emissive lighting from props & FX
`deferred-lighting.ts` / `lighting.ts` already do deferred light. Register light
emitters so the new art actually lights the scene:
- braziers/candles (`decor/anim/*`) → warm point light, radius ~120/40px, color
  `--warn`/`#ffb03a`, intensity pulsed off the 4-frame loop phase.
- active projectiles & explosions → short-lived lights tinted by element.
- legendary/corrupted ground drops → a soft beacon in the rarity color.
This is what makes a torch-lit Diablo scene; the assets are drawn to glow but need
the light pass to push it.

### 3.4 Ground edge-blend & dirt paths
`ground-tiles.ts` already supports clustered `patch` blobs and seamless `path`
trails. The new tilesheets include the detail cells those features reference (veins,
flowers, dirt). Optional polish: author 16px **edge-transition** tiles for biome
borders (e.g. catacomb→cursed) and add them as a `blend.patch` set, or add a
2nd-pass alpha-feather between adjacent biome TilingSprites.

### 3.5 Item-icon pipeline
Two options, pick one:
- **(preferred) regenerate `items_gen.png`**: extend `tools/assetgen/icons` with the
  faceted-gem / rune / material routines (ported from §5) and emit the 8-column
  sheet in `ICON_KEYS` order. `item-icons.ts` then works unchanged.
- **individual loader**: add a fallback in `drawItemIcon` that, when a key has a
  matching `/assets/icons/<key>.png`, draws that file. Lower throughput (many
  textures) — fine for panels, not for dense grids.

### 3.6 Decals
`decals.ts` exists. Add blood splat (on-hit, `--fx-blood`) and scorch (on
fire-death) decals, drawn under entities and faded over time — cheap gore that fits
the brief. Reuse the FX palette; no new art required (radial + speckle).

### 3.7 Texture atlas packing (performance)
Individual PNGs are fine functionally but Pixi prefers a packed atlas. Add a
`tools/assetgen` step that packs `mobs/`, `decor/`, `fx/`, `icons/` into one (or a
few) atlas PNG + JSON frame map, and load via `Assets`/`Spritesheet`. Do this once
the set stabilizes.

### 3.8 Preload manifest
Add the new paths to the asset loader/preload list so first-paint doesn't pop. Group
by scene (HUD chrome + icons eager; biome decor/terrain lazy per area).

---

## 4. Cleanup after adoption
- Delete `public/assets/curated/{rogues,monsters,animals,items}.png`,
  `public/assets/curated/tiles/*` (old packs), the Kenney `ui/*`, and the
  CraftPix/Mana-Seed/Szadi pack folders.
- Remove `rogues-sprites.ts` (replaced by `mob-sprites.ts`) or repoint it.
- Prune `public/assets/CREDITS.md` / `INVENTORY.md` third-party rows — the art is
  now original and needs no attribution.

---

## 5. Asset generator pipeline (how this art was made / how to extend)
All art was produced by deterministic **Canvas2D** routines in the locked Gloomwood
palette (`tokens/colors.css`), supersampled (3–4×) and downscaled for clean edges,
with a per-pixel grain pass. Core routines, reusable for new content:
- **palette + helpers**: `mix`/`mix3` color ramps, seeded `mulberry32` RNG,
  `glow()` radial, `grain()`, `shadow()` foot-ellipse.
- **faceted gem**: brilliant-cut facet fan, per-facet lambert-ish shading from a
  fixed light dir, rarity-tinted outer glow (opal = per-facet pastel).
- **rune tile**: beveled obsidian tile + engraved+glowing glyph (10 glyph paths).
- **FX**: flame tongues, particle bursts, expanding rings, additive cores.
- **decor**: recursive branch trees, boulder polygons, bone primitives, amphora,
  crystal shards, fleshy horror parts (eyes/jaws/tentacles).
- **mobs**: chunky humanoid rig (legs/torso/arms/head + accessories) and beast forms.
- **terrain**: per-16px-cell biome floor with hash variation + placed detail cells.

To extend (new mob, new gem, new biome): the generators are **committed and runnable**
in this design system's **`tools/assetgen/`** (node-canvas; `npm i && node build.js`,
outputs to `../../public/assets`). Add a `draw()` to the relevant module (see its
README) and re-run. The art is intentionally **programmatic, not hand-painted** — production-ready as a coherent
placeholder layer and art-direction reference; an artist can repaint over any sprite
using it as the silhouette/shading guide.

---

## 6. QA checklist
- [ ] Decor renders foot-anchored, correct size (scales unchanged from `decor-sprites.ts`).
- [ ] Each biome's ground tiles cleanly with no transparent cells at the referenced coords.
- [ ] FX strips animate at the documented frame counts; impacts fire on hit.
- [ ] Mobs resolve by archetype; unknown names fall back to procedural (no crash).
- [ ] Braziers/candles emit light and loop.
- [ ] HUD chrome 9-slices without corner stretching at panel/button sizes.
- [ ] No remaining references to `kenney_*` / 32rogues / CraftPix paths.
