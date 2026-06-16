import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import {
  addFriend,
  isValidToken,
  loadFriends,
  loadSave,
  newPlayerToken,
  removeFriend,
  storeSave,
  createGuildRow,
  deleteGuildRow,
  guildName,
  guildOf,
  guildMembers,
  addGuildMemberRow,
  removeGuildMemberRow,
  setGuildRankRow,
  tokenForName,
  sendMail,
  loadMail,
  getMail,
  mailCount,
  deleteMail,
} from './player-store.js';
import type { PlayerSave } from './world.js';

function sampleSave(name = 'Hero'): PlayerSave {
  return {
    name,
    hue: 120,
    hp: 80,
    mana: 50,
    level: 7,
    xp: 1234,
    gold: 99,
    loot: [['wolf_pelt', 3]],
    gear: [{ uid: 1, baseId: 'iron_sword', rarity: 'rare', power: 21, hp: 0, affixes: [] }],
    equipment: {
      mainhand: {
        uid: 2,
        baseId: 'iron_sword',
        rarity: 'epic',
        power: 33,
        hp: 0,
        affixes: [{ stat: 'crit', value: 7 }],
      },
    },
    god: false,
    quests: [['wolf_cull', 2]],
    questsDone: ['intro'],
  };
}

describe('player tokens', () => {
  it('mints well-formed tokens that validate', () => {
    const t = newPlayerToken();
    expect(isValidToken(t)).toBe(true);
  });

  it('rejects malformed / unsafe tokens', () => {
    expect(isValidToken('')).toBe(false);
    expect(isValidToken('not-hex!!')).toBe(false);
    expect(isValidToken("abc'; DROP TABLE player_saves;--")).toBe(false);
    expect(isValidToken(undefined)).toBe(false);
    expect(isValidToken('a'.repeat(200))).toBe(false);
  });
});

describe('player save store', () => {
  it('returns null for an unknown token', () => {
    const db = openDatabase(':memory:');
    expect(loadSave(db, newPlayerToken())).toBeNull();
  });

  it('round-trips a save and overwrites on re-store', () => {
    const db = openDatabase(':memory:');
    const token = newPlayerToken();
    storeSave(db, token, sampleSave());
    const loaded = loadSave(db, token);
    expect(loaded?.level).toBe(7);
    expect(loaded?.equipment.mainhand?.rarity).toBe('epic');
    expect(loaded?.gear[0]?.baseId).toBe('iron_sword');

    storeSave(db, token, { ...sampleSave('Hero2'), level: 12 });
    expect(loadSave(db, token)?.level).toBe(12);
    expect(loadSave(db, token)?.name).toBe('Hero2');
  });

  it('preserves the per-character counters through the DB round-trip', () => {
    // The save is persisted as whole-object JSON (not a column allowlist), so progression counters
    // added over time survive without per-field plumbing. Pin that — a future switch to an allowlist
    // that forgot a field would silently wipe a player's kills/bestiary/stash on every login.
    const db = openDatabase(':memory:');
    const token = newPlayerToken();
    const save: PlayerSave = {
      ...sampleSave('Counter'),
      kills: 137,
      bossKills: 9,
      bestiary: ['goblin', 'skeleton', 'wolf'],
      deathlessStreak: 22,
      bestDeathlessStreak: 88,
      stashCap: 80,
    };
    storeSave(db, token, save);
    const loaded = loadSave(db, token)!;
    expect(loaded.kills).toBe(137);
    expect(loaded.bossKills).toBe(9);
    expect(loaded.bestiary).toEqual(['goblin', 'skeleton', 'wolf']);
    expect(loaded.deathlessStreak).toBe(22);
    expect(loaded.bestDeathlessStreak).toBe(88);
    expect(loaded.stashCap).toBe(80);
  });

  it('tolerates a pre-affix save by defaulting affixes to []', () => {
    const db = openDatabase(':memory:');
    const token = newPlayerToken();
    // A save written before gear affixes existed: instances have no `affixes` field.
    const legacy = {
      name: 'Old',
      hue: 0,
      hp: 50,
      mana: 30,
      level: 3,
      xp: 100,
      gold: 5,
      loot: [],
      gear: [{ uid: 1, baseId: 'iron_sword', rarity: 'rare', power: 18, hp: 0 }],
      weapon: { uid: 2, baseId: 'iron_sword', rarity: 'common', power: 13, hp: 0 },
      armor: null,
      god: false,
      quests: [],
      questsDone: [],
    };
    db.prepare('INSERT INTO player_saves (token,name,data,updated_at) VALUES (?,?,?,?)').run(
      token,
      'Old',
      JSON.stringify(legacy),
      '2020-01-01',
    );
    const loaded = loadSave(db, token)!;
    // The legacy { weapon, armor } shape migrates into the equipment map, with affixes defaulted.
    expect(loaded.equipment.mainhand?.baseId).toBe('iron_sword');
    expect(loaded.equipment.mainhand?.affixes).toEqual([]);
    expect(loaded.gear[0]?.affixes).toEqual([]);
  });
});

