import { describe, expect, it } from 'vitest';
import { initGameDb, getDb } from './content.js';
import { areaScene, WORLD_SCALE } from './editor-scene.js';

initGameDb(':memory:');

/**
 * Authored-scene API for the canvas map editor. Verifies it returns RAW (pre-world-scale) rows so
 * the editor edits authored space directly, addressed by source table + primary key.
 */
describe('areaScene', () => {
  it('returns null for an unknown area', () => {
    expect(areaScene('no_such_area')).toBeNull();
  });

  it('returns authored dimensions + spawn + grouped layers for town', () => {
    const scene = areaScene('town')!;
    expect(scene).not.toBeNull();
    expect(scene.areaId).toBe('town');
    expect(typeof scene.name).toBe('string');

    // Dimensions are AUTHORED (raw) — they match the raw areas row, not the world-scaled content view.
    const raw = getDb()
      .prepare('SELECT width, height, spawn_x, spawn_y FROM areas WHERE id = ?')
      .get('town') as { width: number; height: number; spawn_x: number; spawn_y: number };
    expect(scene.width).toBe(raw.width);
    expect(scene.height).toBe(raw.height);
    expect(scene.spawn).toEqual({ x: raw.spawn_x, y: raw.spawn_y });

    // The four named layers are always present.
    expect(Object.keys(scene.layers)).toEqual(['decor', 'spawns', 'npcs', 'portals']);
  });

  it('exposes town npcs as placeables with table/pk/label set', () => {
    const scene = areaScene('town')!;
    expect(scene.layers.npcs.length).toBeGreaterThan(0);
    const npc = scene.layers.npcs[0]!;
    expect(npc.table).toBe('npcs');
    expect(npc.pk).not.toBe('');
    expect(typeof npc.label).toBe('string');
    expect(typeof npc.x).toBe('number');
    expect(typeof npc.y).toBe('number');
    expect(typeof npc.props?.hue).toBe('number');
    expect(scene.pvp).toBe('safe');
  });

  it('carries the right table + numeric authored coords for an inserted decor + spawn', () => {
    const db = getDb();
    // Place one decor and one creature spawn at known authored coords.
    db.prepare('INSERT INTO decor (area_id,kind,x,y,scale) VALUES (?,?,?,?,?)').run(
      'town',
      'crate',
      42,
      24,
      1.5,
    );
    db.prepare(
      'INSERT INTO mob_templates (id,name,hp,level,hue,speed,aggro_range,attack_range,damage,attack_cooldown_ms) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run('tst_mob', 'Test Mob', 10, 1, 0, 50, 100, 20, 3, 1000);
    db.prepare(
      'INSERT INTO creature_spawns (area_id,template_id,x,y,flags) VALUES (?,?,?,?,?)',
    ).run('town', 'tst_mob', 77, 88, 0);

    const scene = areaScene('town')!;

    const crate = scene.layers.decor.find((d) => d.kind === 'crate' && d.x === 42)!;
    expect(crate).toBeTruthy();
    expect(crate.table).toBe('decor');
    expect(crate.pk).not.toBe('');
    expect(crate.x).toBe(42);
    expect(crate.y).toBe(24);
    expect(crate.props?.scale).toBe(1.5);

    const spawn = scene.layers.spawns.find((s) => s.kind === 'tst_mob')!;
    expect(spawn).toBeTruthy();
    expect(spawn.table).toBe('creature_spawns');
    expect(spawn.x).toBe(77);
    expect(spawn.y).toBe(88);
    expect(spawn.props?.flags).toBe(0);
  });

  it('returns coords in authored (pre-WORLD_SCALE) space, not world-scaled', () => {
    expect(WORLD_SCALE).toBeGreaterThan(1);
    const scene = areaScene('town')!;
    const raw = getDb().prepare('SELECT width FROM areas WHERE id = ?').get('town') as {
      width: number;
    };
    // If this were the served view it would be width * WORLD_SCALE; it is the authored width.
    expect(scene.width).toBe(raw.width);
    expect(scene.width).not.toBe(raw.width * WORLD_SCALE);
  });
});
