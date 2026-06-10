import { describe, expect, it } from 'vitest';
import { LOOT_TABLES, rollLoot } from './loot.js';

/**
 * Deterministic RNG yielding a fixed sequence (cycling). The drop-table engine draws in the
 * order: each `always` row's quantity, then the main pick + its quantity, then (if a rare table
 * exists) the rare gate + pick + quantity.
 */
function seq(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length] ?? 0;
    i += 1;
    return v;
  };
}

describe('rollLoot (drop tables)', () => {
  it('returns [] for an unknown template id (no throw)', () => {
    expect(rollLoot('dragon', seq([0]))).toEqual([]);
    expect(rollLoot('', seq([0]))).toEqual([]);
  });

  it('always drops gold and the main pick for a known sequence (wolf)', () => {
    // always gold qty: 3 + floor(0*10) = 3; main pick t=0 -> wolf_pelt; pelt qty 1 + floor(0*2) = 1.
    expect(rollLoot('wolf', seq([0, 0, 0]))).toEqual([
      { item: 'gold', qty: 3 },
      { item: 'wolf_pelt', qty: 1 },
    ]);
  });

  it('yields the rare rune_shard when the rare gate passes (skeleton)', () => {
    // all-zero draws: gold 5, bone 1, rare gate 0 < 0.05 -> rune_shard 1.
    expect(rollLoot('skeleton', seq([0]))).toEqual([
      { item: 'gold', qty: 5 },
      { item: 'bone', qty: 1 },
      { item: 'rune_shard', qty: 1 },
    ]);
  });

  it('always includes a gold drop for every monster (guaranteed always-row)', () => {
    for (const templateId of Object.keys(LOOT_TABLES)) {
      for (let trial = 0; trial < 50; trial++) {
        const stacks = rollLoot(templateId);
        expect(stacks.some((s) => s.item === 'gold')).toBe(true);
      }
    }
  });

  it('only drops rune_shard from tables that declare it in their rare sub-table', () => {
    // Derive the allowed set from the data so this stays correct as content grows.
    const allowed = new Set(
      Object.entries(LOOT_TABLES)
        .filter(([, t]) => t.rare?.table.some((r) => r.value === 'rune_shard'))
        .map(([id]) => id),
    );
    for (const templateId of Object.keys(LOOT_TABLES)) {
      if (allowed.has(templateId)) continue;
      for (let trial = 0; trial < 100; trial++) {
        expect(rollLoot(templateId).some((s) => s.item === 'rune_shard')).toBe(false);
      }
    }
  });

  it('produces only positive quantities within sane bounds', () => {
    // The cap allows for high-area gold piles (e.g. the Tundra Behemoth) while still catching
    // a runaway quantity bug.
    for (const templateId of Object.keys(LOOT_TABLES)) {
      for (let trial = 0; trial < 200; trial++) {
        for (const stack of rollLoot(templateId)) {
          expect(stack.qty).toBeGreaterThanOrEqual(1);
          expect(stack.qty).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
