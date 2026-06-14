import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import {
  RUNES,
  RUNEWORDS,
  DEFAULT_RUNES,
  DEFAULT_RUNEWORDS,
  applyRuneOverrides,
  applyRunewordOverrides,
  detectRuneword,
  runewordBonuses,
} from '../shared/runewords.js';

/**
 * Runes + runewords are TrinityCore-style content: the DB (seeded from the defaults) is the runtime
 * authority for the rune pool and runeword recipes. Detection/bonus application stays server-side
 * (the client receives the resulting computed affixes), so this is a server-only migration. Restore
 * defaults after each test so the shared singletons never leak.
 */
afterEach(() => {
  applyRuneOverrides([]);
  applyRunewordOverrides([]);
});

describe('content runes + runewords', () => {
  it('exposes runes seeded from the defaults', () => {
    const c = loadContent(openDatabase(':memory:'));
    const byId = new Map(c.runes().map((r) => [r.id, r]));
    for (const def of DEFAULT_RUNES) expect(byId.get(def.id)).toEqual(def);
  });

  it('exposes runewords seeded from the defaults (recipe + bonuses)', () => {
    const c = loadContent(openDatabase(':memory:'));
    const byId = new Map(c.runewords().map((r) => [r.id, r]));
    for (const def of DEFAULT_RUNEWORDS) expect(byId.get(def.id)).toEqual(def);
  });

  it('overlay makes detection/bonuses use the DB recipe', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE runeword_bonuses SET value = ? WHERE runeword_id = ? AND stat = ?').run(
      99,
      'rw_vigor',
      'move',
    );
    applyRunewordOverrides(loadContent(db).runewords());
    expect(runewordBonuses(['rune_el', 'rune_tir']).find((b) => b.stat === 'move')?.value).toBe(99);
  });

  it('supports a runeword added only in the DB (longest-match wins)', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO runewords (id,name,runes,flavor) VALUES (?,?,?,?)').run(
      'rw_test',
      'Testword',
      'rune_ort,rune_thul,rune_sol',
      null,
    );
    applyRunewordOverrides(loadContent(db).runewords());
    expect(detectRuneword(['rune_ort', 'rune_thul', 'rune_sol'])?.name).toBe('Testword');
  });

  it('reset restores the code defaults', () => {
    applyRunewordOverrides([]);
    applyRuneOverrides([]);
    expect(RUNEWORDS).toEqual(DEFAULT_RUNEWORDS);
    expect(RUNES).toEqual(DEFAULT_RUNES);
  });
});
