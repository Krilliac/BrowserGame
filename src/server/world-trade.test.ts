import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';
import type { ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

/**
 * Player-to-player trading: the World owns proximity, the session registry, and the ATOMIC,
 * re-validated swap. The negotiation rules (incl. the anti-scam "any change voids confirmations")
 * live in the pure trade.ts and are unit-tested there; here we prove the World wiring — that a
 * commit actually moves items/gold, that ownership is re-validated at commit, and the guard rails.
 */
function item(uid: number, baseId: string): ItemInstance {
  return { uid, baseId, rarity: 'common', power: 0, hp: 0, affixes: [], sockets: [] };
}

function save(gear: ItemInstance[], gold: number): PlayerSave {
  return {
    name: `P${gold}`,
    hue: 0,
    hp: 100,
    mana: 100,
    level: 5,
    xp: 0,
    gold,
    loot: [],
    gear,
    equipment: {},
    god: false,
    quests: [],
    questsDone: [],
  };
}

function twoTraders(): World {
  const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
  w.importPlayer(1, save([item(100, 'iron_sword')], 50), 100, 100);
  w.importPlayer(2, save([item(200, 'iron_helm')], 30), 110, 100); // within TRADE_RANGE
  return w;
}

const bag = (w: World, id: number): number[] =>
  w
    .playerStats(id)!
    .gear.map((g) => g.uid)
    .sort();
const gold = (w: World, id: number): number => w.playerStats(id)!.gold;

describe('world trading', () => {
  it('commits an agreed swap — items and gold cross atomically', () => {
    const w = twoTraders();
    expect(w.startTrade(1, 2).ok).toBe(true);
    expect(w.tradeSetOffer(1, { gold: 20, itemUids: [100] })).toBe(true);
    expect(w.tradeSetOffer(2, { gold: 10, itemUids: [200] })).toBe(true);
    expect(w.tradeConfirm(1)).toBe('updated'); // only one side confirmed
    expect(w.tradeConfirm(2)).toBe('committed');
    // A gave sword + 20g for helm + 10g; B the reverse.
    expect(bag(w, 1)).toEqual([200]);
    expect(bag(w, 2)).toEqual([100]);
    expect(gold(w, 1)).toBe(50 - 20 + 10);
    expect(gold(w, 2)).toBe(30 - 10 + 20);
  });

  it('the anti-scam rule holds through the World: changing an offer after a confirm voids it', () => {
    const w = twoTraders();
    w.startTrade(1, 2);
    w.tradeSetOffer(1, { gold: 0, itemUids: [100] });
    expect(w.tradeConfirm(1)).toBe('updated'); // A confirmed
    // B changes the table — this must reset A's confirmation, so B confirming is not enough.
    w.tradeSetOffer(2, { gold: 0, itemUids: [200] });
    expect(w.tradeConfirm(2)).toBe('updated'); // NOT 'committed' — A must re-confirm
    expect(bag(w, 1)).toEqual([100]); // nothing moved
  });

  it('re-validates ownership at commit — a uid the player does not own aborts the whole trade', () => {
    const w = twoTraders();
    w.startTrade(1, 2);
    w.tradeSetOffer(1, { gold: 0, itemUids: [999] }); // A does NOT own uid 999
    w.tradeSetOffer(2, { gold: 0, itemUids: [200] });
    w.tradeConfirm(1);
    expect(w.tradeConfirm(2)).toBe('failed'); // commit re-validation rejects it
    expect(bag(w, 1)).toEqual([100]); // no partial transfer — both bags untouched
    expect(bag(w, 2)).toEqual([200]);
    expect(gold(w, 1)).toBe(50);
    expect(gold(w, 2)).toBe(30);
  });

  it('aborts when a side cannot afford its gold offer', () => {
    const w = twoTraders();
    w.startTrade(1, 2);
    w.tradeSetOffer(1, { gold: 9999, itemUids: [] }); // A only has 50g
    w.tradeSetOffer(2, { gold: 0, itemUids: [200] });
    w.tradeConfirm(1);
    expect(w.tradeConfirm(2)).toBe('failed');
    expect(gold(w, 1)).toBe(50);
  });

  it('rejects self-trade, out-of-range, and double-trade', () => {
    const w = twoTraders();
    expect(w.startTrade(1, 1).ok).toBe(false); // self
    w.importPlayer(3, save([], 0), 1500, 1100); // far away
    expect(w.startTrade(1, 3).ok).toBe(false); // out of range
    expect(w.startTrade(1, 2).ok).toBe(true);
    expect(w.startTrade(1, 2).ok).toBe(false); // already trading
  });

  it('cancel ends the session and names the partner to notify', () => {
    const w = twoTraders();
    w.startTrade(1, 2);
    expect(w.tradeCancel(1)).toBe(2); // the other participant
    expect(w.tradeStateFor(1)).toBeUndefined();
    expect(w.startTrade(1, 2).ok).toBe(true); // free to trade again
  });
});
