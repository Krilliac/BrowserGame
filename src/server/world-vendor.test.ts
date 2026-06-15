import { describe, expect, it } from 'vitest';
import { type PlayerSave } from './world.js';
import { initGameDb, getContent } from './content.js';
import { areaWorld, npcPos } from './test-support.js';
import { gearSellValue, type ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

/**
 * Vendor sell/buy at the World boundary — the gold economy's edge. The pure sell-VALUE math lives in
 * vendor.test.ts; here we prove the World conserves gold: selling empties the bag and credits exactly
 * the summed value, and both sell and buy are vendor-proximity gated (a core anti-cheat seam).
 */
const BASE: Omit<PlayerSave, 'gear' | 'equipment' | 'loot'> = {
  name: 'Trader',
  hue: 0,
  hp: 100,
  mana: 100,
  level: 5,
  xp: 0,
  gold: 100,
  god: false,
  quests: [],
  questsDone: [],
};

const sword: ItemInstance = {
  uid: 1,
  baseId: 'iron_sword',
  rarity: 'rare',
  power: 18,
  hp: 0,
  affixes: [],
  sockets: [],
};

describe('world vendor sell', () => {
  it('credits exactly the summed value and empties the bag (gold conservation)', () => {
    const w = areaWorld('town');
    w.populateNpcs('town');
    const vendor = npcPos('town', 'vendor');
    const save: PlayerSave = {
      ...BASE,
      loot: [
        ['wolf_pelt', 2],
        ['rune_shard', 1],
      ],
      gear: [sword],
      equipment: {},
    };
    w.importPlayer(1, save, vendor.x, vendor.y);

    const c = getContent();
    expect(c.sellValue('wolf_pelt')).toBeGreaterThan(0); // both are vendor-sellable drops
    expect(c.sellValue('rune_shard')).toBeGreaterThan(0);
    const expected =
      c.sellValue('wolf_pelt') * 2 + c.sellValue('rune_shard') * 1 + gearSellValue(sword);

    w.sell(1);
    const after = w.playerStats(1)!;
    expect(after.gold).toBe(100 + expected); // started with 100g
    expect(after.gear).toHaveLength(0);
    expect(after.loot.wolf_pelt ?? 0).toBe(0); // sellable loot consumed
    expect(after.loot.rune_shard ?? 0).toBe(0);
  });

  it('does nothing away from a vendor (proximity is server-checked)', () => {
    const w = areaWorld('town');
    w.populateNpcs('town');
    const save: PlayerSave = { ...BASE, loot: [['mat_scrap', 3]], gear: [sword], equipment: {} };
    w.importPlayer(2, save, 40, 40); // nowhere near the Merchant

    w.sell(2);
    const after = w.playerStats(2)!;
    expect(after.gold).toBe(100); // untouched
    expect(after.gear).toHaveLength(1); // bag intact
  });
});

describe('world vendor buy', () => {
  it('does nothing away from a vendor or for an item not on the shelf', () => {
    const w = areaWorld('town');
    w.populateNpcs('town');
    const vendor = npcPos('town', 'vendor');

    // Away from the vendor: no purchase, no gold spent.
    w.importPlayer(3, { ...BASE, gold: 1000, loot: [], gear: [], equipment: {} }, 40, 40);
    w.buy(3, 'iron_sword');
    expect(w.playerStats(3)!.gold).toBe(1000);
    expect(w.playerStats(3)!.gear).toHaveLength(0);

    // At the vendor but asking for an item that isn't stocked: still a no-op (validated vs shown stock).
    w.importPlayer(
      4,
      { ...BASE, gold: 1000, loot: [], gear: [], equipment: {} },
      vendor.x,
      vendor.y,
    );
    w.buy(4, 'definitely_not_a_real_item');
    expect(w.playerStats(4)!.gold).toBe(1000);
  });
});
