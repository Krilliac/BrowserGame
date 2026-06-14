import { describe, expect, it } from 'vitest';
import { socketCountFor } from './items.js';
import { pickUnique, rollUnique, type UniqueDef } from './uniques.js';

/** A fake rng that yields the given values in order, then repeats the last. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

/**
 * uniques.ts is now a pure, data-free roller — the catalogue lives in the `uniques` DB table
 * (seeded from src/server/db/seed-uniques.ts and validated in seed-uniques.test.ts). These tests
 * exercise the minting + pick functions with a local sample def + base, no item data imported.
 */
const sample: UniqueDef = {
  id: 'test_blade',
  name: 'Test Blade',
  baseId: 'some_base',
  affixes: [
    { stat: 'power', value: 18 },
    { stat: 'crit', value: 12 },
  ],
  flavor: 'For testing only.',
};
const base = { power: 40, hp: 0 };

describe('rollUnique', () => {
  it('produces a unique-rarity instance with the def name + fixed affixes', () => {
    const inst = rollUnique(7, sample, base, seqRng([0.5]));
    expect(inst.uid).toBe(7);
    expect(inst.rarity).toBe('unique');
    expect(inst.name).toBe('Test Blade');
    expect(inst.baseId).toBe('some_base');
    expect(inst.affixes).toEqual(sample.affixes);
  });

  it('rolls power/hp within the unique band from the passed base', () => {
    const inst = rollUnique(1, sample, base, seqRng([0, 1]));
    // rollStat scales the base by the unique rarity band; the floor is the base itself.
    expect(inst.power).toBeGreaterThanOrEqual(base.power);
  });

  it('mints empty sockets matching socketCountFor(unique)', () => {
    const inst = rollUnique(1, sample, base, seqRng([0.5]));
    expect(inst.sockets ?? []).toHaveLength(socketCountFor('unique'));
    expect((inst.sockets ?? []).every((s) => s === null)).toBe(true);
  });

  it('does not let callers mutate the shared def via the instance', () => {
    const inst = rollUnique(1, sample, base, seqRng([0.5]));
    inst.affixes[0]!.value = 999;
    expect(sample.affixes[0]!.value).not.toBe(999);
  });
});

describe('pickUnique', () => {
  const pool: UniqueDef[] = [
    sample,
    { ...sample, id: 'b', name: 'B' },
    { ...sample, id: 'c', name: 'C' },
  ];

  it('picks the first entry at rng=0 and a later entry for a higher draw', () => {
    expect(pickUnique(pool, seqRng([0]))?.id).toBe('test_blade');
    expect(pickUnique(pool, seqRng([0.9]))?.id).toBe('c');
  });

  it('returns undefined for an empty pool', () => {
    expect(pickUnique([], seqRng([0.5]))).toBeUndefined();
  });
});
