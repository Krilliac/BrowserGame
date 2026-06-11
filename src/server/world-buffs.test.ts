import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Integration coverage for the buff system end-to-end through the World: learning a buff tome,
 * casting it, and observing the effect in the player tick. (StatusSet's own math is unit-tested in
 * status-effects.test.ts; this pins the cast → buff → tick wiring.)
 */
describe('buff spells (World integration)', () => {
  /** Level a fresh player up so maxHp jumps above current hp, making HP regen observable. */
  function woundedAtLevel(level: number): { w: World; id: number } {
    const w = new World();
    const id = w.spawn('Subject');
    w.setLevel(id, level); // raises maxHp; hp stays at the level-1 value, so there's room to regen
    return { w, id };
  }

  it('Renew applies a heal-over-time that regenerates HP well beyond base regen', () => {
    const { w, id } = woundedAtLevel(12);
    w.giveItem(id, 'tome_renew', 1);
    w.learn(id, 'tome_renew');
    expect(w.playerStats(id)!.known.renew).toBe(1);

    const before = w.playerStats(id)!.hp;
    w.cast(id, 'renew', 1, 0); // self-cast applies the regen buff (10 hp/s)
    w.tick(1); // one second
    const gained = w.playerStats(id)!.hp - before;
    // Base regen alone is ~3 hp/s; Renew adds ~10, so the second should clearly exceed base.
    expect(gained).toBeGreaterThan(8);
  });

  it('regenerates only at the base rate with no buff active (control)', () => {
    const { w, id } = woundedAtLevel(12);
    const before = w.playerStats(id)!.hp;
    w.tick(1);
    const gained = w.playerStats(id)!.hp - before;
    expect(gained).toBeLessThan(6); // only base HP regen (~3/s)
  });

  it('the Renew buff wears off after its duration (back to base regen)', () => {
    const { w, id } = woundedAtLevel(12);
    w.giveItem(id, 'tome_renew', 1);
    w.learn(id, 'tome_renew');
    w.cast(id, 'renew', 1, 0);
    for (let i = 0; i < 7; i++) w.tick(1); // Renew lasts ~6s; after 7s it has expired
    const before = w.playerStats(id)!.hp;
    w.tick(1);
    const gained = w.playerStats(id)!.hp - before;
    expect(gained).toBeLessThan(6); // buff gone → only base regen remains
  });
});
