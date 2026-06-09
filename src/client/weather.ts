import { Container, Sprite, Texture } from 'pixi.js';
import type { WeatherKind } from '../shared/theme.js';

/**
 * Screen-space weather overlay: rain streaks, drifting snowflakes, and rolling fog banks.
 * Lives above the world and below the vignette. The renderer owns one Weather, adds its
 * layer to the stage, and drives it once per frame via update().
 *
 * Design notes:
 *  - All textures are generated once at construction (canvas → Texture.from).
 *  - All sprites are pooled; setWeather decides how many are visible and reseeds them.
 *  - Wrap logic is resize-aware: each update() pass detects w/h changes and reseeds if needed.
 */

// ─── Pool sizes — allocate max at startup so setWeather never allocates ────────
const RAIN_MAX = 220;
const SNOW_MAX = 160;
const FOG_MAX = 7;

// ─── Per-particle state (rain + snow share one interface) ──────────────────────
interface Drop {
  x: number;
  y: number;
  /** Base velocity (before intensity scaling for rain). */
  vx: number;
  vy: number;
  /** Phase offset for the sine sway used by snow. */
  phase: number;
  /** Sprite scale factor, randomized at spawn. */
  size: number;
}

interface FogBlob {
  x: number;
  y: number;
  vx: number;
  /** Sway period for gentle vertical drift. */
  swayPhase: number;
}

export class Weather {
  /** Screen-space layer; the renderer adds this to the stage above the world, below the vignette. */
  readonly layer: Container;

  // Textures (created once)
  private readonly rainTex: Texture;
  private readonly snowTex: Texture;
  private readonly fogTex: Texture;

  // Sprite pools
  private readonly rainSprites: Sprite[] = [];
  private readonly snowSprites: Sprite[] = [];
  private readonly fogSprites: Sprite[] = [];

  // Particle state arrays
  private readonly rainDrops: Drop[] = [];
  private readonly snowFlakes: Drop[] = [];
  private readonly fogBlobs: FogBlob[] = [];

  // Active weather settings
  private kind: WeatherKind = 'none';
  private intensity = 0;
  private fogColorHex = '#8a93a0';

  // Viewport cache — used to detect resizes so we can reseed wrapping correctly
  private w = 0;
  private h = 0;

  constructor() {
    this.layer = new Container();
    this.layer.eventMode = 'none';

    this.rainTex = makeRainStreak();
    this.snowTex = makeSoftDot(12);
    this.fogTex = makeFogBlob(256);

    // Allocate all pools up front; all sprites start hidden
    for (let i = 0; i < RAIN_MAX; i++) {
      const s = new Sprite(this.rainTex);
      s.anchor.set(0.5, 0);
      s.visible = false;
      this.layer.addChild(s);
      this.rainSprites.push(s);
      this.rainDrops.push(emptyDrop());
    }
    for (let i = 0; i < SNOW_MAX; i++) {
      const s = new Sprite(this.snowTex);
      s.anchor.set(0.5);
      s.visible = false;
      this.layer.addChild(s);
      this.snowSprites.push(s);
      this.snowFlakes.push(emptyDrop());
    }
    for (let i = 0; i < FOG_MAX; i++) {
      const s = new Sprite(this.fogTex);
      s.anchor.set(0.5);
      s.visible = false;
      this.layer.addChild(s);
      this.fogSprites.push(s);
      this.fogBlobs.push({ x: 0, y: 0, vx: 0, swayPhase: 0 });
    }
  }

  /** Switch weather. Called when the area theme changes. intensity is 0..1. fogColor is CSS hex. */
  setWeather(kind: WeatherKind, intensity: number, fogColor: string): void {
    this.kind = kind;
    this.intensity = Math.max(0, Math.min(1, intensity));
    this.fogColorHex = fogColor;

    // Hide all pools, then reseed the active one
    this.hideAll();
    const w = this.w || 1280;
    const h = this.h || 800;
    if (kind === 'rain') this.reseedRain(w, h);
    else if (kind === 'snow') this.reseedSnow(w, h);
    else if (kind === 'fog') this.reseedFog(w, h);
  }

  /** Drive the animation each frame. w/h are the screen size in px. */
  update(now: number, w: number, h: number): void {
    // Detect resize — reseed so particles are spread across the new viewport
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      if (this.kind !== 'none') this.setWeather(this.kind, this.intensity, this.fogColorHex);
    }

