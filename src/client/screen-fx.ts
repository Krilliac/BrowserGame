/**
 * Per-area screen-space polish filters (RENDER-10 godrays, RENDER-12 LUT grade, RENDER-13 heat haze).
 *
 * These are drop-in `pixi-filters` effects gated two ways: by render quality (all off on 'low'/touch)
 * and by a per-area config registry (`AREA_SCREEN_FX`). The registry is EMPTY by default, so today no
 * area enables any of them and the scene is unchanged — exactly like RENDER-01's normal-map rollout.
 * Enable an effect by adding an entry here (cosmetic + client-only, so it lives on the client, mirroring
 * the `NORMAL_OVERRIDES` pattern). The values were left conservative so enabling one reads as a subtle
 * art-direction touch rather than a wash.
 *
 *  - godrays: volumetric light shafts over a screen overlay — outdoor / portal mood.
 *  - heat:    a scrolling-noise DisplacementFilter that gently wobbles the world (forges, lava).
 *  - lut:     a ColorMapFilter LUT replacing the ColorMatrix grade for richer art-directed color.
 *             Needs a LUT texture to be loaded; absent → the ColorMatrix grade stays (the fallback).
 */

import { Container, DisplacementFilter, Sprite, Texture, type Filter } from 'pixi.js';
import { ColorMapFilter, GodrayFilter } from 'pixi-filters';
import type { Quality } from './post-fx.js';

export interface AreaScreenFx {
  /** Volumetric light-shaft intensity 0..1 (RENDER-10). */
  godrays?: number;
  /** Heat-haze displacement strength 0..1 (RENDER-13). */
  heat?: number;
  /** LUT texture src for art-directed color grading (RENDER-12); falls back to ColorMatrix if unloaded. */
  lut?: string;
}

/** Per-area screen-FX overrides. Defaults (e.g. outdoor godrays) are applied in `effectiveFx`; an
 *  entry here overrides them for a specific area (set `godrays: 0` to suppress, higher for portals). */
export const AREA_SCREEN_FX: Record<string, AreaScreenFx> = {
  // Portal/crossing-heavy areas read well with stronger shafts.
  town: { godrays: 0.4 },
};

/** Subtle default light-shaft intensity for outdoor areas (RENDER-10) when no override is set. */
export const OUTDOOR_GODRAYS = 0.28;

/** Raw per-area override config (or empty). Accepts instance ids `area#seq`. */
export function screenFxFor(areaId: string): AreaScreenFx {
  const base = areaId.split('#', 1)[0] ?? areaId;
  return AREA_SCREEN_FX[base] ?? {};
}

/**
 * The effective config for an area: the per-area override merged over the outdoor-godrays default,
 * so every outdoor area gets subtle shafts unless it opts out. `outdoor` comes from the area theme.
 */
export function effectiveFx(areaId: string, outdoor: boolean): AreaScreenFx {
  const override = screenFxFor(areaId);
  const godrays = override.godrays ?? (outdoor ? OUTDOOR_GODRAYS : 0);
  return { ...override, godrays };
}

/** Which effects are active for a config at a quality tier — pure, so the gating is unit-tested. */
export function activeScreenEffects(
  cfg: AreaScreenFx,
  quality: Quality,
): { godrays: boolean; heat: boolean } {
  if (quality === 'low') return { godrays: false, heat: false };
  return { godrays: (cfg.godrays ?? 0) > 0, heat: (cfg.heat ?? 0) > 0 };
}

/**
 * Owns the optional screen filters and wires them to the layers the renderer binds. The godray runs
 * on a screen overlay; the heat haze and LUT compose onto the world (the renderer asks for them when
 * rebuilding `world.filters`, so the existing ColorMatrix grade is never clobbered).
 */
export class ScreenFx {
  private readonly quality: Quality;
  /**
   * Godrays render as a DEDICATED additive screen overlay (a full-screen white sprite the
   * GodrayFilter turns into bright ray streaks; additive blend then adds only the shafts to the
   * scene below). This keeps them screen-space and subtle, and never washes the scene the way
   * filtering the mood-tint layer did. The renderer adds `godrayLayer` to the stage above the world.
   */
  readonly godrayLayer = new Container();
  private readonly godraySprite = new Sprite(Texture.WHITE);
  private godray?: GodrayFilter;
  private heat?: DisplacementFilter;
  private heatSprite?: Sprite;
  private cfg: AreaScreenFx = {};
  private readonly luts = new Map<string, Texture>();

