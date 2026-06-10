import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { isValidToken, loadSave, newPlayerToken, storeSave } from './player-store.js';
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
