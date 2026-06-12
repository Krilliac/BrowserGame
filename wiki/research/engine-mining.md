# Engine mining — wasmbots, stage.js, Excalibur, hex-engine

> Four open-source engines/games were deep-read (shallow clones, 2026-06-12) by parallel research
> agents hunting for **patterns to vendor** — never engines to adopt. Verdicts below are
> codebase-mapped: WHAT to take, WHERE it lands in our tree, effort (S/M/L), priority. The
> unified adoption queue is at the bottom. Skeptical "not worth it" lists are kept — knowing why
> we passed is as valuable as knowing what we took.

Sources: [sjml/wasmbots](https://github.com/sjml/wasmbots) ·
[piqnt/stage.js](https://github.com/piqnt/stage.js) ·
[excaliburjs/Excalibur](https://github.com/excaliburjs/Excalibur) ·
[suchipi/hex-engine](https://github.com/suchipi/hex-engine)

---

## wasmbots — sandboxed scripting, determinism, protocol discipline

A WASM bot arena: every competitor is a sandboxed `.wasm` module run in a Web Worker with time
budgets, talking to the host through one shared memory block, with messages generated from a
TOML schema (Beschi).

| Take | Lands in | Effort | Pri |
|---|---|---|---|
| **Seeded, injectable RNG** through the World (their `game/random.ts`): seed every instance, stamp the seed into dungeon/rift instances → reproducible layouts, deterministic test repros, daily-seed events. ~46 `Math.random()` sites in world.ts to sweep. | `src/shared/math.ts` (mulberry32) + `world.ts` | S–M | **P0** |
| **InputVerdict taxonomy** — Succeeded / Failed / Invalid / Error on every client input (their `lastMoveResult`), with Invalid/Error counted per connection feeding an escalating strike system (their `wasm-coordinator.ts` warn→strike→kill). Anti-cheat telemetry + chaos-bot assertions for free. | `world.ts` handlers, `rate-limit.ts`, `tools/bots/` | S | **P0** |
| **Protocol version handshake** — `PROTOCOL_VERSION` first thing in `join`/`welcome`; stale cached phone bundles get a crisp "refresh" instead of decode garbage. | `shared/protocol.ts`, `index.ts`, `net.ts` | S | **P0** |
| **Hireling brain contract (Phase 0)** — refactor hireling AI behind a tick contract: circumstances in → ONE intent out (their `PresentCircumstances`/tick shape). No new tech; positions the epic below and makes the AI trainer-testable. | `server/hirelings.ts` | S | P1 |
| **Player-scripted hirelings (Phase 1, EPIC)** — WASM (or restricted-JS) brains in Node `worker_threads`, validate-before-instantiate (`WebAssembly.Module.exports()` static inspection), 3-strike tick budgets, capability-minimal host API. "Program your companion" is a signature-twist-grade feature that IS our intent-only pillar applied to scripts. Their `guest.ts` memory protocol (re-fetch buffer views after every tick — guest memory may grow) ports almost verbatim. | new `server/scripting/` | L | epic |
| **Bot record/replay transport** — extract a transport interface from `BotClient`, record server traffic to JSONL during stress runs, replay into `BotBrain` in vitest (their trainer-mode pattern: same brain, swappable transport). | `tools/bots/` | M | P1 |
| **ASCII dungeon debug slice + seed provenance** — `asciiMap()` for world-dungeon test failures; stamp `generationSeed`/options into instance records (pairs with seeded RNG). | dungeon gen + tests | S | P1 |
| **Seed-rooms generator** — caller-fixed rooms (entry/boss/vault) injected before procedural fill, everything connected by the normal pass. For when dungeon gen gets fancier. | future `server/dungeon-gen.ts` | M | P2 |

**Passed on:** Beschi codegen for protocol.ts (we share one TS source — codegen solves a
multi-language problem we don't have *until* script guests exist); their turn engine (we're
real-time); Tiled as runtime map format (SQLite stays the source of truth); WASM-validator-as-WASM
(Node static inspection covers 90%); DOM `EventTarget` in the sim.

**Incidental flag:** the known oversized-frame DoS in `index.ts` (no per-socket `'error'` handler
with `maxPayload`) must be fixed before any upload/scripting feature multiplies exposure.

## stage.js — phone-battery rendering + UI micro-patterns

A ~5k-line Canvas2D scene-graph micro-engine whose loop **sleeps when nothing changed**.

| Take | Lands in | Effort | Pri |
|---|---|---|---|
| **HUD dirty-flag / sleep-when-idle** (their monotonic touch-stamps, `root.ts` + `component.ts:touch()`): bump a `hudVersion` on every HUD-feeding mutation; skip `drawHud()` when unchanged and no animated bits active. Our full-screen Canvas2D text redraw every frame is the single biggest battery cost on phones — a project pillar. | `client/main.ts` | M | **P0** |
| **pointercancel/blur reset** — OS gesture swipes fire `pointercancel`, not `pointerup`; we leak stale tap state (ghost-walking). ~10 lines. | `client/main.ts` | S | P1 |
| **Easing micro-module** — their `easing.ts` combinator trick (`out(f)`/`inOut(f)` generate every variant from base curves). ~50 lines; juices existing t0-based FX fades (back-out loot pops, cubic-out fades). Do NOT port their tween queue (competes with animation-controller.ts). | new `client/easing.ts` | S | P1 |
| **`anchorRect` helper** — align/handle/offset placement math collapsed to one function for HUD panels; migrate opportunistically. | HUD utils | S | P2 |
| **Sprite-manifest convergence** — one `SpriteRef` shape (rect / cells / cell map, their atlas convention) unifying rogues-sprites/decor-sprites/ground-tiles texture coords. Opportunistic; prefer Pixi's Spritesheet JSON if we ever pack a real atlas. | `client/sprite-manifest.ts` | M | P2 |

**Passed on:** the scene graph (Pixi's job); viewport fit modes; Monotype glyph text (Pixi
`BitmapText` is the native equivalent); their image loader (ours is already per-asset resilient).

## Excalibur — combat-feel collision wins

A full TS 2D engine; everything good that we lack is < 300 vendorable lines.

| Take | Lands in | Effort | Pri |
|---|---|---|---|
| **Mob-vs-mob separation** — circle-circle half-MTV push (their `arcade-solver.ts` `mtv.scale(0.5)`): one pass per tick over spatial-grid neighbors un-stacks the mob blob. Server-only, zero rubber-band risk. The biggest feel-improvement per line in all four reports. | `shared/collision.ts` + `world.tickMobs` | S | **P0** |
| **Mob wall-slide + projectile wall-stop** — route mob movement/wander through our existing `resolveCircleMove` (mobs currently clip through house walls!), and delete projectiles on wall hit (casters currently shoot through houses). No vendoring — wiring our own primitive. | `world.ts` | S | **P0** |
| **Door-waypoint steering** — if the mob→target segment crosses a wall rect, steer to the door-gap center first (~30 lines in step context). Defer real A* until Tiled maps make geometry concave — and write it fresh: their `math/graph.ts` "A*" is actually greedy best-first (gScore never relaxed). | `server/mobs.ts` | M | P1 |
| **Camera deadzone + bounds clamp** — only those two of their four strategies earn keep: deadzone kills combat camera-swim; clamp stops small rift/den instances showing void. ~10 lines each in the existing camera block. Their shake is *worse* than ours — keep ours. | `client/pixi-renderer.ts` | S | P1 |
| **Loader progress + audio unlock** — "loading n/m" in the existing #status element; first tap explicitly resumes the audio context. | `main.ts`, `sound.ts` | S | P2 |
| **Action queue for scripted boss phases** — 100-line FIFO of `{update,isComplete}` actions overriding stepMob intent while non-empty ("move to center → delay → slam → summon → repeat"). **Gated: build it WITH the first scripted boss** (Nyxathor or Athraxis), per the anti-bloat rules. | new `server/script-queue.ts` | M | gated |
| **Greedy tile-collider meshing** — merge solid-tile runs into few big rects for the wall resolver. **Gated on Tiled maps.** | `shared/` | M | gated |

**Passed on:** ECS (deliberate non-goal); their broken A*; rigid-body physics; DynamicTree
broadphase (our rebuilt-per-tick grid is fine at our scale); GPU particles; coroutines; Timer/
StateMachine classes; per-tile map rendering (our baked TilingSprite is cheaper); engine swap.

## hex-engine — developer tooling

A hooks-style component engine; we mine its *features*, never its paradigm.

| Take | Lands in | Effort | Pri |
|---|---|---|---|
| **Dev inspector overlay** — live reflective entity tree (inline-editable values, img previews, "store as window.tempN" escape hatch), pause/"freeze view"/step, hover-a-row → outline-in-world, click-in-world → select-in-tree. Dev-only via dynamic `import()` + `import.meta.env.DEV` (their prod stub-alias trick). Directly serves the inherited "in-game engine console" goal; keep it read-only and client-side — server inspection stays on the token-gated admin channel. | new `client/inspector.ts` | M | **P0** |
| **Hit-region registry** — panels register `(rect, handler, z)` as they draw; pointerdown becomes one topmost-first lookup instead of main.ts's 15-branch if-chain. Plus **down+up-inside click semantics** (fixes drag-misclicks, enables pressed states on touch). Migrate panels incrementally. | new `client/hit-regions.ts` | S–M | P1 |
| **Tiled estimate revised DOWN** — their ~400-line integration proves a useful subset (ground layers + typed objects, one tileset) is weekend-sized. Do it as a **build-time importer to SQLite** (`tools/import-tiled.ts`, `.tmj` JSON only, `@kayahr/tiled` validation), keeping one source of truth. Bonus: our packs already ship 4 artist-authored `.tmx` maps as free fixtures. | `tools/` | S–M | P1 |
| **Animation micro-ideas** — `onFrame` callbacks (key footstep/impact SFX to frames, not timers) + `currentFrameCompletion` (0..1 within frame). ~15 lines each in our controller. | `client/animation-controller.ts` | S | P2 |
| **Golden-image renderer tests** — one Playwright test: deterministic scene (fixed seed + clock), screenshot, tolerance compare; hide dev overlays before capture. Formalizes our ad-hoc harness. | `tools/`/CI | M | P2 |
| **Error → freeze-view overlay (dev)** — on trapped client error, freeze the render loop and paint the error big, instead of only logging. Pairs with the inspector. | `client/error-trap.ts` | S | P2 |

**Passed on:** the hooks paradigm (implicit call-order context — a parallel ECS by stealth);
.ase native parsing (we own ZERO .aseprite files — verified; their runtime rasterizes cels with
per-pixel fillRect anyway); their Vector/Matrix lib (a third math library); matter.js physics;
Ogmo/BMFont/ProceduralSfx; the unmaintained test-it runner.

---

## Unified adoption queue

**P0 — next combat/feel slice (all S except the inspector + HUD flag):**
1. Mob separation + mob wall-slide + projectile wall-stop (one PR — Excalibur)
2. Seeded RNG through the world + seed provenance on instances (wasmbots/Excalibur)
3. InputVerdict + strikes; protocol version handshake (wasmbots)
4. HUD dirty-flag rendering (stage.js)
5. Dev inspector overlay (hex-engine)
6. Fix the oversized-frame DoS before any scripting/upload work (our own backlog, re-flagged)

**P1:** pointercancel/blur reset · easing.ts · door-waypoint steering · camera deadzone+clamp ·
hireling brain contract (Phase 0) · hit-region registry · bot record/replay · ASCII dungeon
slices · Tiled build-time importer.

**P2 / gated:** action-queue (with the first scripted boss) · tile-collider meshing (with Tiled)
· anchorRect + sprite-manifest convergence (opportunistic) · golden-image tests · loader
progress/audio unlock · animation onFrame hooks · seed-rooms dungeon gen.

**Epic:** WASM player-scripted hirelings — the standout long-term find; the full sandbox model
(validate-before-instantiate, worker isolation, tick budgets + strikes, capability-minimal API)
is proven in wasmbots and aligns exactly with our security-first, intent-only pillars.
