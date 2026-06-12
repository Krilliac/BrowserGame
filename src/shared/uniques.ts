/**
 * UNIQUE (named legendary) items — the hand-authored loot chase on top of the RNG-tier system.
 *
 * Where {@link rollItemInstance} produces a procedurally-named drop, a unique is a *designed* item:
 * a flavorful name, a fixed base it is built on, and a small set of signature, build-defining affixes
 * that never re-roll. Two players who find "Stormcaller's Reach" get the same powers — the chase is
 * for the item itself, not for a god roll on it. Only the rolled base power/hp vary (within the
 * `unique` rarity band) so each copy still feels like loot.
 *
 * Each unique references a real base item id from {@link EQUIPMENT} so the client can resolve its
 * slot and base name. The roller is pure (rng injected) and mirrors {@link rollItemInstance}'s shape.
 */

import { EQUIPMENT } from './equipment.js';
import type { ItemSlot } from './equipment.js';
import { rollStat, socketCountFor } from './items.js';
import type { Affix, ItemInstance } from './items.js';

/** A hand-authored unique: a name, the base item it is built on, and its fixed signature affixes. */
export interface UniqueDef {
  id: string;
  /** The hand-authored display name, shown instead of the affix-composed title. */
  name: string;
  /** A real {@link EQUIPMENT} base id — gives the slot and base power/hp. */
  baseId: string;
  /** 2-4 fixed, build-defining affixes. Strong (epic/legendary magnitude or a touch above). */
  affixes: Affix[];
  /** A flavor line shown in the tooltip. */
  flavor?: string;
}

/**
 * The curated unique pool. Spread across slots (weapons, off-hand, head, chest, hands, feet, neck,
 * rings, trinket) so a slot-targeted drop can usually find a unique. Affix magnitudes are kept inside
 * the agreed band: power 12-22, crit 10-20, multishot 2, lifesteal 6-10, move 12-18, vigor 8-15,
 * hp 40-70, swift 10-18, armor 8-14.
 */
