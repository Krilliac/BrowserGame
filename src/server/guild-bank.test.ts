import { describe, it, expect, beforeEach } from 'vitest';
import { initGameDb, getDb } from './content.js';
import type { ItemInstance } from '../shared/items.js';
import {
  MAX_BANK_ITEMS,
  bankGold,
  depositGold,
  withdrawGold,
  bankItems,
  bankItemsWithIds,
  bankItemCount,
  addBankItem,
  takeBankItem,
  canDeposit,
  canWithdraw,
  clearBank,
} from './guild-bank.js';

/** A minimal but realistic ItemInstance to round-trip through the bank's JSON storage. */
function makeItem(uid: number): ItemInstance {
  return {
    uid,
    baseId: 'sword_iron',
    rarity: 'rare',
    power: 12,
    hp: 0,
    affixes: [{ stat: 'power', value: 4 }],
    sockets: [null, 'gem_ruby'],
  };
}

const GUILD = 1;
const OTHER = 2;

beforeEach(() => {
  // Fresh in-memory DB per test so rows never leak between cases.
  initGameDb(':memory:');
});

describe('guild bank gold', () => {
  it('starts at zero and deposits accumulate via UPSERT', () => {
    expect(bankGold(GUILD)).toBe(0);
    depositGold(GUILD, 100);
    depositGold(GUILD, 50);
    expect(bankGold(GUILD)).toBe(150);
  });

  it('clamps non-positive deposits to a no-op', () => {
    depositGold(GUILD, 100);
    depositGold(GUILD, 0);
    depositGold(GUILD, -25);
    expect(bankGold(GUILD)).toBe(100);
  });

  it('withdraws when funds suffice and subtracts the amount', () => {
    depositGold(GUILD, 100);
    expect(withdrawGold(GUILD, 40)).toBe(true);
    expect(bankGold(GUILD)).toBe(60);
  });

  it('refuses an insufficient or non-positive withdraw without changing the balance', () => {
    depositGold(GUILD, 30);
    expect(withdrawGold(GUILD, 31)).toBe(false);
    expect(withdrawGold(GUILD, 0)).toBe(false);
    expect(withdrawGold(GUILD, -5)).toBe(false);
    expect(bankGold(GUILD)).toBe(30);
  });

  it('keeps each guild bank independent', () => {
    depositGold(GUILD, 100);
    depositGold(OTHER, 200);
    expect(bankGold(GUILD)).toBe(100);
    expect(bankGold(OTHER)).toBe(200);
  });
});

describe('guild bank items', () => {
  it('round-trips an ItemInstance through JSON storage', () => {
    const item = makeItem(42);
    expect(addBankItem(GUILD, item)).toBe(true);
    expect(bankItemCount(GUILD)).toBe(1);
    const stored = bankItems(GUILD);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual(item);
  });

  it('exposes row ids alongside items for the UI/host', () => {
    addBankItem(GUILD, makeItem(1));
    addBankItem(GUILD, makeItem(2));
    const withIds = bankItemsWithIds(GUILD);
    expect(withIds).toHaveLength(2);
    expect(withIds[0]!.id).toBeTypeOf('number');
    expect(withIds[0]!.item.uid).toBe(1);
    expect(withIds[1]!.item.uid).toBe(2);
  });

  it('takes an item by row id, returns it, and removes the row', () => {
    addBankItem(GUILD, makeItem(7));
    const rowId = bankItemsWithIds(GUILD)[0]!.id;
    const taken = takeBankItem(GUILD, rowId);
    expect(taken?.uid).toBe(7);
    expect(bankItemCount(GUILD)).toBe(0);
    // Taking the same row again yields null (already gone).
    expect(takeBankItem(GUILD, rowId)).toBeNull();
  });

  it('scopes take to the owning guild — a member cannot pull another guild’s item by id', () => {
    addBankItem(OTHER, makeItem(99));
    const otherRowId = bankItemsWithIds(OTHER)[0]!.id;
    // GUILD tries to take OTHER's row id.
    expect(takeBankItem(GUILD, otherRowId)).toBeNull();
    // OTHER's item is untouched.
    expect(bankItemCount(OTHER)).toBe(1);
  });

  it('skips corrupt rows when listing', () => {
    addBankItem(GUILD, makeItem(1));
    getDb()
      .prepare('INSERT INTO guild_bank_items (guild_id, item_json) VALUES (?, ?)')
      .run(GUILD, '{not valid json');
    expect(bankItems(GUILD)).toHaveLength(1);
    // The corrupt row still counts toward the cap.
    expect(bankItemCount(GUILD)).toBe(2);
  });

  it('caps the bank at MAX_BANK_ITEMS', () => {
    for (let i = 0; i < MAX_BANK_ITEMS; i++) {
      expect(addBankItem(GUILD, makeItem(i))).toBe(true);
    }
    expect(bankItemCount(GUILD)).toBe(MAX_BANK_ITEMS);
    expect(addBankItem(GUILD, makeItem(999))).toBe(false);
    expect(bankItemCount(GUILD)).toBe(MAX_BANK_ITEMS);
  });
});

describe('guild bank policy', () => {
  it('lets any rank deposit', () => {
    expect(canDeposit('member')).toBe(true);
    expect(canDeposit('officer')).toBe(true);
    expect(canDeposit('leader')).toBe(true);
  });

  it('lets only leader/officer withdraw (members cannot — anti-grief)', () => {
    expect(canWithdraw('leader')).toBe(true);
    expect(canWithdraw('officer')).toBe(true);
    expect(canWithdraw('member')).toBe(false);
  });
});

describe('clearBank', () => {
  it('empties both gold and items for a disbanded guild', () => {
    depositGold(GUILD, 500);
    addBankItem(GUILD, makeItem(1));
    addBankItem(GUILD, makeItem(2));
    // A second guild's bank must survive the clear.
    depositGold(OTHER, 10);
    addBankItem(OTHER, makeItem(3));

    clearBank(GUILD);

    expect(bankGold(GUILD)).toBe(0);
    expect(bankItemCount(GUILD)).toBe(0);
    expect(bankGold(OTHER)).toBe(10);
    expect(bankItemCount(OTHER)).toBe(1);
  });
});
