import { describe, expect, it } from 'vitest';
import {
  applyCrit,
  attackRoll,
  BASE_CRIT_CHANCE,
  CRIT_MULTIPLIER,
  defenceRoll,
  hitChance,
  maxHit,
  resistedDamage,
  resolveAttack,
  rollCrit,
  rollDamage,
  rolledHit,
} from './combat-formulas.js';

/** Build a fake rng that yields the given values in order, then repeats the last. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe('resistedDamage', () => {
  it('passes damage through unchanged when there is no matching resistance', () => {
    expect(resistedDamage(100, 'fire', {})).toBe(100);
    expect(resistedDamage(100, 'physical', { fire: 0.5 })).toBe(100); // resist is for a different element
  });

  it('reduces typed damage by the resistance fraction (rounded)', () => {
    expect(resistedDamage(100, 'fire', { fire: 0.5 })).toBe(50);
    expect(resistedDamage(41, 'cold', { cold: 0.5 })).toBe(21); // round(20.5)
    expect(resistedDamage(100, 'fire', { fire: 0.6 })).toBe(40);
  });

  it('makes 100% resistance fully immune (0 damage)', () => {
    expect(resistedDamage(250, 'lightning', { lightning: 1 })).toBe(0);
  });

  it('amplifies damage for a vulnerability (negative resist), clamped to -1 (double)', () => {
    expect(resistedDamage(100, 'cold', { cold: -0.3 })).toBe(130);
    expect(resistedDamage(100, 'fire', { fire: -5 })).toBe(200); // clamped at -1 → ×2, not ×6
  });

  it('clamps resistance above 1 to full immunity and never returns below 0', () => {
    expect(resistedDamage(100, 'poison', { poison: 5 })).toBe(0);
  });

  it('penetration reduces effective resistance (fire 0.5 - 0.3 pen => resist 0.2 => 80 dmg)', () => {
    expect(resistedDamage(100, 'fire', { fire: 0.5 }, 0.3)).toBe(80);
  });

  it('penetration exceeding resist pushes into vulnerability but floors at -1 (max ×2 dmg)', () => {
    // resist 0.1 - pen 0.5 = -0.4 (vulnerability) => 100 * 1.4 = 140
    expect(resistedDamage(100, 'fire', { fire: 0.1 }, 0.5)).toBe(140);
    // resist -0.5 - pen 0.9 would be -1.4, clamped to -1 => 100 * 2 = 200
    expect(resistedDamage(100, 'fire', { fire: -0.5 }, 0.9)).toBe(200);
  });

  it('penetration = 0 (default) is identical to the 3-arg call', () => {
    expect(resistedDamage(100, 'fire', { fire: 0.5 })).toBe(50);
    expect(resistedDamage(100, 'fire', { fire: 0.5 }, 0)).toBe(50);
  });
});

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

describe('rollCrit (deterministic with fake rng)', () => {
  it('crits when rng() is below the chance', () => {
    expect(rollCrit(() => 0, 0.15)).toBe(true);
    expect(rollCrit(() => 0.149, 0.15)).toBe(true);
  });

  it('does not crit when rng() is at or above the chance', () => {
    expect(rollCrit(() => 0.15, 0.15)).toBe(false);
    expect(rollCrit(() => 0.9, 0.15)).toBe(false);
  });

  it('defaults to the base crit chance', () => {
    expect(rollCrit(() => BASE_CRIT_CHANCE - 0.0001)).toBe(true);
    expect(rollCrit(() => BASE_CRIT_CHANCE)).toBe(false);
  });

  it('never crits at 0 chance, always crits at >=1 chance', () => {
    expect(rollCrit(() => 0, 0)).toBe(false);
    expect(rollCrit(() => 0.999, 1)).toBe(true);
  });
});

describe('applyCrit (multiplier on a hit)', () => {
  it('leaves non-crit damage unchanged', () => {
    expect(applyCrit(20, false)).toBe(20);
  });

  it('multiplies crit damage by the multiplier and rounds', () => {
    expect(applyCrit(20, true)).toBe(20 * CRIT_MULTIPLIER);
    expect(applyCrit(15, true, 1.5)).toBe(23); // 22.5 -> 23
  });

  it('a crit on 0 damage is still 0 (a missed swing cannot crit into damage)', () => {
    expect(applyCrit(0, true)).toBe(0);
  });
});
