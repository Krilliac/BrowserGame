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

Mob/item ids come from the content DB (e.g. `/spawn crypt_lord`, `/give iron_sword`) — so
SQL-added content is immediately usable by commands.

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
