import { describe, expect, it } from 'vitest';
import { initGameDb } from './content.js';
import { areaWorld } from './test-support.js';

initGameDb(':memory:');

/**
 * The World side of the mail system: take gold / a bag gear instance out to attach to outgoing mail,
 * and deliver collected gold + an item back into a bag (with a bag-full guard). The host (index.ts)
 * orchestrates the DB inbox + name→token resolution around these; here we pin the inventory moves.
 */
describe('mail — World inventory moves', () => {
  it('takes gold only when affordable', () => {
    const w = areaWorld('town');
    const id = w.spawn('Sender');
    w.giveItem(id, 'gold', 100);
    expect(w.mailTakeGold(id, 60)).toBe(true);
    expect(w.playerStats(id)!.gold).toBe(40);
    expect(w.mailTakeGold(id, 100)).toBe(false); // can't afford
    expect(w.playerStats(id)!.gold).toBe(40); // unchanged on failure
  });

  it('takes a bag gear instance by uid (and returns null for an unknown uid)', () => {
    const w = areaWorld('town');
    const id = w.spawn('Sender');
    w.giveItem(id, 'iron_sword', 1);
    const uid = w.playerStats(id)!.gear[0]!.uid;
    const taken = w.mailTakeGear(id, uid);
    expect(taken?.uid).toBe(uid);
    expect(w.playerStats(id)!.gear).toHaveLength(0); // pulled out of the bag
    expect(w.mailTakeGear(id, 999999)).toBeNull();
  });

  it('delivers gold + an item into the bag (re-issuing a fresh uid)', () => {
    const w = areaWorld('town');
    const id = w.spawn('Recipient');
    w.giveItem(id, 'iron_sword', 1);
    const item = w.mailTakeGear(id, w.playerStats(id)!.gear[0]!.uid)!;
    const goldBefore = w.playerStats(id)!.gold;

    const r = w.mailDeliver(id, 50, item);
    expect(r.ok).toBe(true);
    expect(w.playerStats(id)!.gold).toBe(goldBefore + 50);
    expect(w.playerStats(id)!.gear).toHaveLength(1);
    expect(w.playerStats(id)!.gear[0]!.baseId).toBe(item.baseId);
  });

  it('refuses item delivery when the bag is full (so the mail can be kept), but gold-only still lands', () => {
    const w = areaWorld('town');
    const id = w.spawn('Hoarder');
    w.giveItem(id, 'iron_sword', 500); // overfill — addGear caps the bag at MAX_BAG_GEAR
    const item = {
      uid: 1,
      baseId: 'iron_sword',
      rarity: 'common' as const,
      power: 5,
      hp: 0,
      affixes: [],
    };
    expect(w.mailDeliver(id, 10, item).ok).toBe(false); // no room for the item
    const goldBefore = w.playerStats(id)!.gold;
    expect(w.mailDeliver(id, 10, null).ok).toBe(true); // gold-only always lands
    expect(w.playerStats(id)!.gold).toBe(goldBefore + 10);
  });
});
