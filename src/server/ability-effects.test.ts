import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import { DEFAULT_ABILITY_STATUS_EFFECTS } from './ability-effects.js';

/**
 * On-hit status effects (slow / burn / weaken) are TrinityCore-style per-ability content: the
 * runtime authority is the DB (seeded from ability-effects.ts), so a designer can retune how long
 * a freeze lasts or how hard a burn ticks with SQL. These pin the default round-trip and live edits.
 */
describe('content ability status effects (slow/burn/weaken)', () => {
  it('seeds a single-effect ability from the defaults', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.abilityStatusEffects('frost')).toEqual([{ effect: 'slow', ms: 1500, magnitude: 0.4 }]);
  });

  it('returns every effect for an ability that both slows and weakens', () => {
    const c = loadContent(openDatabase(':memory:'));
    const effects = c.abilityStatusEffects('curse_of_decay');
    expect(effects).toContainEqual({ effect: 'slow', ms: 1800, magnitude: 0.4 });
    expect(effects).toContainEqual({ effect: 'weaken', ms: 3000, magnitude: 0.4 });
  });

  it('returns an empty list for an ability with no on-hit effect', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.abilityStatusEffects('slash')).toEqual([]);
  });

  it('reflects a live DB edit to a burn duration', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      'UPDATE ability_status_effects SET duration_ms = ?, magnitude = ? WHERE ability_id = ? AND effect = ?',
    ).run(9000, 99, 'fireball', 'burn');
    const c = loadContent(db);
    expect(c.abilityStatusEffects('fireball')).toEqual([
      { effect: 'burn', ms: 9000, magnitude: 99 },
    ]);
  });

  it('seeds exactly one row per default entry (idempotent)', () => {
    const db = openDatabase(':memory:');
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM ability_status_effects').get() as {
      n: number;
    };
    expect(n).toBe(DEFAULT_ABILITY_STATUS_EFFECTS.length);
  });
});
