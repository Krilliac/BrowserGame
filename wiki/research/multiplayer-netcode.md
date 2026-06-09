# Multiplayer Netcode & Server Tech Research

> Survey of open-source browser/Node multiplayer frameworks and netcode patterns, mapped to
> BrowserGame's hand-rolled `ws` + JSON, server-authoritative, instanced top-down MMO — with
> concrete, prioritized adoptions. Compiled 2026-06; web sources cited at the bottom.

## TL;DR

BrowserGame's architecture (server-authoritative, intent-in/state-out, per-instance JSON
snapshots, client-side snapshot interpolation) is *already* the correct shape and matches what
every framework here implements. **Do not rip it out for Colyseus/geckos.io** — that would trade
our simplicity + phone-friendliness pillars for features we don't yet need. Instead, adopt the
specific *patterns* those projects prove out, in this order: (1) **interest management / area-of-
interest culling** in `world.snapshot()`, (2) **delta/diff snapshots** instead of full-state
broadcasts, (3) **binary wire format** (MessagePack first, bit-packing later) once bandwidth — not
CPU — is the bottleneck, and (4) **client-side prediction + reconciliation** for the local player.
Cross-process area servers map cleanly to Colyseus's Redis presence/proxy model.

---

## 1. Authoritative server frameworks for Node/TS

All four below are server-authoritative (client sends intent, server owns state) — same pillar as
ours. The question is never "are they good" but "do they earn replacing our ~110-line `index.ts` +
`protocol.ts`?"

### Colyseus
- **What it does:** Full framework — *rooms* (a room = one running game/area instance, exactly our
  `Instance`), schema-based **state sync with automatic binary delta encoding**, matchmaking,
  presence, lobby/relay rooms, and a Redis-backed multi-process scaling story.
- **State model:** You declare state as decorated `Schema` classes; Colyseus tracks property-level
  changes via a `ChangeTree` and sends only the latest mutation of each changed property each
  `patchRate`, binary-encoded. Handshake sends type defs + full state on join, deltas after. Caps:
  max 64 fields per Schema (nest for more), field order must match both sides.
- **Interest management:** Has `StateView` / `@filter` to control which parts of state each client
  sees (the building block for AoI), though it's a manual opt-in, not automatic spatial culling.
- **Scaling:** `RedisPresence` (pub/sub + shared store via ioredis) + `RedisDriver` for room
  metadata; run N processes on ports 2567+, a **dynamic proxy** routes clients to the process
  hosting their room; a load balancer sits in front. This is *precisely* our "areas get their own
  server process behind a gateway" roadmap item.
- **License:** **MIT** ("even for commercial games"). Transport: WebSocket (uWebSockets option).
- **Verdict for us:** Closest conceptual match — our `InstanceManager`/`Instance`/portal model is
  a hand-rolled Colyseus-lite. **Worth adopting as a reference design, not a dependency** (yet).
  Migrating means rewriting the wire contract, the simulation host, and the client net layer, and
  inheriting `@colyseus/schema` decorators (conflicts with our "one plain `src/shared` protocol"
  rule and strict TS). Revisit only if we want matchmaking + multi-process scaling *for free* and
  are willing to restructure. Steal its **ChangeTree delta** and **StateView filter** ideas now.

### geckos.io
- **What it does:** Real-time client/server over **UDP via WebRTC DataChannels** for browsers
  (unordered/unreliable option), with a Node server. Faster than TCP/WebSocket for twitchy games.
- **Companion libs (the valuable part, transport-agnostic):**
  - `@geckos.io/snapshot-interpolation` (**BSD-3-Clause**) — server `SI.snapshot.create(state)`,
    client `SI.snapshot.add()` + `SI.calcInterpolation('x y', deep)`; a `Vault` stores snapshot
    history (`getById`, time-based `get`, `setMaxSize`). Default interp buffer = 3 server frames
    (interpolates between 4 snapshots). Docs explicitly cover adding **client-side prediction +
    reconciliation** and **lag compensation** on top. "Send the snapshot using geckos.io **or any
    other library**" — i.e. works fine over our plain WebSocket.
  - `@geckos.io/typed-array-buffer-schema` — schema-driven object→ArrayBuffer compressor
    (quantize floats to ints, pack into a typed buffer) to shrink snapshots before send.
