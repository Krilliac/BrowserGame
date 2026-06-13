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
  type TextureSource,
} from 'pixi.js';
import { MOB_RADIUS, PLAYER_RADIUS } from '../shared/combat.js';
import { RARITY, type Rarity } from '../shared/items.js';
import type { EntityState } from '../shared/protocol.js';
import { isDungeon, type DecorProp } from '../shared/areas.js';
import type { TimedFx } from './draw.js';
import type { ClientContentStore } from './content-store.js';
import { Atmosphere } from './atmosphere.js';
import { Weather } from './weather.js';
import { Lighting, type LightSource } from './lighting.js';
import { PostFx } from './post-fx.js';
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
  pickTile,
} from './ground-tiles.js';
import { DECOR_SPRITES, decorSprite } from './decor-sprites.js';
import { combineTints } from './tint.js';
import { backOut, cubicOut } from './easing.js';

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
const EXPLOSION_MS = 600;
const WALK_FRAME_MS = 120;

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
};

interface Sheet {
  src: string;
  fw: number;
  fh: number;
  scale: number;
  clips: ClipSet;
}

/**
 * The Universal LPC Spritesheet block layout (832×1344 = 21 rows): each animation block is 4 rows
 * in the order up(N)/left(W)/down(S)/right(E). spellcast 0–3, thrust 4–7, walk 8–11, slash 12–15,
 * shoot 16–19, hurt/death 20 (a single down-facing row whose last frame is the fallen pose).
 */
function lpcClips(): ClipSet {
  return {
    dirOrder: ['N', 'W', 'S', 'E'],
    clips: {
      idle: { row0: 8, startCol: 0, frames: 1, perFrameMs: 1, loop: true },
      walk: { row0: 8, startCol: 1, frames: 8, perFrameMs: WALK_FRAME_MS, loop: true },
      cast: { row0: 0, startCol: 0, frames: 7, perFrameMs: 70, loop: false },
      attack: { row0: 12, startCol: 0, frames: 6, perFrameMs: 60, loop: false },
      hurt: { row0: 20, startCol: 0, frames: 6, perFrameMs: 45, loop: false, dirless: true },
      death: { row0: 20, startCol: 0, frames: 6, perFrameMs: 75, loop: false, dirless: true },
    },
  };
}

const SHEETS: Record<string, Sheet> = {
  hero: { src: '/assets/sprites/hero_walk_lpc.png', fw: 64, fh: 64, scale: 0.7, clips: lpcClips() },
  skeleton: {
    src: '/assets/sprites/skeleton_lpc.png',
    fw: 64,
    fh: 64,
    scale: 0.7,
    clips: lpcClips(),
  },
  // Wolf: a 6-row walk-only sheet (4 directional walk rows). No action clips → falls back to walk.
  wolf: {
    src: '/assets/sprites/wolf_lpc.png',
    fw: 64,
    fh: 64,
    scale: 0.75,
    clips: {
      dirOrder: ['N', 'W', 'S', 'E'],
      clips: {
        idle: { row0: 0, startCol: 0, frames: 1, perFrameMs: 1, loop: true },
        walk: { row0: 0, startCol: 0, frames: 9, perFrameMs: WALK_FRAME_MS, loop: true },
      },
    },
  },
  // Bat: 32px 4×4 sheet, direction rows S/W/E/N, 4 flap frames.
  bat: {
    src: '/assets/sprites/bat.png',
    fw: 32,
    fh: 32,
    scale: 1.5,
    clips: {
      dirOrder: ['S', 'W', 'E', 'N'],
      clips: {
        idle: { row0: 0, startCol: 0, frames: 4, perFrameMs: WALK_FRAME_MS, loop: true },
        walk: { row0: 0, startCol: 0, frames: 4, perFrameMs: WALK_FRAME_MS, loop: true },
      },
    },
  },
  boss: { src: '/assets/sprites/skeleton_lpc.png', fw: 64, fh: 64, scale: 1.6, clips: lpcClips() },
};

