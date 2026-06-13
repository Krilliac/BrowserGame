/**
 * Water reflections & ripples (RENDER-11).
 *
 * Elliptical water ponds render a tinted, gently rippling surface with mirrored reflections of nearby
 * actors — a vertically-flipped, darkened, alpha'd copy of each actor's current frame, clipped to the
 * water and wobbled by a scrolling-noise DisplacementFilter. Cosmetic and client-only; water does NOT
 * affect collision (you wade straight through).
 *
 * RENDERING: the layer is a STAGE child (like `ground`), NOT a child of `world`. The deferred-lighting
 * pass renders `world` to a RenderTexture with `renderable=false`, and a fresh world subtree didn't
 * compose with it — but the ground (a sibling stage child) always renders. So water sits at the stage
 * level just above the ground and below the lit world content, and the renderer keeps it world-anchored
 * by syncing its transform to the world's each frame (`syncTransform`). Pond placement is PROCEDURAL:
 * `waterPondsFor` scatters ponds across wet areas (marsh/wilderness/…) from a deterministic hash, with a
 * fixed demo pond in town so the effect is always visible near spawn.
 */

import { Container, DisplacementFilter, Graphics, Sprite, Texture } from 'pixi.js';

/** Vertical foreshorten of the ground plane — mirrors PITCH in pixi-renderer.ts. */
const PITCH = 0.6;

/** An elliptical pond in world coords (center + radii). */
export interface Pond {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Same integer hash the renderer / ground bake use — keeps procedural ponds deterministic. */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 1000) / 1000;
}

/** Which areas have water, and how much: a single decorative pond, or scattered wetland pools. */
const WATER_AREAS: Record<string, 'pond' | 'wetland'> = {
  town: 'pond', // a village pond near the green (also the deterministic verification spot)
  wilderness: 'wetland',
  marsh: 'wetland',
  sunken_pass: 'wetland', // a drowned road
  hollowroot: 'wetland', // cavern pools
};

/**
 * Procedural ponds for an area (deterministic). Wetlands scatter several ellipses across the map on a
 * coarse hash grid (kept off the edges); a 'pond' area gets one tasteful pool near its center. Areas
 * not in `WATER_AREAS` get none. Pure (no Pixi) so placement is unit-tested.
 */
export function waterPondsFor(areaId: string, width: number, height: number): Pond[] {
  const base = areaId.split('#', 1)[0] ?? areaId;
  const kind = WATER_AREAS[base];
  if (!kind) return [];
  if (kind === 'pond') {
    // One pond near the green, sized to the area (sits under the central paths so actors reflect).
    return [{ cx: width * 0.5, cy: height * 0.6, rx: 185, ry: 125 }];
  }
  // Wetland: scatter ponds on a ~360px grid, ~35% of cells, with hash-varied size + jitter.
  const ponds: Pond[] = [];
  const cell = 360;
  const cols = Math.max(1, Math.floor(width / cell));
  const rows = Math.max(1, Math.floor(height / cell));
  for (let gx = 0; gx < cols; gx++) {
    for (let gy = 0; gy < rows; gy++) {
      if (hash2(gx * 7 + 1, gy * 13 + 5) > 0.35) continue;
      const jx = hash2(gx, gy * 3);
      const jy = hash2(gx * 5, gy);
      const cx = (gx + 0.2 + jx * 0.6) * cell;
      const cy = (gy + 0.2 + jy * 0.6) * cell;
      if (cx < 120 || cy < 120 || cx > width - 120 || cy > height - 120) continue; // keep off edges
      const rx = 90 + hash2(gx * 3, gy * 7) * 110;
      const ry = rx * (0.62 + hash2(gx, gy) * 0.2); // foreshortened, varied
      ponds.push({ cx, cy, rx, ry });
    }
  }
  return ponds;
}

