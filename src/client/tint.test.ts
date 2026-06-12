import { describe, expect, it } from 'vitest';
import { combineTints, parseTint } from './tint.js';

describe('sprite tint math', () => {
  it('parses #rrggbb and treats junk/missing as white', () => {
    expect(parseTint('#ff8000')).toBe(0xff8000);
    expect(parseTint('a83232')).toBe(0xa83232);
    expect(parseTint(undefined)).toBe(0xffffff);
    expect(parseTint('not-a-color')).toBe(0xffffff);
    expect(parseTint('#fff')).toBe(0xffffff); // shorthand unsupported -> identity, never garbage
  });

  it('white is the identity and combining multiplies per channel', () => {
    expect(combineTints('#ffffff', '#ffffff')).toBe(0xffffff);
    expect(combineTints('#804020', '#ffffff')).toBe(0x804020);
    // 50% grey halves every channel.
    expect(combineTints('#808080', '#808080')).toBe(0x404040);
    // Numeric and string inputs mix.
    expect(combineTints(0xff0000, '#80ff80')).toBe(0x800000);
  });

  it('order does not matter (multiplication commutes, within rounding)', () => {
    expect(combineTints('#a86432', '#80c0ff')).toBe(combineTints('#80c0ff', '#a86432'));
  });
});
