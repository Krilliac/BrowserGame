/**
 * Rift modifiers (mutators) — D3-style "this rift is special" twists.
 *
 * WHY: The endgame rift system already scales mobs by tier (level/HP/damage/density/champions).
 * Modifiers add a second, *named* axis of variety on top of that flat scaling: each opened rift
 * rolls a small handful of mutators that change its risk/reward profile ("monsters hit harder but
 * drop more loot"), so two tier-N rifts feel different. This is the classic ARPG "every run is a
 * little different" lever — it keeps grinding fresh without touching the underlying tier math.
 *
 * DESIGN CONSTRAINTS:
 * - PURE: no World/DB/content imports. The whole module is deterministic given an injected
 *   `rng: () => number` in [0, 1) — matching the codebase's mulberry32 convention (see
 *   `src/shared/math.ts`). The orchestrator will seed it from the rift's existing seed so the
 *   same rift always rolls the same modifiers.
 * - SEED SOURCE: `DEFAULT_RIFT_MODIFIERS` is the in-code seed for a future `rift_modifiers`
 *   content table. The orchestrator will later load defs from SQLite instead of this constant;
 *   the roll/aggregate logic stays here and stays pure.
 * - SANE BANDS: harder multipliers live in 1.1–1.6, reward bonuses in 0.2–0.75, so even a
 *   double-modifier rift can't produce absurd swings when the orchestrator multiplies/adds them.
 *
 * The orchestrator wires this in two places (NOT this module's job): roll modifiers at rift
 * creation, then apply the aggregated `RiftEffects` — mob hp/damage/speed at spawn, loot/xp at
 * the reward sites. See the wiring guide returned with this change.
 */

/**
 * A single rift mutator definition. Multipliers default to 1 (no effect) and bonuses default to 0
 * (no effect) when absent, so a def only needs to spell out the fields it actually touches.
 */
export interface RiftModifierDef {
  /** Stable identifier, also the future table primary key. */
  id: string;
  /** Short display name shown when the rift opens. */
  name: string;
  /** One-line flavor + mechanical hint for the UI. */
  desc: string;
  /** Lowest rift tier this modifier can roll on — nastier mutators gate behind deeper tiers. */
  minTier: number;
  /** Multiplier on monster outgoing damage. Default 1. */
  mobDamageMult?: number;
  /** Multiplier on monster max HP. Default 1. */
  mobHpMult?: number;
  /** Multiplier on monster movement speed. Default 1. */
  mobSpeedMult?: number;
  /** Fractional bonus to loot quantity (0.5 = +50%). Default 0. */
  lootQuantityBonus?: number;
  /** Fractional bonus to XP (0.5 = +50%). Default 0. */
  xpBonus?: number;
}

/**
 * The built-in modifier table — the seed source for the future `rift_modifiers` content table.
 *
 * Balancing intent (every harder twist pays out in loot or xp; the one freebie is rare-by-weight,
 * which the orchestrator expresses via roll frequency, not encoded here):
 * - Tier 1+: gentle, single-axis mutators so even shallow rifts can roll something.
 * - Tier 3+: two-axis or steeper mutators.
 * - Tier 5+: the meanest combos.
 *
 * NOTE: all `minTier` values are >= 1, so a tier-0 / base rift rolls *no* modifiers. That is
 * intentional — the very first rung is the "vanilla" baseline players measure twists against.
 */
