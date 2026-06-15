# Modifier Gems (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Socket modifier gems into gear to add chain/pierce/fork/AoE/homing to all your casts, plus support gems that trade base spell damage for a bigger behavior bonus — reusing the existing gem/socket/stat pipeline.

**Architecture:** New behavior-modifier `AffixStat`s + player stats accumulate from gems in `recomputeStats` (exactly like `multishot`); a pure `applyModifiers` merges them into the ability's `behaviors` list at cast; a `mult` field on gems drives the spell-damage tradeoff. `gems.mult` is a new nullable column with migration #4.

**Tech Stack:** TS strict, Node `ws` sim, better-sqlite3, Vitest. Gate: `NODE_OPTIONS=--use-system-ca npm run check`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `loop/autonomous-20260614`. Do not push until the final task.

## File structure
- Modify `src/shared/items.ts` — new `AffixStat` values.
- Modify `src/shared/gems.ts` — `GemDef.mult`; `gemBonuses` returns new fields; new gem families.
- Modify `src/server/db/editable.ts` — gem-stat enum.
- Create `src/server/spell-modifiers.ts` (+ test) — pure `applyModifiers`.
- Modify `src/server/world.ts` — `Player` stat fields; `recomputeStats` accumulation; cast merge + damage mult.
- Modify `src/server/db/schema.ts`, `migrate.ts`, `seed.ts`, `content.ts` — `gems.mult` column/migration/seed/overlay.
- Tests: `gems.test.ts`, `content-gems.test.ts`, a socket-integration test.

---

## Task 1: New modifier `AffixStat`s + player stat fields

**Files:** `src/shared/items.ts`, `src/server/db/editable.ts`, `src/server/world.ts`

- [ ] **Step 1:** In `src/shared/items.ts`, find the `AffixStat` union (it lists `power|hp|crit|multishot|lifesteal|swift|move|armor|vigor|frail|fragile`). Add `chain | pierce | fork | spellaoe` to the union. Do NOT add them to `DEFAULT_AFFIX_RANGES` (gem-sourced only this slice).
- [ ] **Step 2:** In `src/server/db/editable.ts`, find the gem-stat enum/allow-list (~line 373, the valid gem `AffixStat` values) and add `'chain', 'pierce', 'fork', 'spellaoe'`.
- [ ] **Step 3:** In `src/server/world.ts`, find the `Player` interface computed-stat block (~line 434-455, has `multishot`, `lifesteal`, etc.). Add:
```ts
  chainAdd: number;
  pierceAdd: number;
  forkAdd: number;
  spellAoe: number;
  homingAdd: number;
  spellDamageMult: number;
```
Then find where these defaults are initialized for a new player (search where `multishot: 0` or the stat struct is built — likely in player creation AND/OR reset at the top of `recomputeStats`). Initialize `chainAdd:0, pierceAdd:0, forkAdd:0, spellAoe:0, homingAdd:0, spellDamageMult:1` everywhere `multishot` is initialized.
- [ ] **Step 4:** `NODE_OPTIONS=--use-system-ca npx tsc -p tsconfig.json --noEmit` → expect errors ONLY where the new required Player fields aren't set yet (fixed in Task 4) — OR 0 if you initialized them at recompute. Resolve any "missing property" by initializing at the same spot `multishot` is. Then `npm run check` may still fail until Task 4 sets them in recompute; that's OK — at minimum tsc should pass once every Player literal has the fields.
- [ ] **Step 5:** Commit: `feat(items): modifier-gem AffixStats + player behavior-modifier stat fields (slice 2)`

---

## Task 2: Pure `spell-modifiers.ts` + tests (keystone)

