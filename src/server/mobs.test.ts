import { describe, expect, it } from 'vitest';
import { MOB_TEMPLATES, stepMob, type MobView, type PlayerView } from './mobs.js';

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
