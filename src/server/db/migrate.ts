import type { Database } from 'better-sqlite3';

/**
 * Forward migrations for content databases, run as an ordered, version-gated chain (Diesel/Veloren
 * style). `CREATE TABLE IF NOT EXISTS` in SCHEMA never alters an existing table, so a `game.db` from
 * an older build is missing columns added since. Each migration declares a `version`; on open we read
 * the DB's `PRAGMA user_version`, run every migration newer than that in its own transaction, then
 * stamp the new version — so each migration runs AT MOST ONCE per database.
 *
 * Migration #1 is the historical "add any missing column" sweep — its operations are idempotent
 * (add-if-missing), so it is safe on a brand-new DB (SCHEMA already made the columns) and on a partly
 * upgraded one. FUTURE non-idempotent transforms (renames, backfills, splits) get the real benefit:
 * append a new entry with the next version and a one-shot `up(db)`; user_version guarantees exactly-
 * once execution. Never edit a shipped migration's version or body — only append.
 */
const AREA_THEME_COLUMNS: Record<string, string> = {
  ground_base: "TEXT NOT NULL DEFAULT '#1f2a1c'",
  ground_speck: "TEXT NOT NULL DEFAULT '#27331f'",
  prop: "TEXT NOT NULL DEFAULT 'tree'",
  prop_density: 'REAL NOT NULL DEFAULT 0.08',
  atmo_color: "TEXT NOT NULL DEFAULT '#4a6a4a'",
  atmo_alpha: 'REAL NOT NULL DEFAULT 0.1',
  outdoor: 'INTEGER NOT NULL DEFAULT 1',
  particle_color: "TEXT NOT NULL DEFAULT '#bfff8a'",
  particle_count: 'INTEGER NOT NULL DEFAULT 40',
  particle_rise: 'REAL NOT NULL DEFAULT -6',
  particle_flicker: 'INTEGER NOT NULL DEFAULT 1',
  weather: "TEXT NOT NULL DEFAULT 'none'",
  weather_intensity: 'REAL NOT NULL DEFAULT 0.5',
  fog_color: "TEXT NOT NULL DEFAULT '#8a93a0'",
  light_ambient: 'REAL NOT NULL DEFAULT 1',
  grade_saturation: 'REAL NOT NULL DEFAULT 1',
  grade_brightness: 'REAL NOT NULL DEFAULT 1',
  grade_contrast: 'REAL NOT NULL DEFAULT 1',
  sprite_tint: "TEXT NOT NULL DEFAULT '#ffffff'",
};

/** Monster archetype columns added for enemy variety (ranged attackers + attack telegraphs). */
const MOB_TEMPLATE_COLUMNS: Record<string, string> = {
  behavior: "TEXT NOT NULL DEFAULT 'melee'",
  telegraph_ms: 'INTEGER NOT NULL DEFAULT 0',
  projectile_speed: 'REAL',
  kite_range: 'REAL',
  slam_radius: 'REAL',
  dash_speed: 'REAL',
};

/** Elemental damage: abilities carry a damage school (defaults to physical for old content). */
const ABILITIES_COLUMNS: Record<string, string> = {
  element: "TEXT NOT NULL DEFAULT 'physical'",
};

/** Spellbook era: items can teach an ability; quests can reward an item. */
const ITEMS_COLUMNS: Record<string, string> = { teaches: 'TEXT' };
/** Quest rewards + the collect/turn-in quest type. */
const QUESTS_COLUMNS: Record<string, string> = {
  reward_item: 'TEXT',
  turn_in_item: 'TEXT',
  turn_in_count: 'INTEGER NOT NULL DEFAULT 0',
};

/** One ordered, version-gated migration. `up` runs once when the DB's user_version is below `version`. */
interface Migration {
  version: number;
  name: string;
  up(db: Database): void;
}

