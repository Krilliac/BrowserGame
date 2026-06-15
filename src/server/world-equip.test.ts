import { describe, expect, it } from 'vitest';
import { type PlayerSave } from './world.js';
import { initGameDb } from './content.js';
import { areaWorld } from './test-support.js';
import { type ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

/**
 * Equip / unequip round-trip: the basic bag↔doll move and its stat recompute. Sets, gems, and save
 * persistence are pinned elsewhere; here we cover the plain weapon swap — power rises by the equipped
 * weapon, returns to base on unequip, and (critically) equipping over an occupied slot returns the
 * PREVIOUS piece to the bag rather than dropping it on the floor.
 */
const BASE: Omit<PlayerSave, 'gear' | 'equipment' | 'loot'> = {
  name: 'Smith',
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

const sword = (uid: number, power: number): ItemInstance => ({
  uid,
  baseId: 'iron_sword',
  rarity: 'common',
  power,
  hp: 0,
  affixes: [],
  sockets: [],
});

describe('world equip/unequip', () => {
  it('raises power on equip and restores it on unequip (round-trip)', () => {
    const w = areaWorld('town');
    w.importPlayer(1, { ...BASE, loot: [], gear: [sword(1, 10)], equipment: {} }, 100, 100);
    const base = w.playerStats(1)!.power; // unarmed

    w.equip(1, 1);
    expect(w.playerStats(1)!.power).toBe(base + 10); // weapon power folds in
    expect(w.playerStats(1)!.gear.find((g) => g.uid === 1)).toBeUndefined(); // moved bag → doll

    w.unequip(1, 'mainhand');
    expect(w.playerStats(1)!.power).toBe(base); // restored
    expect(w.playerStats(1)!.gear.find((g) => g.uid === 1)).toBeDefined(); // back in the bag
  });

  it('swapping into an occupied slot returns the previous piece to the bag (never lost)', () => {
    const w = areaWorld('town');
    w.importPlayer(
      2,
      { ...BASE, loot: [], gear: [sword(1, 10), sword(2, 25)], equipment: {} },
      100,
      100,
    );
    const base = w.playerStats(2)!.power;

    w.equip(2, 1); // equip the weaker sword
    w.equip(2, 2); // equip the stronger one into the now-occupied mainhand

    const s = w.playerStats(2)!;
    expect(s.equipment.mainhand?.uid).toBe(2); // the new piece is worn
    expect(s.power).toBe(base + 25); // its power, not the old one's
    expect(s.gear.find((g) => g.uid === 1)).toBeDefined(); // the swapped-out sword returned to the bag
  });
});
