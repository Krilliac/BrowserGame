# Renderer 3D-Feel + Animation Implementation Plan (PixiJS v8)

Synthesis of four research reports into one prioritized, codebase-aware plan for
`src/client/pixi-renderer.ts` (~845 lines) plus its `atmosphere.ts` / `weather.ts` /
`lighting.ts` siblings. Target: make the tilted billboard renderer (PITCH=0.64, LPC
64px sheets, y-sort by world-y) read more like Diablo 2/3 and add a real animation
system — all practical in PixiJS v8 and phone-friendly.

> Status: research complete (4 web-research agents + synthesis, June 2026). Implementation
> proceeds in the sequenced slices in §4. Full source URLs are in the per-topic reports captured
> in the workflow transcript.

**Grounding facts (verified against the code):**
- `Sheet` carries `rows: Record<Dir,number>`, `walkCols`, `idleCol`; `updateActor` steps frames
  with `Math.floor(now/120ms) % walkCols.length` and has no action states.
- `frame(alias,fw,fh,col,row)` already slices + caches sub-`Texture`s over a shared source.
- Shadows are flat `Graphics` ellipses (alpha 0.35) built in `makeActor`/`updateProjectile`.
- One full-stage `ColorMatrixFilter` grade on `this.world`; `Atmosphere` does day/night wash +
  vignette; `Lighting` does additive torch+portal lights; weather/shake/fade exist.
- `FxEvent.kind` is `melee|hit|cast|death|pickup|coin|levelup|telegraph|slam`; `telegraph` carries
  windup ms in `value`, plus `behavior` and `facing`. **No new wire fields needed.**
- Assets: `hero_walk_lpc.png`, `skeleton_lpc.png` are 832×1344 = 13 cols × **21 rows** = the full
  ULPC block stack (spellcast/thrust/walk/slash/shoot/hurt), not a walk-only crop — so attack/cast/
  hurt/death rows are already present. `wolf_lpc.png`/`bat.png` are walk-only.

The headline finding across all four reports: **the Diablo "3D feel" is faked light/shadow on flat
sprites, not real 3D.** Stay in the D2/Hades-1 pre-rendered-sprite lane. Skip normal-mapped deferred
lighting (`pixi-lights` is v7/@pixi/layers-only — does not work in v8).

---

## 1. 3D-feel quick wins (highest impact-per-effort first)

Cheap, build on code already present, need **no new art**.

### 1.1 Skewed/offset blob shadows leaning away from the light (Low, very high) — **done**
Make the foot ellipse lean + lengthen away from the light (`shadow.skew.x`, `shadow.scale.y`,
`shadow.position`). No shader. Store the shadow ref on `ActorView`.

**Implemented** in two passes against a **fixed baked sun** rather than the screen-center torch — the
project deliberately keeps every shadow leaning the same way (the consistent D2 baked-light look), so
direction is constant and only the sun's *altitude* animates:
- The skewed/offset blob + the sheared sprite-copy cast shadow (hero/elites) are the planted base
  (`makeActor`, `SHADOW_OFFSET_*`/`SHADOW_SKEW`), with the shadow ref captured on
  `ActorView.shadowPlanted`.
- **Time-of-day rake** (`client/sun-shadow.ts`, pure + tested): `Atmosphere.sunShadow()` maps the
  day/night `daylight` to length + alpha multipliers (identity at noon and indoors). The renderer
  samples it once per frame and the single shadow updater (`liftShadow`) lengthens `scale.y` + the
  offset reach (not width) and fades alpha, so shadows are short/dark at noon and long/faint at
  dawn/dusk. Applied to blob, cast copy, loot, and projectile shadows; static decor keeps its baked
  foot shadows (raking is scoped to per-frame entities). Torch-relative *direction* swing was
  intentionally skipped to preserve the baked-sun consistency.

### 1.2 Soft baked AO shadow + darkened sprite base (Low, high)
Bake a radial-gradient soft ellipse texture once (canvas → `Texture`), use a `Sprite` for the shadow
(soft edges). Bake a vertical bottom-darkening gradient and add it as a `blendMode:'multiply'` child
so feet sink into the ground — the #1 "planted vs floating" cue.

### 1.3 z-height channel (Low, high) — **done (height-reactive shadows)**
Generalize `PROJECTILE_HEIGHT` (sprite raised, shadow on plane) into a reusable `z`: sprite at `-z`,
shadow `scale`↓ + `alpha`↓ as `z` grows. Drives leaps, knock-ups, loot-pop arc.

