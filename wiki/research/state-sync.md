# State-Sync Implementation Guide (Delta Snapshots, Prediction, Binary Encoding)

> Implementation-focused companion to [`multiplayer-netcode.md`](multiplayer-netcode.md). That page
> decided *what* to adopt (AoI -> deltas -> prediction -> binary) and *why we stay hand-rolled*.
> This page covers *how to build each piece* against BrowserGame's actual wire contract
> (`src/shared/protocol.ts`), simulation (`src/server/world.ts`), and client buffer
> (`src/client/interp.ts`, `src/client/net.ts`). Compiled 2026-06; sources cited at the bottom.

## Summary

Our `snapshot` message today is a **full keyframe every tick**: every `EntityState` (12+ fields:
`id,x,y,name,hue,kind,facing,hp,maxHp,level,...`) for every entity in the instance, JSON-encoded,
20x/second. Three orthogonal upgrades, each independently shippable and testable:

1. **Delta snapshots** — split immutable fields (sent once on first sight) from mutable fields
   (sent only when changed), with explicit `enter`/`leave`/`update` sets and a baseline-ack so the
   client can never apply a delta against a baseline it doesn't have. Biggest bandwidth win, pairs
   with AoI.
2. **Client-side prediction + reconciliation** for the *local player only* — add a `seq` to the
   `input` message and `ackSeq` to the `you` message; the client replays unacknowledged inputs on
   top of the authoritative position. Removes the ~150ms self-input lag. Remote entities keep using
   `interp.ts` unchanged.
3. **Binary encoding** — deferred and metrics-gated. Swap JSON -> MessagePack (one line, reversible)
   then bit-pack only the `snapshot` message (quantize coords to u16, hue/facing to u8). Single swap
   point is already `encode`/`decode` in `protocol.ts`.

Because we run over **WebSocket (TCP)**, messages are reliable and ordered — we do **not** need the
UDP machinery (per-packet acks, jitter buffers for loss, redundant input sends). But we still need a
**baseline ack** for deltas (the client must tell the server which keyframe it has) and **input
sequence numbers** for reconciliation. Those are ordering/identity concerns, not loss concerns.

---

## 1. Delta snapshots / state diffing

### 1.1 The core idea (baseline + delta)

Every delta scheme needs a *baseline*: the last state the receiver is known to hold. The sender
diffs new state against the baseline and transmits only what changed; the receiver applies the diff
to its copy of the baseline to reconstruct full state. Colyseus implements this with a per-Schema
**ChangeTree**: each tracked property is flagged dirty on mutation, and at each `patchRate` interval
only "the latest mutation of each property is queued and sent." Each entity has a stable `refId`
(our `EntityState.id` already is one) so the client knows which instance to patch, and add/remove of
collection members is encoded explicitly. Field caps (Colyseus: 64/schema) are irrelevant to us
since we hand-roll the layout.

Glenn Fiedler's snapshot-compression model is the other canonical reference: snapshots are encoded
**relative to a baseline acked by the receiver** (roughly one RTT back), unchanged entities cost
~1 bit, changed entities send a small index + changed fields.

### 1.2 Field classification for our `EntityState`

Split our fields by mutation frequency — this is most of the win:

| Class | Fields | Send policy |
|---|---|---|
| **Immutable** (set once on spawn) | `id`, `name`, `hue`, `kind`, `abilityId`, `itemId` | Send once, in the **enter** record. Never per tick. |
| **Hot mutable** (change most ticks) | `x`, `y`, `facing` | Per-tick delta, only if changed past a quantization threshold. |
| **Cold mutable** (change rarely) | `hp`, `maxHp`, `level`, `qty`, `flags` | Per-tick delta, only on actual change. |

A static town NPC standing still drops from ~12 fields/tick to **0 bytes/tick** (it only appears in
the keyframe once, then never in a delta until it moves or takes damage).

### 1.3 Concrete protocol design for `snapshot`

