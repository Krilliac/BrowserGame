import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Chests are 'chest' decor: the World spawns them as entities and pops one open when a player walks
 * up, spilling gold + gear on the ground (once). The town has a chest at (800, 985) inside the south
 * house. Chests appear in the snapshot with an `opened` flag so the client draws closed vs open.
 */
describe('loot chests', () => {
  const townWorld = (): World => new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
  const chestOf = (w: World) => w.snapshot().find((e) => e.kind === 'chest');

  it('opens on approach and gives loot (gold), exactly once', () => {
    const w = townWorld();
    const id = w.spawn('Looter');
    expect(chestOf(w)?.opened).toBe(false); // starts closed
    const beforeGold = w.playerStats(id)!.gold;

    w.teleport(id, 800, 985); // walk onto the chest (inside the south house)
    for (let i = 0; i < 3; i++) w.tick(0.05); // open + auto-collect the spilled loot at our feet

    expect(chestOf(w)?.opened).toBe(true);
    const afterGold = w.playerStats(id)!.gold;
    expect(afterGold).toBeGreaterThan(beforeGold); // the chest's gold was collected

    // Standing on the opened chest does not loot again.
    for (let i = 0; i < 3; i++) w.tick(0.05);
    expect(w.playerStats(id)!.gold).toBe(afterGold);
  });

  it('stays closed when no one is near', () => {
    const w = townWorld();
    const id = w.spawn('Idler');
    w.teleport(id, 120, 120);
    w.tick(0.05);
    expect(chestOf(w)?.opened).toBe(false);
  });
});
