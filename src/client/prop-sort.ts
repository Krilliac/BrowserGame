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
