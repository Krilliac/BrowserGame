import { describe, expect, it } from 'vitest';
import {
  MOB_TEMPLATES,
  MOB_TRAITS,
  isPackish,
  stepMob,
  traitDamageMult,
  type MobStepContext,
  type MobView,
  type PlayerView,
} from './mobs.js';

const wolf = MOB_TEMPLATES.wolf!;

function mob(x: number, y: number, attackReady = true): MobView {
  return { x, y, template: wolf, attackReady };
}
function player(id: number, x: number, y: number, alive = true): PlayerView {
  return { id, x, y, alive };
}

describe('stepMob', () => {
  it('idles when no player is in aggro range', () => {
    const intent = stepMob(mob(0, 0), [player(1, 10_000, 0)]);
    expect(intent).toEqual({ vx: 0, vy: 0, facing: null, attackTargetId: null });
  });

  it('chases a player that is in aggro range but out of attack range', () => {
    const intent = stepMob(mob(0, 0), [player(1, 200, 0)]);
    expect(intent.vx).toBeCloseTo(wolf.speed, 5); // moving right toward target
    expect(intent.vy).toBeCloseTo(0, 5);
    expect(intent.attackTargetId).toBeNull();
  });

  it('attacks a player within attack range when ready', () => {
    const intent = stepMob(mob(0, 0, true), [player(7, 30, 0)]);
    expect(intent.vx).toBe(0);
    expect(intent.attackTargetId).toBe(7);
  });

  it('does not attack while on cooldown', () => {
    const intent = stepMob(mob(0, 0, false), [player(7, 30, 0)]);
    expect(intent.attackTargetId).toBeNull();
  });

  it('ignores dead players', () => {
    const intent = stepMob(mob(0, 0), [player(1, 30, 0, false)]);
    expect(intent.attackTargetId).toBeNull();
    expect(intent).toEqual({ vx: 0, vy: 0, facing: null, attackTargetId: null });
  });

  it('targets the nearest living player', () => {
    const intent = stepMob(mob(0, 0, true), [player(1, 35, 0), player(2, 30, 0)]);
    expect(intent.attackTargetId).toBe(2);
  });
});

const sprite = MOB_TEMPLATES.sprite!; // ranged kiter
function ranged(x: number, y: number, attackReady = true): MobView {
  return { x, y, template: sprite, attackReady };
}

describe('stepMob (ranged kiting)', () => {
  it('approaches when the target is beyond firing range', () => {
    const intent = stepMob(ranged(0, 0), [player(1, sprite.attackRange + 100, 0)]);
    expect(intent.vx).toBeCloseTo(sprite.speed, 5); // moving toward the target
    expect(intent.attackTargetId).toBeNull();
  });

  it('backs away when the target is closer than the kite range', () => {
    const kite = sprite.kiteRange!;
    const intent = stepMob(ranged(0, 0), [player(1, kite - 50, 0)]);
    expect(intent.vx).toBeCloseTo(-sprite.speed, 5); // retreating away from the target
    expect(intent.attackTargetId).toBeNull();
  });

  it('holds and fires when inside the kite band and ready', () => {
    const mid = (sprite.kiteRange! + sprite.attackRange) / 2;
    const intent = stepMob(ranged(0, 0, true), [player(9, mid, 0)]);
    expect(intent.vx).toBe(0);
    expect(intent.vy).toBe(0);
    expect(intent.attackTargetId).toBe(9);
  });

  it('holds fire while on cooldown', () => {
    const mid = (sprite.kiteRange! + sprite.attackRange) / 2;
    const intent = stepMob(ranged(0, 0, false), [player(9, mid, 0)]);
    expect(intent.attackTargetId).toBeNull();
  });
});

const boar = MOB_TEMPLATES.boar!; // charger
function charger(x: number, y: number, attackReady = true): MobView {
  return { x, y, template: boar, attackReady };
}

describe('stepMob (charger)', () => {
  it('approaches while outside the charge-trigger range', () => {
    const intent = stepMob(charger(0, 0), [player(1, boar.attackRange + 80, 0)]);
    expect(intent.vx).toBeCloseTo(boar.speed, 5);
    expect(intent.attackTargetId).toBeNull();
  });

  it('triggers an attack (the lunge) once within charge range and ready', () => {
    const intent = stepMob(charger(0, 0, true), [player(4, boar.attackRange - 40, 0)]);
    expect(intent.attackTargetId).toBe(4);
  });
});

// --- Trait behaviors (MobStepContext) -----------------------------------------------------

