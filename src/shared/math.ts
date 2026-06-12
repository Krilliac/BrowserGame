/** Tiny math helpers shared by client and server. Keep this file boring on purpose. */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Standard 32-bit mulberry32 seeded PRNG. Returns a generator producing floats in [0, 1) with a
 * fully deterministic sequence for a given seed — the same seed yields the same draws on server
 * and client, which is what makes seeded loot/world rolls reproducible.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a 32-bit string hash, for turning human-readable identifiers (area ids, item names, ...)
 * into mulberry32 seeds. Stable across platforms: same string, same 32-bit unsigned result.
 */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
