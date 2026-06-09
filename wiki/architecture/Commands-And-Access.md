# Chat Commands & Access Levels

> Slash-commands in chat, gated by account **access level**. This is the SparkConsole in-engine
> command idea, capability-gated (DuetOS). The server is the sole authority on a session's level —
> the client never asserts it.

## Access levels

| Level | Name | Who |
|---|---|---|
| 0 | Player | everyone (guest) |
| 1 | Moderator | chat moderation |
| 2 | GameMaster | world-mutating commands |
| 3 | Admin | accounts + server state |
| 4 | Developer | everything |

Players start as **guests (level 0)**. They authenticate with `/login <user> <password>` to gain a
higher level. Accounts live in the `accounts` table (`src/server/accounts.ts`); passwords are
salted + hashed with **scrypt** (Node built-in; Argon2 is a documented future upgrade). A default
`dev` account (Developer) is seeded with `DEV_PASSWORD` — **change it**.

## Commands

Chat messages starting with `/` are parsed as commands (`src/server/commands.ts`), not broadcast.
`/help` lists only the commands available at your level. Replies come back as `System` chat.

| Command | Min level | What |
|---|---|---|
| `/help` | Player | list your commands |
| `/who` | Player | players in your area |
| `/where` | Player | your area + position |
| `/roll [max]` | Player | random roll (broadcast) |
| `/me <action>` | Player | emote |
| `/login <user> <pass>` | Player | authenticate for staff access |
| `/tp <x> <y>` | GameMaster | teleport |
| `/heal` | GameMaster | full HP/mana |
| `/spawn <mob> [n]` | GameMaster | spawn monsters at you |
| `/give <item> [n]` | GameMaster | add an item to your bag |
| `/setlevel <n>` | GameMaster | set your level |
| `/addxp <n>` | GameMaster | grant XP |
| `/godmode` | GameMaster | toggle invulnerability |
| `/killall` | GameMaster | clear area monsters |
| `/announce <text>` | Admin | server message to the area |
| `/setaccess <user> <0-4>` | Admin | set an account's level |
| `/themekeys` | Developer | list areas + editable theme keys |
| `/theme [area]` | Developer | show an area's environment theme |
| `/settheme <area> <key> <value>` | Developer | **live-edit** an area's look (re-skins all clients) |
| `/reloadcontent` | Developer | reload content from the DB (after direct SQL edits) |
| `/tables` | Developer | list editable content tables (spells, items, monsters, …) |
| `/cols <table>` | Developer | a table's editable columns + types/ranges |
| `/get <table> [id]` | Developer | show a content row, or list ids |
| `/set <table> <id> <column> <value>` | Developer | **live-edit any content value** |

Mob/item ids come from the content DB (e.g. `/spawn crypt_lord`, `/give iron_sword`) — so
SQL-added content is immediately usable by commands.

### Live environment theming (`/settheme`)

The world's *look* is data-driven (see [Content Database](Content-Database.md) → `area_theme`).
`/settheme` is the in-game engine for it: a Developer edits one theme value and **every connected
client re-skins in place, no reconnect**. Example session:

```
/login dev <password>
/settheme town weather snow
/settheme town ground_base #3a2630
/settheme town light_ambient 0.25
```

The value is validated + clamped server-side (`coerceThemeValue` in `src/shared/theme.ts`), the
single whitelisted column is upserted in `area_theme`, then content is reloaded and the `content`
packet is re-broadcast. `/reloadcontent` does the same after you edit `game.db` directly with the
`sqlite3` CLI — so the world can be re-themed from anywhere, live. See `/themekeys` for the keys.

### Live editing for *everything* (`/set`)

`/settheme` is a friendly alias over a **generic content editor** that can edit any whitelisted
content table the same way — the in-game engine for the whole backend:

```
/tables                                  → spells, items, monsters, quests, areas, spawns, npcs, …
/cols mob_templates                      → name:text  hp:int[1..1000000]  damage:real[0..99999] …
/get abilities fireball                  → the row's columns + values
/set abilities fireball damage 40        → buff the spell, live
/set mob_templates wolf speed 160        → make wolves faster, live
/set quests wolf_cull reward_gold 500    → richer reward, live
```

The registry of editable tables/columns and the validation/clamping live in
`src/server/db/editable.ts` (`EDITABLE_TABLES`, `coerceColumn`); the engine is
`src/server/content-edit.ts`. Table/column/pk names come only from the whitelist (safe to
interpolate into SQL); values and ids are always bound. On success the server reloads content and
re-broadcasts, so edits apply **live**: numbers the simulation reads per-tick (spell damage, monster
speed/damage/aggro, item power, sell values, quest rewards) change immediately; **structural**
changes (a new spawn row, moving an NPC, an area's size) apply to newly created instances. Like
`/settheme`, a bad value or id is rejected with a `System` reply and never disrupts the server.

## Design

- **Registry** (`commands.ts`): each command has `{ name, minLevel, usage, help, run(ctx) }`. The
  parser splits the line, looks up the command, **gates by `ctx.accessLevel >= minLevel`**, and runs
  it with parsed args. The host (`index.ts`) builds the `CommandContext` with callbacks
  (`reply`/`broadcast`/`login`/`setAccessLevel`/world access).
- **Authoritative effects**: commands call `World` methods (`teleport`, `spawnMobAt`, `giveItem`,
  `setLevel`, `toggleGod`, `killAllMobs`, …) — all server-side; the client only renders the result.
- This also serves as the backend for a future in-game **dev console** UI.

## Security notes

- A guest cannot run staff commands even by guessing them (server checks the level).
- Replace the default `DEV_PASSWORD`; consider Argon2id + login rate-limiting + audit logging of
  GM+ commands before any public deployment (see `wiki/research/chat-and-commands.md`).

## See also

- [Content Database (SQLite)](Content-Database.md)
- Research: `wiki/research/chat-and-commands.md`
