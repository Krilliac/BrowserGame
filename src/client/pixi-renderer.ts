import {
  Assets,
  ColorMatrixFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  TilingSprite,
  type Application,
  type ColorSource,
  type Filter,
  type TextureSource,
} from 'pixi.js';
import { MOB_RADIUS, PLAYER_RADIUS } from '../shared/combat.js';
import { RARITY, type Rarity } from '../shared/items.js';
import { lootGlint } from './loot-glint.js';
import type { EntityState } from '../shared/protocol.js';
import type { DecorProp } from '../shared/areas.js';
import { BOULDER_BASE_RADIUS } from '../shared/collision.js';
import type { TimedFx } from './draw.js';
import type { ClientContentStore } from './content-store.js';
import { Atmosphere } from './atmosphere.js';
import { Weather } from './weather.js';
import { CloudShadows } from './clouds.js';
import { Lighting, type LightSource } from './lighting.js';
import { PostFx, type Quality } from './post-fx.js';
import { Decals } from './decals.js';
import { ParticleSystem } from './particles.js';
import { palisadeStakes, playerHiddenBehind } from './prop-sort.js';
import {
  DeferredLighting,
  cullLights,
  packLights,
  pointToGpuLight,
  sunGpuLight,
  type GpuLight,
} from './deferred-lighting.js';
import { ScreenFx } from './screen-fx.js';
import { Water, isOverWater, waterPondsFor } from './water.js';
import { Terrain, areaHasTerrain, terrainHeightAt } from './terrain.js';
import { DEFAULT_THEME, type AreaTheme, type PropKind } from '../shared/theme.js';
import {
  newAnimView,
  resolveAnim,
  triggerOneShot,
  type AnimState,
  type AnimView,
  type ClipSet,
} from './animation-controller.js';
import {
  ANIMALS_SHEET,
  MONSTERS_SHEET,
  ROGUES_SHEET,
  mobSpriteCell,
  npcSpriteCell,
} from './rogues-sprites.js';
import {
  GROUND_TILESETS,
  groundTilesetFor,
  patchCoverage,
  patchTileFor,
  pathCoverage,
  pathTileFor,
  pickTile,
  PATTERN_TILES,
} from './ground-tiles.js';
import { DECOR_SPRITES, decorSprite } from './decor-sprites.js';
import { projectileStrip, type ProjStrip } from './projectile-fx.js';
import {
  MOB_ARCHETYPES,
  MOB_CLIPS,
  MOB_DIR,
  MOB_FH,
  MOB_FRAMES,
  MOB_FW,
  mobArchetype,
  mobSheetKey,
  mobStripSrc,
  type MobState,
} from './mob-sprites.js';
import { combineTints } from './tint.js';
import { backOut, cubicOut } from './easing.js';
import { shadowLift } from './shadow-lift.js';

/**
 * PixiJS renderer: a tilted top-down (RuneScape-pitch) 2.5D look. World coordinates are a flat
 * plane (x, y); we project to screen with a vertical foreshorten (PITCH). Actors are LPC sprite
 * sheets animated by `facing`; projectiles/items/impacts use sourced sprite strips — all with a
 * procedural fallback. Everything is y-sorted so nearer things overlap farther ones.
 */
// Vertical foreshorten of the world plane. Lower = a more oblique, raked ground (more "3D"/Diablo
// III-like, less straight-down). The whole projection (sprites' feet, shadows, portals) scales by
// this consistently, so the look tilts without misaligning anything.
const PITCH = 0.6;
// RENDER-08 terrain heightmap mesh — OFF by default. It's the only object that renders through
// PixiJS's GlMeshAdaptor, which null-derefs binding the texture sampler on some real GPU drivers
// (BindGroup.setResource → "reading '0'"). Cosmetic only (collision is flat), so it stays off until
// the bind is hardened; the flat tiled ground is used instead. Set true to re-enable for testing.
const TERRAIN_HEIGHTMAP = false;
// Camera dolly: the player sits a little BELOW screen-center so more of the world is visible ahead,
// mimicking a tilted 3D camera (a D2 depth cue). The torch light follows to stay on the player.
const CAM_DOLLY_Y = 0.58;
// Follow camera: the view eases toward the player each frame (a trailing RS/Diablo camera) rather
// than snapping rigidly. exp-based so it's frame-rate independent.
const CAM_FOLLOW_RATE = 9;
// A jump bigger than this (a portal / teleport) snaps the camera instead of sliding across the map.
const CAM_SNAP_DIST = 600;
// Follow deadzone: the camera ignores movement smaller than this (kills swim during in-place
// combat shuffles) and otherwise chases the player to the zone's edge, not its center.
const CAM_DEADZONE = 18;
// Faux-perspective: actors nearer the bottom of the view (closer to the camera) render slightly
// bigger, farther ones slightly smaller — the depth scaling D2/D3 use. Kept subtle + clamped.
const DEPTH_SCALE_K = 0.00035; // per world-unit of y relative to the camera
const DEPTH_SCALE_MIN = 0.9;
const DEPTH_SCALE_MAX = 1.12;
const FX_DURATION = 700;

// Light sources for the lighting overlay: the local player carries a warm torch, and portals glow.
const PLAYER_LIGHT = { radius: 190, color: 0xffd9a0 };
const PORTAL_LIGHT = { radius: 130, color: 0xc9a24b };
// Warm campfire light tint (0xRRGGBB) the bonfire + torches add to the additive bloom layer.
const FIRE_LIGHT = 0xffb25a;

/** Animated decor kinds: small frame-loop sprites (RF Catacombs cutouts) with a flicker light. */
const ANIM_DECOR: Record<string, { srcs: string[]; scale: number; lightRadius: number }> = {
  candle: {
    srcs: [1, 2, 3, 4].map((i) => `/assets/curated/decor/anim/candle-${i}.png`),
    scale: 1.6,
    lightRadius: 55,
  },
  brazier: {
    srcs: [1, 2, 3, 4].map((i) => `/assets/curated/decor/anim/brazier-${i}.png`),
    scale: 2.1,
    lightRadius: 120,
  },
};

/**
 * Warm wood/cloth/iron palette for the town's Rogue-Encampment set-dressing. Used by the decor
 * draw routines (palisade, tents, wagon, anvil, crates…). Colors a prop carries in its `color`
 * field (canvas/wood tints) override the defaults; these are the shared structural hues.
 */
const DECOR_PALETTE = {
  wood: '#6b4a2c',
  woodDark: '#4a3219',
  woodLight: '#84603a',
  rope: '#8a7350',
  canvas: '#cbbfa3', // default tent/wagon canvas if a prop gives no color
  iron: '#3a3a40',
  ironLight: '#5a5a64',
  stone: '#6b665c',
  hay: '#b9952f',
  hayDark: '#8a6c22',
  emberCore: '#fff2c0', // hottest center of a flame
  ember: '#ff8a2a', // mid flame
  emberDeep: '#d4471a', // outer flame
} as const;

// Enterable houses. The roof fades to near-transparent while the local player is inside its
// footprint (expanded by HOUSE_INSIDE_MARGIN so the door threshold counts), eased frame-rate
// independently at HOUSE_ROOF_FADE_RATE.
const HOUSE_ROOF_INSIDE_ALPHA = 0.18;
const HOUSE_ROOF_OUTSIDE_ALPHA = 1;
const HOUSE_ROOF_FADE_RATE = 8; // per second (exp approach)
const HOUSE_INSIDE_MARGIN = 10; // world px the footprint is expanded by for the inside test

// RENDER-06: tall point props (trees, pillars) the local player can hide behind fade toward
// OCCLUDER_FADE_ALPHA while the player stands within the trunk's horizontal margin and behind it
// (north of, or just south of, its base — where the foliage would otherwise swallow the character).
// Eased at HOUSE_ROOF_FADE_RATE, the same frame-rate-independent approach as the roof fade.
const OCCLUDER_PROP_KINDS = new Set<PropKind>(['tree', 'pillar']);

// Solid terrain decor (RENDER-08): drawn as tall 2.5D rock so it reads as real height, and fed to
// the shared collision blockers (see shared/collision.ts blockersForDecor). `cliff`/`ridge` are
// rectangular rock FACES; `mountain`/`boulder`/`peak` are rounded rock. `barrier`/`wall` are
// invisible collision-only (chokepoint authoring). All occlude the local player when he's behind.
const TERRAIN_KINDS = new Set(['cliff', 'ridge', 'barrier', 'wall', 'mountain', 'boulder', 'peak']);
const TERRAIN_INVISIBLE = new Set(['barrier', 'wall']); // collision-only, no visual
/** Linear-blend two '#rrggbb' colors (t=0 → a, t=1 → b) into a single '#rrggbb'. */
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(((pa >> 16) & 0xff) * (1 - k) + ((pb >> 16) & 0xff) * k);
  const g = Math.round(((pa >> 8) & 0xff) * (1 - k) + ((pb >> 8) & 0xff) * k);
  const bl = Math.round((pa & 0xff) * (1 - k) + (pb & 0xff) * k);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}
const TERRAIN_PALETTE = {
  face: '#403d45', // shadowed vertical rock face (the dark cliff front, Epic-Iso look)
  faceDark: '#2c2a31', // base of the face, in deepest shade
  faceLine: '#4f4b54', // vertical striations catching a little light
  top: '#6d685f', // the lit flat plateau top
  topLight: '#857f74', // sun-struck near edge of the top
  rim: '#9b9486', // bright rocky rim line where top meets the face
  snow: '#d9dde6', // peak cap / brightest highlight
} as const;
const OCCLUDER_FADE_ALPHA = 0.45;
const HOUSE_WALL_HEIGHT = 30; // billboarded wall height (world px)
const HOUSE_DOOR_WIDTH = 46; // gap left in the south wall, centered (world px)
const HOUSE_ROOF_OVERHANG = 10; // roof oversteps the footprint by this on each side (world px)
const HOUSE_ROOF_PEAK = 46; // height of the gable ridge above the wall tops (world px)

const ITEM_COLORS: Record<string, string> = {
  gold: '#f2c14e',
  wolf_pelt: '#9c7a4d',
  bone: '#e8e2d0',
  bat_wing: '#7a5a8a',
  rune_shard: '#5fb0e0',
  healthglobe: '#ff3b4e', // a glowing red life orb (drawn as a pulsing orb, no sheet icon)
};

interface Sheet {
  src: string;
  fw: number;
  fh: number;
  scale: number;
  clips: ClipSet;
}

/**
 * 16-direction adventurer clip set (RENDER-09) — matches the procedurally-generated sheet from
 * `tools/assetgen/sprites` (public/assets/sprites/adventurer16.json). 16 directional rows per clip,
 * ordered clockwise from East (engine `dirIndex`); hurt/death are dirless single rows.
 */
function adventurer16Clips(): ClipSet {
  return {
    dirOrder: ['N', 'W', 'S', 'E'], // unused when dirCount > 4, kept for the type
    dirCount: 16,
    clips: {
      idle: { row0: 0, startCol: 0, frames: 1, perFrameMs: 240, loop: true },
      walk: { row0: 16, startCol: 0, frames: 8, perFrameMs: 110, loop: true },
      attack: { row0: 32, startCol: 0, frames: 6, perFrameMs: 60, loop: false },
      cast: { row0: 48, startCol: 0, frames: 7, perFrameMs: 70, loop: false },
      hurt: { row0: 64, startCol: 0, frames: 4, perFrameMs: 55, loop: false, dirless: true },
      death: { row0: 65, startCol: 0, frames: 6, perFrameMs: 90, loop: false, dirless: true },
    },
  };
}

/**
 * Paper-doll equipment LAYER sheets (generated by `tools/assetgen/sprites`, aligned to the adventurer
 * body frame-for-frame). The renderer overlays these on the LOCAL player's actor, sampling the same
 * (row,col) as the body, gated by which slots the player has equipped. Drawn over the body in the
 * order armor → weapon → helm. Aliased `equip:<piece>` and loaded in loadAssets.
 */
const EQUIP_LAYER_SRCS: Record<string, string> = {
  armor: '/assets/sprites/adventurer16_armor.png',
  weapon: '/assets/sprites/adventurer16_weapon.png',
  helm: '/assets/sprites/adventurer16_helm.png',
};
const EQUIP_LAYER_ORDER = ['armor', 'weapon', 'helm'] as const;

/**
 * 8-direction creature clip set — matches the generated creature sheets from `tools/assetgen/creatures`
 * (skeleton/wolf/bat). idle/walk/attack are directional (8 rows each, clockwise from East via
 * `dirIndex`); hurt/death are dirless single rows. Replaces the licensed LPC mob art.
 */
function creatureClips(): ClipSet {
  return {
    dirOrder: ['N', 'W', 'S', 'E'], // unused when dirCount > 4
    dirCount: 8,
    clips: {
      idle: { row0: 0, startCol: 0, frames: 1, perFrameMs: 260, loop: true },
      walk: { row0: 8, startCol: 0, frames: 6, perFrameMs: 120, loop: true },
      attack: { row0: 16, startCol: 0, frames: 5, perFrameMs: 65, loop: false },
      hurt: { row0: 24, startCol: 0, frames: 3, perFrameMs: 55, loop: false, dirless: true },
      death: { row0: 25, startCol: 0, frames: 4, perFrameMs: 90, loop: false, dirless: true },
    },
  };
}

const SHEETS: Record<string, Sheet> = {
  // The player/NPCs/hirelings use the generated 16-direction adventurer for smooth rotation (RENDER-09).
  hero: {
    src: '/assets/sprites/adventurer16.png',
    fw: 48,
    fh: 48,
    scale: 0.95,
    clips: adventurer16Clips(),
  },
  // Mobs use generated 8-direction creature sheets (our art, replacing the licensed LPC packs).
  skeleton: {
    src: '/assets/sprites/skeleton_gen.png',
    fw: 48,
    fh: 48,
    scale: 0.95,
    clips: creatureClips(),
  },
  wolf: { src: '/assets/sprites/wolf_gen.png', fw: 48, fh: 48, scale: 1.0, clips: creatureClips() },
  bat: { src: '/assets/sprites/bat_gen.png', fw: 48, fh: 48, scale: 1.0, clips: creatureClips() },
  boss: {
    src: '/assets/sprites/skeleton_gen.png',
    fw: 48,
    fh: 48,
    scale: 1.8,
    clips: creatureClips(),
  },
};

/**
 * Original design-system mob roster (the *tail-coverage* tier — see mob-sprites.ts). One virtual
 * 3-row sheet per archetype (idle/walk/attack), its texture composed at load by {@link composeMobSheets}
 * from the three single-facing strips and keyed `mob:<arch>`. These cover the long tail the generated
 * 8/16-direction sheets above don't (demons, golems, vermin, oozes, nagas…) — entities that used to
 * fall back to the licensed 32rogues static cell or a procedural orb. `src` is informational only
 * (the texture is composed, not file-loaded); fw/fh/clips are shared via MOB_CLIPS.
 */
const MOB_SHEETS: Record<string, Sheet> = Object.fromEntries(
  Object.entries(MOB_ARCHETYPES).map(([arch, a]) => [
    mobSheetKey(arch),
    {
      src: `${MOB_DIR}/${arch}_idle.png`,
      fw: MOB_FW,
      fh: MOB_FH,
      scale: a.scale,
      clips: MOB_CLIPS,
    },
  ]),
);

/**
 * Generated combat FX strips (ASSET-FX, `tools/assetgen/fx`) — one-shot animated effects played from
 * `state.fx` events. These are our own procedurally-generated art (no pack licensing), replacing the
 * old `explosion-cuzco.png`. Aliased `fxstrip:<key>` and loaded in loadAssets; frames are a horizontal
 * row. `anchor: 'feet'` strips (lightning) plant at the ground, 'center' strips burst over the target.
 */
const FX_STRIPS: Record<
  string,
  {
    src: string;
    fw: number;
    fh: number;
    frames: number;
    perFrameMs: number;
    blend: 'normal' | 'add';
    anchor: 'center' | 'feet';
  }
> = {
  explosion: {
    src: '/assets/fx/explosion.png',
    fw: 64,
    fh: 64,
    frames: 8,
    perFrameMs: 50,
    blend: 'add',
    anchor: 'center',
  },
  frost: {
    src: '/assets/fx/frost.png',
    fw: 64,
    fh: 64,
    frames: 8,
    perFrameMs: 55,
    blend: 'add',
    anchor: 'center',
  },
  lightning: {
    src: '/assets/fx/lightning.png',
    fw: 64,
    fh: 80,
    frames: 6,
    perFrameMs: 45,
    blend: 'add',
    anchor: 'feet',
  },
  holyNova: {
    src: '/assets/fx/holyNova.png',
    fw: 80,
    fh: 80,
    frames: 8,
    perFrameMs: 55,
    blend: 'add',
    anchor: 'center',
  },
  poison: {
    src: '/assets/fx/poison.png',
    fw: 64,
    fh: 64,
    frames: 8,
    perFrameMs: 70,
    blend: 'normal',
    anchor: 'center',
  },
  slash: {
    src: '/assets/fx/slash.png',
    fw: 64,
    fh: 64,
    frames: 5,
    perFrameMs: 40,
    blend: 'add',
    anchor: 'center',
  },
};

/** Misc single/strip textures (spell FX + item icons). */
const MISC: Record<string, string> = {
  fx_fireball: '/assets/ui/fx/spell_fireball.png', // 96x16 -> 6 frames
  fx_firebomb: '/assets/ui/fx/spell_firebomb.png', // 96x16 -> 6 frames
  fx_frost: '/assets/ui/fx/spell_ice_lance.png', // 64x16 -> 4 frames
  fx_water: '/assets/ui/fx/spell_water_bolt.png', // 96x16 -> 6 frames
  fx_arcane: '/assets/ui/fx/spell_arcane_bolt.png', // 96x16 -> 6 frames
  fx_rock: '/assets/ui/fx/spell_rock_sling.png', // 16x16 -> 1 frame
  item_gold: '/assets/ui/items/coin_gold.png', // 32x32 — a few coins
  item_gold_stack: '/assets/ui/items/coin_gold_stack.png', // a small stack
  item_gold_pile: '/assets/ui/items/coin_pile_large.png', // a big pile
  item_gem: '/assets/ui/items/gem_crystal_shard.png', // 32x32 (rune shard)
  gem_ruby: '/assets/ui/items/gem_ruby.png',
  gem_sapphire: '/assets/ui/items/gem_sapphire.png',
  gem_topaz: '/assets/ui/items/gem_amethyst.png', // amethyst icon stands in for topaz
  gem_diamond: '/assets/ui/items/gem_diamond.png',
};
/** Each animated spell strip (projectile-fx.ts) → its loaded MISC alias + frame count (16px frames). */
const PROJ_STRIP_DEFS: Record<ProjStrip, { alias: string; frames: number }> = {
  fireball: { alias: 'fx_fireball', frames: 6 },
  firebomb: { alias: 'fx_firebomb', frames: 6 },
  frost: { alias: 'fx_frost', frames: 4 },
  water: { alias: 'fx_water', frames: 6 },
  arcane: { alias: 'fx_arcane', frames: 6 },
  rock: { alias: 'fx_rock', frames: 1 },
};

// Screen-shake decay rate (per second, exponential) and the kick a death impact gives.
const SHAKE_DECAY = 9;
const SHAKE_ON_DEATH = 7;
// Area-change fade-from-black duration (seconds).
const FADE_SECONDS = 0.45;
// Projectiles fly above the ground plane; their shadow stays on it for a 3D read.
const PROJECTILE_HEIGHT = 18;

const FLASH_MS = 150;
const TINT_FLASH = 0xff5555;
const TINT_BURN = 0xffaa55;
const TINT_SLOW = 0x88bbff;
const TINT_WEAKEN = 0xb088c0; // sickly violet — a cursed/weakened monster
const TINT_ENRAGE = 0xff7b5a; // hot orange-red — a self-buffed (enraged/hasted) monster

/** Parse a CSS `#rrggbb` hex color to a 0xRRGGBB number for the additive light layer (which takes
 * numeric colors); falls back to a cool blue if the string isn't a 6-digit hex. */
function hexToNum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? parseInt(m[1]!, 16) : 0x7fd0ff;
}

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 1000) / 1000;
}

