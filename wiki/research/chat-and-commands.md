# Chat, Chat Commands & GM/Admin Tooling — Research

> One-line summary: Ship a **channel-based chat** (say/area, world, party, guild, whisper, trade, system) with **rate limiting** already in place (`chatBucket`) plus **mute/filter** moderation; expose a **slash-command parser** that routes both player commands (`/help /who /played /roll /me /tell /ignore /join`) and **access-gated GM/dev commands** (`/tp /spawn /give /kill /heal /setlevel /kick /ban /mute /announce /gm`); gate everything through a **4-tier access model** (Player → Moderator → GameMaster → Admin/Dev) backed by a **per-account `accessLevel` flag**; replace the single `ENGINE_ADMIN_TOKEN` env secret with **real accounts** hashing passwords via **Argon2id** (`@node-rs/argon2`). The whole thing is one `CommandRegistry` (name, minLevel, args, handler) — the same registry can later back an in-game dev console.

This page targets THIS codebase. Today (`src/server/index.ts`) chat is a single area-scoped broadcast (`case 'chat'`) sanitized by `sanitizeChat` and rate-limited by a `TokenBucket(5,1)`; the only privileged surface is `case 'admin'`, gated by a shared-secret `ENGINE_ADMIN_TOKEN` that currently just echoes the command. There are no per-player identities beyond `entityId`, no account system, and no command parser. This report proposes the conventions to grow that stub into a real chat + command system, following the **security-first / capability-gated** pillars in `CLAUDE.md` (treat every client as hostile; gate privilege server-side).

---

## 1. Chat systems — what a typical MMO ships

MMOs split chat into **channels**, each with a different audience scope and routing rule. The client tags an outgoing line with a channel; the server validates membership/permission, formats, and fans it out only to the correct recipients. WoW separates "say/yell/party/guild/whisper" (proximity- or group-routed, not joinable) from true **named channels** (zone-wide General/LocalDefense, plus Trade which spans a whole capital). RuneScape uses Public (nearby players on your world), Private (friends-list whisper), and Friends/Clan chat (named joinable rooms).

### Channels to ship (recommended baseline)

| Channel | Slash | Scope / routing | Notes for our server |
|---|---|---|---|
| **Say / Area** | `/say` `/s` | All players in the **same instance** (already our default) | This is our current `broadcastToInstance` behavior — keep as default. |
| **Yell** | `/yell` `/y` | Everyone in the **area** (all instances of that area) — louder than Say | Optional; needs area-wide (cross-instance) fan-out. |
| **World / Global** | `/world` `/1` | Everyone online, all areas | Cross-instance; heaviest. Rate-limit hard; mod-toggleable. |
| **Whisper / Tell** | `/whisper` `/w` `/tell` `/t` `/msg` | One named target, anywhere | Needs name→connection lookup across instances. `/r` replies to last whisperer. |
| **Party** | `/party` `/p` | Current party members | Requires a party/group system (future). |
| **Guild** | `/guild` `/g` | Guild members online | Requires guilds (future). |
| **Trade** | `/trade` `/2` | Players in town/market areas | A named channel scoped to commercial hubs. |
| **System** | — (server-only) | Targeted player or broadcast | Login notices, level-ups, GM `/announce`, errors. Players can't send. |

**Message formatting.** Standardize a structured `chat` server message: `{ from, channel, text, ts }` (extend the current `{ from, text }`). The client renders `[Channel] Name: text` with a per-channel color (Say white, World yellow, Whisper magenta, Guild green, System grey) — mirroring WoW/RS conventions. Keep formatting **server-side authoritative** for `from` (already done via `world.nameOf(entityId)`); never trust a client-supplied sender name.

**Rate limiting.** Already implemented (`TokenBucket`). Recommendation: keep a per-connection chat bucket, and add a **tighter bucket for World/global** channels (e.g. `TokenBucket(2, 0.2)` ≈ one msg / 5s) since they reach everyone. This matches MMO anti-spam practice.