describe('friends list persistence', () => {
  it('round-trips add/load/remove: sorted, deduped, per-owner, case-insensitive remove', () => {
    const db = openDatabase(':memory:');
    const a = newPlayerToken();
    const b = newPlayerToken();

    addFriend(db, a, 'Bob');
    addFriend(db, a, 'Bob'); // idempotent (PK) — no duplicate
    addFriend(db, a, 'Alice');
    addFriend(db, b, 'Carol'); // a different owner's list

    expect(loadFriends(db, a)).toEqual(['Alice', 'Bob']); // sorted, deduped, scoped to a
    expect(loadFriends(db, b)).toEqual(['Carol']); // not leaked across owners

    removeFriend(db, a, 'bob'); // case-insensitive match on the stored 'Bob'
    expect(loadFriends(db, a)).toEqual(['Alice']);

    removeFriend(db, a, 'Nobody'); // unknown name → no-op, no throw
    expect(loadFriends(db, a)).toEqual(['Alice']);
  });

  it('returns an empty list for a token with no friends', () => {
    const db = openDatabase(':memory:');
    expect(loadFriends(db, newPlayerToken())).toEqual([]);
  });
});

describe('guild persistence', () => {
  it('creates a guild, adds/ranks/removes members, and disbands', () => {
    const db = openDatabase(':memory:');
    const a = newPlayerToken();
    const b = newPlayerToken();

    const gid = createGuildRow(db, 'Ironwolves')!;
    expect(gid).toBeGreaterThan(0);
    expect(createGuildRow(db, 'ironwolves')).toBeNull(); // UNIQUE NOCASE — name taken
    expect(guildName(db, gid)).toBe('Ironwolves');

    addGuildMemberRow(db, gid, a, 'Alice', 'leader');
    addGuildMemberRow(db, gid, b, 'Bob', 'member');
    expect(guildOf(db, a)).toEqual({ guildId: gid, rank: 'leader' });
    expect(guildMembers(db, gid).map((m) => m.name)).toEqual(['Alice', 'Bob']); // leader first

    setGuildRankRow(db, b, 'officer');
    expect(guildOf(db, b)!.rank).toBe('officer');

    removeGuildMemberRow(db, b);
    expect(guildOf(db, b)).toBeUndefined();

    deleteGuildRow(db, gid);
    expect(guildName(db, gid)).toBeUndefined();
    expect(guildOf(db, a)).toBeUndefined(); // membership rows cascade-removed
  });
});

describe('mail persistence', () => {
  it('sends, lists, scopes, counts, and deletes inbox mail', () => {
    const db = openDatabase(':memory:');
    const a = newPlayerToken();
    const b = newPlayerToken();

    sendMail(db, a, 'Bob', 100, null);
    sendMail(db, a, 'Cara', 0, '{"uid":7}');
    sendMail(db, b, 'Dan', 5, null); // a different recipient's inbox

    const inbox = loadMail(db, a);
    expect(inbox).toHaveLength(2);
    expect(inbox[0]!.senderName).toBe('Bob');
    expect(inbox[1]!.itemJson).toBe('{"uid":7}');
    expect(mailCount(db, a)).toBe(2);
    expect(loadMail(db, b)).toHaveLength(1); // not leaked across recipients

    const one = getMail(db, inbox[0]!.id, a)!;
    expect(one.gold).toBe(100);
    expect(getMail(db, inbox[0]!.id, b)).toBeUndefined(); // can't read another's mail by id

    deleteMail(db, inbox[0]!.id);
    expect(mailCount(db, a)).toBe(1);
  });

  it('resolves the most-recent token for a character name', () => {
    const db = openDatabase(':memory:');
    const t = newPlayerToken();
    storeSave(db, t, sampleSave('Mailee'));
    expect(tokenForName(db, 'mailee')).toBe(t); // case-insensitive
    expect(tokenForName(db, 'Nobody')).toBeNull();
  });
});
