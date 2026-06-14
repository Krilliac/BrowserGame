import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import {
  ITEM_SETS,
  DEFAULT_ITEM_SETS,
  applyItemSetOverrides,
  setBonuses,
} from '../shared/item-sets.js';

/**
 * Item sets are TrinityCore/Flare-style content: the DB (seeded from the code defaults) is the
 * runtime authority for set membership + threshold bonuses. Detection/application stays server-side
 * (the client receives the resulting computed affixes), so this is a server-only migration. Restore
 * defaults after each test so the shared ITEM_SETS singleton never leaks.
 */
afterEach(() => applyItemSetOverrides([]));

describe('content item sets', () => {
  it('exposes item sets seeded from the defaults (membership + bonuses)', () => {
    const c = loadContent(openDatabase(':memory:'));
    const byId = new Map(c.itemSets().map((s) => [s.id, s]));
    for (const def of DEFAULT_ITEM_SETS) expect(byId.get(def.id)).toEqual(def);
  });

  it('overlay makes setBonuses use the DB value', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      'UPDATE item_set_bonuses SET value = ? WHERE set_id = ? AND required_pieces = ? AND stat = ?',
    ).run(77, 'set_ironclad', 2, 'armor');
    applyItemSetOverrides(loadContent(db).itemSets());
    expect(setBonuses(['iron_helm', 'iron_armor']).find((a) => a.stat === 'armor')?.value).toBe(77);
  });

  it('supports a set added only in the DB', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO item_sets (id,name,pieces,flavor) VALUES (?,?,?,?)').run(
      'set_db',
      'DB Set',
      'copper_ring,silver_ring',
      null,
    );
    db.prepare(
      'INSERT INTO item_set_bonuses (set_id,required_pieces,stat,value,sort_order) VALUES (?,?,?,?,?)',
    ).run('set_db', 2, 'crit', 42, 0);
    applyItemSetOverrides(loadContent(db).itemSets());
    expect(setBonuses(['copper_ring', 'silver_ring']).find((a) => a.stat === 'crit')?.value).toBe(
      42,
    );
  });

  it('reset restores the code defaults', () => {
    applyItemSetOverrides([]);
    expect(ITEM_SETS).toEqual(DEFAULT_ITEM_SETS);
  });
});
