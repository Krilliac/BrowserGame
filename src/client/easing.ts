/**
 * Easing curves for one-shot FX fades in the renderer (hit flashes, pickup pops, damage-number
 * arcs). Each export is a pure shaping function `(t: 0..1) -> 0..1`: callers compute their own
 * elapsed/duration ratio every frame and pass it in. This is deliberately NOT a tween system —
 * the project has no tween queue, and these helpers must stay stateless.
 *
 * Vendored pattern (stage.js's easing combinator): only the ease-IN base curves are written by
 * hand; `out(f)` mirrors a curve (`1 - f(1 - t)`) into its decelerating twin, and `inOut(f)`
 * stitches a curve to its own mirror. The whole family falls out of two one-liners instead of a
 * formula per variant.
 *
 * Every export clamps its input, returning exactly 0 for t <= 0 and exactly 1 for t >= 1, so
 * callers can feed unclamped ratios without a final-frame pop from floating-point residue.
 */

/** Mirror an ease-in curve into its ease-out twin: decelerate instead of accelerate. */
const out =
  (f: (t: number) => number) =>
  (t: number): number =>
    1 - f(1 - t);

/** First half is the ease-in scaled to [0, 0.5]; second half is its mirror scaled to [0.5, 1]. */
const inOut =
  (f: (t: number) => number) =>
  (t: number): number =>
    t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2;

/** Clamp t into [0, 1] and pin the endpoints so f(0) === 0 and f(1) === 1 hold exactly. */
const clamped =
  (f: (t: number) => number) =>
  (t: number): number =>
    t <= 0 ? 0 : t >= 1 ? 1 : f(t);

// Base ease-in curves. Everything exported below derives from these via the combinators.
const quadIn = (t: number): number => t * t;
const cubicIn = (t: number): number => t * t * t;

/** Classic back-ease overshoot constant; ~10% overshoot past the target before settling. */
const BACK_OVERSHOOT = 1.70158;

// Algebraically equal to the textbook (s+1)t^3 - s*t^2, but factored so backIn(1) is exactly 1
// (the (t - 1) term vanishes) — keeps out(backIn) endpoint-exact without float fudging.
const backIn = (t: number): number => t * t * t + BACK_OVERSHOOT * t * t * (t - 1);

/** 121/16 — makes the four parabolic bounce arcs meet at the standard height ratios. */
const BOUNCE_STIFFNESS = 7.5625;

// Bounce is naturally an "out" curve (big fall first, small bounces after), so it is the one
// member of the family written directly rather than derived via the combinators.
const bounceOutRaw = (t: number): number => {
  const d = 2.75;
  if (t < 1 / d) return BOUNCE_STIFFNESS * t * t;
  if (t < 2 / d) {
    const p = t - 1.5 / d;
    return BOUNCE_STIFFNESS * p * p + 0.75;
  }
  if (t < 2.5 / d) {
    const p = t - 2.25 / d;
    return BOUNCE_STIFFNESS * p * p + 0.9375;
  }
  const p = t - 2.625 / d;
  return BOUNCE_STIFFNESS * p * p + 0.984375;
};

/** No shaping; useful as the explicit default when a call site takes an easing parameter. */
export const linear: (t: number) => number = clamped((t) => t);

/** Fast start, gentle landing — the workhorse for fade-outs. */
export const quadOut: (t: number) => number = clamped(out(quadIn));

/** Like quadOut but snappier early and flatter late. */
export const cubicOut: (t: number) => number = clamped(out(cubicIn));

/** Slow-fast-slow; good for things that travel (damage-number arcs). */
export const cubicInOut: (t: number) => number = clamped(inOut(cubicIn));

/** Overshoots past 1 mid-curve (~1.1 peak) then settles back — punchy scale-in pops. */
export const backOut: (t: number) => number = clamped(out(backIn));

/** Drops in and bounces to rest; stays within [0, 1]. For loot landing on the ground. */
export const bounceOut: (t: number) => number = clamped(bounceOutRaw);
