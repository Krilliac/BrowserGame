# Rendering Engines & Open Art Sources — Research

> One-line summary: For BrowserGame's top-down WoW/Diablo/WC3/RuneScape look, adopt **PixiJS v8** (MIT, WebGL/WebGPU) behind the existing `draw.ts` boundary, author maps in the **Tiled** editor (`.tmj`), pack sprites with **TexturePacker/Free Texture Packer**, and source art from **CC0** packs (Kenney, OGA CC0) first — treating **LPC** (CC-BY-SA 3.0 / GPLv3) as a powerful but share-alike option requiring attribution and derived-art relicensing.

This page targets THIS codebase: the renderer is isolated in `src/client/draw.ts` (raw Canvas2D — tiled biomes via `drawWorld`, top-down figures via `drawCharacter`, projectiles, FX, items) and driven from `src/client/main.ts`. The world is server-authoritative; the client only *draws* what the server resolved (see [Combat.md](../architecture/Combat.md)). Entities arrive as `EntityState` with `facing` (radians), `kind`, `hue`, `hp/maxHp`, `level`, `abilityId`, `itemId`. Any renderer swap must keep that contract and the per-area biome concept (`town`, `wilderness`, `crypt`).

---

## 1. Web rendering engines

### What we need
A top-down sprite/tile MMO client: many moving sprites (players, roaming mobs, projectiles, FX), tilemap ground, depth-sorted characters, damage-number/particle FX, and a 2D HUD — all phone-friendly and small to download. We do **not** need 3D, physics (the server owns simulation), or a built-in scene/entity system (we already have an authoritative `World` + snapshot model). That pushes us toward a **renderer**, not a full game framework.

### Comparison

| Engine | Type | Renderer | Bundle (min) | TS support | License | Top-down fit | Learning curve |
|---|---|---|---|---|---|---|---|
| **PixiJS v8** | 2D renderer | WebGL + WebGPU | ~450–480 KB, tree-shakable | First-class (written in TS) | **MIT** | Excellent — fastest pure 2D, `Sprite`/`AnimatedSprite`, `@pixi/tilemap`, particles | Low–medium |
| **Phaser 3/4** | 2D game framework | WebGL/Canvas | ~1.2 MB | Good (typings) | **MIT** | Excellent — built-in Tiled tilemaps, scenes, arcade physics | Medium (opinionated) |
| **melonJS** | 2D framework | WebGL/Canvas | Mid | Good (TS boilerplate, typings) | **MIT** | Good — tight Tiled integration, lighter than Phaser | Medium |
| **Excalibur** | 2D framework | WebGL | Mid | **Written in TS** (best DX) | **BSD-2** | Good — clean class API, Tiled plugin | Medium |
| **Kontra** | Micro 2D lib | Canvas2D | ~10–14 KB | Typings | **MIT** | Minimal — barebones; you build everything | Low |
| **Babylon.js** | 3D engine | WebGL/WebGPU | ~1.4 MB+ | First-class | **Apache-2.0** | Overkill — fast even at 2D but heavy for sprites | High |
| **three.js** | 3D engine | WebGL/WebGPU | Large | Typings | **MIT** | Overkill for top-down sprites | High |
| **PlayCanvas** | 3D engine | WebGL/WebGPU | Large | Good | **MIT** (engine) | Overkill | High |

**Performance** (Shirajuki js-game-rendering-benchmark, 10,000 sprites): Babylon.js ~56 FPS, **PixiJS ~47 FPS**, Phaser ~43 FPS, Kontra ~60 FPS (but fixed 1/60 step, choppier motion). PixiJS is consistently the fastest *pure 2D* renderer at our scale, with the smallest tree-shakable bundle. Babylon's edge comes from being a heavyweight 3D engine — not worth its bundle/complexity for sprites.

### Recommendation: **PixiJS v8** as the single primary path