/** Misc single/strip textures (spell FX + item icons). */
const MISC: Record<string, string> = {
  fx_fireball: '/assets/ui/fx/spell_fireball.png', // 96x16 -> 6 frames
  fx_frost: '/assets/ui/fx/spell_ice_lance.png', // 64x16 -> 4 frames
  fx_explosion: '/assets/ui/fx/explosion-cuzco.png', // 256x256 -> 4x4 @64
  fx_arcane: '/assets/ui/fx/spell_arcane_bolt.png', // 96x16 -> 6 frames
  item_gold: '/assets/ui/items/coin_gold.png', // 32x32 — a few coins
  item_gold_stack: '/assets/ui/items/coin_gold_stack.png', // a small stack
  item_gold_pile: '/assets/ui/items/coin_pile_large.png', // a big pile
  item_gem: '/assets/ui/items/gem_crystal_shard.png', // 32x32 (rune shard)
  gem_ruby: '/assets/ui/items/gem_ruby.png',
  gem_sapphire: '/assets/ui/items/gem_sapphire.png',
  gem_topaz: '/assets/ui/items/gem_amethyst.png', // amethyst icon stands in for topaz
  gem_diamond: '/assets/ui/items/gem_diamond.png',
};
const PROJ_STRIP: Record<string, { alias: string; frames: number }> = {
  fireball: { alias: 'fx_fireball', frames: 6 },
  frost: { alias: 'fx_frost', frames: 4 },
  lightning: { alias: 'fx_arcane', frames: 6 },
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
  return undefined;
}

/** Elevation (px) a flying monster floats above the ground, separating it from its planted shadow. */
function flyHeight(e: EntityState): number {
  return e.kind === 'mob' && FLYER_RE.test(e.name) ? 16 : 0;
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
}

interface ActorView {
  container: Container;
  sprite?: Sprite;
  orb?: Graphics;
  dyn?: Graphics;
  /** Soft, directional ground shadow (leans away from a fixed sun — the D2 "planted" cue). */
  shadow?: Sprite;
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
  // Bloom on the additive light overlay (torch, portals, spell glow). Quality-gated for phones.
  private readonly postFx = new PostFx(navigator.maxTouchPoints > 0 ? 'low' : 'high');
  private readonly grade = new ColorMatrixFilter(); // per-area color grading (one pass on the world)
  private readonly fade = new Graphics();
  private readonly fxGfx = new Graphics();
  private readonly fxTexts: Text[] = [];
  private readonly explosionPool: Sprite[] = [];
  private readonly views = new Map<number, ActorView>();
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
  private effectsEnabled = true; // false hides weather + ambient motes ("reduce effects" setting)
  private shakeMag = 0; // current screen-shake amplitude (px), decays each frame
  private lastDeathT0 = 0; // newest death-FX timestamp already turned into a shake
  private lastAnimT0 = 0; // newest FX timestamp already turned into a one-shot animation
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
    this.world.addChild(this.propLayer, this.actorLayer, this.fxLayer, this.roofLayer);
    this.fxLayer.addChild(this.fxGfx);
    this.fade.eventMode = 'none';
    // Draw order (back→front): ground, world, ambient motes, weather, the screen wash (day/night +
    // mood tint + vignette darkening), then additive LIGHTS on top so torch/portal glow punches
    // through the darkness, and finally the area-change fade covering everything mid-transition.
    app.stage.addChild(
      this.ground,
      this.world,
      this.atmosphere.particleLayer,
      this.weather.layer,
      this.atmosphere.screen,
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
      ...MISC,
      rogues32: ROGUES_SHEET.src,
      monsters32: MONSTERS_SHEET.src,
      animals32: ANIMALS_SHEET.src,
      ...Object.fromEntries([...decorSrcs].map((src) => [src, src])),
    };
    // Load every texture INDEPENDENTLY: a single failed fetch (a dev-server blip, a missing
    // file) must only cost that one sprite its art — never the whole game. A batched
    // Assets.load rejects wholesale, which once orbed every actor over one dropped request.
    await Promise.allSettled(
      Object.entries(all).map(async ([alias, src]) => {
        const t = (await Assets.load({ alias, src })) as Texture;
        if (t) this.tex.set(alias, t);
      }),
    );
    // The 32px sheets and decor cutouts are pixel art — keep them crisp when scaled.
    for (const alias of ['rogues32', 'monsters32', 'animals32', ...decorSrcs]) {
      const t = this.tex.get(alias);
      if (t) t.source.scaleMode = 'nearest';
    }
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

