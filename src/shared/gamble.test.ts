import { describe, it, expect } from 'vitest';

import { type ItemSlot } from './equipment.js';
import { gambleCost, isGambleSlot, rollGamble } from './gamble.js';
import type { BaseItem } from './items.js';

/** A deterministic rng cycling through fixed draws — lets us assert exact picks. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

/**
 * The gamble pool is supplied by the caller (the server builds it from the content DB). These pure
 * tests pass an inline pool with multiple slots and 2+ bases in some slots (so the pick tests can
 * assert first vs. last), keeping the shared test free of any item-data import.
 */
const BASES: BaseItem[] = [
  { id: 'a_sword', name: 'A Sword', slot: 'mainhand', power: 6, hp: null },
  { id: 'b_sword', name: 'B Sword', slot: 'mainhand', power: 13, hp: null },
  { id: 'a_chest', name: 'A Chest', slot: 'chest', power: null, hp: 30 },
  { id: 'b_chest', name: 'B Chest', slot: 'chest', power: null, hp: 65 },
  { id: 'a_ring', name: 'A Ring', slot: 'ring', power: null, hp: null },
  { id: 'b_ring', name: 'B Ring', slot: 'ring', power: null, hp: null },
  { id: 'a_helm', name: 'A Helm', slot: 'head', power: null, hp: 12 },
];
const slotOf = (id: string): string => BASES.find((b) => b.id === id)!.slot;

/** The set of ItemSlots that actually have a base item in the pool. */
const SLOTS_WITH_BASES = Array.from(new Set(BASES.map((b) => b.slot))) as ItemSlot[];

describe('gambleCost', () => {
  it('uses 50 + 30 * level', () => {
    expect(gambleCost(1)).toBe(80);
    expect(gambleCost(2)).toBe(110);
    expect(gambleCost(10)).toBe(350);
    expect(gambleCost(100)).toBe(3050);
  });

  it('floors fractional levels and treats level < 1 as 1', () => {
    expect(gambleCost(1.9)).toBe(80); // floor -> 1
    expect(gambleCost(0)).toBe(80); // max(1, 0) -> 1
    expect(gambleCost(-5)).toBe(80); // clamped to 1
    expect(gambleCost(3.2)).toBe(140); // floor -> 3
  });
});

describe('isGambleSlot', () => {
  it('is true for slots that have base items', () => {
    expect(isGambleSlot('mainhand', BASES)).toBe(true);
    expect(isGambleSlot('chest', BASES)).toBe(true);
    expect(isGambleSlot('ring', BASES)).toBe(true);
  });

  it('is false for non-equip / unknown / empty slots', () => {
    expect(isGambleSlot('gold', BASES)).toBe(false);
    expect(isGambleSlot('bogus', BASES)).toBe(false);
    expect(isGambleSlot('', BASES)).toBe(false);
    expect(isGambleSlot('ring1', BASES)).toBe(false); // a doll slot, not an ItemSlot with bases
  });

  it('agrees with the pool for every real slot', () => {
    for (const slot of SLOTS_WITH_BASES) {
      expect(isGambleSlot(slot, BASES)).toBe(true);
    }
  });
});

describe('rollGamble', () => {
  it('returns an instance whose base item actually has the requested slot', () => {
    const inst = rollGamble(7, 'mainhand', BASES, seq([0.2, 0.5, 0.5, 0.5, 0.5]));
    expect(inst).not.toBeNull();
    expect(inst!.uid).toBe(7);
    expect(slotOf(inst!.baseId)).toBe('mainhand');
  });

  it('can pick any base in the slot pool depending on rng', () => {
    // rng() near 0 picks the first matching base; near 1 picks the last.
    const first = rollGamble(1, 'chest', BASES, seq([0.0]));
    const last = rollGamble(2, 'chest', BASES, seq([0.999]));
    expect(slotOf(first!.baseId)).toBe('chest');
    expect(slotOf(last!.baseId)).toBe('chest');
    expect(first!.baseId).not.toBe(last!.baseId);
  });

  it('resolves rings to a ring base (slot stays "ring")', () => {
    const inst = rollGamble(3, 'ring', BASES, seq([0.3, 0.5, 0.5, 0.5, 0.5]));
    expect(inst).not.toBeNull();
    expect(slotOf(inst!.baseId)).toBe('ring');
  });

  it('returns null for a slot with no bases', () => {
    expect(rollGamble(1, 'gold', BASES)).toBeNull();
    expect(rollGamble(1, 'bogus', BASES)).toBeNull();
    expect(rollGamble(1, '', BASES)).toBeNull();
    expect(rollGamble(1, 'ring1', BASES)).toBeNull();
  });

  it('never throws and always yields a matching-slot item across every valid slot', () => {
    let uid = 1000;
    for (const slot of SLOTS_WITH_BASES) {
      // Sweep a range of rng values so we exercise different base picks per slot.
      for (let v = 0; v < 1; v += 0.13) {
        const inst = rollGamble(uid++, slot, BASES, seq([v, 0.5, 0.5, 0.5, 0.5, 0.5]));
        expect(inst).not.toBeNull();
        expect(slotOf(inst!.baseId)).toBe(slot);
      }
    }
  });

  it('can roll above-common rarity (the gambling appeal)', () => {
    // A low rng feeds rollRarity past the common weight band, so we should not be stuck on common.
    const inst = rollGamble(42, 'mainhand', BASES, seq([0.2, 0.999, 0.5, 0.5, 0.5]));
    expect(inst).not.toBeNull();
    expect(inst!.rarity).not.toBe('common');
  });
});
