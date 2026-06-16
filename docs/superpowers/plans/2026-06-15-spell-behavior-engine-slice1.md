# Spell-Behavior Engine (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the multishot-only, single-target projectile model with a composable, data-driven spell-behavior engine (chain / pierce / fork / splash / homing / multishot / return) so every spell behaves distinctly, with a chain-arc VFX.

**Architecture:** Behaviors are declared as data (`BehaviorSpec[]`) on each ability, seeded into the SQLite `abilities` table (`behaviors_json`) and read live. A pure, unit-tested `src/server/projectile-behaviors.ts` decides on-hit outcomes (split/redirect/pierce/consume) and homing steering; `world.ts` carries per-projectile behavior state and applies the module's decisions. Cosmetic chain arcs ride a new `arc` FxEvent rendered additively in `pixi-renderer`.

**Tech Stack:** TypeScript (strict), Node `ws` authoritative sim, PixiJS v8 client, better-sqlite3 content DB, Vitest. Run gate: `NODE_OPTIONS=--use-system-ca npm run check`.

**Conventions for every commit:** end the message with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer; stay on branch `loop/autonomous-20260614`.

---

## File structure

- **Create** `src/server/projectile-behaviors.ts` — pure on-hit/steering decision logic (no Pixi/DOM, RNG injected). The keystone.
- **Create** `src/server/projectile-behaviors.test.ts` — Vitest unit tests for the module.
- **Modify** `src/shared/combat.ts` — add `BehaviorSpec`, `Ability.behaviors`, and the `arc` `FxEvent` variant.
- **Modify** `src/server/world.ts` — `Projectile` runtime fields; cast-spawn init; `tickProjectiles` on-travel (homing/return) + on-hit (apply module result); emit `arc` events.
- **Modify** `src/server/content.ts` — parse `behaviors_json` onto the live `Ability` (overlay) + extend `AbilityRow`.
- **Modify** `src/server/db/schema.ts` — add `behaviors_json TEXT` to the `abilities` table.
- **Modify** `src/server/db/seed.ts` — write `behaviors_json` when seeding abilities from `ABILITY_DEFS`.
- **Modify** `src/shared/combat.ts` (`ABILITY_DEFS`) — assign intrinsic `behaviors` to abilities.
- **Modify** `src/client/pixi-renderer.ts` — render the `arc` FxEvent (additive lightning arc).

---

## Task 1: `BehaviorSpec` types + the `arc` FX event

**Files:**
- Modify: `src/shared/combat.ts` (add types near `Ability`, line 32–55; and `FxEvent`, line 876–888)

- [ ] **Step 1: Add the `BehaviorSpec` union and `Ability.behaviors` field**

In `src/shared/combat.ts`, immediately above `export interface Ability {` (line 32), add:

```ts
/**
 * A composable spell behavior (Slice 1 of the spell-behavior engine). Declared as data on an ability
 * and seeded into the content DB (`abilities.behaviors_json`), so behaviors are SQL-tunable. The
 * server resolves them via `src/server/projectile-behaviors.ts`. `falloff` is a per-event damage
 * multiplier (0.7 = each subsequent jump/pierce deals 70% of the prior).
 */
export type BehaviorSpec =
  | { type: 'chain'; count: number; range: number; falloff: number }
  | { type: 'pierce'; count: number; falloff: number }
  | { type: 'fork'; count: number; spreadRad: number; falloff: number }
  | { type: 'splash'; radius: number; scale: number }
  | { type: 'homing'; turnRate: number; acquireRange: number }
  | { type: 'multishot'; count: number; spreadRad: number }
  | { type: 'return'; falloff: number };
```

Then inside `Ability`, after the `element?` field (line 54), add:

```ts
  /** Composable projectile behaviors (chain/pierce/fork/splash/homing/multishot/return). */
  behaviors?: BehaviorSpec[];
```

- [ ] **Step 2: Extend `FxEvent` with the cosmetic chain `arc`**

In `src/shared/combat.ts`, change the `FxEvent` interface (line 876) to add the `arc` kind and the
endpoint/element fields (these are optional, so existing pushes still typecheck):

```ts
export interface FxEvent {
  kind:
    | 'melee'
    | 'hit'
    | 'cast'
    | 'death'
    | 'pickup'
    | 'coin'
    | 'heal'
    | 'levelup'
    | 'telegraph'
    | 'slam'
    | 'arc';
  x: number;
  y: number;
  // …existing optional fields (facing?, abilityId?) stay unchanged…
  /** `arc` only: the far endpoint of a chain link (the source is x,y). */
  x2?: number;
  y2?: number;
  /** `arc` only: element tint for the arc color. */
  element?: DamageElement;
}
```

(If `facing?`/`abilityId?` are declared between `y` and the new fields, leave them in place — only add the three new optional lines.)

- [ ] **Step 3: Verify it compiles**

