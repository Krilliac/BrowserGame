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
const ASH_MAX = 150; // RENDER-14: slow grey drift
const SAND_MAX = 240; // RENDER-14: fast wind-blown grit
const LEAF_MAX = 90; // RENDER-14: tumbling leaves

// ─── Per-particle state (rain + snow + ash + sand + leaves share one interface) ─
interface Drop {
  x: number;
  y: number;
  /** Base velocity (before intensity scaling for rain). */
  vx: number;
  vy: number;
  /** Phase offset for the sine sway used by snow/leaves. */
  phase: number;
  /** Sprite scale factor, randomized at spawn. */
  size: number;
  /** Leaves only: current rotation + spin speed (rad, rad/s). */
  rot?: number;
  vr?: number;
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
  private readonly leafTex: Texture;

  // Sprite pools
  private readonly rainSprites: Sprite[] = [];
  private readonly snowSprites: Sprite[] = [];
  private readonly fogSprites: Sprite[] = [];
  private readonly ashSprites: Sprite[] = [];
  private readonly sandSprites: Sprite[] = [];
  private readonly leafSprites: Sprite[] = [];
  private lightningFlash!: Sprite; // full-screen flash for the 'lightning' weather

  // Particle state arrays
  private readonly rainDrops: Drop[] = [];
  private readonly snowFlakes: Drop[] = [];
  private readonly fogBlobs: FogBlob[] = [];
  private readonly ashFlakes: Drop[] = [];
  private readonly sandDrops: Drop[] = [];
  private readonly leafFlakes: Drop[] = [];
  // Lightning flash timing (ms on the renderer clock).
  private nextFlashAt = 0;
  private flashUntil = 0;
  private flashPeak = 0;

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
    this.leafTex = makeLeaf();

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
    // RENDER-14 pools: ash + sand reuse the soft-dot / streak textures (tinted at render); leaves
    // get their own small tumbling cutout. All start hidden so setWeather never allocates.
    for (let i = 0; i < ASH_MAX; i++) {
      const s = new Sprite(this.snowTex);
      s.anchor.set(0.5);
      s.visible = false;
      this.layer.addChild(s);
      this.ashSprites.push(s);
      this.ashFlakes.push(emptyDrop());
    }
    for (let i = 0; i < SAND_MAX; i++) {
      const s = new Sprite(this.rainTex);
      s.anchor.set(0.5, 0);
      s.visible = false;
      this.layer.addChild(s);
      this.sandSprites.push(s);
      this.sandDrops.push(emptyDrop());
    }
    for (let i = 0; i < LEAF_MAX; i++) {
      const s = new Sprite(this.leafTex);
      s.anchor.set(0.5);
      s.visible = false;
      this.layer.addChild(s);
      this.leafSprites.push(s);
      this.leafFlakes.push(emptyDrop());
    }
    // Lightning is a single full-screen flash sprite (tinted white, alpha pulsed on strike).
    this.lightningFlash = new Sprite(Texture.WHITE);
    this.lightningFlash.tint = 0xdfe8ff;
    this.lightningFlash.alpha = 0;
    this.lightningFlash.visible = false;
    this.layer.addChild(this.lightningFlash);
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
    else if (kind === 'ash') this.reseedAsh(w, h);
    else if (kind === 'sand') this.reseedSand(w, h);
    else if (kind === 'leaves') this.reseedLeaves(w, h);
    // 'lightning' has no particles to seed — its flash is driven entirely in stepLightning.
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
    else if (this.kind === 'ash') this.stepAsh(now, w, h);
    else if (this.kind === 'sand') this.stepSand(now, w, h);
    else if (this.kind === 'leaves') this.stepLeaves(now, w, h);
    else if (this.kind === 'lightning') this.stepLightning(now, w, h);
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
    for (const s of this.ashSprites) s.visible = false;
    for (const s of this.sandSprites) s.visible = false;
    for (const s of this.leafSprites) s.visible = false;
    this.lightningFlash.visible = false;
    this.lightningFlash.alpha = 0;
    this.flashUntil = 0;
    this.nextFlashAt = 0;
  }

  // ─── Ash (RENDER-14) — slow grey drift, like a dim heavy snow ────────────────

  private reseedAsh(w: number, h: number): void {
    const count = this.ashCount();
    for (let i = 0; i < count; i++) {
      this.ashFlakes[i] = spawnAsh(w, h, true);
      this.ashSprites[i]!.visible = true;
    }
  }

  private ashCount(): number {
    return Math.round(40 + this.intensity * (ASH_MAX - 40));
  }

  private stepAsh(now: number, w: number, h: number): void {
    const count = this.ashCount();
    const baseAlpha = 0.3 + this.intensity * 0.35;
    for (let i = 0; i < count; i++) {
      const f = this.ashFlakes[i]!;
      const s = this.ashSprites[i]!;
      const sway = Math.sin(now / 2600 + f.phase) * 10;
      f.x += (f.vx + sway) / 60;
      f.y += f.vy / 60;
      if (f.y > h + 20) this.ashFlakes[i] = spawnAsh(w, h, false);
      else if (f.x < -20) f.x += w + 40;
      else if (f.x > w + 20) f.x -= w + 40;
      s.position.set(f.x, f.y);
      s.scale.set(f.size * 0.8);
      s.alpha = baseAlpha * (0.6 + f.size * 0.4);
      s.tint = 0x6b6b6b; // soot grey
    }
  }

  // ─── Sand (RENDER-14) — fast wind-blown grit, near-horizontal, warm ──────────

  private reseedSand(w: number, h: number): void {
    const count = this.sandCount();
    for (let i = 0; i < count; i++) {
      this.sandDrops[i] = spawnSand(w, h, true);
      this.sandSprites[i]!.visible = true;
    }
  }

  private sandCount(): number {
    return Math.round(80 + this.intensity * (SAND_MAX - 80));
  }

  private stepSand(_now: number, w: number, h: number): void {
    const count = this.sandCount();
    const speedScale = 0.9 + this.intensity * 0.5;
    const baseAlpha = 0.18 + this.intensity * 0.3;
    for (let i = 0; i < count; i++) {
      const d = this.sandDrops[i]!;
      const s = this.sandSprites[i]!;
      d.x += (d.vx * speedScale) / 60;
      d.y += (d.vy * speedScale) / 60;
      if (d.x > w + 30) this.sandDrops[i] = spawnSand(w, h, false);
      else if (d.y < -20) d.y += h + 40;
      else if (d.y > h + 20) d.y -= h + 40;
      s.position.set(d.x, d.y);
      s.rotation = Math.atan2(d.vx, d.vy) + Math.PI; // near-horizontal streaks
      s.scale.set(d.size, d.size * 0.7);
      s.alpha = baseAlpha * d.size;
      s.tint = 0xcaa56a; // warm tan
    }
  }

  // ─── Leaves (RENDER-14) — tumbling, rotating, slow fall + sway ───────────────

  private reseedLeaves(w: number, h: number): void {
    const count = this.leafCount();
    for (let i = 0; i < count; i++) {
      this.leafFlakes[i] = spawnLeaf(w, h, true);
      this.leafSprites[i]!.visible = true;
    }
  }

  private leafCount(): number {
    return Math.round(25 + this.intensity * (LEAF_MAX - 25));
  }

  private stepLeaves(now: number, w: number, h: number): void {
    const count = this.leafCount();
    const baseAlpha = 0.6 + this.intensity * 0.3;
    // Warm autumn palette, chosen per leaf from its phase so the fall is varied.
    const tints = [0xb5562a, 0xc98a2e, 0x8a6d2f, 0x9c3b22];
    for (let i = 0; i < count; i++) {
      const f = this.leafFlakes[i]!;
      const s = this.leafSprites[i]!;
      const sway = Math.sin(now / 1300 + f.phase) * 34; // leaves swing wider than snow
      f.x += (f.vx + sway) / 60;
      f.y += f.vy / 60;
      f.rot = (f.rot ?? 0) + (f.vr ?? 0) / 60;
      if (f.y > h + 24) this.leafFlakes[i] = spawnLeaf(w, h, false);
      else if (f.x < -30) f.x += w + 60;
      else if (f.x > w + 30) f.x -= w + 60;
      s.position.set(f.x, f.y);
      s.rotation = f.rot ?? 0;
      // Tumble: squash horizontally on the sine so the leaf appears to flip edge-on.
      s.scale.set(f.size * Math.cos(now / 600 + f.phase) * 0.6 + f.size * 0.4, f.size);
      s.alpha = baseAlpha;
      s.tint = tints[Math.abs(Math.round(f.phase * 7)) % tints.length]!;
    }
  }

  // ─── Lightning (RENDER-14) — occasional full-screen flash ────────────────────

  private stepLightning(now: number, w: number, h: number): void {
    this.lightningFlash.visible = true;
    this.lightningFlash.width = w;
    this.lightningFlash.height = h;
    if (this.nextFlashAt === 0) this.nextFlashAt = now + this.flashInterval();
    if (now >= this.nextFlashAt && now > this.flashUntil) {
      // Strike: a brief bright pulse, then schedule the next one.
      this.flashUntil = now + 160;
      this.flashPeak = 0.35 + this.intensity * 0.45;
      this.nextFlashAt = now + this.flashInterval();
    }
    // Fade the flash out over its short window.
    const remain = this.flashUntil - now;
    this.lightningFlash.alpha = remain > 0 ? this.flashPeak * Math.max(0, remain / 160) : 0;
  }

  /** Random gap before the next strike — longer when the storm is mild. */
  private flashInterval(): number {
    return 2600 + Math.random() * (7000 - this.intensity * 4000);
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

/** Spawn an ash flake — a slow, gently swaying grey mote (RENDER-14). */
function spawnAsh(w: number, h: number, anywhere: boolean): Drop {
  return {
    x: Math.random() * (w + 40) - 20,
    y: anywhere ? Math.random() * h : -20,
    vx: (Math.random() - 0.5) * 12,
    vy: 16 + Math.random() * 22, // slower than snow
    phase: Math.random() * Math.PI * 2,
    size: 0.3 + Math.random() * 0.8,
  };
}

/** Spawn a sand streak — fast, near-horizontal, entering from the left (RENDER-14). */
function spawnSand(w: number, h: number, anywhere: boolean): Drop {
  return {
    x: anywhere ? Math.random() * w : -20,
    y: Math.random() * h,
    vx: 420 + Math.random() * 280, // fast wind
    vy: 30 + Math.random() * 50, // slight downward slant
    phase: 0,
    size: 0.4 + Math.random() * 0.7,
  };
}

/** Spawn a tumbling leaf — slow fall with a wide sway and its own spin (RENDER-14). */
function spawnLeaf(w: number, h: number, anywhere: boolean): Drop {
  return {
    x: Math.random() * (w + 60) - 30,
    y: anywhere ? Math.random() * h : -24,
    vx: (Math.random() - 0.5) * 24,
    vy: 30 + Math.random() * 36,
    phase: Math.random() * Math.PI * 2,
    size: 0.7 + Math.random() * 0.7,
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 4, // rad/s spin
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
 * A small leaf cutout (~14×10 px) for the 'leaves' weather. A simple pointed-oval blade with a
 * center vein, drawn white so the per-leaf tint colors it. Sprites rotate + squash it to tumble.
 */
function makeLeaf(): Texture {
  const w = 16;
  const h = 12;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.beginPath();
  // Two quadratic curves forming a leaf blade.
  ctx.moveTo(1, h / 2);
  ctx.quadraticCurveTo(w / 2, -1, w - 1, h / 2);
  ctx.quadraticCurveTo(w / 2, h + 1, 1, h / 2);
  ctx.fill();
  // A faint center vein for a bit of detail.
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(2, h / 2);
  ctx.lineTo(w - 2, h / 2);
  ctx.stroke();
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
