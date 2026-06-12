import { describe, expect, it } from 'vitest';
import {
  detectRuneword,
  rune,
  runewordBonuses,
  RUNES,
  RUNEWORDS,
  type RunewordDef,
} from './runewords.js';

describe('runes', () => {
  it('has unique rune ids, all prefixed rune_', () => {
    const ids = RUNES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RUNES) expect(r.id.startsWith('rune_')).toBe(true);
  });

  it('rune() resolves real ids and rejects unknown ones', () => {
    const first = RUNES[0]!;
    expect(rune(first.id)).toEqual(first);
    expect(rune('rune_nope')).toBeUndefined();
  });
});

describe('runewords data integrity', () => {
  it('has unique runeword ids', () => {
    const ids = RUNEWORDS.map((rw) => rw.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every runeword references real rune ids and has 2-3 runes', () => {
    const known = new Set(RUNES.map((r) => r.id));
    for (const rw of RUNEWORDS) {
      expect(rw.runes.length).toBeGreaterThanOrEqual(2);
      expect(rw.runes.length).toBeLessThanOrEqual(3);
      for (const id of rw.runes) expect(known.has(id)).toBe(true);
    }
  });

  it('every runeword grants at least one buff bonus', () => {
    for (const rw of RUNEWORDS) {
      expect(rw.bonuses.length).toBeGreaterThan(0);
      for (const b of rw.bonuses) expect(b.value).toBeGreaterThan(0);
    }
  });
});

describe('detectRuneword', () => {
  // A short, distinct 2-rune word for exact-match assertions.
  const bulwark = RUNEWORDS.find((rw) => rw.id === 'rw_bulwark')!;

  it('matches an exact in-order rune sequence', () => {
    expect(detectRuneword([...bulwark.runes])).toBe(bulwark);
  });

  it('does not match when the runes are in the wrong order', () => {
    const reversed = [...bulwark.runes].reverse();
    expect(detectRuneword(reversed)).toBe(null);
  });

  it('does not match a partial (under-filled) sequence', () => {
    const wrath = RUNEWORDS.find((rw) => rw.id === 'rw_wrath')!;
    // Only the first rune slotted, rest empty — Wrath needs all three.
    expect(detectRuneword([wrath.runes[0]!, null, null])).toBe(null);
  });

  it('does not match when later sockets hold different, non-sequence runes', () => {
    // Right first rune, but the second is a foreign rune that no word expects here.
    const wrong = [bulwark.runes[0]!, 'rune_zod'];
    // 'rune_zod' is not bulwark.runes[1], so Bulwark must not fire.
    expect(detectRuneword(wrong)).not.toBe(bulwark);
  });

  it('returns null for all-empty sockets', () => {
    expect(detectRuneword([null, null])).toBe(null);
    expect(detectRuneword([])).toBe(null);
  });

  it('prefers the longest match when one word is a prefix of another', () => {
    const vigor = RUNEWORDS.find((rw) => rw.id === 'rw_vigor')!;
    const vigil = RUNEWORDS.find((rw) => rw.id === 'rw_vigil')!;
    // Sanity: Vigor's runes are a strict prefix of Vigil's.
    expect(vigil.runes.slice(0, vigor.runes.length)).toEqual(vigor.runes);

    // Only Vigor's runes filled → Vigor.
    expect(detectRuneword([...vigor.runes])).toBe(vigor);
    // Full Vigil sequence → the longer Vigil wins, not the Vigor prefix.
    expect(detectRuneword([...vigil.runes])).toBe(vigil);
  });
});

describe('runewordBonuses', () => {
  it('returns the active runeword bonuses for a match', () => {
    const rw: RunewordDef = RUNEWORDS[0]!;
    expect(runewordBonuses([...rw.runes])).toEqual(rw.bonuses);
  });

  it('returns [] when no runeword is active', () => {
    expect(runewordBonuses([null, null])).toEqual([]);
    expect(runewordBonuses(['rune_zod', 'rune_el'])).toEqual([]);
  });
});