Run: `NODE_OPTIONS=--use-system-ca npx tsc -p tsconfig.json --noEmit`
Expected: exit 0 (no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/shared/combat.ts
git commit -m "feat(combat): BehaviorSpec type + ability.behaviors + arc FxEvent (spell engine slice 1)"
```

---

## Task 2: Pure `projectile-behaviors.ts` module + tests (keystone)

**Files:**
- Create: `src/server/projectile-behaviors.ts`
- Test: `src/server/projectile-behaviors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/server/projectile-behaviors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { BehaviorSpec } from '../shared/combat.js';
import { initialCharges, resolveHit, steerHoming, type MobLite } from './projectile-behaviors.js';

const mob = (id: number, x: number, y: number): MobLite => ({ id, x, y });

describe('initialCharges', () => {
  it('sums charge counts from behaviors', () => {
    const b: BehaviorSpec[] = [
      { type: 'chain', count: 3, range: 140, falloff: 0.7 },
      { type: 'pierce', count: 2, falloff: 0.9 },
      { type: 'fork', count: 2, spreadRad: 0.4, falloff: 0.6 },
    ];
    expect(initialCharges(b)).toEqual({ bouncesLeft: 3, piercesLeft: 2, forksLeft: 2 });
  });

  it('is all-zero for behaviors without charges', () => {
    expect(initialCharges([{ type: 'splash', radius: 60, scale: 0.5 }])).toEqual({
      bouncesLeft: 0,
      piercesLeft: 0,
      forksLeft: 0,
    });
  });
});

describe('resolveHit', () => {
  const base = {
    x: 0,
    y: 0,
    vx: 10,
    vy: 0,
    damageScale: 1,
    hitMob: mob(1, 0, 0),
    hitMobs: new Set<number>(),
  };

  it('consumes a plain projectile (no behaviors)', () => {
    const out = resolveHit({ ...base, behaviors: [], charges: initialCharges([]), candidates: [] });
    expect(out.consume).toBe(true);
    expect(out.pierce).toBe(false);
    expect(out.redirect).toBeUndefined();
    expect(out.forks).toEqual([]);
    expect(out.primaryDamageScale).toBe(1);
  });

  it('pierces and applies falloff to the next hit, without consuming', () => {
    const behaviors: BehaviorSpec[] = [{ type: 'pierce', count: 1, falloff: 0.9 }];
    const out = resolveHit({ ...base, behaviors, charges: initialCharges(behaviors), candidates: [] });
    expect(out.consume).toBe(false);
    expect(out.pierce).toBe(true);
    expect(out.damageScaleAfter).toBeCloseTo(0.9);
    expect(out.charges.piercesLeft).toBe(0);
  });

  it('chains to the nearest un-hit mob in range, redirects velocity, applies falloff', () => {
    const behaviors: BehaviorSpec[] = [{ type: 'chain', count: 2, range: 100, falloff: 0.7 }];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      candidates: [mob(2, 200, 0), mob(3, 0, 30)], // 3 is nearer the hit point
    });
    expect(out.consume).toBe(false);
    expect(out.redirect).toBeDefined();
    // redirect points toward mob 3 (downward, +y)
    expect(out.redirect!.vy).toBeGreaterThan(0);
    expect(Math.hypot(out.redirect!.vx, out.redirect!.vy)).toBeCloseTo(10); // speed preserved
    expect(out.arcTo).toEqual({ x: 0, y: 30 });
    expect(out.damageScaleAfter).toBeCloseTo(0.7);
    expect(out.charges.bouncesLeft).toBe(1);
  });

  it('consumes when chain has no un-hit target in range', () => {
    const behaviors: BehaviorSpec[] = [{ type: 'chain', count: 2, range: 50, falloff: 0.7 }];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      candidates: [mob(2, 500, 0)], // too far
    });
    expect(out.consume).toBe(true);
    expect(out.redirect).toBeUndefined();
  });

  it('prefers chain over pierce while bounces remain', () => {
    const behaviors: BehaviorSpec[] = [
      { type: 'chain', count: 1, range: 100, falloff: 0.7 },
      { type: 'pierce', count: 1, falloff: 0.9 },
    ];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      candidates: [mob(2, 0, 20)],
    });
    expect(out.redirect).toBeDefined();
    expect(out.pierce).toBe(false);
  });

  it('returns splash params and fork spawns; forks fan around the heading', () => {
    const behaviors: BehaviorSpec[] = [
      { type: 'splash', radius: 60, scale: 0.5 },
      { type: 'fork', count: 2, spreadRad: 0.4, falloff: 0.6 },
    ];
    const out = resolveHit({ ...base, behaviors, charges: initialCharges(behaviors), candidates: [] });
    expect(out.splash).toEqual({ radius: 60, scale: 0.5 });
    expect(out.forks).toHaveLength(2);
    expect(out.forks[0]!.damageScale).toBeCloseTo(0.6);
    expect(out.charges.forksLeft).toBe(0); // fork fires once, bounded
    // speed preserved on forks
    expect(Math.hypot(out.forks[0]!.vx, out.forks[0]!.vy)).toBeCloseTo(10);
  });

  it('never re-hits a mob already in hitMobs (chain skips it)', () => {
    const behaviors: BehaviorSpec[] = [{ type: 'chain', count: 2, range: 100, falloff: 0.7 }];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      hitMobs: new Set([2]),
      candidates: [mob(2, 0, 10)], // already hit → ineligible
    });
    expect(out.consume).toBe(true);
  });
});

