import { describe, expect, it } from 'vitest';
import { StatusSet } from './status-effects.js';

describe('StatusSet (timed status effects)', () => {
  it('reports full speed and no effects when empty', () => {
    const effects = new StatusSet();
    expect(effects.slowFactor()).toBe(1);
    expect(effects.size).toBe(0);
    expect(effects.has('slow')).toBe(false);
    expect(effects.has('burn')).toBe(false);
  });

  it('reduces movement while slow is active (slowFactor = 1 - magnitude)', () => {
    const effects = new StatusSet();
    effects.apply('slow', 1000, 0.4);
    expect(effects.slowFactor()).toBeCloseTo(0.6, 5);
    expect(effects.has('slow')).toBe(true);
  });

  it('clears slow and returns to full speed once its duration elapses', () => {
    const effects = new StatusSet();
    effects.apply('slow', 1000, 0.4);
    effects.tick(999);
    expect(effects.slowFactor()).toBeCloseTo(0.6, 5);
    effects.tick(1); // total 1000ms => expired
    expect(effects.has('slow')).toBe(false);
    expect(effects.slowFactor()).toBe(1);
  });

  it('respects the slowFactor floor for an absurdly large slow magnitude', () => {
    const effects = new StatusSet();
    effects.apply('slow', 1000, 5); // 1 - 5 = -4, must clamp up
    expect(effects.slowFactor()).toBe(0.2);
  });

  it('deals burn damage of magnitude * dt and stops after expiry', () => {
    const effects = new StatusSet();
    effects.apply('burn', 1000, 10); // 10 damage/second for 1s

    expect(effects.tick(500).dotDamage).toBeCloseTo(5, 5);
    expect(effects.tick(500).dotDamage).toBeCloseTo(5, 5); // last of the duration
    expect(effects.has('burn')).toBe(false);
    expect(effects.tick(500).dotDamage).toBe(0); // expired => no more damage
  });

  it('only counts the active fraction when burn expires mid-tick', () => {
    const effects = new StatusSet();
    effects.apply('burn', 300, 10); // 0.3s remaining
    // Tick 1s: only 0.3s of burn is active => 10 * 0.3 = 3 damage.
    expect(effects.tick(1000).dotDamage).toBeCloseTo(3, 5);
    expect(effects.has('burn')).toBe(false);
  });

  it('refreshes duration and keeps the stronger magnitude on re-apply', () => {
    const effects = new StatusSet();
    effects.apply('slow', 1000, 0.3);
    effects.tick(800); // 200ms remaining

    // Re-apply weaker magnitude but longer duration: magnitude stays the stronger 0.3,
    // duration refreshes to max(200, 1000) = 1000.
    effects.apply('slow', 1000, 0.1);
    expect(effects.slowFactor()).toBeCloseTo(0.7, 5);
    expect(effects.size).toBe(1);

    effects.tick(999);
    expect(effects.has('slow')).toBe(true); // duration was refreshed, not at 200ms
    effects.tick(1);
    expect(effects.has('slow')).toBe(false);
  });

  it('takes the stronger magnitude when re-applied with a bigger value', () => {
    const effects = new StatusSet();
    effects.apply('slow', 1000, 0.2);
    effects.apply('slow', 500, 0.5); // stronger magnitude wins
    expect(effects.slowFactor()).toBeCloseTo(0.5, 5);
  });

  it('tracks size and clears all effects', () => {
    const effects = new StatusSet();
    effects.apply('slow', 1000, 0.4);
    effects.apply('burn', 1000, 5);
    expect(effects.size).toBe(2);
    expect(effects.has('slow')).toBe(true);
    expect(effects.has('burn')).toBe(true);

    effects.clear();
    expect(effects.size).toBe(0);
    expect(effects.has('slow')).toBe(false);
    expect(effects.slowFactor()).toBe(1);
  });

  it('ignores non-positive durations and magnitudes', () => {
    const effects = new StatusSet();
    effects.apply('slow', 0, 0.5);
    effects.apply('burn', 1000, 0);
    expect(effects.size).toBe(0);
  });
});

