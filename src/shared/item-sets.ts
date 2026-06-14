/**
 * Item sets — the Diablo-II "wear the matching pieces" system, shared by client and server.
 *
 * Some base items belong to a named **set** (their ids are listed in {@link ItemSetDef.pieces}). When
 * a player equips several pieces of the same set at once, the set grants extra {@link Affix} bonuses
 * at piece-count thresholds (2-piece, 4-piece, …) — the classic "the partial set is good, the full
 * set is build-defining" loot chase. Bonuses reuse the same buff {@link AffixStat}s as normal affixes,
 * so they fold straight into the existing equipped-stat aggregation with no per-set code.
 *
 * Membership lives on the SET (like a runeword lists its runes), not on the item, so all set logic
 * stays in this one pure module — it never touches the content item type, the wire, or inventory.
 * This module is pure data + a fold: given the equipped base ids, it answers "which set bonuses are
 * active and what do they grant?". Detecting and applying them is the server's job (recomputeStats).
 */

import type { Affix } from './items.js';

/** One threshold bonus: granted once `requiredPieces` distinct set pieces are equipped. */
export interface ItemSetBonus {
  requiredPieces: number;
  affix: Affix;
}

/**
 * A named set: its `pieces` are the base item-ids that count toward it (typically one per slot), and
 * `bonuses` are the threshold rewards. Sets start contributing at 2 pieces (a single piece is just a
 * normal item). Several bonuses may share a threshold (e.g. two stats at the 4-piece mark).
 */
export interface ItemSetDef {
  id: string;
  name: string;
  pieces: string[];
  bonuses: ItemSetBonus[];
  flavor?: string;
}

/**
 * Code DEFAULTS for the item sets — the seed source for the `item_sets`/`item_set_bonuses` content
 * tables and the fallback the live {@link ITEM_SETS} resets to. Pieces are existing droppable base
 * items (the leather / iron / mithril tiers), so every set is farmable the moment it ships. Bonus
 * magnitudes sit around epic/legendary affix strength so completing a set feels like a real payoff.
 * Treat as immutable; tune via the DB.
 */
export const DEFAULT_ITEM_SETS: ItemSetDef[] = [
  {
    id: 'set_wanderer',
    name: "Wanderer's Garb",
    // The full leather tier — a seven-slot set built for speed and sustain.
    pieces: [
      'leather_cap',
      'leather_pauldrons',
      'leather_armor',
      'leather_gloves',
      'leather_belt',
      'leather_pants',
      'leather_boots',
    ],
    bonuses: [
      { requiredPieces: 2, affix: { stat: 'move', value: 10 } },
      { requiredPieces: 4, affix: { stat: 'vigor', value: 8 } },
      { requiredPieces: 6, affix: { stat: 'swift', value: 12 } },
      { requiredPieces: 6, affix: { stat: 'move', value: 8 } },
    ],
    flavor: 'The leathers of one who is never where the blow lands.',
  },
  {
    id: 'set_ironclad',
    name: 'Ironclad Aegis',
    // Iron helm/chest/legs + the iron blade — a four-piece bruiser set.
    pieces: ['iron_helm', 'iron_armor', 'iron_greaves', 'iron_sword'],
    bonuses: [
      { requiredPieces: 2, affix: { stat: 'armor', value: 10 } },
      { requiredPieces: 3, affix: { stat: 'hp', value: 60 } },
      { requiredPieces: 4, affix: { stat: 'power', value: 12 } },
      { requiredPieces: 4, affix: { stat: 'armor', value: 6 } },
    ],
    flavor: 'Iron answers iron; the full plate answers everything.',
  },
  {
    id: 'set_sentinel',
    name: "Sentinel's Plate",
    // Steel tier (between iron and mithril) — a four-piece defensive bruiser across distinct slots.
    pieces: ['steel_sword', 'steel_armor', 'steel_helm', 'tower_shield'],
    bonuses: [
      { requiredPieces: 2, affix: { stat: 'armor', value: 9 } },
      { requiredPieces: 3, affix: { stat: 'hp', value: 50 } },
      { requiredPieces: 4, affix: { stat: 'power', value: 14 } },
      { requiredPieces: 4, affix: { stat: 'armor', value: 5 } },
    ],
    flavor: 'Hold the line. The line is you.',
  },
  {
    id: 'set_mithril',
    name: 'Mithril Regalia',
    // High-tier mithril — a glass-cannon crit/power set.
    pieces: ['mithril_blade', 'mithril_armor', 'mithril_visage', 'mithril_mantle'],
    bonuses: [
      { requiredPieces: 2, affix: { stat: 'crit', value: 12 } },
      { requiredPieces: 4, affix: { stat: 'power', value: 18 } },
      { requiredPieces: 4, affix: { stat: 'crit', value: 8 } },
    ],
    flavor: 'Moonlight forged into a panoply for the worthy.',
  },
  {
    id: 'set_trinketer',
    name: "Trinketer's Cabal",
    // A jewelry set (neck + two rings + trinket) — a glassy caster's bauble collection.
    pieces: ['pendant', 'copper_ring', 'silver_ring', 'charm'],
    bonuses: [
      { requiredPieces: 2, affix: { stat: 'crit', value: 8 } },
      { requiredPieces: 3, affix: { stat: 'move', value: 12 } },
      { requiredPieces: 4, affix: { stat: 'multishot', value: 1 } },
      { requiredPieces: 4, affix: { stat: 'crit', value: 8 } },
    ],
    flavor: 'Small charms, quietly conspiring toward something lethal.',
  },
];

