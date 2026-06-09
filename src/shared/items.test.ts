import { describe, expect, it } from 'vitest';
import {
  affixCount,
  affixLabel,
  gearSellValue,
  instanceName,
  RARITY,
  RARITY_ORDER,
  rollAffixes,
  rollItemInstance,
  rollRarity,
  rollStat,
  type BaseItem,
} from './items.js';

/** Build a fake rng that yields the given values in order, then repeats the last. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

const SWORD: BaseItem = {
  id: 'iron_sword',
  name: 'Iron Sword',
  slot: 'weapon',
  power: 13,
  hp: null,
};
const ARMOR: BaseItem = {
  id: 'iron_armor',
  name: 'Iron Armor',
  slot: 'armor',
  power: null,
  hp: 65,
};

describe('rollRarity (weighted)', () => {
  it('returns the lowest tier at rng=0 and the highest near rng=1', () => {
    expect(rollRarity(() => 0)).toBe('common');
    expect(rollRarity(() => 0.999999)).toBe('legendary');
  });

  it('only ever returns a defined rarity', () => {
    for (const r of [0, 0.3, 0.6, 0.8, 0.95, 0.999]) {
      expect(RARITY_ORDER).toContain(rollRarity(() => r));
    }
  });

  it('rarer tiers carry more weight than the tier above them (descending weights)', () => {
    for (let i = 1; i < RARITY_ORDER.length; i++) {
      expect(RARITY[RARITY_ORDER[i - 1]!].weight).toBeGreaterThan(RARITY[RARITY_ORDER[i]!].weight);
    }
  });
});

describe('rollStat (base * mult * (1 ± variance))', () => {
  it('returns 0 for a 0/absent base without consuming the roll meaningfully', () => {
    expect(rollStat(0, 'legendary', () => 0.5)).toBe(0);
  });

  it('scales up with rarity at a fixed roll', () => {
    const common = rollStat(10, 'common', () => 0.5);
    const legendary = rollStat(10, 'legendary', () => 0.5);
    expect(legendary).toBeGreaterThan(common);
  });

  it('stays within the rarity variance band', () => {
    const base = 100;
    const def = RARITY.rare;
    const lo = Math.round(base * def.statMult * (1 - def.variance));
    const hi = Math.round(base * def.statMult * (1 + def.variance));
    for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
      const v = rollStat(base, 'rare', () => r);
      expect(v).toBeGreaterThanOrEqual(lo);
      expect(v).toBeLessThanOrEqual(hi);
    }
  });

  it('never rolls below 1 for a positive base', () => {
    expect(rollStat(1, 'common', () => 0)).toBeGreaterThanOrEqual(1);
  });
});

describe('rollItemInstance', () => {
  it('rolls power for a weapon and leaves hp at 0', () => {
    const inst = rollItemInstance(7, SWORD, seqRng([0, 0.5]));
    expect(inst.uid).toBe(7);
    expect(inst.baseId).toBe('iron_sword');
    expect(inst.rarity).toBe('common');
    expect(inst.power).toBeGreaterThan(0);
    expect(inst.hp).toBe(0);
  });

  it('rolls hp for armor and leaves power at 0', () => {
    const inst = rollItemInstance(9, ARMOR, seqRng([0.999999, 0.5]));
    expect(inst.rarity).toBe('legendary');
    expect(inst.hp).toBeGreaterThan(0);
    expect(inst.power).toBe(0);
  });
});

describe('instanceName', () => {
  it('omits the prefix for common and prefixes otherwise', () => {
    expect(
      instanceName(
        { uid: 1, baseId: 'iron_sword', rarity: 'common', power: 13, hp: 0, affixes: [] },
        'Iron Sword',
      ),
    ).toBe('Iron Sword');
    expect(
      instanceName(
        { uid: 1, baseId: 'iron_sword', rarity: 'rare', power: 20, hp: 0, affixes: [] },
        'Iron Sword',
      ),
    ).toBe('Rare Iron Sword');
  });
});

describe('gearSellValue', () => {
  it('is positive and grows with stats and rarity', () => {
    const lo = gearSellValue({
      uid: 1,
      baseId: 'iron_sword',
      rarity: 'common',
      power: 10,
      hp: 0,
      affixes: [],
    });
    const hi = gearSellValue({
      uid: 2,
      baseId: 'iron_sword',
      rarity: 'legendary',
      power: 30,
      hp: 0,
      affixes: [],
    });
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
  });
});

describe('affixes', () => {
  it('affix count rises with rarity and is 0 for common', () => {
    expect(affixCount('common')).toBe(0);
    expect(affixCount('magic')).toBe(1);
    expect(affixCount('legendary')).toBeGreaterThanOrEqual(affixCount('rare'));
  });

  it('rolls the right number of distinct-stat affixes for a rarity', () => {
    const affixes = rollAffixes('rare', seqRng([0, 0.5, 0.5, 0.5]));
    expect(affixes).toHaveLength(affixCount('rare'));
    const stats = affixes.map((a) => a.stat);
    expect(new Set(stats).size).toBe(stats.length); // no duplicate stats
    for (const a of affixes) expect(a.value).toBeGreaterThanOrEqual(1);
  });

  it('common rolls no affixes', () => {
    expect(rollAffixes('common', () => 0.5)).toEqual([]);
  });

  it('an instance above common carries affixes', () => {
    const inst = rollItemInstance(1, SWORD, seqRng([0.999999, 0.5])); // legendary
    expect(inst.affixes.length).toBeGreaterThan(0);
  });

  it('labels affixes readably', () => {
    expect(affixLabel({ stat: 'crit', value: 5 })).toBe('+5% crit');
    expect(affixLabel({ stat: 'power', value: 4 })).toBe('+4 power');
    expect(affixLabel({ stat: 'hp', value: 12 })).toBe('+12 hp');
  });
});
