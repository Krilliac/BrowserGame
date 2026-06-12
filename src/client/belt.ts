/**
 * The potion belt: two quick-use action slots — health (left) and mana (right) — that sit at the
 * bottom-center of the screen, just to the left of the spell hotbar so they read as part of the
 * action bar. Each slot shows a procedural potion-flask icon, the carried count, and its hotkey.
 * Pure Canvas2D rendering matching the rest of the HUD (gold accent, system-ui font); it owns no
 * state beyond the passed `hud` context. Layout lives in `beltSlotRects` so it can be unit-tested
 * (and later reused for click-to-use on touch).
 */

import type { Rect } from '../shared/areas.js';

export interface BeltView {
  health: number;
  mana: number;
  healthKey: string;
  manaKey: string;
  healthReady: boolean;
  manaReady: boolean;
}

const SLOT = 44; // slot square size in px
const SLOT_GAP = 6; // gap between the two belt slots
const HOTBAR_GAP = 10; // gap between the belt and the (centered) hotbar's left edge

// The centered hotbar is 6 slots of 52px with 10px gaps (see main.ts). We mirror its half-width
// here so the belt can anchor to the hotbar's left edge using only the viewport, keeping this
// module free of any shared mutable HUD state.
const HOTBAR_SLOT = 52;
const HOTBAR_GAP_INNER = 10;
const HOTBAR_COUNT = 6;
const HOTBAR_HALF_W = (HOTBAR_COUNT * HOTBAR_SLOT + (HOTBAR_COUNT - 1) * HOTBAR_GAP_INNER) / 2;

/**
 * Compute the two belt slot rectangles for a viewport. The mana slot's right edge sits
 * `HOTBAR_GAP` px left of the hotbar's left edge; the health slot sits one slot+gap further left.
 * Both slots share the hotbar's vertical band near the bottom of the screen.
 */
export function beltSlotRects(viewport: { w: number; h: number }): {
  health: Rect;
  mana: Rect;
} {
  const hotbarLeft = viewport.w / 2 - HOTBAR_HALF_W;
  const manaX = hotbarLeft - HOTBAR_GAP - SLOT;
  const healthX = manaX - SLOT_GAP - SLOT;
  const y = viewport.h - 64; // align with the hotbar's slot band (slotsY = h - 64 in main.ts)

  return {
    health: { x: healthX, y, w: SLOT, h: SLOT },
    mana: { x: manaX, y, w: SLOT, h: SLOT },
  };
}

/**
 * Draw the potion belt: a health flask (red) and a mana flask (blue), each with its carried count
 * and hotkey. Empty slots dim; slots whose readiness flag is false get a dark "recharging" overlay.
 */
export function drawBelt(
  hud: CanvasRenderingContext2D,
  viewport: { w: number; h: number },
  belt: BeltView,
): void {
  const rects = beltSlotRects(viewport);
  drawSlot(hud, rects.health, '#d23b3b', '#f08a8a', belt.health, belt.healthKey, belt.healthReady);
  drawSlot(hud, rects.mana, '#3b6fd2', '#7fa3ec', belt.mana, belt.manaKey, belt.manaReady);
}

/** Draw a single belt slot: panel, potion icon, count, hotkey caption, and cooldown overlay. */
function drawSlot(
  hud: CanvasRenderingContext2D,
  rect: Rect,
  color: string,
  highlight: string,
  count: number,
  key: string,
  ready: boolean,
): void {
  const empty = count <= 0;
  hud.save();
  // Empty slots read as "nothing to drink" by fading the whole slot.
  hud.globalAlpha = empty ? 0.4 : 1;

  // Rounded translucent dark panel.
  roundRect(hud, rect.x, rect.y, rect.w, rect.h, 7);
  hud.fillStyle = 'rgba(8,9,13,0.78)';
  hud.fill();
  hud.strokeStyle = '#c9a24b';
  hud.lineWidth = 1.5;
  hud.stroke();

  drawFlask(hud, rect, color, highlight);

  // Carried count, bold in the bottom-right corner.
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 13px system-ui, sans-serif';
  hud.textAlign = 'right';
  hud.textBaseline = 'alphabetic';
  hud.fillText(String(count), rect.x + rect.w - 4, rect.y + rect.h - 4);

  // Hotkey caption, small, in the top-left corner with the gold accent.
  hud.fillStyle = '#c9a24b';
  hud.font = 'bold 10px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText(key, rect.x + 4, rect.y + 12);

  // Cooldown: a subtle dark wash signals the potion is still recharging.
  if (!ready) {
    roundRect(hud, rect.x, rect.y, rect.w, rect.h, 7);
    hud.fillStyle = 'rgba(0,0,0,0.5)';
    hud.fill();
  }

  hud.restore();
}

/** Draw a simple potion-flask shape (round-bottomed body + neck + cork) centered in `rect`. */
function drawFlask(
  hud: CanvasRenderingContext2D,
  rect: Rect,
  color: string,
  highlight: string,
): void {
  const cx = rect.x + rect.w / 2;
  const bodyR = rect.w * 0.24;
  const bodyCy = rect.y + rect.h * 0.58;
  const neckW = rect.w * 0.14;
  const neckTop = rect.y + rect.h * 0.22;
  const neckBottom = bodyCy - bodyR * 0.55;

  // Body (round flask).
  hud.beginPath();
  hud.arc(cx, bodyCy, bodyR, 0, Math.PI * 2);
  hud.fillStyle = color;
  hud.fill();

  // Neck (a slim rectangle rising from the body).
  hud.fillRect(cx - neckW / 2, neckTop, neckW, neckBottom - neckTop);

  // Cork on top of the neck.
  hud.fillStyle = '#caa46a';
  hud.fillRect(cx - neckW * 0.7, neckTop - rect.h * 0.06, neckW * 1.4, rect.h * 0.06);

  // Glossy highlight on the body so the potion reads as glass.
  hud.beginPath();
  hud.arc(cx - bodyR * 0.35, bodyCy - bodyR * 0.35, bodyR * 0.35, 0, Math.PI * 2);
  hud.fillStyle = highlight;
  hud.fill();
}

/** Trace a rounded rectangle path (caller fills/strokes). */
function roundRect(
  hud: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  hud.beginPath();
  hud.moveTo(x + rr, y);
  hud.arcTo(x + w, y, x + w, y + h, rr);
  hud.arcTo(x + w, y + h, x, y + h, rr);
  hud.arcTo(x, y + h, x, y, rr);
  hud.arcTo(x, y, x + w, y, rr);
  hud.closePath();
}
