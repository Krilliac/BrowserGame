import { Container, Graphics, Sprite, Texture } from 'pixi.js';

/**
 * Screen-space ambiance that reinforces the 2.5D mood: a slow day/night cycle (outdoor areas
 * only), a drifting ambient particle field (pollen / fireflies / crypt dust), and an edge
 * vignette to frame the scene. All of it lives above the world but below the HUD, and is kept
 * out of the renderer proper so each stays a focused unit. The renderer owns one Atmosphere,
 * adds its display objects to the stage, and drives it once per frame.
 */

// One full dawn→day→dusk→night loop. Long enough to feel like a living world, short enough to
// actually witness within a session.
const DAY_MS = 180_000;
const MAX_NIGHT_ALPHA = 0.45;
const NIGHT_COLOR = 0x0a1430;
const WARM_COLOR = 0xffae5c;

interface AreaMood {
  /** Base tint always applied (area "character"), independent of time of day. */
  baseColor: number;
  baseAlpha: number;
  /** Outdoor areas get the day/night cycle; indoor ones (crypts) stay their own gloom. */
  outdoor: boolean;
  particle: { color: number; count: number; rise: number; flicker: boolean };
}

const MOODS: Record<string, AreaMood> = {
  town: {
    baseColor: 0xffdca8,
    baseAlpha: 0.05,
    outdoor: true,
    particle: { color: 0xfff0c0, count: 36, rise: -10, flicker: false },
  },
  wilderness: {
    baseColor: 0x4a6a4a,
    baseAlpha: 0.1,
    outdoor: true,
    particle: { color: 0xbfff8a, count: 40, rise: -6, flicker: true },
  },
  crypt: {
    baseColor: 0x203050,
    baseAlpha: 0.34,
    outdoor: false,
    particle: { color: 0x8c93a8, count: 44, rise: 14, flicker: false },
  },
};
const DEFAULT_MOOD = MOODS.wilderness!;

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
  private mood: AreaMood = DEFAULT_MOOD;
  private lastNow = performance.now();
  private w = 0;
  private h = 0;

  constructor() {
    this.dot = makeSoftDot();
    this.vignette = new Sprite(makeVignette());
    this.screen.eventMode = 'none';
    this.particleLayer.eventMode = 'none';
    this.screen.addChild(this.tint, this.vignette);
  }

  setArea(areaId: string): void {
    this.mood = MOODS[areaId] ?? DEFAULT_MOOD;
    this.reseed(this.mood.particle.count);
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
    const rise = this.mood.particle.rise;
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

  update(now: number, w: number, h: number): void {
    const dt = Math.min(0.05, (now - this.lastNow) / 1000);
    this.lastNow = now;
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.vignette.width = w;
      this.vignette.height = h;
    }

    this.drawOverlay(w, h);
    this.stepMotes(dt, now, w, h);
  }

  private drawOverlay(w: number, h: number): void {
    const g = this.tint;
    g.clear();
    g.rect(0, 0, w, h).fill({ color: this.mood.baseColor, alpha: this.mood.baseAlpha });
    if (this.mood.outdoor) {
      const day = this.daylight();
      const night = (1 - day) * MAX_NIGHT_ALPHA;
      if (night > 0.01) g.rect(0, 0, w, h).fill({ color: NIGHT_COLOR, alpha: night });
      // Warm wash peaks at dawn/dusk (daylight ≈ 0.5), fades out by noon/midnight.
      const warm = Math.max(0, 1 - Math.abs(day - 0.5) * 4) * 0.16;
      if (warm > 0.01) g.rect(0, 0, w, h).fill({ color: WARM_COLOR, alpha: warm });
    }
  }

  private stepMotes(dt: number, now: number, w: number, h: number): void {
    const flicker = this.mood.particle.flicker;
    const tint = this.mood.particle.color;
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

/** A radial vignette (transparent center → dark edges), stretched to the screen each frame. */
function makeVignette(): Texture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const grd = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.28,
    size / 2,
    size / 2,
    size * 0.62,
  );
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(cv);
}
