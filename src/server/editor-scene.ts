/**
 * Unified "scene" data API for the in-browser canvas map editor.
 *
 * Where {@link areaToTiled} (editor-tiled.ts) exports the *served* (world-scaled) view for handing
 * to another engine, this module exposes the AUTHORED view — the raw, pre-WORLD_SCALE coordinates as
 * they actually live in the SQLite rows. The canvas editor edits authored space directly: what it
 * reads here is exactly what a place/edit module would write back, with no scale round-tripping.
 *
 * So this reads RAW rows from {@link getDb} rather than {@link getContent}, whose accessors multiply
 * every coordinate by `config.world.scale` at load. Pure reads only — no DB writes.
 */

import { config } from './config.js';
import { getDb } from './content.js';

/** Authored world scale, exposed so a caller can map authored ↔ served coords if it needs to. */
export const WORLD_SCALE = config.world.scale;

/** One editable thing on a scene layer, addressed by its source table + primary key (authored coords). */
export interface ScenePlaceable {
  /** Source SQLite table (e.g. 'decor', 'npcs') — the write target for an edit/place module. */
  table: string;
  /** Stringified primary key within {@link table} ('' when the table has no addressable id). */
  pk: string;
  /** Category/sprite key (decor.kind, npc.kind, the spawn's template id, or 'portal'). */
  kind: string;
  /** Authored x (raw row value, NOT world-scaled). */
  x: number;
  /** Authored y (raw row value, NOT world-scaled). */
  y: number;
  /** Optional human label (npc name, portal label). */
  label?: string;
  /** Extra editable fields specific to the layer (scale, color, flags, to_area, …). */
  props?: Record<string, string | number | null>;
}

/** The full authored scene for one area, grouped into the canvas editor's named layers. */
export interface AreaScene {
  areaId: string;
  name: string;
  /** Authored area dimensions (raw `areas` row, pre-world-scale). */
  width: number;
  height: number;
  /** Authored default spawn point (raw `areas.spawn_x/_y`). */
  spawn: { x: number; y: number };
  /** PvP rule for the area ('safe' when no `area_pvp` row exists). */
  pvp: string;
  layers: {
    decor: ScenePlaceable[];
    spawns: ScenePlaceable[];
    npcs: ScenePlaceable[];
    portals: ScenePlaceable[];
  };
}

interface AreaRow {
  id: string;
  name: string;
  width: number;
  height: number;
  spawn_x: number;
  spawn_y: number;
}
interface DecorRow {
  id: number;
  kind: string;
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  color: string | null;
  scale: number | null;
}
interface SpawnRow {
  uid: number;
  template_id: string;
  x: number;
  y: number;
  flags: number;
}
interface NpcRow {
  id: number;
  name: string;
  x: number;
  y: number;
  hue: number;
  kind: string;
}
interface PortalRow {
  id: number;
  rect_x: number;
  rect_y: number;
  rect_w: number;
  rect_h: number;
  to_area: string;
  label: string;
}

/**
 * Build the authored scene for one area (null for an unknown area). Reads raw rows so coordinates
 * are returned exactly as stored — the canvas edits authored space, and the served world applies
 * `config.world.scale` separately at content load. Pure read.
 */
export function areaScene(areaId: string): AreaScene | null {
  const db = getDb();

  const area = db
    .prepare('SELECT id, name, width, height, spawn_x, spawn_y FROM areas WHERE id = ?')
    .get(areaId) as AreaRow | undefined;
  if (!area) return null;

  const pvpRow = db.prepare('SELECT rule FROM area_pvp WHERE area_id = ?').get(areaId) as
    | { rule: string }
    | undefined;

  const decor: ScenePlaceable[] = (
    db
      .prepare('SELECT id, kind, x, y, x2, y2, color, scale FROM decor WHERE area_id = ?')
      .all(areaId) as DecorRow[]
  ).map((r) => ({
    table: 'decor',
    pk: String(r.id),
    kind: r.kind,
    x: r.x,
    y: r.y,
    props: { scale: r.scale, color: r.color, x2: r.x2, y2: r.y2 },
  }));

  const spawns: ScenePlaceable[] = (
    db
      .prepare('SELECT uid, template_id, x, y, flags FROM creature_spawns WHERE area_id = ?')
      .all(areaId) as SpawnRow[]
  ).map((r) => ({
    table: 'creature_spawns',
    pk: String(r.uid),
    kind: r.template_id,
    x: r.x,
    y: r.y,
    props: { flags: r.flags },
  }));

  const npcs: ScenePlaceable[] = (
    db
      .prepare('SELECT id, name, x, y, hue, kind FROM npcs WHERE area_id = ?')
      .all(areaId) as NpcRow[]
  ).map((r) => ({
    table: 'npcs',
    pk: String(r.id),
    kind: r.kind,
    x: r.x,
    y: r.y,
    label: r.name,
    props: { hue: r.hue },
  }));

  const portals: ScenePlaceable[] = (
    db
      .prepare(
        'SELECT id, rect_x, rect_y, rect_w, rect_h, to_area, label FROM portals WHERE area_id = ?',
      )
      .all(areaId) as PortalRow[]
  ).map((r) => ({
    table: 'portals',
    pk: String(r.id),
    kind: 'portal',
    x: r.rect_x,
    y: r.rect_y,
    label: r.label,
    props: { to_area: r.to_area, rect_w: r.rect_w, rect_h: r.rect_h },
  }));

  return {
    areaId: area.id,
    name: area.name,
    width: area.width,
    height: area.height,
    spawn: { x: area.spawn_x, y: area.spawn_y },
    pvp: pvpRow?.rule ?? 'safe',
    layers: { decor, spawns, npcs, portals },
  };
}
