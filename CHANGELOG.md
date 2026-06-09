# Changelog

All notable changes to this project are documented here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/), and the project aims to follow semantic
versioning once it stabilizes.

## [Unreleased]

### Added

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
