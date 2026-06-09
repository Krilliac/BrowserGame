import {
  Container,
  Graphics,
  Text,
  Texture,
  TilingSprite,
  type Application,
  type ColorSource,
} from 'pixi.js';
import { ABILITIES, MOB_RADIUS, PLAYER_RADIUS } from '../shared/combat.js';
import { areaOf } from '../shared/areas.js';
import type { EntityState } from '../shared/protocol.js';
import type { TimedFx } from './draw.js';

/**
 * PixiJS renderer for a tilted top-down (RuneScape-pitch) 2.5D look. World coordinates are a
 * flat plane (x, y); we project to screen with a vertical foreshorten (PITCH) and lift each
 * actor above its ground-contact shadow so it reads with depth. Actors are y-sorted so nearer
 * (lower) things overlap farther ones — the core 2.5D trick.
 */
const PITCH = 0.64; // ground foreshortening (~50deg camera pitch)
const FX_DURATION = 700;

interface Biome {
  base: string;
  speck: string;
  prop: 'tree' | 'grave' | 'rock';
  density: number;
}
const BIOMES: Record<string, Biome> = {
  town: { base: '#2f3b29', speck: '#3a4a32', prop: 'tree', density: 0.05 },
  wilderness: { base: '#1f2a1c', speck: '#27331f', prop: 'tree', density: 0.1 },
  crypt: { base: '#16161c', speck: '#20202a', prop: 'grave', density: 0.08 },
};

const ITEM_COLORS: Record<string, string> = {
  gold: '#f2c14e',
  wolf_pelt: '#9c7a4d',
  bone: '#e8e2d0',
  bat_wing: '#7a5a8a',
  rune_shard: '#5fb0e0',
};

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 1000) / 1000;
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
  base: Graphics;
  dyn: Graphics;
  isActor: boolean;
  seen: boolean;
}

export class PixiRenderer {
  private readonly ground: TilingSprite;
  private readonly world = new Container();
  private readonly propLayer = new Container();
  private readonly actorLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly fxGfx = new Graphics();
  private readonly fxTexts: Text[] = [];
  private readonly views = new Map<number, ActorView>();
  private currentArea = '';
  private readonly groundTextures = new Map<string, Texture>();

  constructor(private readonly app: Application) {
    this.ground = new TilingSprite({ texture: Texture.WHITE, width: 100, height: 100 });
    this.actorLayer.sortableChildren = true;
    this.propLayer.sortableChildren = true;
    this.world.addChild(this.propLayer, this.actorLayer, this.fxLayer);
    this.fxLayer.addChild(this.fxGfx);
    app.stage.addChild(this.ground, this.world);
  }

  /** Build ground + static props + portals for an area (once per area change). */
  setArea(areaId: string): void {
    if (areaId === this.currentArea) return;
    this.currentArea = areaId;
    const biome = BIOMES[areaId] ?? BIOMES.wilderness!;
    this.ground.texture = this.groundTexture(areaId, biome);

    for (const child of this.propLayer.removeChildren()) child.destroy();
    const area = areaOf(areaId);
    if (!area) return;

    for (const portal of area.portals) {
      const cx = portal.rect.x + portal.rect.w / 2;
      const cy = portal.rect.y + portal.rect.h / 2;
      const pad = new Graphics();
      pad
        .ellipse(0, 0, portal.rect.w, portal.rect.h * PITCH)
        .fill({ color: '#c9a24b', alpha: 0.22 })
        .stroke({ width: 2, color: '#e7d9b0' });
      pad.position.set(cx, cy * PITCH);
      pad.zIndex = -100000; // portals lie on the ground, behind all actors
      const label = new Text({
        text: portal.label,
        style: { fontFamily: 'system-ui', fontSize: 13, fill: '#e7d9b0' },
      });
      label.anchor.set(0.5, 1);
      label.position.set(cx, cy * PITCH - 6);
      label.zIndex = -99999;
      this.propLayer.addChild(pad, label);
    }

    const cell = 110;
    for (let gx = 0; gx * cell < area.width; gx++) {
      for (let gy = 0; gy * cell < area.height; gy++) {
        if (hash2(gx * 7 + 1, gy * 13 + 3) >= biome.density) continue;
        const px = gx * cell + hash2(gx, gy * 3) * cell;
        const py = gy * cell + hash2(gx * 5, gy) * cell;
        this.propLayer.addChild(this.makeProp(biome.prop, px, py));
      }
    }
  }

