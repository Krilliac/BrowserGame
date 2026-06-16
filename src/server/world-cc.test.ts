import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Crowd-control gate integration tests: stun/freeze root + silence gates, knockback impulse.
 * Drives the full World tick to confirm CC states suppress movement/casting.
 * StatusSet's own math is unit-tested in status-effects.test.ts; these pin the world wiring.
 */
describe('crowd-control gates (slice 3)', () => {
  // -----------------------------------------------------------------------
  // Step 1: mob root — stun prevents movement toward the player
  // -----------------------------------------------------------------------

  it('a stunned mob does not move during the stun duration', () => {
    const w = new World();
    const playerId = w.spawn('Bait');
    w.setLevel(playerId, 20); // survive long enough to observe
    w.teleport(playerId, 1000, 1000);

    // Spawn a mob right next to the player so it aggros immediately.
    expect(w.spawnMobAt(playerId, 'wolf')).toBe(true);

    // One tick to settle aggro state.
    w.tick(0.05);

    const mobSnap = w.snapshot().find((e) => e.kind === 'mob');
    expect(mobSnap).toBeDefined();

    // Inject a 1-second stun onto the mob.
    expect(w.injectMobStatus(mobSnap!.id, 'stun', 1000, 1)).toBe(true);

    const startX = w.snapshot().find((e) => e.kind === 'mob')!.x;
    const startY = w.snapshot().find((e) => e.kind === 'mob')!.y;

    // Tick 10 times (500 ms — well within the 1 s stun).
    for (let i = 0; i < 10; i++) w.tick(0.05);

    const mobAfter = w.snapshot().find((e) => e.kind === 'mob');
    expect(mobAfter).toBeDefined();

    // Mob must not have moved while stunned (within 0.1 px floating-point tolerance).
    expect(mobAfter!.x).toBeCloseTo(startX, 1);
    expect(mobAfter!.y).toBeCloseTo(startY, 1);
  });

  // -----------------------------------------------------------------------
  // Step 4: knockback impulse — ability hit shoves mob away from caster
  // -----------------------------------------------------------------------

  it('crushing_smash knockback pushes a mob farther from the player', () => {
    // Open world (no collision geometry) so knockback isn't wall-absorbed.
    const w = new World(4000, 4000, { x: 2000, y: 2000 });
    const playerId = w.spawn('Basher');
    // Keep the player at level 1 (low damage) so the boosted mob can't be one-shotted.
    w.teleport(playerId, 2000, 2000);

    // Learn crushing_smash (the ability with a 70-px knockback).
    w.giveItem(playerId, 'tome_crushing_smash', 1);
    w.learn(playerId, 'tome_crushing_smash');

    // Spawn a mob near the player and give it enough HP to survive many hits.
    expect(w.spawnMobAt(playerId, 'wolf')).toBe(true);
    w.tick(0.01); // one small tick to settle positions

    const mobSnap0 = w.snapshot().find((e) => e.kind === 'mob');
    expect(mobSnap0).toBeDefined();
    const mobId = mobSnap0!.id;

    // Give the mob 10 000 HP so no number of hits from a level-1 caster can kill it.
    expect(w.boostMobHp(mobId, 10_000)).toBe(true);

    // The hit-check in rollAbilityDamage uses Math.random (not the seeded world RNG), so a
    // single cast may miss (~64 % hit rate at level 1 vs wolf). Re-stun before each cast
    // attempt and check position immediately after cast() (knockback is synchronous — no tick
    // needed). With 10 attempts, P(all miss) = (0.36)^10 < 0.00004.
    const COOLDOWN_S = 1.4; // crushing_smash cooldown is 1300 ms; 1.4 s clears it safely
    let didMove = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      // Re-stun long enough to cover this tick cycle so the mob doesn't chase the player.
      expect(w.injectMobStatus(mobId, 'stun', Math.ceil(COOLDOWN_S * 1000) + 100, 1)).toBe(true);

      const snapBefore = w.snapshot().find((e) => e.kind === 'mob');
      expect(snapBefore).toBeDefined(); // mob must still exist
      const distBefore = Math.hypot(snapBefore!.x - 2000, snapBefore!.y - 2000);

      // Aim directly at the mob and cast.
      const aimX = snapBefore!.x - 2000;
      const aimY = snapBefore!.y - 2000;
      w.cast(playerId, 'crushing_smash', aimX, aimY);

      // Knockback is applied synchronously inside cast() — check immediately.
      const snapAfter = w.snapshot().find((e) => e.kind === 'mob');
      expect(snapAfter).toBeDefined();
      if (Math.hypot(snapAfter!.x - 2000, snapAfter!.y - 2000) > distBefore) {
        didMove = true;
        break;
      }

      // Miss — tick past the cooldown and try again.
      w.tick(COOLDOWN_S);
    }

    // At least one cast must have landed and knocked the mob strictly farther from the player.
    expect(didMove).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Control: without stun, a mob DOES move toward the player
  // -----------------------------------------------------------------------

  it('an unstunned mob moves toward a nearby player (control: root gate has no false positive)', () => {
    const w = new World();
    const playerId = w.spawn('Target');
    w.setLevel(playerId, 20);
    // Spawn the mob near the player so it immediately aggros.
    w.teleport(playerId, 1000, 1000);
    expect(w.spawnMobAt(playerId, 'wolf')).toBe(true);
    w.tick(0.01); // one very short tick to settle spawn

    const mobSpawned = w.snapshot().find((e) => e.kind === 'mob');
    expect(mobSpawned).toBeDefined();

    // Move the player 250 px north — well within aggro range but requiring the mob to chase.
    w.teleport(playerId, 1000, 750);

    const startX = mobSpawned!.x;
    const startY = mobSpawned!.y;

    // No stun applied — tick for 1 second; the mob should pursue the new position.
    for (let i = 0; i < 20; i++) w.tick(0.05);

    const mobEnd = w.snapshot().find((e) => e.kind === 'mob');
    expect(mobEnd).toBeDefined();

    // The mob must have moved toward the player's new position.
    const moved = Math.hypot(mobEnd!.x - startX, mobEnd!.y - startY);
    expect(moved).toBeGreaterThan(1);
  });
});
