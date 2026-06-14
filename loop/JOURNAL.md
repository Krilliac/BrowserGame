# Overnight Loop Journal — 2026-06-13

Branch: `loop/overnight-20260613` (from `8de556a`). Gate = `npm run check && npm run build`.
North star: Diablo 1/2/3 look & feel. Green-only, revert-on-red, no test weakening.

---
## Iteration 1 — movement.ts coverage
- Picked: `src/shared/movement.ts` tests (tier: coverage; risky — drives prediction+collision sync).
- Did: added `movement.test.ts` pinning `moveVector` (cardinals, opposing-cancel, diagonal
  normalization to magnitude 1 so corners aren't faster) and `clamp` (range, bounds, idempotence).
- Tests: +9 (932 total).
- Result: COMMITTED (see log) — gate check+build GREEN.
- Notes: no production code changed; pure characterization of existing behavior.


## Iteration 2 — areas.ts coverage
- Picked: `src/shared/areas.ts` helpers (tier: coverage).
- Did: `areas.test.ts` — `isDungeon` (every DUNGEONS key true, pure non-dungeons false, unknown false),
  `areaOf` (every AREAS key resolves to a def with matching id + positive dims; unknown → undefined),
  `pointInRect` (inside, inclusive edges/corners, just-outside false). Generic over the data so it
  won't rot when content changes.
- Tests: +7 (939 total). No production code changed.
- Result: COMMITTED — gate check+build GREEN.

## Iteration 3 — hirelings.ts coverage
- Picked: `src/server/hirelings.ts` (tier: coverage; real pure AI logic — was untested).
- Did: `hirelings.test.ts` covering roster/cost/stat scaling and `stepHireling` across every branch:
  leash-recall, heel/idle, melee hold+attack / cooldown-hold / advance, ranged advance/hold-fire/kite,
  and target selection (skip dead, respect owner-leash, pick nearest). Two initial expectations were
  wrong about the engage-range gate — fixed the TESTS to match the (correct) code, not vice-versa.
- Tests: +12 (951 total). No production code changed.
- Result: COMMITTED — gate check+build GREEN.

## Iteration 4 — gold magnetism (Diablo-feel) + stepToward
- Picked: D3-style gold vacuum (tier: spec/feature — Diablo-feel; small, server-authoritative).
- Did: added pure `stepToward` to shared/movement.ts; new pure `goldMagnetStep` in world.ts pulls a
  gold drop toward the nearest LIVING player inside the magnet band (pickup 30 < d <= 95) at 460 px/s;
  wired into tickItems (gold only). Client needs no change — gold is a snapshot entity, so it visibly
  flies in via interpolation. Existing pickup logic untouched (still collects inside 30).
- Tests: +9 (stepToward in movement.test.ts; world-gold-magnet.test.ts — band, dead-skip, nearest,
  multi-tick convergence). Existing world-pots test still green (gold still collects).
- Result: COMMITTED — gate check+build GREEN.
- Notes for human: gentle vacuum (95px / 460px·s); tune GOLD_MAGNET_RADIUS / _SPEED in world.ts.

## Iteration 5 — deflake world-rifts elite-HP test
- Picked: known flaky `world-rifts.test.ts` › "same monster spawns higher-level at a higher tier"
  (tier: bug — test reliability).
- Root cause: World's `seed` defaults to `Date.now() ^ random`, so spawnMobAt's elite roll diverged
  between the tier-0 and tier-5 worlds. A lucky elite tier-0 ghoul (~2× HP) could beat the tier-5
  `maxHp > m0*1.5` bar (2.75 vs 3.0) → intermittent fail.
- Fix: pin the SAME instance seed (0x21f7) for both worlds. Tier raises elite chance, so with a
  shared seed tier-5's elite outcome is a superset of tier-0's — the HP gap is now purely the tier
  scaling and the assertion holds every run. Assertion NOT weakened; nondeterminism removed.
- Tests: same count; verified 8/8 deterministic. No production code changed.
- Result: COMMITTED — gate check+build GREEN.

## Iteration 6 — champion gold scales with level (Diablo-feel)
- Picked: flat champion/elite gold pile (`30 + rand*50`, level-independent) → un-Diablo (a level-60
  rift champion dropped the same as a level-1 wolf). (tier: spec/feature — Diablo-feel.)
- Did: new pure `championGoldPile(mobLevel, rng)` in progression.ts (flat base + level-scaled core +
  level-scaled spread, sanitizes bad input); wired into the elite drop in world.ts.
- Tests: +3 (progression.test.ts) — positive-int, scales with level (×5+ at L60), both spread ends
  grow + band widens, bad input → level 1. 966 total.
- Result: COMMITTED — gate check+build GREEN.
- Notes for human: only the ELITE bonus pile scales here; base monster gold still comes from the DB
  drop tables (a future data pass could scale those too).

## Iteration 7 — protocol.ts wire-contract coverage
- Picked: last untested shared module `src/shared/protocol.ts` (tier: coverage; the network boundary).
- Did: `protocol.test.ts` — encode/decode round-trips a representative set of client + server
  messages exactly; the decoders NEVER throw on malformed/truncated/garbage JSON (return null), the
  "one dropped frame, not a dropped connection" contract; and a valid-but-unknown JSON parses through
  (validation is downstream). All `src/shared` modules now have colocated tests.
- Tests: +5. No production code changed.
- Result: COMMITTED — gate check+build GREEN.
- Process note: a piped `&& echo GREEN` masked a real typecheck error earlier; switched the gate
  check to inspect actual exit codes. (The error was a wrong ChatChannel literal in the test, fixed.)