    if (this.kind === 'rain') this.stepRain(now, w, h);
    else if (this.kind === 'snow') this.stepSnow(now, w, h);
    else if (this.kind === 'fog') this.stepFog(now, w, h);
  }

  // ─── Rain ──────────────────────────────────────────────────────────────────

  private reseedRain(w: number, h: number): void {
    const count = this.rainCount();
    for (let i = 0; i < count; i++) {
      const d = spawnRainDrop(w, h, true);
      this.rainDrops[i] = d;
      this.rainSprites[i]!.visible = true;
    }
  }

  private rainCount(): number {
    // 60 streaks at intensity 0, 220 at intensity 1
    return Math.round(60 + this.intensity * (RAIN_MAX - 60));
  }

  private stepRain(_now: number, w: number, h: number): void {
    const count = this.rainCount();
    // Rain falls fast — speed scales lightly with intensity so heavy rain is notably faster
    const speedScale = 0.8 + this.intensity * 0.4;
    const baseAlpha = 0.25 + this.intensity * 0.45;

    for (let i = 0; i < count; i++) {
      const d = this.rainDrops[i]!;
      const s = this.rainSprites[i]!;

      // Move: rain falls steeply with a slight rightward wind slant
      d.x += (d.vx * speedScale) / 60;
      d.y += (d.vy * speedScale) / 60;

      // Wrap — rain can exit bottom or right/left edges
      if (d.y > h + 40) {
        this.rainDrops[i] = spawnRainDrop(w, h, false);
      } else {
        if (d.x < -20) d.x += w + 40;
        else if (d.x > w + 20) d.x -= w + 40;
      }

      s.position.set(d.x, d.y);
      // Tilt the streak to match its velocity direction
      s.rotation = Math.atan2(d.vx, d.vy) + Math.PI;
      s.alpha = baseAlpha * d.size;
      s.tint = 0xc8deff; // cool bluish-white
    }
  }

  // ─── Snow ──────────────────────────────────────────────────────────────────

  private reseedSnow(w: number, h: number): void {
    const count = this.snowCount();
    for (let i = 0; i < count; i++) {
      this.snowFlakes[i] = spawnSnowFlake(w, h, true);
      this.snowSprites[i]!.visible = true;
    }
  }

  private snowCount(): number {
    // 40 flakes at intensity 0, 160 at intensity 1
    return Math.round(40 + this.intensity * (SNOW_MAX - 40));
  }

  private stepSnow(now: number, w: number, h: number): void {
    const count = this.snowCount();
    const baseAlpha = 0.5 + this.intensity * 0.35;

    for (let i = 0; i < count; i++) {
      const f = this.snowFlakes[i]!;
      const s = this.snowSprites[i]!;

      // Gentle downward drift + slow sinusoidal horizontal sway
      const sway = Math.sin(now / 2400 + f.phase) * 18;
      f.x += (f.vx + sway) / 60;
      f.y += f.vy / 60;

      // Wrap edges
      if (f.y > h + 20) {
        this.snowFlakes[i] = spawnSnowFlake(w, h, false);
      } else {
        if (f.x < -20) f.x += w + 40;
        else if (f.x > w + 20) f.x -= w + 40;
      }

      s.position.set(f.x, f.y);
      s.scale.set(f.size);
      s.alpha = baseAlpha * (0.6 + f.size * 0.4);
      s.tint = 0xeef6ff; // cool white with faint blue tint
    }
  }

  // ─── Fog ───────────────────────────────────────────────────────────────────

  private reseedFog(w: number, h: number): void {
    const count = this.fogCount();
    for (let i = 0; i < count; i++) {
      this.fogBlobs[i] = spawnFogBlob(w, h, true);
      this.fogSprites[i]!.visible = true;
    }
    this.applyFogColor();
  }

  private fogCount(): number {
    // 4 blobs at low intensity, 7 at full
    return Math.round(4 + this.intensity * (FOG_MAX - 4));
  }

  private applyFogColor(): void {
    // Parse the CSS hex color (#rrggbb or #rgb) into a numeric tint
    const hex = this.fogColorHex.replace('#', '');
    const expanded =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    const tint = Number.parseInt(expanded.substring(0, 6), 16);
    const count = this.fogCount();
    for (let i = 0; i < count; i++)
      this.fogSprites[i]!.tint = Number.isFinite(tint) ? tint : 0x8a93a0;
  }

  private stepFog(now: number, w: number, h: number): void {
    const count = this.fogCount();
    // Low alpha — fog is subtle; intensity drives opacity
    const baseAlpha = 0.1 + this.intensity * 0.28;

    for (let i = 0; i < count; i++) {
      const b = this.fogBlobs[i]!;
      const s = this.fogSprites[i]!;

      b.x += b.vx / 60;
      // Gentle vertical sway so blobs don't look locked to a lane
      b.y += Math.sin(now / 6000 + b.swayPhase) * 0.12;

      // Fog wraps horizontally only; vertical position is fixed at mid-screen bands
      if (b.x > w + 350) b.x -= w + 700;
      else if (b.x < -350) b.x += w + 700;

      // Scale each blob large enough to overlap neighbors — rolling banks read as continuous
      const scaleX = (w * 0.55 + 150) / 256;
      const scaleY = (h * 0.3 + 80) / 256;

      s.position.set(b.x, b.y);
      s.scale.set(scaleX, scaleY);
      s.alpha = baseAlpha * (0.7 + 0.3 * Math.sin(now / 4000 + b.swayPhase));
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private hideAll(): void {
    for (const s of this.rainSprites) s.visible = false;
    for (const s of this.snowSprites) s.visible = false;
    for (const s of this.fogSprites) s.visible = false;
  }
}

// ─── Spawn helpers ─────────────────────────────────────────────────────────────

function emptyDrop(): Drop {
  return { x: 0, y: 0, vx: 0, vy: 0, phase: 0, size: 1 };
}

/** Spawn a rain drop. anywhere=true scatters it across the full viewport (initial seeding). */
function spawnRainDrop(w: number, h: number, anywhere: boolean): Drop {
  return {
    x: Math.random() * (w + 40) - 20,
    // New drops enter from the top; initial seed scatters throughout the screen
    y: anywhere ? Math.random() * h : -40,
    // Steep fall with a slight rightward slant — looks like wind-driven rain
    vx: 90 + Math.random() * 60,
    vy: 700 + Math.random() * 300,
    phase: 0,
    // size doubles as alpha multiplier — varied opacity prevents banding
    size: 0.5 + Math.random() * 0.7,
  };
}

/** Spawn a snow flake. anywhere=true for initial scatter. */
function spawnSnowFlake(w: number, h: number, anywhere: boolean): Drop {
  return {
    x: Math.random() * (w + 40) - 20,
    y: anywhere ? Math.random() * h : -20,
    vx: (Math.random() - 0.5) * 20, // very gentle horizontal drift
    vy: 28 + Math.random() * 32, // slow fall
    phase: Math.random() * Math.PI * 2,
    size: 0.3 + Math.random() * 0.9,
  };
}

/** Spawn a fog blob. anywhere=true places it anywhere across the screen. */
function spawnFogBlob(w: number, h: number, anywhere: boolean): FogBlob {
  return {
    x: anywhere ? Math.random() * w : -300,
    // Spread vertically across the lower two-thirds of the screen — fog hugs the ground
    y: h * 0.35 + Math.random() * h * 0.5,
    vx: 6 + Math.random() * 12, // slow rightward drift
    swayPhase: Math.random() * Math.PI * 2,
  };
}

// ─── Texture generators ────────────────────────────────────────────────────────

/**
 * A thin vertical rain streak (~2×24 px). Rain sprites are rotated in code to match velocity,
 * so a single streak texture covers all wind angles. Alpha tapers at both ends.
 */
function makeRainStreak(): Texture {
  const w = 2;
  const h = 24;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.9)');
  grd.addColorStop(0.8, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  return Texture.from(cv);
}

/**
 * A soft round dot (radial alpha falloff), used for snowflakes. Size controls resolution;
 * sprites scale it at render time.
 */
function makeSoftDot(size: number): Texture {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(cv);
}

/**
 * A large soft elliptical blob for fog banks. The gradient fades from opaque center to
 * transparent edge so overlapping blobs blend smoothly into rolling banks.
 */
function makeFogBlob(size: number): Texture {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.7)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(cv);
}
