import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DECOR_SPRITES, decorSprite, type DecorSprite } from './decor-sprites.js';

/** All entries flattened to (kind, sprite) pairs for table-style assertions. */
const ALL: { kind: string; sprite: DecorSprite }[] = Object.entries(DECOR_SPRITES).flatMap(
  ([kind, entry]) => (Array.isArray(entry) ? entry : [entry]).map((sprite) => ({ kind, sprite })),
);

/** Resolve a `/assets/...` web path to the file on disk under `public/`. */
function diskPath(src: string): string {
  return fileURLToPath(new URL(`../../public${src}`, import.meta.url));
}

describe('DECOR_SPRITES', () => {
  it('every sprite points at an existing curated PNG', () => {
    for (const { kind, sprite } of ALL) {
      expect(sprite.src, kind).toMatch(/^\/assets\/curated\/decor\/[a-z0-9-]+\.png$/);
      expect(existsSync(diskPath(sprite.src)), `${kind}: ${sprite.src} missing on disk`).toBe(true);
      // PNG magic bytes — guards against an empty or corrupted curation copy.
      const head = readFileSync(diskPath(sprite.src)).subarray(0, 8);
      expect([...head], sprite.src).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    }
  });

  it('scales are sane world sizes and frames/anchors are well-formed when present', () => {
    for (const { kind, sprite } of ALL) {
      expect(sprite.scale, kind).toBeGreaterThan(0);
      expect(sprite.scale, kind).toBeLessThanOrEqual(2);
      if (sprite.anchorY !== undefined) {
        expect(sprite.anchorY, kind).toBeGreaterThan(0);
        expect(sprite.anchorY, kind).toBeLessThanOrEqual(1);
      }
      if (sprite.frame !== undefined) {
        expect(sprite.frame.w, kind).toBeGreaterThan(0);
        expect(sprite.frame.h, kind).toBeGreaterThan(0);
        expect(sprite.frame.x, kind).toBeGreaterThanOrEqual(0);
        expect(sprite.frame.y, kind).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps the animated-light kinds procedural (no sprite entries)', () => {
    for (const kind of ['bonfire', 'torch', 'shrine']) {
      expect(DECOR_SPRITES[kind], kind).toBeUndefined();
    }
  });
});

describe('decorSprite', () => {
  it('is deterministic for the same kind and position', () => {
    for (const [gx, gy] of [
      [0, 0],
      [800, 600],
      [123.7, 456.2],
      [-40, 1190],
    ] as const) {
      for (const kind of Object.keys(DECOR_SPRITES)) {
        expect(decorSprite(kind, gx, gy)).toBe(decorSprite(kind, gx, gy));
      }
    }
  });

  it('always returns a member of the kind entry', () => {
    for (const kind of Object.keys(DECOR_SPRITES)) {
      const entry = DECOR_SPRITES[kind]!;
      const variants = Array.isArray(entry) ? entry : [entry];
      for (let i = 0; i < 25; i++) {
        const got = decorSprite(kind, i * 97 + 13, i * 41 + 7);
        expect(variants, kind).toContain(got);
      }
    }
  });

  it('spreads positions across the variants of a rich kind', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      seen.add(decorSprite('grave', i * 131 + 17, i * 73 + 5)!.src);
    }
    expect(seen.size).toBeGreaterThan(2);
  });

  it('returns undefined for kinds without a sprite', () => {
    expect(decorSprite('bonfire', 10, 10)).toBeUndefined();
    expect(decorSprite('definitely-not-a-kind', 0, 0)).toBeUndefined();
  });
});
