/**
 * SQLite schema for all game content. This database is the source of truth for the backend:
 * areas, portals, spells (abilities), items, monsters, their spawns, loot, NPCs, and quests.
 * Editing the rows (e.g. with the `sqlite3` CLI or any DB browser) changes the game — the
 * server loads this content at startup. Gameplay stays server-authoritative.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS areas (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  spawn_x     INTEGER NOT NULL,
  spawn_y     INTEGER NOT NULL,
  player_cap  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS portals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id     TEXT NOT NULL REFERENCES areas(id),
  rect_x      INTEGER NOT NULL,
  rect_y      INTEGER NOT NULL,
  rect_w      INTEGER NOT NULL,
  rect_h      INTEGER NOT NULL,
  to_area     TEXT NOT NULL,
  to_spawn_x  INTEGER NOT NULL,
  to_spawn_y  INTEGER NOT NULL,
  label       TEXT NOT NULL
);

-- Per-area environment THEME: the data-driven *look* of an area. The client renders ground,
-- props, mood tint, ambient particles, weather, and lighting entirely from these rows, so editing
-- them (via SQL or the /settheme dev command) re-skins the world live. Colors are CSS hex strings.
-- Column names match the keys in src/shared/theme.ts (THEME_KEYS).
CREATE TABLE IF NOT EXISTS area_theme (
  area_id           TEXT PRIMARY KEY REFERENCES areas(id),
  ground_base       TEXT NOT NULL DEFAULT '#1f2a1c',
  ground_speck      TEXT NOT NULL DEFAULT '#27331f',
  prop              TEXT NOT NULL DEFAULT 'tree',     -- 'tree' | 'grave' | 'rock' | 'none'
  prop_density      REAL NOT NULL DEFAULT 0.08,
  atmo_color        TEXT NOT NULL DEFAULT '#4a6a4a',
  atmo_alpha        REAL NOT NULL DEFAULT 0.1,
  outdoor           INTEGER NOT NULL DEFAULT 1,       -- 1 = day/night cycle applies
  particle_color    TEXT NOT NULL DEFAULT '#bfff8a',
  particle_count    INTEGER NOT NULL DEFAULT 40,
  particle_rise     REAL NOT NULL DEFAULT -6,         -- px/s vertical drift (negative rises)
  particle_flicker  INTEGER NOT NULL DEFAULT 1,
  weather           TEXT NOT NULL DEFAULT 'none',     -- 'none' | 'rain' | 'snow' | 'fog'
  weather_intensity REAL NOT NULL DEFAULT 0.5,
  fog_color         TEXT NOT NULL DEFAULT '#8a93a0',
  light_ambient     REAL NOT NULL DEFAULT 1,           -- 0..1 baseline ambient light
  grade_saturation  REAL NOT NULL DEFAULT 1,           -- color grading (1 = unchanged)
  grade_brightness  REAL NOT NULL DEFAULT 1,
  grade_contrast    REAL NOT NULL DEFAULT 1,
  sprite_tint       TEXT NOT NULL DEFAULT '#ffffff'    -- cohesive actor tint (#ffffff = none)
);

-- Spells / abilities.
CREATE TABLE IF NOT EXISTS abilities (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  key                TEXT NOT NULL,
  kind               TEXT NOT NULL,            -- 'melee' | 'projectile' | 'heal'
  damage             REAL NOT NULL,
  range              REAL NOT NULL,
  cooldown_ms        INTEGER NOT NULL,
  mana_cost          INTEGER NOT NULL,
  color              TEXT NOT NULL,
  melee_half_angle   REAL,
  projectile_speed   REAL,
  projectile_ttl_ms  INTEGER,
  radius             REAL NOT NULL,
  sort_order         INTEGER NOT NULL
);

-- Items: equipment, loot materials, currency, and spellbooks, unified.
CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,                   -- 'equip' | 'loot' | 'currency' | 'spellbook'
  slot        TEXT,                            -- equip only: 'weapon' | 'armor'
  power       REAL,
  hp          REAL,
  color       TEXT,
  sell_value  INTEGER NOT NULL DEFAULT 0,
  teaches     TEXT                             -- spellbook only: the ability id it teaches
);

-- What a vendor NPC sells, keyed by area + NPC name (NPC row ids are autoincrement, names are
-- the stable handle). Edit rows live (e.g. /set) to change a shop's shelf.
CREATE TABLE IF NOT EXISTS vendor_stock (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id     TEXT NOT NULL,
  npc_name    TEXT NOT NULL,
  item_id     TEXT NOT NULL REFERENCES items(id),
  price       INTEGER NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mob_templates (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  hp                  INTEGER NOT NULL,
  level               INTEGER NOT NULL,
  hue                 REAL NOT NULL,
  speed               REAL NOT NULL,
  aggro_range         REAL NOT NULL,
  attack_range        REAL NOT NULL,
  damage              REAL NOT NULL,
  attack_cooldown_ms  INTEGER NOT NULL,
  behavior            TEXT NOT NULL DEFAULT 'melee',
  telegraph_ms        INTEGER NOT NULL DEFAULT 0,
  projectile_speed    REAL,
  kite_range          REAL,
  slam_radius         REAL,
  dash_speed          REAL
);

CREATE TABLE IF NOT EXISTS area_mobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id      TEXT NOT NULL,
  template_id  TEXT NOT NULL REFERENCES mob_templates(id),
  count        INTEGER NOT NULL
);

-- Per-monster drop table: each row is one possible drop. (Loaded into the existing
-- weighted drop-table engine; the rolling logic lives in code.)
CREATE TABLE IF NOT EXISTS loot_entry (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  mob_template_id  TEXT NOT NULL,
  grp              TEXT NOT NULL,              -- 'always' | 'main' | 'rare' | 'gear'
  item_id          TEXT NOT NULL,
  weight           REAL NOT NULL DEFAULT 1,
  min_qty          INTEGER NOT NULL DEFAULT 1,
  max_qty          INTEGER NOT NULL DEFAULT 1,
  is_nothing  INTEGER NOT NULL DEFAULT 0, -- 1 = a "no drop" slot in a weighted roll
  chance           REAL NOT NULL DEFAULT 0     -- trigger chance for 'rare'/'gear' groups
);

CREATE TABLE IF NOT EXISTS npcs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id  TEXT NOT NULL,
  name     TEXT NOT NULL,
  x        INTEGER NOT NULL,
  y        INTEGER NOT NULL,
  hue      REAL NOT NULL,
  kind     TEXT NOT NULL                       -- 'vendor'
);

CREATE TABLE IF NOT EXISTS quests (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  target_mob    TEXT,
  target_count  INTEGER NOT NULL DEFAULT 0,
  reward_gold   INTEGER NOT NULL DEFAULT 0,
  reward_xp     INTEGER NOT NULL DEFAULT 0,
  reward_item   TEXT                           -- optional item granted on completion (e.g. a tome)
);

-- Accounts: username -> access level (Player 0 .. Developer 4), with a salted password hash.
-- Used to gate GM/admin/dev chat commands. Players are guests (level 0) until they /login.
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  access_level  INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  salt          TEXT,
  created_at    TEXT
);

-- Persistent character saves keyed by an opaque per-client token (stored in the browser). Lets a
-- returning guest reload their character across disconnects and server restarts. The full
-- PlayerSave is stored as JSON in the data column; the server is the sole writer.
CREATE TABLE IF NOT EXISTS player_saves (
  token      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
