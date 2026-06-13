/**
 * Ground decals (RENDER-02): persistent flat marks on the ground plane — blood pools, scorch,
 * corpse stains, craters — that accumulate from combat FX, fade over time, and sort under actors.
 *
 * Cosmetic and client-only: the renderer spawns these from `state.fx` events; nothing here touches
 * the simulation. The layer is added as the FIRST child of the world container, so decals inherit
 * the camera transform for free and render above the ground texture but below every prop and actor.
 *
 * Pooling: a fixed pool of `CAP` sprites is allocated up front; spawning recycles the oldest live
 * decal once the pool is full, so there are zero per-frame allocations at steady state. Textures are
 * baked once on a 2D canvas (same approach as the renderer's shadow/ground bakes) — no asset fetch
 * to fail, no normal-map dependency.
 */

import { Container, Sprite, Texture } from 'pixi.js';

export type DecalKind = 'blood' | 'scorch' | 'corpse' | 'crater';

/** Vertical foreshorten of the ground plane — mirrors PITCH in pixi-renderer.ts so decals lie flat. */
const PITCH = 0.6;

/** Max live decals; oldest is recycled past this. The 'low' (touch) path uses a smaller cap. */
const CAP_HIGH = 120;
const CAP_LOW = 48;

/** Per-kind lifetime in ms. Corpses linger; blood/scorch are medium. */
const TTL: Record<DecalKind, number> = {
  blood: 9000,
  scorch: 12000,
  corpse: 30000,
  crater: 16000,
};

/** Per-kind peak opacity. */
const PEAK: Record<DecalKind, number> = {
  blood: 0.72,
  scorch: 0.6,
  corpse: 0.5,
  crater: 0.55,
};

/** Fraction of the lifetime spent fading out at the end. */
const FADE_FRAC = 0.25;

export interface DecalOpts {
  /** Rotation in radians (defaults to a deterministic-ish spread per spawn). */
  rotation?: number;
  /** Extra scale multiplier on top of the kind's base size. */
  scale?: number;
  /** Override the kind's default lifetime (ms). */
  ttlMs?: number;
}

interface DecalState {
  kind: DecalKind;
  bornAt: number;
  ttl: number;
  peak: number;
  active: boolean;
}

/**
 * Opacity of a decal at time `now` given its birth and lifetime: full `peak` until the fade band,
 * then a linear ramp to 0, and 0 once expired. Pure (no Pixi) so the fade curve is unit-tested.
 */
export function decalAlpha(bornAt: number, ttl: number, peak: number, now: number): number {
  const age = now - bornAt;
  if (age <= 0) return peak;
  if (age >= ttl) return 0;
  const fadeStart = ttl * (1 - FADE_FRAC);
  if (age <= fadeStart) return peak;
  return peak * (1 - (age - fadeStart) / (ttl * FADE_FRAC));
}

export class Decals {
  /** World-space layer; the renderer inserts this as world's first child (above ground, below props). */
  readonly layer = new Container();

  private readonly textures: Record<DecalKind, Texture>;
  private readonly sprites: Sprite[] = [];
  private readonly state: DecalState[] = [];
  private readonly cap: number;
  /** Monotonic spawn counter, only used to vary rotation deterministically per spawn. */
  private spawns = 0;

  constructor(quality: 'high' | 'low' = 'high') {
    this.cap = quality === 'low' ? CAP_LOW : CAP_HIGH;
    this.layer.eventMode = 'none';
    this.textures = {
      blood: bakeBlood(),
      scorch: bakeScorch(),
      corpse: bakeCorpse(),
      crater: bakeCrater(),
    };
    for (let i = 0; i < this.cap; i++) {
      const s = new Sprite(this.textures.blood);
      s.anchor.set(0.5);
      s.visible = false;
      this.layer.addChild(s);
      this.sprites.push(s);
      this.state.push({ kind: 'blood', bornAt: 0, ttl: 0, peak: 0, active: false });
    }
  }

  /** Mirror the renderer's "reduce effects" toggle. */
  setVisible(on: boolean): void {
    this.layer.visible = on;
  }

  /** Number of live decals — used by tests to assert the cap. */
  liveCount(): number {
    let n = 0;
    for (const d of this.state) if (d.active) n++;
    return n;
  }

