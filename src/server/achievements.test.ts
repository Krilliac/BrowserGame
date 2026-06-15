import { describe, it, expect } from 'vitest';

import {
  DEFAULT_ACHIEVEMENTS,
  achievementById,
  isEarned,
  newlyEarned,
  type AchievementMetric,
} from './achievements.js';

const VALID_METRICS: ReadonlySet<AchievementMetric> = new Set<AchievementMetric>([
  'level',
  'gold',
  'kills',
  'bossKills',
  'bestiary',
  'deathless',
]);

describe('DEFAULT_ACHIEVEMENTS', () => {
  it('is non-empty', () => {
    expect(DEFAULT_ACHIEVEMENTS.length).toBeGreaterThan(0);
  });

  it('has unique ids', () => {
    const ids = DEFAULT_ACHIEVEMENTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only valid metrics', () => {
    for (const d of DEFAULT_ACHIEVEMENTS) {
      expect(VALID_METRICS.has(d.metric)).toBe(true);
    }
  });

  it('has positive thresholds', () => {
    for (const d of DEFAULT_ACHIEVEMENTS) {
      expect(d.threshold).toBeGreaterThan(0);
    }
  });

  it('has non-empty name and desc', () => {
    for (const d of DEFAULT_ACHIEVEMENTS) {
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.desc.length).toBeGreaterThan(0);
    }
  });

  it('has strictly ascending thresholds within each metric', () => {
    for (const metric of VALID_METRICS) {
      const tiers = DEFAULT_ACHIEVEMENTS.filter((d) => d.metric === metric);
      for (let i = 1; i < tiers.length; i++) {
        expect(tiers[i]!.threshold).toBeGreaterThan(tiers[i - 1]!.threshold);
      }
    }
  });
});

describe('isEarned', () => {
  const apprentice = achievementById('level_apprentice')!;

  it('earns at exactly the threshold (inclusive)', () => {
    expect(isEarned(apprentice, { level: 10 })).toBe(true);
  });

  it('does not earn one below the threshold', () => {
    expect(isEarned(apprentice, { level: 9 })).toBe(false);
  });

  it('earns above the threshold', () => {
    expect(isEarned(apprentice, { level: 99 })).toBe(true);
  });

  it('treats a missing metric as 0', () => {
    expect(isEarned(apprentice, {})).toBe(false);
    const collector = achievementById('gold_collector')!;
    expect(isEarned(collector, { level: 50 })).toBe(false);
  });
});

describe('newlyEarned', () => {
  it('returns met-and-not-already-earned achievements', () => {
    // level 10 + gold 600 earns Apprentice and Coin Collector, nothing higher.
    const result = newlyEarned({ level: 10, gold: 600 }, new Set());
    expect(result.map((d) => d.id)).toEqual(['level_apprentice', 'gold_collector']);
  });

  it('boundary: exactly at threshold earns, one below does not', () => {
    expect(newlyEarned({ level: 10 }, new Set()).map((d) => d.id)).toContain('level_apprentice');
    expect(newlyEarned({ level: 9 }, new Set()).map((d) => d.id)).not.toContain('level_apprentice');
  });

  it('excludes ids already in the earned set', () => {
    const earned = new Set(['level_apprentice']);
    const result = newlyEarned({ level: 10, gold: 600 }, earned);
    expect(result.map((d) => d.id)).toEqual(['gold_collector']);
  });

  it('returns nothing when all met achievements are already earned', () => {
    const earned = new Set(['level_apprentice', 'gold_collector']);
    expect(newlyEarned({ level: 10, gold: 600 }, earned)).toEqual([]);
  });

  it('returns nothing when no threshold is met', () => {
    expect(newlyEarned({ level: 1, gold: 0 }, new Set())).toEqual([]);
  });

  it('treats a missing metric as 0', () => {
    // No gold key present — no gold achievement should fire even at high level.
    const result = newlyEarned({ level: 50 }, new Set());
    expect(result.every((d) => d.metric === 'level')).toBe(true);
    expect(result.map((d) => d.id)).not.toContain('gold_collector');
  });

  it('follows DEFAULT_ACHIEVEMENTS order', () => {
    // Everything earned at once should come back in seed order.
    const result = newlyEarned({ level: 999, gold: 999999 }, new Set());
    const seedOrder = DEFAULT_ACHIEVEMENTS.filter((d) => result.includes(d)).map((d) => d.id);
    expect(result.map((d) => d.id)).toEqual(seedOrder);
  });

  it('does not mutate the earned set', () => {
    const earned = new Set(['level_apprentice']);
    const before = new Set(earned);
    newlyEarned({ level: 50, gold: 60000 }, earned);
    expect(earned).toEqual(before);
  });
});

describe('achievementById', () => {
  it('finds an existing achievement', () => {
    const d = achievementById('gold_tycoon');
    expect(d?.metric).toBe('gold');
    expect(d?.threshold).toBe(50000);
  });

  it('returns undefined for an unknown id', () => {
    expect(achievementById('does_not_exist')).toBeUndefined();
  });
});
