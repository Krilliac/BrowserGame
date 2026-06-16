# Stat Expansion (Slice 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Per-element damage %, resistance penetration, AoE & ailment effectiveness stats, non-gem (affix/runeword/skill) sources for the Slice-2 behavior modifiers, and `knockback` as a spell behavior. Reuses `recomputeStats` + the damage/ailment pipeline.

**Tech Stack:** TS strict, Node `ws`, better-sqlite3, Vitest. Gate: `NODE_OPTIONS=--use-system-ca npm run check`. Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `loop/autonomous-20260614`. Push only at the end.

**DEFERRED (no partial code):** beam (hitscan), lob (ground-target — needs aim-point protocol), trail (ground-zone entity), orbit (caster-attached). Logged as next roadmap items.

## File structure
- `src/shared/items.ts` — new AffixStats, names, rollable set, ranges.
- `src/server/world.ts` — Player fields; recomputeStats accumulation; cast per-element damage; penetration + ailment-mult at hit sites.
- `src/server/combat-formulas.ts` — `resistedDamage` penetration param.
- `src/shared/skilltree.ts` — `SkillEffects` chain/pierce/fork/spellaoe fields.
- `src/shared/combat.ts` — `BehaviorSpec` knockback variant.
- `src/server/projectile-behaviors.ts` / `world.ts` — knockback behavior handling.
- `src/server/db/editable.ts`, `src/shared/gems.test.ts` — allow-lists/valid-stats.
- content seed (`seed.ts`/effects) + tests + `CHANGELOG.md`.

---

## Task 1: New AffixStats + rollable promotion + player fields

**Files:** `src/shared/items.ts`, `src/server/db/editable.ts`, `src/shared/gems.test.ts`, `src/server/world.ts`

- [ ] **Step 1:** In `items.ts`, add to the `AffixStat` union: `'firedmg' | 'colddmg' | 'lightningdmg' | 'poisondmg' | 'physdmg' | 'penetration' | 'ailmentdur' | 'ailmentmag'`.
- [ ] **Step 2:** Add exhaustive `DEFAULT_AFFIX_NAMES` entries for all 8 (match the existing AffixName shape — e.g. tiered name templates like the others; copy the structure of an existing entry like `power`). Also confirm the Slice-2 stats `chain/pierce/fork/spellaoe` already have names (they do).
- [ ] **Step 3:** Make rollable: add to `RollableStat` and the `AFFIX_STATS` array, and add `DEFAULT_AFFIX_RANGES` entries: `firedmg/colddmg/lightningdmg/poisondmg/physdmg` → `{min:3,max:8}`; `penetration` → `{min:3,max:8}`; `ailmentdur` → `{min:5,max:12}`; `ailmentmag` → `{min:4,max:10}`. ALSO promote `chain`→`{min:1,max:1}`, `pierce`→`{min:1,max:1}`, `fork`→`{min:1,max:1}`, `spellaoe`→`{min:8,max:18}` (add them to `RollableStat`/`AFFIX_STATS`/`DEFAULT_AFFIX_RANGES`). NOTE: element-damage/penetration/spellaoe values are PERCENTS stored as whole numbers (e.g. 5 = 5%); the apply code divides by 100. chain/pierce/fork are integer counts (use them directly). Keep `rollAffixes`'s rarity scaling — but chain/pierce/fork should NOT scale by rarity into huge numbers; if `rollAffixes` multiplies by `statMult`, special-case chain/pierce/fork to a flat 1 (like `multishot` is special-cased) so they don't become 3-4 from rarity. READ how `multishot` is special-cased and mirror it for chain/pierce/fork.
- [ ] **Step 4:** `editable.ts`: add the 8 new stats (and chain/pierce/fork/spellaoe if not present) to the gem/affix stat allow-lists. `gems.test.ts`: add the new stats to `VALID_STATS`.
- [ ] **Step 5:** `world.ts` `Player` struct: add `elemDamage: Record<DamageElement, number>; penetration: number; ailmentDuration: number; ailmentMagnitude: number;`. Initialize in `spawn()`: `elemDamage: { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0 }, penetration: 0, ailmentDuration: 0, ailmentMagnitude: 0`. Import `DamageElement` if needed.
- [ ] **Step 6:** `NODE_OPTIONS=--use-system-ca npx tsc -p tsconfig.json --noEmit` → resolve exhaustiveness (DEFAULT_AFFIX_NAMES must cover all union members; the Player literal must init the new fields). `npm run check` — may need the recompute (Task 2) before tests pass if a test asserts affix coverage; if only recompute-related, that's Task 2 — but the new Player fields are initialized so tsc passes and nothing reads them yet. Commit: `feat(items): element-damage/penetration/ailment AffixStats + rollable chain/pierce/fork/spellaoe + player fields (slice 4)`

