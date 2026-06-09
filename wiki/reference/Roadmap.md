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
- [ ] Smooth the visual on area change (brief fade) and add a minimap of the current area.
- [ ] Cross-process area servers — host instances in separate workers/processes behind a gateway.

## Combat & world (built)

- [x] World rendering — tiled biomes + deterministic props per area.
- [x] Player & monster rendering — top-down characters, facing, health bars, levels.
- [x] Abilities & weapon/spell rendering — melee + fireball/arrow/frost projectiles + effects.
- [x] Monsters with aggro/chase/melee AI, death + respawn; Diablo-style HUD.
- [x] XP / leveling (HP scaling) and loot drops + pickup on kill (built via parallel sub-agents).
- [x] Status effects — Frostbolt slow, Fireball burn.
- [ ] Inventory UI for non-gold loot (already accumulates server-side).
- [ ] More abilities, level-up effects, monster status visuals.
- [ ] Replace primitive shapes with sprite art (renderer isolated in `src/client/draw.ts`).

## Research-driven adoptions (from `wiki/research/`)

Web research surveyed open-source RuneScape clients/servers, browser-MMO netcode, and web
renderers. Prioritized, codebase-mapped takeaways (full detail + sources in the research docs):

**P0 — high value, incremental, no rewrite**

- [ ] **Interest management (AoI)** in `src/server/world.ts` `snapshot()` — spatial-hash grid
      (~256px cells); send each player only nearby entities. Biggest bandwidth/CPU win.
      (netcode research)
- [ ] **Integer gameplay-tick counter** for ability/attack speeds in `world.ts`/`mobs.ts`
      (replace float `attackCd -= dt*1000` drift), RuneScape-style. (runescape research)
- [ ] **PixiJS v8 renderer** (MIT, WebGL/WebGPU) behind a `Renderer` interface, migrating
      `src/client/draw.ts` layer-by-layer with Canvas2D as fallback. (rendering research)

**P1 — depth & fidelity**

- [ ] OSRS-style **two-roll combat** (accuracy vs defence + max-hit formula) — ~15 lines, our
      injected-RNG style; more depth than flat `damage`. (runescape research)
- [ ] **Delta snapshots** (send immutable fields once, changed fields per tick). (netcode research)
- [ ] **Client-side prediction + reconciliation** for the local player (input `seq`/`ackSeq`) to
      kill ~150ms self-input lag; keep `interp.ts` for remote entities. (netcode research)
- [ ] **Tiled maps** (`.tmj` via `@pixi/tilemap`) to replace hash-based biomes; directional
      sprites driven by `facing` + FxEvents. (rendering research)
- [ ] **Drop tables**: weighted main roll + nested rare sub-table for clean ultra-rares; aggro
      from spawn anchor + level gating in `mobs.ts`. (runescape research)

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
