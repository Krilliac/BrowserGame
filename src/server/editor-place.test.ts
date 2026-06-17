import { describe, it, expect, beforeAll } from 'vitest';
import { initGameDb, getDb, reloadContent } from './content.js';
import { moveEntity, canMoveTable } from './editor-place.js';

// In-memory DB seeded from the bundled content schema/data — the same setup content-edit.test.ts uses.
beforeAll(() => {
  initGameDb(':memory:');
});

/** Insert one decor prop (REAL x,y) and return its rowid. */
function insertDecor(x: number, y: number): string {
  const info = getDb()
    .prepare('INSERT INTO decor (area_id, kind, x, y) VALUES (?,?,?,?)')
    .run('town', 'crate', x, y);
  return String(info.lastInsertRowid);
}

describe('canMoveTable', () => {
  it('is true for placeable tables with authored x/y', () => {
    expect(canMoveTable('decor')).toBe(true);
    expect(canMoveTable('creature_spawns')).toBe(true);
    expect(canMoveTable('npcs')).toBe(true);
  });

  it('is false for tables without authored positions', () => {
    expect(canMoveTable('items')).toBe(false);
    expect(canMoveTable('quests')).toBe(false);
    expect(canMoveTable('abilities')).toBe(false);
    expect(canMoveTable('nope_not_a_table')).toBe(false);
  });
});

describe('moveEntity', () => {
  it('moves a decor row to new authored coords (REAL, stored as-is)', () => {
    const id = insertDecor(10, 20);
    const r = moveEntity('decor', id, 123.5, 456.25);
    expect(r.ok).toBe(true);

    const row = getDb().prepare('SELECT x, y FROM decor WHERE id = ?').get(id) as {
      x: number;
      y: number;
    };
    expect(row.x).toBe(123.5);
    expect(row.y).toBe(456.25);
  });

  it('rounds coordinates for INTEGER tables (creature_spawns)', () => {
    const info = getDb()
      .prepare('INSERT INTO creature_spawns (area_id, template_id, x, y, flags) VALUES (?,?,?,?,?)')
      .run('crypt', 'skeleton', 0, 0, 0);
    const uid = String(info.lastInsertRowid);

    const r = moveEntity('creature_spawns', uid, 99.6, 12.4);
    expect(r.ok).toBe(true);

    const row = getDb().prepare('SELECT x, y FROM creature_spawns WHERE uid = ?').get(uid) as {
      x: number;
      y: number;
    };
    expect(row.x).toBe(100);
    expect(row.y).toBe(12);
  });

  it('reloadContent reflects the moved position', () => {
    const id = insertDecor(1, 1);
    moveEntity('decor', id, 777, 888);
    reloadContent(); // mirrors what the host does after an edit — must not throw
    const row = getDb().prepare('SELECT x, y FROM decor WHERE id = ?').get(id) as {
      x: number;
      y: number;
    };
    expect(row.x).toBe(777);
    expect(row.y).toBe(888);
  });

  it('rejects an unknown table', () => {
    const r = moveEntity('not_a_table', '1', 0, 0);
    expect(r.ok).toBe(false);
    expect(r.message.toLowerCase()).toContain('unknown table');
  });

  it('rejects an editable table that has no movable position', () => {
    expect(moveEntity('items', 'iron_sword', 0, 0).ok).toBe(false);
    const r = moveEntity('quests', 'some_quest', 0, 0);
    expect(r.ok).toBe(false);
    expect(r.message.toLowerCase()).toContain('no movable position');
  });

  it('rejects a missing row', () => {
    const r = moveEntity('decor', '99999999', 0, 0);
    expect(r.ok).toBe(false);
    expect(r.message.toLowerCase()).toContain('no such');
  });

  it('rejects non-finite coordinates', () => {
    const id = insertDecor(5, 5);
    expect(moveEntity('decor', id, Number.NaN, 10).ok).toBe(false);
    expect(moveEntity('decor', id, 10, Number.POSITIVE_INFINITY).ok).toBe(false);
    // The row must be untouched by a rejected move.
    const row = getDb().prepare('SELECT x, y FROM decor WHERE id = ?').get(id) as {
      x: number;
      y: number;
    };
    expect(row.x).toBe(5);
    expect(row.y).toBe(5);
  });
});
