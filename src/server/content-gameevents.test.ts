import { describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import { isEventActive } from './game-events.js';

/**
 * Game events are data-driven content: the DB (seeded from game-events.ts defaults) is the runtime
 * authority for the recurrence schedules. The schedule MATH is unit-tested in game-events.test.ts;
 * here we cover that the rows round-trip into GameEventDef shape and feed the pure functions.
 */
describe('content game events', () => {
  it('loads the seeded events with optional fields intact', () => {
    const c = loadContent(openDatabase(':memory:'));
    const byId = new Map(c.gameEvents().map((e) => [e.id, e]));
    expect(byId.get('bloodmoon')).toEqual({
      id: 'bloodmoon',
      name: 'Bloodmoon Rising',
      periodMin: 360,
      lengthMin: 30,
      xpBonus: 0.5,
      announce: expect.any(String),
    });
    expect(byId.get('golden-hour')?.periodMin).toBe(120);
  });

  it('a loaded event drives the pure schedule check', () => {
    const c = loadContent(openDatabase(':memory:'));
    const bloodmoon = c.gameEvents().find((e) => e.id === 'bloodmoon')!;
    // From epoch 0: active in the first 30 min, inactive after.
    expect(isEventActive(bloodmoon, 5 * 60_000, 0)).toBe(true);
    expect(isEventActive(bloodmoon, 60 * 60_000, 0)).toBe(false);
  });

  it('drops nullable optional fields so they stay absent', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      'INSERT INTO game_events (id,name,period_min,length_min,xp_bonus,announce) VALUES (?,?,?,?,?,?)',
    ).run('bare', 'Bare Event', 60, 10, null, null);
    const ev = loadContent(db)
      .gameEvents()
      .find((e) => e.id === 'bare')!;
    expect(ev).toEqual({ id: 'bare', name: 'Bare Event', periodMin: 60, lengthMin: 10 });
    expect('xpBonus' in ev).toBe(false);
  });
});
