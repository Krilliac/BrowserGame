/**
 * Pure geometry helpers used by the server simulation. No imports — keeps this unit-testable
 * without any game-module bootstrapping.
 */

/**
 * Shortest distance from point P=(px,py) to the line segment AB=(ax,ay)→(bx,by).
 *
 * Algorithm: project P onto the infinite line through AB, clamp the parameter t to [0,1] to
 * land on the segment, then measure to the clamped nearest point.
 *
 * Edge case: when A==B the segment degenerates to a point — returns dist(P, A).
 */
export function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment: A and B are the same point.
    return Math.hypot(px - ax, py - ay);
  }

  // t is the projection parameter along the segment (0 = A, 1 = B).
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const nearestX = ax + t * dx;
  const nearestY = ay + t * dy;
  return Math.hypot(px - nearestX, py - nearestY);
}
