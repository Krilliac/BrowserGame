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
- [x] **Sprite art + audio** — LPC character/monster sprites with facing-driven animation, plus a
      sound manager (cast SFX + per-area ambient). Assets bundled in `public/assets/` (CC0-first).
- [ ] Use the remaining sourced art: **tilemap ground** from the Kenney/OGA tiles, **item-icon
      sprites** (coins/gems) and **spell-FX sprite strips** (fireball/arrow/frost/explosion) to
      replace the procedural projectile/item/FX graphics.
- [x] Spell-FX sprites (fireball/frost strips + explosion on death) and item-icon sprites
      (coin/gem) wired into the renderer with procedural fallbacks.
- [x] Inventory panel — non-gold loot now sent in the `you` message and shown in a HUD "Bag".
- [x] Minimap — circular HUD minimap with player/mobs/players/loot/portals + compass.
- [ ] Composite LPC clothing/equipment layers for a richer hero; re-source CC0 combat SFX.
- [ ] Tilemap ground from hand-authored Tiled maps (the bundled tiles suit authored maps better
      than a single-tile fill; procedural ground kept for now).
- [ ] More abilities, level-up effects, monster status visuals.

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
