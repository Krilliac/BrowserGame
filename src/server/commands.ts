import { AccessLevel, accessName } from './accounts.js';
import type { World } from './world.js';

/**
 * Chat command system: a registry of slash-commands gated by access level (the SparkConsole /
 * in-engine command idea, capability-gated per DuetOS). The host (index.ts) builds a context with
 * callbacks; the server is authoritative for the session's access level — the client never asserts
 * it. Player commands are open; GM/Admin/Dev commands require authentication via `/login`.
 */
export interface CommandContext {
  accessLevel: number;
  args: string[];
  playerId: number;
  areaId: string;
  world: World;
  reply: (text: string) => void; // to the issuing player only (System message)
  broadcast: (text: string) => void; // to everyone in the player's instance
  name: () => string;
  login: (username: string, password: string) => number | null;
  setAccessLevel: (level: number) => void;
  listPlayers: () => string[];
  setAccessFor: (username: string, level: number) => boolean;
}

interface Command {
  name: string;
  minLevel: AccessLevel;
  usage: string;
  help: string;
  run: (ctx: CommandContext) => void;
}

function int(args: string[], i: number, fallback: number): number {
  const n = Number.parseInt(args[i] ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

const COMMAND_LIST: Command[] = [
  // --- Player ---------------------------------------------------------------------------
  {
    name: 'help',
    minLevel: AccessLevel.Player,
    usage: '/help',
    help: 'List the commands you can use.',
    run: (ctx) => {
      const usable = COMMAND_LIST.filter((c) => ctx.accessLevel >= c.minLevel);
      ctx.reply(`Commands: ${usable.map((c) => '/' + c.name).join(', ')}`);
      ctx.reply('Use a command with no args to see usage, e.g. /roll, /tp, /give.');
    },
  },
  {
    name: 'who',
    minLevel: AccessLevel.Player,
    usage: '/who',
    help: 'List players in your area.',
    run: (ctx) => {
      const players = ctx.listPlayers();
      ctx.reply(`Players here (${players.length}): ${players.join(', ')}`);
    },
  },
  {
    name: 'where',
    minLevel: AccessLevel.Player,
    usage: '/where',
    help: 'Show your area and position.',
    run: (ctx) => {
      const p = ctx.world.playerPos(ctx.playerId);
      ctx.reply(p ? `${ctx.areaId} (${Math.round(p.x)}, ${Math.round(p.y)})` : 'unknown');
    },
  },
  {
    name: 'roll',
    minLevel: AccessLevel.Player,
    usage: '/roll [max]',
    help: 'Roll a random number (default 1-100).',
    run: (ctx) => {
      const max = Math.max(1, int(ctx.args, 0, 100));
      const n = 1 + Math.floor(Math.random() * max);
      ctx.broadcast(`${ctx.name()} rolls ${n} (1-${max})`);
    },
  },
  {
    name: 'me',
    minLevel: AccessLevel.Player,
    usage: '/me <action>',
    help: 'Emote an action.',
    run: (ctx) => {
      const text = ctx.args.join(' ').trim();
      if (text) ctx.broadcast(`* ${ctx.name()} ${text}`);
      else ctx.reply('Usage: /me <action>');
    },
  },
  {
    name: 'login',
    minLevel: AccessLevel.Player,
    usage: '/login <user> <password>',
    help: 'Authenticate to gain staff access.',
    run: (ctx) => {
      const [user, pass] = ctx.args;
      if (!user || !pass) return ctx.reply('Usage: /login <user> <password>');
      const level = ctx.login(user, pass);
      if (level === null) return ctx.reply('Login failed.');
      ctx.setAccessLevel(level);
      ctx.reply(`Logged in as ${user} — ${accessName(level)} access.`);
    },
  },
  {
    name: 'quests',
    minLevel: AccessLevel.Player,
    usage: '/quests',
    help: 'Show your quest log.',
    run: (ctx) => {
      const lines = ctx.world.questLog(ctx.playerId);
      if (lines.length === 0) ctx.reply('No quests available.');
      for (const line of lines) ctx.reply(line);
    },
  },
  {
    name: 'accept',
    minLevel: AccessLevel.Player,
    usage: '/accept <questId>',
    help: 'Accept a quest (see /quests).',
    run: (ctx) => {
      const questId = ctx.args[0];
      if (!questId) return ctx.reply('Usage: /accept <questId>');
      ctx.reply(ctx.world.acceptQuest(ctx.playerId, questId));
    },
  },

  // --- Game Master ----------------------------------------------------------------------
  {
    name: 'tp',
    minLevel: AccessLevel.GameMaster,
    usage: '/tp <x> <y>',
    help: 'Teleport yourself to a position in the current area.',
    run: (ctx) => {
      if (ctx.args.length < 2) return ctx.reply('Usage: /tp <x> <y>');
      const x = int(ctx.args, 0, 0);
      const y = int(ctx.args, 1, 0);
      ctx.world.teleport(ctx.playerId, x, y);
      ctx.reply(`Teleported to ${x}, ${y}.`);
    },
  },
  {
    name: 'heal',
    minLevel: AccessLevel.GameMaster,
    usage: '/heal',
    help: 'Restore your HP and mana to full.',
    run: (ctx) => {
      ctx.world.healFull(ctx.playerId);
      ctx.reply('Healed to full.');
    },
  },
  {
    name: 'spawn',
    minLevel: AccessLevel.GameMaster,
    usage: '/spawn <mob> [count]',
    help: 'Spawn monsters at your position.',
    run: (ctx) => {
      const template = ctx.args[0];
      if (!template) return ctx.reply('Usage: /spawn <mobTemplateId> [count]');
      const count = Math.min(50, Math.max(1, int(ctx.args, 1, 1)));
      let spawned = 0;
      for (let i = 0; i < count; i++) if (ctx.world.spawnMobAt(ctx.playerId, template)) spawned++;
      ctx.reply(spawned ? `Spawned ${spawned}x ${template}.` : `Unknown mob template: ${template}`);
    },
  },
  {
    name: 'give',
    minLevel: AccessLevel.GameMaster,
    usage: '/give <item> [qty]',
    help: 'Add an item to your bag.',
    run: (ctx) => {
      const item = ctx.args[0];
      if (!item) return ctx.reply('Usage: /give <itemId> [qty]');
      const qty = Math.min(9999, Math.max(1, int(ctx.args, 1, 1)));
      ctx.reply(
        ctx.world.giveItem(ctx.playerId, item, qty)
          ? `Gave ${qty}x ${item}.`
          : `Unknown item: ${item}`,
      );
    },
  },
  {
    name: 'setlevel',
    minLevel: AccessLevel.GameMaster,
    usage: '/setlevel <n>',
    help: 'Set your character level.',
    run: (ctx) => {
      const level = Math.max(1, int(ctx.args, 0, 1));
      ctx.world.setLevel(ctx.playerId, level);
      ctx.reply(`Level set to ${level}.`);
    },
  },
  {
    name: 'addxp',
    minLevel: AccessLevel.GameMaster,
    usage: '/addxp <n>',
    help: 'Grant yourself XP.',
    run: (ctx) => {
      const amount = Math.max(0, int(ctx.args, 0, 0));
      ctx.world.addXp(ctx.playerId, amount);
      ctx.reply(`Granted ${amount} XP.`);
    },
  },
  {
    name: 'godmode',
    minLevel: AccessLevel.GameMaster,
    usage: '/godmode',
    help: 'Toggle invulnerability.',
    run: (ctx) => {
      const on = ctx.world.toggleGod(ctx.playerId);
      ctx.reply(`God mode ${on ? 'ON' : 'OFF'}.`);
    },
  },
  {
    name: 'killall',
    minLevel: AccessLevel.GameMaster,
    usage: '/killall',
    help: 'Kill all monsters in your area (no rewards).',
    run: (ctx) => {
      const n = ctx.world.killAllMobs();
      ctx.reply(`Killed ${n} monsters.`);
    },
  },

  // --- Admin ----------------------------------------------------------------------------
  {
    name: 'announce',
    minLevel: AccessLevel.Admin,
    usage: '/announce <text>',
    help: 'Broadcast a server message to the area.',
    run: (ctx) => {
      const text = ctx.args.join(' ').trim();
      if (text) ctx.broadcast(`[Announcement] ${text}`);
      else ctx.reply('Usage: /announce <text>');
    },
  },
  {
    name: 'setaccess',
    minLevel: AccessLevel.Admin,
    usage: '/setaccess <user> <level 0-4>',
    help: "Set an account's access level.",
    run: (ctx) => {
      const user = ctx.args[0];
      const level = int(ctx.args, 1, -1);
      if (!user || level < 0 || level > 4) return ctx.reply('Usage: /setaccess <user> <level 0-4>');
      ctx.reply(
        ctx.setAccessFor(user, level)
          ? `Set ${user} to ${accessName(level)}.`
          : `No such account: ${user}`,
      );
    },
  },
];

const COMMANDS = new Map(COMMAND_LIST.map((c) => [c.name, c]));

/** True if a chat message is a command (starts with '/'). */
export function isCommand(text: string): boolean {
  return text.startsWith('/');
}

/** Parse and run a slash-command. Replies with errors/usage via the context. */
export function runCommand(text: string, ctx: CommandContext): void {
  const parts = text.slice(1).trim().split(/\s+/);
  const name = (parts[0] ?? '').toLowerCase();
  const command = COMMANDS.get(name);
  if (!command) return ctx.reply(`Unknown command: /${name}. Try /help.`);
  if (ctx.accessLevel < command.minLevel) {
    return ctx.reply(`You don't have access to /${name}.`);
  }
  command.run({ ...ctx, args: parts.slice(1) });
}
