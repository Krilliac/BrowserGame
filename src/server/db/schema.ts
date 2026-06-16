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
  behaviors_json     TEXT,
  radius             REAL NOT NULL,
  element            TEXT NOT NULL DEFAULT 'physical',  -- damage school (physical|fire|cold|lightning|poison)
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
  teaches     TEXT,                            -- spellbook only: the ability id it teaches
  flags       INTEGER NOT NULL DEFAULT 0,      -- bitmask (ItemFlags): LEGENDARY, …
  base_id     TEXT,                            -- legendaries: the base item they are built on
  affixes     TEXT,                            -- legendaries: JSON array of { stat, value }
  flavor      TEXT                             -- legendaries: tooltip flavor line
);

-- Procedural dungeon population: the random pack pool + boss + elite/mini-boss chances for each
-- dungeon area. DB-driven balance content (mirrors DUNGEONS in shared/areas.ts, which stays as the
-- structural isDungeon metadata + the seed source). Edit rows to retune a dungeon's roster.
CREATE TABLE IF NOT EXISTS dungeons (
  area_id          TEXT PRIMARY KEY,
  pool             TEXT NOT NULL,              -- JSON array of regular monster template ids
  boss             TEXT NOT NULL,
  mini_boss        TEXT,
  mini_boss_chance REAL NOT NULL DEFAULT 0,
  elite_chance     REAL NOT NULL DEFAULT 0,
  min_mobs         INTEGER NOT NULL,
  max_mobs         INTEGER NOT NULL
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
  dash_speed          REAL,
  spell               TEXT,                    -- caster: ability id cast in place of the basic attack
  support             TEXT,                    -- support caster: self buff/heal ability id
  traits              TEXT                     -- JSON array of personality traits (pack/craven/…)
);

-- Individual creature SPAWNS: one row = one placed monster (uid/guid), referencing its
-- mob_templates entry, at a fixed position, with per-spawn flags (e.g. forced ELITE). This is the
-- template-vs-spawn split: area_mobs is the count-based random scatter; this is explicit, addressable
-- placement (a named guardian at a fixed spot, etc.). Empty by default — add rows via SQL.
CREATE TABLE IF NOT EXISTS creature_spawns (
  uid         INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id     TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES mob_templates(id),
  x           INTEGER NOT NULL,
  y           INTEGER NOT NULL,
  flags       INTEGER NOT NULL DEFAULT 0        -- bitmask (CreatureSpawnFlags): ELITE, …
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
  kind     TEXT NOT NULL,                      -- primary role + sprite, e.g. 'vendor'
  npc_flags INTEGER NOT NULL DEFAULT 0         -- bitmask (NpcFlags): VENDOR|QUESTGIVER|… services
);

-- Static set-dressing PROPS per area: cosmetic objects (tents, wagons, a palisade wall, a bonfire,
-- torches, crates…) the client renders with the same 2.5D projection as actors. The placements are
-- authoritative SQL data so the town is SERVER-defined, not hardcoded in the client — edit these
-- rows (or add rows for other areas) to redress the world. Line props (palisade/fence) use the
-- optional x2/y2 second endpoint; color/scale are optional per-prop overrides (NULL = renderer default).
CREATE TABLE IF NOT EXISTS decor (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id  TEXT NOT NULL,
  kind     TEXT NOT NULL,                      -- 'palisade'|'gate'|'bonfire'|'tent'|'wagon'|'anvil'|'crate'|'barrel'|'torch'|'hay'
  x        REAL NOT NULL,
  y        REAL NOT NULL,
  x2       REAL,                               -- line props (palisade/fence): far endpoint
  y2       REAL,
  color    TEXT,                               -- optional cloth/wood tint (CSS hex)
  scale    REAL                                -- optional size multiplier (1 = default)
);

-- SQL-settable SPRITE COLOR OVERRIDES: multiply-tint any rendered source without touching the
-- image files, so one sprite spawns many variations (and the whole game can lean dark/gritty).
-- target selects what gets tinted: 'mob:<template_id>' | 'npc:<kind>' | 'hireling:<type>' |
-- 'decor:<kind>'. tint is a CSS #rrggbb multiplied over the sprite (#ffffff = unchanged;
-- darker/desaturated hexes give the Diablo-ish gritty look). Live-edit via /set sprite_tints
-- <target> tint <hex> (+ /reloadcontent) — no client change needed.
CREATE TABLE IF NOT EXISTS sprite_tints (
  target  TEXT PRIMARY KEY,
  tint    TEXT NOT NULL
);

