/**
 * ASSET-FX — animated effect sprite-strips (explosions, impacts, casts, auras). Distinct from the
 * particle system (baked dots): these are big keyframed effects packed into a horizontal strip, with a
 * manifest (`FxStrip`) the renderer's one-shot FX path plays. Additive effects ride the bloom path.
 */

import { Raster, type RGBA } from '../shared/raster.ts';
import { Rng } from '../shared/rng.ts';
import { cubicOut } from '../shared/curves.ts';

export type FxKind = 'explosion' | 'frost' | 'lightning' | 'holyNova' | 'poison' | 'slash';

export interface FxSpec {
  kind: FxKind;
  fw: number;
  fh: number;
  frames: number;
  perFrameMs: number;
  blend: 'normal' | 'add';
  anchor: 'center' | 'feet';
  tint: number;
}

const FX: Record<FxKind, Omit<FxSpec, 'kind'>> = {
  explosion: {
    fw: 64,
    fh: 64,
    frames: 8,
    perFrameMs: 50,
    blend: 'add',
    anchor: 'center',
    tint: 0xffae3c,
  },
  frost: {
    fw: 64,
    fh: 64,
    frames: 8,
    perFrameMs: 55,
    blend: 'add',
    anchor: 'center',
    tint: 0x9fe0ff,
  },
  lightning: {
    fw: 64,
    fh: 80,
    frames: 6,
    perFrameMs: 45,
    blend: 'add',
    anchor: 'feet',
    tint: 0xcfe0ff,
  },
  holyNova: {
    fw: 80,
    fh: 80,
    frames: 8,
    perFrameMs: 55,
    blend: 'add',
    anchor: 'center',
    tint: 0xfff0c0,
  },
  poison: {
    fw: 64,
    fh: 64,
    frames: 8,
    perFrameMs: 70,
    blend: 'normal',
    anchor: 'center',
    tint: 0x6fbf4a,
  },
  slash: {
    fw: 64,
    fh: 64,
    frames: 5,
    perFrameMs: 40,
    blend: 'add',
    anchor: 'center',
    tint: 0xffffff,
  },
};

function rgba(n: number, a: number): RGBA {
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, a];
}

function drawFrame(r: Raster, spec: FxSpec, t: number, rng: Rng): void {
  const cx = spec.fw / 2;
  const cy = spec.fh / 2;
  const tint = spec.tint;
  if (spec.kind === 'explosion') {
    const rad = cubicOut(t) * spec.fw * 0.46;
    const fade = 1 - t;
    r.radial(cx, cy, rad, rgba(tint, Math.round(220 * fade)), 1.5);
    r.radial(cx, cy, rad * 0.6, rgba(0xffffff, Math.round(200 * fade)), 2);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rng.next();
      const d = rad * (0.7 + rng.next() * 0.4);
      r.disc(
        cx + Math.cos(a) * d,
        cy + Math.sin(a) * d,
        2 * fade + 0.5,
        rgba(tint, Math.round(220 * fade)),
      );
    }
  } else if (spec.kind === 'frost') {
    const rad = cubicOut(t) * spec.fw * 0.44;
    const fade = 1 - t;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ex = cx + Math.cos(a) * rad;
      const ey = cy + Math.sin(a) * rad;
      r.line(cx, cy, ex, ey, 1.4 * fade + 0.4, rgba(tint, Math.round(200 * fade)));
      r.polygon(
        [
          [ex, ey - 3],
          [ex + 3, ey],
          [ex, ey + 3],
          [ex - 3, ey],
        ],
        rgba(0xffffff, Math.round(180 * fade)),
      );
    }
  } else if (spec.kind === 'lightning') {
    const fade = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
    let x = cx;
    let y = 4;
    while (y < spec.fh - 4) {
      const nx = cx + (rng.next() - 0.5) * spec.fw * 0.5;
      const ny = y + spec.fh / 5;
      r.line(x, y, nx, ny, 2 * fade + 0.4, rgba(0xffffff, Math.round(230 * fade)));
      r.line(x, y, nx, ny, 4 * fade + 0.6, rgba(tint, Math.round(110 * fade)));
      x = nx;
      y = ny;
    }
  } else if (spec.kind === 'holyNova') {
    const rad = cubicOut(t) * spec.fw * 0.46;
    const fade = 1 - t;
    r.ellipse(cx, cy, rad, rad, [0, 0, 0, 0]);
    for (let ring = 0; ring < 2; ring++) {
      const rr = rad - ring * 5;
      if (rr > 0) {
        for (let i = 0; i < 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          r.disc(
            cx + Math.cos(a) * rr,
            cy + Math.sin(a) * rr,
            1.5 * fade + 0.4,
            rgba(tint, Math.round(220 * fade)),
          );
        }
      }
    }
    r.radial(cx, cy, rad * 0.4, rgba(0xffffff, Math.round(140 * fade)), 2);
  } else if (spec.kind === 'poison') {
    const fade = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + t * 3;
      const d = spec.fw * 0.3 * (0.4 + i / 14);
      r.radial(
        cx + Math.cos(a) * d,
        cy + Math.sin(a) * d,
        8 + i,
        rgba(tint, Math.round(90 * fade)),
        1.2,
      );
    }
  } else {
    // slash: a sweeping arc
    const a0 = -0.9 + t * 0.4;
    const fade = 1 - t;
    for (let s = 0; s < 18; s++) {
      const a = a0 + (s / 18) * 1.8;
      const rr = spec.fw * 0.4;
      r.disc(
        cx + Math.cos(a) * rr,
        cy + Math.sin(a) * rr,
        2.2 * fade + 0.5,
        rgba(0xffffff, Math.round(220 * fade)),
      );
    }
  }
}

export interface FxStripOut {
  png: Uint8Array;
  manifest: {
    key: string;
    src: string;
    fw: number;
    fh: number;
    frames: number;
    perFrameMs: number;
    blend: 'normal' | 'add';
    anchor: 'center' | 'feet';
    loop: false;
  };
}

export function synthFx(kind: FxKind, src: string, seed: number): FxStripOut {
  const spec: FxSpec = { kind, ...FX[kind] };
  const strip = new Raster(spec.fw * spec.frames, spec.fh);
  for (let f = 0; f < spec.frames; f++) {
    const cell = new Raster(spec.fw, spec.fh);
    drawFrame(cell, spec, f / (spec.frames - 1), new Rng(seed + f * 131 + 1));
    strip.paste(cell, f * spec.fw, 0);
  }
  return {
    png: strip.toPng(),
    manifest: {
      key: kind,
      src,
      fw: spec.fw,
      fh: spec.fh,
      frames: spec.frames,
      perFrameMs: spec.perFrameMs,
      blend: spec.blend,
      anchor: spec.anchor,
      loop: false,
    },
  };
}

export const FX_KINDS = Object.keys(FX) as FxKind[];
