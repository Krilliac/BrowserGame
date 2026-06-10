import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';

describe('content (SQLite-backed)', () => {
  it('seeds and loads the built-in content', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(
      c
        .areas()
        .map((a) => a.id)
        .sort(),
    ).toEqual(['crypt', 'frostpeak', 'marsh', 'mines', 'town', 'wilderness']);
    expect(c.abilityOrder()).toEqual(['slash', 'fireball', 'arrow', 'frost', 'heal', 'lightning']);
    expect(c.area('town')?.name).toBe('Aldermere');
    expect(c.area('town')?.portals.length).toBeGreaterThan(0);
    expect(c.mobTemplate('wolf')?.hp).toBe(45);
    expect(c.item('iron_sword')?.power).toBeGreaterThan(0);
    expect(c.sellValue('rune_shard')).toBe(250);
    expect(c.npcs('town').some((n) => n.kind === 'vendor')).toBe(true);
    expect(c.quests().some((q) => q.id === 'wolf_cull')).toBe(true);
    // Spellbook era: tomes are items that teach, and the Merchant stocks them.
    expect(c.item('tome_frost')?.teaches).toBe('frost');
    expect(c.vendorStock('town', 'Merchant').length).toBeGreaterThan(0);
  });

  it('rolls loot from the database drop tables', () => {
    const c = loadContent(openDatabase(':memory:'));
    // rng=0 takes the first weighted option and the gear group → a deterministic non-empty roll.
    const drops = c.rollLoot('wolf', () => 0);
    expect(drops.length).toBeGreaterThan(0);
  });

  it('reflects SQL edits on reload (the backend is data-driven)', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE mob_templates SET hp = ? WHERE id = ?').run(999, 'wolf');
    db.prepare(
      `INSERT INTO mob_templates (id,name,hp,level,hue,speed,aggro_range,attack_range,damage,attack_cooldown_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run('dragon', 'Ancient Dragon', 2000, 30, 10, 90, 600, 80, 40, 1400);
    const c = loadContent(db);
    expect(c.mobTemplate('wolf')?.hp).toBe(999);
    expect(c.mobTemplate('dragon')?.name).toBe('Ancient Dragon');
  });
});
