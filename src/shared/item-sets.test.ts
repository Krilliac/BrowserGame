import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_ITEM_SETS,
  ITEM_SETS,
  applyItemSetOverrides,
  setBonuses,
  type ItemSetDef,
} from './item-sets.js';

// Restore the live table to code defaults after any override test so suites stay isolated.
afterEach(() => applyItemSetOverrides([]));

describe('DEFAULT_ITEM_SETS', () => {
  it('are well-formed: unique ids, non-empty pieces, ascending sensible thresholds', () => {
    const ids = new Set<string>();
    for (const s of DEFAULT_ITEM_SETS) {
      expect(s.id).toMatch(/^set_/);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      expect(s.pieces.length).toBeGreaterThanOrEqual(2);
      expect(new Set(s.pieces).size).toBe(s.pieces.length); // no duplicate pieces
      expect(s.bonuses.length).toBeGreaterThan(0);
      for (const b of s.bonuses) {
        expect(b.requiredPieces).toBeGreaterThanOrEqual(2);
        expect(b.requiredPieces).toBeLessThanOrEqual(s.pieces.length);
        expect(b.affix.value).toBeGreaterThan(0);
      }
    }
  });
});

describe('setBonuses', () => {
  it('returns nothing for an empty / piece-less loadout', () => {
    expect(setBonuses([])).toEqual([]);
    expect(setBonuses([null, undefined, null])).toEqual([]);
    expect(setBonuses(['rusty_sword', 'buckler'])).toEqual([]); // real items, no set membership
  });

  it('grants nothing below the 2-piece floor', () => {
    expect(setBonuses(['leather_cap'])).toEqual([]);
  });

  it('grants the 2-piece bonus at exactly two pieces', () => {
    const b = setBonuses(['leather_cap', 'leather_armor']);
    expect(b).toContainEqual({ stat: 'move', value: 10 });
    // 4- and 6-piece thresholds are not yet met
    expect(b).not.toContainEqual({ stat: 'vigor', value: 8 });
    expect(b.some((a) => a.stat === 'swift')).toBe(false);
  });

  it('accumulates every met threshold at full set', () => {
    const full = DEFAULT_ITEM_SETS.find((s) => s.id === 'set_wanderer')!.pieces;
    const b = setBonuses(full);
    expect(b).toContainEqual({ stat: 'move', value: 10 }); // 2pc
    expect(b).toContainEqual({ stat: 'vigor', value: 8 }); // 4pc
    expect(b).toContainEqual({ stat: 'swift', value: 12 }); // 6pc
    expect(b).toContainEqual({ stat: 'move', value: 8 }); // 6pc (second bonus at same threshold)
  });

  it('counts a duplicate base id only once', () => {
    // Two of the same piece must NOT cross the 2-piece threshold.
    expect(setBonuses(['leather_cap', 'leather_cap'])).toEqual([]);
  });

  it('ignores nulls and unknown ids while counting real pieces', () => {
    const b = setBonuses(['iron_helm', null, 'iron_armor', 'totally_not_an_item', undefined]);
    expect(b).toContainEqual({ stat: 'armor', value: 10 }); // ironclad 2pc
  });

  it('adds bonuses from two different sets worn simultaneously', () => {
    const b = setBonuses(['leather_cap', 'leather_armor', 'iron_helm', 'iron_armor']);
    expect(b).toContainEqual({ stat: 'move', value: 10 }); // wanderer 2pc
    expect(b).toContainEqual({ stat: 'armor', value: 10 }); // ironclad 2pc
  });

  it('respects intermediate (3-piece) thresholds', () => {
    const b = setBonuses(['iron_helm', 'iron_armor', 'iron_greaves']);
    expect(b).toContainEqual({ stat: 'armor', value: 10 }); // 2pc
    expect(b).toContainEqual({ stat: 'hp', value: 60 }); // 3pc
    expect(b).not.toContainEqual({ stat: 'power', value: 12 }); // 4pc not yet met
  });
});

describe('applyItemSetOverrides', () => {
  it('replaces the live table and is read by setBonuses', () => {
    const custom: ItemSetDef = {
      id: 'set_test',
      name: 'Test Set',
      pieces: ['a', 'b'],
      bonuses: [{ requiredPieces: 2, affix: { stat: 'power', value: 999 } }],
    };
    applyItemSetOverrides([custom]);
    expect(ITEM_SETS).toHaveLength(1);
    expect(setBonuses(['a', 'b'])).toContainEqual({ stat: 'power', value: 999 });
    // The default sets are no longer active under the override.
    expect(setBonuses(['leather_cap', 'leather_armor'])).toEqual([]);
  });

  it('resets to defaults when given an empty list', () => {
    applyItemSetOverrides([{ id: 'x', name: 'X', pieces: ['a', 'b'], bonuses: [] }]);
    applyItemSetOverrides([]);
    expect(ITEM_SETS.map((s) => s.id)).toEqual(DEFAULT_ITEM_SETS.map((s) => s.id));
  });

  it('does not alias the immutable defaults (clones on reset)', () => {
    applyItemSetOverrides([]);
    ITEM_SETS[0]!.bonuses[0]!.affix.value = -1; // mutate the live copy
    applyItemSetOverrides([]); // reset again
    expect(ITEM_SETS[0]!.bonuses[0]!.affix.value).toBeGreaterThan(0); // default untouched
  });
});
