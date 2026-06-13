import { describe, expect, it } from 'vitest';
import { clamp, moveVector } from './movement.js';
import type { InputState } from './protocol.js';

/** Build an InputState with all keys up, overriding the pressed ones. */
function input(over: Partial<InputState> = {}): InputState {
  return { up: false, down: false, left: false, right: false, ...over };
}

describe('moveVector', () => {
  it('returns a zero vector when no direction is pressed', () => {
    expect(moveVector(input())).toEqual({ dx: 0, dy: 0 });
  });

  it('maps each cardinal direction to a unit axis vector (down = +y, up = -y)', () => {
    expect(moveVector(input({ right: true }))).toEqual({ dx: 1, dy: 0 });
    expect(moveVector(input({ left: true }))).toEqual({ dx: -1, dy: 0 });
    expect(moveVector(input({ down: true }))).toEqual({ dx: 0, dy: 1 });
    expect(moveVector(input({ up: true }))).toEqual({ dx: 0, dy: -1 });
  });

  it('cancels opposing inputs to zero on that axis', () => {
    expect(moveVector(input({ left: true, right: true }))).toEqual({ dx: 0, dy: 0 });
    expect(moveVector(input({ up: true, down: true }))).toEqual({ dx: 0, dy: 0 });
    expect(moveVector(input({ up: true, down: true, left: true, right: true }))).toEqual({
      dx: 0,
      dy: 0,
    });
  });

  it('normalizes every diagonal to magnitude 1 (corners are not faster)', () => {
    const inv = 1 / Math.SQRT2;
    for (const [dirs, sx, sy] of [
      [{ right: true, down: true }, 1, 1],
      [{ right: true, up: true }, 1, -1],
      [{ left: true, down: true }, -1, 1],
      [{ left: true, up: true }, -1, -1],
    ] as const) {
      const v = moveVector(input(dirs));
      expect(v.dx).toBeCloseTo(sx * inv, 12);
      expect(v.dy).toBeCloseTo(sy * inv, 12);
      expect(Math.hypot(v.dx, v.dy)).toBeCloseTo(1, 12); // same speed as a cardinal move
    }
  });

  it('cardinal moves also have magnitude 1 (so diagonals match cardinals exactly)', () => {
    expect(Math.hypot(...Object.values(moveVector(input({ up: true }))))).toBeCloseTo(1, 12);
  });
});

describe('clamp', () => {
  it('returns the value when within [min, max]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, -10, 10)).toBe(-3);
  });

  it('clamps below min and above max', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it('returns the boundary exactly when the value sits on it', () => {
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('is idempotent (clamping an already-clamped value is a no-op)', () => {
    const once = clamp(50, 0, 10);
    expect(clamp(once, 0, 10)).toBe(once);
  });
});
