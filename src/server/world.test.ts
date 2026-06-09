import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { PLAYER_SPEED, WORLD_WIDTH } from '../shared/protocol.js';

describe('World (authoritative simulation)', () => {
  it('spawns players at the centre of the world', () => {
    const world = new World();
    const id = world.spawn('Conan');
    const [entity] = world.snapshot();
    expect(entity?.id).toBe(id);
    expect(entity?.name).toBe('Conan');
    expect(entity?.x).toBe(WORLD_WIDTH / 2);
  });

  it('moves a player according to input over time', () => {
    const world = new World();
    const id = world.spawn('Runner');
    world.setInput(id, { up: false, down: false, left: false, right: true });
    world.tick(1); // one full second
    const [entity] = world.snapshot();
    expect(entity?.x).toBeCloseTo(WORLD_WIDTH / 2 + PLAYER_SPEED, 5);
  });

  it('clamps players to the world bounds (no escaping the map)', () => {
    const world = new World();
    const id = world.spawn('Wanderer');
    world.setInput(id, { up: false, down: false, left: true, right: false });
    for (let i = 0; i < 100; i++) world.tick(1);
    const [entity] = world.snapshot();
    expect(entity?.x).toBe(0);
  });

  it('does not let diagonal movement exceed straight-line speed', () => {
    const world = new World();
    const id = world.spawn('Diag');
    world.setInput(id, { up: true, down: false, left: false, right: true });
    world.tick(1);
    const [entity] = world.snapshot();
    const dx = (entity?.x ?? 0) - WORLD_WIDTH / 2;
    expect(Math.abs(dx)).toBeLessThanOrEqual(PLAYER_SPEED + 0.001);
  });

  it('ignores input for unknown entities (rejects spoofed ids)', () => {
    const world = new World();
    world.spawn('Real');
    world.setInput(9999, { up: true, down: false, left: false, right: false });
    expect(world.population).toBe(1);
  });
});
