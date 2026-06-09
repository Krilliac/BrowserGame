import { describe, expect, it } from 'vitest';
import { coerceThemeValue, THEME_KEYS, DEFAULT_THEME } from './theme.js';

describe('theme value coercion (the live-edit boundary)', () => {
  it('accepts valid colors and rejects bad ones', () => {
    expect(coerceThemeValue('ground_base', '#1a2b3c')).toBe('#1a2b3c');
    expect(coerceThemeValue('ground_base', '#abc')).toBe('#abc');
    expect(coerceThemeValue('ground_base', 'red')).toBeNull();
    expect(coerceThemeValue('ground_base', 'drop table')).toBeNull();
  });

  it('clamps numbers to their range', () => {
    expect(coerceThemeValue('prop_density', '0.5')).toBe(0.5);
    expect(coerceThemeValue('prop_density', '9')).toBe(1); // max 1
    expect(coerceThemeValue('prop_density', '-3')).toBe(0); // min 0
    expect(coerceThemeValue('prop_density', 'abc')).toBeNull();
  });

  it('parses ints and bools and enums', () => {
    expect(coerceThemeValue('particle_count', '40.9')).toBe(40);
    expect(coerceThemeValue('outdoor', 'true')).toBe(true);
    expect(coerceThemeValue('outdoor', '0')).toBe(false);
    expect(coerceThemeValue('outdoor', 'maybe')).toBeNull();
    expect(coerceThemeValue('weather', 'snow')).toBe('snow');
    expect(coerceThemeValue('weather', 'meteors')).toBeNull();
  });

  it('rejects unknown keys', () => {
    expect(coerceThemeValue('nonsense', 'x')).toBeNull();
  });

  it('every THEME_KEYS field exists on DEFAULT_THEME', () => {
    for (const spec of Object.values(THEME_KEYS)) {
      expect(DEFAULT_THEME).toHaveProperty(spec.field);
    }
  });
});
