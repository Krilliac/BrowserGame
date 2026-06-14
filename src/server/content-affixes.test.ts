import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/database.js';
import { loadContent } from './content.js';
import {
  AFFIX_RANGES,
  DEFAULT_AFFIX_RANGES,
  applyAffixRangeOverrides,
  DEFAULT_AFFIX_NAMES,
  applyAffixNameOverrides,
  affixName,
} from '../shared/items.js';

/**
 * Affix data is TrinityCore-style content: the roll RANGES (server-only, via rollAffixes) and the
 * flavor NAMES/tiers (client-coupled, via instanceTitle) come from the DB, seeded from the code
 * defaults. Restore defaults after each test so the shared singletons never leak.
 */
afterEach(() => {
  applyAffixRangeOverrides({});
  applyAffixNameOverrides({});
});

describe('content affix ranges', () => {
  it('seeds ranges from the defaults', () => {
    const c = loadContent(openDatabase(':memory:'));
    expect(c.affixRanges()).toEqual(DEFAULT_AFFIX_RANGES);
  });

  it('overlay changes the live roll range', () => {
    const db = openDatabase(':memory:');
    db.prepare('UPDATE affix_ranges SET max_value = ? WHERE stat = ?').run(99, 'power');
    applyAffixRangeOverrides(loadContent(db).affixRanges());
    expect(AFFIX_RANGES.power.max).toBe(99);
  });
});

describe('content affix names', () => {
  it('seeds names + tiers from the defaults', () => {
    const c = loadContent(openDatabase(':memory:'));
    const names = c.affixNames();
    for (const [stat, def] of Object.entries(DEFAULT_AFFIX_NAMES)) {
      expect(names[stat]).toEqual(def);
    }
  });

  it('preserves an Infinity upper bound (stored as NULL)', () => {
    const c = loadContent(openDatabase(':memory:'));
    const power = c.affixNames().power!;
    expect(power.tiers[power.tiers.length - 1]?.upTo).toBe(Infinity);
  });

  it('overlay changes the composed title word', () => {
    const db = openDatabase(':memory:');
    db.prepare("UPDATE affix_name_tiers SET word = ? WHERE stat = 'power' AND sort_order = 0").run(
      'Zappy',
    );
    applyAffixNameOverrides(loadContent(db).affixNames());
    expect(affixName({ stat: 'power', value: 1 }).word).toBe('Zappy');
  });
});
