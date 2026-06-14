import { describe, expect, it } from 'vitest';
import { sunShadow } from './sun-shadow.js';

describe('sunShadow', () => {
  it('is the identity at high noon (and indoors, where daylight is pinned to 1)', () => {
    expect(sunShadow(1)).toEqual({ stretch: 1, alpha: 1 });
  });

  it('throws the longest, faintest shadow when the sun is on the horizon', () => {
    const midnight = sunShadow(0);
    expect(midnight.stretch).toBeGreaterThan(1);
    expect(midnight.alpha).toBeLessThan(1);
  });

  it('lengthens and fades monotonically as the sun sinks', () => {
    const noon = sunShadow(1);
    const dusk = sunShadow(0.5);
    const night = sunShadow(0.1);
    expect(dusk.stretch).toBeGreaterThan(noon.stretch);
    expect(night.stretch).toBeGreaterThan(dusk.stretch);
    expect(dusk.alpha).toBeLessThan(noon.alpha);
    expect(night.alpha).toBeLessThan(dusk.alpha);
  });

  it('clamps out-of-range daylight instead of running past the horizon', () => {
    expect(sunShadow(-3)).toEqual(sunShadow(0));
    expect(sunShadow(5)).toEqual(sunShadow(1));
  });

  it('keeps the lowest-sun shadow a readable cast (never zero-length or invisible)', () => {
    const horizon = sunShadow(0);
    expect(horizon.alpha).toBeGreaterThan(0);
    expect(horizon.stretch).toBeGreaterThan(1);
  });
});