describe('StatusSet (buffs + the weaken debuff)', () => {
  it('defaults all buff/debuff factors to neutral when empty', () => {
    const s = new StatusSet();
    expect(s.weakenFactor()).toBe(1);
    expect(s.damageFactor()).toBe(1);
    expect(s.cooldownFactor()).toBe(1);
    expect(s.moveFactor()).toBe(1);
  });

  it('weaken reduces outgoing damage (1 - magnitude) with a floor', () => {
    const s = new StatusSet();
    s.apply('weaken', 1000, 0.4);
    expect(s.weakenFactor()).toBeCloseTo(0.6, 5);
    s.apply('weaken', 1000, 5); // clamps up to the floor
    expect(s.weakenFactor()).toBe(0.25);
  });

  it('might raises outgoing damage and haste both speeds attacks and movement', () => {
    const s = new StatusSet();
    s.apply('might', 1000, 0.3);
    s.apply('haste', 1000, 0.35);
    expect(s.damageFactor()).toBeCloseTo(1.3, 5);
    expect(s.cooldownFactor()).toBeCloseTo(0.65, 5);
    expect(s.moveFactor()).toBeCloseTo(1.35, 5);
  });

  it('floors the haste cooldown factor so attacks never become instant', () => {
    const s = new StatusSet();
    s.apply('haste', 1000, 5);
    expect(s.cooldownFactor()).toBe(0.4);
  });

  it('regen heals magnitude * dt and expires', () => {
    const s = new StatusSet();
    s.apply('regen', 1000, 10); // 10 hp/s for 1s
    expect(s.tick(500).regenHeal).toBeCloseTo(5, 5);
    expect(s.tick(500).regenHeal).toBeCloseTo(5, 5);
    expect(s.has('regen')).toBe(false);
    expect(s.tick(500).regenHeal).toBe(0);
  });
});

describe('StatusSet — ailments & CC (slice 3)', () => {
  it('dotDamage sums burn + ignite + poison + bleed over the tick', () => {
    const s = new StatusSet();
    s.apply('burn', 2000, 5);
    s.apply('ignite', 2000, 3);
    s.apply('bleed', 2000, 2);
    expect(s.tick(1000).dotDamage).toBeCloseTo(10);
  });
  it('poison stacks additively; other DoTs refresh by max', () => {
    const s = new StatusSet();
    s.apply('poison', 2000, 3);
    s.apply('poison', 2000, 3);
    expect(s.tick(1000).dotDamage).toBeCloseTo(6);
    const s2 = new StatusSet();
    s2.apply('burn', 2000, 3);
    s2.apply('burn', 2000, 3);
    expect(s2.tick(1000).dotDamage).toBeCloseTo(3);
  });
  it('slowFactor folds slow + chill + maim', () => {
    const s = new StatusSet();
    s.apply('chill', 2000, 0.3);
    s.apply('maim', 2000, 0.2);
    expect(s.slowFactor()).toBeCloseTo(0.5);
  });
  it('slowFactor respects the floor', () => {
    const s = new StatusSet();
    s.apply('chill', 2000, 0.9);
    s.apply('maim', 2000, 0.9);
    expect(s.slowFactor()).toBeCloseTo(0.2);
  });
  it('weakenFactor folds weaken + sap + curse', () => {
    const s = new StatusSet();
    s.apply('sap', 2000, 0.2);
    s.apply('curse', 2000, 0.1);
    expect(s.weakenFactor()).toBeCloseTo(0.7);
  });
  it('vulnFactor raises incoming damage from shock + brittle + curse', () => {
    const s = new StatusSet();
    s.apply('shock', 2000, 0.25);
    s.apply('brittle', 2000, 0.15);
    expect(s.vulnFactor()).toBeCloseTo(1.25 * 1.15);
  });
  it('vulnFactor is 1 with no incoming-up statuses', () => {
    expect(new StatusSet().vulnFactor()).toBe(1);
  });
  it('rooted on stun/freeze; silenced on stun/freeze/silence', () => {
    const a = new StatusSet();
    a.apply('stun', 1000, 1);
    expect(a.rooted()).toBe(true);
    expect(a.silenced()).toBe(true);
    const b = new StatusSet();
    b.apply('silence', 1000, 1);
    expect(b.rooted()).toBe(false);
    expect(b.silenced()).toBe(true);
    expect(new StatusSet().rooted()).toBe(false);
  });
});
