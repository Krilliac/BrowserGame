/**
 * Click hit-testing for the Canvas2D HUD. Panels are immediate-mode: every frame they redraw
 * their buttons and re-register a rectangle per clickable thing. This module owns the two rules
 * that make those rectangles feel like real buttons:
 *
 * 1. Topmost-drawn wins (vendored from hex-engine): regions are added in DRAW ORDER, so the
 *    LAST added region containing a point is the one on top — no z-index bookkeeping.
 * 2. Down-and-up-inside (DOM click semantics): a click fires only when the pointer goes down
 *    inside a region AND comes up inside that same region. Dragging off before release cancels.
 *
 * Because panels re-register fresh region objects (and fresh onClick closures) every frame,
 * "same region" CANNOT mean object identity — the object that took the pointer-down is gone by
 * the time pointer-up arrives. Instead we remember the rect (and handler) captured at down time
 * and, at up time, match by RECT EQUALITY against the regions currently registered: the topmost
 * current region with the identical x/y/w/h is "the same button", and its fresh handler is the
 * one we fire. If no current region has that exact rect (e.g. the up landed mid-frame before the
 * panel re-registered), we fall back to "the up point is still inside the remembered rect" and
 * fire the handler captured at down time. A genuine relayout (the button moved) breaks rect
 * equality and usually moves the rect off the up point too, so stale clicks die naturally.
 */

/** A clickable HUD rectangle for one frame. Containment is half-open: [x, x+w) × [y, y+h). */
export interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  onClick: () => void;
}

interface PressState {
  /** Copy of the rect that took the pointer-down (the registered object is per-frame). */
  rect: { x: number; y: number; w: number; h: number };
  /** Handler captured at down time — the fallback when no current region matches the rect. */
  onClick: () => void;
}

export class HitRegions {
  private regions: HitRegion[] = [];
  private press: PressState | null = null;

  /**
   * Clear and re-collect each HUD frame: panels register rects in draw order (later = on top).
   * An in-flight press deliberately survives this — see the up-matching rules above.
   */
  begin(): void {
    this.regions = [];
  }

  add(region: HitRegion): void {
    this.regions.push(region);
  }

  /**
   * Pointer-down: remember the topmost region under the point. Returns true when one exists,
   * i.e. the HUD captured this pointer and the world should not receive it.
   */
  down(x: number, y: number): boolean {
    const hit = this.topmostAt(x, y);
    // A fresh down always replaces any stale press (e.g. a pointer-up the page never saw).
    this.press = hit
      ? { rect: { x: hit.x, y: hit.y, w: hit.w, h: hit.h }, onClick: hit.onClick }
      : null;
    return hit !== null;
  }

  /**
   * Pointer-up: fire onClick only if the up lands inside the same rect that took the down
   * (current-frame handler preferred, down-time handler as fallback — see module doc).
   * Returns true when a press was in flight — the HUD captured the down, so the up is consumed
   * even on a drag-out; the world must not treat it as a click. Returns false only when the
   * down never hit the HUD.
   */
  up(x: number, y: number): boolean {
    const press = this.press;
    if (press === null) return false;
    this.press = null;

    // Drag-out: released outside the button that was pressed — consumed, but no click.
    if (!contains(press.rect, x, y)) return true;

    const current = this.topmostMatching(press.rect);
    (current ? current.onClick : press.onClick)();
    return true;
  }

  /** Cancel any in-flight press (pointercancel / window blur). */
  cancel(): void {
    this.press = null;
  }

  /** Last-added (topmost-drawn) region containing the point, or null. */
  private topmostAt(x: number, y: number): HitRegion | null {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const region = this.regions[i];
      if (region && contains(region, x, y)) return region;
    }
    return null;
  }

  /** Topmost currently-registered region whose rect is identical to the pressed rect. */
  private topmostMatching(rect: PressState['rect']): HitRegion | null {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const region = this.regions[i];
      if (
        region &&
        region.x === rect.x &&
        region.y === rect.y &&
        region.w === rect.w &&
        region.h === rect.h
      ) {
        return region;
      }
    }
    return null;
  }
}

function contains(rect: { x: number; y: number; w: number; h: number }, x: number, y: number) {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}
