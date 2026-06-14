# Changelog

All notable changes to this project are documented here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow semantic
versioning once it stabilizes.

## [Unreleased]

### Fixed

- **Exception handling + null guards at the runtime boundaries (resilience).** Hardened the spots
  where an unguarded throw or disabled-storage failure could take down more than the one operation
  that caused it — building on the existing `runGuarded` / `decodeClient`-null-return / per-socket
  error-handler discipline rather than blanket-wrapping pure sim code:
  - **Server last-resort net:** `process.on('uncaughtException' | 'unhandledRejection')` now log the
    error, count it for the `/health` readout, and keep the world running — a stray throw from a
    timer callback, a library emit, or an async gap no longer crashes the process and disconnects
    every player.
  - **Startup fails loudly, not cryptically:** opening the game DB is wrapped so a corrupt/locked
    file or bad permissions prints a clear `FATAL` line and exits cleanly instead of dumping a raw
    stack; the HTTP server's `error` event (e.g. `EADDRINUSE`) does the same, and the
    `WebSocketServer`'s server-level `error` is now handled (previously unhandled → process death).
  - **The remaining periodic loops are guarded** (autosave, social liveness, invasion, corruption
    announcements) with `runGuarded`, matching the tick/density loops — a single failed save (db
    momentarily locked) can no longer throw out of the timer and silently kill all future runs of it.
  - **Client tolerates disabled/over-quota `localStorage`** (private-browsing mode) when reading the
    saved character token and minting the player name at bootstrap, matching how `settings.ts` /
    `inspector.ts` already degrade — storage failures no longer blank the whole app on load.
  - **Client message pump is contained:** a well-formed-but-unexpected server frame hitting a handler
    is caught per-message so it can't throw out of the socket listener and stop later frames.

### Added

- **Individual creature spawns — the template-vs-spawn split (UID/guid placements).** A new
  `creature_spawns` table places one monster per row (its own `uid`) referencing a `mob_templates`
  entry, at a fixed position, with a per-spawn `flags` bitmask (`CreatureSpawnFlags`, e.g. forced
  `ELITE`). `content.ts` exposes `creatureSpawns(areaId)` and `world.ts` places them alongside the
  count-based `area_mobs` random scatter. Empty by default (no gameplay change); add rows via SQL to
  pin a named guardian or a forced champion at an exact spot. This makes monster spawns individually
  addressable + overridable, the way NPC and decor rows already are.

### Changed

- **NPCs carry a service `npc_flags` bitmask (TrinityCore-style npcflag).** Each `npcs` row gains an
  `npc_flags` integer (a bitmask of `NpcFlags`: VENDOR / QUESTGIVER / HEALER / GAMBLER / ARTIFICER /
  BANKER / RECRUITER / RIFTKEEPER), populated from the NPC's `kind` and override-preserving. The
  E-key interaction dispatcher and every service guard in `world.ts` now check the flag instead of a
  single `kind` string — so one NPC can offer several services at once (e.g. a vendor that is also a
  quest-giver) by setting more bits via SQL. `kind` stays as the primary role + sprite.
- **Legendaries merged into the items table + an item `flags` bitmask.** The separate `uniques` table
  is gone; a legendary is now an `items` row carrying the `LEGENDARY` flag, its `base_id`, and fixed
  `affixes` (slot/power/hp/color copied from the base). `content.ts` derives the unique catalogue
  from flagged item rows, and the random gear/gamble pool excludes `LEGENDARY` items so they drop
  only via the dedicated unique roll. New `ItemFlags`/`hasItemFlag` (and `NpcFlags`/`hasNpcFlag`).
- **Procedural dungeon population is now database-driven (content-engine phase 4).** A new `dungeons`
  table holds each dungeon's pack pool (JSON), boss, mini-boss + chances, elite chance, and mob
  counts, seeded from the `DUNGEONS` const; `content.ts` exposes `content.dungeon(areaId)` and
  `world.ts` rolls dungeon population from the DB. The `DUNGEONS` const remains only as the
  structural client `isDungeon` check and the seed default — so a dungeon's roster can be retuned
  with SQL.
- **Monster traits / spells / support are now database-driven (content-engine phase 3).** The runtime
  no longer reads the `MOB_SPELLS`/`MOB_SUPPORT`/`MOB_TRAITS` consts: `mob_templates` gained `spell`,
  `support`, and `traits` (JSON) columns, seeded from the authoring maps and loaded onto the
  `MobTemplate` by `content.ts`. The `world.ts` caster/support logic reads `template.spell` /
  `template.support`, and the `stepMob` AI plus the `traitDamageMult`/`isPackish` helpers now take
  the template's `traits` array — so a monster's casting and personality come straight from the DB.
  The consts remain only as authored seed data.
- **Items are now fully database-driven (content-engine phase 2).** The DB `items` table is the
  single runtime source of truth and nothing reads a hardcoded item const during the game:
  - `gamble.ts` no longer imports `EQUIPMENT` — `rollGamble`/`isGambleSlot` take the equip-base pool
    as a parameter, which `world.ts` builds from the content DB (a new `equipBases()` helper).
  - The client `item-icons.ts` resolves an item's slot from the content packet via an injected
    resolver (`setItemSlotResolver`, wired in `main.ts` to `net.content`) instead of importing the
    data const — removing the last client-side read of `EQUIPMENT`.
  - The `EQUIPMENT` base catalogue and `MATERIALS` moved out of `src/shared/equipment.ts` into a new
    `src/server/db/seed-items.ts` (the items "world-DB content"); `src/shared/equipment.ts` now holds
    only slot **types/labels** and the doll-slot mapping. New `seed-items.test.ts` validates the
    catalogue and that every base/material seeds into the `items` table.
- **Legendaries are now database-driven (content-engine phase 1).** The hand-authored `UNIQUES`
  catalogue, previously a hardcoded array in `src/shared/uniques.ts`, now lives in a new `uniques`
  SQLite table seeded from `src/server/db/seed-uniques.ts` and loaded by `content.ts` — the same
  DB-as-source-of-truth pattern the rest of the content uses. `content.ts` owns the catalogue,
  `uniquesForSlot`, and `rollRandomUnique` (resolving each base's power/hp from the `items` table);
  `world.ts` mints legendaries through the `Content` API. `shared/uniques.ts` is reduced to a pure,
  data-free roller (`rollUnique` + `pickUnique`) shared by the seed layer, the loader, and the
  tests. You can now add or rebalance a legendary with SQL — no code change. This is the first step
  of a phased move of all content (items, spells, monsters, quests, terrain, objects) to a
  TrinityCore/MaNGOS-style DB content engine; see `wiki/architecture/Content-Engine.md`.

### Added

- **Eight new original legendaries — the unique loot chase now covers every slot.** Expanded the
  curated `UNIQUES` pool (`src/shared/uniques.ts`) from 12 to 20 hand-authored items, filling the
  previously-empty **shoulders / waist / legs** slots and deepening the off-hand / neck / ring /
  trinket chase, all themed to the later acts: *Mantle of the Pale King*, *Cinch of the Unmade*,
  *Tread of the Last Watch*, *Bond of the Hunt*, *Emberglass Heart*, *Choker of the Sleepless*,
  *Ashen Effigy*, and *Moonsilver Edge*. Each is built on a real equipment base with fixed,
  build-defining affixes kept inside the agreed magnitude bands. Original content (our own names,
  flavor, and stats) inspired by the ARPG loot-chase pattern — no third-party data. They drop
  world-wide through the existing `rollRandomUnique` path; a new test asserts the pool now covers
  every equipment slot so slot-targeted drops can always find a unique.
- **Wilds bestiary — wildlife & vermin across every overworld combat zone.** Fourteen new roaming
  species fill the ecological gaps from Gloomwood to the Voidmarch, adding swarm / ambusher / caster
  archetypes to zones that lacked them so **every** overworld combat zone in the game now carries a
  wilds species. **Act 1 + Wastes:** the **Gloomweb Spider** and goat-legged **Bramble Satyr**
  (Gloomwood), skittering **Tomb Rats** (Shadow Crypt), the venom-spitting **Mire Serpent** (Rotfen
  Marsh), chitinous **Cinder Ants** (Emberdeep Mines), the petrifying **Wyrmcrag Cockatrice**
  (Frostpeak Pass), and the void-bloated **Sundered Worm** (the Sundered Wastes). **Act 2 road:**
  **Barrow Vermin** (the Grimfrost Barrows), the **Pineweb Spider** (the Howling Barrens), and the
  **Tidefang Serpent** (the Sunken Pass). **Act 3 dead-lands:** the **Blightweb Spider** (the
  Blighted Spire), the **Dune Serpent** (the Ashveil Desert), the **Chasm Worm** (the Shattered
  Causeway), and the **Void Vermin** swarm (the Voidmarch). The new creatures also seed into
  thematically- and level-matched **dungeon pools** — caves & catacombs get tomb-rats and a cave
  spider, the Writhing Hive a serpent, the Abyssal Throne a blight spider, the Unmade Court the void
  swarm + chasm worm, and the endgame Rift four scaled picks. Pure data through the established
  idempotent seed paths: templates in `src/server/mobs.ts` (with pack / flanker / enrage traits and
  four gaze/venom casters), spawns + zone-matched loot in the new `src/server/db/seed-wilds.ts`
  (wired via `ensureWildsContent`, which also seeds a per-mob `sprite_tints` cast so sprite-sharing
  pairs read as distinct creatures), dungeon-pool entries in `src/shared/areas.ts`, and five new
  `rogues-sprites.ts` mapping rules (satyr / serpent / ant / cockatrice / vermin). Covered by
  `seed-wilds.test.ts`, the content-integrity suite, the dungeon-population tests, and the
  sprite-resolution test.
- **Drifting cloud shadows over outdoor ground (world-anchored depth cue).** Soft dark patches now
  sail slowly across the terrain on the wind, implying a sky and sun *above* the otherwise-flat
  plane. They're **world-anchored** — cloud positions are world coordinates and the layer's transform
  is synced to the camera's each frame (like the water layer), so the shadows slide past the player
  as they walk rather than sticking to the screen. A small fixed pool of lumpy soft sprites wraps
  endlessly around the camera, and the whole effect **fades with the sun** (gone at night, strongest
  near midday) on the same day/night clock the shadows use:
  - New pure helper `client/cloud-field.ts` (`cloudStrength` day-phase → strength, `wrapSpan`
    endless-field wrap), unit-tested; the renderer-facing `client/clouds.ts` owns the sprite pool.
  - Drawn as a **stage layer above the ground/water but below props/actors** (not inside `world`,
    whose per-area colour-grade filter renders to an isolated buffer that a ground shadow nested
    inside could never darken). Outdoor-only, and disabled wholesale on the low-quality (touch) path
    since big soft sprites are fill-rate heavy on phones; hidden with "reduce effects". Verified with
    the screenshot harness.
- **Contact-AO grounding under actors (2.5D "planted" cue).** Beneath the directional shadow sits a
  small, tight, dark soft-ellipse **ambient-occlusion core pinned at the feet** that — unlike the
  cast shadow above it — never lifts with height or rakes with the sun. It's the dark contact where
  body meets ground (the "#1 planted-vs-floating" cue from the renderer research): as the directional
  shadow shrinks off with a hop or slides long under a low sun, this core stays put, so a standing
  figure reads as truly grounded and a rising one visibly parts from its contact point. Desktop-only
  (skipped on touch to save fill rate) and skipped for flyers (which never touch the ground); reuses
  the shared soft-shadow texture, so no new asset or per-frame cost. Verified with the screenshot
  harness (`scripts/screenshot.mjs`).
- **Time-of-day sun shadows (2.5D depth + atmosphere cue).** Actor/loot/projectile ground shadows
  are now coupled to the same sun that drives the day/night cycle: a high **noon sun throws short,
  dark, crisp shadows**, and a low **dawn/dusk (or moonlit-night) sun rakes them long and faint**
  across the ground — watching shadows stretch out toward evening is a strong "real lit surface"
  signal a flat top-down scene can fake. Built on the existing day/night clock and the
  height-reactive shadow plumbing below:
  - A new pure, stateless helper (`client/sun-shadow.ts`) maps the sun's altitude (the atmosphere's
    `daylight`) to `stretch`/`alpha` multipliers; an overhead/noon sun (and indoor areas, which have
    no cycle) returns the exact `{1, 1}` identity, so those scenes keep today's look. Unit-tested.
  - `Atmosphere.sunShadow()` exposes the factor (outdoor → time-of-day, indoor → identity); the
    renderer samples it **once per frame** and folds it into the single shadow updater, lengthening
    each shadow's *length* + *reach* (not its width) so it rakes away from the feet. Applied uniformly
    to the soft blob, the sheared hero/elite cast-shadow copy, loot drops, and projectiles. Direction
    stays the fixed baked-sun lean (the deliberate D2 look) — only how high the sun has climbed
    animates. Static decor keeps its baked foot shadows (per-frame raking is scoped to live entities).
