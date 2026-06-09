import { describe, expect, it } from 'vitest';
import {
  gearSellValue,
  instanceName,
  RARITY,
  RARITY_ORDER,
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
        { uid: 1, baseId: 'iron_sword', rarity: 'common', power: 13, hp: 0 },
        'Iron Sword',
      ),
    ).toBe('Iron Sword');
    expect(
      instanceName(
        { uid: 1, baseId: 'iron_sword', rarity: 'rare', power: 20, hp: 0 },
        'Iron Sword',
      ),
    ).toBe('Rare Iron Sword');
  });
});

describe('gearSellValue', () => {
  it('is positive and grows with stats and rarity', () => {
    const lo = gearSellValue({ uid: 1, baseId: 'iron_sword', rarity: 'common', power: 10, hp: 0 });
    const hi = gearSellValue({
      uid: 2,
      baseId: 'iron_sword',
      rarity: 'legendary',
      power: 30,
      hp: 0,
    });
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
  });
});
