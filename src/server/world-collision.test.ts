import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * House footprints (decor kind 'house') are solid walls server-side, resolved with the same shared
 * collision the client predictor uses (so there's no rubber-banding). The town's NW house footprint
 * is (250,360)→(420,500), with a door centered on the south (max-y) edge. These tests drive the
 * authoritative World directly: walking into a wall is stopped; walking through the door passes.
 */
describe('house wall collision', () => {
  const townWorld = (): World => new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
  const press = (
    w: World,
    id: number,
    dir: Partial<Record<'up' | 'down' | 'left' | 'right', boolean>>,
  ): void => {
    w.setInput(id, { up: false, down: false, left: false, right: false, ...dir });
    for (let i = 0; i < 60; i++) w.tick(0.05); // ~3s of walking into it
  };

  it('stops a player walking south into the house north wall', () => {
    const w = townWorld();
    const id = w.spawn('Tester');
    w.teleport(id, 300, 330); // just north of the NW house, within the wall's x-span
    press(w, id, { down: true });
    expect(w.playerStats(id)!.y).toBeLessThan(360); // never crossed the north wall
  });

  it('lets a player walk in through the south door gap', () => {
    const w = townWorld();
    const id = w.spawn('Tester');
    // Door is centered on the south edge (x ≈ 335). Start just below it and walk north, in.
    w.teleport(id, 335, 520);
    press(w, id, { up: true });
    const s = w.playerStats(id)!;
    expect(s.y).toBeLessThan(500); // passed through the doorway into the house interior
    expect(s.x).toBeGreaterThan(250);
    expect(s.x).toBeLessThan(420);
  });

  it('has no walls in an area without houses (movement is unobstructed)', () => {
    const w = new World(2000, 2000, { x: 100, y: 100 }, undefined, 'wilderness');
    const id = w.spawn('Rover');
    w.teleport(id, 500, 500);
    press(w, id, { right: true });
    expect(w.playerStats(id)!.x).toBeGreaterThan(700); // moved freely a long way
  });
});
