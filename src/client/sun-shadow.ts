/**
 * Time-of-day sun shadows — a 2.5D depth + atmosphere cue.
 *
 * The renderer plants every actor on the ground with a soft directional shadow leaning away from a
 * fixed "sun" (the consistent baked-light Diablo look). The world already runs a slow day/night
 * cycle (`atmosphere.ts`); this couples the shadow to that same sun. A high noon sun throws a short,
 * dark, crisp shadow directly under the caster; a low dawn/dusk (or moonlit-night) sun rakes long,
 * faint shadows across the ground. Watching shadows stretch out toward evening is one of the
 * strongest "this ground is a real lit surface" signals a flat top-down scene can fake.
 *
 * This is the pure mapping from sun altitude to a pair of multipliers applied to the planted
 * shadow's *length* (its reach away from the feet) and *alpha*. Direction is deliberately left
 * fixed — the project's baked-sun look keeps every shadow leaning the same way; only how far the
 * sun has climbed changes through the day. Stateless like `easing.ts`/`shadow-lift.ts`: callers feed
 * the current daylight each frame and multiply the shadow's base metrics by what this returns. An
 * overhead sun (daylight 1, e.g. indoors where there is no cycle) returns the identity {1, 1}, so
 * indoor/noon scenes keep exactly the look they have today.
 */

import { clamp } from '../shared/math.js';

/** Shadow lengthens by up to this fraction past its noon reach as the sun sinks to the horizon. */
const MAX_STRETCH = 1.1;
/** Shadow fades to (1 - this) of its noon alpha at the lowest sun — a raking light is diffuse. */
const MAX_FADE = 0.4;

/**
 * Map the sun's altitude (via `daylight`) to shadow `stretch`/`alpha` multipliers.
 *
 * @param daylight 0 at midnight (sun on the horizon → long, faint shadow), 1 at noon (overhead sun
 *                 → short, dark shadow). Values outside [0,1] clamp.
 * @returns        multipliers; {stretch: 1, alpha: 1} exactly at noon (and indoors, where callers
 *                 pass daylight = 1 because there is no day/night cycle).
 */
export function sunShadow(daylight: number): { stretch: number; alpha: number } {
  const altitude = clamp(daylight, 0, 1);
  const lowness = 1 - altitude; // 0 overhead, 1 on the horizon
  return {
    stretch: 1 + lowness * MAX_STRETCH,
    alpha: 1 - lowness * MAX_FADE,
  };
}
