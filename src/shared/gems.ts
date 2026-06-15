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
  /**
   * Optional spell-damage multiplier applied when this gem is socketed (default 1.0). Support gems
   * that grant powerful modifiers (chain/pierce/fork at high counts) carry a value < 1 as a
   * built-in tradeoff so the benefit isn't free.
   */
  mult?: number;
  /** When true, socketing this gem grants the seeking/homing projectile behaviour. */
  grantsHoming?: boolean;
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

/** Like {@link gem} but accepts optional extra fields (mult, grantsHoming) for support gems. */
function gemExt(
  id: string,
  family: string,
  color: string,
  stat: AffixStat,
  value: number,
  tier: number,
  extra?: Partial<Pick<GemDef, 'mult' | 'grantsHoming'>>,
): GemDef {
  return { id, name: `${TIER_PREFIX[tier]}${family}`, color, stat, value, tier, ...extra };
}

/**
 * The gem catalog: ruby=power, sapphire=hp, topaz=crit across tiers 1/2/3, plus a rare tier-3
 * diamond=multishot. Values scale by tier and stay comparable to gear affixes.
 */
/**
 * Code DEFAULTS for the gem catalog — the seed source for the `gems` content table and the fallback
 * the live {@link GEMS} catalog resets to. Treat as immutable; edit/extend the catalog via the DB.
 */
export const DEFAULT_GEMS: Record<string, GemDef> = {
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

  // --- Build-stat families: a gem for every buff affix, so sockets can shape any build ---
  // Emerald — life steal (% of damage healed): 2 / 3 / 5
  emerald_t1: gem('emerald_t1', 'Emerald', '#4ade80', 'lifesteal', 2, 1),
  emerald_t2: gem('emerald_t2', 'Emerald', '#4ade80', 'lifesteal', 3, 2),
  emerald_t3: gem('emerald_t3', 'Emerald', '#4ade80', 'lifesteal', 5, 3),
  // Amethyst — attack speed (% cooldown reduction): 2 / 3 / 4
  amethyst_t1: gem('amethyst_t1', 'Amethyst', '#b06bff', 'swift', 2, 1),
  amethyst_t2: gem('amethyst_t2', 'Amethyst', '#b06bff', 'swift', 3, 2),
  amethyst_t3: gem('amethyst_t3', 'Amethyst', '#b06bff', 'swift', 4, 3),
  // Jade — move speed (%): 3 / 4 / 6
  jade_t1: gem('jade_t1', 'Jade', '#5fd0a0', 'move', 3, 1),
  jade_t2: gem('jade_t2', 'Jade', '#5fd0a0', 'move', 4, 2),
  jade_t3: gem('jade_t3', 'Jade', '#5fd0a0', 'move', 6, 3),
  // Onyx — armor (% damage reduction): 3 / 5 / 8
  onyx_t1: gem('onyx_t1', 'Onyx', '#54546a', 'armor', 3, 1),
  onyx_t2: gem('onyx_t2', 'Onyx', '#54546a', 'armor', 5, 2),
  onyx_t3: gem('onyx_t3', 'Onyx', '#54546a', 'armor', 8, 3),
  // Opal — vigor (HP per second): 1 / 2 / 3
  opal_t1: gem('opal_t1', 'Opal', '#d8e0ff', 'vigor', 1, 1),
  opal_t2: gem('opal_t2', 'Opal', '#d8e0ff', 'vigor', 2, 2),
  opal_t3: gem('opal_t3', 'Opal', '#d8e0ff', 'vigor', 3, 3),

  // --- Modifier / support gem families: shape projectile behaviour ---
  // Voltaic — chain (projectile bounces): 1 / 1 / 2
  voltaic_t1: gem('voltaic_t1', 'Voltaic Gem', '#9b6bff', 'chain', 1, 1),
  voltaic_t2: gem('voltaic_t2', 'Voltaic Gem', '#9b6bff', 'chain', 1, 2),
  voltaic_t3: gem('voltaic_t3', 'Voltaic Gem', '#9b6bff', 'chain', 2, 3),
  // Lancing — pierce (projectile passes through): 1 / 2 / 2
  lancing_t1: gem('lancing_t1', 'Lancing Gem', '#cfd6e6', 'pierce', 1, 1),
  lancing_t2: gem('lancing_t2', 'Lancing Gem', '#cfd6e6', 'pierce', 2, 2),
  lancing_t3: gem('lancing_t3', 'Lancing Gem', '#cfd6e6', 'pierce', 2, 3),
  // Splitting — fork (projectile splits on hit): 1 / 1 / 2
  splitting_t1: gem('splitting_t1', 'Splitting Gem', '#ff9a4d', 'fork', 1, 1),
  splitting_t2: gem('splitting_t2', 'Splitting Gem', '#ff9a4d', 'fork', 1, 2),
  splitting_t3: gem('splitting_t3', 'Splitting Gem', '#ff9a4d', 'fork', 2, 3),
  // Concussive — spell AoE radius bonus (%): 0.2 / 0.35 / 0.5
  concussive_t1: gem('concussive_t1', 'Concussive Gem', '#ffd24a', 'spellaoe', 0.2, 1),
  concussive_t2: gem('concussive_t2', 'Concussive Gem', '#ffd24a', 'spellaoe', 0.35, 2),
  concussive_t3: gem('concussive_t3', 'Concussive Gem', '#ffd24a', 'spellaoe', 0.5, 3),
  // Seeking — homing projectiles (grantsHoming) + tiny +10% AoE; stat 'spellaoe' value 0.1
  seeking_t1: gemExt('seeking_t1', 'Seeking Gem', '#5fd0a0', 'spellaoe', 0.1, 1, {
    grantsHoming: true,
  }),
  seeking_t2: gemExt('seeking_t2', 'Seeking Gem', '#5fd0a0', 'spellaoe', 0.1, 2, {
    grantsHoming: true,
  }),
  seeking_t3: gemExt('seeking_t3', 'Seeking Gem', '#5fd0a0', 'spellaoe', 0.1, 3, {
    grantsHoming: true,
  }),
  // Overcharge — rare t3 only: +3 chain at a 20% damage cost (mult 0.8)
  overcharge_t3: gemExt('overcharge_t3', 'Overcharge Gem', '#ff4d7a', 'chain', 3, 3, {
    mult: 0.8,
  }),
  // Impaler — rare t3 only: +3 pierce at a 15% damage cost (mult 0.85)
  impaler_t3: gemExt('impaler_t3', 'Impaler Gem', '#b0b0c0', 'pierce', 3, 3, {
    mult: 0.85,
  }),
};

