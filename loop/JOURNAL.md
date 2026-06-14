# Autonomous Loop Journal — 2026-06-14

Branch: `loop/autonomous-20260614` (off `claude/memory-storage-check-yy7q9b`).
Mode: self-paced /loop. Gate: `npm run check` green at every commit. Nothing pushed.
Backlog sources: engine-mining sweep (workflow wf_b00fbf0a-ece) + roadmap open gaps.

| # | Tier | Change | Gate | Notes |
|---|------|--------|------|-------|
| 0 | setup | Created loop branch, ran baseline gate | green* | 1176 tests; *2 flaky-under-load files pass in isolation |
| 1 | feat | **Item sets** (#5 in mining backlog) — D2-style set bonuses | green | 0173a5b; +23 tests → 1199 green, no flakes; 3 sets from existing gear |
| 2 | feat | **mob_scripts** (#3) — data-drive BOSS_SCRIPTS into a table | green | 907b015; +9 tests → 1208; executor/BossStep stay in code; defensive row→step |
| 3 | coverage | **Integrity guards** for new content (item-sets + boss-scripts) | green | f7e8a84; +4 integrity tests → 1212 green, no flakes |

| 4 | feat+coverage | New **Sentinel's Plate** steel set + set **completability** integrity guard | green | 3ea2f66; +1 test → 1213; guard: pieces must fit doll slots (ring=2) |

| 5 | feat | **Item proc system** (#6) — chance-on-hit/crit gear effects | pending | pure resolver (ICD + onHit/onCrit) + data-driven item_procs; hook in damageMob w/ procDepth recursion guard; 2 seeded procs (frost glaive chills, doomspike crit-nuke); +17 tests |

### Iteration 5 plan (proc system — needs focus) [DONE]
Highest felt-value next: on-hit **proc system** (#6, anchor "loot=build" identity). Hook point
found: `damageMob` (world.ts:2949) is the single chokepoint; `attacker = players.get(attackerId)`.
Cast path (world.ts:~1970) is input-coupled — DON'T reuse it. v1 = direct-effect procs (bonus
damage / apply status via existing damageMob + applyStatus), ICD per (player,proc), **recursion
guard** (depth flag — procs must not re-proc → server hang). Player procs computed in recomputeStats
→ player.procs. Pure resolver + tests first; seed a proc on a unique so it's felt.

### Next up (mining backlog, remaining high-value)
- #2 reconnect grace window (phone-friendly; index.ts ws lifecycle — harder to unit-test)
- #4 threat/aggro list (combat hot path — needs care; freeze-risk)
- #6 proc/power-chain resolver (combat; ICD + recursion cap)
- #1 delta snapshots (highest value, riskiest desync)
- #14 per-element resistances (new affix axis; touches combat-formulas + affix union)
- Picking order: bias safe/testable/on-theme; tackle hot-path items with dedicated focus.

## Gate rule (important)
Two tests flake under full-suite parallel load but pass in isolation — treat the gate as GREEN
when the ONLY failures are these and they pass when re-run alone:
- `src/server/world-hirelings.test.ts > fights nearby monsters ... credits the OWNER with XP`
- `tools/assetgen/test/assetgen.test.ts > renders each creature deterministically ...`
Re-run check: `npx vitest run <file>`. Any OTHER failure = real, must fix or revert.

