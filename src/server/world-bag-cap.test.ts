import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';
import { config } from './config.js';
import { type ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

/**
 * Bag overflow policy: addGear (the central pickup path) caps the bag at maxBagGear by evicting the
 * OLDEST item — a picked-up piece always lands, and the bag never grows unbounded. This pins both the
 * hard invariant (length never exceeds the cap) and the FIFO eviction order so a refactor can't quietly
 * change it (e.g. to reject the new pickup or to grow past the cap).
 */
const BASE: Omit<PlayerSave, 'gear' | 'equipment' | 'loot'> = {
  name: 'Packrat',
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

const world = (): World => new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');

describe('bag cap (addGear overflow)', () => {
  it('caps the bag at maxBagGear and evicts the oldest on overflow (FIFO), keeping the pickup', () => {
    const cap = config.items.maxBagGear;
    const w = world();
    // Fill the bag with high uids 1001..(1000+cap) — 1001 is the oldest (front of the array). High uids
    // so the fresh pickup (which gets a low allocId uid) is unambiguously distinguishable.
    w.importPlayer(
      1,
      {
        ...BASE,
        loot: [],
        gear: Array.from({ length: cap }, (_, i) => gear(1001 + i)),
        equipment: {},
      },
      100,
      100,
    );

    w.giveItem(1, 'iron_sword', 1); // a fresh pickup onto a full bag

    const after = w.playerStats(1)!;
    expect(after.gear.length).toBe(cap); // never exceeds the cap
    const uids = after.gear.map((g) => g.uid);
    expect(uids).not.toContain(1001); // the oldest piece was evicted
    expect(uids).toContain(1002); // the second-oldest survived
    expect(uids.filter((u) => u < 1001)).toHaveLength(1); // exactly the fresh pickup remains
  });
});
