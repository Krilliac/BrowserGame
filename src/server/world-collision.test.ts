import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { getContent, initGameDb } from './content.js';
import { areaWorld } from './test-support.js';

initGameDb(':memory:');

/**
 * House footprints (decor kind 'house') are solid walls server-side, resolved with the same shared
 * collision the client predictor uses (so there's no rubber-banding). The footprint is read from
 * content (post-world-scale): a door sits centered on the south (max-y) edge. These tests drive
 * the authoritative World directly: walking into a wall is stopped; the door passes.
 */
describe('house wall collision', () => {
  const house = (getContent().area('town')?.decor ?? []).find((d) => d.kind === 'house')!;
  const press = (
    w: World,
    id: number,
    dir: Partial<Record<'up' | 'down' | 'left' | 'right', boolean>>,
    seconds = 3,
  ): void => {
    w.setInput(id, { up: false, down: false, left: false, right: false, ...dir });
    for (let i = 0; i < seconds * 20; i++) w.tick(0.05);
  };

  it('stops a player walking south into the house north wall', () => {
    const w = areaWorld('town');
    const id = w.spawn('Tester');
    const midX = (house.x + house.x2!) / 2;
    w.teleport(id, midX, house.y - 30); // just north of the house, within the wall's x-span
    press(w, id, { down: true });
    expect(w.playerStats(id)!.y).toBeLessThan(house.y); // never crossed the north wall
  });

  it('lets a player walk in through the south door gap', () => {
    const w = areaWorld('town');
    const id = w.spawn('Tester');
    // The door is centered on the south edge. Start just below it and walk north, in.
    const doorX = (house.x + house.x2!) / 2;
    w.teleport(id, doorX, house.y2! + 20);
    press(w, id, { up: true });
    const s = w.playerStats(id)!;
    expect(s.y).toBeLessThan(house.y2!); // passed through the doorway into the house interior
    expect(s.x).toBeGreaterThan(house.x);
    expect(s.x).toBeLessThan(house.x2!);
  });

  it('has no walls in a world without house decor (movement is unobstructed)', () => {
    const w = new World(2000, 2000, { x: 100, y: 100 }); // default 'world' area id: no decor
    const id = w.spawn('Rover');
    w.teleport(id, 500, 500);
    press(w, id, { right: true });
    expect(w.playerStats(id)!.x).toBeGreaterThan(700); // moved freely a long way
  });
});
