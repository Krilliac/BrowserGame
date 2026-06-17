/**
 * Godot 4 scene (`.tscn`) export adapter — a second cross-engine bridge of the in-browser editor,
 * sibling to {@link areaToTiled} (editor-tiled.ts). Where the Tiled adapter emits the de-facto 2D map
 * interchange format, this one emits a *native* Godot 4 scene so the area opens directly in the Godot
 * editor with no importer in the loop.
 *
 * It is a pure transform of the same data-driven content the Tiled adapter reads — area dimensions +
 * decor + creature spawns + NPCs + portals, all via {@link getContent} so coordinates are the served
 * (world-scaled) view. Using the identical data access (and {@link TILE_SIZE} convention: Godot, like
 * Tiled, works in pixels, so positions are emitted raw — the two exports agree coordinate-for-coordinate)
 * keeps the two bridges in lock-step. No DB writes; fully deterministic (stable ordering, no
 * timestamps/RNG) so the output is byte-stable and round-trippable.
 *
 * Entity data that would otherwise be lost in a pure-visual export (template ids, npc names, portal
 * targets, decor kinds) rides each node as `metadata/*` properties.
 */

import { getContent } from './content.js';
import { TILE_SIZE } from './editor-tiled.js';

/** Re-export so callers/tests can assert the two adapters share the pixel-per-tile convention. */
export { TILE_SIZE };

/** Metadata value kinds we serialize into a `.tscn` (string, number, or bool). */
type MetaValue = string | number | boolean;

/**
 * Escape a string for a Godot `.tscn` double-quoted string literal. Godot uses C-style escapes inside
 * quoted strings, so a backslash, quote, newline, tab or carriage return in (say) a decor/npc name
 * can't break out of the literal and corrupt the file.
 */
function escapeString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Sanitize an arbitrary label into a valid Godot node name. Godot node names may not contain `.`, `:`,
 * `@`, `/`, `"`, `%`, or whitespace; we collapse every run of disallowed characters to a single `_`.
 * An empty/whitespace-only result falls back to `Node` so a name is always present.
 */
function sanitizeName(label: string): string {
  const cleaned = label.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : 'Node';
}

/** Render a metadata value as Godot variant source. */
function renderMetaValue(value: MetaValue): string {
  if (typeof value === 'string') return `"${escapeString(value)}"`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  // Numbers: emit as-is; JS number formatting is deterministic and Godot parses both ints and floats.
  return String(value);
}

/** One node to emit into the scene: a Marker2D/Node2D child of a layer group. */
interface SceneNode {
  name: string;
  /** Godot type — `Marker2D` for points (spawns/npcs/portals), `Node2D` for decor. */
  type: 'Marker2D' | 'Node2D';
  x: number;
  y: number;
  /** Ordered metadata key→value pairs (stable order = deterministic output). */
  meta: [string, MetaValue][];
}

/** One layer group: a `Node2D` parent grouping its entity nodes under the scene root. */
interface SceneGroup {
  name: 'Decor' | 'Spawns' | 'Npcs' | 'Portals';
  nodes: SceneNode[];
}

/**
 * Export one area to a Godot 4 `.tscn` document (null for an unknown area). The scene root is a
 * `Node2D` named after the (sanitized) area id; under it sit four group `Node2D`s — Decor, Spawns,
 * Npcs, Portals — each holding one entity node per placeable. Positions use the same coordinate
 * convention as {@link areaToTiled} (served pixels), and every field the Tiled export carries as a
 * custom property is preserved here as `metadata/*` so no data is lost in the round-trip.
 */
