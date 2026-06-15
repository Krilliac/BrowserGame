import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { DEFAULT_THEME, type AreaTheme } from '../shared/theme.js';
import { sunShadow } from './sun-shadow.js';

/**
 * Screen-space ambiance that reinforces the 2.5D mood: a slow day/night cycle (outdoor areas
 * only), a drifting ambient particle field (pollen / fireflies / crypt dust), and an edge
 * vignette to frame the scene. All of it lives above the world but below the HUD, and is kept
 * out of the renderer proper so each stays a focused unit. The renderer owns one Atmosphere,
 * adds its display objects to the stage, and drives it once per frame. Everything visual here is
 * driven by the area's AreaTheme (from the content DB), so edits re-skin the mood live.
 */

// One full dawn→day→dusk→night loop. Long enough to feel like a living world, short enough to
// actually witness within a session.
const DAY_MS = 180_000;
const MAX_NIGHT_ALPHA = 0.45;
const NIGHT_COLOR = 0x0a1430;
const WARM_COLOR = 0xffae5c;
const CORRUPT_COLOR = 0x3a0810; // deep crimson pall for area corruption
// Indoor areas don't run the day/night cycle, but light sources should still read — treat them as
// perpetually dusk-dark for the lighting module.
const INDOOR_NIGHT = 0.65;

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
}

export class Atmosphere {
  /** Drifting motes (screen-space). Added to the stage above the world. */
  readonly particleLayer = new Container();
  /** Screen-space wash: day/night + base mood tint, then an edge vignette on top. */
  readonly screen = new Container();

  private readonly tint = new Graphics();
  private readonly vignette: Sprite;
  private readonly dot: Texture;
  private readonly sprites: Sprite[] = [];
  private readonly motes: Mote[] = [];
  private theme: AreaTheme = DEFAULT_THEME;
  private lastNow = performance.now();
  private w = 0;
  private h = 0;
  /** Fog color the current vignette texture was baked for; lets us skip needless rebuilds. */
  private vignetteFog = '';

  constructor() {
    this.dot = makeSoftDot();
    this.vignette = new Sprite(makeVignette(DEFAULT_THEME.fogColor));
    this.vignetteFog = DEFAULT_THEME.fogColor;
    this.screen.eventMode = 'none';
    this.particleLayer.eventMode = 'none';
    this.screen.addChild(this.tint, this.vignette);
  }

  setArea(theme: AreaTheme): void {
    this.theme = theme;
    this.refreshVignette();
    this.reseed(theme.particleCount);
  }

  /**
   * Rebuild the baked vignette only when the area's fogColor actually changes. The gradient is
   * resolution-independent (a fixed 256px sprite stretched to the viewport), so a viewport resize
   * just re-stretches the same sprite — no texture work — and the per-fogColor cache keeps this off
   * the per-frame path. Cheap enough for a phone.
   */
  private refreshVignette(): void {
    if (this.theme.fogColor === this.vignetteFog) return;
    const old = this.vignette.texture;
    this.vignette.texture = makeVignette(this.theme.fogColor);
    this.vignetteFog = this.theme.fogColor;
    old.destroy(true);
  }

  /** Time-of-day darkness in [0,1] (1 = full night) — drives the lighting module's glow strength. */
  nightFactor(): number {
    return this.theme.outdoor ? 1 - this.daylight() : INDOOR_NIGHT;
  }

  /**
   * Sun-driven shadow multipliers (length + alpha) for the current time of day, so the renderer can
   * rake actor/loot shadows long + faint at dawn/dusk and pull them short + dark at noon. Indoor
   * areas have no day/night cycle, so they report an overhead-sun identity and keep their fixed
   * shadows. Cheap (one `sin`); safe to call per frame.
   */
  sunShadow(): { stretch: number; alpha: number } {
    return sunShadow(this.theme.outdoor ? this.daylight() : 1);
  }

  private reseed(count: number): void {
    // Grow/shrink the sprite pool to match; (re)seed every mote across the current viewport.
    while (this.sprites.length < count) {
      const s = new Sprite(this.dot);
      s.anchor.set(0.5);
      this.particleLayer.addChild(s);
      this.sprites.push(s);
    }
    for (let i = count; i < this.sprites.length; i++) this.sprites[i]!.visible = false;
    this.motes.length = 0;
    const w = this.w || 1280;
    const h = this.h || 800;
    for (let i = 0; i < count; i++) this.motes.push(this.spawnMote(w, h, true));
  }

  private spawnMote(w: number, h: number, anywhere: boolean): Mote {
    const rise = this.theme.particleRise;
    return {
      x: Math.random() * w,
      // New motes enter from the trailing edge (bottom if rising, top if falling).
      y: anywhere ? Math.random() * h : rise < 0 ? h + 10 : -10,
      vx: (Math.random() - 0.5) * 8,
      vy: rise + (Math.random() - 0.5) * 4,
      size: 0.5 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
    };
  }

