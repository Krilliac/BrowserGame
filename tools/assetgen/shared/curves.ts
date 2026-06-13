/**
 * Animation easing curves shared by the sprite and FX synths (ASSET-ANIM part 1), so baked motion and
 * the in-game interpolation speak the same language. Names mirror `src/client/easing.ts` (linear,
 * quadOut, cubicOut, cubicInOut, backOut, bounceOut) plus a couple synth-only shapes (overshoot,
 * oscillate). All take and return [0,1]-ish and are pure.
 */

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

export const linear = (t: number): number => clamp01(t);
export const quadOut = (t: number): number => {
  const u = clamp01(t);
  return 1 - (1 - u) * (1 - u);
};
export const cubicOut = (t: number): number => {
  const u = clamp01(t);
  return 1 - Math.pow(1 - u, 3);
};
export const cubicInOut = (t: number): number => {
  const u = clamp01(t);
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
};
export const backOut = (t: number): number => {
  const u = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
};
export const bounceOut = (t: number): number => {
  let u = clamp01(t);
  const n1 = 7.5625;
  const d1 = 2.75;
  if (u < 1 / d1) return n1 * u * u;
  if (u < 2 / d1) return n1 * (u -= 1.5 / d1) * u + 0.75;
  if (u < 2.5 / d1) return n1 * (u -= 2.25 / d1) * u + 0.9375;
  return n1 * (u -= 2.625 / d1) * u + 0.984375;
};

/** Anticipation→follow-through: dips below 0 then overshoots past 1 (attack swings, casts). */
export const overshoot = (t: number, amount = 0.18): number => {
  const u = clamp01(t);
  return u + amount * Math.sin(u * Math.PI) * (u < 0.3 ? -1 : 1);
};

/** A looping oscillation in [-1,1] (idle breathing, walk bob). `cycles` over the [0,1] range. */
export const oscillate = (t: number, cycles = 1): number => Math.sin(t * cycles * Math.PI * 2);
