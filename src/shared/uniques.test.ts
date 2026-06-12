import { describe, expect, it } from 'vitest';
import { EQUIPMENT } from './equipment.js';
import { socketCountFor } from './items.js';
import { UNIQUES, rollRandomUnique, rollUnique, uniquesForSlot } from './uniques.js';

/** A fake rng that yields the given values in order, then repeats the last. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe('UNIQUES catalogue', () => {
  it('every unique references a real EQUIPMENT base id', () => {
    for (const def of UNIQUES) {
      expect(EQUIPMENT[def.baseId], `${def.id} -> ${def.baseId}`).toBeDefined();
    }
  });

  it('has 10-12 entries', () => {
    expect(UNIQUES.length).toBeGreaterThanOrEqual(10);
    expect(UNIQUES.length).toBeLessThanOrEqual(12);
  });

  it('has no duplicate names', () => {
    const names = UNIQUES.map((u) => u.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has no duplicate ids', () => {
    const ids = UNIQUES.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each unique has 2-4 fixed affixes', () => {
    for (const def of UNIQUES) {
      expect(def.affixes.length, def.id).toBeGreaterThanOrEqual(2);
      expect(def.affixes.length, def.id).toBeLessThanOrEqual(4);
    }
  });

  it('never uses debuff stats on a unique', () => {
    for (const def of UNIQUES) {
      for (const a of def.affixes) {
        expect(['frail', 'fragile']).not.toContain(a.stat);
      }
    }
  });
});

describe('rollUnique', () => {
  const def = UNIQUES[0]!;

  it('produces a unique-rarity instance with the def name + fixed affixes', () => {
    const inst = rollUnique(1, def, seqRng([0.5]));
    expect(inst.uid).toBe(1);
    expect(inst.rarity).toBe('unique');
    expect(inst.name).toBe(def.name);
    expect(inst.baseId).toBe(def.baseId);
    expect(inst.affixes).toEqual(def.affixes);
  });

  it('rolls sensible power/hp from the base', () => {
    const base = EQUIPMENT[def.baseId]!;
    const inst = rollUnique(2, def, seqRng([0.5]));
    if (base.power && base.power > 0) {
      // unique statMult is 3.6 — a rolled power must clearly exceed the base.
      expect(inst.power).toBeGreaterThan(base.power);
    } else {
      expect(inst.power).toBe(0);
    }
    if (base.hp && base.hp > 0) {
      expect(inst.hp).toBeGreaterThan(base.hp);
    } else {
      expect(inst.hp).toBe(0);
    }
  });

  it('mints empty sockets matching socketCountFor(unique)', () => {
    const inst = rollUnique(3, def, seqRng([0.5]));
    expect(inst.sockets?.length).toBe(socketCountFor('unique'));
    expect(inst.sockets?.every((s) => s === null)).toBe(true);
  });

  it('does not let callers mutate the shared def via the instance', () => {
    const inst = rollUnique(4, def, seqRng([0.5]));
    inst.affixes[0]!.value = 999;
    expect(def.affixes[0]!.value).not.toBe(999);
  });
});

describe('rollRandomUnique', () => {
  it('is deterministic for a fixed rng (picks the first entry at rng=0)', () => {
    const inst = rollRandomUnique(7, seqRng([0]));
    expect(inst.name).toBe(UNIQUES[0]!.name);
    expect(inst.rarity).toBe('unique');
  });

  it('picks a later entry for a higher rng draw', () => {
    // First draw selects the index; 0.99 -> last entry.
    const inst = rollRandomUnique(8, seqRng([0.99]));
    expect(inst.name).toBe(UNIQUES[UNIQUES.length - 1]!.name);
  });

  it('always yields a real unique name', () => {
    const valid = new Set(UNIQUES.map((u) => u.name));
    for (let i = 0; i < UNIQUES.length; i++) {
      const inst = rollRandomUnique(i, seqRng([i / UNIQUES.length]));
      expect(valid.has(inst.name!)).toBe(true);
    }
  });
});

describe('uniquesForSlot', () => {
  it('returns only defs whose base occupies that slot', () => {
    const mainhand = uniquesForSlot('mainhand');
    expect(mainhand.length).toBeGreaterThan(0);
    for (const def of mainhand) {
      expect(EQUIPMENT[def.baseId]!.slot).toBe('mainhand');
    }
  });

  it('returns an empty array for a slot with no uniques', () => {
    // 'legs' has no unique authored in the pool.
    expect(uniquesForSlot('legs')).toEqual([]);
  });
});
