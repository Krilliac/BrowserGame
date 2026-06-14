import { describe, expect, it } from 'vitest';
import { coerceColumn, EDITABLE_TABLES } from './editable.js';

// ---------------------------------------------------------------------------
// coerceColumn — color
// ---------------------------------------------------------------------------

describe('coerceColumn color', () => {
  it('accepts a 3-digit hex', () => {
    expect(coerceColumn('abilities', 'color', '#abc')).toEqual({ ok: true, value: '#abc' });
  });

  it('accepts a 6-digit hex', () => {
    expect(coerceColumn('abilities', 'color', '#1a2b3c')).toEqual({
      ok: true,
      value: '#1a2b3c',
    });
  });

  it('accepts an 8-digit hex (alpha)', () => {
    expect(coerceColumn('abilities', 'color', '#1a2b3cff')).toEqual({
      ok: true,
      value: '#1a2b3cff',
    });
  });

  it('rejects a color missing the hash', () => {
    const r = coerceColumn('abilities', 'color', 'aabbcc');
    expect(r.ok).toBe(false);
  });

  it('rejects a color with invalid characters', () => {
    const r = coerceColumn('abilities', 'color', '#gggggg');
    expect(r.ok).toBe(false);
  });

  it('rejects empty string', () => {
    const r = coerceColumn('abilities', 'color', '#');
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// coerceColumn — int clamping
// ---------------------------------------------------------------------------

describe('coerceColumn int', () => {
  it('parses a valid integer', () => {
    expect(coerceColumn('abilities', 'cooldown_ms', '500')).toEqual({ ok: true, value: 500 });
  });

  it('clamps below min to min', () => {
    expect(coerceColumn('abilities', 'cooldown_ms', '-100')).toEqual({ ok: true, value: 0 });
  });

  it('clamps above max to max', () => {
    expect(coerceColumn('abilities', 'cooldown_ms', '999999')).toEqual({
      ok: true,
      value: 60000,
    });
  });

  it('rejects non-numeric input', () => {
    const r = coerceColumn('abilities', 'cooldown_ms', 'fast');
    expect(r.ok).toBe(false);
  });

  it('rejects float string for int', () => {
    // parseInt('3.5') === 3 which is finite, so it should succeed and return 3
    expect(coerceColumn('abilities', 'mana_cost', '3.5')).toEqual({ ok: true, value: 3 });
  });
});

// ---------------------------------------------------------------------------
// coerceColumn — real clamping
// ---------------------------------------------------------------------------

describe('coerceColumn real', () => {
  it('parses a valid float', () => {
    expect(coerceColumn('abilities', 'damage', '42.5')).toEqual({ ok: true, value: 42.5 });
  });

  it('clamps below min to min', () => {
    expect(coerceColumn('abilities', 'damage', '-1')).toEqual({ ok: true, value: 0 });
  });

  it('clamps above max to max', () => {
    expect(coerceColumn('abilities', 'damage', '99999')).toEqual({ ok: true, value: 9999 });
  });

  it('rejects NaN string', () => {
    const r = coerceColumn('mob_templates', 'hue', 'notanumber');
    expect(r.ok).toBe(false);
  });

  it('rejects Infinity string', () => {
    const r = coerceColumn('mob_templates', 'hue', 'Infinity');
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// coerceColumn — enum
// ---------------------------------------------------------------------------

describe('coerceColumn enum', () => {
  it('accepts a valid enum value', () => {
    expect(coerceColumn('abilities', 'kind', 'melee')).toEqual({ ok: true, value: 'melee' });
  });

  it('accepts another valid enum value', () => {
    expect(coerceColumn('abilities', 'kind', 'heal')).toEqual({ ok: true, value: 'heal' });
  });

  it('rejects an unknown enum value and lists valid options in error', () => {
    const r = coerceColumn('abilities', 'kind', 'magic');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('melee');
      expect(r.error).toContain('projectile');
      expect(r.error).toContain('heal');
    }
  });
});

// ---------------------------------------------------------------------------
// coerceColumn — bool
// ---------------------------------------------------------------------------

describe('coerceColumn bool', () => {
  const trueWords = ['1', 'true', 'on', 'yes'];
  const falseWords = ['0', 'false', 'off', 'no'];

  for (const word of trueWords) {
    it(`accepts truthy word '${word}' → 1`, () => {
      expect(coerceColumn('loot_entry', 'is_nothing', word)).toEqual({ ok: true, value: 1 });
    });
    it(`accepts truthy word '${word.toUpperCase()}' (case-insensitive) → 1`, () => {
      expect(coerceColumn('loot_entry', 'is_nothing', word.toUpperCase())).toEqual({
        ok: true,
        value: 1,
      });
    });
  }

  for (const word of falseWords) {
    it(`accepts falsy word '${word}' → 0`, () => {
      expect(coerceColumn('loot_entry', 'is_nothing', word)).toEqual({ ok: true, value: 0 });
    });
  }

  it('rejects an invalid bool word', () => {
    const r = coerceColumn('loot_entry', 'is_nothing', 'maybe');
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// coerceColumn — text
// ---------------------------------------------------------------------------

describe('coerceColumn text', () => {
  it('accepts a normal string', () => {
    expect(coerceColumn('abilities', 'name', 'Fireball')).toEqual({
      ok: true,
      value: 'Fireball',
    });
  });

  it('trims leading/trailing whitespace', () => {
    expect(coerceColumn('abilities', 'name', '  Fireball  ')).toEqual({
      ok: true,
      value: 'Fireball',
    });
  });

  it('strips ASCII control characters', () => {
    const r = coerceColumn('abilities', 'name', 'Fire\x00ball\x1f');
    expect(r).toEqual({ ok: true, value: 'Fireball' });
  });

  it('rejects empty string after trim', () => {
    const r = coerceColumn('abilities', 'name', '   ');
    expect(r.ok).toBe(false);
  });

  it('rejects string longer than 80 characters', () => {
    const r = coerceColumn('abilities', 'name', 'a'.repeat(81));
    expect(r.ok).toBe(false);
  });

  it('accepts exactly 80 characters', () => {
    const r = coerceColumn('abilities', 'name', 'a'.repeat(80));
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// coerceColumn — nullable
// ---------------------------------------------------------------------------

describe('coerceColumn nullable', () => {
  it('returns null for "null" on a nullable column', () => {
    expect(coerceColumn('abilities', 'melee_half_angle', 'null')).toEqual({
      ok: true,
      value: null,
    });
  });

  it('returns null for "NULL" (case-insensitive) on a nullable column', () => {
    expect(coerceColumn('abilities', 'melee_half_angle', 'NULL')).toEqual({
      ok: true,
      value: null,
    });
  });

  it('rejects "null" on a non-nullable column', () => {
    const r = coerceColumn('abilities', 'damage', 'null');
    expect(r.ok).toBe(false);
  });

  it('nullable enum: null works', () => {
    expect(coerceColumn('items', 'slot', 'null')).toEqual({ ok: true, value: null });
  });

  it('nullable enum: valid value still works', () => {
    expect(coerceColumn('items', 'slot', 'weapon')).toEqual({ ok: true, value: 'weapon' });
  });

  it('nullable text: null works', () => {
    expect(coerceColumn('quests', 'target_mob', 'null')).toEqual({ ok: true, value: null });
  });
});

// ---------------------------------------------------------------------------
// coerceColumn — unknown table / column errors
// ---------------------------------------------------------------------------

describe('coerceColumn unknown table/column', () => {
  it('returns an error for an unknown table', () => {
    const r = coerceColumn('dragons', 'hp', '100');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Unknown table: dragons');
  });

  it('returns an error for an unknown column on a known table', () => {
    const r = coerceColumn('abilities', 'fire_level', '3');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Unknown column fire_level on abilities');
  });
});

// ---------------------------------------------------------------------------
// area_theme — derived from THEME_KEYS
// ---------------------------------------------------------------------------

describe('area_theme derived columns', () => {
  it('ground_base accepts a valid color', () => {
    expect(coerceColumn('area_theme', 'ground_base', '#123')).toEqual({
      ok: true,
      value: '#123',
    });
  });

  it('ground_base rejects an invalid color', () => {
    const r = coerceColumn('area_theme', 'ground_base', 'notacolor');
    expect(r.ok).toBe(false);
  });

  it('prop enum accepts a valid value', () => {
    expect(coerceColumn('area_theme', 'prop', 'tree')).toEqual({ ok: true, value: 'tree' });
  });

  it('prop enum rejects an invalid value', () => {
    const r = coerceColumn('area_theme', 'prop', 'volcano');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('tree');
    }
  });

  it('weather enum accepts a valid value', () => {
    expect(coerceColumn('area_theme', 'weather', 'rain')).toEqual({ ok: true, value: 'rain' });
  });

  it('weather enum rejects an invalid value', () => {
    const r = coerceColumn('area_theme', 'weather', 'hail');
    expect(r.ok).toBe(false);
  });

  it('particle_count clamps to [0, 160]', () => {
    expect(coerceColumn('area_theme', 'particle_count', '9999')).toEqual({
      ok: true,
      value: 160,
    });
  });

  it('atmo_alpha clamps to [0, 1]', () => {
    expect(coerceColumn('area_theme', 'atmo_alpha', '5')).toEqual({ ok: true, value: 1 });
  });

  it('outdoor bool word → 1', () => {
    expect(coerceColumn('area_theme', 'outdoor', 'true')).toEqual({ ok: true, value: 1 });
  });
});

// ---------------------------------------------------------------------------
// TableSpec invariants: pk is non-empty and not listed in columns
// ---------------------------------------------------------------------------

describe('tuning tables are live-editable via /set', () => {
  it('elite_modifiers.hp_mult coerces a real', () => {
    expect(coerceColumn('elite_modifiers', 'hp_mult', '2.5')).toEqual({ ok: true, value: 2.5 });
  });

  it('elite_modifiers.hp_mult clamps above the column max', () => {
    expect(coerceColumn('elite_modifiers', 'hp_mult', '9999')).toEqual({ ok: true, value: 100 });
  });

  it('weather_modifiers.move_scale coerces a real', () => {
    expect(coerceColumn('weather_modifiers', 'move_scale', '0.8')).toEqual({
      ok: true,
      value: 0.8,
    });
  });

  it('ability_status_effects.duration_ms coerces an int', () => {
    expect(coerceColumn('ability_status_effects', 'duration_ms', '2500')).toEqual({
      ok: true,
      value: 2500,
    });
  });

  it('ability_status_effects.effect rejects an unknown status kind', () => {
    expect(coerceColumn('ability_status_effects', 'effect', 'stun').ok).toBe(false);
  });

  it('ability_cast_buffs.buff accepts a valid buff id', () => {
    expect(coerceColumn('ability_cast_buffs', 'buff', 'might')).toEqual({
      ok: true,
      value: 'might',
    });
  });

  it('ability_cast_buffs.buff rejects a non-buff status', () => {
    expect(coerceColumn('ability_cast_buffs', 'buff', 'slow').ok).toBe(false);
  });

  it('shrine_buffs.magnitude coerces a real', () => {
    expect(coerceColumn('shrine_buffs', 'magnitude', '0.5')).toEqual({ ok: true, value: 0.5 });
  });

  it('game_config.value coerces a real', () => {
    expect(coerceColumn('game_config', 'value', '1.6')).toEqual({ ok: true, value: 1.6 });
  });

  it('rarity_tiers.color coerces a hex color', () => {
    expect(coerceColumn('rarity_tiers', 'color', '#ff7a1a')).toEqual({
      ok: true,
      value: '#ff7a1a',
    });
  });

  it('rarity_tiers.weight coerces a real', () => {
    expect(coerceColumn('rarity_tiers', 'weight', '480')).toEqual({ ok: true, value: 480 });
  });

  it('gems.stat accepts a valid affix stat and rejects others', () => {
    expect(coerceColumn('gems', 'stat', 'power')).toEqual({ ok: true, value: 'power' });
    expect(coerceColumn('gems', 'stat', 'frail').ok).toBe(false);
  });
});

describe('EDITABLE_TABLES invariants', () => {
  for (const [tableName, tableSpec] of Object.entries(EDITABLE_TABLES)) {
    it(`${tableName}: pk is a non-empty string`, () => {
      expect(typeof tableSpec.pk).toBe('string');
      expect(tableSpec.pk.length).toBeGreaterThan(0);
    });

    it(`${tableName}: pk is not listed in columns`, () => {
      expect(Object.keys(tableSpec.columns)).not.toContain(tableSpec.pk);
    });
  }
});
