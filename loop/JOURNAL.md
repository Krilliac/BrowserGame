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

| 5 | feat | **Item proc system** (#6) — chance-on-hit/crit gear effects | green | f8761ed; +13 → 1226; resolver+ICD+recursion guard; 2 seeded procs; firing=guarded glue (world test deferred) |

| 6 | feat | **Content expansion** — 3 new proc weapons + Trinketer's Cabal jewelry set | green | 27eb389; +1 → 1227; 5 procs + 5 sets total now; integrity-guarded |

| 7 | feat | **Per-element resistances (#14)** — fire/cold/lightning/poison + mob resists | green | 3b230af; +12 → 1239; neutral-by-default; applied at both hit sites; 8 thematic mobs |

| 8 | infra | **Versioned migration chain** (#8) — PRAGMA user_version + ordered MIGRATIONS[] | green | 70ae394; +3 → 1242; migration #1 wraps existing backfill; exactly-once in txns |

| 9 | feat | **Leaderboard / ladder** (#12) — best-ever level/gold per character | green | c242f3b; +9 → 1250; autosave write hook; /ladder cmd |
| 10 | parallel | Dispatch agents: build game-events.ts (#11) + trade.ts (#13) modules concurrently | in-flight | agents build isolated pure modules + tests; orchestrator wires chokepoints next |

### Parallel-agent mode (user req, iteration 10+)
User: dispatch agents to work on multiple files concurrently for speed. Approach: scout/scope inline,
then fan out independent NEW modules to subagents (disjoint files), orchestrator owns chokepoints
(world.ts, index.ts, content.ts, protocol.ts, schema.ts, seed.ts) + integration + gate. Use Workflow
or parallel Agent calls. Keep TDD + gate-green discipline.

### Iteration 9 candidates (keep varying)
- **#12 leaderboard** (liveops) — dynamic-DB table written on level-up/boss/rift; `/ladder` reader. Needs account identity.
- **#11 game_event timer** (liveops) — recurring world events w/ global modifier + `/event` GM cmd.
- **#15 content-pack discovery** (tooling) — typed seed registry replacing explicit imports.
- **Client polish** — surface ability element + mob resists in tooltips (content-store testable).
- **#2 reconnect grace** (phone) — index.ts ws lifecycle; harder to unit-test.
Decisive-pick worked well; keep iterations tight.

### Iteration 8 candidates (vary axis after a run of big combat features)
- **#8 versioned migration chain** (S, infra) — now well-justified (~10 new tables/cols added); safe, fully testable.
- **#15 content-pack discovery** (M, tooling) — typed seed registry replacing explicit imports.
- **#2 reconnect grace** (M, phone) — ws lifecycle in index.ts; harder to unit-test.
- **#12 leaderboard** (S/M, liveops) — needs account identity + dynamic-DB writer.
- Client polish: surface ability element + mob resists in tooltips (client UI — test via content-store).
Lean: a clean infra/tooling or liveops item for variety; keep combat for later.

### Iteration 7 plan: **per-element resistances (#14)** — bigger, own turn [DONE]
DamageElement type (shared/combat.ts). abilities.element column DEFAULT 'physical' (so existing
INSERTs untouched); tag a curated set via post-seed UPDATE map (ABILITY_ELEMENTS). New mob_resists
child table + MOB_RESISTS code default + content.mobResists(tid). Pure resistedDamage(dmg,elem,resists).
Apply at melee hit (world.ts ~1976) + projectile hit (~2913). World-testable via public cast() +
seeded World (100% resist → immune). Neutral by default = safe.

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

