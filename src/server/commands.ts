import { config } from './config.js';
import { AccessLevel, accessName } from './accounts.js';
import { THEME_KEYS, type AreaTheme } from '../shared/theme.js';
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
  // Live environment theming (Developer): edit the area_theme DB and re-skin all clients.
  areaIds: () => string[];
  areaTheme: (areaId: string) => AreaTheme | undefined;
  setTheme: (areaId: string, key: string, value: string) => string;
  reloadContent: () => string;
  // AI bot players (GameMaster): spawn companions into your instance / clear them / dump run report.
  spawnBots: (count: number) => number;
  clearBots: () => number;
  /** Write the current squad run report (markdown + JSON) and return a one-line summary, or null. */
  botReport: () => string | null;
  // Generic live content editing (Developer): edit any whitelisted content table/column.
  contentTables: () => string;
  contentColumns: (table: string) => string;
  contentRows: (table: string) => string;
  contentRow: (table: string, id: string) => string;
  setContent: (table: string, id: string, column: string, value: string) => string;
  /** Render the top of the ladder for a metric (level/gold/kills/streak); unknown metrics fall back to level. */
  ladder: (metric: string) => string;
  /** Render the timed game-events with their active state + time-to-flip (for /event). */
  events: () => string;
  /** Render the crafting recipes (id — name: inputs → outputs) for /recipes. */
  recipes: () => string;
}

interface Command {
  name: string;
  minLevel: AccessLevel;
  usage: string;
  help: string;
  run: (ctx: CommandContext) => void;
}

