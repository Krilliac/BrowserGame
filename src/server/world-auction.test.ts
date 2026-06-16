import { describe, expect, it } from 'vitest';
import { initGameDb, getDb } from './content.js';
import { areaWorld } from './test-support.js';
import {
  createAuction,
  getAuction,
  loadAuctions,
  deleteAuction,
  auctionPayout,
  sendMail,
  loadMail,
} from './player-store.js';
import type { ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

/**
 * End-to-end auction economics, driving the same World + DB primitives the host orchestrates
 * (escrow the item out of the seller's bag → list → buyer pays + receives → seller is mailed the
 * proceeds minus the house cut). Pins gold conservation, the item transfer, and the gold sink.
 */
describe('auction house — buy flow economics', () => {
  it('transfers the item to the buyer and the proceeds (minus cut) to the seller', () => {
    const db = getDb();
    const w = areaWorld('town');
    const seller = w.spawn('Seller');
    const buyer = w.spawn('Buyer');
    const sellerTok = 'tok-seller';
    const PRICE = 500;

    // Seller lists an item: it leaves their bag into escrow.
    w.giveItem(seller, 'iron_sword', 1);
    const uid = w.playerStats(seller)!.gear[0]!.uid;
    const item = w.mailTakeGear(seller, uid)!;
    const aid = createAuction(db, sellerTok, 'Seller', JSON.stringify(item), PRICE);
    expect(w.playerStats(seller)!.gear).toHaveLength(0);
    expect(loadAuctions(db)).toHaveLength(1);

    // Buyer buys: pays gold, receives the item; the listing is consumed.
    w.giveItem(buyer, 'gold', 1000);
    const a = getAuction(db, aid)!;
    expect(w.mailTakeGold(buyer, a.price)).toBe(true);
    const bought = JSON.parse(a.itemJson) as ItemInstance;
    expect(w.mailDeliver(buyer, 0, bought).ok).toBe(true);
    const payout = auctionPayout(a.price);
    sendMail(db, sellerTok, 'Auction House', payout, null, 'Sold');
    deleteAuction(db, aid);

    expect(w.playerStats(buyer)!.gold).toBe(500); // 1000 - 500
    expect(w.playerStats(buyer)!.gear).toHaveLength(1); // received the item
    expect(w.playerStats(buyer)!.gear[0]!.baseId).toBe('iron_sword');
    expect(loadAuctions(db)).toHaveLength(0); // listing consumed

    // Seller collects their mailed proceeds: nets price minus the 5% sink.
    const mail = loadMail(db, sellerTok);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.gold).toBe(payout);
    expect(payout).toBe(475); // 500 - 5% = 475; the 25g is the gold sink
  });
});
