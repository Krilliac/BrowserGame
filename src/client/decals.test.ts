import { describe, expect, it } from 'vitest';
import { decalAlpha } from './decals.js';

describe('decalAlpha (RENDER-02)', () => {
  const peak = 0.7;
  const ttl = 10_000;
  const born = 1000;

  it('holds peak opacity through the steady phase, before the fade band', () => {
    expect(decalAlpha(born, ttl, peak, born)).toBe(peak);
    expect(decalAlpha(born, ttl, peak, born + ttl * 0.5)).toBe(peak);
    // The fade band is the last 25% — just before it, still full.
    expect(decalAlpha(born, ttl, peak, born + ttl * 0.74)).toBe(peak);
  });

  it('ramps linearly to zero across the fade band and stays at zero after expiry', () => {
    const mid = decalAlpha(born, ttl, peak, born + ttl * 0.875); // halfway through the 25% band
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(peak);
    expect(mid).toBeCloseTo(peak * 0.5, 5);
    expect(decalAlpha(born, ttl, peak, born + ttl)).toBe(0);
    expect(decalAlpha(born, ttl, peak, born + ttl * 2)).toBe(0);
  });

  it('is monotonically non-increasing over the lifetime', () => {
    let prev = Infinity;
    for (let age = 0; age <= ttl; age += ttl / 50) {
      const a = decalAlpha(born, ttl, peak, born + age);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      prev = a;
    }
  });
});