**Moderation.**
- **Mute** — a per-player flag (timed or permanent) checked at the chat boundary; muted players' messages are silently dropped (or echoed back only to themselves). Set via the `/mute` GM command. Persist on the account so it survives reconnect.
- **Filter** — `sanitizeChat` already strips/clamps; add an optional profanity word-list filter (server-side, toggleable) and a length clamp (already implied by `MAX_MESSAGE_BYTES`).
- **Ignore** — client-or-server list; `/ignore <name>` suppresses a specific sender for one player. Cleanest server-side (the sender can't bypass it).

---

## 2. Player slash commands (the common set)

These are available to **everyone** (min level Player). Conventions drawn from WoW and RuneScape/RuneLite.

| Command | Aliases | Args | What it does |
|---|---|---|---|
| `/help` | `/commands` `/?` | `[command]` | List commands the caller is allowed to use (filtered by access level). |
| `/who` | — | `[filter]` | List online players (optionally in area), names + levels. |
| `/played` | — | — | Total time played on this character/account. |
| `/roll` | `/random` `/dice` | `[min] [max]` | Random number 1–100 (or given range), broadcast to area. |
| `/me` | `/emote` `/em` | `<text>` | Emote line: `* Name <text>` to the area. |
| `/tell` | `/w` `/whisper` `/t` `/msg` | `<name> <text>` | Private message. |
| `/reply` | `/r` | `<text>` | Reply to last whisperer. |
| `/say` | `/s` | `<text>` | Force say channel. |
| `/yell` | `/y` | `<text>` | Area-wide. |
| `/join` | — | `<channel>` | Join a named channel (Trade/World/custom). |
| `/leave` | — | `<channel>` | Leave a named channel. |
| `/ignore` | — | `<name>` | Mute a specific player for yourself. |
| `/unignore` | — | `<name>` | Remove from ignore list. |
| `/invite` | — | `<name>` | Party invite (when parties exist). |
| `/time` | — | — | Server time / game clock. |
| `/logout` | — | — | Graceful disconnect. |

Implementation note: a leading `/` (or RuneScape's `::` / `!`) on a chat line routes to the command parser **before** the say-broadcast path. Unknown command → reply "Unknown command" only to the sender.

---

## 3. GM / Admin / Dev commands (the standard toolbox)

Reference baselines: **AzerothCore/TrinityCore** `.command` GM commands (each carries a default security level) and **RSPS** `::command` admin commands. Below is an adoptable set with a **suggested minimum access level** for our 4-tier model (see §4). The split mirrors AzerothCore: world-affecting/destructive → higher tier; reversible/utility → lower.

| Command | Aliases | Args | Min level | Effect |
|---|---|---|---|---|
| `/announce` | `/broadcast` | `<text>` | Moderator | System message to all online players. |
| `/mute` | — | `<name> [minutes] [reason]` | Moderator | Disable a player's chat (timed). |
| `/unmute` | — | `<name>` | Moderator | Lift a mute. |
| `/kick` | — | `<name> [reason]` | Moderator | Disconnect a player. |
| `/who` (extended) | — | `[filter]` | Moderator | See IPs / accounts (privileged fields). |
| `/goto` | `/tp` `/tele` | `<x> <y>` \| `<area>` \| `<name>` | GameMaster | Teleport self to coords/area/player. |
| `/summon` | `/bring` | `<name>` | GameMaster | Teleport a player to you. |
| `/heal` | — | `[name]` | GameMaster | Full HP/mana to self or target. |
| `/revive` | `/res` | `[name]` | GameMaster | Resurrect a dead player. |
| `/kill` | `/die` | `<name>` | GameMaster | Kill the target entity. |
| `/spawn` | `/add` | `npc\|mob <id> [count]` | GameMaster | Spawn a monster/NPC near you. |
| `/give` | `/additem` | `<itemId> [qty] [name]` | GameMaster | Add an item to self/target inventory. |
| `/gm` | `/invisible` `/cloak` | `on\|off` | GameMaster | Toggle GM-visible / invisibility. |
| `/godmode` | — | `on\|off` | GameMaster | Invulnerability for self. |
| `/speed` | — | `<multiplier>` | GameMaster | Movement-speed multiplier. |
| `/setlevel` | `/level` | `<n> [name]` | GameMaster | Set a player's level. |
| `/addxp` | `/givexp` | `<amount> [name]` | GameMaster | Grant experience. |
| `/ban` | — | `<name\|account\|ip> [duration] [reason]` | Admin | Suspend account/IP. |
| `/unban` | — | `<name\|account\|ip>` | Admin | Lift a ban. |
| `/setlevel-account` | `/account set gmlevel` | `<account> <level>` | Admin | Grant/revoke an access level (elevation). |
| `/reload` | — | `<table\|all>` | Admin | Hot-reload content from the SQLite DB. |
| `/shutdown` | `/restart` | `[seconds]` | Admin | Graceful server stop/restart. |

Notes:
- **Reversibility decides the tier.** `/announce`, `/kick`, `/mute` are Moderator (social, reversible). World-mutating/cheat-like powers (`/spawn /give /godmode /setlevel`) are GameMaster. Account-state and server-state powers (`/ban`, granting access levels, `/reload`, `/shutdown`) are Admin. This is exactly AzerothCore's pattern (kick/announce ≈ lvl 1–2, additem/die/revive/modify ≈ lvl 2, ban/mute/level ≈ lvl 3, `account set gmlevel` ≈ lvl 4).
- **Audit logging is mandatory** for every GM+ command: who, when, target, args. AzerothCore/TrinityCore log GM actions; do the same so privileged use is reviewable.
- The existing `case 'admin'` becomes the transport for these — but routed through the registry + access check, not a raw token echo.

---

## 4. Access / permission level model

MMOs use a small ordered ladder of **security/account levels**. TrinityCore's enum is the canonical reference: `SEC_PLAYER=0, SEC_MODERATOR=1, SEC_GAMEMASTER=2, SEC_HGAMEMASTER=3, SEC_DEVELOPER=4, … SEC_ADMINISTRATOR=7, SEC_CONSOLE=8`. On top of raw levels, TrinityCore adds **RBAC** (role-based access control) so individual permissions can be granted/revoked per account beyond the default-per-level grants (tables `rbac_permissions`, `rbac_default_permissions`, `rbac_account_permissions`, `rbac_linked_permissions`). WoW's live service uses account *types* (player, GM, developer) flagged on the account.

### Recommended model for BrowserGame (start simple: ordered levels)

```ts
// src/shared/access.ts
export enum AccessLevel {
  Player = 0,      // everyone
  Moderator = 1,   // chat moderation: mute/kick/announce
  GameMaster = 2,  // world powers: teleport/spawn/give/heal/setlevel
  Admin = 3,       // server + account powers: ban, grant levels, reload, shutdown
}
```

- A command carries `minLevel`; the dispatcher allows it iff `caller.accessLevel >= command.minLevel`. This monotonic check is the simplest correct gate and covers our four tiers.
- **Persist `accessLevel` on the account row**, never inferred from the client. The client may *request* a command; the server looks up the authenticated account's level. (This is the core fix to the current `ENGINE_ADMIN_TOKEN` echo — a single shared secret has no notion of *who* is acting and can't be revoked per-user or audited.)
- **Console level.** Keep the idea of TrinityCore's `SEC_CONSOLE` (highest) for the server's own stdin/dev console — useful for our planned in-game dev console (engine commands run as Admin/Console).
- **Elevation/login.** A normal player logs in with username+password; the account's stored `accessLevel` decides what commands resolve. Granting a level is itself an Admin command (`/account set gmlevel`), mirroring TrinityCore. For staff accounts, recommend requiring a separate GM account (don't grant GM to a main play account) and, for Admin, **2FA/TOTP** on login — a cheap, high-value addition since Admin can ban and shut down the server.
- **Defer full RBAC.** Per-permission RBAC (TrinityCore-style) is powerful but heavy. For our scale, the ordered 4-tier model is enough; leave RBAC as a documented future option if staff roles need finer slicing.

