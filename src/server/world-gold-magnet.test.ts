import { describe, expect, it } from 'vitest';
import { goldMagnetStep } from './world.js';

/**
 * The gold-vacuum: a gold drop is pulled toward the nearest living player that is within the magnet
 * radius (95) but still beyond the pickup radius (30) — inside pickup, the normal collection handles
 * it. `goldMagnetStep` is the pure core of that behavior (tickItems applies it each frame).
 */
type P = { x: number; y: number; dead: boolean };
const player = (x: number, y: number, dead = false): P => ({ x, y, dead });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('goldMagnetStep', () => {
  const dt = 0.05;

  it('pulls gold toward a player inside the magnet band', () => {
    const gold = { x: 100, y: 100 };
    const p = player(100, 160); // d = 60: between pickup(30) and magnet(95)
    const moved = goldMagnetStep(gold, [p], dt);
    expect(moved.y).toBeGreaterThan(gold.y); // moved toward the player (south)
    expect(moved.x).toBeCloseTo(100, 9); // straight line
    expect(dist(moved, p)).toBeLessThan(dist(gold, p)); // got closer
  });

  it('leaves gold alone when no player is within the magnet radius', () => {
    const gold = { x: 100, y: 100 };
    expect(goldMagnetStep(gold, [player(100, 400)], dt)).toEqual(gold);
  });

  it('does not fight the normal pickup: gold inside the pickup radius is untouched', () => {
    const gold = { x: 100, y: 100 };
    expect(goldMagnetStep(gold, [player(100, 115)], dt)).toEqual(gold); // d = 15 < pickup
  });

  it('ignores dead players', () => {
    const gold = { x: 100, y: 100 };
    expect(goldMagnetStep(gold, [player(100, 160, true)], dt)).toEqual(gold);
  });

  it('homes on the nearest eligible player among several', () => {
    const gold = { x: 100, y: 100 };
    const near = player(100, 150); // d = 50
    const far = player(100, 60); // d = 40 north — actually nearer
    const moved = goldMagnetStep(gold, [near, far], dt);
    // far (d=40) is the nearest in-band player → gold moves north (toward y=60).
    expect(moved.y).toBeLessThan(gold.y);
  });

  it('converges toward the player over repeated ticks (until pickup takes over)', () => {
    const p = player(0, 0);
    let gold = { x: 90, y: 0 }; // start near the outer edge of the magnet band
    let d0 = dist(gold, p);
    for (let i = 0; i < 10; i++) {
      const next = goldMagnetStep(gold, [p], dt);
      const d1 = dist(next, p);
      expect(d1).toBeLessThanOrEqual(d0 + 1e-9); // never recedes
      gold = next;
      d0 = d1;
      if (d1 <= 30) break; // entered pickup band — vacuum done
    }
    expect(d0).toBeLessThanOrEqual(30 + 1e-6); // reached the pickup band
  });
});
