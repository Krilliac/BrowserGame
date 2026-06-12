# ARPG Design Guidance — Spellbooks, Areas, Quests/Economy, Bot Harness

Synthesized from four research reports (spell acquisition, world pacing, quests/NPCs/economy, bot stress testing), June 2026. All numbers tuned to BrowserGame's current state: 3 areas (Aldermere town L0, Gloomwood L2–5, Shadow Crypt L5–10), 6 spells all free at start, kill-quests only, sell-only vendor, wolves drop 3–12g (~13g EV/kill all-in), skeletons ~28g EV/kill, rune_shard sells 250g. This document drives implementation directly.

---

## 1. Spellbook acquisition system

Model: **PoE2 uncut gems** (tiered books drop at area tier, never dead loot — [GameSpot](https://www.gamespot.com/articles/path-of-exile-2-how-to-get-uncut-skill-gems/1100-6528278/), [Maxroll](https://maxroll.gg/poe2/resources/skills-in-path-of-exile-2)) + **Diablo 1 duplicate rule** (re-reading a known book = +1 spell rank — [D1 Spellbooks](https://diablo2.diablowiki.net/D1_Spellbooks)) + **partial vendor catalog** so drops stay exciting (the PoE1 Lilly Roth failure — [PCGamesN](https://www.pcgamesn.com/path-of-exile-2/drops-crafting-uncut-gems)).

### Starter loadout & hour-1 pacing
- New characters start with **2 of the 6 spells**: one basic attack spell + one defensive/utility.
- **Spell 3:** first town quest reward (~10–20 min in), fixed spell.
- **Spell 4:** guaranteed book from the first wilderness named-elite/quest by end of hour 1.
- **Spells 5–6:** hours 2–4 (crypt quest reward + first random drops).
- Invariant: no fresh player goes 30+ minutes in hour 1 without an ability-acquisition event ([PoE quest-gem drip](https://www.poewiki.net/wiki/List_of_gems_rewarded_from_quests), [Last Epoch slot pacing](https://lastepoch.fandom.com/wiki/Skills)).

### Drop rates (separate drop table, rolled independently of gear)
| Source | Book drop chance |
|---|---|
| Normal kill | **0.4%** (1 in 250) |
| Elite/named | **3%** |
| Area boss | **30%** |
| Designated quest rewards | **100%**, fixed spell |
| Soft pity | **+0.1% per 25 kills** since last book; resets on drop |

Target: **1–2 book drops per active play-hour** in level-appropriate content. Books are **tiered by area** (Gloomwood = Tier 1, Crypt = Tier 1–2, new areas = Tier 2–3); the table rolls the *tier*, the spell inside is random-within-tier for mob drops, **fixed for quest rewards** — players should know *when* the dice roll, so show "Spellbooks: Tier N" on area portal tooltips ([Game Developer: loot tables](https://www.gamedeveloper.com/design/defining-loot-tables-in-arpg-game-design)).

### Duplicate handling (never dead loot)
- Reading a duplicate grants **+1 spell rank**. Ranks 1–5, each rank **+12% effect**.
- Cost to rank up: rank 2 = 1 book, rank 3 = 1, rank 4 = 2, rank 5 = 3 (7 books total to max).
- Past rank 5, duplicate books auto-convert to **gold (50% of vendor price)** or 1 crafting shard.

### Vendor (spellbook shop in Aldermere)
- Stocks **3 random tier-appropriate books**, restocking when the player leaves the area or after **4 minutes** idle (D2 refresh model — [VHPG](https://www.vhpg.com/d2r-vendor-refresh/)).
- **Quest-progression spells always purchasable** (the Lilly Roth guarantee — [PoE forum](https://www.pathofexile.com/forum/view-thread/3149849)); **1–2 spells per tier are drop-only chase** (the Empower/Enlighten role).
- **Prices:** Tier-N book = 25× the all-in per-kill gold EV of Tier-N mobs ≈ **30–45 min of farming**. Concretely: Tier-1 = **300g** (~13g/wolf-kill EV), Tier-2 = **700g** (~28g/skeleton-kill EV), Tier-3 = **1,500g**. Quest-spell books at **half price**. Re-tune to preserve the 30–45 min invariant whenever gold tables change.
- **Sealed tome gamble:** unidentified random spell of the area tier at **40% of known-book price** (Tier-1 = 120g), odds 70% common-tier / 25% uncommon / 5% top-tier (duplicates rank up, so never a brick). D2 gambling loop ([Arreat Summit](https://classic.battle.net/diablo2exp/basics/gambling.shtml)).

### Hard rules
- No class-like gating of books (avoids PoE1 muling — [PoE Vault](https://www.poe-vault.com/guides/path-of-exile-beginner-guide-skill-gems)).
- No per-cast consumable cost on combat spells (RuneScape rune friction — [OSRS Wiki](https://oldschool.runescape.wiki/w/Magic)); consumables only for utility (town-portal scrolls later, with shift-click bulk buy per [D2 tomes](https://diablo2.diablowiki.net/Scrolls_and_books)).
- If spell ranks ever gain exclusive choices, ship a cheap full-refund regret mechanic on day one ([PoE regret friction](https://www.pathofexile.com/forum/view-thread/681829/page/1)).

---

## 2. Next areas — concrete plan

**Topology decision: D2 spine + spurs** ([D2 area structure](https://www.d2tomb.com/locations.shtml)), **fixed area levels, no scaling** (preserves the loot power fantasy; scaling erodes it — [D4 forums](https://us.forums.blizzard.com/en/d4/t/level-scaling-is-a-disaster/40559)), plus a **PoE-style XP falloff** beyond a ~5-level gap so Gloomwood stops paying at L10 ([PoE XP penalty](https://www.poewiki.net/wiki/Experience)).

Per-area budget: **3–4 mob templates + 1 elite/boss** (D2 spawns ~3 types/area — [PureDiablo](https://www.purediablo.com/forums/threads/monster-type-spawn-distribution.895/)), **exactly one new mechanic per area**, everything else hue-shifted reskins (`mob_templates.hue` exists). Loot tables gate by area level (D2 treasure-class model — [DiabloDex](https://diablodex.com/Guides/Areas)).

### Area 4 — Rotfen Marsh (swamp), L8–12 — build first
- **Theme:** fog weather, sickly green ground, low ambient (existing `area_theme` knobs). Gimmick: **poison pools** (server-side ground-hazard rects, DoT; reuse corrupted-affix debuff plumbing). Makes the poison-resist affix matter — living-loot-meta hook.
- **Topology:** new south portal from Gloomwood; **sibling of the Crypt** — the game's first branch choice. Two-way portal, **soft gate only** (mob level).
- **Roster:** Marsh Leech (fast fodder, L8), Bog Shambler (tanky melee, L9), Mire Spitter (ranged + poison debuff, L9), Fen Strangler (charger, L11). Elite: **Fenwitch** (L12 mini-boss, ranged + summons leeches) — drops the **Fenwitch's Eye** quest key and is the hour-1+ spellbook anchor for Tier 2.

### Area 5 — Emberdeep Mines (volcanic underground), L12–16
- **Theme:** near-black ground, ember particles, very low ambient. Gimmick: **narrow corridors + lava-crack touch hazards** (chokepoints punish multishot, reward AoE). **Raised elite density** — this is the designated farming spur.
- **Topology:** portal at the bottom of Shadow Crypt, behind the Crypt Lord's room. **Hard gate: Crypt Lord kill required** (D2 Duriel pattern — [Horadric Staff quest](https://diablo.fandom.com/wiki/Horadric_Staff_(Quest))).
- **Roster:** Cinder Imp (fast fodder, **explodes on death** — the area's one new behavior, L12), Magma Crawler (slow tanky melee, L13), Deep Cultist (ranged fire, L14 — hue-shift of Hooded Cultist). Boss: **Forge Tyrant** (L16, slam + charge) guarding the exit portal.

### Area 6 — Frostpeak Pass (ice highlands), L15–20
- **Theme:** white-blue palette, new `snow` weather value, high contrast. Gimmick: **ice friction patches** + chill-on-hit slow debuff.
- **Topology:** continues the spine out the far side of Emberdeep. **Quest-key hard gate:** the pass opens with **Fenwitch's Eye + Forge Tyrant kill** — a mini Khalim's Will forcing one visit to the optional branch ([PureDiablo](https://www.purediablo.com/diablo-2/khalims-will-act-3)), after which the Marsh remains a farming spur.
- **Roster:** Frost Wolf (fodder, L16 — hue-shift Gloom Wolf), Rime Archer (ranged + chill, L17), Avalanche Shade (charger, L18), Tundra Behemoth (slow heavy melee, long telegraph, L19). Boss: **the Pale King** (L20) — first "act-end" moment.

### Cross-cutting
- Level bands overlap by ~2 (5–10 / 8–12 / 12–16 / 15–20), matching the genre's ~1.5–2 mlvl/area ramp ([PoE zone levels](https://www.poewiki.net/wiki/Monster_level)).
- **Add waypoints when area count hits 5–6:** one node per area, unlocked on first touch, jumpable from town (D2 ships 7–9 per act — [D2 Tomb](https://www.d2tomb.com/locations.shtml)).
- Reserve the hell/corruption everything-elite biome (D2 Act IV pattern) as the future capstone tied to the persistent-corruption twist — don't spend it now.

---

## 3. Quests & NPCs

**Cadence: 4–6 handcrafted quests per area, each a distinct verb; never escorts** ([Tim Cain](https://www.timeextension.com/news/2025/12/ive-never-seen-a-review-asking-for-more-escort-quests-fallouts-creator-comments-on-why-escort-missions-are-rarely-done-well)). At least one **permanent character-bound reward** per area and one **deferred crafting token** — the rewards players remember from D2 ([Maxroll Important Quests](https://maxroll.gg/d2/resources/important-quests)). Quest gold = **10–20× the area's per-kill gold EV**.

### Quest roster
| # | Quest | Area | Verb | Reward |
|---|---|---|---|---|
| 1 | First Steps | Town | talk/explore (find wilderness portal) | 25g + common weapon + **fixed spellbook #3** |
| 2 | Wolf Cull (exists) | Wilderness | kill-5 | raise **50g → 150g** / 80xp (~12× wolf EV) |
| 3 | Warm Hides | Wilderness | turn in 8 wolf pelts (Trapper NPC; turn-in consumes pelts) | 120g + guaranteed **magic item at char level** ([Prison of Ice pattern](http://classic.battle.net/diablo2exp/quests/rewards.shtml)) |
| 4 | The Alpha | Wilderness | kill named elite **Greyfang** (fixed lair) | 200g + **permanent +10 max HP** + **guaranteed Tier-1 spellbook** (= spell #4, end of hour 1) |
| 5 | The Sunken Door | Wilderness | explore (crypt-entrance trigger zone) | 100xp + crypt portal marker |
| 6 | Old Bones | Crypt | turn in 12 bones (Purifier) | 250g |
| 7 | Silence the Crypt Lord | Crypt | kill boss | 500g + **Imbue token** (Artificer upgrades 1 common → rare rolled at char level — [Charsi pattern](https://maxroll.gg/d2/resources/important-quests)) + guaranteed Tier-2 spellbook (spell #5) |
| 8 | Cleansing Rite | Crypt | 3-step chain: collect 3 rune shards → light 3 braziers → survive a corrupted elite | **permanent +5% damage** + first stash unlock (RuneScape chain pattern — [Massively OP](https://massivelyop.com/2021/05/26/perfect-ten-mmo-quests-where-you-literally-kill-10-rats/)) |

New areas follow the same template (kill-N, turn-in, named-elite w/ permanent stat, explore, one chain). Later (not now): a repeatable D3-style **bounty board** paying ~5× per-kill EV with a daily cap ([Maxroll bounties](https://maxroll.gg/d3/resources/bounties)).

### NPC additions (D2 minimum-viable town skeleton — [Diablo Wiki NPCs](https://diablo2.diablowiki.net/NPCs))
| NPC | Role |
|---|---|
| Merchant (upgrade) | **buy + sell**: stocks commons + a few magics at ilvl ≈ player level, periodic refresh |
| **Sister Oona** (healer) | free instant full HP/mana + debuff clear (QoL, not a sink) |
| **Lucky Marn** (gambler) | slot-targeted gamble (numbers below) |
| **Artificer** (crafter) | affix reroll: `100 × itemLevel × rarityMult` gold **+ 1 rune_shard**; redeems Imbue tokens — gives rune_shard a use beyond its 250g sell value |
| **Purifier** | cleanses a corrupted item's downside affix for a steep level-scaled fee — corruption-identity sink |
| **Trapper** (wilderness edge) | collect-quest giver outside town |
| Stash chest (object) | per-character; account stash later as a gold-purchasable luxury sink |
| Spellbook vendor | per section 1 (can fold into Merchant initially) |

Defer hirelings/mercs entirely (whole AI system — [D2 hirelings](https://diablo-archive.fandom.com/wiki/Hirelings_(Diablo_II))).

### Gold economy numbers (measured faucet: ~65g/min wilderness, ~120–150g/min crypt)
- **Vendor gear prices:** `25 × itemLevel × rarityMult` (common 1×, magic 3×, rare 8×). Common L3 weapon = 75g ≈ 1 min farming; magic L5 = 375g ≈ 3 min crypt. Vendor **pays 25% of buy price** for gear (D2 spread); flat SELL_VALUES stay for materials.
- **Gamble (Kadala pattern, player picks the slot — [Maxroll Kadala](https://maxroll.gg/d3/resources/using-kadala-efficiently)):** cost `50 + 30 × charLevel` per pull (L5 = 200g, L10 = 350g ≈ 1.5–3 min income, scales forever). Odds: **70% magic / 24% rare / 5% epic / 1% legendary / corrupted 0% — drop-only, always.** ilvl = charLevel −2..+3.
- **Anti-inflation guardrails:** **never add a gold-find affix** (what killed D2 gold — [Metaversus](https://metaversus.substack.com/p/diablo-ii)); gold stays non-player-tradeable; log gold created vs destroyed daily server-side, tune sinks to reabsorb **95–105% of faucet** / 2–5% inflation ([Machinations](https://machinations.io/articles/what-is-game-economy-inflation-how-to-foresee-it-and-how-to-overcome-it-in-your-game-design)).

---

## 4. Bot harness architecture — `tools/bots/`

### Layout
```
tools/bots/
  bot.ts        # one Bot: ws client + decode + FSM driver — imports the REAL src/shared protocol
  behaviors.ts  # states: Idle, Wander, AcquireTarget, Fight, Loot, Flee, VendorSell
  chaos.ts      # seeded mutation fuzzer + flood/reconnect/slow-reader scenarios
  metrics.ts    # harness-side: snapshot inter-arrival jitter, intent→effect RTT, connect time
  run.ts        # CLI: --bots N --profile mix|zombie|wanderer|grinder|chaos
                #      --ramp '10,25,50,100,150' --hold 10m --duration 30m --out soak.jsonl --procs N
  report.ts     # JSONL summarizer: binary PASS/FAIL vs threshold table
```
- **Single process to ~150–200 bots** (one shared 50ms bot tick drives all bots, no per-bot timers); `--procs N` forks child processes beyond one core (Artillery/Tsung model — [Nakama benchmarks](https://heroiclabs.com/docs/nakama/getting-started/benchmarks/)). Staggered joins 1–3s apart ([SoulFire](https://soulfiremc.com/blog/stress-testing-minecraft-servers)).
- **FSM bots, mineflayer-statemachine shape** ([mineflayer-statemachine](https://github.com/PrismarineJS/mineflayer-statemachine)): small behavior classes with `enter()`/`onSnapshot()`/transition predicates; one active state owns intent (OpenRA lesson — [forum](https://forum.openra.net/viewtopic.php?t=21241)). **Seeded RNG per bot** (botId → seed) for deterministic replay.
- Only `chaos.ts` may bypass the protocol encoder.

### Bot profiles & tiers
| Profile | Behavior | Stresses |
|---|---|---|
| zombie | connect, idle in town | connection/snapshot load |
| wanderer | random-walk, portal crossings | movement, interest mgmt, instances |
| grinder | full fight/loot/equip-best/vendor FSM | combat, loot, economy |
| chaos | malformed/flood/reconnect/semantic-cheat | validation boundary |

Mixed fleet 60/30/10 grinder/wanderer/chaos for realism; homogeneous to isolate a subsystem.

| Tier | Bots | Duration |
|---|---|---|
| Smoke (CI-able) | 10 | 2–5 min, every FSM state reached |
| Standard dev load | 50 | 10 min |
| Stress ramp | 10→25→50→100→150, hold 10–15 min each | plot tick-p99 vs bots, find the knee |
| Soak | 30–50 + churn (1 reconnect/30s, area-hopping) | 2–4h overnight; 12h pre-milestone |
| Chaos | 5 chaos + 25 normal, dedicated test server only | 10 min |

### Server-side metrics (~100 lines around the tick `setInterval` in `src/server/index.ts`)
Expose `/metrics.json`; harness polls every 10s into JSONL: tick-duration ring-buffer histogram (p50/p95/p99/max + over-budget counter vs 50ms), `perf_hooks.monitorEventLoopDelay` (**report p99/max, not mean** — [nodejs/node#34661](https://github.com/nodejs/node/issues/34661)), `PerformanceObserver('gc')` major-pause max, `process.memoryUsage()`, per-instance entity counts (players-vs-sockets, projectiles, ground loot, mobs), snapshot bytes p95, max `ws.bufferedAmount`, rejectedMessages counter.

**Backpressure policy to implement and verify:** `bufferedAmount` > 256KB → skip that client's snapshots; > 1MB → disconnect. Prove it with a deliberate slow-reader chaos bot (the documented #1 ws production killer — [WebSocket.org](https://websocket.org/guides/languages/javascript/)).

### Pass/fail thresholds (20Hz, 50ms budget — [OneUptime](https://oneuptime.com/blog/post/2026-02-06-monitor-game-server-tick-rate-opentelemetry/view))
| Metric | Pass | Fail |
|---|---|---|
| Tick p99 (1-min window) | < 40ms | ≥ 50ms sustained |
| Over-budget ticks @ 50 bots | < 1%/min | > 5%/min |
| Effective tick rate | 20 ±0.5 | below target 10+s |
| Server event-loop p99 | < 20ms | max > 100ms repeatedly |
| Major GC max pause | < 50ms | > 50ms (= dropped tick) |
| heapUsed trend (soak, post-warmup) | flat | > 20MB/h sustained 3h |
| Entity counts (soak + churn) | stable oscillation | monotonic growth (ghosts) |
| players vs sockets | equal within heartbeat window | divergence |
| Snapshot p95 size | < 16KB budget | step-change regression |
| Chaos suite | 0 crashes; rejected counter == garbage sent | any crash or **silent acceptance** |
| Reconnect storm (no jitter) | server up, refuses with close 1013, recovers < 30s | dies or never recovers |

### Chaos menu (`chaos.ts`, all seeded; log the payload preceding any failure for one-message repro)
1. **Malformed:** non-JSON, truncated JSON, wrong types, NaN/Infinity, huge strings, deep nesting, unknown types, out-of-range values — expected: `decodeClient` → null, never crash ([protocol fuzzing survey](https://www.mdpi.com/2079-9292/12/13/2904)).
2. **Flooding:** 100–1000× intent rate; oversized payloads vs `maxPayload`.
3. **Reconnect storm:** kill all sockets, reconnect simultaneously with no jitter ([WebSocket.org reconnection](https://websocket.org/guides/reconnection/)); plus connect-and-never-read, half-open, disconnect mid-combat.
4. **Semantic cheats:** move-while-dead, loot-across-map, cooldown violations, sell-unowned — direct automated audit of the server-authoritative pillar; every cheat rejected with zero state change.

Also instrument the **harness itself** (`monitorEventLoopDelay` in the bot process); if harness lag climbs, the run is invalid — shard before trusting numbers ([BrowserStack](https://www.browserstack.com/guide/load-testing-node-js)).

---

## Implementation order
1. **Bot harness smoke tier + server metrics endpoint** (validates everything else under load as it lands).
2. **Spellbook system** (starter loadout, drop table, duplicate ranks, vendor) — biggest identity payoff.
3. **NPC skeleton + quest roster rework** for existing areas (incl. wolf_cull 50g→150g, healer, gambler, Artificer/rune_shard sink).
4. **Rotfen Marsh** (first branch, poison gimmick, Fenwitch), then **Emberdeep**, then **Frostpeak + waypoints**.
