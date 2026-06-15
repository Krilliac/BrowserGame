import { describe, expect, it } from 'vitest';
import { type PlayerSave } from './world.js';
import { initGameDb } from './content.js';
import { areaWorld, npcPos } from './test-support.js';
import { config } from './config.js';
import { type ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

/**
 * Stash capacity guards — the item-safety seam of the bank. depositToStash refuses when the stash is
 * at its cap, and withdrawFromStash refuses when the bag is full. The basic move + banker proximity
 * are covered in world-services; here we prove the FULL-destination cases are no-ops that never drop
 * or duplicate the item.
 */
const BASE: Omit<PlayerSave, 'gear' | 'equipment' | 'loot'> = {
  name: 'Hoarder',
  hue: 0,
  hp: 100,
  mana: 100,
  level: 5,
  xp: 0,
  gold: 0,
  god: false,
  quests: [],
  questsDone: [],
};

const gear = (uid: number): ItemInstance => ({
  uid,
  baseId: 'iron_sword',
  rarity: 'common',
  power: 1,
  hp: 0,
  affixes: [],
  sockets: [],
});

const many = (n: number, startUid: number): ItemInstance[] =>
  Array.from({ length: n }, (_, i) => gear(startUid + i));

describe('stash capacity guards', () => {
  it('refuses to withdraw into a full bag — the item stays safely in the stash', () => {
    const w = areaWorld('town');
    w.populateNpcs('town');
    const banker = npcPos('town', 'banker');
    const save: PlayerSave = {
      ...BASE,
      loot: [],
      gear: many(config.items.maxBagGear, 1), // bag at its cap
      equipment: {},
      stash: [gear(9001)],
    };
    w.importPlayer(1, save, banker.x, banker.y);

    w.withdrawFromStash(1, 9001);
    const out = w.exportPlayer(1)!;
    expect(out.gear.length).toBe(config.items.maxBagGear); // bag did not exceed its cap
    expect(out.stash?.some((i) => i.uid === 9001)).toBe(true); // item never left the stash
  });

  it('refuses to deposit into a full stash — the item stays safely in the bag', () => {
    const w = areaWorld('town');
    w.populateNpcs('town');
    const banker = npcPos('town', 'banker');
    const save: PlayerSave = {
      ...BASE,
      loot: [],
      gear: [gear(9002)],
      equipment: {},
      stash: many(config.items.stashCap, 100), // stash at its cap
    };
    w.importPlayer(2, save, banker.x, banker.y);

    w.depositToStash(2, 9002);
    const out = w.exportPlayer(2)!;
    expect(out.gear.some((g) => g.uid === 9002)).toBe(true); // item never left the bag
    expect(out.stash?.length).toBe(config.items.stashCap); // stash did not exceed its cap
  });
});
