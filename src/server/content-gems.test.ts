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

  it('a modifier gem with mult and grants_homing round-trips through loadContent', () => {
    // Insert a one-off support gem that carries both a damage penalty (mult) and the homing flag.
    const db = openDatabase(':memory:');
    db.prepare(
      'INSERT INTO gems (id,name,color,stat,value,tier,mult,grants_homing) VALUES (?,?,?,?,?,?,?,?)',
    ).run('cinnabar_t3', 'Cinnabar', '#ff6040', 'spellaoe', 0.1, 3, 0.75, 1);
    const list = loadContent(db).gems();
    const cinnabar = list.find((g) => g.id === 'cinnabar_t3');
    expect(cinnabar).toBeDefined();
    expect(cinnabar!.mult).toBe(0.75);
    expect(cinnabar!.grantsHoming).toBe(true);
  });
});
