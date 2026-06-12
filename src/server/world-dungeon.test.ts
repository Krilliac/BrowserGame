import { describe, expect, it } from 'vitest';
import { initGameDb, getContent } from './content.js';
import { World } from './world.js';
import { DUNGEONS } from '../shared/areas.js';

initGameDb(':memory:');

/**
 * Procedural dungeon population: entering a dungeon area rolls a random pack from its pool plus the
 * named boss. These pin the runtime behavior of populateDungeon (which the unit tests above don't
 * otherwise exercise) — pack size in range, the boss present, everything in bounds.
 */
describe('procedural dungeon population', () => {
  const W = 1500;
  const H = 1300;

  function buildDungeon(areaId: string): World {
    const world = new World(W, H, { x: 750, y: 220 }, undefined, areaId);
    world.populateMobs(areaId);
    return world;
  }

  it('rolls a pack within range, the boss, and keeps every spawn in bounds', () => {
    for (const [areaId, def] of Object.entries(DUNGEONS)) {
      const world = buildDungeon(areaId);
      const mobs = world.snapshot().filter((e) => e.kind === 'mob');

      // Pack size in 8×[minMobs, maxMobs] (the world-scale density bump) + 1 boss (+ an
      // optional mini-boss).
      expect(mobs.length, `${areaId} pack`).toBeGreaterThanOrEqual(def.minMobs * 8 + 1);
      expect(mobs.length, `${areaId} pack`).toBeLessThanOrEqual(def.maxMobs * 8 + 2);

      // The named boss is present (bosses never roll elite, so the name is exact).
      const bossName = getContent().mobTemplate(def.boss)!.name;
      expect(
        mobs.some((m) => m.name === bossName),
        `${areaId} boss ${bossName}`,
      ).toBe(true);

      // No monster is born outside the map.
      for (const m of mobs) {
        expect(m.x, `${areaId} x`).toBeGreaterThanOrEqual(0);
        expect(m.x, `${areaId} x`).toBeLessThanOrEqual(W);
        expect(m.y, `${areaId} y`).toBeGreaterThanOrEqual(0);
        expect(m.y, `${areaId} y`).toBeLessThanOrEqual(H);
      }
    }
  });

  it('the same seed reproduces the exact same dungeon (provenance)', () => {
    const roll = (seed: number) => {
      const w = new World(
        W,
        H,
        { x: 750, y: 220 },
        undefined,
        'forgotten_catacombs',
        undefined,
        0,
        seed,
      );
      w.populateMobs('forgotten_catacombs');
      return w
        .snapshot()
        .filter((e) => e.kind === 'mob')
        .map((m) => `${m.name}@${m.x.toFixed(2)},${m.y.toFixed(2)}`);
    };
    expect(roll(1234)).toEqual(roll(1234)); // identical layout from an identical seed
    expect(roll(1234)).not.toEqual(roll(5678)); // and different seeds actually differ
  });

  it('only fills dungeons with their own pool (plus boss/mini-boss)', () => {
    for (const [areaId, def] of Object.entries(DUNGEONS)) {
      const world = buildDungeon(areaId);
      const allowed = new Set<string>([
        ...def.pool,
        def.boss,
        ...(def.miniBoss ? [def.miniBoss] : []),
      ]);
      const allowedNames = new Set([...allowed].map((id) => getContent().mobTemplate(id)!.name));
      for (const m of world.snapshot().filter((e) => e.kind === 'mob')) {
        // Elites prepend a modifier word, so match on the trailing template name.
        const matched = [...allowedNames].some((n) => m.name === n || m.name.endsWith(` ${n}`));
        expect(matched, `${areaId}: unexpected ${m.name}`).toBe(true);
      }
    }
  });
});
