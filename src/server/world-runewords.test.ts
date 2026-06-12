import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';
import type { ItemInstance } from '../shared/items.js';

initGameDb(':memory:');

/**
 * Runewords: socket the right runes IN ORDER into an item to activate a named runeword whose bonus
 * affixes fold into the stat recompute. "Leech" = rune_nef + rune_vex (in order) → +12 power (among
 * others). Runes socket like gems (held as stackable loot). Wrong order doesn't form the word.
 */
const sworded = (sockets: (string | null)[], loot: [string, number][]): PlayerSave => ({
  name: 'Smith',
  hue: 0,
  hp: 100,
  mana: 100,
  level: 5,
  xp: 0,
  gold: 0,
  loot,
  gear: [],
  equipment: {
    mainhand: {
      uid: 5000,
      baseId: 'iron_sword',
      rarity: 'epic',
      power: 10,
      hp: 0,
      affixes: [],
      sockets,
    } satisfies ItemInstance,
  },
  god: false,
  quests: [],
  questsDone: [],
});

describe('runewords', () => {
  it('the right runes in order grant the runeword bonus', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(
      1,
      sworded(
        [null, null],
        [
          ['rune_nef', 1],
          ['rune_vex', 1],
        ],
      ),
      100,
      100,
    );
    const before = w.playerStats(1)!.power;

    w.socketGem(1, 'rune_nef');
    w.socketGem(1, 'rune_vex'); // [nef, vex] → "Leech" → +12 power
    const after = w.playerStats(1)!.power;
    expect(after).toBeGreaterThan(before + 10);
  });

  it('the wrong order does not form a runeword', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(
      2,
      sworded(
        [null, null],
        [
          ['rune_nef', 1],
          ['rune_vex', 1],
        ],
      ),
      100,
      100,
    );
    const before = w.playerStats(2)!.power;
    w.socketGem(2, 'rune_vex');
    w.socketGem(2, 'rune_nef'); // [vex, nef] → no runeword
    expect(w.playerStats(2)!.power).toBe(before); // runes alone add no power
  });
});
