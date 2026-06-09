import { describe, expect, it } from 'vitest';
import { SpatialGrid, type Positioned } from './spatial.js';

const pt = (id: number, x: number, y: number): Positioned => ({ id, x, y });

const ids = (items: Positioned[]): number[] => items.map((i) => i.id).sort((a, b) => a - b);

describe('SpatialGrid (interest management)', () => {
  it('returns only items inside a small query box', () => {
    const grid = new SpatialGrid<Positioned>(10);
    grid.insert(pt(1, 5, 5)); // inside
    grid.insert(pt(2, 9, 9)); // inside
    grid.insert(pt(3, 50, 50)); // far away
    const found = grid.queryRect(5, 5, 5, 5); // box [0,10] x [0,10]
    expect(ids(found)).toEqual([1, 2]);
  });

  it('respects Euclidean distance: item just inside vs just outside', () => {
    const grid = new SpatialGrid<Positioned>(4);
    grid.insert(pt(1, 3, 0)); // distance 3 from origin -> inside radius 3
    grid.insert(pt(2, 0, 4)); // distance 4 from origin -> outside radius 3
    const found = grid.queryRadius(0, 0, 3);
    expect(ids(found)).toEqual([1]);
  });

  it('returns [] when querying an empty grid', () => {
    const grid = new SpatialGrid<Positioned>(8);
    expect(grid.queryRect(0, 0, 100, 100)).toEqual([]);
    expect(grid.queryRadius(0, 0, 100)).toEqual([]);
  });

  it('finds items spanning multiple cells when the box covers them', () => {
    const grid = new SpatialGrid<Positioned>(5);
    grid.insert(pt(1, 1, 1)); // cell 0,0
    grid.insert(pt(2, 7, 1)); // cell 1,0
    grid.insert(pt(3, 1, 7)); // cell 0,1
    grid.insert(pt(4, 7, 7)); // cell 1,1
    const found = grid.queryRect(4, 4, 4, 4); // box [0,8] x [0,8] spans 2x2 cells
    expect(ids(found)).toEqual([1, 2, 3, 4]);
  });

  it('reflects inserts in size', () => {
    const grid = new SpatialGrid<Positioned>(10);
    expect(grid.size).toBe(0);
    grid.insert(pt(1, 0, 0));
    grid.insert(pt(2, 100, 100));
    expect(grid.size).toBe(2);
    grid.clear();
    expect(grid.size).toBe(0);
  });

  it('returns everything for a large query box', () => {
    const grid = new SpatialGrid<Positioned>(16);
    grid.insert(pt(1, -50, -50));
    grid.insert(pt(2, 0, 0));
    grid.insert(pt(3, 80, 80));
    const found = grid.queryRect(0, 0, 1000, 1000);
    expect(ids(found)).toEqual([1, 2, 3]);
  });

  it('falls back to a usable cell size when given a non-positive one', () => {
    const grid = new SpatialGrid<Positioned>(0);
    grid.insert(pt(1, 2, 2));
    expect(ids(grid.queryRect(2, 2, 1, 1))).toEqual([1]);
  });
});