**Implemented** as the `client/shadow-lift.ts` pure helper: `shadowLift(lift, falloff?)` maps an
elevation in world px to `{scale, alpha}` multipliers for the planted ground shadow (identity at
`lift === 0`). The renderer reads the lift it already computes — the bob/hover on actors
(`view.sprite.y`), the loot-pop hop (`drop.y`), and the constant `PROJECTILE_HEIGHT` — and multiplies
the captured planted shadow metrics (`ActorView.shadowPlanted`) each frame via `liftShadow(...)`. No
shader, no new wire fields, quality-agnostic. A standalone reusable `z` per entity wasn't needed: the
elevations are all already local to their render paths, so threading a new state field would have been
bloat for no extra capability.

### 1.4 Faux-perspective scale + camera dolly offset (Low–Med, high)
Subtle depth scale by screen-y (near ~1.1, far ~0.9, clamped). Bias `originY` so the player sits
slightly below center (`sh/2` → `sh*0.58`); keep `PLAYER_LIGHT.y` + `ground.tilePosition` aligned.

### 1.5 Depth fog / edge desaturation + warm rim near torch (Low, med-high)
Extend `Atmosphere` vignette toward a cool desaturated edge tint keyed to `theme.fogColor`. Bias
actors near center toward warm `PLAYER_LIGHT.color` (proximity-scaled) for a directional key.

### 1.6 Bloom on FX layer only (Med, med — quality-gated)
`pixi-filters@^6` (the v8 line). `AdvancedBloomFilter` on `fxLayer` + `lighting.layer` ONLY, never
`this.world`; `resolution=0.5`, set `filterArea`. Gate behind a `quality` flag (off on phone).

**Skip:** normal-map deferred lighting (v7/@pixi/layers only, needs per-frame normal maps).

---

## 2. Animation system — `src/client/animation-controller.ts` (new module)

Custom controller (not raw `AnimatedSprite`) so we own the clock, sync one-shots to `FxEvent`s, and
hold the death frame. Framework-free + unit-tested.

### 2.1 Data model — generalize `Sheet` to named clips
```ts
type AnimState = 'idle' | 'walk' | 'attack' | 'cast' | 'hurt' | 'death';
type Dir = 'N' | 'W' | 'S' | 'E';
interface Clip { row0: number; frames: number; perFrameMs: number; loop: boolean; }
interface Sheet { src; fw; fh; scale; dirOrder: ['N','W','S','E']; clips: Partial<Record<AnimState, Clip>>; }
```
Row for a direction = `clip.row0 + dirIndex`. Sheets lacking a state (wolf/bat) fall back to walk/idle.

### 2.2 LPC row mapping (64px universal, 21 rows; dir order up(N)/left(W)/down(S)/right(E))
| State | block | row0 | frames |
|---|---|---|---|
| cast | spellcast | 0 | 7 |
| (thrust) | thrust | 4 | 8 |
| walk | walkcycle | 8 | 9 (col 0 = idle) |
| idle | walkcycle | 8 | 1 |
| attack | slash | 12 | 6 |
| (shoot) | shoot | 16 | 13 |
| hurt | hurt | 20 | 6 (S row authored; reuse for all dirs) |
| death | hurt | 20 | 6 (hold last frame as corpse) |

### 2.3 Per-entity clock + priority state machine
Per-`ActorView` accumulator (`animTime`, `state`, `dir`, `action?`). Priority high→low: death
(terminal, holds) > hurt (flinch) > cast/attack (one-shot) > walk/idle (by measured speed). Movement
does not interrupt a one-shot. Frame = `action?.hold ? frames-1 : floor(animTime/perFrameMs) % frames`.

### 2.4 Event hooks from FxEvents (no new wire fields)
- `telegraph` (`value`=windup ms, `behavior`): start attack/cast windup, scale `perFrameMs` so a
  faster attack plays a snappier swing.
- `melee`/`cast`/`slam`: strike instant — advance the one-shot to its impact frame.
- HP drop (already detected for `flashUntil`): fire `hurt`.
- `death` (already kicks shake): play `death`, hold last frame; delay view destruction ~400ms via a
  small dying-grace list so the corpse pose shows before the `!seen` sweep.
- **Authority:** animation is 100% cosmetic — never gates damage/cooldown/position.

