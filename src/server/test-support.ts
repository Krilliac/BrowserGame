/**
 * Test-only helpers for building Worlds against the LOADED content (which applies the world
 * scale). Tests must never hardcode world coordinates: authored data is compact, the served
 * world is WORLD_SCALE× as long, and these lookups keep tests true at any scale.
 */
import { World } from './world.js';
import { getContent } from './content.js';

/** A World sized + spawned like the real area (content dimensions, post-scale). */
export function areaWorld(areaId: string): World {
  const area = getContent().area(areaId);
  if (!area) throw new Error(`test-support: unknown area ${areaId}`);
  return new World(area.width, area.height, area.spawn, undefined, areaId);
}

/** The (post-scale) position of the first NPC of a kind in an area. */
export function npcPos(areaId: string, kind: string): { x: number; y: number } {
  const npc = getContent()
    .npcs(areaId)
    .find((n) => n.kind === kind);
  if (!npc) throw new Error(`test-support: no ${kind} npc in ${areaId}`);
  return { x: npc.x, y: npc.y };
}

/** The (post-scale) position of the first NPC with a given name in an area. */
export function npcPosByName(areaId: string, name: string): { x: number; y: number } {
  const npc = getContent()
    .npcs(areaId)
    .find((n) => n.name === name);
  if (!npc) throw new Error(`test-support: no npc named ${name} in ${areaId}`);
  return { x: npc.x, y: npc.y };
}

/** The (post-scale) position of the first decor prop of a kind in an area. */
export function decorPos(areaId: string, kind: string): { x: number; y: number } {
  const prop = (getContent().area(areaId)?.decor ?? []).find((d) => d.kind === kind);
  if (!prop) throw new Error(`test-support: no ${kind} decor in ${areaId}`);
  return { x: prop.x, y: prop.y };
}
