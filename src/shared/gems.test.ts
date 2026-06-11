import { describe, expect, it } from 'vitest';
import { GEMS, gemBonuses, gemDef, isGem, rollGemDrop } from './gems.js';

const VALID_STATS = new Set([
  'power',
  'hp',
  'crit',
  'multishot',
  'lifesteal',
  'swift',
  'move',
  'armor',
  'vigor',
]);

/** The full zero baseline for a gemBonuses() result (every gem-able stat). */
const ZERO_BONUSES = {
  power: 0,
  hp: 0,
  crit: 0,
  multishot: 0,
  lifesteal: 0,
  swift: 0,
  move: 0,
  armor: 0,
  vigor: 0,
};

describe('GEMS catalog', () => {
  it('every entry is internally consistent (id, stat, positive value, tier 1..3)', () => {
    for (const [key, def] of Object.entries(GEMS)) {
      expect(def.id).toBe(key);
      expect(VALID_STATS.has(def.stat)).toBe(true);
      expect(def.value).toBeGreaterThan(0);
      expect(def.tier).toBeGreaterThanOrEqual(1);
      expect(def.tier).toBeLessThanOrEqual(3);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });

  it('covers power/hp/crit families across three tiers, plus a tier-3 multishot diamond', () => {
    expect(GEMS.ruby_t1?.stat).toBe('power');
    expect(GEMS.sapphire_t2?.stat).toBe('hp');
    expect(GEMS.topaz_t3?.stat).toBe('crit');
    expect(GEMS.diamond_t3?.stat).toBe('multishot');
    expect(GEMS.diamond_t3?.tier).toBe(3);
    // The only multishot gem is the diamond.
    const multishotGems = Object.values(GEMS).filter((g) => g.stat === 'multishot');
    expect(multishotGems).toHaveLength(1);
  });

  it('values scale up with tier within a family', () => {
    expect(GEMS.ruby_t1!.value).toBeLessThan(GEMS.ruby_t2!.value);
    expect(GEMS.ruby_t2!.value).toBeLessThan(GEMS.ruby_t3!.value);
    expect(GEMS.sapphire_t1!.value).toBeLessThan(GEMS.sapphire_t3!.value);
  });
});

describe('isGem / gemDef', () => {
  it('recognizes known gems and rejects unknowns', () => {
    expect(isGem('ruby_t1')).toBe(true);
    expect(isGem('diamond_t3')).toBe(true);
    expect(isGem('not_a_gem')).toBe(false);
    expect(isGem('')).toBe(false);
    // Must not be fooled by inherited Object properties.
    expect(isGem('toString')).toBe(false);
    expect(isGem('constructor')).toBe(false);
  });

  it('returns defs for known gems and undefined otherwise', () => {
    expect(gemDef('topaz_t2')).toEqual(GEMS.topaz_t2);
    expect(gemDef('nope')).toBeUndefined();
  });
});

describe('gemBonuses', () => {
  it('returns all zeros for an empty list', () => {
    expect(gemBonuses([])).toEqual(ZERO_BONUSES);
  });

  it('sums a single gem', () => {
    expect(gemBonuses(['ruby_t3'])).toEqual({ ...ZERO_BONUSES, power: 10 });
  });

  it('sums mixed gems across stats and stacks same-stat gems', () => {
    const total = gemBonuses(['ruby_t1', 'ruby_t2', 'sapphire_t3', 'topaz_t1', 'diamond_t3']);
    expect(total).toEqual({
      ...ZERO_BONUSES,
      power: 3 + 6, // ruby_t1 + ruby_t2
      hp: 55, // sapphire_t3
      crit: 3, // topaz_t1
      multishot: 1, // diamond_t3
    });
  });

  it('sums the new build-stat families (lifesteal / armor / vigor)', () => {
    expect(gemBonuses(['emerald_t3', 'onyx_t2', 'opal_t1'])).toEqual({
      ...ZERO_BONUSES,
      lifesteal: 5,
      armor: 5,
      vigor: 1,
    });
  });

  it('ignores null (empty) sockets', () => {
    expect(gemBonuses([null, 'ruby_t1', null])).toEqual({ ...ZERO_BONUSES, power: 3 });
  });

  it('ignores unknown gem ids without throwing', () => {
    expect(() => gemBonuses(['mystery', 'ruby_t1', 'toString'])).not.toThrow();
    expect(gemBonuses(['mystery', 'ruby_t1', 'toString'])).toEqual({ ...ZERO_BONUSES, power: 3 });
  });
});

describe('rollGemDrop', () => {
  it('rng=0 yields a tier-1 gem (lowest tiers are most common)', () => {
    const id = rollGemDrop(() => 0);
    expect(isGem(id)).toBe(true);
    expect(GEMS[id]!.tier).toBe(1);
  });

  it('rng just under 1 yields a valid gem (the rarest tier)', () => {
    const id = rollGemDrop(() => 0.999999);
    expect(isGem(id)).toBe(true);
    expect(GEMS[id]!.tier).toBe(3);
  });

  it('always returns a valid gem id across the rng range', () => {
    for (let i = 0; i < 100; i++) {
      const id = rollGemDrop(() => i / 100);
      expect(isGem(id)).toBe(true);
    }
  });

  it('weights lower tiers far more common than tier 3', () => {
    let seq = 0;
    const rng = (): number => {
      // Deterministic LCG so the distribution is reproducible.
      seq = (seq * 1664525 + 1013904223) % 0x100000000;
      return seq / 0x100000000;
    };
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 10000; i++) {
      const def = GEMS[rollGemDrop(rng)]!;
      counts[def.tier as 1 | 2 | 3]++;
    }
    expect(counts[1]).toBeGreaterThan(counts[2]);
    expect(counts[2]).toBeGreaterThan(counts[3]);
  });

  it('defaults rng to Math.random and still returns a valid gem', () => {
    expect(isGem(rollGemDrop())).toBe(true);
  });
});
