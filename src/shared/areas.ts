/**
 * Area definitions for the open world. The world is one connected place, but it is carved
 * into AREAS, and each area is served by one or more INSTANCES that the server spins up
 * based on player cap / load (see server/instance-manager.ts). Players cross between areas
 * through PORTALS. This file is shared so the client can render area names and portals
 * without a round-trip.
 */

import type { AreaTheme } from './theme.js';

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
  /** Data-driven environment look, loaded from the area_theme DB table (DEFAULT_THEME if absent). */
  theme?: AreaTheme;
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
      {
        rect: { x: 1000, y: 1940, w: 360, h: 60 },
        toArea: 'marsh',
        toSpawn: { x: 1100, y: 160 },
        label: 'Rotfen Marsh ↓',
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
      {
        rect: { x: 600, y: 1350, w: 200, h: 50 },
        toArea: 'mines',
        toSpawn: { x: 900, y: 160 },
        label: 'Emberdeep Mines ↓',
      },
    ],
  },
  // A poison-soaked branch off Gloomwood (the first "which way?" choice). Soft-gated by mob level.
  marsh: {
    id: 'marsh',
    name: 'Rotfen Marsh',
    width: 2200,
    height: 1800,
    spawn: { x: 1100, y: 160 },
    playerCap: 24,
    portals: [
      {
        rect: { x: 940, y: 0, w: 320, h: 50 },
        toArea: 'wilderness',
        toSpawn: { x: 1180, y: 1860 },
        label: '↑ Back to Gloomwood',
      },
    ],
  },
  // A volcanic underground beyond the crypt; continues the spine, exits to Frostpeak.
  mines: {
    id: 'mines',
    name: 'Emberdeep Mines',
    width: 1900,
    height: 1700,
    spawn: { x: 900, y: 160 },
    playerCap: 16,
    portals: [
      {
        rect: { x: 800, y: 0, w: 200, h: 50 },
        toArea: 'crypt',
        toSpawn: { x: 700, y: 1300 },
        label: '↑ Back to the Crypt',
      },
      {
        rect: { x: 820, y: 1650, w: 260, h: 50 },
        toArea: 'frostpeak',
        toSpawn: { x: 1000, y: 180 },
        label: 'Frostpeak Pass ↓',
      },
    ],
  },
  // Ice highlands — the current act-end, home of the Pale King.
  frostpeak: {
    id: 'frostpeak',
    name: 'Frostpeak Pass',
    width: 2200,
    height: 2000,
    spawn: { x: 1000, y: 180 },
    playerCap: 16,
    portals: [
      {
        rect: { x: 880, y: 0, w: 260, h: 50 },
        toArea: 'mines',
        toSpawn: { x: 950, y: 1600 },
        label: '↑ Back to Emberdeep',
      },
    ],
  },
};

/**
 * Default environment themes per area — the look these areas shipped with, used to seed the
 * `area_theme` DB table. After seeding, the DB is the source of truth: edit it (SQL or /settheme)
 * to re-skin live. Areas without an entry fall back to DEFAULT_THEME.
 */
export const AREA_THEMES: Record<string, AreaTheme> = {
  town: {
    groundBase: '#2f3b29',
    groundSpeck: '#3a4a32',
    prop: 'tree',
    propDensity: 0.05,
    atmoColor: '#ffdca8',
    atmoAlpha: 0.05,
    outdoor: true,
    particleColor: '#fff0c0',
    particleCount: 36,
    particleRise: -10,
    particleFlicker: false,
    weather: 'none',
    weatherIntensity: 0.5,
    fogColor: '#cfd6e0',
    lightAmbient: 1,
    gradeSaturation: 1.05,
    gradeBrightness: 1.02,
    gradeContrast: 1,
    spriteTint: '#ffffff',
  },
  wilderness: {
    groundBase: '#1f2a1c',
    groundSpeck: '#27331f',
    prop: 'tree',
    propDensity: 0.1,
    atmoColor: '#4a6a4a',
    atmoAlpha: 0.1,
    outdoor: true,
    particleColor: '#bfff8a',
    particleCount: 40,
    particleRise: -6,
    particleFlicker: true,
    weather: 'none',
    weatherIntensity: 0.5,
    fogColor: '#8a93a0',
    lightAmbient: 0.95,
    gradeSaturation: 1.1,
    gradeBrightness: 1,
    gradeContrast: 1.05,
    spriteTint: '#ffffff',
  },
  crypt: {
    groundBase: '#16161c',
    groundSpeck: '#20202a',
    prop: 'grave',
    propDensity: 0.08,
    atmoColor: '#203050',
    atmoAlpha: 0.34,
    outdoor: false,
    particleColor: '#8c93a8',
    particleCount: 44,
    particleRise: 14,
    particleFlicker: false,
    weather: 'fog',
    weatherIntensity: 0.35,
    fogColor: '#2a3346',
    lightAmbient: 0.5,
    gradeSaturation: 0.7,
    gradeBrightness: 0.92,
    gradeContrast: 1.08,
    spriteTint: '#bcc6e6',
  },
  // Sickly green, foggy, low light — the swamp reads as poisonous at a glance.
  marsh: {
    groundBase: '#1c241a',
    groundSpeck: '#2c3a22',
    prop: 'mushroom',
    propDensity: 0.12,
    atmoColor: '#3c5a32',
    atmoAlpha: 0.22,
    outdoor: true,
    particleColor: '#9fd86a',
    particleCount: 54,
    particleRise: -3,
    particleFlicker: true,
    weather: 'fog',
    weatherIntensity: 0.5,
    fogColor: '#3a4a2e',
    lightAmbient: 0.72,
    gradeSaturation: 0.95,
    gradeBrightness: 0.92,
    gradeContrast: 1.05,
    spriteTint: '#cfe6b8',
  },
  // Near-black volcanic rock lit by drifting embers — hot, cramped, dangerous.
  mines: {
    groundBase: '#1a1210',
    groundSpeck: '#33180e',
    prop: 'crystal',
    propDensity: 0.1,
    atmoColor: '#5a1e0a',
    atmoAlpha: 0.28,
    outdoor: false,
    particleColor: '#ff8a3a',
    particleCount: 60,
    particleRise: -14,
    particleFlicker: true,
    weather: 'none',
    weatherIntensity: 0.5,
    fogColor: '#3a1c12',
    lightAmbient: 0.45,
    gradeSaturation: 1.15,
    gradeBrightness: 0.95,
    gradeContrast: 1.12,
    spriteTint: '#ffd2b0',
  },
  // White-blue ice highlands with driving snow — high contrast, cold and stark.
  frostpeak: {
    groundBase: '#cdd8e6',
    groundSpeck: '#aebfd4',
    prop: 'rock',
    propDensity: 0.09,
    atmoColor: '#bcd0ee',
    atmoAlpha: 0.18,
    outdoor: true,
    particleColor: '#ffffff',
    particleCount: 64,
    particleRise: 6,
    particleFlicker: false,
    weather: 'snow',
    weatherIntensity: 0.7,
    fogColor: '#dfeaf6',
    lightAmbient: 1,
    gradeSaturation: 0.9,
    gradeBrightness: 1.06,
    gradeContrast: 1.08,
    spriteTint: '#dcebff',
  },
};

export function areaOf(id: string): AreaDef | undefined {
  return AREAS[id];
}

export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
