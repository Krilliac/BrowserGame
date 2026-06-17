/**
 * Tiled `.tmj` export adapter — the first cross-engine bridge of the in-browser editor.
 *
 * Tiled (mapeditor.org) is the de-facto interchange format for 2D maps: Godot, Unity (SuperTiled2Unity),
 * GameMaker, Defold, 001 Game Creator and many others import `.tmj`/`.tmx`. So exporting an area to
 * Tiled JSON is the widest single step toward "port the world to another engine." This is a pure
 * transform of the data-driven content (area dimensions + decor + creature spawns + NPCs + portals)
 * into a Tiled orthogonal map with object layers — no DB writes, fully unit-testable. The reverse
 * (Tiled → content import) is a future slice; the object layers here are named/typed to round-trip.
 */

import { getContent } from './content.js';

/** Tiled object-tile size we emit (px per tile). Object coords stay in pixels regardless. */
export const TILE_SIZE = 32;

export interface TiledProperty {
  name: string;
  type: 'string' | 'int' | 'float' | 'bool';
  value: string | number | boolean;
}

export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A zero-size object is a point (decor/spawn/npc); a sized one is a region (portal). */
  point?: boolean;
  properties?: TiledProperty[];
}

export interface TiledLayer {
  id: number;
  name: string;
  type: 'objectgroup';
  objects: TiledObject[];
  opacity: number;
  visible: boolean;
  x: 0;
  y: 0;
}

export interface TiledMap {
  type: 'map';
  version: string;
  tiledversion: string;
  orientation: 'orthogonal';
  renderorder: 'right-down';
  infinite: false;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  tilesets: [];
  layers: TiledLayer[];
  properties: TiledProperty[];
}

const sp = (name: string, value: string): TiledProperty => ({ name, type: 'string', value });
const ip = (name: string, value: number): TiledProperty => ({ name, type: 'int', value });
const fp = (name: string, value: number): TiledProperty => ({ name, type: 'float', value });

/**
 * Export one area to a Tiled `.tmj` map object (null for an unknown area). Decor/spawns/NPCs become
 * point objects on named object layers; portals become sized region objects; the area's default
 * spawn is a point. Custom props (kind, scale, templateId, toArea, …) ride each object so the map
 * is a faithful, re-importable snapshot of the area's content — not just visuals.
 */
export function areaToTiled(areaId: string): TiledMap | null {
  const content = getContent();
  const area = content.area(areaId);
  if (!area) return null;

  let nextId = 1;
  const id = (): number => nextId++;

  const decorObjects: TiledObject[] = (area.decor ?? []).map((d) => {
    const props: TiledProperty[] = [sp('kind', d.kind)];
    if (d.scale !== undefined) props.push(fp('scale', d.scale));
    if (d.color !== undefined) props.push(sp('color', d.color));
    if (d.x2 !== undefined) props.push(fp('x2', d.x2));
    if (d.y2 !== undefined) props.push(fp('y2', d.y2));
    return {
      id: id(),
      name: d.kind,
      type: 'decor',
      x: d.x,
      y: d.y,
      width: 0,
      height: 0,
      point: true,
      properties: props,
    };
  });

  const spawnObjects: TiledObject[] = content.creatureSpawns(areaId).map((s) => ({
    id: id(),
    name: s.templateId,
    type: 'spawn',
    x: s.x,
    y: s.y,
    width: 0,
    height: 0,
    point: true,
    properties: [sp('templateId', s.templateId), ip('uid', s.uid), ip('flags', s.flags)],
  }));

  const npcObjects: TiledObject[] = content.npcs(areaId).map((n) => ({
    id: id(),
    name: n.name,
    type: 'npc',
    x: n.x,
    y: n.y,
    width: 0,
    height: 0,
    point: true,
    properties: [sp('kind', n.kind), ip('flags', n.flags), fp('hue', n.hue)],
  }));

  const portalObjects: TiledObject[] = area.portals.map((p) => ({
    id: id(),
    name: p.label,
    type: 'portal',
    x: p.rect.x,
    y: p.rect.y,
    width: p.rect.w,
    height: p.rect.h,
    properties: [sp('toArea', p.toArea), fp('toSpawnX', p.toSpawn.x), fp('toSpawnY', p.toSpawn.y)],
  }));

  const spawnPoint: TiledObject = {
    id: id(),
    name: 'spawn',
    type: 'spawnpoint',
    x: area.spawn.x,
    y: area.spawn.y,
    width: 0,
    height: 0,
    point: true,
  };

  const layer = (name: string, objects: TiledObject[]): TiledLayer => ({
    id: id(),
    name,
    type: 'objectgroup',
    objects,
    opacity: 1,
    visible: true,
    x: 0,
    y: 0,
  });

  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.0',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width: Math.max(1, Math.ceil(area.width / TILE_SIZE)),
    height: Math.max(1, Math.ceil(area.height / TILE_SIZE)),
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    tilesets: [],
    layers: [
      layer('decor', decorObjects),
      layer('spawns', spawnObjects),
      layer('npcs', npcObjects),
      layer('portals', portalObjects),
      layer('meta', [spawnPoint]),
    ],
    properties: [sp('areaId', area.id), sp('name', area.name), sp('pvp', area.pvp ?? 'safe')],
  };
}
