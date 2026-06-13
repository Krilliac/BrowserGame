import { describe, expect, it } from 'vitest';
import { palisadeStakes } from './prop-sort.js';

describe('palisadeStakes (RENDER-05)', () => {
  it('spans the endpoints and always yields at least two stakes', () => {
    const s = palisadeStakes(0, 0, 0, 4); // tiny run
    expect(s.length).toBeGreaterThanOrEqual(2);
    expect(s[0]!.x).toBe(0);
    expect(s[0]!.y).toBe(0);
    expect(s[s.length - 1]!.x).toBe(0);
    expect(s[s.length - 1]!.y).toBe(4);
  });

  it('produces monotonically increasing sort keys along a north→south run', () => {
    const s = palisadeStakes(100, 50, 100, 450); // vertical wall
    for (let i = 1; i < s.length; i++) {
      expect(s[i]!.y).toBeGreaterThan(s[i - 1]!.y);
    }
    // ~one stake every 16px over 400px → ~26 stakes.
    expect(s.length).toBeGreaterThan(20);
    expect(s.length).toBeLessThan(32);
  });

  it('each non-last stake carries the delta to the next; the last carries none', () => {
    const s = palisadeStakes(0, 0, 160, 0, 16);
    for (let i = 0; i < s.length - 1; i++) {
      const st = s[i]!;
      expect(st.isLast).toBe(false);
      expect(st.x + st.nextDx).toBeCloseTo(s[i + 1]!.x, 6);
      expect(st.y + st.nextDy).toBeCloseTo(s[i + 1]!.y, 6);
    }
    const last = s[s.length - 1]!;
    expect(last.isLast).toBe(true);
    expect(last.nextDx).toBe(0);
    expect(last.nextDy).toBe(0);
  });

  it('stake count scales with run length', () => {
    const short = palisadeStakes(0, 0, 32, 0);
    const long = palisadeStakes(0, 0, 320, 0);
    expect(long.length).toBeGreaterThan(short.length);
  });
});
