# Bot harness — functional + stress + chaos testing

Headless clients that speak the real wire protocol (`src/shared/protocol.ts`) over `ws`, for
load-testing the authoritative server and probing it adversarially. No browser, no Pixi — pure
Node, run with the project's `tsx`.

## Files

| File | Role |
|------|------|
| `bot-client.ts` | `BotClient` — connects to `ws://host/ws`, joins, defensively decodes every server message, tracks self + nearby entities + `you` stats, exposes `sendInput/cast/interact/equip`, optional reconnect-on-drop. The `ws` lib answers the server's heartbeat pings automatically, so a healthy socket is never evicted as a ghost. |
| `behaviors.ts` | `BotBrain` — a small state machine (WANDER / FIGHT / LOOT / VENDOR / PORTAL_HOP) that decides intent from a snapshot view. Pure decisions, unit-testable with fake data. |
| `stress.ts` | CLI load runner: spawn N bots, run a profile mix, sample metrics every 5s, print a live line + summary table, write `last-run.json`, exit 0/1 on thresholds. |
| `chaos.ts` | Adversarial client: malformed JSON, oversized frames, unknown types, out-of-range inputs, cast spam. Asserts the server stays up by joining a clean canary afterward. |
| `bot-client.test.ts` | Vitest: `BotBrain` unit tests + one integration test that boots the real server (`GAME_DB=:memory:`) and drives a real socket. Run by `npm test` (the root config globs `tools/**` too). |

## Usage

```bash
# Stress: 50 bots, 5 minutes, 70% grinders / 20% wanderers / 10% portal-hoppers
npx tsx tools/bots/stress.ts --bots 50 --url ws://localhost:8080 --minutes 5 \
  --mix grind:70,wander:20,hopper:10

# Short smoke run (seconds instead of minutes)
npx tsx tools/bots/stress.ts --bots 10 --url ws://localhost:8080 --seconds 30

# Adversarial self-test
npx tsx tools/bots/chaos.ts --url ws://localhost:8080

# Tests (run by `npm test`; or just this file:)
npx vitest run tools/bots/bot-client.test.ts
```

`stress.ts` flags: `--bots N`, `--url ws://host:port`, `--minutes M` or `--seconds S`,
`--mix grind:W,wander:W,hopper:W` (weights are proportional, assigned deterministically).

### Booting a server to test against

```bash
# fresh in-memory world on a spare port
PORT=8137 GAME_DB=:memory: INSTANCING=single npx tsx src/server/index.ts
```

## Behavior profiles

- **grind** — VENDOR when the bag is heavy and a vendor is in range; else FIGHT the nearest live
  mob (walk into ~300px, fire `arrow` aimed at it, respecting cooldown); else LOOT a nearby ground
  item (pickup is automatic within 30px); else WANDER.
- **wander** — random in-bounds waypoints only (never casts). The gentlest load profile.
- **hopper** — wanders, then periodically (15–45s) walks into a portal rect to cross areas,
  exercising instance transfers + the `area_changed` path.

## Metric definitions (per 5s window)

| Metric | Meaning |
|--------|---------|
| `connected` | Bots currently joined (welcomed + socket open). |
| `in/s`, `out/s` | Server→bot and bot→server messages per second across the fleet. |
| `gap ms` / `gap p99` | Mean / 99th-percentile milliseconds between consecutive snapshots for a bot. The cadence-jitter signal. Ideal ≈ tick interval (50ms @ 20Hz). |
| `snap B` / `snap p99` | Mean / p99 raw byte size of a snapshot frame (AOI-filtered entity list). |
| `dc` | Unexpected disconnects (socket closed while joined, not by us). Cumulative. |
| `rc` | Successful reconnects (re-welcomes after an unexpected close). Cumulative. |
| `err` | Decode errors (unparseable / wrong-shape frames). Cumulative. Should stay 0. |