-- Per-ability ON-HIT status effects: a spell can chill (slow), ignite (burn = damage-over-time), or
-- curse (weaken = reduced outgoing damage) what it strikes. One row per (ability, effect); an ability
-- may carry several. Seeded from ability-effects.ts; magnitude is the factor (slow/weaken) or the
-- per-tick damage (burn). Edit a row to retune a spell's utility without a recompile.
CREATE TABLE IF NOT EXISTS ability_status_effects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ability_id  TEXT NOT NULL,
  effect      TEXT NOT NULL,            -- 'slow' | 'burn' | 'weaken' (maps to a StatusId)
  duration_ms INTEGER NOT NULL,
  magnitude   REAL NOT NULL,
  UNIQUE (ability_id, effect)
);

-- Hireling templates: the mercenary roster a player hires from the Recruiter. Seeded from
-- DEFAULT_HIRELING_TEMPLATES (hirelings.ts); server-only (the AI reads these). Add a row for a new
-- mercenary type. kite_range is ranged-only (NULL for melee).
CREATE TABLE IF NOT EXISTS hireling_templates (
  type               TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  behavior           TEXT NOT NULL,     -- 'melee' | 'ranged'
  speed              REAL NOT NULL,
  attack_range       REAL NOT NULL,
  kite_range         REAL,              -- ranged only (NULL = none)
  attack_cooldown_ms INTEGER NOT NULL
);

-- Passive skill-tree nodes: a talent the player allocates a point into. Seeded from
-- DEFAULT_SKILL_TREE (skilltree.ts); the server folds allocated nodes' effects into stats and the
-- client renders the tree from the content packet. Prereqs + effects are separate child tables.
CREATE TABLE IF NOT EXISTS skill_nodes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  desc TEXT NOT NULL,
  tier INTEGER NOT NULL                 -- 0 = always available; deeper tiers gate on requires
);

-- A skill node's prerequisites: every requires_id must be allocated before the node unlocks.
CREATE TABLE IF NOT EXISTS skill_node_requires (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id     TEXT NOT NULL,
  requires_id TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- A skill node's granted effects: one row per (node, effect-key). Keys are SkillEffects fields
-- (power, critPct, maxHpPct, lifestealPct, swiftPct, movePct, armorPct, vigor, manaRegen, multishot).
CREATE TABLE IF NOT EXISTS skill_node_effects (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  effect  TEXT NOT NULL,
  value   REAL NOT NULL
);

-- Affix roll ranges: the pre-rarity-scaling base value range per scalar affix stat. Server-only
-- (rollAffixes reads them). Seeded from DEFAULT_AFFIX_RANGES (items.ts).
CREATE TABLE IF NOT EXISTS affix_ranges (
  stat      TEXT PRIMARY KEY,           -- a rollable AffixStat (excl. multishot, handled specially)
  min_value REAL NOT NULL,
  max_value REAL NOT NULL
);

-- Affix flavor names: where an affix sits in the item title (prefix/suffix). Seeded from
-- DEFAULT_AFFIX_NAMES (items.ts); shipped to the client so item titles compose from DB data.
CREATE TABLE IF NOT EXISTS affix_names (
  stat TEXT PRIMARY KEY,                -- an AffixStat
  kind TEXT NOT NULL                    -- 'prefix' | 'suffix'
);

-- The tiered word per affix name: ascending value thresholds -> the word used at that tier. up_to is
-- the inclusive upper bound for that tier; NULL means "no upper bound" (Infinity, the top tier).
CREATE TABLE IF NOT EXISTS affix_name_tiers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  stat       TEXT NOT NULL,
  up_to      REAL,                      -- NULL = Infinity (top tier)
  word       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Runes: the socketable atoms players slot to build runewords. Seeded from DEFAULT_RUNES
-- (runewords.ts); also registered as content items so the client shows their name/icon.
CREATE TABLE IF NOT EXISTS runes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Runewords: a named recipe (an ordered rune sequence) that grants bonus affixes when those runes
-- fill the start of an item's sockets in order. runes is the comma-separated ordered rune-id list.
-- Detection + bonus application are server-side; seeded from DEFAULT_RUNEWORDS (runewords.ts).
CREATE TABLE IF NOT EXISTS runewords (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  runes  TEXT NOT NULL,                 -- ordered rune ids, comma-separated (e.g. 'rune_el,rune_tir')
  flavor TEXT
);

-- The affix bonuses a runeword grants when active. One row per (runeword, stat).
CREATE TABLE IF NOT EXISTS runeword_bonuses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  runeword_id  TEXT NOT NULL,
  stat         TEXT NOT NULL,           -- a buff AffixStat
  value        REAL NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0
);

