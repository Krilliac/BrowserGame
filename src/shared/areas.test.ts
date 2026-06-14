import { describe, expect, it } from 'vitest';
import { AREAS, DUNGEONS, areaOf, isDungeon, pointInRect, type Rect } from './areas.js';

describe('isDungeon', () => {
  it('is true for every dungeon id and false for fixed-spawn areas', () => {
    for (const id of Object.keys(DUNGEONS)) expect(isDungeon(id), id).toBe(true);
    for (const id of Object.keys(AREAS)) {
      if (id in DUNGEONS) continue; // some ids may exist in both maps; only assert the pure non-dungeons
      expect(isDungeon(id), id).toBe(false);
    }
  });

  it('is false for unknown ids', () => {
    expect(isDungeon('not_a_place')).toBe(false);
    expect(isDungeon('')).toBe(false);
  });
});

describe('areaOf', () => {
  it('returns the matching def (with consistent id) for every known area', () => {
    for (const id of Object.keys(AREAS)) {
      const def = areaOf(id);
      expect(def, id).toBeDefined();
      expect(def!.id, id).toBe(id);
      expect(def!.width).toBeGreaterThan(0);
      expect(def!.height).toBeGreaterThan(0);
    }
  });

  it('returns undefined for an unknown id', () => {
    expect(areaOf('nowhere')).toBeUndefined();
  });
});

describe('pointInRect', () => {
  const r: Rect = { x: 10, y: 20, w: 100, h: 50 };

  it('is true strictly inside', () => {
    expect(pointInRect(50, 40, r)).toBe(true);
  });

  it('is inclusive on every edge and corner', () => {
    expect(pointInRect(10, 20, r)).toBe(true); // NW corner
    expect(pointInRect(110, 70, r)).toBe(true); // SE corner (x+w, y+h)
    expect(pointInRect(10, 45, r)).toBe(true); // left edge
    expect(pointInRect(110, 45, r)).toBe(true); // right edge
    expect(pointInRect(60, 20, r)).toBe(true); // top edge
    expect(pointInRect(60, 70, r)).toBe(true); // bottom edge
  });

  it('is false just outside any edge', () => {
    expect(pointInRect(9.99, 40, r)).toBe(false);
    expect(pointInRect(110.01, 40, r)).toBe(false);
    expect(pointInRect(60, 19.99, r)).toBe(false);
    expect(pointInRect(60, 70.01, r)).toBe(false);
  });
});
