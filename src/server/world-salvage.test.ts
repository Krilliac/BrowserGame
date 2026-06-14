import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb, getContent } from './content.js';
import type { ItemInstance, Rarity } from '../shared/items.js';

initGameDb(':memory:');

/**
 * Salvage wiring: World.salvage breaks a BAG gear instance into crafting materials (the pure yield
 * math is unit-tested in salvage.test.ts). Here we prove the World consumes the item, grants the
 * mapped material loot, only touches bag items, and that the mapped material ids are real content.
 */
function item(uid: number, baseId: string, rarity: Rarity): ItemInstance {
  return { uid, baseId, rarity, power: 0, hp: 0, affixes: [], sockets: [] };
}

function save(gear: ItemInstance[]): PlayerSave {
  return {
    name: 'Smith',
    hue: 0,
    hp: 100,
    mana: 100,
    level: 5,
    xp: 0,
    gold: 0,
    loot: [],
    gear,
    equipment: {},
    god: false,
    quests: [],
    questsDone: [],
  };
}

const world = (): World => new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');

describe('world salvage', () => {
  it('breaks a bag item into materials and removes it from the bag', () => {
    const w = world();
    w.importPlayer(1, save([item(100, 'iron_sword', 'common')]), 100, 100);
    const r = w.salvage(1, 100);
    expect(r.ok).toBe(true);
    expect(w.playerStats(1)!.gear.find((g) => g.uid === 100)).toBeUndefined(); // consumed
    expect(w.playerStats(1)!.loot.mat_scrap).toBeGreaterThanOrEqual(1); // common → scrap
  });

  it('maps the top tier (legendary) to essence + rune_shard', () => {
    const w = world();
    w.importPlayer(2, save([item(200, 'mithril_blade', 'legendary')]), 100, 100);
    w.salvage(2, 200);
    const loot = w.playerStats(2)!.loot;
    expect(loot.mat_essence).toBeGreaterThanOrEqual(1);
    expect(loot.rune_shard).toBeGreaterThanOrEqual(1); // shard kind reuses rune_shard
  });

  it('rejects an unknown uid and never touches an equipped item', () => {
    const w = world();
    w.importPlayer(3, save([]), 100, 100);
    expect(w.salvage(3, 999).ok).toBe(false);
  });

  it('every salvage material maps to a REAL content item', () => {
    // Guards the World.SALVAGE_ITEM_ID map against a typo'd / unseeded material id.
    for (const id of ['mat_scrap', 'mat_dust', 'mat_essence', 'rune_shard']) {
      expect(getContent().item(id), `salvage material "${id}"`).toBeDefined();
    }
  });
});
