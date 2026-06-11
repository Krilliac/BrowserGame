import { describe, expect, it } from 'vitest';
import { clampPanelRect, fitsInViewport, type Rect, type Viewport } from './ui-guard.js';

const VIEW: Viewport = { w: 800, h: 600 };

describe('fitsInViewport', () => {
  it('accepts a panel fully inside', () => {
    expect(fitsInViewport({ x: 10, y: 10, w: 100, h: 100 }, VIEW)).toBe(true);
  });

  it('accepts a panel touching the far edge exactly', () => {
    expect(fitsInViewport({ x: 700, y: 500, w: 100, h: 100 }, VIEW)).toBe(true);
  });

  it('rejects a panel running off the right edge', () => {
    expect(fitsInViewport({ x: 750, y: 10, w: 100, h: 100 }, VIEW)).toBe(false);
  });

  it('rejects a negative origin', () => {
    expect(fitsInViewport({ x: -5, y: 10, w: 100, h: 100 }, VIEW)).toBe(false);
  });
});

describe('clampPanelRect', () => {
  const margin = 8;

  it('leaves an already-fitting panel unchanged', () => {
    const rect: Rect = { x: 100, y: 100, w: 200, h: 150 };
    expect(clampPanelRect(rect, VIEW, margin)).toEqual(rect);
  });

  it('pulls a panel off the right edge back inside', () => {
    const out = clampPanelRect({ x: 750, y: 100, w: 200, h: 150 }, VIEW, margin);
    expect(out.x + out.w).toBeLessThanOrEqual(VIEW.w - margin);
    expect(out.x).toBe(VIEW.w - margin - 200);
    expect(out.w).toBe(200);
    expect(fitsInViewport(out, VIEW)).toBe(true);
  });

  it('pulls a panel off the bottom edge back inside', () => {
    const out = clampPanelRect({ x: 100, y: 580, w: 200, h: 150 }, VIEW, margin);
    expect(out.y + out.h).toBeLessThanOrEqual(VIEW.h - margin);
    expect(fitsInViewport(out, VIEW)).toBe(true);
  });

  it('pushes a panel off the top-left to the margin', () => {
    const out = clampPanelRect({ x: -50, y: -30, w: 200, h: 150 }, VIEW, margin);
    expect(out.x).toBe(margin);
    expect(out.y).toBe(margin);
    expect(fitsInViewport(out, VIEW)).toBe(true);
  });

  it('shrinks a panel wider than the viewport to fit within the margins', () => {
    const out = clampPanelRect({ x: 0, y: 0, w: 2000, h: 150 }, VIEW, margin);
    expect(out.w).toBe(VIEW.w - margin * 2);
    expect(out.x).toBe(margin);
    expect(fitsInViewport(out, VIEW)).toBe(true);
  });

  it('shrinks a panel taller than the viewport to fit within the margins', () => {
    const out = clampPanelRect({ x: 0, y: 0, w: 200, h: 5000 }, VIEW, margin);
    expect(out.h).toBe(VIEW.h - margin * 2);
    expect(fitsInViewport(out, VIEW)).toBe(true);
  });

  it('shrinks a panel larger than the viewport on both axes (the spell-merchant case)', () => {
    const out = clampPanelRect({ x: 600, y: 500, w: 1200, h: 900 }, VIEW, margin);
    expect(fitsInViewport(out, VIEW)).toBe(true);
    expect(out.w).toBe(VIEW.w - margin * 2);
    expect(out.h).toBe(VIEW.h - margin * 2);
  });

  it('never returns a negative size or origin on a degenerate viewport', () => {
    const out = clampPanelRect({ x: -100, y: -100, w: 200, h: 200 }, { w: 10, h: 10 }, margin);
    expect(out.w).toBeGreaterThanOrEqual(0);
    expect(out.h).toBeGreaterThanOrEqual(0);
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.y).toBeGreaterThanOrEqual(0);
  });

  it('defaults the margin to 8 when omitted', () => {
    const out = clampPanelRect({ x: 0, y: 0, w: 2000, h: 2000 }, VIEW);
    expect(out.x).toBe(8);
    expect(out.y).toBe(8);
  });
});
