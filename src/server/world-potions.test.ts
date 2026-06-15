import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Quick-use potion belt: instant restore, a shared use-cooldown, a carry cap. The Healer refills the
 * belt; chests stock it. These tests import a wounded player (so a heal actually applies) and drive
 * usePotion directly.
 */
const woundedSave = (potions: { health: number; mana: number }): PlayerSave => ({
  name: 'Quaffer',
  hue: 0,
  hp: 10, // below max so a health potion has something to restore
  mana: 5,
  level: 5,
  xp: 0,
  gold: 0,
  loot: [],
  gear: [],
  equipment: {},
  god: false,
  quests: [],
  questsDone: [],
  potions,
});

describe('potion belt', () => {
  it('a health potion restores HP and consumes one, then the belt is on cooldown', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(1, woundedSave({ health: 2, mana: 2 }), 100, 100);

    const before = w.playerStats(1)!;
    expect(before.potions.health).toBe(2);
    w.usePotion(1, 'health');
    const after = w.playerStats(1)!;
    expect(after.potions.health).toBe(1); // one consumed
    expect(after.hp).toBeGreaterThan(before.hp); // and it healed

    // Shared cooldown: a second quaff right away is a no-op (count unchanged).
    w.usePotion(1, 'health');
    expect(w.playerStats(1)!.potions.health).toBe(1);
  });

  it('does nothing with an empty belt', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(2, woundedSave({ health: 0, mana: 0 }), 100, 100);
    const before = w.playerStats(2)!;
    w.usePotion(2, 'health');
    const after = w.playerStats(2)!;
    expect(after.potions.health).toBe(0);
    expect(after.hp).toBe(before.hp); // no heal
  });

  it('persists the belt across export/import', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(3, woundedSave({ health: 4, mana: 1 }), 100, 100);
    const save = w.exportPlayer(3)!;
    expect(save.potions).toEqual({ health: 4, mana: 1 });
  });

  it('a mana potion restores mana, consumes one, and never exceeds the cap', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(4, woundedSave({ health: 1, mana: 2 }), 100, 100);
    const before = w.playerStats(4)!;
    w.usePotion(4, 'mana');
    const after = w.playerStats(4)!;
    expect(after.potions.mana).toBe(1); // one consumed
    expect(after.mana).toBeGreaterThan(before.mana); // restored
    expect(after.mana).toBeLessThanOrEqual(after.maxMana); // clamped at the cap
  });

  it('quaffing at full HP or full mana is a no-op — no potion wasted', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(5, woundedSave({ health: 3, mana: 3 }), 100, 100);
    w.devHeal(5); // top off both bars

    w.usePotion(5, 'health');
    expect(w.playerStats(5)!.potions.health).toBe(3); // full HP → not consumed
    w.usePotion(5, 'mana');
    expect(w.playerStats(5)!.potions.mana).toBe(3); // full mana → not consumed
  });
});
