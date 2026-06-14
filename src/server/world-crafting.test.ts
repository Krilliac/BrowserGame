import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Crafting wiring: World.craft reads the player's loot, applies a content recipe via the pure
 * applyCraft, and writes the result back (the spend math is unit-tested in crafting.test.ts). This
 * gives the salvage materials a sink — the refinement ladder turns scrap into higher tiers.
 */
function save(loot: [string, number][]): PlayerSave {
  return {
    name: 'Crafter',
    hue: 0,
    hp: 100,
    mana: 100,
    level: 5,
    xp: 0,
    gold: 0,
    loot,
    gear: [],
    equipment: {},
    god: false,
    quests: [],
    questsDone: [],
  };
}

const world = (): World => new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');

describe('world crafting', () => {
  it('refines materials up the ladder, spending inputs for outputs', () => {
    const w = world();
    w.importPlayer(1, save([['mat_scrap', 3]]), 100, 100);
    expect(w.craft(1, 'refine_scrap')).toBe(true);
    const loot = w.playerStats(1)!.loot;
    expect(loot.mat_scrap ?? 0).toBe(0); // 3 scrap consumed (key dropped)
    expect(loot.mat_dust).toBe(1); // 1 dust produced
  });

  it('fails (and changes nothing) when materials are insufficient', () => {
    const w = world();
    w.importPlayer(2, save([['mat_scrap', 2]]), 100, 100);
    expect(w.craft(2, 'refine_scrap')).toBe(false);
    expect(w.playerStats(2)!.loot.mat_scrap).toBe(2); // untouched — no partial spend
  });

  it('rejects an unknown recipe id', () => {
    const w = world();
    w.importPlayer(3, save([['mat_scrap', 99]]), 100, 100);
    expect(w.craft(3, 'not_a_recipe')).toBe(false);
  });
});
