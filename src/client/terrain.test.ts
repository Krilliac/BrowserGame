import { describe, expect, it } from 'vitest';
import { Terrain, areaHasTerrain, terrainHeightAt } from './terrain.js';

describe('areaHasTerrain (RENDER-08)', () => {
  it('flags wild areas and resolves instance ids; flat areas are false', () => {
    expect(areaHasTerrain('wilderness')).toBe(true);
    expect(areaHasTerrain('wilderness#3')).toBe(true);
    expect(areaHasTerrain('town')).toBe(false);
    expect(areaHasTerrain('crypt')).toBe(false);
  });
});

describe('terrainHeightAt (RENDER-08)', () => {
  it('is deterministic and bounded to [0, HILL_HEIGHT]', () => {
    for (const [x, y] of [
      [0, 0],
      [137, 902],
      [-400, 250],
      [2400, 2000],
    ] as const) {
      const h = terrainHeightAt(x, y);
      expect(h).toBe(terrainHeightAt(x, y));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(38);
    }
  });

  it('is continuous — adjacent world points differ only slightly (smooth hills)', () => {
    let maxStep = 0;
    for (let x = 0; x < 2000; x += 50) {
      maxStep = Math.max(maxStep, Math.abs(terrainHeightAt(x, 500) - terrainHeightAt(x + 8, 500)));
    }
    expect(maxStep).toBeLessThan(3); // no cliffs from the smooth noise at this step
  });
});

describe('Terrain.hillshadeAt (RENDER-08)', () => {
  it('stays in the gentle multiply range [0.74, 1] and is deterministic', () => {
    for (const [x, y] of [
      [10, 10],
      [600, 350],
      [1234, 1700],
    ] as const) {
      const s = Terrain.hillshadeAt(x, y);
      expect(s).toBe(Terrain.hillshadeAt(x, y));
      expect(s).toBeGreaterThanOrEqual(0.74);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
