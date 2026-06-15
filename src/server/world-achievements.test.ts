import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Achievements wiring: the earned-id set persists in the save, and /achievements renders earned vs
 * in-progress. The unlock math (newlyEarned) is unit-tested in achievements.test.ts; here we cover
 * the save round-trip + the status display the World exposes to the command.
 */
function save(
  level: number,
  gold: number,
  earned: string[],
  kills = 0,
  bestiary: string[] = [],
  deathlessStreak = 0,
  bestDeathlessStreak = deathlessStreak,
  bossKills = 0,
  questsDone: string[] = [],
): PlayerSave {
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
    questsDone,
    earnedAchievements: earned,
    kills,
    bossKills,
    bestiary,
    deathlessStreak,
    bestDeathlessStreak,
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

  it('tracks the bestiary: persists distinct species and feeds collection milestones', () => {
    const w = world();
    const species = Array.from({ length: 12 }, (_, i) => `mob_${i}`); // 12 distinct → Naturalist (10) met
    w.importPlayer(5, save(5, 0, [], 200, species), 100, 100);
    expect(w.exportPlayer(5)!.bestiary?.sort()).toEqual([...species].sort());
    const lines = w.achievementStatus(5);
    expect(lines.some((l) => l.startsWith('✓') && l.includes('Naturalist'))).toBe(true);
    expect(lines.some((l) => l.includes('Zoologist') && l.includes('12/30'))).toBe(true);
  });

  it('bestiaryStatus reports the distinct-species count, or a hint when empty', () => {
    const w = world();
    w.importPlayer(6, save(5, 0, []), 100, 100);
    expect(w.bestiaryStatus(6)[0]).toMatch(/no monsters slain/i);
    w.importPlayer(7, save(5, 0, [], 0, ['goblin', 'skeleton']), 100, 100);
    expect(w.bestiaryStatus(7)[0]).toContain('2 species');
  });

  it('tracks the deathless streak: persists it and surfaces no-death milestones', () => {
    const w = world();
    w.importPlayer(8, save(5, 0, [], 0, [], 60), 100, 100); // 60-kill streak → Untouchable (50) met
    expect(w.exportPlayer(8)!.deathlessStreak).toBe(60);
    const lines = w.achievementStatus(8);
    expect(lines.some((l) => l.startsWith('✓') && l.includes('Untouchable'))).toBe(true);
    expect(lines.some((l) => l.includes('Immortal') && l.includes('60/200'))).toBe(true);
  });

  it('persists the best (record) deathless streak for the ladder', () => {
    const w = world();
    // Current streak 5 but a recorded best of 120 — the record survives the round-trip.
    w.importPlayer(9, save(5, 0, [], 0, [], 5, 120), 100, 100);
    expect(w.exportPlayer(9)!.bestDeathlessStreak).toBe(120);
  });

  it('floors the record to the current streak on an old save that lacks one', () => {
    const w = world();
    const legacy = save(5, 0, [], 0, [], 40);
    delete (legacy as { bestDeathlessStreak?: number }).bestDeathlessStreak; // pre-record save
    w.importPlayer(10, legacy, 100, 100);
    expect(w.exportPlayer(10)!.bestDeathlessStreak).toBe(40);
  });

  it('tracks completed quests: surfaces quest milestones from questsDone', () => {
    const w = world();
    const done = ['q1', 'q2', 'q3', 'q4']; // 4 quests done → Adventurer (3) met
    w.importPlayer(12, save(5, 0, [], 0, [], 0, 0, 0, done), 100, 100);
    const lines = w.achievementStatus(12);
    expect(lines.some((l) => l.startsWith('✓') && l.includes('Adventurer'))).toBe(true);
    expect(lines.some((l) => l.includes('Questmaster') && l.includes('4/12'))).toBe(true);
  });

  it('tracks boss kills: persists the count and surfaces boss-slayer milestones', () => {
    const w = world();
    w.importPlayer(11, save(5, 0, [], 0, [], 0, 0, 8), 100, 100); // 8 boss kills → Boss Hunter (5) met
    expect(w.exportPlayer(11)!.bossKills).toBe(8);
    const lines = w.achievementStatus(11);
    expect(lines.some((l) => l.startsWith('✓') && l.includes('Boss Hunter'))).toBe(true);
    expect(lines.some((l) => l.includes('Bane of Champions') && l.includes('8/25'))).toBe(true);
  });
});
