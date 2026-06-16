# Slice 2 — Modifier Gems — Design

**Date:** 2026-06-15
**Branch:** `loop/autonomous-20260614`
**Status:** Approved (standing authorization to take the full approach autonomously).
**Builds on:** Slice 1 (spell-behavior engine). Roadmap: `2026-06-15-spell-behavior-system-design.md`.

## Goal

Let players reshape how their spells behave by socketing **modifier gems** into gear — adding chain
jumps, pierces, forks, AoE, or homing to *all* their casts, plus "support" gems that trade base spell
damage for a bigger behavior bonus (the player's "−base dmg → +chains" idea). No new socket UI: it
reuses the existing gem/socket system end to end.

## Key architectural fit (why this is small)

`multishot` already flows **gem → `gemBonuses` → `recomputeStats` (`player.multishot`) → read at cast**
(`world.ts:2485`). Modifier gems are the same pattern generalized: each modifier gem's `stat` is a new
behavior-modifier stat, aggregated into a new player stat, then merged into the ability's `behaviors`
list at cast by a pure function. The gem catalog, socket flow, Artificer combine, and content overlay
are all reused unchanged.

## Design

### New behavior-modifier stats (`AffixStat` values, `src/shared/items.ts`)

Add these `AffixStat` values (gem-sourced this slice; affix/runeword/skill sources are Slice 4):
`chain`, `pierce`, `fork`, `spellaoe`. (`multishot` already exists.) Plus a non-`AffixStat`
spell-damage multiplier carried directly on the gem (see tradeoff below). `homing` is granted by a
dedicated gem family flagged on the gem (boolean), not a numeric stat — see below.

These are added to the `editable.ts` gem-stat enum and `VALID_STATS` so the DB tool + catalog test
accept them.

### New player computed stats (`Player` struct + `recomputeStats`, `world.ts`)

- `chainAdd: number` — extra chain jumps
- `pierceAdd: number` — extra pierces
- `forkAdd: number` — extra forks
- `spellAoe: number` — splash-radius bonus as a fraction (0.25 = +25% radius)
- `homingAdd: number` — count of homing gems socketed (>0 grants homing)
- `spellDamageMult: number` — product of all socketed gems' `mult` (1 = none); applied to projectile
  damage at cast (the tradeoff knob)

All default to 0 (1 for `spellDamageMult`) and accumulate from `gemBonuses` exactly like `multishot`.

### Gem catalog additions (`src/shared/gems.ts` `DEFAULT_GEMS`)

New modifier-gem families (3 tiers each, `<family>_t<n>`), each granting one modifier stat:

| Family | Color | stat | T1 / T2 / T3 | mult |
|---|---|---|---|---|
| voltaic | `#9b6bff` | `chain` | 1 / 1 / 2 | 1 |
| lancing | `#cfd6e6` | `pierce` | 1 / 2 / 2 | 1 |
| splitting | `#ff9a4d` | `fork` | 1 / 1 / 2 | 1 |
| concussive | `#ffd24a` | `spellaoe` | 0.2 / 0.35 / 0.5 | 1 |
| seeking | `#5fd0a0` | `homing` | 1 / 1 / 1 | 1 |

Plus **support gems** (the tradeoff) — a separate small set carrying a behavior bonus AND a
`mult < 1` spell-damage penalty:

| Family | Color | stat | value | mult |
|---|---|---|---|---|
| overcharge | `#ff4d7a` | `chain` | 3 (T3 only) | 0.8 |
| impaler | `#b0b0c0` | `pierce` | 3 (T3 only) | 0.85 |

`GemDef` gains an optional `mult?: number` (default 1). `gemBonuses` returns it as a product so
`recomputeStats` does `player.spellDamageMult *= gems.mult`. The `homing` stat is summed into
`homingAdd`. The catalog/content/Artificer/UI all already handle arbitrary gem families.

### Merge at cast — pure `applyModifiers` (`src/server/spell-modifiers.ts`)

A new pure, unit-tested module mirroring `projectile-behaviors.ts`:

```ts
export interface SpellMods {
  chainAdd: number; pierceAdd: number; forkAdd: number;
  spellAoe: number; homingAdd: number;
}
/** Merge player gem modifiers into an ability's behavior list (pure). Increases existing matching
 *  behaviors and adds missing ones when a modifier is present. multishot is handled separately. */
export function applyModifiers(behaviors: BehaviorSpec[], mods: SpellMods): BehaviorSpec[];
```

Rules:
- **chain:** if a chain behavior exists, `count += chainAdd`; else if `chainAdd>0`, add
  `{type:'chain', count:chainAdd, range:150, falloff:0.75}`.
- **pierce:** if exists, `count += pierceAdd`; else if `pierceAdd>0`, add `{type:'pierce', count:pierceAdd, falloff:0.9}`.
- **fork:** if exists, `count += forkAdd`; else if `forkAdd>0`, add `{type:'fork', count:forkAdd, spreadRad:0.35, falloff:0.6}`.
- **spellaoe:** if a splash behavior exists, `radius *= (1 + spellAoe)`; non-splash spells are NOT
  granted splash (AoE on a single-target bolt reads oddly — keep it a multiplier on real splash).
- **homing:** if `homingAdd>0` and no homing behavior, add `{type:'homing', turnRate:3.5, acquireRange:220}`.

The cast path (`world.ts:2481-2488`) calls `applyModifiers(carried, mods)` to get the effective list
before `initialCharges`, and multiplies projectile `damage` by `player.spellDamageMult`. Plain spells
with no player modifiers produce an unchanged list (no regression).

### Content / display

Modifier gems are seeded into `DEFAULT_GEMS` → auto-registered as `kind='gem'` items (name/color) by
the existing seed loop, so the bag, Artificer panel, and socket pips render them with no client change.
The Artificer 3-gem combine works for any family. The content packet already ships `gems`.

### Migration

The `gems`/`items` tables are seeded with `INSERT OR IGNORE`, and `ensure*` backfills re-run each boot;
the new gem rows land on existing DBs via the same idempotent seed path used for the base gems. No new
column on `gems` (the `mult` lives in `DEFAULT_GEMS`/the gem content row — add a nullable `mult REAL`
column to the `gems` table + migration #4, mirroring Slice 1's behaviors_json, so it's SQL-tunable).

### Testing

- `spell-modifiers.test.ts` — pure `applyModifiers` (increase existing / add missing / splash radius
  scale / homing add / no-op when mods empty).
- `gems.test.ts` — the catalog loop auto-covers the new families; extend `VALID_STATS`.
- `content-gems.test.ts` — a new modifier gem overlays from SQL incl. `mult`.
- `world-spellbook.test.ts`-style — socket a voltaic gem → `player.chainAdd` rises; socket overcharge →
  `chainAdd` rises and `spellDamageMult` drops.
- `editable.test.ts` — the new gem stats validate.

### Non-goals (later slices)

- No affix/runeword/skill-tree sources for the new stats (Slice 4).
- No new ailments/statuses, no protocol change (Slice 3).
- No new behaviors beyond Slice 1's set.

### Risks / mitigations

- **Balance:** modifier values are deliberately small (1–2 per gem); `spellDamageMult` floors via gem
  `mult` (≥0.8). SQL-tunable. Not a balance pass (Slice 4).
- **Adding splash to non-splash spells avoided** to prevent weird AoE on bolts.
- **Determinism:** `applyModifiers` is pure; no RNG/clock.
- **Backward compat:** new stats default to 0/1; absent gems → unchanged casts.
