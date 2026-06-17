import { describe, expect, it } from 'vitest';
import { initGameDb, getDb, reloadContent, getContent } from './content.js';
import { exportPack, importPack } from './editor-pack.js';

initGameDb(':memory:');

/**
 * Full-world content pack export/import: serialize the whole data-driven game into one portable
 * document and apply one back, transactionally — the engine's save/load + backup/restore primitive.
 */
describe('exportPack', () => {
  it('produces a self-describing pack with the items table populated', () => {
    const pack = exportPack();
    expect(pack.format).toBe('browsergame-pack');
    expect(pack.version).toBe(1);
    expect(typeof pack.tables).toBe('object');

    const items = pack.tables['items'];
    expect(items).toBeDefined();
    expect(items!.pk).toBe('id');
    expect(items!.columns[0]).toBe('id'); // pk first
    expect(items!.rows.length).toBeGreaterThan(0);
    // Representative second table also rides along.
    expect(pack.tables['mob_templates']!.rows.length).toBeGreaterThan(0);
  });
});

describe('importPack round-trip', () => {
  it('re-exports identically after writing a freshly-exported pack (stable round-trip)', () => {
    const before = exportPack();
    const res = importPack(getDb(), before);
    expect(res.ok).toBe(true);
    expect(res.tablesWritten).toBeGreaterThan(0);
    expect(res.skipped).toEqual([]);

    reloadContent();
    const after = exportPack();

    // Full structural stability: the serialized world is identical through a write + reload.
    expect(after).toEqual(before);
    // And explicitly: representative row counts are preserved.
    expect(after.tables['items']!.rows.length).toBe(before.tables['items']!.rows.length);
    expect(after.tables['mob_templates']!.rows.length).toBe(
      before.tables['mob_templates']!.rows.length,
    );
  });
});

describe('importPack writes mutations through', () => {
  it('a changed item name in the pack reaches live content after import + reload', () => {
    const pack = exportPack();
    const items = pack.tables['items']!;
    const idCol = items.pk;
    const target = items.rows[0]!;
    const id = String(target[idCol]);
    const newName = 'Pack-Renamed Relic';
    target.name = newName;

    const res = importPack(getDb(), pack);
    expect(res.ok).toBe(true);

    reloadContent();
    expect(getContent().item(id)!.name).toBe(newName);
  });
});

describe('importPack rejects a bad pack', () => {
  it('wrong format → ok:false and content is unchanged', () => {
    const id = exportPack().tables['items']!.rows[0]![exportPack().tables['items']!.pk];
    const itemId = String(id);
    const nameBefore = getContent().item(itemId)!.name;

    const res = importPack(getDb(), { format: 'not-a-pack', version: 1, tables: {} });
    expect(res.ok).toBe(false);
    expect(res.tablesWritten).toBe(0);

    reloadContent();
    expect(getContent().item(itemId)!.name).toBe(nameBefore);
  });

  it('non-object / missing fields → ok:false', () => {
    expect(importPack(getDb(), null).ok).toBe(false);
    expect(importPack(getDb(), 'nope').ok).toBe(false);
    expect(importPack(getDb(), { format: 'browsergame-pack', version: 2, tables: {} }).ok).toBe(
      false,
    );
    expect(importPack(getDb(), { format: 'browsergame-pack', version: 1 }).ok).toBe(false);
  });

  it('skips unknown tables but still applies known ones', () => {
    const pack = exportPack();
    // Inject a forged table name alongside the real ones.
    (pack.tables as Record<string, unknown>)['player_saves'] = {
      pk: 'id',
      columns: ['id'],
      rows: [{ id: 'x' }],
    };
    const res = importPack(getDb(), pack);
    expect(res.ok).toBe(true);
    expect(res.skipped).toContain('player_saves');
    reloadContent();
  });
});
