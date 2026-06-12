import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * The host owns party membership (it spans instances), and injects a resolver so a kill shares XP +
 * quest credit with co-party members present in the same instance. These tests exercise that glue.
 */
describe('party shared XP + quest credit', () => {
  it('credits XP to a present party member on a kill, not just the killer', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'wilderness');
    const killer = w.spawn('Killer', { x: 800, y: 600 });
    const buddy = w.spawn('Buddy', { x: 820, y: 600 });
    // Wire a party of the two: each is the other's co-member.
    w.setPartyResolver((id) => (id === killer ? [buddy] : id === buddy ? [killer] : []));
    w.setLevel(killer, 50); // one-shot wolves
    w.toggleGod(killer);

    const before = w.playerStats(buddy)!.xp;
    for (let t = 0; t < 400 && w.playerStats(buddy)!.xp === before; t++) {
      w.spawnMobAt(killer, 'wolf');
      w.cast(killer, 'slash', 1, 0);
      w.tick(0.05);
    }
    expect(w.playerStats(buddy)!.xp).toBeGreaterThan(before); // buddy shared the kill XP
  });

  it('does not credit a party member who is NOT in this instance (resolver filters them out)', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'wilderness');
    const killer = w.spawn('Solo', { x: 800, y: 600 });
    const elsewhere = w.spawn('Away', { x: 200, y: 200 });
    // The host's resolver reports NO co-members present here (the party member is in another area).
    w.setPartyResolver(() => []);
    w.setLevel(killer, 50);
    w.toggleGod(killer);

    const before = w.playerStats(elsewhere)!.xp;
    for (let t = 0; t < 40; t++) {
      w.spawnMobAt(killer, 'wolf');
      w.cast(killer, 'slash', 1, 0);
      w.tick(0.05);
    }
    expect(w.playerStats(elsewhere)!.xp).toBe(before); // no shared credit across instances
  });

  it('shares quest progress with present party members', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'wilderness');
    const a = w.spawn('A', { x: 800, y: 600 });
    const b = w.spawn('B', { x: 820, y: 600 });
    w.setPartyResolver((id) => (id === a ? [b] : id === b ? [a] : []));
    w.acceptQuest(a, 'wolf_cull');
    w.acceptQuest(b, 'wolf_cull');
    w.setLevel(a, 50);
    w.toggleGod(a);

    for (let t = 0; t < 400; t++) {
      const qa = w.playerStats(a)!.quests.find((q) => q.id === 'wolf_cull')!;
      const qb = w.playerStats(b)!.quests.find((q) => q.id === 'wolf_cull')!;
      if (qa.status === 'done' && qb.status === 'done') break;
      w.spawnMobAt(a, 'wolf');
      w.cast(a, 'slash', 1, 0);
      w.tick(0.05);
    }
    // Both party members completed the kill quest from A's kills.
    expect(w.playerStats(b)!.quests.find((q) => q.id === 'wolf_cull')!.status).toBe('done');
  });
});
