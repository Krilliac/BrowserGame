import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Orbit behavior: a caster-attached projectile that circles the owner, hitting enemies it sweeps
 * through, persisting for its full TTL rather than being consumed on first contact.
 *
 * arcane_orb carries { type: 'orbit', radius: 48, angularSpeed: 3.2 }.
 * Orbit rehit cooldown: ORBIT_REHIT_MS = 350 ms.
 * TTL: 1700 ms.
 */
describe('orbit spell behavior', () => {
  /** Build a minimal world with one player (arcane_orb learned) and no area mobs.
   *  Fixed seed 12345 makes every RNG call inside the sim deterministic. */
  function setup(): { w: World; pid: number } {
    // Small flat world with no area content so no mobs spawn automatically.
    // Seed is the 8th constructor argument; passing a constant eliminates all RNG flake.
    const w = new World(2000, 2000, { x: 1000, y: 1000 }, undefined, 'world', undefined, 0, 1);
    const pid = w.spawn('Caster', { x: 1000, y: 1000 });
    w.giveItem(pid, 'tome_arcane_orb', 1);
    w.learn(pid, 'tome_arcane_orb');
    // Give enough mana to cast.
    w.setLevel(pid, 5);
    return { w, pid };
  }

  it('orbit projectile stays at roughly `radius` distance from the owner each tick', () => {
    const { w, pid } = setup();
    const ORBIT_RADIUS = 48;
    const stats0 = w.playerStats(pid)!;
    const ownerX = stats0.x;
    const ownerY = stats0.y;

    // Cast aimed right (facing = 0).
    w.cast(pid, 'arcane_orb', 1, 0);

    // Advance several ticks and verify the projectile stays ~radius away from the caster.
    for (let t = 0; t < 15; t++) {
      w.tick(0.05); // 50ms ticks
      const proj = w.snapshot().find((e) => e.kind === 'projectile' && !e.hostile);
      if (!proj) continue; // may not have spawned yet in tick 0 edge case
      const dx = proj.x - ownerX;
      const dy = proj.y - ownerY;
      const dist = Math.hypot(dx, dy);
      expect(dist).toBeCloseTo(ORBIT_RADIUS, 0); // within 0.5 px
    }
  });

  it('orbit projectile angle advances over time (it actually sweeps)', () => {
    const { w, pid } = setup();

    w.cast(pid, 'arcane_orb', 1, 0);
    w.tick(0.05);

    const snapA = w.snapshot().find((e) => e.kind === 'projectile' && !e.hostile);
    expect(snapA).toBeDefined();

    w.tick(0.1); // advance 100ms more

    const snapB = w.snapshot().find((e) => e.kind === 'projectile' && !e.hostile);
    expect(snapB).toBeDefined();

    // The projectile should have moved — angle changed so x and/or y differ.
    const moved = snapA!.x !== snapB!.x || snapA!.y !== snapB!.y;
    expect(moved).toBe(true);
  });

  it('orbit projectile damages a mob inside the ring and persists (not consumed)', () => {
    const { w, pid } = setup();
    // Spawn a mob then teleport it to the orbit start position: (ownerX + 48, ownerY).
    // cast(pid, 'arcane_orb', 1, 0) aims right (facing=0), so the orb starts at angle=0 →
    // position (1000 + 48, 1000) = (1048, 1000). The mob is guaranteed to be on the ring path.
    w.spawnMobAt(pid, 'bat');
    const mobSnap0 = w.snapshot().find((e) => e.kind === 'mob');
    expect(mobSnap0).toBeDefined();
    const mobId = mobSnap0!.id;
    // Place mob exactly on the orbit starting position so the sweeping orb is guaranteed to hit.
    expect(w.teleportMob(mobId, 1048, 1000)).toBe(true);
    const initialHp = w.snapshot().find((e) => e.id === mobId)!.hp;

    // Cast the orbit spell aimed right (facing=0).
    w.cast(pid, 'arcane_orb', 1, 0);

    // Advance for the full TTL (1700ms) in 50ms ticks.
    for (let t = 0; t < 34; t++) w.tick(0.05);

    const mobSnapFinal = w.snapshot().find((e) => e.id === mobId);
    // Mob should have taken some damage during the orbit sweep.
    if (mobSnapFinal) {
      expect(mobSnapFinal.hp).toBeLessThan(initialHp);
    } else {
      // Mob was killed by the sweeping orb — also acceptable.
      expect(true).toBe(true);
    }
  });

  it('orbit projectile expires after its TTL (not permanent)', () => {
    const { w, pid } = setup();

    w.cast(pid, 'arcane_orb', 1, 0);
    w.tick(0.05); // projectile is alive

    const snapMid = w.snapshot().find((e) => e.kind === 'projectile' && !e.hostile);
    expect(snapMid).toBeDefined();

    // Advance well past the 1700ms TTL.
    for (let t = 0; t < 40; t++) w.tick(0.05); // 2000ms more

    const snapEnd = w.snapshot().find((e) => e.kind === 'projectile' && !e.hostile);
    expect(snapEnd).toBeUndefined();
  });

  it('orbit re-hit cooldown: a mob on the orbit path is not hit every single tick', () => {
    const { w, pid } = setup();

    // Place the mob exactly on the orbit starting position: (ownerX + 48, ownerY) = (1048, 1000).
    // cast aimed right (facing=0) so the orb begins at angle=0 and sweeps through this point.
    // With ORBIT_REHIT_MS=350 and TTL=1700ms, the orb can hit at most floor(1700/350)+1 = 5-6
    // times. With 50ms ticks and no cooldown it would hit 34 times. The cooldown is what we test.
    w.spawnMobAt(pid, 'bat');
    const mob0 = w.snapshot().find((e) => e.kind === 'mob');
    expect(mob0).toBeDefined();
    const mobId = mob0!.id;
    // Warp the mob to the orbit start position so it is guaranteed to be swept by the orb.
    expect(w.teleportMob(mobId, 1048, 1000)).toBe(true);
    // Boost HP so the mob survives multiple hits and we can count them.
    expect(w.boostMobHp(mobId, 10_000)).toBe(true);
    const startHp = w.snapshot().find((e) => e.id === mobId)!.hp;

    w.cast(pid, 'arcane_orb', 1, 0);

    let hitTicks = 0;
    let prevHp = startHp;

    // Run through the full orbit lifetime in 50ms ticks.
    for (let t = 0; t < 34; t++) {
      w.tick(0.05);
      const mob = w.snapshot().find((e) => e.id === mobId);
      if (!mob) break; // mob died — stop counting
      if (mob.hp < prevHp) {
        hitTicks++;
        prevHp = mob.hp;
      }
    }

    // The mob is on the orbit path; the re-hit cooldown (350ms) limits hits to ≤6 over the
    // 1700ms TTL. Must be far fewer than 34 (the per-tick upper bound with no cooldown).
    expect(hitTicks).toBeGreaterThan(0); // mob is on-path, must take at least one hit
    expect(hitTicks).toBeLessThan(10); // cooldown caps it well below the tick count
  });
});
