import { describe, expect, it } from 'vitest';
import {
  championGoldPile,
  coopScale,
  levelForXp,
  levelProgress,
  maxHpForLevel,
  scaleGoldForLevel,
  tierGoldScale,
  xpForLevel,
  xpReward,
} from './progression.js';

describe('progression (XP / leveling curve)', () => {
  it('starts level 1 at 0 XP and increases monotonically', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(90);
    for (let lvl = 1; lvl < 50; lvl++) {
      expect(xpForLevel(lvl + 1)).toBeGreaterThan(xpForLevel(lvl));
    }
  });

  it('is piecewise exponential: steep through Act 1, easing past the level-20 knee', () => {
    for (let lvl = 2; lvl <= 18; lvl++) {
      const prev = xpForLevel(lvl) - xpForLevel(lvl - 1);
      const next = xpForLevel(lvl + 1) - xpForLevel(lvl);
      expect(next / prev).toBeGreaterThan(1.25);
      expect(next / prev).toBeLessThan(1.31);
    }
    for (let lvl = 22; lvl <= 58; lvl++) {
      const prev = xpForLevel(lvl) - xpForLevel(lvl - 1);
      const next = xpForLevel(lvl + 1) - xpForLevel(lvl);
      expect(next / prev).toBeGreaterThan(1.09);
      expect(next / prev).toBeLessThan(1.15);
    }
    // Act pacing anchors: Act 1 exits ~L18-20 in the tens of thousands; Act 2 ends ~L40 under
    // a million; the Act 3 finish line (~L60) is a multi-million chase, not an astronomical one.
    expect(xpForLevel(20)).toBeGreaterThan(30_000);
    expect(xpForLevel(40)).toBeGreaterThan(600_000);
    expect(xpForLevel(40)).toBeLessThan(900_000);
    expect(xpForLevel(60)).toBeGreaterThan(6_500_000);
    expect(xpForLevel(60)).toBeLessThan(9_000_000);
  });

  it('rewards Act 2/3 kills super-linearly so 20 levels per act stays hundreds of kills', () => {
    expect(xpReward(18)).toBe(98); // linear band unchanged
    expect(xpReward(30)).toBe(8 + 150 + 2 * 12 * 12); // 446
    expect(xpReward(50)).toBe(8 + 250 + 2 * 32 * 32); // 2306
    // Sanity: a level-40 player needs on the order of hundreds of same-level kills per level.
    const perLevel = xpForLevel(41) - xpForLevel(40);
    expect(perLevel / xpReward(40)).toBeGreaterThan(40);
    expect(perLevel / xpReward(40)).toBeLessThan(200);
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

describe('championGoldPile', () => {
  const lo = () => 0; // floor of the random spread
  const hi = () => 0.999999; // top of the random spread

  it('is a positive integer that scales with monster level', () => {
    for (const lvl of [1, 10, 30, 60]) {
      const g = championGoldPile(lvl, () => 0.5);
      expect(Number.isInteger(g)).toBe(true);
      expect(g).toBeGreaterThan(0);
    }
    // Expected payout rises with level (a level-60 champion spills far more than a level-1 one).
    expect(championGoldPile(60, () => 0.5)).toBeGreaterThan(championGoldPile(1, () => 0.5) * 5);
  });

  it('both ends of the random spread grow with level, and the band widens', () => {
    const band = (lvl: number) => championGoldPile(lvl, hi) - championGoldPile(lvl, lo);
    expect(championGoldPile(60, lo)).toBeGreaterThan(championGoldPile(1, lo));
    expect(championGoldPile(60, hi)).toBeGreaterThan(championGoldPile(1, hi));
    expect(band(60)).toBeGreaterThan(band(1)); // higher levels have a bigger gold swing
  });

  it('sanitizes bad level inputs to level 1 (never NaN / negative)', () => {
    const base = championGoldPile(1, lo);
    expect(championGoldPile(0, lo)).toBe(base);
    expect(championGoldPile(-5, lo)).toBe(base);
    expect(championGoldPile(NaN, lo)).toBe(base);
  });
});

describe('scaleGoldForLevel', () => {
  it('leaves base gold untouched at the template level (tier 0)', () => {
    expect(scaleGoldForLevel(100, 15, 15)).toBe(100);
    expect(scaleGoldForLevel(50, 1, 1)).toBe(50);
  });

  it('scales up as the mob outlevels its template (rift tier)', () => {
    // crypt_lord template L15 → at L25 (tier 5): 100 × 25/15 ≈ 167.
    expect(scaleGoldForLevel(100, 25, 15)).toBe(Math.round(100 * (25 / 15)));
    expect(scaleGoldForLevel(100, 30, 15)).toBeGreaterThan(scaleGoldForLevel(100, 20, 15));
  });

  it('caps the multiplier at 4× so deep rifts never run away', () => {
    expect(scaleGoldForLevel(100, 999, 5)).toBe(400); // 100 × min(4, 199.8)
  });

  it('never drops below the base (factor floored at 1) and is always >= 1', () => {
    expect(scaleGoldForLevel(100, 5, 60)).toBe(100); // mobLevel < templateLevel → factor 1
    expect(scaleGoldForLevel(0, 30, 10)).toBe(1); // never zero gold
  });

  it('sanitizes bad inputs (NaN / non-positive levels)', () => {
    expect(scaleGoldForLevel(80, NaN, NaN)).toBe(80); // both → level 1 → factor 1
    expect(scaleGoldForLevel(80, -3, 0)).toBe(80);
  });
});

describe('coopScale', () => {
  const per = 0.12;
  const cap = 1.6;

  it('is 1× solo (or with no players)', () => {
    expect(coopScale(0, per, cap)).toBe(1);
    expect(coopScale(1, per, cap)).toBe(1);
  });

  it('adds perPlayer for each extra living player', () => {
    expect(coopScale(2, per, cap)).toBeCloseTo(1.12, 10);
    expect(coopScale(3, per, cap)).toBeCloseTo(1.24, 10);
    expect(coopScale(4, per, cap)).toBeGreaterThan(coopScale(3, per, cap));
  });

  it('never exceeds the cap', () => {
    expect(coopScale(100, per, cap)).toBe(cap);
    for (let n = 1; n <= 20; n++) expect(coopScale(n, per, cap)).toBeLessThanOrEqual(cap);
  });

  it('resolves garbage head-counts to solo (×1)', () => {
    expect(coopScale(NaN, per, cap)).toBe(1);
    expect(coopScale(-3, per, cap)).toBe(1);
  });
});

describe('tierGoldScale', () => {
  it('is 1× in the normal world (tier 0) so nothing changes there', () => {
    expect(tierGoldScale(0)).toBe(1);
  });

  it('rises with tier and is monotonic up to the cap', () => {
    expect(tierGoldScale(1)).toBeCloseTo(1.35, 10);
    expect(tierGoldScale(5)).toBeCloseTo(2.75, 10);
    for (let t = 0; t < 8; t++)
      expect(tierGoldScale(t + 1)).toBeGreaterThanOrEqual(tierGoldScale(t));
  });

  it('caps the multiplier at 4×', () => {
    expect(tierGoldScale(100)).toBe(4);
    for (let t = 0; t <= 50; t++) expect(tierGoldScale(t)).toBeLessThanOrEqual(4);
  });

  it('resolves a garbage/negative tier to ×1', () => {
    expect(tierGoldScale(NaN)).toBe(1);
    expect(tierGoldScale(-3)).toBe(1);
  });
});
