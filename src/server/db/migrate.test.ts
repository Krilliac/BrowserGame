import { describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { migrate, LATEST_DB_VERSION } from './migrate.js';

const userVersion = (db: BetterSqlite3.Database): number =>
  db.pragma('user_version', { simple: true }) as number;

describe('content DB migration', () => {
  it('adds theme columns missing from an older area_theme table', () => {
    const db = new BetterSqlite3(':memory:');
    // Simulate an old DB: area_theme exists but predates the color-grade / sprite-tint columns.
    db.exec(`CREATE TABLE area_theme (
      area_id TEXT PRIMARY KEY, ground_base TEXT NOT NULL DEFAULT '#000000');`);
    db.prepare('INSERT INTO area_theme (area_id) VALUES (?)').run('town');

    migrate(db);

    const cols = new Set(
      (db.prepare('PRAGMA table_info(area_theme)').all() as { name: string }[]).map((r) => r.name),
    );
    expect(cols.has('grade_saturation')).toBe(true);
    expect(cols.has('sprite_tint')).toBe(true);
    // Existing row gets the column default, so reads don't break.
    const row = db
      .prepare('SELECT grade_saturation, sprite_tint FROM area_theme WHERE area_id = ?')
      .get('town') as { grade_saturation: number; sprite_tint: string };
    expect(row.grade_saturation).toBe(1);
    expect(row.sprite_tint).toBe('#ffffff');
  });

  it('adds the game_events gold_bonus column to an older table (migration #2)', () => {
    const db = new BetterSqlite3(':memory:');
    // Simulate a pre-gold-bonus game_events table.
    db.exec(`CREATE TABLE game_events (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, period_min INTEGER NOT NULL,
      length_min INTEGER NOT NULL, xp_bonus REAL, announce TEXT);`);
    migrate(db);
    const cols = new Set(
      (db.prepare('PRAGMA table_info(game_events)').all() as { name: string }[]).map((r) => r.name),
    );
    expect(cols.has('gold_bonus')).toBe(true);
  });

  it('is a no-op when the table is absent', () => {
    const db = new BetterSqlite3(':memory:');
    expect(() => migrate(db)).not.toThrow();
  });

  it('stamps the DB to the latest version after running', () => {
    const db = new BetterSqlite3(':memory:');
    expect(userVersion(db)).toBe(0); // a brand-new DB starts at 0
    migrate(db);
    expect(userVersion(db)).toBe(LATEST_DB_VERSION);
  });

  it('is idempotent — a second run changes nothing and does not throw', () => {
    const db = new BetterSqlite3(':memory:');
    migrate(db);
    const after = userVersion(db);
    expect(() => migrate(db)).not.toThrow();
    expect(userVersion(db)).toBe(after); // already current → no migrations re-run
  });

  it('skips migrations on a DB already recorded at a newer version', () => {
    const db = new BetterSqlite3(':memory:');
    // An old-shaped area_theme, but the DB claims a future version → the column backfill must NOT run.
    db.exec(`CREATE TABLE area_theme (
      area_id TEXT PRIMARY KEY, ground_base TEXT NOT NULL DEFAULT '#000000');`);
    db.pragma('user_version = 999');

    migrate(db);

    const cols = new Set(
      (db.prepare('PRAGMA table_info(area_theme)').all() as { name: string }[]).map((r) => r.name),
    );
    expect(cols.has('grade_saturation')).toBe(false); // gated out by the higher user_version
    expect(userVersion(db)).toBe(999); // left untouched
  });
});
