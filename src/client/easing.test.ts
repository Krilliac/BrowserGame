import { describe, expect, it } from 'vitest';
import { backOut, bounceOut, cubicInOut, cubicOut, linear, quadOut } from './easing.js';

const ALL = { linear, quadOut, cubicOut, cubicInOut, backOut, bounceOut };

/** Curves that must never decrease (backOut/bounceOut intentionally wiggle). */
const MONOTONE = { linear, quadOut, cubicOut, cubicInOut };

const SAMPLES = 200;

describe('easing curves', () => {
  it('hits the endpoints exactly and clamps out-of-range t', () => {
    for (const [name, f] of Object.entries(ALL)) {
      expect(f(0), `${name}(0)`).toBe(0);
      expect(f(1), `${name}(1)`).toBe(1);
      // Out-of-range inputs clamp to the endpoint values, never extrapolate.
      expect(f(-0.5), `${name}(-0.5)`).toBe(0);
      expect(f(2), `${name}(2)`).toBe(1);
    }
  });

  it('monotone curves never decrease across [0, 1]', () => {
    for (const [name, f] of Object.entries(MONOTONE)) {
      let prev = f(0);
      for (let i = 1; i <= SAMPLES; i++) {
        const value = f(i / SAMPLES);
        expect(value, `${name} dipped at t=${i / SAMPLES}`).toBeGreaterThanOrEqual(prev);
        prev = value;
      }
    }
  });

  it('linear is the identity inside the range', () => {
    expect(linear(0.25)).toBe(0.25);
    expect(linear(0.5)).toBe(0.5);
  });

  it('out-mirroring holds: quadOut decelerates where quadIn accelerates', () => {
    // quadOut(t) = 1 - (1-t)^2; spot-check the mirror relation at an interior point.
    expect(quadOut(0.25)).toBeCloseTo(1 - 0.75 * 0.75, 12);
    expect(cubicOut(0.25)).toBeCloseTo(1 - 0.75 ** 3, 12);
    // inOut passes through the midpoint exactly.
    expect(cubicInOut(0.5)).toBeCloseTo(0.5, 12);
  });

  it('backOut overshoots above 1 mid-curve, then settles back to 1', () => {
    let peak = 0;
    for (let i = 1; i < SAMPLES; i++) peak = Math.max(peak, backOut(i / SAMPLES));
    expect(peak).toBeGreaterThan(1); // the signature overshoot
    expect(peak).toBeLessThan(1.2); // but a pop, not a launch
    expect(backOut(1)).toBe(1);
  });

  it('bounceOut stays within [0, 1] and actually bounces (non-monotone)', () => {
    let nonMonotone = false;
    let prev = bounceOut(0);
    for (let i = 1; i <= SAMPLES; i++) {
      const value = bounceOut(i / SAMPLES);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
      if (value < prev) nonMonotone = true;
      prev = value;
    }
    expect(nonMonotone).toBe(true);
    // First arc lands on 1 at t = 1/2.75 before rebounding.
    expect(bounceOut(1 / 2.75)).toBeCloseTo(1, 12);
  });
});
