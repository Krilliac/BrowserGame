import { describe, expect, it } from 'vitest';
import { aimAngle, angleDelta, circlesOverlap, inMeleeCone } from './combat.js';

describe('aimAngle', () => {
  it('points along the vector', () => {
    expect(aimAngle(1, 0)).toBeCloseTo(0, 5);
    expect(aimAngle(0, 1)).toBeCloseTo(Math.PI / 2, 5);
  });
  it('falls back when the vector is zero', () => {
    expect(aimAngle(0, 0, 1.23)).toBe(1.23);
  });
});

describe('angleDelta', () => {
  it('wraps around the circle', () => {
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(0.2, 5);
    expect(angleDelta(0, Math.PI)).toBeCloseTo(Math.PI, 5);
  });
});

describe('inMeleeCone', () => {
  it('hits a target ahead within range and arc', () => {
    expect(inMeleeCone(0, 0, 0, 50, 0, 78, 0.7)).toBe(true);
  });
  it('misses a target behind the attacker', () => {
    expect(inMeleeCone(0, 0, 0, -50, 0, 78, 0.7)).toBe(false);
  });
  it('misses a target out of range', () => {
    expect(inMeleeCone(0, 0, 0, 200, 0, 78, 0.7)).toBe(false);
  });
  it('misses a target outside the arc', () => {
    expect(inMeleeCone(0, 0, 0, 0, 50, 78, 0.3)).toBe(false);
  });
});

describe('circlesOverlap', () => {
  it('detects overlap', () => {
    expect(circlesOverlap(0, 0, 10, 15, 0, 6)).toBe(true);
  });
  it('detects separation', () => {
    expect(circlesOverlap(0, 0, 10, 30, 0, 6)).toBe(false);
  });
});
