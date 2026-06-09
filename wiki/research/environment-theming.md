# Environment Theming — Research & Design

> One-line summary: Store every visual parameter (ground colors, mood tint, particles, weather,
> lighting) in an `area_theme` DB table; broadcast changes over WebSocket; validate/clamp
> server-side; re-skin the live world without a reconnect.

This page covers the _data-driven environment theming_ system that makes every area's visual
identity fully editable at runtime — from a SQL INSERT or the `/settheme` dev command — and
shows which rendering techniques to layer in on the PixiJS v8 WebGL client.

---

## 1. Data-Driven Look — Prior Art & Design Rationale

### Prior art

- **Blizzard / id-style data tables.** WoW, Diablo, and StarCraft II all store biome/zone visual
  parameters (fog colour, sky colour, ambient light colour, weather type) in DBC/CASC data tables
  loaded at zone transition — never hard-coded in C++. The pattern is decades old and proven at
  scale. Blizzard's `Light.dbc`/`LightParams.dbc` files are documented reverse-engineering targets
  precisely _because_ editing them re-skins every zone instance immediately.
  https://wowdev.wiki/LightParams.dbc

- **Tiled map custom properties.** The Tiled editor lets you attach typed key→value properties to
  every map, layer, object, or tile. These are exported verbatim into `.tmj` JSON under
  `"properties": [{"name":"fogColor","type":"color","value":"#3a1e6e"}]`. Many indie MMOs (and
  the PixiJS rendering guide) use per-map Tiled properties as their "biome descriptor" — ground
  tint, ambient colour, whether precipitation is on — and read them at load time.
  https://doc.mapeditor.org/en/stable/manual/custom-properties/

- **"Theme/biome definition" tables in indie MMO databases.** A well-known Game Developer article
  on MMOG database schemas advises keeping visual state in relational tables (not in code) so
  designers can change the world without a deploy.
  https://www.gamedeveloper.com/programming/relational-database-guidelines-for-mmogs

- **SQLite for live game configuration.** "Using SQLite to Organize Design Data"
  (Games from Within) makes the case for SQLite over YAML/JSON for game config:
  typed columns, foreign-key constraints, and the ability to `UPDATE` a row while the server is
  running and pick up the change on the next read.
  https://gamesfromwithin.com/using-sqlite-to-organize-design-data

### Why a typed key→value registry with boundary validation

A raw string-typed `key → value` table is tempting for flexibility, but every consumer must
parse and range-check the value itself, spreading validation across the codebase. Instead, adopt
**typed columns with enforced ranges in the schema** and a single server-side validation/clamping
step before any value reaches a client or a renderer:

```sql
-- Proposed schema
CREATE TABLE area_theme (
  area_id       TEXT NOT NULL REFERENCES areas(id),
  ground_base   TEXT NOT NULL DEFAULT '#3a6e3a',   -- hex color
  ground_speckle TEXT NOT NULL DEFAULT '#2e5c2e',  -- hex color
  ground_tone2  TEXT,                              -- optional second tone
  mood_tint     TEXT NOT NULL DEFAULT '#ffffff',   -- hex color (multiplicative)
  mood_alpha    REAL NOT NULL DEFAULT 0.0          -- 0.0–0.25
    CHECK (mood_alpha BETWEEN 0.0 AND 0.25),
  vignette_strength REAL NOT NULL DEFAULT 0.3
    CHECK (vignette_strength BETWEEN 0.0 AND 1.0),
  ambient_r     INTEGER NOT NULL DEFAULT 255
    CHECK (ambient_r BETWEEN 0 AND 255),
  ambient_g     INTEGER NOT NULL DEFAULT 255
    CHECK (ambient_g BETWEEN 0 AND 255),
  ambient_b     INTEGER NOT NULL DEFAULT 255
    CHECK (ambient_b BETWEEN 0 AND 255),
  particle_type TEXT NOT NULL DEFAULT 'none'
    CHECK (particle_type IN ('none','dust','fireflies','embers','snow','rain')),
  particle_density REAL NOT NULL DEFAULT 0.0
    CHECK (particle_density BETWEEN 0.0 AND 1.0),
  weather       TEXT NOT NULL DEFAULT 'clear'
    CHECK (weather IN ('clear','rain','snow','fog')),
  weather_intensity REAL NOT NULL DEFAULT 0.0
    CHECK (weather_intensity BETWEEN 0.0 AND 1.0),
  PRIMARY KEY (area_id)
);
```

