import { describe, expect, it } from 'vitest';
import { SHADOW_LIFT_FALLOFF, shadowLift } from './shadow-lift.js';

describe('shadowLift', () => {
  it('is the identity when the caster is grounded', () => {
    expect(shadowLift(0)).toEqual({ scale: 1, alpha: 1 });
  });

  it('treats below-ground lift as grounded (no negative blow-up)', () => {
    expect(shadowLift(-50)).toEqual({ scale: 1, alpha: 1 });
  });

  it('shrinks and fades the shadow as the caster rises', () => {
    const low = shadowLift(4);
    const high = shadowLift(16);
    expect(low.scale).toBeLessThan(1);
    expect(low.alpha).toBeLessThan(1);
    // Higher lift => smaller, fainter shadow than a low hop.
    expect(high.scale).toBeLessThan(low.scale);
    expect(high.alpha).toBeLessThan(low.alpha);
  });

  it('keeps a small walk-bob barely perceptible', () => {
    const bob = shadowLift(2);
    expect(bob.scale).toBeGreaterThan(0.95);
    expect(bob.alpha).toBeGreaterThan(0.95);
  });

  it('clamps at the falloff height instead of inverting past it', () => {
    const atFalloff = shadowLift(SHADOW_LIFT_FALLOFF);
    const wayPast = shadowLift(SHADOW_LIFT_FALLOFF * 10);
    expect(wayPast).toEqual(atFalloff);
    // Never collapses to nothing — the shadow always stays a readable contact blob.
    expect(atFalloff.scale).toBeGreaterThan(0);
    expect(atFalloff.alpha).toBeGreaterThan(0);
  });

  it('honors a custom falloff (e.g. a shorter loot-pop arc)', () => {
    const standard = shadowLift(10, SHADOW_LIFT_FALLOFF);
    const snappy = shadowLift(10, 12);
    // The same lift reads as "higher" against a shorter falloff, so it shrinks/fades more.
    expect(snappy.scale).toBeLessThan(standard.scale);
    expect(snappy.alpha).toBeLessThan(standard.alpha);
  });
});
