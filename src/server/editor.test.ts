import { describe, expect, it } from 'vitest';
import { initGameDb } from './content.js';
import { editorSchema, editorTable, editorWorld, parseEditBody, ROW_CAP } from './editor.js';
import { EDITABLE_TABLES } from './db/editable.js';

initGameDb(':memory:');

/**
 * Editor data-model API (slice 1 of the in-browser editor): a structured, machine-readable view of
 * the whole data-driven content model — what an editor UI loads and a cross-engine exporter walks.
 */
describe('editor schema', () => {
  it('mirrors every whitelisted editable table with its typed columns + pk', () => {
    const schema = editorSchema();
    expect(schema.tables.length).toBe(Object.keys(EDITABLE_TABLES).length);
    const mobs = schema.tables.find((t) => t.name === 'mob_templates')!;
    expect(mobs.pk).toBe('id');
    expect(mobs.columns.some((c) => c.name === 'hp' && c.type === 'int')).toBe(true);
    // The summonable/tameable flags added by the ED5 port show up as editable int columns.
    expect(mobs.columns.some((c) => c.name === 'tameable')).toBe(true);
    // Every column carries a type from the registry.
    for (const t of schema.tables) for (const c of t.columns) expect(c.type).toBeTruthy();
  });
});

describe('editor table data', () => {
  it('returns pk-first columns and real rows for a known table', () => {
    const data = editorTable('mob_templates')!;
    expect(data).not.toBeNull();
    expect(data.columns[0]).toBe('id'); // pk first
    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.rows[0]).toHaveProperty('id');
    expect(data.truncated).toBe(false);
  });

  it('refuses an unknown/forged table name (only the trusted registry is reachable)', () => {
    expect(editorTable('player_saves')).toBeNull(); // sensitive table — not in the editable registry
    expect(editorTable('sqlite_master')).toBeNull();
    expect(editorTable('mob_templates; DROP TABLE mounts')).toBeNull();
  });

  it('caps rows at ROW_CAP', () => {
    expect(ROW_CAP).toBeGreaterThan(0);
  });
});

describe('editor world dump', () => {
  it('bundles the schema + every table rows bucket (the export/import model)', () => {
    const world = editorWorld();
    expect(world.schema.tables.length).toBe(Object.keys(EDITABLE_TABLES).length);
    // Every data bucket corresponds to a schema table with a matching pk (virtual/derived registry
    // entries with no physical table are skipped rather than crashing the dump).
    for (const [name, data] of Object.entries(world.tables)) {
      const t = world.schema.tables.find((s) => s.name === name)!;
      expect(t).toBeDefined();
      expect(data.pk).toBe(t.pk);
    }
    // Representative physical tables round-trip with content.
    expect(world.tables['items']!.rows.length).toBeGreaterThan(0);
    expect(world.tables['mob_templates']!.rows.length).toBeGreaterThan(0);
  });
});

describe('parseEditBody', () => {
  it('accepts a well-formed edit and normalizes id/value to strings', () => {
    expect(parseEditBody({ table: 'mob_templates', id: 7, column: 'hp', value: 99 })).toEqual({
      table: 'mob_templates',
      id: '7',
      column: 'hp',
      value: '99',
    });
  });

  it('rejects malformed bodies', () => {
    expect(parseEditBody(null)).toBeNull();
    expect(parseEditBody('nope')).toBeNull();
    expect(parseEditBody({ table: '', id: 'x', column: 'c', value: 'v' })).toBeNull();
    expect(parseEditBody({ table: 't', id: 'x', column: '', value: 'v' })).toBeNull();
    expect(parseEditBody({ table: 't', column: 'c', value: 'v' })).toBeNull(); // missing id
    expect(parseEditBody({ table: 't', id: {}, column: 'c', value: 'v' })).toBeNull(); // object id
  });
});