  setArea(areaId: string): void {
    if (areaId === this.currentArea) return;
    const area = this.content.area(areaId);
    if (!area) return; // content packet not loaded yet — retry next frame
    this.currentArea = areaId;
    const theme = area.theme ?? DEFAULT_THEME;
    this.currentTheme = theme;
    this.atmosphere.setArea(theme);
    this.weather.setWeather(theme.weather, theme.weatherIntensity, theme.fogColor);
    this.applyGrade(theme);
    this.fadeAlpha = 1; // brief fade-from-black as the new area pops in
    // Real tiled ground where a biome tileset exists; the procedural speckle is the fallback.
    this.ground.texture =
      this.tiledGroundTexture(areaId, theme.groundBase) ??
      this.groundTexture(theme.groundBase, theme.groundSpeck);

    for (const child of this.propLayer.removeChildren()) child.destroy();
    // Roofs live in their own layer above the actors — clear them too so leaving the area never
    // leaks a previous area's house roofs over the new scene.
    for (const child of this.roofLayer.removeChildren()) child.destroy();

    this.portalCenters = [];
    this.decorLights = [];
    this.fireFlames = [];
    this.animatedProps = [];
    this.shrineOrbs = [];
    this.houses = [];
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
          this.propLayer.addChild(this.makeProp(prop, px, py));
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
    // Draw line props (the palisade) first so point props layer over their bases naturally; the
    // y-sort handles final ordering regardless, but this keeps the back wall reading as a backdrop.
    for (const prop of decor) this.propLayer.addChild(this.makeDecorProp(prop));
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
    // Line props (palisade) anchor at their midpoint; point props at (x,y). The container's zIndex
    // is the world y of its anchor, so props sort against actors by depth (the back wall sits high).
    const line = prop.x2 !== undefined && prop.y2 !== undefined;
    const ax = line ? (prop.x + prop.x2!) / 2 : prop.x;
    const ay = line ? (prop.y + prop.y2!) / 2 : prop.y;
    c.position.set(ax, ay * PITCH);
    c.zIndex = ay;
    const scale = prop.scale ?? 1;

    // Real decor sprites (curated pack cutouts) where one exists for the kind — the variant is
    // picked deterministically from the prop's position, so a row of graves doesn't repeat. Kinds
    // with no mapping (or a failed texture) keep their procedural draw below. Pots are excluded:
    // they are authoritative ENTITIES (breakable), drawn in the entity path like chests.
    if (prop.kind !== 'pot' && this.addDecorSprite(c, prop.kind, prop.x, prop.y, scale, prop.color))
      return c;

    switch (prop.kind) {
      case 'palisade':
        this.drawPalisade(c, prop.x, prop.y, prop.x2!, prop.y2!, ax, ay);
        break;
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
    c.position.set(cx, cy * PITCH);
    c.zIndex = cy;
    this.propShadow(c, 14, 6);
    const g = new Graphics();
    if (isDungeon(toArea)) {
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

  /**
   * A spiked palisade wall: a run of pointed vertical stakes from (x1,y1) to (x2,y2), lashed with a
   * rope rail. Billboarded upward so the stakes stand against the ground (the camp's defensive ring).
   */
  private drawPalisade(
    c: Container,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    ax: number,
    ay: number,
  ): void {
    // Endpoints relative to the container origin (the run's midpoint), projected to the pitch.
    const lx1 = x1 - ax;
    const ly1 = (y1 - ay) * PITCH;
    const lx2 = x2 - ax;
    const ly2 = (y2 - ay) * PITCH;
    const len = Math.hypot(lx2 - lx1, ly2 - ly1);
    const steps = Math.max(1, Math.round(len / 16)); // a stake roughly every 16px along the run

    // A soft strip shadow under the whole run (a stretched ellipse along the segment).
    const sh = new Sprite(this.softShadowTexture());
    sh.anchor.set(0.5, 0.5);
    sh.width = len + 24;
    sh.height = 16;
    sh.alpha = SHADOW_ALPHA * 0.8;
    sh.rotation = Math.atan2(ly2 - ly1, lx2 - lx1);
    sh.position.set((lx1 + lx2) / 2 + 6, (ly1 + ly2) / 2 + 4);
    sh.skew.x = SHADOW_SKEW;
    c.addChild(sh);

    const g = new Graphics();
    const stakeH = 40;
    // A back rope/rail lashing the stakes together, drawn first so the stakes overlap it.
    g.moveTo(lx1, ly1 - stakeH * 0.6)
      .lineTo(lx2, ly2 - stakeH * 0.6)
      .stroke({ width: 2, color: DECOR_PALETTE.rope, alpha: 0.8 });
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = lx1 + (lx2 - lx1) * t;
      const py = ly1 + (ly2 - ly1) * t;
      const w = 5;
      // The stake body, then a sharpened point on top, with a darker shaded side for round logs.
      g.rect(px - w / 2, py - stakeH, w, stakeH).fill({ color: DECOR_PALETTE.wood });
      g.rect(px - w / 2, py - stakeH, 2, stakeH).fill({ color: DECOR_PALETTE.woodDark });
      g.poly([px - w / 2, py - stakeH, px + w / 2, py - stakeH, px, py - stakeH - 7]).fill({
        color: DECOR_PALETTE.woodLight,
      });
    }
    c.addChild(g);
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
    c.position.set(minX, minY * PITCH);
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
    roof.position.set(minX, minY * PITCH);
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
    if (identity) {
      this.world.filters = [];
      return;
    }
    const f = this.grade;
    f.reset();
    f.brightness(theme.gradeBrightness, false); // 1 = unchanged
    f.contrast(theme.gradeContrast - 1, true); // 0 = unchanged
    f.saturate(theme.gradeSaturation - 1, true); // 0 = unchanged
    this.world.filters = [f];
  }

  update(state: RenderState): void {
    this.setArea(state.areaId);

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

    // Fade house roofs based on whether the LOCAL player stands inside each footprint. Uses the
    // authoritative self entity's world position (the camera trails it, so the actual entity is the
    // truthful test). Eased frame-rate-independently off `dt` — no Date.now()/Math.random().
    this.updateHouseRoofs(state.entities, state.selfId, dt);
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

  private updateActor(e: EntityState, isSelf: boolean): void {
    let view = this.views.get(e.id);
    if (!view) {
      view = this.makeActor(e, isSelf);
      this.actorLayer.addChild(view.container);
      this.views.set(e.id, view);
    }
    view.seen = true;
    view.container.position.set(e.x, e.y * PITCH);
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
      // A small vertical bob — a quick footstep lift while moving, a slow breath while idle —
      // staggered per entity so a crowd doesn't pulse in lockstep. Sells the billboards as alive.
      const phase = e.id * 1.7;
      const fly = flyHeight(e);
      view.sprite.y = fly
        ? -fly + Math.sin(now / 300 + phase) * 2 // flyers hover well above their planted shadow
        : moving
          ? -Math.abs(Math.sin(now / 110 + phase)) * 2.5
          : Math.sin(now / 420 + phase) * 1.2;
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
    // The local player keeps a thin gold ground-ring so you can always pick yourself out.
    if (isSelf) {
      const ring = new Graphics();
      ring.ellipse(0, 0, radius + 3, radius * 0.5 + 2).stroke({ width: 2, color: '#c9a24b' });
      container.addChild(ring);
    }

    const key = sheetKey(e);
    const sheet = key ? SHEETS[key] : undefined;
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
    const strip = e.abilityId ? PROJ_STRIP[e.abilityId] : undefined;
    const hasStrip = strip ? this.tex.has(strip.alias) : false;

    let view = this.views.get(e.id);
    if (!view) {
      const container = new Container();
      view = { container, topY: 0, lastX: e.x, lastY: e.y, lastHp: 0, flashUntil: 0, seen: true };
      // Ground shadow on the plane; the projectile itself rides above it (a 2.5D height cue).
      const shadow = new Graphics();
      shadow.ellipse(0, 0, radius * 1.3, radius * 0.6).fill({ color: '#000000', alpha: 0.28 });
      container.addChild(shadow);
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
    view.container.position.set(e.x, e.y * PITCH);
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
      view = {
        container,
        topY: 0,
        lastX: e.x,
        lastY: e.y,
        lastHp: 0,
        flashUntil: 0,
        seen: true,
        spawnT: performance.now(),
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
    view.container.position.set(e.x, e.y * PITCH);
    view.container.zIndex = e.y;
    // Loot pop: the drop hops up and settles with a back-out overshoot when it first appears
    // (shadow stays planted) — the easing gives it that satisfied little bounce on landing.
    const drop = view.sprite ?? view.orb;
    if (drop) {
      const age = performance.now() - (view.spawnT ?? 0);
      const t = age / LOOT_POP_MS;
      drop.y = t < 1 ? -Math.sin(t * Math.PI) * LOOT_POP_HEIGHT * (2 - backOut(t)) : 0;
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
    view.container.position.set(e.x, e.y * PITCH);
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
    view.container.position.set(e.x, e.y * PITCH);
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
    view.container.position.set(e.x, e.y * PITCH);
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
    const hasExplosion = this.tex.has('fx_explosion');
    let ti = 0;
    let ei = 0;
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
        // Impact: a fast expanding shock ring at the slam radius.
        const r = ev.radius ?? 80;
        g.circle(x, y - 16, r * (0.6 + 0.4 * age)).stroke({
          width: 5 * (1 - age),
          color: '#ff7a3c',
          alpha,
        });
      } else if (ev.kind === 'melee' && ev.facing !== undefined) {
        g.arc(x, y - 16, 40, ev.facing - 0.7, ev.facing + 0.7).stroke({
          width: 4,
          color: '#ffffff',
          alpha,
        });
      } else if (ev.kind === 'cast') {
        const c = ev.abilityId
          ? (this.content.ability(ev.abilityId)?.color ?? '#ffffff')
          : '#ffffff';
        g.circle(x, y - 16, 16 + age * 18).stroke({ width: 2, color: c, alpha: alpha * 0.7 });
      } else if (ev.kind === 'death') {
        const da = (now - t0) / EXPLOSION_MS;
        if (hasExplosion && da < 1) {
          const s = this.explosion(ei++);
          s.visible = true;
          const f = Math.min(15, Math.floor(da * 16));
          s.texture = this.frame('fx_explosion', 64, 64, f % 4, Math.floor(f / 4));
          s.position.set(x, y - 16);
        } else if (!hasExplosion) {
          g.circle(x, y - 10, 10 + age * 40).stroke({ width: 3, color: '#ccaaaa', alpha });
        }
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

  private explosion(i: number): Sprite {
    let s = this.explosionPool[i];
    if (!s) {
      s = new Sprite(this.frame('fx_explosion', 64, 64, 0, 0));
      s.anchor.set(0.5);
      s.scale.set(1.1);
      this.explosionPool[i] = s;
      this.fxLayer.addChild(s);
    }
    return s;
  }

  private makeProp(kind: Exclude<PropKind, 'none'>, x: number, y: number): Container {
    const c = new Container();
    c.position.set(x, y * PITCH);
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
   * Bake (and cache) a real tiled-ground texture for an area from its biome tileset: a 16×16-tile
   * pattern of weight-picked floor tiles, upscaled to 32 world px per tile with crisp pixels. The
   * TilingSprite repeats the pattern across the screen. Returns undefined (→ procedural fallback)
   * when the area has no tileset mapping or its sheet failed to load.
   */
  private tiledGroundTexture(areaId: string, groundBase: string): Texture | undefined {
    const ts = groundTilesetFor(areaId, groundBase);
    if (!ts) return undefined;
    const img = this.tileImages.get(ts.src);
    if (!img) return undefined;
    // Content-based key: biomes that share a sheet (town/forest both use forest_spring.png) differ in
    // their tile/blend lists, so keying on src alone collided and the second area reused the first bake.
    const key = `tiles:${ts.src}:${ts.tiles.map((t) => `${t.col},${t.row},${t.weight}`).join('|')}:${
      ts.blend
        ? `b${ts.blend.patch.map((p) => `${p.col},${p.row}`).join('.')}@${ts.blend.threshold}`
        : ''
    }`;
    const cached = this.groundTextures.get(key);
    if (cached) return cached;
    const TILE_WORLD = 32; // world px per tile (16px art shown 2×, 32px art native)
    const N = 16; // pattern tiles per side — big enough that the repeat reads as natural ground
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
        // Then fade a clustered detail patch over it where the biome-noise says so (RENDER-04).
        if (ts.blend) {
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