/** True if world point (x,y) lies in/near any pond (margin in world px). Used to pick who reflects. */
export function isOverWater(ponds: readonly Pond[], x: number, y: number, margin = 0): boolean {
  for (const p of ponds) {
    const dx = (x - p.cx) / (p.rx + margin);
    const dy = (y - p.cy) / (p.ry + margin);
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

/** One actor to mirror this frame: current frame texture, world feet position, and body scale. */
export interface Reflectable {
  texture: Texture;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

export class Water {
  /** Stage-level layer (added next to `ground`); the renderer syncs its transform to the world's. */
  readonly layer = new Container();
  private readonly surface = new Container();
  private readonly reflections = new Container();
  private readonly mask = new Graphics();
  private readonly pool: Sprite[] = [];
  private readonly ripple?: DisplacementFilter;
  private readonly rippleSprite?: Sprite;
  private ponds: Pond[] = [];

  constructor(quality: 'high' | 'low') {
    this.layer.eventMode = 'none';
    this.layer.addChild(this.surface, this.reflections, this.mask);
    this.reflections.mask = this.mask; // reflections clipped to the water footprint
    if (quality === 'high') {
      this.rippleSprite = new Sprite(makeRippleNoise());
      this.rippleSprite.texture.source.addressMode = 'repeat';
      this.ripple = new DisplacementFilter({ sprite: this.rippleSprite, scale: 9 });
      this.layer.addChild(this.rippleSprite);
      this.reflections.filters = [this.ripple];
    }
  }

  hasPonds(): boolean {
    return this.ponds.length > 0;
  }

  getPonds(): readonly Pond[] {
    return this.ponds;
  }

  /** Match the world container's transform so ponds stay world-anchored (called each frame). */
  syncTransform(x: number, y: number, scale: number): void {
    this.layer.position.set(x, y);
    this.layer.scale.set(scale);
  }

  /** Rebuild the water surface + reflection mask for an area. `tint` is the area's water color. */
  setRegions(ponds: Pond[], tint: number): void {
    this.ponds = ponds;
    for (const c of this.surface.removeChildren()) c.destroy();
    this.mask.clear();
    for (const p of ponds) {
      const cx = p.cx;
      const cy = p.cy * PITCH; // ellipse center flattened onto the tilted ground plane
      const ry = p.ry * PITCH;
      const g = new Graphics();
      // A darker pool with a soft lighter rim reads as recessed water; the reflections sit on top.
      g.ellipse(cx, cy, p.rx, ry).fill({ color: tint, alpha: 0.66 });
      g.ellipse(cx, cy, p.rx * 0.7, ry * 0.7).fill({ color: 0x0e2733, alpha: 0.22 }); // deeper center
      g.ellipse(cx, cy, p.rx, ry).stroke({ width: 4, color: 0xbfe2ff, alpha: 0.22 });
      this.surface.addChild(g);
      this.mask.ellipse(cx, cy, p.rx, ry).fill(0xffffff);
    }
    for (const s of this.pool) s.visible = false;
  }

  /** Position mirrored reflections for the given actors (pooled; extras hidden). */
  reflect(items: Reflectable[]): void {
    let i = 0;
    for (const it of items) {
      let s = this.pool[i];
      if (!s) {
        s = new Sprite();
        s.anchor.set(0.5, 0.92); // feet anchor, same as the body sprite
        s.tint = 0x6f93b8; // darkened cool cast
        this.reflections.addChild(s);
        this.pool[i] = s;
      }
      s.texture = it.texture;
      s.visible = true;
      s.position.set(it.x, it.y * PITCH); // feet at the waterline
      s.scale.set(it.scaleX, -Math.abs(it.scaleY)); // flip down into the water
      s.alpha = 0.34;
      i++;
    }
    for (; i < this.pool.length; i++) this.pool[i]!.visible = false;
  }

  /** Scroll the ripple noise so the reflection wobble animates. */
  update(now: number): void {
    if (this.rippleSprite) {
      this.rippleSprite.x = Math.sin(now / 1100) * 30;
      this.rippleSprite.y = (now / 40) % 256;
    }
  }

  setVisible(on: boolean): void {
    this.layer.visible = on;
  }
}

/** A soft tiling ripple-noise texture for the reflection displacement (R/G = x/y offset). */
function makeRippleNoise(): Texture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const nx = Math.sin(x / 12) + Math.sin((x + y) / 18);
      const ny = Math.sin(y / 10) + Math.sin((x - y) / 20);
      img.data[i] = Math.round((nx * 0.25 + 0.5) * 255);
      img.data[i + 1] = Math.round((ny * 0.25 + 0.5) * 255);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(cv);
}
