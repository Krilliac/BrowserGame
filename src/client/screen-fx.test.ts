import { describe, expect, it } from 'vitest';
import { AREA_SCREEN_FX, activeScreenEffects, screenFxFor } from './screen-fx.js';

describe('screenFxFor (RENDER-10/12/13)', () => {
  it('returns empty config for unregistered areas (default-off)', () => {
    expect(screenFxFor('town')).toEqual({});
    expect(Object.keys(AREA_SCREEN_FX)).toHaveLength(0); // empty by default → no regression
  });

  it('resolves instance ids (area#seq) to the base area config', () => {
    // Drive the lookup through a temporary entry, then clean up so the suite stays order-independent.
    AREA_SCREEN_FX['town'] = { godrays: 0.5 };
    try {
      expect(screenFxFor('town#4')).toEqual({ godrays: 0.5 });
    } finally {
      delete AREA_SCREEN_FX['town'];
    }
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
