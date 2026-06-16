# Slice 4 — Stat Expansion — Design

**Date:** 2026-06-15
**Branch:** `loop/autonomous-20260614`
**Status:** Approved (standing autonomous authorization; final slice).
**Builds on:** Slices 1–3. Roadmap: `2026-06-15-spell-behavior-system-design.md`.

## Goal

Round out the build system: per-element damage scaling, resistance penetration, AoE & ailment
effectiveness, and **non-gem sources** (affixes / runewords / skill tree) for the Slice-2 behavior
modifiers — so gear/runewords/skills, not just gems, shape spells. Plus `knockback` as a first-class
spell behavior. Reuses the proven `recomputeStats` + damage pipeline.

## Scope decision (full core; heavy behaviors deferred)

**Delivered:** all stat expansion + `knockback`-as-behavior + a light balance pass.
**Deferred (clearly noted):** the new-lifecycle behaviors **beam** (hitscan), **lob** (ground-target —
needs an aim-point cast protocol the engine doesn't have; casts carry only a facing angle), **trail**
(needs a new persistent ground-zone entity + serialization + client render), **orbit** (caster-attached
lifecycle). Each is effectively its own slice (new entity type and/or protocol change). They're logged
as the next roadmap items.

## New player computed stats (`Player` struct + `recomputeStats`, `world.ts`)

- `elemDamage: Record<DamageElement, number>` — % increased damage per element (default all 0).
- `penetration: number` — fraction of the target's elemental resist ignored (0..1, default 0).
- `ailmentDuration: number` — % bonus to applied ailment duration (default 0).
- `ailmentMagnitude: number` — % bonus to applied ailment magnitude/DoT (default 0).
- (`spellAoe`, `chainAdd/pierceAdd/forkAdd` already exist from Slice 2 — Slice 4 adds non-gem sources.)

All default to neutral and accumulate in `recomputeStats` (no-regression when zero).

## New AffixStats (`src/shared/items.ts`)

Add to the `AffixStat` union + the exhaustive `DEFAULT_AFFIX_NAMES`:
`firedmg`, `colddmg`, `lightningdmg`, `poisondmg`, `physdmg`, `penetration`, `ailmentdur`, `ailmentmag`.
Make these **rollable** (add to `RollableStat` + `AFFIX_STATS` + `DEFAULT_AFFIX_RANGES`):
- the 5 element-damage stats (e.g. 3–8% range), `penetration` (3–8%), `ailmentdur` (5–12%),
  `ailmentmag` (4–10%).
ALSO promote the Slice-2 modifier stats `chain`,`pierce`,`fork`,`spellaoe` to **rollable** (add to
`RollableStat`/`AFFIX_STATS`/`DEFAULT_AFFIX_RANGES`) — chain/pierce/fork as small integer rolls (1),
`spellaoe` as a % (8–18%). (They were gem-only in Slice 2.)

Update `editable.ts` gem/affix allow-lists and `gems.test` `VALID_STATS` to accept the new stats.

## recomputeStats accumulation

Add `let` accumulators for the new stats. In the affix dispatch block (and gems where natural), add
arms summing each new AffixStat into its accumulator; element-damage stats sum into the
`elemDamage` map (`firedmg→fire`, etc.). Write finals to `player.*`. **Non-gem modifier sources:** add
`chain/pierce/fork/spellaoe` arms to the runeword + set-bonus dispatch blocks, and add
`chain/pierce/fork/spellaoe` fields to `SkillEffects` (`skilltree.ts`) so skill nodes can grant them;
`aggregateSkillEffects` already sums dynamic keys. (The `player.chainAdd…spellAoe` accumulators already
exist — just fold these extra sources in.)

## Damage application

- **Per-element increased damage:** at the two cast sites (melee `~2528`, projectile cast `~2577`),
  multiply the computed damage by `(1 + player.elemDamage[ability.element ?? 'physical'])`. (For
  projectiles, apply at cast so it bakes into `proj.damage`.)
- **Penetration:** extend `resistedDamage(damage, element, resists, penetration = 0)` in
  `combat-formulas.ts` to reduce the resist: `r = clamp(-1, 1, (resists[element] ?? 0) - penetration)`.
  Pass `player.penetration` at the two damage-resolution call sites (melee `~2532`,
  `applyProjectileDamage` `~3656` — look up the owner player by `proj.ownerId`). No-regression: default 0.

## Ailment effectiveness

Thread the caster's ailment stats into `applyStatus`. Change `applyStatus(mob, abilityId, mods?)` where
`mods = { durMult: number; magMult: number }` (default `{1,1}`), scaling `e.ms * durMult` and
`e.magnitude * magMult` before `mob.statuses.apply`. Pass `{ durMult: 1+player.ailmentDuration,
magMult: 1+player.ailmentMagnitude }` from the melee + projectile hit sites (projectile: look up owner
by `proj.ownerId`; if absent, default 1/1). **No ailment-chance gate** — ailments currently always apply
on hit; adding a sub-100% chance would nerf existing behavior, so "ailment chance" is intentionally not
added (effectiveness = duration + magnitude only). Noted.

## Knockback as a behavior

Add `{ type: 'knockback'; px: number }` to `BehaviorSpec`. In `resolveHit` (or the world hit path),
when a projectile's behaviors include knockback, displace the hit mob away from the projectile by `px`
(reuse the existing `knockbackMob`). The existing `ABILITY_KNOCKBACK` melee map stays. This lets
projectile spells knock back (data-driven on the ability's `behaviors`).

## Content / DB

- Seed `affix_ranges` rows for the new rollable stats (the `DEFAULT_AFFIX_RANGES` seed path —
  `INSERT OR IGNORE` every boot so they land on existing game.db). New `affix_names` rows likewise.
- Add a few gems/runeword bonuses/skill nodes granting the new stats (data; optional polish — at
  least make the affixes roll). A migration entry is **not** needed (no new columns; the affix/gem/
  runeword/skill tables already use `TEXT` stat keys — new rows land via INSERT OR IGNORE).
- Assign `knockback` behavior to one or two thematic projectile abilities (e.g. a heavy bolt).

## Light balance pass

Modest: keep new affix ranges small (single-digit %), penetration capped (resist floors at −1/0 as
today), ailment effectiveness modest. No overhaul of existing numbers.

## Testing

- `items`/affix tests: the new stats roll within range; `DEFAULT_AFFIX_NAMES` exhaustive.
- `combat-formulas.test.ts`: `resistedDamage` with penetration reduces resist correctly (and floors).
- `recomputeStats`/world test: equip an item with `firedmg`/`penetration`/`chain` affix → the player
  stat rises; a fire spell deals more vs a fire-resistant mob with penetration.
- ailment effectiveness: `ailmentDuration`/`ailmentMagnitude` scale the applied status (via a world
  integration test using a known ailment ability).
- knockback behavior: a projectile with a knockback behavior displaces a (surviving) mob.

## Risks / mitigations

- **recomputeStats sprawl:** many new `else if` arms — mechanical, tsc-checked; keep the existing
  structure (don't refactor the whole function). Per-element damage uses a small `Record` to avoid 5
  separate player fields scattered through the apply sites.
- **Backward compat:** all new stats default neutral (0/1); penetration/elemDamage/ailment mults are
  no-ops at default → existing damage/ailments unchanged. New affix rows land via INSERT OR IGNORE.
- **No protocol change** (these are server-side computed stats + existing damage/ailment paths).
- **Determinism:** no new RNG except the existing seeded affix-roll; per-element/penetration/ailment
  scaling is deterministic arithmetic.
- **Deferred behaviors** are not half-built — beam/lob/trail/orbit get no partial code.
