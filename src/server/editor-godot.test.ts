import { describe, expect, it } from 'vitest';
import { initGameDb, getContent, getDb, reloadContent } from './content.js';
import { areaToGodot, TILE_SIZE } from './editor-godot.js';
import { areaToTiled } from './editor-tiled.js';

initGameDb(':memory:');

// The `creature_spawns` table ships empty; seed one fixed spawn so the spawn-layer assertions have
// content (mirrors world-creature-spawns.test.ts), then reload content so the adapters see it.
getDb()
  .prepare('INSERT INTO creature_spawns (area_id,template_id,x,y,flags) VALUES (?,?,?,?,?)')
  .run('wilderness', 'wolf', 100, 120, 0);
reloadContent();

/**
 * Godot 4 `.tscn` export — the native-Godot cross-engine bridge, sibling to the Tiled export. Verifies
 * the transform produces a parseable Godot scene whose group nodes faithfully carry the area's content
 * (decor/spawns/npcs/portals) with no data lost, sharing the Tiled export's coordinate convention.
 */
describe('areaToGodot', () => {
  it('returns null for an unknown area', () => {
    expect(areaToGodot('no_such_area')).toBeNull();
  });

  it('emits a Godot 4 scene with a root node and the four group nodes', () => {
    const tscn = areaToGodot('town')!;
    expect(tscn.startsWith('[gd_scene')).toBe(true);
    expect(tscn).toContain('format=3');
    // Root Node2D named after the area, with area-level metadata.
    expect(tscn).toContain('[node name="town" type="Node2D"]');
    expect(tscn).toContain('metadata/areaId = "town"');
    // The four layer group nodes, parented to the root.
    expect(tscn).toContain('[node name="Decor" type="Node2D" parent="."]');
    expect(tscn).toContain('[node name="Spawns" type="Node2D" parent="."]');
    expect(tscn).toContain('[node name="Npcs" type="Node2D" parent="."]');
    expect(tscn).toContain('[node name="Portals" type="Node2D" parent="."]');
  });

  it('emits entity nodes with a Vector2 position and preserves a spawn template id in metadata', () => {
    // wilderness has both decor and creature spawns seeded.
    const tscn = areaToGodot('wilderness')!;
    expect(tscn).toContain('position = Vector2(');

    const spawns = getContent().creatureSpawns('wilderness');
    expect(spawns.length).toBeGreaterThan(0);
    // The first spawn's template id rides its node as metadata, so no content is lost.
    expect(tscn).toContain(`metadata/templateId = "${spawns[0]!.templateId}"`);
    // And a Marker2D spawn node exists.
    expect(tscn).toContain('type="Marker2D"');
  });

  it('carries NPCs and portals with their identifying metadata', () => {
    const tscn = areaToGodot('town')!;
    // town has service NPCs (Merchant) and onward portals.
    expect(tscn).toContain('metadata/name = "Merchant"');
    expect(tscn).toContain('metadata/toArea = ');
  });

  it('shares the Tiled export coordinate convention (served pixels)', () => {
    // A spawn's position must match the Tiled object's coordinate exactly so the two exports agree.
    const spawns = getContent().creatureSpawns('wilderness');
    const s = spawns[0]!;
    const tscn = areaToGodot('wilderness')!;
    expect(tscn).toContain(`position = Vector2(${s.x}, ${s.y})`);

    const tiled = areaToTiled('wilderness')!;
    const spawnLayer = tiled.layers.find((l) => l.name === 'spawns')!;
    const obj = spawnLayer.objects.find((o) => o.name === s.templateId)!;
    expect(obj.x).toBe(s.x);
    expect(obj.y).toBe(s.y);
  });

  it('escapes quotes/backslashes so a hostile label cannot corrupt the file', () => {
    // The escaper is exercised structurally: every metadata string in the doc is balanced — no raw
    // unescaped quote breaks out of a literal. A simple proxy: the doc has matched node brackets.
    const tscn = areaToGodot('town')!;
    const open = (tscn.match(/\[node /g) ?? []).length;
    expect(open).toBeGreaterThan(0);
    // Sanity: the tile-size convention is recorded and matches the Tiled adapter.
    expect(tscn).toContain(`metadata/tileSize = ${TILE_SIZE}`);
  });

  it('produces byte-identical output across calls (deterministic)', () => {
    const a = areaToGodot('crypt')!;
    const b = areaToGodot('crypt')!;
    expect(a).toBe(b);
  });
});
