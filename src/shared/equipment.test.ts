import { describe, expect, it } from 'vitest';
import { EQUIP_SLOTS, SLOT_LABELS, dollSlotsFor } from './equipment.js';

/**
 * equipment.ts is now slot TYPES + labels only — the item base DATA is database-driven (see
 * src/server/db/seed-items.test.ts). These tests cover the shared slot contract.
 */
describe('equipment slot contract', () => {
  it('every doll slot has a label', () => {
    for (const slot of EQUIP_SLOTS) {
      expect(SLOT_LABELS[slot], slot).toBeTruthy();
    }
  });

  it('maps an item slot to its doll slot(s); rings fill either ring slot', () => {
    expect(dollSlotsFor('chest')).toEqual(['chest']);
    expect(dollSlotsFor('mainhand')).toEqual(['mainhand']);
    expect(dollSlotsFor('ring')).toEqual(['ring1', 'ring2']);
  });

  it('exposes the 13 doll slots (two ring positions)', () => {
    expect(EQUIP_SLOTS).toContain('ring1');
    expect(EQUIP_SLOTS).toContain('ring2');
    expect(EQUIP_SLOTS.length).toBe(13);
  });
});
