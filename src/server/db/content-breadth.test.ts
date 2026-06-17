import { describe, expect, it } from 'vitest';
import { initGameDb, getContent, getDb } from '../content.js';

/**
 * Content-breadth regression for the pet/summon/mount systems: the mount roster and the
 * tameable/summonable creature pools are pure content (seeded into SQLite from code defaults). These
 * tests pin down that the breadth additions actually loaded — the new mounts are in the roster, and
 * the tameable/summonable pools grew past the original starter set.
 */
initGameDb(':memory:');

describe('mount roster breadth', () => {
  it('seeds the new mid/high mount tiers into the content roster', () => {
    const ids = new Set(
      getContent()
        .mounts()
        .map((m) => m.id),
    );
    for (const id of ['fenstride_pony', 'ashmane_charger', 'voidwake_nightmare']) {
      expect(ids.has(id), `mount ${id} should be seeded`).toBe(true);
    }
  });

  it('keeps mount speed multipliers in a sane, strictly-escalating ladder', () => {
    const sorted = [...getContent().mounts()].sort((a, b) => a.price - b.price);
    let prevSpeed = 0;
    let prevPrice = 0;
    for (const m of sorted) {
      expect(m.speedMult, `${m.id} speedMult sane`).toBeGreaterThanOrEqual(1.3);
      expect(m.speedMult, `${m.id} speedMult sane`).toBeLessThanOrEqual(2.2);
      expect(m.speedMult, `${m.id} speed escalates with price`).toBeGreaterThan(prevSpeed);
      expect(m.price, `${m.id} price escalates`).toBeGreaterThan(prevPrice);
      prevSpeed = m.speedMult;
      prevPrice = m.price;
    }
  });
});

describe('tameable / summonable creature breadth', () => {
  // Direct DB read: the Content interface exposes mobTemplate(id) but no iterator, so we count
  // flagged templates straight from the seeded mob_templates table.
  const countFlag = (col: 'tameable' | 'summonable'): number =>
    (
      getDb().prepare(`SELECT COUNT(*) AS n FROM mob_templates WHERE ${col} = 1`).get() as {
        n: number;
      }
    ).n;

  it('grows the tameable pool well past the original two beasts', () => {
    // wolf + boar shipped tameable; the breadth pass added 6 more wild beasts.
    expect(countFlag('tameable')).toBeGreaterThanOrEqual(8);
  });

  it('flags the new tameable beasts and leaves them readable as pets', () => {
    const c = getContent();
    for (const id of [
      'frost_wolf',
      'plague_hound',
      'shadowmaw_bear',
      'gnarlfang_lycan',
      'barrens_warg',
      'ash_dire_wolf',
    ]) {
      expect(c.mobTemplate(id)?.tameable, `${id} tameable`).toBe(true);
    }
  });

  it('grows the summonable pool past the original skeleton minions', () => {
    // 3 skeleton minions shipped summonable; the breadth pass added 2 graveborn raise-targets.
    expect(countFlag('summonable')).toBeGreaterThanOrEqual(5);
  });

  it('flags the new summonable graveborn raise-targets', () => {
    const c = getContent();
    for (const id of ['rot_ghoul', 'grave_golem']) {
      expect(c.mobTemplate(id)?.summonable, `${id} summonable`).toBe(true);
    }
  });
});
