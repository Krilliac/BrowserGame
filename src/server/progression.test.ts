import { describe, expect, it } from 'vitest';
import { levelForXp, levelProgress, maxHpForLevel, xpForLevel, xpReward } from './progression.js';

describe('progression (XP / leveling curve)', () => {
  it('starts level 1 at 0 XP and increases monotonically', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(90);
    for (let lvl = 1; lvl < 50; lvl++) {
      expect(xpForLevel(lvl + 1)).toBeGreaterThan(xpForLevel(lvl));
    }
  });

  it('is exponential: each level costs ~28% more than the last (the hours-long chase)', () => {
    for (let lvl = 2; lvl <= 35; lvl++) {
      const prev = xpForLevel(lvl) - xpForLevel(lvl - 1);
      const next = xpForLevel(lvl + 1) - xpForLevel(lvl);
      expect(next / prev).toBeGreaterThan(1.25);
      expect(next / prev).toBeLessThan(1.31);
    }
    // Pacing anchors: mid-game in the tens of thousands, endgame in the hundreds of thousands.
    expect(xpForLevel(20)).toBeGreaterThan(30_000);
    expect(xpForLevel(30)).toBeGreaterThan(380_000);
  });

  it('levelForXp is the exact inverse at level boundaries', () => {
    for (let lvl = 1; lvl <= 30; lvl++) {
      expect(levelForXp(xpForLevel(lvl))).toBe(lvl);
    }
  });

  it('levelForXp stays on the lower level just below a boundary', () => {
    for (let lvl = 2; lvl <= 30; lvl++) {
      expect(levelForXp(xpForLevel(lvl) - 1)).toBe(lvl - 1);
    }
  });

  it('clamps to level 1 for zero, negative, or NaN XP', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-500)).toBe(1);
    expect(levelForXp(Number.NaN)).toBe(1);
    expect(levelForXp(89)).toBe(1); // just under the level-2 boundary
  });

  it('treats invalid level inputs as level 1', () => {
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(-3)).toBe(0);
    expect(xpForLevel(Number.NaN)).toBe(0);
    expect(maxHpForLevel(0)).toBe(100);
  });

  it('xpReward increases with monster level', () => {
    expect(xpReward(1)).toBe(13);
    expect(xpReward(2)).toBe(18);
    expect(xpReward(5)).toBe(33);
    for (let lvl = 1; lvl < 20; lvl++) {
      expect(xpReward(lvl + 1)).toBeGreaterThan(xpReward(lvl));
    }
  });

  it('maxHpForLevel grows by a flat amount per level', () => {
    expect(maxHpForLevel(1)).toBe(100);
    expect(maxHpForLevel(2)).toBe(115);
    expect(maxHpForLevel(5)).toBe(160);
    for (let lvl = 1; lvl < 50; lvl++) {
      expect(maxHpForLevel(lvl + 1)).toBeGreaterThan(maxHpForLevel(lvl));
    }
  });

  it('levelProgress keeps fraction in [0, 1] and matches the curve', () => {
    for (const xp of [0, 50, 100, 250, 450, 999, 1000, 1500, 12345]) {
      const p = levelProgress(xp);
      expect(p.fraction).toBeGreaterThanOrEqual(0);
      expect(p.fraction).toBeLessThanOrEqual(1);
      expect(p.level).toBe(levelForXp(xp));
      expect(p.intoLevel).toBe(xp - xpForLevel(p.level));
      expect(p.neededForNext).toBe(xpForLevel(p.level + 1) - xpForLevel(p.level));
      expect(p.fraction).toBeCloseTo(p.intoLevel / p.neededForNext, 10);
    }
  });

  it('levelProgress sits at the start of a level on a boundary', () => {
    const p = levelProgress(xpForLevel(3));
    expect(p.level).toBe(3);
    expect(p.intoLevel).toBe(0);
    expect(p.neededForNext).toBe(xpForLevel(4) - xpForLevel(3));
    expect(p.fraction).toBe(0);
  });

  it('levelProgress is halfway through a level at the midpoint XP', () => {
    const mid = (xpForLevel(2) + xpForLevel(3)) / 2; // 200, halfway L2 -> L3
    const p = levelProgress(mid);
    expect(p.level).toBe(2);
    expect(p.fraction).toBeCloseTo(0.5, 10);
  });
});
