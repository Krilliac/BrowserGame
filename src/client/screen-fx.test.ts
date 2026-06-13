import { describe, expect, it } from 'vitest';
import {
  LUT_PRESETS,
  OUTDOOR_GODRAYS,
  activeScreenEffects,
  effectiveFx,
  gradeColor,
  screenFxFor,
} from './screen-fx.js';

describe('screenFxFor / effectiveFx (RENDER-10/12/13)', () => {
  it('resolves instance ids (area#seq) to the base area override', () => {
    expect(screenFxFor('town#4')).toEqual(screenFxFor('town'));
  });

  it('gives outdoor areas the default godray shafts, indoor areas none', () => {
    expect(effectiveFx('wilderness', true).godrays).toBe(OUTDOOR_GODRAYS); // no override → default
    expect(effectiveFx('some_cave', false).godrays).toBe(0); // indoor → no shafts
  });

  it('lets a per-area override win over the outdoor default', () => {
    expect(effectiveFx('town', true).godrays).toBe(0.4); // town override is stronger
  });
});

describe('gradeColor / LUT presets (RENDER-12)', () => {
  it('is identity for an empty transform and stays in range', () => {
    expect(gradeColor(0.4, 0.6, 0.2, {})).toEqual([0.4, 0.6, 0.2]);
    const [r, g, b] = gradeColor(1, 1, 1, { gain: 5 });
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeLessThanOrEqual(1);
  });

  it('warm pushes toward red and away from blue; cool the opposite', () => {
    const mid = [0.5, 0.5, 0.5] as const;
    const warm = gradeColor(...mid, LUT_PRESETS.warm);
    const cool = gradeColor(...mid, LUT_PRESETS.cool);
    expect(warm[0]).toBeGreaterThan(warm[2]); // R > B under warm
    expect(cool[2]).toBeGreaterThan(cool[0]); // B > R under cool
  });

  it('pallid desaturates (channels converge toward the grey)', () => {
    const [r, g, b] = gradeColor(0.8, 0.2, 0.2, LUT_PRESETS.pallid);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    expect(spread).toBeLessThan(0.8 - 0.2); // less channel spread than the input
  });
});

describe('activeScreenEffects (RENDER-10/12/13)', () => {
  it('is all-off on the low/touch quality tier regardless of config', () => {
    expect(activeScreenEffects({ godrays: 1, heat: 1 }, 'low')).toEqual({
      godrays: false,
      heat: false,
    });
  });

  it('activates only the effects with a positive intensity on high quality', () => {
    expect(activeScreenEffects({}, 'high')).toEqual({ godrays: false, heat: false });
    expect(activeScreenEffects({ godrays: 0.3 }, 'high')).toEqual({ godrays: true, heat: false });
    expect(activeScreenEffects({ heat: 0.5 }, 'high')).toEqual({ godrays: false, heat: true });
    expect(activeScreenEffects({ godrays: 0, heat: 0 }, 'high')).toEqual({
      godrays: false,
      heat: false,
    });
  });
});
