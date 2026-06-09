/** Anything the grid can index: a stable id plus a world position. */
export interface Positioned {
  id: number;
  x: number;
  y: number;
}

/** A uniform spatial hash grid for fast neighborhood queries. Rebuilt each tick. */
export class SpatialGrid<T extends Positioned> {
  private readonly cellSize: number;
  private readonly cells = new Map<string, T[]>();
  private count = 0;

  constructor(cellSize: number) {
    // Guard against a degenerate cell size that would break floor(x / cell).
    this.cellSize = cellSize > 0 ? cellSize : 1;
  }

  /** Remove all items. */
  clear(): void {
    this.cells.clear();
    this.count = 0;
  }

  /** Insert/index an item at its current x,y. */
  insert(item: T): void {
    const key = this.cellKey(item.x, item.y);
    const bucket = this.cells.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      this.cells.set(key, [item]);
    }
    this.count += 1;
  }

  /** All inserted items whose position lies within the axis-aligned box centered at (cx,cy). */
  queryRect(cx: number, cy: number, halfW: number, halfH: number): T[] {
    const minX = cx - halfW;
    const maxX = cx + halfW;
    const minY = cy - halfH;
    const maxY = cy + halfH;
    const found: T[] = [];

    for (const item of this.candidates(minX, minY, maxX, maxY)) {
      if (item.x >= minX && item.x <= maxX && item.y >= minY && item.y <= maxY) {
        found.push(item);
      }
    }
    return found;
  }

  /** All inserted items within Euclidean distance `radius` of (cx,cy). */
  queryRadius(cx: number, cy: number, radius: number): T[] {
    const r2 = radius * radius;
    const found: T[] = [];

    for (const item of this.candidates(cx - radius, cy - radius, cx + radius, cy + radius)) {
      const dx = item.x - cx;
      const dy = item.y - cy;
      if (dx * dx + dy * dy <= r2) {
        found.push(item);
      }
    }
    return found;
  }

  /** Total inserted item count. */
  get size(): number {
    return this.count;
  }

  /** Yield every item in the cells overlapping the given world-space box. */
  private *candidates(minX: number, minY: number, maxX: number, maxY: number): Iterable<T> {
    const minCellX = Math.floor(minX / this.cellSize);
    const maxCellX = Math.floor(maxX / this.cellSize);
    const minCellY = Math.floor(minY / this.cellSize);
    const maxCellY = Math.floor(maxY / this.cellSize);

    for (let gx = minCellX; gx <= maxCellX; gx++) {
      for (let gy = minCellY; gy <= maxCellY; gy++) {
        const bucket = this.cells.get(`${gx},${gy}`);
        if (bucket) yield* bucket;
      }
    }
  }

  /** Bucket key for a world position. */
  private cellKey(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }
}
