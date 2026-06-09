/**
 * Area definitions for the open world. The world is one connected place, but it is carved
 * into AREAS, and each area is served by one or more INSTANCES that the server spins up
 * based on player cap / load (see server/instance-manager.ts). Players cross between areas
 * through PORTALS. This file is shared so the client can render area names and portals
 * without a round-trip.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Portal {
  /** The trigger region in this area; stepping into it transfers the player. */
  rect: Rect;
  /** Destination area id. */
  toArea: string;
  /** Where the player appears in the destination (kept clear of that area's portals). */
  toSpawn: Vec2;
  /** Short label for the client to draw on the portal. */
  label: string;
}

export interface AreaDef {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Default arrival point. */
  spawn: Vec2;
  /** Soft cap: in 'auto' instancing, a new instance is spun up once all are at this many players. */
  playerCap: number;
  portals: Portal[];
}

export const START_AREA = 'town';

/**
 * Themed around the WC3 / Diablo / RuneScape blend — a safe town, a dangerous wilderness,
 * and an instanced dungeon. Spawn points are deliberately placed clear of portal rects so
 * arriving never re-triggers a transfer.
 */
export const AREAS: Record<string, AreaDef> = {
  town: {
    id: 'town',
    name: 'Aldermere',
    width: 1600,
    height: 1200,
    spawn: { x: 800, y: 600 },
    playerCap: 20,
    portals: [
      {
        rect: { x: 1520, y: 500, w: 80, h: 200 },
        toArea: 'wilderness',
        toSpawn: { x: 160, y: 700 },
        label: 'To Gloomwood →',
      },
    ],
  },
  wilderness: {
    id: 'wilderness',
    name: 'Gloomwood',
    width: 2400,
    height: 2000,
    spawn: { x: 160, y: 700 },
    playerCap: 30,
    portals: [
      {
        rect: { x: 0, y: 600, w: 60, h: 200 },
        toArea: 'town',
        toSpawn: { x: 1440, y: 600 },
        label: '← To Aldermere',
      },
      {
        rect: { x: 2340, y: 1700, w: 60, h: 300 },
        toArea: 'crypt',
        toSpawn: { x: 700, y: 300 },
        label: 'Shadow Crypt ↓',
      },
    ],
  },
  crypt: {
    id: 'crypt',
    name: 'Shadow Crypt',
    width: 1400,
    height: 1400,
    spawn: { x: 700, y: 300 },
    playerCap: 8,
    portals: [
      {
        rect: { x: 600, y: 0, w: 200, h: 50 },
        toArea: 'wilderness',
        toSpawn: { x: 2280, y: 1750 },
        label: '↑ Escape to Gloomwood',
      },
    ],
  },
};

export function areaOf(id: string): AreaDef | undefined {
  return AREAS[id];
}

export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
