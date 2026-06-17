import { describe, expect, it } from 'vitest';
import { initGameDb } from './content.js';
import {
  addGuildXp,
  guildXp,
  guildLevel,
  guildLevelForXp,
  guildLevelProgress,
  clearGuildProgress,
  GUILD_XP_PER_LEVEL,
  GUILD_MAX_LEVEL,
} from './guild-progress.js';
import { addBankItem, bankItemCapacity, MAX_BANK_ITEMS } from './guild-bank.js';
import type { ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

describe('guild progression', () => {
  it('derives level from xp (1-based, clamped to max)', () => {
    expect(guildLevelForXp(0)).toBe(1);
    expect(guildLevelForXp(GUILD_XP_PER_LEVEL - 1)).toBe(1);
    expect(guildLevelForXp(GUILD_XP_PER_LEVEL)).toBe(2);
    expect(guildLevelForXp(GUILD_XP_PER_LEVEL * 3)).toBe(4);
    expect(guildLevelForXp(GUILD_XP_PER_LEVEL * 9999)).toBe(GUILD_MAX_LEVEL);
  });

  it('accumulates xp and reports the level crossing', () => {
    const gid = 4101;
    expect(guildXp(gid)).toBe(0);
    expect(guildLevel(gid)).toBe(1);
    const a = addGuildXp(gid, GUILD_XP_PER_LEVEL - 5);
    expect(a).toEqual({ before: 1, after: 1 }); // not yet
    const b = addGuildXp(gid, 10); // crosses into level 2
    expect(b).toEqual({ before: 1, after: 2 });
    expect(guildXp(gid)).toBe(GUILD_XP_PER_LEVEL + 5);
    addGuildXp(gid, -100); // non-positive is a no-op
    expect(guildXp(gid)).toBe(GUILD_XP_PER_LEVEL + 5);
  });

  it('reports progress into the current level', () => {
    const gid = 4102;
    addGuildXp(gid, GUILD_XP_PER_LEVEL + 120); // level 2, 120 into it
    expect(guildLevelProgress(gid)).toEqual({ into: 120, span: GUILD_XP_PER_LEVEL, level: 2 });
  });

  it('clears a disbanded guild’s progression', () => {
    const gid = 4103;
    addGuildXp(gid, GUILD_XP_PER_LEVEL * 2);
    expect(guildLevel(gid)).toBe(3);
    clearGuildProgress(gid);
    expect(guildXp(gid)).toBe(0);
    expect(guildLevel(gid)).toBe(1);
  });

  it('guild bank capacity grows with guild level (the leveling perk)', () => {
    const gid = 4104;
    // Level 1 (no xp) holds exactly the base.
    expect(bankItemCapacity(gid)).toBe(MAX_BANK_ITEMS);
    addGuildXp(gid, GUILD_XP_PER_LEVEL * 2); // level 3
    expect(guildLevel(gid)).toBe(3);
    expect(bankItemCapacity(gid)).toBeGreaterThan(MAX_BANK_ITEMS);
  });

  it('addBankItem respects the level-scaled capacity', () => {
    const gid = 4105;
    const item: ItemInstance = { uid: 1, baseId: 'iron_sword', name: 'Iron Sword' } as ItemInstance;
    // Fill to the base cap.
    for (let i = 0; i < MAX_BANK_ITEMS; i++) expect(addBankItem(gid, item)).toBe(true);
    expect(addBankItem(gid, item)).toBe(false); // level-1 guild is full at the base
    addGuildXp(gid, GUILD_XP_PER_LEVEL); // level 2 → more slots
    expect(addBankItem(gid, item)).toBe(true); // the perk opened room
  });
});
