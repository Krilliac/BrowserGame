import { describe, expect, it } from 'vitest';
import { initGameDb, getDb, reloadContent } from './content.js';
import { createEntity } from './editor-create.js';

/**
 * The editor's CREATE primitive (`createEntity`): the Add palette drops a new placeable at authored
 * coordinates. These tests insert via the primitive, then assert both the raw row exists at those
 * coords and that reloaded content surfaces the new entity — plus every rejection path.
 */
initGameDb(':memory:');

describe('createEntity (editor Add palette)', () => {
  it('creates a decor prop: raw row at the coords + reloaded content grows', () => {
    const before = reloadContent().area('town')?.decor?.length ?? 0;
    const r = createEntity('decor', 'town', 123, 456, 'rock');
    expect(r.ok).toBe(true);
    expect(r.id).toBeDefined();

    // Raw row stored at the authored coords (decor x/y are REAL, stored as-is).
    const row = getDb().prepare('SELECT area_id, kind, x, y FROM decor WHERE id = ?').get(r.id) as
      | { area_id: string; kind: string; x: number; y: number }
      | undefined;
    expect(row).toMatchObject({ area_id: 'town', kind: 'rock', x: 123, y: 456 });

    // Reloaded content surfaces the new prop (the decor list for town grew by one).
    expect(reloadContent().area('town')?.decor?.length ?? 0).toBe(before + 1);
  });

  it('creates a creature_spawns with a real template + content grows', () => {
    const before = reloadContent().creatureSpawns('town').length;
    const r = createEntity('creature_spawns', 'town', 200, 220, 'skeleton');
    expect(r.ok).toBe(true);

    const row = getDb()
      .prepare('SELECT area_id, template_id, x, y FROM creature_spawns WHERE uid = ?')
      .get(r.id) as { area_id: string; template_id: string; x: number; y: number };
    expect(row).toMatchObject({ area_id: 'town', template_id: 'skeleton', x: 200, y: 220 });

    expect(reloadContent().creatureSpawns('town').length).toBe(before + 1);
  });

  it('creates an npc with name defaulting to kind', () => {
    const before = reloadContent().npcs('town').length;
    const r = createEntity('npcs', 'town', 300, 320, 'vendor');
    expect(r.ok).toBe(true);

    const row = getDb()
      .prepare('SELECT area_id, name, kind, x, y FROM npcs WHERE id = ?')
      .get(r.id) as { area_id: string; name: string; kind: string; x: number; y: number };
    expect(row).toMatchObject({ area_id: 'town', name: 'vendor', kind: 'vendor', x: 300, y: 320 });

    expect(reloadContent().npcs('town').length).toBe(before + 1);
  });

  it('rounds integer-coord tables (creature_spawns/npcs) to whole numbers', () => {
    const r = createEntity('creature_spawns', 'town', 10.7, 20.2, 'skeleton');
    expect(r.ok).toBe(true);
    const row = getDb().prepare('SELECT x, y FROM creature_spawns WHERE uid = ?').get(r.id) as {
      x: number;
      y: number;
    };
    expect(row).toMatchObject({ x: 11, y: 20 });
  });

  it('rejects an unknown creature template (FK column)', () => {
    const r = createEntity('creature_spawns', 'town', 5, 5, 'definitely_not_a_mob');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/template/i);
  });

  it('rejects an unknown area', () => {
    const r = createEntity('decor', 'no_such_area', 5, 5, 'rock');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/area/i);
  });

  it('rejects an unknown / non-placeable table', () => {
    expect(createEntity('items', 'town', 5, 5, 'whatever').ok).toBe(false);
    expect(createEntity('mob_templates', 'town', 5, 5, 'skeleton').ok).toBe(false);
  });

  it('rejects non-finite coordinates', () => {
    expect(createEntity('decor', 'town', NaN, 5, 'rock').ok).toBe(false);
    expect(createEntity('decor', 'town', 5, Infinity, 'rock').ok).toBe(false);
  });
});
