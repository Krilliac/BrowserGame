import { Container, Sprite, Texture } from 'pixi.js';

/**
 * Screen-space additive glow overlay that makes point lights (torches, spells, portals) feel
 * alive. Lives above the world layer but below weather/vignette so atmospheric effects can
 * darken/desaturate the glows naturally. The renderer owns one Lighting instance, adds its
 * layer to the stage, and calls update() once per frame with projected screen positions.
 *
 * Design choices:
 *  - One shared 64 px soft-radial texture, tinted per light. White source lets PixiJS tint do
 *    the colour work cheaply without extra draw calls.
 *  - Additive blend: overlapping lights brighten correctly and never punch dark holes.
 *  - Pool: sprites are reused across frames so GC pressure is zero at steady state.
 *  - nightFactor / ambient: glows should be near-invisible in bright daylight (they'd just
 *    look like washed-out halos) and pop at night or inside murky indoor areas.
 */

// Glow texture is generated once and shared across every sprite in the pool.
const GLOW_SIZE = 64;

export interface LightSource {
  x: number; // screen-space px (already projected by the renderer)
  y: number; // screen-space px
  radius: number;
  color: number; // 0xRRGGBB
}

export class Lighting {
  /** Screen-space additive layer; the renderer adds this above the world, below weather/vignette. */
  readonly layer: Container;

  private readonly texture: Texture;
  // Grow-only pool; sprites that exceed the current light count are hidden, not destroyed.
  private readonly pool: Sprite[] = [];

  constructor() {
    this.layer = new Container();
    this.layer.eventMode = 'none';
    this.texture = makeGlow();
  }

  /**
   * Position one additive glow per light. `nightFactor` 0..1 (1 = full night) scales overall
   * alpha so lights matter at night and fade by day. `ambient` 0..1 is the area's baseline
   * light from the theme — lower ambient means glows read stronger (a crypt torch pops; a
   * sunlit town torch is barely visible). w/h are screen size for culling off-screen lights.
   */
  update(lights: LightSource[], w: number, h: number, nightFactor: number, ambient: number): void {
    // Grow the pool on demand; never shrink (reuse is cheaper than alloc/GC).
    while (this.pool.length < lights.length) {
      const s = new Sprite(this.texture);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      this.layer.addChild(s);
      this.pool.push(s);
    }

    // Base alpha shared by all lights this frame.  The formula ensures:
    //   - nightFactor=1, ambient=0  → alpha ≈ 1.15   (clamped to 1)   full brightness
    //   - nightFactor=0, ambient=1  → alpha ≈ 0.01   near-invisible in bright day
    //   - nightFactor=0, ambient=0  → alpha ≈ 0.15   subtle glow in dark indoor day
    const baseAlpha = clamp01((nightFactor * 0.9 + 0.1) * (1.15 - ambient));

    for (let i = 0; i < lights.length; i++) {
      const light = lights[i]!;
      const sprite = this.pool[i]!;

      // Cull lights whose glow circle is completely outside the viewport — avoids
      // wasting blend operations on invisible overdraw at the edges of large worlds.
      const offScreen =
        light.x + light.radius < 0 ||
        light.x - light.radius > w ||
        light.y + light.radius < 0 ||
        light.y - light.radius > h;

      if (offScreen) {
        sprite.visible = false;
        continue;
      }

      sprite.visible = true;
      sprite.position.set(light.x, light.y);
      // Texture is GLOW_SIZE px wide (diameter), so radius maps to scale = radius / half-size.
      sprite.scale.set(light.radius / (GLOW_SIZE / 2));
      sprite.tint = light.color;
      sprite.alpha = baseAlpha;
    }

    // Hide pooled sprites that weren't needed this frame.
    for (let i = lights.length; i < this.pool.length; i++) {
      this.pool[i]!.visible = false;
    }
  }
}

/** Clamp a value to [0, 1]. */
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Soft radial gradient: bright white centre fading to transparent at the edge.
 * Generated once from a canvas; white so tint applies cleanly without colour contamination.
 */
function makeGlow(): Texture {
  const size = GLOW_SIZE;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(cv);
}