**Files:** Create `src/server/spell-modifiers.ts`, `src/server/spell-modifiers.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/server/spell-modifiers.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { BehaviorSpec } from '../shared/combat.js';
import { applyModifiers, type SpellMods } from './spell-modifiers.js';

const NONE: SpellMods = { chainAdd: 0, pierceAdd: 0, forkAdd: 0, spellAoe: 0, homingAdd: 0 };

describe('applyModifiers', () => {
  it('returns an equivalent list when there are no modifiers', () => {
    const b: BehaviorSpec[] = [{ type: 'chain', count: 3, range: 150, falloff: 0.75 }];
    expect(applyModifiers(b, NONE)).toEqual(b);
  });

  it('increases an existing chain count', () => {
    const b: BehaviorSpec[] = [{ type: 'chain', count: 3, range: 150, falloff: 0.75 }];
    const out = applyModifiers(b, { ...NONE, chainAdd: 2 });
    expect(out.find((x) => x.type === 'chain')).toMatchObject({ count: 5 });
  });

  it('adds a chain behavior to a spell that lacks one', () => {
    const out = applyModifiers([], { ...NONE, chainAdd: 2 });
    expect(out).toEqual([{ type: 'chain', count: 2, range: 150, falloff: 0.75 }]);
  });

  it('adds pierce and fork when missing', () => {
    const out = applyModifiers([], { ...NONE, pierceAdd: 1, forkAdd: 2 });
    expect(out).toContainEqual({ type: 'pierce', count: 1, falloff: 0.9 });
    expect(out).toContainEqual({ type: 'fork', count: 2, spreadRad: 0.35, falloff: 0.6 });
  });

  it('scales an existing splash radius by spellAoe but does NOT add splash to a non-splash spell', () => {
    const withSplash: BehaviorSpec[] = [{ type: 'splash', radius: 60, scale: 0.5 }];
    const out = applyModifiers(withSplash, { ...NONE, spellAoe: 0.5 });
    expect(out.find((x) => x.type === 'splash')).toMatchObject({ radius: 90, scale: 0.5 });
    // a bolt with no splash stays splash-less
    expect(applyModifiers([], { ...NONE, spellAoe: 0.5 })).toEqual([]);
  });

  it('adds homing when homingAdd>0 and none present', () => {
    const out = applyModifiers([], { ...NONE, homingAdd: 1 });
    expect(out).toEqual([{ type: 'homing', turnRate: 3.5, acquireRange: 220 }]);
  });

  it('does not duplicate a behavior the spell already has (homing)', () => {
    const b: BehaviorSpec[] = [{ type: 'homing', turnRate: 3.5, acquireRange: 220 }];
    expect(applyModifiers(b, { ...NONE, homingAdd: 1 })).toEqual(b);
  });
});
```
- [ ] **Step 2:** Run it → FAIL (module missing).
- [ ] **Step 3: Implement.** Create `src/server/spell-modifiers.ts`:
```ts
/**
 * Pure merge of player gem modifiers into an ability's behavior list (Slice 2). Framework-free and
 * deterministic. The world reads the player's gem-derived modifier stats and calls this at cast to
 * produce the effective behavior list before initialCharges. Increases an existing matching behavior
 * or adds a missing one; splash AoE is a radius multiplier on real splash only (never granted to a
 * single-target bolt). `multishot` and the spell-damage `mult` are handled by the caller.
 */
import type { BehaviorSpec } from '../shared/combat.js';

export interface SpellMods {
  chainAdd: number;
  pierceAdd: number;
  forkAdd: number;
  spellAoe: number;
  homingAdd: number;
}

export function applyModifiers(behaviors: BehaviorSpec[], mods: SpellMods): BehaviorSpec[] {
  // Deep-clone so we never mutate the ability's shared behavior objects.
  const out: BehaviorSpec[] = behaviors.map((b) => ({ ...b }));

  if (mods.chainAdd > 0) {
    const c = out.find((b) => b.type === 'chain');
    if (c && c.type === 'chain') c.count += mods.chainAdd;
    else out.push({ type: 'chain', count: mods.chainAdd, range: 150, falloff: 0.75 });
  }
  if (mods.pierceAdd > 0) {
    const p = out.find((b) => b.type === 'pierce');
    if (p && p.type === 'pierce') p.count += mods.pierceAdd;
    else out.push({ type: 'pierce', count: mods.pierceAdd, falloff: 0.9 });
  }
  if (mods.forkAdd > 0) {
    const f = out.find((b) => b.type === 'fork');
    if (f && f.type === 'fork') f.count += mods.forkAdd;
    else out.push({ type: 'fork', count: mods.forkAdd, spreadRad: 0.35, falloff: 0.6 });
  }
  if (mods.spellAoe > 0) {
    const s = out.find((b) => b.type === 'splash');
    if (s && s.type === 'splash') s.radius = Math.round(s.radius * (1 + mods.spellAoe));
  }
  if (mods.homingAdd > 0 && !out.some((b) => b.type === 'homing')) {
    out.push({ type: 'homing', turnRate: 3.5, acquireRange: 220 });
  }
  return out;
}
```
- [ ] **Step 4:** Run the test → PASS. Run `npm run check` (fix prettier if needed).
- [ ] **Step 5:** Commit: `feat(combat): pure applyModifiers spell-modifier merge + tests (slice 2)`

