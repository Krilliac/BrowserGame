# Content Database (SQLite)

> Game **content** lives in a SQLite database — the source of truth for the backend. Editing the
> database changes the game. Gameplay stays server-authoritative.

## What's in it

The server loads all content from SQLite at startup (`src/server/content.ts`, via parametrized
queries) into in-memory structures the simulation reads. Tables (`src/server/db/schema.ts`):

| Table | Holds |
|---|---|
| `areas`, `portals` | The world's zones, sizes, spawns, caps, and the portals between them |
| `area_theme` | Each area's **environment look** — ground, props, mood tint, particles, weather, lighting |
| `abilities` | Spells / abilities (damage, range, cooldown, mana, kind, projectile stats) |
| `items` | Equipment (slot/power/hp), loot materials (sell value), and currency |
| `mob_templates` | Monster stats (hp, level, speed, aggro/attack range, damage) |
| `area_mobs` | Which monsters spawn in which area, and how many |
| `loot_entry` | Per-monster drop tables (always / weighted main / rare / gear) |
| `npcs` | Static NPCs (the town vendor) per area |
| `quests` | Quest definitions (schema seeded with a sample) |

## How it works

1. On first run the server creates `game.db` (path from `GAME_DB`, default `game.db`) and **seeds**
   it from the built-in content (`src/server/db/seed.ts`). On later runs it just loads.
2. `content.ts` reads every table with **parametrized prepared statements** and exposes a typed
   `Content` API (`area`, `ability`, `item`, `mobTemplate`, `areaMobs`, `npcs`, `quests`,
   `rollLoot`, …). The simulation (`world.ts`, `instance-manager.ts`) reads only from `Content`.
3. Tests and the default use an in-memory DB (`:memory:`) seeded the same way — zero config.

## Editing the game with SQL

Stop the server, open the database, run SQL, restart:

```bash
sqlite3 game.db
```

```sql
-- Buff a spell
UPDATE abilities SET damage = 40, cooldown_ms = 700 WHERE id = 'fireball';

-- Make wolves tougher
UPDATE mob_templates SET hp = 90, damage = 12 WHERE id = 'wolf';

-- Add a brand-new monster and spawn it in the crypt
INSERT INTO mob_templates
  (id,name,hp,level,hue,speed,aggro_range,attack_range,damage,attack_cooldown_ms)
  VALUES ('dragon','Ancient Dragon',2000,30,10,90,600,80,40,1400);
INSERT INTO area_mobs (area_id, template_id, count) VALUES ('crypt','dragon',1);

-- Change a vendor price, move an NPC, add a quest…
UPDATE items SET sell_value = 400 WHERE id = 'rune_shard';
UPDATE npcs SET x = 800, y = 600 WHERE name = 'Merchant';

-- Re-skin an area's environment (see area_theme below)
UPDATE area_theme SET ground_base = '#2a1830', weather = 'snow' WHERE area_id = 'town';
```

All of these take effect on the next server start — no code change. (Gameplay numbers are
server-authoritative, so they apply immediately to combat/loot/spawns.)

## Environment themes — the *look* is data too (`area_theme`)

Each area has one `area_theme` row driving its entire appearance — the client renders ground
colors, scattered props, mood tint, ambient particles, weather (rain/snow/fog), and lighting
**entirely from these columns**. Column names match the keys in `src/shared/theme.ts`:

| Column(s) | Effect |
|---|---|
| `ground_base`, `ground_speck` | tiled ground fill + speckle colors |
| `prop`, `prop_density` | scattered props (`tree`/`grave`/`rock`/`none`) and how dense |
| `atmo_color`, `atmo_alpha` | base mood tint over the whole screen |
| `outdoor` | `1` = the day/night cycle applies; `0` = indoor gloom (crypts) |
| `particle_color`, `particle_count`, `particle_rise`, `particle_flicker` | drifting ambient motes |
| `weather`, `weather_intensity`, `fog_color` | weather overlay |
| `light_ambient` | baseline light `0..1`; lower = murkier and torch/portal glow reads stronger |

This is **live-editable without a restart**: the `/settheme <area> <key> <value>` Developer command
(see [Commands & Access](Commands-And-Access.md)) validates + clamps the value, upserts the column,
and re-broadcasts the `content` packet so every connected client re-skins in place. After a direct
`sqlite3` edit, `/reloadcontent` does the same. Values are always validated server-side
(`coerceThemeValue`) — the client never asserts theme state.

## Client mirrors the database too

On connect the server sends a **`content` packet** (areas, abilities, items) built from the DB.
The client stores it (`src/client/content-store.ts`) and reads everything from it — the hotbar,
portals/minimap, item names/colors, and equip checks. So a brand-new spell added via SQL shows up
in the hotbar, and a new area renders, **with no client code change**. Even the area's *look* now
comes from the DB (`area_theme`, above), so re-skinning is data-driven and live. The client keeps
only pure *presentation* config locally (sprite-sheet frame layouts, physics radii).

The one thing not yet hot-reloaded is **sprite art for a brand-new monster type** added purely via
SQL — it falls back to a procedural shape until a sheet is registered for it. Everything else
(stats, spells, items, areas, spawns, NPCs, vendor prices, loot) is fully data-driven end to end.

## See also

- [Areas & Instances](Areas-And-Instances.md)
- [Combat, Monsters & Rendering](Combat.md)
