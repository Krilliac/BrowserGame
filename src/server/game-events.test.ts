import { describe, it, expect } from 'vitest';

import {
  DEFAULT_GAME_EVENTS,
  isEventActive,
  activeEvents,
  msUntilNextChange,
  totalXpBonus,
  totalGoldBonus,
  type GameEventDef,
} from './game-events.js';

const MIN = 60_000;

/** A simple event: fires every 100 min, lasts 20 min, +50% XP. */
const ev: GameEventDef = {
  id: 'test',
  name: 'Test Event',
  periodMin: 100,
  lengthMin: 20,
  xpBonus: 0.5,
};

describe('isEventActive', () => {
  it('is active at the start of the first window (start inclusive)', () => {
    expect(isEventActive(ev, 0)).toBe(true);
  });

  it('is active inside the first window', () => {
    expect(isEventActive(ev, 10 * MIN)).toBe(true);
  });

  it('is inactive at the exact end of the window (end exclusive)', () => {
    expect(isEventActive(ev, 20 * MIN)).toBe(false);
  });

  it('is inactive between windows', () => {
    expect(isEventActive(ev, 50 * MIN)).toBe(false);
  });

  it('is inactive at the very end just before the next window', () => {
    expect(isEventActive(ev, 100 * MIN - 1)).toBe(false);
  });

  it('is active at the start of a later (Nth) window', () => {
    // 3rd occurrence starts at 300 min.
    expect(isEventActive(ev, 300 * MIN)).toBe(true);
    expect(isEventActive(ev, 315 * MIN)).toBe(true);
    expect(isEventActive(ev, 320 * MIN)).toBe(false); // its window has closed
  });

  it('shifts the schedule by epochMs', () => {
    const epoch = 1000 * MIN;
    // Without the epoch offset, time 1000 min would be a window start; with it, time is relative.
    expect(isEventActive(ev, epoch, epoch)).toBe(true); // start of first window after epoch
    expect(isEventActive(ev, epoch + 10 * MIN, epoch)).toBe(true);
    expect(isEventActive(ev, epoch + 20 * MIN, epoch)).toBe(false);
    expect(isEventActive(ev, epoch + 50 * MIN, epoch)).toBe(false);
  });

  it('is inactive before the schedule epoch begins', () => {
    expect(isEventActive(ev, 500 * MIN, 1000 * MIN)).toBe(false);
  });

  it('returns false for periodMin <= 0', () => {
    expect(isEventActive({ ...ev, periodMin: 0 }, 0)).toBe(false);
    expect(isEventActive({ ...ev, periodMin: -10 }, 5 * MIN)).toBe(false);
  });

  it('returns false for lengthMin <= 0', () => {
    expect(isEventActive({ ...ev, lengthMin: 0 }, 0)).toBe(false);
    expect(isEventActive({ ...ev, lengthMin: -5 }, 0)).toBe(false);
  });

  it('is always-on when lengthMin >= periodMin (once started)', () => {
    const alwaysOn: GameEventDef = { ...ev, periodMin: 60, lengthMin: 60 };
    expect(isEventActive(alwaysOn, 0)).toBe(true);
    expect(isEventActive(alwaysOn, 30 * MIN)).toBe(true);
    expect(isEventActive(alwaysOn, 59 * MIN)).toBe(true);
    expect(isEventActive(alwaysOn, 60 * MIN)).toBe(true); // next window starts back-to-back
    expect(isEventActive(alwaysOn, 9999 * MIN)).toBe(true);
  });

  it('always-on still respects the epoch start', () => {
    const alwaysOn: GameEventDef = { ...ev, periodMin: 60, lengthMin: 120 };
    expect(isEventActive(alwaysOn, 0, 10 * MIN)).toBe(false); // before epoch
    expect(isEventActive(alwaysOn, 10 * MIN, 10 * MIN)).toBe(true);
  });

  it('tiles the timeline with no gap when length === period', () => {
    const tiled: GameEventDef = { ...ev, periodMin: 30, lengthMin: 30 };
    // Every instant from 0 onward should be active.
    for (const t of [0, 1, 29, 30, 31, 60, 90]) {
      expect(isEventActive(tiled, t * MIN)).toBe(true);
    }
  });
});

