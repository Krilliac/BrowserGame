# Changelog

All notable changes to this project are documented here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow semantic
versioning once it stabilizes.

## [Unreleased]

### Fixed

- **Character no longer resets when crossing a portal** — area transfers now carry the player's full
  persistent state (level, XP, HP/mana, gold, loot, equipment, quests) between instances
  (`World.exportPlayer`/`importPlayer`); previously crossing a portal wiped progression.

### Added

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