- **Height-reactive contact shadows (2.5D depth cue).** Billboards (actors, loot, projectiles) ride
  above a flat ground shadow, but that shadow used to stay a fixed size + opacity however high the
  caster floated — a dead giveaway that the world is flat. The ground shadow now **shrinks and fades
  as its caster rises off the plane and tightens + darkens on contact**, the readable "how high is
  this" signal of the classic platformer shadow:
  - A new pure, stateless helper (`client/shadow-lift.ts`, in the same family as `easing.ts`) maps an
    elevation in world px to `scale`/`alpha` multipliers; grounded callers get an exact `{1, 1}`
    identity, so nothing changes until a billboard actually leaves the ground. Unit-tested.
  - Wired into the renderer everywhere something lifts off the ground: a flyer's hover and the
    walk/idle bob (per frame), the loot-pop hop as a drop appears + settles (a shorter falloff for the
    brief, sharp arc), and a projectile's constant flight height (applied once so it reads as a shadow
    cast from the air, not a blob welded to the missile). Cast-shadow actors (hero/elites) keep their
    sheared sprite-copy shadow unchanged.
- **Real terrain collision + walkable mountain passes (RENDER-08, true elevation).** Mountains,
  cliffs, and boulders are now SOLID and authoritative — you walk *around* them and *through* the gaps
  (paths), not over them. It's built on the shared collision module so the server simulation and the
  client predictor resolve it identically (no rubber-banding):
  - `shared/collision.ts` gains **circle blockers** alongside rects: `resolveCircleMove` pushes the
    player radially out of round terrain (slide around a boulder), and `blockersForDecor()` turns decor
    into solid geometry — `cliff`/`ridge`/`barrier`/`wall` → rects (tall faces, ledges, invisible
    chokepoints), `mountain`/`boulder`/`peak` → circles. Projectiles stop on either (`pointInAnyBlocker`).
  - The server (`world.ts`) and predictor (`predictor.ts`) both collide against these `Blockers`
    (rects + circles); walls/cliffs and round terrain are one shared source of truth.
  - **Authored in the content DB** (live-editable): new solid decor kinds, seeded as the **Gloomwood
    Pass** — a cliff ridge across mid-wilderness with a single walkable gap that lines up with the
    Catacombs and Marsh portals, so the pass is a real chokepoint connecting them.
  - **Tall 2.5D visuals**: cliffs render as a gradient rock FACE under a lit, moss-capped plateau TOP
    with a cast shadow; mountains/boulders as rounded rock. All occlude the local player when he's
    behind them (RENDER-06). Pure Graphics — no `Mesh`, so it can't hit the GlMeshAdaptor crash.

### Changed

- **Buildings render at canonical (retail) size in the scaled world.** The world is inflated
  `×WORLD_SCALE` so zones are expeditions, but that was making footprint objects — houses especially —
  into `×WORLD_SCALE` giants (a ~170-unit house became ~850 px). Object SIZE is now decoupled from the
  world scale (`content.ts` `CANONICAL_SIZE_KINDS`): a house's POSITION still rides the world scale
  (so the world stays as spacious as before — positions, spacing, aggro/attack ranges, and mob
  density are all untouched), but its footprint keeps its **authored 1× size**. As a bonus the south
  door is now a proper doorway again instead of a thin slit in a giant wall. **Terrain** uses its own
  `world.terrainSizeScale` (default ×1, canonical) so cliffs/massifs are ground features, not
  screen-filling ×WORLD_SCALE walls — tune it up (1.5–2) for more imposing massifs. The town palisade
  (a world-spanning wall) still scales fully so it keeps ringing the town. Safe villages are scrubbed
  of any stray terrain decor on boot (`cleanupStrayTerrain`), so a town never sprouts a mountain.
- **Cooperating bot squads + run metrics.** Bots spawned by one GM (`/bot N`) now act as a
  **cooperating party** on their journey to endgame instead of independent roamers:
  - **Roles** (`bot-squad.ts`): every bot that owns a heal is a `healer` (support survivor — heal is
    self-only, so it keeps *itself* up as the durable member), the toughest of the rest is the `tank`
    (crowds the target), and everyone else is `dps` (kites at range).
  - **Focus fire**: the squad concentrates on ONE shared target — boss → elite → most-wounded →
    nearest the party centroid — committing to it from farther than a solo bot would, so they collapse
    enemies together.
  - **Travel & regroup**: the squad heads to the same milestone zone paced by its **slowest living
    member** (no one runs to endgame alone), and **regroups/holds** — converging on a rally point — when
    the party scatters, a member drops low, or a member dies (rescue), rather than pushing on.
  - **Run metrics** (`bot-metrics.ts`): the host records the squad's whole journey — milestone arrival
    times, level/gold/gear/XP curves, every death (with the blamed mob), and boss attempts. When the
    squad kills the final boss (Athraxis, the Unmade God) it auto-writes **`botrun-report.md` +
    `botrun-report.json`** (also on demand via **`/bot report`**) with a timeline, curves, deaths, and
    auto-generated **improvement findings** (slowest band, death hotspots, progression stalls, boss
    wipe risk). All times are sim-clock so reports are reproducible at any tick rate.

- **Generated item icons replace the licensed sheets (`gen:icons`).** Inventory/vault/belt icons now
  draw from a procedurally-generated, **kind-keyed** sheet (`/assets/icons/items_gen.png`) instead of
  the licensed 32rogues atlas + minerals gem files. `item-icons.ts` resolves every item id to one of a
  fixed set of icon keys (weapon/armor/jewelry categories + nine per-family gem cells + a generic
  fallback) through a chain — gem family → rune → material → keyword rules → equipment-slot default →
  generic — so every seeded id renders *something*, asserted against the generated manifest. The
  generator (`tools/assetgen/icons`) draws parametric silhouettes for ~23 kinds with a rarity ring and
  optional tint, packed 8-per-row; deterministic per seed.
- **Paper-doll gear on every humanoid (broadcast per entity).** The server now broadcasts each entity's
  visible-gear "look" as a compact bitfield on `EntityState` (`look`: 1=helm, 2=armor, 4=weapon), set
  from players' equipped slots and from NPC/hireling kind. The renderer overlays the generated
  equipment layer sheets on all humanoid actors — not just the local player — sampling the same frame
  as the body and gated by that bitfield. (Local player reads `net.you.equipment` directly.)
- **Generated creature sheets replace the licensed LPC mob art (`gen:creatures`).** Skeleton, wolf, and
  bat now use procedurally-generated 8-direction sheets (idle/walk/attack + dirless hurt/death) instead
  of the licensed LPC atlases; the renderer's `creatureClips()` maps the generated layout. Deterministic
  per seed; recognizable silhouettes verified via an 8-facing preview.
- **Generated emitter presets + synthesized cast SFX wired in.** The `frost`/`heal` emitter presets are
  registered and fire on cast/level-up, and the remaining licensed cast audio (`shoot_arrow`/`cast_fire`
  `.ogg`) is dropped — those one-shots are now synthesized via Web Audio (bowstring whoosh for arrows, a
  rising magical surge + chord for fireball/frost). Only the looping ambient bed remains a bundled file.
- **Paper-doll equipment on the character (image data for equippables).** The sprite generator now
  emits equipment **layer sheets** (helm/armor/weapon) aligned to the adventurer body frame-for-frame
  via a shared pose "rig", and the renderer overlays them on the local player's actor — sampling the
  same 16-direction frame as the body and gated by the equipped slots (`head`→helm, `chest`→armor,
  `mainhand`→weapon, pushed from `net.you.equipment`). Alignment verified across all facings. (Gear is
  now shown on NPCs/other players too — see the per-entity `look` broadcast entry above.)
- **Generated combat FX strips wired in; licensed `explosion-cuzco.png` removed.** Death plays the
  generated explosion strip; casts play an elemental strip chosen from the ability color
  (frost/lightning/holy/poison/explosion); slams add an explosion burst; melee plays an oriented slash.
