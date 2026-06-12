import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { initGameDb, getContent } from './content.js';

initGameDb(':memory:');

/**
 * The SQL sprite-color override system (`sprite_tints` table): targets like 'mob:<templateId>'
 * or 'decor:<kind>' carry a #rrggbb multiply tint, so one image source spawns many variations
 * without editing the file. Decor tints ship in the content packet; entity tints are stamped
 * onto the snapshot server-side (the client never needs template ids).
 */
describe('sprite tints', () => {
  it('loads the seeded example overrides', () => {
    const c = getContent();
    expect(c.spriteTint('decor:grave')).toBe('#aeb4cc');
    expect(c.spriteTint('mob:rot_ghoul')).toBe('#a8c096');
    expect(c.spriteTint('decor:not-a-kind')).toBeUndefined();
    // The full map ships to clients in the content packet.
    expect(c.spriteTints()['decor:tree']).toBe('#93a08c');
  });

  it('stamps a tinted mob in the snapshot; untinted mobs carry no field', () => {
    const w = new World();
    const id = w.spawn('Witness');
    w.spawnMobAt(id, 'rot_ghoul'); // tinted in the seed
    w.spawnMobAt(id, 'wolf'); // no override

    const mobs = w.snapshot().filter((e) => e.kind === 'mob');
    const ghoul = mobs.find((m) => m.name.includes('Ghoul'))!;
    const wolf = mobs.find((m) => m.name.includes('Wolf'))!;
    expect(ghoul.tint).toBe('#a8c096');
    expect(wolf.tint).toBeUndefined();
  });
});