Replace the single full-state message with an **enter / update / leave** structure. Keep it JSON
first (debuggable); the field layout is the part that matters and survives the later binary swap.

```ts
// --- src/shared/protocol.ts ---

/** Fields that never change after spawn — sent once, in `enter`. */
export interface EntityEnter {
  id: number;
  name: string;
  hue: number;
  kind: EntityKind;
  abilityId?: AbilityId;
  itemId?: string;
  // initial mutable values so the client can render immediately:
  x: number; y: number; facing: number;
  hp: number; maxHp: number; level: number; qty?: number; flags?: number;
}

/** Per-entity delta: only the fields that changed since the client's baseline. */
export interface EntityDelta {
  id: number;
  x?: number; y?: number; facing?: number;
  hp?: number; maxHp?: number; level?: number; qty?: number; flags?: number;
}

export type ServerMessage =
  // ...
  | {
      t: 'snapshot';
      tick: number;
      /** Monotonic baseline id; client echoes the last fully-applied one (see ackBaseline). */
      base: number;
      enter: EntityEnter[];   // entities newly in this client's view (or first-ever)
      update: EntityDelta[];  // changed fields for entities already in view
      leave: number[];        // ids that left view / despawned
      fx: FxEvent[];
    };
```

The client tells the server which baseline it holds so the server can resend an `enter` if they
desync (e.g. after a dropped... no, TCP doesn't drop — but after a reconnect, or if the server
decides to re-keyframe). Add a tiny client->server ack:

```ts
export type ClientMessage =
  // ...
  | { t: 'ackBaseline'; base: number };
```

### 1.4 Server side (`world.snapshot()` / per-client build)