/**
 * The migration chain, in ascending version order. APPEND ONLY — never renumber or rewrite a shipped
 * entry (databases in the wild have already recorded which versions they ran).
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'ensure-base-columns',
    up(db) {
      // Idempotent column backfill — safe on a fresh DB (columns already exist) or a partial upgrade.
      if (hasTable(db, 'area_theme')) ensureColumns(db, 'area_theme', AREA_THEME_COLUMNS);
      if (hasTable(db, 'mob_templates')) ensureColumns(db, 'mob_templates', MOB_TEMPLATE_COLUMNS);
      if (hasTable(db, 'abilities')) ensureColumns(db, 'abilities', ABILITIES_COLUMNS);
      if (hasTable(db, 'items')) ensureColumns(db, 'items', ITEMS_COLUMNS);
      if (hasTable(db, 'quests')) ensureColumns(db, 'quests', QUESTS_COLUMNS);
    },
  },
  {
    version: 2,
    name: 'game-events-gold-bonus',
    up(db) {
      // Timed events gained a gold-drop bonus (e.g. Golden Hour). Add the nullable column to old DBs.
      if (hasTable(db, 'game_events')) ensureColumns(db, 'game_events', { gold_bonus: 'REAL' });
    },
  },
  {
    version: 3,
    name: 'ability-behaviors',
    up(db) {
      // Spell-behavior engine: abilities carry a JSON behavior list (chain/pierce/fork/splash/homing/
      // multishot/return), seeded into behaviors_json. Add the nullable column to old DBs.
      if (hasTable(db, 'abilities')) ensureColumns(db, 'abilities', { behaviors_json: 'TEXT' });
    },
  },
  {
    version: 4,
    name: 'gem-modifier-fields',
    up(db) {
      // Support gems carry a damage-tradeoff multiplier (mult) and a homing flag (grants_homing).
      // Both default to their neutral values so all existing gem rows behave identically to before.
      if (hasTable(db, 'gems'))
        ensureColumns(db, 'gems', {
          mult: 'REAL NOT NULL DEFAULT 1',
          grants_homing: 'INTEGER NOT NULL DEFAULT 0',
        });
    },
  },
  {
    version: 5,
    name: 'explore-quest-type',
    up(db) {
      // Explore/discover quests complete on visiting a target area. Add the nullable column to old
      // DBs; existing kill/collect quests leave it NULL and behave identically to before.
      if (hasTable(db, 'quests')) ensureColumns(db, 'quests', { explore_area: 'TEXT' });
    },
  },
  {
    version: 6,
    name: 'chain-quest-prereq',
    up(db) {
      // Chain quests gain a `requires` prerequisite quest id. Nullable: existing quests have no
      // prerequisite and stay immediately available, exactly as before.
      if (hasTable(db, 'quests')) ensureColumns(db, 'quests', { requires: 'TEXT' });
    },
  },
  {
    version: 7,
    name: 'elite-death-explosion',
    up(db) {
      // Elite modifiers gain a death-explosion multiplier (the Volatile affix). Defaults to 0 so
      // every existing modifier keeps behaving exactly as before (no blast).
      if (hasTable(db, 'elite_modifiers'))
        ensureColumns(db, 'elite_modifiers', { explode_dmg: 'REAL NOT NULL DEFAULT 0' });
    },
  },
  {
    version: 8,
    name: 'summonable-creatures',
    up(db) {
      // Creatures gain a `summonable` flag so any of them can be raised as a friendly minion by a
      // summon ability. Defaults to 0 — existing creatures are not summonable unless flagged.
      if (hasTable(db, 'mob_templates'))
        ensureColumns(db, 'mob_templates', { summonable: 'INTEGER NOT NULL DEFAULT 0' });
    },
  },
];

/** The newest migration version this build knows about (0 if there are none). */
export const LATEST_DB_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.version), 0);

/**
 * Bring a content DB up to date: run every migration newer than its recorded `user_version`, each in
 * its own transaction, stamping the version after each so a crash mid-chain resumes cleanly. Already-
 * current (or newer, e.g. opened by a future build) DBs are left untouched.
 */
export function migrate(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      m.up(db);
      // version is a trusted code constant (never user input) — safe to inline.
      db.pragma(`user_version = ${m.version}`);
    })();
  }
}

function hasTable(db: Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

/** Add any missing columns to a table. Table/column names are constants here (never user input). */
function ensureColumns(db: Database, table: string, columns: Record<string, string>): void {
  const existing = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name),
  );
  for (const [name, ddl] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
  }
}