Why PixiJS over the alternatives for *this* project:
- **It's a renderer, not a framework.** We already own simulation, netcode, input, and the snapshot/interpolation loop. Phaser/melonJS/Excalibur bundle scene graphs, physics, and entity systems we'd have to ignore or fight. PixiJS gives us exactly the missing piece — a fast WebGL/WebGPU 2D batcher — and nothing we'd have to throw away. This matches the project pillar "Simple over clever / one source of truth."
- **Smallest, tree-shakable bundle** (~450 KB, vs Phaser's ~1.2 MB) — directly serves the phone-friendly pillar.
- **MIT license**, written in TypeScript, strict-mode friendly — aligns with our `verbatimModuleSyntax` / strict TS standards.
- **WebGPU-ready** (v8 has WebGPU as a core renderer; default fell back to WebGL in v8.1 for browser consistency — so we get WebGPU automatically as it matures, no rewrite).
- **Ecosystem covers our needs:** `@pixi/tilemap` (batched tile layers), `AnimatedSprite` (directional character/FX animation from a spritesheet), `@pixi/particle-emitter` (projectile trails, death bursts), `pixi-viewport` (camera/culling — replaces our manual `camX/camY` math).

Phaser is the reasonable runner-up *if* we ever wanted its batteries (built-in Tiled loader + arcade physics + tween/scene manager) and accepted the larger bundle and a more opinionated structure. We don't — our server is authoritative, so its physics/scene systems are redundant. Excalibur is the best pure-TS DX if we wanted a framework, but same "redundant framework" objection. Kontra is too minimal to buy us much over our current Canvas2D. 3D engines (Babylon/three/PlayCanvas) are rejected: bundle size, learning curve, and no payoff for a 2D top-down sprite look.

### Migration approach (incremental, low-risk)

The whole point of the isolated `draw.ts` is that this is a contained swap. Suggested phasing:

1. **Introduce a renderer interface.** Define a thin `Renderer` abstraction (the functions already in `draw.ts`: `drawWorld`, `drawCharacter`, `drawProjectile`, `drawItem`, `drawFx`, plus a `resize`/`frame` lifecycle). Keep the current Canvas2D implementation as `Canvas2DRenderer` so nothing breaks.
2. **Add `PixiRenderer` behind the same interface.** Stand up a Pixi `Application`, a `Container` per layer (ground → props → entities → projectiles → FX → HUD overlay). Port `drawCharacter` first to a `Sprite`/`Graphics` so we can A/B the two renderers behind a flag.
3. **Replace primitives with sprites layer by layer.** Characters → directional `AnimatedSprite` driven by `EntityState.facing` + a state derived from movement/`abilityId` (see §3). Projectiles → sprites + particle trails keyed off `abilityId`. FX (`drawFx`) → particle emitters / tween-faded sprites, preserving the existing `hit`/`melee`/`cast`/`death` events and `FX_DURATION` fade.
4. **Swap the world.** Replace the `hash2`-based procedural biomes (`drawWorld`) with a `@pixi/tilemap` layer fed by **Tiled** `.tmj` maps (see §2). Depth-sort entities by Y within the entity container for correct top-down overlap (RuneScape/Diablo feel).
5. **Camera & culling.** Replace manual `camX/camY` with `pixi-viewport` for follow-camera + automatic off-screen culling.
6. **Retire `Canvas2DRenderer`** once parity is reached (no parallel systems — anti-bloat).

HUD note: `drawHud` in `main.ts` (HP/MP bars, hotbar, cooldown sweeps) can stay DOM/Canvas2D overlaid on the Pixi canvas, or move into a Pixi UI layer later. Keep it out of the critical-path migration.

---

## 2. Tilemaps — authoring real maps instead of hash-based props

Today `drawWorld` invents terrain from a position hash (`hash2`) — detailed but uncontrolled and unauthorable. To get a designed WoW/Diablo look we want hand-built maps.

### Tooling
- **Tiled** (mapeditor.org) — the de-facto free, open-source 2D map editor. Exports **`.tmx`** (XML) or **`.tmj`** (JSON). Supports orthogonal, **isometric**, staggered, and hexagonal orientations; tile/object/image/group layers; per-tile properties; and **Automapping** (rule-based autotiling) — great for painting coherent terrain transitions (grass→dirt→stone edges) without hand-placing every edge tile.
- **Loaders for our chosen path (PixiJS):**
  - **`@pixi/tilemap`** — low-level, batched, mesh-backed tile layer renderer (the performance primitive).
  - **`pixi-tiledmap`** (riebel) — Pixi v8 loader written in TS, no deps, JSON/XML, auto-detects `.tmj`/`.tmx`, supports all layer types and all orientations, animated tiles, flip/rotation flags, tints, object templates. Load via `Assets.load('map.tmj')`. This is the most direct adoption for us.
  - **`@kayahr/tiled`** — TypeScript types + runtime validators for the Tiled JSON format (framework-agnostic). Useful to *type and validate* a `.tmj` we load ourselves before handing layers to `@pixi/tilemap` — fits our "validate at the boundary" discipline.
- (If we had picked Phaser/melonJS, both have first-class built-in Tiled tilemap loaders — a point in their favor we're consciously trading away for PixiJS's smaller/cleaner footprint.)

### Orientation: orthographic vs isometric
- **Orthographic top-down** (square tiles, straight-down camera) — matches our current look, RuneScape/early-Diablo flavor, simplest depth sorting (by Y), easiest art sourcing (most CC0 packs are orthographic). **Recommended** as the near-term target.
- **Isometric** (2:1 diamond tiles) — more "Diablo II / WC3" depth and dimensionality, but needs iso art, iso depth-sorting, and screen↔world coordinate transforms. A possible later upgrade; Tiled + `pixi-tiledmap` both support it, so we can defer the decision without changing tools.

### Workflow we'd adopt
1. Build a **tileset** PNG per biome (terrain + transitions + props) — from CC0 packs in §4.
2. In Tiled, author one `.tmj` **per area** (`town`, `wilderness`, `crypt`) matching `src/shared/areas.ts`; use ground/decoration/collision-hint layers and Automapping for terrain edges.
3. Store maps under `public/` (static assets, per the layout in CLAUDE.md). Client loads the area's `.tmj`, validates with `@kayahr/tiled` types, renders ground/props via `@pixi/tilemap`.
4. The server stays authoritative on collision/areas; map files are **visual** + optional design-time metadata. (If we ever want server-side collision from maps, export a collision layer and consume it server-side too — single source of truth via the shared `.tmj`.)

---

## 3. Sprites & directional animation

### Atlas / spritesheet tooling
- **TexturePacker** (codeandweb) — industry standard; **free tier** is sufficient for PixiJS sheets. Has a dedicated PixiJS v8 exporter (JSON + PNG, trimming, rotation, multipack). Folder-recursive naming yields `character/walk_01.png` style frame names that map cleanly to `AnimatedSprite` animations.
- **Free Texture Packer** (free-tex-packer.com) — fully free/open, no watermark; exports PixiJS/Phaser/Godot/JSON formats. Good default for an open project.
- **Aseprite** (paid, ~$20, or build-from-source free) — pixel-art editor + animator; its sheet exporter emits JSON Hash ready for PixiJS/Phaser. Ideal if we author/edit our own pixel art and animations.
- **PixiJS `Spritesheet` + `AnimatedSprite`** consume any of these JSON+PNG atlases directly.

### Driving animation from our entity model
Our `EntityState` already carries `facing` (radians) and `kind`; the server emits `cast`/`melee` FX events. To drive directional sprites:
- **Direction:** quantize `facing` into 4 or 8 compass directions (`Math.round(facing / (2π/8))`) and pick the matching directional animation row (LPC sheets are laid out exactly as N/W/S/E walk/attack rows — see §4).
- **State:** derive `idle` vs `walk` from whether the entity's interpolated position changed since last frame (the client already interpolates snapshots); trigger `attack`/`cast` one-shot animations when a `melee`/`cast` `FxEvent` for that entity arrives. Map our four abilities (Slash/Fireball/Arrow/Frostbolt from `src/shared/combat.ts`) to attack/cast animations + projectile sprites keyed by `abilityId` (we already key colors by `abilityId` — extend the same table with texture/anim names).
- **Self highlight:** keep the gold-ring/`isSelf` treatment as a Pixi overlay sprite.

This keeps the **server authoritative** (animation is purely cosmetic, derived from already-broadcast state) — no new trust surface.

---

## 4. Open art / asset sources (licenses for a distributable game)

License priority for a game we may distribute: **CC0 first** (no obligations), then **CC-BY** (attribution only), and **CC-BY-SA / GPL with care** (share-alike / copyleft obligations). Flagged clearly below.

| Source / Pack | Content | License | Obligations | Notes |
|---|---|---|---|---|
| **Kenney — Roguelike/RPG pack** | ~1700 top-down RPG tiles | **CC0** | None | Huge orthographic top-down set; great starter terrain+props |
| **Kenney — Roguelike Caves & Dungeons** | ~520 dungeon/cave tiles | **CC0** | None | Fits our `crypt` biome |
| **Kenney — Tiny Dungeon** | ~130 dungeon tiles | **CC0** | None | Clean minimalist option |
| **Kenney — RPG Base** | ~230 RPG tiles | **CC0** | None | Terrain/building basics |
| **Kenney — Scribble Dungeons** | top-down dungeon tiles + chars/weapons + vector source | **CC0** | None | Includes characters & items; editable source |
| **Kenney — Impact / UI / Interface audio + sprite UI** | UI frames, icons | **CC0** | None | For HUD/hotbar polish |
| **OpenGameArt — Top Down Dungeon Pack** | 2256 × 64×64 top-down tiles | **CC0** | None | Seamless tiling; great for prototyping crypts/dungeons |
| **OpenGameArt — DawnLike (16×16 roguelike)** | universal terrain/monsters/items | **CC-BY 4.0** | Attribution | Massive monster/terrain coverage; verify per-file |
| **OpenGameArt — Dungeon Crawl Stone Soup tiles (32×32)** | monsters, items, terrain | **CC0** | None | Enormous fantasy monster/item library |
| **OpenGameArt — "Top Down Fantasy RPG for Commercial Use"** | top-down terrain/props | (check page) | Per-file | Confirm exact license on the entry before use |
| **LPC Base Assets (sprites & map tiles)** | characters, terrain, dungeon | **CC-BY-SA 3.0 OR GPLv3 (dual)** | **Attribution + share-alike on derived ART** | See caveats below — our recommended *character* source |
| **LPC Character Generator (pflat / Universal-LPC)** | composable directional character sprites | **CC-BY-SA 3.0 / GPLv3 (+ some others per part)** | **Attribution + share-alike; verify each part's license** | Generates ready-to-use 4/8-dir walk/attack/cast sheets |
| **itch.io — CC0 tileset/tilemap tag** | varied top-down packs | **CC0** | None | Browse `itch.io/game-assets/assets-cc0/tag-tileset` |

### LPC license caveats (important)
LPC art is **dual-licensed CC-BY-SA 3.0 and GPLv3**. For a distributable game:
- **Choose CC-BY-SA 3.0** (not GPL) so your **game code can stay proprietary** — CC-BY-SA applies to the *art only*, not your source.
- **Attribution is required** — credit each artist (LPC entries list authors; keep an `ASSETS/CREDITS` manifest).
- **Share-alike applies to derived art** — if you *modify* an LPC sprite or make new art *based on* it, that derivative must also be CC-BY-SA 3.0. Your code is unaffected.
- **Watch GPL-only contributions:** many newer LPC-style assets are contributed **GPL-only** (not dual). Mixing a GPL-only *art* asset can force GPL obligations on the combined work — **prefer assets explicitly offered under CC-BY-SA or CC0**, and verify per-file before importing.
- Practical stance for BrowserGame: use **CC0 packs (Kenney, OGA CC0) for terrain/props/UI/monsters** to stay obligation-free, and reserve **LPC (CC-BY-SA)** for **player/NPC directional characters**, where its clean N/W/S/E walk/attack/cast layout is uniquely convenient — accepting the attribution + derived-art share-alike obligations and maintaining a credits file.

---

## 5. Audio sources (CC0 / CC-BY), briefly

| Source | Content | License | Obligations |
|---|---|---|---|
| **Kenney audio packs** (Impact, UI, RPG, Interface) | SFX (impacts, UI, pickups) | **CC0** | None |
| **Sonniss #GameAudioGDC** annual bundle | tens of thousands of pro SFX | Royalty-free | None for game projects |
| **OpenGameArt — CC0 Sound Effects** | combat/ambient/UI SFX | **CC0** | None |
| **Freesound** (filter by CC0 tag) | ambient loops, one-shots | Mixed — **filter to CC0/CC-BY** | Attribution if CC-BY |
| **Pixabay Sounds** | music + SFX | Pixabay license (free commercial) | None |
| **sfxr / jsfxr / bfxr** | generate retro SFX yourself | Generated assets are yours | None |

Recommendation: combat SFX (slash/fireball/arrow/frostbolt impacts, level-up, death) from **Kenney CC0** + **OGA CC0**; ambient biome beds (town/wilderness/crypt) from **Freesound CC0** or Pixabay. Mirror the per-ability/per-area structure we already have in `combat.ts`/`areas.ts`.

---

## 6. Recommended adoptions for BrowserGame (prioritized)

1. **[High] Adopt PixiJS v8 behind a `Renderer` interface, keeping Canvas2D as the fallback during migration.** Touches: refactor `src/client/draw.ts` into an interface + `Canvas2DRenderer` + new `PixiRenderer`; wire from `src/client/main.ts`. Preserves the `EntityState`/snapshot contract and server authority. MIT, ~450 KB, phone-friendly, TS-native.
2. **[High] Replace hash-based terrain with Tiled `.tmj` maps.** Author one map per area (`town`/`wilderness`/`crypt`) in **Tiled**, render via **`@pixi/tilemap`** + **`pixi-tiledmap`**, validate with **`@kayahr/tiled`** types. Store under `public/`. Retires `hash2`/`drawWorld` procedural props for designed terrain. Orthographic now; isometric possible later (same tools).
3. **[High] Y-sorted directional character sprites.** Port `drawCharacter` to `AnimatedSprite`; quantize `EntityState.facing` to 4/8 directions; derive idle/walk from interpolated motion; trigger attack/cast one-shots from existing `melee`/`cast` `FxEvent`s. Source characters from **LPC (CC-BY-SA)** via the LPC generator; keep `isSelf` gold-ring as overlay.
4. **[Medium] Asset pipeline.** Pack atlases with **Free Texture Packer** (or TexturePacker free) → PixiJS JSON+PNG. Establish `public/atlas/`, `public/maps/`, and an `ASSETS/CREDITS.md` manifest tracking each source + license (mandatory for CC-BY / CC-BY-SA).
5. **[Medium] Projectile & FX upgrade.** Replace `drawProjectile`/`drawFx` gradients with sprites + **`@pixi/particle-emitter`** (fireball trails, frost shards, death bursts, floating damage numbers), keyed off `abilityId` — extend the existing `ABILITIES` color table with texture/anim fields. Camera/culling via **`pixi-viewport`**.
6. **[Low] CC0 art + audio first pass.** Seed terrain/props/dungeon from **Kenney Roguelike/RPG pack**, **Roguelike Caves & Dungeons**, **OGA Top Down Dungeon Pack** (all CC0); monsters from **DCSS tiles (CC0)** / **DawnLike (CC-BY)**; SFX from **Kenney CC0** + **OGA CC0**; ambient from **Freesound CC0**.
7. **[Roadmap] Defer isometric and WebGPU-by-default** — both are reachable without retooling (PixiJS already ships WebGPU; Tiled/`pixi-tiledmap` already support iso). Note in `wiki/reference/Roadmap.md` as future upgrades, not blockers.

**License hygiene rule of thumb for this project:** prefer **CC0** everywhere; use **CC-BY** with an attribution manifest; use **CC-BY-SA (LPC)** only for characters and accept attribution + derived-art share-alike; **avoid GPL-only art** to keep game code license-free.

---

## Sources

- PixiJS / Phaser / Babylon comparison: https://generalistprogrammer.com/comparisons/phaser-vs-pixijs , https://generalistprogrammer.com/tutorials/phaser-vs-pixijs-renderer-comparison , https://generalistprogrammer.com/tutorials/best-html5-game-frameworks-2025 , https://dev.to/ritza/phaser-vs-pixijs-for-making-2d-games-2j8c , https://npm-compare.com/aframe,babylonjs,matter-js,melonjs,phaser,pixi.js,planck,playcanvas,whs
- Rendering benchmark (FPS at 10k sprites): https://github.com/Shirajuki/js-game-rendering-benchmark
- PixiJS v8 / WebGPU / TS / bundle / MIT: https://pixijs.com/blog/pixi-v8-launches , https://pixijs.com/8.x/guides/getting-started/intro , https://github.com/pixijs/pixijs/blob/dev/LICENSE , https://pixijs.download/dev/docs/scene.AnimatedSprite.html
- PixiJS tilemap & Tiled loaders: https://api.pixijs.io/@pixi/tilemap/Tilemap.html , https://github.com/riebel/pixi-tiledmap , https://www.npmjs.com/package/pixi-tiledmap
- Tiled editor (formats, orientations, automapping): https://docs.mapeditor.org/en/latest/reference/support-for-tmx-maps/ , https://doc.mapeditor.org/en/stable/manual/automapping/
- melonJS / Excalibur TS: https://github.com/melonjs/typescript-boilerplate , https://www.slant.co/versus/1963/1966/~melonjs_vs_phaser
- Spritesheet / atlas tooling: https://www.codeandweb.com/texturepacker , https://www.codeandweb.com/texturepacker/tutorials/how-to-create-sprite-sheets-and-animations-with-pixijs , https://free-tex-packer.com/ , https://pixijs.com/7.x/guides/components/sprite-sheets
- LPC license & caveats: https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles , https://opengameart.org/content/properly-licensing-your-liberated-pixel-cup-game-entry , https://lpc.opengameart.org/lpc-art-entries , https://pflat.itch.io/lpc-character-generator
- Kenney CC0 packs: https://kenney.nl/assets/roguelike-rpg-pack , https://kenney.nl/assets/roguelike-caves-dungeons , https://kenney.nl/assets/tiny-dungeon , https://kenney.nl/assets/rpg-base , https://kenney-assets.itch.io/scribble-dungeons
- OpenGameArt top-down packs: https://opengameart.org/content/top-down-dungeon-pack , https://opengameart.org/content/top-down-rpg-pixel-art , https://opengameart.org/content/cc0-resources , https://lpc.opengameart.org/content/top-down-2d-rpg
- itch.io CC0 tilesets: https://itch.io/game-assets/assets-cc0/tag-tileset , https://itch.io/game-assets/assets-cc0/tag-tilemap
- Audio (CC0/CC-BY): https://opengameart.org/content/cc0-sound-effects , https://sonniss.com/gameaudiogdc/ , https://freesound.org/browse/tags/cc0/ , https://pixabay.com/sound-effects/search/cc0/ , https://kenney.nl/

---

## Drop-in plan: more monster sprites (current state, June 2026)

The renderer (`src/client/pixi-renderer.ts`) maps entities to sprite **sheets** via `sheetKey(e)`,
animates them with `lpcClips()` (the standard 64×64 LPC block layout), and falls back to procedural
hue-tinted shapes when there's no match. Today it ships four character sheets — `hero`, `skeleton`,
`wolf`, `bat` (+ a 1.6× `boss` reusing the skeleton) — reused across archetypes (humanoid/undead →
skeleton, beast → wolf, flyer → bat). Flyers hover above a planted shadow for a 3D height read.
Amorphous mobs (oozes, golems, imps, colossi, demons) stay procedural on purpose.

**The cheapest path to real variety is more LPC sheets**, because they drop straight into the
existing pipeline — no renderer changes, just data:

1. Download an LPC-format sheet (832×1344, the 21-row block layout) into `public/assets/sprites/`.
2. Add a `SHEETS` entry: `{ src, fw: 64, fh: 64, scale, clips: lpcClips() }`.
3. Add a `sheetKey` branch matching the mob's name/archetype.
4. Credit it in `public/assets/sprites/CREDITS.md` (LPC is **CC-BY-SA 3.0 / GPLv3** — attribution +
   share-alike on derived art).

Highest-value sheets to source next (each covers a cluster of currently-procedural mobs):

| Want | Covers | Source |
|---|---|---|
| **Slime / ooze** | bile_ooze, carrion_swarm, marsh_leech | https://opengameart.org/content/lpc-slime |
| **Goblin / imp** | cinder_imp, sprite-likes | https://opengameart.org/content/lpc-goblin |
| **Orc / brute** | bog_shambler, grave_golem, blight_knight, ruin_colossus | https://opengameart.org/content/lpc-orc |
| **Demon / fire** | magma_crawler, molten_colossus, balthuzar, pyre_caster | https://lpc.opengameart.org/content/lpc-monsters |
| **Spider / insect** | shardspine_hurler, thornling, hive mobs | https://opengameart.org/content/lpc-spider |

CC0 alternatives (no attribution, but **not** LPC-layout — they need a small custom `Sheet`/`clips`
mapping rather than `lpcClips()`): the Kenney roguelike/RPG pack is **already in**
`public/assets/tiles/kenney_roguelike_rpg.png` with many unused creature tiles; plus
https://kenney.nl/assets/roguelike-rpg-pack and https://kenney.nl/assets/tiny-dungeon . Use these
when no LPC equivalent exists.

Verification: after wiring, run the screenshot harness (`npm run build && node scripts/screenshot.mjs`)
and walk into the relevant zone to confirm the sprite + its shadow align (sprites anchor at the feet;
a wrong `fw/fh`/`scale` shows as a floating or clipped sprite).