Because deltas are **per-client** (each client's AoI view differs), the server keeps, *per client*,
the set of entity ids currently in view and the last mutable values it sent for each. Pseudo-code:

```ts
// Per connection, kept on the server:
interface ClientView {
  acked: number;                       // last base the client confirmed
  pending: number;                     // last base we sent
  known: Map<number, EntityState>;     // id -> last values we sent this client
}

function buildSnapshot(view: ClientView, visible: EntityState[], tick: number) {
  const enter: EntityEnter[] = [];
  const update: EntityDelta[] = [];
  const leave: number[] = [];
  const visIds = new Set<number>();

  for (const e of visible) {
    visIds.add(e.id);
    const prev = view.known.get(e.id);
    if (!prev) {
      enter.push(toEnter(e));                 // immutable + initial mutable
    } else {
      const d = diffMutable(prev, e);         // only changed hot/cold fields
      if (d) update.push(d);
    }
    view.known.set(e.id, clone(e));
  }
  for (const id of view.known.keys()) {
    if (!visIds.has(id)) { leave.push(id); view.known.delete(id); }
  }

  view.pending = tick;                        // use tick as the baseline id
  return { t: 'snapshot', tick, base: tick, enter, update, leave, fx };
}
```

`diffMutable` compares each hot/cold field and quantizes the position compare so sub-pixel jitter
doesn't churn deltas (e.g. only emit `x` if `Math.round(e.x) !== Math.round(prev.x)`).

Reliability note: over TCP, every `snapshot` arrives in order, so `view.known` on the server and the
client's reconstructed state stay in lockstep **as long as the connection lives**. The only desync
risk is a fresh connection / reconnect — handle it by treating a new socket (or an `ackBaseline`
with `base < view.acked`) as "resend everything as `enter`," i.e. clear `view.known` and re-keyframe.

### 1.5 Client side (`interp.ts` + `net.ts`)

The client maintains a **reconstructed full-state map** `Map<number, EntityState>`, applies each
snapshot to it, then pushes a *snapshot of that map* into the existing `SnapshotBuffer` for
interpolation. The interpolation code (`interpolate()`) is unchanged — it still receives full
`EntityState[]`.

```ts
// net.ts handle('snapshot')
const now = performance.now();
for (const e of msg.enter)  this.live.set(e.id, fromEnter(e));
for (const d of msg.update) applyDelta(this.live.get(d.id), d);   // assign only present fields
for (const id of msg.leave) this.live.delete(id);
this.snapshots.push([...this.live.values()].map(clone), now);     // feed interp buffer
this.send({ t: 'ackBaseline', base: msg.base });
```

`leave` must drop the entity from `this.live` **but** the entity may still be mid-interpolation in
the buffer; `interpolate()` already handles a missing `to` by dropping it, so a left entity fades on
its next sampled frame — acceptable. (For AoI churn at the view edge, see 1.6.)

### 1.6 Entities entering / leaving AoI

AoI culling (the highest-value item, already specced in `multiplayer-netcode.md`) and deltas are the
same mechanism viewed twice:

- An entity **entering** a client's view radius emits an `enter` (full immutable + current mutable)
  even though it has existed for a while on the server — from *this client's* perspective it's new.
- An entity **leaving** emits a `leave`. The client should not snap-delete it (causes a visual pop);
  prefer letting interpolation drift it off, or render it for one extra `INTERP_DELAY_MS` then drop.
- Edge hysteresis: use a slightly larger "leave" radius than "enter" radius so an entity oscillating
  on the boundary doesn't thrash `enter`/`leave` every tick. (Standard AoI practice.)

---

## 2. Client-side prediction + server reconciliation (local player)

This is the Gambetta "Fast-Paced Multiplayer" model, mapped to our intent-in / snapshot-out loop.
Currently the local player is rendered from the snapshot buffer like everyone else, so it lags its
own input by `INTERP_DELAY_MS` (100ms) **plus** ~half a tick + RTT/2 — visibly mushy. Prediction
renders the local player in *present time* and corrects only when the server disagrees.

### 2.1 Protocol additions

```ts
// client -> server: tag every input with a monotonically increasing seq
| { t: 'input'; seq: number; input: InputState }

// server -> client: ack the last input it consumed (put it on the 'you' message,
// which is already the per-player private channel)
{ t: 'you'; /* ...existing... */ ackSeq: number; x: number; y: number }
```

We add the **authoritative `x,y`** to `you` (or read it from the self entity in the snapshot — but
`you` is cleaner because it's already private and unbuffered). `ackSeq` = sequence number of the
last input the server applied for this player.

### 2.2 Client loop (canonical Gambetta pseudo-code, our types)

```ts
let seq = 0;
const pending: { seq: number; input: InputState; dtMs: number }[] = [];
let predicted = { x: startX, y: startY };

// On each local input frame:
function onInputFrame(input: InputState, dtMs: number) {
  seq += 1;
  net.send({ t: 'input', seq, input });          // send intent (unchanged contract + seq)
  applyInput(predicted, input, dtMs);            // PREDICT immediately, locally
  pending.push({ seq, input, dtMs });
}

// applyInput MUST be identical math to the server's movement integration:
function applyInput(pos, input, dtMs) {
  const v = PLAYER_SPEED * (dtMs / 1000);
  pos.x = clamp(pos.x + (input.right - input.left) * v, 0, WORLD_WIDTH);
  pos.y = clamp(pos.y + (input.down  - input.up)   * v, 0, WORLD_HEIGHT);
}

// On 'you' message (server reconciliation):
function onYou(msg) {
  predicted.x = msg.x;  predicted.y = msg.y;     // snap to authoritative base
  // drop inputs the server already applied:
  while (pending.length && pending[0].seq <= msg.ackSeq) pending.shift();
  // replay everything the server hasn't seen yet, on top of the authoritative base:
  for (const p of pending) applyInput(predicted, p.input, p.dtMs);
}
```

The local player sprite renders from `predicted` (present time). All other entities render from the
`SnapshotBuffer` (100ms in the past) exactly as today. If client and server movement math agree,
`pending` replay reproduces the same position the client already showed -> **no visible correction**.
A disagreement (e.g. server clamped against a wall, or a knockback the client didn't predict) snaps
to the authoritative base then replays -> a small, correct rubber-band only when the client was wrong.

### 2.3 Server side (`world.ts`)

- Store `lastInputSeq` per player. On `input`, validate/clamp as today, apply movement, set
  `player.lastInputSeq = msg.seq`.
- The server already integrates movement per tick; the only change is recording the seq and putting
  it (plus authoritative `x,y`) on the `you` message it sends to that player.
- **Critical for determinism:** the client's `applyInput` and the server's movement integration must
  use the **same `PLAYER_SPEED`, same clamp bounds (`WORLD_WIDTH/HEIGHT`), and a consistent dt.**
  Easiest: have the client integrate per fixed tick (1/tickRate) just like the server, rather than
  per render frame, so the dt matches exactly. Mismatched dt is the #1 source of constant rubber-band.

### 2.4 What NOT to predict

Predict only **local-player movement** (the cheap, high-value case). Do **not** client-predict
combat results, HP, loot, or other entities — those stay fully authoritative (our security pillar:
the client asserts position via prediction but the server overwrites it every `you`, so a cheater
gains nothing but a snap-back).

---

## 3. Interpolation vs. extrapolation (remote entities)

Our `interp.ts` already does the right thing: render `INTERP_DELAY_MS = 100` in the past and lerp
between the two bracketing snapshots. Keep it. Notes for tuning at 20Hz (50ms/tick):

- **Interpolation delay** must be >= 1 snapshot interval so there are always two snapshots to lerp
  between. At 20Hz that's 50ms minimum; 100ms (our value) = 2 ticks of slack, which absorbs one
  late/dropped-from-jitter snapshot. geckos' library defaults to a **3-frame buffer (interpolating
  across 4 snapshots)** — at 50ms/frame that's ~150ms; our 100ms is a touch tighter (lower latency,
  slightly less jitter tolerance). 100ms is a good default for a top-down MMO; expose it as a const
  (it already is) and consider 150ms if mobile networks show snapshot jitter.
- **Extrapolation (dead reckoning)** = projecting an entity forward past the last snapshot using its
  last velocity when no newer snapshot exists. Pro: hides a missing snapshot with zero added latency.
  Con: **mispredicts on direction changes** -> overshoot then snap-back, which looks worse than a
  brief freeze for ability-based combat. Recommendation: **stay with interpolation**; only add
  short-window extrapolation (cap ~100ms) if buffer starvation becomes visible. To extrapolate we'd
  need velocity in the snapshot (or derive it from the last two), which adds a field — not worth it
  yet. Our `interp.ts` currently clamps to the latest snapshot at the edge (freeze), which is the
  safe choice.

---

## 4. Binary encoding (deferred, metrics-gated)

Keep JSON until **AoI + deltas are live and a phone on mobile data is still bandwidth-bound** (rough
trigger: sustained per-client snapshot egress > ~30-50 KB/s). The single swap point already exists:
`encode`/`decode` in `protocol.ts`. Migrate in two steps so each is reversible.

### 4.1 Step 1 — MessagePack

One-line, schema-free: replace `JSON.stringify`/`JSON.parse` inside `encode`/`decode` with a
MessagePack codec, send `ArrayBuffer` frames instead of strings. ~15-27% smaller (still ships field
names as map keys), zero structural change, fully reversible. Good first move; keeps the JSON-like
mental model and debuggability (decode-to-object still works in devtools).

### 4.2 Step 2 — bit-packed `snapshot` only (quantization)

Only the hot `snapshot` message earns hand-packing; leave `chat`/`admin`/`content` as
MessagePack/JSON. Use a `DataView` writer with a **positional layout** (no field names) and quantize:

| Field | JSON cost (approx) | Quantized | Bits | Rationale |
|---|---|---|---|---|
| `x`, `y` | ~6-9 chars each | u16 each | 16 + 16 | World is 2000x2000; `u16` (0..65535) covers it at **<1px** resolution exactly. |
| `facing` | ~6-18 chars | u8 | 8 | 256 directions = 1.4 deg steps, imperceptible for sprite orientation. (Angle quantization: `round(facing / (2*PI) * 256) & 0xff`.) |
| `hue` | ~3 chars | u8 | 8 | 0..360 -> 0..255, or store the raw 0..255 hue. |
| `kind`, `abilityId` | string | u8 enum | 8 | Enum index, not a string. |
| `hp`, `maxHp`, `level` | digits | u16 / u8 | 16 / 8 | Whole numbers, small range. |
| `id` | digits | u16 | 16 | < 65k entities per instance is plenty. |

This is the **smallest-value** half of Fiedler's scheme (we skip quaternion smallest-three since we
have a single 2D angle, not a 3D rotation). For deltas, prefix each entity's record with a small
**field-mask byte** (bit per mutable field present), so an unchanged entity costs ~0 and a moving
one costs `id(2) + mask(1) + x(2) + y(2) + facing(1)` = **8 bytes** vs ~80+ for the JSON object.

