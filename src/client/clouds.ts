import { Container, Sprite, Texture } from 'pixi.js';
import { cloudStrength, wrapSpan } from './cloud-field.js';
import type { Quality } from './post-fx.js';

/**
 * Drifting cloud shadows — a world-anchored outdoor depth cue.
 *
 * A flat top-down plane has no sky; soft dark patches sailing across the ground put one back. Cloud
 * positions are WORLD coordinates, and the layer's transform is synced to the world's each frame
 * (`syncTransform`), so as the player walks the shadows slide past them — the shadows belong to the
 * ground, not the screen. A small fixed pool wraps endlessly around the camera (`wrapSpan`), and the
 * whole effect fades with the sun (`cloudStrength`): present by day, gone at night when there's no
 * sun to cast them. Outdoor-only, and disabled wholesale on the low-quality (touch) path since big
 * soft sprites are fill-rate heavy on phones.
 *
 * RENDERING: like `Water`, the layer is a STAGE child (drawn just above the ground/water, below the
 * world) — NOT a child of `world`. It must darken the real ground, and `world` carries a per-area
 * colour-grade filter that renders its children into an isolated buffer (so a shadow nested inside
 * would never touch the ground). The renderer owns one instance, adds `.layer` to the stage, calls
 * `setArea` on area entry, syncs the transform + drives `update` once per frame.
 */

// Peak shadow darkness at high noon (scaled down by sun strength + per-cloud variation from there).
const MAX_ALPHA = 0.34;
// Slow wind drift in world px/s — a cloud crosses a screen over many seconds, never distractingly.
const WIND_X = 13;
const WIND_Y = 6;

interface Cloud {
  x: number;
  y: number;
  scale: number;
  alphaMul: number;
}

export class CloudShadows {
  /** World-space layer; the renderer parents it inside the world, behind props/actors. */
  readonly layer = new Container();

  private readonly texture: Texture;
  private readonly sprites: Sprite[] = [];
  private readonly clouds: Cloud[] = [];
  private readonly count: number;
  private readonly pitch: number;
  private outdoor = false;
  private lastNow = performance.now();
  private seeded = false;

  constructor(quality: Quality, pitch: number) {
    this.layer.eventMode = 'none';
    this.texture = makeCloudShadow();
    this.count = quality === 'low' ? 0 : 7;
    // World Y is foreshortened by the renderer's PITCH (the tilted top-down look); cloud sprites
    // pre-multiply it on placement so they sit on the same ground plane as everything else.
    this.pitch = pitch;
    for (let i = 0; i < this.count; i++) {
      const s = new Sprite(this.texture);
      s.anchor.set(0.5);
      // A dark, cool-grey tint at low alpha: the patch only ever darkens the ground toward dusk-blue,
      // reading as a shadow cast from a cloud overhead rather than a coloured wash.
      s.tint = 0x0c0f16;
      s.visible = false;
      this.layer.addChild(s);
      this.sprites.push(s);
      this.clouds.push({ x: 0, y: 0, scale: 1, alphaMul: 1 });
    }
  }

  /** Clouds only drift over outdoor areas; indoor areas have no sky, so the layer goes dark. */
  setArea(outdoor: boolean): void {
    this.outdoor = outdoor;
    if (!outdoor) this.layer.visible = false;
  }

  /** Keep the world-anchored layer aligned with the camera (same origin/zoom as `world`). */
  syncTransform(x: number, y: number, scale: number): void {
    this.layer.position.set(x, y);
    this.layer.scale.set(scale);
  }

  /**
   * Drift + wrap the cloud pool around the camera and fade it with the sun. `camX`/`camY` is the
   * world point at screen center; `halfW`/`halfH` are the visible world half-extents (so clouds fill
   * the view and wrap just out of sight); `daylight` is the atmosphere's day phase (0..1).
   */
  update(
    now: number,
    camX: number,
    camY: number,
    halfW: number,
    halfH: number,
    daylight: number,
  ): void {
    const strength = cloudStrength(daylight);
    if (this.count === 0 || !this.outdoor || strength < 0.02) {
      this.layer.visible = false;
      this.lastNow = now;
      return;
    }
    this.layer.visible = true;
    const dt = Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;

    // Wrap with a margin so a cloud slides fully off-view before it recycles (no pop at the edge).
    const wrapW = halfW + 260;
    const wrapH = halfH + 260;
    if (!this.seeded) this.seed(camX, camY, wrapW, wrapH);

    for (let i = 0; i < this.clouds.length; i++) {
      const c = this.clouds[i]!;
      c.x = wrapSpan(c.x + WIND_X * dt, camX, wrapW);
      c.y = wrapSpan(c.y + WIND_Y * dt, camY, wrapH);
      const s = this.sprites[i]!;
      s.visible = true;
      s.position.set(c.x, c.y * this.pitch); // foreshorten Y onto the tilted ground plane
      s.scale.set(c.scale);
      s.alpha = MAX_ALPHA * strength * c.alphaMul;
    }
  }

  /** Scatter the pool across the visible band once we know where the camera is. */
  private seed(camX: number, camY: number, wrapW: number, wrapH: number): void {
    for (const c of this.clouds) {
      c.x = camX + (Math.random() * 2 - 1) * wrapW;
      c.y = camY + (Math.random() * 2 - 1) * wrapH;
      c.scale = 2.6 + Math.random() * 2.4; // texture is 128px → ~330–650 world px wide patches
      c.alphaMul = 0.6 + Math.random() * 0.4;
    }
    this.seeded = true;
  }
}

/**
 * A soft, lumpy dark-shadow texture: several overlapping radial gradients stamped on one canvas so
 * the patch has a cloud-like irregular edge rather than a perfect ellipse. White (tinted at use), so
 * the sprite tint colours it. Baked once and shared across the pool.
 */
function makeCloudShadow(): Texture {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  // A handful of soft lobes clustered near the centre build an irregular blob.
  const lobes = [
    { x: 0.5, y: 0.5, r: 0.42 },
    { x: 0.38, y: 0.44, r: 0.3 },
    { x: 0.62, y: 0.56, r: 0.32 },
    { x: 0.55, y: 0.38, r: 0.26 },
    { x: 0.44, y: 0.62, r: 0.28 },
  ];
  for (const l of lobes) {
    const cx = l.x * size;
    const cy = l.y * size;
    const r = l.r * size;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return Texture.from(cv);
}
