import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import { DUNGEONS } from '../shared/areas.js';

/**
 * Procedural-dungeon definitions are TrinityCore-style content: the DB (seeded from areas.ts
 * DUNGEONS) is the runtime authority, so a designer can add a dungeon or re-roster its pool with SQL.
 * The server reads pools/bosses via Content.dungeon(); the client only needs the id set (shipped in
 * the content packet) for isDungeon().
 */
describe('content dungeons (procedural pool definitions)', () => {
  it('exposes every seeded dungeon with its full def', () => {
    const c = loadContent(openDatabase(':memory:'));
    for (const [areaId, def] of Object.entries(DUNGEONS)) {
      expect(c.dungeon(areaId)).toEqual(def);
    }
  });

  it('isDungeon reflects membership', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.isDungeon('forgotten_catacombs')).toBe(true);
    expect(c.isDungeon('town')).toBe(false);
  });

  it('dungeonAreaIds lists exactly the seeded dungeons', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.dungeonAreaIds().sort()).toEqual(Object.keys(DUNGEONS).sort());
  });

  it('preserves pool order (deterministic spawn picks)', () => {
    const c = loadContent(openDatabase(':memory:'));
    const id = 'forgotten_catacombs';
    expect(c.dungeon(id)?.pool).toEqual(DUNGEONS[id]!.pool);
  });

  it('reflects a live DB edit to a dungeon boss', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE dungeons SET boss = ? WHERE area_id = ?').run('wolf', 'forgotten_catacombs');
    const c = loadContent(db);
    expect(c.dungeon('forgotten_catacombs')?.boss).toBe('wolf');
  });
});
