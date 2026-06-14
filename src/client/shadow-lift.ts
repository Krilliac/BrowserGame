/**
 * Height-reactive contact shadows — a 2.5D depth cue.
 *
 * The renderer draws billboards (actors, projectiles, loot) on a flat ground plane and lifts them
 * off it: a walk/idle bob, a flyer's hover, an arrow riding above its path, a loot drop's pop. Their
 * ground shadow, however, was baked once and stayed a fixed size + opacity no matter how high the
 * caster rose. Real contact shadows don't: the higher something floats, the smaller and fainter the
 * dark blob beneath it gets (the light wraps around it), tightening + darkening as it lands. That
 * shrink-and-fade is the readable "how high is this thing" signal — the classic platformer shadow.
 *
 * This is the pure mapping from elevation to a pair of multipliers applied to the shadow's *planted*
 * (grounded) scale and alpha. It is deliberately stateless like `easing.ts`: callers compute the
 * current lift each frame and multiply the shadow's base metrics by what this returns. A grounded
 * caster (lift 0) always returns the identity {scale: 1, alpha: 1}, so nothing changes until a
 * billboard actually leaves the ground.
 */

import { clamp } from '../shared/math.js';

/** Elevation (world px) at which the shadow reaches its smallest + faintest. Tuned so a walk bob
 *  (~2px) is barely a flicker while a flyer's hover (~16px) clearly reads as airborne. */
export const SHADOW_LIFT_FALLOFF = 30;

/** Shadow shrinks to (1 - this) of its planted size at full lift — the blob pulls in under the riser. */
const MAX_SHRINK = 0.45;
/** Shadow fades to (1 - this) of its planted alpha at full lift — light spills in around the edges. */
const MAX_FADE = 0.55;

/**
 * Map a caster's elevation above the ground plane to shadow `scale`/`alpha` multipliers.
 *
 * @param lift     elevation above the ground in world px; negatives clamp to grounded (0).
 * @param falloff  height at which the shadow is fully shrunk/faded (defaults to `SHADOW_LIFT_FALLOFF`).
 * @returns        multipliers in (0, 1]; {scale: 1, alpha: 1} exactly when grounded.
 */
export function shadowLift(
  lift: number,
  falloff: number = SHADOW_LIFT_FALLOFF,
): { scale: number; alpha: number } {
  const t = clamp(lift / falloff, 0, 1);
  return {
    scale: 1 - MAX_SHRINK * t,
    alpha: 1 - MAX_FADE * t,
  };
}
