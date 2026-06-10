/**
 * Item rarity + rolled instances — the Diablo-style "RNG tier loot" layer, shared by client and
 * server so the wire, the bag UI, and the authoritative stats all agree.
 *
 * A base item (from the content DB / `equipment.ts`) defines the *kind* of gear and its baseline
 * power/hp. When a monster drops gear, the server rolls a {@link Rarity} and a concrete stat value
 * around the base — producing an {@link ItemInstance} with its own rolled stats and a unique id.
 * Two "Iron Swords" are no longer interchangeable: one may be a Common with 12 power, another a
 * Legendary with 41. All randomness is injected (`rng`) so every function here is pure and tested.
 *
 * Forward note: this is the foundation for affixes ("loot = your build") and the living-loot meta —
 * an instance is the natural place to later hang rolled affixes (e.g. +crit) and provenance.
 */

import type { ItemSlot } from './equipment.js';

export type Rarity = 'common' | 'magic' | 'rare' | 'epic' | 'legendary' | 'corrupted';

/**
 * The normal-roll rarities, most to least common. **Corrupted is excluded on purpose** — it never
 * drops from the weighted roll or a rarity bump; it is only created by the corruption of an item
 * (see {@link rollCorruptedInstance}), so the area-corruption system is its sole source.
 */
export const RARITY_ORDER: Rarity[] = ['common', 'magic', 'rare', 'epic', 'legendary'];

export interface RarityDef {
  name: string;
  /** Relative drop weight (higher = more common). */
  weight: number;
  /** Multiplier applied to the base item's power/hp before variance. */
  statMult: number;
  /** ± fraction of variance around the multiplied stat (0.15 = ±15%). */
  variance: number;
  /** Display + glow color (drives the ground-drop glint and the bag entry). */
  color: string;
}

export const RARITY: Record<Rarity, RarityDef> = {
  common: { name: 'Common', weight: 1000, statMult: 1.0, variance: 0.1, color: '#c9c9c9' },
  magic: { name: 'Magic', weight: 430, statMult: 1.35, variance: 0.12, color: '#6ea8ff' },
  rare: { name: 'Rare', weight: 150, statMult: 1.8, variance: 0.15, color: '#ffd24a' },
  epic: { name: 'Epic', weight: 38, statMult: 2.4, variance: 0.18, color: '#c06bff' },
  legendary: { name: 'Legendary', weight: 7, statMult: 3.2, variance: 0.22, color: '#ff7a1a' },
  // Never weighted-rolled (weight 0); only born from corruption. The strongest base stats of all.
  corrupted: { name: 'Corrupted', weight: 0, statMult: 3.9, variance: 0.25, color: '#ff2d6f' },
};

/** Roll a rarity tier by weight. Deterministic given `rng`. */
export function rollRarity(rng: () => number = Math.random): Rarity {
  let total = 0;
  for (const r of RARITY_ORDER) total += RARITY[r].weight;
  let t = rng() * total;
  for (const r of RARITY_ORDER) {
    t -= RARITY[r].weight;
    if (t < 0) return r;
  }
  return 'common';
}

/** Bump a rarity up `steps` tiers (capped at legendary). Used for elite/champion drops. */
export function bumpRarity(rarity: Rarity, steps = 1): Rarity {
  const i = Math.min(RARITY_ORDER.length - 1, RARITY_ORDER.indexOf(rarity) + Math.max(0, steps));
  return RARITY_ORDER[i]!;
}

/**
 * Roll a concrete stat value for a base stat at a rarity: `base * statMult` then a uniform draw
 * within ±variance, rounded. A non-positive base yields 0 (e.g. a weapon has no hp). Positive
 * bases never roll below 1.
 */
export function rollStat(base: number, rarity: Rarity, rng: () => number = Math.random): number {
  if (base <= 0) return 0;
  const def = RARITY[rarity];
  const center = base * def.statMult;
  const lo = center * (1 - def.variance);
  const hi = center * (1 + def.variance);
  return Math.max(1, Math.round(lo + rng() * (hi - lo)));
}

/** The base (template) shape an instance is rolled from — a subset of the content DB item. */
export interface BaseItem {
  id: string;
  name: string;
  slot: ItemSlot;
  power?: number | null;
  hp?: number | null;
}

/**
 * Rollable bonus stats ("affixes") layered on top of a piece of gear's base stats. Most are scalar
 * bonuses, but `multishot` is *build-defining*: it adds extra projectiles to your projectile
 * abilities — gear that changes how your kit plays, the first taste of "loot = your build".
 */
export type AffixStat =
  | 'power'
  | 'hp'
  | 'crit'
  | 'multishot'
  // Debuffs — only appear on corrupted gear, paired with a strong buff:
  | 'frail' // value = max HP removed
  | 'fragile'; // value = % extra damage taken

/** One rolled affix. `value` is always a positive magnitude; debuff stats apply it as a penalty. */
export interface Affix {
  stat: AffixStat;
  value: number;
}

/** Affix stats that are penalties (corrupted gear pairs one of these with a strong buff). */
const DEBUFF_STATS: AffixStat[] = ['frail', 'fragile'];

/** True if an affix is a downside (rendered as a warning). */
export function isDebuff(a: Affix): boolean {
  return DEBUFF_STATS.includes(a.stat);
}

/** Stats that can appear on a normal (non-corrupted) affix roll. */
type RollableStat = 'power' | 'hp' | 'crit' | 'multishot';
const AFFIX_STATS: RollableStat[] = ['power', 'hp', 'crit', 'multishot'];

