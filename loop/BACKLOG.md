# Overnight Loop Backlog — 2026-06-13

**North star (human):** make it look and feel like **Diablo 1/2/3** (ARPG look + feel).
Within the loop safety order — `(red gate) > (real bug) > (coverage for risky code) > (spec/feature) > (debt) > (perf)` —
weight **Diablo-feel** items high inside the spec/feature tier. Every behavior change ships a real test.

**Starting state:** gate GREEN (103 files, 923 tests; build clean) at `8de556a` (base) → loop branch `loop/overnight-20260613`.

## Coverage — untested pure / risky modules (safe, always-valid)
- [x] `src/shared/movement.ts` — `moveVector` (diagonal normalization) + `clamp`. **[iter 1]**
- [ ] `src/shared/areas.ts` — `isDungeon`, `areaOf`, `pointInRect`.
- [ ] `src/server/hirelings.ts` — `hirelingCost`, `hirelingStats`, `hirelingTemplate`, `stepHireling`.
- [ ] `src/shared/protocol.ts` — decode contract (malformed JSON → null; valid → parsed); `encode` round-trip.
- [ ] Thin-coverage branch gaps in existing tested modules (scan as we go).

## Diablo-feel — gameplay/content (server-side, unit-testable)
- [ ] Audit combat/loot/affixes/monsters for small, high-value mechanics that deepen the ARPG loop
      (each as one tested sub-item). Scan: `items.ts`, `gems.ts`, `runewords.ts`, `mobs.ts`, `progression.ts`.
- [ ] Verify/strengthen loot-roll distribution invariants (rarity weighting, affix ranges).

## Diablo-feel — visuals (cosmetic, client-only, screenshot-verified)
- [ ] Ground/path treatment toward the D2 worn-dirt-path look (scan `ground-tiles.ts` / tilesets).
- [ ] Item-drop ground glints by rarity, drop labels — the ARPG loot-pop feel (scan renderer).
- [ ] (keep each change small, behind quality/effectsEnabled where it has runtime cost)

## Tech debt (zero-behavior-change, proven by tests)
- [ ] Scan for duplicated logic / unsafe casts / missing error handling.

## Known / watch
- Flaky (pre-existing): `world-rifts.test.ts` › "same monster spawns higher-level at a higher tier"
  (RNG-seeded; passes on isolated re-run). Candidate to deflake.

## Done this run
- iter 1: movement.ts coverage (+9 tests)