- **License:** geckos.io MIT; snapshot-interpolation BSD-3-Clause. **Verdict:** Don't switch
  transport to WebRTC — it breaks our "one URL, works on a phone/tunnel" simplicity (WebRTC needs
  STUN/TURN + signaling). But the **snapshot-interpolation library validates our `interp.ts`**, and
  its prediction/reconciliation + buffer-schema packing are drop-in references for our roadmap.

### nengi.js
- **What it does:** Node + HTML5 network engine focused on *both* volume and responsiveness. Claims
  100+ concurrent players or 50,000+ entities on a 20-tick server. Ships **built-in interest
  management/visibility**, lag-compensated collision, input-delay elimination — the exact MMO
  toolkit we'd otherwise hand-roll.
- **License:** MIT. **Verdict:** The most *MMO-specialized* of the set and the best single source
  to study for **interest management** and **lag compensation** done idiomatically in JS at our
  tick rate. Adopting wholesale means buying into nengi's entity/channel model. **Recommend: read
  its interest-management implementation, port the pattern, not the dependency.**

### Lance / Incheon
- **What it does:** Node server + client lib that synchronizes client game state to server state,
  with built-in **extrapolation/interpolation + client prediction**. More physics/extrapolation-
  oriented (good for continuous-physics games).
- **License:** MIT (often cited as the leading open-source Colyseus alternative). **Verdict:**
  Lower priority for us — its extrapolation focus suits physics arcade games more than a tile/
  ability MMO; less of a clean fit than nengi for interest management. Reference only.

### Comparison table

| Framework | License | What it gives | Transport | Adopt vs hand-rolled `ws`+JSON |
|---|---|---|---|---|
| **Colyseus** | MIT | Rooms, **binary delta state sync**, matchmaking, Redis multi-process + proxy | WebSocket (uWS) | **Reference, not dependency.** Mirrors our Instance/portal model; steal ChangeTree deltas + StateView filtering + the Redis/proxy scaling design. |
| **geckos.io** | MIT (+ BSD-3 libs) | UDP/WebRTC transport; **snapshot-interp**, buffer-schema packing, prediction/lag-comp recipes | WebRTC UDP | **Don't switch transport** (breaks phone-simple). **Reuse its libs/patterns** for interp, packing, prediction. |
| **nengi.js** | MIT | **Interest management**, lag compensation, input-delay removal, high entity counts | WebSocket | **Best AoI/lag-comp reference.** Port patterns; adopt dependency only if we go heavy-MMO. |
| **Lance/Incheon** | MIT | Extrapolation + client prediction, physics sync | WebSocket | **Reference only** — physics-oriented, weaker fit. |

**Overall recommendation:** Stay hand-rolled. We keep the pillars (simple, phone-friendly, one
plain protocol) and the codebase is already small + correct. Harvest patterns from Colyseus
(deltas, scaling) and nengi/geckos (AoI, prediction, packing).

---

## 2. Netcode patterns — ranked by value for our instanced top-down MMO

1. **Interest management / area-of-interest (AoI) culling — HIGHEST VALUE.**
   Today `index.ts` sends *every* entity in an instance to *every* player in it (`world.snapshot()`
   broadcast). That's O(players x entities) bandwidth and grows quadratically as instances fill.
   The fix every MMO uses: a **spatial hash grid** (uniform cells, e.g. 256px) over the area;
   per player, gather only entities in the player's cell + 8 neighbors (a view radius), and send
   only those. Quadtrees are the alternative for wildly varying object sizes; a uniform grid is
   simpler and ideal for our roughly-uniform top-down entities. Also send enter/leave events so the
   client drops out-of-range entities. This is what nengi's visibility system and Colyseus's
   `StateView` give you. **Biggest bandwidth + CPU win, and it's local to `world.snapshot()`** —
   no protocol break required (you just send fewer entities).

