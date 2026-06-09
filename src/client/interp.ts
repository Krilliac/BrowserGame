import { lerp } from '../shared/math.js';
import type { EntityState } from '../shared/protocol.js';

/**
 * Render the world a fixed delay in the past and interpolate between the two snapshots
 * that bracket that render time. This turns a 20Hz stream of authoritative snapshots into
 * smooth on-screen motion — the standard MMO trick (cf. SparkEngine's InterpolationBuffer).
 */
export const INTERP_DELAY_MS = 100;

interface TimedSnapshot {
  time: number; // client receipt time, ms
  entities: EntityState[];
}

export class SnapshotBuffer {
  private readonly buffer: TimedSnapshot[] = [];
  private static readonly MAX = 30;

  push(entities: EntityState[], time: number): void {
    this.buffer.push({ time, entities });
    if (this.buffer.length > SnapshotBuffer.MAX) this.buffer.shift();
  }

  /** Interpolated entity states at `renderTime`, clamped to the latest snapshot at the edges. */
  sample(renderTime: number): EntityState[] {
    if (this.buffer.length === 0) return [];
    const latest = this.buffer[this.buffer.length - 1]!;
    if (this.buffer.length === 1) return latest.entities;

    for (let i = 0; i < this.buffer.length - 1; i++) {
      const older = this.buffer[i]!;
      const newer = this.buffer[i + 1]!;
      if (older.time <= renderTime && renderTime <= newer.time) {
        const span = newer.time - older.time;
        const t = span > 0 ? (renderTime - older.time) / span : 0;
        return interpolate(older.entities, newer.entities, t);
      }
    }
    // renderTime is outside the buffered window → show the freshest data we have.
    return latest.entities;
  }
}

export function interpolate(a: EntityState[], b: EntityState[], t: number): EntityState[] {
  const newById = new Map(b.map((e) => [e.id, e]));
  const out: EntityState[] = [];
  for (const from of a) {
    const to = newById.get(from.id);
    if (!to) continue; // entity left between snapshots — drop it
    out.push({ ...to, x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) });
  }
  return out;
}
