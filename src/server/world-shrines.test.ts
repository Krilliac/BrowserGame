import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';
import { areaWorld, decorPos } from './test-support.js';

initGameDb(':memory:');

/**
 * Shrines are placed as 'shrine' decor in the content DB; the World blesses a player who steps
 * within range with a random timed buff, then the shrine recharges. Positions come from content
 * (post-world-scale), never hardcoded.
 */
describe('shrines', () => {
  const blessed = (w: World, id: number): boolean =>
    w.drainNotices().some((n) => n.playerId === id && /shrine blesses you/i.test(n.text));

  it('blesses a player who steps onto a shrine, then recharges (cooldown)', () => {
    const w = areaWorld('town');
    const id = w.spawn('Pilgrim'); // spawns at the town spawn, well clear of the shrine
    const shrine = decorPos('town', 'shrine');
    w.teleport(id, shrine.x, shrine.y); // step onto the town shrine
    w.tick(0.05);
    expect(blessed(w, id)).toBe(true);
    // Immediately standing on it again does nothing — it's spent until the cooldown elapses.
    w.tick(0.05);
    expect(blessed(w, id)).toBe(false);
  });

  it('does nothing away from any shrine', () => {
    const w = areaWorld('town');
    const id = w.spawn('Wanderer');
    w.teleport(id, 120, 120); // nowhere near the shrine
    w.tick(0.05);
    expect(blessed(w, id)).toBe(false);
  });

  it('a world without shrine decor never blesses', () => {
    // The default 'world' area id has no content row at all -> no decor -> no shrines.
    const w = new World();
    const id = w.spawn('Scout');
    w.tick(0.05);
    expect(blessed(w, id)).toBe(false);
  });
});
