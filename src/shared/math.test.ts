import { describe, expect, it } from 'vitest';
import { clamp, hashSeed, lerp, mulberry32 } from './math.js';

describe('clamp', () => {
  it('clamps below, inside, and above the range', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe('lerp', () => {
  it('interpolates linearly between a and b', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 1)).toBe(10);
  });
});

describe('mulberry32', () => {
  it('produces a deterministic sequence for a fixed seed (snapshot of first 5 draws)', () => {
    const rng = mulberry32(12345);
    expect([rng(), rng(), rng(), rng(), rng()]).toEqual([
      0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203,
      0.5094283693470061,
    ]);
  });

  it('produces the same sequence from two generators with the same seed', () => {
    const a = mulberry32(987654321);
    const b = mulberry32(987654321);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it('diverges for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const drawsA = [a(), a(), a(), a(), a()];
    const drawsB = [b(), b(), b(), b(), b()];
    expect(drawsA).not.toEqual(drawsB);
  });

  it('stays in [0, 1) over 10k draws', () => {
    const rng = mulberry32(0xdeadbeef);
    for (let i = 0; i < 10_000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('hashSeed', () => {
  it('returns the FNV-1a 32-bit offset basis for the empty string', () => {
    expect(hashSeed('')).toBe(2166136261);
  });

  it('produces stable, known values', () => {
    expect(hashSeed('a')).toBe(3826002220);
    expect(hashSeed('hello')).toBe(1335831723);
    expect(hashSeed('BrowserGame')).toBe(3399543141);
  });

  it('is deterministic and case/content sensitive', () => {
    expect(hashSeed('loot-table-7')).toBe(hashSeed('loot-table-7'));
    expect(hashSeed('loot-table-7')).not.toBe(hashSeed('loot-table-8'));
    expect(hashSeed('Hello')).not.toBe(hashSeed('hello'));
  });

  it('always yields an unsigned 32-bit integer usable as a mulberry32 seed', () => {
    for (const s of ['', 'a', 'zone:catacombs', '💎💎💎', 'x'.repeat(500)]) {
      const h = hashSeed(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
