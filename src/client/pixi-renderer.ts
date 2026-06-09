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
import type { TimedFx } from './draw.js';
import type { ClientContentStore } from './content-store.js';
import { Atmosphere } from './atmosphere.js';
import { Weather } from './weather.js';
import { Lighting, type LightSource } from './lighting.js';
import { DEFAULT_THEME, type AreaTheme, type PropKind } from '../shared/theme.js';

/**
 * PixiJS renderer: a tilted top-down (RuneScape-pitch) 2.5D look. World coordinates are a flat
 * plane (x, y); we project to screen with a vertical foreshorten (PITCH). Actors are LPC sprite
 * sheets animated by `facing`; projectiles/items/impacts use sourced sprite strips — all with a
 * procedural fallback. Everything is y-sorted so nearer things overlap farther ones.
 */
const PITCH = 0.64;
const FX_DURATION = 700;
const EXPLOSION_MS = 600;
const WALK_FRAME_MS = 120;

// Light sources for the lighting overlay: the local player carries a warm torch, and portals glow.
const PLAYER_LIGHT = { radius: 190, color: 0xffd9a0 };
const PORTAL_LIGHT = { radius: 130, color: 0xc9a24b };

const ITEM_COLORS: Record<string, string> = {
  gold: '#f2c14e',
  wolf_pelt: '#9c7a4d',
  bone: '#e8e2d0',
  bat_wing: '#7a5a8a',
  rune_shard: '#5fb0e0',
};

type Dir = 'E' | 'S' | 'W' | 'N';

interface Sheet {
  src: string;
  fw: number;
  fh: number;
  scale: number;
  rows: Record<Dir, number>;
  walkCols: number[];
  idleCol: number;
}

const SHEETS: Record<string, Sheet> = {
  hero: {
    src: '/assets/sprites/hero_walk_lpc.png',
    fw: 64,
    fh: 64,
    scale: 0.7,
    rows: { N: 8, W: 9, S: 10, E: 11 },
    walkCols: [1, 2, 3, 4, 5, 6, 7, 8],
    idleCol: 0,
  },
  skeleton: {
    src: '/assets/sprites/skeleton_lpc.png',
    fw: 64,
    fh: 64,
    scale: 0.7,
    rows: { N: 8, W: 9, S: 10, E: 11 },
    walkCols: [1, 2, 3, 4, 5, 6, 7, 8],
    idleCol: 0,
  },
  wolf: {
    src: '/assets/sprites/wolf_lpc.png',
    fw: 64,
    fh: 64,
    scale: 0.75,
    rows: { N: 0, W: 1, S: 2, E: 3 },
    walkCols: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    idleCol: 0,
  },
  bat: {
    src: '/assets/sprites/bat.png',
    fw: 32,
    fh: 32,
    scale: 1.5,
    rows: { S: 0, W: 1, E: 2, N: 3 },
    walkCols: [0, 1, 2, 3],
    idleCol: 0,
  },
  boss: {
    src: '/assets/sprites/skeleton_lpc.png',
    fw: 64,
    fh: 64,
    scale: 1.6,
    rows: { N: 8, W: 9, S: 10, E: 11 },
    walkCols: [1, 2, 3, 4, 5, 6, 7, 8],
    idleCol: 0,
  },
};

/** Misc single/strip textures (spell FX + item icons). */
const MISC: Record<string, string> = {
  fx_fireball: '/assets/ui/fx/spell_fireball.png', // 96x16 -> 6 frames
  fx_frost: '/assets/ui/fx/spell_ice_lance.png', // 64x16 -> 4 frames
  fx_explosion: '/assets/ui/fx/explosion-cuzco.png', // 256x256 -> 4x4 @64
  fx_arcane: '/assets/ui/fx/spell_arcane_bolt.png', // 96x16 -> 6 frames
  item_gold: '/assets/ui/items/coin_gold.png', // 32x32
  item_gem: '/assets/ui/items/gem_crystal_shard.png', // 32x32
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

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 1000) / 1000;
}

function dirOf(facing: number): Dir {
  const q = ((Math.round(facing / (Math.PI / 2)) % 4) + 4) % 4;
  return (['E', 'S', 'W', 'N'] as const)[q]!;
}

function sheetKey(e: EntityState): string | undefined {
  if (e.kind === 'player' || e.kind === 'npc') return 'hero';
  if (e.kind === 'mob') {
    if (e.name.includes('Lord')) return 'boss';
    if (e.name.includes('Wolf')) return 'wolf';
    if (e.name.includes('Skeleton')) return 'skeleton';
    if (e.name.includes('Bat')) return 'bat';
  }
  return undefined;
}

export interface RenderState {
  areaId: string;
  entities: EntityState[];
  selfId: number;
  fx: TimedFx[];
  camX: number;
  camY: number;
}

interface ActorView {
  container: Container;
  sprite?: Sprite;
  orb?: Graphics;
  dyn?: Graphics;
  sheet?: Sheet;
  topY: number;
  lastX: number;
  lastY: number;
  lastHp: number;
  flashUntil: number;
  seen: boolean;
}