The CHECK constraints are the first line of defence. A second, explicit server-side clamp
(parse hex → clamp RGB channels 0–255; clamp floats to declared ranges) runs in the `/settheme`
handler **before** the row is written and before the broadcast fires. This follows the same
"validate at the boundary" discipline used for all client inputs
(`decodeClient`/`decodeServer` in `src/shared/protocol.ts`). A malicious or buggy edit cannot
push a crash-inducing value to every connected client.
https://www.gamedeveloper.com/business/never-trust-the-client-simple-techniques-against-cheating-in-multiplayer-and-spatialos

---

## 2. Cheap High-Impact 2.5D Visual Techniques

All techniques below use PixiJS v8 (WebGL renderer) and add cost roughly in the order listed.
Performance estimates assume a mid-range phone (Adreno 640 class).

### Ground layering

| Layer | Technique | Perf cost | Notes |
| --- | --- | --- | --- |
| **Base tile** | Flat tinted `@pixi/tilemap` tile layer | Minimal — 1 draw call | Drive color from `ground_base` via `tint` |
| **Speckle** | Second tile layer with sparse alpha-transparent specks | Minimal — 1 draw call | `ground_speckle` tint; ~10–15% fill |
| **Second tone** | Optional third layer, lower alpha | Low | Only when `ground_tone2 != null` |

Three batched tile layers is negligible on WebGL. Avoid per-tile `tint` changes inside a layer —
group same-tint tiles in the same batch.
https://pixijs.com/8.x/guides/components/color

### Vignette

- Draw a single fullscreen `Graphics` radial gradient (transparent center → dark edge) on a layer
  above the world but below the HUD.
- Set `alpha` = `vignette_strength`; update only when the theme changes.
- **Cost: ~0 GPU** (one mesh, static after theme is set). Rebuild the gradient mesh on theme
  change only.

### Mood tint / day–night

- Apply a `ColorMatrixFilter` to the root world `Container`, or use a fullscreen semi-transparent
  colored rectangle with `blendMode = 'multiply'`.
- `ColorMatrixFilter` built-in presets (`night`, `browni`, `vintage`, `colorTone`) work
  immediately; for arbitrary tints, `brightness`/`hue` methods are fine.
- **Cost: ~0.2 ms/frame** for a single `ColorMatrixFilter` on the world container (one shader
  pass). Merge all post-process effects (tint + colour grade) into **one filter** on one
  container — every additional filter pass is an extra render-target blit.
  https://pixijs.com/8.x/guides/components/filters
  https://pixijs.download/dev/docs/PIXI.filters.ColorMatrixFilter.html

### Additive light glows

- Sprites with `blendMode = 'add'` add their RGB channels directly to whatever is underneath —
  perfect for torches, magic circles, and zone entrance halos.