2. **Delta compression / state diffing — HIGH VALUE.**
   We resend full entity state (x,y,name,hue,kind,facing,hp,maxHp,level,...) every tick even when
   nothing changed. Colyseus's ChangeTree proves the win: track per-entity dirty fields, send only
   changed fields plus a baseline-on-join. For a static NPC standing still this drops its per-tick
   cost from ~12 fields to zero. Pairs naturally with AoI (send "entity entered view" full, then
   deltas). Immutable fields (`name`, `hue`, `kind`) should be sent **once on first sight**, never
   per tick.

3. **Client-side prediction + server reconciliation — MEDIUM (feel, not bandwidth).**
   Per Gabriel Gambetta's canonical model: client applies its own input immediately (predicts),
   tags each input with a sequence number, server processes and returns the authoritative position
   + last-processed input seq; client re-simulates unacknowledged inputs from that authoritative
   base (reconciles). At our 20Hz tick + 100ms interp delay, the **local player currently lags its
   own input by ~150ms** — prediction removes that. Requires adding an input `seq` to the `input`
   message and the player's last-acked seq to the `you`/snapshot message. geckos and Lance both
   bake this in; the Gambetta live demo is the reference implementation.

4. **Lag compensation — LOWER (only if we add hitscan/precise PvP).**
   Server rewinds entity positions to the shooter's view-time when resolving a hit, so high-ping
   players still land shots. Our abilities are server-spawned projectiles (already fair-ish), so
   this matters only if we add instant-hit attacks. Defer.

**Incremental path:** AoI grid → per-entity deltas + immutable-once fields → prediction/recon for
self → (later) lag comp. Each step is independent and testable; none requires a binary format.

---

## 3. Wire format: when to leave JSON

We send JSON today (deliberately — debuggable). Concrete benchmark numbers for WebSocket payloads
(JSON baseline = 100%):

| Payload size | JSON | MessagePack | Protobuf | **Custom binary / bit-packed** |
|---|---|---|---|---|
| Small (~33 B) | 33 B | 24 B (−27%) | 17 B (−48%) | **13 B (−61%)** |
| Medium (~117 B) | 117 B | 102 B (−13%) | 75 B (−36%) | **70 B (−40%)** |
| Large (~329 B) | 329 B | 277 B (−16%) | 229 B (−30%) | **220 B (−33%)** |

Key takeaways:
- **MessagePack** is the one-line, schema-free win (~15–27%), but underwhelms because it still
  ships field-name keys. Good first step, low risk, keeps a JSON-like mental model.
- **Custom binary / bit-packing + quantization** is the real prize (30–61%) — drop field names
  (positional layout), quantize world coords to 16-bit ints (our world is 2000x2000 → a 16-bit int
  per axis is *exact* at 1px and halves coord cost vs a JSON float), pack `hue`→1 byte, `facing`→1
  byte (256 directions), `kind`/`abilityId` as enum bytes. `@geckos.io/typed-array-buffer-schema`
  does exactly this from a schema; or hand-roll a `DataView` encoder in `src/shared/protocol.ts`.
- Note the benchmark also found **JSON serialization can be *faster* than custom binary** (V8's
  native `JSON.stringify`), so this is purely a **bandwidth** optimization, not a CPU one.

**Recommended threshold for us:** Stay on JSON until **AoI + deltas are in and a typical phone on
mobile data is still bandwidth-constrained** (rough rule: per-client snapshot egress consistently
> ~30–50 KB/s, i.e. dozens of nearby entities at 20Hz). At that point go **MessagePack first**
(cheap, reversible), and only bit-pack the hot `snapshot` message (not chat/admin) if mobile
bandwidth is still the limiter. Keep `encode`/`decode` in `src/shared/protocol.ts` as the single
swap point — the abstraction is already there.