// Max bots a SINGLE /bot call may spawn — generous (a real flood) but finite so a typo like
// /bot 9999999 can't lock the event loop joining entities. Run the command repeatedly to stack
// past this into an arbitrarily large army.
const BOT_SPAWN_PER_CALL_MAX = config.bots.spawnPerCallMax;

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
    name: 'ladder',
    minLevel: AccessLevel.Player,
    usage: '/ladder [level|gold|kills|streak]',
    help: 'Show the top characters by level (default), gold, kills, or best deathless streak.',
    run: (ctx) => {
      const metric = (ctx.args[0] ?? 'level').toLowerCase();
      // The accessor renders + clamps; it falls back to 'level' for an unknown metric.
      for (const line of ctx.ladder(metric).split('\n')) ctx.reply(line);
    },
  },
  {
    name: 'events',
    minLevel: AccessLevel.GameMaster,
    usage: '/events',
    help: 'List timed game-events and whether each is active right now.',
    run: (ctx) => {
      for (const line of ctx.events().split('\n')) ctx.reply(line);
    },
  },
  {
    name: 'salvage',
    minLevel: AccessLevel.Player,
    usage: '/salvage <itemUid>',
    help: 'Break a bag item down into crafting materials.',
    run: (ctx) => {
      const uid = int(ctx.args, 0, -1);
      const r = ctx.world.salvage(ctx.playerId, uid);
      if (!r.ok) {
        ctx.reply(r.reason ?? 'Could not salvage that.');
        return;
      }
      const mats = (r.yields ?? []).map((y) => `${y.qty} ${y.kind}`).join(', ');
      ctx.reply(`Salvaged → ${mats}.`);
    },
  },
  {
    name: 'recipes',
    minLevel: AccessLevel.Player,
    usage: '/recipes',
    help: 'List crafting recipes you can make with /craft.',
    run: (ctx) => {
      for (const line of ctx.recipes().split('\n')) ctx.reply(line);
    },
  },
  {
    name: 'achievements',
    minLevel: AccessLevel.Player,
    usage: '/achievements',
    help: 'Show your achievements and progress.',
    run: (ctx) => {
      for (const line of ctx.world.achievementStatus(ctx.playerId)) ctx.reply(line);
    },
  },
  {
    name: 'bestiary',
    minLevel: AccessLevel.Player,
    usage: '/bestiary',
    help: 'List the monster species you have slain.',
    run: (ctx) => {
      for (const line of ctx.world.bestiaryStatus(ctx.playerId)) ctx.reply(line);
    },
  },
  {
    name: 'respec',
    minLevel: AccessLevel.Player,
    usage: '/respec',
    help: 'Refund all allocated attribute + skill points for gold (cost scales with level).',
    run: (ctx) => {
      ctx.reply(ctx.world.respec(ctx.playerId).message);
    },
  },
  {
    name: 'expandstash',
    minLevel: AccessLevel.Player,
    usage: '/expandstash',
    help: 'Buy more stash slots for gold (at a Banker; cost rises each time).',
    run: (ctx) => {
      ctx.reply(ctx.world.expandStash(ctx.playerId).message);
    },
  },
  {
    name: 'sort',
    minLevel: AccessLevel.Player,
    usage: '/sort',
    help: 'Tidy your bag: group gear by slot, best rarity first.',
    run: (ctx) => {
      ctx.world.sortBag(ctx.playerId);
      ctx.reply('Bag sorted.');
    },
  },
  {
    name: 'craft',
    minLevel: AccessLevel.Player,
    usage: '/craft <recipeId>',
    help: 'Craft a recipe from your materials (see /recipes).',
    run: (ctx) => {
      const id = ctx.args[0];
      if (!id) {
        ctx.reply('Usage: /craft <recipeId> — see /recipes.');
        return;
      }
      ctx.world.craft(ctx.playerId, id); // the world notifies success/failure
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
    name: 'showcase',
    minLevel: AccessLevel.GameMaster,
    usage: '/showcase',
    help: 'Drop a QA loot spread (rarity glints, top-tier labels, a health globe) and wound yourself, for verifying the loot visuals.',
    run: (ctx) => {
      const n = ctx.world.devLootShowcase(ctx.playerId);
      ctx.reply(n ? `Dropped ${n} showcase item(s) — grab the globe to heal.` : 'Showcase failed.');
    },
  },
  {
    name: 'speed',
    minLevel: AccessLevel.GameMaster,
    usage: '/speed <multiplier>',
    help: 'Set your movement-speed multiplier (e.g. /speed 2 = double, /speed 0.5 = half, /speed 1 = reset).',
    run: (ctx) => {
      const m = Number.parseFloat(ctx.args[0] ?? '');
      if (!Number.isFinite(m)) {
        return ctx.reply('Usage: /speed <multiplier> — e.g. 2 (double), 0.5 (half), 1 (reset).');
      }
      const applied = ctx.world.setDebugSpeed(ctx.playerId, m);
      ctx.reply(`Movement speed set to ${applied}×.`);
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
    name: 'bot',
    minLevel: AccessLevel.GameMaster,
    usage: '/bot <count> | /bot clear | /bot report',
    help: 'Spawn a cooperating AI squad that roams, fights, and journeys to endgame, or clear them. /bot report writes the run metrics. Stackable — run it again to add more.',
    run: (ctx) => {
      const arg = (ctx.args[0] ?? '').toLowerCase();
      if (arg === 'clear' || arg === 'off' || arg === '0') {
        const n = ctx.clearBots();
        return ctx.reply(n ? `Cleared ${n} bot${n === 1 ? '' : 's'}.` : 'No bots to clear.');
      }
      if (arg === 'report' || arg === 'metrics' || arg === 'stats') {
        const summary = ctx.botReport();
        return ctx.reply(summary ?? 'No active bot squad to report on.');
      }
      // Uncapped for floods — only a sanity ceiling per call so one fat-fingered number can't
      // freeze the event loop spawning entities. Stack calls for an arbitrarily large army.
      const count = Math.min(BOT_SPAWN_PER_CALL_MAX, Math.max(1, int(ctx.args, 0, 3)));
      const n = ctx.spawnBots(count);
      ctx.reply(
        n
          ? `Spawned ${n} bot${n === 1 ? '' : 's'} — they roam, fight, and head for endgame. Run /bot again for more · /bot clear to remove.`
          : 'Could not spawn bots.',
      );
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

  // --- Developer (live environment theming) ---------------------------------------------
  {
    name: 'themekeys',
    minLevel: AccessLevel.Developer,
    usage: '/themekeys',
    help: 'List the editable environment-theme keys.',
    run: (ctx) => {
      ctx.reply(`Areas: ${ctx.areaIds().join(', ')}`);
      ctx.reply(`Theme keys: ${Object.keys(THEME_KEYS).join(', ')}`);
    },
  },
  {
    name: 'theme',
    minLevel: AccessLevel.Developer,
    usage: '/theme [area]',
    help: "Show an area's environment theme (defaults to your area).",
    run: (ctx) => {
      const area = ctx.args[0] ?? ctx.areaId;
      const t = ctx.areaTheme(area);
      if (!t) return ctx.reply(`No such area: ${area}`);
      const pairs = Object.entries(THEME_KEYS).map(
        ([key, spec]) => `${key}=${String(t[spec.field])}`,
      );
      ctx.reply(`Theme[${area}]: ${pairs.join('  ')}`);
    },
  },
  {
    name: 'settheme',
    minLevel: AccessLevel.Developer,
    usage: '/settheme <area> <key> <value>',
    help: 'Live-edit an environment theme value — re-skins every connected client.',
    run: (ctx) => {
      const [area, key] = ctx.args;
      const value = ctx.args.slice(2).join(' ');
      if (!area || !key || value === '') {
        return ctx.reply('Usage: /settheme <area> <key> <value>  (see /themekeys)');
      }
      ctx.reply(ctx.setTheme(area, key, value));
    },
  },
  {
    name: 'reloadcontent',
    minLevel: AccessLevel.Developer,
    usage: '/reloadcontent',
    help: 'Reload content from the DB and re-skin all clients (after direct SQL edits).',
    run: (ctx) => ctx.reply(ctx.reloadContent()),
  },

  // --- Developer (live editing for *everything* — the in-game content engine) -----------
  {
    name: 'tables',
    minLevel: AccessLevel.Developer,
    usage: '/tables',
    help: 'List the editable content tables (spells, items, monsters, quests, …).',
    run: (ctx) => ctx.reply(ctx.contentTables()),
  },
  {
    name: 'cols',
    minLevel: AccessLevel.Developer,
    usage: '/cols <table>',
    help: "List a table's editable columns and types.",
    run: (ctx) => {
      const table = ctx.args[0];
      if (!table) return ctx.reply('Usage: /cols <table>  (see /tables)');
      ctx.reply(ctx.contentColumns(table));
    },
  },
  {
    name: 'get',
    minLevel: AccessLevel.Developer,
    usage: '/get <table> [id]',
    help: 'Show a content row, or list ids when no id is given.',
    run: (ctx) => {
      const [table, id] = ctx.args;
      if (!table) return ctx.reply('Usage: /get <table> [id]  (see /tables)');
      ctx.reply(id ? ctx.contentRow(table, id) : ctx.contentRows(table));
    },
  },
  {
    name: 'set',
    minLevel: AccessLevel.Developer,
    usage: '/set <table> <id> <column> <value>',
    help: 'Live-edit any content value — applies immediately and reloads all clients.',
    run: (ctx) => {
      const [table, id, column] = ctx.args;
      const value = ctx.args.slice(3).join(' ');
      if (!table || !id || !column || value === '') {
        return ctx.reply('Usage: /set <table> <id> <column> <value>  (see /tables, /cols, /get)');
      }
      ctx.reply(ctx.setContent(table, id, column, value));
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
