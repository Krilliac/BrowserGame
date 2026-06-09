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

-- Items: equipment, loot materials, and currency, unified.
CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL,                   -- 'equip' | 'loot' | 'currency'
  slot        TEXT,                            -- equip only: 'weapon' | 'armor'
  power       REAL,
  hp          REAL,
  color       TEXT,
  sell_value  INTEGER NOT NULL DEFAULT 0
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
  attack_cooldown_ms  INTEGER NOT NULL
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
  reward_xp     INTEGER NOT NULL DEFAULT 0
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
`;
