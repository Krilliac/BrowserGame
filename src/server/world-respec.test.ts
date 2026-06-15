import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';
import { BASE_ATTRIBUTE } from '../shared/attributes.js';

initGameDb(':memory:');

/**
 * Respec: refund every allocated attribute + skill point for a level-scaled gold cost, resetting the
 * build. The server conserves points (counts what's allocated, never invents/loses any) and validates
 * gold + that there's something to refund before mutating anything.
 */
const save = (over: Partial<PlayerSave> = {}): PlayerSave => ({
  name: 'Hero',
  hue: 0,
  hp: 100,
  mana: 100,
  level: 10,
  xp: 0,
  gold: 1000,
  loot: [],
  gear: [],
  equipment: {},
  god: false,
  quests: [],
  questsDone: [],
  attrPoints: 0,
  attributes: { strength: 15, vitality: 13, dexterity: 10, energy: 10 }, // 5 + 3 = 8 points spent
  skills: ['off-might', 'off-precision'],
  skillPoints: 1,
  ...over,
});

const world = (): World => new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');

describe('respec', () => {
  it('refunds allocated points, resets the build, and charges level-scaled gold', () => {
    const w = world();
    w.importPlayer(1, save(), 100, 100);
    const res = w.respec(1);
    expect(res.ok).toBe(true);

    const out = w.exportPlayer(1)!;
    // 8 attribute points were spent (above the base of 10); they come back on top of the 0 unspent.
    expect(out.attrPoints).toBe(8);
    for (const v of Object.values(out.attributes!)) expect(v).toBe(BASE_ATTRIBUTE);
    // 2 nodes refunded on top of the 1 unspent skill point.
    expect(out.skillPoints).toBe(3);
    expect(out.skills).toEqual([]);
    // Cost = level(10) * 50 = 500, deducted from 1000.
    expect(out.gold).toBe(500);
  });

  it('is a no-op when nothing is allocated', () => {
    const w = world();
    const blank = save({ skills: [], skillPoints: 0 });
    blank.attributes = { strength: 10, vitality: 10, dexterity: 10, energy: 10 }; // all at base
    w.importPlayer(2, blank, 100, 100);
    const res = w.respec(2);
    expect(res.ok).toBe(false);
    expect(w.exportPlayer(2)!.gold).toBe(1000); // untouched
  });

  it('refuses and changes nothing when the player cannot afford it', () => {
    const w = world();
    w.importPlayer(3, save({ gold: 100 }), 100, 100); // cost 500 > 100
    const res = w.respec(3);
    expect(res.ok).toBe(false);
    const out = w.exportPlayer(3)!;
    expect(out.gold).toBe(100);
    expect(out.attributes!.strength).toBe(15); // build intact
    expect(out.skills).toEqual(['off-might', 'off-precision']);
  });
});
