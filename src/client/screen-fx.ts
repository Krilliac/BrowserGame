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

import { DisplacementFilter, Sprite, Texture, type Container, type Filter } from 'pixi.js';
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

/** Per-area screen-FX config. Empty by default — add an area id to light it up. Accepts base ids. */
export const AREA_SCREEN_FX: Record<string, AreaScreenFx> = {};

/** Resolve an area (or instance `area#seq`) to its screen-FX config, or empty when none. */
export function screenFxFor(areaId: string): AreaScreenFx {
  const base = areaId.split('#', 1)[0] ?? areaId;
  return AREA_SCREEN_FX[base] ?? {};
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
  private godray?: GodrayFilter;
  private heat?: DisplacementFilter;
  private heatSprite?: Sprite;
  private overlay?: Container;
  private cfg: AreaScreenFx = {};
  private readonly luts = new Map<string, Texture>();

  constructor(quality: Quality) {
    this.quality = quality;
  }

  /** Bind the screen-space overlay the godrays render on (added to the stage by the renderer). */
  bindOverlay(overlay: Container): void {
    this.overlay = overlay;
  }

  /** Register a loaded LUT texture so areas referencing it grade through a ColorMapFilter. */
  addLut(src: string, tex: Texture): void {
    this.luts.set(src, tex);
  }

  /** Switch to an area: (re)apply the godray overlay filter. Returns nothing; world filters are pulled. */
  setArea(areaId: string): void {
    this.cfg = screenFxFor(areaId);
    const on = activeScreenEffects(this.cfg, this.quality);
    if (this.overlay) {
      if (on.godrays) {
        if (!this.godray)
          this.godray = new GodrayFilter({ gain: 0.5, lacunarity: 2.2, alpha: 0.85 });
        this.godray.gain = 0.5 * (this.cfg.godrays ?? 0);
        this.overlay.filters = [this.godray];
      } else if (this.overlay.filters && (this.overlay.filters as readonly unknown[]).length > 0) {
        this.overlay.filters = [];
      }
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

  /** Animate the active filters (godray shafts drift; the heat noise scrolls). */
  update(now: number): void {
    if (this.godray) this.godray.time = now / 1000;
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
    this.overlay?.addChild(this.heatSprite);
    this.heat = new DisplacementFilter({ sprite: this.heatSprite, scale: 0 });
  }

  destroy(): void {
    this.heatSprite?.destroy();
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
