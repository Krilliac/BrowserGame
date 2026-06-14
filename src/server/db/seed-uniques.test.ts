import { describe, expect, it } from 'vitest';
import { EQUIPMENT, type ItemSlot } from '../../shared/equipment.js';
import { getContent, initGameDb } from '../content.js';
import { UNIQUES } from './seed-uniques.js';

/** Stats that apply as a penalty — a unique should never carry one. */
const DEBUFF_STATS = new Set(['frail', 'fragile']);

const ALL_SLOTS: ItemSlot[] = [
  'head',
  'neck',
  'shoulders',
  'chest',
  'hands',
  'waist',
  'legs',
  'feet',
  'mainhand',
  'offhand',
  'ring',
  'trinket',
];

describe('UNIQUES seed catalogue', () => {
  it('every unique references a real equipment base id', () => {
    for (const def of UNIQUES) {
      expect(EQUIPMENT[def.baseId], `${def.id} -> ${def.baseId}`).toBeDefined();
    }
  });

  it('is a curated pool of 18-24 entries', () => {
    expect(UNIQUES.length).toBeGreaterThanOrEqual(18);
    expect(UNIQUES.length).toBeLessThanOrEqual(24);
  });

  it('has no duplicate names or ids', () => {
    expect(new Set(UNIQUES.map((u) => u.name)).size).toBe(UNIQUES.length);
    expect(new Set(UNIQUES.map((u) => u.id)).size).toBe(UNIQUES.length);
  });

  it('each unique has 2-4 fixed, buff-only affixes', () => {
    for (const def of UNIQUES) {
      expect(def.affixes.length, def.id).toBeGreaterThanOrEqual(2);
      expect(def.affixes.length, def.id).toBeLessThanOrEqual(4);
      for (const a of def.affixes) {
        expect(DEBUFF_STATS.has(a.stat), `${def.id} uses debuff ${a.stat}`).toBe(false);
      }
    }
  });

  it('covers every equipment slot (so a slot-targeted drop can always find a unique)', () => {
    for (const slot of ALL_SLOTS) {
      const has = UNIQUES.some((u) => EQUIPMENT[u.baseId]?.slot === slot);
      expect(has, `slot ${slot}`).toBe(true);
    }
  });
});

describe('uniques are DB-driven (loaded from the seeded `uniques` table)', () => {
  initGameDb(':memory:');
  const c = getContent();

  it('loads the whole catalogue from the DB', () => {
    expect(c.uniques().length).toBe(UNIQUES.length);
    for (const def of UNIQUES) {
      const loaded = c.unique(def.id);
      expect(loaded, def.id).toBeDefined();
      expect(loaded!.affixes).toEqual(def.affixes);
    }
  });

  it('resolves uniquesForSlot via the items table', () => {
    for (const slot of ALL_SLOTS) {
      expect(c.uniquesForSlot(slot).length, slot).toBeGreaterThanOrEqual(1);
    }
  });

  it('mints a random legendary with base power/hp resolved from the items table', () => {
    const inst = c.rollRandomUnique(42, () => 0);
    expect(inst).toBeDefined();
    expect(inst!.rarity).toBe('unique');
    const def = c.uniques()[0]!;
    expect(inst!.name).toBe(def.name);
    const base = c.item(def.baseId)!;
    expect(inst!.power).toBeGreaterThanOrEqual(base.power ?? 0);
  });
});
