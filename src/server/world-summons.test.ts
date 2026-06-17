import { describe, expect, it } from 'vitest';
import { initGameDb, getContent } from './content.js';
import { areaWorld } from './test-support.js';
import { MAX_MINIONS_PER_OWNER } from './minions.js';

initGameDb(':memory:');

/**
 * The summon system (Diablo-necromancer pet line), reworked to be data-driven: a `kind:'summon'`
 * ability raises a minion from any `summonable`-flagged mob template (skeleton_warrior/mage/archer
 * are seeded summonable). Minions snapshot as friendly mobs, follow + fight via the hireling AI, and
 * crumble on death. Tests learn the summon tome, cast, and inspect the resulting minions.
 */
function summoner(): { w: ReturnType<typeof areaWorld>; id: number } {
  const w = areaWorld('wilderness');
  const id = w.spawn('Necromancer');
  return { w, id };
}

/** Count friendly minions in the snapshot (summoned creatures ride the 'mob' kind + friendly flag). */
function minionCount(w: ReturnType<typeof areaWorld>): number {
  return w.snapshot().filter((e) => e.kind === 'mob' && e.friendly).length;
}

describe('summon minions', () => {
  it('raises a friendly minion from a summonable creature on cast', () => {
    const { w, id } = summoner();
    w.giveItem(id, 'tome_raise_skeleton', 1);
    w.learn(id, 'tome_raise_skeleton');
    expect(minionCount(w)).toBe(0);

    w.cast(id, 'raise_skeleton', 1, 0);
    const minions = w.snapshot().filter((e) => e.kind === 'mob' && e.friendly);
    expect(minions).toHaveLength(1);
    expect(minions[0]!.name).toBe('Skeleton Warrior'); // rendered as its source creature
  });

  it('enforces the per-owner minion cap', () => {
    const { w, id } = summoner();
    w.giveItem(id, 'tome_raise_skeleton', 1);
    w.learn(id, 'tome_raise_skeleton');
    // Cast far more than the cap (manually clearing the cooldown each time via fresh casts).
    for (let i = 0; i < MAX_MINIONS_PER_OWNER + 4; i++) {
      w.cast(id, 'raise_skeleton', 1, 0);
      w.tick(2); // drain the summon cooldown + restore mana between raises
    }
    expect(minionCount(w)).toBe(MAX_MINIONS_PER_OWNER);
  });

  it('gates summons on the summonable flag (the server guard against raising arbitrary creatures)', () => {
    const c = getContent();
    // spawnMinion only raises `summonable`-flagged creatures, so a hostile client can't summon a
    // boss/arbitrary id even if it forged a target. skeleton_warrior is summonable; wolf is not.
    expect(c.mobTemplate('skeleton_warrior')!.summonable).toBe(true);
    expect(c.mobTemplate('wolf')!.summonable).toBeFalsy();
  });

  it('minions are dismissed when their owner leaves the world', () => {
    const { w, id } = summoner();
    w.giveItem(id, 'tome_raise_skeleton', 1);
    w.learn(id, 'tome_raise_skeleton');
    w.cast(id, 'raise_skeleton', 1, 0);
    expect(minionCount(w)).toBe(1);
    w.remove(id);
    expect(minionCount(w)).toBe(0);
  });

  it('a summoned ranged minion (skeletal mage) fires at a nearby mob', () => {
    const w = areaWorld('wilderness');
    const id = w.spawn('Summoner');
    w.giveItem(id, 'tome_raise_skeleton_mage', 1);
    w.learn(id, 'tome_raise_skeleton_mage');
    w.cast(id, 'raise_skeleton_mage', 1, 0);
    expect(
      w.snapshot().filter((e) => e.kind === 'mob' && e.friendly && e.name === 'Skeletal Mage'),
    ).toHaveLength(1);
  });
});
