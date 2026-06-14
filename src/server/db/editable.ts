/**
 * Registry + validation boundary for the live content editor.
 *
 * A Developer can edit any whitelisted content-DB column at runtime via
 * `/set <table> <id> <column> <value>`. This module decides which tables and columns
 * are editable, and validates + coerces an untrusted raw string into a safe typed value.
 *
 * Pure module: no DB access, no I/O, no Date/random. Just data and pure functions.
 * The `area_theme` table columns are derived programmatically from THEME_KEYS so they
 * never drift out of sync with the shared theme contract.
 */

import { THEME_KEYS } from '../../shared/theme.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ColumnSpec {
  type: 'text' | 'int' | 'real' | 'color' | 'enum' | 'bool';
  min?: number;
  max?: number;
  values?: readonly string[];
  /** If true, the literal "null" (case-insensitive) sets SQL NULL. */
  nullable?: boolean;
}

export interface TableSpec {
  /** Primary-key column name. */
  pk: string;
  /** Human label, e.g. 'spell'. */
  label: string;
  /** Editable columns (NOT including the pk). */
  columns: Record<string, ColumnSpec>;
  /** Optional one-line note about liveness / side-effects. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const TRUE_WORDS = ['1', 'true', 'on', 'yes'];
const FALSE_WORDS = ['0', 'false', 'off', 'no'];

/** Strip ASCII control characters (0x00-0x1f, 0x7f). */
function stripControl(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x1f\x7f]/g, '');
}

// ---------------------------------------------------------------------------
// Derive area_theme columns from THEME_KEYS (single source of truth)
// ---------------------------------------------------------------------------

function buildThemeColumns(): Record<string, ColumnSpec> {
  const cols: Record<string, ColumnSpec> = {};
  for (const [key, spec] of Object.entries(THEME_KEYS)) {
    const col: ColumnSpec = (() => {
      switch (spec.type) {
        case 'color':
          return { type: 'color' } satisfies ColumnSpec;
        case 'bool':
          return { type: 'bool' } satisfies ColumnSpec;
        case 'enum': {
          const base: ColumnSpec = { type: 'enum' };
          if (spec.values !== undefined) base.values = spec.values;
          return base;
        }
        case 'int': {
          const base: ColumnSpec = { type: 'int' };
          if (spec.min !== undefined) base.min = spec.min;
          if (spec.max !== undefined) base.max = spec.max;
          return base;
        }
        case 'number': {
          const base: ColumnSpec = { type: 'real' };
          if (spec.min !== undefined) base.min = spec.min;
          if (spec.max !== undefined) base.max = spec.max;
          return base;
        }
      }
    })();
    cols[key] = col;
  }
  return cols;
}

// ---------------------------------------------------------------------------
// EDITABLE_TABLES registry
// ---------------------------------------------------------------------------