**Pass criteria** (judged on the final window, i.e. steady state, not the connect ramp):
zero unexpected disconnects, zero connect failures, and snapshot p99 gap `< 3 × tick interval`
(`< 150ms` @ 20Hz). Exit code `0` on pass, `1` on fail. Full data → `last-run.json`.

## Capacity

One Node process comfortably drives ~100 bots; the ceiling is JSON encode/decode on the single
event loop, not the network. For more, run multiple `stress.ts` processes (shard the bot count).
No `worker_threads` in v1 (kept simple on purpose).

## Smoke-run results (this machine, 2026-06-10)

10 bots, 30s, `grind:70,wander:20,hopper:10`, server `GAME_DB=:memory: INSTANCING=single` @ 20Hz:

- connected 10/10 the entire run; **0 disconnects, 0 reconnects, 0 decode errors**.
- throughput ≈ **320–346 msgs/s in, ~92 msgs/s out** (fleet total).
- snapshot gap mean **~62ms**, p99 **64ms**; payload mean **~1.8KB**, p99 **~1.9KB**.
- verdict **PASS** (final p99 gap 64ms < 150ms threshold).

`chaos.ts`: malformed JSON, unknown message types, over-long/wrong-typed join names, out-of-range
inputs, and a 400-cast burst are all handled gracefully (server survives, drops silently or
rate-limits). The **oversized-frame** probe currently **crashes the server** — see below.

## Orchestrator wiring (needs action outside tools/bots/)

1. **Run the tests in CI.** The root `vitest.config.ts` includes only `src/**`, so `npm test`
   skips this harness. Either:
   - add `'tools/**/*.test.ts'` to the `include` array in the root `vitest.config.ts`, **or**
   - add an npm script, e.g. `"test:bots": "vitest run --config tools/bots/vitest.config.ts"`.
   The integration test spawns `src/server/index.ts` via `tsx` with `GAME_DB=:memory:` on a free
   port — no external services, ~1–2s.
2. **Optional npm scripts** for convenience:
   ```json
   "stress": "tsx tools/bots/stress.ts",
   "chaos":  "tsx tools/bots/chaos.ts"
   ```
3. **`last-run.json`** is a generated artifact (written by `stress.ts`). Consider adding
   `tools/bots/last-run.json` to `.gitignore`.

## SERVER BUG FOUND (not fixed — out of scope; report only)

**An oversized inbound WebSocket frame crashes the entire server process.** Reproduced reliably.

- Trigger: any single inbound frame larger than `MAX_MESSAGE_BYTES` (4096), e.g. a 64KB frame, or
  even a `join` with a ~5000-char `name`.
- Mechanism: the `WebSocketServer` is created with `maxPayload: 4096`, so `ws`'s `Receiver` throws
  `RangeError: Max payload size exceeded` (`code: WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`,
  `status 1009`). `ws` surfaces this as an `'error'` event **on the per-connection socket**. In
  `src/server/index.ts`, `wss.on('connection', (socket) => { ... })` registers `'message'`,
  `'pong'`, and `'close'` handlers but **no `'error'` handler**, so Node throws on the unhandled
  `'error'` event and the process exits.
- Impact: a denial-of-service — one hostile (or buggy) client takes down the whole world for every
  connected player with a single frame. The `maxPayload` guard rejects the frame but the crash
  defeats the guard's purpose.
- Suggested fix (server-side, owner's call): add a per-socket error handler in the connection
  callback, e.g. `socket.on('error', () => socket.terminate());` (and/or a `wss.on('error', ...)`).
  This lets the existing 1009 close proceed without killing the process.
- Reproduce: boot a server, then `npx tsx tools/bots/chaos.ts --url ws://localhost:<port>` — the
  `oversized-frame` probe reports `code 1009` and the final canary check fails because the server
  is down (`/health` stops responding).

## Minor observation (not a bug)

Snapshot interval measured ~62ms vs the ideal 50ms tick (20Hz) even at 10 bots — about 24% slower
than the nominal cadence. Comfortably under the 3× failure threshold, but worth noting; likely
`setInterval` drift / per-tick server work rather than load. Worth watching at higher bot counts.