const kobold = MOB_TEMPLATES.thistle_kobold!; // pack + craven melee
const orc = MOB_TEMPLATES.mosshide_orc!; // enrage melee
const stalker = MOB_TEMPLATES.wraithfrost_stalker!; // flanker melee

function viewOf(template: typeof wolf, x = 0, y = 0, attackReady = true): MobView {
  return { x, y, template, attackReady };
}
function ctx(overrides: Partial<MobStepContext> = {}): MobStepContext {
  return { hpFrac: 1, packNearby: 0, seed: 1, alerted: false, ...overrides };
}

describe('stepMob (craven trait)', () => {
  it('flees directly away at full speed below 30% hp, still facing the target', () => {
    const intent = stepMob(viewOf(kobold), [player(1, 100, 0)], 1, ctx({ hpFrac: 0.2 }));
    expect(intent.vx).toBeCloseTo(-kobold.speed, 5); // backpedaling away
    expect(intent.vy).toBeCloseTo(0, 5);
    expect(intent.facing).toBeCloseTo(0, 5); // still facing the threat
    expect(intent.attackTargetId).toBeNull();
  });

  it('flees instead of attacking even inside attack range', () => {
    const intent = stepMob(viewOf(kobold), [player(1, 30, 0)], 1, ctx({ hpFrac: 0.2 }));
    expect(intent.vx).toBeLessThan(0);
    expect(intent.attackTargetId).toBeNull();
  });

  it('holds the line when 2+ packmates are nearby (brave in numbers)', () => {
    const intent = stepMob(
      viewOf(kobold),
      [player(1, 100, 0)],
      1,
      ctx({ hpFrac: 0.2, packNearby: 2 }),
    );
    expect(intent.vx).toBeCloseTo(kobold.speed * 1.15, 5); // chasing, with the pack speed bonus
  });

  it('fights normally at or above 30% hp', () => {
    const intent = stepMob(viewOf(kobold), [player(1, 100, 0)], 1, ctx({ hpFrac: 0.3 }));
    expect(intent.vx).toBeCloseTo(kobold.speed, 5);
  });
});

describe('stepMob (enrage trait)', () => {
  it('moves 1.35x faster below 35% hp', () => {
    const intent = stepMob(viewOf(orc), [player(1, 200, 0)], 1, ctx({ hpFrac: 0.3 }));
    expect(intent.vx).toBeCloseTo(orc.speed * 1.35, 5);
  });

  it('moves at base speed at or above 35% hp', () => {
    const at = stepMob(viewOf(orc), [player(1, 200, 0)], 1, ctx({ hpFrac: 0.35 }));
    const healthy = stepMob(viewOf(orc), [player(1, 200, 0)], 1, ctx({ hpFrac: 1 }));
    expect(at.vx).toBeCloseTo(orc.speed, 5);
    expect(healthy.vx).toBeCloseTo(orc.speed, 5);
  });
});

describe('stepMob (pack trait)', () => {
  it('gains speed with packmates: x1.15 at 1+, x1.25 at 3+', () => {
    const lone = stepMob(viewOf(wolf), [player(1, 200, 0)], 1, ctx());
    const pair = stepMob(viewOf(wolf), [player(1, 200, 0)], 1, ctx({ packNearby: 1 }));
    const swarm = stepMob(viewOf(wolf), [player(1, 200, 0)], 1, ctx({ packNearby: 3 }));
    expect(lone.vx).toBeCloseTo(wolf.speed, 5);
    expect(pair.vx).toBeCloseTo(wolf.speed * 1.15, 5);
    expect(swarm.vx).toBeCloseTo(wolf.speed * 1.25, 5);
  });

  it('extends aggro range x1.3 with packmates nearby', () => {
    const beyondBase = wolf.aggroRange + 60; // outside base aggro, inside the x1.3 reach
    const lone = stepMob(viewOf(wolf), [player(1, beyondBase, 0)], 1, ctx());
    const pack = stepMob(viewOf(wolf), [player(1, beyondBase, 0)], 1, ctx({ packNearby: 1 }));
    expect(lone.vx).toBe(0); // idles — target out of range
    expect(pack.vx).toBeGreaterThan(0); // the pack hunts it down
  });

  it('gives no pack bonus to non-pack templates', () => {
    const intent = stepMob(viewOf(orc), [player(1, 200, 0)], 1, ctx({ packNearby: 3 }));
    expect(intent.vx).toBeCloseTo(orc.speed, 5);
  });
});

