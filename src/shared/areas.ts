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

/**
 * One static set-dressing prop, placed in world coordinates. Loaded from the `decor` SQL table and
 * sent to the client inside the area's content, so the town's look is server-defined data rather
 * than client-hardcoded. The renderer owns HOW each `kind` is drawn; this is purely WHAT + WHERE.
 */
export interface DecorProp {
  /** Visual kind, e.g. 'palisade' | 'gate' | 'bonfire' | 'tent' | 'wagon' | 'torch' | 'crate'. */
  kind: string;
  x: number;
  y: number;
  /** Line props (palisade/fence): the far endpoint. */
  x2?: number;
  y2?: number;
  /** Optional cloth/wood tint (CSS hex). */
  color?: string;
  /** Optional size multiplier (1 = renderer default). */
  scale?: number;
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
  /** Static set-dressing props, loaded from the `decor` DB table (empty when the area has none). */
  decor?: DecorProp[];
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
        rect: { x: 2340, y: 300, w: 60, h: 300 },
        toArea: 'hollowroot',
        toSpawn: { x: 760, y: 220 },
        label: 'Hollowroot Caverns ⌖',
      },
      {
        rect: { x: 1000, y: 1940, w: 360, h: 60 },
        toArea: 'marsh',
        toSpawn: { x: 1100, y: 160 },
        label: 'Rotfen Marsh ↓',
      },
      {
        rect: { x: 1080, y: 0, w: 300, h: 50 },
        toArea: 'forgotten_catacombs',
        toSpawn: { x: 750, y: 220 },
        label: 'The Forgotten Catacombs ⌖',
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
      {
        rect: { x: 1000, y: 1750, w: 300, h: 50 },
        toArea: 'writhing_hive',
        toSpawn: { x: 750, y: 220 },
        label: 'The Writhing Hive ⌖',
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
      {
        rect: { x: 0, y: 760, w: 50, h: 240 },
        toArea: 'infernal_forge',
        toSpawn: { x: 750, y: 220 },
        label: 'The Infernal Forge ⌖',
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
      {
        rect: { x: 960, y: 1950, w: 300, h: 50 },
        toArea: 'frozen_vault',
        toSpawn: { x: 750, y: 220 },
        label: 'The Frozen Vault ⌖',
      },
      {
        rect: { x: 2150, y: 800, w: 50, h: 300 },
        toArea: 'sundered_wastes',
        toSpawn: { x: 160, y: 1000 },
        label: 'The Sundered Wastes →',
      },
      {
        rect: { x: 0, y: 850, w: 50, h: 300 },
        toArea: 'duskhaven',
        toSpawn: { x: 1340, y: 620 },
        label: '← Duskhaven Refuge',
      },
    ],
  },

  // The frontier village: a second rest point at the far end of the spine, off Frostpeak.
  // A safe settlement (no area_mobs roster) — vendor, healer, banker, and quest-giver live here.
  duskhaven: {
    id: 'duskhaven',
    name: 'Duskhaven',
    width: 1500,
    height: 1100,
    spawn: { x: 750, y: 620 },
    playerCap: 8,
    portals: [
      {
        rect: { x: 1440, y: 470, w: 60, h: 260 },
        toArea: 'frostpeak',
        toSpawn: { x: 160, y: 1000 },
        label: 'To Frostpeak Pass →',
      },
    ],
  },

  // ===================================================================================
  // Procedural dungeons — entered via the portals above. Each is repopulated on instance
  // creation (random packs, elevated elite chance, a boss); the population pool + boss live
  // in DUNGEONS below. A low playerCap keeps them near-private so re-entering re-rolls.
  // ===================================================================================
  forgotten_catacombs: {
    id: 'forgotten_catacombs',
    name: 'The Forgotten Catacombs',
    width: 1500,
    height: 1300,
    spawn: { x: 750, y: 220 },
    playerCap: 4,
    portals: [
      {
        rect: { x: 600, y: 0, w: 300, h: 50 },
        toArea: 'wilderness',
        toSpawn: { x: 1230, y: 120 },
        label: '↑ Leave the Catacombs',
      },
    ],
  },
  // The endgame rift: opened at a chosen difficulty tier by the town Riftkeeper. Every opening
  // is a FRESH private instance (never joined via pickInstance); the tier scales the monsters.
  rift: {
    id: 'rift',
    name: 'The Shattered Rift',
    width: 1500,
    height: 1300,
    spawn: { x: 750, y: 220 },
    playerCap: 4,
    portals: [
      {
        rect: { x: 600, y: 0, w: 300, h: 50 },
        toArea: 'town',
        toSpawn: { x: 800, y: 700 },
        label: '↑ Return to Aldermere',
      },
    ],
  },
  writhing_hive: {
    id: 'writhing_hive',
    name: 'The Writhing Hive',
    width: 1500,
    height: 1300,
    spawn: { x: 750, y: 220 },
    playerCap: 4,
    portals: [
      {
        rect: { x: 600, y: 0, w: 300, h: 50 },
        toArea: 'marsh',
        toSpawn: { x: 1150, y: 1650 },
        label: '↑ Flee the Hive',
      },
    ],
  },
  infernal_forge: {
    id: 'infernal_forge',
    name: 'The Infernal Forge',
    width: 1500,
    height: 1300,
    spawn: { x: 750, y: 220 },
    playerCap: 4,
    portals: [
      {
        rect: { x: 600, y: 0, w: 300, h: 50 },
        toArea: 'mines',
        toSpawn: { x: 140, y: 880 },
        label: '↑ Escape the Forge',
      },
    ],
  },
  frozen_vault: {
    id: 'frozen_vault',
    name: 'The Frozen Vault',
    width: 1500,
    height: 1300,
    spawn: { x: 750, y: 220 },
    playerCap: 4,
    portals: [
      {
        rect: { x: 600, y: 0, w: 300, h: 50 },
        toArea: 'frostpeak',
        toSpawn: { x: 1110, y: 1850 },
        label: '↑ Leave the Vault',
      },
    ],
  },
  // A winding cave system off Gloomwood — the early-game "caves" branch (procedural, instanced).
  hollowroot: {
    id: 'hollowroot',
    name: 'Hollowroot Caverns',
    width: 1700,
    height: 1500,
    spawn: { x: 760, y: 220 },
    playerCap: 4,
    portals: [
      {
        rect: { x: 620, y: 0, w: 300, h: 50 },
        toArea: 'wilderness',
        toSpawn: { x: 2280, y: 450 },
        label: '↑ Back to Gloomwood',
      },
    ],
  },

  // Act 2: a void-scarred highland beyond Frostpeak — the new level ceiling (L20-26).
  sundered_wastes: {
    id: 'sundered_wastes',
    name: 'The Sundered Wastes',
    width: 2400,
    height: 2000,
    spawn: { x: 160, y: 1000 },
    playerCap: 16,
    portals: [
      {
        rect: { x: 0, y: 850, w: 50, h: 300 },
        toArea: 'frostpeak',
        toSpawn: { x: 2080, y: 1000 },
        label: '← Back to Frostpeak',
      },
      {
        rect: { x: 2350, y: 900, w: 50, h: 300 },
        toArea: 'blighted_spire',
        toSpawn: { x: 160, y: 1000 },
        label: 'The Blighted Spire →',
      },
    ],
  },

  // Act 3: a corrupted citadel beyond the Wastes — the new level ceiling (L27-32).
  blighted_spire: {
    id: 'blighted_spire',
    name: 'The Blighted Spire',
    width: 2400,
    height: 2000,
    spawn: { x: 160, y: 1000 },
    playerCap: 12,
    portals: [
      {
        rect: { x: 0, y: 850, w: 50, h: 300 },
        toArea: 'sundered_wastes',
        toSpawn: { x: 2280, y: 1000 },
        label: '← Back to the Wastes',
      },
      {
        rect: { x: 2350, y: 1700, w: 50, h: 300 },
        toArea: 'abyssal_throne',
        toSpawn: { x: 750, y: 220 },
        label: '↓ The Abyssal Throne',
      },
    ],
  },

  // The far corner of the world: the hardest dungeon in the game, beneath the Blighted Spire.
  // Tuned for the level-30+ endgame — the Sovereign at its heart is the apex fight.
  abyssal_throne: {
    id: 'abyssal_throne',
    name: 'The Abyssal Throne',
    width: 1500,
    height: 1300,
    spawn: { x: 750, y: 220 },
    playerCap: 4,
    portals: [
      {
        rect: { x: 600, y: 0, w: 300, h: 50 },
        toArea: 'blighted_spire',
        toSpawn: { x: 2280, y: 1850 },
        label: '↑ Flee the Throne',
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

  // --- Dungeon themes: dark, indoor, oppressive ---
  rift: {
    groundBase: '#1a1426',
    groundSpeck: '#2c2140',
    prop: 'crystal',
    propDensity: 0.08,
    atmoColor: '#1a0b2e',
    atmoAlpha: 0.4,
    outdoor: false,
    particleColor: '#b08aff',
    particleCount: 60,
    particleRise: 16,
    particleFlicker: true,
    weather: 'fog',
    weatherIntensity: 0.35,
    fogColor: '#120a1c',
    lightAmbient: 0.45,
    gradeSaturation: 0.85,
    gradeBrightness: 0.92,
    gradeContrast: 1.12,
    spriteTint: '#cdb8e8',
  },
  forgotten_catacombs: {
    groundBase: '#241f29',
    groundSpeck: '#332b3a',
    prop: 'grave',
    propDensity: 0.1,
    atmoColor: '#160c1e',
    atmoAlpha: 0.36,
    outdoor: false,
    particleColor: '#8c93a8',
    particleCount: 44,
    particleRise: 12,
    particleFlicker: false,
    weather: 'fog',
    weatherIntensity: 0.4,
    fogColor: '#0c0a12',
    lightAmbient: 0.4,
    gradeSaturation: 0.7,
    gradeBrightness: 0.9,
    gradeContrast: 1.1,
    spriteTint: '#c2b8d6',
  },
  writhing_hive: {
    groundBase: '#1d241a',
    groundSpeck: '#2e3a22',
    prop: 'mushroom',
    propDensity: 0.14,
    atmoColor: '#16240e',
    atmoAlpha: 0.32,
    outdoor: false,
    particleColor: '#9fd86a',
    particleCount: 56,
    particleRise: -3,
    particleFlicker: true,
    weather: 'fog',
    weatherIntensity: 0.45,
    fogColor: '#0a120a',
    lightAmbient: 0.48,
    gradeSaturation: 0.95,
    gradeBrightness: 0.88,
    gradeContrast: 1.08,
    spriteTint: '#cfe6b8',
  },
  infernal_forge: {
    groundBase: '#1f1410',
    groundSpeck: '#3a1d0e',
    prop: 'crystal',
    propDensity: 0.1,
    atmoColor: '#2a0c06',
    atmoAlpha: 0.32,
    outdoor: false,
    particleColor: '#ff8a3a',
    particleCount: 64,
    particleRise: -14,
    particleFlicker: true,
    weather: 'none',
    weatherIntensity: 0.5,
    fogColor: '#0e0604',
    lightAmbient: 0.42,
    gradeSaturation: 1.15,
    gradeBrightness: 0.95,
    gradeContrast: 1.12,
    spriteTint: '#ffceb0',
  },
  frozen_vault: {
    groundBase: '#1a2230',
    groundSpeck: '#28344a',
    prop: 'pillar',
    propDensity: 0.1,
    atmoColor: '#0c1828',
    atmoAlpha: 0.3,
    outdoor: false,
    particleColor: '#cfe6ff',
    particleCount: 60,
    particleRise: 4,
    particleFlicker: false,
    weather: 'snow',
    weatherIntensity: 0.6,
    fogColor: '#080c14',
    lightAmbient: 0.5,
    gradeSaturation: 0.85,
    gradeBrightness: 0.95,
    gradeContrast: 1.1,
    spriteTint: '#cfe0ff',
  },
  // Damp underground cave: brown-grey wet rock, near-dark, dripping fog, faint mineral motes.
  hollowroot: {
    groundBase: '#241c16',
    groundSpeck: '#322519',
    prop: 'crystal',
    propDensity: 0.12,
    atmoColor: '#1a120a',
    atmoAlpha: 0.34,
    outdoor: false,
    particleColor: '#9a8c70',
    particleCount: 46,
    particleRise: 16,
    particleFlicker: false,
    weather: 'fog',
    weatherIntensity: 0.45,
    fogColor: '#120c08',
    lightAmbient: 0.42,
    gradeSaturation: 0.82,
    gradeBrightness: 0.9,
    gradeContrast: 1.1,
    spriteTint: '#d8c8a8',
  },
  // Blight-choked citadel: black-green stone, drifting spores, an oppressive ruined grandeur.
  blighted_spire: {
    groundBase: '#1a221a',
    groundSpeck: '#283326',
    prop: 'pillar',
    propDensity: 0.12,
    atmoColor: '#14260e',
    atmoAlpha: 0.32,
    outdoor: false,
    particleColor: '#aef07a',
    particleCount: 60,
    particleRise: -6,
    particleFlicker: true,
    weather: 'fog',
    weatherIntensity: 0.5,
    fogColor: '#0a120a',
    lightAmbient: 0.5,
    gradeSaturation: 0.95,
    gradeBrightness: 0.9,
    gradeContrast: 1.12,
    spriteTint: '#cfe6b8',
  },
  // Frontier mountain village: dark timber under snow-dusted blue-grey ground, light snowfall,
  // and warm hearth-sparks drifting up — cold outside, welcoming around the fires.
  duskhaven: {
    groundBase: '#262d38',
    groundSpeck: '#3a4452',
    prop: 'rock',
    propDensity: 0.04,
    atmoColor: '#9db4d6',
    atmoAlpha: 0.12,
    outdoor: true,
    particleColor: '#ffd9a0',
    particleCount: 30,
    particleRise: -10,
    particleFlicker: true,
    weather: 'snow',
    weatherIntensity: 0.35,
    fogColor: '#cdd8e6',
    lightAmbient: 0.8,
    gradeSaturation: 0.88,
    gradeBrightness: 1,
    gradeContrast: 1.05,
    spriteTint: '#e6edf8',
  },
  // The Abyssal Throne: the darkest place in the game — near-black stone under a violet-red
  // haze, heavy fog, embers raining down, and barely any light. Abandon hope.
  abyssal_throne: {
    groundBase: '#0d0a10',
    groundSpeck: '#1c1018',
    prop: 'pillar',
    propDensity: 0.1,
    atmoColor: '#2e0a1a',
    atmoAlpha: 0.42,
    outdoor: false,
    particleColor: '#ff5a3a',
    particleCount: 72,
    particleRise: -16,
    particleFlicker: true,
    weather: 'fog',
    weatherIntensity: 0.55,
    fogColor: '#0a0508',
    lightAmbient: 0.3,
    gradeSaturation: 0.85,
    gradeBrightness: 0.85,
    gradeContrast: 1.2,
    spriteTint: '#d8b0c0',
  },
  // Void-scarred highland: bruised violet ground, drifting void-motes, a wrongness in the air.
  sundered_wastes: {
    groundBase: '#211a26',
    groundSpeck: '#2e2236',
    prop: 'crystal',
    propDensity: 0.08,
    atmoColor: '#2a0e2e',
    atmoAlpha: 0.26,
    outdoor: true,
    particleColor: '#c08adf',
    particleCount: 58,
    particleRise: -8,
    particleFlicker: true,
    weather: 'none',
    weatherIntensity: 0.5,
    fogColor: '#140a1a',
    lightAmbient: 0.6,
    gradeSaturation: 1.05,
    gradeBrightness: 0.92,
    gradeContrast: 1.12,
    spriteTint: '#d8c4e8',
  },
};

/**
 * Procedural dungeon population. The presence of an entry here marks an area as a dungeon: the World
 * rolls a random pack from `pool` (each spawn an equal pick) at random positions, with `eliteChance`
 * per mob (higher than the overworld), then spawns `boss` once and, with `miniBossChance`, `miniBoss`.
 */
export interface DungeonDef {
  /** Regular monster template ids; each spawn is an equal random pick. */
  pool: string[];
  /** The end-boss template id, spawned exactly once. */
  boss: string;
  /** An optional extra champion that may also appear (a tanky bonus encounter). */
  miniBoss?: string;
  miniBossChance: number;
  /** Per-mob elite ("champion") chance inside the dungeon — dialled up from the overworld ~0.09. */
  eliteChance: number;
  /** Inclusive range for how many regular monsters fill the dungeon. */
  minMobs: number;
  maxMobs: number;
}

export const DUNGEONS: Record<string, DungeonDef> = {
  forgotten_catacombs: {
    pool: [
      'rot_ghoul',
      'carrion_swarm',
      'thornling_archer',
      'tusk_runner',
      'skeleton',
      'plague_hound',
      'grave_golem',
    ],
    boss: 'maggath',
    miniBoss: 'abyssal_warden',
    miniBossChance: 0.4,
    eliteChance: 0.2,
    minMobs: 14,
    maxMobs: 20,
  },
  writhing_hive: {
    pool: [
      'plague_hound',
      'grave_golem',
      'bile_ooze',
      'shardspine_hurler',
      'gravetide_revenant',
      'marsh_leech',
    ],
    boss: 'vorraxia',
    miniBoss: 'abyssal_warden',
    miniBossChance: 0.45,
    eliteChance: 0.24,
    minMobs: 16,
    maxMobs: 22,
  },
  infernal_forge: {
    pool: [
      'bile_ooze',
      'shardspine_hurler',
      'gravetide_revenant',
      'cinder_imp',
      'magma_crawler',
      'wraithfrost_stalker',
    ],
    boss: 'balthuzar',
    miniBoss: 'molten_colossus',
    miniBossChance: 0.5,
    eliteChance: 0.28,
    minMobs: 16,
    maxMobs: 24,
  },
  frozen_vault: {
    pool: [
      'wraithfrost_stalker',
      'hollow_runeseer',
      'obsidian_juggernaut',
      'gravetide_revenant',
      'rime_archer',
    ],
    boss: 'kaldris',
    miniBoss: 'voidmaw_devourer',
    miniBossChance: 0.5,
    eliteChance: 0.32,
    minMobs: 18,
    maxMobs: 26,
  },
  // The caves: an early branch off Gloomwood — cave-dwellers and burrowers, a molten depths boss.
  hollowroot: {
    pool: ['tusk_runner', 'plague_hound', 'grave_golem', 'magma_crawler', 'shardspine_hurler'],
    boss: 'balthuzar',
    miniBoss: 'abyssal_warden',
    miniBossChance: 0.4,
    eliteChance: 0.22,
    minMobs: 15,
    maxMobs: 22,
  },
  // The endgame rift: a chaotic cross-act roster. The chosen tier scales every spawn's level,
  // HP, damage, density, and elite chance on top of these base numbers (see World difficulty).
  rift: {
    pool: [
      'rot_ghoul',
      'thornling_archer',
      'plague_hound',
      'grave_golem',
      'bile_ooze',
      'shardspine_hurler',
      'gravetide_revenant',
      'cinder_imp',
      'magma_crawler',
      'wraithfrost_stalker',
      'hollow_runeseer',
      'obsidian_juggernaut',
      'rime_archer',
      // The 32rogues-roster expansion (mid/late-band picks; early fodder stays out).
      'gloomcap_myconid',
      'basalt_basilisk',
      'gnarlfang_lycan',
      'crag_manticore',
      'riftwing_harpy',
      'voidscale_drake',
      'blightgore_minotaur',
    ],
    boss: 'voidmaw_devourer',
    miniBoss: 'abyssal_warden',
    miniBossChance: 0.5,
    eliteChance: 0.25,
    minMobs: 18,
    maxMobs: 26,
  },
  // The endgame dungeon beneath the Blighted Spire: the new Throne floor mobs plus the
  // nastiest late-act monsters, the densest population, the highest elite chance, and the
  // apex boss of the game on the throne itself.
  abyssal_throne: {
    pool: [
      'abyss_thrall',
      'duskfire_hexer',
      'thronespawn_ravager',
      'blight_knight',
      'pyre_caster',
      'blightgore_minotaur',
      'obsidian_juggernaut',
      'voidscale_drake',
      'throne_magus',
    ],
    boss: 'nyxathor',
    miniBoss: 'throne_sentinel',
    miniBossChance: 0.55,
    eliteChance: 0.4,
    minMobs: 20,
    maxMobs: 28,
  },
};

/** True if the area id is a procedural dungeon (populated from DUNGEONS rather than fixed spawns). */
export function isDungeon(areaId: string): boolean {
  return areaId in DUNGEONS;
}

export function areaOf(id: string): AreaDef | undefined {
  return AREAS[id];
}

export function pointInRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
