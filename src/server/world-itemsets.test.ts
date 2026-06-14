import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';
import type { ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

/**
 * Item sets: equipping several pieces of one set folds threshold bonuses into the stat recompute.
 * The "Ironclad Aegis" set (iron_helm/iron_armor/iron_greaves/iron_sword) grants +12 power at four
 * pieces. We zero each instance's own power/affixes so the only power on the doll is the set bonus,
 * making the delta exact.
 */
function piece(uid: number, baseId: string): ItemInstance {
  return { uid, baseId, rarity: 'common', power: 0, hp: 0, affixes: [], sockets: [] };
}

function save(equipment: PlayerSave['equipment']): PlayerSave {
  return {
    name: 'Tester',
    hue: 0,
    hp: 100,
    mana: 100,
    level: 5,
    xp: 0,
    gold: 0,
    loot: [],
    gear: [],
    equipment,
    god: false,
    quests: [],
    questsDone: [],
  };
}

describe('item sets', () => {
  it('grants the four-piece set bonus only once the set is complete', () => {
    // One piece: set inactive — baseline power is just attributes (instance power is 0).
    const one = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    one.importPlayer(1, save({ head: piece(7001, 'iron_helm') }), 100, 100);
    const base = one.playerStats(1)!.power;

    // Four pieces across four distinct slots: Ironclad 4-piece → +12 power.
    const full = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    full.importPlayer(
      2,
      save({
        head: piece(7001, 'iron_helm'),
        chest: piece(7002, 'iron_armor'),
        feet: piece(7003, 'iron_greaves'),
        mainhand: piece(7004, 'iron_sword'),
      }),
      100,
      100,
    );
    expect(full.playerStats(2)!.power).toBe(base + 12);
  });

  it('a single set piece grants no set bonus', () => {
    // A lone Mithril piece must read the same crit as a non-set weapon (no 2-piece bonus yet).
    const noSet = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    noSet.importPlayer(3, save({ mainhand: piece(7010, 'rusty_sword') }), 100, 100);
    const onePiece = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    onePiece.importPlayer(4, save({ mainhand: piece(7011, 'mithril_blade') }), 100, 100);
    expect(onePiece.playerStats(4)!.critChance).toBeCloseTo(noSet.playerStats(3)!.critChance, 6);
  });

  it('the two-piece Mithril bonus adds +12% crit', () => {
    const one = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    one.importPlayer(5, save({ mainhand: piece(7011, 'mithril_blade') }), 100, 100);
    const base = one.playerStats(5)!.critChance;

    const two = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    two.importPlayer(
      6,
      save({ mainhand: piece(7011, 'mithril_blade'), chest: piece(7012, 'mithril_armor') }),
      100,
      100,
    );
    expect(two.playerStats(6)!.critChance).toBeCloseTo(base + 0.12, 6);
  });
});
