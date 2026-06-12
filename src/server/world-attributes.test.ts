import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Attributes: points are earned on level-up and spent to raise strength/vitality/dexterity/energy,
 * which feed power/maxHp/crit/mana-regen via the stat recompute. The server is authoritative — it
 * ignores allocation with no points and refuses unknown attribute keys.
 */
const save = (level: number, attrPoints: number): PlayerSave => ({
  name: 'Hero',
  hue: 0,
  hp: 100,
  mana: 100,
  level,
  xp: 0,
  gold: 0,
  loot: [],
  gear: [],
  equipment: {},
  god: false,
  quests: [],
  questsDone: [],
  attrPoints,
  attributes: { strength: 10, vitality: 10, dexterity: 10, energy: 10 },
});

describe('attribute allocation', () => {
  it('spending a point on vitality raises max HP and consumes the point', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(1, save(5, 4), 100, 100);
    const before = w.playerStats(1)!;
    expect(before.attrPoints).toBe(4);

    w.allocateAttribute(1, 'vitality');
    const after = w.playerStats(1)!;
    expect(after.attrPoints).toBe(3);
    expect(after.attributes.vitality).toBe(11);
    expect(after.maxHp).toBeGreaterThan(before.maxHp); // +4 HP per vitality
  });

  it('strength raises power; with no points or a bad key it does nothing', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(2, save(5, 2), 100, 100);
    const basePower = w.playerStats(2)!.power;
    w.allocateAttribute(2, 'strength');
    w.allocateAttribute(2, 'strength');
    expect(w.playerStats(2)!.power).toBe(basePower + 1); // +1 power per 2 strength

    w.allocateAttribute(2, 'strength'); // out of points now → no-op
    expect(w.playerStats(2)!.attrPoints).toBe(0);
    expect(w.playerStats(2)!.attributes.strength).toBe(12);

    w.importPlayer(3, save(5, 5), 100, 100);
    w.allocateAttribute(3, 'cleverness'); // not a real attribute → ignored
    expect(w.playerStats(3)!.attrPoints).toBe(5);
  });

  it('a pre-attribute save is granted points retroactively for its levels', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    const legacy = save(6, 0);
    delete (legacy as { attributes?: unknown }).attributes; // simulate an old save
    w.importPlayer(4, legacy, 100, 100);
    expect(w.playerStats(4)!.attrPoints).toBe((6 - 1) * 5); // ATTR_POINTS_PER_LEVEL
  });
});
