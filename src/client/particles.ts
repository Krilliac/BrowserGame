/**
 * General GPU particle emitter (RENDER-03): a reusable, data-driven system for sparks, blood spray,
 * dust kick-up, embers, and magic bursts. Cosmetic and client-only — the renderer fires bursts from
 * `state.fx` events and local triggers (footstep dust). Lives in the world-space `fxLayer`, so
 * particles scroll and sort with the scene.
 *
 * Throughput: one flat pool of `cap` Sprites allocated up front; emitting recycles the oldest live
 * particle when the pool is full → zero per-frame allocation at steady state. Additive particles use
 * the per-sprite `blendMode = 'add'` so sparks/embers glow against the scene (no extra bloom filter
 * is added — the additive blend carries the glow; routing them through the screen-space lighting
 * bloom would mean re-projecting every world particle each frame and is deliberately avoided).
 *
 * Projection: a particle carries a world position (x, y) plus a virtual height `z` (px). It is drawn
 * inside the world container at local `(x, y * PITCH - z)`, so a positive `z` lifts it off the
 * ground (embers float) exactly like the renderer's flying-mob offset.
 */

import { Container, Sprite, Texture } from 'pixi.js';

/** Vertical foreshorten of the ground plane — mirrors PITCH in pixi-renderer.ts. */
const PITCH = 0.6;

const CAP_HIGH = 600;
const CAP_LOW = 160;

export interface EmitterDef {
  /** Which baked texture to use. */
  texture: 'spark' | 'soft';
  /** Particles per burst (scaled down on the 'low' quality path). */
  count: number;
  /** Lifetime range [min, max] in ms. */
  lifeMs: [number, number];
  /** Planar speed range in world px/s. */
  speed: [number, number];
  /** Emission angle range in radians (planar direction). */
  angle: [number, number];
  /** Downward acceleration on height (px/s²); negative makes particles rise (embers). */
  gravity: number;
  /** Initial upward height velocity range (px/s) — gives sparks/embers loft. */
  zSpeed: [number, number];
  startScale: [number, number];
  endScale: number;
  startAlpha: number;
  endAlpha: number;
  tint: number;
  blend: 'normal' | 'add';
}

/** Built-in emitter library, referenced by key so the renderer (and future content) can emit by name. */
export const EMITTERS = {
  hit: {
    texture: 'spark',
    count: 8,
    lifeMs: [180, 360],
    speed: [60, 180],
    angle: [0, Math.PI * 2],
    gravity: 520,
    zSpeed: [40, 140],
    startScale: [0.4, 0.8],
    endScale: 0.05,
    startAlpha: 1,
    endAlpha: 0,
    tint: 0xffffff,
    blend: 'add',
  },
  critHit: {
    texture: 'spark',
    count: 16,
    lifeMs: [220, 460],
    speed: [80, 240],
    angle: [0, Math.PI * 2],
    gravity: 560,
    zSpeed: [60, 180],
    startScale: [0.5, 1],
    endScale: 0.05,
    startAlpha: 1,
    endAlpha: 0,
    tint: 0xffcf6a,
    blend: 'add',
  },
  blood: {
    texture: 'soft',
    count: 10,
    lifeMs: [260, 520],
    speed: [50, 170],
    angle: [0, Math.PI * 2],
    gravity: 900,
    zSpeed: [30, 120],
    startScale: [0.5, 1.1],
    endScale: 0.2,
    startAlpha: 0.95,
    endAlpha: 0,
    tint: 0x8a0c0c,
    blend: 'normal',
  },
  dust: {
    texture: 'soft',
    count: 5,
    lifeMs: [320, 620],
    speed: [10, 50],
    angle: [0, Math.PI * 2],
    gravity: 60,
    zSpeed: [10, 40],
    startScale: [0.5, 1],
    endScale: 1.7,
    startAlpha: 0.34,
    endAlpha: 0,
    tint: 0xb6a98c,
    blend: 'normal',
  },
  slam: {
    texture: 'soft',
    count: 18,
    lifeMs: [320, 560],
    speed: [120, 280],
    angle: [0, Math.PI * 2],
    gravity: 120,
    zSpeed: [10, 50],
    startScale: [0.6, 1.2],
    endScale: 2,
    startAlpha: 0.4,
    endAlpha: 0,
    tint: 0xc2b291,
    blend: 'normal',
  },
  ember: {
    texture: 'spark',
    count: 6,
    lifeMs: [600, 1200],
    speed: [6, 30],
    angle: [0, Math.PI * 2],
    gravity: -60, // rise
    zSpeed: [20, 70],
    startScale: [0.3, 0.7],
    endScale: 0.1,
    startAlpha: 0.9,
    endAlpha: 0,
    tint: 0xff7a2a,
    blend: 'add',
  },
} satisfies Record<string, EmitterDef>;

export type EmitterKey = keyof typeof EMITTERS;

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  life: number;
  maxLife: number;
  startScale: number;
  endScale: number;
  startAlpha: number;
  endAlpha: number;
  active: boolean;
}

/** Normalized age 0..1 of a particle (0 at birth, 1 at death). Pure → unit-tested. */
export function particleT(p: { life: number; maxLife: number }): number {
  if (p.maxLife <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - p.life / p.maxLife));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Advance one particle by `dtMs`. Integrates planar position, height (`z`) under gravity, and the
 * lifetime. Returns whether the particle is still alive. Pure (mutates the passed state, no Pixi).
 */
