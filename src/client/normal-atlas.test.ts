import { describe, expect, it } from 'vitest';
import {
  NORMAL_OVERRIDES,
  conventionalNormalSrc,
  hasRealNormals,
  normalSrcFor,
} from './normal-atlas.js';

describe('normal-atlas (RENDER-01)', () => {
  it('derives the conventional <name>_n.png path', () => {
    expect(conventionalNormalSrc('/assets/sheets/hero.png')).toBe('/assets/sheets/hero_n.png');
    expect(conventionalNormalSrc('foo.bar.png')).toBe('foo.bar_n.png');
    expect(conventionalNormalSrc('noext')).toBe('noext_n');
  });

  it('prefers an explicit override over the convention', () => {
    const albedo = '/assets/x.png';
    expect(normalSrcFor(albedo)).toBe('/assets/x_n.png'); // no override → convention
  });

  it('ships with an empty override map, so the deferred pass is inactive today', () => {
    expect(Object.keys(NORMAL_OVERRIDES)).toHaveLength(0);
    expect(hasRealNormals(new Set())).toBe(false);
    expect(hasRealNormals(new Set(['/assets/x_n.png']))).toBe(true);
  });
});
