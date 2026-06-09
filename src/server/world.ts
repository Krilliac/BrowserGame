import { clamp } from '../shared/math.js';
import {
  PLAYER_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type EntityState,
  type InputState,
} from '../shared/protocol.js';

/**
 * The authoritative simulation. Pure and framework-free so it is trivially testable
 * (see world.test.ts) and could later be compiled to WASM or moved to a worker.
 *
 * Echoes SparkEngine's server-authoritative model: inputs come in, the world advances
 * by a fixed dt, and a snapshot goes out. No client ever writes state directly.
 */
export class World {
  private nextId = 1;
  private readonly entities = new Map<number, EntityState>();
  private readonly inputs = new Map<number, InputState>();

  spawn(name: string): number {
    const id = this.nextId++;
    this.entities.set(id, {
      id,
      name: sanitizeName(name),
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
      hue: (id * 47) % 360,
    });
    this.inputs.set(id, { up: false, down: false, left: false, right: false });
    return id;
  }

  remove(id: number): void {
    this.entities.delete(id);
    this.inputs.delete(id);
  }

  /** Record a client's *intent*. Validated/clamped at simulation time, never trusted as state. */
  setInput(id: number, input: InputState): void {
    if (!this.inputs.has(id)) return;
    this.inputs.set(id, {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
    });
  }

  /** Advance the simulation by dt seconds. */
  tick(dt: number): void {
    for (const [id, entity] of this.entities) {
      const input = this.inputs.get(id);
      if (!input) continue;

      let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);

      // Normalize diagonals so you can't move faster by going corner-ways.
      if (dx !== 0 && dy !== 0) {
        const inv = 1 / Math.SQRT2;
        dx *= inv;
        dy *= inv;
      }

      entity.x = clamp(entity.x + dx * PLAYER_SPEED * dt, 0, WORLD_WIDTH);
      entity.y = clamp(entity.y + dy * PLAYER_SPEED * dt, 0, WORLD_HEIGHT);
    }
  }

  snapshot(): EntityState[] {
    return [...this.entities.values()].map((e) => ({ ...e }));
  }

  get population(): number {
    return this.entities.size;
  }
}

function sanitizeName(name: string): string {
  const trimmed = (name ?? '').trim().slice(0, 16);
  return trimmed.length > 0 ? trimmed : 'Adventurer';
}