export function stepParticle(p: Particle, dtMs: number): boolean {
  const dt = dtMs / 1000;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  p.vz -= p.gravity * dt;
  if (p.z < 0) {
    p.z = 0;
    p.vz = 0;
  }
  p.life -= dtMs;
  p.active = p.life > 0;
  return p.active;
}

export class ParticleSystem {
  /** World-space layer; the renderer adds this to fxLayer so particles sort/scroll with the scene. */
  readonly layer = new Container();

  private readonly texSpark: Texture;
  private readonly texSoft: Texture;
  private readonly sprites: Sprite[] = [];
  private readonly parts: Particle[] = [];
  private readonly cap: number;
  private readonly countScale: number;
  /** Round-robin cursor for fast free-slot search. */
  private cursor = 0;

  constructor(quality: 'high' | 'low' = 'high') {
    this.cap = quality === 'low' ? CAP_LOW : CAP_HIGH;
    this.countScale = quality === 'low' ? 0.45 : 1;
    this.layer.eventMode = 'none';
    this.texSpark = bakeSpark();
    this.texSoft = bakeSoftDot();
    for (let i = 0; i < this.cap; i++) {
      const s = new Sprite(this.texSoft);
      s.anchor.set(0.5);
      s.visible = false;
      this.layer.addChild(s);
      this.sprites.push(s);
      this.parts.push(emptyParticle());
    }
  }

  setVisible(on: boolean): void {
    this.layer.visible = on;
  }

  liveCount(): number {
    let n = 0;
    for (const p of this.parts) if (p.active) n++;
    return n;
  }

  /** Fire a one-shot burst of `def` at a world position. */
  emit(key: EmitterKey, worldX: number, worldY: number): void {
    const def = EMITTERS[key];
    const tex = def.texture === 'spark' ? this.texSpark : this.texSoft;
    const n = Math.max(1, Math.round(def.count * this.countScale));
    for (let i = 0; i < n; i++) {
      const idx = this.freeSlot();
      const p = this.parts[idx]!;
      const s = this.sprites[idx]!;
      const ang = lerp(def.angle[0], def.angle[1], Math.random());
      const spd = lerp(def.speed[0], def.speed[1], Math.random());
      p.x = worldX;
      p.y = worldY;
      p.z = 0;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.vz = lerp(def.zSpeed[0], def.zSpeed[1], Math.random());
      p.gravity = def.gravity;
      p.maxLife = lerp(def.lifeMs[0], def.lifeMs[1], Math.random());
      p.life = p.maxLife;
      p.startScale = lerp(def.startScale[0], def.startScale[1], Math.random());
      p.endScale = def.endScale;
      p.startAlpha = def.startAlpha;
      p.endAlpha = def.endAlpha;
      p.active = true;

      s.texture = tex;
      s.tint = def.tint;
      s.blendMode = def.blend === 'add' ? 'add' : 'normal';
      s.visible = true;
      this.sync(idx);
    }
  }

  /** Integrate every live particle and sync its sprite. `dtMs` is the frame delta in ms. */
  update(dtMs: number): void {
    const dt = Math.min(50, dtMs); // clamp huge stalls so particles don't teleport
    for (let i = 0; i < this.cap; i++) {
      const p = this.parts[i]!;
      if (!p.active) continue;
      if (!stepParticle(p, dt)) {
        this.sprites[i]!.visible = false;
        continue;
      }
      this.sync(i);
    }
  }

  clear(): void {
    for (let i = 0; i < this.cap; i++) {
      this.parts[i]!.active = false;
      this.sprites[i]!.visible = false;
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.texSpark.destroy(true);
    this.texSoft.destroy(true);
  }

  /** Project a particle's world+height state to its sprite's local transform and fade. */
  private sync(i: number): void {
    const p = this.parts[i]!;
    const s = this.sprites[i]!;
    const t = particleT(p);
    s.position.set(p.x, p.y * PITCH - p.z);
    s.zIndex = p.y;
    const sc = lerp(p.startScale, p.endScale, t);
    s.scale.set(sc, sc);
    s.alpha = lerp(p.startAlpha, p.endAlpha, t);
  }

  /** First inactive slot from a round-robin cursor; else recycle the oldest (most-elapsed) particle. */
  private freeSlot(): number {
    for (let k = 0; k < this.cap; k++) {
      const i = (this.cursor + k) % this.cap;
      if (!this.parts[i]!.active) {
        this.cursor = (i + 1) % this.cap;
        return i;
      }
    }
    // Pool full: recycle the particle closest to death (largest normalized age).
    let worst = 0;
    let worstT = -1;
    for (let i = 0; i < this.cap; i++) {
      const t = particleT(this.parts[i]!);
      if (t > worstT) {
        worstT = t;
        worst = i;
      }
    }
    return worst;
  }
}

function emptyParticle(): Particle {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    gravity: 0,
    life: 0,
    maxLife: 0,
    startScale: 1,
    endScale: 1,
    startAlpha: 1,
    endAlpha: 0,
    active: false,
  };
}

// ─── Texture bakes ───────────────────────────────────────────────────────────────

/** A small bright dot with a hard-ish core — reads as a spark; tinted per particle. */
function bakeSpark(): Texture {
  const size = 16;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(cv);
}

/** A soft round puff (gentle falloff) — dust, blood spray, magic; tinted per particle. */
function bakeSoftDot(): Texture {
  const size = 24;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(cv);
}
