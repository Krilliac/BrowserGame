import { describe, expect, it } from 'vitest';
import type { World } from './world.js';
import { type PlayerSave } from './world.js';
import { initGameDb } from './content.js';
import { areaWorld, npcPos } from './test-support.js';
import type { ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

/**
 * Integration coverage for the town-service NPCs that share the (previously broken) nearbyNpc
 * proximity path: the gambler and the Artificer (enchant + unsocket). These are the kind of
 * thinly-tested shipped features where the Artificer's vendor-fallback bug hid.
 */
const BASE_SAVE: Omit<PlayerSave, 'gear' | 'equipment' | 'loot'> = {
  name: 'Subject',
  hue: 0,
  hp: 100,
  mana: 100,
  level: 5,
  xp: 0,
  gold: 1000,
  god: false,
  quests: [],
  questsDone: [],
};

describe('gambler', () => {
  it('spends gold and adds a rolled item of the chosen slot to the bag', () => {
    const w = areaWorld('town');
    const id = w.spawn('Lucky');
    w.populateNpcs('town'); // Lucky Marn, the town gambler
    const gambler = npcPos('town', 'gambler');
    w.teleport(id, gambler.x, gambler.y);
    w.giveItem(id, 'gold', 500);

    // Capture primitives before acting: playerStats().gear is a live reference, not a snapshot.
    const beforeGear = w.playerStats(id)!.gear.length;
    const beforeGold = w.playerStats(id)!.gold;
    w.gamble(id, 'mainhand');
    const after = w.playerStats(id)!;

    expect(after.gear.length).toBe(beforeGear + 1);
    expect(after.gold).toBeLessThan(beforeGold); // the pull cost was deducted
    expect(after.gear.at(-1)!.baseId).toBeTruthy();
  });

  it('does nothing away from the gambler (proximity is server-checked)', () => {
    const w = areaWorld('town');
    const id = w.spawn('Lucky');
    w.populateNpcs('town');
    w.teleport(id, 50, 50); // nowhere near Lucky Marn
    w.giveItem(id, 'gold', 500);
    const before = w.playerStats(id)!.gear.length;
    w.gamble(id, 'mainhand');
    expect(w.playerStats(id)!.gear.length).toBe(before);
  });
});

describe('Artificer enchant + unsocket', () => {
  const affixedSword: ItemInstance = {
    uid: 9001,
    baseId: 'iron_sword',
    rarity: 'rare',
    power: 20,
    hp: 0,
    affixes: [
      { stat: 'power', value: 6 },
      { stat: 'crit', value: 5 },
    ],
    sockets: [],
  };

  it('reroll consumes gold + a rune shard and keeps the item affixed', () => {
    const w = areaWorld('town');
    w.populateNpcs('town'); // Coalhand the Artificer
    const save: PlayerSave = {
      ...BASE_SAVE,
      loot: [['rune_shard', 3]],
      gear: [affixedSword],
      equipment: {},
    };
    const artificer = npcPos('town', 'artificer');
    w.importPlayer(1, save, artificer.x, artificer.y); // arrive standing on the artificer

    const before = w.playerStats(1)!;
    w.enchant(1, 9001);
    const after = w.playerStats(1)!;

    expect(after.gold).toBe(before.gold - 250); // ARTIFICER_REROLL_GOLD
    expect(after.loot.rune_shard ?? 0).toBe((before.loot.rune_shard ?? 0) - 1);
    expect(after.gear.find((g) => g.uid === 9001)!.affixes.length).toBeGreaterThan(0);
  });

  it('unsocket pops the gem back into the bag and frees the socket', () => {
    const w = areaWorld('town');
    w.populateNpcs('town');
    const socketedArmor: ItemInstance = {
      uid: 9002,
      baseId: 'iron_armor',
      rarity: 'epic',
      power: 0,
      hp: 60,
      affixes: [],
      sockets: ['ruby_t1'],
    };
    const save: PlayerSave = {
      ...BASE_SAVE,
      loot: [],
      gear: [],
      equipment: { chest: socketedArmor },
    };
    const artificer2 = npcPos('town', 'artificer');
    w.importPlayer(2, save, artificer2.x, artificer2.y);

    w.unsocketGem(2, 'chest', 0);
    const after = w.playerStats(2)!;

    expect(after.equipment.chest!.sockets![0]).toBe(null);
    expect(after.loot.ruby_t1 ?? 0).toBe(1);
    expect(after.gold).toBe(1000 - 120); // ARTIFICER_UNSOCKET_GOLD
  });
});

describe('banker stash', () => {
  const sword: ItemInstance = {
    uid: 7001,
    baseId: 'iron_sword',
    rarity: 'rare',
    power: 18,
    hp: 0,
    affixes: [],
    sockets: [],
  };

  /** Read a player's current stash contents via the host drain path. */
  const stashOf = (w: World, playerId: number): ItemInstance[] =>
    w.drainStashOffers().find((o) => o.playerId === playerId)?.items ?? [];

  it('deposit moves a bag item into the stash next to the banker', () => {
    const w = areaWorld('town');
    w.populateNpcs('town'); // the Vault Keeper (banker)
    const save: PlayerSave = { ...BASE_SAVE, loot: [], gear: [sword], equipment: {} };
    const banker = npcPos('town', 'banker');
    w.importPlayer(1, save, banker.x, banker.y);

    w.depositToStash(1, 7001);
    expect(w.playerStats(1)!.gear.find((g) => g.uid === 7001)).toBeUndefined();
    expect(stashOf(w, 1).map((i) => i.uid)).toContain(7001);
  });

  it('withdraw moves a stashed item back into the bag', () => {
    const w = areaWorld('town');
    w.populateNpcs('town');
    const save: PlayerSave = { ...BASE_SAVE, loot: [], gear: [sword], equipment: {} };
    const banker2 = npcPos('town', 'banker');
    w.importPlayer(2, save, banker2.x, banker2.y);

    w.depositToStash(2, 7001); // bag -> stash
    w.drainStashOffers(); // clear the pending window so the next read is fresh
    w.withdrawFromStash(2, 7001); // stash -> bag

    expect(w.playerStats(2)!.gear.find((g) => g.uid === 7001)).toBeTruthy();
    expect(stashOf(w, 2).map((i) => i.uid)).not.toContain(7001);
  });

  it('does nothing away from the banker (proximity is server-checked)', () => {
    const w = areaWorld('town');
    w.populateNpcs('town');
    const save: PlayerSave = { ...BASE_SAVE, loot: [], gear: [sword], equipment: {} };
    w.importPlayer(3, save, 50, 50); // nowhere near the Vault Keeper

    w.depositToStash(3, 7001);
    expect(w.playerStats(3)!.gear.find((g) => g.uid === 7001)).toBeTruthy();
    expect(stashOf(w, 3)).toHaveLength(0);
  });
});
