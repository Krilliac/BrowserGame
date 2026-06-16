# Ailments + CC (Slice 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A maximal element-signature ailment + crowd-control suite (ignite/poison/bleed/chill/shock/brittle/maim/sap/curse + stun/freeze/silence/knockback) on the existing pure `StatusSet`, with an expanded `flags` bitfield (JSON wire — no format restructure).

**Architecture:** Expand `StatusId`; `StatusSet` gains `vulnFactor`/`rooted`/`silenced`, summed slow/weaken, additive poison, and `dotDamage`. World applies a `vulnFactor` multiply to incoming damage, root/silence gates (mirroring `telegraphUntil`), and a one-shot knockback impulse. A shared `STATUS_BITS` table is the single source of truth for bit↔id (server snapshot + client render). Element-signature ailments seed into `ability_status_effects`.

**Tech Stack:** TS strict, Node `ws`, better-sqlite3, Vitest. Gate: `NODE_OPTIONS=--use-system-ca npm run check`. Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `loop/autonomous-20260614`. Push only at the end.

**DEFERRED (noted):** fear (mob flee) + taunt (forced retarget) — need attacker-id threading + bespoke AI state; out of this slice.

## File structure
- Create `src/shared/status-bits.ts` — `STATUS_BITS: Record<string, number>` (single source of truth) + the `StatusId` string list. Shared by server snapshot + client render.
- Modify `src/server/status-effects.ts` — expand `StatusId`, API.
- Modify `src/server/ability-effects.ts` — `StatusEffectKind` widen + element-signature seed rows + knockback map.
- Modify `src/server/db/editable.ts` — effect enum.
- Modify `src/server/world.ts` — incoming `vulnFactor`, dot rename, root/silence gates, knockback, snapshot flag builders.
- Modify `src/shared/protocol.ts` — flags doc + `PROTOCOL_VERSION` → 2.
- Modify `src/client/pixi-renderer.ts` + `src/client/main.ts` — tints + HUD pips via `STATUS_BITS`.
- Tests as listed per task.

---

## Task 1: `status-bits.ts` shared table + expand `StatusId`/enum/protocol

**Files:** create `src/shared/status-bits.ts`; modify `src/server/status-effects.ts`, `src/server/ability-effects.ts`, `src/server/db/editable.ts`, `src/shared/protocol.ts`

- [ ] **Step 1:** Create `src/shared/status-bits.ts`:
```ts
/**
 * Single source of truth for status → wire bit. The server builds EntityState.flags from these and
 * the client reads them back, so they never drift. Bits 1-64 are the legacy set (do not renumber).
 */
export const STATUS_BITS = {
  slow: 1,
  burn: 2,
  weaken: 4,
  might: 8,
  haste: 16,
  regen: 32,
  enrage: 64, // mob-only: might|haste
  stun: 128,
  freeze: 256,
  silence: 512,
  shock: 1024,
  poison: 2048,
  bleed: 4096,
  ignite: 8192,
  chill: 16384,
  brittle: 32768,
  maim: 65536,
  sap: 131072,
  curse: 262144,
} as const;
export type StatusBitName = keyof typeof STATUS_BITS;
```
- [ ] **Step 2:** In `src/server/status-effects.ts`, expand the `StatusId` union to:
`'slow' | 'burn' | 'weaken' | 'might' | 'haste' | 'regen' | 'ignite' | 'poison' | 'bleed' | 'chill' | 'shock' | 'brittle' | 'maim' | 'sap' | 'stun' | 'freeze' | 'silence' | 'curse'`.
- [ ] **Step 3:** In `src/server/ability-effects.ts`, widen `StatusEffectKind` (the content effect type) to the same set MINUS the buffs are separate — include every applicable debuff/ailment: `ignite|poison|bleed|chill|shock|brittle|maim|sap|stun|freeze|silence|curse` plus the existing `slow|burn|weaken`. (Buffs might/haste/regen stay in the cast-buff path, not here.)
- [ ] **Step 4:** In `src/server/db/editable.ts`, find the `ability_status_effects.effect` enum (`~286`, currently `['slow','burn','weaken']`) and add all the new effect kinds from Step 3.
- [ ] **Step 5:** In `src/shared/protocol.ts`, update the `EntityState.flags` doc comment to reference the full bit set (point at `status-bits.ts`), and bump `PROTOCOL_VERSION` from 1 to 2.
- [ ] **Step 6:** `NODE_OPTIONS=--use-system-ca npx tsc -p tsconfig.json --noEmit` — expect errors only where exhaustive switches over `StatusId`/`StatusEffectKind` now miss cases (fixed in Task 2). If `editable.test.ts` asserts the old enum, update it. Commit: `feat(status): status-bits SSOT + expanded StatusId/effect enum + protocol v2 (slice 3)`

