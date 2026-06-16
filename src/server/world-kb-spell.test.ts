import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Knockback-as-spell-behavior integration test (Slice 4, Task 5).
 * Confirms that a projectile carrying `{ type: 'knockback', px }` in its behaviors array
 * shoves the primary hit target away from the impact point when it lands.
 *
 * Chosen ability: mire_mortar — a slow heavy glob that now carries knockback px=55.
 */
describe('knockback spell behavior (slice 4)', () => {
  it('mire_mortar projectile pushes a mob farther from the player on hit', () => {
    // Large open arena so no wall absorbs the knockback displacement.
    const w = new World(4000, 4000, { x: 2000, y: 2000 });
    const playerId = w.spawn('Slinger');
    w.teleport(playerId, 2000, 2000);

    // Learn mire_mortar.
    w.giveItem(playerId, 'tome_mire_mortar', 1);
    w.learn(playerId, 'tome_mire_mortar');

    // Spawn a mob close to the player; give it massive HP so it survives many hits.
    expect(w.spawnMobAt(playerId, 'wolf')).toBe(true);
    w.tick(0.01);

    const mobSnap0 = w.snapshot().find((e) => e.kind === 'mob');
    expect(mobSnap0).toBeDefined();
    const mobId = mobSnap0!.id;
    expect(w.boostMobHp(mobId, 10_000)).toBe(true);

    // mire_mortar is slow (220 px/s); stun the mob so it stays put while the projectile flies.
    // The cooldown is 1400 ms; we stun for 3 s to cover cast + travel + cooldown per attempt.
    const STUN_MS = 3000;
    const COOLDOWN_S = 1.5; // 1400 ms cooldown + margin
    const TRAVEL_TICKS = 60; // 3 s of 50 ms ticks — enough for a 220 px/s glob to travel ~660 px

    // hit-roll uses Math.random (not the seeded world RNG), so we retry up to 10 times.
    // P(all 10 miss at ~64% hit rate) < 0.00004.
    let didKnockback = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      // Re-stun to keep the mob still during travel.
      expect(w.injectMobStatus(mobId, 'stun', STUN_MS, 1)).toBe(true);

      const snapBefore = w.snapshot().find((e) => e.id === mobId);
      expect(snapBefore).toBeDefined();
      const distBefore = Math.hypot(snapBefore!.x - 2000, snapBefore!.y - 2000);

      // Aim directly at the mob and cast.
      const aimDx = snapBefore!.x - 2000;
      const aimDy = snapBefore!.y - 2000;
      w.cast(playerId, 'mire_mortar', aimDx, aimDy);

      // Tick until the projectile can land (mire_mortar travels at 220 px/s).
      for (let t = 0; t < TRAVEL_TICKS; t++) w.tick(0.05);

      const snapAfter = w.snapshot().find((e) => e.id === mobId);
      expect(snapAfter).toBeDefined();
      const distAfter = Math.hypot(snapAfter!.x - 2000, snapAfter!.y - 2000);

      if (distAfter > distBefore) {
        didKnockback = true;
        break;
      }

      // Miss — advance past the cooldown and try again.
      w.tick(COOLDOWN_S);
    }

    // At least one cast must have landed and knocked the mob strictly farther from the player.
    expect(didKnockback).toBe(true);
  });
});
