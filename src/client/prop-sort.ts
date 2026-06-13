/**
 * Depth-sort helpers for tall/line props (RENDER-05).
 *
 * A wall/fence run drawn as ONE sprite can only carry a single `zIndex` (its midpoint row), so an
 * actor standing beside the middle of a long palisade sorts entirely in front of or behind the whole
 * wall. The fix is the segment-split: sample the run into per-stake points, and let the renderer
 * build each stake as its own container at its own ground row. An actor then interleaves stake by
 * stake — occluded by the posts north of their feet, occluding the posts to the south.
 *
 * This module is the pure, unit-testable core: it turns a run's endpoints into the list of stake
 * sample points (each carrying the delta to the next stake so the renderer can draw the connecting
 * rope without re-deriving it). No Pixi here.
 */

export interface Stake {
  /** World position of this stake; its `y` is also its sort key (zIndex). */
  x: number;
  y: number;
  /** World delta to the next stake along the run (0,0 for the last stake). */
  nextDx: number;
  nextDy: number;
  /** True for the final stake — it draws no connecting rope. */
  isLast: boolean;
}

/**
 * Sample a line run `(x1,y1)→(x2,y2)` into evenly-spaced stakes, roughly one every `spacing` world
 * px. Always yields at least two endpoints (one segment). Each stake's `y` is its own ground-row sort
 * key, so a north-south run produces monotonically increasing keys from north to south.
 */
export function palisadeStakes(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  spacing = 16,
): Stake[] {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.round(len / spacing));
  const out: Stake[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    const isLast = i === steps;
    const nt = (i + 1) / steps;
    const nx = x1 + (x2 - x1) * nt;
    const ny = y1 + (y2 - y1) * nt;
    out.push({
      x,
      y,
      nextDx: isLast ? 0 : nx - x,
      nextDy: isLast ? 0 : ny - y,
      isLast,
    });
  }
  return out;
}

// ─── Occluder fade (RENDER-06) ───────────────────────────────────────────────────
// A tall point prop (tree/pillar) hides the player when the player stands within the trunk's
// horizontal margin AND behind it: from just south of the base (foreground overlap) up to where the
// foliage reaches north up the screen. Tuned to the renderer's tree/pillar art.
export const OCCLUDER_X_MARGIN = 22; // |player.x − prop.x| under which the trunk overlaps the player
export const OCCLUDER_FRONT = 10; // world px south of the base the player can stand and stay covered
export const OCCLUDER_BACK = 48; // world px north of the base the foliage reaches up the screen

/** True when the player at (px,py) is hidden behind a tall prop at (ox,oy) and should fade it. */
export function playerHiddenBehind(px: number, py: number, ox: number, oy: number): boolean {
  const dx = Math.abs(px - ox);
  const dy = oy - py; // > 0 means the player is north of (behind) the prop
  return dx < OCCLUDER_X_MARGIN && dy > -OCCLUDER_FRONT && dy < OCCLUDER_BACK;
}