/** Pre-rarity-scaling base value ranges for the scalar affix stats (multishot is handled specially). */
const AFFIX_RANGES: Record<'power' | 'hp' | 'crit', { min: number; max: number }> = {
  power: { min: 2, max: 6 },
  hp: { min: 8, max: 22 },
  crit: { min: 2, max: 6 },
};

/** How many affixes a rarity rolls (common gear has none — rarity is the dopamine gate). */
export function affixCount(rarity: Rarity): number {
  const counts: Partial<Record<Rarity, number>> = {
    common: 0,
    magic: 1,
    rare: 2,
    epic: 2,
    legendary: 3,
  };
  return counts[rarity] ?? 0; // corrupted gets its affixes from the corrupted pair, not this
}

/** Roll an item's affixes: `affixCount(rarity)` distinct stats, each value scaled by rarity. */
export function rollAffixes(rarity: Rarity, rng: () => number = Math.random): Affix[] {
  const n = affixCount(rarity);
  if (n <= 0) return [];
  const pool = [...AFFIX_STATS];
  const mult = RARITY[rarity].statMult;
  const out: Affix[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const stat = pool.splice(Math.floor(rng() * pool.length), 1)[0]!;
    if (stat === 'multishot') {
      // A bounded, build-defining roll — never mult-scaled into absurdity.
      out.push({ stat, value: rarity === 'epic' || rarity === 'legendary' ? 2 : 1 });
    } else {
      const r = AFFIX_RANGES[stat];
      const base = r.min + rng() * (r.max - r.min);
      out.push({ stat, value: Math.max(1, Math.round(base * mult)) });
    }
  }
  return out;
}

/** Human-readable affix line, e.g. "+5% crit", "+1 projectile", or the debuff "-30 hp". */
export function affixLabel(a: Affix): string {
  switch (a.stat) {
    case 'crit':
      return `+${a.value}% crit`;
    case 'multishot':
      return `+${a.value} projectile${a.value > 1 ? 's' : ''}`;
    case 'frail':
      return `-${a.value} hp`;
    case 'fragile':
      return `+${a.value}% dmg taken`;
    default:
      return `+${a.value} ${a.stat}`;
  }
}

const CORRUPT_BUFFS: AffixStat[] = ['power', 'crit', 'multishot'];

/** Roll a corrupted item's affix pair: one strong buff and one debuff. */
export function rollCorruptedAffixes(rng: () => number = Math.random): Affix[] {
  const buff = CORRUPT_BUFFS[Math.floor(rng() * CORRUPT_BUFFS.length)]!;
  const debuff = DEBUFF_STATS[Math.floor(rng() * DEBUFF_STATS.length)]!;
  const span = (lo: number, hi: number): number => Math.round(lo + rng() * (hi - lo));
  const buffAffix: Affix =
    buff === 'multishot'
      ? { stat: 'multishot', value: 2 }
      : buff === 'power'
        ? { stat: 'power', value: span(8, 16) }
        : { stat: 'crit', value: span(10, 20) };
  const debuffAffix: Affix =
    debuff === 'frail'
      ? { stat: 'frail', value: span(20, 40) }
      : { stat: 'fragile', value: span(15, 30) };
  return [buffAffix, debuffAffix];
}

/** A concrete, rolled piece of gear a player can hold or equip. `uid` is unique within a world. */
export interface ItemInstance {
  uid: number;
  baseId: string;
  rarity: Rarity;
  /** Rolled attack power (0 for armor). */
  power: number;
  /** Rolled bonus max HP (0 for weapons). */
  hp: number;
  /** Rolled bonus affixes (empty for common gear). */
  affixes: Affix[];
}

/** Roll a fresh instance of a base item: a rarity, then its stat(s). Deterministic given `rng`. */
export function rollItemInstance(
  uid: number,
  base: BaseItem,
  rng: () => number = Math.random,
  rarityBump = 0,
): ItemInstance {
  const rarity = rarityBump > 0 ? bumpRarity(rollRarity(rng), rarityBump) : rollRarity(rng);
  return {
    uid,
    baseId: base.id,
    rarity,
    power: rollStat(base.power ?? 0, rarity, rng),
    hp: rollStat(base.hp ?? 0, rarity, rng),
    affixes: rollAffixes(rarity, rng),
  };
}

/** Build a corrupted instance: top-tier base stats plus a strong-buff/debuff corrupted affix pair. */
export function rollCorruptedInstance(
  uid: number,
  base: BaseItem,
  rng: () => number = Math.random,
): ItemInstance {
  return {
    uid,
    baseId: base.id,
    rarity: 'corrupted',
    power: rollStat(base.power ?? 0, 'corrupted', rng),
    hp: rollStat(base.hp ?? 0, 'corrupted', rng),
    affixes: rollCorruptedAffixes(rng),
  };
}

/** Display name: the base name, prefixed with the rarity for anything above common. */
export function instanceName(inst: ItemInstance, baseName: string): string {
  return inst.rarity === 'common' ? baseName : `${RARITY[inst.rarity].name} ${baseName}`;
}

/** Vendor gold paid for a gear instance — scales with its rolled stats, (buff) affixes, and rarity. */
export function gearSellValue(inst: ItemInstance): number {
  const affixWorth = inst.affixes.reduce((s, a) => s + (isDebuff(a) ? 0 : a.value), 0);
  return Math.max(
    1,
    Math.round((inst.power + inst.hp + affixWorth) * 0.6 * RARITY[inst.rarity].statMult),
  );
}