### 4.3 Rough byte-budget math

Per moving entity per tick:
- **Full JSON `EntityState`:** ~90-130 bytes (field names + numeric strings + punctuation).
- **MessagePack full:** ~60-90 bytes (keys still present).
- **Bit-packed delta (id + mask + x,y,facing):** **~8 bytes.** Cold fields add 1-2 bytes each *only
  when they change.*

At 20Hz with 40 visible entities all moving: JSON ~= 40 * 110 * 20 = **88 KB/s**; bit-packed delta
~= 40 * 8 * 20 = **6.4 KB/s** (plus near-zero for the static ones AoI/deltas already removed). That's
the ~10-15x that takes us from "phone on mobile data struggles" to "comfortable."

> CPU caveat (from the benchmark in `multiplayer-netcode.md`): V8's native `JSON.stringify` can be
> *faster* than a hand-rolled binary encoder. This is purely a **bandwidth** optimization — only
> spend the complexity when bandwidth, not CPU, is the measured bottleneck.

---

## 5. Lag compensation / hit registration (brief)

Authoritative servers that resolve **instant-hit** attacks rewind the world: when player P fires at
client-time T, the server reconstructs every entity's position at T (= now - P's RTT/2 - P's interp
delay) from a short ring buffer of past states, tests the hit against *those* positions, then applies
the result in the present. This makes high-ping players able to land shots on what they saw.

