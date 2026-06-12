# Roadmap

> Pending and deferred work. Keep this current — agents and contributors read it first.

## Now (foundation — done)

- [x] TypeScript project, strict config, ESM.
- [x] Server-authoritative simulation + fixed-tick loop.
- [x] WebSocket transport; join / input / snapshot.
- [x] Canvas client with camera, grid, multiplayer rendering.
- [x] Token-gated admin command scaffold.
- [x] Standards (ESLint/Prettier/EditorConfig), tests (Vitest).
- [x] CI, CodeQL, Dependabot, SessionStart hook.
- [x] Docs: CLAUDE.md, wiki, project meta.

## Next (small, high-value)

- [x] **World structure decided & built** — open world, instanced per area with cap-based scaling,
      portals, and an `INSTANCING=single` testing mode. See `architecture/Areas-And-Instances.md`.
- [x] Snapshot interpolation on the client (smooth movement between ticks).
- [x] Touch controls (virtual joystick) for true phone play.
- [x] Message rate limiting + payload size caps (see Threat Model "known gaps").
- [x] Smooth the visual on area change (brief fade-from-black + area title card) and a minimap.
- [ ] Cross-process area servers — host instances in separate workers/processes behind a gateway.

## Combat & world (built)

- [x] World rendering — tiled biomes + deterministic props per area.
- [x] Player & monster rendering — top-down characters, facing, health bars, levels.
- [x] Abilities & weapon/spell rendering — melee + fireball/arrow/frost projectiles + effects.
- [x] Monsters with aggro/chase/melee AI, death + respawn; Diablo-style HUD.
- [x] XP / leveling (HP scaling) and loot drops + pickup on kill (built via parallel sub-agents).
- [x] Status effects — Frostbolt slow, Fireball burn.
- [x] **Sprite art + audio** — LPC character/monster sprites with facing-driven animation, plus a
      sound manager (cast SFX + per-area ambient). Assets bundled in `public/assets/` (CC0-first).
- [x] Use the remaining sourced art — superseded by the **curated-pack integration** below;
      spell-FX strips and coin/gem item sprites were wired earlier.
- [x] Spell-FX sprites (fireball/frost strips + explosion on death) and item-icon sprites
      (coin/gem) wired into the renderer with procedural fallbacks.
- [x] Inventory panel — non-gold loot now sent in the `you` message and shown in a HUD "Bag".
- [x] Minimap — circular HUD minimap with player/mobs/players/loot/portals + compass.
- [x] Combat feedback (hit-flash, status tints), per-area atmosphere tint, respawn countdown.
- [x] **2.5D depth & atmosphere pass** (`src/client/atmosphere.ts` + renderer) — a shared-clock
      day/night cycle, a per-biome drifting ambient-particle field (pollen / fireflies / crypt
      dust), an edge vignette, screen-shake on death impacts, an area-change fade-from-black with
      a title card, idle/walk bob on actors, and elevated projectiles that cast ground shadows.
- [x] **SQL-driven, live-editable environment themes** — each area's look (ground, props, mood
      tint, particles, weather, lighting) lives in the `area_theme` DB table, flows through the
      `content` packet, and is hot-edited via `/settheme` (re-skins every client, no reconnect) or
      a direct SQL edit + `/reloadcontent`. New client modules: `weather.ts` (rain/snow/fog) and
      `lighting.ts` (additive torch/portal glow). Design: `wiki/research/environment-theming.md`.
- [x] **Theming, deepened** — per-area color grading (one `ColorMatrixFilter`), weather that
      **affects gameplay** (server-authoritative move/aggro modifiers, `weather-effects.ts`), extra
      prop kinds (`bush`/`mushroom`/`crystal`/`pillar`) and a per-area `sprite_tint`. Plus content-DB
      auto-migration (`db/migrate.ts`) and crash-proof command handling.
- [x] **Live editing for everything** — a generic content editor (`/tables` `/cols` `/get` `/set`)
      over a whitelisted registry (`db/editable.ts`, `content-edit.ts`) edits any content table
      (spells/items/monsters/quests/areas/spawns/npcs/loot/themes) at runtime; edits validate +
      clamp server-side, then reload + re-broadcast so they apply live. `/settheme` is an alias.
