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
    ).toEqual([
      'blighted_spire',
      'crypt',
      'forgotten_catacombs',
      'frostpeak',
      'frozen_vault',
      'hollowroot',
      'infernal_forge',
      'marsh',
      'mines',
      'sundered_wastes',
      'town',
      'wilderness',
      'writhing_hive',
    ]);
    // The original nine spells lead the order (declaration order); the expanded pool appends after.
    expect(c.abilityOrder().slice(0, 9)).toEqual([
      'slash',
      'fireball',
      'arrow',
      'frost',
      'heal',
      'lightning',
      'cleave',
      'venom',
      'meteor',
    ]);
    expect(c.abilityOrder().length).toBeGreaterThan(30);
    expect(c.ability('frostnova')?.kind).toBe('melee');
    expect(c.item('tome_shadow_bolt')?.teaches).toBe('shadow_bolt');
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

  it('loads town set-dressing decor from the decor table onto the area', () => {
    const c = loadContent(openDatabase(':memory:'));
    const decor = c.area('town')?.decor ?? [];
    expect(decor.length).toBeGreaterThan(0);
    // The camp's defining props are present.
    expect(decor.some((d) => d.kind === 'bonfire')).toBe(true);
    expect(decor.some((d) => d.kind === 'palisade')).toBe(true);
    expect(decor.some((d) => d.kind === 'tent')).toBe(true);
    // Line props carry their second endpoint; point props don't.
    const wall = decor.find((d) => d.kind === 'palisade');
    expect(wall?.x2).toBeTypeOf('number');
    const fire = decor.find((d) => d.kind === 'bonfire');
    expect(fire?.x2).toBeUndefined();
    // Areas without decor rows get an empty array, never undefined.
    expect(c.area('crypt')?.decor).toEqual([]);
  });

  it('reflects SQL decor edits on reload (the town look is data-driven)', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO decor (area_id,kind,x,y) VALUES (?,?,?,?)').run(
      'town',
      'statue',
      900,
      700,
    );
    const c = loadContent(db);
    expect(c.area('town')?.decor?.some((d) => d.kind === 'statue')).toBe(true);
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
