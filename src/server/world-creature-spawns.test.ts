import { describe, expect, it } from 'vitest';
import { initGameDb, getContent, getDb, reloadContent } from './content.js';
import { CreatureSpawnFlags } from '../shared/spawn-flags.js';
import { World } from './world.js';

/**
 * Individual creature spawns (the uid/guid-level placement, distinct from the mob_templates entry):
 * a `creature_spawns` row places one monster at a fixed position with per-spawn flags. The table is
 * empty by default; these tests insert rows, reload content, and assert the world places them.
 */
initGameDb(':memory:');

describe('creature_spawns (template/spawn split)', () => {
  it('is empty by default — no behavior change to seeded content', () => {
    expect(getContent().creatureSpawns('wilderness')).toEqual([]);
  });

  it('places a fixed-position spawn, scaled like other authored coordinates', () => {
    getDb()
      .prepare('INSERT INTO creature_spawns (area_id,template_id,x,y,flags) VALUES (?,?,?,?,?)')
      .run('wilderness', 'wolf', 100, 120, 0);
    const c = reloadContent();
    const spawns = c.creatureSpawns('wilderness');
    expect(spawns).toHaveLength(1);
    const s = spawns[0]!;
    expect(s.templateId).toBe('wolf');
    // Authored coords are scaled into the served world (same as NPCs/decor), so x > the raw 100.
    expect(s.x).toBeGreaterThanOrEqual(100);

    const area = c.area('wilderness')!;
    const world = new World(area.width, area.height, area.spawn, undefined, 'wilderness');
    world.populateMobs('wilderness');
    const placed = world
      .snapshot()
      .filter((e) => e.kind === 'mob')
      .some((m) => Math.round(m.x) === Math.round(s.x) && Math.round(m.y) === Math.round(s.y));
    expect(placed, 'a mob stands at the fixed spawn point').toBe(true);
  });

  it('honors the ELITE spawn flag (forced champion at the placement)', () => {
    getDb()
      .prepare('INSERT INTO creature_spawns (area_id,template_id,x,y,flags) VALUES (?,?,?,?,?)')
      .run('crypt', 'skeleton', 90, 90, CreatureSpawnFlags.ELITE);
    const c = reloadContent();
    const area = c.area('crypt')!;
    const pos = c.creatureSpawns('crypt')[0]!;
    const world = new World(area.width, area.height, area.spawn, undefined, 'crypt');
    world.populateMobs('crypt');
    const mob = world
      .snapshot()
      .filter((e) => e.kind === 'mob')
      .find((m) => Math.round(m.x) === Math.round(pos.x) && Math.round(m.y) === Math.round(pos.y));
    expect(mob, 'the flagged spawn exists').toBeDefined();
    // An elite carries a modifier prefix, so its name is longer than the bare template name.
    expect(mob!.name).not.toBe('Crypt Skeleton');
  });
});
