import { describe, expect, it } from 'vitest';
import type { World } from './world.js';
import { initGameDb } from './content.js';
import { areaWorld, npcPos } from './test-support.js';

initGameDb(':memory:');

/**
 * Gem combining at the Artificer: fuse 3 same-kind gems into one of the next tier. The World
 * re-validates artificer proximity, so each test stands the player on Coalhand (town's artificer)
 * at his content position (post-world-scale).
 */
describe('gem combining (Artificer)', () => {
  function atArtificer(): { w: World; id: number } {
    const w = areaWorld('town');
    w.populateNpcs('town');
    const id = w.spawn('Smith');
    const artificer = npcPos('town', 'artificer');
    w.teleport(id, artificer.x, artificer.y); // stand on the artificer for the proximity check
    return { w, id };
  }

  it('fuses 3 same-tier gems into one of the next tier', () => {
    const { w, id } = atArtificer();
    w.giveItem(id, 'ruby_t1', 3);
    w.combineGems(id);
    const loot = w.playerStats(id)!.loot;
    expect(loot.ruby_t1 ?? 0).toBe(0);
    expect(loot.ruby_t2 ?? 0).toBe(1);
  });

  it('consumes exactly 3 and leaves the remainder (one fuse per click)', () => {
    const { w, id } = atArtificer();
    w.giveItem(id, 'emerald_t2', 4);
    w.combineGems(id);
    const loot = w.playerStats(id)!.loot;
    expect(loot.emerald_t2 ?? 0).toBe(1); // 4 - 3
    expect(loot.emerald_t3 ?? 0).toBe(1);
  });

  it('does nothing without 3 matching gems', () => {
    const { w, id } = atArtificer();
    w.giveItem(id, 'ruby_t1', 2);
    w.combineGems(id);
    const loot = w.playerStats(id)!.loot;
    expect(loot.ruby_t1 ?? 0).toBe(2);
    expect(loot.ruby_t2 ?? 0).toBe(0);
  });

  it('will not fuse top-tier gems (no next tier)', () => {
    const { w, id } = atArtificer();
    w.giveItem(id, 'ruby_t3', 3);
    w.combineGems(id);
    expect(w.playerStats(id)!.loot.ruby_t3 ?? 0).toBe(3);
  });

  it('requires artificer proximity (no fuse when far away)', () => {
    const { w, id } = atArtificer();
    w.teleport(id, 50, 50); // walk away from the artificer
    w.giveItem(id, 'ruby_t1', 3);
    w.combineGems(id);
    expect(w.playerStats(id)!.loot.ruby_t1 ?? 0).toBe(3); // unchanged
  });
});
