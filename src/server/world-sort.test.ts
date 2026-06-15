import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';
import type { ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

/** /sort wiring: the World resolves each base id's slot from content and reorders the bag in place. */
const gearInst = (uid: number, baseId: string): ItemInstance => ({
  uid,
  baseId,
  rarity: 'common',
  power: 0,
  hp: 0,
  affixes: [],
});

const save = (gear: ItemInstance[]): PlayerSave => ({
  name: 'Hero',
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
});

describe('world sortBag', () => {
  it('reorders the bag by slot group (mainhand → head → ring)', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    const jumbled = [
      gearInst(1, 'copper_ring'),
      gearInst(2, 'leather_cap'),
      gearInst(3, 'iron_sword'),
    ];
    w.importPlayer(1, save(jumbled), 100, 100);

    expect(w.sortBag(1)).toBe(true);
    expect(w.playerStats(1)!.gear.map((g) => g.baseId)).toEqual([
      'iron_sword',
      'leather_cap',
      'copper_ring',
    ]);
  });
});
