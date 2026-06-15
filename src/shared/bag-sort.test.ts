import { describe, expect, it } from 'vitest';
import { sortBag } from './bag-sort.js';
import type { ItemInstance } from './items.js';

const inst = (over: Partial<ItemInstance> & { uid: number }): ItemInstance => ({
  baseId: 'base',
  rarity: 'common',
  power: 0,
  hp: 0,
  affixes: [],
  ...over,
});

// A tiny slot map for the fixtures (mirrors a content lookup).
const SLOTS: Record<string, string> = {
  sword: 'mainhand',
  helm: 'head',
  ring: 'ring',
  boots: 'feet',
};
const slotOf = (id: string): string | undefined => SLOTS[id];

describe('sortBag', () => {
  it('groups by slot order (weapon → armor → jewelry)', () => {
    const out = sortBag(
      [
        inst({ uid: 1, baseId: 'ring' }),
        inst({ uid: 2, baseId: 'sword' }),
        inst({ uid: 3, baseId: 'boots' }),
        inst({ uid: 4, baseId: 'helm' }),
      ],
      slotOf,
    );
    expect(out.map((i) => i.baseId)).toEqual(['sword', 'helm', 'boots', 'ring']);
  });

  it('within a slot, sorts best rarity first then by total rolled stats', () => {
    const out = sortBag(
      [
        inst({ uid: 1, baseId: 'sword', rarity: 'rare', power: 10 }),
        inst({ uid: 2, baseId: 'sword', rarity: 'legendary', power: 5 }),
        inst({ uid: 3, baseId: 'sword', rarity: 'rare', power: 30 }),
      ],
      slotOf,
    );
    // legendary first; then the two rares ordered by higher power.
    expect(out.map((i) => i.uid)).toEqual([2, 3, 1]);
  });

  it('sorts unknown-slot items to the end and does not mutate the input', () => {
    const input = [inst({ uid: 1, baseId: 'mystery' }), inst({ uid: 2, baseId: 'sword' })];
    const out = sortBag(input, slotOf);
    expect(out.map((i) => i.uid)).toEqual([2, 1]);
    expect(input.map((i) => i.uid)).toEqual([1, 2]); // original order preserved
  });
});