---

## 5. Account & auth basics (practical, Node-first)

Today there is no account system — players just send `{ t:'join', name }` and the only secret is `ENGINE_ADMIN_TOKEN`. To support real access levels we need accounts. Keep it minimal but correct:

- **Password storage: Argon2id.** OWASP's current (2024+) recommendation and RFC 9106 default for new applications. Use **`@node-rs/argon2`** (native binding; the pure-JS implementations are ~100× slower). OWASP minimum params: **19 MiB memory, 2 iterations, parallelism 1** — argon2id (memory-hard, resists GPU cracking). Fallback only if native modules are unavailable: **bcrypt cost ≥ 12** (Node's `bcrypt`), or Node's built-in `crypto.scrypt` (N=2^17, r=8, p=1). Recommendation: **Argon2id primary, bcrypt-12 fallback.** Never store plaintext; never roll your own hash.
- **Login flow.** Client sends `{username, password}` once over the (TLS-terminated) WebSocket/HTTP; server verifies the hash, issues an opaque **session token** (random 256-bit, stored server-side or signed), and the client presents it on `join`. Don't keep re-sending the password. Sessions expire and are revocable (logout, ban).
- **Don't trust the client — ever.** The client never sends its own `accessLevel`, never sends `from`/sender identity for chat, and never sends authoritative state. The server maps `session → account → accessLevel` and decides. This is the same boundary doctrine already used for input clamping in `World`.
- **Storage.** Accounts fit naturally in the existing SQLite DB (`game.db` / `src/server/db/`): an `accounts` table (`id, username, pwHash, accessLevel, muted, bannedUntil, createdAt`). Parametrized queries only (already the project convention).
- **Transport security.** Auth is only as safe as the transport — require HTTPS/WSS in production (the phone-friendly tunnel already gives TLS). Rate-limit login attempts (reuse `TokenBucket`) to slow credential stuffing.

