import { describe, expect, it } from 'vitest';
import type { World } from './world.js';
import { initGameDb } from './content.js';
import { areaWorld, decorPos } from './test-support.js';

initGameDb(':memory:');

/**
 * Chests are 'chest' decor: the World spawns them as entities and pops one open when a player
 * walks up, spilling gold + gear on the ground (once). Positions come from content (post-scale).
 * Chests appear in the snapshot with an `opened` flag so the client draws closed vs open.
 */
describe('loot chests', () => {
  const chest = decorPos('town', 'chest');
  const chestAt = (w: World) =>
    w.snapshot().find((e) => e.kind === 'chest' && e.x === chest.x && e.y === chest.y);

  it('opens on approach and gives loot (gold), exactly once', () => {
    const w = areaWorld('town');
    const id = w.spawn('Looter');
    expect(chestAt(w)?.opened).toBe(false); // starts closed
    const beforeGold = w.playerStats(id)!.gold;

    w.teleport(id, chest.x, chest.y); // walk onto the chest
    for (let i = 0; i < 3; i++) w.tick(0.05); // open + auto-collect the spilled loot at our feet

    expect(chestAt(w)?.opened).toBe(true);
    const afterGold = w.playerStats(id)!.gold;
    expect(afterGold).toBeGreaterThan(beforeGold); // the chest's gold was collected

    // Standing on the opened chest does not loot again.
    for (let i = 0; i < 3; i++) w.tick(0.05);
    expect(w.playerStats(id)!.gold).toBe(afterGold);
  });

  it('stays closed when no one is near', () => {
    const w = areaWorld('town');
    const id = w.spawn('Idler');
    w.teleport(id, 120, 120);
    w.tick(0.05);
    expect(chestAt(w)?.opened).toBe(false);
  });
});
