import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RIFT_MODIFIERS,
  rollRiftModifiers,
  aggregateRiftEffects,
  type RiftModifierDef,
} from './rift-modifiers.js';

/**
 * Scripted rng: returns the supplied values in order, then throws if exhausted. Lets each test
 * pin exactly which pool index gets picked (the roll does `i + floor(rng() * (len - i))`), so the
 * determinism assertions are explicit rather than relying on a real PRNG sequence.
 */
function scriptedRng(values: readonly number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i++];
    if (v === undefined) throw new Error('scriptedRng exhausted');
    return v;
  };
}

describe('DEFAULT_RIFT_MODIFIERS', () => {
  it('has unique ids', () => {
    const ids = DEFAULT_RIFT_MODIFIERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls in the documented 6–8 count band', () => {
    expect(DEFAULT_RIFT_MODIFIERS.length).toBeGreaterThanOrEqual(6);
    expect(DEFAULT_RIFT_MODIFIERS.length).toBeLessThanOrEqual(8);
  });

  it('is well-formed: minTier >= 0, multipliers positive, bonuses >= 0', () => {
    for (const m of DEFAULT_RIFT_MODIFIERS) {
      expect(m.id).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.desc).toBeTruthy();
      expect(m.minTier).toBeGreaterThanOrEqual(0);

      // Multipliers, when present, must be positive (never zero/negative — would nullify a stat).
      for (const mult of [m.mobDamageMult, m.mobHpMult, m.mobSpeedMult]) {
        if (mult !== undefined) expect(mult).toBeGreaterThan(0);
      }
      // Bonuses, when present, must be non-negative.
      for (const bonus of [m.lootQuantityBonus, m.xpBonus]) {
        if (bonus !== undefined) expect(bonus).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('keeps multipliers in the sane 1.1–1.6 band and bonuses in 0.2–0.75', () => {
    for (const m of DEFAULT_RIFT_MODIFIERS) {
      for (const mult of [m.mobDamageMult, m.mobHpMult, m.mobSpeedMult]) {
        if (mult !== undefined) {
          expect(mult).toBeGreaterThanOrEqual(1.1);
          expect(mult).toBeLessThanOrEqual(1.6);
        }
      }
      for (const bonus of [m.lootQuantityBonus, m.xpBonus]) {
        if (bonus !== undefined) {
          expect(bonus).toBeGreaterThanOrEqual(0.2);
          expect(bonus).toBeLessThanOrEqual(0.75);
        }
      }
    }
  });
});

describe('rollRiftModifiers', () => {
  it('returns no modifiers at tier 0 (all minTier >= 1)', () => {
    const result = rollRiftModifiers(0, scriptedRng([0, 0, 0]));
    expect(result).toEqual([]);
  });

  it('respects minTier — never returns a modifier gated above the tier', () => {
    // Roll the full pool at a low tier; nothing with minTier > tier may appear.
    const tier = 2;
    const big = rollRiftModifiers(
      tier,
      // Always pick index i (rng=0), walking the eligible pool in order.
      scriptedRng(new Array(DEFAULT_RIFT_MODIFIERS.length).fill(0)),
      DEFAULT_RIFT_MODIFIERS.length,
    );
    for (const m of big) expect(m.minTier).toBeLessThanOrEqual(tier);
  });

  it('returns distinct modifiers (no duplicates)', () => {
    const result = rollRiftModifiers(
      9,
      // Each draw picks index i (rng -> j = i), so we sweep distinct entries.
      scriptedRng([0, 0, 0, 0]),
      4,
    );
    const ids = result.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('honors count — returns at most `count` modifiers', () => {
    const result = rollRiftModifiers(9, scriptedRng([0, 0]), 2);
    expect(result.length).toBe(2);
  });

  it('defaults to a count of 2', () => {
    const result = rollRiftModifiers(9, scriptedRng([0, 0]));
    expect(result.length).toBe(2);
  });

  it('is deterministic given a fixed rng sequence', () => {
    const seq = [0.42, 0.17, 0.9];
    const a = rollRiftModifiers(9, scriptedRng(seq), 3);
    const b = rollRiftModifiers(9, scriptedRng(seq), 3);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });

  it('handles count > eligible gracefully (returns the whole eligible pool, distinct)', () => {
    const tier = 1;
    const eligible = DEFAULT_RIFT_MODIFIERS.filter((m) => m.minTier <= tier);
    // Ask for far more than exist; one rng draw per actual pick.
    const result = rollRiftModifiers(tier, scriptedRng(new Array(eligible.length).fill(0)), 999);
    expect(result.length).toBe(eligible.length);
    expect(new Set(result.map((m) => m.id)).size).toBe(eligible.length);
  });

  it('picks the rng-selected pool index (explicit selection check)', () => {
    const eligible = DEFAULT_RIFT_MODIFIERS.filter((m) => m.minTier <= 9);
    // First draw: j = 0 + floor(rng * len). rng chosen so j lands on the last entry.
    const rngVal = (eligible.length - 1) / eligible.length;
    const result = rollRiftModifiers(9, scriptedRng([rngVal]), 1);
    expect(result[0]?.id).toBe(eligible[eligible.length - 1]?.id);
  });
});

describe('aggregateRiftEffects', () => {
  it('returns the neutral identity for an empty list', () => {
    expect(aggregateRiftEffects([])).toEqual({
      mobDamageMult: 1,
      mobHpMult: 1,
      mobSpeedMult: 1,
      lootQuantityBonus: 0,
      xpBonus: 0,
    });
  });

  it('multiplies multipliers and adds bonuses', () => {
    const mods: RiftModifierDef[] = [
      {
        id: 'a',
        name: 'A',
        desc: '',
        minTier: 1,
        mobDamageMult: 1.5,
        lootQuantityBonus: 0.4,
      },
      {
        id: 'b',
        name: 'B',
        desc: '',
        minTier: 1,
        mobDamageMult: 1.2,
        mobHpMult: 2,
        lootQuantityBonus: 0.3,
        xpBonus: 0.5,
      },
    ];
    const e = aggregateRiftEffects(mods);
    expect(e.mobDamageMult).toBeCloseTo(1.8, 10); // 1.5 * 1.2
    expect(e.mobHpMult).toBeCloseTo(2, 10); // 1 * 2
    expect(e.mobSpeedMult).toBe(1); // untouched
    expect(e.lootQuantityBonus).toBeCloseTo(0.7, 10); // 0.4 + 0.3
    expect(e.xpBonus).toBeCloseTo(0.5, 10); // 0 + 0.5
  });

  it('treats absent fields as identity (mult 1, bonus 0)', () => {
    const mod: RiftModifierDef = {
      id: 'lonely',
      name: 'Lonely',
      desc: '',
      minTier: 1,
      xpBonus: 0.2,
    };
    const e = aggregateRiftEffects([mod]);
    expect(e.mobDamageMult).toBe(1);
    expect(e.mobHpMult).toBe(1);
    expect(e.mobSpeedMult).toBe(1);
    expect(e.lootQuantityBonus).toBe(0);
    expect(e.xpBonus).toBeCloseTo(0.2, 10);
  });

  it('round-trips a real roll through aggregation without error', () => {
    const mods = rollRiftModifiers(5, scriptedRng([0.1, 0.6]), 2);
    const e = aggregateRiftEffects(mods);
    expect(e.mobDamageMult).toBeGreaterThanOrEqual(1);
    expect(e.lootQuantityBonus).toBeGreaterThanOrEqual(0);
  });
});