---

## 6. Proposed command-registry API (TS)

One registry routes both chat-slash commands and GM/dev commands; the same registry can back an in-game dev console (the "in-engine console" concept). This replaces the `case 'admin'` echo with a real dispatcher.

```ts
// src/server/commands/registry.ts
import { AccessLevel } from '../../shared/access.js';

/** Context handed to every handler — who is calling, where, and how to reply. */
export interface CommandContext {
  callerId: number;            // entityId
  accountId: number;
  accessLevel: AccessLevel;
  instanceId: string;
  world: World;
  reply(text: string): void;                 // private system line back to caller
  announce(text: string, scope: 'area' | 'world'): void;
  resolveTarget(name: string): number | null; // name -> entityId, server-side lookup
}

export interface Command {
  name: string;                 // canonical, no slash, e.g. "give"
  aliases?: string[];           // ["additem"]
  minLevel: AccessLevel;        // gate
  usage: string;                // "/give <itemId> [qty] [name]"
  summary: string;              // one line for /help
  /** Returns a user-facing message (or void). Throw/return error string on bad args. */
  run(ctx: CommandContext, args: string[]): void | string | Promise<void | string>;
}

export class CommandRegistry {
  private byName = new Map<string, Command>();

  register(cmd: Command): void {
    for (const n of [cmd.name, ...(cmd.aliases ?? [])]) {
      if (this.byName.has(n)) throw new Error(`duplicate command: ${n}`);
      this.byName.set(n, cmd);
    }
  }

  /** Parse a raw chat line beginning with '/'. Returns false if not a command. */
  async dispatch(ctx: CommandContext, line: string): Promise<boolean> {
    if (!line.startsWith('/')) return false;
    const [head, ...args] = line.slice(1).trim().split(/\s+/);
    const cmd = this.byName.get((head ?? '').toLowerCase());
    if (!cmd) { ctx.reply(`Unknown command: /${head}`); return true; }
    if (ctx.accessLevel < cmd.minLevel) {           // capability gate
      ctx.reply('You do not have permission to use that command.');
      return true;                                  // do NOT reveal the command exists differently
    }
    try {
      const out = await cmd.run(ctx, args);
      if (typeof out === 'string') ctx.reply(out);
      if (cmd.minLevel >= AccessLevel.GameMaster) auditLog(ctx, cmd.name, args); // log privileged use
    } catch (e) {
      ctx.reply(`Error: ${(e as Error).message}`);
    }
    return true;
  }
}
```

Wiring (in `src/server/index.ts`): in `case 'chat'`, if `text` starts with `/`, call `registry.dispatch(ctx, text)` instead of broadcasting; otherwise broadcast as today. Build `ctx.accessLevel` from the **authenticated account**, not the message. `/help` enumerates `registry` entries filtered by `ctx.accessLevel` (callers never see commands above their tier).

