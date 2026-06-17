import { describe, expect, it } from 'vitest';
import { pointToSegmentDist } from './geometry.js';

describe('pointToSegmentDist', () => {
  it('returns 0 for a point lying exactly on the segment', () => {
    // Midpoint of a horizontal segment from (0,0) to (10,0) is (5,0).
    expect(pointToSegmentDist(5, 0, 0, 0, 10, 0)).toBeCloseTo(0);
  });

  it('returns the perpendicular offset for a point off the side of the segment', () => {
    // Point (5, 3) is 3 units above the midpoint of segment (0,0)→(10,0).
    expect(pointToSegmentDist(5, 3, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('returns the perpendicular offset for a point below the segment', () => {
    expect(pointToSegmentDist(5, -4, 0, 0, 10, 0)).toBeCloseTo(4);
  });

  it('returns distance to the near endpoint when the point is beyond the A end', () => {
    // Point (-3, 0) is to the left of A=(0,0); nearest point is A itself.
    expect(pointToSegmentDist(-3, 0, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('returns distance to the far endpoint when the point is beyond the B end', () => {
    // Point (13, 0) is to the right of B=(10,0); nearest point is B itself.
    expect(pointToSegmentDist(13, 0, 0, 0, 10, 0)).toBeCloseTo(3);
  });

  it('handles a diagonal segment correctly', () => {
    // Segment (0,0)→(4,4). Point (4,0) projects to (2,2), distance = sqrt((4-2)^2+(0-2)^2) = sqrt(8).
    expect(pointToSegmentDist(4, 0, 0, 0, 4, 4)).toBeCloseTo(Math.sqrt(8));
  });

  it('degenerate segment (A==B) returns distance to that point', () => {
    // Both endpoints at (5,5), query from (8,9): distance = sqrt(9+16) = 5.
    expect(pointToSegmentDist(8, 9, 5, 5, 5, 5)).toBeCloseTo(5);
  });
});
