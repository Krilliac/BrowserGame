import { describe, expect, it } from 'vitest';
import { LOOT_TABLES, rollLoot } from './loot.js';

/**
 * A deterministic RNG that yields values from a fixed sequence, cycling when exhausted. Each
 * call to rollLoot consumes two values per table row: one to gate the drop, one for quantity.
 */
function seq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i += 1;
    return v;
  };
}

describe('rollLoot (pure drop tables)', () => {
  it('produces expected stacks for a known rng sequence (wolf)', () => {
    // Row order: gold (chance 0.9), wolf_pelt (chance 0.6).
    // gold: gate 0.0 < 0.9 -> drop, qty draw 0.0 -> min 3.
    // pelt: gate 0.0 < 0.6 -> drop, qty draw 0.99 -> max 2.
    const rng = seq([0, 0, 0, 0.99]);
    expect(rollLoot('wolf', rng)).toEqual([
      { item: 'gold', qty: 3 },
      { item: 'wolf_pelt', qty: 2 },
    ]);
  });

  it('drops nothing when every gate roll fails (chance acts as a floor)', () => {
    // Gate value 1 is never < any chance (chances are < 1), so no row drops.
    expect(rollLoot('skeleton', seq([1]))).toEqual([]);
  });

  it('drops every row when gate rolls always pass', () => {
    // Gate 0 passes every chance; quantity 0 gives each row its min.
    const stacks = rollLoot('skeleton', seq([0]));
    expect(stacks).toEqual([
      { item: 'gold', qty: 5 },
      { item: 'bone', qty: 1 },
      { item: 'rune_shard', qty: 1 },
    ]);
  });

  it('returns [] for an unknown template id (no throw)', () => {
    expect(rollLoot('dragon', seq([0]))).toEqual([]);
    expect(rollLoot('', seq([0]))).toEqual([]);
  });

  it("keeps quantities within each row's [min, max]", () => {
    for (const templateId of Object.keys(LOOT_TABLES)) {
      const table = LOOT_TABLES[templateId] ?? [];
      const bounds = new Map(table.map((e) => [e.item, { min: e.min, max: e.max }]));
      // Random rng across many trials; every produced stack must respect bounds.
      const rng = Math.random;
      for (let trial = 0; trial < 200; trial++) {
        for (const stack of rollLoot(templateId, rng)) {
          const b = bounds.get(stack.item);
          expect(b).toBeDefined();
          expect(stack.qty).toBeGreaterThanOrEqual(b?.min ?? 0);
          expect(stack.qty).toBeLessThanOrEqual(b?.max ?? 0);
        }
      }
    }
  });

  it('merges duplicate item ids into a single summed stack', () => {
    // Two rows both dropping gold should collapse into one stack with summed qty.
    const table = [
      { item: 'gold' as const, chance: 1, min: 2, max: 2 },
      { item: 'gold' as const, chance: 1, min: 5, max: 5 },
    ];
    LOOT_TABLES['_test_dupe'] = table;
    try {
      // Gate 0 passes both rows; qty draw 0 gives each its (min === max) value.
      expect(rollLoot('_test_dupe', seq([0]))).toEqual([{ item: 'gold', qty: 7 }]);
    } finally {
      delete LOOT_TABLES['_test_dupe'];
    }
  });

  it('uses Math.random by default and stays within bounds', () => {
    for (const stack of rollLoot('bat')) {
      expect(stack.qty).toBeGreaterThanOrEqual(1);
    }
  });
});
