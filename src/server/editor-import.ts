/**
 * Tiled `.tmj` → content import — the reverse of editor-tiled.ts, completing the cross-engine
 * round-trip. Edit a map in Tiled (or any engine that exports Tiled) and load it back into the
 * data-driven content DB. `tiledToContent` is a pure, defensive parser (the map is untrusted input);
 * `applyTiledImport` writes the parsed rows into the area's `decor` / `creature_spawns` / `npcs`
 * tables inside one transaction.
 *
 * Scope (v1, deliberately conservative): imports the placement layers (decor / spawns / npcs) only.
 * Portals, area dimensions, and the spawn point are carried in the `.tmj` for reference + round-trip
 * but NOT overwritten on import — they affect world-graph integrity, so editing them stays a
 * deliberate, separate action. Coordinates are divided back by the world scale (the export multiplied
 * authored coords by it), so an export→import→export cycle is stable.
 */

import { config } from './config.js';
import { getDb } from './content.js';
import type { GameDatabase } from './db/database.js';
import type { TiledMap, TiledObject } from './editor-tiled.js';

const WORLD_SCALE = config.world.scale;

export interface ImportedDecor {
  kind: string;
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  color: string | null;
  scale: number | null;
}
export interface ImportedSpawn {
  templateId: string;
  x: number;
  y: number;
  flags: number;
}
export interface ImportedNpc {
  name: string;
  x: number;
  y: number;
  hue: number;
  kind: string;
  flags: number;
}
export interface ImportedContent {
  areaId: string;
  decor: ImportedDecor[];
  spawns: ImportedSpawn[];
  npcs: ImportedNpc[];
}

/** A named custom property's value off a Tiled object (undefined if absent). */
function prop(o: TiledObject, name: string): string | number | boolean | undefined {
  return o.properties?.find((p) => p.name === name)?.value;
}
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
/** Authored (pre-world-scale) coordinate from an exported (post-scale) one. */
const unscale = (v: number): number => v / WORLD_SCALE;

/** Objects of a named layer (empty if the layer is absent or malformed). */
function layerObjects(map: TiledMap, name: string): TiledObject[] {
  const layer = map.layers?.find?.((l) => l && l.name === name);
  return Array.isArray(layer?.objects)
    ? layer!.objects.filter((o) => o && Number.isFinite(o.x))
    : [];
}

/**
 * Parse a Tiled map into structured content rows (decor / spawns / npcs), or null if it isn't a map
 * with an `areaId` property. Defensive: unknown fields are ignored, malformed objects skipped, and
 * coordinates are un-scaled back to authored space.
 */
export function tiledToContent(map: TiledMap): ImportedContent | null {
  if (!map || map.type !== 'map' || !Array.isArray(map.layers)) return null;
  const areaId = str(map.properties?.find?.((p) => p.name === 'areaId')?.value);
  if (!areaId) return null;

  const decor: ImportedDecor[] = layerObjects(map, 'decor').map((o) => {
    const x2 = prop(o, 'x2');
    const y2 = prop(o, 'y2');
    const scale = prop(o, 'scale');
    const color = prop(o, 'color');
    return {
      kind: str(prop(o, 'kind'), o.name || 'rock'),
      x: unscale(num(o.x)),
      y: unscale(num(o.y)),
      x2: x2 === undefined ? null : unscale(num(x2)),
      y2: y2 === undefined ? null : unscale(num(y2)),
      color: typeof color === 'string' ? color : null,
      scale: scale === undefined ? null : num(scale, 1),
    };
  });

  const spawns: ImportedSpawn[] = layerObjects(map, 'spawns').map((o) => ({
    templateId: str(prop(o, 'templateId'), o.name),
    x: Math.round(unscale(num(o.x))),
    y: Math.round(unscale(num(o.y))),
    flags: num(prop(o, 'flags')),
  }));

  const npcs: ImportedNpc[] = layerObjects(map, 'npcs').map((o) => ({
    name: o.name,
    x: Math.round(unscale(num(o.x))),
    y: Math.round(unscale(num(o.y))),
    hue: num(prop(o, 'hue')),
    kind: str(prop(o, 'kind'), 'vendor'),
    flags: num(prop(o, 'flags')),
  }));

  return { areaId, decor, spawns, npcs };
}

/**
 * Apply a parsed Tiled import to the DB: replace the area's decor / creature_spawns / npcs with the
 * imported rows, in one transaction (all-or-nothing). Spawn template ids are validated against
 * mob_templates (unknown ones are skipped) since the column is a FK. Returns a status + counts.
 * The host reloads + re-broadcasts content afterward so the change applies to fresh instances.
 */
export function applyTiledImport(
  db: GameDatabase,
  map: TiledMap,
): { ok: boolean; message: string } {
  const parsed = tiledToContent(map);
  if (!parsed) return { ok: false, message: 'Not a valid Tiled map (missing areaId).' };
  const { areaId } = parsed;

  const knownTemplate = db.prepare('SELECT 1 FROM mob_templates WHERE id = ?');
  const validSpawns = parsed.spawns.filter((s) => knownTemplate.get(s.templateId));

  const run = db.transaction(() => {
    db.prepare('DELETE FROM decor WHERE area_id = ?').run(areaId);
    db.prepare('DELETE FROM creature_spawns WHERE area_id = ?').run(areaId);
    db.prepare('DELETE FROM npcs WHERE area_id = ?').run(areaId);

    const insDecor = db.prepare(
      'INSERT INTO decor (area_id,kind,x,y,x2,y2,color,scale) VALUES (?,?,?,?,?,?,?,?)',
    );
    for (const d of parsed.decor)
      insDecor.run(areaId, d.kind, d.x, d.y, d.x2, d.y2, d.color, d.scale);

    const insSpawn = db.prepare(
      'INSERT INTO creature_spawns (area_id,template_id,x,y,flags) VALUES (?,?,?,?,?)',
    );
    for (const s of validSpawns) insSpawn.run(areaId, s.templateId, s.x, s.y, s.flags);

    const insNpc = db.prepare(
      'INSERT INTO npcs (area_id,name,x,y,hue,kind,npc_flags) VALUES (?,?,?,?,?,?,?)',
    );
    for (const n of parsed.npcs) insNpc.run(areaId, n.name, n.x, n.y, n.hue, n.kind, n.flags);
  });
  run();

  const skipped = parsed.spawns.length - validSpawns.length;
  return {
    ok: true,
    message:
      `Imported into ${areaId}: ${parsed.decor.length} decor, ${validSpawns.length} spawns, ` +
      `${parsed.npcs.length} npcs` +
      (skipped > 0 ? ` (${skipped} spawn(s) skipped — unknown template)` : '') +
      '. Reload to apply.',
  };
}

/** Convenience wrapper over the active DB for the host route. */
export function importTiled(map: TiledMap): { ok: boolean; message: string } {
  return applyTiledImport(getDb(), map);
}
