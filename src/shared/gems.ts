/**
 * Gems — the Diablo-style socketable layer. A gem slots into a piece of gear's socket and grants a
 * flat bonus to one of the same affix stats gear already uses ({@link AffixStat}), so the same
 * `recomputeStats` summation in `world.ts` can fold gem bonuses in without learning a new stat kind.
 *
 * Gems come in three families (ruby/sapphire/topaz) across three tiers (chipped → flawless), plus a
 * single rare tier-3 diamond that grants the build-defining `multishot`. Values are tuned to sit
 * alongside gear affixes (see `AFFIX_RANGES` in `items.ts`): meaningful but not overpowering.
 *
 * Everything here is pure. The one source of randomness ({@link rollGemDrop}) takes an injected rng
 * so drops are deterministic and testable.
 */

import type { AffixStat } from './items.js';

export interface GemDef {
  id: string;
  name: string;
  /** UI color / glow. */
  color: string;
  /** Which stat this gem grants — one of the existing affix stats. */
  stat: AffixStat;
  /** Flat bonus magnitude granted when socketed (crit is in whole % points, like the crit affix). */
  value: number;
  /** Tier 1..3 (chipped → flawed → flawless); higher = bigger value + rarer drop. */
  tier: number;
}

/** Tier display prefixes (index 0 unused; tiers are 1-based). */
const TIER_PREFIX = ['', 'Chipped ', '', 'Flawless '] as const;

function gem(
  id: string,
  family: string,
  color: string,
  stat: AffixStat,
  value: number,
  tier: number,
): GemDef {
  return { id, name: `${TIER_PREFIX[tier]}${family}`, color, stat, value, tier };
}

/**
 * The gem catalog: ruby=power, sapphire=hp, topaz=crit across tiers 1/2/3, plus a rare tier-3
 * diamond=multishot. Values scale by tier and stay comparable to gear affixes.
 */
export const GEMS: Record<string, GemDef> = {
  // Ruby — power: 3 / 6 / 10
  ruby_t1: gem('ruby_t1', 'Ruby', '#ff4d4d', 'power', 3, 1),
  ruby_t2: gem('ruby_t2', 'Ruby', '#ff4d4d', 'power', 6, 2),
  ruby_t3: gem('ruby_t3', 'Ruby', '#ff4d4d', 'power', 10, 3),
  // Sapphire — hp: 15 / 30 / 55
  sapphire_t1: gem('sapphire_t1', 'Sapphire', '#4d7dff', 'hp', 15, 1),
  sapphire_t2: gem('sapphire_t2', 'Sapphire', '#4d7dff', 'hp', 30, 2),
  sapphire_t3: gem('sapphire_t3', 'Sapphire', '#4d7dff', 'hp', 55, 3),
  // Topaz — crit (whole %): 3 / 6 / 10
  topaz_t1: gem('topaz_t1', 'Topaz', '#ffd24a', 'crit', 3, 1),
  topaz_t2: gem('topaz_t2', 'Topaz', '#ffd24a', 'crit', 6, 2),
  topaz_t3: gem('topaz_t3', 'Topaz', '#ffd24a', 'crit', 10, 3),
  // Diamond — rare tier-3 only: +1 projectile (build-defining, kept scarce).
  diamond_t3: gem('diamond_t3', 'Diamond', '#bfefff', 'multishot', 1, 3),
};

/** True if `id` names a known gem. */
export function isGem(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(GEMS, id);
}

/** Look up a gem definition by id, or `undefined` if unknown. */
export function gemDef(id: string): GemDef | undefined {
  return GEMS[id];
}

/** The stats a gem can grant (the gem-relevant subset of {@link AffixStat}). */
export interface GemBonuses {
  power: number;
  hp: number;
  crit: number;
  multishot: number;
}

/**
 * Sum the stat bonuses from a list of socketed gem ids. `null` entries (empty sockets) and unknown
 * ids are ignored; never throws. Returns flat totals for power/hp/crit/multishot.
 */
export function gemBonuses(socketed: (string | null)[]): GemBonuses {
  const out: GemBonuses = { power: 0, hp: 0, crit: 0, multishot: 0 };
  for (const id of socketed) {
    if (id === null) continue;
    const def = GEMS[id];
    if (def === undefined) continue;
    switch (def.stat) {
      case 'power':
        out.power += def.value;
        break;
      case 'hp':
        out.hp += def.value;
        break;
      case 'crit':
        out.crit += def.value;
        break;
      case 'multishot':
        out.multishot += def.value;
        break;
      default:
        // Gems never grant debuff stats (frail/fragile); ignore defensively.
        break;
    }
  }
  return out;
}

/** Relative drop weight per tier — lower tiers far more common, tier 3 rarest. */
const TIER_WEIGHT: Record<number, number> = { 1: 100, 2: 30, 3: 6 };

/**
 * Pick a random gem id for a drop, weighted toward lower tiers (tier 3 rarest). Within a tier every
 * gem is equally likely. Deterministic given `rng`; `rng()` in [0,1) → a valid gem id.
 */
export function rollGemDrop(rng: () => number = Math.random): string {
  const ids = Object.keys(GEMS);
  let total = 0;
  for (const id of ids) total += TIER_WEIGHT[GEMS[id]!.tier] ?? 0;
  let t = rng() * total;
  for (const id of ids) {
    t -= TIER_WEIGHT[GEMS[id]!.tier] ?? 0;
    if (t < 0) return id;
  }
  return ids[0]!;
}
