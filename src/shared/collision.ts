/**
 * Pure, deterministic collision math shared by BOTH the authoritative server simulation
 * (src/server/world.ts) and the client-side movement predictor (src/client/predictor.ts).
 *
 * It is CRITICAL that both sides resolve movement identically: if the server and the client
 * predictor disagree about where a move ends up, the client visibly rubber-bands as the
 * server's authoritative position snaps it back. To guarantee that, this module is framework-free
 * and floating-point deterministic (no randomness, no time, no mutable global state) — call it
 * with the same inputs on either side and get the same output.
 */

import type { Rect, DecorProp } from './areas.js';

/** Axis-aligned bounding box of a building, in world coordinates. */
export interface Footprint {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A solid circle obstacle in world coordinates — round terrain (boulders, mountain bases). */
export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

/**
 * The full set of solid geometry for an area: axis-aligned `rects` (walls, cliffs, ridges, the
 * footprints of buildings) and `circles` (round terrain you slide around — boulders, mountains).
 * The server sim and the client predictor BOTH resolve movement against this same set, so they
 * agree exactly (the prerequisite for no rubber-banding).
 */
export interface Blockers {
  rects: readonly Rect[];
  circles: readonly Circle[];
}

/** Decor kinds whose footprint `(x,y)→(x2,y2)` is a solid RECT (walls/ledges/chokepoint barriers). */
const RECT_SOLID_KINDS = new Set(['cliff', 'ridge', 'barrier', 'wall']);
/** Decor kinds that are solid CIRCLES — round terrain you walk around (mountains slide, not stick). */
const CIRCLE_SOLID_KINDS = new Set(['mountain', 'boulder', 'peak']);
/** Circle radius (world units) at scale 1 for a round-solid prop authored with only a `scale` (no
 *  footprint). Sized for the scaled world so a lone boulder is a real obstacle, not a pebble; big
 *  terrain should use a footprint instead. Exported so the renderer sizes the rock to the collider. */
export const BOULDER_BASE_RADIUS = 90;

/** Default wall thickness (world units) when none is supplied. */
const DEFAULT_THICKNESS = 10;
/** Default door-gap width (world units) on the south wall when none is supplied. */
const DEFAULT_DOOR_WIDTH = 48;

/**
 * The player's collision radius (world units), shared so the server and predictor agree exactly.
 * A move resolves the player as a circle of this radius against solid walls.
 */
export const PLAYER_COLLISION_RADIUS = 13;
/** Door gap used for house walls — generous enough to walk through with the player radius. */
const HOUSE_DOOR_WIDTH = 72;

/**
 * Build the solid wall rectangles for an area from its decor. Only `house` props are solid: each
 * house footprint `(x,y)→(x2,y2)` becomes walls with a centered south door gap. Both the server sim
 * and the client predictor call this with the SAME decor (from the content packet), so they collide
 * against identical geometry — the prerequisite for no rubber-banding.
 */
export function wallsForDecor(decor: readonly DecorProp[]): Rect[] {
  return [...blockersForDecor(decor).rects];
}

/** Footprint (min/max corners) of a decor prop that carries an `(x,y)→(x2,y2)` rect, else undefined. */
function footprintOf(d: DecorProp): Footprint | undefined {
  if (d.x2 === undefined || d.y2 === undefined) return undefined;
  return {
    minX: Math.min(d.x, d.x2),
    minY: Math.min(d.y, d.y2),
    maxX: Math.max(d.x, d.x2),
    maxY: Math.max(d.y, d.y2),
  };
}

/**
 * Build the full solid geometry (rects + circles) for an area from its decor — the single source of
 * truth both the server sim and the client predictor collide against (so they never disagree). Solid
 * kinds:
 *  - `house`  → walls with a centered south door gap (existing behavior).
 *  - `cliff` / `ridge` / `barrier` / `wall` → a solid RECT from the footprint (tall cliff faces,
 *    ledges, and invisible chokepoint barriers; the navigable PATHS are simply the gaps between them).
 *  - `mountain` / `boulder` / `peak` → a solid CIRCLE you slide around: from the footprint's inscribed
 *    circle when one is given, else a radius scaled from the prop's `scale` (default scale 1).
 * Every other decor kind is non-solid (purely decorative), exactly as before.
 */
export function blockersForDecor(decor: readonly DecorProp[]): Blockers {
  const rects: Rect[] = [];
  const circles: Circle[] = [];
  for (const d of decor) {
    if (d.kind === 'house') {
      const foot = footprintOf(d);
      if (foot) rects.push(...houseWalls(foot, { doorWidth: HOUSE_DOOR_WIDTH }));
    } else if (RECT_SOLID_KINDS.has(d.kind)) {
      const foot = footprintOf(d);
      if (foot)
        rects.push({
          x: foot.minX,
          y: foot.minY,
          w: foot.maxX - foot.minX,
          h: foot.maxY - foot.minY,
        });
    } else if (CIRCLE_SOLID_KINDS.has(d.kind)) {
      const foot = footprintOf(d);
      if (foot) {
        // Inscribed circle of the footprint (centered; radius = the smaller half-extent).
        circles.push({
          cx: (foot.minX + foot.maxX) / 2,
          cy: (foot.minY + foot.maxY) / 2,
          r: Math.min(foot.maxX - foot.minX, foot.maxY - foot.minY) / 2,
        });
      } else {
        circles.push({ cx: d.x, cy: d.y, r: BOULDER_BASE_RADIUS * (d.scale ?? 1) });
      }
    }
  }
  return { rects, circles };
}

/**
 * Axis-aligned, inclusive point-in-rect test. (Also exported from areas.ts; re-exported here so
 * collision consumers do not need to reach into the areas module for this primitive.)
 */
export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

/**
 * Solid wall rectangles for a rectangular house footprint.
 *
 * The north (min-y), west (min-x), and east (max-x) edges become full-length thin walls of the
 * given `thickness`. The SOUTH (max-y) edge is split into TWO segments around a centered door gap
 * of width `doorWidth`, so a player can walk in and out through the gap. Each wall is inset so it
 * sits ON the footprint boundary (its outer face flush with the edge), keeping the solid mass
 * inside the footprint rather than spilling outward.
 *
 * If `doorWidth` is at least the south edge's length there is no room for a wall on either side,
 * so the south wall is omitted entirely (north/west/east only).
 */
export function houseWalls(
  foot: Footprint,
  opts?: { thickness?: number; doorWidth?: number },
): Rect[] {
  const thickness = opts?.thickness ?? DEFAULT_THICKNESS;
  const doorWidth = opts?.doorWidth ?? DEFAULT_DOOR_WIDTH;

  const { minX, minY, maxX, maxY } = foot;
  const width = maxX - minX;
  const height = maxY - minY;

  const walls: Rect[] = [];

  // North wall: full top edge, inset downward so it lies inside the footprint.
  walls.push({ x: minX, y: minY, w: width, h: thickness });

  // West and east walls span the full height. They overlap the north (and south) wall corners,
  // which is fine — overlapping solids resolve identically to a single welded solid.
  walls.push({ x: minX, y: minY, w: thickness, h: height });
  walls.push({ x: maxX - thickness, y: minY, w: thickness, h: height });

  // South wall: split into two segments around a centered door gap. If the gap is as wide as the
  // edge (or wider), there is no wall to draw on either side — leave the south open.
  if (doorWidth < width) {
    const gapHalf = doorWidth / 2;
    const centerX = minX + width / 2;
    const gapLeft = centerX - gapHalf;
    const gapRight = centerX + gapHalf;
    const wallTop = maxY - thickness;

    // Left segment: from the west edge to the left side of the door gap.
    walls.push({ x: minX, y: wallTop, w: gapLeft - minX, h: thickness });
    // Right segment: from the right side of the door gap to the east edge.
    walls.push({ x: gapRight, y: wallTop, w: maxX - gapRight, h: thickness });
  }

  return walls;
}

/**
 * Resolve a desired move of a circle (the player) against a set of solid rectangles using
 * AXIS-SEPARATED sliding — the classic platformer/top-down approach that lets a body slide along
 * a wall instead of sticking to it.
 *
 * The circle is treated as an axis-aligned box of half-extent `radius` for the overlap test. That
 * is a slight over-approximation at corners, but it is cheap, stable, and more than accurate enough
 * for the thin walls this resolves against — and, crucially, it is identical on server and client.
 *
 * How it works:
 *   1. Move along X only. If the body's box now overlaps any rect, push it back out along X to the
 *      nearest face (left or right depending on travel direction). Repeat against every rect.
 *   2. Move along Y only, then resolve Y overlaps the same way.
 * Resolving one axis at a time is what produces sliding: a diagonal move into a vertical wall has
 * its X component cancelled but keeps its Y component, so the body slides along the wall.
 *
 * With no rects this is a no-op and returns the desired point exactly. A move that never touches a
 * rect also returns the desired point exactly (the resolution branches simply do not fire).
 */
export function resolveCircleMove(
  px: number,
  py: number,
  nx: number,
  ny: number,
  radius: number,
  rects: readonly Rect[],
  circles: readonly Circle[] = [],
): { x: number; y: number } {
  if (rects.length === 0 && circles.length === 0) {
    return { x: nx, y: ny };
  }

  // --- Axis 1: move along X, keeping the original Y, then resolve X-overlaps. ---
  let x = nx;
  const yDuringX = py;
  for (const r of rects) {
    if (boxOverlapsRect(x, yDuringX, radius, r)) {
      // Push out along X to whichever face we came from. Moving right (x > px) means we entered
      // through the rect's left face, so stop the body's right edge at that face; vice versa.
      if (x > px) {
        x = r.x - radius;
      } else if (x < px) {
        x = r.x + r.w + radius;
      }
    }
  }

  // --- Axis 2: move along Y, using the X we just resolved, then resolve Y-overlaps. ---
  let y = ny;
  for (const r of rects) {
    if (boxOverlapsRect(x, y, radius, r)) {
      if (y > py) {
        y = r.y - radius;
      } else if (y < py) {
        y = r.y + r.h + radius;
      }
    }
  }

  // --- Round terrain: push the body radially out of each solid circle it overlaps. ---
  // A radial push (not axis-separated) lets the body slide smoothly AROUND a boulder/mountain
  // instead of catching on it: each frame it is shoved to the circle's surface along the
  // center-to-center line, and the tangential part of the next move carries it around.
  for (const c of circles) {
    const dx = x - c.cx;
    const dy = y - c.cy;
    const minDist = radius + c.r;
    const distSq = dx * dx + dy * dy;
    if (distSq >= minDist * minDist) continue; // outside (or just touching) → no push
    if (distSq > 0) {
      const dist = Math.sqrt(distSq);
      x = c.cx + (dx / dist) * minDist;
      y = c.cy + (dy / dist) * minDist;
    } else {
      // Dead-center (no direction from the new point): shove back toward where the body CAME from,
      // so a head-on move bounces back the way it came rather than teleporting out the far side.
      // If the previous point is also the center (truly degenerate), fall back to +x — never NaN.
      let bx = px - c.cx;
      let by = py - c.cy;
      const bl = Math.hypot(bx, by);
      if (bl === 0) {
        bx = 1;
        by = 0;
      }
      const blen = bl === 0 ? 1 : bl;
      x = c.cx + (bx / blen) * minDist;
      y = c.cy + (by / blen) * minDist;
    }
  }

  return { x, y };
}

/**
 * True if a box of half-extent `radius` centered at (cx,cy) overlaps rect `r`. Uses strict
 * inequalities so that merely touching (body face flush against the wall surface) does not count
 * as a collision — that is exactly the resting state we push bodies to, and it must be stable.
 */
function boxOverlapsRect(cx: number, cy: number, radius: number, r: Rect): boolean {
  return (
    cx + radius > r.x && cx - radius < r.x + r.w && cy + radius > r.y && cy - radius < r.y + r.h
  );
}

/**
 * Separate two overlapping circles by pushing EACH half the minimum translation vector apart
 * along the line between their centers (the arcade-solver split: mtv * 0.5 per body, so the pair
 * resolves symmetrically and total displacement equals exactly the overlap).
 *
 * Boundary behavior:
 *  - Non-overlapping OR exactly touching (distance === radiusA + radiusB) returns the inputs
 *    unchanged — touching is the stable resting state, same convention as boxOverlapsRect.
 *  - Exactly-coincident centers have no direction, so the push happens along a fixed +x axis
 *    (A goes -x, B goes +x). This keeps the result finite and deterministic — never NaN.
 */
export function separateCircles(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radiusA: number,
  radiusB: number,
): { ax: number; ay: number; bx: number; by: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const distSq = dx * dx + dy * dy;
  const minDist = radiusA + radiusB;
  if (distSq >= minDist * minDist) {
    return { ax, ay, bx, by };
  }

  const dist = Math.sqrt(distSq);
  // Unit direction from A toward B; coincident centers fall back to the fixed +x axis.
  let nx = 1;
  let ny = 0;
  if (dist > 0) {
    nx = dx / dist;
    ny = dy / dist;
  }

  const half = (minDist - dist) / 2;
  return {
    ax: ax - nx * half,
    ay: ay - ny * half,
    bx: bx + nx * half,
    by: by + ny * half,
  };
}

/**
 * True if the segment (x1,y1)→(x2,y2) crosses the axis-aligned rect, or either endpoint lies
 * inside it. Implemented with Liang-Barsky slab clipping: clip the segment's parameter interval
 * [0,1] against each of the rect's four half-planes; the segment intersects iff the interval
 * survives non-empty.
 *
 * Boundary behavior is INCLUSIVE: a segment that merely touches an edge or corner, or runs
 * collinear along an edge, counts as intersecting. A degenerate zero-length segment reduces to an
 * inclusive point-in-rect test. (Projectile wall-stops want the generous reading: grazing a wall
 * is a hit, not a pass-through.)
 */
export function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: Rect,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;

