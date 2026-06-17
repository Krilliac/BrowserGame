import { describe, expect, it } from 'vitest';
import { initGameDb, getDb, getContent, reloadContent } from './content.js';
import { areaToTiled, type TiledMap } from './editor-tiled.js';
import { tiledToContent, applyTiledImport } from './editor-import.js';

initGameDb(':memory:');

const layerCount = (m: TiledMap, name: string): number =>
  m.layers.find((l) => l.name === name)?.objects.length ?? 0;

/**
 * Tiled → content import (the reverse of editor-tiled.ts). Verifies the parser inverts the exporter
 * (counts + areaId), an export→import→export cycle is stable (coordinate scaling round-trips), and
 * applying a modified map actually rewrites the area's content.
 */
describe('tiledToContent (parse)', () => {
  it('parses an exported map back into content rows for the right area', () => {
    const map = areaToTiled('town')!;
    const parsed = tiledToContent(map)!;
    expect(parsed).not.toBeNull();
    expect(parsed.areaId).toBe('town');
    expect(parsed.npcs.length).toBe(layerCount(map, 'npcs'));
    expect(parsed.decor.length).toBe(layerCount(map, 'decor'));
    expect(parsed.npcs.some((n) => n.name === 'Merchant' && n.kind === 'vendor')).toBe(true);
  });

  it('rejects a non-map / map without an areaId', () => {
    expect(tiledToContent({ type: 'notamap' } as unknown as TiledMap)).toBeNull();
    const noArea = areaToTiled('town')!;
    noArea.properties = noArea.properties.filter((p) => p.name !== 'areaId');
    expect(tiledToContent(noArea)).toBeNull();
  });
});

describe('applyTiledImport (write + round-trip)', () => {
  it('export → import → export is stable (placement layers round-trip through the DB)', () => {
    const before = areaToTiled('crypt')!;
    expect(applyTiledImport(getDb(), before).ok).toBe(true);
    reloadContent();
    const after = areaToTiled('crypt')!;
    for (const name of ['decor', 'spawns', 'npcs']) {
      expect(layerCount(after, name)).toBe(layerCount(before, name));
    }
  });

  it('writes an edited map — adding a decor object shows up after reload', () => {
    const map = areaToTiled('wilderness')!;
    const decorLayer = map.layers.find((l) => l.name === 'decor')!;
    const before = decorLayer.objects.length;
    decorLayer.objects.push({
      id: 99999,
      name: 'mushroom',
      type: 'decor',
      x: 640,
      y: 640,
      width: 0,
      height: 0,
      point: true,
      properties: [{ name: 'kind', type: 'string', value: 'mushroom' }],
    });
    expect(applyTiledImport(getDb(), map).ok).toBe(true);
    reloadContent();
    expect(layerCount(areaToTiled('wilderness')!, 'decor')).toBe(before + 1);
  });

  it('skips spawn objects whose template is unknown (the FK guard)', () => {
    const map = areaToTiled('crypt')!;
    map.layers.find((l) => l.name === 'spawns')!.objects = [
      {
        id: 1,
        name: 'not_a_real_mob',
        type: 'spawn',
        x: 300,
        y: 300,
        width: 0,
        height: 0,
        point: true,
        properties: [{ name: 'templateId', type: 'string', value: 'not_a_real_mob' }],
      },
    ];
    const res = applyTiledImport(getDb(), map);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('skipped');
    reloadContent();
    expect(getContent().creatureSpawns('crypt')).toHaveLength(0); // the bad spawn was not written
  });
});