### Example command definitions

```ts
registry.register({
  name: 'roll', aliases: ['random'], minLevel: AccessLevel.Player,
  usage: '/roll [max]', summary: 'Roll a random number.',
  run(ctx, args) {
    const max = Math.min(Math.max(parseInt(args[0] ?? '100', 10) || 100, 1), 1_000_000);
    const n = 1 + Math.floor(Math.random() * max);
    ctx.announce(`${ctx.world.nameOf(ctx.callerId)} rolls ${n} (1-${max}).`, 'area');
  },
});

registry.register({
  name: 'give', aliases: ['additem'], minLevel: AccessLevel.GameMaster,
  usage: '/give <itemId> [qty] [name]', summary: 'Give an item.',
  run(ctx, args) {
    const itemId = args[0]; if (!itemId) return 'Usage: /give <itemId> [qty] [name]';
    const qty = Math.min(Math.max(parseInt(args[1] ?? '1', 10) || 1, 1), 1000);
    const target = args[2] ? ctx.resolveTarget(args[2]) : ctx.callerId;
    if (target == null) return 'No such player.';
    ctx.world.giveItem(target, itemId, qty);        // world validates itemId against content DB
    return `Gave ${qty}x ${itemId}.`;
  },
});
```

Every handler still validates/clamps its args at the boundary (e.g. clamp `qty`, verify `itemId` exists in the content DB) — the access gate decides *who*, the handler decides *what's legal*.

---

## 7. Adoption checklist for this repo

1. Add `src/shared/access.ts` (`AccessLevel` enum) — shared so client can grey-out commands it can't run (cosmetic only; the server is the real gate).
2. Add an `accounts` table to `game.db` + an auth module hashing with `@node-rs/argon2` (Argon2id, 19 MiB / t=2 / p=1); issue session tokens; rate-limit logins.
3. Replace `ENGINE_ADMIN_TOKEN` echo: `case 'admin'`/`case 'chat'` route `/`-prefixed lines into `CommandRegistry.dispatch` with `accessLevel` from the authenticated account. (Token can remain as a bootstrap for the first Admin account only.)
4. Extend the `chat` protocol message with `channel` and implement whisper/world/system routing + per-channel colors client-side.
5. Add `mute`/`bannedUntil` checks at the chat and join boundaries; add `/ignore` (server-side suppression).
6. Audit-log every GameMaster+ command.

---

## Sources

- WoW chat channels & slash commands — [Warcraft Wiki: Chat](https://warcraft.wiki.gg/wiki/Chat), [WoWWiki: Slash commands](https://wowwiki-archive.fandom.com/wiki/Slash_commands), [Warcraft Wiki: Macro commands](https://warcraft.wiki.gg/wiki/Macro_commands)
- RuneScape chat & emote commands — [OSRS Wiki: Chat Interface](https://oldschool.runescape.wiki/w/Chat_Interface), [OSRS Wiki: Commands](https://oldschool.runescape.wiki/w/Commands), [RuneLite: Chat Commands](https://github.com/runelite/runelite/wiki/Chat-Commands)
- RSPS admin commands & access tiers — [RSPS Codes: Player/Moderator/Admin Commands](http://rspscodes.synthasite.com/general-commands.php), [Open-RSC Core-Framework Commands.md](https://github.com/Open-RSC/Core-Framework/blob/develop/Commands.md), [Vortex RSPS Wiki: Admin Commands](https://vortex-rsps.fandom.com/wiki/Admin_Commands)
- GM commands & security levels — [AzerothCore: GM Commands](https://www.azerothcore.org/wiki/gm-commands), [TrinityCore: RBAC](https://trinitycore.info/how-to/RBAC), [TrinityCore RBAC.h enum (source)](https://github.com/TrinityCore/TrinityCore/blob/master/src/server/game/Accounts/RBAC.h)
- Password hashing — [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [WorkOS: Picking a password hash (argon2/bcrypt/scrypt)](https://workos.com/blog/picking-a-password-hash-argon2-bcrypt-scrypt)