---

## Task 3: GemDef.mult + gemBonuses + new gem families

**Files:** `src/shared/gems.ts`

- [ ] **Step 1:** Add `mult?: number` to the `GemDef` interface (optional; default-1 spell-damage multiplier).
- [ ] **Step 2:** Find the return type of `gemBonuses` (the object with `power, hp, crit, multishot, lifesteal, swift, move, armor, vigor`). Add `chain: number; pierce: number; fork: number; spellaoe: number; homing: number; mult: number` to it. Initialize `chain:0,pierce:0,fork:0,spellaoe:0,homing:0,mult:1`. In the per-gem switch/dispatch that adds `value` to the matching stat, add cases for the new stats (`chain`,`pierce`,`fork`,`spellaoe`,`homing` → add value to that field), and for EVERY gem also do `acc.mult *= gem.mult ?? 1`. (Read the existing dispatch carefully — match its structure.)
- [ ] **Step 3:** Add the new families to `DEFAULT_GEMS` (3 tiers each, id `<family>_t<n>`), following the existing entry shape exactly:
```
voltaic  (stat 'chain',   color #9b6bff): t1 v1, t2 v1, t3 v2
lancing  (stat 'pierce',  color #cfd6e6): t1 v1, t2 v2, t3 v2
splitting(stat 'fork',    color #ff9a4d): t1 v1, t2 v1, t3 v2
concussive(stat 'spellaoe',color #ffd24a):t1 v0.2, t2 v0.35, t3 v0.5
seeking  (stat 'homing',  color #5fd0a0): t1 v1, t2 v1, t3 v1
overcharge(stat 'chain',  color #ff4d7a): t3 v3, mult 0.8   (T3 only — support gem)
impaler  (stat 'pierce',  color #b0b0c0): t3 v3, mult 0.85  (T3 only — support gem)
```
Give each a sensible `name` matching the file's naming style (e.g. "Voltaic Gem", "Overcharge Gem"). The single-tier support gems (overcharge/impaler) only need their t3 entry — match how `diamond` (multishot, t3-only) is defined.
- [ ] **Step 4:** Update `src/shared/gems.test.ts`: add `'chain','pierce','fork','spellaoe','homing'` to its `VALID_STATS` set so the catalog-integrity loop accepts the new families. Run `NODE_OPTIONS=--use-system-ca npx vitest run src/shared/gems.test.ts` → pass.
- [ ] **Step 5:** `npm run check` (the recompute won't read the new gemBonuses fields yet — Task 4 — but tsc/tests should pass as gemBonuses just returns extra fields). Commit: `feat(content): modifier + support gem families and gemBonuses fields (slice 2)`

---

## Task 4: recomputeStats accumulation + cast merge + damage mult

**Files:** `src/server/world.ts`

- [ ] **Step 1:** In `recomputeStats` (~line 1979), where the gem loop does `const gems = gemBonuses(...); power += gems.power; ...` (~2012-2021), add accumulation of the new stats into locals (declare `let chainAdd=0, pierceAdd=0, forkAdd=0, spellAoe=0, homingAdd=0, spellDamageMult=1;` near the other stat locals at the top of the function):
```ts
        chainAdd += gems.chain;
        pierceAdd += gems.pierce;
        forkAdd += gems.fork;
        spellAoe += gems.spellaoe;
        homingAdd += gems.homing;
        spellDamageMult *= gems.mult;
```
- [ ] **Step 2:** Where the function assigns finals to `player.*` (e.g. `player.multishot = multishot`), add:
```ts
    player.chainAdd = chainAdd;
    player.pierceAdd = pierceAdd;
    player.forkAdd = forkAdd;
    player.spellAoe = spellAoe;
    player.homingAdd = homingAdd;
    player.spellDamageMult = spellDamageMult;
```
- [ ] **Step 3:** In the cast projectile branch (~line 2481-2488), import `applyModifiers` from `'./spell-modifiers.js'` and use it. Change:
```ts
      const carried = behaviors.filter((b) => b.type !== 'multishot');
```
to:
```ts
      const carried = applyModifiers(
        behaviors.filter((b) => b.type !== 'multishot'),
        {
          chainAdd: player.chainAdd,
          pierceAdd: player.pierceAdd,
          forkAdd: player.forkAdd,
          spellAoe: player.spellAoe,
          homingAdd: player.homingAdd,
        },
      );
```
- [ ] **Step 4:** Apply the spell-damage tradeoff multiplier to projectile damage. In the same branch, the spawned projectile's `damage` is `(ability.damage + player.power) * rankMult * mightMult`. Multiply by `player.spellDamageMult`:
```ts
          damage: (ability.damage + player.power) * rankMult * mightMult * player.spellDamageMult,
```
- [ ] **Step 5:** `npm run check` → green. Manually reason: a player with no modifier gems has chainAdd…=0 and spellDamageMult=1, so `applyModifiers` returns the same list and damage is unchanged (no regression). Commit: `feat(combat): aggregate gem modifiers + merge into casts with damage tradeoff (slice 2)`

---

## Task 5: gems.mult column + migration #4 + seed + overlay

**Files:** `src/server/db/schema.ts`, `src/server/db/migrate.ts`, `src/server/db/seed.ts`, `src/server/content.ts`

- [ ] **Step 1:** `schema.ts`: add `mult REAL` (nullable) to the `gems` table (~line 398).
- [ ] **Step 2:** `migrate.ts`: append migration version 4, name `gem-mult`: `if (hasTable(db, 'gems')) ensureColumns(db, 'gems', { mult: 'REAL' });`
- [ ] **Step 3:** `seed.ts`: in the gems INSERT (~line 456) add `mult` to columns + bind `g.mult ?? null`. (Match the existing positional/named style; gems use `INSERT OR IGNORE` — so existing rows won't update. ALSO add an idempotent backfill `UPDATE gems SET mult=? WHERE id=? AND mult IS NULL` in the ensure chain — mirror `ensureAbilityBehaviors` from Slice 1 — so existing DBs get mult on the support gems.)
- [ ] **Step 4:** `content.ts`: where `gems()` builds `GemDef` rows from the `gems` table, read `mult`: `if (r.mult !== null) gem.mult = r.mult;` (and add `mult: number | null` to the gem row type). Verify the client overlay path carries `mult` (it ships the `GemDef[]` whole, so adding the field suffices).
- [ ] **Step 5:** `npm run check` → green. Commit: `feat(content): gems.mult column, migration #4, seed + overlay (slice 2)`

---

## Task 6: Integration tests + verify + changelog + push

**Files:** `src/server/world-spellbook.test.ts` (or a new `world-modifier-gems.test.ts`), `src/server/content-gems.test.ts`, `CHANGELOG.md`

- [ ] **Step 1:** Add a socket-integration test mirroring `world-spellbook.test.ts:315-353`: create a world + player, equip an item with a socket, grant `voltaic_t3`, `socketGem`, assert `playerStats().chainAdd >= 2`. Second case: socket `overcharge_t3`, assert `chainAdd` rose AND `spellDamageMult < 1`.
- [ ] **Step 2:** Add a `content-gems.test.ts` case: a SQL-inserted modifier gem with a `mult` overlays via `loadContent` and appears in `gems()` with the `mult`.
- [ ] **Step 3:** `NODE_OPTIONS=--use-system-ca npm run check` → fully green.
- [ ] **Step 4:** Reseed the dev DB so the new gems load: the gems seed is `INSERT OR IGNORE` + the ensure backfill, and migration #4 adds `gems.mult` — so a server restart applies them to the running `game.db` (tsx watch restarts on the source change). Confirm the dev server log shows a clean boot after the change.
- [ ] **Step 5:** Changelog: add an `### Added` bullet under `[Unreleased]` describing modifier gems (chain/pierce/fork/AoE/homing) + support gems (damage tradeoff). Commit: `docs: changelog for modifier gems (slice 2)`.
- [ ] **Step 6:** Push: `git push origin loop/autonomous-20260614`.

---

## Self-review notes
- Spec coverage: new stats (T1), pure merge (T2), gem catalog + mult (T3), aggregation+cast (T4), DB/migration (T5), tests+ship (T6). Tradeoff = `mult`<1 support gems. No affix/runeword sources (deferred). No protocol change.
- Backward compat: new stats default 0/1; absent gems → identical casts (verified by the no-op test + the T4 reasoning).
- Determinism: `applyModifiers` pure; clones behaviors (never mutates shared ability objects — important, since `getContent().ability()` returns shared objects).
