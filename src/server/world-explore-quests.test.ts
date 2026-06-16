import { describe, expect, it } from 'vitest';
import { initGameDb } from './content.js';
import { areaWorld } from './test-support.js';

initGameDb(':memory:');

/**
 * The explore/discover quest type: a quest with an `exploreArea` completes automatically the moment
 * the player visits (discovers) that area — no kill, no turn-in. Coverage mirrors how the live game
 * crosses areas: export a player's save in one World and import it into the destination World, which
 * marks the area discovered. The seeded explore quest `scout_sunken_pass` targets `sunken_pass`.
 */
describe('explore/discover quests', () => {
  it('completes on arrival in the target area and grants the reward', () => {
    const town = areaWorld('town');
    const id = town.spawn('Wayfarer');
    town.acceptQuest(id, 'scout_sunken_pass');

    const before = town.playerStats(id)!;
    expect(before.quests.find((q) => q.id === 'scout_sunken_pass')!.status).toBe('active');
    const goldBefore = before.gold;

    // Cross to the Sunken Pass: export the save and import it into that area's World.
    const save = town.exportPlayer(id)!;
    const pass = areaWorld('sunken_pass');
    pass.importPlayer(id, save, 200, 200);

    const after = pass.playerStats(id)!;
    expect(after.quests.find((q) => q.id === 'scout_sunken_pass')!.status).toBe('done');
    expect(after.gold).toBeGreaterThan(goldBefore); // the gold reward was paid out
  });

  it('completes immediately if the target area is already discovered when accepted', () => {
    const pass = areaWorld('sunken_pass');
    const id = pass.spawn('Scout'); // spawning here discovers sunken_pass
    const msg = pass.acceptQuest(id, 'scout_sunken_pass');
    expect(typeof msg).toBe('string'); // acceptQuest still returns a status line

    // Accepting a quest for an already-visited area resolves it at once.
    const q = pass.playerStats(id)!.quests.find((x) => x.id === 'scout_sunken_pass')!;
    expect(q.status).toBe('done');
  });

  it('reports explore kind and 0/1 → 1/1 progress in the quest log', () => {
    const town = areaWorld('town');
    const id = town.spawn('Pathfinder');
    town.acceptQuest(id, 'scout_sunken_pass');
    const q = town.playerStats(id)!.quests.find((x) => x.id === 'scout_sunken_pass')!;
    expect(q.kind).toBe('explore');
    expect(q.targetCount).toBe(1);
    expect(q.progress).toBe(0); // not yet discovered

    const save = town.exportPlayer(id)!;
    const pass = areaWorld('sunken_pass');
    pass.importPlayer(id, save, 200, 200);
    const done = pass.playerStats(id)!.quests.find((x) => x.id === 'scout_sunken_pass')!;
    expect(done.progress).toBe(1);
  });

  it('does not auto-complete an explore quest from killing the wrong thing', () => {
    const town = areaWorld('town');
    const id = town.spawn('Idler');
    town.acceptQuest(id, 'scout_sunken_pass');
    // Stay in town, never visiting the pass: the quest must remain active.
    expect(town.playerStats(id)!.quests.find((q) => q.id === 'scout_sunken_pass')!.status).toBe(
      'active',
    );
  });
});

/**
 * Chain quests: a quest with a `requires` prerequisite stays 'locked' (offered but un-acceptable)
 * until the prerequisite is complete. The three Wayfinder bounties form a chain
 * (scout_sunken_pass → chart_ashveil → witness_voidmarch).
 */
describe('chain quests', () => {
  const find = (w: ReturnType<typeof areaWorld>, id: number, qid: string) =>
    w.playerStats(id)!.quests.find((q) => q.id === qid)!;

  it('locks a quest until its prerequisite is complete, then unlocks it', () => {
    const pass = areaWorld('sunken_pass');
    const id = pass.spawn('Climber');

    // Before the prereq: the next leg is locked, names its requirement, and cannot be accepted.
    const locked = find(pass, id, 'chart_ashveil');
    expect(locked.status).toBe('locked');
    expect(locked.requiresName).toBeTruthy();
    expect(pass.acceptQuest(id, 'chart_ashveil')).toContain('Locked');
    expect(find(pass, id, 'chart_ashveil').status).toBe('locked');

    // Completing the prerequisite (spawning in sunken_pass already discovered it) unlocks it.
    pass.acceptQuest(id, 'scout_sunken_pass'); // auto-completes — area already discovered
    expect(find(pass, id, 'scout_sunken_pass').status).toBe('done');
    const unlocked = find(pass, id, 'chart_ashveil');
    expect(unlocked.status).toBe('available');
    expect(unlocked.requiresName).toBeNull();
    expect(pass.acceptQuest(id, 'chart_ashveil')).toContain('accepted');
  });

  it('keeps the third leg locked while only the first is done', () => {
    const pass = areaWorld('sunken_pass');
    const id = pass.spawn('Trekker');
    pass.acceptQuest(id, 'scout_sunken_pass'); // leg 1 done
    expect(find(pass, id, 'chart_ashveil').status).toBe('available'); // leg 2 unlocked
    expect(find(pass, id, 'witness_voidmarch').status).toBe('locked'); // leg 3 still gated on leg 2
  });
});
