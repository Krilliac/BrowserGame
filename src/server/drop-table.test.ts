import { describe, expect, it } from 'vitest';
import { rollDropTable, rollWeighted } from './drop-table.js';
import type { DropRow, DropTable } from './drop-table.js';

/** A deterministic rng that cycles through a fixed list of draws in [0, 1). */
function fakeRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v ?? 0;
  };
}

describe('rollWeighted', () => {
  it('returns null for empty rows', () => {
    expect(rollWeighted<string>([], fakeRng([0.5]))).toBeNull();
  });

  it('returns null when total weight is non-positive', () => {
    const rows: DropRow<string>[] = [
      { value: 'a', weight: 0 },
      { value: 'b', weight: -3 },
    ];
    expect(rollWeighted(rows, fakeRng([0.5]))).toBeNull();
  });

  it('picks the row whose cumulative weight band the draw falls in', () => {
    const rows: DropRow<string>[] = [
      { value: 'a', weight: 1 },
      { value: 'b', weight: 99 },
    ];
    // total = 100. draw 0.005 * 100 = 0.5 -> falls in 'a' band [0,1).
    expect(rollWeighted(rows, fakeRng([0.005]))?.value).toBe('a');
    // draw 0.5 * 100 = 50 -> 'b' band [1,100).
    expect(rollWeighted(rows, fakeRng([0.5]))?.value).toBe('b');
  });

  it('skips non-positive weights when selecting', () => {
    const rows: DropRow<string>[] = [
      { value: 'zero', weight: 0 },
      { value: 'only', weight: 5 },
    ];
    expect(rollWeighted(rows, fakeRng([0.0]))?.value).toBe('only');
    expect(rollWeighted(rows, fakeRng([0.999]))?.value).toBe('only');
  });
});

describe('rollDropTable', () => {
  it('always-rows drop independently alongside one main pick', () => {
    const table: DropTable<string> = {
      always: [{ value: 'gold', weight: 1, min: 5, max: 5 }],
      main: [
        { value: 'pelt', weight: 1 },
        { value: 'bone', weight: 1 },
      ],
    };
    // draws: gold qty (-> 5), main weighted pick (0.0 -> first row 'pelt').
    const drops = rollDropTable(table, fakeRng([0.0, 0.0]));
    expect(drops).toEqual([
      { value: 'gold', qty: 5 },
      { value: 'pelt', qty: 1 },
    ]);
  });

  it('quantities fall within [min, max]', () => {
    const table: DropTable<string> = {
      main: [{ value: 'coin', weight: 1, min: 3, max: 12 }],
    };
    for (let d = 0; d < 100; d++) {
      const drops = rollDropTable(table, fakeRng([d / 100]));
      const coin = drops.find((x) => x.value === 'coin');
      expect(coin).toBeDefined();
      expect(coin!.qty).toBeGreaterThanOrEqual(3);
      expect(coin!.qty).toBeLessThanOrEqual(12);
    }
  });

  it('does not roll the rare table when the gate draw >= chance', () => {
    const table: DropTable<string> = {
      main: [{ value: 'common', weight: 1 }],
      rare: { chance: 0.1, table: [{ value: 'rune', weight: 1 }] },
    };
    // draws: main pick (0.0), main qty (0.0 -> 1), rare gate (0.5 >= 0.1 -> skip).
    const drops = rollDropTable(table, fakeRng([0.0, 0.0, 0.5]));
    expect(drops).toEqual([{ value: 'common', qty: 1 }]);
  });

  it('rolls the rare table when the gate draw < chance', () => {
    const table: DropTable<string> = {
      main: [{ value: 'common', weight: 1 }],
      rare: { chance: 0.1, table: [{ value: 'rune', weight: 1, min: 1, max: 1 }] },
    };
    // draws: main pick (0.0), main qty (0.0 -> 1), rare gate (0.05 < 0.1 -> roll),
    // rare pick (0.0), rare qty (0.0 -> 1).
    const drops = rollDropTable(table, fakeRng([0.0, 0.0, 0.05, 0.0, 0.0]));
    expect(drops).toEqual([
      { value: 'common', qty: 1 },
      { value: 'rune', qty: 1 },
    ]);
  });

  it('merges duplicate values into one summed drop', () => {
    const table: DropTable<string> = {
      always: [{ value: 'gold', weight: 1, min: 5, max: 5 }],
      main: [{ value: 'gold', weight: 1, min: 2, max: 2 }],
    };
    // draws: always gold qty (-> 5), main pick (0.0), main qty (-> 2).
    const drops = rollDropTable(table, fakeRng([0.0, 0.0, 0.0]));
    expect(drops).toEqual([{ value: 'gold', qty: 7 }]);
  });

  it('yields no drop when a selected row is "nothing"', () => {
    const table: DropTable<string> = {
      main: [{ value: 'blank', weight: 1, nothing: true }],
    };
    expect(rollDropTable(table, fakeRng([0.0]))).toEqual([]);
  });

  it('an empty main table contributes no main drop', () => {
    const table: DropTable<string> = {
      always: [{ value: 'gold', weight: 1, min: 1, max: 1 }],
      main: [],
    };
    expect(rollDropTable(table, fakeRng([0.0]))).toEqual([{ value: 'gold', qty: 1 }]);
  });
});
