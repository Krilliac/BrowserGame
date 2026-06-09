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
