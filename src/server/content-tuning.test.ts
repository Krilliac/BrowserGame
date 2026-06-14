import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { seed } from './db/seed.js';
import { loadContent } from './content.js';
import { weatherModifiers } from './weather-effects.js';
import { DEFAULT_ELITE_MODIFIERS } from './mobs.js';
import { WEATHER_KINDS } from '../shared/theme.js';

/**
 * The weather and elite ("champion") modifier tables are TrinityCore-style data: the runtime
 * authority is the DB (seeded from the code defaults), so a designer can retune monster champion
 * power or weather gameplay penalties with SQL — no recompile. These tests pin that the defaults
 * round-trip through the DB and that live edits take effect.
 */
describe('content tuning tables (weather + elite modifiers)', () => {
  it('seeds weather_modifiers matching the code defaults for every weather kind', () => {
    const c = loadContent(openDatabase(':memory:'));
    for (const kind of WEATHER_KINDS) {
      expect(c.weatherMods(kind)).toEqual(weatherModifiers(kind));
    }
  });

  it('weatherMods reflects a live DB edit', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      'UPDATE weather_modifiers SET move_scale = ?, aggro_scale = ? WHERE weather = ?',
    ).run(0.5, 0.25, 'snow');
    const c = loadContent(db);
    expect(c.weatherMods('snow')).toEqual({ moveScale: 0.5, aggroScale: 0.25 });
  });

  it('weatherMods falls back to the code default when a row is missing', () => {
    const db = openDatabase(':memory:');
    db.prepare('DELETE FROM weather_modifiers WHERE weather = ?').run('fog');
    const c = loadContent(db);
    expect(c.weatherMods('fog')).toEqual(weatherModifiers('fog'));
  });

  it('seeds elite_modifiers from the defaults in declaration order', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.eliteModifiers()).toEqual(DEFAULT_ELITE_MODIFIERS);
  });

  it('eliteModifiers reflects a live DB edit', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE elite_modifiers SET hp_mult = ? WHERE id = ?').run(9, 'swift');
    const c = loadContent(db);
    expect(c.eliteModifiers().find((m) => m.name === 'Swift')?.hp).toBe(9);
  });

  it('falls back to the code defaults when elite_modifiers is empty', () => {
    const db = openDatabase(':memory:');
    db.prepare('DELETE FROM elite_modifiers').run();
    const c = loadContent(db);
    expect(c.eliteModifiers()).toEqual(DEFAULT_ELITE_MODIFIERS);
  });

  it('re-seeding an existing DB does not duplicate tuning rows (idempotent)', () => {
    const db = openDatabase(':memory:');
    seed(db); // run the ensure-* passes a second time
    const w = db.prepare('SELECT COUNT(*) AS n FROM weather_modifiers').get() as { n: number };
    const e = db.prepare('SELECT COUNT(*) AS n FROM elite_modifiers').get() as { n: number };
    expect(w.n).toBe(WEATHER_KINDS.length);
    expect(e.n).toBe(DEFAULT_ELITE_MODIFIERS.length);
  });
});