  // Clip [t0,t1] against one half-plane (p·t <= q form). Returns false once the interval empties.
  const clip = (p: number, q: number): boolean => {
    if (p === 0) {
      // Segment parallel to this boundary: inside the half-plane iff q >= 0 (inclusive).
      return q >= 0;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };

  return (
    clip(-dx, x1 - rect.x) && // left   boundary: x >= rect.x
    clip(dx, rect.x + rect.w - x1) && // right  boundary: x <= rect.x + w
    clip(-dy, y1 - rect.y) && // top    boundary: y >= rect.y
    clip(dy, rect.y + rect.h - y1) // bottom boundary: y <= rect.y + h
  );
}

/**
 * True if the point lies inside (or on the edge of) ANY of the given rects. Convenience for
 * projectile wall-stop checks; same inclusive boundary as pointInRect.
 */
export function pointInAnyRect(x: number, y: number, rects: readonly Rect[]): boolean {
  for (const r of rects) {
    if (pointInRect(x, y, r)) return true;
  }
  return false;
}

/** Inclusive point-in-circle test (on the rim counts as inside, matching pointInRect's convention). */
export function pointInCircle(x: number, y: number, c: Circle): boolean {
  const dx = x - c.cx;
  const dy = y - c.cy;
  return dx * dx + dy * dy <= c.r * c.r;
}

/** True if the point is inside ANY solid blocker (rect or circle) — e.g. a projectile hitting terrain. */
export function pointInAnyBlocker(x: number, y: number, blockers: Blockers): boolean {
  if (pointInAnyRect(x, y, blockers.rects)) return true;
  for (const c of blockers.circles) {
    if (pointInCircle(x, y, c)) return true;
  }
  return false;
}