For BrowserGame this is **deferred**: our abilities spawn **server-side projectiles** that travel and
collide in the authoritative present, so a shot is already fair (the player aims a direction; the
server owns the projectile). Lag compensation only becomes necessary if we add **hitscan / instant**
attacks (e.g. a melee swing or beam that resolves the same tick). If/when we do: keep ~250-500ms of
per-entity position history on the server, rewind to the attacker's view-time, and cap the rewind so
a very-high-ping client can't shoot players who've long since moved/teleported (anti-cheat clamp).

---

## Proposed design for OUR delta-snapshot + prediction (consolidated)

1. **Protocol (`protocol.ts`):**
   - `snapshot` becomes `{ tick, base, enter[], update[], leave[], fx }` with `EntityEnter`
     (immutable + initial mutable) and `EntityDelta` (sparse mutable).
   - Add `{ t: 'ackBaseline'; base }` (client->server).
   - Add `seq` to `input`; add `ackSeq`, `x`, `y` to `you`.
2. **Server (`world.ts` / per-client build):** per-client `ClientView { acked, pending, known }`;
   build enter/update/leave by diffing `known` vs the AoI-visible set; quantize the position compare;
   record `player.lastInputSeq`; emit it + authoritative `x,y` on `you`. New socket / stale ack ->
   re-keyframe (clear `known`).
3. **Client interp (`interp.ts` / `net.ts`):** maintain `live: Map<id, EntityState>`, apply
   enter/update/leave, feed full snapshots into the existing `SnapshotBuffer` (interpolation
   untouched); send `ackBaseline`.
