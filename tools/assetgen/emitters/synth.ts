/**
 * ASSET-EMIT — particle emitter preset *data* (not pixels). Produces tuned `EmitterDef`s matching the
 * shipped `EMITTERS` registry in `src/client/particles.ts` (the textures `spark`/`soft` are baked
 * in-engine). A small parametric model maps an intent + intensity → a def; output is validated JSON
 * a build step can spread into the registry.
 */

import type { Rng } from '../shared/rng.ts';

/** Mirrors `EmitterDef` in src/client/particles.ts exactly. */
export interface EmitterDef {
  texture: 'spark' | 'soft';
  count: number;
  lifeMs: [number, number];
  speed: [number, number];
  angle: [number, number];
  gravity: number;
  zSpeed: [number, number];
  startScale: [number, number];
  endScale: number;
  startAlpha: number;
  endAlpha: number;
  tint: number;
  blend: 'normal' | 'add';
}

export type EmitIntent = 'dust' | 'blood' | 'ember' | 'frost' | 'heal' | 'spark' | 'dash';

const FULL = Math.PI * 2;

/** Build an EmitterDef for an intent at `intensity` 0..1 (scales count/speed), tinted by `tint`. */
export function makeEmitter(
  intent: EmitIntent,
  intensity: number,
  tint: number,
  rng: Rng,
): EmitterDef {
  const i = Math.max(0.1, Math.min(1, intensity));
  const jitter = (base: number, frac: number) => base * (1 + (rng.next() - 0.5) * frac);
  switch (intent) {
    case 'dust':
      return def(
        'soft',
        Math.round(jitter(5 * i, 0.2)),
        [320, 620],
        [10, 50],
        [0, FULL],
        60,
        [10, 40],
        [0.5, 1],
        1.7,
        0.34,
        0,
        tint,
        'normal',
      );
    case 'blood':
      return def(
        'soft',
        Math.round(jitter(10 * i, 0.2)),
        [260, 520],
        [50, 170],
        [0, FULL],
        900,
        [30, 120],
        [0.5, 1.1],
        0.2,
        0.95,
        0,
        tint,
        'normal',
      );
    case 'ember':
      return def(
        'spark',
        Math.round(jitter(6 * i, 0.2)),
        [600, 1200],
        [6, 30],
        [0, FULL],
        -60,
        [20, 70],
        [0.3, 0.7],
        0.1,
        0.9,
        0,
        tint,
        'add',
      );
    case 'frost':
      return def(
        'spark',
        Math.round(jitter(9 * i, 0.2)),
        [300, 600],
        [40, 120],
        [0, FULL],
        200,
        [10, 60],
        [0.4, 0.9],
        0.15,
        0.95,
        0,
        tint,
        'add',
      );
    case 'heal':
      return def(
        'spark',
        Math.round(jitter(8 * i, 0.2)),
        [500, 1000],
        [10, 40],
        [-Math.PI, 0],
        -90,
        [30, 80],
        [0.3, 0.7],
        0.1,
        0.9,
        0,
        tint,
        'add',
      );
    case 'dash':
      return def(
        'soft',
        Math.round(jitter(7 * i, 0.2)),
        [200, 380],
        [4, 24],
        [0, FULL],
        30,
        [4, 18],
        [0.6, 1.1],
        1.4,
        0.4,
        0,
        tint,
        'normal',
      );
    case 'spark':
    default:
      return def(
        'spark',
        Math.round(jitter(8 * i, 0.2)),
        [180, 360],
        [60, 180],
        [0, FULL],
        520,
        [40, 140],
        [0.4, 0.8],
        0.05,
        1,
        0,
        tint,
        'add',
      );
  }
}

function def(
  texture: EmitterDef['texture'],
  count: number,
  lifeMs: [number, number],
  speed: [number, number],
  angle: [number, number],
  gravity: number,
  zSpeed: [number, number],
  startScale: [number, number],
  endScale: number,
  startAlpha: number,
  endAlpha: number,
  tint: number,
  blend: EmitterDef['blend'],
): EmitterDef {
  return {
    texture,
    count: Math.max(1, count),
    lifeMs,
    speed,
    angle,
    gravity,
    zSpeed,
    startScale,
    endScale,
    startAlpha,
    endAlpha,
    tint,
    blend,
  };
}

/** Validate a def against the shipped contract (ordered ranges, positive count, valid enums). */
export function validateEmitter(d: EmitterDef): void {
  const okPair = (p: [number, number]) => p[0] <= p[1];
  if (!(d.count > 0)) throw new Error('count must be > 0');
  if (!okPair(d.lifeMs) || !okPair(d.speed) || !okPair(d.startScale) || !okPair(d.zSpeed))
    throw new Error('range pairs must be [lo<=hi]');
  if (!['spark', 'soft'].includes(d.texture)) throw new Error('bad texture');
  if (!['normal', 'add'].includes(d.blend)) throw new Error('bad blend');
  if (d.startAlpha < 0 || d.startAlpha > 1) throw new Error('startAlpha out of range');
}
