import { describe, expect, it } from 'vitest';
import { SELL_VALUES, sellAll, sellValue } from './vendor.js';

describe('vendor (town pricing)', () => {
  it('gives positive gold for known sellable items', () => {
    expect(sellValue('wolf_pelt')).toBeGreaterThan(0);
    expect(sellValue('bone')).toBeGreaterThan(0);
    expect(sellValue('bat_wing')).toBeGreaterThan(0);
    expect(sellValue('rune_shard')).toBeGreaterThan(0);
  });

  it('prices rune_shard as the most valuable drop', () => {
    const values = Object.values(SELL_VALUES);
    expect(sellValue('rune_shard')).toBe(Math.max(...values));
  });

  it('returns 0 for gold (currency) and unknown items', () => {
    expect(sellValue('gold')).toBe(0);
    expect(sellValue('definitely_not_an_item')).toBe(0);
  });

  it('sums quantity * value across a mixed bag', () => {
    const result = sellAll({ wolf_pelt: 2, bone: 3 });
    const expected = sellValue('wolf_pelt') * 2 + sellValue('bone') * 3;
    expect(result.gold).toBe(expected);
    expect(result.sold).toEqual({ wolf_pelt: 2, bone: 3 });
  });

  it('excludes gold and unsellable items from the sale', () => {
    const result = sellAll({ rune_shard: 1, gold: 100, junk: 5 });
    expect(result.gold).toBe(sellValue('rune_shard'));
    expect(result.sold).toEqual({ rune_shard: 1 });
  });

  it('ignores zero and negative quantities', () => {
    const result = sellAll({ wolf_pelt: 0, bone: -2 });
    expect(result).toEqual({ gold: 0, sold: {} });
  });

  it('returns nothing for an empty bag', () => {
    expect(sellAll({})).toEqual({ gold: 0, sold: {} });
  });
});
