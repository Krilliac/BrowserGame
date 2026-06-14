import { describe, expect, it } from 'vitest';
import { AreaCorruption, morningDayIndex, tierOf } from './area-corruption.js';
import { config } from './config.js';

// The corruption scalars are data-driven via config.corruption (see the game_config overlay).
const CORRUPT_PER_DEATH = config.corruption.perDeath;
const CORRUPT_PER_KILL = config.corruption.perKill;

describe('AreaCorruption', () => {
  it('defaults to 0 and accumulates deaths per area', () => {
    const c = new AreaCorruption();
    expect(c.get('crypt')).toBe(0);
    c.addDeath('crypt');
    c.addDeath('crypt');
    expect(c.get('crypt')).toBeCloseTo(2 * CORRUPT_PER_DEATH, 10);
    expect(c.get('wilderness')).toBe(0); // separate pools per area
  });

  it('is pushed back by kills and clamped to [0,1]', () => {
    const c = new AreaCorruption();
    c.pushBack('crypt'); // already 0 — stays 0
    expect(c.get('crypt')).toBe(0);
    for (let i = 0; i < 20; i++) c.addDeath('crypt'); // saturate
    expect(c.get('crypt')).toBe(1);
    c.pushBack('crypt');
    expect(c.get('crypt')).toBeCloseTo(1 - CORRUPT_PER_KILL, 10);
  });

  it('decays over time toward 0', () => {
    const c = new AreaCorruption();
    c.addDeath('crypt');
    const before = c.get('crypt');
    c.decay(5);
    expect(c.get('crypt')).toBeLessThan(before);
  });

  it('resets all areas when the day index advances, once', () => {
    const c = new AreaCorruption();
    expect(c.rolloverIfNewDay(10)).toBe(true); // first ever
    c.addDeath('crypt');
    expect(c.rolloverIfNewDay(10)).toBe(false); // same day, no reset
    expect(c.get('crypt')).toBeGreaterThan(0);
    expect(c.rolloverIfNewDay(11)).toBe(true); // new morning
    expect(c.get('crypt')).toBe(0);
  });
});

describe('corruption tiers', () => {
  it('maps levels to ascending tiers', () => {
    expect(tierOf(0)).toBe(0);
    expect(tierOf(0.3)).toBe(1);
    expect(tierOf(0.6)).toBe(2);
    expect(tierOf(0.9)).toBe(3);
  });

  it('reports a tier crossing once, with direction, then nothing until it changes again', () => {
    const c = new AreaCorruption();
    expect(c.pollTierChange('crypt')).toBeNull(); // starts at tier 0
    for (let i = 0; i < 5; i++) c.addDeath('crypt'); // 0.75 -> tier 2
    const up = c.pollTierChange('crypt');
    expect(up).toEqual({ tier: 2, dir: 'up' });
    expect(c.pollTierChange('crypt')).toBeNull(); // no further change
    for (let i = 0; i < 200; i++) c.decay(1); // fade well back down (0.003/s)
    const down = c.pollTierChange('crypt');
    expect(down?.dir).toBe('down');
  });
});

describe('morningDayIndex', () => {
  it('advances at the 06:00 local boundary', () => {
    const day = 86_400_000;
    // 05:59 local vs 06:01 local (tz offset 0) should differ by one day index.
    const at0559 = Date.UTC(2026, 0, 2, 5, 59);
    const at0601 = Date.UTC(2026, 0, 2, 6, 1);
    expect(morningDayIndex(at0601, 0) - morningDayIndex(at0559, 0)).toBe(1);
    // Monotonic across a full day.
    expect(morningDayIndex(at0601 + day, 0)).toBe(morningDayIndex(at0601, 0) + 1);
  });
});
