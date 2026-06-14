import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import {
  HIRELING_TEMPLATES,
  DEFAULT_HIRELING_TEMPLATES,
  applyHirelingOverrides,
  hirelingTemplate,
} from './hirelings.js';

/**
 * Hireling templates are TrinityCore-style content: the DB (seeded from DEFAULT_HIRELING_TEMPLATES)
 * is the runtime authority for the mercenary roster. Server-only (the recruiter offers carry
 * type/name/cost to the client). Restore defaults after each test.
 */
afterEach(() => applyHirelingOverrides([]));

describe('content hireling templates', () => {
  it('seeds templates from the defaults', () => {
    const c = loadContent(openDatabase(':memory:'));
    const byType = new Map(c.hirelingTemplates().map((h) => [h.type, h]));
    for (const [type, def] of Object.entries(DEFAULT_HIRELING_TEMPLATES)) {
      expect(byType.get(type)).toEqual(def);
    }
  });

  it('overlay changes a template stat', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE hireling_templates SET speed = ? WHERE type = ?').run(999, 'guard');
    applyHirelingOverrides(loadContent(db).hirelingTemplates());
    expect(hirelingTemplate('guard')?.speed).toBe(999);
  });

  it('supports a hireling added only in the DB', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      'INSERT INTO hireling_templates (type,name,behavior,speed,attack_range,kite_range,attack_cooldown_ms) VALUES (?,?,?,?,?,?,?)',
    ).run('mage', 'Battle Mage', 'ranged', 190, 260, 140, 1700);
    applyHirelingOverrides(loadContent(db).hirelingTemplates());
    expect(hirelingTemplate('mage')?.name).toBe('Battle Mage');
  });

  it('reset restores the code defaults', () => {
    applyHirelingOverrides([]);
    expect(HIRELING_TEMPLATES).toEqual(DEFAULT_HIRELING_TEMPLATES);
  });
});
