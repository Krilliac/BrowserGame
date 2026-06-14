import { describe, expect, it } from 'vitest';
import {
  coordinateSquad,
  DEFAULT_SQUAD_TUNING,
  type SquadMemberInput,
  type SquadMobInput,
} from './bot-squad.js';

function member(over: Partial<SquadMemberInput> & { id: number }): SquadMemberInput {
  return {
    x: 0,
    y: 0,
    hpFrac: 1,
    maxHp: 100,
    level: 10,
    dead: false,
    hasHeal: false,
    ...over,
  };
}

function mob(over: Partial<SquadMobInput> & { id: number }): SquadMobInput {
  return { x: 0, y: 0, hp: 100, level: 10, boss: false, elite: false, ...over };
}

describe('coordinateSquad — roles', () => {
  it('marks heal-owners as healers, the toughest of the rest as tank, others dps', () => {
    const ctx = coordinateSquad(
      [
        member({ id: 1, maxHp: 120 }),
        member({ id: 2, maxHp: 200 }), // toughest non-healer → tank
        member({ id: 3, maxHp: 90, hasHeal: true }), // healer
      ],
      [],
    );
    expect(ctx.role.get(3)).toBe('healer');
    expect(ctx.role.get(2)).toBe('tank');
    expect(ctx.role.get(1)).toBe('dps');
  });

  it('breaks tank ties by lower id (deterministic)', () => {
    const ctx = coordinateSquad([member({ id: 5, maxHp: 100 }), member({ id: 2, maxHp: 100 })], []);
    expect(ctx.role.get(2)).toBe('tank');
    expect(ctx.role.get(5)).toBe('dps');
  });
});

describe('coordinateSquad — focus fire', () => {
  it('prefers a boss over an elite over a normal mob', () => {
    const ctx = coordinateSquad(
      [member({ id: 1 })],
      [mob({ id: 10 }), mob({ id: 11, elite: true }), mob({ id: 12, boss: true })],
    );
    expect(ctx.focusTargetId).toBe(12);
  });

  it('within a tier, finishes the most-wounded target', () => {
    const ctx = coordinateSquad(
      [member({ id: 1 })],
      [mob({ id: 10, hp: 80 }), mob({ id: 11, hp: 20 }), mob({ id: 12, hp: 50 })],
    );
    expect(ctx.focusTargetId).toBe(11);
  });

  it('ignores mobs outside the engage radius', () => {
    const far = DEFAULT_SQUAD_TUNING.engageRadius + 200;
    const ctx = coordinateSquad([member({ id: 1, x: 0, y: 0 })], [mob({ id: 10, x: far, y: 0 })]);
    expect(ctx.focusTargetId).toBeUndefined();
  });
});

describe('coordinateSquad — regroup & rescue', () => {
  it('calls a rally + holds the party when a member is scattered', () => {
    const spread = DEFAULT_SQUAD_TUNING.regroupRadius + 100;
    const ctx = coordinateSquad(
      [member({ id: 1, x: 0, y: 0 }), member({ id: 2, x: spread * 2, y: 0 })],
      [],
    );
    expect(ctx.holdForParty).toBe(true);
    expect(ctx.rally).toBeDefined();
  });

  it('holds the party when a living member is low on health', () => {
    const ctx = coordinateSquad([member({ id: 1, hpFrac: 1 }), member({ id: 2, hpFrac: 0.1 })], []);
    expect(ctx.holdForParty).toBe(true);
  });

  it('holds the party when a member is dead (rescue/regroup)', () => {
    const ctx = coordinateSquad([member({ id: 1 }), member({ id: 2, dead: true })], []);
    expect(ctx.holdForParty).toBe(true);
  });

  it('a gathered, healthy squad pushes on (no rally, no hold)', () => {
    const ctx = coordinateSquad([member({ id: 1, x: 0 }), member({ id: 2, x: 40 })], []);
    expect(ctx.holdForParty).toBe(false);
    expect(ctx.rally).toBeUndefined();
  });
});