describe('stepMob (flanker trait)', () => {
  const target = [player(1, 150, 0)]; // inside the 70..220 flank band

  it('curves around the target in the 70..220 band (not parallel to the approach)', () => {
    const intent = stepMob(viewOf(stalker), target, 1, ctx({ seed: 2 }));
    expect(intent.vx).toBeGreaterThan(0); // still closing
    expect(Math.abs(intent.vy)).toBeGreaterThan(1); // ...but off the beeline
    expect(Math.hypot(intent.vx, intent.vy)).toBeCloseTo(stalker.speed, 5); // net speed unchanged
  });

  it('is deterministic for a fixed seed and mirrored across seed parity', () => {
    const even = stepMob(viewOf(stalker), target, 1, ctx({ seed: 2 }));
    const evenAgain = stepMob(viewOf(stalker), target, 1, ctx({ seed: 2 }));
    const odd = stepMob(viewOf(stalker), target, 1, ctx({ seed: 3 }));
    expect(evenAgain).toEqual(even);
    expect(odd.vy).toBeCloseTo(-even.vy, 5); // mirrored side
    expect(odd.vx).toBeCloseTo(even.vx, 5);
  });

  it('commits straight in below 70 and beelines beyond 220', () => {
    const close = stepMob(viewOf(stalker), [player(1, 60, 0)], 1, ctx({ seed: 2 }));
    const far = stepMob(viewOf(stalker), [player(1, 300, 0)], 1, ctx({ seed: 2 }));
    expect(close.vy).toBeCloseTo(0, 5);
    expect(close.vx).toBeCloseTo(stalker.speed, 5);
    expect(far.vy).toBeCloseTo(0, 5);
  });
});

describe('stepMob (alerted)', () => {
  it('extends acquisition range x2.5 when alerted', () => {
    const beyondBase = wolf.aggroRange * 2; // far outside base aggro, inside the alerted reach
    const calm = stepMob(viewOf(wolf), [player(1, beyondBase, 0)], 1, ctx());
    const alerted = stepMob(viewOf(wolf), [player(1, beyondBase, 0)], 1, ctx({ alerted: true }));
    expect(calm).toEqual({ vx: 0, vy: 0, facing: null, attackTargetId: null });
    expect(alerted.vx).toBeGreaterThan(0); // hunts the player down
  });
});

describe('stepMob (no-ctx regression)', () => {
  it('behaves exactly like the trait-free baseline when ctx is omitted', () => {
    // A craven+pack template just chases; a flanker beelines. No trait can act without ctx.
    const chase = stepMob(viewOf(kobold), [player(1, 100, 0)]);
    expect(chase.vx).toBeCloseTo(kobold.speed, 5);
    expect(chase.vy).toBeCloseTo(0, 5);

    const beeline = stepMob(viewOf(stalker), [player(1, 150, 0)]);
    expect(beeline.vy).toBeCloseTo(0, 5);
    expect(beeline.vx).toBeCloseTo(stalker.speed, 5);

    // Explicit undefined ctx is identical to the 3-arg call world.ts makes today.
    expect(stepMob(viewOf(wolf), [player(1, 200, 0)], 1, undefined)).toEqual(
      stepMob(viewOf(wolf), [player(1, 200, 0)], 1),
    );
  });
});

describe('traitDamageMult', () => {
  it('returns 1.5 for enrage templates below 35% hp, else 1', () => {
    expect(traitDamageMult('mosshide_orc', 0.34)).toBe(1.5);
    expect(traitDamageMult('mosshide_orc', 0.35)).toBe(1);
    expect(traitDamageMult('mosshide_orc', 1)).toBe(1);
    expect(traitDamageMult('wolf', 0.1)).toBe(1); // pack, not enrage
    expect(traitDamageMult('no_such_template', 0.1)).toBe(1);
  });
});

describe('isPackish', () => {
  it('reports the pack trait', () => {
    expect(isPackish('wolf')).toBe(true);
    expect(isPackish('mosshide_orc')).toBe(false);
    expect(isPackish('no_such_template')).toBe(false);
  });
});

describe('MOB_TRAITS data integrity', () => {
  it('every key is a real template, bosses (hp >= 200) are traitless, and 1-2 unique traits each', () => {
    for (const [id, traits] of Object.entries(MOB_TRAITS)) {
      const template = MOB_TEMPLATES[id];
      expect(template, `MOB_TRAITS key "${id}" missing from MOB_TEMPLATES`).toBeDefined();
      expect(template!.hp, `boss "${id}" (hp ${template!.hp}) must stay traitless`).toBeLessThan(
        200,
      );
      expect(traits.length).toBeGreaterThanOrEqual(1);
      expect(traits.length).toBeLessThanOrEqual(2);
      expect(new Set(traits).size).toBe(traits.length);
    }
  });
});
