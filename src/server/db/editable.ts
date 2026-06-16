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
      element: { type: 'enum', values: ['physical', 'fire', 'cold', 'lightning', 'poison'] },
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
    note: 'on-hit ailment/CC; reload to apply',
    columns: {
      ability_id: { type: 'text' },
      effect: {
        type: 'enum',
        values: [
          'slow',
          'burn',
          'weaken',
          'ignite',
          'poison',
          'bleed',
          'chill',
          'shock',
          'brittle',
          'maim',
          'sap',
          'stun',
          'freeze',
          'silence',
          'curse',
        ],
      },
      duration_ms: { type: 'int', min: 0, max: 60000 },
      magnitude: { type: 'real', min: 0, max: 100000 },
    },
  },

  ability_cast_buffs: {
    pk: 'ability_id',
    label: 'cast buff',
    note: 'self-buff granted on cast; reload to apply',
    columns: {
      buff: { type: 'enum', values: ['might', 'haste', 'regen'] },
      duration_ms: { type: 'int', min: 0, max: 600000 },
      magnitude: { type: 'real', min: 0, max: 100000 },
    },
  },

  shrine_buffs: {
    pk: 'id',
    label: 'shrine buff',
    note: 'shrine blessing pool; reload to apply',
    columns: {
      buff: { type: 'enum', values: ['might', 'haste', 'regen'] },
      duration_ms: { type: 'int', min: 0, max: 600000 },
      magnitude: { type: 'real', min: 0, max: 100000 },
      label: { type: 'text' },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  game_config: {
    pk: 'key',
    label: 'tuning knob',
    note: 'global game-tuning overlay (e.g. difficulty.mobDamage); /reloadcontent to apply',
    columns: {
      value: { type: 'real', min: 0, max: 1_000_000_000 },
    },
  },

  dungeons: {
    pk: 'area_id',
    label: 'dungeon',
    note: 'procedural dungeon def; applies to new instances',
    columns: {
      boss: { type: 'text' },
      mini_boss: { type: 'text', nullable: true },
      mini_boss_chance: { type: 'real', min: 0, max: 1 },
      elite_chance: { type: 'real', min: 0, max: 1 },
      min_mobs: { type: 'int', min: 0, max: 1000 },
      max_mobs: { type: 'int', min: 0, max: 1000 },
    },
  },

  dungeon_pool: {
    pk: 'id',
    label: 'dungeon pool entry',
    note: 'a monster in a dungeon roster; applies to new instances',
    columns: {
      area_id: { type: 'text' },
      template_id: { type: 'text' },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  rarity_tiers: {
    pk: 'rarity',
    label: 'rarity tier',
    note: 'loot rarity weight/scaling/color; /reloadcontent to apply',
    columns: {
      name: { type: 'text' },
      weight: { type: 'real', min: 0, max: 100000 },
      stat_mult: { type: 'real', min: 0, max: 100 },
      variance: { type: 'real', min: 0, max: 1 },
      color: { type: 'color' },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  gems: {
    pk: 'id',
    label: 'gem',
    note: 'socketable gem; /reloadcontent to apply',
    columns: {
      name: { type: 'text' },
      color: { type: 'color' },
      stat: {
        type: 'enum',
        values: [
          'power',
          'hp',
          'crit',
          'multishot',
          'lifesteal',
          'swift',
          'move',
          'armor',
          'vigor',
          // Behavior-modifier stats — gem-sourced only:
          'chain',
          'pierce',
          'fork',
          'spellaoe',
        ],
      },
      value: { type: 'real', min: 0, max: 100000 },
      tier: { type: 'int', min: 1, max: 3 },
    },
  },

  runes: {
    pk: 'id',
    label: 'rune',
    note: 'a socketable rune; /reloadcontent to apply',
    columns: {
      name: { type: 'text' },
    },
  },

  runewords: {
    pk: 'id',
    label: 'runeword',
    note: 'recipe (comma-separated rune ids in order); /reloadcontent to apply',
    columns: {
      name: { type: 'text' },
      runes: { type: 'text' },
      flavor: { type: 'text', nullable: true },
    },
  },

  runeword_bonuses: {
    pk: 'id',
    label: 'runeword bonus',
    note: 'an affix a runeword grants; /reloadcontent to apply',
    columns: {
      runeword_id: { type: 'text' },
      stat: {
        type: 'enum',
        values: [
          'power',
          'hp',
          'crit',
          'multishot',
          'lifesteal',
          'swift',
          'move',
          'armor',
          'vigor',
        ],
      },
      value: { type: 'real', min: 0, max: 100000 },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  item_sets: {
    pk: 'id',
    label: 'item set',
    note: 'set membership (comma-separated base item ids); /reloadcontent to apply',
    columns: {
      name: { type: 'text' },
      pieces: { type: 'text' },
      flavor: { type: 'text', nullable: true },
    },
  },

  item_set_bonuses: {
    pk: 'id',
    label: 'item set bonus',
    note: 'a buff a set grants at a piece-count threshold; /reloadcontent to apply',
    columns: {
      set_id: { type: 'text' },
      required_pieces: { type: 'int', min: 2, max: 99 },
      stat: {
        type: 'enum',
        values: [
          'power',
          'hp',
          'crit',
          'multishot',
          'lifesteal',
          'swift',
          'move',
          'armor',
          'vigor',
        ],
      },
      value: { type: 'real', min: 0, max: 100000 },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  crafting_recipes: {
    pk: 'id',
    label: 'crafting recipe',
    note: 'a recipe header; edit its inputs/outputs in crafting_recipe_io; /reloadcontent to apply',
    columns: {
      name: { type: 'text' },
    },
  },

  crafting_recipe_io: {
    pk: 'id',
    label: 'crafting recipe i/o',
    note: 'one input/output line of a recipe; /reloadcontent to apply',
    columns: {
      recipe_id: { type: 'text' },
      role: { type: 'enum', values: ['input', 'output'] },
      item_id: { type: 'text' },
      qty: { type: 'int', min: 1, max: 9999 },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  rift_modifiers: {
    pk: 'id',
    label: 'rift modifier',
    note: 'a D3-style rift mutator (multipliers/bonuses); /reloadcontent to apply',
    columns: {
      name: { type: 'text' },
      descr: { type: 'text' },
      min_tier: { type: 'int', min: 0, max: 100 },
      mob_damage_mult: { type: 'real', min: 0, max: 100 },
      mob_hp_mult: { type: 'real', min: 0, max: 100 },
      mob_speed_mult: { type: 'real', min: 0, max: 100 },
      loot_quantity_bonus: { type: 'real', min: 0, max: 100 },
      xp_bonus: { type: 'real', min: 0, max: 100 },
    },
  },

  game_events: {
    pk: 'id',
    label: 'game event',
    note: 'a timed recurring liveops event (period/length in minutes); /reloadcontent to apply',
    columns: {
      name: { type: 'text' },
      period_min: { type: 'int', min: 1, max: 100000 },
      length_min: { type: 'int', min: 1, max: 100000 },
      xp_bonus: { type: 'real', min: 0, max: 100, nullable: true },
      announce: { type: 'text', nullable: true },
    },
  },

  mob_resists: {
    pk: 'id',
    label: 'mob resistance',
    note: 'per-element damage resistance for a mob template (1=immune, negative=vulnerable); /reloadcontent to apply',
    columns: {
      template_id: { type: 'text' },
      element: { type: 'enum', values: ['physical', 'fire', 'cold', 'lightning', 'poison'] },
      value: { type: 'real', min: -1, max: 1 },
    },
  },

  item_procs: {
    pk: 'id',
    label: 'item proc',
    note: 'a chance-on-hit/crit effect a base item grants; /reloadcontent to apply',
    columns: {
      source_id: { type: 'text' },
      trigger: { type: 'enum', values: ['onHit', 'onCrit'] },
      chance: { type: 'real', min: 0, max: 1 },
      icd_ms: { type: 'int', min: 0, max: 600000 },
      effect: { type: 'enum', values: ['damage', 'status'] },
      amount: { type: 'real', min: 0, max: 100000, nullable: true },
      ability: { type: 'text', nullable: true },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  mob_script_phases: {
    pk: 'id',
    label: 'boss script phase',
    note: 'a boss phase (active while hp/maxHp < hp_below); /reloadcontent to apply',
    columns: {
      template_id: { type: 'text' },
      hp_below: { type: 'real', min: 0, max: 1 },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  mob_script_steps: {
    pk: 'id',
    label: 'boss script step',
    note: 'one step of a boss phase loop; only the columns for its kind are used; /reloadcontent to apply',
    columns: {
      phase_id: { type: 'int', min: 1, max: 9999999 },
      sort_order: { type: 'int', min: 0, max: 9999 },
      kind: { type: 'enum', values: ['moveTo', 'wait', 'brawl', 'cast', 'summon', 'shout'] },
      x: { type: 'real', min: 0, max: 1, nullable: true },
      y: { type: 'real', min: 0, max: 1, nullable: true },
      speed_mult: { type: 'real', min: 0, max: 10, nullable: true },
      ms: { type: 'int', min: 0, max: 600000, nullable: true },
      ability: { type: 'text', nullable: true },
      summon_template: { type: 'text', nullable: true },
      summon_count: { type: 'int', min: 0, max: 99, nullable: true },
      summon_radius: { type: 'real', min: 0, max: 4000, nullable: true },
      text: { type: 'text', nullable: true },
    },
  },

  uniques: {
    pk: 'id',
    label: 'unique item',
    note: 'named legendary; /reloadcontent to apply',
    columns: {
      name: { type: 'text' },
      base_id: { type: 'text' },
      flavor: { type: 'text', nullable: true },
    },
  },

  unique_affixes: {
    pk: 'id',
    label: 'unique affix',
    note: 'a fixed affix on a unique; /reloadcontent to apply',
    columns: {
      unique_id: { type: 'text' },
      stat: {
        type: 'enum',
        values: [
          'power',
          'hp',
          'crit',
          'multishot',
          'lifesteal',
          'swift',
          'move',
          'armor',
          'vigor',
        ],
      },
      value: { type: 'real', min: 0, max: 100000 },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  affix_ranges: {
    pk: 'stat',
    label: 'affix range',
    note: 'affix roll range; /reloadcontent to apply',
    columns: {
      min_value: { type: 'real', min: 0, max: 100000 },
      max_value: { type: 'real', min: 0, max: 100000 },
    },
  },

  affix_names: {
    pk: 'stat',
    label: 'affix name',
    note: 'where an affix sits in the title; /reloadcontent to apply',
    columns: {
      kind: { type: 'enum', values: ['prefix', 'suffix'] },
    },
  },

  affix_name_tiers: {
    pk: 'id',
    label: 'affix name tier',
    note: 'tiered word for an affix (up_to NULL = top tier); /reloadcontent to apply',
    columns: {
      stat: { type: 'text' },
      up_to: { type: 'real', min: 0, max: 1000000, nullable: true },
      word: { type: 'text' },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  skill_nodes: {
    pk: 'id',
    label: 'skill node',
    note: 'passive talent; /reloadcontent to apply',
    columns: {
      name: { type: 'text' },
      desc: { type: 'text' },
      tier: { type: 'int', min: 0, max: 99 },
    },
  },

  skill_node_requires: {
    pk: 'id',
    label: 'skill prereq',
    note: 'a node prerequisite; /reloadcontent to apply',
    columns: {
      node_id: { type: 'text' },
      requires_id: { type: 'text' },
      sort_order: { type: 'int', min: 0, max: 9999 },
    },
  },

  skill_node_effects: {
    pk: 'id',
    label: 'skill effect',
    note: 'a stat a node grants; /reloadcontent to apply',
    columns: {
      node_id: { type: 'text' },
      effect: {
        type: 'enum',
        values: [
          'power',
          'critPct',
          'maxHpPct',
          'lifestealPct',
          'swiftPct',
          'movePct',
          'armorPct',
          'vigor',
          'manaRegen',
          'multishot',
        ],
      },
      value: { type: 'real', min: -100000, max: 100000 },
    },
  },

  hireling_templates: {
    pk: 'type',
    label: 'hireling',
    note: 'mercenary template; applies to newly hired mercs',
    columns: {
      name: { type: 'text' },
      behavior: { type: 'enum', values: ['melee', 'ranged'] },
      speed: { type: 'real', min: 0, max: 2000 },
      attack_range: { type: 'real', min: 0, max: 2000 },
      kite_range: { type: 'real', min: 0, max: 2000, nullable: true },
      attack_cooldown_ms: { type: 'int', min: 0, max: 60000 },
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
