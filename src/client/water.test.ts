import { describe, expect, it } from 'vitest';
import { isOverWater, waterPondsFor, type Pond } from './water.js';

describe('waterPondsFor (RENDER-11)', () => {
  it('returns no ponds for areas without water', () => {
    expect(waterPondsFor('crypt', 1600, 1200)).toEqual([]);
    expect(waterPondsFor('mines', 2000, 2000)).toEqual([]);
  });

  it('gives a single centered pond to a "pond" area (town)', () => {
    const ponds = waterPondsFor('town', 1600, 1200);
    expect(ponds).toHaveLength(1);
    expect(ponds[0]!.cx).toBeCloseTo(800, 5);
    expect(ponds[0]!.rx).toBeGreaterThan(0);
  });

  it('scatters several ponds across a wetland, all inside the map bounds', () => {
    const w = 2400;
    const h = 2000;
    const ponds = waterPondsFor('wilderness', w, h);
    expect(ponds.length).toBeGreaterThan(1);
    for (const p of ponds) {
      expect(p.cx).toBeGreaterThan(0);
      expect(p.cx).toBeLessThan(w);
      expect(p.cy).toBeGreaterThan(0);
      expect(p.cy).toBeLessThan(h);
      expect(p.rx).toBeGreaterThan(0);
      expect(p.ry).toBeGreaterThan(0);
    }
  });

  it('is deterministic and resolves instance ids to the base area', () => {
    expect(waterPondsFor('marsh', 1800, 1800)).toEqual(waterPondsFor('marsh', 1800, 1800));
    expect(waterPondsFor('marsh#2', 1800, 1800)).toEqual(waterPondsFor('marsh', 1800, 1800));
  });
});

describe('isOverWater (RENDER-11)', () => {
  const ponds: Pond[] = [{ cx: 100, cy: 100, rx: 50, ry: 30 }];

  it('is true inside the ellipse, false outside', () => {
    expect(isOverWater(ponds, 100, 100)).toBe(true); // center
    expect(isOverWater(ponds, 145, 100)).toBe(true); // within rx
    expect(isOverWater(ponds, 100, 140)).toBe(false); // beyond ry (30)
    expect(isOverWater(ponds, 200, 100)).toBe(false); // well outside
  });

  it('honors the margin', () => {
    expect(isOverWater(ponds, 100, 138, 0)).toBe(false);
    expect(isOverWater(ponds, 100, 138, 20)).toBe(true); // margin expands the ellipse
  });
});
