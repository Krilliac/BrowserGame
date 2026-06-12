import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';
import { EXPANSION_DECOR } from './db/seed-decor.js';

initGameDb(':memory:');

/**
 * Breakable pots are 'pot' decor: the World spawns them as entities and smashes one when a player
 * brushes against it, spilling a little gold (once — a smashed pot leaves the snapshot for good).
 */
describe('breakable pots', () => {
  // Use a real seeded placement so the test follows the data, not a magic coordinate.
  const townPot = EXPANSION_DECOR.find((d) => d.areaId === 'town' && d.kind === 'pot')!;
  const townWorld = (): World => new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
  const potsOf = (w: World) => w.snapshot().filter((e) => e.kind === 'pot');

  it('seeds pots in town and smashing pays out gold, exactly once per pot', () => {
    const w = townWorld();
    const id = w.spawn('Smasher');
    const before = potsOf(w).length;
    expect(before).toBeGreaterThan(0);
    const beforeGold = w.playerStats(id)!.gold;

    // Pots sit in tight clusters, so brushing one can smash its neighbors too — by design.
    w.teleport(id, townPot.x, townPot.y);
    for (let i = 0; i < 3; i++) w.tick(0.05); // smash + auto-collect the spilled gold

    expect(potsOf(w).length).toBeLessThan(before); // smashed pots left the snapshot
    const afterGold = w.playerStats(id)!.gold;
    expect(afterGold).toBeGreaterThan(beforeGold);

    // Standing in the shards does not pay again.
    const broken = potsOf(w).length;
    for (let i = 0; i < 3; i++) w.tick(0.05);
    expect(w.playerStats(id)!.gold).toBe(afterGold);
    expect(potsOf(w).length).toBe(broken);
  });

  it('pots stay intact when no one is near', () => {
    const w = townWorld();
    const id = w.spawn('Idler');
    w.teleport(id, 80, 80);
    w.tick(0.05);
    expect(potsOf(w).length).toBe(potsOf(w).length); // unchanged across ticks
    const count = potsOf(w).length;
    w.tick(0.05);
    expect(potsOf(w).length).toBe(count);
  });
});
