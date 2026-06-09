import { describe, expect, it } from 'vitest';
import { initGameDb, reloadContent } from './content.js';
import { editContent, getRow, listTables, listColumns } from './content-edit.js';

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
