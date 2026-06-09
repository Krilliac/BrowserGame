import BetterSqlite3, { type Database } from 'better-sqlite3';
import { SCHEMA } from './schema.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';

export type GameDatabase = Database;

/**
 * Open (or create) the game content database, apply the schema, and seed it from the built-in
 * content on first use. Pass `:memory:` for tests. Parametrized queries everywhere — see seed.ts
 * and content.ts.
 */
export function openDatabase(file = ':memory:'): GameDatabase {
  const db = new BetterSqlite3(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db); // bring older DBs up to date (add columns introduced since they were created)
  seed(db);
  return db;
}