export const UNIQUES: UniqueDef[] = [
  {
    id: 'stormcallers_reach',
    name: "Stormcaller's Reach",
    baseId: 'doomspike_partisan',
    affixes: [
      { stat: 'multishot', value: 2 },
      { stat: 'power', value: 18 },
      { stat: 'crit', value: 12 },
    ],
    flavor: 'Each strike splits into the storm it was forged from.',
  },
  {
    id: 'widowmaker',
    name: 'Widowmaker',
    baseId: 'serpentine_dagger',
    affixes: [
      { stat: 'crit', value: 20 },
      { stat: 'lifesteal', value: 9 },
      { stat: 'swift', value: 14 },
    ],
    flavor: 'It drinks deepest from those who never saw it coming.',
  },
  {
    id: 'sunderking',
    name: 'Sunderking',
    baseId: 'mithril_warhammer',
    affixes: [
      { stat: 'power', value: 22 },
      { stat: 'armor', value: 10 },
      { stat: 'hp', value: 55 },
    ],
    flavor: 'The crown was a hammer long before it was a throne.',
  },
  {
    id: 'frostfang',
    name: 'Frostfang',
    baseId: 'frostforged_glaive',
    affixes: [
      { stat: 'power', value: 17 },
      { stat: 'swift', value: 16 },
      { stat: 'crit', value: 14 },
    ],
    flavor: 'Cold enough to still a heartbeat between two strikes.',
  },
  {
    id: 'oathkeeper',
    name: 'Oathkeeper',
    baseId: 'bulwark_of_the_pale_moon',
    affixes: [
      { stat: 'armor', value: 14 },
      { stat: 'hp', value: 70 },
      { stat: 'vigor', value: 12 },
    ],
    flavor: 'It has never broken a vow, nor a siege.',
  },
  {
    id: 'crown_of_the_vigilant',
    name: 'Crown of the Vigilant',
    baseId: 'runed_crown_of_vigil',
    affixes: [
      { stat: 'hp', value: 60 },
      { stat: 'vigor', value: 14 },
      { stat: 'armor', value: 9 },
    ],
    flavor: 'The watch never ends, and neither does its wearer.',
  },
  {
    id: 'aegis_of_the_dawnward',
    name: 'Aegis of the Dawnward',
    baseId: 'runed_aegis_plate',
    affixes: [
      { stat: 'hp', value: 68 },
      { stat: 'armor', value: 13 },
      { stat: 'vigor', value: 10 },
    ],
    flavor: 'Worn by the first to meet the dark, and the last to fall.',
  },
  {
    id: 'gravewalkers_grasp',
    name: "Gravewalker's Grasp",
    baseId: 'stormbound_grasp',
    affixes: [
      { stat: 'lifesteal', value: 10 },
      { stat: 'power', value: 14 },
      { stat: 'crit', value: 11 },
    ],
    flavor: 'What it takes from the living, it gives back to its bearer.',
  },
  {
    id: 'windstride',
    name: 'Windstride',
    baseId: 'emberstride_boots',
    affixes: [
      { stat: 'move', value: 18 },
      { stat: 'swift', value: 12 },
      { stat: 'hp', value: 45 },
    ],
    flavor: 'The ground forgets you the moment you leave it.',
  },
  {
    id: 'heart_of_the_wyrm',
    name: 'Heart of the Wyrm',
    baseId: 'wyrmscale_pendant',
    affixes: [
      { stat: 'lifesteal', value: 8 },
      { stat: 'power', value: 12 },
      { stat: 'vigor', value: 11 },
    ],
    flavor: 'It still beats, slow and patient, against your chest.',
  },
  {
    id: 'bloodbinder',
    name: 'Bloodbinder',
    baseId: 'obsidian_signet',
    affixes: [
      { stat: 'crit', value: 16 },
      { stat: 'lifesteal', value: 9 },
    ],
    flavor: 'A pact signed in red, paid in red, repaid in red.',
  },
  {
    id: 'eye_of_the_huntress',
    name: 'Eye of the Huntress',
    baseId: 'hunters_charm',
    affixes: [
      { stat: 'multishot', value: 2 },
      { stat: 'crit', value: 13 },
      { stat: 'move', value: 12 },
    ],
    flavor: 'It sees three paths where the prey sees one.',
  },
];

/** Look up the base item for a unique def, falling back to a zero-stat placeholder if missing. */
function baseOf(def: UniqueDef): { power: number; hp: number } {
  const base = EQUIPMENT[def.baseId];
  return { power: base?.power ?? 0, hp: base?.hp ?? 0 };
}

/** A fresh array of `n` empty sockets (mirrors items.ts). */
function emptySockets(n: number): (string | null)[] {
  return new Array<string | null>(n).fill(null);
}

/**
 * Mint a concrete instance of a specific unique: `unique` rarity, the hand-authored name, rolled
 * base power/hp within the unique band, the def's fixed affixes, and empty sockets. Pure given `rng`.
 */
export function rollUnique(
  uid: number,
  def: UniqueDef,
  rng: () => number = Math.random,
): ItemInstance {
  const base = baseOf(def);
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

/** Pick a random unique from the pool and mint it. Deterministic given `rng`. */
export function rollRandomUnique(uid: number, rng: () => number = Math.random): ItemInstance {
  const idx = Math.floor(rng() * UNIQUES.length);
  const def = UNIQUES[Math.min(idx, UNIQUES.length - 1)] ?? UNIQUES[0]!;
  return rollUnique(uid, def, rng);
}

/** The unique defs whose base item occupies the given slot (handy for slot-targeted drops). */
export function uniquesForSlot(slot: ItemSlot): UniqueDef[] {
  return UNIQUES.filter((def) => EQUIPMENT[def.baseId]?.slot === slot);
}
