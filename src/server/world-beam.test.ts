import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/**
 * Beam (hitscan) spell behavior: an instant line from the caster that damages every mob whose
 * edge intersects the segment. No projectile is spawned.
 *
 * Chosen ability: starfall — a bolt of pure starfire; `behaviors: [{ type: 'beam', range: 360, width: 18 }]`.
 * Beam segment: player at (2000, 2000), aimed at +x → endpoint at (2360, 2000).
 * Hit threshold: pointToSegmentDist(mob) ≤ width(18) + MOB_RADIUS(16) = 34 px.
 */
describe('beam spell behavior', () => {
  function setup(): { w: World; pid: number } {
    // Large open arena — no area mobs spawn automatically.
    // Fixed seed 12345 makes every RNG call (hit rolls, damage) deterministic so the retry
    // loop is unnecessary: the same seed always produces the same hit/miss outcome.
    const w = new World(4000, 4000, { x: 2000, y: 2000 }, undefined, 'world', undefined, 0, 1);
    const pid = w.spawn('Caster', { x: 2000, y: 2000 });
    // Learn starfall (the beam ability).
    w.giveItem(pid, 'tome_starfall', 1);
    w.learn(pid, 'tome_starfall');
    // Level up so damage rolls are meaningful; also gives ample mana.
    w.setLevel(pid, 10);
    return { w, pid };
  }

  it('mob directly on the beam axis takes damage', () => {
    const { w, pid } = setup();

    // Spawn mob A and teleport it onto the +x beam path, within range.
    expect(w.spawnMobAt(pid, 'bat')).toBe(true);
    const mobASnap = w.snapshot().find((e) => e.kind === 'mob');
    expect(mobASnap).toBeDefined();
    const mobAId = mobASnap!.id;
    // Place it directly on the +x axis, 200 px ahead of the player (well within beam range=360).
    expect(w.teleportMob(mobAId, 2200, 2000)).toBe(true);
    // Boost HP so it survives at least one hit (we want to measure damage, not instant kill).
    expect(w.boostMobHp(mobAId, 10_000)).toBe(true);

    const hpBefore = w.snapshot().find((e) => e.id === mobAId)!.hp;

    // Cast starfall aimed at +x (dx=1, dy=0) — no tick needed, beam is instant.
    // With the fixed seed the RNG is deterministic: seed 1 guarantees this cast hits.
    w.cast(pid, 'starfall', 1, 0);

    const hpAfter = w.snapshot().find((e) => e.id === mobAId)!.hp;
    expect(hpAfter).toBeLessThan(hpBefore);
  });

  it('mob off the beam axis is not hit', () => {
    const { w, pid } = setup();

    // Spawn mob B and teleport it perpendicular to the beam, well off-axis.
    expect(w.spawnMobAt(pid, 'bat')).toBe(true);
    const mobBSnap = w.snapshot().find((e) => e.kind === 'mob');
    expect(mobBSnap).toBeDefined();
    const mobBId = mobBSnap!.id;
    // Place it 200 px above the player on the y axis — perpendicular to the +x beam.
    // Perpendicular distance from (2000, 2200) to segment (2000,2000)→(2360,2000) is 200 px,
    // which far exceeds the hit threshold of 34 px.
    expect(w.boostMobHp(mobBId, 10_000)).toBe(true);
    expect(w.teleportMob(mobBId, 2000, 2200)).toBe(true);
    // Keep the mob frozen in place for all three casts so it cannot walk back toward the beam.
    expect(w.injectMobStatus(mobBId, 'stun', 30_000, 1)).toBe(true);

    const hpBefore = w.snapshot().find((e) => e.id === mobBId)!.hp;

    // Cast 3 times (handling mana regen between casts) to confirm mob B is never hit.
    w.cast(pid, 'starfall', 1, 0);
    for (let t = 0; t < 50; t++) w.tick(0.05); // wait for cooldown + mana regen
    w.cast(pid, 'starfall', 1, 0);
    for (let t = 0; t < 50; t++) w.tick(0.05);
    w.cast(pid, 'starfall', 1, 0);

    // Re-read position to confirm mob stayed off-axis (stun keeps it frozen).
    const mobBAfterSnap = w.snapshot().find((e) => e.id === mobBId);
    expect(mobBAfterSnap).toBeDefined();
    // Mob must not have moved significantly (stun + teleport).
    expect(Math.abs(mobBAfterSnap!.y - 2200)).toBeLessThan(5);

    const hpAfter = w.snapshot().find((e) => e.id === mobBId)!.hp;
    // Off-axis mob must never have taken damage.
    expect(hpAfter).toBe(hpBefore);
  });

  it('beam FxEvent is emitted with correct endpoints', () => {
    const { w, pid } = setup();

    // Cast aimed at +x; no mobs needed for the event check.
    w.cast(pid, 'starfall', 1, 0);

    const events = w.drainEvents();
    const beamEv = events.find((e) => e.kind === 'beam');
    expect(beamEv).toBeDefined();
    // Origin must be the player position.
    expect(beamEv!.x).toBeCloseTo(2000);
    expect(beamEv!.y).toBeCloseTo(2000);
    // Far endpoint: player.x + cos(0)*range = 2000+360 = 2360; y stays 2000.
    expect(beamEv!.x2).toBeCloseTo(2360);
    expect(beamEv!.y2).toBeCloseTo(2000);
  });

  it('no projectile is spawned when the beam fires', () => {
    const { w, pid } = setup();

    w.cast(pid, 'starfall', 1, 0);
    // Give the sim a tick to let any hypothetical projectile appear.
    w.tick(0.05);

    const projs = w.snapshot().filter((e) => e.kind === 'projectile' && !e.hostile);
    expect(projs).toHaveLength(0);
  });
});