  /** Per-frame update from the latest interpolated snapshot. */
  update(state: RenderState): void {
    this.setArea(state.areaId);

    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const cx = sw / 2;
    const cy = sh / 2;

    this.world.position.set(cx - state.camX, cy - state.camY * PITCH);
    this.ground.width = sw;
    this.ground.height = sh;
    this.ground.tilePosition.set(cx - state.camX, cy - state.camY * PITCH);

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

  private updateActor(e: EntityState, isSelf: boolean): void {
    const radius = e.kind === 'mob' ? MOB_RADIUS : PLAYER_RADIUS;
    const raise = radius * 1.2;
    let view = this.views.get(e.id);
    if (!view) {
      view = this.makeActor(e, isSelf, radius, raise);
      this.actorLayer.addChild(view.container);
      this.views.set(e.id, view);
    }
    view.seen = true;
    view.container.position.set(e.x, e.y * PITCH);
    view.container.zIndex = e.y;

    const d = view.dyn;
    d.clear();
    const fx = Math.cos(e.facing);
    const fy = Math.sin(e.facing) * PITCH;
    d.moveTo(fx * radius * 0.6, -raise + fy * radius * 0.6)
      .lineTo(fx * (radius + 14), -raise + fy * (radius + 14))
      .stroke({ width: 4, color: e.kind === 'mob' ? '#ccaaaa' : '#d9c87a' });
    if (e.maxHp > 0) {
      const bw = radius * 2.2;
      const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
      d.rect(-bw / 2, -raise - radius - 8, bw, 4).fill({ color: '#000000', alpha: 0.6 });
      d.rect(-bw / 2, -raise - radius - 8, bw * frac, 4).fill({
        color: e.kind === 'mob' ? '#cc4444' : '#4caf50',
      });
    }
  }

  private makeActor(e: EntityState, isSelf: boolean, radius: number, raise: number): ActorView {
    const container = new Container();
    const base = new Graphics();
    base.ellipse(0, 0, radius, radius * 0.5).fill({ color: '#000000', alpha: 0.35 });
    const light = e.kind === 'mob' ? 44 : 56;
    base.circle(0, -raise, radius).fill({ color: `hsl(${e.hue} 60% ${light}%)` });
    base
      .circle(-radius * 0.3, -raise - radius * 0.3, radius * 0.45)
      .fill({ color: `hsl(${e.hue} 60% ${light + 14}%)` });
    base.circle(0, -raise, radius).stroke({
      width: isSelf ? 3 : 2,
      color: isSelf ? '#c9a24b' : '#000000',
      alpha: isSelf ? 1 : 0.55,
    });

    const dyn = new Graphics();
    const label = new Text({
      text: `${e.name}${e.level ? ` · L${e.level}` : ''}`,
      style: {
        fontFamily: 'system-ui',
        fontSize: 12,
        fill: e.kind === 'mob' ? '#e7b0b0' : '#e7e3d2',
      },
    });
    label.anchor.set(0.5, 1);
    label.position.set(0, -raise - radius - 12);
    container.addChild(base, dyn, label);
    return { container, base, dyn, isActor: true, seen: true };
  }

  private updateProjectile(e: EntityState): void {
    const ability = e.abilityId ? ABILITIES[e.abilityId] : undefined;
    const color = (ability?.color ?? '#ffffff') as ColorSource;
    const radius = ability?.radius ?? 6;
    let view = this.views.get(e.id);
    if (!view) {
      const container = new Container();
      const base = new Graphics();
      if (e.abilityId === 'arrow') {
        base.moveTo(-10, 0).lineTo(10, 0).stroke({ width: 3, color });
      } else {
        base.circle(0, 0, radius * 2).fill({ color, alpha: 0.25 });
        base.circle(0, 0, radius).fill({ color });
      }
      container.addChild(base);
      view = { container, base, dyn: base, isActor: false, seen: true };
      this.actorLayer.addChild(container);
      this.views.set(e.id, view);
    }
    view.seen = true;
    view.container.position.set(e.x, e.y * PITCH - 10);
    view.container.zIndex = e.y + 5000;
    if (e.abilityId === 'arrow') view.base.rotation = e.facing;
  }

  private updateItem(e: EntityState): void {
    const color = ITEM_COLORS[e.itemId ?? ''] ?? '#cccccc';
    let view = this.views.get(e.id);
    if (!view) {
      const container = new Container();
      const base = new Graphics();
      base.ellipse(0, 0, 8, 4).fill({ color: '#000000', alpha: 0.3 });
      base.circle(0, -8, 9).fill({ color, alpha: 0.25 });
      base.circle(0, -8, 4).fill({ color });
      container.addChild(base);
      view = { container, base, dyn: base, isActor: false, seen: true };
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
    let ti = 0;
    for (const { ev, t0 } of fx) {
      const age = (now - t0) / FX_DURATION;
      if (age >= 1) continue;
      const x = ev.x;
      const y = ev.y * PITCH;
      const alpha = 1 - age;
      if (ev.kind === 'hit' && ev.value !== undefined) {
        const t = this.fxText(ti++);
        t.visible = true;
        t.text = ev.value === 0 ? 'miss' : `${ev.value}`;
        t.style.fill =
          ev.value === 0 ? '#9bbbbb' : ev.abilityId ? ABILITIES[ev.abilityId]!.color : '#ffee66';
        t.alpha = alpha;
        t.position.set(x, y - 40 - age * 26);
      } else if (ev.kind === 'melee' && ev.facing !== undefined) {
        g.arc(x, y - 16, 40, ev.facing - 0.7, ev.facing + 0.7).stroke({
          width: 4,
          color: '#ffffff',
          alpha,
        });
      } else if (ev.kind === 'cast') {
        const c = ev.abilityId ? ABILITIES[ev.abilityId]!.color : '#ffffff';
        g.circle(x, y - 16, 16 + age * 18).stroke({ width: 2, color: c, alpha: alpha * 0.7 });
      } else if (ev.kind === 'death') {
        g.circle(x, y - 10, 10 + age * 40).stroke({ width: 3, color: '#ccaaaa', alpha });
      }
    }
    for (let i = ti; i < this.fxTexts.length; i++) this.fxTexts[i]!.visible = false;
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

  private makeProp(kind: Biome['prop'], x: number, y: number): Container {
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
    } else {
      g.ellipse(0, -8, 14, 10).fill({ color: '#3a3d42' });
    }
    c.addChild(g);
    return c;
  }

  private groundTexture(areaId: string, biome: Biome): Texture {
    const cached = this.groundTextures.get(areaId);
    if (cached) return cached;
    const size = 128;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = biome.base;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = biome.speck;
    for (let i = 0; i < 220; i++) {
      ctx.fillRect(
        Math.random() * size,
        Math.random() * size,
        2 + Math.random() * 3,
        2 + Math.random() * 3,
      );
    }
    const tex = Texture.from(cv);
    this.groundTextures.set(areaId, tex);
    return tex;
  }
}
