import { describe, expect, it } from 'vitest';
import type { Rect } from './areas.js';
import {
  houseWalls,
  pointInAnyRect,
  pointInRect,
  resolveCircleMove,
  segmentIntersectsRect,
  separateCircles,
  type Footprint,
} from './collision.js';

describe('houseWalls', () => {
  // A 200x200 house at the origin, default thickness 10, default door 48.
  const foot: Footprint = { minX: 0, minY: 0, maxX: 200, maxY: 200 };

  it('produces 4 edges: north, west, east, and a split south wall (2 segments)', () => {
    const walls = houseWalls(foot);
    // north + west + east + 2 south segments = 5 rects total.
    expect(walls).toHaveLength(5);
  });

  it('leaves a centered, OPEN door gap on the south edge', () => {
    const walls = houseWalls(foot);
    // The door gap is centered on the south edge: width 48 centered at x=100 -> [76, 124].
    // A point in the middle of the doorway (x=100) at the south wall's y should sit in NO wall.
    const doorX = 100;
    const doorY = 195; // within the south wall band (190..200)
    const insideAnyWall = walls.some((w) => pointInRect(doorX, doorY, w));
    expect(insideAnyWall).toBe(false);
  });

  it('omits the south wall entirely when the door is as wide as the edge', () => {
    const walls = houseWalls(foot, { doorWidth: 200 });
    // Only north/west/east remain.
    expect(walls).toHaveLength(3);
  });
});

describe('resolveCircleMove', () => {
  const RADIUS = 8;

  it('returns the exact target when no rects exist', () => {
    expect(resolveCircleMove(0, 0, 50, 30, RADIUS, [])).toEqual({ x: 50, y: 30 });
  });

  it('returns the exact target when the move is entirely clear of all rects', () => {
    // A wall far away to the east; a small move to the right stays clear.
    const rects: Rect[] = [{ x: 500, y: 0, w: 10, h: 200 }];
    expect(resolveCircleMove(0, 100, 40, 100, RADIUS, rects)).toEqual({ x: 40, y: 100 });
  });

  it('blocks a straight move into a wall, stopping ~radius before its surface', () => {
    // Vertical wall whose left face is at x=100 (thick enough that the target lands inside it).
    const rects: Rect[] = [{ x: 100, y: 0, w: 60, h: 200 }];
    const out = resolveCircleMove(50, 100, 120, 100, RADIUS, rects);
    // The body's center is stopped at the wall face minus its radius.
    expect(out.x).toBeCloseTo(100 - RADIUS, 6);
    expect(out.y).toBeCloseTo(100, 6);
    // And it is genuinely outside the wall (not overlapping).
    expect(out.x + RADIUS).toBeLessThanOrEqual(100 + 1e-9);
  });

  it('slides along a wall on a diagonal move (parallel component still advances)', () => {
    // Same vertical wall at x=100 (thick enough that the target lands inside it).
    const rects: Rect[] = [{ x: 100, y: 0, w: 60, h: 200 }];
    const out = resolveCircleMove(50, 50, 120, 90, RADIUS, rects);
    // X (into the wall) is blocked at the surface...
    expect(out.x).toBeCloseTo(100 - RADIUS, 6);
    // ...but Y (parallel to the wall) still advances to the desired value: sliding.
    expect(out.y).toBeCloseTo(90, 6);
  });

  it('allows walking in through the centered door gap', () => {
    // Build a house and try to enter through the south door from just below it.
    const foot: Footprint = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
    const walls = houseWalls(foot);
    // Start just south of the door (outside, below maxY) and walk north into the doorway.
    const startX = 100;
    const startY = 210;
    const out = resolveCircleMove(startX, startY, startX, 185, RADIUS, walls);
    // The move through the open gap is unobstructed: we reach the target inside the house.
    expect(out.x).toBeCloseTo(startX, 6);
    expect(out.y).toBeCloseTo(185, 6);
  });

  it('blocks entry where the south wall is solid (not the door)', () => {
    // Walking north through the SOLID part of the south wall (off-center) is stopped.
    const foot: Footprint = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
    const walls = houseWalls(foot);
    // x=30 is well inside the left south-wall segment (gap is [76,124]).
    const out = resolveCircleMove(30, 210, 30, 185, RADIUS, walls);
    // Stopped at the wall's south (max-y) face plus radius: wall spans y in [190,200].
    expect(out.y).toBeCloseTo(200 + RADIUS, 6);
  });
});