describe('activeEvents', () => {
  const a: GameEventDef = { id: 'a', name: 'A', periodMin: 100, lengthMin: 20, xpBonus: 0.5 };
  const b: GameEventDef = { id: 'b', name: 'B', periodMin: 60, lengthMin: 30, xpBonus: 0.25 };
  const events = [a, b];

  it('returns only the events active at the given time', () => {
    // At t=10min: a active (0..20), b active (0..30).
    expect(activeEvents(events, 10 * MIN).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('returns a subset when only some are active', () => {
    // At t=25min: a inactive (20..100 off), b active (0..30).
    expect(activeEvents(events, 25 * MIN).map((e) => e.id)).toEqual(['b']);
  });

  it('returns empty when none are active', () => {
    // At t=45min: a off, b off (30..60 off).
    expect(activeEvents(events, 45 * MIN)).toEqual([]);
  });

  it('respects the epoch offset', () => {
    const epoch = 500 * MIN;
    expect(activeEvents(events, epoch + 10 * MIN, epoch).map((e) => e.id)).toEqual(['a', 'b']);
    expect(activeEvents(events, epoch + 25 * MIN, epoch).map((e) => e.id)).toEqual(['b']);
  });
});

describe('msUntilNextChange', () => {
  it('returns ms until this active window ends', () => {
    // At t=5min, active window [0,20) ends at 20min → 15 min remain.
    expect(msUntilNextChange(ev, 5 * MIN)).toBe(15 * MIN);
  });

  it('returns ms until the next window starts when inactive', () => {
    // At t=50min, next window starts at 100min → 50 min remain.
    expect(msUntilNextChange(ev, 50 * MIN)).toBe(50 * MIN);
  });

  it('returns ms until the first occurrence when before the epoch', () => {
    expect(msUntilNextChange(ev, 990 * MIN, 1000 * MIN)).toBe(10 * MIN);
  });

  it('is infinite when the event never fires', () => {
    expect(msUntilNextChange({ ...ev, periodMin: 0 }, 5 * MIN)).toBe(Number.POSITIVE_INFINITY);
    expect(msUntilNextChange({ ...ev, lengthMin: 0 }, 5 * MIN)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is infinite for an always-on event once started', () => {
    const alwaysOn: GameEventDef = { ...ev, periodMin: 60, lengthMin: 60 };
    expect(msUntilNextChange(alwaysOn, 30 * MIN)).toBe(Number.POSITIVE_INFINITY);
  });

  it('honors the epoch offset', () => {
    const epoch = 200 * MIN;
    expect(msUntilNextChange(ev, epoch + 5 * MIN, epoch)).toBe(15 * MIN);
    expect(msUntilNextChange(ev, epoch + 50 * MIN, epoch)).toBe(50 * MIN);
  });
});

describe('totalXpBonus', () => {
  const a: GameEventDef = { id: 'a', name: 'A', periodMin: 100, lengthMin: 20, xpBonus: 0.5 };
  const b: GameEventDef = { id: 'b', name: 'B', periodMin: 60, lengthMin: 30, xpBonus: 0.25 };
  const noBonus: GameEventDef = { id: 'c', name: 'C', periodMin: 100, lengthMin: 20 };
  const events = [a, b, noBonus];

  it('sums the bonuses of only the active events', () => {
    // At t=10min: a (0.5) + b (0.25) + c (0, undefined bonus) = 0.75.
    expect(totalXpBonus(events, 10 * MIN)).toBe(0.75);
  });

  it('counts only active events', () => {
    // At t=25min: only b active → 0.25.
    expect(totalXpBonus(events, 25 * MIN)).toBe(0.25);
  });

  it('returns 0 when nothing is active', () => {
    expect(totalXpBonus(events, 45 * MIN)).toBe(0);
  });

  it('returns 0 for an empty event list', () => {
    expect(totalXpBonus([], 10 * MIN)).toBe(0);
  });

  it('treats a missing xpBonus as 0', () => {
    expect(totalXpBonus([noBonus], 10 * MIN)).toBe(0);
  });

  it('respects the epoch offset', () => {
    const epoch = 1000 * MIN;
    expect(totalXpBonus(events, epoch + 10 * MIN, epoch)).toBe(0.75);
  });
});

describe('totalGoldBonus', () => {
  const gold: GameEventDef = {
    id: 'g',
    name: 'G',
    periodMin: 100,
    lengthMin: 20,
    xpBonus: 0.25,
    goldBonus: 0.5,
  };
  const xpOnly: GameEventDef = { id: 'x', name: 'X', periodMin: 100, lengthMin: 20, xpBonus: 0.4 };

  it('sums only the goldBonus of active events (xp-only events contribute 0)', () => {
    expect(totalGoldBonus([gold, xpOnly], 10 * MIN)).toBe(0.5);
  });

  it('returns 0 when nothing is active or no event grants gold', () => {
    expect(totalGoldBonus([gold], 25 * MIN)).toBe(0); // gold event inactive at t=25
    expect(totalGoldBonus([xpOnly], 10 * MIN)).toBe(0); // active but no goldBonus
    expect(totalGoldBonus([], 10 * MIN)).toBe(0);
  });
});

describe('DEFAULT_GAME_EVENTS', () => {
  it('exposes two thematic seed events with unique ids', () => {
    expect(DEFAULT_GAME_EVENTS).toHaveLength(2);
    const ids = DEFAULT_GAME_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has the Bloodmoon and Golden Hour as designed', () => {
    const bloodmoon = DEFAULT_GAME_EVENTS.find((e) => e.id === 'bloodmoon');
    const golden = DEFAULT_GAME_EVENTS.find((e) => e.id === 'golden-hour');
    expect(bloodmoon).toMatchObject({ periodMin: 360, lengthMin: 30, xpBonus: 0.5 });
    expect(golden).toMatchObject({ periodMin: 120, lengthMin: 15, xpBonus: 0.25 });
  });

  it('every seed event has a valid (firing) schedule', () => {
    for (const e of DEFAULT_GAME_EVENTS) {
      expect(e.periodMin).toBeGreaterThan(0);
      expect(e.lengthMin).toBeGreaterThan(0);
      expect(e.lengthMin).toBeLessThan(e.periodMin); // recurring, not always-on
    }
  });

  it('each seed event is active at its own epoch start', () => {
    for (const e of DEFAULT_GAME_EVENTS) {
      expect(isEventActive(e, 0)).toBe(true);
    }
  });
});
