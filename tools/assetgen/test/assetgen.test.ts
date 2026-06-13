import { describe, expect, it } from 'vitest';
import { Rng, seedFromString } from '../shared/rng.ts';
import { encodePng } from '../shared/png.ts';
import { Raster } from '../shared/raster.ts';
import { backOut, bounceOut, cubicInOut, cubicOut, linear, quadOut } from '../shared/curves.ts';
import { ADVENTURER, synthCharacter } from '../sprites/synth.ts';

describe('shared/rng', () => {
  it('is deterministic per seed and varies across seeds', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Rng(43).next()).not.toBe(seqA[0]);
    expect(seedFromString('hero')).toBe(seedFromString('hero'));
  });
});

describe('shared/png', () => {
  it('emits a valid PNG signature + IHDR/IEND, deterministically', () => {
    const px = new Uint8Array(2 * 2 * 4).fill(128);
    const a = encodePng(2, 2, px);
    const b = encodePng(2, 2, px);
    expect(Array.from(a.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(Buffer.from(a).includes(Buffer.from('IHDR'))).toBe(true);
    expect(Buffer.from(a).includes(Buffer.from('IEND'))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true); // determinism
  });
});

describe('shared/curves', () => {
  it('all eases hit the [0,1] endpoints and clamp out of range', () => {
    for (const f of [linear, quadOut, cubicOut, cubicInOut, backOut, bounceOut]) {
      expect(f(0)).toBeCloseTo(0, 5);
      expect(f(1)).toBeCloseTo(1, 5);
      expect(f(-1)).toBeGreaterThanOrEqual(-0.001);
      expect(f(2)).toBeLessThanOrEqual(1.001);
    }
  });
  it('cubicOut is monotonically increasing', () => {
    let prev = -1;
    for (let t = 0; t <= 1; t += 0.05) {
      const v = cubicOut(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('shared/raster', () => {
  it('composites a disc and exports a PNG', () => {
    const r = new Raster(16, 16);
    r.disc(8, 8, 6, [255, 0, 0, 255]);
    // center pixel is now red-ish, a corner is still transparent
    const ci = (8 * 16 + 8) * 4;
    expect(r.data[ci]).toBeGreaterThan(200);
    expect(r.data[3]).toBe(0); // (0,0) alpha untouched
    expect(r.toPng().length).toBeGreaterThan(8);
  });
});

describe('sprites/synth — RENDER-09 16-dir character', () => {
  it('produces a deterministic sheet (generate twice → byte-identical)', () => {
    const a = synthCharacter(ADVENTURER, '/assets/sprites/adventurer16.png');
    const b = synthCharacter(ADVENTURER, '/assets/sprites/adventurer16.png');
    expect(Buffer.from(a.png).equals(Buffer.from(b.png))).toBe(true);
  });

  it('manifest matches the engine ClipSet contract (dirCount 16, exact AnimState names, dirless tail)', () => {
    const { manifest } = synthCharacter(ADVENTURER, '/assets/sprites/adventurer16.png');
    expect(manifest.dirCount).toBe(16);
    expect(Object.keys(manifest.clips).sort()).toEqual(
      ['attack', 'cast', 'death', 'hurt', 'idle', 'walk'].sort(),
    );
    // directional clips' rows are spaced by dirCount; hurt/death are single dirless rows after them.
    expect(manifest.clips.idle!.row0).toBe(0);
    expect(manifest.clips.walk!.row0).toBe(16);
    expect(manifest.clips.attack!.row0).toBe(32);
    expect(manifest.clips.cast!.row0).toBe(48);
    expect(manifest.clips.hurt!.row0).toBe(64);
    expect(manifest.clips.death!.row0).toBe(65);
    for (const c of Object.values(manifest.clips)) {
      expect(c.frames).toBeGreaterThan(0);
      expect(c.perFrameMs).toBeGreaterThan(0);
    }
  });
});
