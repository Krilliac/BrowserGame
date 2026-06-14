import { describe, expect, it } from 'vitest';
import { lootGlint } from './loot-glint.js';
import { RARITY, RARITY_ORDER } from '../shared/items.js';

describe('lootGlint', () => {
  it('gives material/currency drops a faint neutral glow and no label', () => {
    const g = lootGlint(undefined);
    expect(g.intensity).toBeGreaterThan(0);
    expect(g.intensity).toBeLessThan(0.3);
    expect(g.label).toBe(false);
    expect(g.color).not.toBe(RARITY.rare.color);
  });

  it('does not glint common gear (rarity is the dopamine gate)', () => {
    expect(lootGlint('common').intensity).toBe(0);
    expect(lootGlint('common').label).toBe(false);
  });

  it('uses the rarity color for gear and brightens up the tier ladder', () => {
    expect(lootGlint('rare').color).toBe(RARITY.rare.color);
    const order = RARITY_ORDER.map((r) => lootGlint(r).intensity);
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeGreaterThan(order[i - 1]!);
    expect(lootGlint('legendary').intensity).toBe(1); // top of the normal ladder
  });

  it('labels only the genuinely exciting tiers (epic+ / unique / corrupted)', () => {
    expect(lootGlint('magic').label).toBe(false);
    expect(lootGlint('rare').label).toBe(false);
    expect(lootGlint('epic').label).toBe(true);
    expect(lootGlint('legendary').label).toBe(true);
    expect(lootGlint('unique').label).toBe(true);
    expect(lootGlint('corrupted').label).toBe(true);
  });

  it('treats off-ladder top tiers (unique/corrupted) as max-intensity finds in their own color', () => {
    expect(lootGlint('unique').intensity).toBe(1);
    expect(lootGlint('corrupted').intensity).toBe(1);
    expect(lootGlint('unique').color).toBe(RARITY.unique.color);
    expect(lootGlint('corrupted').color).toBe(RARITY.corrupted.color);
  });

  it('falls back to a quiet neutral glow for an unknown rarity (forward-compatible client)', () => {
    const g = lootGlint('mythic-from-the-future');
    expect(g.color).toBe(lootGlint(undefined).color);
    expect(g.label).toBe(false);
  });
});