export const EDITABLE_TABLES: Record<string, TableSpec> = {
  abilities: {
    pk: 'id',
    label: 'spell',
    columns: {
      name: { type: 'text' },
      key: { type: 'text' },
      kind: { type: 'enum', values: ['melee', 'projectile', 'heal'] },
      damage: { type: 'real', min: 0, max: 9999 },
      range: { type: 'real', min: 0, max: 4000 },
      cooldown_ms: { type: 'int', min: 0, max: 60000 },
      mana_cost: { type: 'int', min: 0, max: 1000 },
      color: { type: 'color' },
      radius: { type: 'real', min: 0, max: 400 },
      sort_order: { type: 'int', min: 0, max: 99 },
      melee_half_angle: { type: 'real', min: 0, max: 3.2, nullable: true },
      projectile_speed: { type: 'real', min: 0, max: 4000, nullable: true },
      projectile_ttl_ms: { type: 'int', min: 0, max: 20000, nullable: true },
    },
  },

  items: {
    pk: 'id',
    label: 'item',
    columns: {
      name: { type: 'text' },
      kind: { type: 'enum', values: ['equip', 'loot', 'currency', 'spellbook', 'gem'] },
      slot: { type: 'enum', values: ['weapon', 'armor'], nullable: true },
      power: { type: 'real', min: 0, max: 9999, nullable: true },
      hp: { type: 'real', min: 0, max: 99999, nullable: true },
      color: { type: 'color', nullable: true },
      sell_value: { type: 'int', min: 0, max: 1000000 },
      teaches: { type: 'text', nullable: true },
    },
  },

  mob_templates: {
    pk: 'id',
    label: 'monster',
    note: 'hp/level apply to newly spawned mobs',
    columns: {
      name: { type: 'text' },
      hp: { type: 'int', min: 1, max: 1000000 },
      level: { type: 'int', min: 1, max: 999 },
      hue: { type: 'real', min: 0, max: 360 },
      speed: { type: 'real', min: 0, max: 2000 },
      aggro_range: { type: 'real', min: 0, max: 4000 },
      attack_range: { type: 'real', min: 0, max: 1000 },
      damage: { type: 'real', min: 0, max: 99999 },
      attack_cooldown_ms: { type: 'int', min: 0, max: 60000 },
    },
  },

  quests: {
    pk: 'id',
    label: 'quest',
    columns: {
      name: { type: 'text' },
      description: { type: 'text' },
      target_mob: { type: 'text', nullable: true },
      target_count: { type: 'int', min: 0, max: 100000 },
      reward_gold: { type: 'int', min: 0, max: 100000000 },
      reward_xp: { type: 'int', min: 0, max: 100000000 },
      reward_item: { type: 'text', nullable: true },
      turn_in_item: { type: 'text', nullable: true },
      turn_in_count: { type: 'int', min: 0, max: 100000 },
    },
  },

  areas: {
    pk: 'id',
    label: 'area',
    columns: {
      name: { type: 'text' },
      width: { type: 'int', min: 200, max: 100000 },
      height: { type: 'int', min: 200, max: 100000 },
      spawn_x: { type: 'int', min: 0, max: 100000 },
      spawn_y: { type: 'int', min: 0, max: 100000 },
      player_cap: { type: 'int', min: 1, max: 1000 },
    },
  },

  area_mobs: {
    pk: 'id',
    label: 'spawn',
    note: 'placement applies to new instances',
    columns: {
      area_id: { type: 'text' },
      template_id: { type: 'text' },
      count: { type: 'int', min: 0, max: 1000 },
    },
  },

  npcs: {
    pk: 'id',
    label: 'npc',
    note: 'placement applies to new instances',
    columns: {
      area_id: { type: 'text' },
      name: { type: 'text' },
      x: { type: 'int', min: 0, max: 100000 },
      y: { type: 'int', min: 0, max: 100000 },
      hue: { type: 'real', min: 0, max: 360 },
      kind: {
        type: 'enum',
        values: [
          'vendor',
          'questgiver',
          'healer',
          'gambler',
          'artificer',
          'banker',
          'recruiter',
          'riftkeeper',
        ],
      },
    },
  },

  sprite_tints: {
    pk: 'target',
    label: 'sprite tint',
    note: 'multiply color over a sprite source: mob:<id> | npc:<kind> | hireling:<type> | decor:<kind>',
    columns: {
      tint: { type: 'text' },
    },
  },

  vendor_stock: {
    pk: 'id',
    label: 'shop item',
    note: 'reload to apply to open shops',
    columns: {
      area_id: { type: 'text' },
      npc_name: { type: 'text' },
      item_id: { type: 'text' },
      price: { type: 'int', min: 0, max: 100000000 },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  loot_entry: {
    pk: 'id',
    label: 'loot row',
    columns: {
      weight: { type: 'real', min: 0, max: 100000 },
      min_qty: { type: 'int', min: 0, max: 100000 },
      max_qty: { type: 'int', min: 0, max: 100000 },
      chance: { type: 'real', min: 0, max: 1 },
      is_nothing: { type: 'bool' },
      grp: { type: 'enum', values: ['always', 'main', 'rare', 'gear'] },
      item_id: { type: 'text' },
    },
  },

  area_theme: {
    pk: 'area_id',
    label: 'theme',
    note: 'edit via /settheme for ergonomics',
    columns: buildThemeColumns(),
  },

  weather_modifiers: {
    pk: 'weather',
    label: 'weather rule',
    note: 'gameplay effect of a weather kind; reload to apply',
    columns: {
      move_scale: { type: 'real', min: 0, max: 4 },
      aggro_scale: { type: 'real', min: 0, max: 4 },
    },
  },

  elite_modifiers: {
    pk: 'id',
    label: 'champion modifier',
    note: 'applies to newly spawned elites',
    columns: {
      name: { type: 'text' },
      hp_mult: { type: 'real', min: 0, max: 100 },
      damage_mult: { type: 'real', min: 0, max: 100 },
      speed_mult: { type: 'real', min: 0, max: 10 },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  ability_status_effects: {
    pk: 'id',
    label: 'spell effect',
    note: 'on-hit slow/burn/weaken; reload to apply',
    columns: {
      ability_id: { type: 'text' },
      effect: { type: 'enum', values: ['slow', 'burn', 'weaken'] },
      duration_ms: { type: 'int', min: 0, max: 60000 },
      magnitude: { type: 'real', min: 0, max: 100000 },
    },
  },
};

// ---------------------------------------------------------------------------
// coerceColumn
// ---------------------------------------------------------------------------

/**
 * Validate and coerce a raw string for table.column. Returns a discriminated
 * result so callers can surface precise error messages to the developer.
 *
 * This is the single validation boundary for all live content edits — both the
 * `/set` command and any future tooling go through here.
 */
export function coerceColumn(
  table: string,
  column: string,
  raw: string,
): { ok: true; value: string | number | null } | { ok: false; error: string } {
  const tableSpec = EDITABLE_TABLES[table];
  if (tableSpec === undefined) {
    return { ok: false, error: `Unknown table: ${table}` };
  }

  const spec = tableSpec.columns[column];
  if (spec === undefined) {
    return { ok: false, error: `Unknown column ${column} on ${table}` };
  }

  // Nullable: the literal "null" sets SQL NULL.
  if (spec.nullable === true && raw.toLowerCase() === 'null') {
    return { ok: true, value: null };
  }

  switch (spec.type) {
    case 'color':
      if (!COLOR_RE.test(raw)) {
        return {
          ok: false,
          error: `Invalid color '${raw}': must match #RGB, #RRGGBB, or #RRGGBBAA`,
        };
      }
      return { ok: true, value: raw };

    case 'bool': {
      const lower = raw.toLowerCase();
      if (TRUE_WORDS.includes(lower)) return { ok: true, value: 1 };
      if (FALSE_WORDS.includes(lower)) return { ok: true, value: 0 };
      return {
        ok: false,
        error: `Invalid bool '${raw}': expected 1/true/on/yes or 0/false/off/no`,
      };
    }

    case 'enum': {
      const allowed = spec.values ?? [];
      if (allowed.includes(raw)) return { ok: true, value: raw };
      return {
        ok: false,
        error: `Invalid value '${raw}' for ${column}: must be one of [${allowed.join(', ')}]`,
      };
    }

    case 'int': {
      let n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n)) {
        return { ok: false, error: `Invalid integer '${raw}'` };
      }
      if (spec.min !== undefined) n = Math.max(spec.min, n);
      if (spec.max !== undefined) n = Math.min(spec.max, n);
      return { ok: true, value: n };
    }

    case 'real': {
      let n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) {
        return { ok: false, error: `Invalid number '${raw}'` };
      }
      if (spec.min !== undefined) n = Math.max(spec.min, n);
      if (spec.max !== undefined) n = Math.min(spec.max, n);
      return { ok: true, value: n };
    }

    case 'text': {
      let s = raw.trim();
      s = stripControl(s);
      if (s.length === 0) {
        return { ok: false, error: `Value for ${column} must not be empty` };
      }
      if (s.length > 80) {
        return { ok: false, error: `Value for ${column} exceeds 80-character limit` };
      }
      return { ok: true, value: s };
    }
  }
}