- [x] Abilities: Heal + Lightning (6-slot hotbar); Crypt Lord boss in the crypt.
- [x] Town vendor (Merchant NPC) — press E to sell loot for gold (`vendor.ts`, sub-agent module).
- [x] Equipment & stats — weapon (+power) / armor (+max HP) drops, click-to-equip, HUD panel.
- [x] Accounts + access levels + chat commands (player/GM/admin/dev); `/login` auth.
- [x] Client-side prediction + reconciliation (instant local movement; `predictor.ts`).
- [ ] **Delta snapshots** (per-client field diffs; design in `wiki/research/state-sync.md`).
- [x] Quests wired into gameplay (/accept, kill-tracking, rewards + notices); area-transfer
      persistence fix (character keeps progression across portals).
- [ ] More chat channels (global/party/guild/whisper) + moderation (/mute /kick /ignore).
- [x] **Spells are loot (spellbook system)** — abilities acquired from drops/quests/vendor as tomes;
      duplicate-reads rank a spell up; casting gated server-side on learned spells; starter loadout
      Slash+Fireball; legacy saves grandfathered. Design: `wiki/research/spell-acquisition-design.md`.
- [x] **Shop to *buy* gear** — vendors open a buy/sell shop (E); `vendor_stock` table; common-rolled
      vendor gear; explicit sell. (Gear rarity/affixes already shipped.)
- [x] **3 new areas** — Rotfen Marsh (L8–12), Emberdeep Mines (L12–16), Frostpeak Pass (L15–20):
      13 new mobs, steel+mithril gear tiers, themes, drop tables, bosses, quest-givers. World graph
      now 6 areas (spine + marsh spur). Integrity-tested (`world-graph.test.ts`).
- [x] **Bot stress harness** (`tools/bots/`) — headless FSM bots, stress runner with metrics +
      thresholds, protocol-fuzzing chaos client. `npm run stress` / `npm run chaos`.
- [ ] **Deferred from the ARPG research** (`wiki/research/arpg-design-research.md`): collect/turn-in
      & named-elite quest *types*; gambler / healer / crafter (Artificer) NPCs + gold sinks;
      area-scoped quest offers; hard portal gates (boss-kill / quest-key); waypoints; biome hazard
      gimmicks (poison pools, lava cracks, death-explosions); vendor stock rotation + sealed-tome gamble.
- [x] **Parties** — host-level grouping (invite/accept/leave, leader promotion), shared XP + quest
      credit for co-members in the same instance, roster UI (P). `party.ts` + tests.
- [x] **Friends + whispers** — persistent friends list with live presence, social panel (F),
      `/friend` `/unfriend` `/w`, chat channels (say/party/whisper/system). `social.ts` + tests.
- [x] **Quest log UI** (L) — available/active/completed with progress bars + accept buttons.
- [x] **Gems + sockets** — gem drops, sockets rolled on gear, tap-to-socket, stat folding,
      socket pips in the character panel. `shared/gems.ts` + tests.
- [x] **Healer + Gambler NPCs** — Sister Oona (free full restore) and Lucky Marn (slot-targeted
      gold gamble, cost 50+30×level). `shared/gamble.ts` + tests.
- [x] **Collect/turn-in quest type** — turn N items in to a quest-giver; live held/needed progress
      in the quest log. (*Warm Hides*, *Old Bones*.) `quests.turn_in_item`/`turn_in_count`.
- [x] **Waypoints** — discovered-area fast-travel (press M); discovery persists, `teleport` carries
      full state. `InstanceManager.teleport`.
- [x] **Hirelings** — Guard/Marksman mercenaries from the town Recruiter (Captain Aldric);
      follow + fight + owner kill credit; level-scaled fee; contract voids on death.
      `server/hirelings.ts` + `world-hirelings.test.ts`.
- [ ] **Enchanting NPC (Artificer)** — reroll/add affixes for gold + materials; gem unsocketing.
- [ ] **Explore/discover quest type**; chain quests.
- [ ] Banking; guilds/trade.
- [ ] Hand-authored Tiled maps; LPC equipment layers on the hero.
- [ ] Composite LPC clothing/equipment layers for a richer hero; re-source CC0 combat SFX.
- [ ] Tilemap ground from hand-authored Tiled maps (the bundled tiles suit authored maps better
      than a single-tile fill; procedural ground kept for now).
