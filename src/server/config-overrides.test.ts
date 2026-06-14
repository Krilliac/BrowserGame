import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { applyConfigOverrides, TUNABLE_SECTIONS } from './config.js';

/**
 * The game_config key/value table is the TrinityCore-style world-settings overlay: the code config
 * (config.ts) is the default, and DB rows override the gameplay-tuning knobs at load — so an operator
 * can rebalance difficulty/economy/drops with SQL, persisted across restarts. These tests use an
 * injected target object so they never mutate the shared `config` singleton.
 */
describe('game_config overlay', () => {
  it('seeds a row for a tunable field (difficulty.mobDamage)', () => {
    const db = openDatabase(':memory:');
    const row = db
      .prepare('SELECT value FROM game_config WHERE key = ?')
      .get('difficulty.mobDamage') as { value: number } | undefined;
    expect(row?.value).toBe(1.5);
  });

  it('does not seed plumbing/secret sections (no server.*)', () => {
    const db = openDatabase(':memory:');
    const { n } = db
      .prepare("SELECT COUNT(*) AS n FROM game_config WHERE key LIKE 'server.%'")
      .get() as {
      n: number;
    };
    expect(n).toBe(0);
    expect(TUNABLE_SECTIONS).not.toContain('server');
  });

  it('seeds the corruption tuning section (corruption.perDeath)', () => {
    const db = openDatabase(':memory:');
    const row = db
      .prepare('SELECT value FROM game_config WHERE key = ?')
      .get('corruption.perDeath') as { value: number } | undefined;
    expect(row?.value).toBe(0.15);
  });

  it('overlays a DB value onto the target config section', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE game_config SET value = ? WHERE key = ?').run(9, 'difficulty.mobDamage');
    const target = { difficulty: { mobDamage: 1.5 } };
    applyConfigOverrides(db, target);
    expect(target.difficulty.mobDamage).toBe(9);
  });

  it('ignores a key whose field is absent on the target (typo-safe)', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT OR REPLACE INTO game_config (key,value) VALUES (?,?)').run(
      'difficulty.bogus',
      5,
    );
    const target: { difficulty: Record<string, number> } = { difficulty: { mobDamage: 1.5 } };
    applyConfigOverrides(db, target);
    expect(target.difficulty.bogus).toBeUndefined();
  });

  it('ignores a non-whitelisted section', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT OR REPLACE INTO game_config (key,value) VALUES (?,?)').run('server.port', 1);
    const target = { server: { port: 8080 } };
    applyConfigOverrides(db, target);
    expect(target.server.port).toBe(8080); // untouched: server is not tunable
  });

  it('does not pollute Object.prototype via a __proto__ key', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT OR REPLACE INTO game_config (key,value) VALUES (?,?)').run(
      '__proto__.polluted',
      1,
    );
    applyConfigOverrides(db, { difficulty: { mobDamage: 1.5 } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