/**
 * The LIVE gem catalog the game reads (gemDef/gemBonuses/rollGemDrop and the client icons). Starts
 * as a copy of {@link DEFAULT_GEMS}; the server overlays the `gems` DB rows at load and the client
 * overlays the catalog shipped in the content packet. Cleared and repopulated in place (stable
 * reference) so it can gain/lose gems added via SQL without re-importing.
 */
export const GEMS: Record<string, GemDef> = { ...DEFAULT_GEMS };

/**
 * Replace the live {@link GEMS} catalog with `list` (a gem added via SQL appears; one removed
 * disappears). An empty list RESETS to {@link DEFAULT_GEMS}, so `applyGemOverrides([])` restores the
 * code defaults. Mutates the existing object in place to preserve its reference for all readers.
 */
export function applyGemOverrides(list: GemDef[]): void {
  for (const id of Object.keys(GEMS)) delete GEMS[id];
  const src = list.length ? list : Object.values(DEFAULT_GEMS);
  for (const g of src) GEMS[g.id] = g;
}

/** True if `id` names a known gem. */
export function isGem(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(GEMS, id);
}

/** Look up a gem definition by id, or `undefined` if unknown. */
export function gemDef(id: string): GemDef | undefined {
  return GEMS[id];
}

/** How many same-kind gems fuse into one of the next tier (the Diablo cube rule). */
export const GEMS_PER_COMBINE = 3;

/**
 * The next-tier gem id in the same family (e.g. `ruby_t1` → `ruby_t2`), or undefined if the gem is
 * unknown or already top tier. Gem ids are `<family>_t<tier>`, so the family is the part before the
 * final `_t`.
 */
export function nextGemTier(id: string): string | undefined {
  const def = GEMS[id];
  if (!def || def.tier >= 3) return undefined;
  const family = id.slice(0, id.lastIndexOf('_t'));
  const next = `${family}_t${def.tier + 1}`;
  return GEMS[next] ? next : undefined;
}

/** The stats a gem can grant (the gem-able subset of {@link AffixStat} — every buff stat). */
export interface GemBonuses {
  power: number;
  hp: number;
  crit: number;
  multishot: number;
  lifesteal: number;
  swift: number;
  move: number;
  armor: number;
  vigor: number;
  // Projectile-modifier stats — sourced from support gems only, never roll as gear affixes.
  chain: number;
  pierce: number;
  fork: number;
  spellaoe: number;
  /** Number of seeking/homing gems socketed (each seeking gem contributes 1). */
  homing: number;
  /**
   * Cumulative spell-damage multiplier from all support gems (product of each gem's `mult`; gems
   * without `mult` contribute 1.0, so pure modifier gems have no damage penalty).
   */
  mult: number;
}

/**
 * Sum the stat bonuses from a list of socketed gem ids. `null` entries (empty sockets) and unknown
 * ids are ignored; never throws. Returns flat totals across every gem-able stat.
 */
export function gemBonuses(socketed: (string | null)[]): GemBonuses {
  const out: GemBonuses = {
    power: 0,
    hp: 0,
    crit: 0,
    multishot: 0,
    lifesteal: 0,
    swift: 0,
    move: 0,
    armor: 0,
    vigor: 0,
    chain: 0,
    pierce: 0,
    fork: 0,
    spellaoe: 0,
    homing: 0,
    mult: 1,
  };
  for (const id of socketed) {
    if (id === null) continue;
    const def = GEMS[id];
    if (def === undefined) continue;

    // Apply per-gem damage multiplier (support gems carry mult < 1 as a tradeoff).
    out.mult *= def.mult ?? 1;

    // Grant homing if this gem type flags it (seeking gems use a field, not a stat).
    if (def.grantsHoming) out.homing += 1;

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
      case 'lifesteal':
        out.lifesteal += def.value;
        break;
      case 'swift':
        out.swift += def.value;
        break;
      case 'move':
        out.move += def.value;
        break;
      case 'armor':
        out.armor += def.value;
        break;
      case 'vigor':
        out.vigor += def.value;
        break;
      case 'chain':
        out.chain += def.value;
        break;
      case 'pierce':
        out.pierce += def.value;
        break;
      case 'fork':
        out.fork += def.value;
        break;
      case 'spellaoe':
        out.spellaoe += def.value;
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
