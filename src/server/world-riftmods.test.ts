import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb } from './content.js';

initGameDb(':memory:');

/** Construct a World at a given rift tier + seed (tier is the 7th ctor arg, seed the 8th). */
function riftWorld(tier: number, seed: number): World {
  return new World(1600, 1200, { x: 800, y: 600 }, undefined, 'rift', undefined, tier, seed);
}

/**
 * Rift modifiers wiring: a tiered rift rolls a couple of mutators at construction (deterministically
 * from its seed, via a DERIVED rng so the main spawn/loot rolls are untouched). A normal area rolls
 * none, so ordinary play is completely unaffected. The effect math is unit-tested in
 * rift-modifiers.test.ts; this proves the World rolls + exposes them.
 */
describe('rift modifiers (world)', () => {
  it('a normal area (tier 0) rolls no modifiers', () => {
    expect(riftWorld(0, 123).riftModifiers).toEqual([]);
  });

  it('a tiered rift rolls modifiers, deterministically from its seed', () => {
    const a = riftWorld(5, 999);
    const b = riftWorld(5, 999);
    expect(a.riftModifiers.length).toBeGreaterThan(0);
    expect(a.riftModifiers.map((m) => m.id)).toEqual(b.riftModifiers.map((m) => m.id));
  });

  it('only rolls modifiers eligible for the tier', () => {
    const w = riftWorld(5, 7);
    for (const m of w.riftModifiers) expect(m.minTier).toBeLessThanOrEqual(5);
    // A low-tier rift can never roll the tier-5-gated mutators (vengeful/cataclysmic).
    const low = riftWorld(1, 7);
    for (const m of low.riftModifiers) expect(m.minTier).toBeLessThanOrEqual(1);
  });
});
