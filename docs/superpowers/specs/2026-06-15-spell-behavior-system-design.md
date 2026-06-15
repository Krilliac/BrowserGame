# Spell Behavior + Modifier / Ailment Redesign — Design

**Date:** 2026-06-15
**Branch:** `loop/autonomous-20260614`
**Status:** Approved (Slice 1 design); roadmap captured for Slices 2–4.

## Problem

Today a spell's only modifier is `multishot`: at cast the server fires `1 + player.multishot`
projectiles in a fan (`world.ts:2465`), and each projectile dies on first contact
(`break` at `world.ts:3402`). Every build therefore plays the same way — a flurry of extra
projectiles from gear — and spells have no individual identity. We want spells to behave
distinctly (e.g. lightning fires **one** bolt that **chains** to nearby targets) and to support a
build-crafting modifier layer with tradeoffs (e.g. "convert extra projectiles into chains at the
cost of base damage"), delivered through the existing gem/socket system. We also want a much richer
status-effect / ailment suite and the stats that drive it.

## Vision (full scope) and decomposition

This is five interlocking subsystems. We build them as **sequenced slices**, each its own
spec → plan → green build (`npm run check`), with the full vision captured here. Behaviors are
implemented as **composable handlers with shared hook points**, so adding more later is cheap.

- **Slice 1 — Spell-Behavior Engine (this spec).** A data-driven, composable projectile-behavior
  system + intrinsic behaviors assigned to every spell. Behaviors in scope: **chain, pierce, fork,
  splash, homing, multishot, return**. No protocol change.
- **Slice 2 — Modifier Gems.** A new gem class whose gems carry spell-behavior modifiers (and the
  "−base damage → +chain/pierce/splash" tradeoff supports). Socketed into **gear** (not into spells);
  aggregated into player-global modifier stats via `recomputeStats()` and merged into the effective
  behavior list at cast.
- **Slice 3 — Ailment / Status overhaul.** Element-signature ailments (ignite/burn, chill, freeze,
  shock, poison-stacks, bleed) + a CC suite (stun, knockback, fear, taunt, silence, maim, sap,
  brittle, scorch, curses). Requires a **protocol change**: the `EntityState.flags` bitfield is
  nearly full, so statuses move to a compact status list on the wire.
- **Slice 4 — Stat expansion + deferred behaviors + balance.** Per-element increased-damage %,
  ailment chance/duration/magnitude, penetration, AoE size, etc., wired through
  affixes/gems/runewords/skill tree; the deferred behaviors **beam** (hitscan), **lob**
  (ground-target), **trail** (lingering ground entity), **orbit** (caster-attached), **knockback**
  (mob displacement); plus the content/balance pass across all ~51 abilities.

The deferred behaviors are deferred because each needs a *new lifecycle or entity type* (hitscan,
ground-target aim point, a lingering area entity, caster-attached motion) or touches mob
movement/collision — out of scope for a clean, low-risk projectile-only Slice 1.

---

## Slice 1 — Spell-Behavior Engine (detailed)

### Goals / success criteria

- Spells have distinct intrinsic behaviors (lightning chains, fireball splashes, arrows pierce, …).
- The projectile lifecycle resolves chain / pierce / fork / splash / homing / multishot / return
  from **data on the ability** (SQL-tunable), composably and deterministically.
- The hit-resolution logic is a **pure, unit-tested module** (no Pixi/DOM, no `Date.now`/`Math.random`
  — RNG passed in), mirroring `status-effects.ts`.
- Existing `player.multishot` keeps working (no regression); chain links draw an arc VFX client-side.
- `npm run check` green; new logic covered by tests.

### Data model (`src/shared/combat.ts`)

Add an optional behavior list to `Ability`:

```ts
export type BehaviorSpec =
  | { type: 'chain';     count: number; range: number; falloff: number } // jumps; search px; dmg×/jump
  | { type: 'pierce';    count: number; falloff: number }                // pass-throughs; dmg×/hit
  | { type: 'fork';      count: number; spreadRad: number; falloff: number }
  | { type: 'splash';    radius: number; scale: number }                 // AoE on impact; dmg× for splash
  | { type: 'homing';    turnRate: number; acquireRange: number }        // rad/s turn; acquire px
  | { type: 'multishot'; count: number; spreadRad: number }              // cast-time fan
  | { type: 'return';    falloff: number };                              // reverse past mid-flight

export interface Ability {
  // …existing fields…
  behaviors?: BehaviorSpec[];
}
```

- `falloff` is a per-event damage multiplier (e.g. `0.7` = each jump/pierce deals 70% of the prior).
- **Source of truth:** seeded from the code `ABILITY_DEFS` into the DB. Add a `behaviors_json TEXT`
  column on the `abilities` table (JSON-encoded `BehaviorSpec[]`), overlaid onto the live ability
  singletons at load exactly like `ability_status_effects` / `ability_cast_buffs`
  (`content.ts`). Editing `game.db` retunes behaviors with no code change. (A `behaviors_json` blob
  is chosen over a side table because a behavior list is small, always read whole, and edited as a
  unit.)

### Runtime state (`Projectile`, `world.ts`)

Extend the projectile with self-contained behavior state, resolved once at spawn:

```ts
interface Projectile {
  // …existing (x, y, vx, vy, ttl, damage, radius, abilityId, ownerId, critChance, hostile)…
  behaviors: BehaviorSpec[];      // effective list (ability behaviors; + player modifiers in Slice 2)
  hitMobs: Set<number>;           // ids already damaged — never double-hit on pierce/chain
  bouncesLeft: number;            // remaining chain jumps
  piercesLeft: number;            // remaining pierces
  forksLeft: number;              // remaining fork generations
  homingTargetId?: number;        // current homing acquisition
  damageScale: number;            // running falloff multiplier (starts 1)
  returnedAt?: number;            // tick flag for `return`
}
```

### Hook pipeline (three points)

Replaces the single-target `break` logic. The decision logic is pure (see module below); `world.ts`
applies the result (spawns, damage, velocity, deletion).

1. **on-spawn (cast, `world.ts` cast path).** A `multishot` behavior (or `player.multishot`)
   expands the cast into N projectiles fanned by `spreadRad` around the aim angle (the existing fan,
   generalized). Each projectile is initialized with the ability's behavior list and charge counts.
2. **on-travel (per tick, `tickProjectiles`).** `homing` re-aims velocity toward `homingTargetId`
   (acquired/refreshed within `acquireRange`, capped by `turnRate × dt`). `return` reverses velocity
   once past mid-flight (or on first wall/expiry), so the projectile flies back through enemies.
3. **on-hit (mob overlap, `tickProjectiles` hit branch).** Apply damage `= rollAbilityDamage(...) ×
   damageScale` (crit + element resist as today), add the mob to `hitMobs`, then resolve behaviors in
   a **fixed precedence**:
   1. **splash** — always fires: damage every mob within `radius` (excluding the primary), scaled by
      `scale × damageScale`. Emits an impact FX event (existing `playStrip`).
   2. **fork** — if `forksLeft > 0`: spawn `count` child projectiles at ±`spreadRad`, inheriting
      `damageScale × falloff` and the remaining behavior list (minus one fork generation).
   3. **movement** — exactly one of:
      - **chain** (`bouncesLeft > 0`): pick the nearest mob within `range` not in `hitMobs`; redirect
        velocity toward it, `damageScale *= falloff`, `bouncesLeft--`; **do not consume**. Emit a
        chain-arc VFX event (from → to).
      - **pierce** (`piercesLeft > 0`): keep flying straight, `damageScale *= falloff`,
        `piercesLeft--`; **do not consume**.
      - otherwise **consume** (delete the projectile — today's behavior).
   - A projectile that can only re-hit mobs already in `hitMobs` (no new chain target, etc.) is
     consumed. Wall hit / TTL / out-of-bounds consume as today.

Precedence rationale: splash and fork are *additive* (they spawn damage/projectiles and don't move
the original); chain vs pierce are *mutually exclusive movement* outcomes, so a projectile that both
chains and pierces prefers **chain** (the more build-defining behavior) while it has bounces, then
falls back to pierce. This is documented and unit-tested so combos are predictable.

### Pure module — `src/server/projectile-behaviors.ts`

The keystone of the architecture: a framework-free, deterministic module holding the on-hit and
on-travel decision logic, unit-tested like `status-effects.ts`.

```ts
export interface HitContext {
  proj: ProjectileView;                 // minimal {x,y,vx,vy,damageScale,hitMobs,charges,behaviors}
  hitMob: { id: number; x: number; y: number };
  nearby: { id: number; x: number; y: number }[]; // candidate targets (un-hit, alive), within max range
  rng: () => number;                    // injected — no Math.random
}
export interface HitResult {
  primaryDamageScale: number;           // dmg× applied to the primary hit
  splash?: { radius: number; scale: number };
  spawn: { angleOffset: number; damageScale: number }[]; // fork children (relative to current heading)
  redirect?: { vx: number; vy: number }; // chain
  pierce: boolean;                      // continue straight
  consume: boolean;                     // delete after this hit
  arcTo?: { x: number; y: number };     // chain-arc VFX endpoint
  chargesAfter: { bouncesLeft: number; piercesLeft: number; forksLeft: number };
}
export function resolveHit(ctx: HitContext): HitResult { /* fixed-precedence logic above */ }
export function steerHoming(proj, target, turnRate, dtMs): { vx: number; vy: number };
```

`world.ts` calls `resolveHit` / `steerHoming`, then performs the side effects (damage, spawn, set
velocity, delete, emit FX). Tests assert: pierce continues + falloff; chain redirects to the nearest
un-hit mob + falloff + consumes when no target; fork spawn count/angles; splash radius selection;
chain+pierce precedence; `hitMobs` prevents double-hits; homing turn-rate cap; determinism.

### Content — intrinsic behavior assignment

Assign behaviors across the seeded abilities by identity (data-only, in the seed + DB column):
lightning/arc spells → `chain`; arrows/bolts/spears → `pierce`; fireball/meteor/firebomb/nova →
`splash`; magic-missile/seeker → `homing`; scattershot/volley → `multishot` (+ optional `fork`);
boomerang/glaive → `return`. Abilities with no entry keep the current straight single-hit projectile
(no regression). The exact per-ability table is produced during implementation and reviewed.

### Client

Server-authoritative, so most of this is free:
- chain **redirect** → the projectile's velocity changes server-side; the client already interpolates
  projectile entities, so it visibly curves to the next target.
- **fork** → new projectile entities appear; the client already renders projectiles (incl. the
  Slice §3.2 spell strips).
- **splash** → emit the existing impact-FX event; the client already plays `explosion`/`splash`.
- **chain arc VFX (in scope):** a short additive lightning-arc drawn between the two linked points
  for ~120 ms, driven by a new lightweight FX event `{kind:'arc', x0,y0,x1,y1, element}`. Rendered in
  `pixi-renderer` on the existing `fxLayer` with additive blend, tinted by the spell's `--fx-*`
  element color. Pure cosmetic; no authority.

### Testing

- `projectile-behaviors.test.ts` — the pure resolution logic (cases above).
- `combat.test.ts` extension — `behaviors` parse/seed round-trip; the behavior list survives the DB
  overlay; abilities resolve to valid `BehaviorSpec`s.
- A `world.ts` integration-style test for the cast→spawn multishot count and a chain hit reducing
  damage by falloff (using the existing world test harness).

### Non-goals (Slice 1)

- No modifier gems / new gem class (Slice 2).
- No new statuses/ailments and **no protocol change** (Slice 3).
- No per-element/ailment stats (Slice 4).
- No beam / lob / trail / orbit / knockback (Slice 4).
- No balance pass beyond making the in-scope behaviors feel correct.

### Risks / mitigations

- **Determinism:** all randomness via the injected `rng` (the world's seeded RNG); no `Date.now`.
- **Infinite chains / fork bombs:** hard charge counts (`bouncesLeft`/`forksLeft`) + `hitMobs`
  dedupe + the global projectile cap already in the sim bound growth.
- **Performance:** chain/splash do a bounded nearest-mob scan over the instance's mob list; reuse the
  existing spatial grid if the scan shows up in the 500-player tick budget.
- **Save/DB compat:** `behaviors_json` defaults to empty; abilities without it behave exactly as
  today, so the change is additive and backward-compatible.
