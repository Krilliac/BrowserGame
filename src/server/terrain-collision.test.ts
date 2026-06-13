import { describe, expect, it } from 'vitest';
import { getContent, initGameDb } from './content.js';
import {
  blockersForDecor,
  resolveCircleMove,
  pointInCircle,
  PLAYER_COLLISION_RADIUS,
} from '../shared/collision.js';

initGameDb(':memory:');

/**
 * End-to-end check that the seeded "Gloomwood Pass" terrain reaches the simulation as real collision:
 * the content DB → scaled decor → shared blockers → resolveCircleMove. Proves a player is stopped by
 * the cliff rock but can still walk through the authored gap, and slides around a solid boulder.
 */
describe('seeded terrain collision (Gloomwood Pass)', () => {
  const decor = getContent().area('wilderness')?.decor ?? [];

  it('seeds solid terrain decor into the wilderness', () => {
    const kinds = new Set(decor.map((d) => d.kind));
    expect(kinds.has('cliff')).toBe(true);
    expect(kinds.has('boulder')).toBe(true);
    expect(kinds.has('mountain')).toBe(true);
  });

  it('derives both rect and circle blockers from that decor', () => {
    const b = blockersForDecor(decor);
    expect(b.rects.length).toBeGreaterThan(0); // cliffs (+ any house walls)
    expect(b.circles.length).toBeGreaterThan(0); // mountains + boulders
  });

  it('stops a player walking INTO a cliff rock but lets them pass through the gap', () => {
    const b = blockersForDecor(decor);
    // A cliff face is a solid block in BOTH dimensions; house walls are thin (≈10 px) on one axis.
    const cliff = b.rects.find((r) => Math.min(r.w, r.h) > 25);
    expect(cliff).toBeDefined();
    const c = cliff!;
    const r = PLAYER_COLLISION_RADIUS;

    // Walk from just left of the cliff straight into its left face → blocked (can't enter the rock).
    const intoFace = resolveCircleMove(
      c.x - r - 5,
      c.y + c.h / 2,
      c.x + 20,
      c.y + c.h / 2,
      r,
      b.rects,
      b.circles,
    );
    expect(intoFace.x).toBeLessThanOrEqual(c.x - r + 1e-3); // stopped at the face, not inside

    // Walk along a horizontal line ABOVE the cliff (through open ground / the gap) → unobstructed
    // by THIS cliff (y is above it), so the body advances freely there.
    const aboveY = c.y - r - 50;
    const free = resolveCircleMove(c.x - 100, aboveY, c.x + 100, aboveY, r, [c], []);
    expect(free.x).toBeCloseTo(c.x + 100); // nothing blocks it at that y
  });

  it('pushes a player out of a solid boulder (round terrain)', () => {
    const b = blockersForDecor(decor);
    const boulder = b.circles[0]!;
    // Aim at the boulder center; the resolver must leave the body outside the rim.
    const r = resolveCircleMove(
      boulder.cx - 200,
      boulder.cy,
      boulder.cx,
      boulder.cy,
      PLAYER_COLLISION_RADIUS,
      [],
      b.circles,
    );
    expect(pointInCircle(r.x, r.y, boulder)).toBe(false);
  });
});
