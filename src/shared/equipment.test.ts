import { describe, expect, it } from 'vitest';
import { EQUIPMENT, equipDef, isEquip } from './equipment.js';

describe('equipment defs', () => {
  it('recognizes equippable item ids', () => {
    expect(isEquip('iron_sword')).toBe(true);
    expect(isEquip('wolf_pelt')).toBe(false);
  });

  it('weapons carry power, armor carries hp', () => {
    expect(EQUIPMENT.iron_sword!.power).toBeGreaterThan(0);
    expect(EQUIPMENT.iron_armor!.hp).toBeGreaterThan(0);
    expect(equipDef('leather_armor')?.slot).toBe('armor');
  });
});
