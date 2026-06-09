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

export type Rarity = 'common' | 'magic' | 'rare' | 'epic' | 'legendary';

/** Rarities from most to least common — also the visual/quality order. */
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
  slot: 'weapon' | 'armor';
  power?: number | null;
  hp?: number | null;
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
}

/** Roll a fresh instance of a base item: a rarity, then its stat(s). Deterministic given `rng`. */
export function rollItemInstance(
  uid: number,
  base: BaseItem,
  rng: () => number = Math.random,
): ItemInstance {
  const rarity = rollRarity(rng);
  return {
    uid,
    baseId: base.id,
    rarity,
    power: rollStat(base.power ?? 0, rarity, rng),
    hp: rollStat(base.hp ?? 0, rarity, rng),
  };
}

/** Display name: the base name, prefixed with the rarity for anything above common. */
export function instanceName(inst: ItemInstance, baseName: string): string {
  return inst.rarity === 'common' ? baseName : `${RARITY[inst.rarity].name} ${baseName}`;
}

/** Vendor gold paid for a gear instance — scales with its rolled stats and rarity. */
export function gearSellValue(inst: ItemInstance): number {
  return Math.max(1, Math.round((inst.power + inst.hp) * 0.6 * RARITY[inst.rarity].statMult));
}