describe('steerHoming', () => {
  it('turns velocity toward the target, capped by turn rate, preserving speed', () => {
    // moving +x at speed 10, target straight down; small turn rate over 100ms
    const out = steerHoming(0, 0, 10, 0, mob(1, 0, 100), Math.PI / 2, 100);
    expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(10);
    expect(out.vy).toBeGreaterThan(0); // rotated toward target
    expect(out.vx).toBeLessThan(10); // no longer purely +x
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `NODE_OPTIONS=--use-system-ca npx vitest run src/server/projectile-behaviors.test.ts`
Expected: FAIL — `Cannot find module './projectile-behaviors.js'`.

- [ ] **Step 3: Implement the module**

Create `src/server/projectile-behaviors.ts`:

```ts
/**
 * Pure spell-behavior resolution for the projectile engine (Slice 1). Framework-free and
 * deterministic — no Pixi/DOM, no Date.now/Math.random (any randomness is the caller's). The world
 * sim calls these and performs the side effects (damage, spawn, set velocity, delete, emit FX).
 *
 * On-hit precedence (documented so combos are predictable): splash always fires; fork spawns once;
 * then movement is exactly one of chain (redirect to nearest un-hit mob) → pierce (continue straight)
 * → consume. Chain is preferred over pierce while bounces remain (it is the more build-defining
 * behavior). Forks are plain projectiles (no recursive fork/chain) so growth is hard-bounded.
 */

import type { BehaviorSpec } from '../shared/combat.js';

export interface MobLite {
  id: number;
  x: number;
  y: number;
}

export interface ProjCharges {
  bouncesLeft: number;
  piercesLeft: number;
  forksLeft: number;
}

/** Initial per-projectile charge counts from its behavior list. */
export function initialCharges(behaviors: BehaviorSpec[]): ProjCharges {
  let bouncesLeft = 0;
  let piercesLeft = 0;
  let forksLeft = 0;
  for (const b of behaviors) {
    if (b.type === 'chain') bouncesLeft += b.count;
    else if (b.type === 'pierce') piercesLeft += b.count;
    else if (b.type === 'fork') forksLeft += b.count;
  }
  return { bouncesLeft, piercesLeft, forksLeft };
}

export interface HitInput {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Running damage multiplier carried by the projectile (1 at spawn). */
  damageScale: number;
  behaviors: BehaviorSpec[];
  charges: ProjCharges;
  /** Mob ids already damaged by this projectile (never re-hit). */
  hitMobs: ReadonlySet<number>;
  /** The mob just struck. */
  hitMob: MobLite;
  /** Alive mobs eligible as chain targets (caller excludes the dead; this fn excludes hitMobs). */
  candidates: MobLite[];
}

export interface ForkSpawn {
  vx: number;
  vy: number;
  damageScale: number;
}

export interface HitOutput {
  /** Damage multiplier to apply to the primary hit (== input.damageScale). */
  primaryDamageScale: number;
  /** AoE on impact, if any (caller applies radius damage). */
  splash?: { radius: number; scale: number };
  /** Child projectiles to spawn (plain, bounded). */
  forks: ForkSpawn[];
  /** New velocity for a chained projectile. */
  redirect?: { vx: number; vy: number };
  /** True if the projectile continues straight (pierce). */
  pierce: boolean;
  /** True if the projectile is deleted after this hit. */
  consume: boolean;
  /** Chain-arc VFX endpoint (the source is the hit position). */
  arcTo?: { x: number; y: number };
  /** Projectile damageScale for subsequent hits (after chain/pierce falloff). */
  damageScaleAfter: number;
  /** Remaining charges after this hit. */
  charges: ProjCharges;
}

function find<T>(arr: BehaviorSpec[], type: T): Extract<BehaviorSpec, { type: T }> | undefined {
  return arr.find((b) => b.type === type) as Extract<BehaviorSpec, { type: T }> | undefined;
}

export function resolveHit(input: HitInput): HitOutput {
  const speed = Math.hypot(input.vx, input.vy) || 1;
  const charges: ProjCharges = { ...input.charges };
  const out: HitOutput = {
    primaryDamageScale: input.damageScale,
    forks: [],
    pierce: false,
    consume: true,
    damageScaleAfter: input.damageScale,
    charges,
  };

  const splash = find(input.behaviors, 'splash');
  if (splash) out.splash = { radius: splash.radius, scale: splash.scale };

  const fork = find(input.behaviors, 'fork');
  if (fork && charges.forksLeft > 0) {
    const baseAngle = Math.atan2(input.vy, input.vx);
    for (let i = 0; i < fork.count; i++) {
      // fan symmetrically around the heading
      const a = baseAngle + (i - (fork.count - 1) / 2) * fork.spreadRad;
      out.forks.push({
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        damageScale: input.damageScale * fork.falloff,
      });
    }
    charges.forksLeft = 0; // fork fires once → hard bound on projectile growth
  }

  // Movement: chain (preferred) → pierce → consume.
  const chain = find(input.behaviors, 'chain');
  if (chain && charges.bouncesLeft > 0) {
    let best: MobLite | undefined;
    let bestD = chain.range;
    for (const c of input.candidates) {
      if (c.id === input.hitMob.id || input.hitMobs.has(c.id)) continue;
      const d = Math.hypot(c.x - input.hitMob.x, c.y - input.hitMob.y);
      if (d <= bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best) {
      const dx = best.x - input.hitMob.x;
      const dy = best.y - input.hitMob.y;
      const len = Math.hypot(dx, dy) || 1;
      out.redirect = { vx: (dx / len) * speed, vy: (dy / len) * speed };
      out.arcTo = { x: best.x, y: best.y };
      out.damageScaleAfter = input.damageScale * chain.falloff;
      out.consume = false;
      charges.bouncesLeft -= 1;
      return out;
    }
  }

  const pierce = find(input.behaviors, 'pierce');
  if (pierce && charges.piercesLeft > 0) {
    out.pierce = true;
    out.consume = false;
    out.damageScaleAfter = input.damageScale * pierce.falloff;
    charges.piercesLeft -= 1;
    return out;
  }

  return out;
}

/** Rotate `(vx,vy)` toward `target` by at most `turnRateRadPerS * dtMs/1000`, preserving speed. */
export function steerHoming(
  x: number,
  y: number,
  vx: number,
  vy: number,
  target: MobLite,
  turnRateRadPerS: number,
  dtMs: number,
): { vx: number; vy: number } {
  const speed = Math.hypot(vx, vy) || 1;
  const cur = Math.atan2(vy, vx);
  const want = Math.atan2(target.y - y, target.x - x);
  let delta = want - cur;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const maxStep = turnRateRadPerS * (dtMs / 1000);
  const step = Math.max(-maxStep, Math.min(maxStep, delta));
  const a = cur + step;
  return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `NODE_OPTIONS=--use-system-ca npx vitest run src/server/projectile-behaviors.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/server/projectile-behaviors.ts src/server/projectile-behaviors.test.ts
git commit -m "feat(combat): pure projectile-behaviors resolution module + tests (spell engine slice 1)"
```

---

## Task 3: Projectile runtime state + cast-spawn wiring

**Files:**
- Modify: `src/server/world.ts` (`Projectile` interface line 601–617; cast projectile branch line 2464–2488)

- [ ] **Step 1: Extend the `Projectile` interface**

In `src/server/world.ts`, add fields to `interface Projectile` (after `hostile: boolean;`, line 616):

```ts
  /** Effective behavior list resolved at spawn (ability behaviors; + player modifiers in Slice 2). */
  behaviors: BehaviorSpec[];
  /** Mob ids already damaged — never double-hit on pierce/chain. */
  hitMobs: Set<number>;
  bouncesLeft: number;
  piercesLeft: number;
  forksLeft: number;
  /** Running falloff multiplier applied to damage (1 at spawn). */
  damageScale: number;
  /** `homing` acquisition (mob id), if any. */
  homingTargetId?: number;
  /** `return` latch — set once the projectile has reversed. */
  returned?: boolean;
```

- [ ] **Step 2: Add imports**

At the top of `src/server/world.ts`, add to the existing `./projectile-behaviors.js` import (create it if absent) and the `../shared/combat.js` import:

```ts
import {
  initialCharges,
  resolveHit,
  steerHoming,
  type MobLite,
} from './projectile-behaviors.js';
```

Ensure `BehaviorSpec` is imported from `'../shared/combat.js'` (add it to the existing combat import list).

- [ ] **Step 3: Initialize behavior state at cast (multishot generalized)**

Replace the projectile cast branch (`else {` … `}` at lines 2464–2488) with:

```ts
    } else {
      const speed = ability.projectileSpeed ?? 300;
      const behaviors = ability.behaviors ?? [];
      // Multishot: the ability's `multishot` behavior OR the player's multishot stat (whichever is
      // larger) fans extra projectiles around the aim. Slice 2 adds gem-driven multishot.
      const ms = behaviors.find((b) => b.type === 'multishot');
      const count = Math.max(1 + player.multishot, ms ? ms.count : 1);
      const spread = ms ? ms.spreadRad : 0.18;
      // Behaviors carried by each projectile exclude the cast-time `multishot` entry.
      const carried = behaviors.filter((b) => b.type !== 'multishot');
      const charges = initialCharges(carried);
      for (let i = 0; i < count; i++) {
        const a = facing + (i - (count - 1) / 2) * spread;
        const pid = this.allocId();
        this.projectiles.set(pid, {
          id: pid,
          abilityId,
          x: player.x,
          y: player.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          ttl: ability.projectileTtlMs ?? 1200,
          damage: (ability.damage + player.power) * rankMult * mightMult,
          radius: ability.radius,
          ownerId: player.id,
          ownerLevel: player.level,
          critChance: player.critChance,
          hostile: false,
          behaviors: carried,
          hitMobs: new Set<number>(),
          bouncesLeft: charges.bouncesLeft,
          piercesLeft: charges.piercesLeft,
          forksLeft: charges.forksLeft,
          damageScale: 1,
        });
      }
    }
```

- [ ] **Step 4: Verify it compiles**

Run: `NODE_OPTIONS=--use-system-ca npx tsc -p tsconfig.json --noEmit`
Expected: exit 0. (Hostile/mob projectiles spawned elsewhere will now fail to typecheck because they lack the new required fields — that is expected and fixed in Step 5.)

- [ ] **Step 5: Give every other projectile-spawn site the new fields**

Search for every other `this.projectiles.set(` in `world.ts` (mob/hireling projectiles). For each, add the behavior fields with safe defaults so non-player projectiles keep today's single-hit behavior:

```ts
          behaviors: [],
          hitMobs: new Set<number>(),
          bouncesLeft: 0,
          piercesLeft: 0,
          forksLeft: 0,
          damageScale: 1,
```

Run: `grep -n "this.projectiles.set(" src/server/world.ts` to find them all; patch each.

- [ ] **Step 6: Verify compile**

Run: `NODE_OPTIONS=--use-system-ca npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/server/world.ts
git commit -m "feat(combat): projectile behavior state + multishot-as-behavior at cast (spell engine slice 1)"
```

---

## Task 4: `tickProjectiles` — on-travel (homing/return) + on-hit resolution

**Files:**
- Modify: `src/server/world.ts` (`tickProjectiles` line 3352–3410)

- [ ] **Step 1: Add on-travel steering before the wall check**

In `tickProjectiles`, inside the loop, BEFORE `proj.x += proj.vx * dt;` (line 3354), insert homing
and return handling:

```ts
      // On-travel behaviors (cosmetic-free, server-authoritative).
      const homing = proj.behaviors.find((b) => b.type === 'homing');
      if (homing && !proj.hostile) {
        let tgt: MobLite | undefined;
        let best = homing.acquireRange;
        for (const m of this.mobs.values()) {
          if (m.dead || proj.hitMobs.has(m.id)) continue;
          const d = Math.hypot(m.x - proj.x, m.y - proj.y);
          if (d <= best) {
            best = d;
            tgt = { id: m.id, x: m.x, y: m.y };
          }
        }
        if (tgt) {
          const v = steerHoming(proj.x, proj.y, proj.vx, proj.vy, tgt, homing.turnRate, dt * 1000);
          proj.vx = v.vx;
          proj.vy = v.vy;
        }
      }
      const ret = proj.behaviors.find((b) => b.type === 'return');
      if (ret && !proj.returned && proj.ttl <= (getContent().ability(proj.abilityId)?.projectileTtlMs ?? 1200) / 2) {
        proj.vx = -proj.vx;
        proj.vy = -proj.vy;
        proj.returned = true;
        proj.hitMobs.clear(); // can hit the same mobs on the way back
        proj.damageScale *= ret.falloff;
      }
```

- [ ] **Step 2: Replace the player-projectile hit block with behavior resolution**

Replace the `} else {` mob branch (lines 3387–3404) — the single-target loop ending in `break;` — with:

```ts
      } else {
        let hit: Mob | undefined;
        for (const mob of this.mobs.values()) {
          if (mob.dead || proj.hitMobs.has(mob.id)) continue;
          if (circlesOverlap(proj.x, proj.y, proj.radius, mob.x, mob.y, MOB_RADIUS)) {
            hit = mob;
            break;
          }
        }
        if (hit) {
          proj.hitMobs.add(hit.id);
          const candidates: MobLite[] = [];
          for (const m of this.mobs.values()) {
            if (m.dead || proj.hitMobs.has(m.id)) continue;
            candidates.push({ id: m.id, x: m.x, y: m.y });
          }
          const res = resolveHit({
            x: proj.x,
            y: proj.y,
            vx: proj.vx,
            vy: proj.vy,
            damageScale: proj.damageScale,
            behaviors: proj.behaviors,
            charges: { bouncesLeft: proj.bouncesLeft, piercesLeft: proj.piercesLeft, forksLeft: proj.forksLeft },
            hitMobs: proj.hitMobs,
            hitMob: { id: hit.id, x: hit.x, y: hit.y },
            candidates,
          });
          // Primary hit damage.
          this.applyProjectileDamage(proj, hit, res.primaryDamageScale);
          // Splash: every other mob within radius.
          if (res.splash) {
            for (const m of this.mobs.values()) {
              if (m.dead || m.id === hit.id) continue;
              if (Math.hypot(m.x - hit.x, m.y - hit.y) <= res.splash.radius) {
                this.applyProjectileDamage(proj, m, res.primaryDamageScale * res.splash.scale);
              }
            }
          }
          // Forks: plain child projectiles.
          for (const f of res.forks) {
            const cid = this.allocId();
            this.projectiles.set(cid, {
              id: cid,
              abilityId: proj.abilityId,
              x: proj.x,
              y: proj.y,
              vx: f.vx,
              vy: f.vy,
              ttl: getContent().ability(proj.abilityId)?.projectileTtlMs ?? 1200,
              damage: proj.damage,
              radius: proj.radius,
              ownerId: proj.ownerId,
              ownerLevel: proj.ownerLevel,
              critChance: proj.critChance,
              hostile: false,
              behaviors: [],
              hitMobs: new Set<number>(),
              bouncesLeft: 0,
              piercesLeft: 0,
              forksLeft: 0,
              damageScale: f.damageScale,
            });
          }
          // Movement outcome.
          proj.bouncesLeft = res.charges.bouncesLeft;
          proj.piercesLeft = res.charges.piercesLeft;
          proj.forksLeft = res.charges.forksLeft;
          proj.damageScale = res.damageScaleAfter;
          if (res.redirect) {
            proj.vx = res.redirect.vx;
            proj.vy = res.redirect.vy;
            if (res.arcTo) {
              this.events.push({
                kind: 'arc',
                x: hit.x,
                y: hit.y,
                x2: res.arcTo.x,
                y2: res.arcTo.y,
                element: getContent().ability(proj.abilityId)?.element ?? 'physical',
              });
            }
          }
          consumed = res.consume;
        }
      }
```

- [ ] **Step 3: Add the `applyProjectileDamage` helper**

Immediately after `tickProjectiles` (after line 3410, before `wander`), add a private method that
centralizes the damage roll/crit/resist/status that was previously inline:

```ts
  /** Roll + apply one projectile damage instance to a mob (crit, element resist, status), scaled. */
  private applyProjectileDamage(proj: Projectile, mob: Mob, scale: number): void {
    const base = rollAbilityDamage(proj.ownerLevel, mob.level, proj.damage * scale);
    const crit = base > 0 && rollCrit(this.rand, proj.critChance);
    const dmg = applyCrit(base, crit);
    const finalDmg = resistedDamage(
      dmg,
      getContent().ability(proj.abilityId)?.element ?? 'physical',
      getContent().mobResists(mob.templateId),
    );
    this.damageMob(mob, finalDmg, proj.abilityId, proj.ownerId, crit);
    if (finalDmg > 0) applyStatus(mob, proj.abilityId);
  }
```

- [ ] **Step 4: Verify compile + full test run**

Run: `NODE_OPTIONS=--use-system-ca npx tsc -p tsconfig.json --noEmit`
Expected: exit 0.
Run: `NODE_OPTIONS=--use-system-ca npx vitest run src/server/world.test.ts`
Expected: PASS (existing world tests still green — plain projectiles behave as before).

- [ ] **Step 5: Commit**

```bash
git add src/server/world.ts
git commit -m "feat(combat): projectile on-hit behavior resolution + homing/return travel (spell engine slice 1)"
```

---

## Task 5: Chain-arc VFX (client)

**Files:**
- Modify: `src/client/pixi-renderer.ts` (the FX-event handler near `spawnFxDecalsAndParticles` / `playStrip`, ~line 2046 / 3160)

- [ ] **Step 1: Write a failing render-smoke assertion**

There is no DOM test harness for the renderer; instead pin the pure mapping. Add to
`src/client/projectile-fx.test.ts` (created earlier) a check that an element maps to an arc color via
a small exported helper. First add the failing test:

```ts
import { arcColor } from './projectile-fx.js';

describe('arcColor', () => {
  it('maps elements to a hex tint', () => {
    expect(arcColor('lightning')).toBe('#b07ae8');
    expect(arcColor('cold')).toBe('#7fc4ff');
    expect(arcColor('fire')).toBe('#ff8a3a');
    expect(arcColor(undefined)).toBe('#ffffff');
  });
});
```

Run: `NODE_OPTIONS=--use-system-ca npx vitest run src/client/projectile-fx.test.ts`
Expected: FAIL — `arcColor` not exported.

- [ ] **Step 2: Add `arcColor` to `projectile-fx.ts`**

Append to `src/client/projectile-fx.ts`:

```ts
import type { DamageElement } from '../shared/combat.js';

/** The --fx-* tint for a chain-arc VFX, by element. */
export function arcColor(element: DamageElement | undefined): string {
  switch (element) {
    case 'fire':
      return '#ff8a3a';
    case 'cold':
      return '#7fc4ff';
    case 'lightning':
      return '#b07ae8';
    case 'poison':
      return '#aef07a';
    default:
      return '#ffffff';
  }
}
```

Run: `NODE_OPTIONS=--use-system-ca npx vitest run src/client/projectile-fx.test.ts`
Expected: PASS.

- [ ] **Step 3: Render the `arc` FxEvent**

In `src/client/pixi-renderer.ts`, find the FX-event loop that processes `state.fx` for visual
effects (the one that calls `playStrip` / `spawnFxDecalsAndParticles`, ~line 2046). Add a branch that
draws a short additive line on `this.fxGfx` (the existing world-space FX Graphics, added to
`this.fxLayer` at line ~689) when `ev.kind === 'arc'`:

```ts
        if (ev.kind === 'arc' && ev.x2 !== undefined && ev.y2 !== undefined) {
          const g = this.fxGfx;
          g.moveTo(ev.x, ev.y * PITCH)
            .lineTo(ev.x2, ev.y2 * PITCH)
            .stroke({ width: 2, color: arcColor(ev.element), alpha: 0.9 });
          g.blendMode = 'add';
        }
```

(`this.fxGfx` is already cleared each frame; the arc shows for the frame(s) the event is live in the
FX window — consistent with the other one-shot FX. Import `arcColor` from `'./projectile-fx.js'`.)

- [ ] **Step 4: Verify check**

Run: `NODE_OPTIONS=--use-system-ca npm run check`
Expected: typecheck + lint + format + tests all green.

- [ ] **Step 5: Commit**

```bash
git add src/client/pixi-renderer.ts src/client/projectile-fx.ts src/client/projectile-fx.test.ts
git commit -m "feat(render): chain-arc VFX for the spell-behavior engine (slice 1)"
```

---

## Task 6: DB column + seed + content overlay for `behaviors_json`

**Files:**
- Modify: `src/server/db/schema.ts` (the `abilities` table DDL, ~line 59–75)
- Modify: `src/server/db/seed.ts` (the abilities INSERT, ~line 1393 column list)
- Modify: `src/server/content.ts` (the `AbilityRow` type ~line 985 + the overlay loop ~line 338–353)

- [ ] **Step 1: Add the column to the schema**

In `src/server/db/schema.ts`, in the `CREATE TABLE abilities (...)` statement, add a column (after
`projectile_ttl_ms`):

```sql
  behaviors_json TEXT,
```

- [ ] **Step 2: Extend `AbilityRow` + parse it in the overlay**

In `src/server/content.ts`, add to the `AbilityRow` interface (near line 989):

```ts
  behaviors_json: string | null;
```

In the ability build loop (after line 352, `if (r.projectile_ttl_ms !== null) …`), add:

```ts
    if (r.behaviors_json) {
      try {
        ability.behaviors = JSON.parse(r.behaviors_json) as Ability['behaviors'];
      } catch {
        // malformed JSON → no behaviors (plain projectile); never crash content load
      }
    }
```

- [ ] **Step 3: Seed `behaviors_json` from `ABILITY_DEFS`**

In `src/server/db/seed.ts`, find the abilities INSERT (the column list at ~line 1393 includes
`projectile_ttl_ms`). Add `behaviors_json` to both the column list and the values, sourcing it from
the ability def:

```ts
// in the column list:
behaviors_json,
// in the bound values for each ability `a`:
a.behaviors ? JSON.stringify(a.behaviors) : null,
```

(Match the existing parametrized-insert style in that function exactly — add one column + one bound
parameter. If the insert uses named params, add `behaviors_json: a.behaviors ? JSON.stringify(a.behaviors) : null`.)

- [ ] **Step 4: Verify the round-trip with a test**

Add to `src/server/db/seed.test.ts` (or the nearest seed test) a case asserting a behavior survives
seeding+load. If `fireball` is assigned `splash` in Task 7, this will pass after Task 7; for now
assert the column exists and parses for any ability that has behaviors:

```ts
import { getContent } from '../content.js';
it('abilities round-trip their behaviors_json', () => {
  // after seed+load in the existing harness:
  const withBehaviors = getContent().abilitiesList().filter((a) => a.behaviors && a.behaviors.length);
  for (const a of withBehaviors) {
    expect(Array.isArray(a.behaviors)).toBe(true);
    expect(a.behaviors![0]).toHaveProperty('type');
  }
});
```

(Use the existing seed-test harness's content accessor; if `abilitiesList()` doesn't exist, iterate
the known ids the test already uses.)

- [ ] **Step 5: Verify check**

Run: `NODE_OPTIONS=--use-system-ca npm run check`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/server/db/schema.ts src/server/db/seed.ts src/server/content.ts src/server/db/seed.test.ts
git commit -m "feat(content): seed + overlay ability behaviors_json (spell engine slice 1)"
```

---

## Task 7: Assign intrinsic behaviors to abilities

**Files:**
- Modify: `src/shared/combat.ts` (`ABILITY_DEFS`, lines 57–831)

- [ ] **Step 1: Add `behaviors` to ability defs by identity**

For each ability in `ABILITY_DEFS`, add a `behaviors: [...]` array per this mapping rule (apply to all
~51; the table below gives the canonical assignments — extend the same rules to any ability not
listed by matching its name/element):

| Identity / name contains | element | behaviors |
|---|---|---|
| lightning, arc, shock, storm, chain | lightning | `[{type:'chain',count:3,range:150,falloff:0.75}]` |
| arrow, bolt, spear, lance, pierce, dart | physical/any | `[{type:'pierce',count:2,falloff:0.9}]` |
| fireball, meteor, firebomb, blast, nova, explos | fire | `[{type:'splash',radius:70,scale:0.5}]` |
| frost, ice, glacier (single-target) | cold | `[{type:'splash',radius:50,scale:0.4}]` |
| magic missile, seeker, homing, spirit | any | `[{type:'homing',turnRate:3.5,acquireRange:220}]` |
| scattershot, volley, spread, multishot | any | `[{type:'multishot',count:3,spreadRad:0.2}]` |
| boomerang, glaive, returning | any | `[{type:'return',falloff:0.8}]` |
| poison, venom (cloud) | poison | `[{type:'splash',radius:60,scale:0.5}]` |

Concrete examples (edit in place):

```ts
  fireball: { /* …existing fields… */ behaviors: [{ type: 'splash', radius: 70, scale: 0.5 }] },
  arrow:    { /* …existing fields… */ behaviors: [{ type: 'pierce', count: 2, falloff: 0.9 }] },
  frost:    { /* …existing fields… */ behaviors: [{ type: 'splash', radius: 50, scale: 0.4 }] },
```

For a lightning ability (find the id whose name/element is lightning, e.g. `lightning`):

```ts
  lightning: { /* …existing fields… */ behaviors: [{ type: 'chain', count: 3, range: 150, falloff: 0.75 }] },
```

Abilities with no matching identity keep no `behaviors` (plain straight projectile — no regression).
Melee/heal abilities get no `behaviors`.

- [ ] **Step 2: Re-seed the DB so the new behaviors load**

The dev server seeds on a fresh DB. Trigger a reseed per the project's convention (delete/rebuild
`game.db` or run the seed script the repo uses), then restart the world server so the abilities load
with behaviors. (Schema/seed changes need a server restart — `tsx watch` will restart the server
process on the seed/source change; if the DB is cached, remove `game.db` so it reseeds.)

Run: `NODE_OPTIONS=--use-system-ca npm run check`
Expected: green (the seed round-trip test from Task 6 now sees populated behaviors).

- [ ] **Step 3: Commit**

```bash
git add src/shared/combat.ts
git commit -m "feat(content): assign intrinsic spell behaviors to abilities (spell engine slice 1)"
```

---

## Task 8: Integration verification + final gate

**Files:** none (verification)

- [ ] **Step 1: Full check**

Run: `NODE_OPTIONS=--use-system-ca npm run check`
Expected: typecheck + lint + format + all tests green.

- [ ] **Step 2: Manual smoke (server already running on :5173/:8080, hot-reloads)**

Confirm in the browser (http://localhost:5173): a lightning spell fires one bolt that visibly jumps
between nearby enemies with a short arc; an arrow passes through a line of enemies; a fireball deals
splash. If `game.db` didn't reseed, remove it and restart the world server so the behaviors load.

- [ ] **Step 3: Update the changelog**

Add an `### Added` bullet under `[Unreleased]` in `CHANGELOG.md`:

```markdown
- **Spell-behavior engine (slice 1).** Spells now carry composable, data-driven behaviors
  (chain/pierce/fork/splash/homing/multishot/return) resolved by a pure, tested module; lightning
  chains with an arc VFX, arrows pierce, fireballs splash. Behaviors are SQL-tunable
  (`abilities.behaviors_json`). Foundation for modifier gems + ailments (slices 2–4).
```

- [ ] **Step 4: Commit + push**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for spell-behavior engine slice 1"
git push -u origin loop/autonomous-20260614
```

---

## Self-review notes (author)

- **Spec coverage:** behavior set (chain/pierce/fork/splash/homing/multishot/return) → Tasks 2,3,4,7;
  pure tested module → Task 2; data-driven/SQL-tunable → Task 6; intrinsic assignment → Task 7;
  chain-arc VFX → Task 5; no protocol change (FxEvent extension is additive, not the flags bitfield) →
  Task 1. Non-goals (gems/ailments/stats/deferred behaviors) correctly excluded.
- **Determinism:** RNG injected to the sim's `this.rand`; the pure module takes no clock/RNG except a
  nearest-target tiebreak that is positional (deterministic). Homing/return use `dt`.
- **Growth bounds:** `forksLeft` set to 0 after one fork; children are plain; `hitMobs` dedupes;
  charges decrement; the sim's global projectile cap still applies.
- **Backward compat:** `behaviors_json` nullable; abilities without it behave exactly as today;
  mob/hireling projectiles get empty behaviors (Task 3 Step 5).
- **Type consistency:** `MobLite`, `ProjCharges`, `HitInput`/`HitOutput`, `initialCharges`,
  `resolveHit`, `steerHoming`, `arcColor` names are used identically across Tasks 2/4/5.
