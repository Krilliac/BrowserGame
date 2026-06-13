/**
 * ASSET-SFX — procedural sound effect *params* (the zero-asset 'synth' path). Produces sfxr-style
 * `SfxDef`s the engine's Web Audio `Sound` path can render with no asset fetch. A seeded parametric
 * model maps an intent → an ADSR + frequency-slide + vibrato graph; seeded variation yields a family
 * of non-identical thumps per intent.
 */

import type { Rng } from '../shared/rng.ts';

export type Wave = 'sine' | 'square' | 'saw' | 'noise';

export interface SfxSynth {
  wave: Wave;
  freq: number; // start frequency (Hz)
  freqSlide: number; // Hz/s drift (negative = falling pitch)
  attackMs: number;
  decayMs: number;
  sustain: number; // 0..1 sustain level
  releaseMs: number;
  vibratoHz: number;
  vibratoDepth: number; // 0..1
  noiseMix: number; // 0..1 blend of noise into the tone
}

export interface SfxDef {
  key: string;
  mode: 'file' | 'synth';
  synth: SfxSynth;
  gain: number;
}

export type SfxIntent =
  | 'hit'
  | 'crit'
  | 'block'
  | 'pickup'
  | 'coin'
  | 'levelup'
  | 'footstep'
  | 'cast'
  | 'door'
  | 'portal'
  | 'uiClick'
  | 'uiError';

const BASE: Record<SfxIntent, Partial<SfxSynth> & { gain?: number }> = {
  hit: { wave: 'noise', freq: 220, freqSlide: -400, decayMs: 120, noiseMix: 0.7, gain: 0.5 },
  crit: { wave: 'square', freq: 520, freqSlide: -300, decayMs: 200, noiseMix: 0.3, gain: 0.6 },
  block: { wave: 'noise', freq: 320, freqSlide: -120, decayMs: 90, noiseMix: 0.85, gain: 0.45 },
  pickup: { wave: 'sine', freq: 660, freqSlide: 520, decayMs: 130, gain: 0.4 },
  coin: { wave: 'square', freq: 880, freqSlide: 320, decayMs: 110, gain: 0.4 },
  levelup: { wave: 'saw', freq: 440, freqSlide: 520, decayMs: 420, sustain: 0.4, gain: 0.55 },
  footstep: { wave: 'noise', freq: 140, freqSlide: -60, decayMs: 70, noiseMix: 0.9, gain: 0.25 },
  cast: {
    wave: 'saw',
    freq: 300,
    freqSlide: 260,
    decayMs: 280,
    vibratoHz: 9,
    vibratoDepth: 0.3,
    gain: 0.45,
  },
  door: { wave: 'square', freq: 120, freqSlide: -40, decayMs: 260, noiseMix: 0.4, gain: 0.4 },
  portal: {
    wave: 'sine',
    freq: 200,
    freqSlide: 180,
    decayMs: 600,
    vibratoHz: 6,
    vibratoDepth: 0.5,
    gain: 0.5,
  },
  uiClick: { wave: 'square', freq: 720, freqSlide: 0, decayMs: 45, gain: 0.3 },
  uiError: { wave: 'saw', freq: 200, freqSlide: -120, decayMs: 180, gain: 0.35 },
};

/** Build a seeded SfxDef for an intent (seeded variation keeps a family of non-identical sounds). */
export function makeSfx(intent: SfxIntent, rng: Rng): SfxDef {
  const b = BASE[intent];
  const v = (n: number, frac = 0.08) => n * (1 + (rng.next() - 0.5) * frac);
  const synth: SfxSynth = {
    wave: b.wave ?? 'sine',
    freq: v(b.freq ?? 440),
    freqSlide: (b.freqSlide ?? 0) * (1 + (rng.next() - 0.5) * 0.1),
    attackMs: b.attackMs ?? 2,
    decayMs: v(b.decayMs ?? 150),
    sustain: b.sustain ?? 0,
    releaseMs: b.releaseMs ?? 30,
    vibratoHz: b.vibratoHz ?? 0,
    vibratoDepth: b.vibratoDepth ?? 0,
    noiseMix: b.noiseMix ?? 0,
  };
  return { key: intent, mode: 'synth', synth, gain: b.gain ?? 0.4 };
}

export function validateSfx(d: SfxDef): void {
  if (!['sine', 'square', 'saw', 'noise'].includes(d.synth.wave)) throw new Error('bad wave');
  if (!(d.synth.freq > 0)) throw new Error('freq must be > 0');
  if (d.synth.sustain < 0 || d.synth.sustain > 1) throw new Error('sustain out of range');
  if (d.synth.noiseMix < 0 || d.synth.noiseMix > 1) throw new Error('noiseMix out of range');
  if (!(d.gain > 0 && d.gain <= 1)) throw new Error('gain out of range');
}