  constructor(quality: Quality) {
    this.quality = quality;
    this.godrayLayer.eventMode = 'none';
    this.godrayLayer.visible = false;
    // The GodrayFilter outputs ray streaks over a black base. We composite that output ADDITIVELY
    // (blendMode on the FILTER — a sprite's own blendMode doesn't propagate through a filter in v8),
    // so the black gaps add nothing and only the bright shafts lighten the scene behind.
    this.godraySprite.tint = 0x000000;
    this.godrayLayer.addChild(this.godraySprite);
  }

  /** Register a loaded LUT texture so areas referencing it grade through a ColorMapFilter. */
  addLut(src: string, tex: Texture): void {
    this.luts.set(src, tex);
  }

  /** Switch to an area. `outdoor` (from the area theme) drives the default godray shafts. World
   *  filters (LUT/heat) are pulled separately by the renderer when it rebuilds `world.filters`. */
  setArea(areaId: string, outdoor: boolean): void {
    this.cfg = effectiveFx(areaId, outdoor);
    const on = activeScreenEffects(this.cfg, this.quality);
    if (on.godrays) {
      const intensity = this.cfg.godrays ?? 0;
      if (!this.godray) {
        this.godray = new GodrayFilter({ gain: 0.35, lacunarity: 2.5, alpha: 1 });
        this.godray.blendMode = 'add'; // composite the ray output additively over the scene
      }
      this.godray.gain = 0.45 * intensity; // ray contrast scales with intensity
      this.godraySprite.filters = [this.godray];
      this.godraySprite.alpha = 0.6 * intensity; // overall shaft strength (subtle)
      this.godrayLayer.visible = true;
    } else {
      this.godrayLayer.visible = false;
    }
  }

  /**
   * The color-grade filter for the current area: the area's LUT ColorMapFilter when one is loaded,
   * otherwise `fallback` (the renderer's ColorMatrix grade). LUT is the RENDER-12 capability; with no
   * LUT registered it returns the fallback unchanged.
   */
  gradeFilter(fallback: Filter | null): Filter | null {
    const src = this.cfg.lut;
    if (src) {
      const tex = this.luts.get(src);
      if (tex) return new ColorMapFilter({ colorMap: tex, nearest: false });
    }
    return fallback;
  }

  /** The heat-haze filter to compose onto the world this area, or null when inactive. */
  heatFilter(): Filter | null {
    const on = activeScreenEffects(this.cfg, this.quality);
    if (!on.heat) return null;
    this.ensureHeat();
    const s = 6 * (this.cfg.heat ?? 0);
    this.heat!.scale.x = s;
    this.heat!.scale.y = s;
    return this.heat!;
  }

  /** Animate the active effects and keep the godray overlay sized to the screen. */
  update(now: number, sw: number, sh: number): void {
    if (this.godrayLayer.visible) {
      this.godraySprite.width = sw;
      this.godraySprite.height = sh;
      if (this.godray) this.godray.time = now / 1000;
    }
    if (this.heatSprite) {
      this.heatSprite.x = Math.sin(now / 900) * 24;
      this.heatSprite.y = -((now / 28) % 256);
    }
  }

  private ensureHeat(): void {
    if (this.heat) return;
    this.heatSprite = new Sprite(makeNoiseTexture());
    this.heatSprite.texture.source.addressMode = 'repeat';
    // The displacement sprite must live in the scene graph for its transform; it never draws visibly.
    this.godrayLayer.addChild(this.heatSprite);
    this.heat = new DisplacementFilter({ sprite: this.heatSprite, scale: 0 });
  }

  destroy(): void {
    this.heatSprite?.destroy();
    this.godrayLayer.destroy({ children: true });
    for (const t of this.luts.values()) t.destroy(true);
    this.luts.clear();
  }
}

/** A small tiling value-noise texture used as the heat-haze displacement map. */
function makeNoiseTexture(): Texture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  // Smooth-ish noise: low-frequency sine interference, written to R/G so x/y displace independently.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = (Math.sin(x / 16) + Math.sin((x + y) / 22)) * 0.5;
      const ny = (Math.sin(y / 14) + Math.sin((x - y) / 26)) * 0.5;
      img.data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(cv);
}