export class PixiRenderer {
  private readonly ground: TilingSprite;
  private readonly world = new Container();
  private readonly propLayer = new Container();
  private readonly actorLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly atmosphere = new Atmosphere();
  private readonly weather = new Weather();
  private readonly lighting = new Lighting();
  private readonly grade = new ColorMatrixFilter(); // per-area color grading (one pass on the world)
  private readonly fade = new Graphics();
  private readonly fxGfx = new Graphics();
  private readonly fxTexts: Text[] = [];
  private readonly explosionPool: Sprite[] = [];
  private readonly views = new Map<number, ActorView>();
  private currentArea = '';
  private currentTheme: AreaTheme = DEFAULT_THEME;
  private portalCenters: { x: number; y: number }[] = []; // world-space, for portal glow lights
  private shakeMag = 0; // current screen-shake amplitude (px), decays each frame
  private lastDeathT0 = 0; // newest death-FX timestamp already turned into a shake
  private fadeAlpha = 0; // area-change fade-from-black, eases 1 -> 0 on arrival
  private lastFrameAt = performance.now();
  private readonly groundTextures = new Map<string, Texture>();
  private readonly tex = new Map<string, Texture>(); // sheets + misc
  private readonly frameCache = new Map<string, Texture>();

  constructor(
    private readonly app: Application,
    private readonly content: ClientContentStore,
  ) {
    this.ground = new TilingSprite({ texture: Texture.WHITE, width: 100, height: 100 });
    this.actorLayer.sortableChildren = true;
    this.propLayer.sortableChildren = true;
    this.world.addChild(this.propLayer, this.actorLayer, this.fxLayer);
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
    const all = {
      ...Object.fromEntries(Object.entries(SHEETS).map(([a, s]) => [a, s.src])),
      ...MISC,
    };
    try {
      const loaded = await Assets.load(Object.entries(all).map(([alias, src]) => ({ alias, src })));
      for (const alias of Object.keys(all)) {
        const t = (loaded as Record<string, Texture>)[alias];
        if (t) this.tex.set(alias, t);
      }
    } catch {
      // leave tex empty -> procedural fallback
    }
  }