describe('separateCircles', () => {
  it('returns inputs unchanged when the circles do not overlap', () => {
    const out = separateCircles(0, 0, 100, 0, 10, 10);
    expect(out).toEqual({ ax: 0, ay: 0, bx: 100, by: 0 });
  });

  it('returns inputs unchanged when exactly touching (distance === sum of radii)', () => {
    const out = separateCircles(0, 0, 20, 0, 10, 10);
    expect(out).toEqual({ ax: 0, ay: 0, bx: 20, by: 0 });
  });

  it('pushes each circle HALF the overlap apart along the center line (exact distances)', () => {
    // Centers 10 apart, radii sum 16 -> overlap 6 -> each moves 3 along the x axis.
    const out = separateCircles(0, 0, 10, 0, 8, 8);
    expect(out.ax).toBeCloseTo(-3, 10);
    expect(out.ay).toBeCloseTo(0, 10);
    expect(out.bx).toBeCloseTo(13, 10);
    expect(out.by).toBeCloseTo(0, 10);
    // After separation the circles rest exactly touching.
    const dist = Math.hypot(out.bx - out.ax, out.by - out.ay);
    expect(dist).toBeCloseTo(16, 10);
  });

  it('splits the push half/half even with unequal radii (mtv is per-pair, not per-radius)', () => {
    // Centers 5 apart on y, radii 8 + 3 = 11 -> overlap 6 -> each moves 3 along y.
    const out = separateCircles(0, 0, 0, 5, 8, 3);
    expect(out.ay).toBeCloseTo(-3, 10);
    expect(out.by).toBeCloseTo(8, 10);
    expect(out.ax).toBeCloseTo(0, 10);
    expect(out.bx).toBeCloseTo(0, 10);
  });

  it('separates along the diagonal center line, not an axis', () => {
    // Centers (0,0) and (3,4): distance 5, radii sum 9 -> overlap 4 -> each moves 2
    // along the unit direction (0.6, 0.8).
    const out = separateCircles(0, 0, 3, 4, 4, 5);
    expect(out.ax).toBeCloseTo(-1.2, 10);
    expect(out.ay).toBeCloseTo(-1.6, 10);
    expect(out.bx).toBeCloseTo(4.2, 10);
    expect(out.by).toBeCloseTo(5.6, 10);
  });

  it('handles exactly-coincident centers without NaN, pushing along +x', () => {
    const out = separateCircles(5, 5, 5, 5, 4, 4);
    expect(Number.isFinite(out.ax)).toBe(true);
    expect(Number.isFinite(out.bx)).toBe(true);
    // Overlap is the full radii sum (8); A goes -x by 4, B goes +x by 4.
    expect(out.ax).toBeCloseTo(1, 10);
    expect(out.ay).toBeCloseTo(5, 10);
    expect(out.bx).toBeCloseTo(9, 10);
    expect(out.by).toBeCloseTo(5, 10);
  });
});

describe('segmentIntersectsRect', () => {
  const rect: Rect = { x: 10, y: 10, w: 20, h: 20 }; // spans [10,30] x [10,30]

  it('detects a segment crossing straight through (both endpoints outside)', () => {
    expect(segmentIntersectsRect(0, 20, 40, 20, rect)).toBe(true);
  });

  it('detects a segment with one endpoint inside the rect', () => {
    expect(segmentIntersectsRect(20, 20, 100, 100, rect)).toBe(true);
  });

  it('detects a segment fully inside the rect (both endpoints inside)', () => {
    expect(segmentIntersectsRect(12, 12, 28, 28, rect)).toBe(true);
  });

  it('rejects a segment that misses entirely', () => {
    expect(segmentIntersectsRect(0, 0, 5, 40, rect)).toBe(false);
  });

  it('rejects a segment whose infinite line would hit but whose span stops short', () => {
    // Pointing straight at the rect but ending before reaching it.
    expect(segmentIntersectsRect(0, 20, 8, 20, rect)).toBe(false);
  });

  it('counts touching a corner as intersecting (inclusive boundary)', () => {
    // Diagonal passing exactly through the (10,10) corner.
    expect(segmentIntersectsRect(0, 20, 20, 0, rect)).toBe(true);
  });

  it('counts a tangent segment running along an edge as intersecting (inclusive boundary)', () => {
    // Collinear with the top edge y=10.
    expect(segmentIntersectsRect(0, 10, 40, 10, rect)).toBe(true);
  });

  it('rejects a parallel segment just outside an edge', () => {
    expect(segmentIntersectsRect(0, 9.999, 40, 9.999, rect)).toBe(false);
  });

  it('treats a zero-length segment as an inclusive point test', () => {
    expect(segmentIntersectsRect(20, 20, 20, 20, rect)).toBe(true);
    expect(segmentIntersectsRect(10, 10, 10, 10, rect)).toBe(true); // on the corner
    expect(segmentIntersectsRect(5, 5, 5, 5, rect)).toBe(false);
  });
});

describe('pointInAnyRect', () => {
  const rects: Rect[] = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 50, y: 50, w: 10, h: 10 },
  ];

  it('is true when the point is inside any rect, false otherwise', () => {
    expect(pointInAnyRect(5, 5, rects)).toBe(true);
    expect(pointInAnyRect(55, 55, rects)).toBe(true);
    expect(pointInAnyRect(30, 30, rects)).toBe(false);
  });

  it('includes edges (same boundary as pointInRect) and is false for an empty list', () => {
    expect(pointInAnyRect(10, 10, rects)).toBe(true);
    expect(pointInAnyRect(5, 5, [])).toBe(false);
  });
});
