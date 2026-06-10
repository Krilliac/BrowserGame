import { describe, expect, it } from 'vitest';
import {
  affixCount,
  affixLabel,
  bumpRarity,
  gearSellValue,
  instanceName,
  isDebuff,
  RARITY,
  RARITY_ORDER,
  rollAffixes,
  rollCorruptedInstance,
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
  slot: 'mainhand',
  power: 13,
  hp: null,
};
const ARMOR: BaseItem = {
  id: 'iron_armor',
  name: 'Iron Armor',
  slot: 'chest',
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

  it('bumpRarity steps up tiers and caps at legendary', () => {
    expect(bumpRarity('common', 1)).toBe('magic');
    expect(bumpRarity('common', 2)).toBe('rare');
    expect(bumpRarity('legendary', 1)).toBe('legendary');
    expect(bumpRarity('epic', 5)).toBe('legendary');
    expect(bumpRarity('rare', 0)).toBe('rare');
  });

  it('rollItemInstance with a rarity bump never drops below the bump from common', () => {
    const inst = rollItemInstance(1, SWORD, () => 0, 1); // rng=0 => common, bumped to magic
    expect(inst.rarity).toBe('magic');
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
    expect(affixLabel({ stat: 'multishot', value: 1 })).toBe('+1 projectile');
    expect(affixLabel({ stat: 'multishot', value: 2 })).toBe('+2 projectiles');
  });

  it('keeps multishot bounded regardless of rarity (never mult-scaled)', () => {
    // Force the first affix pick to be multishot (rng=0 selects pool index 0... 'power').
    // Scan a roll until a multishot turns up and assert its value is small.
    for (const rarity of ['magic', 'rare', 'epic', 'legendary'] as const) {
      const affixes = rollAffixes(rarity, () => 0.999); // bias picks toward the end of the pool
      const ms = affixes.find((a) => a.stat === 'multishot');
      if (ms) expect(ms.value).toBeLessThanOrEqual(2);
    }
  });
});

describe('corrupted items', () => {
  it('never weighted-rolls or bumps into corrupted', () => {
    expect(RARITY_ORDER).not.toContain('corrupted');
    for (const r of [0, 0.5, 0.999999]) expect(rollRarity(() => r)).not.toBe('corrupted');
    expect(bumpRarity('legendary', 9)).toBe('legendary'); // caps at legendary, not corrupted
  });

  it('rollCorruptedInstance makes a corrupted item with exactly one buff and one debuff', () => {
    const inst = rollCorruptedInstance(5, SWORD, () => 0.3);
    expect(inst.rarity).toBe('corrupted');
    expect(inst.affixes).toHaveLength(2);
    const debuffs = inst.affixes.filter(isDebuff);
    expect(debuffs).toHaveLength(1);
    expect(inst.affixes.filter((a) => !isDebuff(a))).toHaveLength(1);
    expect(inst.power).toBeGreaterThan(0); // top-tier base stats
  });

  it('identifies and labels debuff affixes', () => {
    expect(isDebuff({ stat: 'frail', value: 30 })).toBe(true);
    expect(isDebuff({ stat: 'fragile', value: 20 })).toBe(true);
    expect(isDebuff({ stat: 'crit', value: 10 })).toBe(false);
    expect(affixLabel({ stat: 'frail', value: 30 })).toBe('-30 hp');
    expect(affixLabel({ stat: 'fragile', value: 20 })).toBe('+20% dmg taken');
  });
});
