import { describe, expect, it } from 'vitest';
import { EQUIP_SLOTS, type ItemSlot } from '../../shared/equipment.js';
import { getContent, initGameDb } from '../content.js';
import { EQUIPMENT, MATERIALS } from './seed-items.js';

const ITEM_SLOTS: ItemSlot[] = [
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

describe('item base catalogue (seed-items.ts)', () => {
  it('every base is well-formed (id matches key, real slot, a color)', () => {
    for (const [id, def] of Object.entries(EQUIPMENT)) {
      expect(def.id, `${id} id`).toBe(id);
      expect(def.name, `${id} name`).toBeTruthy();
      expect(ITEM_SLOTS.includes(def.slot), `${id} slot ${def.slot}`).toBe(true);
      expect(def.color, `${id} color`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('covers every item slot at least once', () => {
    for (const slot of ITEM_SLOTS) {
      expect(
        Object.values(EQUIPMENT).some((e) => e.slot === slot),
        `slot ${slot}`,
      ).toBe(true);
    }
    // doll slots are derived from item slots; the two ring positions share the 'ring' item slot.
    expect(EQUIP_SLOTS.length).toBeGreaterThan(ITEM_SLOTS.length - 1);
  });

  it('materials include gold and the loot mats, each with a name + color', () => {
    expect(MATERIALS.gold).toBeDefined();
    for (const [id, m] of Object.entries(MATERIALS)) {
      expect(m.name, `${id} name`).toBeTruthy();
      expect(m.color, `${id} color`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('item bases are database-driven (seeded into the items table)', () => {
  initGameDb(':memory:');
  const c = getContent();

  it('every authored base lands in the items table as an equip row', () => {
    for (const [id, def] of Object.entries(EQUIPMENT)) {
      const row = c.item(id);
      expect(row, id).toBeDefined();
      expect(row!.kind, id).toBe('equip');
      expect(row!.slot, id).toBe(def.slot);
    }
  });

  it('every material lands in the items table (currency for gold, loot otherwise)', () => {
    for (const id of Object.keys(MATERIALS)) {
      const row = c.item(id);
      expect(row, id).toBeDefined();
      expect(row!.kind, id).toBe(id === 'gold' ? 'currency' : 'loot');
    }
  });
});