-- Item sets: equipping multiple pieces of one set grants threshold bonuses (D2-style set items).
-- pieces is the comma-separated base item-id membership; the bonuses live in item_set_bonuses.
-- Seeded from DEFAULT_ITEM_SETS (item-sets.ts); applied server-side in recomputeStats (world.ts).
CREATE TABLE IF NOT EXISTS item_sets (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  pieces TEXT NOT NULL,                 -- comma-separated base item ids that count toward the set
  flavor TEXT
);

-- A bonus a set grants once required_pieces of its pieces are equipped. One row per (set, threshold, stat).
CREATE TABLE IF NOT EXISTS item_set_bonuses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id          TEXT NOT NULL,
  required_pieces INTEGER NOT NULL,
  stat            TEXT NOT NULL,        -- a buff AffixStat
  value           REAL NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

-- Scripted boss phases (TrinityCore smart_scripts, cut to essentials): the DATA half of the apex-boss
-- action queue. The executor + step vocabulary stay in code (boss-scripts.ts); only the phase/step
-- data lives here, so designers can re-tune fights or add a scripted boss without touching the sim.
-- One row per (boss, phase); the phase is active while hp/maxHp < hp_below (last match wins).
CREATE TABLE IF NOT EXISTS mob_script_phases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL,            -- the boss MOB_TEMPLATES id
  hp_below    REAL NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- The ordered steps of a phase loop. kind is a closed BossStep enum; only the columns relevant to
-- that kind are set (the rest are NULL): moveTo->x,y,speed_mult; wait/brawl->ms; cast->ability;
-- summon->summon_template,summon_count,summon_radius; shout->text. Malformed rows are skipped on load.
CREATE TABLE IF NOT EXISTS mob_script_steps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id        INTEGER NOT NULL,     -- -> mob_script_phases.id
  sort_order      INTEGER NOT NULL DEFAULT 0,
  kind            TEXT NOT NULL,        -- moveTo|wait|brawl|cast|summon|shout
  x               REAL,
  y               REAL,
  speed_mult      REAL,
  ms              INTEGER,
  ability         TEXT,
  summon_template TEXT,
  summon_count    INTEGER,
  summon_radius   REAL,
  text            TEXT
);

-- Item procs: a chance-on-hit/crit effect a base item grants while equipped (Diablo proc / Flare
-- passive_trigger). The roll + internal-cooldown logic is pure code (item-procs.ts); only the proc
-- data lives here. effect 'damage' uses amount; effect 'status' uses ability (whose on-hit status
-- is applied). Seeded from DEFAULT_ITEM_PROCS; the World applies fired effects with a recursion guard.
CREATE TABLE IF NOT EXISTS item_procs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id  TEXT NOT NULL,            -- base item id that carries the proc
  trigger    TEXT NOT NULL,            -- onHit | onCrit
  chance     REAL NOT NULL DEFAULT 1,  -- 0..1 probability when eligible + off cooldown
  icd_ms     INTEGER NOT NULL DEFAULT 0,
  effect     TEXT NOT NULL,            -- damage | status
  amount     REAL,                     -- damage procs: bonus damage dealt
  ability    TEXT,                     -- status procs: ability whose on-hit status to apply
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Mob resistances: per-element damage reduction for a monster template (Flare trait_elemental).
-- Sparse — only non-zero resists get a row; a missing element means 0 (no resistance). value is a
-- fraction: 1 = immune, 0.5 = halves it, negative = vulnerable. Applied server-side at the hit site.
CREATE TABLE IF NOT EXISTS mob_resists (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL,
  element     TEXT NOT NULL,           -- fire | cold | lightning | poison | physical
  value       REAL NOT NULL
);

