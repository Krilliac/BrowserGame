import type { Database } from 'better-sqlite3';

/**
 * Lightweight forward migrations for content databases that predate newer columns. `CREATE TABLE IF
 * NOT EXISTS` never alters an existing table, so a `game.db` created by an older build is missing
 * columns added since (e.g. the environment-theme look fields). We add any missing column with its
 * default, so old saves keep working without a manual SQL dance. New columns added in the future:
 * append them here.
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

export function migrate(db: Database): void {
  // The area_theme table may not exist yet on a brand-new DB — SCHEMA creates it; skip if absent.
  const hasTable = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'area_theme'")
    .get();
  if (hasTable) ensureColumns(db, 'area_theme', AREA_THEME_COLUMNS);
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
