import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Achievements wiring: the earned-id set persists in the save, and /achievements renders earned vs
 * in-progress. The unlock math (newlyEarned) is unit-tested in achievements.test.ts; here we cover
 * the save round-trip + the status display the World exposes to the command.
 */
function save(level: number, gold: number, earned: string[], kills = 0): PlayerSave {
  return {
    name: 'Hero',
    hue: 0,
    hp: 100,
    mana: 100,
    level,
    xp: 0,
    gold,
    loot: [],
    gear: [],
    equipment: {},
    god: false,
    quests: [],
    questsDone: [],
    earnedAchievements: earned,
    kills,
  };
}

const world = (): World => new World(1600, 1200, { x: 800, y: 600 }, undefined, 'town');

describe('world achievements', () => {
  it('persists the earned-achievement set across export/import', () => {
    const w = world();
    w.importPlayer(1, save(12, 0, ['level_apprentice']), 100, 100);
    const out = w.exportPlayer(1)!;
    expect(out.earnedAchievements).toEqual(['level_apprentice']);
  });

  it('defaults to no achievements for a pre-achievement save', () => {
    const w = world();
    const legacy = save(5, 0, []);
    delete (legacy as { earnedAchievements?: string[] }).earnedAchievements; // simulate an old save
    w.importPlayer(2, legacy, 100, 100);
    expect(w.exportPlayer(2)!.earnedAchievements).toEqual([]);
  });

  it('status ticks met milestones and shows progress for the rest', () => {
    const w = world();
    w.importPlayer(3, save(10, 0, []), 100, 100); // level 10 → Apprentice met, Adept (20) not
    const lines = w.achievementStatus(3);
    expect(lines.some((l) => l.startsWith('✓') && l.includes('Apprentice'))).toBe(true);
    expect(lines.some((l) => l.includes('Adept') && l.includes('10/20'))).toBe(true);
  });

  it('tracks kills: persists the count and surfaces kill milestones', () => {
    const w = world();
    w.importPlayer(4, save(5, 0, [], 150), 100, 100); // 150 lifetime kills → Slayer (100) met
    expect(w.exportPlayer(4)!.kills).toBe(150);
    const lines = w.achievementStatus(4);
    expect(lines.some((l) => l.startsWith('✓') && l.includes('Slayer'))).toBe(true);
    expect(lines.some((l) => l.includes('Exterminator') && l.includes('150/500'))).toBe(true);
  });
});