---

## Task 2: `StatusSet` engine extension + tests (keystone)

**Files:** `src/server/status-effects.ts`, `src/server/status-effects.test.ts`

- [ ] **Step 1: extend the tests** — add to `status-effects.test.ts` (keep existing cases):
```ts
import { describe, expect, it } from 'vitest';
import { StatusSet } from './status-effects.js';

describe('StatusSet — ailments & CC', () => {
  it('dotDamage sums burn + ignite + poison + bleed', () => {
    const s = new StatusSet();
    s.apply('burn', 2000, 5);
    s.apply('ignite', 2000, 3);
    s.apply('bleed', 2000, 2);
    const { dotDamage } = s.tick(1000); // 1s
    expect(dotDamage).toBeCloseTo(10);
  });
  it('poison stacks additively (others refresh by max)', () => {
    const s = new StatusSet();
    s.apply('poison', 2000, 3);
    s.apply('poison', 2000, 3);
    expect(s.tick(1000).dotDamage).toBeCloseTo(6); // additive
    const s2 = new StatusSet();
    s2.apply('burn', 2000, 3);
    s2.apply('burn', 2000, 3);
    expect(s2.tick(1000).dotDamage).toBeCloseTo(3); // max-refresh, not additive
  });
  it('slowFactor folds slow + chill + maim', () => {
    const s = new StatusSet();
    s.apply('chill', 2000, 0.3);
    s.apply('maim', 2000, 0.2);
    expect(s.slowFactor()).toBeCloseTo(0.5);
  });
  it('weakenFactor folds weaken + sap + curse', () => {
    const s = new StatusSet();
    s.apply('sap', 2000, 0.2);
    s.apply('curse', 2000, 0.1);
    expect(s.weakenFactor()).toBeCloseTo(0.7);
  });
  it('vulnFactor raises incoming damage from shock + brittle + curse', () => {
    const s = new StatusSet();
    s.apply('shock', 2000, 0.25);
    s.apply('brittle', 2000, 0.15);
    expect(s.vulnFactor()).toBeCloseTo(1.25 * 1.15);
  });
  it('rooted on stun/freeze; silenced on stun/freeze/silence', () => {
    const a = new StatusSet();
    a.apply('stun', 1000, 1);
    expect(a.rooted()).toBe(true);
    expect(a.silenced()).toBe(true);
    const b = new StatusSet();
    b.apply('silence', 1000, 1);
    expect(b.rooted()).toBe(false);
    expect(b.silenced()).toBe(true);
  });
});
```
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement** in `status-effects.ts`:
  - Rename the `tick` result field `burnDamage` → `dotDamage`, summing magnitudes of `burn`,`ignite`,`poison`,`bleed` (each `magnitude * activeMs/1000`). Update the return type/interface.
  - In `apply`, special-case poison to **add** magnitude (`existing + new`, capped at a const e.g. `POISON_MAX = 20`) and refresh duration to max; all other statuses keep the existing max rule.
  - `slowFactor()`: `max(SLOW_FLOOR, 1 - (mag('slow') + mag('chill') + mag('maim')))` (clamp the sum so factor ≥ floor).
  - `weakenFactor()`: `max(WEAKEN_FLOOR, 1 - (mag('weaken') + mag('sap') + mag('curse')))`.
  - `vulnFactor()`: `(1 + mag('shock')) * (1 + mag('brittle') + mag('curse'))`.
  - `rooted()`: `has('stun') || has('freeze')`.
  - `silenced()`: `rooted() || has('silence')`.
  - Add a private `mag(id)` helper returning the magnitude or 0.
  - Keep `damageFactor()`/`cooldownFactor()`/`moveFactor()`/`regenHeal` as-is.
- [ ] **Step 4:** run tests → PASS. NOTE: renaming `burnDamage`→`dotDamage` breaks the two world.ts tick call sites — that's Task 3. For THIS task, also grep `burnDamage` and update only references inside `status-effects.ts`/its test. tsc may now error at world.ts (Task 3) — acceptable; but run `npx vitest run src/server/status-effects.test.ts` to confirm the unit tests pass.
- [ ] **Step 5:** Commit: `feat(status): StatusSet ailment/CC factors (dotDamage, vulnFactor, rooted, poison stacks) + tests (slice 3)`

---

## Task 3: incoming-damage vulnFactor + dotDamage rename in world.ts

**Files:** `src/server/world.ts`

