import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import { UNIQUES, DEFAULT_UNIQUES, applyUniqueOverrides } from '../shared/uniques.js';

/**
 * Unique (named legendary) items are TrinityCore-style content: the DB (seeded from DEFAULT_UNIQUES)
 * is the runtime authority for the curated pool. Minting is server-side (the resulting ItemInstance
 * carries name/affixes to the client), so this is a server-only migration. Restore defaults after
 * each test so the shared singleton never leaks.
 */
afterEach(() => applyUniqueOverrides([]));

describe('content uniques', () => {
  it('exposes uniques seeded from the defaults', () => {
    const c = loadContent(openDatabase(':memory:'));
    const byId = new Map(c.uniques().map((u) => [u.id, u]));
    for (const def of DEFAULT_UNIQUES) expect(byId.get(def.id)).toEqual(def);
  });

  it('overlay changes a minted unique affix', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE unique_affixes SET value = ? WHERE unique_id = ? AND stat = ?').run(
      99,
      'widowmaker',
      'crit',
    );
    applyUniqueOverrides(loadContent(db).uniques());
    const wm = UNIQUES.find((u) => u.id === 'widowmaker');
    expect(wm?.affixes.find((a) => a.stat === 'crit')?.value).toBe(99);
  });

  it('supports a unique added only in the DB', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO uniques (id,name,base_id,flavor) VALUES (?,?,?,?)').run(
      'tst_blade',
      'Testblade',
      'iron_sword',
      null,
    );
    applyUniqueOverrides(loadContent(db).uniques());
    expect(UNIQUES.find((u) => u.id === 'tst_blade')?.name).toBe('Testblade');
  });

  it('reset restores the code defaults', () => {
    applyUniqueOverrides([]);
    expect(UNIQUES).toEqual(DEFAULT_UNIQUES);
  });
});
