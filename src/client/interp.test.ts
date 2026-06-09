import { describe, expect, it } from 'vitest';
import { SnapshotBuffer, interpolate } from './interp.js';
import type { EntityState } from '../shared/protocol.js';

function entity(id: number, x: number, y: number): EntityState {
  return { id, x, y, name: `e${id}`, hue: 0 };
}

describe('interpolate', () => {
  it('lerps positions of matching entities', () => {
    const a = [entity(1, 0, 0)];
    const b = [entity(1, 100, 50)];
    const [mid] = interpolate(a, b, 0.5);
    expect(mid?.x).toBe(50);
    expect(mid?.y).toBe(25);
  });

  it('drops entities that left between snapshots', () => {
    const a = [entity(1, 0, 0), entity(2, 0, 0)];
    const b = [entity(1, 10, 0)];
    const out = interpolate(a, b, 0.5);
    expect(out.map((e) => e.id)).toEqual([1]);
  });
});

describe('SnapshotBuffer', () => {
  it('returns the only snapshot when just one is buffered', () => {
    const buf = new SnapshotBuffer();
    buf.push([entity(1, 5, 5)], 1000);
    expect(buf.sample(999)[0]?.x).toBe(5);
  });

  it('interpolates between bracketing snapshots', () => {
    const buf = new SnapshotBuffer();
    buf.push([entity(1, 0, 0)], 1000);
    buf.push([entity(1, 200, 0)], 1100);
    const [e] = buf.sample(1050); // halfway
    expect(e?.x).toBeCloseTo(100, 5);
  });

  it('clamps to the latest snapshot beyond the buffered window', () => {
    const buf = new SnapshotBuffer();
    buf.push([entity(1, 0, 0)], 1000);
    buf.push([entity(1, 200, 0)], 1100);
    expect(buf.sample(5000)[0]?.x).toBe(200);
  });
});
