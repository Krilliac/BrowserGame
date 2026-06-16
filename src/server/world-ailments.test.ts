import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * World-level integration tests for the slice-3 ailment system.
 *
 * These pin two concrete behaviors that involve the World tick path, not just
 * the pure StatusSet unit (which is covered in status-effects.test.ts):
 *
 *  1. Ignite DoT actually drains a mob's HP through `World.tick()`.
 *  2. Shock amplifies incoming damage via `vulnFactor()` when damage reaches a
 *     mob through the `damageMob` private path (exercised here via the DoT
 *     tick, which calls `this.damageMob(mob, dotDamage, ...)`).
 *
 * The shock test uses an entirely deterministic route: both mobs receive the
 * same ignite DoT magnitude so their raw tick damage is identical; only the
 * shocked mob has a vulnFactor > 1, so its HP drop is strictly larger.  No
 * RNG is involved — ability hit-rolls and crit rolls are bypassed entirely.
 */
describe('ailment integration (slice 3)', () => {
  // -----------------------------------------------------------------------
  // Case 1: Ignite DoT chips HP through the world tick
  // -----------------------------------------------------------------------

  it('ignite DoT reduces a mob HP over a world tick', () => {
    const w = new World();
    const playerId = w.spawn('Bait');
    w.setLevel(playerId, 20);
    w.teleport(playerId, 1000, 1000);

    // Spawn a wolf right next to the player so it's easily findable.
    expect(w.spawnMobAt(playerId, 'wolf')).toBe(true);
    w.tick(0.01); // settle spawn

    const mobSnap = w.snapshot().find((e) => e.kind === 'mob');
    expect(mobSnap).toBeDefined();
    const mobId = mobSnap!.id;

    // Give the mob 10 000 HP so the DoT can't kill it in one tick.
    expect(w.boostMobHp(mobId, 10_000)).toBe(true);

    // Apply ignite: magnitude 5 = 5 HP/second DoT.
    expect(w.injectMobStatus(mobId, 'ignite', 2000, 5)).toBe(true);

    const hpBefore = w.snapshot().find((e) => e.kind === 'mob')!.hp;

    // Tick 1 second — ignite should deal ≈5 damage.
    w.tick(1.0);

    const hpAfter = w.snapshot().find((e) => e.kind === 'mob')!.hp;
    const damage = hpBefore - hpAfter;

    // The mob's hp must have decreased. We give a generous tolerance (≥4) because
    // the world tick is dt=1.0 but it advances statuses by dtMs=1000 internally,
    // and vulnFactor defaults to 1 (no shock), so raw damage ≈ 5 * 1 = 5.
    expect(damage).toBeGreaterThanOrEqual(4);
  });

  // -----------------------------------------------------------------------
  // Case 2: Shock raises incoming damage through the damageMob path
  //
  // Route: World.tick() → mob.statuses.tick(dtMs) → dotDamage > 0
  //       → this.damageMob(mob, dotDamage, ...) → amount *= mob.statuses.vulnFactor()
  //
  // Both mobs get the same ignite DoT magnitude (= same raw dotDamage from
  // StatusSet.tick). Only the shocked mob has vulnFactor = 1 + shockMag = 1.25,
  // so its actual HP loss is 25% larger. No RNG involved.
  // -----------------------------------------------------------------------

  it('shock amplifies DoT damage taken (vulnFactor applied inside damageMob)', () => {
    const w = new World(4000, 4000, { x: 2000, y: 2000 });
    const playerId = w.spawn('Spectator');
    w.setLevel(playerId, 20);
    w.teleport(playerId, 100, 100); // far from both mobs so they won't aggro-path or die

    // Spawn both wolves near each other but away from the player.
    expect(w.spawnMobAt(playerId, 'wolf')).toBe(true);
    w.tick(0.01);
    expect(w.spawnMobAt(playerId, 'wolf')).toBe(true);
    w.tick(0.01);

    // Collect the two most-recently-spawned mobs.
    const mobs = w.snapshot().filter((e) => e.kind === 'mob');
    expect(mobs.length).toBeGreaterThanOrEqual(2);
    const [mobA, mobB] = mobs.slice(-2) as [(typeof mobs)[0], (typeof mobs)[1]];

    // Give both mobs ample HP so neither can be killed by a DoT tick.
    expect(w.boostMobHp(mobA.id, 10_000)).toBe(true);
    expect(w.boostMobHp(mobB.id, 10_000)).toBe(true);

    // Apply the same ignite magnitude (10 HP/s) to BOTH mobs.
    const IGNITE_MAG = 10;
    const IGNITE_DUR_MS = 5000;
    expect(w.injectMobStatus(mobA.id, 'ignite', IGNITE_DUR_MS, IGNITE_MAG)).toBe(true);
    expect(w.injectMobStatus(mobB.id, 'ignite', IGNITE_DUR_MS, IGNITE_MAG)).toBe(true);

    // Apply shock ONLY to mob B (25% amplifier → vulnFactor = 1.25).
    const SHOCK_MAG = 0.25;
    expect(w.injectMobStatus(mobB.id, 'shock', IGNITE_DUR_MS, SHOCK_MAG)).toBe(true);

    const hpABefore = w.snapshot().find((e) => e.id === mobA.id)!.hp;
    const hpBBefore = w.snapshot().find((e) => e.id === mobB.id)!.hp;

    // Tick 1 second — both ignites fire, mob B's damageMob call is scaled by vulnFactor.
    w.tick(1.0);

    const hpAAfter = w.snapshot().find((e) => e.id === mobA.id)!.hp;
    const hpBAfter = w.snapshot().find((e) => e.id === mobB.id)!.hp;

    const damageA = hpABefore - hpAAfter;
    const damageB = hpBBefore - hpBAfter;

    // Mob A took raw ignite DoT (~10 damage).
    expect(damageA).toBeGreaterThan(0);
    // Mob B took 25% more because of shock's vulnFactor.
    expect(damageB).toBeGreaterThan(damageA);
    // The ratio should be ≈ 1.25 (generous tolerance for any tick-boundary rounding).
    const ratio = damageB / damageA;
    expect(ratio).toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(1.5);
  });
});
