import { describe, expect, it } from 'vitest';
import { initGameDb, getContent } from './content.js';
import { areaToTiled, TILE_SIZE } from './editor-tiled.js';

initGameDb(':memory:');

/**
 * Tiled .tmj export — the first cross-engine bridge. Verifies the transform produces a valid Tiled
 * orthogonal map whose object layers faithfully carry the area's content (decor/spawns/npcs/portals),
 * so it round-trips into Tiled and the engines that import it.
 */
describe('areaToTiled', () => {
  it('returns null for an unknown area', () => {
    expect(areaToTiled('no_such_area')).toBeNull();
  });

  it('emits a valid Tiled map sized from the area dimensions', () => {
    const area = getContent().area('town')!;
    const map = areaToTiled('town')!;
    expect(map.type).toBe('map');
    expect(map.orientation).toBe('orthogonal');
    expect(map.tilewidth).toBe(TILE_SIZE);
    expect(map.width).toBe(Math.ceil(area.width / TILE_SIZE));
    expect(map.height).toBe(Math.ceil(area.height / TILE_SIZE));
    expect(map.properties.find((p) => p.name === 'areaId')?.value).toBe('town');
    // The five named object layers are always present.
    expect(map.layers.map((l) => l.name)).toEqual(['decor', 'spawns', 'npcs', 'portals', 'meta']);
    for (const l of map.layers) expect(l.type).toBe('objectgroup');
  });

  it('carries NPCs and portals as objects with their content properties', () => {
    const map = areaToTiled('town')!;
    const npcs = map.layers.find((l) => l.name === 'npcs')!;
    expect(npcs.objects.length).toBeGreaterThan(0); // town has service NPCs
    const merchant = npcs.objects.find((o) => o.name === 'Merchant')!;
    expect(merchant.type).toBe('npc');
    expect(merchant.point).toBe(true);
    expect(merchant.properties?.some((p) => p.name === 'kind' && p.value === 'vendor')).toBe(true);

    const portals = map.layers.find((l) => l.name === 'portals')!;
    expect(portals.objects.length).toBeGreaterThan(0); // town connects onward
    const portal = portals.objects[0]!;
    expect(portal.width).toBeGreaterThan(0); // a region, not a point
    expect(portal.properties?.some((p) => p.name === 'toArea')).toBe(true);
  });

  it('gives every object a unique id (Tiled requires it)', () => {
    const map = areaToTiled('crypt')!;
    const ids = map.layers.flatMap((l) => l.objects.map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries decor with kind + optional scale/color props', () => {
    // wilderness has decor (trees/rocks/etc.) seeded.
    const map = areaToTiled('wilderness')!;
    const decor = map.layers.find((l) => l.name === 'decor')!;
    expect(decor.objects.length).toBeGreaterThan(0);
    for (const o of decor.objects) {
      expect(o.type).toBe('decor');
      expect(o.properties?.some((p) => p.name === 'kind')).toBe(true);
    }
  });
});
