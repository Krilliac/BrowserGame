# Overnight Loop Backlog — 2026-06-13

**North star (human):** make it look and feel like **Diablo 1/2/3** (ARPG look + feel).
Within the loop safety order — `(red gate) > (real bug) > (coverage for risky code) > (spec/feature) > (debt) > (perf)` —
weight **Diablo-feel** items high inside the spec/feature tier. Every behavior change ships a real test.

**Starting state:** gate GREEN (103 files, 923 tests; build clean) at `8de556a` (base) → loop branch `loop/overnight-20260613`.

## Coverage — untested pure / risky modules (safe, always-valid)
- [x] `src/shared/movement.ts` — `moveVector` (diagonal normalization) + `clamp`. **[iter 1]**
- [x] `src/shared/areas.ts` — `isDungeon`, `areaOf`, `pointInRect`. (iter 2)
- [x] `src/server/hirelings.ts` — cost/stats/template + stepHireling AI. (iter 3)
- [x] `src/shared/protocol.ts` — encode/decode round-trip + never-throw. (iter 7)
- [ ] Thin-coverage branch gaps in existing tested modules (scan as we go).

## Diablo-feel — gameplay/content (server-side, unit-testable)
- [x] D3-style gold magnetism (iter 4).  [x] champion gold scales with level (iter 6).
- [x] Scale BASE monster gold by level (iter 8) — scaleGoldForLevel, tier-0 unchanged, 4× cap.
- [ ] Party/co-op gold or loot bonus per extra nearby player (D3 "more players = more loot").
- [ ] Health-globe drops (D3): rare monster drop that instant-heals on pickup (new item kind +
      pickup branch + balance; decompose if it grows).
- [ ] Audit `mobs.ts`/`items.ts`/`gems.ts` for other small flat-vs-scaled un-Diablo spots.

## Coverage / robustness — remaining
- [x] Circle-collision edge cases (iter 9): bounded-step block, separate circles, clean exit.
      bounded-speed no-tunnel) in `shared/collision.test.ts`.
- [x] `src/server/config.ts` invariants (iter 10): finite, chances [0,1], min<=max, start<=cap.

## Diablo-feel — visuals (cosmetic, client-only, screenshot-verified)
- [ ] Ground/path treatment toward the D2 worn-dirt-path look (scan `ground-tiles.ts` / tilesets).
- [ ] Item-drop ground glints by rarity, drop labels — the ARPG loot-pop feel (scan renderer).
- [ ] (keep each change small, behind quality/effectsEnabled where it has runtime cost)

## Tech debt (zero-behavior-change, proven by tests)
- [ ] Scan for duplicated logic / unsafe casts / missing error handling.

## Known / watch
- [x] DEFLAKED (iter 5): `world-rifts.test.ts` elite-HP test now seeds both worlds (0x21f7).
  (RNG-seeded; passes on isolated re-run). Candidate to deflake.

## Done this run
- iter 1: movement.ts coverage (+9 tests)
- iter 2: areas.ts coverage (+7 tests)
- iter 3: hirelings.ts coverage (+12 tests)
- iter 4: gold magnetism (Diablo-feel) + stepToward (+9 tests)
- iter 5: deflaked world-rifts elite-HP test (seeded)
- iter 6: champion gold scales with level (+3 tests)
- iter 7: protocol.ts wire-contract coverage (+5 tests) — all shared modules now tested
- iter 8: base monster gold scales with level (+5 tests)
- iter 9: circle-collision edge-case coverage (+3 tests)
- iter 10: config.ts invariant coverage (+5 tests)