-- Gems: the socketable catalog. Each gem grants a flat bonus to one affix stat. Seeded from
-- DEFAULT_GEMS (gems.ts); overlaid onto the shared GEMS catalog on both sides (server load + content
-- packet). Add a row to introduce a new gem; tier drives the combine chain + drop weight (in code).
CREATE TABLE IF NOT EXISTS gems (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  color        TEXT NOT NULL,
  stat         TEXT NOT NULL,           -- an AffixStat (power|hp|crit|...|chain|pierce|fork|spellaoe)
  value        REAL NOT NULL,
  tier         INTEGER NOT NULL,        -- 1..3 (chipped → flawless)
  mult         REAL NOT NULL DEFAULT 1, -- spell-damage multiplier (support gems carry < 1 as a tradeoff)
  grants_homing INTEGER NOT NULL DEFAULT 0  -- 1 = seeking/homing projectile behaviour
);

-- Item rarity tiers: drop weight, stat multiplier, roll variance, and display color per rarity.
-- Seeded from DEFAULT_RARITY (items.ts); the server overlays these onto the shared RARITY table at
-- load and ships them to the client in the content packet. weight 0 = never weighted-rolled
-- (corrupted/unique are minted by their own systems). Edit to retune loot rarity without a recompile.
CREATE TABLE IF NOT EXISTS rarity_tiers (
  rarity     TEXT PRIMARY KEY,           -- 'common'|'magic'|'rare'|'epic'|'legendary'|'corrupted'|'unique'
  name       TEXT NOT NULL,
  weight     REAL NOT NULL,
  stat_mult  REAL NOT NULL,
  variance   REAL NOT NULL,
  color      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Global game-tuning overlay (TrinityCore-style world settings): a key/value table of numeric
-- gameplay knobs. key is a dotted config path (e.g. 'difficulty.mobDamage', 'drops.gemBoss') and
-- value overrides the code default in config.ts at load. Only whitelisted GAMEPLAY sections are
-- seeded here — server plumbing and secrets (ports, tokens, paths) deliberately never live in the DB.
-- Edit a row + restart (or /reloadcontent) to rebalance difficulty/economy/drops without a recompile.
CREATE TABLE IF NOT EXISTS game_config (
  key   TEXT PRIMARY KEY,
  value REAL NOT NULL
);

-- Self-buff a spell grants its caster (player War Cry / Sprint / Renew; mob heal-spells). One buff
-- per ability. buff is a StatusId ('might'|'haste'|'regen'); magnitude is the buff strength.
-- Seeded from ability-effects.ts; edit to retune spell utility.
CREATE TABLE IF NOT EXISTS ability_cast_buffs (
  ability_id  TEXT PRIMARY KEY,
  buff        TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  magnitude   REAL NOT NULL
);

-- Shrine blessing pool: stepping on a charged shrine grants one of these at random (stronger and
-- longer than a buff spell). buff is a StatusId; label is the player-facing blessing message.
-- sort_order fixes the deterministic pick order. Seeded from ability-effects.ts.
CREATE TABLE IF NOT EXISTS shrine_buffs (
  id          TEXT PRIMARY KEY,
  buff        TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  magnitude   REAL NOT NULL,
  label       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Weather gameplay modifiers: how each WeatherKind affects the simulation (server-authoritative).
-- move_scale multiplies player movement speed; aggro_scale multiplies monster aggro range
-- (both 1 = no effect). Seeded from the code defaults in weather-effects.ts; edit a row to retune
-- how a weather state PLAYS (e.g. make a sandstorm slower) without a recompile.
CREATE TABLE IF NOT EXISTS weather_modifiers (
  weather     TEXT PRIMARY KEY,        -- a WeatherKind ('none'|'rain'|'snow'|'fog'|'ash'|'sand'|'leaves'|'lightning')
  move_scale  REAL NOT NULL DEFAULT 1, -- player move-speed multiplier
  aggro_scale REAL NOT NULL DEFAULT 1  -- monster aggro-range multiplier
);

-- Elite ("champion") modifiers: the beefed-up variants a normal spawn can roll into. Each row is a
-- flavor prefix + stat multipliers. Seeded from DEFAULT_ELITE_MODIFIERS (mobs.ts); add/edit rows to
-- change the champion roster and its power. sort_order fixes the pick order (kept deterministic).
CREATE TABLE IF NOT EXISTS elite_modifiers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,           -- name prefix (e.g. 'Swift')
  hp_mult     REAL NOT NULL,           -- max-HP multiplier
  damage_mult REAL NOT NULL,           -- outgoing-damage multiplier
  speed_mult  REAL NOT NULL,           -- movement-speed multiplier
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- A quest is a KILL quest (target_mob + target_count, auto-progresses on kills), a COLLECT quest
-- (turn_in_item + turn_in_count, completed by turning items in to a quest-giver), or an EXPLORE
-- quest (explore_area, completed automatically the moment the player discovers that area).
CREATE TABLE IF NOT EXISTS quests (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  target_mob    TEXT,
  target_count  INTEGER NOT NULL DEFAULT 0,
  reward_gold   INTEGER NOT NULL DEFAULT 0,
  reward_xp     INTEGER NOT NULL DEFAULT 0,
  reward_item   TEXT,                          -- optional item granted on completion (e.g. a tome)
  turn_in_item  TEXT,                          -- collect quests: the item id to turn in
  turn_in_count INTEGER NOT NULL DEFAULT 0,    -- collect quests: how many to turn in
  explore_area  TEXT,                          -- explore quests: the area id to discover
  flags         INTEGER NOT NULL DEFAULT 0     -- bitmask (QuestFlags): REPEATABLE, …
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

-- Friends list: each row is one directed "owner has friend" relation, by display name. Presence
-- (online/area/level) is resolved at runtime by the SocialRegistry; this table is just the roster.
CREATE TABLE IF NOT EXISTS friends (
  owner_token TEXT NOT NULL,
  friend_name TEXT NOT NULL,
  PRIMARY KEY (owner_token, friend_name)
);

-- Game events: timed recurring liveops (TrinityCore GameEventMgr, cut down). Each row is a schedule
-- (recurs every period_min, active for length_min) with an optional XP bonus + announce line. The
-- schedule math is pure (game-events.ts); the host applies the active XP bonus + announces on start.
CREATE TABLE IF NOT EXISTS game_events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  period_min  INTEGER NOT NULL,        -- recurrence cadence (minutes)
  length_min  INTEGER NOT NULL,        -- occurrence duration (minutes)
  xp_bonus    REAL,                    -- nullable; fractional XP boost while active (0.5 = +50%)
  gold_bonus  REAL,                    -- nullable; fractional gold-drop boost while active (0.5 = +50%)
  announce    TEXT                     -- nullable; chat line broadcast when an occurrence begins
);

-- Rift modifiers: D3-style mutators a tiered rift rolls at open (e.g. Berserk: +mob damage, +loot).
-- Seeded from rift-modifiers.ts DEFAULT_RIFT_MODIFIERS; the World rolls a couple (seeded by the rift)
-- and applies the aggregated effects at mob spawn + reward sites. Column descr avoids the SQL keyword.
CREATE TABLE IF NOT EXISTS rift_modifiers (
  id                  TEXT    PRIMARY KEY,
  name                TEXT    NOT NULL,
  descr               TEXT    NOT NULL,
  min_tier            INTEGER NOT NULL DEFAULT 1,
  mob_damage_mult     REAL    NOT NULL DEFAULT 1,
  mob_hp_mult         REAL    NOT NULL DEFAULT 1,
  mob_speed_mult      REAL    NOT NULL DEFAULT 1,
  loot_quantity_bonus REAL    NOT NULL DEFAULT 0,
  xp_bonus            REAL    NOT NULL DEFAULT 0
);

-- Crafting recipes: fixed inputs → fixed outputs (the salvage-material refinement ladder + sinks).
-- Seeded from crafting.ts DEFAULT_RECIPES; the pure applyCraft does the spend. Header + normalized
-- I/O rows (role = input|output). Gives mat_scrap/dust/essence a sink via /craft.
CREATE TABLE IF NOT EXISTS crafting_recipes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS crafting_recipe_io (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id  TEXT NOT NULL,
  role       TEXT NOT NULL,           -- 'input' | 'output'
  item_id    TEXT NOT NULL,
  qty        INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Ladder / leaderboard: the best-ever score per character per metric (server is the sole writer;
-- scores are recorded from the authoritative save on autosave). One row per (name, metric); the
-- value only ever climbs (recordScore keeps the max). Read by the /ladder command.
CREATE TABLE IF NOT EXISTS leaderboard (
  name        TEXT NOT NULL,
  metric      TEXT NOT NULL,            -- 'level' | 'gold'
  value       REAL NOT NULL,
  achieved_at INTEGER NOT NULL,         -- wall-clock ms when this best was reached
  PRIMARY KEY (name, metric)
);
`;
