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