export function areaToGodot(areaId: string): string | null {
  const content = getContent();
  const area = content.area(areaId);
  if (!area) return null;

  const decorNodes: SceneNode[] = (area.decor ?? []).map((d, i) => {
    const meta: [string, MetaValue][] = [['kind', d.kind]];
    if (d.scale !== undefined) meta.push(['scale', d.scale]);
    if (d.color !== undefined) meta.push(['color', d.color]);
    if (d.x2 !== undefined) meta.push(['x2', d.x2]);
    if (d.y2 !== undefined) meta.push(['y2', d.y2]);
    return {
      name: `Decor_${sanitizeName(d.kind)}_${i}`,
      type: 'Node2D',
      x: d.x,
      y: d.y,
      meta,
    };
  });

  const spawnNodes: SceneNode[] = content.creatureSpawns(areaId).map((s, i) => ({
    name: `Spawn_${sanitizeName(s.templateId)}_${i}`,
    type: 'Marker2D',
    x: s.x,
    y: s.y,
    meta: [
      ['templateId', s.templateId],
      ['uid', s.uid],
      ['flags', s.flags],
    ],
  }));

  const npcNodes: SceneNode[] = content.npcs(areaId).map((n, i) => ({
    name: `Npc_${sanitizeName(n.name)}_${i}`,
    type: 'Marker2D',
    x: n.x,
    y: n.y,
    meta: [
      ['name', n.name],
      ['kind', n.kind],
      ['flags', n.flags],
      ['hue', n.hue],
    ],
  }));

  const portalNodes: SceneNode[] = area.portals.map((p, i) => ({
    name: `Portal_${sanitizeName(p.label)}_${i}`,
    type: 'Marker2D',
    x: p.rect.x,
    y: p.rect.y,
    meta: [
      ['label', p.label],
      ['toArea', p.toArea],
      ['toSpawnX', p.toSpawn.x],
      ['toSpawnY', p.toSpawn.y],
      ['rectW', p.rect.w],
      ['rectH', p.rect.h],
    ],
  }));

  const groups: SceneGroup[] = [
    { name: 'Decor', nodes: decorNodes },
    { name: 'Spawns', nodes: spawnNodes },
    { name: 'Npcs', nodes: npcNodes },
    { name: 'Portals', nodes: portalNodes },
  ];

  return renderScene(area.id, area.name, area.pvp ?? 'safe', groups);
}

/** Render the collected groups/nodes into a deterministic `.tscn` text document. */
function renderScene(areaId: string, areaName: string, pvp: string, groups: SceneGroup[]): string {
  const rootName = sanitizeName(areaId);
  const lines: string[] = [];

  // The scene header. load_steps counts the root + every node we emit (Godot tolerates an
  // over-count, but an exact one keeps the file idiomatic). format=3 is the Godot 4 scene format.
  const nodeCount = 1 + groups.length + groups.reduce((n, g) => n + g.nodes.length, 0);
  lines.push(`[gd_scene load_steps=${nodeCount} format=3]`);
  lines.push('');

  // Root node, carrying area-level metadata (id/name/pvp + the pixel-per-tile convention).
  lines.push(`[node name="${escapeString(rootName)}" type="Node2D"]`);
  lines.push(`metadata/areaId = "${escapeString(areaId)}"`);
  lines.push(`metadata/name = "${escapeString(areaName)}"`);
  lines.push(`metadata/pvp = "${escapeString(pvp)}"`);
  lines.push(`metadata/tileSize = ${TILE_SIZE}`);
  lines.push('');

  for (const group of groups) {
    lines.push(`[node name="${escapeString(group.name)}" type="Node2D" parent="."]`);
    lines.push('');
    for (const node of group.nodes) {
      lines.push(
        `[node name="${escapeString(node.name)}" type="${node.type}" parent="${escapeString(
          group.name,
        )}"]`,
      );
      lines.push(`position = Vector2(${node.x}, ${node.y})`);
      for (const [key, value] of node.meta) {
        lines.push(`metadata/${sanitizeName(key)} = ${renderMetaValue(value)}`);
      }
      lines.push('');
    }
  }

  // Trailing newline; join with `\n` for byte-stable output across platforms.
  return lines.join('\n') + '\n';
}
