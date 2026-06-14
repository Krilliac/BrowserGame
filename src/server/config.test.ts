import { describe, expect, it } from 'vitest';
import { config } from './config.js';

/**
 * Config-contract guards: the single tuning file is where a typo or a bad env override would
 * silently break the live game (a NaN tick rate, an inverted gold range, a >1 drop chance). These
 * tests turn that into a failing build instead. They assert RELATIONSHIPS and ranges, not just types.
 */
describe('config invariants', () => {
  it('has no non-finite numeric values anywhere (catches NaN/Infinity from bad env parsing)', () => {
    const bad: string[] = [];
    const walk = (obj: unknown, path: string) => {
      if (typeof obj === 'number') {
        if (!Number.isFinite(obj)) bad.push(`${path} = ${obj}`);
      } else if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(config, '');
    expect(bad, `non-finite config values: ${bad.join(', ')}`).toEqual([]);
  });

  it('keeps every probability/chance knob within [0, 1]', () => {
    const chances = [
      config.difficulty.eliteChance,
      config.coop.damagePerPlayer,
      config.coop.goldPerPlayer,
      config.density.perPlayer,
      config.drops.unique,
      config.drops.chestUnique,
      config.drops.spellbookNormal,
      config.drops.spellbookElite,
      config.drops.spellbookBoss,
      config.drops.gemNormal,
      config.drops.gemElite,
      config.drops.gemBoss,
      config.bounty.maxChance,
      config.bounty.invasionCorruptChance,
      config.bounty.bossCorruptChance,
      config.invasion.chance,
    ];
    for (const c of chances) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('orders every min/max gold range correctly', () => {
    expect(config.economy.chestGoldMin).toBeLessThanOrEqual(config.economy.chestGoldMax);
    expect(config.economy.potGoldMin).toBeLessThanOrEqual(config.economy.potGoldMax);
  });

  it('keeps the core scaling + host knobs positive and sane', () => {
    expect(config.server.port).toBeGreaterThan(0);
    expect(config.server.tickRate).toBeGreaterThan(0);
    expect(config.world.scale).toBeGreaterThanOrEqual(1);
    expect(config.world.mobCountScale).toBeGreaterThan(0);
    expect(config.world.terrainSizeScale).toBeGreaterThan(0);
    expect(config.world.portalSpanScale).toBeGreaterThan(0);
    expect(config.difficulty.mobHp).toBeGreaterThan(0);
    expect(config.difficulty.mobDamage).toBeGreaterThan(0);
    expect(config.density.cap).toBeGreaterThanOrEqual(1);
    expect(config.coop.damageCap).toBeGreaterThanOrEqual(1); // a cap below 1 would REDUCE solo damage
    expect(config.coop.goldCap).toBeGreaterThanOrEqual(1); // a cap below 1 would REDUCE solo gold
  });

  it('keeps inventory/belt limits coherent (you can never start over the cap)', () => {
    expect(config.potions.start).toBeLessThanOrEqual(config.potions.cap);
    expect(config.potions.cap).toBeGreaterThan(0);
    expect(config.items.maxBagGear).toBeGreaterThan(0);
    expect(config.items.stashCap).toBeGreaterThan(0);
    expect(config.items.itemTtlMs).toBeGreaterThan(0);
    expect(config.bots.spawnPerCallMax).toBeGreaterThan(0);
  });
});
