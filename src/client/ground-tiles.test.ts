import { describe, expect, it } from 'vitest';
import { AREAS, AREA_THEMES } from '../shared/areas.js';
import {
  GROUND_TILESETS,
  groundTilesetFor,
  patchCoverage,
  patchTileFor,
  pickTile,
  valueNoise,
  type GroundTileset,
} from './ground-tiles.js';

describe('GROUND_TILESETS', () => {
  it('every tileset is a curated sheet with sane, positively-weighted tiles', () => {
    for (const [key, ts] of Object.entries(GROUND_TILESETS)) {
      expect(ts.src, key).toMatch(/^\/assets\/curated\/tiles\/[a-z_]+\.png$/);
      expect([16, 32], key).toContain(ts.tileSize);
      expect(ts.tiles.length, key).toBeGreaterThan(0);
      for (const t of ts.tiles) {
        expect(Number.isInteger(t.col) && t.col >= 0, `${key} col`).toBe(true);
        expect(Number.isInteger(t.row) && t.row >= 0, `${key} row`).toBe(true);
        expect(t.weight, `${key} weight`).toBeGreaterThan(0);
      }
    }
  });
});

describe('groundTilesetFor', () => {
  it('maps every area seeded in shared/areas.ts', () => {
    for (const id of Object.keys(AREAS)) {
      const groundBase = AREA_THEMES[id]?.groundBase ?? '#000000';
      expect(groundTilesetFor(id, groundBase), id).toBeDefined();
    }
  });

  it('accepts instance ids (areaId#seq) and resolves them to the base area', () => {
    expect(groundTilesetFor('crypt#3', '#16161c')).toBe(groundTilesetFor('crypt', '#16161c'));
    expect(groundTilesetFor('town#12', '#2f3b29')).toBe(GROUND_TILESETS['meadow']); // town → generated meadow
  });

  it('classifies unknown areas coarsely from their ground color', () => {
    expect(groundTilesetFor('new_glade', '#2f4f2f')).toBe(GROUND_TILESETS['forest']);
    expect(groundTilesetFor('new_tundra', '#dde6f0')).toBe(GROUND_TILESETS['frost']);
    expect(groundTilesetFor('new_abyss', '#1a1210')).toBeUndefined();
    expect(groundTilesetFor('new_broken', 'not-a-color')).toBeUndefined();
  });
});

describe('pickTile', () => {
  const town = GROUND_TILESETS['town']!;

  it('is deterministic for the same cell', () => {
    for (const [gx, gy] of [
      [0, 0],
      [7, 3],
      [-4, 9],
      [123, 456],
    ] as const) {
      expect(pickTile(town, gx, gy)).toEqual(pickTile(town, gx, gy));
    }
  });

  it('only returns tiles from the set', () => {
    const allowed = new Set(town.tiles.map((t) => `${t.col},${t.row}`));
    for (let gx = 0; gx < 20; gx++) {
      for (let gy = 0; gy < 20; gy++) {
        const { col, row } = pickTile(town, gx, gy);
        expect(allowed.has(`${col},${row}`)).toBe(true);
      }
    }
  });

  it('roughly honors weights (90/10 split lands near 10% rare)', () => {
    const ts: GroundTileset = {
      src: '/assets/curated/tiles/forest_spring.png',
      tileSize: 16,
      tiles: [
        { col: 0, row: 0, weight: 90 },
        { col: 1, row: 0, weight: 10 },
      ],
    };
    let rare = 0;
    const n = 100;
    for (let gx = 0; gx < n; gx++) {
      for (let gy = 0; gy < n; gy++) {
        if (pickTile(ts, gx, gy).col === 1) rare++;
      }
    }
    const share = rare / (n * n);
    expect(share).toBeGreaterThan(0.07);
    expect(share).toBeLessThan(0.13);
  });

  it('lets the plain base tile dominate a real biome (mine ≈ 70% blank floor)', () => {
    const mine = GROUND_TILESETS['mine']!;
    let base = 0;
    const n = 100;
    for (let gx = 0; gx < n; gx++) {
      for (let gy = 0; gy < n; gy++) {
        const t = pickTile(mine, gx, gy);
        if (t.col === 0 && t.row === 11) base++;
      }
    }
    const share = base / (n * n);
    expect(share).toBeGreaterThan(0.65);
    expect(share).toBeLessThan(0.75);
  });
});

describe('valueNoise (RENDER-04)', () => {
  it('is deterministic and within [0, 1)', () => {
    for (const [gx, gy] of [
      [0, 0],
      [3, 9],
      [-7, 4],
      [200, 50],
    ] as const) {
      const a = valueNoise(gx, gy, 6);
      expect(a).toBe(valueNoise(gx, gy, 6));
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('is spatially smooth — adjacent cells differ far less than raw white noise would', () => {
    let sum = 0;
    let count = 0;
    for (let gx = 0; gx < 40; gx++) {
      for (let gy = 0; gy < 40; gy++) {
        sum += Math.abs(valueNoise(gx, gy, 6) - valueNoise(gx + 1, gy, 6));
        count++;
      }
    }
    // White noise neighbors average ~0.33 apart; interpolated noise should be well under that.
    expect(sum / count).toBeLessThan(0.12);
  });
});

describe('patchCoverage / patchTileFor (RENDER-04)', () => {
  it('returns 0 coverage and no patch tile for un-annotated tilesets (regression guard)', () => {
    const mine = GROUND_TILESETS['mine']!;
    expect(mine.blend).toBeUndefined();
    for (let gx = 0; gx < 16; gx++) {
      for (let gy = 0; gy < 16; gy++) {
        expect(patchCoverage(mine, gx, gy)).toBe(0);
        expect(patchTileFor(mine, gx, gy)).toBeUndefined();
      }
    }
  });

  it('coverage stays in [0, 1], is deterministic, and clusters into contiguous patches', () => {
    const town = GROUND_TILESETS['town']!;
    expect(town.blend).toBeDefined();
    let covered = 0;
    let edgeRuns = 0; // transitions base↔patch along rows — fewer means bigger, coherent blobs
    const N = 32;
    let prev = false;
    for (let gy = 0; gy < N; gy++) {
      prev = false;
      for (let gx = 0; gx < N; gx++) {
        const c = patchCoverage(town, gx, gy);
        expect(c).toBe(patchCoverage(town, gx, gy));
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
        const inPatch = c > 0.5;
        if (inPatch) covered++;
        if (inPatch !== prev) edgeRuns++;
        prev = inPatch;
      }
    }
    const coverShare = covered / (N * N);
    expect(coverShare).toBeGreaterThan(0.05); // patches actually appear
    expect(coverShare).toBeLessThan(0.7); // but don't swallow the whole area
    // Lattice-scattered cells would flip base↔patch almost every step (~N*N transitions);
    // coherent blobs flip far less often.
    expect(edgeRuns).toBeLessThan(N * N * 0.4);
  });

  it('always picks a valid patch tile from the set when a tileset opts in', () => {
    for (const [k, ts] of Object.entries(GROUND_TILESETS)) {
      if (!ts.blend) continue;
      const allowed = new Set(ts.blend.patch.map((p) => `${p.col},${p.row}`));
      for (let gx = 0; gx < 12; gx++) {
        for (let gy = 0; gy < 12; gy++) {
          const pt = patchTileFor(ts, gx, gy);
          expect(pt, k).toBeDefined();
          expect(allowed.has(`${pt!.col},${pt!.row}`), k).toBe(true);
        }
      }
    }
  });
});