// Names whose monsters fly — rendered elevated above a planted ground shadow (a 3D height cue).
const FLYER_RE = /Bat|Sprite|Shade|Wraith|Spectre|Ghost/;
// Big humanoid/undead bosses get the imposing 1.6× boss sprite.
const BOSS_NAME_RE = /Lord|King|Warden|Bonecaller|Tyrant|Unmaker|Eternal|Knight|Reaver/;

/**
 * Pick a sprite sheet for an entity by archetype (the LPC sheets are reused across thematically
 * similar monsters): humanoid/undead → skeleton, canine/beast → wolf, flyer → bat, big named undead
 * → boss. Monsters with no good match (oozes, golems, imps, colossi, demons) fall back to procedural
 * shapes, which suit their amorphous forms better than a mismatched sprite.
 */
function sheetKey(e: EntityState): string | undefined {
  if (e.kind === 'player' || e.kind === 'npc') return 'hero';
  // A hireling is a friendly humanoid: the Guard reads as an armored skeleton-sheet figure would
  // be wrong — use the hero sheet so it visually belongs to the player's side of the fight.
  if (e.kind === 'hireling') return 'hero';
  if (e.kind !== 'mob') return undefined;
  const n = e.name;
  if (e.maxHp >= 280 && BOSS_NAME_RE.test(n)) return 'boss';
  if (/Wolf|Hound|Boar/.test(n)) return 'wolf';
  if (
    /Skeleton|Cultist|Revenant|Knight|Warlock|Acolyte|Warden|Runeseer|Seer|Bonecaller|Lord|Pilgrim/.test(
      n,
    )
  )
    return 'skeleton';
  if (FLYER_RE.test(n)) return 'bat';
  // Tail coverage: the original Gloomwood roster for everything the generated sheets above don't
  // handle (demons, golems, vermin, oozes, nagas…). Composed at load into MOB_SHEETS.
  const arch = mobArchetype(n);
  if (arch) return mobSheetKey(arch);
  return undefined;
}

/** Elevation (px) a flying monster floats above the ground, separating it from its planted shadow. */
function flyHeight(e: EntityState): number {
  if (e.kind !== 'mob') return 0;
  if (FLYER_RE.test(e.name)) return 16;
  // Curated flyers (banshee, imp) aren't in FLYER_RE but hover via their archetype's `flying` flag.
  const arch = mobArchetype(e.name);
  return arch && MOB_ARCHETYPES[arch]?.flying ? 12 : 0;
}

/** Load one image, rejecting on error (used to compose the curated mob strip sheets). Browser-only. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${src}`));
    img.src = src;
  });
}

export interface RenderState {
  areaId: string;
  entities: EntityState[];
  selfId: number;
  fx: TimedFx[];
  camX: number;
  camY: number;
  /** Area corruption 0..1 — darkens the scene with a creeping crimson pall. */
  corruption?: number;
  /** The mob the player has selected (click-to-target) — draws a bright ground-ring under it. */
  targetId?: number | null;
}

interface ActorView {
  container: Container;
  sprite?: Sprite;
  orb?: Graphics;
  dyn?: Graphics;
  /** Soft, directional ground shadow (leans away from a fixed sun — the D2 "planted" cue). */
  shadow?: Sprite;
  /** Planted (grounded) metrics of the ground shadow — its base scale, offset + alpha captured at
   *  build time. The per-frame cues (`liftShadow`) multiply from this baseline: the height-reactive
   *  shrink/fade as the caster rises off the ground, and the time-of-day sun stretch/fade. `ox`/`oy`
   *  is the shadow's planted offset from the feet, lengthened with the shadow toward dusk. */
  shadowPlanted?: {
    node: Container;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    alpha: number;
  };
  /** Important actors (hero/elite): a sheared, darkened sprite-copy cast shadow (RENDER-07). It
   *  shares the body's current frame texture, so it always matches the pose (updated on frame change). */
  castShadow?: Sprite;
  /** Local player only: paper-doll equipment overlay sprites (piece → Sprite), synced to the body
   *  frame and shown/hidden by the equipped look (ASSET — equippables on characters). */
  equipLayers?: Record<string, Sprite>;
  sheet?: Sheet;
  /** The sprite-sheet alias (for setting the corpse frame after the entity leaves the snapshot). */
  spriteKey?: string;
  /** Per-actor animation state machine (idle/walk/attack/cast/hurt/death). Absent on proj/item views. */
  anim?: AnimView;
  /** Set when a death one-shot is playing: keep the corpse pose until this time, then sweep it. */
  dyingUntil?: number;
  /** Item views only: spawn time, for a brief loot-pop arc when the drop appears. */
  spawnT?: number;
  /** Chest views only: the closed-body group, the open-body group, and the per-frame closed glint. */
  closedG?: Container;
  openG?: Container;
  glintG?: Graphics;
  /** Chest views only: the last `opened` state we rendered, so we only toggle on a change. */
  chestOpened?: boolean;
  /** Chest views only: a per-chest phase seed so a row of chests doesn't sparkle in lockstep. */
  seed?: number;
  topY: number;
  lastX: number;
  lastY: number;
  lastHp: number;
  flashUntil: number;
  seen: boolean;
}

/** How long a slain actor's corpse pose lingers before its view is swept. */
const DEATH_HOLD_MS = 900;
/** Loot-pop: a brief hop when a dropped item first appears (the orb/icon, not its shadow). */
const LOOT_POP_MS = 420;
const LOOT_POP_HEIGHT = 14;

// A fixed "sun" direction (light from the upper-left) so every actor's shadow leans the same way —
// the consistent baked-light look of Diablo 2. Offsets are fractions of the actor's foot radius.
const SHADOW_OFFSET_X = 0.42; // shadow slides toward lower-right (away from the sun)
const SHADOW_OFFSET_Y = 0.18;
const SHADOW_SKEW = -0.55; // slants the ellipse so it reads as cast across the ground
const SHADOW_ALPHA = 0.42;
const CAST_SHADOW_ALPHA = 0.4; // sheared sprite-copy cast shadow (hero/elites), at the noon sun
const CONTACT_AO_ALPHA = 0.3; // tight planted ambient-occlusion core directly under the feet

export class PixiRenderer {
  private readonly ground: TilingSprite;
  private readonly world = new Container();
  private readonly propLayer = new Container();
  private readonly actorLayer = new Container();
  private readonly fxLayer = new Container();
  // Roofs of enterable houses live ABOVE the actor layer so a building occludes the character by
  // default; each roof's alpha eases toward near-transparent while the local player is inside (see
  // `houses` + the per-frame fade in update), revealing the player within — the D2/RuneScape look.
  private readonly roofLayer = new Container();
  private readonly atmosphere = new Atmosphere();
  private readonly weather = new Weather();
  private readonly lighting = new Lighting();
  // One render-quality split for every cosmetic system: phones (touch) get the cheap 'low' paths.
  private readonly quality: Quality = navigator.maxTouchPoints > 0 ? 'low' : 'high';
  // Bloom on the additive light overlay (torch, portals, spell glow). Quality-gated for phones.
  private readonly postFx = new PostFx(this.quality);
  // Drifting cloud shadows over the ground (outdoor + daylight only; off on touch). World-anchored.
  private readonly clouds = new CloudShadows(this.quality, PITCH);
  // Ground decals (blood/scorch/corpse stains) — world-space, above ground, below props/actors.
  private readonly decals = new Decals(this.quality);
  // Water ponds (RENDER-11): a stage-level, world-anchored layer above the ground, below the world.
  private readonly water = new Water(this.quality);
  // Decorative terrain elevation (RENDER-08): a world-anchored heightmapped ground mesh for wild areas.
  private readonly terrain = new Terrain();
  // General particle bursts (sparks, blood spray, dust, embers) in the world-space fxLayer.
  private readonly particles = new ParticleSystem(this.quality);
  // Per-pixel dynamic lighting (RENDER-01): derives normals from the albedo and rakes light across
  // surface relief. Enabled on 'high' quality (off on touch). The additive halos still draw on top.
  private readonly deferred = new DeferredLighting();
  // Screen-space sprite that shows the deferred-lit result in place of the world when the pass runs.
  private readonly litSprite = new Sprite();
  // Per-area screen polish filters: godrays / heat-haze / LUT grade (RENDER-10/12/13). Default-off.
  private readonly screenFx = new ScreenFx(this.quality);
  private readonly grade = new ColorMatrixFilter(); // per-area color grading (one pass on the world)
  private readonly fade = new Graphics();
  private readonly fxGfx = new Graphics();
  private readonly fxTexts: Text[] = [];
  private readonly explosionPool: Sprite[] = [];
  private readonly views = new Map<number, ActorView>();
  /** The currently click-selected mob id (for the target ground-ring); set each update(). */
  private targetId: number | null = null;
  private currentArea = '';
  private currentTheme: AreaTheme = DEFAULT_THEME;
  // World-space portal waymarks: glow-light anchors + the hover-tooltip labels.
  private portalCenters: { x: number; y: number; label: string }[] = [];
  // World-space warm lights cast by the camp's bonfire + torches. Built once per area entry, then
  // projected to screen each frame like the portal lights so they bloom on the additive overlay at
  // night. `flicker` lights re-jitter their radius per frame from the animation clock (live fire).
  private decorLights: { x: number; y: number; radius: number; color: number; flicker: boolean }[] =
    [];
  // Cached fire flames (bonfire/torch). Their flame Graphics is redrawn each frame from the shared
  // animation clock so the camp visibly flickers — without rebuilding the whole decor container.
  private fireFlames: { gfx: Graphics; scale: number; seed: number }[] = [];
  // Animated decor sprites (candles/braziers): frame-looped each render off the shared clock.
  private animatedProps: { sprite: Sprite; srcs: string[]; phaseMs: number }[] = [];
  // Cached shrine orbs (the floating glowing gem atop each shrine pedestal). Like fireFlames, each
  // orb's Graphics is redrawn every frame from the animation clock so it bobs + pulses without
  // rebuilding the decor container. Built once per area entry in drawShrine.
  private shrineOrbs: { gfx: Graphics; color: string; seed: number }[] = [];
  // Enterable houses: each roof Graphics (in roofLayer) plus the building's world-space footprint
  // (NW + SE corners). Built once per area entry; only the roof's alpha updates each frame, easing
  // toward HOUSE_ROOF_INSIDE_ALPHA when the local player stands within the footprint (+ a margin).
  private houses: { roof: Container; minX: number; minY: number; maxX: number; maxY: number }[] =
    [];
  // RENDER-06: tall point props (trees/pillars) the local player can vanish behind; faded while the
  // player stands behind them so the character is never lost. Rebuilt per area entry.
  private occluders: { container: Container; x: number; y: number }[] = [];
  private effectsEnabled = true; // false hides weather + ambient motes ("reduce effects" setting)
  // Local player's equipped "look" (which paper-doll layers to show), set from net.you.equipment.
  private playerLook: Record<string, boolean> = { armor: false, weapon: false, helm: false };
  private shakeMag = 0; // current screen-shake amplitude (px), decays each frame
  // Time-of-day sun shadow multipliers (length + alpha), refreshed once per frame from the
  // atmosphere's day/night clock and applied to every actor/loot/projectile shadow.
  private frameSun = { stretch: 1, alpha: 1 };
  private lastDeathT0 = 0; // newest death-FX timestamp already turned into a shake
  private lastAnimT0 = 0; // newest FX timestamp already turned into a one-shot animation
  private lastDecalT0 = 0; // newest FX timestamp already turned into decals/particles
  private lastFootstepAt = 0; // throttle for local-player footstep dust
  private lastSelfX = 0; // last local-player world pos, for footstep-dust movement detection
  private lastSelfY = 0;
  private zoom = 1.15; // camera zoom (player-adjustable); >1 = closer, a more intimate D3 framing
  private camX = 0; // last camera world-x (screen center), for screen->world picking
  private camY = 0; // last camera world-y, for per-actor faux-perspective depth scaling
  private fadeAlpha = 0; // area-change fade-from-black, eases 1 -> 0 on arrival
  private lastFrameAt = performance.now();
  private readonly groundTextures = new Map<string, Texture>();
  private readonly tex = new Map<string, Texture>(); // sheets + misc
  private readonly tileImages = new Map<string, HTMLImageElement>(); // ground tilesets, by src
  private readonly frameCache = new Map<string, Texture>();
  private softShadow?: Texture; // shared soft-ellipse shadow, baked on first actor
  private placeholder?: Texture; // magenta/black checkerboard for missing/failed assets
  private heavyGpuFxDisabled = false; // panic-disabled the deferred + terrain meshes after a GPU fault

  constructor(
    private readonly app: Application,
    private readonly content: ClientContentStore,
  ) {
    this.ground = new TilingSprite({ texture: Texture.WHITE, width: 100, height: 100 });
    this.actorLayer.sortableChildren = true;
    this.propLayer.sortableChildren = true;
    this.roofLayer.sortableChildren = true;
    // roofLayer is added LAST so house roofs draw in front of actors (occluding them) until they
    // fade as the local player steps inside through the south door.
    // decals first → above the ground texture but behind every prop and actor (RENDER-02).
    this.world.addChild(
      this.decals.layer,
      this.propLayer,
      this.actorLayer,
      this.fxLayer,
      this.roofLayer,
    );
    this.fxLayer.addChild(this.fxGfx);
    this.fxLayer.addChild(this.particles.layer); // world-space particle bursts (RENDER-03)
    this.fade.eventMode = 'none';
    // Draw order (back→front): ground, world, ambient motes, weather, the screen wash (day/night +
    // mood tint + vignette darkening), then additive LIGHTS on top so torch/portal glow punches
    // through the darkness, and finally the area-change fade covering everything mid-transition.
    this.litSprite.visible = false; // shown only while the deferred pass is active (RENDER-01)
    app.stage.addChild(
      this.ground,
      this.terrain.layer, // heightmapped ground mesh for wild areas, replacing the flat ground (RENDER-08)
      this.water.layer, // world-anchored ponds: above the ground, below the world (RENDER-11)
      this.clouds.layer, // world-anchored drifting cloud shadows: above ground/water, below the world
      this.world,
      this.litSprite,
      this.atmosphere.particleLayer,
      this.weather.layer,
      this.atmosphere.screen,
      this.screenFx.godrayLayer, // additive light shafts over the mood wash (RENDER-10)
      this.lighting.layer,
      this.fade,
    );
  }

