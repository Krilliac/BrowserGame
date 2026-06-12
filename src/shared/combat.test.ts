import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  ABILITY_ORDER,
  PLAYER_MAX_MANA,
  STARTER_ABILITIES,
  isAbilityId,
  spellRankMult,
  type AbilityId,
} from './combat.js';

describe('ABILITIES table — every entry is well-formed', () => {
  it('ids match their keys and names/colors are present', () => {
    for (const [key, a] of Object.entries(ABILITIES)) {
      expect(a.id, key).toBe(key);
      expect(a.name.length, key).toBeGreaterThan(0);
      expect(a.color, key).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('numbers are within sane bounds (no zero cooldowns, mana within the pool)', () => {
    for (const [key, a] of Object.entries(ABILITIES)) {
      expect(a.cooldownMs, key).toBeGreaterThan(0);
      expect(a.manaCost, key).toBeGreaterThanOrEqual(0);
      expect(a.manaCost, key).toBeLessThanOrEqual(PLAYER_MAX_MANA);
      expect(a.damage, key).toBeGreaterThanOrEqual(0);
      expect(a.range, key).toBeGreaterThanOrEqual(0);
      expect(a.radius, key).toBeGreaterThanOrEqual(0);
    }
  });

  it('projectiles carry speed + ttl; melee carries a positive half-angle', () => {
    for (const [key, a] of Object.entries(ABILITIES)) {
      if (a.kind === 'projectile') {
        expect(a.projectileSpeed, key).toBeGreaterThan(0);
        expect(a.projectileTtlMs, key).toBeGreaterThan(0);
      }
      if (a.kind === 'melee') {
        expect(a.meleeHalfAngle, key).toBeGreaterThan(0);
        expect(a.meleeHalfAngle, key).toBeLessThanOrEqual(3.2); // ~π = a full-circle nova
      }
    }
  });

  it('keeps the original nine spells first (content.test.ts and seeding sort rely on it)', () => {
    expect(ABILITY_ORDER.slice(0, 9)).toEqual([
      'slash',
      'fireball',
      'arrow',
      'frost',
      'heal',
      'lightning',
      'cleave',
      'venom',
      'meteor',
    ]);
  });

  it('starter abilities are real ability ids', () => {
    for (const id of STARTER_ABILITIES) expect(isAbilityId(id)).toBe(true);
  });
});

describe('long-climb expansion spells', () => {
  const expected: [AbilityId, 'melee' | 'projectile' | 'heal'][] = [
    ['razor_wind', 'projectile'],
    ['bone_chakram', 'projectile'],
    ['mire_mortar', 'projectile'],
    ['galeburst', 'melee'],
    ['earthshatter', 'melee'],
    ['divine_mending', 'heal'],
    ['battle_trance', 'heal'],
    ['wyrmfire_lance', 'projectile'],
    ['starfall', 'projectile'],
    ['maelstrom_orb', 'projectile'],
  ];

  it('all ten exist with the intended kind', () => {
    for (const [id, kind] of expected) {
      expect(isAbilityId(id), id).toBe(true);
      expect(ABILITIES[id].kind, id).toBe(kind);
    }
  });

  it('the novas hit all around (full-circle half-angle, like frostnova)', () => {
    expect(ABILITIES.galeburst.meleeHalfAngle).toBeCloseTo(3.15);
    expect(ABILITIES.earthshatter.meleeHalfAngle).toBeCloseTo(3.15);
  });

  it('the late nukes cost more and hit harder than meteor — chase, not free upgrade', () => {
    for (const id of ['wyrmfire_lance', 'starfall', 'maelstrom_orb'] as const) {
      const nuke = ABILITIES[id];
      expect(nuke.damage, id).toBeGreaterThan(ABILITIES.meteor.damage);
      expect(nuke.manaCost, id).toBeGreaterThan(ABILITIES.meteor.manaCost);
      expect(nuke.cooldownMs, id).toBeGreaterThan(ABILITIES.meteor.cooldownMs);
      // No strict dominance: burst rises but sustained damage-per-second stays at or below meteor's.
      const meteorDps = ABILITIES.meteor.damage / ABILITIES.meteor.cooldownMs;
      expect(nuke.damage / nuke.cooldownMs, id).toBeLessThanOrEqual(meteorDps);
    }
  });

  it('each new spell has a distinct color, unused by any other ability', () => {
    const newIds = new Set<string>(expected.map(([id]) => id));
    const others = new Set(
      Object.values(ABILITIES)
        .filter((a) => !newIds.has(a.id))
        .map((a) => a.color.toLowerCase()),
    );
    const seen = new Set<string>();
    for (const [id] of expected) {
      const color = ABILITIES[id].color.toLowerCase();
      expect(seen.has(color), id).toBe(false);
      expect(others.has(color), id).toBe(false);
      seen.add(color);
    }
  });
});

describe('spellRankMult', () => {
  it('is 1.0 at rank 1 and clamps to the rank cap', () => {
    expect(spellRankMult(1)).toBe(1);
    expect(spellRankMult(0)).toBe(1); // clamped up
    expect(spellRankMult(3)).toBeCloseTo(1.24);
    expect(spellRankMult(99)).toBe(spellRankMult(5)); // clamped to MAX_SPELL_RANK
  });
});
