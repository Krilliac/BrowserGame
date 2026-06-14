/**
 * Cloud-shadow field math — the pure core behind `clouds.ts`.
 *
 * Drifting cloud shadows imply a sky and a sun *above* the flat ground plane: soft dark patches
 * sail across the terrain on the wind, sliding past the player as they walk (so the shadows are
 * anchored to the world, not the screen). This module holds the two stateless bits that need
 * testing without a renderer: how strong the shadows are for the time of day, and how a fixed pool
 * of clouds wraps into an endless field around the moving camera. Stateless like
 * `shadow-lift.ts`/`sun-shadow.ts`.
 */

import { clamp } from '../shared/math.js';

/**
 * Cloud shadows only fall while the sun is up: at their darkest near midday, gone at night (no sun
 * to occlude). Maps daylight (0 = midnight, 1 = noon) to a 0..1 strength the renderer scales the
 * cloud alpha by.
 */
export function cloudStrength(daylight: number): number {
  return clamp(daylight, 0, 1);
}

/**
 * Wrap a world coordinate into the band `[center - half, center + half)` by shifting whole `2*half`
 * spans. A cloud that drifts off one edge of the camera's view reappears at the opposite edge, so a
 * small fixed pool reads as an endless field. Pure; returns `v` unchanged if `half` isn't positive.
 */
export function wrapSpan(v: number, center: number, half: number): number {
  if (half <= 0) return v;
  const span = half * 2;
  const offset = (((v - (center - half)) % span) + span) % span;
  return center - half + offset;
}
