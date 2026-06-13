import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Co-op kill credit (dopamine-first): every player who DAMAGES a mob shares full XP when it dies,
 * regardless of who lands the last hit — no last-hit stealing. The mob is marked `tagged` in the
 * snapshot so others can see it's already engaged (and pile in for their own share).
 */
describe('shared tag credit', () => {
  it('both damagers gain XP from one kill — last hit does not matter', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'wilderness', undefined, 0, 5);
    const a = w.spawn('A', { x: 800, y: 600 });
    const b = w.spawn('B', { x: 815, y: 600 });
    w.setLevel(a, 40);
    w.setLevel(b, 40);
    w.toggleGod(a);
    w.toggleGod(b);
    // A and B are NOT partied (no resolver) — pure free-tag credit.

    const beforeA = w.playerStats(a)!.xp;
    const beforeB = w.playerStats(b)!.xp;
    for (let t = 0; t < 600; t++) {
      const wolf = w.snapshot().find((e) => e.kind === 'mob' && e.hp > 0);
      if (!wolf) {
        w.spawnMobAt(a, 'wolf');
        continue;
      }
      // A chips it, B chips it — alternate so both are taggers before it dies.
      w.cast(t % 2 === 0 ? a : b, 'slash', wolf.x - (t % 2 === 0 ? 800 : 815), wolf.y - 600);
      w.tick(0.05);
      if (w.playerStats(a)!.xp > beforeA && w.playerStats(b)!.xp > beforeB) break;
    }
    expect(w.playerStats(a)!.xp).toBeGreaterThan(beforeA);
    expect(w.playerStats(b)!.xp).toBeGreaterThan(beforeB); // B shared the kill without last-hitting
  });

  it('a damaged mob is flagged tagged in the snapshot', () => {
    const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'wilderness', undefined, 0, 9);
    const a = w.spawn('Tagger', { x: 800, y: 600 });
    w.setLevel(a, 40);
    w.toggleGod(a);
    w.spawnMobAt(a, 'wolf');
    expect(w.snapshot().find((e) => e.kind === 'mob')!.tagged).toBeUndefined(); // untouched

    for (let t = 0; t < 60; t++) {
      const wolf = w.snapshot().find((e) => e.kind === 'mob' && e.hp > 0);
      if (!wolf) break;
      w.cast(a, 'slash', wolf.x - 800, wolf.y - 600);
      w.tick(0.05);
      const tagged = w.snapshot().find((e) => e.kind === 'mob' && e.hp > 0)?.tagged;
      if (tagged) {
        expect(tagged).toBe(true); // engaged mobs read as claimed
        return;
      }
    }
    throw new Error('the mob was never tagged despite being hit');
  });
});

describe('co-op difficulty', () => {
  it('monsters hit harder with more living players in the instance', () => {
    // Two identical worlds, same seed; one solo, one with extra bystanders. The crowded one's
    // mob should deal more damage per hit (coopDamageScale grows with the head-count).
    const measure = (extraPlayers: number) => {
      const w = new World(1600, 1200, { x: 800, y: 600 }, undefined, 'wilderness', undefined, 0, 3);
      const victim = w.spawn('Victim', { x: 800, y: 600 });
      // Bystanders far across the map: they raise the instance head-count (coop scale) without the
      // wolf ever choosing one of them as its nearer target.
      for (let i = 0; i < extraPlayers; i++) w.spawn(`Buddy${i}`, { x: 100 + i * 20, y: 100 });
      w.spawnMobAt(victim, 'wolf');
      const startHp = w.playerStats(victim)!.hp;
      // Let the wolf wail on the (non-god) victim for a while.
      for (let t = 0; t < 200 && !w.playerStats(victim)!.dead; t++) w.tick(0.05);
      return startHp - w.playerStats(victim)!.hp;
    };
    const soloDamage = measure(0);
    const crowdedDamage = measure(4);
    expect(crowdedDamage).toBeGreaterThan(soloDamage);
  });
});