- **Procedural asset-generation suite + RENDER-09 finished.** A new in-repo, zero-dependency generator
  toolkit under `tools/assetgen/` (a software RGBA rasterizer + PNG encoder via Node `zlib`, seeded RNG,
  shared easing curves, atomic manifest writer) drives offline asset synthesis — never imported by the
  server. Its first generator (`gen:sprites`) renders a **procedural 16-direction adventurer** character
  sheet (idle/walk/attack/cast/hurt/death, clockwise-from-East to match the engine's `dirIndex`), wired
  in as the player/NPC/hireling sheet with `dirCount: 16` — **completing RENDER-09** (the player now
  rotates in 16 increments instead of 4). Deterministic per seed (hash-tested); the manifest matches the
  engine's `Sheet`/`ClipSet` contract exactly. Verified via the screenshot harness. Five more generators
  ship alongside it (`gen:fx` effect strips, `gen:emitter` particle presets, `gen:tiles` seamless
  biomes, `gen:icons` item icons, `gen:sfx` procedural sound params) — each deterministic and emitting
  artifacts that match the real engine consumer type (`FxStrip`, `EmitterDef`, `GroundTileset`,
  the kind-keyed icon manifest, sound synth defs), ready to register. See `wiki/architecture/Asset-Generation.md`.
- **Per-area screen polish filters (RENDER-10/12/13), enabled.** A new `screen-fx.ts` adds three
  drop-in `pixi-filters` effects driven by a per-area registry (`AREA_SCREEN_FX`), gated to desktop
  ('high'): **godrays** (subtle light shafts, on for all outdoor areas via `theme.outdoor`, stronger
  in town), a **LUT color grade** (`ColorMapFilter`) driven by **procedurally-generated LUT presets**
  (warm/cool/ember/verdant/pallid — no LUT image assets needed; falls back to the ColorMatrix grade
  where no preset is set), and **heat haze** (scrolling-noise `DisplacementFilter`, on for the
  fire/forge/desert areas). Town/wilderness grades verified via the screenshot harness. Also fixed a
  bug where per-area color grades were dropped while the deferred lighting pass was active (the grade
  now rides the displayed lit sprite, not the off-screen world root).

### Deferred (rendering spec)

- The **true (gameplay) form of terrain elevation** — ramps/ledges that change where you can stand —
  remains future work, as it must agree with `world.ts` collision; only the cosmetic visual subset
  shipped (RENDER-08). With RENDER-09 now done, all 15 render-spec tracks are implemented. See the
  Roadmap for details.
- **Premultiplied-alpha audit (RENDER-15).** Verified every blended/additive sprite path (lighting,
  particles, weather) relies on Pixi v8's default premultiplied-alpha upload and premultiply-aware
  `'add'` blend — no `alphaMode` overrides, no edge fringing. No code change required.
- **Direction-count-aware animation (RENDER-09).** The animation controller now supports 8/16-
  direction sheets via an optional `ClipSet.dirCount`: a sheet that declares it rotates in that many
  steps (`dirIndex`, clockwise from East) for smoother hero/boss turning, while sheets that don't
  (every sheet today) keep the exact 4-cardinal mapping — so behavior is unchanged until 16-direction
  art is added, then it activates per-sheet with a clean fall-back.
- **Extended weather (RENDER-14).** Four new weather types widen the mood range: `ash` (slow grey
  drift), `sand` (fast wind-blown grit), `leaves` (tumbling autumn leaves with spin), and `lightning`
  (occasional full-screen flashes). Each respects `weatherIntensity` and "reduce effects", and all
  get authoritative server-side gameplay modifiers (sandstorms cut aggro range hardest; leaves are
  cosmetic). The `AreaTheme.weather` union and the content-DB enum are extended without breaking the
  existing rain/snow/fog/none areas.
- **Occluded-actor fade (RENDER-06).** Tall props the local player can vanish behind (trees,
  pillars) now fade toward 45% opacity while the player stands hidden behind them — generalizing the
  house-roof fade — so the character is never lost. Only the local player triggers it; it restores
  fully on exit and is cheap enough to run on every quality tier.
- **Sprite-copy cast shadows for hero/elites (RENDER-07).** The local player and elite/boss mobs now
  cast a sheared, darkened copy of their current animation frame instead of a soft ellipse blob, so
  the shadow reads as a real cast silhouette that matches the pose (D2's method). The copy shares the
  body's frame texture (no per-frame texture allocation) and updates with the pose, including the
  corpse frame on death. Minor mobs and flyers keep the cheap blob.
- **Decorative terrain elevation (RENDER-08, visual subset).** Wild areas (wilderness, howling
  barrens, ashveil desert) now render rolling hills: the flat ground `TilingSprite` is replaced by a
  heightmapped **mesh** (a world grid whose vertices are pushed up the screen by a deterministic
  height field, textured with the same tiled ground), and props + actors are lifted by the same field
  so they ride the terrain. A baked **hillshade** mesh (same displaced geometry, multiply-blended)
  shades the slopes from the upper-left sun so the elevation reads top-down. Like the water layer it's
  a stage-level, world-anchored layer (composes with the deferred pass). **Cosmetic only** — collision
  stays flat. Verified via the screenshot harness; flat areas keep the original `TilingSprite`.
- **Water reflections & ripples (RENDER-11).** Procedurally-placed elliptical ponds render a tinted,
  rippling surface with mirrored reflections of nearby actors (a flipped, darkened, alpha'd copy of
  each actor's frame, clipped to the pond and wobbled by a `DisplacementFilter`). `waterPondsFor`
  scatters ponds across wet areas (marsh / wilderness / sunken pass / hollowroot) deterministically,
  plus a fixed village pond in town. The water layer renders at the stage level (like the ground) and
  is kept world-anchored by syncing its transform to the world's each frame — which is what lets it
  compose with the deferred-lighting pass (a `world`-child layer didn't). Verified via the screenshot
  harness. Ponds are cosmetic only (no collision — you wade through).
- **Per-pixel dynamic lighting (RENDER-01).** A GPU pass renders the world to an albedo target, then
  a fullscreen composite **derives per-pixel normals from the albedo's luminance gradient** (a Sobel
  emboss — so no normal-map art is needed; existing sprite/ground detail is the relief) and rakes the
  screen-space light list (torches, portals, spells, a directional sun) across it. A relief
  formulation (`lit = albedo·(1 + Σrelief)`) preserves daylight exposure — only textured surfaces and
  edges catch each light's direction. Enabled on desktop ('high'); touch keeps the cheaper additive
  halos, which still draw on top everywhere. The pure light pipeline (projection, farthest-first cull
  to 16, sun, night modulation, packing) is unit-tested; the GPU result was verified via the
  screenshot harness. Replaces the earlier normal-map-asset approach (no art dependency).
- **Tall-object depth sorting (RENDER-05).** Line props (palisade/fence walls) are now built as one
  container per stake, each sorting at its own ground row, so an actor walking alongside a long wall
  is correctly occluded by the posts north of their feet and occludes the posts to the south —
  instead of the whole wall flipping in front/behind by its midpoint. Removed the now-dead
  single-container palisade draw path.
- **Ground decals (RENDER-02).** Combat now leaves the ground marked: deaths drop a corpse stain
  and a blood spray, heavy slams leave a crater/scorch. Decals are pooled (cap 120, 48 on touch),
  baked procedurally (no asset fetch), sort above the ground but below actors, fade out over their
  lifetime, and clear on area change. Honors the "reduce effects" toggle.
- **General particle emitter (RENDER-03).** A reusable, data-driven particle system (`particles.ts`)
  with a library of bursts — impact sparks (gold on crits), blood spray, footstep dust, slam dust,
  embers. Pooled (cap 600 / 160 on touch) with zero steady-state allocation; additive particles glow
  via `blendMode='add'`. World-space (sorts/scrolls with the scene). Honors "reduce effects".
- **Ground tile-edge blending (RENDER-04).** The baked ground texture no longer lattice-scatters
  detail tiles (wildflowers, leaf piles) as lone squares on a regular grid. Tilesets can opt into a
  `blend` field; the bake then clusters those detail tiles into organic patches driven by
  deterministic value-noise and fades them in at the patch edges, killing the grid read. Tilesets
  without `blend` bake byte-identically to before. Also fixed a latent cache-key collision where
  biomes sharing a sheet (town/forest both use `forest_spring.png`) reused each other's bake.

### Fixed

- **NaN-injection via cast aim (security).** A hostile client could send non-finite `dx`/`dy` in a
  `cast` and poison the caster's facing + spawn a NaN-position projectile broadcast to every
  player. The aim is now sanitized at the simulation boundary. (Found by the invariant soak.)
- **Out-of-bounds mob spawns.** `spawnMobAt` now clamps its spawn scatter to the world, like every
  other spawn path. (Also found by the invariant soak.)
- **Movement rubber-banding (now fixed properly, predictor-aware).** Player move speed scaled by
  weather, +move affixes/gems, the Haste buff, and enemy Slow debuff — but the client predictor
  integrated raw `PLAYER_SPEED`, so any of those (especially the now-common monster Slow) made the
  predicted position race ahead and snap back. The server now sends the player's **effective move
  multiplier** in the `you` packet, and the predictor integrates with it (recording it per input so
  reconciliation replays exactly) — so move-slow / haste / +move gear all work with **no
  rubber-banding**.
- **Ranged/spell auto-attack from range.** Clicking a monster now auto-attacks with your *selected*
  attack at *its* range — a ranged or spell primary fires from a distance instead of walking you
  into melee; the chase stops just inside that range. Basic Slash still closes to melee.
- **The Artificer was non-functional.** Its NPC kind fell back to `vendor` when an area was
  populated (the runtime kind allowlist omitted `artificer`), so Coalhand opened a shop and every
  artificer action (reroll / unsocket / combine) silently failed its proximity check. The allowlist
  now includes `artificer`, restoring the whole crafting window. (Found by the new gem-combine tests.)

### Performance

- **Spatial grid for `tickMobs` — a packed instance now ticks ~3× under budget.** The two
  `O(mobs²)` passes (pack-proximity counting + crowd separation, ~1.44M distance checks/tick once
  density scaled mobs to the ~1200 cap) drove the 20Hz tick to ~44ms avg / 58ms p99, over the 50ms
  budget. Both now use `SpatialGrid.queryRadius`. Benchmark (`tools/playtest/tick-bench.ts`,
  Gloomwood, density-scaled): 500 players / 1200 mobs went from ~58ms p99 to **~15–20ms p99** — a
  single instance comfortably holds a 500-bot "best-case launch" wave.

### Changed

- **All tunable server/balance knobs live in one file (`src/server/config.ts`).** Difficulty,
  co-op + crowd-density scaling, world scaling, drop rates, the economy, the bounty/corruption +
  invasion meta, item/potion limits, instance capacity, bot limits, and the operational settings
  (port, tick rate, instancing, admin token, db path, dev password — with their env overrides) are
  no longer scattered across `world.ts`/`index.ts`/`content.ts`/etc. Each module binds its local
  names to `config.*`, so editing one file retunes the game. The two wire-shared pure modules
  (the XP curve in `progression.ts`, the combat math in `combat-formulas.ts`) deliberately stay
  self-contained — they're client-importable and must remain free of any `process.env` dependency.
- **Per-instance player floor raised 50 → 100.** Mob-density scaling caps *per instance*, so packing
  players into fewer, fuller instances is cheaper for the whole-server tick than spreading them
  across instances that each balloon to the ~1200-mob cap. (See `config.instances.minCap`.)
- **Mob HP scales with level.** Player attack power climbs fast (gear + strength + skill nodes),
  so without this a mid-level monster died in one hit and the danger evaporated. Mob HP now grows
  ×(1 + 0.05 × level) — early mobs barely change, but L18 mobs are ~1.9× tankier and the L40+ apex
  bosses ~3×, so same-level fights take real exchanges and the grind lengthens. (Calibrated
  against the new offline pacing simulator, which flagged the one-shot-by-L8 problem.)
- **Engine-mining adoption pass (wasmbots · stage.js · Excalibur · hex-engine).** Every
  vendorable pattern from the four-repo research sweep, in one slice:
  - **Combat feel:** overlapping monsters now push each other apart (no more single-pixel mob
    blobs — packs spread around you, Diablo-style); monsters slide along house walls instead of
    clipping through them (lunges included) and head for the doorway when a wall pins them; and
    **nothing shoots through walls anymore** — projectiles stop on impact.
  - **Determinism:** every instance runs on a seeded RNG (mulberry32) recorded on the instance —
    the same seed reproduces the exact dungeon layout and loot rolls (bug repros, future daily
    seeds). The simulation no longer touches `Math.random`.
  - **Protocol hygiene:** a version handshake in `join` — stale cached phone bundles get a clean
    "New version available — refresh" screen instead of decode garbage; undecodable frames and
    unknown message types now count strikes per connection (20 → disconnect).
  - **Phone battery:** the Canvas2D HUD redraws at ~12Hz when idle (instant on any input)
    instead of every frame; `pointercancel`/window-blur clear in-flight touch state so OS
    gestures never leave ghost input; a "loading assets…" status shows during boot.
  - **Game feel polish:** camera deadzone (no swim during combat shuffles) + bounds clamp
    (small instances like dens never show void); loot pops land with a back-out bounce; the
    area-arrival fade lifts on a cubic ease (new `easing.ts`).
  - **HUD interaction:** a hit-region registry with real down+up-inside click semantics
    (drag-out cancels, topmost-drawn wins) — the gamble/hire/rift windows migrated first.
  - **Dev tooling:** an F9 inspector overlay in dev builds (live entity tree, nearest-to-mouse
    readout, renderer counters, freeze-view, right-click-to-`window.tempN`), and a bot
    record/replay mode (`--record`, `tools/bots/replay.ts`) for deterministic brain regression
    tests against captured server traffic.
- **The world is 5× as long per side (25× the ground).** A single `WORLD_SCALE` applied where
  content loads stretches every area, portal, spawn, NPC spot, and decor placement — zones are
  now real expeditions. Monster rosters grow 4× (sparser frontier, every camp a hunt), dungeon
  packs likewise. Authored data stays compact; tests read positions from content, never
  hardcoded coordinates.
- **Three-act structure.** Everything that existed is **Act 1** (the exponential curve walks
  you out of it around level 15-20). The XP curve is now piecewise — steep ~28%/level through
  the Act 1 band, easing to ~12%/level beyond 20 — with super-linear kill XP for Act 2/3
  monsters, landing ~20 levels per act: L20 ≈ 35k total XP, L40 ≈ 741k, L60 ≈ 7.6M.

### Added

- **Dev "Game Engine" panel — live edit (almost) everything (Developer access).** A full in-game
  editor, gated server-side at Developer level (isolated from every player path), with three tabs:
  - **Content** — every editable DB table (areas, spells, items, monsters, NPCs, quests, loot,
    vendor stock, spawns, sprite tints, area themes). Pick a table → a row → edit any column with a
    widget typed by the server's column spec (number+range, text, enum dropdown, bool); saves
    validate + clamp at the boundary and apply live (reload + re-skin all clients). Built on the
    existing `EDITABLE_TABLES` whitelist, so it can never touch a non-whitelisted table.
  - **Config** — the runtime gameplay knobs (difficulty, drops, economy, density, co-op, potions,
    items, bounty). Edits mutate the live server config; the sim's tuning bindings were made
    runtime-refreshable (`applyRuntimeConfig`) so changes take effect immediately.
  - **Actions** — reload content, spawn/clear bots, give item/gold/XP, set level, spawn monsters,
    set weather, teleport to any area, full heal, set an account's access level.

  Plumbed over a new structured `engine_req`/`engine_res` protocol (request/response with a Dev
  gate); the client surfaces an **Engine** button only at Developer access. The values that need a
  restart (world scale, instance caps, ports) are deliberately excluded from live editing so the
  panel never lies about an edit taking effect.
- **In-game settings panel (⚙ / `O`) + a client-config module.** A DOM drawer to tune the
  CLIENT-side options that now live in one place (`src/client/settings.ts`, the client mirror of
  the server config): master **volume** + mute, **camera zoom**, **show FPS**, and **reduce
  effects** (hides weather + ambient motes for a phone-perf win while keeping the lighting/art).
  Settings persist to localStorage and apply live. A new server→client `access` message lets the
  panel reveal **GM-only** tools once `/login` grants GameMaster+ — a live **debug overlay**
  (entity/renderer counts, area/instance, position, zoom, access) and an **extended camera-zoom
  range**. The GM gate is UX only; privileged powers stay token-gated server-side.
- **AI companion bots (`/bot`).** A GM command spawns AI players that **journey from the starting
  wilderness all the way to the endgame** — fighting, looting, auto-equipping better gear,
  learning spell tomes, and spending attribute/skill points as they level, then routing through
  the live portal graph zone-by-zone toward the Unmade Court. `/bot 4` to populate, `/bot clear`
  to remove your own. They're real World entities driven by a pure server-side brain
  (`server/bot-brain.ts`) with a host-side progression director, so the world feels alive whether
  they grind beside you or strike out on their own. Uncapped for floods (up to 2,000 per call,
  stack more by re-running), and they spawn directly into your instance so the whole army lands
  in your world rather than scattering across cap-scaled copies.
- **Bigger instances + crowd density scaling.** The per-instance player cap is floored at 50 (so a
  crowd stays together in one world), and busy overworld zones now top their monster roster up
  toward a player-scaled target — 50 players in a zone find roughly 5× the monsters a soloist
  does, instead of farming the same thin handful to extinction. Solo instances, safe zones, and
  dungeons are untouched.
- **Shared kill credit + co-op difficulty (dopamine-first).** Every player who *damages* a mob
  shares its full XP and quest credit — no last-hit stealing, helping always pays; party members
  present in the instance share too (proximity credit), plus a small group-size XP bonus. Tagged
  mobs show a **cyan claim ring + pip** so you can see which fights are already engaged (and pile
  in for your share). Each extra living player in an area also makes its monsters hit harder
  (capped) — a crowd is genuinely more dangerous, so you want a real team, not just taggers.
- **Apex boss phases.** Nyxathor (the Abyssal Throne) and Athraxis (the Unmade God, in the Unmade
  Court) now fight in scripted HP-gated phases layered over their brawling AI — they taunt,
  reposition, cast big novas, and **summon their honor guard** as you wear them down, returning to
  melee between set-pieces. (`server/boss-scripts.ts`, a tiny vendored action-queue.)
- **Test + playtest instrumentation.** A deterministic invariant soak (`world-invariants.test.ts`
  — hammers the sim with valid + hostile actions and asserts structural invariants throughout; it
  caught the two bugs fixed above), an offline Act-1 pacing simulator (`tools/playtest/pacing.ts`),
  bot record/replay for deterministic brain regression tests (`tools/bots/replay.ts`), and headless
  playthrough + inspector smoke checks.
- **Acts 2 and 3 — the rest of the map (8 new areas, 18 new monsters).** The Act 2 road runs
  Duskhaven → Grimfrost Barrow → the Howling Barrens → the Sunken Pass (the game's first rain
  zone), forking east to the Blighted Spire and south to **Vhalreth, the city** — Act 3's safe
  hub with every service (including the priciest vendor shelf in the game and the four
  otherwise drop-only chase tomes as an endgame gold sink). Act 3 marches Ashveil Desert → the
  Shattered Causeway → Voidmarch → **the Unmade Court**, the final dungeon, where court guards
  defend **Athraxis, the Unmade God** (level 60, hp 3000 — the true end, with a 150,000 XP /
  20,000 gold bounty). Mid-bosses (Maelgor the Tidewarden, Sarghul the Ash-Tyrant, Vess'irah
  the Void Hag) anchor quests along the way; several Act 2/3 monsters are tint-variant
  recolors of earlier sprites via the `sprite_tints` system (the ash-grey dire wolf, the
  waterlogged hulk, the hollowed-angel final boss).
- **Dens — the Diablo cellar loop (procedural dungeons everywhere).** Every instance rolls its
  own secrets: each house footprint has a 50% chance of a **cellar hatch** inside, and open
  country hides 2-4 **hidden dens** at random spots. Stepping on one descends into a fresh,
  private cellar-sized dungeon stocked from the local area's roster (35% chance of a beefed-up
  den landlord), holding guaranteed chests; the exit climbs back out where you went down. Plus
  **random bonus chests** rolled into every instance beyond the authored treasure.
- **Portal + density tuning for the 5× world.** Portal triggers scale only 2× (centers fully)
  and the drawn pad is capped to a discrete gateway; overworld monster rosters go 4×→10× and
  dungeon packs 4×→8×.
- **Duskhaven, the frontier village (Act 2's rest point).** A snow-dusted mountain settlement
  through a new pass at the far end of Frostpeak: vendor (with an Act 2 shelf), healer, banker,
  and quest-giver, hearth-lit and palisaded — the second safe anchor on the map.
- **The Abyssal Throne (endgame dungeon).** Beyond the Blighted Spire: the darkest floor in
  the game, packed level 30-40 — Abyssal Thralls, Duskfire Hexers, Thronespawn Ravagers, two
  throne-guard bosses, and **Nyxathor, the Abyssal Sovereign** (level 40, the hardest fight in
  the game; 2-4k gold and a 50,000 XP bounty quest).
- **Exploration rewards everywhere.** ~45 treasure chests and shrines plus ~30 landmark prop
  clusters (standing-stone rings, a fairy ring, a titan ribcage, a ruined chapel…) scattered
  to the far corners of every zone — destinations worth the now-long walk.

- **The world is HARD now (difficulty + pacing overhaul).** The game is rebalanced from a
  15-minute stroll into an hours-long climb:
  - **Exponential XP curve** — each level costs ~28% more than the last (L10 ≈ 2.6k total XP,
    L20 ≈ 35k, L30 ≈ 410k, vs the old quadratic 4.5k/19k/43.5k), and kill XP is reduced ~35%.
    Existing saves keep their level (XP is raised to the new floor — nobody de-levels).
  - **Monsters hit 1.5× harder, live 1.4× longer, and notice you from 1.2× farther** — on top
    of elite/rift/corruption scaling.
  - **Smarter, varied AI (traits across the whole roster):** *pack* hunters speed up and aggro
    wider together and call packmates for help when hurt; *craven* skirmishers flee below 30%
    HP (but hold the line in numbers); *enrage* brutes hit 1.5× and run 1.35× faster below 35%
    HP; *flankers* curve around you instead of beelining; and any hurt monster is **alerted** —
    it hunts with 2.5× aggro reach instead of idling.

### Added

- **10 new spells across the longer climb.** Early utility (Razor Wind, Bone Chakram), mid-game
  control (Mire Mortar's bogging splat, the Galeburst and Earthshatter novas), a big expensive
  heal (Divine Mending), a late-game War Cry (Battle Trance, +45% damage), and three endgame
  nukes (Wyrmfire Lance, Starfall, Maelstrom Orb — burning, slowing, and the hardest single hit
  in the book). Cheap tomes sit on the Merchant's shelf (topping out at a 2,600g gold sink);
  the four chase tomes (Galeburst, Earthshatter, Starfall, Maelstrom Orb) are **drop-only**.
- **SQL sprite color overrides (`sprite_tints`).** A new content table multiply-tints any rendered
  source — `mob:<template_id>`, `npc:<kind>`, `hireling:<type>`, `decor:<kind>` — so one image
  spawns many variations (and the look can be pushed dark and gritty) without ever editing the
  files. Entity tints are stamped server-side onto the snapshot; decor tints ship in the content
  packet and multiply with each decor row's own `color` column and the area's sprite tint.
  Live-editable (`/set sprite_tints <target> tint <hex>`, or SQL + `/reloadcontent`). Seeded with
  gritty examples (moonlit graves, mossy gloom canopy, putrid/drowned monster recolors).
- **Breakable pots.** 'pot' decor rows spawn as smashable entities: brush against one and it
  shatters in a sparkle, spilling a little gold (occasionally topping up a belt potion). Placed
  in Diablo-style clusters through every dungeon and the town.
- **Hand-placed set-dressing everywhere (324 props).** Every one of the 14 areas now has authored
  decor: graveyards in the crypts, stalagmite-and-mushroom caves, horror-plant cursed zones,
  supply caches in the mines, pots by the town vendors — plus animated **candles** and
  **braziers** (RF Catacombs frame loops) that flicker on the light layer.
- **12 new monsters from the 32rogues roster.** Thistle Kobold, Mosshide Orc, Shadowmaw Bear,
  Rotfen Naga, Fen Ettin (slammer), Gloomcap Myconid, Basalt Basilisk (charger), Gnarlfang Lycan,
  Crag Manticore, Riftwing Harpy, Voidscale Drake, and the Blightgore Minotaur — spread across
  the overworld with tuned stats, spells, and loot; the mid/late picks join the rift pool.
- **Endgame rifts (The Shattered Rift).** Saelis the Riftkeeper in town opens a **fresh, private
  rift instance** at a difficulty tier you choose (one tier unlocks per 3 levels, up to 10; the
  fee is 100g × tier — an endgame gold sink). The tier scales everything: +2 monster levels per
  tier (more XP), +35% HP and +18% damage per tier, ~15% denser packs, and a climbing champion
  chance. The rift rolls a chaotic cross-act roster with the Voidmaw Devourer at the bottom;
  exit through the portal home and the instance dissolves. Re-opening re-rolls everything.
  Also fixed in passing: portals now transfer **only players** — a hireling (or mob) crossing a
  portal pad could previously be re-spawned as a ghost "player" on the other side.
- **Real pack art across the whole game (curated-asset integration).** The 13 extracted Downloads
  packs (see `public/assets/INVENTORY.md`) now feed the renderer and HUD via four new data modules:
  - **Tiled ground per biome** (`ground-tiles.ts`) — every area bakes a 16×16-tile pattern of real
    floor tiles (forest grass + wildflowers, catacomb brick, cursed earth, cracked graveyard dirt,
    slate dungeon, volcanic/glacial stone…) replacing the procedural speckle; procedural stays as
    the fallback.
  - **A sprite for every monster** (`rogues-sprites.ts`) — all 48 mob templates map to 32rogues
    creature cells; mobs without an animated LPC sheet (slimes, golems, demons, spiders…) now draw
    a real static sprite with facing-flip + walk/idle bob instead of a colored orb. Service NPCs
    get distinct townsfolk figures (shopkeep, priest, blacksmith…).
  - **Decor sprites** (`decor-sprites.ts`) — 16 prop kinds (graves, bones, dead trees, rocks,
    crystals, mushrooms, stalagmites, ruins, pots, horror plants, barrel, crate…) with up to 6
    position-hashed variants each, used by both SQL `decor` rows and theme-density props.
  - **HUD item icons** (`item-icons.ts`) — bag/stash/belt cells draw real pixel-art icons (94 gear
    mappings + 25 gems + 10 runes + tomes/materials/potions) with the old colored-rect fallback.
  Only the ~640KB of curated sprites the game loads are committed (`public/assets/curated/`); raw
  packs stay on disk, attribution recorded in `public/assets/CREDITS.md`.
- **Hirelings (mercenary companions).** Captain Aldric, the town Recruiter, hires out a melee
  **Guard** or a kiting **Marksman** for a level-scaled gold fee. The companion follows you,
  fights nearby monsters (kill credit — XP and quests — flows to you), scales with your level,
  draws monster aggro, and crosses areas at your side. If it dies the contract is void: hire
  anew in town. Server-authoritative (`src/server/hirelings.ts` + `world.ts`); a new `hireling`
  entity kind on the wire and a recruiter window on the client.
- **Potions + a quick-use belt.** Health (Q) and mana (R) potions restore instantly on a short shared
  cooldown — the active-survival layer over passive regen. Carried in a capped belt that persists with
  the character; the Healer refills it and chests stock it. Server-authoritative count + cooldown, with
  a HUD belt that greys out while recharging.
- **Unique items (named legendaries).** A new `unique` rarity and 12 hand-authored named legendaries
  on real base items, each with signature fixed affixes — the loot chase. A slim chance on any gear
  drop (4× from bosses, better from chests) mints one; they show their name, colored gold.
- **Shrines.** Step onto a shrine (SQL `decor` kind `shrine`) to be blessed with a random timed
  buff — Might (+40% damage), Haste (+40% move/attack), or Renewal (15 hp/s) — on the existing buff
  system; the shrine then recharges on a 60s cooldown. Placed by the town bonfire and in the caves.
- **Lootable world chests.** Chests (SQL `decor` kind `chest`, spawned as `chest` entities) pop open
  when you walk up, spilling gold and rolled gear at your feet. One waits inside the south town house
  (a reward for going indoors) and more hide in the Hollowroot Caverns.
- **Solid house walls (no rubber-banding).** Houses are now enterable through the door but solid at
  the walls, via a shared collision module that the authoritative server and the client predictor run
  identically against the same footprint geometry — so collision adds no movement desync.
- **Enterable houses with a fading roof.** Timber houses you can walk into: the renderer draws the
  floor and walls behind your character but the **roof above** it, then fades the roof to
  near-transparent while you stand inside the footprint, so you see your character indoors (Diablo II
  / RuneScape style). Houses are SQL `decor` rows (`kind = 'house'`, footprint `(x,y)→(x2,y2)`,
  timber `color`), placed in the starting town. v1 is cosmetic (no wall collision yet — solid walls
  without movement rubber-banding need a shared server/predictor collision module, a planned
  follow-up).
- **Hollowroot Caverns — a new cave dungeon.** A procedural "caves" branch off Gloomwood (a damp,
  near-dark cavern theme), reusing the dungeon system: a cave-dweller mob pool, an elite chance, a
  boss, and a portal in and out. Reachable from the wilderness east edge.
- **The town is a Diablo-II-style camp, defined in SQL.** Town set-dressing moved off the client into
  a new `decor` content table (loaded onto `AreaDef.decor`, shipped in the `content` packet): a
  spiked palisade ring with an east gate, a central bonfire, canvas tents, a merchant wagon, a
  blacksmith anvil, crates/barrels/hay, and torch poles — all editable with SQL, no code change.
- **A banker stash (the Vault).** A Vault Keeper banker NPC opens a two-column Vault: deposit bag
  gear into a 60-slot stash, withdraw it back. Server-authoritative, proximity- and capacity-checked,
  and persisted with the character.
- **A codebase-wide exception/trap system.** A client global error trap (window error +
  unhandledrejection) with a bounded log and an on-screen badge so a stray throw flashes a warning
  instead of a blank screen; a pure UI overflow guard that keeps HUD panels on small/rotated screens;
  and server-side `runGuarded` wrappers around the per-message dispatch and the per-tick loop so one
  bad message or corrupt entity can't crash the server (with a failure tally on `/health`).
- **Gem combining at the Artificer.** Fuse **3 matching gems into one of the next tier** (the Diablo
  cube), free — the gems are the cost. A "Combine gems" button in the Artificer window upgrades your
  first eligible stack each click, giving the flood of chipped gems a purpose. Server-authoritative
  (re-validates artificer proximity); new `combine_gems` message + `nextGemTier` helper.

### Changed

- **Renderer — more 3D + wider sprite coverage.** Flying monsters (bats, sprites, shades, wraiths)
  now **hover elevated above a smaller, fainter planted shadow** — a real height/parallax cue (the
  D2/D3 look). And far more monsters get a real animated sprite instead of a flat procedural blob:
  the LPC sheets are reused by archetype (humanoid/undead → skeleton, canine/beast → wolf, flyer →
  bat, big named undead bosses → the imposing 1.6× boss sprite); amorphous mobs (oozes, golems,
  colossi) still use procedural shapes, which suit them better than a mismatched sprite.
- **Spell merchant — rotating, capped shelf + higher prices.** The Merchant no longer dumps its
  whole catalog (which overflowed the panel): it shows its basic gear plus a **rotating window of a
  few spell tomes**, cycling the selection every few minutes, and **tome prices are scaled up** (a
  gold sink that keeps drops the exciting acquisition path). Display and the buy check share one
  source, so you can only buy what's currently on the shelf, at the shown price.
- **Renderer — trailing follow camera + a more oblique tilt (toward the Diablo III / RuneScape
  look).** The camera now eases toward the player each frame instead of being bolted to it, so the
  view *follows* like RuneScape/Diablo (large jumps through portals still snap). The world plane is
  raked a little more (a lower foreshorten) so the ground reads as more 3D and less straight-down.
  The smoothed camera drives both drawing and click-to-move picking, so targeting stays aligned.
  Added **camera zoom** (`=`/`-`), defaulting a touch zoomed-in for a more intimate framing — the
  zoom feeds the projection and click-picking so everything stays aligned at any level.
- **Controls — click-to-move + targeting + remappable hotbar (ARPG redesign).** Movement is now
  **click-to-move only** (WASD and the touch joystick are gone): left-click the ground to walk
  there, left-click a monster to **select + chase** it. A selected monster is **auto-attacked**
  with your basic Slash whenever it's in reach — no key needed. Spells stay **manual** and
  **auto-aim at the selected target** (no manual aiming): fire them from the **6-slot hotbar**
  (keys `1`–`6`, or click a slot). The hotbar is a **sliding window over your known spells** —
  **scroll the wheel over the bar to rotate every spell through it at once**, lining up your
  rotation in the 1–6 positions — and scrolling **locks during combat** (for ~4s after you deal or
  take damage) so you can't re-plan mid-fight. Newly-learned spells appear automatically. Movement is
  synthesized client-side into the existing 8-direction input, so the authoritative server,
  prediction, and reconciliation are untouched (no protocol change). Fresh characters start knowing
  **only the Slash auto-attack** — every spell is acquired loot. Added `PixiRenderer.screenToWorld`
  to invert the tilted projection for click picking; removed `input.ts` (joystick) as dead code.

### Added

- **Monsters cast spells.** Caster monsters now hurl real abilities instead of generic bolts — a
  Hooded Cultist throws a **Shadow Bolt** that burns you, a Rime Archer a **Frostbolt** that slows
  you, a Mire Spitter **Poison Spit**, the Fenwitch **Venom**, deep/ashen casters fire/cinder, and so
  on — and the spell's on-hit effect now **debuffs the player** (you can be slowed, burned, or
  weakened, shown as red HUD chips and a tint). Other monsters are **support casters**: War Cry
  enrages them (more damage), Sprint hastes them, Renew self-heals — enraged mobs glow hot orange.
  Built on the same status engine as player buffs: a generic mob-cast dispatches by spell kind
  (projectile / melee-nova / heal / self-buff), so any ability can be handed to a monster. Player
  debuffs clear on death. Config lives in code (`MOB_SPELLS` / `MOB_SUPPORT`), so no DB migration.
- **Gems for every build stat.** Sockets are no longer limited to power/HP/crit/multishot — five new
  gem families drop and slot in: **Emerald** (life steal), **Amethyst** (attack speed), **Jade**
  (move speed), **Onyx** (armor), and **Opal** (vigor regen), each across three tiers. Combined with
  the new Armor/Vigor affixes, socketing is now a real lever for any build, not just raw damage.
- **New act-3 zone — The Blighted Spire (L27–32).** A blight-choked citadel opens off the east edge
  of the Sundered Wastes, raising the ceiling again. Blight Knights, **Pyre Casters** (who hurl
  Meteor — burning you, via the monster-spell system), and Ruin Colossi guard it, with the act boss
  **Vorzel, the Throne-Tyrant** (L32) and a bounty quest rewarding the Tome of Cataclysm. The Last
  Warden gives quests at the entrance. Four new monster templates; all seeded idempotently.
- **New act-2 zone — The Sundered Wastes (L20–26).** A void-scarred highland opens off the east edge
  of Frostpeak Pass, raising the level ceiling past the Pale King. It's stalked by Void Revenants,
  Ashen Warlocks, Obsidian Juggernauts and Hollow Runeseers, and ruled by a new act boss —
  **Xal'thirun, the Unmaker** (L26), with a bounty quest that rewards the Tome of the Thunder Lance.
  Three new monster templates join the bestiary; the zone, its theme, the entrance/return portals,
  the monster roster, the boss gold drop, and the quests all seed idempotently into an existing DB.
  A quest-giver — **The Exiled Seer** — stands near the arrival point (matching every other zone),
  offering a side bounty to thin the Void Revenants.
- **Two new gear affixes — Armor & Vigor.** Gear can now roll **+% armor** (incoming damage reduced,
  stacking with the corrupted +fragile penalty, capped at 50%) and **+HP/sec Vigor** (passive regen
  on top of the base). They flow through the whole loot system — rolled by rarity, named in the
  Diablo title style (Sturdy/Plated/Ironclad… / …of Health/Vitality/Renewal), and shown on the stat
  line — widening defensive/sustain builds alongside the existing offensive affixes.
- **Temporary buffs & a curse debuff.** Three self-cast buff spells join the book: **War Cry**
  (+30% damage), **Sprint** (+35% attack speed & movement), and **Renew** (a heal-over-time) — each a
  timed buff that stacks on top of your gear. Monsters can now be **weakened** (their outgoing damage
  cut) by curse spells — Curse of Decay both slows *and* weakens, and Draining Touch / Shadow Nova
  sap a monster's bite. All run through the existing timed-status engine (now extended with
  weaken/might/haste/regen and floored so nothing zeroes out). The HUD shows active buff pips, and
  weakened monsters take a sickly violet tint. Surfaced via the existing entity status-flags (no new
  wire fields). The three new tomes drop in-world and sell on the Merchant.
- **Procedural Diablo-style dungeons + tougher spawns.** Four instanced **dungeons** now hang off the
  overworld via portals — **The Forgotten Catacombs** (off Gloomwood, L4–9), **The Writhing Hive**
  (off Rotfen Marsh, L9–15), **The Infernal Forge** (off Emberdeep Mines, L15–20), and **The Frozen
  Vault** (off Frostpeak, L19–24). Each is **repopulated from scratch on entry**: a random-sized pack
  drawn from the dungeon's monster pool at random positions, an **elevated elite ("champion") chance**
  (up to 0.32 vs the overworld 0.09), a **named boss** (Maggath, Vorraxia, Bal'thuzar, Kaldris), and
  sometimes a bonus tanky **mini-boss**. A low player-cap keeps them near-private, so re-entering
  re-rolls the whole dungeon. Adds **20 new monster templates** (a full dungeon bestiary across every
  bracket + four bosses) and four dark dungeon themes. Overworld monsters now also **re-randomize
  their position when they respawn**, so cleared ground refills somewhere new instead of the same
  spots. All of it seeds idempotently into an existing DB (areas, themes, portals, monsters — no
  wipe). The drop pool widening from the previous entry means dungeon kills surface the full loot set.
  Each dungeon also has a **boss-bounty quest** (clear Maggath / Vorraxia / Bal'thuzar / Kaldris) that
  rewards a spell tome, giving the descent a goal.
- **Huge content drop — 34 new spells + 74 new gear bases.** The spellbook grows from 9 to **43
  abilities**: a full elemental line (ember/frost/spark bolts, frost & inferno **novas**, chain
  spark, glacier spike, thunder lance…), an occult & nature line (shadow bolt, poison spit, arcane
  orb, radiant smite, curses, **3 new heals**), and a martial line (quick jab, whirlwind,
  bladestorm, crushing smash, rend, hamstring, throwing axe…). Novas are expressed as full-circle
  (360°) melee, so AoE needed no new engine system. New chilling/bleed spells slow or burn on hit.
  The loot pool grows from ~24 to **~98 gear bases** across every slot and tier (rough → runed):
  evocative weapons, armor, and jewelry. Because the drop system already rolls a *random* base for
  every gear drop and a *random* tome for every book drop, registering these instantly widens all
  loot — every kill can now surface far more variety. All new content seeds idempotently into an
  existing DB (no wipe). `AbilityId` now derives from the ability table, so future spells extend the
  type for free. (Generated by parallel content-design subagents, then balance-merged.)
- **Artificer NPC — enchanting + gem unsocketing.** Coalhand the Artificer joins the town: press E
  to open a crafting window that **rerolls a bag item's affixes** (250g + 1 rune shard — corrupted
  gear rerolls its buff/debuff pair) or **pops a gem out of equipped gear** back into the bag (120g),
  freeing the socket. Both are server-authoritative (proximity + cost + ownership re-validated). New
  `enchant` / `unsocket_gem` messages, an `artificer_open` panel packet, and an `artificer-panel.ts`
  renderer. This completes the gems system (socket → reroll → unsocket).
- **Renderer — real loot icons (3D-feel pass, slice 6).** Ground drops now use the sourced sprite
  icons that were already bundled but unused: gold renders as a few coins / a stack / a big pile by
  stack size, and **gems drop as their actual gem icon** (ruby/sapphire/topaz/diamond) instead of a
  generic glowing dot. (Bulk new-art sourcing + atlasing — more monsters, a Tiled ground — remains
  future work needing the asset pipeline + per-asset CC-BY review, per
  `wiki/research/renderer-3d-feel-and-animation.md` §6.)
- **Renderer — depth, atmosphere & bloom (3D-feel pass, slices 3–5).** A **camera dolly** seats the
  player below screen-center so more world shows ahead (a tilted-camera depth cue), and actors get a
  subtle **faux-perspective scale** (closer = bigger, clamped) — the D2/D3 depth read. The vignette
  now also washes the screen edges toward the area's **fog color, desaturated** (atmospheric
  perspective: the periphery recedes). And a quality-gated **bloom** (`pixi-filters` AdvancedBloom at
  half resolution) makes the torch / portal / spell glow bloom on desktop, while phones
  (`navigator.maxTouchPoints > 0`) get it disabled for zero GPU cost. New `post-fx.ts` module; the
  atmosphere edge-fog is baked + cached (rebuilt only when the fog color or viewport changes).
- **Renderer — sprite animation system (3D-feel pass, slice 2).** The old "idle-vs-walk frame index"
  becomes a real state machine: **idle / walk / attack / cast / hurt / death**, driven by movement
  and the server's existing `FxEvent`s (no new wire fields). Characters now swing on a melee/slam,
  cast on a spell, flinch when hit, and **hold a corpse pose on death** (lingering ~0.9s before the
  view is swept). The full Universal-LPC block rows (slash/spellcast/hurt — previously unused) are
  now animated. Built on a new pure, unit-tested `animation-controller.ts` (9 tests: priority,
  one-shot completion, dirless hurt, terminal death, walk-only fallback); the renderer pre-resolves
  (row,col) per frame with zero allocation. Animation stays 100% cosmetic and server-authoritative.
- **Renderer — soft directional shadows (3D-feel pass, slice 1).** Actors now cast a soft,
  baked-radial ground shadow that's offset and skewed toward a fixed "sun" (upper-left), so
  characters read as *planted* and lit from a consistent direction (the Diablo 2 look) instead of
  floating over a hard symmetric ellipse. Built on a once-baked shadow texture (zero per-frame
  cost); the local player keeps its gold ground-ring. First of the sequenced rendering slices in
  `wiki/research/renderer-3d-feel-and-animation.md` (animation system, depth/parallax, atmosphere,
  bloom, and asset upgrades follow).
- **Waypoints / fast-travel (press M).** Characters now remember every area they've visited; a
  waypoint map lists discovered areas and lets you instantly travel to any of them (carrying full
  state, the same export/import as a portal). Discovery persists in the save and grandfathers in for
  old saves (the area you load into is always discovered). New `waypoint` message +
  `InstanceManager.teleport`; the server only honors travel to a discovered area.
- **Collect / turn-in quests (a new quest type).** Quests can now require turning in N of an item
  (consumed) instead of slaying mobs. Talk to a quest-giver to hand in a completed collect quest —
  the quest log shows live held/needed progress and a "turn in at a quest-giver" hint. Two new
  quests: *Warm Hides* (8 Wolf Pelts) and *Old Bones* (12 Bones). New `quests.turn_in_item` /
  `turn_in_count` columns (migrated), `QuestState.kind` on the wire, and a shared `completeQuest`
  path so kill + collect rewards behave identically.
- **Town services — Healer + Gambler NPCs.** **Sister Oona** (healer) fully restores HP/mana on
  interact — a free QoL stop. **Lucky Marn** (gambler, the D3-Kadala pattern) opens a window where
  you spend gold for a **random item of a chosen equip slot** (cost `50 + 30 × level`, scaling
  forever as a gold sink) — could be junk, could be rare. New `gamble`/`gamble_open` messages,
  `shared/gamble.ts` (11 tests), a `gamble-panel.ts` renderer, and two seeded NPCs (added
  idempotently to existing DBs). `npc.kind` now includes `healer`/`gambler`.
- **Gems + sockets (Diablo-style).** Gear now rolls **gem sockets** by rarity (magic/rare 1, epic/
  legendary 2, corrupted 1). Gems drop from monsters (2%/12%/60% normal/elite/boss) as their own
  stackable item kind — three families × three tiers (Ruby→power, Sapphire→hp, Topaz→crit) plus a
  rare tier-3 Diamond (+1 projectile). Tap a gem in the bag to socket it into the first open socket
  on your equipped gear (server-authoritative, auto-targeted); socketed gems fold into your stats
  via `recomputeStats`, and the character panel shows filled/empty socket pips. Built on
  `src/shared/gems.ts` (15 unit tests) with socket plumbing on `ItemInstance`.
- **Player parties (press P).** Invite the nearest player (or `/invite <name>`), accept/decline,
  and leave from a party panel showing each member's name, level, live HP bar, and area. Parties are
  host-level so they span areas/instances; a kill **shares full XP + quest credit** with every
  co-member present in the same instance (grouping is rewarded, not taxed). The leader leaving
  promotes the next member; a party of one disbands. New `PartyRegistry` (server) with 19 unit
  tests, a `setPartyResolver` hook so the pure per-instance `World` can credit teammates, and a
  `party` packet. Cap 5.
- **Friends list + whispers (press F).** A persistent friends list (stored in a new `friends` table,
  per character token) with live presence — online/offline, level, and current area — plus private
  whispers. `/friend <name>`, `/unfriend <name>`, `/w <name> <msg>` (the panel's per-friend buttons
  prefill a whisper or remove a friend). New `SocialRegistry` (server) with 13 unit tests; presence
  updates as players join, move between areas, and disconnect, pushing fresh lists to watchers.
- **Chat channels.** Messages now carry a channel (`say`/`system`/`party`/`whisper`) and the client
  tints them — whispers purple, party blue, system gold — so social chatter reads at a glance.
- **Quest log UI (press L).** A panel listing every quest as available / active / completed, sorted
  with live objectives first: active quests show a progress bar (e.g. 3/5), available quests have an
  **Accept** button, and each row shows its gold/XP/item reward. Quest state now rides the `you`
  packet (`QuestState[]`), and a new `accept_quest` message lets the panel accept a quest directly
  (server validates it exists and isn't already taken). Turn-in stays automatic on the killing blow.
- **Spells are loot — the spellbook system.** Abilities are no longer all free at spawn. Fresh
  characters know only **Slash + Fireball**; the rest are learned from **spellbook items** that drop
  from monsters (0.4% normal / 3% elite / 30% boss), are awarded by quests (Wolf Cull now grants the
  *Tome of Mending*), or are bought from the town Merchant. Re-reading a known tome **ranks the spell
  up** (Diablo 1 rule: +12% effect per rank, to rank 5). Casting is gated server-side on learned
  spells — a client can't cast what it never learned. The hotbar shows locked slots with a padlock
  and rank pips on learned ones. New `items.teaches` column + `STARTER_ABILITIES`/`MAX_SPELL_RANK`;
  pre-spellbook saves grandfather in all six spells at rank 1. Design:
  `wiki/research/spell-acquisition-design.md`.
- **Vendor shops — buy as well as sell.** Pressing **E** on a vendor now opens a **shop window**
  (buy gear + tomes for gold; an explicit *Sell all* button; Esc closes) instead of instantly
  dumping your bag. Server-side `buy`/`sell` re-validate proximity, stock membership, and gold every
  time; vendor gear rolls **common** (a floor, so drops stay the jackpot). New `vendor_stock` table.
- **Three new areas — the spine grows from 3 zones to 6.** **Rotfen Marsh** (L8–12, a poison-themed
  branch off Gloomwood), **Emberdeep Mines** (L12–16, volcanic, past the Crypt), and **Frostpeak
  Pass** (L15–20, ice highlands, ending at the Pale King). 13 new monster templates across the
  fodder/tank/ranged/charger/boss roles (reusing the existing AI behaviors), each area with its own
  data-driven theme, drop tables, and a boss; two new gear tiers (**steel**, **mithril**) and three
  new materials give each zone a loot identity. Quest-givers stand at each new area's arrival point.
- **More quests.** Boss-hunt quests for the Fenwitch, Forge Tyrant, and Pale King (plus a crypt
  skeleton cull), each rewarding gold, XP, and a spellbook — a natural progression chain.
- **Bot stress harness (`tools/bots/`).** Headless clients that speak the real wire protocol: a
  `WANDER/FIGHT/LOOT/VENDOR/PORTAL_HOP` state machine, a `stress` runner that ramps N bots and
  reports tick/snapshot metrics against pass/fail thresholds, and a `chaos` client that fuzzes the
  protocol boundary. Wired into `npm test`; `npm run stress` / `npm run chaos` to drive it.

### Fixed

- **Oversized-frame server crash (DoS).** A single inbound WebSocket frame larger than the 4 KB cap
  raised an unhandled per-socket `error` event that killed the **whole** server process. The
  connection callback now handles `error` and terminates just that socket. (Found by the new chaos
  bot.)
- **`giveItem` now credits gold to the wallet** instead of stuffing it into a bag stack, so GM
  `/give gold` and quest/vendor gold flows are consistent.
- **Windows: the prod server now serves the page.** `serveStatic` decided "site root" *after*
  `path.normalize`, which on Windows turns `/` into `\\` — so `/` missed the index.html branch and
  404'd (the built client never loaded; the screenshot harness showed the dev fallback text). Root
  is now detected from the raw URL before normalization.
- **Hardening from an adversarial bug-hunt pass** (4 confirmed findings, fixed + regression-tested):
  a dead player could `learn`/rank spells (now gated like `cast`/`buy`/`sell`); a negative
  `vendor_stock` price would *add* gold on purchase (`buy` now rejects non-positive prices); an
  out-of-range `giveItem` quantity could spin the tick loop forever (now clamped to 10 000); and a
  malformed/oversized `shop` packet could crash or freeze the client (stock is now validated as an
  array and capped at 60 rows on the client). Also grandfathers an empty learned-spells list so a
  save can never produce a spell-less character.

- **Character no longer resets when crossing a portal** — area transfers now carry the player's full
  persistent state (level, XP, HP/mana, gold, loot, equipment, quests) between instances
  (`World.exportPlayer`/`importPlayer`); previously crossing a portal wiped progression.

### Added

- **Full equipment slots + a Diablo-style character panel** — gear expands from weapon/armor to **13
  doll slots**: head, neck, shoulders, chest, hands, waist, legs, feet, main-hand, off-hand, **two
  rings**, and a trinket. The model is generalized (`ItemSlot`/`EquipSlot` + `EQUIP_SLOTS` in
  `src/shared/equipment.ts`, ~18 base items across the slots); the player's `equipment` is a slot→
  instance map; `recomputeStats` sums power/HP/affixes from every equipped piece; equipping a ring
  fills the first free ring slot; and a new `unequip` action returns a slot to the bag. Press **C**
  for the character panel — a paper-doll of all slots showing each equipped item in its rarity color
  with stats, tap a slot to remove it; the bag (tap to equip) auto-routes to the right slot. Mob
  kills now drop a **random** equippable (any slot) for variety. The `you` packet carries the
  equipment map; old `{ weapon, armor }` saves migrate to `equipment.mainhand`/`chest`.
- **Ghost-player fix (WebSocket heartbeat)** — abruptly-dropped clients (tab reloads, HMR, network
  blips) left idle "ghost" players in the world until TCP timed out (dozens piled up). The server now
  pings every socket every 15s and terminates any that miss a pong, removing their player promptly.
- **Corrupted gear (high-risk, high-reward)** — a new top rarity, **Corrupted** (sinister pink),
  that never drops normally: it is **born from area corruption**. In a corrupted area, a
  corruption-scaled share of gear drops (up to ~30% at full corruption) come out Corrupted — with the
  **strongest base stats of all** plus a **corrupted affix pair**: one powerful buff (big +power,
  +crit, or +2 projectiles) bound to a real **debuff** (`frail` −max HP, or `fragile` +% damage
  taken). Debuffs feed `recomputeStats` (lower max HP / a damage-taken multiplier applied in
  `damagePlayer`). This ties the loot chase to the corruption system — the deadliest places yield the
  deadliest gear. Beyond area corruption, corrupted gear also drops on a **slim chance from invasion
  champions** and an **even slimmer chance from bosses** (below the legendary rate). New
  `rollCorruptedInstance` / `rollCorruptedAffixes` / `isDebuff` in `src/shared/items.ts` (tested); the
  corrupted rarity color + debuff labels render through the existing bag/drop paths.
- **Invasion events** — every so often a populated, non-town area instance is raided by a sudden
  wave of 3–5 **champions** ringed around a random player, announced in chat — a spontaneous group
  fight that turns a quiet farm into an onslaught (`World.spawnInvasion`, host-driven timer in
  `src/server/index.ts`). This is the gameplay of the "spontaneous raid" twist; literal
  *cross-instance portal-linking* (joining separate instances into one raid) remains a deliberate
  future step — it needs coordination across the otherwise-pure instance manager.
- **Persistent corruption** — a signature twist: each **area** carries a shared **corruption** level
  (0..1) — **every player's death in the area** feeds the same pool (across all its instances) — that
  is **pushed back by killing monsters**, fades slowly, and **resets every morning** (06:00 local).
  High corruption makes mobs hit harder (up to +60% damage) and visibly **darkens the area** with a
  crimson pall. Rather than a numeric meter, the world announces threshold crossings **Diablo-style**
  ("The forces of darkness grow stronger/weaker in …"). Area-wide pool + 06:00 daily reset live in
  `src/server/area-corruption.ts` (tested); the host drives decay, the daily rollover, and the tier
  announcements (`src/server/index.ts`); the darkening rides a `corruption` value on the `you` packet.
- **Living loot meta — the hunting bounty** — the first of the signature twists: each monster type
  accumulates a loot "bounty" while it is left alone and **consumes it on a kill**, so the first
  kills after a lull are richer (a high chance of a bonus rarity-bumped drop) and farming one spot
  quickly depletes it back to base loot. The loot value literally *reacts to farming pressure* —
  rewarding exploration over camping. Server-side and time-based (`lastKillAt` per template, no DB),
  with a player notice on a bounty (`src/server/world.ts`). (Seasonal/persistent meta evolution
  remains future work.)
- **Quest-giver NPC (the loop now has direction)** — a new **Elder Maeve** stands in the town plaza
  beside the merchant; walk up and press **E** to take the next quest (or hear your progress) — no
  more undiscoverable typed `/accept`. New `questgiver` NPC kind dispatched in `World.interact`
  (`sellToVendor` / `talkToQuestGiver`), the NPC role rides the snapshot (`npcKind`), and the client
  shows a context-aware prompt plus a floating gold **!** marker over the giver.
- **Elite / champion monsters** — any non-boss mob has a small chance (~9%) to spawn as an **elite**
  with a flavor modifier (**Swift** / **Brutal** / **Vigorous**) that scales its HP, damage, and
  speed, a name prefix, a gold ground-ring marker, and a bigger body. Killing one is a real event:
  **3× XP**, a pile of gold, and **one guaranteed rarity-bumped gear drop** (`rollItemInstance` gains
  a `rarityBump`; `bumpRarity` in `src/shared/items.ts`, tested). All runtime (no DB change) —
  modifiers + rewards in `src/server/world.ts`, the `elite` flag rides the snapshot, and the client
  draws the marker + upscales the mob (`src/client/pixi-renderer.ts`).
- **"Loot = your build" — the multishot affix** — gear can now roll a build-defining **`+projectile`**
  affix that makes your projectile abilities fire extra bolts in a fan (1, or 2 at Epic/Legendary).
  Your *kit* now changes with your *gear*, not just your stats — the first taste of the loot-as-build
  twist. Aggregated into `player.multishot` on equip and applied in the cast path
  (`src/server/world.ts`); rolls/labels in `src/shared/items.ts` (bounded, never rarity-scaled into
  absurdity); shows in the bag like any affix.
- **Reward + combat audio (procedurally synthesized)** — the silent dopamine channel now has sound,
  with **no audio assets** required: `src/client/sound.ts` synthesizes one-shot SFX via the Web Audio
  API (oscillator blips/chords/arpeggios) and maps them to FX events — a punchy hit, a ringing crit,
  a coin ka-ching on gold, a rising fanfare on level-up, a heavy boom on the Crypt Lord's slam, a
  death thud, and a whoosh for enemy shots. Ambient area loops (bundled files) are unchanged.
- **More enemy archetypes — chargers + AoE slam** — two new attack patterns built on the telegraph
  system. **Chargers** (new **Gloom Boar**, wilderness) close in, wind up, then **dash** through
  their target along a locked line, striking each player they pass (dodge by leaving the line). The
  **Crypt Lord** now does an **AoE slam** (`slamRadius`) that hits everyone nearby — telegraphed by a
  filling red danger circle — so it fights like a boss, not a big trash mob. New `behavior: charger`,
  `slamRadius`/`dashSpeed` template fields + a dash state machine in `src/server/world.ts`; DB
  columns + migration; client renders the slam danger circle, impact shock-ring, and lunge tell
  (`src/client/pixi-renderer.ts`).
- **Gear affixes (Diablo-style itemization)** — gear above Common now rolls bonus **affixes**
  (`+power`, `+hp`, `+crit%`) on top of its base stats — 1 for Magic up to 3 for Legendary, scaled
  by rarity, distinct stats per item (`rollAffixes`, `affixLabel` in `src/shared/items.ts`, tested).
  Equipping aggregates affixes into the player's power, max HP, and **crit chance** — so a `+crit%`
  drop literally raises how often you crit, on both melee and projectiles (wiring the crit-chance
  parameter left in `rollCrit`). Crit chance rides the `you` packet and shows in the Equipped panel
  (`+N pow · X% crit`); the bag lists each item's affixes; the vendor pays more for affixed gear; and
  affixes persist with the save. Forward step toward the "loot = your build" twist.
- **Enemy variety — ranged attackers + attack telegraphs** — monsters now have combat archetypes
  (`behavior: melee | ranged`) and a wind-up before every strike. **Ranged** mobs (new **Gloom
  Sprite** in the wilderness, **Hooded Cultist** in the crypt) kite to keep their distance and fire
  **hostile projectiles** (red, dodge by side-stepping the aimed line). **Telegraphs**: every attack
  has a per-template wind-up (`telegraphMs`) showing a red strike-wedge (melee) or aim-line (ranged)
  that builds as it nears — move out of it to dodge; the Crypt Lord's heavy slam is the most
  readable. Pure AI (`stepMob` ranged kiting, unit-tested) + a World telegraph state machine and
  hostile-projectile path (`src/server/world.ts`); new `mob_templates` columns
  (`behavior`/`telegraph_ms`/`projectile_speed`/`kite_range`) with a migration for existing DBs;
  client renders telegraphs and tints enemy projectiles (`src/client/pixi-renderer.ts`).
- **Character persistence (survives disconnect + restart)** — characters are now saved to SQLite,
  closing the #1 retention hole (state was RAM-only). New guests are issued an opaque token (stored
  in the browser as `bg.token`) and presented on reconnect; the server reloads the saved character
  via the existing `exportPlayer`/`importPlayer` plumbing. New `player_saves` table; store +
  token validation in `src/server/player-store.ts` (round-trip tested); the server persists on
  disconnect and on a 20s autosave for crash safety (`src/server/index.ts`). The `join` message
  carries the token and `welcome` returns it (`src/shared/protocol.ts`).
- **Phone playability — joystick drawn + tap-to-attack** — the on-screen move joystick is now
  actually rendered while dragging (its geometry was computed in `input.ts` but never drawn), and a
  quick stationary tap on the world casts the selected ability toward the tapped point, with
  tap-vs-drag detection so a move-drag never fires an attack (`src/client/main.ts`). The primary
  platform is now playable for combat without reaching for the tiny hotbar.
- **Reward feedback (the dopamine engine, turned on)** — loot, gold, and level-ups are no longer
  silent and effectless. New `FxEvent` kinds (`pickup`, `coin`, `levelup`) are emitted server-side on
  item pickup, gold gain / vendor sale, and level-up (`src/server/world.ts`) and rendered as a
  rarity-colored pickup sparkle, a rising `+N` gold number, and a gold burst + "Level N!" callout
  (`src/client/pixi-renderer.ts`). Also fixes the bug where **picking up loot and selling fired a
  spell-cast ring** — they now show coin/sparkle FX. (Reward *audio* still TODO — needs CC0 clips.)
- **RNG tier loot (rarity + rolled instances)** — slain monsters now drop **gear instances** with a
  rolled rarity (Common → Magic → Rare → Epic → Legendary) and stats rolled around the base item, so
  two "Iron Swords" are no longer interchangeable. Rarity drives drop weight, a stat multiplier +
  variance, and a glow color. The pure roller lives in `src/shared/items.ts` (`rollRarity`,
  `rollStat`, `rollItemInstance`, `gearSellValue`); the server rolls instances on drop, carries them
  through pickup → a per-player **gear bag** → equip-by-uid → equipped slots (rolled stats feed
  `power`/`maxHp`), the vendor, and save/load (`src/server/world.ts`). The wire carries instances on
  the `you` packet and drop rarity on the snapshot (`src/shared/protocol.ts`); the client shows a
  rarity-colored Gear panel (tap to equip), rarity-colored equipped slots, and rarity-tinted ground
  glints (`src/client/main.ts`, `pixi-renderer.ts`). Replaces the old fixed-stat `rollEquipDrop`.
- **Critical hits** — every attack now has a base 15% chance to critically strike for 2× damage
  (`rollCrit` / `applyCrit`, `src/server/combat-formulas.ts`). The authoritative server rolls the
  crit per hit and flags the `hit` FX event (`crit`); the client renders crit numbers larger, in a
  hot orange-red, with a trailing `!`, floating higher so they read as a bigger moment
  (`src/client/pixi-renderer.ts`). Crit chance is designed to become an item affix.
- **Scrollable chat log** — the chat panel is now scrollable by scrollbar and mouse wheel. The log
  is interactive for mouse devices and whenever the chat input is focused (touch still passes drags
  through to the movement joystick); while focused, the wheel scrolls the log even when the cursor
  is over the game; and new messages no longer yank you to the bottom if you've scrolled up to read
  history (`isPinnedToBottom`, `src/client/chat.ts`; wired in `src/client/main.ts` + `styles/main.css`).
- **Right-click reserved for the game** — the browser's native context menu (copy image, etc.) is
  suppressed everywhere except editable fields, freeing right-click for future game actions
  (`src/client/main.ts`).
- **Live editing for *everything*** — a generic, validated content editor turns the whole content
  DB into an in-game engine. New Developer commands `/tables`, `/cols <table>`, `/get <table> [id]`,
  and `/set <table> <id> <column> <value>` edit any whitelisted table/column (spells, items,
  monsters, quests, areas, spawns, NPCs, loot, themes) at runtime; on success the server reloads and
  re-broadcasts content, so changes apply live — numbers the sim reads per-tick (spell damage,
  monster speed/damage/aggro, item power, sell values, quest rewards) change immediately. The
  editable registry + validation/clamping live in `src/server/db/editable.ts` (`EDITABLE_TABLES`,
  `coerceColumn`), with the engine in `src/server/content-edit.ts`; table/column/pk names come only
  from the whitelist (safe in SQL) and values/ids are bound. `/settheme` is now a friendly alias
  over the same machinery. See `wiki/architecture/Commands-And-Access.md`.
- **Environment theming, deepened** — three more theme dimensions, all live-editable via
  `/settheme` and persisted in `area_theme`:
  - **Per-area color grading** — `grade_saturation` / `grade_brightness` / `grade_contrast` drive a
    single `ColorMatrixFilter` on the scene (one GPU pass), for cohesive area color moods.
  - **Weather affects gameplay** (server-authoritative, `src/server/weather-effects.ts`) — `snow`
    slows movement, `fog` shrinks monster aggro range, `rain` does a bit of both; applied in the
    sim and re-applied live when the weather theme changes.
  - **More scenery + per-area sprite tint** — new prop kinds (`bush`/`mushroom`/`crystal`/`pillar`)
    selectable by SQL, and a `sprite_tint` that recolors an area's actors cohesively.
- **Server robustness + DB migration** — a chat-command handler can no longer crash the server
  (errors become a `System` reply); and content databases created by an older build are
  auto-migrated on open (`src/server/db/migrate.ts`) so new theme columns are added to existing
  `game.db` files instead of erroring.
- **SQL-driven environment theming (live, from anywhere)** — every area's *look* now lives in the
  content DB (`area_theme` table) and is sent to the client in the `content` packet: ground colors,
  scattered props, mood tint, ambient particles, weather, and lighting. Editing it re-skins the
  world — and it's **live-editable at runtime**: `/settheme <area> <key> <value>` (Developer)
  validates + clamps the value (`src/shared/theme.ts`), upserts the DB column, and re-broadcasts to
  every connected client, which re-skins in place with no reconnect. `/reloadcontent` does the same
  after a direct `sqlite3` edit; `/theme` and `/themekeys` inspect the keys. Two new client visual
  modules consume the theme — **weather** (`src/client/weather.ts`: rain / snow / fog overlays) and
  **dynamic lighting** (`src/client/lighting.ts`: additive torch/portal glow that strengthens at
  night and in low-ambient areas). The renderer + atmosphere are now fully theme-driven. Design:
  `wiki/research/environment-theming.md`; docs: `wiki/architecture/Content-Database.md`,
  `Commands-And-Access.md`.
- **2.5D depth & atmosphere pass** — a batch of rendering work to strengthen the tilted top-down
  look (`src/client/atmosphere.ts`, `src/client/pixi-renderer.ts`, HUD in `main.ts`):
  - **Day/night cycle** — a slow sky wash (dawn→day→dusk→night) over outdoor areas, keyed to the
    wall clock so it's a shared world time across players (not reset per page load); crypts stay
    their own indoor gloom.
  - **Ambient particle field** — drifting per-biome motes (warm town pollen, flickering wilderness
    fireflies, falling crypt dust) for atmosphere and depth.
  - **Edge vignette** that frames the scene and draws the eye to the center.
  - **Screen-shake** kicked by death impacts, and an **area-change fade-from-black** paired with a
    brief **area title card** ("now entering") when you cross a portal.
  - **Idle/walk bob** on actor billboards (a footstep lift while moving, a slow breath while idle)
    and **elevated projectiles** that fly above the ground while casting a shadow on it — both
    reinforce the 2.5D read.
- **Quests wired into gameplay** — accept quests with `/accept <id>` (see `/quests`); kills of the
  target monster progress them, and completion grants gold + XP with a `System` notice. Quest defs
  live in the content DB (`quests` table). Per-player notice queue also drives level-up messages.
- **Client-side prediction + reconciliation** — the local player now simulates input immediately
  (`src/client/predictor.ts`) instead of being rendered ~100ms in the past, so your own movement
  feels instant. Inputs carry a sequence number; the server acks it with the authoritative position
  in `you`, and the client rebases + replays unacknowledged inputs (smoothing residual error,
  snapping on teleports). Movement math is shared (`src/shared/movement.ts`) so prediction matches
  the server exactly. Remote entities stay interpolated. (Design: `wiki/research/state-sync.md`.)
- **Accounts, access levels & chat commands** — slash-commands in chat gated by account access
  level (Player→Moderator→GameMaster→Admin→Developer). `accounts` table with scrypt-hashed
  passwords (`src/server/accounts.ts`); authenticate in-game with `/login`. A command registry
  (`src/server/commands.ts`) provides player commands (`/help /who /where /roll /me`) and
  GM/admin/dev commands (`/tp /heal /spawn /give /setlevel /addxp /godmode /killall /announce
  /setaccess`), all server-authoritative. Seeds a `dev` account (`DEV_PASSWORD`). See
  `wiki/architecture/Commands-And-Access.md`. Research: `wiki/research/{chat-and-commands,state-sync}.md`.
- **Client mirrors the content DB** — the server sends a `content` packet (areas, spells, items)
  on connect; the client (`src/client/content-store.ts`) drives the hotbar, portals/minimap, and
  item display from it instead of bundled constants. New spells/areas/items added via SQL now show
  up client-side with no code change.
- **SQLite content database** — game content (areas, spells, items, monsters, area spawns, loot
  tables, NPCs, quests) now lives in SQLite and is loaded at startup via parametrized queries
  (`src/server/db/`, `src/server/content.ts`). Seeded from the built-in content on first run; the
  simulation reads only from the DB, so editing `game.db` with SQL changes the game (add a monster,
  rebalance a spell, move an NPC). `GAME_DB` sets the path. See `wiki/architecture/Content-Database.md`.
- **Equipment & stats** — weapons (+attack power) and armor (+max HP) drop from monsters
  (`src/shared/equipment.ts`), shown as colored ground glints. Click an equippable bag item to
  equip it; the HUD shows an Equipped panel (weapon/armor/power). Weapon power adds to every hit;
  armor raises max HP. Server-authoritative equip/stat derivation.
- **One-command hosting (`npm run host`)** — builds + serves the game on one port and opens a free
  Cloudflare quick tunnel (`*.trycloudflare.com`), giving a public https URL to play from anywhere.
  `scripts/tunnel.mjs` + the `cloudflared` dev dependency; QUIC-blocked networks can set
  `TUNNEL_PROTOCOL=http2`.
- **Combat feedback & ambiance** — red hit-flash on damage, status tints (blue=slow, orange=burn),
  per-area atmospheric screen tint, and a respawn countdown on the death overlay.
- **New abilities** — Heal (self, hotbar 5) and Lightning (fast projectile, hotbar 6); the hotbar
  now holds 6 slots.
- **Crypt Lord boss** — a 400 HP, level-10 boss spawns in the Shadow Crypt (larger sprite).
- **Town vendor & economy** — a Merchant NPC in Aldermere; stand near and press **E** to sell loot
  for gold (`src/server/vendor.ts` pricing, built as a pure tested module by a sub-agent).
- **Minimap** — a RuneScape-style circular minimap (HUD overlay) showing the player centered, nearby
  monsters (red), players (blue), loot (gold), and the area's portals (gold markers), with a compass
  and edge-clamping for off-screen markers.
- **Sprite characters + sound** — wired the sourced CC0/CC-BY assets in: actors now render as
  **LPC sprite sheets** (hero, wolf, skeleton, bat) animated by `facing` with idle/walk frames and
  a procedural-orb fallback (`src/client/pixi-renderer.ts`), and a **sound manager**
  (`src/client/sound.ts`) plays spell-cast SFX off `fx` events and a per-area ambient loop.
- **Bundled game assets** (`public/assets/`) sourced by parallel web agents — terrain tiles,
  character/monster sprites, UI atlas + item icons + spell-FX strips, and audio; with a
  consolidated `public/assets/CREDITS.md` (CC0-first; CC-BY/CC-BY-SA attributions recorded).
- **PixiJS 2.5D renderer** — migrated the client from Canvas2D to **PixiJS v8 (WebGL)** with a
  tilted top-down (RuneScape-pitch) look: textured ground, depth-sorted billboarded actors with
  ground shadows, glowing portal pads, projectiles/items/FX, and a Canvas2D HUD overlay
  (`src/client/pixi-renderer.ts`). Verified via the headless screenshot harness.
- **Interest management, combat depth & richer loot** — research-driven P0/P1 adoptions, built as
  pure modules in parallel by sub-agents and integrated:
  - **Interest management** (`src/server/spatial.ts`) — a spatial hash grid; each player now
    receives only entities near them (per-player snapshots) instead of the whole instance.
  - **Combat hit/miss + damage rolls** (`src/server/combat-formulas.ts`) — OSRS-inspired accuracy
    (attacker level vs monster level) and damage variance on every ability hit; misses show 0.
  - **Weighted + rare drop tables** (`src/server/drop-table.ts`) — loot rebuilt on a generic engine
    with a guaranteed drop, a weighted main roll, and a nested rare sub-table (rune shards).
- **Progression, loot & status effects** — built in parallel by sub-agents as pure, tested modules
  (`src/server/progression.ts`, `loot.ts`, `status-effects.ts`) and integrated into the world:
  XP/leveling with HP scaling, monster loot tables → ground items with auto-pickup (gold in HUD),
  and Frostbolt slow / Fireball burn. Adds an XP bar, level, and gold to the HUD.
- **Parallel-agent workflow** ported from DuetOS (`CLAUDE_PARALLEL.md`, `tools/parallel/*`,
  `PARALLEL_WORK.md`) — coordinator file, claim/release/status scripts, and conflict detection.
- **Game world, characters & combat** — tiled biome rendering with deterministic props
  (`src/client/draw.ts`), top-down characters with facing/health/level, projectile + melee
  effects, and a Diablo-style HP/MP + ability hotbar HUD.
- **Abilities** (`src/shared/combat.ts`) — Slash (melee), Fireball, Arrow, Frostbolt; cast with
  1–4 / click (desktop) or hotbar tap aimed at the nearest monster (touch). Server-authoritative
  validation of cooldown/mana/range; projectiles simulated server-side.
- **Monsters** (`src/server/mobs.ts`) — roaming, respawning Gloom Wolves / Crypt Skeletons /
  Cave Bats with aggro → chase → melee AI (pure, unit-tested). Town is a safe zone.
- **Death & respawn**, HP/mana with regen, and per-player `you` stats + per-tick `fx` effects.
- **Open world, instanced** — areas (`src/shared/areas.ts`: town / wilderness / crypt) each served
  by one or more instances. The server packs players up to an area's cap and spins up new instances
  on demand (`src/server/instance-manager.ts`), or collapses to one instance per area with
  `INSTANCING=single` for testing. Server-authoritative **portal** transfers move players between
  areas (preserving identity); snapshots and chat are scoped per instance.
- **Client snapshot interpolation** (`src/client/interp.ts`) — smooth movement between 20Hz ticks
  by rendering a short delay in the past and lerping between bracketing snapshots.
- **Touch controls** — a drag-anywhere virtual joystick (`src/client/input.ts`) merged with
  keyboard input, for real phone play.
- **In-game chat** — first gameplay system: shared `chat` protocol messages, server-side
  sanitization (`src/server/chat.ts`), and a chat panel UI.
- **Server hardening** — per-connection token-bucket rate limiting (`src/server/rate-limit.ts`)
  for messages and chat, plus a WebSocket `maxPayload` cap.
- Initial TypeScript foundation: server-authoritative simulation (`src/server`), browser client
  (`src/client`), and a shared wire protocol (`src/shared`).
- Working multiplayer vertical slice: join, move (WASD/arrows), and see other players move in
  real time over WebSocket.
- Token-gated privileged "in-game engine" command surface (scaffold for live editing).
- Tooling and standards: strict TypeScript, ESLint, Prettier, EditorConfig, Vitest.
- Automation: GitHub Actions CI (typecheck/lint/format/test/build), CodeQL, Dependabot.
- Documentation: expanded `CLAUDE.md`, `AGENTS.md`, a structured `wiki/`, and project meta docs.
- Claude Code `SessionStart` hook so web/phone sessions arrive ready to lint and test.