- [ ] **Step 1:** Update the two tick sites to use `dotDamage`: player tick (`~2665`) `const { dotDamage } = player.debuffs.tick(...); if (dotDamage>0) this.damagePlayer(player, dotDamage, true);` and mob tick (`~2931`) `const { dotDamage, regenHeal } = mob.statuses.tick(...); if (dotDamage>0) this.damageMob(...)`. Grep `burnDamage` to catch all.
- [ ] **Step 2:** Apply `vulnFactor` to incoming damage. In `damageMob(mob, amount, …)`, multiply `amount` by `mob.statuses.vulnFactor()` at the top (before reductions). In `damagePlayer(player, amount, …)`, multiply by `player.debuffs.vulnFactor()`. Round as the surrounding code does. (This is the shock/brittle/curse payoff.)
- [ ] **Step 3:** `NODE_OPTIONS=--use-system-ca npm run check` → green (existing tests still pass; vulnFactor is 1 when no shock/brittle/curse → no regression). Commit: `feat(combat): incoming-damage vulnFactor + dotDamage wiring (slice 3)`

---

## Task 4: control gates (stun/freeze root, silence) + knockback impulse

**Files:** `src/server/world.ts`, `src/server/ability-effects.ts`

- [ ] **Step 1: mob root.** In `tickMobs`, right after `const { dotDamage, regenHeal } = mob.statuses.tick(...)` and the death check, add: `if (mob.statuses.rooted()) continue;` (skips all movement + attack for this mob this tick — mirrors the `telegraphUntil` root). Place it BEFORE the movement/AI block but AFTER dot/regen application so a stunned mob still burns.
- [ ] **Step 2: mob silence.** In the mob cast/attack path (`castMobSpell` / `executeMobAttack`), add at the top `if (mob.statuses.silenced()) return;` for the CAST path only (a silenced mob can still melee — gate only spell casts; leave melee). If the structure makes melee-vs-cast hard to separate, gate the cast function only.
- [ ] **Step 3: player root + silence.** In `tickPlayers` where player input movement is applied, gate movement on `!player.debuffs.rooted()` (a rooted player doesn't move). In `cast` (player), add at the very top: `if (player.debuffs.silenced()) return;` (rooted ⊂ silenced, so this also blocks a stunned player from casting).
- [ ] **Step 4: knockback.** In `ability-effects.ts`, add `export const ABILITY_KNOCKBACK: Record<string, number> = { /* abilityId: pushPx */ };` seed a few (e.g. a `crushing_smash`/`galeburst`/boss slam → 60-90). In `world.ts`, add a helper `private knockbackMob(mob, fromX, fromY, px)` that displaces the mob away from (fromX,fromY) by `px`, clamped via the same collision the sim uses (`resolveCircleMove` or clamp to bounds + blockers). Call it at melee-hit and projectile-hit sites when `ABILITY_KNOCKBACK[abilityId]` is set (after damage). Keep it one-shot, deterministic.
- [ ] **Step 5:** `NODE_OPTIONS=--use-system-ca npm run check` → green. Add a small world test: apply `stun` to a mob, tick, assert it didn't move toward the player; apply a knockback ability, assert the mob's distance from the source increased. Commit: `feat(combat): stun/freeze root + silence gates + knockback impulse (slice 3)`

---

## Task 5: snapshot flag builders (player + mob) via STATUS_BITS

**Files:** `src/server/world.ts`

- [ ] **Step 1:** Import `STATUS_BITS` from `'../shared/status-bits.js'`. Replace the hand-written player flag builder (`~4224`) with a loop that ORs in a bit for each status the player has (debuffs: slow/burn/weaken/ignite/poison/bleed/chill/shock/brittle/maim/sap/stun/freeze/silence/curse; buffs: might/haste/regen). Keep `enrage` (64) for mobs only. Concretely build:
```ts
let flags = 0;
for (const [name, bit] of Object.entries(STATUS_BITS)) {
  if (name === 'enrage') continue;
  if (p.debuffs.has(name as StatusId) || p.buffs.has(name as StatusId)) flags |= bit;
}
```
- [ ] **Step 2:** Mob flag builder (`~4270`): OR in bits for every status `m.statuses.has(name)` (skip the buff-only pips if desired — but it's fine to include), plus the `enrage` bit when `has('might')||has('haste')`.
- [ ] **Step 3:** `npm run check` → green. Update `world-mob-spells.test.ts` if it asserts an exact `flags` value (the bit 64 enrage test should still pass; if it asserts `flags === 64` exactly and the mob now also has another status, relax to `flags & 64`). Commit: `feat(net): serialize full status set into the flags bitfield via STATUS_BITS (slice 3)`

---

## Task 6: client tints + HUD pips for new statuses

**Files:** `src/client/pixi-renderer.ts`, `src/client/main.ts`

- [ ] **Step 1:** Import `STATUS_BITS`. In the sprite-tint priority chain (`pixi-renderer.ts:2401`), add high-signal tints before the theme tint: stun/freeze → an icy/grey tint; poison → green; bleed → dark red; shock → yellow; ignite → orange (reuse burn tint); chill → light blue (reuse slow). Keep the existing priority (hit-flash first). Add tint constants near `TINT_BURN` etc.
- [ ] **Step 2:** In `main.ts` `drawBuffPips` (`~2461`) and the target badges (`~2050`), add pips/badges for the new statuses using `STATUS_BITS`. To avoid HUD clutter, give the lesser statuses (maim/sap/brittle/curse/shock) a shared generic "Hexed" pip and the headline ones (Stun, Freeze, Poison, Bleed, Ignite, Chill) their own labels/colors. Drive bit lookups from `STATUS_BITS` (no magic numbers).
- [ ] **Step 3:** `npm run check` → green. Commit: `feat(hud): render new ailment/CC tints + pips via STATUS_BITS (slice 3)`

---

## Task 7: element-signature ailment content seed

**Files:** `src/server/ability-effects.ts`, `src/server/db/seed.ts` (if a backfill is needed)

- [ ] **Step 1:** In `ability-effects.ts` `DEFAULT_ABILITY_STATUS_EFFECTS`, add element-signature rows so spells imprint their ailment. For each projectile/AoE ability, by element: fire → `ignite` (ms 2500, mag ~3); cold → `chill` (ms 2000, mag 0.3) and frost *novas* → also `freeze` (ms 900, mag 1); lightning → `shock` (ms 2500, mag 0.2); poison → `poison` (ms 3000, mag 2); physical projectiles → `bleed` (ms 2500, mag 2). Add a couple of `stun`/`silence`/`curse` rows on thematic boss abilities. Keep magnitudes modest (no balance pass). Respect the `UNIQUE(ability_id, effect)` constraint (one row per pair).
- [ ] **Step 2:** Ensure these land on existing DBs: the seed path for `ability_status_effects` (check `seed.ts`) should be `INSERT OR IGNORE` run every boot (like Slice 2 gems) — confirm new (ability,effect) rows insert on an existing `game.db`. If it only seeds on empty, add an idempotent `ensure` for these rows (mirror Slice 1/2 lessons).
- [ ] **Step 3:** `npm run check` → green. Add/extend `ability-effects.test.ts` to assert a fire ability resolves `ignite`, a cold one `chill`, etc. Commit: `feat(content): element-signature ailment rows for abilities (slice 3)`

---

## Task 8: integration tests + serialization round-trip + changelog + push

**Files:** test files, `src/shared/protocol.test.ts` (or a status-serialize test), `CHANGELOG.md`

- [ ] **Step 1:** Add a serialization round-trip test: build an EntityState with several status bits set via `STATUS_BITS`, `encode`→`decodeServer`, assert `flags` survives and `PROTOCOL_VERSION === 2`.
- [ ] **Step 2:** Add a world integration test: cast a fire spell at a mob → mob has `ignite` (dot ticks); a shock debuff raises the next hit's damage (compare damage with/without shock). Use the existing world test harness.
- [ ] **Step 3:** `NODE_OPTIONS=--use-system-ca npm run check` → fully green.
- [ ] **Step 4:** Confirm the dev server (`/tmp/devserver3.log`) booted clean after the changes (tsx watch restarted; migrations/seed ran). The protocol bump means an OLD connected client should reconnect — note it in the changelog.
- [ ] **Step 5:** Changelog `### Added` bullet under `[Unreleased]` describing the ailment/CC suite + the `flags`-v2 wire change + the deferred fear/taunt. Commit: `docs: changelog for ailments + CC (slice 3)`.
- [ ] **Step 6:** `git push origin loop/autonomous-20260614`.

---

## Self-review notes
- Coverage: SSOT bits + enums + protocol (T1); StatusSet math (T2); incoming vuln + dot (T3); root/silence/knockback (T4); serialize (T5); client render (T6); element content (T7); tests+ship (T8). Fear/taunt explicitly deferred.
- Backward compat: statuses transient; new flag bits ignored by old clients (JSON); `ability_status_effects` rows land via INSERT OR IGNORE; vulnFactor=1 / rooted=false when absent → no regression.
- SSOT: `STATUS_BITS` shared prevents server/client drift.
- Determinism: StatusSet pure; knockback positional; no new RNG.
