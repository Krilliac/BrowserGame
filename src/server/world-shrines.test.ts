import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Shrines are placed as 'shrine' decor in the content DB; the World blesses a player who steps within
 * range with a random timed buff, then the shrine recharges. The town has one shrine at (800, 772).
 */
describe('shrines', () => {
  const townWorld = (): World => new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
  const blessed = (w: World, id: number): boolean =>
    w.drainNotices().some((n) => n.playerId === id && /shrine blesses you/i.test(n.text));

  it('blesses a player who steps onto a shrine, then recharges (cooldown)', () => {
    const w = townWorld();
    const id = w.spawn('Pilgrim'); // spawns at (800,600), well clear of the shrine
    w.teleport(id, 800, 772); // step onto the town shrine
    w.tick(0.05);
    expect(blessed(w, id)).toBe(true);
    // Immediately standing on it again does nothing — it's spent until the cooldown elapses.
    w.tick(0.05);
    expect(blessed(w, id)).toBe(false);
  });

  it('does nothing away from any shrine', () => {
    const w = townWorld();
    const id = w.spawn('Wanderer');
    w.teleport(id, 120, 120); // nowhere near the shrine
    w.tick(0.05);
    expect(blessed(w, id)).toBe(false);
  });

  it('an area with no shrine decor never blesses', () => {
    const w = new World(2000, 2000, { x: 100, y: 100 }, undefined, 'wilderness');
    const id = w.spawn('Scout');
    w.tick(0.05);
    expect(blessed(w, id)).toBe(false);
  });
});
