/**
 * UI overflow guard for the Canvas2D HUD. Panels are drawn as axis-aligned rectangles on a viewport
 * of a given size; on small or rotated screens (the spell-merchant bug) a panel could run off an
 * edge or be larger than the screen entirely. These pure helpers keep a panel fully on-screen so it
 * always stays interactable. No DOM, no Pixi — fully unit-testable.
 */

/** An axis-aligned panel rectangle in HUD/canvas pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The drawable area (the HUD canvas size in pixels). */
export interface Viewport {
  w: number;
  h: number;
}

/** True when `rect` lies fully inside `viewport` (touching the edge counts as inside). */
export function fitsInViewport(rect: Rect, viewport: Viewport): boolean {
  return (
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= viewport.w && rect.y + rect.h <= viewport.h
  );
}

/**
 * Return a new rect repositioned/resized so it stays fully inside the viewport, keeping `margin`
 * pixels of breathing room from each edge where possible.
 *
 * Order matters: first shrink so the panel is no larger than the viewport minus margins (otherwise
 * it can never fit), then shift it inward so no edge runs off. If the viewport is so tiny that even
 * margins don't fit, we clamp to a non-negative size and pin to the top-left — never returning a
 * negative width/height or position.
 */
export function clampPanelRect(rect: Rect, viewport: Viewport, margin: number = 8): Rect {
  // Usable span on each axis once both margins are reserved; floored at 0 for tiny viewports.
  const maxW = Math.max(0, viewport.w - margin * 2);
  const maxH = Math.max(0, viewport.h - margin * 2);

  const w = Math.min(rect.w, maxW);
  const h = Math.min(rect.h, maxH);

  // Shift inward: clamp the top-left so the (possibly shrunk) panel sits within [margin, viewport-margin].
  // Math.max(margin, …) wins when the panel is pushed off the right/bottom; the inner min handles
  // negative starts (off the left/top).
  const x = clamp(rect.x, margin, Math.max(margin, viewport.w - margin - w));
  const y = clamp(rect.y, margin, Math.max(margin, viewport.h - margin - h));

  return { x, y, w, h };
}

/** Clamp `value` into the inclusive range [lo, hi]; if lo > hi, returns lo (degenerate viewport). */
function clamp(value: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, value));
}