### 2.5 Integration
`updateActor` shrinks to `const {row,col} = controller.resolve(view, e, dtMs, now)` then
`view.sprite.texture = frame(...)` + bob. Pre-build per-(state,dir) `Texture[]` at `makeActor` time
(reusing `frame()`'s cache) → per-frame cost is one index + a `.texture =` assign, zero allocation.

### 2.6 Unit test
Assert the transition table: telegraph→attack windup scaling, hurt interrupts attack, death terminal
+ holds, locomotion resumes after a one-shot.

---

## 3. Assets

Atlas with **Free Texture Packer** → JSON (Hash) (Array format breaks `sheet.textures`/`animations`).
`texture.source.scaleMode='nearest'` for crisp pixels. One atlas per concern (characters/monsters/
fx/terrain/icons) so phone memory stays bounded and areas lazy-load. Name frames
`actor.state.direction.frameNNN.png` so the packer auto-groups into `sheet.animations`.

| Need | Pack | License | URL |
|---|---|---|---|
| Characters + anim rows | LPC Universal Generator | CC-BY-SA/CC-BY/GPL | https://liberatedpixelcup.github.io/Universal-LPC-Spritesheet-Character-Generator/ |
| Expanded idle/run/jump combat | ElizaWy ULPC | mixed | https://opengameart.org/content/expanded-universal-lpc-spritesheet-idle-run-jump-lpc-revised-combat-and-assets |
| Monsters (static) | DCSS 32×32 supplemental | CC0 | https://opengameart.org/content/dungeon-crawl-32x32-tiles-supplemental |
| Monsters (animated) | Pipoya Free RPG Monster Pack | credit-optional | https://pipoya.itch.io/free-rpg-monster-pack |
| Tilemap ground | [LPC] Terrains | CC-BY-SA | https://opengameart.org/content/lpc-terrains |
| Tilemap (CC0) | Kenney Roguelike/RPG | CC0 | https://kenney.nl/assets/roguelike-rpg-pack |
| FX strips | CodeManu Pixel Effects | public domain | https://codemanu.itch.io/pixelart-effect-pack |
| FX (CC0) | OGA CC0 Special Effects | CC0 | https://opengameart.org/content/cc0-special-effects |
| Icons | game-icons.net | CC-BY 3.0 | https://game-icons.net/ |

Ship a machine-readable `ASSETS_CREDITS.md` at repo root; surface on an in-game credits screen.
CC-BY/CC-BY-SA/OGA-BY require per-asset attribution; never silently mix share-alike art into a sheet
you'd want to relicense (binds the art, not your game code).

---

## 4. Sequenced slices (each `npm run check` + `scripts/screenshot.mjs` verified)

1. **Directional shadows + AO** (low risk) — skewed/offset shadow leaning from torch + soft baked
   shadow texture + bottom-darken gradient. No new art/deps. Add `shadow?` to `ActorView`.
2. **Animation system** (medium, highest payoff) — generalize `Sheet`→clips; new
   `animation-controller.ts` + per-entity clock; wire FxEvent hooks (attack/cast/hurt/death with
   telegraph-scaled timing). Controller unit test. Keep cosmetic/server-authoritative; pre-build
   `Texture[]`; dying-grace list must not leak views.
3. **Depth & camera** (low) — z-height channel + faux-perspective scale + dolly offset. Keep
   `originY`/`PLAYER_LIGHT.y`/`ground.tilePosition` aligned; clamp depth-scale.
4. **Atmosphere polish** (low) — edge desaturation/fog tint + warm rim near torch. Reuses passes.
5. **Post-process FX** (medium, quality-gated) — `pixi-filters@^6` AdvancedBloom on FX+lighting at
   `resolution=0.5` behind a `quality` flag; optional ShockwaveFilter on slam. Always set
   `filterArea`; null when off; profile on a real phone.
6. **Asset upgrade** (low, mostly data) — full LPC sheets + atlas via Free Texture Packer (JSON-Hash),
   migrate `Assets.load` to atlas JSON + `sheet.animations`, ship `ASSETS_CREDITS.md`. Optionally
   `@pixi/tilemap` v5 + [LPC] Terrains to replace procedural ground (1 draw call). Defer if
   scope-bound; `cacheAsTexture` static chunks meanwhile.

### Phone-perf guardrails
WebGL in prod (CPU/batch-bound). Filters per-stage never per-object; always set `filterArea`; null
when unused. Atlas everything (batches ≤16 textures/draw). Group same-blendMode FX in z-order. No
per-frame allocation (reuse pools). `cacheAsTexture` static layers; cap resolution/FPS on phones.

**Bottom line:** Slices 1–3 are the transformative, low-risk core (directional shadows, animation,
depth) and need no new dependencies. Slice 4 is free atmosphere. Slice 5 is quality-gated desktop
punch. Slice 6 is the art/data upgrade.