  /**
   * Force the next update() to re-run setArea even though the area id is unchanged — used when a
   * fresh content packet arrives (a live theme edit or hot reload) so the world re-skins in place.
   */
  invalidateArea(): void {
    this.currentArea = '';
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
    this.ground.texture = this.groundTexture(theme.groundBase, theme.groundSpeck);

    for (const child of this.propLayer.removeChildren()) child.destroy();

    this.portalCenters = [];
    for (const portal of area.portals) {
      const cx = portal.rect.x + portal.rect.w / 2;
      const cy = portal.rect.y + portal.rect.h / 2;
      this.portalCenters.push({ x: cx, y: cy });
      const pad = new Graphics();
      pad
        .ellipse(0, 0, portal.rect.w, portal.rect.h * PITCH)
        .fill({ color: '#c9a24b', alpha: 0.22 })
        .stroke({ width: 2, color: '#e7d9b0' });
      pad.position.set(cx, cy * PITCH);
      pad.zIndex = -100000;
      const label = new Text({
        text: portal.label,
        style: { fontFamily: 'system-ui', fontSize: 13, fill: '#e7d9b0' },
      });
      label.anchor.set(0.5, 1);
      label.position.set(cx, cy * PITCH - 6);
      label.zIndex = -99999;
      this.propLayer.addChild(pad, label);
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

    const originX = sw / 2 - state.camX + shX;
    const originY = sh / 2 - state.camY * PITCH + shY;
    this.world.position.set(originX, originY);
    this.ground.width = sw;
    this.ground.height = sh;
    this.ground.tilePosition.set(originX, originY);

    this.atmosphere.update(now, sw, sh);
    this.weather.update(now, sw, sh);

    // Dynamic lights (additive): the local player carries a torch at screen center; portals glow.
    // Strength scales with night + the area's ambient-light theme, so they matter after dark.
    const lights: LightSource[] = [
      { x: sw / 2 + shX, y: sh / 2 + shY, radius: PLAYER_LIGHT.radius, color: PLAYER_LIGHT.color },
    ];
    for (const p of this.portalCenters) {
      lights.push({
        x: p.x + originX,
        y: p.y * PITCH + originY,
        radius: PORTAL_LIGHT.radius,
        color: PORTAL_LIGHT.color,
      });
    }
    this.lighting.update(
      lights,
      sw,
      sh,
      this.atmosphere.nightFactor(),
      this.currentTheme.lightAmbient,
    );

    // Area-change fade-from-black, eased toward 0.
    this.fadeAlpha = Math.max(0, this.fadeAlpha - dt / FADE_SECONDS);
    this.fade.clear();
    if (this.fadeAlpha > 0.001)
      this.fade.rect(0, 0, sw, sh).fill({ color: 0x000000, alpha: this.fadeAlpha });

    for (const view of this.views.values()) view.seen = false;
    for (const e of state.entities) {
      if (e.kind === 'projectile') this.updateProjectile(e);
      else if (e.kind === 'item') this.updateItem(e);
      else this.updateActor(e, e.id === state.selfId);
    }
    for (const [id, view] of this.views) {
      if (!view.seen) {
        view.container.destroy({ children: true });
        this.views.delete(id);
      }
    }

    this.updateFx(state.fx);
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

    if (view.sprite && view.sheet) {
      const moving = Math.hypot(e.x - view.lastX, e.y - view.lastY) > 0.25;
      const sheet = view.sheet;
      const row = sheet.rows[dirOf(e.facing)];
      const t = performance.now();
      const col = moving
        ? sheet.walkCols[Math.floor(t / WALK_FRAME_MS) % sheet.walkCols.length]!
        : sheet.idleCol;
      view.sprite.texture = this.frame(sheetKey(e)!, sheet.fw, sheet.fh, col, row);
      // A small vertical bob — a quick footstep lift while moving, a slow breath while idle —
      // staggered per entity so a crowd doesn't pulse in lockstep. Sells the billboards as alive.
      const phase = e.id * 1.7;
      view.sprite.y = moving
        ? -Math.abs(Math.sin(t / 110 + phase)) * 2.5
        : Math.sin(t / 420 + phase) * 1.2;
    }
    view.lastX = e.x;
    view.lastY = e.y;

    // Hit-flash on HP drop, else status tint (burn > slow).
    const now = performance.now();
    if (e.hp < view.lastHp) view.flashUntil = now + FLASH_MS;
    view.lastHp = e.hp;
    if (view.sprite) {
      const flags = e.flags ?? 0;
      // Status/flash tints override; otherwise actors take the area's cohesive sprite tint.
      view.sprite.tint =
        e.kind === 'npc'
          ? 0xffd97a
          : now < view.flashUntil
            ? TINT_FLASH
            : flags & 2
              ? TINT_BURN
              : flags & 1
                ? TINT_SLOW
                : (this.currentTheme.spriteTint as ColorSource);
    }

    if (view.dyn && e.maxHp > 0) {
      const bw = (e.kind === 'mob' ? MOB_RADIUS : PLAYER_RADIUS) * 2.4;
      const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
      view.dyn.clear();
      view.dyn.rect(-bw / 2, view.topY - 6, bw, 4).fill({ color: '#000000', alpha: 0.6 });
      view.dyn.rect(-bw / 2, view.topY - 6, bw * frac, 4).fill({
        color: e.kind === 'mob' ? '#cc4444' : '#4caf50',
      });
    }
  }

  private makeActor(e: EntityState, isSelf: boolean): ActorView {
    const container = new Container();
    const radius = e.kind === 'mob' ? MOB_RADIUS : PLAYER_RADIUS;
    const shadow = new Graphics();
    shadow.ellipse(0, 0, radius, radius * 0.5).fill({ color: '#000000', alpha: 0.35 });
    if (isSelf) {
      shadow.ellipse(0, 0, radius + 3, radius * 0.5 + 2).stroke({ width: 2, color: '#c9a24b' });
    }
    container.addChild(shadow);

    const key = sheetKey(e);
    const sheet = key ? SHEETS[key] : undefined;
    const baseTex = key ? this.tex.get(key) : undefined;
    const view: ActorView = {
      container,
      dyn: new Graphics(),
      topY: -radius * 2.6,
      lastX: e.x,
      lastY: e.y,
      lastHp: e.hp,
      flashUntil: 0,
      seen: true,
    };

    if (sheet && baseTex) {
      const sprite = new Sprite(
        this.frame(key!, sheet.fw, sheet.fh, sheet.idleCol, sheet.rows[dirOf(e.facing)]),
      );
      sprite.anchor.set(0.5, 0.92);
      sprite.scale.set(sheet.scale);
      view.sprite = sprite;
      view.sheet = sheet;
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
    return view;
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

  private updateItem(e: EntityState): void {
    // Gear drops glint in their rarity color; materials fall back to their item color.
    const rarityColor = e.rarity ? RARITY[e.rarity as Rarity]?.color : undefined;
    const color =
      rarityColor ??
      ITEM_COLORS[e.itemId ?? ''] ??
      this.content.item(e.itemId ?? '')?.color ??
      '#cccccc';
    const alias =
      e.itemId === 'gold' ? 'item_gold' : e.itemId === 'rune_shard' ? 'item_gem' : undefined;
    let view = this.views.get(e.id);
    if (!view) {
      const container = new Container();
      const shadow = new Graphics();
      shadow.ellipse(0, 0, 8, 4).fill({ color: '#000000', alpha: 0.3 });
      container.addChild(shadow);
      view = { container, topY: 0, lastX: e.x, lastY: e.y, lastHp: 0, flashUntil: 0, seen: true };
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
