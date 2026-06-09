# RuneScape Mechanics & Open-Source Ecosystem — Research

> What we can adopt from RuneScape (OSRS/RSC) and its open-source clients, servers, and data
> tooling for our server-authoritative TypeScript MMO: the game-tick model, the XP curve,
> simplified combat formulas, drop-table design, aggression/respawn rules, and licensing.

This is a research note, not a spec. Concrete, prioritized actions mapped to our files are in
[Recommended adoptions](#recommended-adoptions-for-browsergame). Numbers and formulas are real
and sourced; see [Sources](#sources).

---

## 1. Open-source clients, servers & data tooling

The RuneScape open-source scene splits into **clients**, **server emulators (RSPS)**, and
**cache/data tooling**. None of their code is directly reusable in TypeScript, but the
*architectural patterns* are battle-tested for exactly our problem: an authoritative server
broadcasting state to thin clients on a fixed tick.

| Project | What it is | License | Lesson for us |
|---|---|---|---|
| **RuneLite** (`runelite/runelite`) | The de-facto OSRS client. Thin renderer + a **plugin bus** over a read-only game state. | BSD-2-Clause | Plugins observe immutable game state and never mutate authoritative data. Mirrors our "client draws what the server resolved" rule. |
| **OpenRS2** (`openrs2/openrs2`) | Full server + tooling compatible with RS build 550 (2009); also a **cache/XTEA archive**. | ISC | Clean separation of *cache/data tooling* from the *runtime server*. Data is content, loaded not hardcoded. |
| **2003scape** (`2003scape/rsc-server`, `rsc-client`) | RuneScape Classic emulator + web client, **written in JavaScript/Node**, runnable in-browser via Web Workers/WebRTC. | (per-repo; permissive) | Closest analog to us: a JS, browser-deliverable MMO. Worth reading `rsc-server` for tick loop & entity update structure. |
| **Hyperion** (`Rune-Server/hyperion`) | Classic 317 Java emulator. Has an **`Action`/`ActionQueue`** abstraction — queued, tickable player actions. | open | The action-queue model (below) is the single most adoptable idea. |
| **Apollo** (`apollo-rsps/apollo`) | Modular 317/377 Java server: small core + **plugin system**, packet **encode/decode split from packet representation**, parallel player updates. | open | Decode/handle/encode are separate stages; handlers can be chained. We already split decode at the boundary — Apollo validates going further with a handler registry. |

**Architecture lessons that transfer to a server-authoritative TS MMO**

1. **Encode/decode split from logic** (Apollo). We already do this in `decodeClient`/`decodeServer`
   (`src/shared/protocol.ts`). Apollo confirms the next step: a *handler registry* keyed by
   message type, rather than a growing `switch` in `world.ts`.
2. **Data-as-content, not code** (OpenRS2). Mob/loot/XP tables are *data files* loaded by the
   server, not literals compiled in. Our `MOB_TEMPLATES`/`LOOT_TABLES`/`AREA_MOBS` are already
   table-shaped; the lesson is to keep them declarative and eventually externalize.
3. **Immutable game state to the client** (RuneLite). Clients get a read-only snapshot and render;
   they never compute authoritative results. We already enforce this — keep it as a hard rule.
4. **Per-tick action queue per entity** (Hyperion/Apollo) — see §2.

---

## 2. The game-tick model (0.6s tick)

RuneScape's entire simulation runs on a **game tick of 0.6 seconds** (600 ms). Every
server-processed action is quantized to tick boundaries: an input registered mid-tick takes
effect at the start of the next tick, so the perceived latency of an action is 0–600 ms.

Key tick-based rules:

- **Movement:** walking = **1 tile/tick**, running = **2 tiles/tick**.
- **Attack speed** is an integer **interval in ticks** per weapon (e.g. 4-tick scimitar, 5-tick
  longsword, 7-tick halberd). It behaves like a **global cooldown**: after attacking you cannot act
  offensively until that weapon's tick interval elapses. Switching weapons does not refund the
  remaining cooldown.
- Tick length is nominally fixed but can stretch under server load (more players → longer ticks).
- "Tick manipulation" exists *because* the tick is the atomic unit — actions can be interleaved
  within a tick boundary for efficiency. We don't want to invite that, but it shows the model is
  deterministic and observable.

**Does a tick model fit on top of our fixed-timestep server?**

Our `World.tick(dt)` already advances a fixed simulation step and tracks `this.now` in ms
(`src/server/world.ts`). RuneScape's tick is a **coarser, gameplay-level quantization layered on
top of** the simulation step — they are not in conflict:

- Keep the **fine fixed-timestep** for continuous things: projectile flight, movement integration,
  status-effect DoT, HP/MP regen. (We are a real-time top-down game, not a tile-grid game; we do
  *not* want to quantize movement to 600 ms steps — that would feel like classic RuneScape, not
  WC3/Diablo.)
- Introduce a **gameplay tick** (e.g. accumulate ms, fire every 600 ms — or a faster value like
  300 ms that better fits action combat) that governs **discrete combat events**: attack
  cooldowns, DoT application cadence, aggression re-evaluation, regen pulses. This gives
  deterministic, testable, integer-tick cooldowns instead of float ms drift.
- Adopt the **action-queue** idea (Hyperion's `ActionQueue`): each entity owns a small queue of
  pending tick-bound actions (`{ at: tickIndex, kind }`). The world drains actions whose `at` has
  arrived. This cleanly replaces ad-hoc `attackCd -= dt*1000` countdowns scattered through
  `tickMobs`/`cast`, and makes "weapon has an N-tick attack interval" a first-class concept.

**Recommendation:** *don't* replace our timestep. *Do* add a lightweight tick counter and express
ability cooldowns/attack intervals as **integer ticks** rather than raw ms. Express weapon/ability
speed in `ABILITIES` (`src/shared/combat.ts`) as a tick interval, not a ms cooldown.

---

## 3. The OSRS XP curve

### The formula

The cumulative experience required to **reach level `L`** is:

```
xp(L) = floor( (1/4) * Σ_{n=1}^{L-1} floor( n + 300 * 2^(n/7) ) )
```

i.e. sum a per-level term `floor(n + 300·2^(n/7))` from `n = 1` to `L-1`, then take a quarter and
floor. `xp(1) = 0`. This single curve is used for **every** OSRS skill (1–99, capped at
13,034,431 XP for level 99). After ~level 20 the curve is effectively exponential: **total XP
roughly doubles every 7 levels** (level 92 is ~50% of the XP to 99; the last 7 levels 92→99 cost
as much as 1→92 combined).

### Cumulative XP thresholds (level → total XP to reach it)

| Lvl | XP | Lvl | XP | Lvl | XP |
|----:|----:|----:|----:|----:|----:|
| 1 | 0 | 8 | 540 | 15 | 2,411 |
| 2 | 83 | 9 | 670 | 16 | 2,746 |
| 3 | 174 | 10 | 1,154 | 17 | 3,115 |
| 4 | 276 | 11 | 1,358 | 18 | 3,523 |
| 5 | 388 | 12 | 1,584 | 19 | 3,973 |
| 6 | 512 | 13 | 1,833 | 20 | 4,470 |
| 7 | 650 | 14 | 2,107 | — | — |

Milestones: **L30 = 13,363 · L40 = 37,224 · L50 = 101,333 · L60 = 273,742 · L70 = 737,627 ·
L80 = 1,986,068 · L92 = 6,517,253 · L99 = 13,034,431**.

(Note: the small per-level numbers above — 83, 91, 102, 112… deltas — are the canonical OSRS table.
Levels 8/9 = 512+128.../... reflect the floored sum; the cumulative values shown match the OSRS
Wiki experience table.)

### Comparison to our current curve

Our `xpForLevel(L) = 50·(L−1)·L` (`src/server/progression.ts`) is a **pure quadratic**:
`0, 100, 300, 600, 1000, 1500, …`, each level costs a flat **+100** more than the last. Contrast:

| Level | Ours `50·(L-1)·L` | OSRS |
|---:|---:|---:|
| 2 | 100 | 83 |
| 5 | 1,000 | 388 |
| 10 | 4,500 | 1,154 |
| 20 | 19,000 | 4,470 |
| 50 | 122,500 | 101,333 |
| 99 | 485,100 | 13,034,431 |

Ours is *gentler early* (less low-level grind) but *vastly flatter at the top* — there is no
"chase" to a level 99. OSRS's exponential tail is what creates a multi-thousand-hour endgame.

**Recommendation:** Whether to adopt depends on intended session length. Our quadratic is fine for
a short-loop action game and keeps `levelForXp` cheaply invertible in closed form (we currently
solve the quadratic). The OSRS curve has **no closed-form inverse** — `levelForXp` becomes a
precomputed cumulative table + binary search (cheap: 99 entries). If we want long-tail RuneScape-style
progression and per-skill grinding, adopt the OSRS curve as a **precomputed `XP_TABLE: number[]`**
(generate once from the formula) with `levelForXp` doing `binarySearch`. If we want fast,
forgiving leveling, keep the quadratic. A reasonable middle path: keep quadratic but steepen the
constant, or cap our intended max level lower (e.g. 50) where the two curves are closest.

---

## 4. Combat formulas (OSRS) and how to simplify them

OSRS combat is two independent rolls each attack: **does it hit** (accuracy) and **if so, how
much** (damage 0..max).

### Accuracy

Compute an **attack roll** for the attacker and a **defence roll** for the defender:

```
attackRoll  = floor( effectiveAttack  * (equipAttackBonus  + 64) )
defenceRoll = (defLevel + 9) * (defStyleBonus + 64)        // vs a monster
```

`effectiveAttack = floor((attackLevel + potionBonus) * prayer) + styleBonus + 8` (style bonus is
the invisible +0/+1/+3 from accurate/controlled/aggressive stances; a void-style multiplier may
apply). Hit chance from the two rolls:

```
if attackRoll > defenceRoll:  hitChance = 1 - (defenceRoll + 2) / (2 * (attackRoll + 1))
else:                         hitChance =     attackRoll       / (2 * (defenceRoll + 1))
```

### Max hit (melee)

```
effectiveStrength = floor((strengthLevel + potion) * prayer) + styleBonus + 8
maxHit = floor( (effectiveStrength * (equipStrengthBonus + 64) + 320) / 640 )
```

On a hit, damage is uniform integer in `[0 .. maxHit]` (a successful hit can still roll 0 in OSRS;
many simplified servers use `[1 .. maxHit]`). All damage is floored; OSRS caps any single hit at
200. Ranged uses the same shape with ranged str/attack; Magic max hit is largely **spell-defined**
(fixed base per spell + small level/gear modifiers) rather than purely level-derived.

### The combat triangle

A rock-paper-scissors of **armour effectiveness**, not raw damage:

- **Melee** beats **Ranged** (melee armour has high ranged-defence; close the gap and you win).
- **Ranged** beats **Magic** (ranged armour has high magic-defence).
- **Magic** beats **Melee** (metal/melee armour has terrible magic-defence — magic punches through).

Implementation detail worth stealing: **magic defence is 70% Magic level + 30% Defence level**,
unlike melee/ranged which use Defence alone. That one rule is what makes "mage armour resists
mages, melee armour doesn't" emergent rather than a hardcoded multiplier.

### Realistic simplification for our ability system

Our `ABILITIES` table currently has flat `damage` per ability (`src/shared/combat.ts`); mobs have
flat `damage` (`src/server/mobs.ts`); `damageMob`/`damagePlayer` just subtract. To add RuneScape
depth without a full sim:

1. **Two-roll model.** Give each combatant `attack`, `strength`, `defence` (and optionally
   `ranged`, `magic`) skill levels (from `progression.ts`). On `cast`, compute a hit chance from
   the roll formulas above (with `equipBonus = 0` until we have gear) and a `maxHit` from strength;
   roll `hitChance`, then roll damage in `[0..maxHit]`. This is ~15 lines and fully deterministic
   with an injected RNG (matches our `rollLoot` testing pattern).
2. **Damage type per ability** (`melee | ranged | magic`) on each `ABILITIES` row, and an
   **armour/resistance class** per mob. Apply a flat triangle multiplier (e.g. ×1.25 favorable /
   ×0.8 unfavorable) — a tiny, readable approximation of the armour math above.
3. **Per-skill XP.** Award XP to the *skill used* (attack/strength/magic) rather than one global
   pool, so the triangle creates progression choices.

Keep it simple: skip prayers, potions, void, and the full effective-level stack until they earn
their place (anti-bloat).

---

## 5. Skill/progression, drop tables, aggression & respawn

### Drop-table design (weighted + rare drop table)

Our `rollLoot` (`src/server/loot.ts`) rolls **each row independently** by probability. OSRS uses a
richer two-layer model worth borrowing selectively:

- **Always table** — guaranteed drops (e.g. bones). Always roll.
- **Main table** — a **single weighted roll**: each entry has an integer *weight*; pick one entry
  with probability `weight / totalWeight` (plus a "nothing"/empty weight). This is different from
  our per-row independent rolls and is the standard MMO pattern: one kill yields one main-table
  result, controllable globally by adjusting weights.
- **Rare Drop Table (RDT)** — accessed as a **sub-table**: the main table includes an entry that,
  when selected, rolls *another* weighted table. OSRS nests Gem table (weight 20/128) and Mega-rare
  table (15/128) inside the standard RDT, and many monsters reach the RDT at a small chance
  (e.g. **1/128**). Net rarity multiplies: a 1/128 table access × a 1/128 item = **1/16,384**.
  This is how RuneScape gets clean, tunable ultra-rare drops without tiny floats everywhere.
- **Bad-luck protection** (common in RSPS): increment a counter on no-unique kills and raise the
  RDT chance after N kills. Optional, but a nice retention lever.

**Adoptable:** add an optional **weighted single-roll table** alongside our current independent
rolls, and support **nested sub-tables** so a rare entry can point at a shared "rune table". Keep
the injected-RNG, pure-function design we already have.

### Aggression & respawn

- **Aggro origin is the spawn point**, not the mob's current position; aggro range = max-range +
  attack-range from that origin. Our `stepMob` aggros from the mob's *live* position
  (`src/server/mobs.ts`); switching the aggro check to the spawn anchor prevents mobs being kited
  arbitrarily far.
- **Combat-level gating:** a level-based aggressive monster attacks a player only while
  `playerLevel ≤ 2 × monsterLevel`. Cheap, and makes high-level zones "safe" for high-level players
  — a natural difficulty signal. We have player level (`progression.ts`) and `MobTemplate.level`,
  so this is a one-line gate in `nearestTarget`.
- **Tolerance:** after **10 minutes** in a region, aggressive monsters become **passive** to that
  player until they leave and return (region = 21×21 tiles centred on the player). Prevents endless
  passive-aggro while AFK. Worth a simplified version: per-player, per-area tolerance timer.
- **Respawn:** RuneScape mobs respawn at a fixed timer at their **spawn point**. We already do this
  (`MOB_RESPAWN_MS`, `respawnMob` in `world.ts`) — keep it; just ensure respawn restores to the
  spawn anchor we'd add for aggro.

### Skill/progression design

- **Many independent skills** sharing one XP curve (§3) — each with its own level — is RuneScape's
  core progression identity and maps cleanly onto our per-skill-XP combat idea (§4.3).
- **Level gates content** (you need level N to wield/use X). A lightweight version: ability unlocks
  by skill level in `ABILITIES`.

---

## 6. Licensing / data-reuse notes (important)

**Unsafe — do not use (Jagex IP):**

- Any **game assets**: sprites, models, audio, maps, the cache, item/NPC art. These are Jagex
  copyright. The OSRS/RS Wikis host images that are *Jagex copyright*, used on the wiki under
  permission — that permission does **not** extend to us.
- **Names and lore** of specific RuneScape items/NPCs/places (e.g. "Abyssal whip", "Lumbridge").
  Trademarked / IP. Our project is already correctly themed as *original* ("Gloom Wolf", "Crypt
  Skeleton") — keep inventing our own names.
- Jagex's **Fan Content Policy** grants Jagex broad rights over anything you build with their IP and
  is **non-commercial**; building on their IP entangles us in that license. Avoid entirely.

**Usable with care:**

- **Game mechanics, formulas, and numbers** (XP curve, max-hit math, tick length, drop-rate math)
  are **facts/ideas, not copyrightable expression**. We can reimplement the *formulas* and use the
  *numeric thresholds* freely (this document does). We should not copy wiki *prose* verbatim.
- **OSRS Wiki text** is licensed **CC BY-NC-SA** (post-2018 content; some older content is CC BY-SA).
  NC = **non-commercial** and SA = **share-alike (copyleft)** — so we must **not** paste wiki prose
  into a commercial product, and any verbatim text would force CC BY-NC-SA on the derivative. Use
  the wiki to *learn* the mechanics, then express them in our own words/code (as here). Treating the
  numbers as facts and rewriting the explanation keeps us clear of the SA/NC obligations.
- **Open-source code** (RuneLite BSD-2, OpenRS2 ISC, Apollo/Hyperion) — permissive, but we are
  taking *architecture ideas*, not code, so no attribution obligation is triggered. If we ever copy
  a snippet, honor the (short, permissive) license headers.

**Bottom line:** reimplement mechanics and use numeric data; never ship Jagex assets or names;
don't paste wiki prose.

---

## Recommended adoptions for BrowserGame

Prioritized, mapped to files. Each is small and respects the anti-bloat doctrine.

**P0 — high value, low risk**

1. **Two-roll combat (accuracy + max-hit).** Add `attack`/`strength`/`defence` to players
   (`src/server/progression.ts` → a stats helper) and to `MobTemplate` (`src/server/mobs.ts`);
   compute hit chance + `[0..maxHit]` damage with an injected RNG in `damageMob`/`damagePlayer`
   (`src/server/world.ts`). Mirrors `rollLoot`'s pure/testable style. *(§4)*
2. **Integer-tick cooldowns.** Add a gameplay tick counter to `World` and express
   `ABILITIES` speed and `MobTemplate.attackCooldownMs` as **tick intervals**
   (`src/shared/combat.ts`, `src/server/mobs.ts`). Replaces float `attackCd -= dt*1000` drift. *(§2)*
3. **Aggro from spawn anchor + combat-level gate.** In `stepMob`/`nearestTarget`
   (`src/server/mobs.ts`), measure aggro from the spawn point and only aggro when
   `playerLevel ≤ 2·mobLevel`. *(§5)*

**P1 — depth, moderate effort**

4. **Weighted single-roll + nested sub-tables in loot.** Extend `LootEntry`/`rollLoot`
   (`src/server/loot.ts`) with a weighted "main table" mode and a sub-table pointer for a shared
   rare table. Keep current independent rolls for "always" drops. *(§5)*
5. **Damage type + combat triangle multiplier.** Add `damageType` to `ABILITIES` and a resistance
   class to `MobTemplate`; apply a ×1.25/×0.8 triangle multiplier in damage resolution. *(§4)*
6. **Per-skill XP.** Split the single XP pool into per-skill XP keyed by the ability's
   `damageType`/skill (`src/server/progression.ts` + `world.ts` reward path). *(§5)*

**P2 — long-tail / optional**

7. **OSRS XP curve option.** Add a precomputed `XP_TABLE` generated from the OSRS formula and switch
   `xpForLevel`/`levelForXp` to table lookup + binary search if we want a long endgame
   (`src/server/progression.ts`). Otherwise keep the quadratic. *(§3)*
8. **Tolerance timer** (per-player, per-area 10-min passive) and **bad-luck protection** on the rare
   table. *(§5)*
9. **Handler registry** for client messages instead of a growing switch in `world.ts`/`index.ts`,
   à la Apollo. Only if the message set grows. *(§1)*

**Explicitly not recommended:** quantizing movement to 600 ms ticks (we're an action game, not
tile-based); copying any Jagex asset/name; pasting wiki prose.

---

## Sources

- RuneLite — https://github.com/runelite/runelite , https://runelite.net/
- OpenRS2 (server + cache/data tooling) — https://github.com/openrs2/openrs2 , https://archive.openrs2.org/
- 2003scape (RSC server/client in JS) — https://github.com/2003scape/rsc-server , https://github.com/2003scape/rsc-client , https://2003scape.github.io/
- Hyperion (317 emulator, Action/ActionQueue) — https://github.com/Rune-Server/hyperion
- Apollo (modular plugin server, packet split) — https://github.com/apollo-rsps/apollo
- Game tick — https://oldschool.runescape.wiki/w/Game_tick
- Attack speed — https://oldschool.runescape.wiki/w/Attack_speed
- Tick manipulation — https://oldschool.runescape.wiki/w/Tick_manipulation
- Experience / XP formula & table — https://oldschool.runescape.wiki/w/Experience
- Maximum melee hit — https://oldschool.runescape.wiki/w/Maximum_melee_hit
- Strength — https://oldschool.runescape.wiki/w/Strength
- DPS / accuracy formulas — https://oldschool.runescape.wiki/w/Damage_per_second/Melee
- Combat & combat triangle — https://oldschool.runescape.wiki/w/Combat , https://oldschool.runescape.wiki/w/Combat_triangle
- Defence (how defence/accuracy works) — https://www.theoatrix.net/post/how-defence-works-in-osrs
- Rare drop table — https://oldschool.runescape.wiki/w/Rare_drop_table
- Gem drop table — https://oldschool.runescape.wiki/w/Gem_drop_table
- Drop table — https://oldschool.runescape.wiki/w/Drop_table
- RSPS drop-rate / weighting guide — https://rspsinsider.com/guides/rsps-drop-rate-guide/
- Aggressiveness — https://oldschool.runescape.wiki/w/Aggressiveness
- Tolerance — https://oldschool.runescape.wiki/w/Tolerance
- NPC aggression timer (RuneLite wiki) — https://github.com/runelite/runelite/wiki/NPC-Aggression-Timer
- Jagex Fan Content Policy — https://legal.jagex.com/docs/policies/fan-content-policy
- RuneScape Wiki licensing (CC BY-NC-SA / CC BY-SA) — https://runescape.wiki/w/Forum:CC_licensing , https://meta.weirdgloop.org/w/Meta:Copyrights

> Note: a couple of source pages (tritecode XP table; some Fandom mirrors) returned HTTP↔HTTPS
> redirect loops to the fetcher; the XP thresholds here were taken from the OSRS Wiki Experience
> page and verified against the canonical formula.
