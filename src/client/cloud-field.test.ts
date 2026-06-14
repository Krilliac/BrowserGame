import { describe, expect, it } from 'vitest';
import { cloudStrength, wrapSpan } from './cloud-field.js';

describe('cloudStrength', () => {
  it('is strongest at noon and absent at night', () => {
    expect(cloudStrength(1)).toBe(1);
    expect(cloudStrength(0)).toBe(0);
  });

  it('rises monotonically with the sun and clamps out-of-range daylight', () => {
    expect(cloudStrength(0.5)).toBeGreaterThan(cloudStrength(0.2));
    expect(cloudStrength(-1)).toBe(0);
    expect(cloudStrength(9)).toBe(1);
  });
});

describe('wrapSpan', () => {
  it('leaves a coordinate already inside the band untouched', () => {
    expect(wrapSpan(5, 0, 10)).toBe(5);
    expect(wrapSpan(-9, 0, 10)).toBe(-9);
  });

  it('wraps a coordinate past the far edge back to the near edge', () => {
    // Band is [-10, 10); 12 is 2 past the top, so it reappears 2 above the bottom.
    expect(wrapSpan(12, 0, 10)).toBeCloseTo(-8);
    // 25 = 12 + one full 20-span wrap.
    expect(wrapSpan(32, 0, 10)).toBeCloseTo(-8);
  });

  it('wraps a coordinate past the near edge up to the far edge', () => {
    expect(wrapSpan(-12, 0, 10)).toBeCloseTo(8);
  });

  it('always lands within [center - half, center + half)', () => {
    for (const v of [-1000, -37, 3, 88, 5000]) {
      const w = wrapSpan(v, 100, 40);
      expect(w).toBeGreaterThanOrEqual(60);
      expect(w).toBeLessThan(140);
    }
  });

  it('is a no-op for a non-positive half-span', () => {
    expect(wrapSpan(7, 0, 0)).toBe(7);
  });
});
