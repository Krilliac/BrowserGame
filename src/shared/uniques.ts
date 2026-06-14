/**
 * UNIQUE (named legendary) items — the hand-authored loot chase on top of the RNG-tier system.
 *
 * Where {@link rollItemInstance} produces a procedurally-named drop, a unique is a *designed* item:
 * a flavorful name, a fixed base it is built on, and a small set of signature, build-defining affixes
 * that never re-roll. Two players who find "Stormcaller's Reach" get the same powers — the chase is
 * for the item itself, not for a god roll on it. Only the rolled base power/hp vary (within the
 * `unique` rarity band) so each copy still feels like loot.
 *
 * The catalogue itself is **database-driven**: definitions live in the `uniques` table (seeded from
 * src/server/db/seed-uniques.ts) and are loaded by content.ts, which owns the random pick + base
 * resolution. This module stays pure: it only defines the shape and the rng-injected minting, so it
 * is shared by the seed layer, the content loader, and the unit tests without importing item data.
 */

import { rollStat, socketCountFor } from './items.js';
import type { Affix, ItemInstance } from './items.js';

/** A hand-authored unique: a name, the base item it is built on, and its fixed signature affixes. */
export interface UniqueDef {
  id: string;
  /** The hand-authored display name, shown instead of the affix-composed title. */
  name: string;
  /** A real item base id (from the `items` table) — gives the slot and base power/hp. */
  baseId: string;
  /** 2-4 fixed, build-defining affixes. Strong (epic/legendary magnitude or a touch above). */
  affixes: Affix[];
  /** A flavor line shown in the tooltip. */
  flavor?: string;
}

/** A fresh array of `n` empty sockets (mirrors items.ts). */
function emptySockets(n: number): (string | null)[] {
  return new Array<string | null>(n).fill(null);
}

/**
 * Mint a concrete instance of a specific unique: `unique` rarity, the hand-authored name, rolled
 * base power/hp within the unique band, the def's fixed affixes, and empty sockets. The base item's
 * power/hp are passed in (resolved from the content DB by the caller). Pure given `rng`.
 */
export function rollUnique(
  uid: number,
  def: UniqueDef,
  base: { power: number; hp: number },
  rng: () => number = Math.random,
): ItemInstance {
  return {
    uid,
    baseId: def.baseId,
    rarity: 'unique',
    name: def.name,
    power: rollStat(base.power, 'unique', rng),
    hp: rollStat(base.hp, 'unique', rng),
    // Fixed, hand-authored affixes — copied so callers can't mutate the shared def.
    affixes: def.affixes.map((a) => ({ ...a })),
    sockets: emptySockets(socketCountFor('unique')),
  };
}

/** Pick a random unique def from a pool (deterministic given `rng`). Returns undefined if empty. */
export function pickUnique(
  defs: UniqueDef[],
  rng: () => number = Math.random,
): UniqueDef | undefined {
  if (defs.length === 0) return undefined;
  const idx = Math.floor(rng() * defs.length);
  return defs[Math.min(idx, defs.length - 1)];
}