/** Deep-copy a set definition so the live table never aliases the immutable defaults. */
function cloneSet(s: ItemSetDef): ItemSetDef {
  const c: ItemSetDef = {
    id: s.id,
    name: s.name,
    pieces: [...s.pieces],
    bonuses: s.bonuses.map((b) => ({ requiredPieces: b.requiredPieces, affix: { ...b.affix } })),
  };
  if (s.flavor !== undefined) c.flavor = s.flavor;
  return c;
}

/** The LIVE item sets the stat fold reads. Initialized from {@link DEFAULT_ITEM_SETS}; the server
 *  overlays the `item_sets` DB rows onto it on load (see content.ts). Mutated in place. */
export const ITEM_SETS: ItemSetDef[] = DEFAULT_ITEM_SETS.map(cloneSet);

/**
 * Replace the live {@link ITEM_SETS} list with `list` (cloned), or RESET to {@link DEFAULT_ITEM_SETS}
 * when `list` is empty — so `applyItemSetOverrides([])` restores the code defaults and tests stay
 * clean. Called server-side from the content load + reload.
 */
export function applyItemSetOverrides(list: ItemSetDef[]): void {
  ITEM_SETS.length = 0;
  ITEM_SETS.push(...(list.length ? list : DEFAULT_ITEM_SETS).map(cloneSet));
}

/**
 * The active set bonuses for a loadout. Counts how many DISTINCT pieces of each set appear in
 * `equippedBaseIds` (nulls/undefined and unknown ids ignored; a piece worn once counts once), then
 * returns every bonus whose `requiredPieces` threshold is met. A set with fewer than 2 pieces
 * contributes nothing. Returns a fresh affix list (safe for the caller to fold/mutate).
 */
export function setBonuses(equippedBaseIds: readonly (string | null | undefined)[]): Affix[] {
  const worn = new Set<string>();
  for (const id of equippedBaseIds) if (id) worn.add(id);
  if (worn.size === 0) return [];
  const out: Affix[] = [];
  for (const set of ITEM_SETS) {
    let count = 0;
    for (const p of set.pieces) if (worn.has(p)) count++;
    if (count < 2) continue; // a single piece is just a normal item — sets start at two
    for (const b of set.bonuses) {
      if (count >= b.requiredPieces) out.push({ ...b.affix });
    }
  }
  return out;
}