  /**
   * Daylight in [0,1]: 0 at midnight, 1 at noon. Drives darkness + warm dawn/dusk glow. Keyed to
   * the wall clock (not performance.now, which resets to 0 each page load — that would strand
   * every fresh client at midnight); this also makes it a shared world clock across players.
   */
  private daylight(): number {
    const phase = (Date.now() % DAY_MS) / DAY_MS;
    return (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
  }

  update(now: number, w: number, h: number, corruption = 0): void {
    const dt = Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.vignette.width = w;
      this.vignette.height = h;
    }

    this.drawOverlay(w, h, corruption);
    this.stepMotes(dt, now, w, h);
  }

  private drawOverlay(w: number, h: number, corruption: number): void {
    const g = this.tint;
    g.clear();
    g.rect(0, 0, w, h).fill({ color: this.theme.atmoColor, alpha: this.theme.atmoAlpha });
    if (this.theme.outdoor) {
      const day = this.daylight();
      const night = (1 - day) * MAX_NIGHT_ALPHA;
      if (night > 0.01) g.rect(0, 0, w, h).fill({ color: NIGHT_COLOR, alpha: night });
      // Warm wash peaks at dawn/dusk (daylight ≈ 0.5), fades out by noon/midnight.
      const warm = Math.max(0, 1 - Math.abs(day - 0.5) * 4) * 0.16;
      if (warm > 0.01) g.rect(0, 0, w, h).fill({ color: WARM_COLOR, alpha: warm });
    }
    // Persistent corruption: a creeping crimson pall that deepens as the area darkens.
    if (corruption > 0.01) {
      g.rect(0, 0, w, h).fill({ color: CORRUPT_COLOR, alpha: Math.min(0.55, corruption * 0.55) });
    }
  }

  private stepMotes(dt: number, now: number, w: number, h: number): void {
    const flicker = this.theme.particleFlicker;
    const tint = this.theme.particleColor;
    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i]!;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      const off = m.y < -20 || m.y > h + 20 || m.x < -20 || m.x > w + 20;
      if (off) this.motes[i] = this.spawnMote(w, h, false);
      const s = this.sprites[i]!;
      s.visible = true;
      s.tint = tint;
      s.position.set(m.x, m.y);
      s.scale.set(m.size);
      const twinkle = flicker ? 0.5 + 0.5 * Math.sin(now / 220 + m.phase) : 0.7;
      s.alpha = twinkle * 0.6;
    }
  }
}

/** A soft round particle texture (radial alpha falloff), generated once. */
function makeSoftDot(): Texture {
  const size = 16;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(cv);
}

/**
 * A radial vignette baked once per fogColor and stretched to the screen. Two cues are layered into
 * the SAME gradient so the renderer still wires only one sprite:
 *   1. the original edge-darkening (transparent center → dark edges) that frames the scene, and
 *   2. atmospheric perspective — the periphery washes a touch toward the (slightly desaturated)
 *      fog color, the way distant terrain hazes out, so the screen edges read as "further away".
 * Both are subtle ambiance; the center stays clear. Drawn as two stacked radial gradients on a
 * fixed 256px canvas, which is then stretched — no per-pixel filter, no per-frame allocation.
 */
function makeVignette(fogHex: string): Texture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;

  // Layer 1: the existing edge-darkening (unchanged feel).
  const dark = ctx.createRadialGradient(cx, cy, size * 0.28, cx, cy, size * 0.62);
  dark.addColorStop(0, 'rgba(0,0,0,0)');
  dark.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, size, size);

  // Layer 2: cool, slightly-desaturated fog haze that only touches the periphery. Pulling the fog
  // color partway toward neutral grey drops its saturation so it reads as distance-haze, not a
  // colored filter. Kept faint (max ~0.14 alpha) — ambiance, not a wash.
  const { r, g, b } = hexToRgb(fogHex);
  const grey = (r + g + b) / 3;
  const hr = Math.round(lerp(r, grey, 0.45));
  const hg = Math.round(lerp(g, grey, 0.45));
  const hb = Math.round(lerp(b, grey, 0.45));
  const haze = ctx.createRadialGradient(cx, cy, size * 0.34, cx, cy, size * 0.62);
  haze.addColorStop(0, `rgba(${hr},${hg},${hb},0)`);
  haze.addColorStop(1, `rgba(${hr},${hg},${hb},0.14)`);
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, size, size);

  return Texture.from(cv);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Parse a #rgb / #rrggbb CSS hex into 0..255 channels; falls back to mid-grey on garbage. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  if (h.length < 6 || !/^[0-9a-fA-F]{6}/.test(h)) return { r: 128, g: 128, b: 128 };
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
  };
}