  /** Load sprite sheets + FX/item textures. Falls back to procedural shapes on failure. */
  async loadAssets(): Promise<void> {
    // Decor sprites are keyed by their src path (one alias per curated file).
    const decorSrcs = new Set<string>();
    for (const entry of Object.values(DECOR_SPRITES)) {
      for (const d of Array.isArray(entry) ? entry : [entry]) decorSrcs.add(d.src);
    }
    for (const def of Object.values(ANIM_DECOR)) for (const src of def.srcs) decorSrcs.add(src);
    const all = {
      ...Object.fromEntries(Object.entries(SHEETS).map(([a, s]) => [a, s.src])),
      ...Object.fromEntries(Object.entries(FX_STRIPS).map(([k, s]) => [`fxstrip:${k}`, s.src])),
      ...Object.fromEntries(Object.entries(EQUIP_LAYER_SRCS).map(([k, s]) => [`equip:${k}`, s])),
      ...MISC,
      rogues32: ROGUES_SHEET.src,
      monsters32: MONSTERS_SHEET.src,
      animals32: ANIMALS_SHEET.src,
      ...Object.fromEntries([...decorSrcs].map((src) => [src, src])),
    };
    // Load every texture INDEPENDENTLY: a single failed fetch (a dev-server blip, a missing
    // file) must only cost that one sprite its art — never the whole game. A batched
    // Assets.load rejects wholesale, which once orbed every actor over one dropped request.
    // A 404 (or a texture that loads with no GPU resource) falls back to a loud checkerboard
    // placeholder so the alias always resolves to a bindable texture — never a null that crashes.
    await Promise.allSettled(
      Object.entries(all).map(async ([alias, src]) => {
        try {
          const t = (await Assets.load({ alias, src })) as Texture;
          this.tex.set(alias, this.isUsableTexture(t) ? t : this.placeholderTexture());
        } catch {
          this.tex.set(alias, this.placeholderTexture());
        }
      }),
    );
    // The 32px sheets and decor cutouts are pixel art — keep them crisp when scaled.
    for (const alias of ['rogues32', 'monsters32', 'animals32', ...decorSrcs]) {
      const t = this.tex.get(alias);
      if (t) t.source.scaleMode = 'nearest';
    }
    // Compose the original mob roster's per-state strips into virtual 3-row sheets (fail-soft).
    await this.composeMobSheets();
    // Ground tilesets load as plain images: the ground texture is baked on a 2D canvas per area.
    const tileSrcs = new Set(Object.values(GROUND_TILESETS).map((t) => t.src));
    await Promise.all(
      [...tileSrcs].map(
        (src) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => {
              this.tileImages.set(src, img);
              resolve();
            };
            img.onerror = () => resolve(); // missing sheet -> that biome keeps procedural ground
            img.src = src;
          }),
      ),
    );

    // Per-pixel dynamic lighting (RENDER-01) derives normals from the albedo, so it needs no normal
    // art — enable it on desktop ('high'); touch keeps the cheaper additive-halo-only lighting.
    this.deferred.setEnabled(this.quality === 'high' && !this.heavyGpuFxDisabled);
  }

  /**
   * Compose each curated mob archetype's three single-facing strips (idle/walk/attack, 256×64) into
   * one virtual 3-row sheet texture (256×192) keyed `mob:<arch>`, so the original Gloomwood roster
   * plugs straight into the animated-actor pipeline (MOB_SHEETS + MOB_CLIPS via resolveAnim). Drawn
   * with smoothing off so the pixel art stays crisp. Browser-only and fail-soft: a missing or broken
   * strip just leaves that archetype unsheeted, so its mobs keep the procedural / generated fallback.
   */
  private async composeMobSheets(): Promise<void> {
    if (typeof document === 'undefined') return;
    const states: MobState[] = ['idle', 'walk', 'attack'];
    await Promise.all(
      Object.keys(MOB_ARCHETYPES).map(async (arch) => {
        try {
          const imgs = await Promise.all(states.map((st) => loadImage(mobStripSrc(arch, st))));
          const canvas = document.createElement('canvas');
          canvas.width = MOB_FW * MOB_FRAMES; // 4 frames wide
          canvas.height = MOB_FH * states.length; // idle / walk / attack rows
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          ctx.imageSmoothingEnabled = false;
          imgs.forEach((img, row) => ctx.drawImage(img, 0, row * MOB_FH));
          const tex = Texture.from(canvas);
          tex.source.scaleMode = 'nearest';
          this.tex.set(mobSheetKey(arch), tex);
        } catch {
          // strip missing/broken → archetype stays unsheeted; its mobs use the existing fallback
        }
      }),
    );
  }

  /**
   * Panic switch: turn off the OPTIONAL GPU passes — the deferred-lighting composite (a custom-shader
   * Mesh) and the terrain heightmap Mesh — and revert to the safe flat-ground / direct-world render.
   * Called by the main loop's render-fault guard: some drivers null-deref binding these meshes
   * (`BindGroup.setResource`) in a way our headless GPU can't reproduce, so rather than crash every
   * frame we drop the eye-candy and keep the game running. Idempotent.
   */
  disableHeavyGpuFx(): void {
    if (this.heavyGpuFxDisabled) return;
    this.heavyGpuFxDisabled = true;
    this.deferred.setEnabled(false);
    this.litSprite.visible = false;
    this.world.renderable = true;
    this.terrain.clear(); // tear down the heightmap mesh…
    this.ground.visible = true; // …and show the flat tiled ground in its place
  }

  /**
   * Force the next update() to re-run setArea even though the area id is unchanged — used when a
   * fresh content packet arrives (a live theme edit or hot reload) so the world re-skins in place.
   */
  invalidateArea(): void {
    this.currentArea = '';
  }

  /**
   * Invert the tilted projection: turn a screen-space point (e.g. a mouse click) back into a
   * world-plane (x, y). Uses the last camera passed to `update`, so call after a frame has
   * rendered. The inverse of: screenX = sw/2 - camX + worldX, screenY = sh*CAM_DOLLY_Y -
   * camY*PITCH + worldY*PITCH. (Screen shake is transient and ignored.)
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const z = this.zoom;
    return {
      x: this.camX + (screenX - sw / 2) / z,
      y: this.camY + (screenY - sh * CAM_DOLLY_Y) / (PITCH * z),
    };
  }

  /** Live object counts for the dev inspector (cheap reads, no allocation beyond the record). */
  debugCounts(): Record<string, number> {
    return {
      views: this.views.size,
      props: this.propLayer.children.length,
      actors: this.actorLayer.children.length,
      animatedProps: this.animatedProps.length,
      decorLights: this.decorLights.length,
      frameCache: this.frameCache.size,
      textures: this.tex.size,
    };
  }

  /** Zoom range, clamped — keeps the framing sane and click-picking aligned. `extended` widens the
   *  clamp for GM+ inspection (a settings option), normal players stay in the framed range. */
  setZoom(z: number, extended = false): void {
    const min = extended ? 0.4 : 0.75;
    const max = extended ? 3.0 : 1.6;
    this.zoom = Math.max(min, Math.min(max, z));
  }

  /**
   * Decorative vertical lift (screen px) for a world point so props/actors ride elevated terrain
   * (RENDER-08). Returns 0 on flat areas, so every call site is a no-op except in terrain areas —
   * which is why it can be sprinkled across all the world-positioned containers with zero regression.
   */
  private groundLift(x: number, y: number): number {
    return this.terrain.isActive() ? terrainHeightAt(x, y) : 0;
  }
  adjustZoom(delta: number, extended = false): void {
    this.setZoom(this.zoom + delta, extended);
  }
  getZoom(): number {
    return this.zoom;
  }

  /** "Reduce effects" (settings): hide the decorative weather + ambient motes — a phone-perf win.
   *  Lighting and the corruption/day-night wash stay on, so the art direction is preserved. */
  setEffectsEnabled(on: boolean): void {
    this.effectsEnabled = on;
  }

  /**
   * Set the local player's equipped look (which paper-doll layers to show). Called from the client
   * when the `you` packet's equipment changes — head→helm, chest→armor, mainhand→weapon.
   */
  setPlayerLook(look: { helm: boolean; armor: boolean; weapon: boolean }): void {
    this.playerLook = { helm: look.helm, armor: look.armor, weapon: look.weapon };
  }

  setArea(areaId: string): void {
    if (areaId === this.currentArea) return;
    const area = this.content.area(areaId);
    if (!area) return; // content packet not loaded yet — retry next frame
    this.currentArea = areaId;
    const theme = area.theme ?? DEFAULT_THEME;
    this.currentTheme = theme;
    this.atmosphere.setArea(theme);
    this.weather.setWeather(theme.weather, theme.weatherIntensity, theme.fogColor);
    this.clouds.setArea(theme.outdoor); // drifting ground cloud-shadows, outdoor only
    this.screenFx.setArea(areaId, theme.outdoor); // godrays + LUT/heat config (RENDER-10/12/13)
    this.applyGrade(theme);
    this.fadeAlpha = 1; // brief fade-from-black as the new area pops in
    // Real tiled ground where a biome tileset exists; the procedural speckle is the fallback.
    const groundTex =
      this.tiledGroundTexture(areaId, theme.groundBase) ??
      this.groundTexture(theme.groundBase, theme.groundSpeck);
    this.ground.texture = groundTex;
    // RENDER-08: wild areas render a heightmapped ground MESH (rolling hills) in place of the flat
    // tiled ground; the mesh tiles the same texture (one repeat per texture-width of world). Other
    // areas keep the flat TilingSprite. `terrainHeightAt` then also lifts props + actors to match.
    // RENDER-08 heightmap mesh is DISABLED by default. It is the one display object in the scene that
    // renders through PixiJS's GlMeshAdaptor (a Mesh with the default shader), and on some real GPU
    // drivers that path null-derefs binding the texture sampler in BindGroup.setResource
    // ("Cannot read properties of null (reading '0')") — a crash our headless GPU can't reproduce.
    // It is purely cosmetic (collision is flat regardless), so wild areas use the flat tiled ground
    // until the mesh's texture-bind is hardened. Flip TERRAIN_HEIGHTMAP to re-enable for testing.
    if (TERRAIN_HEIGHTMAP && areaHasTerrain(areaId) && !this.heavyGpuFxDisabled) {
      this.terrain.build(area.width, area.height, groundTex, groundTex.width);
      this.ground.visible = false;
    } else {
      this.terrain.clear();
      this.ground.visible = true;
    }

    for (const child of this.propLayer.removeChildren()) child.destroy();
    // Roofs live in their own layer above the actors — clear them too so leaving the area never
    // leaks a previous area's house roofs over the new scene.
    for (const child of this.roofLayer.removeChildren()) child.destroy();
    // Drop any blood/scorch stains and live particles so they don't bleed across a zone change.
    this.decals.clear();
    this.particles.clear();
    // Procedural water ponds for this area (RENDER-11), tinted toward a dark teal pool.
    this.water.setRegions(waterPondsFor(areaId, area.width, area.height), 0x2c5a6e);

    this.portalCenters = [];
    this.decorLights = [];
    this.fireFlames = [];
    this.animatedProps = [];
    this.shrineOrbs = [];
    this.houses = [];
    this.occluders = [];
    for (const portal of area.portals) {
      const cx = portal.rect.x + portal.rect.w / 2;
      const cy = portal.rect.y + portal.rect.h / 2;
      this.portalCenters.push({ x: cx, y: cy, label: portal.label });
      // Crossings are marked by LANDMARKS, not glowing pads: a lantern-lit wooden signpost on
      // the roads, a carved stone waymark at dungeon mouths. The destination shows on hover
      // (portalLabelAt -> the HUD tooltip), not as always-on floating text.
      this.propLayer.addChild(this.makeWaymark(portal.toArea, cx, cy));
    }

    if (theme.prop !== 'none' && theme.propDensity > 0) {
      const prop = theme.prop;
      const cell = 110;
      for (let gx = 0; gx * cell < area.width; gx++) {
        for (let gy = 0; gy * cell < area.height; gy++) {
          if (hash2(gx * 7 + 1, gy * 13 + 3) >= theme.propDensity) continue;
          const px = gx * cell + hash2(gx, gy * 3) * cell;
          const py = gy * cell + hash2(gx * 5, gy) * cell;
          const c = this.makeProp(prop, px, py);
          this.propLayer.addChild(c);
          // Register tall props as occluders so the local player fades them when hidden (RENDER-06).
          if (OCCLUDER_PROP_KINDS.has(prop)) this.occluders.push({ container: c, x: px, y: py });
        }
      }
    }

    // Server-authoritative set-dressing (the `decor` SQL table, delivered on the AreaDef). Built
    // ONCE per area entry into the cached prop layer; only when the area actually has decor.
    if (area.decor && area.decor.length > 0) this.buildDecor(area.decor);
  }

  /**
   * Build the area's server-authoritative set-dressing (the `decor` SQL rows) into the cached prop
   * layer. Each prop becomes a y-sorted, soft-shadowed Container drawn with the same 2.5D projection
   * the actors use, so a player can stand in front of / behind a tent. Bonfire + torch glow lights
   * are recorded in decorLights and projected to screen each frame on the additive light overlay;
   * their flames are cached in fireFlames and re-drawn each frame so the camp flickers. Built ONCE
   * per area entry (in setArea) — never rebuilt per frame.
   */
  private buildDecor(decor: readonly DecorProp[]): void {
    for (const prop of decor) {
      // Solid TERRAIN (cliffs/mountains/boulders) — tall 2.5D rock that also blocks movement. Checked
      // before the line-prop branch because terrain carries a footprint too but is NOT a fence.
      if (TERRAIN_KINDS.has(prop.kind)) {
        const c = this.makeTerrainProp(prop);
        this.propLayer.addChild(c);
        // Occlude the local player when he walks behind a peak/cliff (RENDER-06), like trees.
        if (!TERRAIN_INVISIBLE.has(prop.kind)) {
          const ax = prop.x2 !== undefined ? (prop.x + prop.x2) / 2 : prop.x;
          const ay =
            prop.y2 !== undefined
              ? prop.kind === 'cliff' || prop.kind === 'ridge'
                ? Math.max(prop.y, prop.y2)
                : (prop.y + prop.y2) / 2
              : prop.y;
          this.occluders.push({ container: c, x: ax, y: ay });
        }
        continue;
      }
      // Line props (palisade/fence) are segment-split into per-stake containers so an actor beside
      // the run interleaves stake by stake instead of sorting against the whole wall (RENDER-05).
      if (prop.kind !== 'house' && prop.x2 !== undefined && prop.y2 !== undefined) {
        for (const seg of this.buildLineSegments(prop)) this.propLayer.addChild(seg);
      } else {
        this.propLayer.addChild(this.makeDecorProp(prop));
      }
    }
  }

  /**
   * Build a solid-terrain prop as a tall, y-sorted 2.5D rock Container. Cliffs/ridges are a vertical
   * rock FACE under a lit flat top (the Epic-Isometric plateau look); mountains/boulders/peaks are
   * rounded rock. `barrier`/`wall` are invisible (collision only). The collider that matches each is
   * built on BOTH server and client by shared `blockersForDecor`, so what you see is what blocks you.
   */
  private makeTerrainProp(prop: DecorProp): Container {
    const c = new Container();
    const hasFoot = prop.x2 !== undefined && prop.y2 !== undefined;
    const minX = hasFoot ? Math.min(prop.x, prop.x2!) : prop.x;
    const maxX = hasFoot ? Math.max(prop.x, prop.x2!) : prop.x;
    const minY = hasFoot ? Math.min(prop.y, prop.y2!) : prop.y;
    const maxY = hasFoot ? Math.max(prop.y, prop.y2!) : prop.y;
    const cx = (minX + maxX) / 2;
    const isFace = prop.kind === 'cliff' || prop.kind === 'ridge';
    // Faces anchor + sort by their FRONT (south) edge; round terrain by its base center.
    const anchorY = isFace ? maxY : (minY + maxY) / 2;
    c.position.set(cx, anchorY * PITCH - this.groundLift(cx, anchorY));
    c.zIndex = anchorY;

    if (TERRAIN_INVISIBLE.has(prop.kind)) return c; // collision-only, draw nothing

    if (isFace) {
      this.drawCliff(c, maxX - minX, maxY - minY);
    } else {
      const r = hasFoot
        ? Math.min(maxX - minX, maxY - minY) / 2
        : BOULDER_BASE_RADIUS * (prop.scale ?? 1);
      if (prop.kind === 'boulder') this.drawBoulder(c, r);
      else this.drawMountain(c, r);
    }
    return c;
  }

  /**
   * Draw a cliff/plateau into `c`, anchored at its FRONT (south) edge center. A dark vertical rock
   * face rises `H` up the screen, capped by a lit flat top set back by the footprint depth — so it
   * reads as a solid raised block with real height. `wWorld`/`depthWorld` are the footprint size.
   */
  private drawCliff(c: Container, wWorld: number, depthWorld: number): void {
    const W = wWorld;
    const depth = depthWorld * PITCH; // footprint depth in screen px (foreshortened)
    const H = Math.min(130, 28 + wWorld * 0.42); // rock-face height, proportional to width (not towering)
    const halfW = W / 2;
    const g = new Graphics();

    // Cast shadow: a long soft footprint thrown toward the lower-right (sun upper-left).
    g.ellipse(28, depth * 0.5 + 10, halfW + 24, depth * 0.7 + 18).fill({
      color: '#000000',
      alpha: 0.28,
    });

    // Vertical front rock FACE (south wall) as a top-lit→base-dark GRADIENT (stacked bands), so it
    // reads as a sunlit rock wall receding into shadow rather than a flat panel.
    const bands = 7;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1); // 0 at top, 1 at base
      const y = -H + (H * i) / bands;
      const col = mixHex(TERRAIN_PALETTE.faceLine, TERRAIN_PALETTE.faceDark, t);
      g.rect(-halfW, y, W, H / bands + 1).fill({ color: col });
    }
    // Jagged vertical fractures down the face — a few darker clefts for rocky texture.
    const cols = Math.max(3, Math.round(W / 90));
    for (let i = 1; i < cols; i++) {
      const fx = -halfW + (i / cols) * W + (((i * 37) % 17) - 8);
      g.rect(fx, -H + 8, 3, H - 12).fill({ color: TERRAIN_PALETTE.faceDark, alpha: 0.45 });
      g.rect(fx + 3, -H + 8, 1.5, H - 12).fill({ color: TERRAIN_PALETTE.snow, alpha: 0.12 });
    }

    // Flat plateau TOP (footprint raised by H): lit grey rock, brighter toward the sunlit north edge.
    g.rect(-halfW, -depth - H, W, depth).fill({ color: TERRAIN_PALETTE.top });
    g.rect(-halfW, -depth - H, W, Math.max(8, depth * 0.4)).fill({
      color: TERRAIN_PALETTE.topLight,
      alpha: 0.55,
    });
    // A thin mossy fringe + a bright sun rim along the front lip where the top breaks to the face.
    g.rect(-halfW, -H - 7, W, 5).fill({ color: '#5c6b3a', alpha: 0.5 }); // moss caps the lip
    g.rect(-halfW, -H - 3, W, 3).fill({ color: TERRAIN_PALETTE.rim }); // bright sunlit rim
    c.addChild(g);
  }

  /** Draw a rounded mountain/peak into `c`, anchored at its base center; rises ~1.9× its radius. */
  private drawMountain(c: Container, r: number): void {
    const baseRy = r * PITCH;
    const H = r * 1.35; // peak height (kept modest so a massif doesn't tower over the screen)
    const g = new Graphics();
    g.ellipse(14, baseRy * 0.5, r * 1.04, baseRy).fill({ color: '#000000', alpha: 0.22 }); // shadow
    // Body silhouette: a smoothed peaked massif from the base up to the summit.
    g.poly([
      -r,
      0,
      -r * 0.62,
      -H * 0.42,
      -r * 0.28,
      -H * 0.74,
      0,
      -H,
      r * 0.32,
      -H * 0.72,
      r * 0.66,
      -H * 0.4,
      r,
      0,
    ]).fill({ color: TERRAIN_PALETTE.top });
    // Shaded (right/away-from-sun) flank.
    g.poly([0, -H, r * 0.32, -H * 0.72, r * 0.66, -H * 0.4, r, 0, r * 0.2, 0]).fill({
      color: TERRAIN_PALETTE.face,
      alpha: 0.85,
    });
    // Ridgelines + a bright snow cap near the summit.
    g.moveTo(-r * 0.28, -H * 0.74)
      .lineTo(0, -H)
      .lineTo(r * 0.32, -H * 0.72)
      .stroke({
        width: 2,
        color: TERRAIN_PALETTE.faceDark,
        alpha: 0.5,
      });
    g.poly([0, -H, -r * 0.16, -H * 0.82, r * 0.16, -H * 0.82]).fill({
      color: TERRAIN_PALETTE.snow,
    });
    c.addChild(g);
  }

  /** Draw a rounded boulder into `c`, anchored at its base center; a shaded rock ~1.15× its radius. */
  private drawBoulder(c: Container, r: number): void {
    const baseRy = r * PITCH;
    const H = r * 1.15;
    const g = new Graphics();
    g.ellipse(8, baseRy * 0.4, r * 0.98, baseRy * 0.9).fill({ color: '#000000', alpha: 0.22 });
    g.ellipse(0, -H * 0.45, r, H * 0.62).fill({ color: TERRAIN_PALETTE.top }); // rock body
    g.ellipse(r * 0.28, -H * 0.32, r * 0.66, H * 0.42).fill({
      color: TERRAIN_PALETTE.face,
      alpha: 0.7,
    }); // shaded right
    g.ellipse(-r * 0.32, -H * 0.62, r * 0.34, H * 0.24).fill({
      color: TERRAIN_PALETTE.topLight,
      alpha: 0.8,
    }); // sunlit upper-left
    // A facet crack for a chiseled rock feel.
    g.moveTo(-r * 0.1, -H * 0.7)
      .lineTo(r * 0.12, -H * 0.3)
      .stroke({ width: 1.5, color: TERRAIN_PALETTE.faceDark, alpha: 0.5 });
    c.addChild(g);
  }

  /**
   * Build a line prop (palisade/fence) as one container PER STAKE, each at its own world position
   * with `zIndex = stake.y` — its own ground-row sort key. Because each stake sorts independently
   * against the actor layer, a player walking alongside the run is correctly occluded by the posts
   * north of their feet and occludes the posts to the south (the tall-object sorting fix).
   */
  private buildLineSegments(prop: DecorProp): Container[] {
    const stakes = palisadeStakes(prop.x, prop.y, prop.x2!, prop.y2!);
    const stakeH = 40;
    const w = 5;
    const out: Container[] = [];
    for (const st of stakes) {
      const c = new Container();
      c.position.set(st.x, st.y * PITCH - this.groundLift(st.x, st.y));
      c.zIndex = st.y;
      this.propShadow(c, 6, 3);
      const g = new Graphics();
      // Rope lashing to the next stake, drawn first so this stake's body overlaps it.
      if (!st.isLast) {
        g.moveTo(0, -stakeH * 0.6)
          .lineTo(st.nextDx, st.nextDy * PITCH - stakeH * 0.6)
          .stroke({ width: 2, color: DECOR_PALETTE.rope, alpha: 0.8 });
      }
      // The stake body, a darker shaded side for round logs, then a sharpened point on top.
      g.rect(-w / 2, -stakeH, w, stakeH).fill({ color: DECOR_PALETTE.wood });
      g.rect(-w / 2, -stakeH, 2, stakeH).fill({ color: DECOR_PALETTE.woodDark });
      g.poly([-w / 2, -stakeH, w / 2, -stakeH, 0, -stakeH - 7]).fill({
        color: DECOR_PALETTE.woodLight,
      });
      c.addChild(g);
      out.push(c);
    }
    return out;
  }

  /** Build one decor prop as a y-sorted, shadowed Container at its world position. */
  private makeDecorProp(prop: DecorProp): Container {
    // Houses own a footprint (NW corner = x,y; SE corner = x2,y2): they build their floor + walls
    // into the returned prop container and register a separate roof in the roofLayer. Handled up
    // front because their geometry is footprint-relative, not the point/line anchor below.
    if (prop.kind === 'house' && prop.x2 !== undefined && prop.y2 !== undefined) {
      return this.makeHouse(prop.x, prop.y, prop.x2, prop.y2, prop.color ?? DECOR_PALETTE.wood);
    }

    const c = new Container();
    // Point props anchor at (x,y); line props (palisade/fence) are handled in buildDecor by the
    // segment-split path, so they never reach here. The container's zIndex is the world y of its
    // anchor, so props sort against actors by depth.
    const ax = prop.x;
    const ay = prop.y;
    c.position.set(ax, ay * PITCH - this.groundLift(ax, ay));
    c.zIndex = ay;
    const scale = prop.scale ?? 1;

    // Real decor sprites (curated pack cutouts) where one exists for the kind — the variant is
    // picked deterministically from the prop's position, so a row of graves doesn't repeat. Kinds
    // with no mapping (or a failed texture) keep their procedural draw below. Pots are excluded:
    // they are authoritative ENTITIES (breakable), drawn in the entity path like chests.
    if (prop.kind !== 'pot' && this.addDecorSprite(c, prop.kind, prop.x, prop.y, scale, prop.color))
      return c;

    switch (prop.kind) {
      case 'gate':
        this.drawGate(c, scale);
        break;
      case 'bonfire':
        this.drawBonfire(c, prop.x, prop.y);
        break;
      case 'tent':
        this.drawTent(c, prop.color ?? DECOR_PALETTE.canvas, scale);
        break;
      case 'wagon':
        this.drawWagon(c, prop.color ?? DECOR_PALETTE.wood);
        break;
      case 'anvil':
        this.drawAnvil(c);
        break;
      case 'crate':
        this.drawCrate(c, scale);
        break;
      case 'barrel':
        this.drawBarrel(c);
        break;
      case 'hay':
        this.drawHay(c);
        break;
      case 'torch':
        this.drawTorch(c, prop.x, prop.y);
        break;
      case 'shrine':
        this.drawShrine(c, prop.x, prop.y, prop.color ?? '#7fd0ff');
        break;
      case 'chest':
      case 'pot':
        // Chests + pots are authoritative ENTITIES (live opened/broken state) drawn in the
        // entity path. These decor rows are just the server's placement markers — render nothing
        // here, or each would draw twice (once as decor, once as the entity).
        break;
      case 'candle':
      case 'brazier': {
        // Small animated flame props: a frame-looped sprite + a warm flicker light. The frames
        // advance in updateAnimatedProps off the shared clock, phase-offset per prop so a wall
        // of candles never blinks in lockstep.
        const def = ANIM_DECOR[prop.kind]!;
        const tex0 = this.tex.get(def.srcs[0]!);
        if (tex0) {
          const s = new Sprite(tex0);
          s.anchor.set(0.5, 1);
          s.scale.set(def.scale * scale);
          s.tint = combineTints(this.content.tint(`decor:${prop.kind}`), prop.color);
          c.addChild(s);
          this.animatedProps.push({
            sprite: s,
            srcs: def.srcs,
            phaseMs: hash2(prop.x | 0, prop.y | 0) * 520,
          });
          this.decorLights.push({
            x: ax,
            y: ay - 10,
            radius: def.lightRadius * scale,
            color: FIRE_LIGHT,
            flicker: true,
          });
        } else {
          // Sprite missing: fall back to the procedural torch so the light source still reads.
          this.drawTorch(c, prop.x, prop.y);
        }
        break;
      }
      default:
        // Unknown kind: a low stone marker so bad data fails visibly but harmlessly.
        this.propShadow(c, 10, 5);
        c.addChild(new Graphics().ellipse(0, -6, 10, 8).fill({ color: DECOR_PALETTE.stone }));
        break;
    }
    return c;
  }

  /**
   * Add a curated decor sprite (with foot shadow) for a prop kind into a container, picking a
   * variant deterministically from the world position. Returns false when the kind has no sprite
   * mapping or its texture isn't loaded — the caller keeps its procedural draw.
   */
  private addDecorSprite(
    c: Container,
    kind: string,
    seedX: number,
    seedY: number,
    scale: number,
    rowColor?: string,
  ): boolean {
    const ds = decorSprite(kind, seedX, seedY);
    const dtex = ds ? this.tex.get(ds.src) : undefined;
    if (!ds || !dtex) return false;
    const tex = ds.frame
      ? new Texture({
          source: dtex.source as TextureSource,
          frame: new Rectangle(ds.frame.x, ds.frame.y, ds.frame.w, ds.frame.h),
        })
      : dtex;
    const s = new Sprite(tex);
    s.anchor.set(0.5, ds.anchorY ?? 1);
    s.scale.set(ds.scale * scale);
    // SQL color overrides: a kind-wide 'decor:<kind>' tint × this row's own color column —
    // the same cutout spawns dark/gritty variations without touching the image file.
    s.tint = combineTints(this.content.tint(`decor:${kind}`), rowColor);
    const w = tex.width * ds.scale * scale;
    this.propShadow(c, w * 0.5, w * 0.22);
    c.addChild(s);
    return true;
  }

  /**
   * A portal waymark: a y-sorted landmark at a crossing. Roads get a lantern-lit wooden
   * signpost (two boards, warm steady light); dungeon mouths get a carved stone monolith with
   * an ember at its base. Hovering reveals the destination via portalLabelAt + the HUD tooltip.
   */
  private makeWaymark(toArea: string, cx: number, cy: number): Container {
    const c = new Container();
    c.position.set(cx, cy * PITCH - this.groundLift(cx, cy));
    c.zIndex = cy;
    this.propShadow(c, 14, 6);
    const g = new Graphics();
    if (this.content.isDungeon(toArea)) {
      // A weathered stone waymark: a tapered monolith with a carved down-arrow, ember-lit.
      g.moveTo(-10, 0).lineTo(-7, -46).lineTo(7, -46).lineTo(10, 0).closePath();
      g.fill({ color: '#4a4650' }).stroke({ width: 2, color: '#2e2b34' });
      g.moveTo(0, -38).lineTo(0, -22).stroke({ width: 3, color: '#241f1a' });
      g.moveTo(-5, -28).lineTo(0, -22).lineTo(5, -28).stroke({ width: 3, color: '#241f1a' });
      g.ellipse(0, -2, 6, 3).fill({ color: '#ff8a3a', alpha: 0.8 });
      this.decorLights.push({ x: cx, y: cy - 4, radius: 90, color: 0xff8a3a, flicker: true });
    } else {
      // A wooden signpost: post, two angled boards, and a hung lantern (steady, warm).
      g.rect(-3, -52, 6, 52).fill({ color: '#5a3a22' });
      g.moveTo(-20, -46).lineTo(18, -46).lineTo(24, -42).lineTo(18, -38).lineTo(-20, -38);
      g.closePath().fill({ color: '#7a5232' }).stroke({ width: 1.5, color: '#3e2a16' });
      g.moveTo(20, -32).lineTo(-18, -32).lineTo(-24, -28).lineTo(-18, -24).lineTo(20, -24);
      g.closePath().fill({ color: '#6a4628' }).stroke({ width: 1.5, color: '#3e2a16' });
      g.moveTo(3, -52).lineTo(10, -50).stroke({ width: 2, color: '#3e2a16' });
      g.circle(11, -46, 3.5).fill({ color: '#ffd27a' }).stroke({ width: 1.5, color: '#5a4a2a' });
      this.decorLights.push({
        x: cx + 11,
        y: cy - 46,
        radius: 110,
        color: FIRE_LIGHT,
        flicker: false,
      });
    }
    c.addChild(g);
    return c;
  }

  /** The portal waymark's label under a world point (drives the HUD hover tooltip), if any. */
  portalLabelAt(wx: number, wy: number): string | undefined {
    for (const p of this.portalCenters) {
      if (Math.hypot(wx - p.x, wy - p.y) < 85) return p.label;
    }
    return undefined;
  }

  /** A soft ground shadow at the prop's foot, matching the actors' directional baked-sun look. */
  private propShadow(c: Container, radiusX: number, radiusY: number): void {
    const s = new Sprite(this.softShadowTexture());
    s.anchor.set(0.5, 0.5);
    s.width = radiusX * 2;
    s.height = radiusY * 2;
    s.alpha = SHADOW_ALPHA;
    s.position.set(radiusX * SHADOW_OFFSET_X, radiusY * SHADOW_OFFSET_Y);
    s.skew.x = SHADOW_SKEW;
    c.addChildAt(s, 0);
  }

  /** A camp gate: two heavy posts and a lintel framing an open doorway. Billboarded upward. */
  private drawGate(c: Container, scale: number): void {
    this.propShadow(c, 40 * scale, 12 * scale);
    const g = new Graphics();
    g.scale.set(scale);
    const h = 76;
    // Two posts.
    for (const px of [-34, 30]) {
      g.rect(px, -h, 8, h).fill({ color: DECOR_PALETTE.wood });
      g.rect(px, -h, 3, h).fill({ color: DECOR_PALETTE.woodDark });
      g.poly([px, -h, px + 8, -h, px + 4, -h - 8]).fill({ color: DECOR_PALETTE.woodLight }); // capped point
    }
    // Lintel across the top + a second cross-beam, lashed with rope ties.
    g.rect(-40, -h, 80, 9).fill({ color: DECOR_PALETTE.woodDark });
    g.rect(-40, -h + 2, 80, 3).fill({ color: DECOR_PALETTE.woodLight, alpha: 0.5 });
    g.rect(-34, -h + 18, 68, 5).fill({ color: DECOR_PALETTE.wood });
    for (const px of [-30, 34]) g.circle(px, -h + 6, 2.5).fill({ color: DECOR_PALETTE.rope });
    c.addChild(g);
  }

  /**
   * The big central campfire: a stacked log pile, a stone ring, and animated flames with a warm
   * glow. The flame Graphics is registered in fireFlames so update() redraws it each frame (live
   * flicker); the glow light is registered in decorLights as the camp's brightest, flickering light.
   */
  private drawBonfire(c: Container, wx: number, wy: number): void {
    this.propShadow(c, 30, 15);
    const base = new Graphics();
    // Stone ring at the tilted pitch.
    base.ellipse(0, 0, 30, 30 * PITCH).fill({ color: DECOR_PALETTE.stone });
    base.ellipse(0, 0, 24, 24 * PITCH).fill({ color: '#241c16' }); // charred pit
    // Crossed log pile.
    base.poly([-22, -2, -8, -14, -4, -10, -18, 2]).fill({ color: DECOR_PALETTE.wood });
    base.poly([22, -2, 8, -14, 4, -10, 18, 2]).fill({ color: DECOR_PALETTE.woodDark });
    base.poly([-16, -10, 16, -10, 14, -4, -14, -4]).fill({ color: DECOR_PALETTE.woodLight });
    c.addChild(base);

    const flame = new Graphics();
    c.addChild(flame);
    this.fireFlames.push({ gfx: flame, scale: 1, seed: hash2(wx | 0, wy | 0) * 6.28 });
    // The camp's brightest, flickering light — drawn a touch above the pit so it haloes the fire.
    this.decorLights.push({ x: wx, y: wy - 8, radius: 230, color: FIRE_LIGHT, flicker: true });
  }

  /**
   * A canvas A-frame tent: a triangular ridge of cloth (the `color` tint) with a shaded side, a dark
   * door slit, and guy-ropes. Billboarded upward; `scale` sizes it (the central tent is bigger).
   */
  private drawTent(c: Container, color: string, scale: number): void {
    this.propShadow(c, 38 * scale, 16 * scale);
    const g = new Graphics();
    g.scale.set(scale);
    const w = 40; // half-width at the base
    const h = 56; // ridge height
    // Lit front slope, then a shaded right slope for a little form.
    g.poly([-w, 0, w, 0, 0, -h]).fill({ color });
    g.poly([0, 0, w, 0, 0, -h]).fill({ color: '#000000', alpha: 0.18 });
    // Ridge line + a hem strip along the bottom for weight.
    g.moveTo(0, -h).lineTo(0, 0).stroke({ width: 2, color: '#000000', alpha: 0.2 });
    g.rect(-w, -4, w * 2, 4).fill({ color: '#000000', alpha: 0.22 });
    // A dark triangular door flap at the front.
    g.poly([-9, 0, 9, 0, 0, -h * 0.62]).fill({ color: '#241b12' });
    // Guy-ropes to two pegs.
    g.moveTo(-w + 4, -2)
      .lineTo(-w - 12, 2)
      .stroke({ width: 1.5, color: DECOR_PALETTE.rope });
    g.moveTo(w - 4, -2)
      .lineTo(w + 12, 2)
      .stroke({ width: 1.5, color: DECOR_PALETTE.rope });
    c.addChild(g);
  }

  /**
   * A merchant's caravan: a wooden cart bed on two wheels under an arched cloth cover (`color` is
   * the wood tint). Billboarded upward — the camp's trader.
   */
  private drawWagon(c: Container, wood: string): void {
    this.propShadow(c, 46, 16);
    const g = new Graphics();
    // Wheels (seen edge-on at the pitch).
    for (const wx of [-30, 26]) {
      g.ellipse(wx, -8, 11, 11 * PITCH + 4).fill({ color: DECOR_PALETTE.woodDark });
      g.ellipse(wx, -8, 6, 6 * PITCH + 2).fill({ color: wood });
    }
    // Cart bed.
    g.rect(-40, -30, 80, 18).fill({ color: wood });
    g.rect(-40, -16, 80, 4).fill({ color: DECOR_PALETTE.woodDark });
    // Arched canvas cover.
    g.moveTo(-38, -30).arc(0, -30, 38, Math.PI, 0).fill({ color: DECOR_PALETTE.canvas });
    // Vertical hoop-rib shading lines following the arch.
    for (const rx of [-24, -8, 8, 24]) {
      const ry = -30 - Math.sqrt(Math.max(0, 38 * 38 - rx * rx));
      g.moveTo(rx, -30).lineTo(rx, ry).stroke({ width: 1.5, color: '#000000', alpha: 0.12 });
    }
    c.addChild(g);
  }

  /** A blacksmith's anvil on a wooden stump. */
  private drawAnvil(c: Container): void {
    this.propShadow(c, 18, 9);
    const g = new Graphics();
    // Stump.
    g.ellipse(0, 0, 14, 14 * PITCH).fill({ color: DECOR_PALETTE.woodDark });
    g.rect(-12, -14, 24, 14).fill({ color: DECOR_PALETTE.wood });
    g.ellipse(0, -14, 12, 12 * PITCH).fill({ color: DECOR_PALETTE.woodLight });
    // Iron anvil: waist + horned top.
    g.rect(-4, -26, 8, 12).fill({ color: DECOR_PALETTE.iron });
    g.poly([-14, -34, 12, -34, 16, -28, -10, -28]).fill({ color: DECOR_PALETTE.iron });
    g.poly([12, -34, 22, -33, 16, -30, 12, -31]).fill({ color: DECOR_PALETTE.iron }); // horn
    g.rect(-14, -34, 26, 2).fill({ color: DECOR_PALETTE.ironLight }); // top highlight
    c.addChild(g);
  }

  /** A wooden supply crate (plank box with cross-braces). */
  private drawCrate(c: Container, scale: number): void {
    this.propShadow(c, 16 * scale, 8 * scale);
    const g = new Graphics();
    g.scale.set(scale);
    g.rect(-14, -28, 28, 28).fill({ color: DECOR_PALETTE.wood });
    g.rect(-14, -28, 28, 28).stroke({ width: 2, color: DECOR_PALETTE.woodDark });
    g.moveTo(-14, -28)
      .lineTo(14, 0)
      .stroke({ width: 2, color: DECOR_PALETTE.woodDark, alpha: 0.7 });
    g.moveTo(14, -28)
      .lineTo(-14, 0)
      .stroke({ width: 2, color: DECOR_PALETTE.woodDark, alpha: 0.7 });
    g.rect(-14, -28, 28, 5).fill({ color: DECOR_PALETTE.woodLight, alpha: 0.5 }); // lit top edge
    c.addChild(g);
  }

  /** A wooden barrel with iron hoops. */
  private drawBarrel(c: Container): void {
    this.propShadow(c, 12, 6);
    const g = new Graphics();
    g.roundRect(-11, -30, 22, 30, 6).fill({ color: DECOR_PALETTE.wood });
    g.rect(-11, -25, 22, 3).fill({ color: DECOR_PALETTE.iron }); // upper hoop
    g.rect(-11, -10, 22, 3).fill({ color: DECOR_PALETTE.iron }); // lower hoop
    g.ellipse(0, -30, 11, 11 * PITCH).fill({ color: DECOR_PALETTE.woodLight }); // lid
    g.rect(-3, -30, 1.5, 30).fill({ color: '#000000', alpha: 0.15 }); // stave seams
    g.rect(4, -30, 1.5, 30).fill({ color: '#000000', alpha: 0.15 });
    c.addChild(g);
  }

  /** A hay bale (a rounded straw block with binding twine). */
  private drawHay(c: Container): void {
    this.propShadow(c, 18, 9);
    const g = new Graphics();
    g.roundRect(-18, -20, 36, 20, 6).fill({ color: DECOR_PALETTE.hay });
    g.roundRect(-18, -20, 36, 20, 6).stroke({ width: 1.5, color: DECOR_PALETTE.hayDark });
    // A few straw strokes + two binding twines.
    for (let i = -14; i <= 14; i += 4) {
      g.moveTo(i, -18)
        .lineTo(i + 2, -2)
        .stroke({ width: 1, color: DECOR_PALETTE.hayDark, alpha: 0.5 });
    }
    g.moveTo(-7, -20).lineTo(-7, 0).stroke({ width: 1.5, color: '#6a5418' });
    g.moveTo(7, -20).lineTo(7, 0).stroke({ width: 1.5, color: '#6a5418' });
    c.addChild(g);
  }

  /**
   * A tall torch/brazier pole with a flame casting a soft warm glow (smaller than the bonfire). The
   * flame is registered in fireFlames for per-frame flicker and a (smaller) flickering decorLight.
   */
  private drawTorch(c: Container, wx: number, wy: number): void {
    this.propShadow(c, 7, 4);
    const g = new Graphics();
    const h = 58;
    g.rect(-2.5, -h, 5, h).fill({ color: DECOR_PALETTE.woodDark }); // pole
    g.rect(-2.5, -h, 2, h).fill({ color: '#000000', alpha: 0.25 });
    // Iron basket at the top holding the fuel.
    g.poly([-7, -h, 7, -h, 5, -h + 10, -5, -h + 10]).fill({ color: DECOR_PALETTE.iron });
    g.rect(-7, -h, 14, 2).fill({ color: DECOR_PALETTE.ironLight });
    c.addChild(g);

    const flame = new Graphics();
    flame.position.set(0, -h); // flame sits in the basket at the pole top
    c.addChild(flame);
    this.fireFlames.push({ gfx: flame, scale: 0.5, seed: hash2(wx | 0, (wy | 0) + 7) * 6.28 });
    this.decorLights.push({
      x: wx,
      y: wy - h * 0.7,
      radius: 120,
      color: FIRE_LIGHT,
      flicker: true,
    });
  }

  /**
   * A small magical shrine: a tilted stone pedestal/obelisk topped by a floating glowing orb tinted
   * by `color` (the shrine's glow hue). The orb is registered in fireFlames so update() re-draws it
   * each frame — a gentle bob + halo pulse off the shared animation clock (never Date.now/random) —
   * and a soft COOL glow is recorded in decorLights so it blooms on the additive light overlay at
   * night, like the torch/bonfire. Purely cosmetic decor — no state.
   */
  private drawShrine(c: Container, wx: number, wy: number, color: string): void {
    this.propShadow(c, 16, 8);
    const stone = new Graphics();
    // A stepped stone base, then a tapered obelisk/pedestal rising to where the orb floats.
    stone.ellipse(0, 0, 16, 16 * PITCH).fill({ color: DECOR_PALETTE.stone });
    stone.rect(-13, -8, 26, 8).fill({ color: DECOR_PALETTE.stone });
    stone.rect(-13, -8, 26, 2).fill({ color: '#88837a', alpha: 0.6 }); // lit top step
    // Tapered pillar (wider base, narrower neck) with a shaded right side for form.
    stone.poly([-8, -8, 8, -8, 5, -40, -5, -40]).fill({ color: '#7c776d' });
    stone.poly([0, -8, 8, -8, 5, -40, 0, -40]).fill({ color: '#000000', alpha: 0.2 });
    // A small notched cradle at the top the orb hovers above.
    stone.poly([-7, -40, 7, -40, 4, -46, -4, -46]).fill({ color: '#605b52' });
    c.addChild(stone);

    // The floating orb sits above the pedestal; its Graphics is redrawn each frame for the pulse.
    const orb = new Graphics();
    orb.position.set(0, -54);
    c.addChild(orb);
    this.shrineOrbs.push({ gfx: orb, color, seed: hash2(wx | 0, (wy | 0) + 11) * 6.28 });
    // A soft cool magical glow on the additive overlay, gently pulsing (flicker = a slow breathe).
    this.decorLights.push({
      x: wx,
      y: wy - 50,
      radius: 150,
      color: hexToNum(color),
      flicker: true,
    });
  }

  /**
   * Redraw every cached shrine orb for this frame from the shared animation clock — a tinted gem
   * core wrapped in two soft halo rings, bobbing and pulsing gently. Cheap (a few circles per orb)
   * and keyed off `now`, so shrines breathe in sync with the renderer's clock (never Date.now/random).
   */
  private updateShrineOrbs(now: number): void {
    const t = now / 1000;
    for (const { gfx, color, seed } of this.shrineOrbs) {
      const bob = Math.sin(t * 1.6 + seed) * 2.5; // slow vertical float
      const pulse = 0.82 + 0.18 * Math.sin(t * 2.2 + seed * 1.7); // gentle halo breathe
      gfx.clear();
      gfx.circle(0, bob, 13 * pulse).fill({ color, alpha: 0.16 }); // outer halo
      gfx.circle(0, bob, 8 * pulse).fill({ color, alpha: 0.3 }); // inner halo
      gfx.circle(0, bob, 4.5).fill({ color, alpha: 0.95 }); // bright gem core
      gfx.circle(-1.4, bob - 1.4, 1.6).fill({ color: '#ffffff', alpha: 0.85 }); // glint highlight
    }
  }

  /**
   * Build an enterable house from its world-space footprint (NW corner minX,minY → SE corner
   * maxX,maxY). The floor + perimeter walls (with a door gap centered on the south edge) go into
   * the returned prop container (in propLayer, BEHIND actors, so the player stands on the floor and
   * in front of the walls). A separate gabled roof is built and registered in roofLayer + `houses`
   * so it occludes the player from above until it fades when the player steps inside. `color` tints
   * the timber. Built ONCE per area entry — only the roof alpha changes per frame.
   */
  private makeHouse(x: number, y: number, x2: number, y2: number, color: string): Container {
    const minX = Math.min(x, x2);
    const maxX = Math.max(x, x2);
    const minY = Math.min(y, y2);
    const maxY = Math.max(y, y2);
    const w = maxX - minX;
    const d = maxY - minY;

    // Anchor the prop container at the footprint's NW corner; everything below is drawn relative to
    // it in projected (pitched) space. zIndex by the south (near) edge so the building as a whole
    // sorts roughly with nearby props — actors are a separate layer in front regardless.
    const c = new Container();
    c.position.set(minX, minY * PITCH - this.groundLift(minX, minY));
    c.zIndex = maxY;

    const floor = new Graphics();
    // Interior floor: the footprint as a pitched quad, a touch lighter/warmer than the ground so the
    // room reads as a distinct boarded surface once the roof lifts.
    floor.rect(0, 0, w, d * PITCH).fill({ color: this.shade(color, 0.35), alpha: 0.95 });
    floor.rect(0, 0, w, d * PITCH).stroke({ width: 1, color: this.shade(color, -0.4), alpha: 0.4 });
    // A few plank seams across the floor for texture.
    for (let py = 12; py < d; py += 16) {
      floor
        .moveTo(0, py * PITCH)
        .lineTo(w, py * PITCH)
        .stroke({ width: 1, color: this.shade(color, -0.4), alpha: 0.18 });
    }
    c.addChild(floor);

    // Soft shadow hugging the south + east walls (the sides away from the upper-left sun).
    const sh = new Sprite(this.softShadowTexture());
    sh.anchor.set(0.5, 0.5);
    sh.width = w * 1.15;
    sh.height = Math.max(28, d * PITCH * 0.8);
    sh.alpha = SHADOW_ALPHA * 0.7;
    sh.position.set(w / 2 + 8, d * PITCH + 6);
    sh.skew.x = SHADOW_SKEW;
    c.addChildAt(sh, 0);

    const walls = new Graphics();
    const wall = color;
    const wallDark = this.shade(color, -0.35);
    const wallLight = this.shade(color, 0.25);
    const h = HOUSE_WALL_HEIGHT;
    // Footprint corners in the container's projected space.
    const nwY = 0;
    const seY = d * PITCH;
    // North (far) wall: a full billboarded strip standing up from the back edge.
    walls.rect(0, nwY - h, w, h).fill({ color: wallDark });
    walls.rect(0, nwY - h, w, 3).fill({ color: wallLight, alpha: 0.5 });
    // West + east (side) walls: slanted quads from the back edge down to the near edge.
    walls.poly([0, nwY, 0, nwY - h, 0, seY - h, 0, seY]).fill({ color: wall });
    walls.poly([w, nwY, w, nwY - h, w, seY - h, w, seY]).fill({ color: wallDark });
    // South (near, camera-facing) wall, split around a centered door gap.
    const doorHalf = Math.min(HOUSE_DOOR_WIDTH, w * 0.6) / 2;
    const doorCx = w / 2;
    const leftEnd = doorCx - doorHalf;
    const rightStart = doorCx + doorHalf;
    walls.rect(0, seY - h, Math.max(0, leftEnd), h).fill({ color: wall });
    walls.rect(rightStart, seY - h, Math.max(0, w - rightStart), h).fill({ color: wall });
    // Door jambs framing the opening + a dark threshold so the doorway reads clearly.
    walls.rect(leftEnd - 2, seY - h, 2, h).fill({ color: wallDark });
    walls.rect(rightStart, seY - h, 2, h).fill({ color: wallDark });
    walls.rect(leftEnd, seY - 4, doorHalf * 2, 4).fill({ color: '#1c140d', alpha: 0.6 });
    c.addChild(walls);

    // The roof is a separate object in roofLayer (drawn above actors). Register it + the footprint
    // so update() can fade it when the local player is inside.
    const roof = this.makeHouseRoof(minX, minY, maxX, maxY, color);
    this.roofLayer.addChild(roof);
    this.houses.push({ roof, minX, minY, maxX, maxY });
    return c;
  }

  /**
   * A peaked, gabled timber roof covering a house footprint (slightly overhanging), drawn as its own
   * container so it can be placed in roofLayer above the actors and faded independently. The ridge
   * runs east–west; two trapezoidal slopes fall to the front and back eaves, with the lit (back/upper)
   * slope brighter than the shaded front slope. Positioned + z-sorted off the footprint's near edge.
   */
  private makeHouseRoof(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    color: string,
  ): Container {
    const roof = new Container();
    roof.position.set(minX, minY * PITCH - this.groundLift(minX, minY));
    roof.zIndex = maxY;
    const w = maxX - minX;
    const d = maxY - minY;
    const o = HOUSE_ROOF_OVERHANG;
    const peak = HOUSE_ROOF_PEAK;
    // Eave line (top of the walls) and the ridge above it, all in projected space.
    const backEaveY = -HOUSE_WALL_HEIGHT - o * PITCH;
    const frontEaveY = d * PITCH - HOUSE_WALL_HEIGHT + o * PITCH;
    const ridgeY = (backEaveY + frontEaveY) / 2 - peak;
    const left = -o;
    const right = w + o;
    const g = new Graphics();
    const roofShade = this.shade(color, -0.2);
    const roofLit = this.shade(color, 0.18);
    const roofDark = this.shade(color, -0.45);
    // Back slope (faces up/away — catches the light) then the front slope (shaded), as two trapezoids
    // meeting at the ridge. Drawing back-first lets the front slope overlap it along the ridge.
    g.poly([left, backEaveY, right, backEaveY, right, ridgeY, left, ridgeY]).fill({
      color: roofLit,
    });
    g.poly([left, frontEaveY, right, frontEaveY, right, ridgeY, left, ridgeY]).fill({
      color: roofShade,
    });
    // Ridge beam + gable end caps (the triangular timber ends) for a built read.
    g.moveTo(left, ridgeY).lineTo(right, ridgeY).stroke({ width: 2, color: roofDark });
    g.poly([left, backEaveY, left, frontEaveY, left, ridgeY]).fill({ color: roofDark });
    g.poly([right, backEaveY, right, frontEaveY, right, ridgeY]).fill({ color: roofDark });
    // A couple of shingle/rafter lines down each slope.
    for (let i = 1; i < 4; i++) {
      const fx = left + ((right - left) * i) / 4;
      g.moveTo(fx, ridgeY).lineTo(fx, backEaveY).stroke({ width: 1, color: roofDark, alpha: 0.3 });
      g.moveTo(fx, ridgeY).lineTo(fx, frontEaveY).stroke({ width: 1, color: roofDark, alpha: 0.3 });
    }
    roof.addChild(g);
    return roof;
  }

  /**
   * Lighten (amount > 0) or darken (amount < 0) a CSS hex color toward white/black by `amount`
   * (−1..1), returning `#rrggbb`. Used to derive timber highlight/shade tones from a house's color.
   */
  private shade(hex: string, amount: number): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return hex;
    const n = parseInt(m[1]!, 16);
    const target = amount >= 0 ? 255 : 0;
    const k = Math.abs(amount);
    const mix = (ch: number): number => Math.round(ch + (target - ch) * k);
    const r = mix((n >> 16) & 0xff);
    const g = mix((n >> 8) & 0xff);
    const b = mix(n & 0xff);
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }

  /**
   * Redraw every cached fire flame for this frame from the shared animation clock — a few stacked,
   * jittering teardrops (deep ember → mid → hot core). Cheap (a handful of polys per fire) and keyed
   * off `now` so the whole camp flickers in sync with the renderer's clock, never Date.now/random.
   */
  private updateFireFlames(now: number): void {
    for (const { gfx, scale, seed } of this.fireFlames) {
      const t = now / 1000;
      // Two out-of-phase sines give an organic, non-repeating sway/height per fire (seeded).
      const sway = Math.sin(t * 7 + seed) * 3 + Math.sin(t * 13 + seed * 2) * 1.5;
      const lift = 1 + Math.sin(t * 9 + seed * 1.3) * 0.16;
      gfx.clear();
      const s = scale;
      // Outer → inner flame, each a teardrop swaying at the tip; the core burns brightest.
      this.flameTeardrop(gfx, sway * s, 30 * s * lift, 13 * s, DECOR_PALETTE.emberDeep, 0.85);
      this.flameTeardrop(gfx, sway * 0.7 * s, 22 * s * lift, 9 * s, DECOR_PALETTE.ember, 0.95);
      this.flameTeardrop(gfx, sway * 0.4 * s, 14 * s * lift, 5 * s, DECOR_PALETTE.emberCore, 1);
    }
  }

  /** Advance every animated decor sprite (candles/braziers) to its current loop frame. */
  private updateAnimatedProps(now: number): void {
    for (const p of this.animatedProps) {
      const i = Math.floor((now + p.phaseMs) / 130) % p.srcs.length;
      const t = this.tex.get(p.srcs[i]!);
      if (t) p.sprite.texture = t;
    }
  }

  /** One flame teardrop: a base ellipse pulled to a swaying point at height `h`. */
  private flameTeardrop(
    g: Graphics,
    tipX: number,
    h: number,
    w: number,
    color: string,
    alpha: number,
  ): void {
    g.poly([-w, -4, w, -4, tipX + w * 0.2, -h * 0.55, tipX, -h]).fill({ color, alpha });
    g.ellipse(0, -4, w, w * 0.7).fill({ color, alpha });
  }

  /** Configure the per-area color grade (saturation/brightness/contrast) as one filter pass. */
  private applyGrade(theme: AreaTheme): void {
    const identity =
      theme.gradeSaturation === 1 && theme.gradeBrightness === 1 && theme.gradeContrast === 1;
    let color: Filter | null = null;
    if (!identity) {
      const f = this.grade;
      f.reset();
      f.brightness(theme.gradeBrightness, false); // 1 = unchanged
      f.contrast(theme.gradeContrast - 1, true); // 0 = unchanged
      f.saturate(theme.gradeSaturation - 1, true); // 0 = unchanged
      color = f;
    }
    // RENDER-12: a per-area LUT (ColorMapFilter) overrides the ColorMatrix grade when the area names a
    // preset, else the ColorMatrix grade. RENDER-13: compose the heat-haze displacement after the grade.
    color = this.screenFx.gradeFilter(color);
    const heat = this.screenFx.heatFilter();
    const filters: Filter[] = [];
    if (color) filters.push(color);
    if (heat) filters.push(heat);
    // When the deferred pass is active the world is rendered to a RenderTexture as the render ROOT, so
    // filters on `world` itself wouldn't apply — put the grade on the displayed `litSprite` instead.
    // When deferred is off, the world is a normal stage child and carries the filters directly.
    if (this.deferred.isEnabled()) {
      this.litSprite.filters = filters;
      this.world.filters = [];
    } else {
      this.world.filters = filters;
      this.litSprite.filters = [];
    }
  }

  update(state: RenderState): void {
    this.setArea(state.areaId);
    this.targetId = state.targetId ?? null;

    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;

    const sw = this.app.screen.width;
    const sh = this.app.screen.height;

    // Screen shake: a decaying random offset added to the camera, kicked by death impacts.
    this.kickShake(state.fx);
    this.shakeMag *= Math.exp(-dt * SHAKE_DECAY);
    const shX = this.shakeMag > 0.05 ? (Math.random() * 2 - 1) * this.shakeMag : 0;
    const shY = this.shakeMag > 0.05 ? (Math.random() * 2 - 1) * this.shakeMag : 0;

    // Smoothly trail the camera toward the player (a follow camera) instead of snapping rigidly; a
    // large jump (portal/teleport, or the very first frame) snaps so we never slide across the map.
    // A small DEADZONE absorbs in-place combat shuffles (no camera swim), and the focus clamps to
    // the area bounds so small instances (dens, rifts) never show void past the world edge.
    let targetX = state.camX;
    let targetY = state.camY;
    const ddx = targetX - this.camX;
    const ddy = targetY - this.camY;
    const dd = Math.hypot(ddx, ddy);
    if (dd > CAM_SNAP_DIST) {
      this.camX = targetX;
      this.camY = targetY;
    } else {
      if (dd > 0 && dd < CAM_DEADZONE + 1) {
        targetX = this.camX; // inside the deadzone: hold steady
        targetY = this.camY;
      } else if (dd > 0) {
        targetX -= (ddx / dd) * CAM_DEADZONE; // chase to the deadzone's edge, not the center
        targetY -= (ddy / dd) * CAM_DEADZONE;
      }
      const k = 1 - Math.exp(-dt * CAM_FOLLOW_RATE);
      this.camX += (targetX - this.camX) * k;
      this.camY += (targetY - this.camY) * k;
    }
    const area = this.content.area(this.currentArea);
    if (area) {
      // Visible world extents from the actual projection (the dolly shows more world AHEAD of
      // the player than behind, so the Y clamp is asymmetric).
      const halfW = sw / 2 / this.zoom;
      const above = (sh * CAM_DOLLY_Y) / (PITCH * this.zoom);
      const below = (sh * (1 - CAM_DOLLY_Y)) / (PITCH * this.zoom);
      this.camX =
        area.width > halfW * 2
          ? Math.min(Math.max(this.camX, halfW), area.width - halfW)
          : area.width / 2;
      this.camY =
        area.height > above + below
          ? Math.min(Math.max(this.camY, above), area.height - below)
          : (above + area.height - below) / 2;
    }
    // this.camX/camY (the smoothed camera) and zoom drive both the draw origin and screen->world
    // picking, so click-to-move stays aligned with what's on screen even as the camera eases/zooms.
    const z = this.zoom;
    const originX = sw / 2 - this.camX * z + shX;
    const originY = sh * CAM_DOLLY_Y - this.camY * PITCH * z + shY;
    this.world.position.set(originX, originY);
    this.world.scale.set(z);
    this.water.syncTransform(originX, originY, z); // keep ponds world-anchored (RENDER-11)
    this.clouds.syncTransform(originX, originY, z); // keep cloud shadows world-anchored
    this.terrain.syncTransform(originX, originY, z); // keep the terrain mesh world-anchored (RENDER-08)
    this.ground.width = sw;
    this.ground.height = sh;
    this.ground.tilePosition.set(originX, originY);
    this.ground.tileScale.set(z);

    this.atmosphere.update(now, sw, sh, state.corruption ?? 0);
    if (this.effectsEnabled) this.weather.update(now, sw, sh);
    // "Reduce effects": hide the decorative weather + ambient motes (set visibility last so it sticks
    // regardless of what the update calls did). The screen wash + lights stay for the art direction.
    this.weather.layer.visible = this.effectsEnabled;
    this.atmosphere.particleLayer.visible = this.effectsEnabled;
    this.decals.setVisible(this.effectsEnabled);
    this.particles.setVisible(this.effectsEnabled);

    // Drifting cloud shadows: world-anchored patches that slide over the ground with the wind and
    // fade with the sun (outdoor + daylight only). Visible world half-extents come straight from the
    // projection; hidden with "reduce effects" alongside the weather + motes.
    if (this.effectsEnabled) {
      const cloudHalfW = sw / 2 / z;
      const cloudHalfH = sh / (2 * PITCH * z);
      const daylight = 1 - this.atmosphere.nightFactor();
      this.clouds.update(now, this.camX, this.camY, cloudHalfW, cloudHalfH, daylight);
    } else {
      this.clouds.layer.visible = false;
    }

    // Dynamic lights (additive): the local player carries a torch at screen center; portals glow.
    // Strength scales with night + the area's ambient-light theme, so they matter after dark.
    const lights: LightSource[] = [
      {
        x: sw / 2 + shX,
        y: sh * CAM_DOLLY_Y + shY,
        radius: PLAYER_LIGHT.radius,
        color: PLAYER_LIGHT.color,
      },
    ];
    for (const p of this.portalCenters) {
      lights.push({
        x: p.x * z + originX,
        y: p.y * PITCH * z + originY,
        radius: PORTAL_LIGHT.radius,
        color: PORTAL_LIGHT.color,
      });
    }
    // The camp's bonfire + torches cast a warm glow, projected to screen like the portal lights so
    // they bloom on the additive overlay (strongest after dark). Fire lights flicker their radius
    // off the animation clock so the firelight breathes. Empty outside a decorated area (the town).
    for (const t of this.decorLights) {
      const r = t.flicker ? t.radius * (0.9 + 0.1 * Math.sin(now / 90 + t.x)) : t.radius;
      lights.push({
        x: t.x * z + originX,
        y: t.y * PITCH * z + originY,
        radius: r,
        color: t.color,
      });
    }
    // Live flicker for the cached campfire/torch flames (drawn from this same clock — never random).
    this.updateFireFlames(now);
    // Advance the candle/brazier frame loops (same clock).
    this.updateAnimatedProps(now);
    // Gentle bob + halo pulse for the cached shrine orbs (same clock — never Date.now/random).
    this.updateShrineOrbs(now);
    this.lighting.update(
      lights,
      sw,
      sh,
      this.atmosphere.nightFactor(),
      this.currentTheme.lightAmbient,
    );
    // Soft bloom on the light overlay so torch/portal/spell glow blooms (desktop only).
    this.postFx.update(this.lighting.layer, sw, sh);

    // Animate the optional screen polish filters (godray drift, heat-haze scroll). No-op when the
    // current area enables none of them.
    this.screenFx.update(now, sw, sh);

    // Deferred normal-mapped lighting (RENDER-01): when active, render the world through the GPU
    // light list and show the lit result in place of the world. Inactive today (no normal maps
    // loaded) → this early-returns and the world renders directly with the additive halos above.
    this.runDeferred(lights, sw, sh);

    // Area-change fade-from-black, eased toward 0.
    // The arrival fade lifts with a cubic ease-out: dark lingers a beat, then clears fast.
    this.fadeAlpha = Math.max(0, this.fadeAlpha - dt / FADE_SECONDS);
    const fadeEased = 1 - cubicOut(1 - this.fadeAlpha);
    this.fade.clear();
    if (fadeEased > 0.001) this.fade.rect(0, 0, sw, sh).fill({ color: 0x000000, alpha: fadeEased });

    // Fire one-shot animations from FX events BEFORE the sweep, so a death can latch a corpse pose
    // on the actor's view the same tick the entity drops out of the snapshot.
    const nowMs = performance.now();
    this.triggerAnimEvents(state.fx, nowMs);

    // Refresh the time-of-day sun once for the whole frame so every shadow rakes consistently.
    this.frameSun = this.atmosphere.sunShadow();

    for (const view of this.views.values()) view.seen = false;
    for (const e of state.entities) {
      if (e.kind === 'projectile') this.updateProjectile(e);
      else if (e.kind === 'item') this.updateItem(e);
      else if (e.kind === 'chest') this.updateChest(e);
      else if (e.kind === 'pot') this.updatePot(e);
      else if (e.kind === 'den') this.updateDen(e);
      else this.updateActor(e, e.id === state.selfId);
    }
    for (const [id, view] of this.views) {
      // Keep a freshly-slain actor's corpse pose for a moment, then sweep it.
      if (!view.seen && (view.dyingUntil ?? 0) <= nowMs) {
        view.container.destroy({ children: true });
        this.views.delete(id);
      }
    }

    this.updateFx(state.fx);

    // Decals + particles: spawn from new FX events, kick footstep dust, then integrate both pools.
    if (this.effectsEnabled) {
      this.spawnFxDecalsAndParticles(state.fx, now);
      this.footstepDust(state, now);
    }
    this.decals.update(now);
    this.particles.update(dt * 1000);

    // Water reflections (RENDER-11): mirror actors standing in/near a pond.
    if (this.water.hasPonds()) {
      if (this.effectsEnabled) {
        const ponds = this.water.getPonds();
        const items = [];
        for (const e of state.entities) {
          if (e.kind === 'projectile' || e.kind === 'item') continue;
          if (!isOverWater(ponds, e.x, e.y, 40)) continue;
          const view = this.views.get(e.id);
          if (view?.sprite) {
            items.push({
              texture: view.sprite.texture,
              x: e.x,
              y: e.y,
              scaleX: view.sprite.scale.x,
              scaleY: view.sprite.scale.y,
            });
          }
        }
        this.water.reflect(items);
      } else {
        this.water.reflect([]);
      }
      this.water.update(now);
      this.water.setVisible(this.effectsEnabled);
    }

    // Fade house roofs based on whether the LOCAL player stands inside each footprint. Uses the
    // authoritative self entity's world position (the camera trails it, so the actual entity is the
    // truthful test). Eased frame-rate-independently off `dt` — no Date.now()/Math.random().
    this.updateHouseRoofs(state.entities, state.selfId, dt);
    this.updateOccluders(state.entities, state.selfId, dt);
  }

  /**
   * Per-frame roof fade for every cached house. The local player is "inside" a house when its world
   * position falls within the footprint expanded by HOUSE_INSIDE_MARGIN (so crossing the south-door
   * threshold counts). Each roof's alpha eases toward HOUSE_ROOF_INSIDE_ALPHA when inside and
   * HOUSE_ROOF_OUTSIDE_ALPHA when outside; only the alpha changes — geometry is never rebuilt.
   */
  private updateHouseRoofs(entities: EntityState[], selfId: number, dt: number): void {
    if (this.houses.length === 0) return;
    const self = entities.find((e) => e.id === selfId);
    const k = 1 - Math.exp(-dt * HOUSE_ROOF_FADE_RATE); // exp approach, frame-rate independent
    for (const house of this.houses) {
      let inside = false;
      if (self) {
        const m = HOUSE_INSIDE_MARGIN;
        inside =
          self.x >= house.minX - m &&
          self.x <= house.maxX + m &&
          self.y >= house.minY - m &&
          self.y <= house.maxY + m;
      }
      const target = inside ? HOUSE_ROOF_INSIDE_ALPHA : HOUSE_ROOF_OUTSIDE_ALPHA;
      house.roof.alpha += (target - house.roof.alpha) * k;
    }
  }

  /**
   * RENDER-06: fade tall point props (trees/pillars) the LOCAL player is hidden behind, so the
   * character is never lost. A prop occludes when the player is within the trunk's horizontal margin
   * and behind it (from just south of the base up to where the foliage reaches north). Eased toward
   * OCCLUDER_FADE_ALPHA the same frame-rate-independent way as the roof fade; restores to 1 on exit.
   * Only the local player triggers it — matching the roof-fade rule. Cheap (an alpha lerp), so it
   * runs on every quality tier.
   */
  private updateOccluders(entities: EntityState[], selfId: number, dt: number): void {
    if (this.occluders.length === 0) return;
    const self = entities.find((e) => e.id === selfId);
    const k = 1 - Math.exp(-dt * HOUSE_ROOF_FADE_RATE);
    for (const occ of this.occluders) {
      const hidden = self ? playerHiddenBehind(self.x, self.y, occ.x, occ.y) : false;
      const target = hidden ? OCCLUDER_FADE_ALPHA : 1;
      occ.container.alpha += (target - occ.container.alpha) * k;
    }
  }

  /** Trigger a shake impulse for any death FX we haven't seen yet (newer than lastDeathT0). */
  private kickShake(fx: TimedFx[]): void {
    let newest = this.lastDeathT0;
    for (const { ev, t0 } of fx) {
      if (ev.kind !== 'death' || t0 <= this.lastDeathT0) continue;
      this.shakeMag = Math.max(this.shakeMag, SHAKE_ON_DEATH);
      if (t0 > newest) newest = t0;
    }
    this.lastDeathT0 = newest;
  }

  /**
   * Spawn ground decals + particle bursts from FX events we haven't consumed yet (RENDER-02/03).
   * Cosmetic only — purely a function of the broadcast `state.fx`, never of local simulation. FX
   * coordinates are world-space (the same x/y the actors use), so they map straight onto the decal
   * layer and particle system, both of which live inside the world container.
   */
  private spawnFxDecalsAndParticles(fx: TimedFx[], now: number): void {
    let newest = this.lastDecalT0;
    for (const { ev, t0 } of fx) {
      if (t0 <= this.lastDecalT0) continue;
      if (t0 > newest) newest = t0;
      switch (ev.kind) {
        case 'death':
          // A lasting stain plus a short blood spray at the kill site.
          this.decals.spawn('corpse', ev.x, ev.y, now);
          this.decals.spawn('blood', ev.x, ev.y, now, { scale: 0.8 });
          this.particles.emit('blood', ev.x, ev.y);
          break;
        case 'hit':
          // Impact sparks; crits throw a bigger golden burst.
          this.particles.emit(ev.crit ? 'critHit' : 'hit', ev.x, ev.y);
          break;
        case 'slam':
          // Heavy AoE impact: a scorch/crater mark and a ring of kicked-up dust.
          this.decals.spawn('crater', ev.x, ev.y, now, { scale: ((ev.radius ?? 80) / 80) * 1.1 });
          this.particles.emit('slam', ev.x, ev.y);
          break;
        case 'cast': {
          // A spell cast throws an elemental particle burst matching the ability color.
          const strip = this.castStripFor(
            ev.abilityId ? (this.content.ability(ev.abilityId)?.color ?? '#ffffff') : '#ffffff',
          );
          this.particles.emit(
            strip === 'frost' ? 'frost' : strip === 'poison' ? 'frost' : 'ember',
            ev.x,
            ev.y,
          );
          break;
        }
        case 'levelup':
          this.particles.emit('heal', ev.x, ev.y); // a rising sparkle on level-up
          break;
        default:
          break;
      }
    }
    this.lastDecalT0 = newest;
  }

  /**
   * Kick a small puff of dust under the LOCAL player while they move. Throttled so a continuous walk
   * emits at a steady cadence rather than once per frame, and gated on actual displacement so
   * standing still is silent. Mirrors the roof-fade rule of keying off the authoritative self entity.
   */
  private footstepDust(state: RenderState, now: number): void {
    const self = state.entities.find((e) => e.id === state.selfId);
    if (!self) return;
    const moved = Math.hypot(self.x - this.lastSelfX, self.y - this.lastSelfY);
    this.lastSelfX = self.x;
    this.lastSelfY = self.y;
    if (moved > 1.2 && now - this.lastFootstepAt > 150) {
      this.lastFootstepAt = now;
      this.particles.emit('dust', self.x, self.y);
    }
  }

  /**
   * Run the deferred normal-mapped lighting pass (RENDER-01) when it is active, swapping the live
   * world for the lit render-texture result. When inactive (no normal maps, or 'low' quality) it
   * restores the direct world render and returns immediately — the no-regression path used today.
   */
  private runDeferred(lights: LightSource[], sw: number, sh: number): void {
    if (!this.deferred.isEnabled()) {
      if (this.litSprite.visible) {
        this.litSprite.visible = false;
        this.world.renderable = true;
      }
      return;
    }
    const night = this.atmosphere.nightFactor();
    const pointIntensity = 0.6 + night * 0.7; // torches matter more after dark
    const gpu: GpuLight[] = [];
    for (const l of lights) gpu.push(pointToGpuLight(l, 40, pointIntensity));
    gpu.push(sunGpuLight(night));
    const culled = cullLights(gpu, sw / 2, sh * CAM_DOLLY_Y);
    const packed = packLights(culled);
    // Self-healing: the deferred composite is the only GPU pass that can fault on a driver we can't
    // test headlessly. If it ever throws, disable it for good and fall back to the direct world
    // render — a missing relief effect is fine; a hard crash every frame is not.
    try {
      const lit = this.deferred.run(this.app.renderer, this.world, packed, sw, sh);
      if (lit) {
        this.litSprite.texture = lit;
        this.litSprite.visible = true;
        this.world.renderable = false;
      }
    } catch (err) {
      console.warn('[render] deferred lighting disabled after a GPU error:', err);
      this.deferred.setEnabled(false);
      this.litSprite.visible = false;
      this.world.renderable = true;
    }
  }

  /**
   * Drive one-shot animations from the server's FxEvents (cast/melee/slam/death), matched to the
   * nearest actor by position — the events fire at the actor's exact spot the tick they happen.
   * Runs BEFORE the not-seen sweep so a death can hold the corpse pose past the entity's removal.
   */
  private triggerAnimEvents(fx: TimedFx[], now: number): void {
    let newest = this.lastAnimT0;
    for (const { ev, t0 } of fx) {
      if (t0 <= this.lastAnimT0) continue;
      if (t0 > newest) newest = t0;
      const state: AnimState | null =
        ev.kind === 'cast'
          ? 'cast'
          : ev.kind === 'melee' || ev.kind === 'slam'
            ? 'attack'
            : ev.kind === 'death'
              ? 'death'
              : null;
      if (!state) continue;
      const view = this.nearestActorView(ev.x, ev.y);
      if (!view || !view.sheet || !view.sheet.clips.clips[state]) continue;
      const anim = (view.anim ??= newAnimView());
      triggerOneShot(anim, state, now, view.sheet.clips);
      if (state === 'death') {
        // Hold the corpse a moment past the entity leaving the snapshot, frozen on its last frame.
        view.dyingUntil = now + DEATH_HOLD_MS;
        const f = resolveAnim(anim, view.sheet.clips, 0, false, now);
        if (view.sprite && view.spriteKey) {
          view.sprite.texture = this.frame(
            view.spriteKey,
            view.sheet.fw,
            view.sheet.fh,
            f.col,
            f.row,
          );
          if (view.castShadow) view.castShadow.texture = view.sprite.texture; // corpse pose shadow
        }
      }
    }
    this.lastAnimT0 = newest;
  }

  /** The actor view nearest a world point (within a small radius), for matching FxEvents to actors. */
  private nearestActorView(x: number, y: number): ActorView | undefined {
    let best: ActorView | undefined;
    let bestD2 = 50 * 50; // only match within ~50px
    for (const view of this.views.values()) {
      const d2 = (view.lastX - x) ** 2 + (view.lastY - y) ** 2;
      if (d2 < bestD2) {
        best = view;
        bestD2 = d2;
      }
    }
    return best;
  }

  /**
   * Drive a planted ground shadow from two cues, both multiplying its captured baseline (no-op until
   * a `shadowPlanted` was captured):
   *   - height-reactive: shrink + fade as the caster rises off the plane (`lift`, world px), the
   *     readable "how high is this" contact cue, snapping tight on landing;
   *   - time-of-day sun: lengthen + fade toward dawn/dusk, short + dark at noon (`this.frameSun`).
   * The sun stretches *length* (scale.y) + reach (offset), not width, so the shadow rakes away from
   * the feet rather than ballooning.
   */
  private liftShadow(view: ActorView, lift: number, falloff?: number): void {
    const p = view.shadowPlanted;
    if (!p) return;
    const m = shadowLift(lift, falloff);
    const sun = this.frameSun;
    p.node.scale.set(p.sx * m.scale, p.sy * m.scale * sun.stretch);
    p.node.position.set(p.ox * sun.stretch, p.oy * sun.stretch);
    p.node.alpha = p.alpha * m.alpha * sun.alpha;
  }

  private updateActor(e: EntityState, isSelf: boolean): void {
    let view = this.views.get(e.id);
    if (!view) {
      view = this.makeActor(e, isSelf);
      this.actorLayer.addChild(view.container);
      this.views.set(e.id, view);
    }
    view.seen = true;
    view.container.position.set(e.x, e.y * PITCH - this.groundLift(e.x, e.y));
    view.container.zIndex = e.y;

    const now = performance.now();
    const anim = (view.anim ??= newAnimView());
    // Hit-flash + hurt animation on HP drop; status tint otherwise (burn > slow).
    if (e.hp < view.lastHp) {
      view.flashUntil = now + FLASH_MS;
      if (view.sheet) triggerOneShot(anim, 'hurt', now, view.sheet.clips);
    }
    view.lastHp = e.hp;

    if (view.sprite && view.sheet) {
      const moving = Math.hypot(e.x - view.lastX, e.y - view.lastY) > 0.25;
      const sheet = view.sheet;
      const { row, col } = resolveAnim(anim, sheet.clips, e.facing, moving, now);
      view.sprite.texture = this.frame(sheetKey(e)!, sheet.fw, sheet.fh, col, row);
      if (view.castShadow) {
        const cs = view.castShadow;
        cs.texture = view.sprite.texture; // keep the cast pose in sync
        // Rake the sheared cast shadow with the same time-of-day sun as the blob shadows: longer +
        // fainter toward dusk, short + dark at noon. Recomputed from the planted constants each
        // frame (no drift), scaling length (scale.y) + reach (offset), not width.
        const sun = this.frameSun;
        const csR = e.kind === 'mob' ? MOB_RADIUS : PLAYER_RADIUS;
        cs.scale.set(sheet.scale, sheet.scale * PITCH * sun.stretch);
        cs.position.set(csR * SHADOW_OFFSET_X * sun.stretch, csR * SHADOW_OFFSET_Y * sun.stretch);
        cs.alpha = CAST_SHADOW_ALPHA * sun.alpha;
      }

      // A small vertical bob — a quick footstep lift while moving, a slow breath while idle —
      // staggered per entity so a crowd doesn't pulse in lockstep. Sells the billboards as alive.
      const phase = e.id * 1.7;
      const fly = flyHeight(e);
      view.sprite.y = fly
        ? -fly + Math.sin(now / 300 + phase) * 2 // flyers hover well above their planted shadow
        : moving
          ? -Math.abs(Math.sin(now / 110 + phase)) * 2.5
          : Math.sin(now / 420 + phase) * 1.2;

      // Paper-doll: overlay equipped layers on the same frame + bob. The local player's look comes
      // from net.you.equipment (setPlayerLook); other humanoids decode the server's `look` bitfield
      // (1=helm, 2=armor, 4=weapon) so players/hirelings/NPCs all show their gear.
      if (view.equipLayers) {
        const lookBits = e.look ?? 0;
        const wear = (piece: string) =>
          isSelf
            ? this.playerLook[piece] === true
            : piece === 'helm'
              ? (lookBits & 1) !== 0
              : piece === 'armor'
                ? (lookBits & 2) !== 0
                : (lookBits & 4) !== 0; // weapon
        for (const piece of EQUIP_LAYER_ORDER) {
          const ls = view.equipLayers[piece];
          if (!ls) continue;
          if (wear(piece)) {
            ls.visible = true;
            ls.texture = this.frame(`equip:${piece}`, sheet.fw, sheet.fh, col, row);
            ls.y = view.sprite.y;
          } else {
            ls.visible = false;
          }
        }
      }
    } else if (view.sprite && !view.sheet) {
      // Static one-frame sprite: mirror horizontally to face the travel direction, with the same
      // walk/idle bob the animated actors get so it still reads as alive.
      const moving = Math.hypot(e.x - view.lastX, e.y - view.lastY) > 0.25;
      const left = Math.cos(e.facing) < -0.05;
      view.sprite.scale.x = Math.abs(view.sprite.scale.x) * (left ? -1 : 1);
      const phase = e.id * 1.7;
      const fly = flyHeight(e);
      view.sprite.y = fly
        ? -fly + Math.sin(now / 300 + phase) * 2
        : moving
          ? -Math.abs(Math.sin(now / 110 + phase)) * 2.5
          : Math.sin(now / 420 + phase) * 1.2;
    }
    // Drive the blob shadow each frame: the height-reactive shrink/fade as the billboard rises off
    // the ground (walk bob, idle breath, flyer hover; sprite.y is the negative lift) plus the
    // time-of-day sun rake. Procedural orbs don't bob (lift 0) but still want the sun; cast-shadow
    // actors have no shadowPlanted, so liftShadow no-ops for them (their cast copy rakes instead).
    this.liftShadow(view, view.sprite ? Math.max(0, -view.sprite.y) : 0);
    view.lastX = e.x;
    view.lastY = e.y;
    if (view.sprite) {
      const flags = e.flags ?? 0;
      // Status/flash tints override; otherwise actors take the area's cohesive sprite tint
      // multiplied by any SQL sprite-color override stamped on the entity (the `sprite_tints`
      // table — one source image, many dark/gritty variations). The gold NPC tint only suits
      // the shared hero sheet — distinct rogues figures keep their own palette.
      view.sprite.tint =
        e.kind === 'npc'
          ? view.sheet
            ? 0xffd97a
            : combineTints(this.currentTheme.spriteTint, e.tint)
          : now < view.flashUntil
            ? TINT_FLASH
            : flags & 2
              ? TINT_BURN
              : flags & 1
                ? TINT_SLOW
                : flags & 4
                  ? TINT_WEAKEN
                  : flags & 64
                    ? TINT_ENRAGE
                    : combineTints(this.currentTheme.spriteTint, e.tint);
    }

    if (view.dyn && e.maxHp > 0) {
      const bw = (e.kind === 'mob' ? MOB_RADIUS : PLAYER_RADIUS) * 2.4;
      const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
      view.dyn.clear();
      // Elite/champion mob: a gold ground-ring marker (drawn under the bar).
      if (e.elite) {
        view.dyn
          .ellipse(0, 2, MOB_RADIUS + 7, (MOB_RADIUS + 7) * 0.5)
          .stroke({ width: 2, color: '#ffcf5a', alpha: 0.9 });
      }
      // Your selected target (click-to-target): a bright white ground-ring, drawn larger than the
      // elite/tagged rings so the mob you're chasing + auto-attacking stands out in a pack.
      if (e.id === this.targetId) {
        view.dyn
          .ellipse(0, 2, MOB_RADIUS + 9, (MOB_RADIUS + 9) * 0.5)
          .stroke({ width: 2.5, color: '#ffffff', alpha: 0.95 });
      }
      // Tagged/engaged mob: a cyan claim ring + a small swordfight pip over the bar, so you can
      // see at a glance which monsters are already someone's fight (you still get shared credit).
      if (e.tagged) {
        view.dyn
          .ellipse(0, 2, MOB_RADIUS + 4, (MOB_RADIUS + 4) * 0.5)
          .stroke({ width: 1.5, color: '#5fd0e0', alpha: 0.8 });
        view.dyn.circle(bw / 2 - 2, view.topY - 4, 2.4).fill({ color: '#5fd0e0', alpha: 0.95 });
      }
      view.dyn.rect(-bw / 2, view.topY - 6, bw, 4).fill({ color: '#000000', alpha: 0.6 });
      view.dyn.rect(-bw / 2, view.topY - 6, bw * frac, 4).fill({
        color: e.kind === 'mob' ? '#cc4444' : '#4caf50',
      });
    }
    // Faux-perspective depth scale (closer to camera = bigger), combined with the champion bump.
    const depth = Math.max(
      DEPTH_SCALE_MIN,
      Math.min(DEPTH_SCALE_MAX, 1 + (e.y - this.camY) * DEPTH_SCALE_K),
    );
    const elite = e.kind === 'mob' && e.elite ? 1.32 : 1;
    view.container.scale.set(depth * elite);
  }

  private makeActor(e: EntityState, isSelf: boolean): ActorView {
    const container = new Container();
    const radius = e.kind === 'mob' ? MOB_RADIUS : PLAYER_RADIUS;
    // Soft directional shadow: a baked radial ellipse offset + skewed toward a fixed sun, so actors
    // read as planted on the ground and lit from a consistent direction (the Diablo 2 look).
    const shadow = new Sprite(this.softShadowTexture());
    shadow.anchor.set(0.5, 0.5);
    // A flyer's shadow is smaller + fainter (cast from height), which sells the elevation gap.
    const flying = flyHeight(e) > 0;
    shadow.width = radius * (flying ? 1.9 : 2.9);
    shadow.height = radius * (flying ? 0.95 : 1.45);
    shadow.alpha = flying ? SHADOW_ALPHA * 0.65 : SHADOW_ALPHA;
    shadow.position.set(radius * SHADOW_OFFSET_X, radius * SHADOW_OFFSET_Y);
    shadow.skew.x = SHADOW_SKEW;
    container.addChild(shadow);
    // Contact-AO core (desktop only): a small, tight, dark soft ellipse pinned at the feet that —
    // unlike the directional shadow above — never lifts or rakes. It's the ambient occlusion where
    // body meets ground, the "#1 planted-vs-floating" cue: as the directional shadow shrinks/slides
    // off with height or a low sun, this core stays put, so the figure reads as truly grounded (and
    // a rising one visibly parts from its contact point). Flyers never touch the ground, so skip it.
    if (this.quality === 'high' && flyHeight(e) === 0) {
      const contact = new Sprite(this.softShadowTexture());
      contact.anchor.set(0.5, 0.5);
      contact.width = radius * 1.5;
      contact.height = radius * 0.7;
      contact.alpha = CONTACT_AO_ALPHA;
      container.addChild(contact);
    }
    // The local player keeps a thin gold ground-ring so you can always pick yourself out.
    if (isSelf) {
      const ring = new Graphics();
      ring.ellipse(0, 0, radius + 3, radius * 0.5 + 2).stroke({ width: 2, color: '#c9a24b' });
      container.addChild(ring);
    }

    const key = sheetKey(e);
    const sheet = key ? (SHEETS[key] ?? MOB_SHEETS[key]) : undefined;
    const baseTex = key ? this.tex.get(key) : undefined;
    const anim = newAnimView();
    const view: ActorView = {
      container,
      shadow,
      anim,
      dyn: new Graphics(),
      topY: -radius * 2.6,
      lastX: e.x,
      lastY: e.y,
      lastHp: e.hp,
      flashUntil: 0,
      seen: true,
    };

    // Static (single-frame) 32rogues sprites: NPCs prefer them (a distinct figure per role beats
    // a shared animated hero), and mobs use them when no animated LPC sheet matches — previously
    // those fell back to procedural orbs.
    const staticSprite = this.staticActorSprite(e);
    if (staticSprite && (e.kind === 'npc' || !(sheet && baseTex))) {
      view.sprite = staticSprite;
      view.topY = -staticSprite.height * 0.85;
      container.addChild(staticSprite);
    } else if (sheet && baseTex) {
      const start = resolveAnim(anim, sheet.clips, e.facing, false, performance.now());
      const sprite = new Sprite(this.frame(key!, sheet.fw, sheet.fh, start.col, start.row));
      sprite.anchor.set(0.5, 0.92);
      sprite.scale.set(sheet.scale);
      view.sprite = sprite;
      view.sheet = sheet;
      view.spriteKey = key!;
      view.topY = -sheet.fh * sheet.scale * 0.85;
      container.addChild(sprite);
      // RENDER-07: important actors (the local hero, elites/bosses) cast a real sheared sprite-copy
      // shadow instead of the soft blob — a darkened copy of the current frame, flattened onto the
      // ground and sheared toward the sun's lower-right. It shares the body texture (updated on frame
      // change in updateActor), so it always matches the pose; minor mobs keep the cheap blob.
      if ((isSelf || e.elite) && !flying) {
        const cast = new Sprite(sprite.texture);
        cast.anchor.set(0.5, 0.92); // same feet anchor as the body
        cast.scale.set(sheet.scale, sheet.scale * PITCH); // flatten onto the tilted ground
        cast.skew.x = SHADOW_SKEW;
        cast.tint = 0x000000;
        cast.alpha = CAST_SHADOW_ALPHA;
        cast.position.set(radius * SHADOW_OFFSET_X, radius * SHADOW_OFFSET_Y);
        container.addChildAt(cast, 0); // behind the body and the blob
        view.castShadow = cast;
        shadow.visible = false; // the cast shadow replaces the blob for important actors
      }
      // Paper-doll equipment overlays for any humanoid on the adventurer sheet (player/NPC/hireling):
      // one sprite per layer, matching the body's anchor + scale, over the body in armor→weapon→helm
      // order. Hidden until the look enables them (updateActor syncs texture/visibility/bob per frame).
      if (key === 'hero') {
        const layers: Record<string, Sprite> = {};
        for (const piece of EQUIP_LAYER_ORDER) {
          if (!this.tex.has(`equip:${piece}`)) continue;
          const ls = new Sprite(Texture.EMPTY);
          ls.anchor.set(0.5, 0.92);
          ls.scale.set(sheet.scale);
          ls.visible = false;
          container.addChild(ls);
          layers[piece] = ls;
        }
        if (Object.keys(layers).length > 0) view.equipLayers = layers;
      }
    } else {
      const orb = new Graphics();
      const raise = radius * 1.2;
      const light = e.kind === 'mob' ? 44 : 56;
      orb.circle(0, -raise, radius).fill({ color: `hsl(${e.hue} 60% ${light}%)` });
      orb.circle(0, -raise, radius).stroke({ width: 2, color: '#000000', alpha: 0.5 });
      view.orb = orb;
      view.topY = -raise - radius;
      container.addChild(orb);
    }

    const label = new Text({
      text: `${e.name}${e.level ? ` · L${e.level}` : ''}`,
      style: {
        fontFamily: 'system-ui',
        fontSize: 12,
        fill: e.kind === 'mob' ? '#e7b0b0' : '#e7e3d2',
      },
    });
    label.anchor.set(0.5, 1);
    label.position.set(0, view.topY - 8);
    container.addChild(view.dyn!, label);

    // Quest-giver marker: a gold "!" floating above so the objective source is discoverable.
    if (e.kind === 'npc' && e.npcKind === 'questgiver') {
      const mark = new Text({
        text: '!',
        style: { fontFamily: 'system-ui', fontSize: 22, fontWeight: 'bold', fill: '#ffd23f' },
      });
      mark.anchor.set(0.5, 1);
      mark.position.set(0, view.topY - 22);
      container.addChild(mark);
    }
    // Capture the blob shadow's planted scale/alpha so the per-frame height cue (liftShadow) can
    // shrink + fade it from this baseline as the actor bobs/hovers. Skipped when the blob is hidden
    // behind a sheared cast shadow (important actors): their bob is small and the cast copy already
    // sells the contact.
    if (shadow.visible) {
      view.shadowPlanted = {
        node: shadow,
        sx: shadow.scale.x,
        sy: shadow.scale.y,
        ox: shadow.position.x,
        oy: shadow.position.y,
        alpha: shadow.alpha,
      };
    }
    return view;
  }

  /**
   * A static one-frame sprite for an actor from the 32rogues sheets: every monster name maps to a
   * creature cell (mobSpriteCell) and every service NPC kind to a townsfolk cell (npcSpriteCell).
   * Returns undefined when no cell matches or the sheet isn't loaded (→ LPC/orb fallback).
   */
  private staticActorSprite(e: EntityState): Sprite | undefined {
    let alias: string | undefined;
    let cell: { col: number; row: number } | undefined;
    if (e.kind === 'mob') {
      const m = mobSpriteCell(e.name);
      if (m) {
        alias = m.sheet === 'animals' ? 'animals32' : 'monsters32';
        cell = m;
      }
    } else if (e.kind === 'npc' && e.npcKind) {
      cell = npcSpriteCell(e.npcKind);
      alias = 'rogues32';
    }
    if (!alias || !cell || !this.tex.has(alias)) return undefined;
    // Bosses read bigger; everyone else lands near the LPC actors' on-screen height.
    const scale = e.kind === 'mob' && e.maxHp >= 280 ? 2.1 : 1.4;
    const sprite = new Sprite(this.frame(alias, 32, 32, cell.col, cell.row));
    sprite.anchor.set(0.5, 0.92);
    sprite.scale.set(scale);
    return sprite;
  }

  private frame(alias: string, fw: number, fh: number, col: number, row: number): Texture {
    const key = `${alias}:${col}:${row}`;
    let t = this.frameCache.get(key);
    if (!t) {
      const base = this.tex.get(alias);
      if (!base) return Texture.WHITE;
      t = new Texture({
        source: base.source as TextureSource,
        frame: new Rectangle(col * fw, row * fh, fw, fh),
      });
      this.frameCache.set(key, t);
    }
    return t;
  }

  private updateProjectile(e: EntityState): void {
    const ability = e.abilityId ? this.content.ability(e.abilityId) : undefined;
    // Enemy projectiles read as a menacing red regardless of the sprite hint they were given.
    const color = (e.hostile ? '#ff4d4d' : (ability?.color ?? '#ffffff')) as ColorSource;
    const radius = ability?.radius ?? 6;
    // Animate the projectile with the element-appropriate spell strip (by ability id, then by the
    // ability's true color); elements with no strip (poison/holy) keep the correctly-tinted orb.
    const stripKey = projectileStrip(e.abilityId, ability?.color);
    const strip = stripKey ? PROJ_STRIP_DEFS[stripKey] : undefined;
    const hasStrip = strip ? this.tex.has(strip.alias) : false;

    let view = this.views.get(e.id);
    if (!view) {
      const container = new Container();
      view = { container, topY: 0, lastX: e.x, lastY: e.y, lastHp: 0, flashUntil: 0, seen: true };
      // Ground shadow on the plane; the projectile itself rides above it (a 2.5D height cue). The
      // shadow is shrunk + faded once to match the constant flight elevation, so it reads as a
      // contact shadow cast from the air rather than a blob welded to the missile.
      const shadow = new Graphics();
      shadow.ellipse(0, 0, radius * 1.3, radius * 0.6).fill({ color: '#000000', alpha: 0.28 });
      container.addChild(shadow);
      view.shadowPlanted = { node: shadow, sx: 1, sy: 1, ox: 0, oy: 0, alpha: 1 };
      this.liftShadow(view, PROJECTILE_HEIGHT);
      if (strip && hasStrip) {
        const s = new Sprite(this.frame(strip.alias, 16, 16, 0, 0));
        s.anchor.set(0.5);
        s.scale.set(2.2);
        s.y = -PROJECTILE_HEIGHT;
        view.sprite = s;
        container.addChild(s);
      } else {
        const base = new Graphics();
        if (e.abilityId === 'arrow') base.moveTo(-10, 0).lineTo(10, 0).stroke({ width: 3, color });
        else {
          base.circle(0, 0, radius * 2).fill({ color, alpha: 0.25 });
          base.circle(0, 0, radius).fill({ color });
        }
        base.y = -PROJECTILE_HEIGHT;
        view.orb = base;
        container.addChild(base);
      }
      this.actorLayer.addChild(container);
      this.views.set(e.id, view);
    }
    view.seen = true;
    view.container.position.set(e.x, e.y * PITCH - this.groundLift(e.x, e.y));
    view.container.zIndex = e.y + 5000;
    if (view.sprite && strip && hasStrip) {
      const f = Math.floor(performance.now() / 80) % strip.frames;
      view.sprite.texture = this.frame(strip.alias, 16, 16, f, 0);
      view.sprite.rotation = e.facing;
    } else if (e.abilityId === 'arrow' && view.orb) {
      view.orb.rotation = e.facing;
    }
  }

  /** Pick the ground-drop icon for an item: gold scales with the stack, gems use their gem icon. */
  private itemIcon(e: EntityState): string | undefined {
    const id = e.itemId ?? '';
    if (id === 'gold') {
      const q = e.qty ?? 1;
      return q >= 50 ? 'item_gold_pile' : q >= 12 ? 'item_gold_stack' : 'item_gold';
    }
    if (id === 'rune_shard') return 'item_gem';
    if (id.startsWith('ruby')) return 'gem_ruby';
    if (id.startsWith('sapphire')) return 'gem_sapphire';
    if (id.startsWith('topaz')) return 'gem_topaz';
    if (id.startsWith('diamond')) return 'gem_diamond';
    return undefined;
  }

  private updateItem(e: EntityState): void {
    // Gear drops glint in their rarity color; materials fall back to their item color.
    const rarityColor = e.rarity ? RARITY[e.rarity as Rarity]?.color : undefined;
    const color =
      rarityColor ??
      ITEM_COLORS[e.itemId ?? ''] ??
      this.content.item(e.itemId ?? '')?.color ??
      '#cccccc';
    const alias = this.itemIcon(e);
    let view = this.views.get(e.id);
    if (!view) {
      const container = new Container();
      const shadow = new Graphics();
      shadow.ellipse(0, 0, 8, 4).fill({ color: '#000000', alpha: 0.3 });
      container.addChild(shadow);
      // Rarity glint: a static additive halo under the drop in its rarity color (brighter the rarer),
      // so a good drop reads from across the screen — the ARPG loot-pop. Drawn once (no per-frame
      // cost); the glow is hidden when effects are reduced, the top-tier name label always shows.
      const glint = lootGlint(e.rarity);
      if (this.effectsEnabled && glint.intensity > 0) {
        const glow = new Graphics();
        const r = 9 + glint.intensity * 8;
        glow.circle(0, -8, r).fill({ color: glint.color, alpha: 0.1 + glint.intensity * 0.16 });
        glow
          .circle(0, -8, r * 0.55)
          .fill({ color: glint.color, alpha: 0.12 + glint.intensity * 0.18 });
        glow.blendMode = 'add';
        container.addChild(glow);
      }
      // D2-style drop label for the genuinely exciting tiers (epic+ / unique / corrupted): the item's
      // name floats over the drop in its rarity color so you know it's worth the trip.
      if (glint.label) {
        const name = this.content.item(e.itemId ?? '')?.name ?? e.itemId ?? 'Item';
        const label = new Text({
          text: name,
          style: { fontFamily: 'system-ui', fontWeight: 'bold', fontSize: 11, fill: glint.color },
        });
        label.anchor.set(0.5, 1);
        label.position.set(0, -20);
        container.addChild(label);
      }
      view = {
        container,
        topY: 0,
        lastX: e.x,
        lastY: e.y,
        lastHp: 0,
        flashUntil: 0,
        seen: true,
        spawnT: performance.now(),
        // The flat ellipse drops at node scale/alpha 1 (its fill carries the 0.3 visible alpha), so
        // the height cue multiplies cleanly from this baseline as the drop pops + settles.
        shadowPlanted: { node: shadow, sx: 1, sy: 1, ox: 0, oy: 0, alpha: 1 },
      };
      if (alias && this.tex.has(alias)) {
        const s = new Sprite(this.tex.get(alias)!);
        s.anchor.set(0.5, 0.85);
        s.scale.set(0.6);
        view.sprite = s;
        container.addChild(s);
      } else {
        const base = new Graphics();
        base.circle(0, -8, 9).fill({ color, alpha: 0.25 });
        base.circle(0, -8, 4).fill({ color });
        view.orb = base;
        container.addChild(base);
      }
      this.actorLayer.addChild(container);
      this.views.set(e.id, view);
    }
    view.seen = true;
    view.container.position.set(e.x, e.y * PITCH - this.groundLift(e.x, e.y));
    view.container.zIndex = e.y;
    // Loot pop: the drop hops up and settles with a back-out overshoot when it first appears — the
    // easing gives it that satisfied little bounce on landing. The ground shadow shrinks + fades on
    // the way up and snaps tight as the icon lands, so the hop reads as real height (a shorter
    // falloff than actors since the pop arc is brief and sharp).
    const drop = view.sprite ?? view.orb;
    if (drop) {
      const age = performance.now() - (view.spawnT ?? 0);
      const t = age / LOOT_POP_MS;
      drop.y = t < 1 ? -Math.sin(t * Math.PI) * LOOT_POP_HEIGHT * (2 - backOut(t)) : 0;
      this.liftShadow(view, Math.max(0, -drop.y), LOOT_POP_HEIGHT * 1.7);
    }
  }

  /**
   * A wooden treasure chest with iron banding, drawn in the ENTITY path (it carries the live
   * `opened` state) — y-sorted with a soft ground shadow like other actors. Built once, then we just
   * toggle between a cached CLOSED body (lid down, with a faint warm sparkle so players notice it)
   * and a cached OPEN body (lid back, empty interior) when `opened` flips. The closed glint is a
   * cheap per-frame redraw off the renderer's clock (never Date.now/random). The authoritative chest
   * is THIS entity; its decor placement marker is skipped, so it never double-draws.
   */
  /**
   * A breakable pot: an authoritative entity (the live `broken` state is server-side — a smashed
   * pot simply leaves the snapshot, and the not-seen sweep clears its view). Its decor placement
   * marker is skipped in makeDecorProp, so it never double-draws.
   */
  private updatePot(e: EntityState): void {
    let view = this.views.get(e.id);
    if (!view) {
      const container = new Container();
      view = { container, topY: 0, lastX: e.x, lastY: e.y, lastHp: 0, flashUntil: 0, seen: true };
      if (!this.addDecorSprite(container, 'pot', e.x, e.y, 1)) {
        // Procedural amphora fallback when the curated sprite isn't loaded.
        const g = new Graphics();
        g.ellipse(0, -3, 8, 4).fill({ color: '#8a5a36' });
        g.ellipse(0, -10, 6, 7).fill({ color: '#a06a40' });
        g.ellipse(0, -16, 4, 2).fill({ color: '#6a4226' });
        this.propShadow(container, 8, 4);
        container.addChild(g);
      }
      this.actorLayer.addChild(container);
      this.views.set(e.id, view);
    }
    view.seen = true;
    view.container.position.set(e.x, e.y * PITCH - this.groundLift(e.x, e.y));
    view.container.zIndex = e.y;
  }

  /**
   * A den entrance (cellar hatch / hidden burrow): step onto it and the server descends you into
   * a fresh private mini-dungeon. Drawn as a dark pit with a stone rim and ladder rungs, labeled
   * so the find reads as a discovery.
   */
  private updateDen(e: EntityState): void {
    let view = this.views.get(e.id);
    if (!view) {
      const container = new Container();
      view = { container, topY: 0, lastX: e.x, lastY: e.y, lastHp: 0, flashUntil: 0, seen: true };
      const g = new Graphics();
      g.ellipse(0, 0, 26, 14).fill({ color: '#070605' });
      g.ellipse(0, 0, 26, 14).stroke({ width: 3, color: '#4a4038' });
      g.moveTo(-8, -5).lineTo(-8, 8).stroke({ width: 2, color: '#6a5a42' });
      g.moveTo(8, -5).lineTo(8, 8).stroke({ width: 2, color: '#6a5a42' });
      g.moveTo(-8, 1).lineTo(8, 1).stroke({ width: 2, color: '#6a5a42' });
      container.addChild(g);
      const label = new Text({
        text: e.name || 'Den',
        style: { fontFamily: 'system-ui', fontSize: 12, fill: '#cab98f' },
      });
      label.anchor.set(0.5, 1);
      label.position.set(0, -18);
      container.addChild(label);
      this.actorLayer.addChild(container);
      this.views.set(e.id, view);
    }
    view.seen = true;
    view.container.position.set(e.x, e.y * PITCH - this.groundLift(e.x, e.y));
    view.container.zIndex = e.y;
  }

  private updateChest(e: EntityState): void {
    let view = this.views.get(e.id);
    if (!view) {
      const container = new Container();
      // Soft directional ground shadow, matching the actors' baked-sun look.
      const shadow = new Sprite(this.softShadowTexture());
      shadow.anchor.set(0.5, 0.5);
      shadow.width = 36;
      shadow.height = 16;
      shadow.alpha = SHADOW_ALPHA;
      shadow.position.set(16 * SHADOW_OFFSET_X, 8 * SHADOW_OFFSET_Y);
      shadow.skew.x = SHADOW_SKEW;
      container.addChild(shadow);

      const closedG = this.drawChestClosed();
      const openG = this.drawChestOpen();
      // The closed-state glint (a faint warm sparkle), redrawn per frame; lives in the closed group.
      const glintG = new Graphics();
      closedG.addChild(glintG);

      container.addChild(closedG, openG);
      view = {
        container,
        shadow,
        closedG,
        openG,
        glintG,
        topY: -28,
        lastX: e.x,
        lastY: e.y,
        lastHp: 0,
        flashUntil: 0,
        seen: true,
        seed: hash2(e.id, e.id * 3) * 6.28,
      };
      this.actorLayer.addChild(container);
      this.views.set(e.id, view);
    }
    view.seen = true;
    view.container.position.set(e.x, e.y * PITCH - this.groundLift(e.x, e.y));
    view.container.zIndex = e.y;

    const opened = e.opened === true;
    // Toggle bodies only when the state actually changes (cheap: just visibility).
    if (view.chestOpened !== opened) {
      if (view.closedG) view.closedG.visible = !opened;
      if (view.openG) view.openG.visible = opened;
      view.chestOpened = opened;
    }
    // A faint warm sparkle on a closed chest so it reads as lootable; gone once opened.
    if (view.glintG) {
      if (opened) {
        view.glintG.clear();
      } else {
        const t = performance.now() / 1000;
        const pulse = 0.55 + 0.45 * Math.sin(t * 2.4 + (view.seed ?? 0));
        view.glintG.clear();
        // A soft halo over the lid plus a tiny twinkle on the lock — both breathing with the clock.
        view.glintG.circle(0, -14, 16).fill({ color: '#ffe7a8', alpha: 0.1 * pulse });
        view.glintG.circle(0, -11, 2.2 * (0.7 + 0.3 * pulse)).fill({
          color: '#fff3c8',
          alpha: 0.85 * pulse,
        });
      }
    }
  }

  /** The CLOSED chest body: a banded wooden box with a domed lid, iron lock, and corner straps. */
  private drawChestClosed(): Container {
    const c = new Container();
    const g = new Graphics();
    const wood = DECOR_PALETTE.wood;
    const woodDark = DECOR_PALETTE.woodDark;
    const woodLight = DECOR_PALETTE.woodLight;
    const iron = DECOR_PALETTE.iron;
    const ironLight = DECOR_PALETTE.ironLight;
    // Box body.
    g.rect(-16, -16, 32, 16).fill({ color: wood });
    g.rect(-16, -6, 32, 6).fill({ color: woodDark }); // shaded lower band
    // Domed lid (an arc) sitting on top of the body.
    g.moveTo(-16, -16).arc(0, -16, 16, Math.PI, 0).fill({ color: woodLight });
    g.moveTo(-16, -16).lineTo(16, -16).stroke({ width: 1.5, color: woodDark, alpha: 0.6 });
    // Iron banding: two vertical straps + a horizontal strap across the lid seam.
    for (const sx of [-9, 9]) g.rect(sx - 2, -26, 4, 26).fill({ color: iron });
    g.rect(-16, -17, 32, 3).fill({ color: iron });
    g.rect(-16, -17, 32, 1).fill({ color: ironLight, alpha: 0.6 });
    // Lock plate + keyhole at the front center.
    g.rect(-4, -13, 8, 7).fill({ color: ironLight });
    g.rect(-4, -13, 8, 7).stroke({ width: 1, color: '#2a2a30' });
    g.circle(0, -10, 1.4).fill({ color: '#1c1c20' });
    c.addChild(g);
    return c;
  }

  /** The OPEN chest body: the box with its lid tilted back and a dark, empty interior. */
  private drawChestOpen(): Container {
    const c = new Container();
    c.visible = false; // closed by default; updateChest flips visibility
    const g = new Graphics();
    const wood = DECOR_PALETTE.wood;
    const woodDark = DECOR_PALETTE.woodDark;
    const woodLight = DECOR_PALETTE.woodLight;
    const iron = DECOR_PALETTE.iron;
    // Box body (same footprint as closed).
    g.rect(-16, -16, 32, 16).fill({ color: wood });
    g.rect(-16, -6, 32, 6).fill({ color: woodDark });
    for (const sx of [-9, 9]) g.rect(sx - 2, -16, 4, 16).fill({ color: iron });
    // Hollow interior: a dark rim recessed into the open box (empty — the loot is gone).
    g.moveTo(-13, -16).arc(0, -16, 13, Math.PI, 0).fill({ color: '#1a130c' });
    g.ellipse(0, -16, 13, 4).fill({ color: '#0f0b07' });
    g.ellipse(0, -16, 13, 4).stroke({ width: 1, color: woodLight, alpha: 0.4 }); // lit inner edge
    // The lid, tilted back and up behind the box (a flattened dome rotated open).
    g.moveTo(-15, -28).arc(0, -28, 15, Math.PI, 0, true).fill({ color: woodLight });
    g.moveTo(-15, -28).lineTo(15, -28).stroke({ width: 1.5, color: woodDark, alpha: 0.6 });
    g.rect(-15, -29, 30, 3).fill({ color: iron }); // lid banding
    c.addChild(g);
    return c;
  }

  private updateFx(fx: TimedFx[]): void {
    const g = this.fxGfx;
    g.clear();
    const now = performance.now();
    let ti = 0;
    let ei = 0; // FX-strip pool index
    for (const { ev, t0 } of fx) {
      const age = (now - t0) / FX_DURATION;
      if (age >= 1) continue;
      const x = ev.x;
      const y = ev.y * PITCH;
      const alpha = 1 - age;
      if (ev.kind === 'hit' && ev.value !== undefined) {
        const t = this.fxText(ti++);
        const crit = ev.crit === true && ev.value > 0;
        t.visible = true;
        t.text = ev.value === 0 ? 'miss' : crit ? `${ev.value}!` : `${ev.value}`;
        t.style.fontSize = crit ? 26 : 16;
        t.style.fill =
          ev.value === 0
            ? '#9bbbbb'
            : crit
              ? '#ff5a3c' // crits pop in hot orange-red
              : ev.abilityId
                ? (this.content.ability(ev.abilityId)?.color ?? '#ffee66')
                : '#ffee66';
        t.alpha = alpha;
        // Crits float higher and faster so they read as a bigger moment.
        t.position.set(x, y - 50 - age * (crit ? 40 : 26));
      } else if (ev.kind === 'coin' && ev.value !== undefined) {
        // Gold gained (loot pickup / vendor sale): a rising "+N" in coin gold.
        const t = this.fxText(ti++);
        t.visible = true;
        t.text = `+${ev.value}`;
        t.style.fontSize = 15;
        t.style.fill = '#f2c14e';
        t.alpha = alpha;
        t.position.set(x, y - 40 - age * 24);
      } else if (ev.kind === 'heal' && ev.value !== undefined) {
        // HP restored (a health globe): a rising "+N" in life-red, with a soft expanding ring.
        g.circle(x, y - 16, 6 + age * 22).stroke({
          width: 2,
          color: '#ff5d6c',
          alpha: alpha * 0.7,
        });
        const t = this.fxText(ti++);
        t.visible = true;
        t.text = `+${ev.value}`;
        t.style.fontSize = 16;
        t.style.fill = '#ff6b78';
        t.alpha = alpha;
        t.position.set(x, y - 44 - age * 26);
      } else if (ev.kind === 'levelup') {
        // A gold burst ring + a "Level N!" callout rising over the player.
        g.circle(x, y - 16, 14 + age * 46).stroke({ width: 3, color: '#ffe08a', alpha });
        const t = this.fxText(ti++);
        t.visible = true;
        t.text = ev.value !== undefined ? `Level ${ev.value}!` : 'Level up!';
        t.style.fontSize = 22;
        t.style.fill = '#ffe08a';
        t.alpha = alpha;
        t.position.set(x, y - 56 - age * 30);
      } else if (ev.kind === 'pickup') {
        // A small expanding sparkle in the item's rarity color (white for materials).
        const c = ev.rarity ? (RARITY[ev.rarity as Rarity]?.color ?? '#dfe7f0') : '#dfe7f0';
        g.circle(x, y - 14, 4 + age * 16).stroke({ width: 2, color: c, alpha });
      } else if (ev.kind === 'telegraph') {
        // Attack wind-up: a red warning that builds as the strike nears, so the player can react.
        const tage = Math.min(1, (now - t0) / (ev.value ?? FX_DURATION));
        const warn = 0.25 + 0.55 * tage;
        if (ev.behavior === 'slam') {
          // An AoE danger circle that fills as it nears — leave the ring before it lands.
          const r = ev.radius ?? 80;
          g.circle(x, y - 16, r).stroke({ width: 2 + 2 * tage, color: '#ff4d4d', alpha: warn });
          g.circle(x, y - 16, r * tage).fill({ color: '#ff4d4d', alpha: warn * 0.2 });
        } else if (ev.behavior === 'ranged' && ev.facing !== undefined) {
          // An aimed line to side-step out of (ranged shots and charger lunges).
          const len = 60 + 220 * tage;
          g.moveTo(x, y - 16)
            .lineTo(x + Math.cos(ev.facing) * len, y - 16 + Math.sin(ev.facing) * len)
            .stroke({ width: 2 + 2 * tage, color: '#ff4d4d', alpha: warn });
        } else if (ev.facing !== undefined) {
          // A strike wedge in front of the mob to step out of.
          g.moveTo(x, y - 16)
            .arc(x, y - 16, 52, ev.facing - 0.6, ev.facing + 0.6)
            .lineTo(x, y - 16)
            .fill({ color: '#ff4d4d', alpha: warn * 0.5 });
        }
      } else if (ev.kind === 'slam') {
        // Impact: a fast expanding shock ring + an explosion burst at the slam point.
        const r = ev.radius ?? 80;
        g.circle(x, y - 16, r * (0.6 + 0.4 * age)).stroke({
          width: 5 * (1 - age),
          color: '#ff7a3c',
          alpha,
        });
        if (this.playStrip('explosion', x, ev.y * PITCH, t0, now, ei)) ei++;
      } else if (ev.kind === 'melee' && ev.facing !== undefined) {
        // A generated slash strip oriented at the swing; keeps the thin arc as a cheap fallback.
        if (this.playStrip('slash', x, ev.y * PITCH, t0, now, ei)) {
          this.explosionPool[ei]!.rotation = ev.facing;
          ei++;
        } else {
          g.arc(x, y - 16, 40, ev.facing - 0.7, ev.facing + 0.7).stroke({
            width: 4,
            color: '#ffffff',
            alpha,
          });
        }
      } else if (ev.kind === 'cast') {
        const c = ev.abilityId
          ? (this.content.ability(ev.abilityId)?.color ?? '#ffffff')
          : '#ffffff';
        g.circle(x, y - 16, 16 + age * 18).stroke({ width: 2, color: c, alpha: alpha * 0.7 });
        if (this.playStrip(this.castStripFor(c), x, ev.y * PITCH, t0, now, ei)) ei++;
      } else if (ev.kind === 'death') {
        if (this.playStrip('explosion', x, ev.y * PITCH, t0, now, ei)) ei++;
        else g.circle(x, y - 10, 10 + age * 40).stroke({ width: 3, color: '#ccaaaa', alpha });
      }
    }
    for (let i = ti; i < this.fxTexts.length; i++) this.fxTexts[i]!.visible = false;
    for (let i = ei; i < this.explosionPool.length; i++) this.explosionPool[i]!.visible = false;
  }

  private fxText(i: number): Text {
    let t = this.fxTexts[i];
    if (!t) {
      t = new Text({
        text: '',
        style: { fontFamily: 'system-ui', fontSize: 16, fontWeight: 'bold', fill: '#ffffff' },
      });
      t.anchor.set(0.5);
      this.fxTexts[i] = t;
      this.fxLayer.addChild(t);
    }
    return t;
  }

  /** A pooled sprite for the generic FX-strip player (RENDER/ASSET-FX combat effects). */
  private fxStripSprite(i: number): Sprite {
    let s = this.explosionPool[i];
    if (!s) {
      s = new Sprite(Texture.EMPTY);
      this.explosionPool[i] = s;
      this.fxLayer.addChild(s);
    }
    return s;
  }

  /**
   * Play a generated FX strip by key at world (x, worldY) for an event started at `t0`. Advances the
   * frame by elapsed time; sets blend + anchor per the strip. Returns false (so the caller can fall
   * back) when the strip's clip has finished or its texture isn't loaded. Cosmetic, client-only.
   */
  private playStrip(
    key: string,
    x: number,
    worldY: number,
    t0: number,
    now: number,
    i: number,
  ): boolean {
    const def = FX_STRIPS[key];
    const alias = `fxstrip:${key}`;
    if (!def || !this.tex.has(alias)) return false;
    const dur = def.frames * def.perFrameMs;
    const dt = now - t0;
    if (dt < 0 || dt >= dur) return false;
    const f = Math.min(def.frames - 1, Math.floor(dt / def.perFrameMs));
    const s = this.fxStripSprite(i);
    s.visible = true;
    s.texture = this.frame(alias, def.fw, def.fh, f, 0);
    s.blendMode = def.blend === 'add' ? 'add' : 'normal';
    s.anchor.set(0.5, def.anchor === 'feet' ? 1 : 0.5);
    s.scale.set(1);
    s.rotation = 0; // reset (the melee slash sets its own after this)
    s.position.set(x, def.anchor === 'feet' ? worldY : worldY - 16);
    return true;
  }

  /** Map an ability's color to the most fitting elemental FX strip (cast effects). */
  private castStripFor(color: string | undefined): string {
    if (!color) return 'holyNova';
    const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
    if (!m) return 'holyNova';
    const n = parseInt(m[1]!, 16);
    const r = (n >> 16) & 0xff;
    const gC = (n >> 8) & 0xff;
    const b = n & 0xff;
    if (b > r && b > gC) return r > gC ? 'lightning' : 'frost'; // blue/violet → arc, cyan → frost
    if (gC > r && gC > b) return 'poison'; // green
    if (r > 200 && gC > 180) return 'holyNova'; // bright/gold
    return 'explosion'; // warm/red
  }

  private makeProp(kind: Exclude<PropKind, 'none'>, x: number, y: number): Container {
    const c = new Container();
    c.position.set(x, y * PITCH - this.groundLift(x, y));
    c.zIndex = y;
    // Theme-density props share the curated decor sprites (trees, graves, mushrooms, crystals…).
    if (this.addDecorSprite(c, kind, x, y, 1)) return c;
    const g = new Graphics();
    g.ellipse(0, 0, 16, 7).fill({ color: '#000000', alpha: 0.28 });
    if (kind === 'tree') {
      g.rect(-3, -14, 6, 14).fill({ color: '#5a3a22' });
      g.circle(0, -22, 17).fill({ color: '#2f4a2a' });
      g.circle(-5, -27, 9).fill({ color: '#37562f' });
    } else if (kind === 'grave') {
      g.roundRect(-8, -26, 16, 26, 3).fill({ color: '#3a3a48' });
      g.rect(-2, -34, 4, 12).fill({ color: '#4a4a5c' });
    } else if (kind === 'bush') {
      g.circle(-6, -8, 9).fill({ color: '#2d432a' });
      g.circle(6, -8, 9).fill({ color: '#34502f' });
      g.circle(0, -13, 10).fill({ color: '#3a5836' });
    } else if (kind === 'mushroom') {
      g.rect(-2, -12, 4, 12).fill({ color: '#d8cfc0' });
      g.ellipse(0, -13, 11, 6).fill({ color: '#b1402f' });
      g.circle(-3, -14, 1.6).fill({ color: '#e8d9c0' });
      g.circle(3, -13, 1.6).fill({ color: '#e8d9c0' });
    } else if (kind === 'crystal') {
      g.poly([0, -30, 6, -10, 0, -4, -6, -10]).fill({ color: '#6fb6e0', alpha: 0.92 });
      g.poly([-7, -18, -3, -6, -9, -7]).fill({ color: '#9fd4f0', alpha: 0.85 });
    } else if (kind === 'pillar') {
      g.rect(-7, -40, 14, 40).fill({ color: '#5b5b66' });
      g.rect(-9, -44, 18, 6).fill({ color: '#6c6c78' });
      g.rect(-9, -4, 18, 6).fill({ color: '#46464f' });
    } else {
      g.ellipse(0, -8, 14, 10).fill({ color: '#3a3d42' });
    }
    c.addChild(g);
    return c;
  }

  /**
   * A soft radial ellipse shadow texture (black, fading to transparent), baked once and shared by
   * every actor. Soft edges read far more like a cast shadow than a hard `Graphics` ellipse, and
   * cost nothing per frame.
   */
  private softShadowTexture(): Texture {
    if (this.softShadow) return this.softShadow;
    const w = 128;
    const h = 64;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d')!;
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.9)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, h / w); // squash the radial gradient into a flat ellipse
    ctx.translate(-w / 2, -h / 2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
    this.softShadow = Texture.from(cv);
    return this.softShadow;
  }

  /**
   * The classic "missing texture" checkerboard (magenta/black), baked once. Substituted for any asset
   * that 404s or loads with no GPU resource, so a missing file shows a loud, obvious placeholder
   * instead of crashing the renderer on a null texture bind. Pixel-crisp (nearest) so it reads sharp.
   */
  private placeholderTexture(): Texture {
    if (this.placeholder) return this.placeholder;
    const n = 8; // checks per side
    const px = 8; // px per check
    const cv = document.createElement('canvas');
    cv.width = n * px;
    cv.height = n * px;
    const ctx = cv.getContext('2d')!;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#ff00dc' : '#101010';
        ctx.fillRect(x * px, y * px, px, px);
      }
    }
    this.placeholder = Texture.from(cv);
    this.placeholder.source.scaleMode = 'nearest';
    return this.placeholder;
  }

  /** A texture is usable only if it has a GPU-backed source; `Texture.EMPTY` (a failed load) is not. */
  private isUsableTexture(t: Texture | undefined): t is Texture {
    return !!t && !!t.source && !!t.source.resource;
  }

  /**
   * Bake (and cache) a real tiled-ground texture for an area from its biome tileset: a 16×16-tile
   * pattern of weight-picked floor tiles, upscaled to 32 world px per tile with crisp pixels. The
   * TilingSprite repeats the pattern across the screen. Returns undefined (→ procedural fallback)
   * when the area has no tileset mapping or its sheet failed to load.
   */
  private tiledGroundTexture(areaId: string, groundBase: string): Texture | undefined {
    const ts = groundTilesetFor(areaId, groundBase);
    if (!ts) return undefined; // no tileset mapped → intentional procedural ground
    const img = this.tileImages.get(ts.src);
    if (!img) return this.placeholderTexture(); // mapped sheet failed to load → loud checkerboard
    // Content-based key: biomes that share a sheet (town/forest both use forest_spring.png) differ in
    // their tile/blend lists, so keying on src alone collided and the second area reused the first bake.
    const key = `tiles:${ts.src}:${ts.tiles.map((t) => `${t.col},${t.row},${t.weight}`).join('|')}:${
      ts.blend
        ? `b${ts.blend.patch.map((p) => `${p.col},${p.row}`).join('.')}@${ts.blend.threshold}` +
          (ts.blend.path
            ? `p${ts.blend.path.tiles.map((p) => `${p.col},${p.row}`).join('.')}@${ts.blend.path.threshold}`
            : '')
        : ''
    }`;
    const cached = this.groundTextures.get(key);
    if (cached) return cached;
    const TILE_WORLD = 32; // world px per tile (16px art shown 2×, 32px art native)
    const N = PATTERN_TILES; // pattern tiles per side — the dirt-path layer is periodic over this
    const cv = document.createElement('canvas');
    cv.width = N * TILE_WORLD;
    cv.height = N * TILE_WORLD;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const drawCell = (col: number, row: number, gx: number, gy: number) => {
      ctx.drawImage(
        img,
        col * ts.tileSize,
        row * ts.tileSize,
        ts.tileSize,
        ts.tileSize,
        gx * TILE_WORLD,
        gy * TILE_WORLD,
        TILE_WORLD,
        TILE_WORLD,
      );
    };
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        // Base floor first (un-annotated tilesets stop here → byte-identical to before).
        const base = pickTile(ts, gx, gy);
        drawCell(base.col, base.row, gx, gy);
        if (ts.blend) {
          // Worn dirt trails next, faded in at their edges — under the detail patches so a wildflower
          // can still sit at a trail's grassy verge (seamless across the repeat — see pathCoverage).
          const pathCov = pathCoverage(ts, gx, gy);
          if (pathCov > 0.02) {
            const dirt = pathTileFor(ts, gx, gy);
            if (dirt) {
              ctx.globalAlpha = pathCov;
              drawCell(dirt.col, dirt.row, gx, gy);
              ctx.globalAlpha = 1;
            }
          }
          // Then fade a clustered detail patch over it where the biome-noise says so (RENDER-04).
          const cov = patchCoverage(ts, gx, gy);
          if (cov > 0.02) {
            const pt = patchTileFor(ts, gx, gy);
            if (pt) {
              ctx.globalAlpha = cov;
              drawCell(pt.col, pt.row, gx, gy);
              ctx.globalAlpha = 1;
            }
          }
        }
      }
    }
    const tex = Texture.from(cv);
    tex.source.scaleMode = 'nearest';
    this.groundTextures.set(key, tex);
    return tex;
  }

  /** Build (and cache) a tiled ground texture from the theme's base + speckle colors. */
  private groundTexture(base: string, speck: string): Texture {
    const key = `${base}|${speck}`;
    const cached = this.groundTextures.get(key);
    if (cached) return cached;
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = speck;
    for (let i = 0; i < 220; i++) {
      ctx.fillRect(
        Math.random() * size,
        Math.random() * size,
        2 + Math.random() * 3,
        2 + Math.random() * 3,
      );
    }
    const tex = Texture.from(cv);
    this.groundTextures.set(key, tex);
    return tex;
  }
}
