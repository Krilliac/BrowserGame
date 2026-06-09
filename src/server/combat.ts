/**
 * Pure combat geometry helpers used by the authoritative World. Kept framework-free and
 * unit-tested (combat.test.ts). The World owns entity state; these just answer
 * "did this hit?" and "which way?".
 */

/** Normalize a direction; falls back to `fallback` (radians) when the vector is ~zero. */
export function aimAngle(dx: number, dy: number, fallback = 0): number {
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return fallback;
  return Math.atan2(dy, dx);
}

/** Smallest absolute difference between two angles, in [0, π]. */
export function angleDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

/**
 * True if a target at (tx,ty) is within a melee cone: centered on `facing`, reaching `range`,
 * with half-angle `halfAngle`, from an attacker at (ax,ay).
 */
export function inMeleeCone(
  ax: number,
  ay: number,
  facing: number,
  tx: number,
  ty: number,
  range: number,
  halfAngle: number,
): boolean {
  const dx = tx - ax;
  const dy = ty - ay;
  const dist = Math.hypot(dx, dy);
  if (dist > range) return false;
  if (dist < 1e-6) return true; // on top of the attacker
  return angleDelta(facing, Math.atan2(dy, dx)) <= halfAngle;
}

/** Circle overlap test — used for projectile vs entity collisions. */
export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const r = ar + br;
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy <= r * r;
}
