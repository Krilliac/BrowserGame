import { describe, expect, it } from 'vitest';
import type { Rect } from './areas.js';
import { houseWalls, pointInRect, resolveCircleMove, type Footprint } from './collision.js';

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
