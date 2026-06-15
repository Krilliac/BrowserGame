import { describe, expect, it } from 'vitest';
import type { Database } from 'better-sqlite3';
import { openDatabase } from './database.js';
import { seed } from './seed.js';

/**
 * Seed idempotency — the contract every `ensure*` in seed() depends on. `openDatabase` already runs
 * schema → migrate → seed once; running the WHOLE seed pipeline a second time on the same DB must add
 * no rows and never throw. A future seeder that forgets `INSERT OR IGNORE` (or re-seeds an un-gated
 * table) would duplicate rows here and fail this test — exactly the regression we want to catch.
 */
function tableRowCounts(db: Database): Record<string, number> {
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[]
  ).map((r) => r.name);
  const counts: Record<string, number> = {};
  for (const t of tables) {
    counts[t] = (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
  }
  return counts;
}

describe('seed() idempotency', () => {
  it('a second full seed pass adds no rows and does not throw', () => {
    const db = openDatabase(':memory:'); // schema + migrate + seed (first pass)
    const before = tableRowCounts(db);
    expect(Object.keys(before).length).toBeGreaterThan(20); // sanity: the content tables exist

    expect(() => seed(db)).not.toThrow(); // run the entire pipeline again

    expect(tableRowCounts(db)).toEqual(before); // every table is unchanged
  });

  it('stays stable across several passes (no slow drift)', () => {
    const db = openDatabase(':memory:');
    const before = tableRowCounts(db);
    for (let i = 0; i < 3; i++) seed(db);
    expect(tableRowCounts(db)).toEqual(before);
  });
});
