import { describe, expect, it } from 'vitest';
import { OUTDOOR_GODRAYS, activeScreenEffects, effectiveFx, screenFxFor } from './screen-fx.js';

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
