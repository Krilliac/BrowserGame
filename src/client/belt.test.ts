import { describe, expect, it } from 'vitest';
import { beltSlotRects } from './belt.js';

describe('beltSlotRects', () => {
  const viewports = [
    { w: 800, h: 600 },
    { w: 1280, h: 720 },
    { w: 1920, h: 1080 },
  ];

  for (const vp of viewports) {
    describe(`viewport ${vp.w}x${vp.h}`, () => {
      const { health, mana } = beltSlotRects(vp);

      it('keeps both slots inside the viewport', () => {
        for (const r of [health, mana]) {
          expect(r.x).toBeGreaterThanOrEqual(0);
          expect(r.y).toBeGreaterThanOrEqual(0);
          expect(r.x + r.w).toBeLessThanOrEqual(vp.w);
          expect(r.y + r.h).toBeLessThanOrEqual(vp.h);
        }
      });

      it('puts the health slot left of the mana slot', () => {
        expect(health.x).toBeLessThan(mana.x);
      });

      it('does not overlap the two slots', () => {
        // Health is left of mana, so they're separated iff health's right edge precedes mana's left.
        expect(health.x + health.w).toBeLessThanOrEqual(mana.x);
      });

      it('sits near the bottom of the screen', () => {
        // The slots' top should be within the bottom ~15% band of the viewport.
        expect(health.y).toBeGreaterThan(vp.h * 0.85);
        expect(mana.y).toBeGreaterThan(vp.h * 0.85);
      });
    });
  }
});