- [ ] More abilities, level-up effects, monster status visuals.
- [x] **Renderer 3D-feel + animation pass** (`wiki/research/renderer-3d-feel-and-animation.md`):
      soft directional shadows; a real sprite **animation system** (idle/walk/attack/cast/hurt/death,
      `animation-controller.ts`, driven by FxEvents); camera dolly + faux-perspective depth scale;
      atmospheric edge-fog; quality-gated bloom (`post-fx.ts`); real gold/gem loot icons. Verified via
      the screenshot harness (also fixed a Windows static-serve bug + a Pixi-v8 filters-null crash).
- [x] **Curated-pack asset integration** — 13 extracted packs (`public/assets/INVENTORY.md`) wired
      in: per-biome tiled ground (`ground-tiles.ts`), a 32rogues sprite for **every** mob template +
      distinct NPC figures (`rogues-sprites.ts`), 16 decor-sprite kinds with variants
      (`decor-sprites.ts`), and real HUD item icons (`item-icons.ts`). Curated sprites committed
      under `public/assets/curated/`; attribution in `public/assets/CREDITS.md`.
- [ ] **Renderer — remaining asset upgrade**: a Tiled `.tmj` hand-authored ground via
      `@pixi/tilemap`, composite LPC equipment layers — needs the asset pipeline (Free Texture
      Packer) + human CC-BY attribution review.

## Research-driven adoptions (from `wiki/research/`)

Web research surveyed open-source RuneScape clients/servers, browser-MMO netcode, and web
renderers. Prioritized, codebase-mapped takeaways (full detail + sources in the research docs):

**P0 — high value, incremental, no rewrite**

- [x] **Interest management (AoI)** — spatial-hash grid (`src/server/spatial.ts`); the host sends
      each player only nearby entities (per-player snapshots in `index.ts`). (netcode research)
- [~] **Integer gameplay-tick** — intentionally deferred: per the RuneScape research we keep
      real-time cadence (we're an action game; float drift is negligible at our tick rate).
      Revisit only if we add turn-based RuneScape-style skills. (runescape research)
- [x] **PixiJS v8 renderer** — migrated to a tilted top-down 2.5D look (textured ground,
      depth-sorted billboards + shadows, portal pads, FX); HUD is a Canvas2D overlay
      (`src/client/pixi-renderer.ts`). Verified via the screenshot harness. (rendering research)

**P1 — depth & fidelity**

- [x] OSRS-style **hit/miss + damage rolls** (`src/server/combat-formulas.ts`) applied to every
      ability hit — accuracy vs monster level + damage variance. (runescape research)
- [x] **Drop tables** — weighted main roll + nested rare sub-table (`src/server/drop-table.ts`),
      loot rebuilt on it. Aggro-from-anchor + level gating still TODO in `mobs.ts`. (runescape)
- [ ] **Delta snapshots** (send immutable fields once, changed fields per tick). (netcode research)
- [ ] **Client-side prediction + reconciliation** for the local player (input `seq`/`ackSeq`) to
      kill ~150ms self-input lag; keep `interp.ts` for remote entities. (netcode research)
- [ ] **Tiled maps** (`.tmj` via `@pixi/tilemap`) to replace hash-based biomes; directional
      sprites driven by `facing` + FxEvents. (rendering research)

**P2 — deferred, metrics-gated**

- [ ] Binary wire format (MessagePack, then bit-packing/quantization) once bandwidth is the
      bottleneck — single swap point at `encode`/`decode` in `protocol.ts`. (netcode research)
- [ ] OSRS exponential XP curve via precomputed table (only if we want a long endgame chase).
- [ ] Cross-process area servers: gateway + shared presence (worker_threads → Redis). (netcode)

**Assets** — CC0 first (Kenney, OpenGameArt, DCSS) for terrain/props/monsters/UI; LPC
(CC-BY-SA 3.0) for characters with attribution + an `ASSETS/CREDITS.md` manifest. Never ship
Jagex IP. (rendering research)

## Later (systems — reimplement from the SparkGameMMO blueprint)

- [ ] Inventory + loot tables (server-authoritative).
- [x] Chat — basic global channel (sanitized + rate-limited). Next: area/party/whisper channels.
- [ ] Party / grouping.
- [ ] Character persistence (pick a store).
- [ ] Privileged engine mode: command registry + operator auth + UI panel.

## Reference material

- SparkEngine gameplay blueprint and netcode architecture.
- DuetOS security/isolation posture and React desktop-UI prototype (privileged panel base).

See [Influences](Influences.md) for specifics.
