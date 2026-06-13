import { describe, expect, it } from 'vitest';
import type { World } from './world.js';
import { initGameDb } from './content.js';
import { areaWorld } from './test-support.js';

initGameDb(':memory:');

const mobCount = (w: World) => w.snapshot().filter((e) => e.kind === 'mob' && e.hp > 0).length;

/**
 * Crowd density scaling: a flood of players clears mobs faster than respawn refills, so the host
 * periodically tops up the roster toward a target that scales with the living-player count — no
 * more being farmed to extinction. Solo instances and safe zones are untouched.
 */
describe('crowd mob density', () => {
  it('tops a crowded overworld instance up well past its solo roster', () => {
    const w = areaWorld('wilderness');
    w.populateMobs('wilderness');
    const solo = mobCount(w);

    // Pack the instance with players, then run the density maintenance a few cycles.
    for (let i = 0; i < 30; i++) w.spawn(`P${i}`, { x: 100 + i, y: 100 });
    for (let i = 0; i < 20; i++) w.maintainDensity();

    expect(mobCount(w)).toBeGreaterThan(solo * 2); // a crowd finds far more monsters
  });

  it('does nothing for a solo instance (rides the normal respawn loop)', () => {
    const w = areaWorld('wilderness');
    w.populateMobs('wilderness');
    w.spawn('Solo', { x: 100, y: 100 });
    const before = mobCount(w);
    for (let i = 0; i < 10; i++) w.maintainDensity();
    expect(mobCount(w)).toBe(before); // unchanged
  });

  it('never populates a safe zone (no roster) even when packed', () => {
    const w = areaWorld('town');
    for (let i = 0; i < 30; i++) w.spawn(`P${i}`, { x: 100 + i, y: 100 });
    for (let i = 0; i < 10; i++) w.maintainDensity();
    expect(mobCount(w)).toBe(0);
  });
});
