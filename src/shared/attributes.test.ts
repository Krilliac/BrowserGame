import { describe, expect, it } from 'vitest';
import {
  attributeBonuses,
  emptyAttributes,
  toAttributeSet,
  BASE_ATTRIBUTE,
  ATTRIBUTE_KEYS,
} from './attributes.js';

describe('attributes', () => {
  it('a fresh set sits at the base with zero bonuses', () => {
    const a = emptyAttributes();
    for (const k of ATTRIBUTE_KEYS) expect(a[k]).toBe(BASE_ATTRIBUTE);
    expect(attributeBonuses(a)).toEqual({ power: 0, maxHp: 0, critChance: 0, manaRegen: 0 });
  });

  it('each attribute feeds its derived stat', () => {
    const b = attributeBonuses({
      strength: BASE_ATTRIBUTE + 10,
      vitality: BASE_ATTRIBUTE + 10,
      dexterity: BASE_ATTRIBUTE + 10,
      energy: BASE_ATTRIBUTE + 10,
    });
    expect(b.power).toBe(5); // +1 per 2 strength
    expect(b.maxHp).toBe(40); // +4 per vitality
    expect(b.critChance).toBeCloseTo(0.02); // +0.2% per dexterity
    expect(b.manaRegen).toBeCloseTo(3); // +0.3/sec per energy
  });

  it('coerces persisted / partial / invalid values to a valid set', () => {
    expect(toAttributeSet(undefined)).toEqual(emptyAttributes());
    const a = toAttributeSet({ strength: 25, vitality: 2 /* below base, ignored */ });
    expect(a.strength).toBe(25);
    expect(a.vitality).toBe(BASE_ATTRIBUTE);
  });
});
