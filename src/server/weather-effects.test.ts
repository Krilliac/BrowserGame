import { describe, expect, it } from 'vitest';
import { weatherModifiers } from './weather-effects.js';
import type { WeatherKind } from '../shared/theme.js';

describe('weatherModifiers (authoritative weather gameplay multipliers)', () => {
  it('returns identity modifiers for "none" (neutral baseline)', () => {
    const mods = weatherModifiers('none');
    expect(mods.moveScale).toBe(1);
    expect(mods.aggroScale).toBe(1);
  });

  it('returns correct modifiers for "rain"', () => {
    const mods = weatherModifiers('rain');
    expect(mods.moveScale).toBeCloseTo(0.95, 10);
    expect(mods.aggroScale).toBeCloseTo(0.85, 10);
  });

  it('returns correct modifiers for "snow"', () => {
    const mods = weatherModifiers('snow');
    expect(mods.moveScale).toBeCloseTo(0.82, 10);
    expect(mods.aggroScale).toBe(1);
  });

  it('returns correct modifiers for "fog"', () => {
    const mods = weatherModifiers('fog');
    expect(mods.moveScale).toBe(1);
    expect(mods.aggroScale).toBeCloseTo(0.55, 10);
  });

  it('"none" is the neutral identity — both scales are exactly 1', () => {
    const { moveScale, aggroScale } = weatherModifiers('none');
    expect(moveScale).toBe(1);
    expect(aggroScale).toBe(1);
  });

  it('returns modifiers for the extended weather kinds (RENDER-14)', () => {
    expect(weatherModifiers('leaves')).toEqual({ moveScale: 1, aggroScale: 1 }); // cosmetic only
    expect(weatherModifiers('sand').aggroScale).toBeLessThan(weatherModifiers('rain').aggroScale);
    expect(weatherModifiers('ash').moveScale).toBeLessThan(1);
    expect(weatherModifiers('lightning').moveScale).toBeGreaterThan(0);
  });

  it('all weather kinds produce finite, positive scales', () => {
    const kinds: WeatherKind[] = [
      'none',
      'rain',
      'snow',
      'fog',
      'ash',
      'sand',
      'leaves',
      'lightning',
    ];
    for (const kind of kinds) {
      const { moveScale, aggroScale } = weatherModifiers(kind);
      expect(Number.isFinite(moveScale)).toBe(true);
      expect(Number.isFinite(aggroScale)).toBe(true);
      expect(moveScale).toBeGreaterThan(0);
      expect(aggroScale).toBeGreaterThan(0);
    }
  });
});
