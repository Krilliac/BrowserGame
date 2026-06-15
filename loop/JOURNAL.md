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
| 10a | feat | **Timed game-events** (#11) — Bloodmoon/Golden Hour XP bonus | green | 8baeaae; +37 → 1306; agent-built module wired to data+host (sim-clock, /events cmd) |
| 10b | feat | **Trade** (#13) — secure atomic escrow trading | green | 3d5091e; +24 → 1328; world session+commit revalidation, protocol, index routing; client panel deferred |
| 12 | feat | **Rift modifiers** (D3 mutators) — 8 tier-gated, applied at spawn+reward | green | bf2f64d; +21 → 1364; world rolls from derived seed; /rift entry announces |
| 13 | feat | **Salvage/disenchant** — gear → crafting materials, /salvage cmd | green | 71b8b57; +4 → 1368; 3 new materials; world.salvage |

### User-requested (during playtest): click-to-target UX
8a09529 target frame (portrait+name+level+HP bar); 18eeedf world selection ring. The chase +
auto-attack ALREADY worked (moveSample/autoAttackAbility) — only the VISUALS were missing.

| 14 | feat | **Crafting/refinement** — closes salvage sink; /recipes /craft | green | 54dce81; +6 → 1397; 3:1 ladder + sinks; data-driven recipes |

| 15 | feat(ui) | **Salvage bag UI** — shift-click bag item to salvage | green | 5bfeaf4; protocol+net+index+main; hint added; no restart needed (mats already seeded) |

| 16 | feat(ui) | **Set progress in character panel** — ship itemSets in content packet | green | 37fa68c; compact active-set line (panel was full; full per-bonus = future, needs resize) |

NEXT: alternate — last 2 were client-UX (salvage, sets). Do a BACKEND item via parallel agent
(achievements module, or #2 reconnect grace, or #15 content-pack discovery). Then another client-UX.

| 17 | feat | **Achievements** — level/gold milestone unlocks; /achievements | green | 4165ce5; +23 → 1420; earned[] in save; checkAchievements in creditKill; code-driven |
| 18 | feat(ui) | **Target status badges** — Slow/Burn/Weak on target frame | green | 78bc12c; client-only; surfaces proc/elemental statuses; refresh-live |

| 19 | feat | **Kill counter** → kill achievements + /ladder kills metric | green | e47fee7; +1 → 1421; Player.kills+save; creditKill increments; Slayer→Reaper tiers |

| 20 | feat(ui) | **Set-piece tags on items** — green ◆ SetName in stat lines | green | bb45ea3; client-only ITEM_SETS; helps spot set pieces while looting |

| 21 | feat | **Boss soft-enrage** — bosses ramp damage past 90s | green | fe3e8d1; +3 → 1424; pure bossEnrageMultiplier; engagedAt clock; mobOutgoing hook |

| 22 | feat(ui) | **H help/keybind overlay** + hint — discoverability | green | (pushed); lists keys+mouse+commands; "H Help" hint |

| 23 | feat | **Monster bestiary** — track distinct species killed → collection achievements + /bestiary | green | +5 → 1426; Player.bestiary Set persists in save; creditKill records template; Naturalist(10)/Zoologist(30) achievements; world.bestiaryStatus |

| 24 | feat(ui) | **Achievement unlock toast** — celebratory on-screen card | green | client-only; piggybacks System "Achievement unlocked:" chat line (no protocol); fades in/out near top |

| 25 | feat | **Deathless streak** — kills since last death → no-death achievements | green | +1 → 1427; Player.deathlessStreak persists; creditKill++, death resets to 0; Untouchable(50)/Immortal(200) |

| 26 | feat(ui) | **Kills + deathless-streak on character sheet** — ship in `you` packet | green | protocol+world playerStats+net SelfStats+main bottom-right line; needs server reload to surface |

| 27 | feat | **Best deathless-streak ladder axis** — `/ladder streak` | green | +2 → 1429; Player.bestDeathlessStreak record (max at each kill, persisted); leaderboard 'streak' metric + autosave recordScore; /ladder usage refreshed (now lists kills+streak too) |

| 28 | feat(ui) | **Live deathless-streak badge** on the HUD | green | client-only; centered Lv↔gold, shown at streak≥5, color heats up (amber→orange→red), hides on death |

| 29 | feat | **Boss-kill counter** → boss-slayer achievements | green | +1 → 1430; Player.bossKills (hp≥200 tier, same threshold the spawner uses); creditKill increments; Boss Hunter(5)/Bane of Champions(25) |

| 30 | feat(ui) | **Bosses on character sheet** — Kills/Bosses/Streak trio | green | ship bossKills in `you` packet (protocol+world+net); sheet line now Kills · Bosses · Streak |

| 31 | feat | **Respec** — refund all attribute+skill points for level-scaled gold (/respec) | green | +3 → 1433; fresh axis (not a kill-stat); World.respec conserves points (counts allocated above BASE_ATTRIBUTE + node-set size), charges level×50g, validates gold+something-to-refund; no combat-tick change (low-risk while unattended) |

| 32 | feat(ui) | **Respec button** on the character panel | green | client-only; sends /respec via chat; enabled only when something's allocated AND affordable, else dimmed; shows level×50g cost; both click handlers |

NEXT (it.33): backend (alternation). Then client-UX. PUSH now (it.31 + it.32).
NOTE: it.23–32 all need the dev server to reload its code (no new schema tables) for the user to see
them live.

OLD NEXT (it.20): client-UX (alternation). Candidates: crafting panel (needs restart for tables), achievements
panel, trade panel, or show buffs/timers. Then backend. Consider pushing soon (commits since it.17 push).

(old it.19 note below — superseded)
OLD NEXT (it.19): backend via parallel agent (alternation). Candidates: kill/bestiary counter on the save
(unlocks kill-based achievements + leaderboard metric), boss enrage timer, or #15 content-pack discovery.
Pushed through it.17; push again after a few more or when user asks.

### USER DIRECTIVE (2026-06-14): after the achievements iteration, COMMIT + PUSH everything. [DOING NOW]
Push branch loop/autonomous-20260614 to origin (github.com/Krilliac/BrowserGame): `git push -u origin
loop/autonomous-20260614`. 33 commits ahead of origin base. Iteration 17 = achievements (agent building
achievements.ts; integrate: schema/seed/content + save earned[] + world unlock check on creditKill +
/achievements cmd), commit, THEN push.

### Iteration 16+ candidates
- Set-bonus display in character panel (ship set membership in content packet → client shows N/M + active bonuses).
- Crafting panel UI (list /recipes as clickable; needs server restart for crafting tables).
- Trade client panel (server+protocol done #10b).
- Backend via parallel agent: achievements module, #2 reconnect grace, #15 content-pack discovery.

### Iteration 15+ candidates (integration backlog now CLEAR)
Backend is very deep. Highest FELT value now = CLIENT/UX surfacing (user flagged targeting gap):
- Salvage/craft UI (bag salvage buttons + crafting panel) — /salvage needs item uids the bag UI
  doesn't show; a panel fixes that. Client-heavy, hard to gate-verify.
- Set-bonus display in character panel (ship set membership in content packet).
- Trade client panel (server+protocol already done #10b).
Backend/infra options: #2 reconnect grace, #15 content-pack discovery.
Lean: alternate a client-UX iteration (user can verify live) with backend via parallel agents.

### Iteration 14 plan: integrate crafting.ts (gives salvage materials a sink!) [DONE]
crafting.ts (19 tests, on disk UNTRACKED) PURE: CraftRecipe + DEFAULT_RECIPES (3:1 ladder
scrap→dust→essence→rune_shard + 2 terminal sinks); canCraft/applyCraft. Closes the gap that salvage
mats (mat_scrap/dust/essence) currently have NO consumer. Wire: schema crafting_recipes +
crafting_recipe_io; ensureCrafting seed; content loadCrafting + getRecipe; World.craft(playerId,
recipeId) (loot Map↔record, applyCraft); /recipes + /craft <id> commands. Needs server restart.

### Session pause (2026-06-14): user testing with fresh DB
All 4 parallel-built modules integrated + committed; working tree clean. Deleted game.db for a fresh
seed; started `npm run dev`. NOTE for follow-up: TRADE has no client panel yet (server+protocol only —
test via future UI); game-events fire on a 2-6h sim cadence (won't trigger in a short test; /events
shows schedule). Testable now: item sets, proc weapons, elemental resistances, rift mutators (open a
rift), /salvage <uid>, /ladder, /events.

### Iteration 13 plan: integrate salvage.ts (agent guide)
salvage.ts PURE (salvageYield(inst,rng)→MaterialYield[]; kinds scrap/dust/essence/shard). Wire:
(1) NEW material items mat_scrap/mat_dust/mat_essence (kind 'loot', no power/hp) in seed-items + map
shard→existing rune_shard: const SALVAGE_ITEM_ID={scrap:'mat_scrap',dust:'mat_dust',essence:'mat_essence',
shard:'rune_shard'}; (2) world.salvage(playerId,uid): find BAG item (not equipped), salvageYield(inst,
this.rand), consume gear + add materials to player.loot (mirror rune_shard granting); (3) protocol
salvage{uid} + index route OR a /salvage <uid> command (simpler, no protocol). Add integrity check
that material items exist. World stays deterministic (this.rand).

### Iteration 12 plan: integrate rift-modifiers.ts (agent guide)
rift-modifiers.ts is PURE (8 mutators: berserk/juggernaut/bountiful/scholarly/frenzied/empowered/
vengeful/cataclysmic, minTier-gated; rollRiftModifiers/aggregateRiftEffects→RiftEffects). Wire:
(1) schema rift_modifiers table; (2) ensureRiftModifiers seed; (3) content loader+accessor (add a
`pool` param to rollRiftModifiers so it reads DB rows, default DEFAULT_*); (4) world-rifts: on rift
open, roll mods seeded from the rift's existing seed, store on the rift, apply RiftEffects — mob
hp/damage/speed at spawn (after tier scaling), loot qty + xp at reward sites; broadcast mod names to
client on open. Reuse the game-events xpEventMult pattern for xp/loot if convenient.

### Iteration 11 plan: integrate trade.ts (agent's wiring guide)
trade.ts is a PURE escrow state machine (createTrade/setOffer[resets both confirms]/confirm/commit).
Wire: (1) protocol.ts msgs — C→S tradeInvite/tradeRespond/tradeOffer(full offer)/tradeConfirm/
tradeCancel; S→C tradeOpen/tradeState/tradeClosed; decode defensively. (2) world.ts: Map<sessionId,
TradeSession> + per-player Map<playerId,sessionId> (one trade/player); startTrade (proximity+same-
instance), tradeSetOffer/Confirm/Cancel re-broadcast tradeState; tradeCommit MUST re-validate each
uid is STILL in the giver's bag + gold + free space, else abort whole (never partial). Tear down on
disconnect/death/area-change. (3) index.ts: route msgs + rate-limit invites(1/s)+offer churn. (4)
client trade panel — DEFER to a follow-up (server+protocol first). Big integration; may split.

### Parallel-agent mode (user req, iteration 10+)

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

