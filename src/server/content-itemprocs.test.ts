import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import { resolveProcs } from './item-procs.js';

/**
 * Item procs are server-only runtime content: the DB (seeded from item-procs.ts defaults) is the
 * authority for which base items carry a chance-on-hit/crit effect. The roll/ICD brain stays pure
 * (item-procs.ts); the World applies fired effects. These tests cover the data wiring + that the
 * seeded procs feed the resolver correctly.
 */
describe('content item procs', () => {
  it('exposes the seeded procs (frostforged_glaive status, doomspike_partisan onCrit damage)', () => {
    const c = loadContent(openDatabase(':memory:'));
    const frost = c.itemProcs('frostforged_glaive');
    expect(frost).toHaveLength(1);
    expect(frost[0]!.trigger).toBe('onHit');
    expect(frost[0]!.effect).toEqual({ kind: 'status', ability: 'glacierspike' });

    const doom = c.itemProcs('doomspike_partisan');
    expect(doom).toHaveLength(1);
    expect(doom[0]!.trigger).toBe('onCrit');
    expect(doom[0]!.effect).toEqual({ kind: 'damage', amount: 22 });
  });

  it('exposes the additional seeded signature procs', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.itemProcs('serpentine_dagger')[0]!.effect).toEqual({
      kind: 'status',
      ability: 'poison_spit',
    });
    expect(c.itemProcs('reapers_scythe')[0]!.effect).toEqual({ kind: 'damage', amount: 20 });
    expect(c.itemProcs('moonsilver_saber')[0]!.trigger).toBe('onCrit');
  });

  it('a base item with no proc returns an empty list', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.itemProcs('iron_sword')).toEqual([]);
  });

  it('a seeded proc feeds the resolver and fires', () => {
    const c = loadContent(openDatabase(':memory:'));
    const fired = resolveProcs(
      c.itemProcs('frostforged_glaive'),
      { crit: false, now: 0 },
      new Map(),
      () => 0, // rng 0 < 0.25 chance → fires
    );
    expect(fired).toEqual([{ kind: 'status', ability: 'glacierspike' }]);
  });

  it('drops a malformed proc row (status with no ability)', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      'INSERT INTO item_procs (source_id,trigger,chance,icd_ms,effect,amount,ability) VALUES (?,?,?,?,?,?,?)',
    ).run('iron_sword', 'onHit', 1, 0, 'status', null, null);
    expect(loadContent(db).itemProcs('iron_sword')).toEqual([]); // bad row dropped, not crashed
  });

  it('loads a proc added only in the DB with a stable id', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      'INSERT INTO item_procs (source_id,trigger,chance,icd_ms,effect,amount,ability) VALUES (?,?,?,?,?,?,?)',
    ).run('iron_sword', 'onHit', 0.5, 1000, 'damage', 7, null);
    const procs = loadContent(db).itemProcs('iron_sword');
    expect(procs).toHaveLength(1);
    expect(procs[0]!.id).toBe('iron_sword#0');
    expect(procs[0]!.effect).toEqual({ kind: 'damage', amount: 7 });
  });
});