  /** Drop a decal at a world position. Recycles the oldest live decal when the pool is full. */
  spawn(kind: DecalKind, worldX: number, worldY: number, now: number, opts: DecalOpts = {}): void {
    const idx = this.freeSlot();
    const s = this.sprites[idx]!;
    const st = this.state[idx]!;
    st.kind = kind;
    st.bornAt = now;
    st.ttl = opts.ttlMs ?? TTL[kind];
    st.peak = PEAK[kind];
    st.active = true;

    s.texture = this.textures[kind];
    s.position.set(worldX, worldY * PITCH);
    // Decals lie on the tilted ground: the baked texture is already squashed, and a small extra
    // y-flatten keeps round marks reading flat. Rotation varies per spawn so repeats don't tile.
    s.rotation = opts.rotation ?? (this.spawns % 8) * (Math.PI / 4);
    const sc = opts.scale ?? 1;
    s.scale.set(sc, sc);
    s.alpha = st.peak;
    s.visible = true;
    this.spawns++;
  }

  /** Fade live decals; recycle any that have fully expired. */
  update(now: number): void {
    for (let i = 0; i < this.cap; i++) {
      const st = this.state[i]!;
      if (!st.active) continue;
      const a = decalAlpha(st.bornAt, st.ttl, st.peak, now);
      if (a <= 0) {
        st.active = false;
        this.sprites[i]!.visible = false;
      } else {
        this.sprites[i]!.alpha = a;
      }
    }
  }

  /** Hide and free every decal (called on area change so stains don't bleed across zones). */
  clear(): void {
    for (let i = 0; i < this.cap; i++) {
      this.state[i]!.active = false;
      this.sprites[i]!.visible = false;
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    for (const t of Object.values(this.textures)) t.destroy(true);
  }

  /** First inactive slot, else the oldest live decal (smallest bornAt) to recycle. */
  private freeSlot(): number {
    let oldest = 0;
    let oldestBorn = Infinity;
    for (let i = 0; i < this.cap; i++) {
      const st = this.state[i]!;
      if (!st.active) return i;
      if (st.bornAt < oldestBorn) {
        oldestBorn = st.bornAt;
        oldest = i;
      }
    }
    return oldest;
  }
}

// ─── Texture bakes ───────────────────────────────────────────────────────────────
// Each mark is drawn squashed vertically (scaleY ≈ PITCH) so it reads as lying flat under the
// dimetric camera. Irregular overlapping blobs avoid a clean-ellipse "sticker" look.

function decalCanvas(
  w: number,
  h: number,
): { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  return { cv, ctx };
}

function blob(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

function bakeBlood(): Texture {
  const W = 96;
  const H = 64;
  const { cv, ctx } = decalCanvas(W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, PITCH); // flatten onto the ground plane
  ctx.translate(-W / 2, -H / 2);
  blob(ctx, W / 2, H / 2, 30, 'rgba(120,12,12,0.85)');
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const d = 16 + Math.random() * 16;
    blob(
      ctx,
      W / 2 + Math.cos(a) * d,
      H / 2 + Math.sin(a) * d,
      6 + Math.random() * 8,
      'rgba(96,8,8,0.8)',
    );
  }
  ctx.restore();
  return Texture.from(cv);
}

function bakeScorch(): Texture {
  const W = 88;
  const H = 60;
  const { cv, ctx } = decalCanvas(W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, PITCH);
  ctx.translate(-W / 2, -H / 2);
  blob(ctx, W / 2, H / 2, 30, 'rgba(18,14,12,0.9)');
  blob(ctx, W / 2, H / 2, 20, 'rgba(40,26,16,0.6)'); // charred warm core
  ctx.restore();
  return Texture.from(cv);
}

function bakeCorpse(): Texture {
  const W = 104;
  const H = 70;
  const { cv, ctx } = decalCanvas(W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, PITCH);
  ctx.translate(-W / 2, -H / 2);
  blob(ctx, W / 2, H / 2, 34, 'rgba(54,42,34,0.7)');
  blob(ctx, W / 2, H / 2, 18, 'rgba(72,18,18,0.55)'); // dark blood center
  ctx.restore();
  return Texture.from(cv);
}

function bakeCrater(): Texture {
  const W = 92;
  const H = 60;
  const { cv, ctx } = decalCanvas(W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1, PITCH);
  ctx.translate(-W / 2, -H / 2);
  blob(ctx, W / 2, H / 2, 30, 'rgba(20,16,12,0.75)');
  // A lighter raised rim ring.
  ctx.strokeStyle = 'rgba(120,104,80,0.5)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  return Texture.from(cv);
}
