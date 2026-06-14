# Engine-Mining Synthesis: Prioritized Recommendations for BrowserGame

> Source: parallel multi-agent sweep (2026-06-14) of TrinityCore, MaNGOS/CMaNGOS, AzerothCore,
> Flare, the TypeScript multiplayer ecosystem (Colyseus/geckos.io/nengi/boardgame.io), and
> Veloren/MMO-liveops research. Every candidate was verified against the actual codebase before
> ranking. 45 candidates mined, all 45 survived verification as novel/partial (0 already-done).

## Executive summary

The mined cores converge on a single, low-risk thesis: **finish the data-driven sweep already in
flight and close the two named netcode/persistence gaps — don't bolt on new subsystems.** The
highest-fit wins extend systems that already exist: porting the hardcoded `BOSS_SCRIPTS` const into
a `mob_scripts` table (executor + `BossStep` vocabulary already ship), per-client delta snapshots
over the existing AoI grid (the #1 named gap), and a reconnect grace window for flaky phone
connections. A second tier adds genuinely new but on-genre ARPG depth — item sets, gear procs, a
generic conditions gate — that fold into the existing equipped-stat and loot pipelines without new
code per item. Liveops (ladder seasons, leaderboard, trade) match the committed endgame twists but
follow the data-model and netcode foundations, not lead. WebRTC UDP, binary wire, cross-process
gateways, and a GE order book are correct in principle but premature for a single-process,
phone-first project — explicitly demoted.

## Prioritized top 15 (value-vs-effort, fit to the five pillars)

| # | Recommendation | Effort | Value | Lands in |
|---|----------------|--------|-------|----------|
| 1 | Per-client **delta snapshots** over the AoI grid | M | high | `index.ts` snapshot loop + `{t:'delta'}` in protocol.ts; reuses AoI hash |
| 2 | **Reconnect grace window** (linkdead hold) | M | high | `index.ts` close handler + `pendingReconnect` map; gc skips held instances |
| 3 | Port `BOSS_SCRIPTS` → **`mob_scripts` table** (closed event enum) | M | high | `mob_scripts(...)` + content.ts loader; world.ts reads rows vs boss-scripts.ts const |
| 4 | Lightweight **threat/aggro list** (ONLINE/SUPPRESSED only) | M | high | Mob threat Map; threat on dmg/heal in combat.ts; victim select in mobs.ts |
| 5 | **Item sets** with piece-count-scaled bonuses | M | high | `item_sets`+`item_set_bonuses`, `set_id` on items; world.ts equip-stat fold |
| 6 | Data-driven **proc + power-chain resolver** (ICD, recursion-capped) | M | high | `item_procs`+`ability_chains`; combat.ts event emit + one capped resolver |
| 7 | Generic **conditions gate** wired to loot_entry first | M | med | `conditions(...)` + content.ts `evaluateConditions()`; first caller = loot chance |
| 8 | **Versioned migration chain** (PRAGMA user_version) | S | med | `db/migrate.ts` ordered `MIGRATIONS[]` in one txn; ensureColumns = migration #0 |
| 9 | **Loot reference/sub-tables** (shared evolvable pools) | S | med | `loot_references(...)`; recursion in combat.ts roller |
| 10 | **Active-object grid pinning** (sleep far mobs) | S | med | `tickMobs` early-out via AoI hash; `active` flag on Mob |
| 11 | **`game_event` timer** for timed liveops (invasions/ante-up) | M | med | `game_events` table + `isEventActive()` tick; `/event` GM cmd |
| 12 | **Ladder seasons + leaderboard** (reuse bot-metrics math) | M | med | `season`+`leaderboard` tables, `season_id` on saves; `/season` `/ladder` |
| 13 | **Atomic two-party trade window** (escrow, confirm-hash) | M | med | new `src/server/trade.ts`; protocol msgs; world re-validates uid at commit |
| 14 | **Per-element damage + resistances** (new affix axis) | M | med | `element` on abilities; resist cols + resist AffixStat; combat-formulas.ts |
| 15 | **Content-pack discovery** for seeds (typed glob registry) | M | med | `db/seed.ts` glob replacing ~10 explicit imports; per-pack migrate deltas |

## Deliberately NOT recommended (on the record)

- **WebRTC unreliable DataChannel (geckos.io)** — a whole parallel transport (ICE/STUN/TURN) for a
  phone-first single-process project; delta snapshots capture most of the win on plain WS.
- **Binary MessagePack/bit-packing now** — premature; field-mask JSON (4.3) gets half the bytes
  with zero deps. Swap transport only when a profile demands it.
- **Full cross-process area-server split / realmd session-key handoff** — over-engineering at this
  scale. Adopt only the reservation *seam* (optional `endpoint` in welcome); defer the split.
- **GE-style async order-book market** — the live trade window is the must-have; an order book is a
  later, larger surface. Don't build both.
- **Generic status-effect catalog as a foundation** — the 6 closed effects are deliberately simple
  with hand-coded behavior; refactoring into a `stat_mods_json` engine fights simple-over-clever
  until the effect count actually grows.
- **Full SmartAI event matrix / full ThreatManager reference-state model** — take the pared slice
  (current phases to DB; ONLINE/SUPPRESSED only).
- **Embedded Lua (Eluna proper)** — violates simple-over-clever + no-engine-swap and adds a
  server-side execution surface. Use a closed TS-handler registry with data-only step lists.
- **PlayerbotAI 10k-bot manager** — the bot harness is a stress tool, not a live population; only
  the Trigger concept transfers.

_Full per-finding detail (whatItIs / whyFits / mapsTo / risk per source) is in the workflow result
for run `wf_b00fbf0a-ece`. This page is the durable backlog the autonomous loop works from._