---

## 4. Reference open-source games to learn from

- **BrowserQuest (Mozilla, MIT, deprecated but seminal).** Browser opens a WebSocket to one of
  several **load-balanced game servers**; **each server hosts multiple world instances** and runs
  all game logic in them — *the exact "one process, many instances, scale by adding processes"
  model our InstanceManager + roadmap target.* Shared JS between client/server (our `src/shared`).
  Best single reference for the multi-instance + load-balanced-server topology.
- **Colyseus examples** (github.com/colyseus) — canonical room lifecycle, schema state, lobby/
  matchmaking patterns; read these for how to structure cross-process matchmaking.
- **agar.io clones** (owenashurst/huytd `agar.io-clone` wiki, i-radwan/agar.io) — show the minimal
  authoritative-loop + delta-update pattern, and the classic gotcha: to avoid client/server drift,
  the **client integrates velocity from the same input the server uses** (prediction) and corrects
  to server deltas — direct guidance for our prediction step.
- **nengi.js demos** — idiomatic JS interest management + lag compensation at MMO entity counts.
- **Veloren** (Rust voxel MMO) — split into `veloren-server-cli` + `veloren-voxygen` client +
  separate **`veloren-auth` central auth server** (one account, any server — Minecraft-style).
  Lesson for us: when we add persistence/accounts, make **auth a separate service** the area
  servers trust, rather than baking it into each instance.
- **deepnight/gameBase** (Haxe/Heaps) — single-player game scaffold; relevant for *project
  structure/discipline*, **not** netcode (no multiplayer layer). Low priority for this task.

---

## 5. Scaling: many areas/instances/processes

How the field does it, mapped to us:

- **BrowserQuest:** N load-balanced game-server processes, each hosting many instances; LB picks a
  server on connect. Simple, proven, matches our model.
- **Colyseus multi-process:** processes on distinct ports, **RedisPresence** (pub/sub + shared
  state) + **RedisDriver** (room registry) so any process can find/reserve a seat in any room; a
  **dynamic proxy** routes each client to the process hosting its room; a front load balancer is
  the single entrypoint. This is a ready-made blueprint for our **"each instance could run as its
  own area-server process"** goal — and our `InstanceManager` is already the in-process version of
  it.

**Mapping to our roadmap item "Cross-process area servers — host instances in separate workers/
processes behind a gateway":**
1. Keep `InstanceManager` as the *placement/matchmaking* authority (it already assigns globally
   unique ids stable across transfers — the hard part).
2. Add a **gateway** process: terminates the client WebSocket, asks `InstanceManager` which
   process owns the player's instance, and relays. (Colyseus's dynamic proxy is the model.)
3. Use a **shared presence bus** (Redis pub/sub, or a Node `worker_threads`/`cluster` message
   channel for a single-box first cut) so portal transfers (`TransferEvent`) can hand a player to
   an instance living in another process — the same handoff `InstanceManager.tick` does today,
   just across a process boundary.
4. Start with `worker_threads` (one box, no Redis, keeps `npm run dev` phone-simple), graduate to
   Redis + multiple machines only when one box is saturated.

---

## Recommended adoptions for BrowserGame (prioritized)

1. **Interest management (AoI) in `world.snapshot()` / `src/server/index.ts` broadcast.**
   Add a spatial hash grid (cell ~256px) to `World`; build each player's snapshot from entities in
   their cell + neighbors within a view radius. Send enter/leave so the client (`interp.ts`) drops
   out-of-range entities. *Biggest win, no protocol break, fully unit-testable like
   `instance-manager.test.ts`.* — maps to roadmap scaling + perf.
