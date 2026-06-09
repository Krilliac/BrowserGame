import { describe, expect, it } from 'vitest';
import { EQUIPMENT, equipDef, isEquip, rollEquipDrop } from './equipment.js';

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

describe('rollEquipDrop', () => {
  it('returns null when the roll misses the drop chance', () => {
    expect(rollEquipDrop(3, () => 0.9)).toBeNull();
  });

  it('drops the low tier for low-level mobs and high tier for level >= 5', () => {
    // first rng < 0.15 = drop; second rng < 0.5 = weapon.
    expect(rollEquipDrop(2, seq([0.0, 0.0]))).toBe('rusty_sword');
    expect(rollEquipDrop(8, seq([0.0, 0.0]))).toBe('iron_sword');
    expect(rollEquipDrop(2, seq([0.0, 0.9]))).toBe('leather_armor');
    expect(rollEquipDrop(8, seq([0.0, 0.9]))).toBe('iron_armor');
  });
});

function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}
