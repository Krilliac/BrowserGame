import { describe, expect, it } from 'vitest';

import type { BehaviorSpec } from '../shared/combat.js';
import { initialCharges, resolveHit, steerHoming, type MobLite } from './projectile-behaviors.js';

const mob = (id: number, x: number, y: number): MobLite => ({ id, x, y });

describe('initialCharges', () => {
  it('sums charge counts from behaviors', () => {
    const b: BehaviorSpec[] = [
      { type: 'chain', count: 3, range: 140, falloff: 0.7 },
      { type: 'pierce', count: 2, falloff: 0.9 },
      { type: 'fork', count: 2, spreadRad: 0.4, falloff: 0.6 },
    ];
    expect(initialCharges(b)).toEqual({ bouncesLeft: 3, piercesLeft: 2, forksLeft: 2 });
  });

  it('is all-zero for behaviors without charges', () => {
    expect(initialCharges([{ type: 'splash', radius: 60, scale: 0.5 }])).toEqual({
      bouncesLeft: 0,
      piercesLeft: 0,
      forksLeft: 0,
    });
  });
});

describe('resolveHit', () => {
  const base = {
    x: 0,
    y: 0,
    vx: 10,
    vy: 0,
    damageScale: 1,
    hitMob: mob(1, 0, 0),
    hitMobs: new Set<number>(),
  };

  it('consumes a plain projectile (no behaviors)', () => {
    const out = resolveHit({ ...base, behaviors: [], charges: initialCharges([]), candidates: [] });
    expect(out.consume).toBe(true);
    expect(out.pierce).toBe(false);
    expect(out.redirect).toBeUndefined();
    expect(out.forks).toEqual([]);
    expect(out.primaryDamageScale).toBe(1);
  });

  it('pierces and applies falloff to the next hit, without consuming', () => {
    const behaviors: BehaviorSpec[] = [{ type: 'pierce', count: 1, falloff: 0.9 }];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      candidates: [],
    });
    expect(out.consume).toBe(false);
    expect(out.pierce).toBe(true);
    expect(out.damageScaleAfter).toBeCloseTo(0.9);
    expect(out.charges.piercesLeft).toBe(0);
  });

  it('does not consume a boomerang (return) projectile on hit, so it can fly back', () => {
    const behaviors: BehaviorSpec[] = [{ type: 'return', falloff: 0.8 }];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      candidates: [],
    });
    // Regression: a chakram with only `return` was consumed on the first mob and never returned.
    expect(out.consume).toBe(false);
    expect(out.pierce).toBe(true);
  });

  it('chains to the nearest un-hit mob in range, redirects velocity, applies falloff', () => {
    const behaviors: BehaviorSpec[] = [{ type: 'chain', count: 2, range: 100, falloff: 0.7 }];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      candidates: [mob(2, 200, 0), mob(3, 0, 30)],
    });
    expect(out.consume).toBe(false);
    expect(out.redirect).toBeDefined();
    expect(out.redirect!.vy).toBeGreaterThan(0);
    expect(Math.hypot(out.redirect!.vx, out.redirect!.vy)).toBeCloseTo(10);
    expect(out.arcTo).toEqual({ x: 0, y: 30 });
    expect(out.damageScaleAfter).toBeCloseTo(0.7);
    expect(out.charges.bouncesLeft).toBe(1);
  });

  it('consumes when chain has no un-hit target in range', () => {
    const behaviors: BehaviorSpec[] = [{ type: 'chain', count: 2, range: 50, falloff: 0.7 }];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      candidates: [mob(2, 500, 0)],
    });
    expect(out.consume).toBe(true);
    expect(out.redirect).toBeUndefined();
  });

  it('prefers chain over pierce while bounces remain', () => {
    const behaviors: BehaviorSpec[] = [
      { type: 'chain', count: 1, range: 100, falloff: 0.7 },
      { type: 'pierce', count: 1, falloff: 0.9 },
    ];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      candidates: [mob(2, 0, 20)],
    });
    expect(out.redirect).toBeDefined();
    expect(out.pierce).toBe(false);
  });

  it('returns splash params and fork spawns; forks fan around the heading', () => {
    const behaviors: BehaviorSpec[] = [
      { type: 'splash', radius: 60, scale: 0.5 },
      { type: 'fork', count: 2, spreadRad: 0.4, falloff: 0.6 },
    ];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      candidates: [],
    });
    expect(out.splash).toEqual({ radius: 60, scale: 0.5 });
    expect(out.forks).toHaveLength(2);
    expect(out.forks[0]!.damageScale).toBeCloseTo(0.6);
    expect(out.charges.forksLeft).toBe(0);
    expect(Math.hypot(out.forks[0]!.vx, out.forks[0]!.vy)).toBeCloseTo(10);
  });

  it('never re-hits a mob already in hitMobs (chain skips it)', () => {
    const behaviors: BehaviorSpec[] = [{ type: 'chain', count: 2, range: 100, falloff: 0.7 }];
    const out = resolveHit({
      ...base,
      behaviors,
      charges: initialCharges(behaviors),
      hitMobs: new Set([2]),
      candidates: [mob(2, 0, 10)],
    });
    expect(out.consume).toBe(true);
  });
});

describe('steerHoming', () => {
  it('turns velocity toward the target, capped by turn rate, preserving speed', () => {
    const out = steerHoming(0, 0, 10, 0, mob(1, 0, 100), Math.PI / 2, 100);
    expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(10);
    expect(out.vy).toBeGreaterThan(0);
    expect(out.vx).toBeLessThan(10);
  });
});