2. **Per-entity delta snapshots + immutable-once fields** in `src/shared/protocol.ts` +
   `world.snapshot()`. Send `name`/`hue`/`kind` once on first sight; per tick send only changed
   fields (mirror Colyseus's ChangeTree idea). Pairs with #1.
3. **Client-side prediction + reconciliation for the local player** — add `seq` to the `input`
   message and `ackSeq` to `you`/snapshot in `protocol.ts`; predict in `src/client/` and reconcile
   against the authoritative position. Removes the ~150ms self-input lag. Reference: Gambetta +
   geckos/Lance. Keep the existing `interp.ts` for *remote* entities (it's already correct).
4. **Binary wire format — deferred, gated on metrics.** Keep JSON until AoI+deltas land and mobile
   bandwidth is still the limit; then MessagePack (one-line, reversible), then optionally bit-pack
   only the `snapshot` message (quantize coords to 16-bit, hue/facing to 1 byte each) via a
   `DataView` encoder or `@geckos.io/typed-array-buffer-schema`. Single swap point already exists:
   `encode`/`decode` in `protocol.ts`.
5. **Cross-process area servers** via a gateway + shared presence — keep `InstanceManager` as
   placement authority; start with `worker_threads` (phone-simple), Redis later. Blueprint:
   Colyseus presence/driver/proxy; topology: BrowserQuest. Maps directly to the open roadmap item.
6. **Do NOT** adopt Colyseus/geckos/nengi as dependencies now, and **do NOT** switch to WebRTC —
   both conflict with the simplicity + phone-friendliness pillars. Use them as references.

---

## Sources

- Colyseus — docs & framework: https://docs.colyseus.io/ , https://colyseus.io/
- Colyseus state sync / delta encoding: https://docs.colyseus.io/state
- Colyseus repo (MIT license, binary delta): https://github.com/colyseus/colyseus
- Colyseus scalability (Redis presence/driver, dynamic proxy, multi-process):
  https://docs.colyseus.io/deployment/scalability , https://docs.colyseus.io/server/presence ,
  https://docs.colyseus.io/server/driver
- geckos.io (WebRTC/UDP): https://geckos.io/ , https://github.com/geckosio/geckos.io
- geckos snapshot-interpolation (BSD-3, API, prediction/lag-comp, buffer-schema):
  https://github.com/geckosio/snapshot-interpolation ,
  https://www.npmjs.com/package/@geckos.io/snapshot-interpolation
- nengi.js (interest management, lag comp, entity counts): https://github.com/timetocode/nengi
- Lance (alternative, extrapolation/prediction): https://www.html5gamedevs.com/topic/44532-colyseus-vs-lance/
- Gabriel Gambetta — client-side prediction & server reconciliation:
  https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html ,
  https://www.gabrielgambetta.com/client-server-game-architecture.html ,
  https://www.gabrielgambetta.com/client-side-prediction-live-demo.html
- Wire-format benchmark (JSON vs MessagePack vs Protobuf vs custom binary, byte numbers):
  https://dev.to/nate10/performance-analysis-of-json-buffer-custom-binary-protocol-protobuf-and-messagepack-for-websockets-2apn
- MsgPack vs JSON ~50% traffic cut: http://indiegamr.com/cut-your-data-exchange-traffic-by-up-to-50-with-one-line-of-code-msgpack-vs-json/
- BrowserQuest (multi-instance, load-balanced servers, shared JS):
  https://hacks.mozilla.org/2012/03/browserquest/ , https://github.com/mozilla/BrowserQuest
- agar.io clone architecture (delta updates, client velocity integration):
  https://github.com/huytd/agar.io-clone/wiki/Game-Architecture
- Interest management / spatial hash grid (AoI):
  https://www.dynetisgames.com/2017/04/05/interest-management-mog/ ,
  https://dev.to/maiu/babylonjs-browser-mmo-devlog-update-5-area-of-interest-with-spatial-hash-grid-ifd ,
  https://www.ee.ucl.ac.uk/lcs/previous/LCS2011/LCS1121.pdf
- Veloren architecture (separate server/client/auth): https://book.veloren.net/contributors/developers/codebase-structure.html
- deepnight/gameBase (project scaffold, not netcode): https://github.com/deepnight/gameBase
