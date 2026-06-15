/**
 * Bag-sort: a pure ordering for a character's loose gear (the bag), used by the `/sort` command.
 *
 * The order is the one a player scanning their bag expects: group by equipment slot (weapons first,
 * then armor head-to-toe, then jewelry), best rarity first within a slot, then the heavier-rolled
 * piece, then by name for a stable tiebreak. It is intentionally framework-free — the caller supplies
 * a `slotOf(baseId)` lookup so this module never imports the content DB and stays trivially testable.
 */

import type { ItemInstance, Rarity } from './items.js';

/** Slot display order: hands/weapons, then armor top-to-bottom, then jewelry. */
const SLOT_SORT: readonly string[] = [
  'mainhand',
  'offhand',
  'head',
  'shoulders',
  'chest',
  'hands',
  'waist',
  'legs',
  'feet',
  'neck',
  'ring',
  'trinket',
];

/** Rarity rank, higher = better. Unique/corrupted sit above the normal tiers. */
const RARITY_RANK: Record<Rarity, number> = {
  common: 0,
  magic: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  corrupted: 5,
  unique: 6,
};

/** Index of a slot in the display order; unknown/absent slots sort to the end. */
function slotIndex(slot: string | null | undefined): number {
  if (!slot) return SLOT_SORT.length;
  const i = SLOT_SORT.indexOf(slot);
  return i < 0 ? SLOT_SORT.length : i;
}

/**
 * Return a NEW array of the bag sorted for display (does not mutate the input). Ordering: slot group,
 * then best rarity first, then higher total rolled stats (power + hp), then name. `slotOf` maps a base
 * id to its equipment slot (or null/undefined for unknown); `nameOf` is the display name for the
 * tiebreak (falls back to the base id).
 */
export function sortBag(
  items: readonly ItemInstance[],
  slotOf: (baseId: string) => string | null | undefined,
  nameOf: (inst: ItemInstance) => string = (i) => i.baseId,
): ItemInstance[] {
  return [...items].sort((a, b) => {
    const sa = slotIndex(slotOf(a.baseId));
    const sb = slotIndex(slotOf(b.baseId));
    if (sa !== sb) return sa - sb;
    const ra = RARITY_RANK[a.rarity] ?? 0;
    const rb = RARITY_RANK[b.rarity] ?? 0;
    if (ra !== rb) return rb - ra; // best rarity first
    const statsA = a.power + a.hp;
    const statsB = b.power + b.hp;
    if (statsA !== statsB) return statsB - statsA; // heavier roll first
    return nameOf(a).localeCompare(nameOf(b));
  });
}
