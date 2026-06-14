import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import { GEMS, DEFAULT_GEMS, applyGemOverrides, gemDef } from '../shared/gems.js';

/**
 * Gems are TrinityCore-style content: the DB (seeded from DEFAULT_GEMS) is the runtime authority for
 * the gem catalog. Both sides overlay the shared GEMS catalog from their source (server: DB; client:
 * content packet). Restore defaults after each test so the shared singleton never leaks.
 */
afterEach(() => applyGemOverrides([]));

describe('content gems', () => {
  it('exposes every gem seeded from the defaults', () => {
    const c = loadContent(openDatabase(':memory:'));
    const byId = new Map(c.gems().map((g) => [g.id, g]));
    for (const [id, def] of Object.entries(DEFAULT_GEMS)) {
      expect(byId.get(id)).toEqual(def);
    }
  });

  it('overlays gem tuning onto the shared catalog', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE gems SET value = ? WHERE id = ?').run(99, 'ruby_t1');
    applyGemOverrides(loadContent(db).gems());
    expect(gemDef('ruby_t1')?.value).toBe(99);
    expect(GEMS.ruby_t1?.value).toBe(99);
  });

  it('supports a brand-new gem added only in the DB', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO gems (id,name,color,stat,value,tier) VALUES (?,?,?,?,?,?)').run(
      'garnet_t1',
      'Garnet',
      '#a00000',
      'power',
      4,
      1,
    );
    applyGemOverrides(loadContent(db).gems());
    expect(gemDef('garnet_t1')?.name).toBe('Garnet');
  });

  it('applyGemOverrides([]) restores the code defaults', () => {
    applyGemOverrides([
      { id: 'ruby_t1', name: 'X', color: '#000000', stat: 'power', value: 1, tier: 1 },
    ]);
    expect(gemDef('ruby_t1')?.value).toBe(1);
    applyGemOverrides([]);
    expect(gemDef('ruby_t1')?.value).toBe(DEFAULT_GEMS.ruby_t1!.value);
  });
});
