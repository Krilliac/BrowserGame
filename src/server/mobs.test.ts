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
