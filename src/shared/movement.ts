import type { InputState } from './protocol.js';

/**
 * Movement math shared by the authoritative server (`world.ts`) and the client predictor
 * (`predictor.ts`). Using one implementation guarantees client-side prediction integrates exactly
 * like the server, so reconciliation converges instead of rubber-banding.
 */
export function moveVector(input: InputState): { dx: number; dy: number } {
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  // Normalize diagonals so corners aren't faster.
  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.SQRT2;
    dx *= inv;
    dy *= inv;
  }
  return { dx, dy };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Step a point from (fx,fy) toward (tx,ty) by at most `maxDist`. If the target is within `maxDist`
 * it snaps exactly onto it (no overshoot); a non-positive `maxDist` or a zero-length gap returns the
 * start unchanged. Pure + deterministic — used for things like the gold-vacuum pull.
 */
export function stepToward(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  maxDist: number,
): { x: number; y: number } {
  if (maxDist <= 0) return { x: fx, y: fy };
  const dx = tx - fx;
  const dy = ty - fy;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dist <= maxDist) return { x: tx, y: ty };
  const k = maxDist / dist;
  return { x: fx + dx * k, y: fy + dy * k };
}
