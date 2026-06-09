import { describe, expect, it } from 'vitest';
import {
  attackRoll,
  defenceRoll,
  hitChance,
  maxHit,
  resolveAttack,
  rollDamage,
  rolledHit,
} from './combat-formulas.js';

/** Build a fake rng that yields the given values in order, then repeats the last. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe('attackRoll / defenceRoll (effective rolls)', () => {
  it('adds the +8 offset and the optional bonus', () => {
    expect(attackRoll(1)).toBe(9);
    expect(attackRoll(10, 5)).toBe(23);
    expect(defenceRoll(1)).toBe(9);
    expect(defenceRoll(10, 5)).toBe(23);
  });
});

describe('hitChance (OSRS piecewise)', () => {
  it('stays within [0,1] and well below 1.0', () => {
    const c = hitChance(50, 10);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(1);
  });

  it('rises monotonically as attack grows vs a fixed defence', () => {
    const defence = 20;
    let prev = -1;
    for (const attack of [5, 10, 20, 21, 40, 80, 200]) {
      const c = hitChance(attack, defence);
      expect(c).toBeGreaterThan(prev);
      expect(c).toBeLessThanOrEqual(1);
      prev = c;
    }
  });

  it('uses the favored branch when attack > defence', () => {
    // 1 - (defence + 2) / (2 * (attack + 1)) = 1 - 12/22
    expect(hitChance(10, 10)).toBeCloseTo(1 - 12 / 22, 10);
  });

  it('uses the unfavored branch when attack <= defence', () => {
    // attack / (2 * (defence + 1)) = 10 / 42
    expect(hitChance(10, 20)).toBeCloseTo(10 / 42, 10);
  });

  it('clamps to [0,1] at extremes', () => {
    expect(hitChance(0, 0)).toBeGreaterThanOrEqual(0);
    expect(hitChance(0, 0)).toBeLessThanOrEqual(1);
    expect(hitChance(1_000_000, 1)).toBeLessThanOrEqual(1);
    expect(hitChance(1, 1_000_000)).toBeGreaterThanOrEqual(0);
  });
});

describe('rolledHit (deterministic with fake rng)', () => {
  it('hits when rng() < chance and the chance is positive', () => {
    // favored: chance ~ 0.45
    expect(rolledHit(10, 10, () => 0)).toBe(true);
  });

  it('misses when rng() is above the chance (0.999)', () => {
    // chance is well below 1, so a near-1 roll always misses
    expect(rolledHit(10, 10, () => 0.999)).toBe(false);
    expect(rolledHit(200, 1, () => 0.999)).toBe(false);
  });

  it('misses on rng()=0 only is impossible when chance>0 (0 always hits a positive chance)', () => {
    expect(rolledHit(50, 10, () => 0)).toBe(true);
  });
});

describe('maxHit (scaled strength)', () => {
  it('a strength ~20 lands in the mid-20s damage band', () => {
    expect(maxHit(20)).toBe(25);
  });

  it('increases with strength', () => {
    let prev = -1;
    for (const str of [0, 5, 10, 20, 30]) {
      const m = maxHit(str);
      expect(m).toBeGreaterThan(prev);
      prev = m;
    }
  });

  it('applies the damage bonus and clamps negatives to a floor of 1', () => {
    expect(maxHit(10, 5)).toBeGreaterThan(maxHit(10));
    expect(maxHit(-100)).toBe(1);
  });
});

describe('rollDamage (uniform [0, maxHit])', () => {
  it('stays within [0, maxHit] across an rng sweep including endpoints', () => {
    const max = 25;
    for (const r of [0, 0.001, 0.25, 0.5, 0.75, 0.9999, 0.99999999]) {
      const d = rollDamage(max, () => r);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(max);
    }
  });

  it('hits both endpoints: 0 at rng=0 and maxHit at rng→1', () => {
    expect(rollDamage(25, () => 0)).toBe(0);
    expect(rollDamage(25, () => 0.99999999)).toBe(25);
  });
});

describe('resolveAttack (one full attack)', () => {
  const params = {
    attackLevel: 10,
    strength: 20,
    defenceLevel: 5,
    accuracyBonus: 2,
    damageBonus: 0,
    defenceBonus: 0,
  };

  it('returns damage 0 on a miss', () => {
    const result = resolveAttack(params, () => 0.999);
    expect(result.hit).toBe(false);
    expect(result.damage).toBe(0);
  });

  it('returns damage within [0, maxHit] on a hit', () => {
    // first rng for the hit roll (low => hit), second for the damage roll (high => near max)
    const result = resolveAttack(params, seqRng([0, 0.99999999]));
    expect(result.hit).toBe(true);
    const max = maxHit(params.strength, params.damageBonus);
    expect(result.damage).toBeGreaterThanOrEqual(0);
    expect(result.damage).toBeLessThanOrEqual(max);
    expect(result.damage).toBe(max);
  });

  it('can roll 0 damage even on a hit (OSRS allows a 0)', () => {
    const result = resolveAttack(params, seqRng([0, 0]));
    expect(result.hit).toBe(true);
    expect(result.damage).toBe(0);
  });
});