---

## Task 2: recomputeStats accumulation (incl. non-gem modifier sources)

**Files:** `src/server/world.ts`, `src/shared/skilltree.ts`

- [ ] **Step 1:** `skilltree.ts`: add `chain?: number; pierce?: number; fork?: number; spellaoe?: number` to `SkillEffects` + `zeroEffects()`. (`aggregateSkillEffects` sums dynamic keys, so a node with these effects then aggregates.)
- [ ] **Step 2:** `world.ts` `recomputeStats`: declare accumulators near the others:
```ts
    const elemDamage: Record<DamageElement, number> = { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0 };
    let penetration = 0, ailmentDuration = 0, ailmentMagnitude = 0;
```
- [ ] **Step 3:** In the AFFIX dispatch block, add arms (values are percents → divide by 100 into the fraction stats):
```ts
        else if (a.stat === 'firedmg') elemDamage.fire += a.value / 100;
        else if (a.stat === 'colddmg') elemDamage.cold += a.value / 100;
        else if (a.stat === 'lightningdmg') elemDamage.lightning += a.value / 100;
        else if (a.stat === 'poisondmg') elemDamage.poison += a.value / 100;
        else if (a.stat === 'physdmg') elemDamage.physical += a.value / 100;
        else if (a.stat === 'penetration') penetration += a.value / 100;
        else if (a.stat === 'ailmentdur') ailmentDuration += a.value / 100;
        else if (a.stat === 'ailmentmag') ailmentMagnitude += a.value / 100;
        else if (a.stat === 'chain') chainAdd += a.value;
        else if (a.stat === 'pierce') pierceAdd += a.value;
        else if (a.stat === 'fork') forkAdd += a.value;
        else if (a.stat === 'spellaoe') spellAoe += a.value / 100;
```
(The `chainAdd/pierceAdd/forkAdd/spellAoe` locals already exist from Slice 2 — fold these in. Note spellaoe affix value is a percent → /100, consistent with the gem spellaoe which is stored as a fraction like 0.2; VERIFY the gem spellaoe magnitude convention and make the affix match — read how gems' spellaoe value is summed in Slice 2 and keep the SAME unit so `applyModifiers` treats them identically.)
- [ ] **Step 4:** Add the SAME `chain/pierce/fork/spellaoe` arms to the RUNEWORD and SET-BONUS dispatch blocks (so runewords/sets can grant them). For the SKILL block, since `aggregateSkillEffects` returns an object with the new `chain/pierce/fork/spellaoe` keys, add `chainAdd += skill.chain ?? 0;` etc. after the existing skill assignments.
- [ ] **Step 5:** Assign finals: `player.elemDamage = elemDamage; player.penetration = penetration; player.ailmentDuration = ailmentDuration; player.ailmentMagnitude = ailmentMagnitude;` (near the other `player.* =` lines).
- [ ] **Step 6:** `npm run check` → green. Commit: `feat(combat): recomputeStats sources for element-damage/penetration/ailment + non-gem chain/pierce/fork/spellaoe (slice 4)`

---

## Task 3: per-element damage at cast + penetration at resist

**Files:** `src/server/combat-formulas.ts`, `src/server/world.ts`

- [ ] **Step 1:** `combat-formulas.ts`: extend `resistedDamage`:
```ts
export function resistedDamage(damage: number, element: DamageElement, resists: ResistMap, penetration = 0): number {
  const r = Math.max(-1, Math.min(1, (resists[element] ?? 0) - penetration));
  return Math.max(0, Math.round(damage * (1 - r)));
}
```
(Default `penetration=0` → identical to before. Update its test if it asserts the signature.)
- [ ] **Step 2:** `world.ts` melee cast (`~2528`): multiply the computed damage by the element bonus:
```ts
          const elem = ability.element ?? 'physical';
          const power = (ability.damage + player.power) * rankMult * mightMult * (1 + player.elemDamage[elem]);
          ...
          const finalDmg = resistedDamage(dmg, elem, getContent().mobResists(mob.templateId), player.penetration);
```
- [ ] **Step 3:** `world.ts` projectile cast (`~2577`): multiply `proj.damage` by `(1 + player.elemDamage[ability.element ?? 'physical'])`. Then in `applyProjectileDamage` (`~3656`), pass penetration: look up the owner player by `proj.ownerId` (`this.players.get(proj.ownerId)`), and call `resistedDamage(dmg, element, resists, owner?.penetration ?? 0)`. (Element is already re-fetched there.)
- [ ] **Step 4:** `npm run check` → green (no-regression: elemDamage default 0, penetration default 0). Commit: `feat(combat): per-element damage scaling at cast + resistance penetration (slice 4)`

---

## Task 4: ailment effectiveness (duration + magnitude)

**Files:** `src/server/world.ts`

- [ ] **Step 1:** Change `applyStatus` to accept optional mods:
```ts
function applyStatus(mob: { statuses: StatusSet }, abilityId: AbilityId, mods?: { durMult: number; magMult: number }): void {
  const dm = mods?.durMult ?? 1;
  const mm = mods?.magMult ?? 1;
  for (const e of getContent().abilityStatusEffects(abilityId)) {
    mob.statuses.apply(e.effect, e.ms * dm, e.magnitude * mm);
  }
}
```
- [ ] **Step 2:** At the melee hit site (`~2539`) pass `{ durMult: 1 + player.ailmentDuration, magMult: 1 + player.ailmentMagnitude }`. At the projectile hit site (`applyProjectileDamage`, `~3663`), look up the owner (`this.players.get(proj.ownerId)`) and pass its ailment mults (default 1/1 if absent). `applyPlayerDebuff` (mob→player) stays unscaled (mobs don't have these stats) — leave it.
- [ ] **Step 3:** `npm run check` → green (default 1/1 = no-regression). Commit: `feat(combat): ailment effectiveness (duration/magnitude) scaling (slice 4)`

---

## Task 5: knockback as a spell behavior

**Files:** `src/shared/combat.ts`, `src/server/projectile-behaviors.ts`, `src/server/world.ts`

- [ ] **Step 1:** `combat.ts`: add `| { type: 'knockback'; px: number }` to `BehaviorSpec`.
- [ ] **Step 2:** Simplest integration (no change to the pure `resolveHit` return shape): in `world.ts` `tickProjectiles` on-hit block, AFTER applying primary damage and BEFORE/around the existing resolveHit handling, check `if (proj.behaviors.some(b => b.type === 'knockback')) { const kb = proj.behaviors.find(b => b.type === 'knockback'); this.knockbackMob(hit, proj.x, proj.y, kb.px); }`. (Reuse the existing `knockbackMob`. The hit mob + projectile position are in scope there.) Keep it minimal — do NOT thread it through the pure module unless clean.
- [ ] **Step 3:** Assign a knockback behavior to a thematic projectile ability: in `combat.ts` ABILITY_DEFS, add `{ type: 'knockback', px: 50 }` to one heavy projectile's `behaviors` (e.g. a rock/boulder bolt or `wyrmfire_lance` — pick one that exists and reads as forceful). Keep one or two only.
- [ ] **Step 4:** `npm run check` → green. Add a world test: a projectile ability with knockback displaces a surviving mob (mirror world-cc.test.ts knockback test — boost mob hp, position player, cast, assert distance grew; use a bounded retry for the RNG hit). Commit: `feat(combat): knockback as a spell behavior + assign to a heavy bolt (slice 4)`

---

## Task 6: content seed for new affixes + tests

**Files:** `src/server/db/seed.ts` (affix ranges/names), tests

- [ ] **Step 1:** Ensure the new affix ranges + names seed onto existing DBs. READ how `affix_ranges`/`affix_names` are seeded (the `DEFAULT_AFFIX_RANGES`/`DEFAULT_AFFIX_NAMES` seed path). It should `INSERT OR IGNORE` every boot (new stat rows are new → they insert on an existing game.db). VERIFY; if it only seeds when empty, add an idempotent ensure (mirror Slice 1/2/3 lessons). No migration needed (no new columns; stat columns are TEXT).
- [ ] **Step 2:** (Optional polish) add a couple of gems/runeword bonuses/skill nodes granting the new stats so they're obtainable beyond random affixes — at minimum the affixes roll. Keep modest.
- [ ] **Step 3:** Tests:
  - `combat-formulas.test.ts`: `resistedDamage(100, 'fire', {fire:0.5}, 0)` = 50; with penetration 0.3 → resist 0.2 → 80; penetration that exceeds resist floors at resist 0 (not negative beyond −1).
  - a world/recompute test: equip an item whose affix is `firedmg` (or inject via the affix path the other tests use) → `playerStats().elemDamage.fire` rises; `penetration` affix → `playerStats().penetration` rises; `chain` affix → `chainAdd` rises (non-gem source).
  - an ailment-effectiveness test: a player with `ailmentDuration`/`ailmentMagnitude` applies a longer/stronger ailment than baseline (compare `mob.statuses` remaining/magnitude, or hp drop over time).
  Use the existing harnesses (content-affixes.test.ts pattern for affix overlay; world-modifier-gems.test.ts for the equip→stat path).
- [ ] **Step 4:** `npm run check` → green. Commit: `feat(content)+test: seed new affixes + stat-expansion integration tests (slice 4)`

---

## Task 7: balance pass + changelog + push

- [ ] **Step 1:** Light balance review: confirm the new affix ranges are modest (single-digit % mostly), penetration can't make damage absurd (resist still floors), ailment effectiveness reasonable. Tune any obviously-off number. Keep it light — no overhaul.
- [ ] **Step 2:** `CHANGELOG.md` `### Added` bullet: per-element damage, penetration, AoE/ailment effectiveness stats; affix/runeword/skill sources for chain/pierce/fork/spellaoe; knockback behavior; note beam/lob/trail/orbit deferred.
- [ ] **Step 3:** `NODE_OPTIONS=--use-system-ca npm run check` → fully green. Confirm the dev server booted clean (`/tmp/devserver3.log`).
- [ ] **Step 4:** Commit `docs: changelog for stat expansion (slice 4)` and `git push origin loop/autonomous-20260614`.

---

## Self-review notes
- Coverage: AffixStats+player fields (T1); recompute incl. non-gem modifier sources (T2); per-element damage + penetration (T3); ailment effectiveness (T4); knockback behavior (T5); content+tests (T6); balance+ship (T7). Beam/lob/trail/orbit deferred (no partial code).
- No-regression: every new stat neutral at default (0 / 1 mult / empty map → elemDamage[x]=0). resistedDamage penetration default 0. applyStatus mods default 1/1.
- No protocol/schema change (server-side computed stats; TEXT stat columns accept new rows via INSERT OR IGNORE).
- Determinism: only the existing seeded affix roll; all apply math deterministic.