4. **Client prediction (`net.ts` + input code):** `seq` counter, `pending[]` input log, `applyInput`
   mirroring server movement, reconcile on `you`. Render local player from `predicted`, everyone else
   from the buffer.

---

## Prioritized adoption list (mapped to files)

1. **Delta snapshots (enter/update/leave + immutable-once fields).** `protocol.ts` (message shape),
   `world.ts` (per-client diff + `ClientView`), `net.ts`/`interp.ts` (reconstruct `live` map, ack
   baseline). Highest bandwidth win; pairs with the AoI grid already prioritized in
   `multiplayer-netcode.md`. Unit-test the diff like `instance-manager.test.ts`.
2. **Client-side prediction + reconciliation (local player).** `protocol.ts` (`seq` on `input`,
   `ackSeq`+`x`+`y` on `you`), `world.ts` (`lastInputSeq`), client input loop + `net.ts`
   (`pending[]`, `applyInput`, reconcile). Pure feel win; remove the ~150ms self-lag. Keep
   `interp.ts` for remote entities.
3. **Interpolation tuning.** No code change required now; keep `INTERP_DELAY_MS = 100`, revisit to
   150ms only if mobile jitter shows. Add short-window extrapolation only if buffer starvation is
   observed (would need a velocity field — defer).
4. **Binary encoding — MessagePack first, then bit-pack `snapshot`.** Single swap point
   `encode`/`decode` in `protocol.ts`. Gate on measured per-client egress (> ~30-50 KB/s on mobile).
   Bit-pack only the hot `snapshot` message; quantize `x,y`->u16, `facing,hue`->u8, enums->u8.
5. **Lag compensation.** Defer until/unless instant-hit attacks exist; our projectiles are already
   fair. When needed: per-entity position ring buffer in `world.ts` + capped rewind.

---

## Sources

- Gabriel Gambetta — Client-Side Prediction & Server Reconciliation (input seq numbers, replay of
  unacked inputs): https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html
- Gabriel Gambetta — Fast-Paced Multiplayer, sample code & live demo (<500 LOC reference impl):
  https://www.gabrielgambetta.com/client-side-prediction-live-demo.html
- Gabriel Gambetta — Client-Server Game Architecture (intent-in/state-out model):
  https://www.gabrielgambetta.com/client-server-game-architecture.html
- Client-side prediction (overview): https://en.wikipedia.org/wiki/Client-side_prediction
- Colyseus — State Synchronization (ChangeTree, per-property dirty flags, patchRate, full-state-on-
  join then deltas, refId add/remove, StateView/filter, 64-field cap): https://docs.colyseus.io/state
- Colyseus — Advanced Schema usage (`.setDirty()`, manual change control):
  https://docs.colyseus.io/state/advanced-usage
- @colyseus/schema — incremental binary serializer with delta encoding (repo + impl notes):
  https://github.com/colyseus/schema , https://github.com/colyseus/schema/blob/master/src/Schema.ts
- geckos.io snapshot-interpolation — interpolation buffer default (3 frames / 4 snapshots), Vault
  API, angle interpolation (rad/deg/quat), prediction & lag-comp hooks:
  https://github.com/geckosio/snapshot-interpolation ,
  https://www.npmjs.com/package/@geckos.io/snapshot-interpolation
- Glenn Fiedler (Gaffer on Games) — Snapshot Compression (coordinate/angle quantization bit counts,
  baseline-relative delta encoding, byte-budget math):
  https://gafferongames.com/post/snapshot_compression/
- Wire-format byte benchmark (JSON vs MessagePack vs Protobuf vs custom binary):
  https://dev.to/nate10/performance-analysis-of-json-buffer-custom-binary-protocol-protobuf-and-messagepack-for-websockets-2apn
- Interest management / spatial hash grid (AoI enter/leave that delta snapshots ride on):
  https://www.dynetisgames.com/2017/04/05/interest-management-mog/
</content>
</invoke>