- Pool these sprites (pre-allocate N glow sprites per area; re-use from pool, don't `new`).
- **Cost: cheap per-sprite batching** as long as all additive sprites share the same texture atlas
  page. Avoid more than ~50 on-screen additives on mobile.
  https://app.studyraid.com/en/read/12379/399742/blend-modes-implementation

### Ambient particles (dust, fireflies, embers)

- Use `@pixi/particle-emitter` with a `ParticleContainer` backing (v8 `ParticleContainer` renders
  100 K+ sprites at 60 fps via GPU-side transforms).
- Pre-fill the pool: `Emitter.emit = true` + `spawnChance` driven by `particle_density`.
- **Cost: low** if particle count ≤ 500; scale density with `particle_density` value from theme.
  Keep `maxParticles` bounded per emitter type so a `density=1.0` value can't OOM.
  https://pixijs.com/blog/particlecontainer-v8
  https://github.com/pixijs-userland/particle-emitter

### Weather overlays

| Weather | Technique | Perf notes |
| --- | --- | --- |
| **Rain** | Tileable vertical-streak texture scrolled per-frame on a `Sprite` with `tileScale` + `tilePosition` | ~0.3 ms, one draw call |
| **Snow** | `ParticleContainer` with 200–400 particles, slow drift + gentle X wobble | ~0.5 ms |
| **Fog** | Two large semi-transparent cloud sprites cross-fading, slow pan, low alpha | ~0.2 ms, two draw calls |

All overlays live in a dedicated `weatherContainer` placed above entities but below the HUD.
Activate/deactivate containers by `visible` flag, not by adding/removing from the scene graph
(avoids scene-tree churn on theme change).
Scale intensity with `weather_intensity`; smoothly lerp `alpha` on change so transitions
aren't jarring.

### Colour grading / atmosphere LUT (future)

A 16×16×16 3D LUT applied as a post-process filter can reshape the entire palette of the frame
in a single fragment shader pass. The GPU texture cache makes LUT reads effectively free once
the texture is warm. Merge this pass with the mood-tint filter (one `Filter` subclass) to avoid
an extra render-target blit.
https://blog.frost.kiwi/WebGL-LUTS-made-simple/
https://medium.com/@mattdesl/filmic-effects-for-webgl-9dab4bc899dc

---

## 3. Live Content Reload Patterns

### "Edit DB, re-skin world" workflow

```
Designer writes SQL / types /settheme in chat
  → server handler validates & clamps values
  → UPDATE area_theme SET ... WHERE area_id = ?
  → server reads back the canonical row
  → broadcasts { type: "content", patch: { areaTheme: <row> } } to every WS client in that area
  → client ContentStore updates in-memory theme
  → renderer reads new values, rebuilds/updates affected objects (vignette mesh, filter matrix,
    particle emitter config, weather container alpha)
```

Key properties of this pattern:

- **No reconnect required.** The `content` packet is the same channel as the initial content
  broadcast on join; the client just re-applies the theme. Keep the theme-apply code as a pure
  function `applyTheme(theme: AreaTheme): void` callable from both the join path and the
  live-patch path — single source of truth for re-skinning.

- **Broadcast only affected area.** Clients in other areas don't need the update; filter by
  `instance.areaId === updatedAreaId` before sending.

- **Server is the single writer.** The `/settheme` command is an admin-only chat command
  (`ENGINE_ADMIN_TOKEN`-gated via the existing privilege system in
  `src/server/index.ts`). No client path writes directly to `area_theme`. This is the same
  capability-gate discipline used for other privileged commands.

- **SQLite WAL mode** (`PRAGMA journal_mode=WAL`) lets a write (the UPDATE) and concurrent reads
  (the tick loop) co-exist without locking. Worth confirming this is set in
  `src/server/content.ts` if not already.
  https://dev.to/thevahidal/soul-sqlite-rest-server-is-realtime-now-hmh
  https://dev.to/hexshift/injecting-real-time-websocket-streams-into-sqlite-using-python-and-wal-hooking-25bi

### Client re-skinning without flicker

- Apply numeric changes (tint alpha, vignette strength, weather intensity) as a **lerp over
  ~1 second** rather than an instant jump. The lerp runs in the render loop; the target values
  come from the `content` patch.
- Rebuild static geometry (vignette radial gradient mesh) only on actual value change
  (compare old vs new before rebuilding).
- Particle emitter config changes (density, type) reconfigure the existing emitter via its
  public API rather than destroying and re-creating it.

### Safety checklist for live theme edits

- [ ] Hex colour strings are validated with a `/^#[0-9a-fA-F]{6}$/` regex before use.
- [ ] All float fields clamped server-side (not just DB CHECK — CHECK can be bypassed by direct
  SQL tools).
- [ ] `particle_type` and `weather` are enum-validated against an allowlist (SQL CHECK +
  server-side `Set.has()`).
- [ ] Max density/intensity values are capped low enough they cannot cause OOM or freeze
  (e.g. `particle_density=1.0` → at most 500 particles, not unlimited).
- [ ] The broadcast includes only the `area_theme` row, not raw SQL strings or file paths.

---

## 4. Prioritised Adoption List

| Priority | Item | Status | Notes |
| --- | --- | --- | --- |
| **P0** | `area_theme` SQLite table + server read on startup | **Built** | Schema above; CHECK constraints; read in `content.ts` |
| **P0** | `content` packet carries `areaTheme`; client stores it | **Built** | Same packet as spells/items/monsters |
| **P0** | `/settheme <area> <key> <value>` chat command; validates, writes, broadcasts | **Built** | Admin-gated; server-side clamp before DB write |
| **P0** | Client applies `ground_base`/`mood_tint`/`vignette_strength` to renderer | **Built** | Pure `applyTheme()` called on join + live patch |
| **P1** | Smooth lerp transitions on numeric theme changes | Future | 1-second lerp in render loop |
| **P1** | Weather particle overlay (`rain`/`snow`/`fog`) respecting `weather_intensity` | Future | Dedicated `weatherContainer`; pool-backed |
| **P1** | Ambient particles (`dust`/`fireflies`/`embers`) via `@pixi/particle-emitter` | Future | Density-capped; pool pre-allocated |
| **P1** | Day/night `ColorMatrixFilter` on world container; merged with mood tint | Future | One shader pass; use built-in `night` preset as baseline |
| **P2** | Per-area colour grading LUT (16×16×16 3D LUT texture) | Future | Merge with mood-tint filter; zero perf cost once warm |
| **P2** | Weather affecting gameplay (rain slows movement, fog reduces vision range) | Future | Server-side area modifier read from `area_theme.weather` |
| **P2** | Normal-mapped lighting (point lights with normal-map sprites) | Future | Requires normal-atlas; `@pixi-essentials/plugin-cull` for off-screen |
| **P2** | Tiled `.tmj` per-map theme properties synced to `area_theme` at import | Future | Let Tiled be the authoring tool; importer writes DB |

---

## Sources

- Tiled custom properties docs: https://doc.mapeditor.org/en/stable/manual/custom-properties/
- Tiled TMX/TMJ format reference: https://doc.mapeditor.org/en/stable/reference/tmx-map-format/
- MMOG relational database guidelines: https://www.gamedeveloper.com/programming/relational-database-guidelines-for-mmogs
- SQLite for game design data: https://gamesfromwithin.com/using-sqlite-to-organize-design-data
- WoW LightParams.dbc (zone visual params): https://wowdev.wiki/LightParams.dbc
- "Never trust the client" (input validation in multiplayer): https://www.gamedeveloper.com/business/never-trust-the-client-simple-techniques-against-cheating-in-multiplayer-and-spatialos
- PixiJS v8 colour / tint system: https://pixijs.com/8.x/guides/components/color
- PixiJS v8 filters and blend modes: https://pixijs.com/8.x/guides/components/filters
- PixiJS ColorMatrixFilter API: https://pixijs.download/dev/docs/PIXI.filters.ColorMatrixFilter.html
- PixiJS blend modes (additive glow): https://app.studyraid.com/en/read/12379/399742/blend-modes-implementation
- PixiJS v8 ParticleContainer performance: https://pixijs.com/blog/particlecontainer-v8
- @pixi/particle-emitter docs: https://particle-emitter.pixijs.io/docs/
- @pixi/particle-emitter GitHub: https://github.com/pixijs-userland/particle-emitter
- WebGL LUT colour grading (performance analysis): https://blog.frost.kiwi/WebGL-LUTS-made-simple/
- Filmic effects / post-processing in WebGL: https://medium.com/@mattdesl/filmic-effects-for-webgl-9dab4bc899dc
- glsl-lut (GLSL LUT colour transforms): https://github.com/mattdesl/glsl-lut
- Soul (SQLite + WebSocket realtime broadcast): https://dev.to/thevahidal/soul-sqlite-rest-server-is-realtime-now-hmh
- SQLite WAL + WebSocket streaming: https://dev.to/hexshift/injecting-real-time-websocket-streams-into-sqlite-using-python-and-wal-hooking-25bi
- PixiJS v8 launch (WebGPU, render groups, perf): https://pixijs.com/blog/pixi-v8-launches
