import { describe, expect, it } from 'vitest';
import { initGameDb, reloadContent, getDb } from './content.js';
import {
  editContent,
  getRow,
  listTables,
  listColumns,
  cloneRow,
  deleteRow,
} from './content-edit.js';

initGameDb(':memory:');

describe('generic content live-edit (the in-game engine for everything)', () => {
  it('edits a spell and a reload reflects it', () => {
    const r = editContent('abilities', 'fireball', 'damage', '55');
    expect(r.ok).toBe(true);
    expect(reloadContent().ability('fireball')?.damage).toBe(55);
  });

  it('edits a monster stat and clamps out-of-range values', () => {
    expect(editContent('mob_templates', 'wolf', 'hp', '99999999').ok).toBe(true);
    expect(getRow('mob_templates', 'wolf')).toContain('hp=1000000'); // clamped to the max
    expect(reloadContent().mobTemplate('wolf')?.hp).toBe(1000000);
  });

  it('rejects unknown tables, non-editable columns, bad values, and missing rows', () => {
    expect(editContent('nope', 'x', 'y', 'z').ok).toBe(false);
    expect(editContent('abilities', 'fireball', 'totally_made_up', '1').ok).toBe(false);
    expect(editContent('abilities', 'fireball', 'damage', 'abc').ok).toBe(false);
    expect(editContent('abilities', 'no_such_spell', 'damage', '5').ok).toBe(false);
  });

  it('discovers the schema', () => {
    expect(listTables()).toContain('abilities');
    expect(listColumns('mob_templates')).toContain('hp:int');
  });
});

describe('content row clone + delete (the editor create/remove primitives)', () => {
  it('clones a text-pk row under a new id, copying all columns', () => {
    const r = cloneRow('mob_templates', 'wolf', 'wolf_clone');
    expect(r.ok).toBe(true);
    expect(r.id).toBe('wolf_clone');
    const c = reloadContent();
    expect(c.mobTemplate('wolf_clone')).toBeDefined();
    expect(c.mobTemplate('wolf_clone')?.hp).toBe(c.mobTemplate('wolf')?.hp); // full duplicate
  });

  it('rejects an unknown table, missing source, or a duplicate new id', () => {
    expect(cloneRow('nope', 'x', 'y').ok).toBe(false);
    expect(cloneRow('mob_templates', 'no_such_mob', 'z').ok).toBe(false);
    expect(cloneRow('mob_templates', 'wolf', 'skeleton').ok).toBe(false); // id already taken
  });

  it('deletes a row, and a reload no longer sees it', () => {
    cloneRow('items', 'iron_sword', 'iron_sword_tmp');
    expect(reloadContent().item('iron_sword_tmp')).toBeDefined();
    expect(deleteRow('items', 'iron_sword_tmp').ok).toBe(true);
    expect(reloadContent().item('iron_sword_tmp')).toBeUndefined();
    expect(deleteRow('items', 'iron_sword_tmp').ok).toBe(false); // already gone
  });

  it('refuses to delete a row another table references (FK guard)', () => {
    // A creature_spawn referencing 'skeleton' makes deleting that template an FK violation.
    getDb()
      .prepare('INSERT INTO creature_spawns (area_id,template_id,x,y,flags) VALUES (?,?,?,?,?)')
      .run('crypt', 'skeleton', 50, 50, 0);
    const r = deleteRow('mob_templates', 'skeleton');
    expect(r.ok).toBe(false);
    expect(r.message.toLowerCase()).toContain('referenced');
    expect(reloadContent().mobTemplate('skeleton')).toBeDefined(); // still there
  });
});