export const DEFAULT_RIFT_MODIFIERS: readonly RiftModifierDef[] = [
  {
    id: 'berserk',
    name: 'Berserk',
    desc: 'Monsters strike with savage force, but spill far more loot.',
    minTier: 1,
    mobDamageMult: 1.3,
    lootQuantityBonus: 0.4,
  },
  {
    id: 'juggernaut',
    name: 'Juggernaut',
    desc: 'Monsters are grotesquely tough — and worth the extra effort.',
    minTier: 1,
    mobHpMult: 1.4,
    xpBonus: 0.35,
  },
  {
    id: 'bountiful',
    name: 'Bountiful',
    desc: 'A vein of fortune runs through this rift. More loot, no catch.',
    minTier: 1,
    lootQuantityBonus: 0.3,
  },
  {
    id: 'scholarly',
    name: 'Scholarly',
    desc: 'Strange knowledge saturates the rift. Generous experience, no catch.',
    minTier: 2,
    xpBonus: 0.4,
  },
  {
    id: 'frenzied',
    name: 'Frenzied',
    desc: 'Monsters move and hit faster — outrun them or be overwhelmed.',
    minTier: 3,
    mobSpeedMult: 1.25,
    mobDamageMult: 1.2,
    lootQuantityBonus: 0.45,
  },
  {
    id: 'empowered',
    name: 'Empowered',
    desc: 'Dark power swells the horde. Tougher foes, richer rewards.',
    minTier: 3,
    mobHpMult: 1.35,
    xpBonus: 0.5,
  },
  {
    id: 'vengeful',
    name: 'Vengeful',
    desc: 'Wounded monsters lash out harder; the rift bleeds treasure.',
    minTier: 5,
    mobDamageMult: 1.5,
    mobHpMult: 1.25,
    lootQuantityBonus: 0.6,
  },
  {
    id: 'cataclysmic',
    name: 'Cataclysmic',
    desc: 'Everything is faster, tougher, deadlier — and pays a king’s ransom.',
    minTier: 5,
    mobDamageMult: 1.4,
    mobHpMult: 1.4,
    mobSpeedMult: 1.2,
    lootQuantityBonus: 0.5,
    xpBonus: 0.75,
  },
];

/**
 * Roll up to `count` DISTINCT modifiers eligible for `tier` (minTier <= tier).
 *
 * Deterministic given `rng`: we copy the eligible pool, then do a partial Fisher–Yates draw,
 * consuming one rng value per pick. The same rng sequence always yields the same modifiers in the
 * same order — which is what lets the orchestrator reproduce a rift from its seed. Never returns
 * duplicates; if fewer than `count` modifiers are eligible (including zero at tier 0), returns
 * exactly what's available.
 *
 * @param tier  Rift tier being opened.
 * @param rng   Injected PRNG returning floats in [0, 1).
 * @param count Max number of modifiers to roll (default 2).
 */
export function rollRiftModifiers(
  tier: number,
  rng: () => number,
  count = 2,
  source: readonly RiftModifierDef[] = DEFAULT_RIFT_MODIFIERS,
): RiftModifierDef[] {
  // Eligible pool for this tier. Copy so we can shuffle without mutating the seed table.
  const pool = source.filter((m) => m.minTier <= tier);
  const picks: RiftModifierDef[] = [];
  const take = Math.min(count, pool.length);

  // Partial Fisher–Yates: select `take` distinct entries, one rng draw each.
  for (let i = 0; i < take; i++) {
    // Remaining unpicked window is pool[i .. pool.length - 1].
    const j = i + Math.floor(rng() * (pool.length - i));
    const chosen = pool[j];
    const here = pool[i];
    // noUncheckedIndexedAccess: both indices are in-window, but narrow for the type-checker.
    if (chosen === undefined || here === undefined) continue;
    pool[j] = here;
    pool[i] = chosen;
    picks.push(chosen);
  }

  return picks;
}

/** Aggregated, ready-to-apply effect of a set of rift modifiers. */
export interface RiftEffects {
  mobDamageMult: number;
  mobHpMult: number;
  mobSpeedMult: number;
  lootQuantityBonus: number;
  xpBonus: number;
}

/**
 * Combine modifiers into a single `RiftEffects`.
 *
 * WHY these combine rules: multipliers MULTIPLY (two +30% damage twists stack to ~1.69x, the
 * intuitive "both apply" behavior), while fractional bonuses ADD (two +40% loot twists give +80%,
 * not +96%) — additive bonuses keep reward growth linear and predictable for tuning. Returns the
 * neutral identity (all mults 1, all bonuses 0) for an empty list, so the orchestrator can apply
 * the result unconditionally even on a modifier-free rift.
 */
export function aggregateRiftEffects(mods: readonly RiftModifierDef[]): RiftEffects {
  const effects: RiftEffects = {
    mobDamageMult: 1,
    mobHpMult: 1,
    mobSpeedMult: 1,
    lootQuantityBonus: 0,
    xpBonus: 0,
  };

  for (const m of mods) {
    effects.mobDamageMult *= m.mobDamageMult ?? 1;
    effects.mobHpMult *= m.mobHpMult ?? 1;
    effects.mobSpeedMult *= m.mobSpeedMult ?? 1;
    effects.lootQuantityBonus += m.lootQuantityBonus ?? 0;
    effects.xpBonus += m.xpBonus ?? 0;
  }

  return effects;
}
