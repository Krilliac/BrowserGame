import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Passive skill tree: a skill point is earned per level, spent on nodes whose prerequisites are met.
 * Allocated nodes fold into the stat recompute. The server validates points + prerequisites.
 * `off-might` is a tier-0 offense root (grants power); `off-precision` requires `off-might`.
 */
const save = (level: number, skillPoints: number, skills: string[] = []): PlayerSave => ({
  name: 'Adept',
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
  skills,
  skillPoints,
});

describe('skill tree allocation', () => {
  it('allocating a root node boosts a stat and spends the point', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(1, save(5, 3), 100, 100);
    const before = w.playerStats(1)!;
    expect(before.skillPoints).toBe(3);

    w.allocateSkill(1, 'off-might');
    const after = w.playerStats(1)!;
    expect(after.skillPoints).toBe(2);
    expect(after.skills).toContain('off-might');
    expect(after.power).toBeGreaterThan(before.power); // off-might grants power
  });

  it('refuses a node whose prerequisites are not met, and unknown nodes', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    w.importPlayer(2, save(5, 3), 100, 100);
    w.allocateSkill(2, 'off-precision'); // requires off-might, not yet taken → rejected
    expect(w.playerStats(2)!.skills).not.toContain('off-precision');
    expect(w.playerStats(2)!.skillPoints).toBe(3);

    w.allocateSkill(2, 'not-a-real-node');
    expect(w.playerStats(2)!.skillPoints).toBe(3);

    // After the prerequisite is allocated, the child is allowed.
    w.allocateSkill(2, 'off-might');
    w.allocateSkill(2, 'off-precision');
    expect(w.playerStats(2)!.skills).toContain('off-precision');
  });

  it('grants skill points to a pre-skill save retroactively for its levels', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');
    const legacy = save(7, 0);
    delete (legacy as { skills?: unknown }).skills;
    delete (legacy as { skillPoints?: unknown }).skillPoints;
    w.importPlayer(3, legacy, 100, 100);
    expect(w.playerStats(3)!.skillPoints).toBe((7 - 1) * 1); // SKILL_POINTS_PER_LEVEL
  });
});
