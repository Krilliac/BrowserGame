import { createServer, type ServerResponse, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { InstanceManager, type InstancingMode } from './instance-manager.js';
import { newBotState, stepBot, type BotState, type BotView } from './bot-brain.js';
import {
  coordinateSquad,
  type SquadContext,
  type SquadMemberInput,
  type SquadMobInput,
} from './bot-squad.js';
import { SquadMetrics, writeReport, type RunSample } from './bot-metrics.js';
import { SKILL_TREE } from '../shared/skilltree.js';
import { sanitizeChat } from './chat.js';
import { TokenBucket } from './rate-limit.js';
import { runGuarded, GuardStats } from './resilience.js';
import {
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  decodeClient,
  encode,
  type EntityState,
  type ServerMessage,
} from '../shared/protocol.js';
import { isAbilityId, type AbilityId } from '../shared/combat.js';
import { initGameDb, getDb, getContent, reloadContent, type Content } from './content.js';
import { isCommand, runCommand } from './commands.js';
import { verifyLogin, setAccess, AccessLevel } from './accounts.js';
import { engineSchema, engineRows, setEngineConfig } from './engine.js';
import { editorWorld, parseEditBody } from './editor.js';
import { areaToTiled, type TiledMap } from './editor-tiled.js';
import { importTiled } from './editor-import.js';
import { EDITOR_HTML } from './editor-page.js';
import { tableToCsv } from './editor-csv.js';
import { auditContent } from './content-audit.js';
import {
  isValidToken,
  loadSave,
  newPlayerToken,
  storeSave,
  loadFriends,
  addFriend as dbAddFriend,
  removeFriend as dbRemoveFriend,
  createGuildRow,
  deleteGuildRow,
  guildName,
  guildOf,
  guildMembers,
  addGuildMemberRow,
  removeGuildMemberRow,
  setGuildRankRow,
  tokenForName,
  sendMail,
  loadMail,
  getMail,
  mailCount,
  deleteMail,
  auctionPayout,
  MAX_AUCTIONS_PER_SELLER,
  createAuction,
  loadAuctions,
  getAuction,
  auctionsBySeller,
  auctionCountBySeller,
  deleteAuction,
} from './player-store.js';
import { instanceName, type ItemInstance } from '../shared/items.js';
import { recordScore, formatLadder, isLeaderboardMetric } from './leaderboard.js';
import { activeEvents, totalXpBonus, totalGoldBonus, msUntilNextChange } from './game-events.js';
import { PartyRegistry } from './party.js';
import { SocialRegistry, type FriendStore } from './social.js';
import { GuildRegistry, type GuildStore, type GuildRank } from './guild.js';
import {
  ARTIFICER_REROLL_GOLD,
  ARTIFICER_UNSOCKET_GOLD,
  applyRuntimeConfig,
  type World,
} from './world.js';
import type { EngineResData, PartyMember } from '../shared/protocol.js';
import { morningDayIndex } from './area-corruption.js';
import { SpatialGrid } from './spatial.js';
import { THEME_KEYS, coerceThemeValue } from '../shared/theme.js';
import {
  listTables,
  listColumns,
  listRows,
  getRow,
  editContent,
  cloneRow,
  deleteRow,
} from './content-edit.js';

// Load all game content from SQLite (the source of truth). Defaults to ./game.db; the file is
// created and seeded from the built-in content on first run. Edit it with any SQLite tool.
// A failure here (corrupt/locked db file, bad permissions, an unmigratable schema) is fatal — the
// server has no content to serve — so fail loudly with a clear message instead of a raw stack.
let content: Content;
try {
  content = initGameDb(config.server.gameDbPath);
} catch (err) {
  console.error(
    `[browsergame] FATAL: could not open game database at "${config.server.gameDbPath}":`,
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
}
// initGameDb has overlaid the game_config tuning rows onto `config`; rebind the sim's tuning locals
// so the overlay takes effect on this run (the values below + world.ts are bound at module load).
applyRuntimeConfig();
console.log(
  `[browsergame] content loaded: ${content.areas().length} areas, ${content.abilityOrder().length} abilities`,
);
// Pre-encode the content packet — it's the same for every client and sent on connect, so the
// client mirrors the database (new areas/spells/items added via SQL render with no code change).
// Rebuilt and re-broadcast on a live content edit (theme changes, /reloadcontent), so the world
// re-skins everywhere without a reconnect.
let contentMessage = encodeContent();
function encodeContent(): string {
  const c = getContent();
  return encode({
    t: 'content',
    areas: c.areas(),
    abilities: c.abilityList(),
    items: c.items(),
    tints: c.spriteTints(),
    dungeons: c.dungeonAreaIds(),
    rarities: c.rarityTiers(),
    gems: c.gems(),
    affixNames: c.affixNames(),
    skillTree: c.skillTree(),
    itemSets: c.itemSets(),
  });
}

/** Re-read content from the DB, re-encode the packet, and push it to every connected client. */
function rebroadcastContent(): number {
  const c = reloadContent(); // also re-overlays game_config tuning onto `config`
  applyRuntimeConfig(); // push any changed tuning into the sim's bound locals (live game_config edits)
  contentMessage = encodeContent();
  for (const { socket } of players.values()) {
    if (socket.readyState === socket.OPEN) socket.send(contentMessage);
  }
  // Re-apply weather as gameplay modifiers on every running instance (live, not just visual).
  for (const instance of manager.list()) {
    instance.world.applyWeather(c.area(instance.areaId)?.theme?.weather ?? 'none');
  }
  return c.areas().length;
}

/**
 * Live-edit one environment-theme value: validate + clamp at the boundary (never trust the input),
 * upsert the single whitelisted column in area_theme, then reload + re-broadcast so every client
 * re-skins. The key is checked against THEME_KEYS, so interpolating it as a column name is safe.
 */
function applyThemeEdit(area: string, key: string, raw: string): string {
  if (!(key in THEME_KEYS)) return `Unknown theme key: ${key}. Try /themekeys.`;
  const value = coerceThemeValue(key, raw);
  if (value === null) return `Invalid value for ${key}: "${raw}".`;
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM areas WHERE id = ?').get(area)) return `No such area: ${area}`;
  const stored = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  db.prepare(
    `INSERT INTO area_theme (area_id, ${key}) VALUES (?, ?)
       ON CONFLICT(area_id) DO UPDATE SET ${key} = excluded.${key}`,
  ).run(area, stored);
  rebroadcastContent();
  return `Set ${area}.${key} = ${raw} — re-skinned all clients.`;
}

// Area-of-interest half-extents: each player is sent only entities within this box around them,
// generously larger than any viewport so nothing pops in at the screen edge.
const AOI_HALF_W = config.networking.aoiHalfWidth;
const AOI_HALF_H = config.networking.aoiHalfHeight;

// Invasion events: how often we roll, and the per-instance chance each roll.
const INVASION_INTERVAL_MS = config.invasion.intervalMs;
const INVASION_CHANCE = config.invasion.chance;

const PORT = config.server.port;
const TICK_RATE = config.server.tickRate;
const ENGINE_ADMIN_TOKEN = config.server.engineAdminToken;
const INSTANCING: InstancingMode = config.server.instancing;

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = join(here, '..', 'client'); // dist/client after build

const manager = new InstanceManager(INSTANCING);
/** Per-player connection state. instanceId is mutated on portal crossings; accessLevel via /login. */
const players = new Map<
  number,
  { socket: WebSocket; instanceId: string; accessLevel: number; token: string }
>();

// Host-level social state (parties + friends span instances, so they live above the per-instance
// World). The party registry is in-memory (session-scoped); friends persist to the content DB.
const parties = new PartyRegistry();
/** Instances whose World already has the party XP-share resolver installed (set once each). */
const resolverInstances = new Set<string>();
const friendStore: FriendStore = {
  load: (token) => loadFriends(getDb(), token),
  add: (token, name) => dbAddFriend(getDb(), token, name),
  remove: (token, name) => dbRemoveFriend(getDb(), token, name),
};
const social = new SocialRegistry(friendStore);

// Guilds: persistent societies (roster + ranks + guild chat), DB-backed via the GuildStore.
const guildStore: GuildStore = {
  create: (name) => createGuildRow(getDb(), name),
  delete: (guildId) => deleteGuildRow(getDb(), guildId),
  name: (guildId) => guildName(getDb(), guildId),
  guildOf: (token) => guildOf(getDb(), token),
  members: (guildId) =>
    guildMembers(getDb(), guildId).map((m) => ({
      token: m.token,
      name: m.name,
      rank: m.rank as GuildRank,
    })),
  add: (guildId, token, name, rank) => addGuildMemberRow(getDb(), guildId, token, name, rank),
  remove: (token) => removeGuildMemberRow(getDb(), token),
  setRank: (token, rank) => setGuildRankRow(getDb(), token, rank),
};
const guilds = new GuildRegistry(guildStore);

// AI bot players — real World player entities with no socket, driven each tick by a pure brain.
// Spawned via the GM `/bot` command so the world feels alive (and to test co-op solo).
interface BotRunner {
  /** The GM who spawned this bot — `/bot clear` only removes your own, wherever they've roamed. */
  owner: number;
  instanceId: string;
  state: BotState;
  seq: number;
  /** Next tick at which to run the (throttled) gear/spell/points upkeep. */
  upkeepAt: number;
  /** Last-tick alive→dead edge detector, so a death is recorded into the squad metrics exactly once. */
  wasDead: boolean;
}

/**
 * The bot advancement ladder: the areas a bot journeys through toward endgame, each with the
 * level it should reach before moving on. A bot grinds in milestone[i] until it hits `grad`, then
 * routes (via the live portal graph) to milestone[i+1] — leveling, gearing, and learning spells
 * the whole way out to the Unmade Court. The host BFS-routes between non-adjacent milestones, so
 * this is just the ORDER + pacing, not the connectivity.
 */
const BOT_ADVANCEMENT: { area: string; grad: number }[] = [
  { area: 'wilderness', grad: 6 },
  { area: 'marsh', grad: 11 },
  { area: 'mines', grad: 15 },
  { area: 'frostpeak', grad: 20 },
  { area: 'grimfrost_barrow', grad: 25 },
  { area: 'howling_barrens', grad: 29 },
  { area: 'sunken_pass', grad: 34 },
  { area: 'ashveil_desert', grad: 45 },
  { area: 'shattered_causeway', grad: 49 },
  { area: 'voidmarch', grad: 55 },
  { area: 'the_unmade_court', grad: 999 }, // the endgame — grind here forever
];

/** The area a bot of the given level should currently be working toward (the first unfinished rung). */
function botTargetArea(level: number): string {
  const rung =
    BOT_ADVANCEMENT.find((m) => level < m.grad) ?? BOT_ADVANCEMENT[BOT_ADVANCEMENT.length - 1]!;
  return rung.area;
}

/**
 * BFS the live portal graph for the first hop from `fromArea` toward `toArea`; returns the portal
 * in `fromArea` to walk into (its rect, already world-scaled), or undefined if same/unreachable.
 */
function nextPortalHop(fromArea: string, toArea: string): { x: number; y: number } | undefined {
  if (fromArea === toArea) return undefined;
  const c = getContent();
  // BFS recording, for each discovered area, the FIRST area stepped to from the source.
  const firstStep = new Map<string, string>(); // discoveredArea -> the area id of fromArea's portal
  const queue: string[] = [];
  for (const p of c.area(fromArea)?.portals ?? []) {
    if (!firstStep.has(p.toArea)) {
      firstStep.set(p.toArea, p.toArea);
      queue.push(p.toArea);
    }
  }
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === toArea) break;
    for (const p of c.area(cur)?.portals ?? []) {
      if (!firstStep.has(p.toArea)) {
        firstStep.set(p.toArea, firstStep.get(cur)!);
        queue.push(p.toArea);
      }
    }
  }
  const hopArea = firstStep.get(toArea);
  if (!hopArea) return undefined;
  const portal = (c.area(fromArea)?.portals ?? []).find((p) => p.toArea === hopArea);
  if (!portal) return undefined;
  return { x: portal.rect.x + portal.rect.w / 2, y: portal.rect.y + portal.rect.h / 2 };
}

/**
 * Throttled upkeep so a bot actually GROWS: equip any bag gear that beats what's worn, read any
 * spell tome in the bag, and spend attribute + skill points. Runs ~once a second per bot.
 */
function botUpkeep(world: World, id: number): void {
  const stats = world.playerStats(id);
  if (!stats) return;
  const c = getContent();
  // Learn every tome held (materials map keys like 'tome_fireball').
  for (const itemId of Object.keys(stats.loot)) {
    if (itemId.startsWith('tome_')) world.learn(id, itemId);
  }
  // Equip any bag piece that scores higher than the one in its slot.
  const score = (it: { power: number; hp: number; affixes: { value: number }[] }): number =>
    it.power + it.hp * 0.5 + it.affixes.reduce((s, a) => s + a.value, 0);
  for (const item of stats.gear) {
    const slot = c.item(item.baseId)?.slot;
    if (!slot) continue;
    const worn = stats.equipment[slot as keyof typeof stats.equipment];
    if (!worn || score(item) > score(worn)) world.equip(id, item.uid);
  }
  // Spend points: strength + vitality (offense + survivability) alternately; first allocatable node.
  for (let i = 0; i < stats.attrPoints; i++) {
    world.allocateAttribute(id, i % 2 === 0 ? 'strength' : 'vitality');
  }
  if (stats.skillPoints > 0) {
    for (const node of SKILL_TREE) {
      const before = world.playerStats(id)?.skillPoints ?? 0;
      world.allocateSkill(id, node.id);
      if ((world.playerStats(id)?.skillPoints ?? 0) < before) break; // one allocated — done this pass
    }
  }
}
const bots = new Map<number, BotRunner>();
/** One run recorder per owner (the GM who spawned the squad). Created on first spawn, dropped on clear. */
const squadMetrics = new Map<number, SquadMetrics>();
/** Instances where the final boss (Athraxis) was alive last tick — for the alive→gone kill edge. */
const bossAliveIn = new Set<string>();
/** Next tick at which to sample squad metrics, per owner (throttled to ~2s). */
const metricsSampleAt = new Map<number, number>();
/** The current sim clock in ms (tick × ms/tick) — reproducible regardless of wall-clock / tick rate. */
function simMs(): number {
  return tick * (1000 / TICK_RATE);
}

/** Shape an active event for the `events` packet, omitting absent bonus fields (exactOptionalProps). */
function eventBadge(e: { id: string; name: string; xpBonus?: number; goldBonus?: number }): {
  id: string;
  name: string;
  xpBonus?: number;
  goldBonus?: number;
} {
  return {
    id: e.id,
    name: e.name,
    ...(e.xpBonus !== undefined ? { xpBonus: e.xpBonus } : {}),
    ...(e.goldBonus !== undefined ? { goldBonus: e.goldBonus } : {}),
  };
}
const BOT_NAMES = [
  'Roan',
  'Mira',
  'Korg',
  'Sable',
  'Pip',
  'Vex',
  'Tula',
  'Bran',
  'Nyx',
  'Hale',
  'Wren',
  'Orin',
];

/** Spawn `count` AI bot players directly into the owner's instance (cap-bypassing, so a big
 *  flood lands right in your world); returns how many actually joined. */
function spawnBots(owner: number, instanceId: string, count: number): number {
  if (!manager.get(instanceId)) return 0;
  let spawned = 0;
  for (let i = 0; i < count; i++) {
    const name = BOT_NAMES[(bots.size + i) % BOT_NAMES.length] ?? `Bot${bots.size + i}`;
    const placement = manager.joinInstance(instanceId, name);
    if (!placement) break;
    bots.set(placement.entityId, {
      owner,
      instanceId: placement.instanceId,
      state: newBotState(placement.entityId),
      seq: 0,
      upkeepAt: 0,
      wasDead: false,
    });
    spawned++;
  }
  // Start (or extend) this owner's run recorder so the whole journey to endgame is measured.
  if (spawned > 0) {
    const names = [...bots]
      .filter(([, b]) => b.owner === owner)
      .map(([id]) => manager.get(bots.get(id)!.instanceId)?.world.nameOf(id) ?? `Bot${id}`);
    const existing = squadMetrics.get(owner);
    if (existing) existing.setMembers(names);
    else squadMetrics.set(owner, new SquadMetrics(owner, names, simMs()));
  }
  return spawned;
}

/**
 * Despawn bots. Scoped by OWNER: a GM's `/bot clear` only removes the bots they spawned (wherever
 * those have roamed), never another GM's — so cross-instance bot removal isn't possible. An
 * undefined owner clears all (host shutdown / admin sweep only, never the player command).
 */
function clearBots(owner?: number): number {
  let removed = 0;
  for (const [id, b] of [...bots]) {
    if (owner !== undefined && b.owner !== owner) continue;
    manager.remove(b.instanceId, id);
    bots.delete(id);
    removed++;
  }
  // Drop the run recorder(s) for the cleared owner(s) so a fresh squad starts a fresh measurement.
  if (owner !== undefined) {
    squadMetrics.delete(owner);
    metricsSampleAt.delete(owner);
  } else {
    squadMetrics.clear();
    metricsSampleAt.clear();
  }
  return removed;
}

/** Write `owner`'s current squad run report to disk and return a one-line summary (or null). */
function botReport(owner: number): string | null {
  const m = squadMetrics.get(owner);
  if (!m) return null;
  const r = m.report();
  const { md } = writeReport(r);
  const top = r.findings[0]?.detail ?? 'no findings yet';
  return `Run report written to ${md} — ${r.bossKilled ? 'boss DOWN' : 'in progress'}, avg L${r.finalLevelAvg.toFixed(0)}, ${r.deaths.length} death(s). Top finding: ${top}`;
}

/** Drive every bot one tick: build a brain view from its world, apply the decision. Cheap — bots
 *  are few, and each only sees mobs/items near itself. Bots follow portals like real players via
 *  the transfer path (their instanceId is refreshed below when the manager moves them). */
function driveBots(): void {
  // Bots cross portals/dens like anyone else; the transfer loop updates routing for sockets but
  // not bots, so resync each bot's instance from where the manager currently holds its entity.
  for (const [id, b] of bots) {
    const inst = manager
      .list()
      .find((i) => i.world.playerStats(id) !== undefined && manager.playerIdsIn(i.id).includes(id));
    if (inst) b.instanceId = inst.id;
  }
  const byInstance = new Map<string, number[]>();
  for (const [id, b] of bots)
    byInstance.set(b.instanceId, [...(byInstance.get(b.instanceId) ?? []), id]);
  const now = simMs();
  for (const [instanceId, ids] of byInstance) {
    const world = manager.get(instanceId)?.world;
    if (!world) continue;
    const areaId = manager.get(instanceId)!.areaId;
    const snap = world.snapshot();
    const mobs = snap.filter((e) => e.kind === 'mob' && e.hp > 0);
    const items = snap.filter((e) => e.kind === 'item');
    const area = getContent().area(areaId);

    // Group this instance's bots by owner — each owner's bots in here form one cooperating squad.
    const squadIds = new Map<number, number[]>();
    for (const id of ids) {
      const o = bots.get(id)!.owner;
      squadIds.set(o, [...(squadIds.get(o) ?? []), id]);
    }
    // The mobs every squad here can see, in the shared coordination shape (boss = a big-HP target).
    const squadMobs: SquadMobInput[] = mobs.map((m) => ({
      id: m.id,
      x: m.x,
      y: m.y,
      hp: m.hp,
      level: m.level,
      boss: m.maxHp >= 1500,
      elite: m.elite === true,
    }));

    for (const [, memberIds] of squadIds) {
      // Build the squad's member view, then coordinate roles / focus-fire / regroup for this tick.
      const members: SquadMemberInput[] = [];
      for (const id of memberIds) {
        const st = world.playerStats(id);
        const e = snap.find((s) => s.id === id);
        if (!st || !e) continue;
        const hasHeal = Object.keys(st.known).some(
          (aid) => getContent().ability(aid as AbilityId)?.kind === 'heal',
        );
        members.push({
          id,
          x: e.x,
          y: e.y,
          hpFrac: st.maxHp > 0 ? st.hp / st.maxHp : 0,
          maxHp: st.maxHp,
          level: st.level,
          dead: st.dead,
          hasHeal,
        });
      }
      const ctx: SquadContext = coordinateSquad(members, squadMobs);
      // The squad heads to the same milestone, paced by its SLOWEST living member, so nobody runs
      // ahead to endgame solo — they level and travel as a group.
      const livingLevels = members.filter((m) => !m.dead).map((m) => m.level);
      const squadLevel = livingLevels.length ? Math.min(...livingLevels) : (members[0]?.level ?? 1);

      for (const id of memberIds) {
        const stats = world.playerStats(id);
        const me = snap.find((e) => e.id === id);
        const b = bots.get(id)!;
        if (!stats || !me) continue;

        // Grow: equip/learn/spend-points on a ~1s throttle (cheap, and keeps the bot relevant).
        if (tick >= b.upkeepAt) {
          botUpkeep(world, id);
          b.upkeepAt = tick + TICK_RATE;
        }

        // Record the alive→dead edge into the run metrics, blaming the nearest mob at the death site.
        if (stats.dead && !b.wasDead) {
          squadMetrics.get(b.owner)?.noteDeath({
            simMs: now,
            name: world.nameOf(id) ?? `Bot${id}`,
            area: areaId,
            level: stats.level,
            cause: nearestMobName(mobs, me.x, me.y),
          });
        }
        b.wasDead = stats.dead;

        // Journey toward endgame: head for the portal leading to the next milestone area; once
        // standing in the milestone area itself, drop the goal and grind it to graduation.
        const target = botTargetArea(squadLevel);
        const goal = areaId === target ? undefined : nextPortalHop(areaId, target);
        const squadView: NonNullable<BotView['squad']> = { role: ctx.role.get(id) ?? 'dps' };
        if (ctx.focusTarget) squadView.focusTarget = ctx.focusTarget;
        if (ctx.rally) squadView.rally = ctx.rally;
        const view: BotView = {
          self: {
            x: me.x,
            y: me.y,
            hp: stats.hp,
            maxHp: stats.maxHp,
            mana: stats.mana,
            maxMana: stats.maxMana,
            level: stats.level,
            dead: stats.dead,
          },
          abilities: Object.keys(stats.known).flatMap((aid) => {
            const a = getContent().ability(aid as AbilityId);
            // Bots only reason about direct-attack/heal spells; summon (and any future) kinds are
            // skipped so the BotAbilityView union stays the combat subset the brain understands.
            if (!a || (a.kind !== 'melee' && a.kind !== 'projectile' && a.kind !== 'heal'))
              return [];
            return [
              {
                id: aid,
                kind: a.kind,
                damage: a.damage,
                range: a.range,
                manaCost: a.manaCost,
                cooldownReady: true, // world.cast re-gates cooldown; pass-through is fine
              },
            ];
          }),
          mobs: mobs
            .filter((m) => Math.hypot(m.x - me.x, m.y - me.y) < 700)
            .map((m) => ({ id: m.id, x: m.x, y: m.y, hp: m.hp })),
          items: items
            .filter((it) => Math.hypot(it.x - me.x, it.y - me.y) < 400)
            .map((it) => ({ id: it.id, x: it.x, y: it.y })),
          width: area?.width ?? 1600,
          height: area?.height ?? 1200,
          potions: stats.potions,
          squad: squadView,
          ...(goal ? { goal } : {}),
        };
        const decision = stepBot(view, b.state, now);
        world.setInput(id, decision.input, ++b.seq);
        if (decision.cast) {
          world.cast(id, decision.cast.ability as AbilityId, decision.cast.dx, decision.cast.dy);
        }
        if (decision.usePotion) world.usePotion(id, decision.usePotion);
      }
    }

    // Final-boss watch: when Athraxis was alive here last tick and is now gone, the squad won.
    detectBossKill(instanceId, snap, now);
  }

  sampleSquadMetrics();
}

/** Final boss identity (template `athraxis`) — detected by name in the endgame instance snapshot. */
const FINAL_BOSS_NAME = 'Athraxis, the Unmade God';

/** Detect the alive→gone edge of the final boss in an instance and credit the squads present. */
function detectBossKill(instanceId: string, snap: EntityState[], nowMs: number): void {
  const bossAlive = snap.some((e) => e.kind === 'mob' && e.name === FINAL_BOSS_NAME && e.hp > 0);
  if (bossAlive) {
    bossAliveIn.add(instanceId);
    return;
  }
  if (!bossAliveIn.delete(instanceId)) return; // wasn't tracking a live boss here
  const owners = new Set(
    [...bots].filter(([, b]) => b.instanceId === instanceId).map(([, b]) => b.owner),
  );
  for (const owner of owners) {
    const m = squadMetrics.get(owner);
    if (!m || m.bossKilled) continue;
    m.noteBossKill(nowMs);
    const { md, json } = writeReport(m.report());
    const r = m.report();
    console.log(
      `[botrun] Squad ${r.members.join('/')} KILLED the final boss in ${fmtRunDur(r.totalMs)} ` +
        `(avg L${r.finalLevelAvg.toFixed(0)}, ${r.deaths.length} deaths, ${r.bossAttempts} boss attempts). ` +
        `Report: ${md} + ${json}`,
    );
  }
}

/** Nearest living mob's display name to a point — the best-effort "cause of death". */
function nearestMobName(mobs: EntityState[], x: number, y: number): string {
  let name = 'unknown';
  let best = Infinity;
  for (const m of mobs) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < best) {
      best = d;
      name = m.name || 'unknown';
    }
  }
  return name;
}

/** Equipped-gear score (mirrors the bot's equip heuristic): power + hp·0.5 + Σ affix value. */
type GearLike = { power: number; hp: number; affixes: { value: number }[] };
function gearScoreOf(equipment: object): number {
  let s = 0;
  for (const it of Object.values(equipment) as (GearLike | undefined)[]) {
    if (it) s += it.power + it.hp * 0.5 + it.affixes.reduce((a, x) => a + x.value, 0);
  }
  return s;
}

/** Throttled per-owner progression sampling, aggregated across every instance the squad is split over. */
function sampleSquadMetrics(): void {
  for (const [owner, m] of squadMetrics) {
    if (tick < (metricsSampleAt.get(owner) ?? 0)) continue;
    metricsSampleAt.set(owner, tick + TICK_RATE * 2); // ~once every 2s of sim time
    let n = 0;
    let alive = 0;
    let lvlSum = 0;
    let lvlMin = Infinity;
    let lvlMax = 0;
    let goldSum = 0;
    let gearSum = 0;
    let xpSum = 0;
    const areaCount = new Map<string, number>();
    for (const [id, b] of bots) {
      if (b.owner !== owner) continue;
      const w = manager.get(b.instanceId)?.world;
      const st = w?.playerStats(id);
      if (!st) continue;
      n++;
      if (!st.dead) alive++;
      lvlSum += st.level;
      lvlMin = Math.min(lvlMin, st.level);
      lvlMax = Math.max(lvlMax, st.level);
      goldSum += st.gold;
      xpSum += st.xp;
      gearSum += gearScoreOf(st.equipment);
      const a = manager.get(b.instanceId)?.areaId ?? '?';
      areaCount.set(a, (areaCount.get(a) ?? 0) + 1);
    }
    if (!n) continue;
    let area = '?';
    let top = -1;
    for (const [a, c] of areaCount) {
      if (c > top) {
        area = a;
        top = c;
      }
    }
    const sample: RunSample = {
      simMs: simMs(),
      area,
      alive,
      lvlAvg: lvlSum / n,
      lvlMin: lvlMin === Infinity ? 0 : lvlMin,
      lvlMax,
      goldSum,
      gearAvg: gearSum / n,
      xpSum,
    };
    m.sample(sample);
  }
}

/** Compact duration for the boss-kill log line (mirrors bot-metrics' formatting). */
function fmtRunDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return h > 0
    ? `${h}h ${String(mm).padStart(2, '0')}m`
    : `${mm}m ${String(s % 60).padStart(2, '0')}s`;
}

/** The display name of a connected player (from their instance's World), or undefined. */
function nameOf(id: number): string | undefined {
  const p = players.get(id);
  return p ? manager.get(p.instanceId)?.world.nameOf(id) : undefined;
}

/** Find a connected player's entity id by display name (case-insensitive), or undefined. */
function findPlayerByName(name: string): number | undefined {
  const lower = name.trim().toLowerCase();
  if (!lower) return undefined;
  for (const id of players.keys()) {
    if (nameOf(id)?.toLowerCase() === lower) return id;
  }
  return undefined;
}

/** The connected entity id for an owner token, or undefined (for friend-presence pushes). */
function idForToken(token: string): number | undefined {
  for (const [id, p] of players) if (p.token === token) return id;
  return undefined;
}

/** Send one message to the online player holding `token`, if any (guild fan-out helper). */
function sendToToken(token: string, msg: Parameters<typeof send>[1]): void {
  const id = idForToken(token);
  const conn = id !== undefined ? players.get(id) : undefined;
  if (conn) send(conn.socket, msg);
}

/** Broadcast a guild chat line to every ONLINE member of the guild that `token` belongs to. */
function guildBroadcast(token: string, from: string, text: string): void {
  for (const memberToken of guilds.memberTokens(token)) {
    sendToToken(memberToken, { t: 'chat', from, text, channel: 'guild' });
  }
}

/** Resolve a guild member's token by display name within `byToken`'s guild (works for offline members). */
function guildMemberTokenByName(byToken: string, name: string): string | undefined {
  const lower = name.trim().toLowerCase();
  return guilds.roster(byToken)?.members.find((m) => m.name.toLowerCase() === lower)?.token;
}

/** Largest inbox per recipient (anti-spam / anti-hoard). */
const MAX_MAIL = 30;
/** Upper clamp on a single mail/auction gold value — defensive bound (the wallet is the real gate). */
const MAX_TRADE_GOLD = 1_000_000_000;

/**
 * Send mail: take the gold (+ optional bag item by uid) from the sender's live World, resolve the
 * recipient's persistent token (online presence first, else the most-recent save by name), and
 * queue an inbox row. Refunds anything already taken if a later check fails, so no gold/item is lost.
 */
function mailSend(
  world: World,
  senderId: number,
  senderToken: string,
  senderName: string,
  toName: string,
  gold: number,
  uid?: number,
): string {
  const amount = Math.min(MAX_TRADE_GOLD, Math.max(0, Math.floor(gold) || 0));
  const toToken = social.findOnline(toName)?.token ?? tokenForName(getDb(), toName);
  if (!toToken) return 'No such player (they must have played here).';
  if (toToken === senderToken) return 'You cannot mail yourself.';
  if (amount === 0 && uid === undefined) return 'Attach some gold or an item.';
  if (mailCount(getDb(), toToken) >= MAX_MAIL) return 'Their mailbox is full.';

  // Take the item first (it can fail cleanly before any gold moves), then the gold.
  const item = uid !== undefined ? world.mailTakeGear(senderId, uid) : null;
  if (uid !== undefined && !item) return 'No such item in your bag.';
  if (amount > 0 && !world.mailTakeGold(senderId, amount)) {
    if (item) world.mailDeliver(senderId, 0, item); // give the item back — nothing lost
    return `You don't have ${amount}g.`;
  }
  sendMail(getDb(), toToken, senderName, amount, item ? JSON.stringify(item) : null);
  sendToToken(toToken, {
    t: 'chat',
    from: 'System',
    text: `You have new mail from ${senderName} — /mail to read it.`,
    channel: 'system',
  });
  return `Mail sent to ${toName}.`;
}

/** Collect one piece of mail into the collector's live World bag (deletes it on success). */
function mailTake(collectorId: number, token: string, world: World, id: number): string {
  const m = getMail(getDb(), id, token);
  if (!m) return 'No such mail.';
  let item: ItemInstance | null = null;
  if (m.itemJson) {
    try {
      item = JSON.parse(m.itemJson) as ItemInstance;
    } catch {
      item = null; // corrupt payload — drop the item but still release the gold + clear the row
    }
  }
  const r = world.mailDeliver(collectorId, m.gold, item);
  if (!r.ok) return r.reason ?? 'Could not collect.';
  deleteMail(getDb(), id);
  const got: string[] = [];
  if (m.gold > 0) got.push(`${m.gold}g`);
  if (item) got.push('an item');
  return `Collected ${got.join(' + ') || 'mail'}.`;
}

/** A short, readable name for an item held in an auction listing (e.g. "Rare Iron Sword"). */
function describeAuctionItem(itemJson: string): string {
  try {
    const inst = JSON.parse(itemJson) as ItemInstance;
    return instanceName(inst, getContent().item(inst.baseId)?.name ?? inst.baseId);
  } catch {
    return 'an item';
  }
}

/** List a bag gear instance on the auction house (escrow it out of the seller's live bag). */
function auctionList(
  world: World,
  sellerId: number,
  sellerToken: string,
  sellerName: string,
  uid: number,
  price: number,
): string {
  const amount = Math.min(MAX_TRADE_GOLD, Math.floor(price) || 0);
  if (amount <= 0) return 'Set a buyout price above 0.';
  if (auctionCountBySeller(getDb(), sellerToken) >= MAX_AUCTIONS_PER_SELLER) {
    return `You already have ${MAX_AUCTIONS_PER_SELLER} listings.`;
  }
  const item = world.mailTakeGear(sellerId, uid);
  if (!item) return 'No such item in your bag.';
  const id = createAuction(getDb(), sellerToken, sellerName, JSON.stringify(item), amount);
  return `Listed ${describeAuctionItem(JSON.stringify(item))} for ${amount}g (#${id}).`;
}

/** Buy a listing: pay gold, receive the item, mail the seller the proceeds (minus the house cut). */
function auctionBuy(world: World, buyerId: number, buyerToken: string, id: number): string {
  const a = getAuction(getDb(), id);
  if (!a) return 'No such listing (it may have sold).';
  if (a.sellerToken === buyerToken) return 'That is your own listing — use /ah cancel.';
  let item: ItemInstance | null = null;
  try {
    item = JSON.parse(a.itemJson) as ItemInstance;
  } catch {
    item = null;
  }
  if (!item) {
    deleteAuction(getDb(), id); // corrupt listing — clear it
    return 'That listing is invalid.';
  }
  if (!world.mailTakeGold(buyerId, a.price)) return `You need ${a.price}g.`;
  const delivered = world.mailDeliver(buyerId, 0, item);
  if (!delivered.ok) {
    world.mailDeliver(buyerId, a.price, null); // refund — nothing lost
    return delivered.reason ?? 'Your bag is full.';
  }
  const payout = auctionPayout(a.price);
  sendMail(
    getDb(),
    a.sellerToken,
    'Auction House',
    payout,
    null,
    `Sold: ${describeAuctionItem(a.itemJson)}`,
  );
  deleteAuction(getDb(), id);
  sendToToken(a.sellerToken, {
    t: 'chat',
    from: 'System',
    text: `Your auction sold for ${a.price}g (${payout}g after fees) — collect it with /mail.`,
    channel: 'system',
  });
  return `Bought ${describeAuctionItem(a.itemJson)} for ${a.price}g.`;
}

/** Cancel your own listing: the escrowed item is mailed back to you. */
function auctionCancel(token: string, id: number): string {
  const a = getAuction(getDb(), id);
  if (!a) return 'No such listing.';
  if (a.sellerToken !== token) return 'That is not your listing.';
  sendMail(getDb(), token, 'Auction House', 0, a.itemJson, 'Listing cancelled');
  deleteAuction(getDb(), id);
  return 'Listing cancelled — the item is mailed back to you.';
}

/** Build the roster entry for one party member (members are always connected — see disconnect). */
function partyMemberInfo(memberId: number): PartyMember | null {
  const conn = players.get(memberId);
  if (!conn) return null;
  const inst = manager.get(conn.instanceId);
  const name = inst?.world.nameOf(memberId);
  if (!name) return null;
  const stats = inst?.world.playerStats(memberId);
  return {
    id: memberId,
    name,
    level: stats?.level ?? 1,
    hp: stats?.hp ?? 0,
    maxHp: stats?.maxHp ?? 1,
    areaId: inst?.areaId ?? '',
    online: true,
    leader: parties.partyOf(memberId)?.leaderId === memberId,
  };
}

/** Send a player their current party state (roster + any pending invite). */
function sendPartyState(playerId: number): void {
  const conn = players.get(playerId);
  if (!conn) return;
  const party = parties.partyOf(playerId);
  const members = party
    ? party.memberIds.map(partyMemberInfo).filter((m): m is PartyMember => m !== null)
    : [];
  const invite = parties.pendingInvite(playerId);
  const inviteFrom = invite ? nameOf(invite.fromId) : undefined;
  send(conn.socket, inviteFrom ? { t: 'party', members, inviteFrom } : { t: 'party', members });
}

/** One-invite-per-second cooldown per player (sim-clock ms), to stop trade-invite popup spam. */
const tradeInviteAt = new Map<number, number>();

/** Send the current trade table to BOTH participants (so confirmations stay honest on each side). */
function sendTradeState(world: World, anyParticipantId: number): void {
  const s = world.tradeStateFor(anyParticipantId);
  if (!s) return;
  const stateMsg: ServerMessage = {
    t: 'trade_state',
    aId: s.aId,
    bId: s.bId,
    aGold: s.aOffer.gold,
    aItemUids: s.aOffer.itemUids,
    bGold: s.bOffer.gold,
    bItemUids: s.bOffer.itemUids,
    aConfirmed: s.aConfirmed,
    bConfirmed: s.bConfirmed,
  };
  for (const id of [s.aId, s.bId]) {
    const c = players.get(id);
    if (c) send(c.socket, stateMsg);
  }
}

/** Send a player their friends list with live presence. */
function sendFriends(playerId: number): void {
  const conn = players.get(playerId);
  if (!conn) return;
  send(conn.socket, { t: 'friends', list: social.friendsOf(conn.token) });
}

/** Re-push friends lists to everyone who has `name` on their list (presence just changed). */
function notifyFriendWatchers(name: string): void {
  for (const token of social.watchersOf(name)) {
    const id = idForToken(token);
    if (id !== undefined) sendFriends(id);
  }
}

/** Send a System line on the party channel to a set of party member ids. */
function broadcastToParty(memberIds: number[], text: string): void {
  for (const id of memberIds) {
    const conn = players.get(id);
    if (conn) send(conn.socket, { t: 'chat', from: 'System', text, channel: 'party' });
  }
}

// --- HTTP: health check + static hosting of the built client in production -----------
const http = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        ok: true,
        players: players.size,
        instances: manager.instanceCount,
        instancing: INSTANCING,
        tickRate: TICK_RATE,
        guardErrors: guardStats.total(),
        guards: guardStats.top(5),
      }),
    );
    return;
  }
  // Editor world export (slice 1 of the in-browser editor): the full data-driven content model as
  // JSON — the source an editor UI loads and an exporter walks toward other engines. Dev-gated by the
  // ENGINE_ADMIN_TOKEN (same gate as the engine panel) so it never leaks on a normal player path; if
  // the token is unset the route is disabled entirely.
  if ((req.url ?? '').split('?')[0] === '/editor/world.json') {
    const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? '';
    if (ENGINE_ADMIN_TOKEN === '' || token !== ENGINE_ADMIN_TOKEN) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden: set ENGINE_ADMIN_TOKEN and pass ?token=' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(editorWorld()));
    return;
  }
  // Editor content audit: GET /editor/audit.json?token=… — live cross-reference integrity scan so a
  // designer editing via the editor catches broken refs immediately. Dev-gated.
  if ((req.url ?? '').split('?')[0] === '/editor/audit.json') {
    const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? '';
    if (ENGINE_ADMIN_TOKEN === '' || token !== ENGINE_ADMIN_TOKEN) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden: set ENGINE_ADMIN_TOKEN and pass ?token=' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(auditContent()));
    return;
  }
  // Editor CSV export: GET /editor/table/<name>.csv?token=… — a table as a spreadsheet. Dev-gated;
  // the name is registry-validated inside tableToCsv (unknown/forged → 404).
  const csv = /^\/editor\/table\/([A-Za-z0-9_]+)\.csv$/.exec((req.url ?? '').split('?')[0] ?? '');
  if (csv) {
    const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? '';
    if (ENGINE_ADMIN_TOKEN === '' || token !== ENGINE_ADMIN_TOKEN) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden: set ENGINE_ADMIN_TOKEN and pass ?token=' }));
      return;
    }
    const out = tableToCsv(csv[1]!);
    if (out === null) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `unknown/non-editable table: ${csv[1]}` }));
      return;
    }
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${csv[1]}.csv"`,
    });
    res.end(out);
    return;
  }
  // The editor UI page itself (the shell carries no secrets; its data calls send the token).
  if ((req.url ?? '').split('?')[0] === '/editor') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(EDITOR_HTML);
    return;
  }
  // Editor cell edit: POST /editor/edit?token=… {table,id,column,value} (dev-gated). Validated +
  // clamped by content-edit; reloads + re-broadcasts so the change applies live.
  if ((req.url ?? '').split('?')[0] === '/editor/edit') {
    const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? '';
    if (ENGINE_ADMIN_TOKEN === '' || token !== ENGINE_ADMIN_TOKEN) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'forbidden: set ENGINE_ADMIN_TOKEN' }));
      return;
    }
    const req2 = parseEditBody(await readJsonBody(req));
    if (!req2) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, message: 'bad edit body' }));
      return;
    }
    const out = editContent(req2.table, req2.id, req2.column, req2.value);
    if (out.ok) rebroadcastContent();
    res.writeHead(out.ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
    return;
  }
  // Editor row create (clone) + delete: POST /editor/clone {table,id,newId?} / /editor/delete
  // {table,id} (dev-gated). Clone duplicates a row under a new pk; delete removes one (FK-guarded).
  {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/editor/clone' || path === '/editor/delete') {
      const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? '';
      if (ENGINE_ADMIN_TOKEN === '' || token !== ENGINE_ADMIN_TOKEN) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'forbidden: set ENGINE_ADMIN_TOKEN' }));
        return;
      }
      const body = (await readJsonBody(req)) as { table?: unknown; id?: unknown; newId?: unknown };
      const table = typeof body?.table === 'string' ? body.table : '';
      const id = body?.id === undefined || body?.id === null ? '' : String(body.id);
      if (!table || !id) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, message: 'need {table, id}' }));
        return;
      }
      const out =
        path === '/editor/clone'
          ? cloneRow(table, id, typeof body.newId === 'string' ? body.newId : undefined)
          : deleteRow(table, id);
      if (out.ok) rebroadcastContent();
      res.writeHead(out.ok ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
      return;
    }
  }
  // Tiled .tmj export of one area: GET /editor/area/<id>.tmj?token=… (dev-gated). The cross-engine
  // bridge — the returned map imports into Tiled/Godot/Unity/GameMaker/001.
  const tmj = /^\/editor\/area\/([A-Za-z0-9_]+)\.tmj$/.exec((req.url ?? '').split('?')[0] ?? '');
  if (tmj) {
    const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? '';
    if (ENGINE_ADMIN_TOKEN === '' || token !== ENGINE_ADMIN_TOKEN) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden: set ENGINE_ADMIN_TOKEN and pass ?token=' }));
      return;
    }
    // POST = import a Tiled map back into the area's content (decor/spawns/npcs); GET = export.
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      if (!body) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad or oversized JSON body' }));
        return;
      }
      const result = importTiled(body as TiledMap);
      if (result.ok) rebroadcastContent(); // reload + re-skin connected clients
      res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
    const map = areaToTiled(tmj[1]!);
    if (!map) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `unknown area: ${tmj[1]}` }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(map));
    return;
  }
  await serveStatic(req.url ?? '/', res);
});

/** Read a JSON request body (capped), or null on parse error / oversize. For the editor import POST. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const MAX = 8 * 1024 * 1024; // 8 MB — generous for a map, bounded against a memory-flood
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

async function serveStatic(url: string, res: ServerResponse): Promise<void> {
  // Decide "is this the site root?" from the RAW url, before normalize() — on Windows
  // normalize('/') returns '\\', so a post-normalize `=== '/'` check misses root and we'd try to
  // read the client directory itself (404). Strip the query, then treat '/' (or empty) as index.html.
  const raw = (url.split('?')[0] ?? '/').split('#')[0] ?? '/';
  const isRoot = raw === '/' || raw === '';
  const safePath = normalize(raw).replace(/^(\.\.[/\\])+/, '');
  const target = join(clientDir, isRoot ? 'index.html' : safePath);
  try {
    const data = await readFile(target);
    res.writeHead(200, { 'content-type': contentType(target) });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found. In dev, open the Vite url (npm run dev) instead.');
  }
}

function contentType(path: string): string {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.wav': 'audio/wav',
    '.json': 'application/json',
  };
  return types[extname(path)] ?? 'application/octet-stream';
}

// --- WebSocket: the live game connection ----------------------------------------------
// maxPayload caps frame size so a single client can't send a giant message (DoS guard).
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_MESSAGE_BYTES });

// A server-level ws error (distinct from the per-socket 'error' handled on each connection) is
// emitted on the WebSocketServer itself; with no handler Node rethrows it and the process dies.
// Log and keep serving — one transport hiccup must not take the whole world down.
wss.on('error', (err) => {
  console.error('[ws] server error:', err instanceof Error ? err.message : err);
});

// Heartbeat: ping every socket periodically; a client that misses a pong (tab closed abruptly, a
// reload, a dropped network) is terminated so its player entity is removed promptly instead of
// lingering as an idle "ghost" until TCP times out. (This is what piled up dozens of stale players.)
const HEARTBEAT_MS = config.server.heartbeatMs;
const alive = new WeakSet<WebSocket>();
setInterval(() => {
  for (const client of wss.clients) {
    if (!alive.has(client)) {
      client.terminate(); // missed the last ping → dead; terminate fires 'close' → removes player
      continue;
    }
    alive.delete(client);
    client.ping();
  }
}, HEARTBEAT_MS);

// Tracks how often each guarded unit of work throws, for the /health readout.
const guardStats = new GuardStats();

// Last-resort safety net. The tick loop, message dispatch, and command handlers are each guarded,
// but a stray throw/rejection from outside those scopes (a timer callback, a library emit, an async
// gap) would otherwise crash the whole process and disconnect every player. A long-lived game server
// should survive that: log it under a stable label, count it for the /health readout, and stay up.
process.on('uncaughtException', (err) => {
  console.error('[uncaught]', err);
  guardStats.record('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  guardStats.record('unhandledRejection');
});

wss.on('connection', (socket) => {
  let entityId = 0;
  alive.add(socket);
  socket.on('pong', () => alive.add(socket));
  // A per-socket error (e.g. `ws` rejecting an oversized inbound frame past maxPayload) is emitted
  // as an 'error' event; with no handler Node rethrows it and the whole process dies. A single
  // hostile client must never crash the server — log and drop just that connection.
  socket.on('error', (err) => {
    console.warn('[ws] socket error, terminating connection:', (err as Error).message);
    socket.terminate();
  });
  socket.send(contentMessage); // hand the client the game content first
  // Per-connection rate limits. Every client is untrusted: a single socket must not be
  // able to flood the simulation or chat. Generous for input, tight for chat.
  const messageBucket = new TokenBucket(80, 80);
  const chatBucket = new TokenBucket(5, 1);
  // Malformed-message strikes (the wasmbots discipline): undecodable frames are an honest-client
  // impossibility — count them, and cut the connection after a budget rather than tolerating an
  // endless garbage stream. Legal-but-refused actions (cooldowns, range) cost nothing.
  let strikes = 0;
  const strike = (): void => {
    if (++strikes >= 20) socket.close(1008, 'too many malformed messages');
  };

  socket.on('message', (raw) => {
    if (!messageBucket.tryRemove()) return; // rate-limited: silently drop
    // Guard the whole dispatch so one malformed-but-decodable message hitting a buggy handler can't
    // throw out of the ws 'message' callback and crash the server for everyone.
    runGuarded(
      'client-message',
      () => {
        const msg = decodeClient(raw.toString());
        if (!msg) {
          strike();
          return;
        }

        switch (msg.t) {
          case 'join': {
            if (entityId !== 0) return; // already joined
            // Version gate: a stale cached bundle (a phone that hasn't refreshed since a deploy)
            // gets a crisp "refresh" instead of confusing decode errors deeper in.
            if (msg.v !== PROTOCOL_VERSION) {
              send(socket, { t: 'refresh_required' });
              socket.close(1008, 'protocol version mismatch');
              return;
            }
            // Returning guests present an opaque token; load their save if we recognize it, else mint
            // a fresh token. The token is validated before it ever touches the DB (bound param anyway).
            const presented = isValidToken(msg.token) ? msg.token : undefined;
            const token = presented ?? newPlayerToken();
            const save = presented ? (loadSave(getDb(), presented) ?? undefined) : undefined;
            const placement = manager.join(save?.name ?? msg.name, undefined, save);
            entityId = placement.entityId;
            players.set(entityId, {
              socket,
              instanceId: placement.instanceId,
              accessLevel: 0,
              token,
            });
            send(socket, {
              t: 'welcome',
              id: entityId,
              tickRate: TICK_RATE,
              areaId: placement.areaId,
              instanceId: placement.instanceId,
              token,
            });
            // Hand the newcomer the currently-active liveops events so their HUD badge is correct now,
            // not only after the next change.
            send(socket, {
              t: 'events',
              active: activeEvents(getContent().gameEvents(), simMs()).map(eventBadge),
            });
            // Register social presence so friends see this player come online, and hand them their list.
            const joinName = save?.name ?? msg.name;
            social.setOnline({
              id: entityId,
              token,
              name: joinName,
              areaId: placement.areaId,
              level: 1,
            });
            sendFriends(entityId);
            notifyFriendWatchers(joinName);
            break;
          }
          case 'input': {
            const p = players.get(entityId);
            if (p) manager.get(p.instanceId)?.world.setInput(entityId, msg.input, msg.seq);
            break;
          }
          case 'cast': {
            const p = players.get(entityId);
            if (p && isAbilityId(msg.ability)) {
              manager.get(p.instanceId)?.world.cast(entityId, msg.ability, msg.dx, msg.dy);
            }
            break;
          }
          case 'interact': {
            const p = players.get(entityId);
            if (p) manager.get(p.instanceId)?.world.interact(entityId);
            break;
          }
          case 'equip': {
            const p = players.get(entityId);
            if (p) manager.get(p.instanceId)?.world.equip(entityId, msg.uid);
            break;
          }
          case 'unequip': {
            const p = players.get(entityId);
            if (p) manager.get(p.instanceId)?.world.unequip(entityId, msg.slot);
            break;
          }
          case 'salvage': {
            const p = players.get(entityId);
            if (!p || typeof msg.uid !== 'number') break;
            const r = manager.get(p.instanceId)?.world.salvage(entityId, msg.uid);
            if (r?.ok) {
              const mats = (r.yields ?? []).map((y) => `${y.qty} ${y.kind}`).join(', ');
              send(p.socket, {
                t: 'chat',
                from: 'System',
                text: `Salvaged → ${mats}.`,
                channel: 'system',
              });
            } else if (r) {
              send(p.socket, {
                t: 'chat',
                from: 'System',
                text: r.reason ?? 'Could not salvage that.',
                channel: 'system',
              });
            }
            break;
          }
          case 'learn': {
            const p = players.get(entityId);
            if (p && typeof msg.itemId === 'string') {
              manager.get(p.instanceId)?.world.learn(entityId, msg.itemId);
            }
            break;
          }
          case 'accept_quest': {
            const p = players.get(entityId);
            if (p && typeof msg.questId === 'string') {
              const world = manager.get(p.instanceId)?.world;
              const result = world?.acceptQuest(entityId, msg.questId);
              if (result) send(p.socket, { t: 'chat', from: 'System', text: result });
            }
            break;
          }
          case 'socket_gem': {
            const p = players.get(entityId);
            if (p && typeof msg.gemId === 'string') {
              manager.get(p.instanceId)?.world.socketGem(entityId, msg.gemId);
            }
            break;
          }
          case 'gamble': {
            const p = players.get(entityId);
            if (p && typeof msg.slot === 'string') {
              manager.get(p.instanceId)?.world.gamble(entityId, msg.slot);
            }
            break;
          }
          case 'hire': {
            const p = players.get(entityId);
            if (p && typeof msg.type === 'string') {
              manager.get(p.instanceId)?.world.hire(entityId, msg.type);
            }
            break;
          }
          case 'open_rift': {
            const p = players.get(entityId);
            if (!p || typeof msg.tier !== 'number') break;
            const world = manager.get(p.instanceId)?.world;
            // The world validates Riftkeeper proximity + tier + gold and takes the fee; the
            // manager then spins up the private tiered instance and moves the player.
            if (!world?.payForRift(entityId, msg.tier)) break;
            const ev = manager.openRift(p.instanceId, entityId, msg.tier);
            if (ev) {
              p.instanceId = ev.toInstanceId;
              send(p.socket, {
                t: 'area_changed',
                areaId: ev.toAreaId,
                instanceId: ev.toInstanceId,
              });
              announceArrival(p.socket, ev.toAreaId);
              // Announce the rolled rift mutators so the player knows what twist they're walking into.
              const riftWorld = manager.get(p.instanceId)?.world;
              if (riftWorld && riftWorld.riftModifiers.length > 0) {
                for (const m of riftWorld.riftModifiers) {
                  send(p.socket, {
                    t: 'chat',
                    from: 'System',
                    text: `Rift mutator — ${m.name}: ${m.desc}`,
                    channel: 'system',
                  });
                }
              }
              const stats = manager.get(p.instanceId)?.world.playerStats(entityId);
              social.updatePresence(p.token, ev.toAreaId, stats?.level ?? 1);
              const name = nameOf(entityId);
              if (name) notifyFriendWatchers(name);
              const party = parties.partyOf(entityId);
              if (party) for (const m of party.memberIds) sendPartyState(m);
            }
            break;
          }
          case 'enchant': {
            const p = players.get(entityId);
            if (p && typeof msg.uid === 'number') {
              manager.get(p.instanceId)?.world.enchant(entityId, msg.uid);
            }
            break;
          }
          case 'unsocket_gem': {
            const p = players.get(entityId);
            if (p && typeof msg.slot === 'string' && typeof msg.index === 'number') {
              manager.get(p.instanceId)?.world.unsocketGem(entityId, msg.slot, msg.index);
            }
            break;
          }
          case 'combine_gems': {
            const p = players.get(entityId);
            if (p) manager.get(p.instanceId)?.world.combineGems(entityId);
            break;
          }
          case 'stash_deposit': {
            const p = players.get(entityId);
            if (p && typeof msg.uid === 'number') {
              manager.get(p.instanceId)?.world.depositToStash(entityId, msg.uid);
            }
            break;
          }
          case 'stash_withdraw': {
            const p = players.get(entityId);
            if (p && typeof msg.uid === 'number') {
              manager.get(p.instanceId)?.world.withdrawFromStash(entityId, msg.uid);
            }
            break;
          }
          case 'use_potion': {
            const p = players.get(entityId);
            if (p && (msg.kind === 'health' || msg.kind === 'mana')) {
              manager.get(p.instanceId)?.world.usePotion(entityId, msg.kind);
            }
            break;
          }
          case 'allocate_attr': {
            const p = players.get(entityId);
            if (p && typeof msg.attr === 'string') {
              manager.get(p.instanceId)?.world.allocateAttribute(entityId, msg.attr);
            }
            break;
          }
          case 'allocate_skill': {
            const p = players.get(entityId);
            if (p && typeof msg.nodeId === 'string') {
              manager.get(p.instanceId)?.world.allocateSkill(entityId, msg.nodeId);
            }
            break;
          }
          case 'waypoint': {
            const p = players.get(entityId);
            if (!p || typeof msg.areaId !== 'string') break;
            const world = manager.get(p.instanceId)?.world;
            const stats = world?.playerStats(entityId);
            // Only travel to a discovered area, and never to the one you're already in.
            if (!stats || !stats.discovered.includes(msg.areaId)) break;
            if (manager.get(p.instanceId)?.areaId === msg.areaId) break;
            const ev = manager.teleport(p.instanceId, entityId, msg.areaId);
            if (ev) {
              p.instanceId = ev.toInstanceId;
              send(p.socket, {
                t: 'area_changed',
                areaId: ev.toAreaId,
                instanceId: ev.toInstanceId,
              });
              announceArrival(p.socket, ev.toAreaId);
              social.updatePresence(p.token, ev.toAreaId, stats.level);
              const name = nameOf(entityId);
              if (name) notifyFriendWatchers(name);
              const party = parties.partyOf(entityId);
              if (party) for (const m of party.memberIds) sendPartyState(m);
            }
            break;
          }
          case 'party_invite': {
            if (!players.has(entityId) || typeof msg.targetName !== 'string') break;
            const target = findPlayerByName(msg.targetName);
            if (target === undefined || target === entityId) {
              send(socket, {
                t: 'chat',
                from: 'System',
                text: 'No such player online.',
                channel: 'system',
              });
              break;
            }
            const r = parties.invite(entityId, target);
            if (r.ok) {
              sendPartyState(target);
              sendPartyState(entityId);
              const tconn = players.get(target);
              if (tconn) {
                send(tconn.socket, {
                  t: 'chat',
                  from: 'System',
                  text: `${nameOf(entityId) ?? 'Someone'} invited you to a party — open the party panel (P) to accept.`,
                  channel: 'party',
                });
              }
            } else {
              send(socket, {
                t: 'chat',
                from: 'System',
                text: `Invite failed: ${r.reason}`,
                channel: 'system',
              });
            }
            break;
          }
          case 'party_accept': {
            const r = parties.accept(entityId);
            if (r.ok) {
              for (const m of r.party.memberIds) sendPartyState(m);
              broadcastToParty(
                r.party.memberIds,
                `${nameOf(entityId) ?? 'A hero'} joined the party.`,
              );
            } else {
              send(socket, { t: 'chat', from: 'System', text: r.reason, channel: 'system' });
            }
            break;
          }
          case 'party_decline': {
            parties.decline(entityId);
            sendPartyState(entityId);
            break;
          }
          case 'party_leave': {
            const affected = parties.leave(entityId);
            for (const m of affected) sendPartyState(m);
            break;
          }
          case 'trade_invite': {
            if (!players.has(entityId) || typeof msg.targetName !== 'string') break;
            const now = simMs();
            if ((tradeInviteAt.get(entityId) ?? 0) > now) break; // anti-spam: one invite/sec
            tradeInviteAt.set(entityId, now + 1000);
            const target = findPlayerByName(msg.targetName);
            const me = players.get(entityId);
            const them = target !== undefined ? players.get(target) : undefined;
            if (target === undefined || !me || !them || me.instanceId !== them.instanceId) {
              send(socket, {
                t: 'chat',
                from: 'System',
                text: 'That player is not nearby.',
                channel: 'system',
              });
              break;
            }
            const world = manager.get(me.instanceId)?.world;
            if (!world) break;
            const r = world.startTrade(entityId, target);
            if (!r.ok) {
              send(socket, {
                t: 'chat',
                from: 'System',
                text: r.reason ?? 'Could not trade.',
                channel: 'system',
              });
              break;
            }
            send(me.socket, { t: 'trade_open', otherId: target, otherName: nameOf(target) ?? '?' });
            send(them.socket, {
              t: 'trade_open',
              otherId: entityId,
              otherName: nameOf(entityId) ?? '?',
            });
            sendTradeState(world, entityId);
            break;
          }
          case 'trade_offer': {
            const me = players.get(entityId);
            const world = me ? manager.get(me.instanceId)?.world : undefined;
            if (!world) break;
            const gold = typeof msg.gold === 'number' ? msg.gold : 0;
            const itemUids = Array.isArray(msg.itemUids)
              ? msg.itemUids.filter((u): u is number => typeof u === 'number')
              : [];
            if (world.tradeSetOffer(entityId, { gold, itemUids })) sendTradeState(world, entityId);
            break;
          }
          case 'trade_confirm': {
            const me = players.get(entityId);
            const world = me ? manager.get(me.instanceId)?.world : undefined;
            if (!world) break;
            const partners = world.tradePartners(entityId); // capture before commit clears the session
            const result = world.tradeConfirm(entityId);
            if (result === 'updated') {
              sendTradeState(world, entityId);
            } else if ((result === 'committed' || result === 'failed') && partners) {
              const reason = result === 'committed' ? 'committed' : 'aborted';
              for (const id of [partners.aId, partners.bId]) {
                const c = players.get(id);
                // The committed swap is reflected to each client by the next per-tick `you` update.
                if (c) send(c.socket, { t: 'trade_closed', reason });
              }
            }
            break;
          }
          case 'trade_cancel': {
            const me = players.get(entityId);
            const world = me ? manager.get(me.instanceId)?.world : undefined;
            if (!world) break;
            const partners = world.tradePartners(entityId);
            world.tradeCancel(entityId);
            if (partners) {
              for (const id of [partners.aId, partners.bId]) {
                const c = players.get(id);
                if (c) send(c.socket, { t: 'trade_closed', reason: 'cancelled' });
              }
            }
            break;
          }
          case 'friend_add': {
            const p = players.get(entityId);
            if (p && typeof msg.name === 'string') {
              const r = social.addFriend(p.token, nameOf(entityId) ?? '', msg.name);
              send(socket, {
                t: 'chat',
                from: 'System',
                text: r.ok
                  ? `Added ${msg.name.trim()} to your friends.`
                  : `Cannot add friend: ${r.reason}`,
                channel: 'system',
              });
              if (r.ok) sendFriends(entityId);
            }
            break;
          }
          case 'friend_remove': {
            const p = players.get(entityId);
            if (p && typeof msg.name === 'string') {
              social.removeFriend(p.token, msg.name);
              sendFriends(entityId);
            }
            break;
          }
          case 'whisper': {
            const p = players.get(entityId);
            if (!p || typeof msg.to !== 'string' || typeof msg.text !== 'string') break;
            const text = sanitizeChat(msg.text);
            if (!text) break;
            const fromName = nameOf(entityId) ?? 'Player';
            const target = social.findOnline(msg.to);
            const tconn = target ? players.get(target.id) : undefined;
            if (target && tconn) {
              send(tconn.socket, {
                t: 'chat',
                from: `${fromName} ▸ you`,
                text,
                channel: 'whisper',
              });
              send(socket, { t: 'chat', from: `you ▸ ${target.name}`, text, channel: 'whisper' });
            } else {
              send(socket, {
                t: 'chat',
                from: 'System',
                text: `${msg.to} is not online.`,
                channel: 'system',
              });
            }
            break;
          }
          case 'buy': {
            const p = players.get(entityId);
            if (p && typeof msg.itemId === 'string') {
              manager.get(p.instanceId)?.world.buy(entityId, msg.itemId);
            }
            break;
          }
          case 'sell': {
            const p = players.get(entityId);
            if (p) manager.get(p.instanceId)?.world.sell(entityId);
            break;
          }
          case 'chat': {
            const p = players.get(entityId);
            if (!p || !chatBucket.tryRemove()) return;
            const text = sanitizeChat(msg.text);
            const instance = manager.get(p.instanceId);
            if (!text || !instance) return;
            const world = instance.world;
            const from = world.nameOf(entityId) ?? 'Player';

            if (isCommand(text)) {
              // A command handler must never crash the server — every client is untrusted, and a bad
              // input or DB error is the issuer's problem, not the whole world's.
              try {
                runCommand(text, {
                  accessLevel: p.accessLevel,
                  args: [],
                  playerId: entityId,
                  areaId: instance.areaId,
                  world,
                  reply: (t) => send(p.socket, { t: 'chat', from: 'System', text: t }),
                  broadcast: (t) =>
                    broadcastToInstance(p.instanceId, { t: 'chat', from: 'System', text: t }),
                  name: () => from,
                  login: (u, pw) => verifyLogin(getDb(), u, pw),
                  setAccessLevel: (lvl) => {
                    p.accessLevel = lvl;
                    // Tell the client its new access so the settings panel can reveal GM options.
                    send(p.socket, { t: 'access', level: lvl });
                  },
                  listPlayers: () => world.playerNames(),
                  setAccessFor: (u, lvl) => setAccess(getDb(), u, lvl),
                  spawnBots: (count) => spawnBots(entityId, p.instanceId, count),
                  clearBots: () => clearBots(entityId),
                  botReport: () => botReport(entityId),
                  areaIds: () =>
                    getContent()
                      .areas()
                      .map((a) => a.id),
                  areaTheme: (areaId) => getContent().area(areaId)?.theme,
                  setTheme: (areaId, key, value) => applyThemeEdit(areaId, key, value),
                  reloadContent: () =>
                    `Reloaded content from DB — re-skinned ${rebroadcastContent()} areas.`,
                  contentTables: () => listTables(),
                  contentColumns: (table) => listColumns(table),
                  contentRows: (table) => listRows(table),
                  contentRow: (table, id) => getRow(table, id),
                  setContent: (table, id, column, value) => {
                    const r = editContent(table, id, column, value);
                    if (r.ok) rebroadcastContent(); // reload + push to all clients, re-apply weather
                    return r.message;
                  },
                  ladder: (metric) =>
                    formatLadder(getDb(), isLeaderboardMetric(metric) ? metric : 'level'),
                  events: () => {
                    const now = simMs();
                    const evs = getContent().gameEvents();
                    if (evs.length === 0) return 'No game events configured.';
                    return evs
                      .map((e) => {
                        const active = msUntilNextChange(e, now);
                        const on = totalXpBonus([e], now) > 0 || activeEvents([e], now).length > 0;
                        const secs = Number.isFinite(active) ? Math.ceil(active / 1000) : Infinity;
                        const when = Number.isFinite(secs)
                          ? `${on ? 'ends' : 'starts'} in ${secs}s`
                          : on
                            ? 'always on'
                            : 'never';
                        return `${e.name} [${e.id}]: ${on ? 'ACTIVE' : 'idle'} (${when})`;
                      })
                      .join('\n');
                  },
                  recipes: () => {
                    const rs = getContent().craftingRecipes();
                    if (rs.length === 0) return 'No crafting recipes configured.';
                    const fmt = (io: { itemId: string; qty: number }[]): string =>
                      io.map((x) => `${x.qty} ${x.itemId}`).join(' + ');
                    return rs
                      .map((r) => `${r.id} — ${fmt(r.inputs)} → ${fmt(r.outputs)}`)
                      .join('\n');
                  },
                  guildCreate: (gname) => {
                    const r = guilds.create(p.token, gname, from);
                    return r.ok
                      ? `Guild "${gname.trim()}" founded — you are its leader.`
                      : r.reason;
                  },
                  guildInvite: (tname) => {
                    const target = social.findOnline(tname);
                    if (!target) return 'That player must be online to be invited.';
                    const r = guilds.invite(p.token, target.token);
                    if (!r.ok) return r.reason;
                    sendToToken(target.token, {
                      t: 'chat',
                      from: 'System',
                      text: `${from} invited you to "${guilds.guildNameOf(p.token) ?? 'a guild'}" — /guild accept to join.`,
                      channel: 'guild',
                    });
                    return `Invited ${target.name} to the guild.`;
                  },
                  guildAccept: () => {
                    const r = guilds.accept(p.token, from);
                    if (!r.ok) return r.reason;
                    guildBroadcast(p.token, 'System', `${from} has joined the guild.`);
                    return `You joined "${r.guildName}".`;
                  },
                  guildDecline: () => {
                    guilds.decline(p.token);
                    return 'Guild invite declined.';
                  },
                  guildLeave: () => {
                    const gname = guilds.guildNameOf(p.token);
                    const r = guilds.leave(p.token);
                    if (!r.ok) return r.reason ?? 'You are not in a guild.';
                    for (const tok of r.affected) {
                      if (tok === p.token) continue;
                      sendToToken(tok, {
                        t: 'chat',
                        from: 'System',
                        text: `${from} has left the guild.${r.note ? ` ${r.note}` : ''}`,
                        channel: 'guild',
                      });
                    }
                    return `You left "${gname ?? 'the guild'}".${r.note ? ` ${r.note}` : ''}`;
                  },
                  guildKick: (tname) => {
                    const tok = guildMemberTokenByName(p.token, tname);
                    if (!tok) return 'They are not in your guild.';
                    const r = guilds.kick(p.token, tok);
                    if (!r.ok) return r.reason;
                    sendToToken(tok, {
                      t: 'chat',
                      from: 'System',
                      text: 'You have been removed from the guild.',
                      channel: 'guild',
                    });
                    return `Removed ${tname} from the guild.`;
                  },
                  guildRank: (tname, rank) => {
                    const tok = guildMemberTokenByName(p.token, tname);
                    if (!tok) return 'They are not in your guild.';
                    const r = guilds.setRank(p.token, tok, rank);
                    if (!r.ok) return r.reason;
                    sendToToken(tok, {
                      t: 'chat',
                      from: 'System',
                      text: `You are now a guild ${rank}.`,
                      channel: 'guild',
                    });
                    return `${tname} is now a ${rank}.`;
                  },
                  guildRoster: () => {
                    const r = guilds.roster(p.token);
                    if (!r) return ['You are not in a guild. Found one with /guild create <name>.'];
                    const lines = [`${r.name} — ${r.members.length} member(s):`];
                    for (const m of r.members) {
                      const on = social.findOnline(m.name);
                      const where = on ? `online (${on.areaId})` : 'offline';
                      lines.push(`  [${m.rank}] ${m.name} — ${where}`);
                    }
                    return lines;
                  },
                  guildSay: (text) => {
                    if (!guilds.guildNameOf(p.token)) return 'You are not in a guild.';
                    guildBroadcast(p.token, from, text);
                    return '';
                  },
                  mailSend: (toName, gold, uid) =>
                    mailSend(world, entityId, p.token, from, toName, gold, uid),
                  mailList: () => {
                    const inbox = loadMail(getDb(), p.token);
                    if (inbox.length === 0) return ['Your mailbox is empty.'];
                    return [
                      `Mailbox (${inbox.length}):`,
                      ...inbox.map((m) => {
                        const parts: string[] = [];
                        if (m.gold > 0) parts.push(`${m.gold}g`);
                        if (m.itemJson) parts.push('an item');
                        return `  #${m.id} from ${m.senderName}: ${parts.join(' + ') || '(empty)'} — /mail take ${m.id}`;
                      }),
                    ];
                  },
                  mailTake: (id) => mailTake(entityId, p.token, world, id),
                  mailTakeAll: () => {
                    const inbox = loadMail(getDb(), p.token);
                    if (inbox.length === 0) return 'Your mailbox is empty.';
                    let taken = 0;
                    for (const m of inbox) {
                      const r = mailTake(entityId, p.token, world, m.id);
                      if (r.startsWith('Collected')) taken++;
                      else break; // stop on the first failure (e.g. bag full) so nothing is lost
                    }
                    return taken > 0
                      ? `Collected ${taken} mail.`
                      : 'Could not collect (bag full?).';
                  },
                  auctionList: (uid, price) =>
                    auctionList(world, entityId, p.token, from, uid, price),
                  auctionBuy: (id) => auctionBuy(world, entityId, p.token, id),
                  auctionCancel: (id) => auctionCancel(p.token, id),
                  auctionBrowse: () => {
                    const rows = loadAuctions(getDb());
                    if (rows.length === 0) return ['The auction house is empty.'];
                    const shown = rows.slice(0, 25);
                    const lines = [`Auction house (${rows.length} listing(s)):`];
                    for (const a of shown) {
                      lines.push(
                        `  #${a.id} ${describeAuctionItem(a.itemJson)} — ${a.price}g (${a.sellerName})`,
                      );
                    }
                    if (rows.length > shown.length) {
                      lines.push(`  …and ${rows.length - shown.length} more.`);
                    }
                    return lines;
                  },
                  auctionMine: () => {
                    const rows = auctionsBySeller(getDb(), p.token);
                    if (rows.length === 0) return ['You have no active listings.'];
                    return [
                      'Your listings:',
                      ...rows.map(
                        (a) =>
                          `  #${a.id} ${describeAuctionItem(a.itemJson)} — ${a.price}g — /ah cancel ${a.id}`,
                      ),
                    ];
                  },
                });
              } catch (err) {
                console.error('[command] failed:', err);
                send(p.socket, {
                  t: 'chat',
                  from: 'System',
                  text: 'Command failed (server error).',
                });
              }
            } else {
              broadcastToInstance(p.instanceId, { t: 'chat', from, text });
            }
            break;
          }
          case 'admin': {
            // Privileged "in-game engine" surface — the foundation of the live-editing
            // feature. Gated by a server-side token; unauthenticated callers get nothing.
            const ok = ENGINE_ADMIN_TOKEN !== '' && msg.token === ENGINE_ADMIN_TOKEN;
            send(socket, {
              t: 'admin_result',
              ok,
              message: ok
                ? `accepted: ${msg.command} (engine commands land here)`
                : 'denied: invalid or unset ENGINE_ADMIN_TOKEN',
            });
            break;
          }
          case 'engine_req': {
            // The Dev "Game Engine" panel. The ENTIRE surface is gated on Developer access,
            // server-side — isolated from any normal player path (CLAUDE.md security pillar).
            const p = players.get(entityId);
            if (!p) break;
            const rid = msg.rid;
            const reply = (ok: boolean, message?: string, data?: EngineResData): void => {
              const out: ServerMessage = { t: 'engine_res', rid, ok };
              if (message !== undefined) (out as { message?: string }).message = message;
              if (data !== undefined) (out as { data?: EngineResData }).data = data;
              send(socket, out);
            };
            if (p.accessLevel < AccessLevel.Developer) {
              reply(false, 'The engine panel requires Developer access (/login).');
              break;
            }
            const op = msg.op;
            const instance = manager.get(p.instanceId);
            const world = instance?.world;
            switch (op.kind) {
              case 'schema':
                reply(true, undefined, { kind: 'schema', schema: engineSchema() });
                break;
              case 'rows': {
                const res = engineRows(op.table);
                if ('error' in res) reply(false, res.error);
                else reply(true, undefined, res);
                break;
              }
              case 'edit': {
                const out = editContent(op.table, op.id, op.column, op.value);
                if (out.ok) rebroadcastContent();
                reply(out.ok, out.message);
                break;
              }
              case 'config': {
                const applied = setEngineConfig(op.path, op.value);
                if (applied === null) {
                  reply(false, `Unknown or invalid config knob: ${op.path}`);
                  break;
                }
                applyRuntimeConfig(); // re-read the live config into the sim's tuning bindings
                reply(true, `Set ${op.path} = ${applied} — applied live.`);
                break;
              }
              case 'reload': {
                const n = rebroadcastContent();
                reply(true, `Reloaded content — re-skinned ${n} areas.`);
                break;
              }
              case 'spawn_bots': {
                const count = Math.max(0, Math.min(2000, Math.floor(op.count) || 0));
                reply(true, `Spawned ${spawnBots(entityId, p.instanceId, count)} bot(s).`);
                break;
              }
              case 'clear_bots':
                reply(true, `Cleared ${clearBots(entityId)} bot(s).`);
                break;
              case 'give': {
                if (!world) return reply(false, 'No active instance.');
                const qty = Math.max(1, Math.min(10_000, Math.floor(op.qty) || 1));
                const ok = world.giveItem(entityId, op.itemId, qty);
                reply(ok, ok ? `Gave ${qty}× ${op.itemId}.` : `Unknown item: ${op.itemId}`);
                break;
              }
              case 'add_xp': {
                if (!world) return reply(false, 'No active instance.');
                const amt = Math.max(0, Math.floor(op.amount) || 0);
                world.addXp(entityId, amt);
                reply(true, `Granted ${amt} XP.`);
                break;
              }
              case 'set_level': {
                if (!world) return reply(false, 'No active instance.');
                const lvl = Math.max(1, Math.min(999, Math.floor(op.level) || 1));
                world.setLevel(entityId, lvl);
                reply(true, `Set level to ${lvl}.`);
                break;
              }
              case 'spawn_mob': {
                if (!world) return reply(false, 'No active instance.');
                const n = Math.max(1, Math.min(200, Math.floor(op.count) || 1));
                let made = 0;
                for (let k = 0; k < n; k++) if (world.spawnMobAt(entityId, op.templateId)) made++;
                reply(
                  made > 0,
                  made > 0
                    ? `Spawned ${made}× ${op.templateId}.`
                    : `Unknown template: ${op.templateId}`,
                );
                break;
              }
              case 'weather': {
                if (!instance) return reply(false, 'No active instance.');
                // Route through the theme editor so it's both visual and persistent (re-skins clients).
                const msgOut = applyThemeEdit(instance.areaId, 'weather', op.weather);
                rebroadcastContent();
                reply(true, msgOut);
                break;
              }
              case 'teleport': {
                const ev = manager.teleport(p.instanceId, entityId, op.areaId);
                if (!ev) return reply(false, `Cannot teleport to: ${op.areaId}`);
                p.instanceId = ev.toInstanceId;
                send(p.socket, {
                  t: 'area_changed',
                  areaId: ev.toAreaId,
                  instanceId: ev.toInstanceId,
                });
                announceArrival(p.socket, ev.toAreaId);
                reply(true, `Teleported to ${ev.toAreaId}.`);
                break;
              }
              case 'heal': {
                if (!world) return reply(false, 'No active instance.');
                reply(world.devHeal(entityId), 'Restored HP + mana.');
                break;
              }
              case 'set_access': {
                const ok = setAccess(getDb(), op.username, op.level);
                reply(
                  ok,
                  ok
                    ? `Set ${op.username} to access ${op.level}.`
                    : `No such account: ${op.username}`,
                );
                break;
              }
              default:
                reply(false, 'Unsupported engine op.');
            }
            break;
          }
          default:
            // A well-formed JSON frame with an unknown type is still not something an honest
            // client sends — it counts toward the malformed-message budget.
            strike();
        }
      },
      (label) => guardStats.record(label),
    );
  });

  socket.on('close', () => {
    const p = players.get(entityId);
    if (p) {
      // Persist the character so this guest can reload it on reconnect.
      const save = manager.get(p.instanceId)?.world.exportPlayer(entityId);
      if (save) storeSave(getDb(), p.token, save);
      const leftName = nameOf(entityId);
      // Drop out of any party (promote/disband) and tell the remaining members; go offline so
      // friends see it, then refresh everyone who had this player on their list.
      const affectedParty = parties.remove(entityId);
      guilds.remove(p.token); // drop any pending guild invite (membership persists in the DB)
      clearBots(entityId); // a disconnecting GM's bots go with them — never orphaned in the world
      manager.remove(p.instanceId, entityId);
      players.delete(entityId);
      social.setOffline(p.token);
      for (const m of affectedParty) if (m !== entityId) sendPartyState(m);
      if (leftName) notifyFriendWatchers(leftName);
    }
  });
});

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(encode(msg));
}

/** Tell an arriving player where they are — the "Now entering …" line in chat. */
function announceArrival(socket: WebSocket, areaId: string): void {
  const name = getContent().area(areaId)?.name ?? areaId;
  send(socket, { t: 'chat', from: 'System', text: `Now entering ${name}.` });
}

/** Send a message to every player currently in the given instance (area-scoped). */
function broadcastToInstance(instanceId: string, msg: ServerMessage): void {
  const payload = encode(msg);
  for (const id of manager.playerIdsIn(instanceId)) {
    const socket = players.get(id)?.socket;
    if (socket && socket.readyState === socket.OPEN) socket.send(payload);
  }
}

// --- Fixed-timestep authoritative loop ------------------------------------------------
const dt = 1 / TICK_RATE;
let tick = 0;
/** The set of game-event ids active last tick — for the inactive→active edge that triggers an announce. */
let lastActiveEventIds = new Set<string>();
setInterval(() => {
  // Guard the whole tick: a throw from one corrupt entity/instance must not kill the interval and
  // freeze the world for everyone. On throw we skip this tick and carry on next frame.
  runGuarded(
    'tick',
    () => {
      if (bots.size > 0) driveBots(); // feed AI companions their inputs before the world advances
      const transfers = manager.tick(dt);
      tick++;

      // Liveops timed game-events on the deterministic sim clock (NOT wall-clock, so replays stay
      // reproducible): inject each world's XP multiplier from the active events, and announce one the
      // moment it begins. The schedule math is pure (game-events.ts); the World just reads the number.
      const evNow = simMs();
      const events = getContent().gameEvents();
      const eventMult = 1 + totalXpBonus(events, evNow);
      const goldMult = 1 + totalGoldBonus(events, evNow);
      for (const instance of manager.list()) {
        instance.world.setXpEventMult(eventMult);
        instance.world.setGoldEventMult(goldMult);
      }
      const active = activeEvents(events, evNow);
      const nowActiveEventIds = new Set(active.map((e) => e.id));
      for (const e of active) {
        if (!lastActiveEventIds.has(e.id) && e.announce) {
          for (const instance of manager.list()) {
            broadcastToInstance(instance.id, { t: 'chat', from: 'System', text: e.announce });
          }
        }
      }
      // Push the active-event set to every client whenever it changes, so the HUD badge stays current.
      const eventsChanged =
        nowActiveEventIds.size !== lastActiveEventIds.size ||
        [...nowActiveEventIds].some((id) => !lastActiveEventIds.has(id));
      if (eventsChanged) {
        const payload = active.map(eventBadge);
        for (const instance of manager.list()) {
          broadcastToInstance(instance.id, { t: 'events', active: payload });
        }
      }
      lastActiveEventIds = nowActiveEventIds;

      // Area corruption: fade it once on the shared pool, and reset it every morning (06:00 local).
      manager.corruption.decay(dt);
      if (
        manager.corruption.rolloverIfNewDay(
          morningDayIndex(Date.now(), new Date().getTimezoneOffset()),
        )
      ) {
        for (const instance of manager.list()) {
          broadcastToInstance(instance.id, {
            t: 'chat',
            from: 'System',
            text: 'Dawn breaks. The corruption of yesterday fades from the land.',
          });
        }
      }

      // Resolve den descents: a player stepped onto a cellar hatch or hidden den — collect the
      // requests first (opening a den mutates the instance list), then transfer like a portal.
      const denDescents: { playerId: number; instanceId: string }[] = [];
      for (const instance of manager.list()) {
        for (const entry of instance.world.drainDenEntries()) {
          denDescents.push({ playerId: entry.playerId, instanceId: instance.id });
        }
      }
      for (const d of denDescents) {
        const ev = manager.openDen(d.instanceId, d.playerId);
        if (ev) transfers.push(ev);
      }

      // Apply portal crossings: update routing and tell the player their area changed.
      for (const ev of transfers) {
        const p = players.get(ev.entityId);
        if (!p) continue;
        p.instanceId = ev.toInstanceId;
        send(p.socket, { t: 'area_changed', areaId: ev.toAreaId, instanceId: ev.toInstanceId });
        announceArrival(p.socket, ev.toAreaId);
        // Presence follows the player across areas; refresh their party + friends' rosters.
        social.updatePresence(
          p.token,
          ev.toAreaId,
          manager.get(ev.toInstanceId)?.world.playerStats(ev.entityId)?.level ?? 1,
        );
        const name = nameOf(ev.entityId);
        if (name) notifyFriendWatchers(name);
        const party = parties.partyOf(ev.entityId);
        if (party) for (const m of party.memberIds) sendPartyState(m);
      }

      // Each player only sees their own instance (instancing), and within it only the entities
      // near them (interest management) — built once per instance via a spatial grid. Each instance's
      // World gets the host party resolver so a kill shares XP with co-members present here.
      for (const instance of manager.list()) {
        const world = instance.world;
        if (!resolverInstances.has(instance.id)) {
          world.setPartyResolver((id) =>
            parties.coMembers(id).filter((m) => players.get(m)?.instanceId === instance.id),
          );
          resolverInstances.add(instance.id);
        }
        const all = world.snapshot();
        const fx = world.drainEvents();
        const grid = new SpatialGrid<EntityState>(256);
        for (const e of all) grid.insert(e);

        for (const id of manager.playerIdsIn(instance.id)) {
          const socket = players.get(id)?.socket;
          if (!socket || socket.readyState !== socket.OPEN) continue;
          const me = all.find((e) => e.id === id);
          const entities = me ? grid.queryRect(me.x, me.y, AOI_HALF_W, AOI_HALF_H) : all;
          socket.send(encode({ t: 'snapshot', tick, entities, fx }));
          // Personal stats (hp/mana/xp/gold/dead) are kept off the shared snapshot.
          const stats = world.playerStats(id);
          if (stats) send(socket, { t: 'you', ...stats });
        }

        // Deliver per-player system notices (quest completions, level-ups) as System chat.
        for (const notice of world.drainNotices()) {
          const socket = players.get(notice.playerId)?.socket;
          if (socket && socket.readyState === socket.OPEN) {
            send(socket, { t: 'chat', from: 'System', text: notice.text });
          }
        }

        // Deliver shop windows to players who just interacted with a vendor.
        for (const offer of world.drainShopOffers()) {
          const socket = players.get(offer.playerId)?.socket;
          if (socket && socket.readyState === socket.OPEN) {
            send(socket, { t: 'shop', vendor: offer.vendor, stock: offer.stock });
          }
        }

        // Deliver gambling windows to players who just interacted with a gambler.
        for (const offer of world.drainGambleOffers()) {
          const socket = players.get(offer.playerId)?.socket;
          if (socket && socket.readyState === socket.OPEN) {
            send(socket, { t: 'gamble_open', cost: offer.cost });
          }
        }

        // Deliver hire windows to players who just interacted with a recruiter.
        for (const offer of world.drainHireOffers()) {
          const socket = players.get(offer.playerId)?.socket;
          if (socket && socket.readyState === socket.OPEN) {
            send(socket, { t: 'hire_open', offers: offer.offers });
          }
        }

        // Deliver rift windows to players who just interacted with the Riftkeeper.
        for (const offer of world.drainRiftOffers()) {
          const socket = players.get(offer.playerId)?.socket;
          if (socket && socket.readyState === socket.OPEN) {
            send(socket, { t: 'rift_open', maxTier: offer.maxTier, costBase: offer.costBase });
          }
        }

        // Deliver Artificer windows to players who just interacted with an artificer.
        for (const offer of world.drainArtificerOffers()) {
          const socket = players.get(offer.playerId)?.socket;
          if (socket && socket.readyState === socket.OPEN) {
            send(socket, {
              t: 'artificer_open',
              rerollCost: ARTIFICER_REROLL_GOLD,
              unsocketCost: ARTIFICER_UNSOCKET_GOLD,
            });
          }
        }

        // Deliver stash windows (on open + after each deposit/withdraw) to refresh the bank panel.
        for (const offer of world.drainStashOffers()) {
          const socket = players.get(offer.playerId)?.socket;
          if (socket && socket.readyState === socket.OPEN) {
            send(socket, {
              t: 'stash',
              items: offer.items,
              cap: offer.cap,
              expandCost: offer.expandCost,
            });
          }
        }
      }
    },
    (label) => guardStats.record(label),
  );
}, 1000 / TICK_RATE);

// Periodic autosave: persist every connected character so progress survives a server crash, not
// just a clean disconnect. Cheap (a handful of upserts) and infrequent. Guarded so a single failed
// write (db momentarily locked, disk hiccup) can't throw out of the timer and kill all future saves.
setInterval(() => {
  runGuarded(
    'autosave',
    () => {
      const db = getDb();
      const at = Date.now();
      for (const [id, p] of players) {
        const save = manager.get(p.instanceId)?.world.exportPlayer(id);
        if (save) {
          storeSave(db, p.token, save);
          // Record best-ever ladder standings from the authoritative save (server is sole writer).
          recordScore(db, save.name, 'level', save.level, at);
          recordScore(db, save.name, 'gold', save.gold, at);
          recordScore(db, save.name, 'kills', save.kills ?? 0, at);
          recordScore(db, save.name, 'streak', save.bestDeathlessStreak ?? 0, at);
        }
      }
    },
    (label) => guardStats.record(label),
  );
}, 20_000);

// Social liveness: once a second, refresh party rosters (HP/level/area move) and keep each online
// player's presence (level) current so friends lists reflect it. Cheap — parties + friends are tiny.
setInterval(() => {
  runGuarded(
    'social-liveness',
    () => {
      for (const [id, p] of players) {
        const lvl = manager.get(p.instanceId)?.world.playerStats(id)?.level;
        if (lvl !== undefined)
          social.updatePresence(p.token, manager.get(p.instanceId)?.areaId ?? '', lvl);
        if (parties.partyOf(id)) sendPartyState(id);
      }
    },
    (label) => guardStats.record(label),
  );
}, 1000);

// Invasion events: every so often a populated, non-town instance is raided by a champion wave — a
// spontaneous group fight that turns a quiet farm into an onslaught.
setInterval(() => {
  runGuarded(
    'invasion',
    () => {
      for (const instance of manager.list()) {
        if (instance.areaId === 'town') continue;
        if (manager.playerIdsIn(instance.id).length === 0) continue;
        if (Math.random() > INVASION_CHANCE) continue;
        const count = 3 + Math.floor(Math.random() * 3); // 3–5 champions
        if (instance.world.spawnInvasion(instance.areaId, count)) {
          const area = getContent().area(instance.areaId);
          broadcastToInstance(instance.id, {
            t: 'chat',
            from: 'System',
            text: `⚔ An invasion! Champions pour into ${area?.name ?? instance.areaId} — survive the onslaught.`,
          });
        }
      }
    },
    (label) => guardStats.record(label),
  );
}, INVASION_INTERVAL_MS);

// Crowd density maintenance: keep busy overworld instances stocked with monsters so a flood of
// players (or bots) doesn't farm a zone to extinction. Cheap — a no-op for solo/quiet/dungeon
// instances; only tops up where a crowd has thinned the roster below its player-scaled target.
setInterval(() => {
  runGuarded('density', () => {
    for (const instance of manager.list()) instance.world.maintainDensity();
  });
}, 3000);

// "The forces of darkness grow stronger/weaker" — announce per-area corruption tier crossings
// (no numeric meter), broadcast to every instance of the area whose darkness shifted.
setInterval(() => {
  runGuarded(
    'corruption-announce',
    () => {
      const seen = new Set<string>();
      for (const instance of manager.list()) {
        if (instance.areaId === 'town' || seen.has(instance.areaId)) continue;
        seen.add(instance.areaId);
        const change = manager.corruption.pollTierChange(instance.areaId);
        if (!change) continue;
        const area = getContent().area(instance.areaId);
        const text = corruptionFlavor(area?.name ?? instance.areaId, change.tier, change.dir);
        for (const inst of manager.list()) {
          if (inst.areaId === instance.areaId) {
            broadcastToInstance(inst.id, { t: 'chat', from: 'System', text });
          }
        }
      }
    },
    (label) => guardStats.record(label),
  );
}, 4000);

/** Diablo-style flavor for a corruption tier crossing — louder as the darkness deepens. */
function corruptionFlavor(area: string, tier: number, dir: 'up' | 'down'): string {
  if (dir === 'up') {
    if (tier >= 3) return `The forces of darkness are rampant in ${area} — tread carefully.`;
    if (tier === 2) return `The forces of darkness grow stronger in ${area}.`;
    return `The forces of darkness stir in ${area}.`;
  }
  if (tier <= 0) return `${area} is cleansed; the darkness recedes.`;
  if (tier === 1) return `The forces of darkness grow weaker in ${area}.`;
  return `The darkness loosens its grip on ${area}.`;
}

// A listen failure (port already in use, no permission to bind) surfaces as an 'error' event; with
// no handler Node rethrows it as a raw stack. Translate the common case into a clear, actionable
// message and exit cleanly — there is no server to run without a bound port.
http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[browsergame] FATAL: port ${PORT} is already in use (set PORT to another value).`,
    );
  } else {
    console.error('[browsergame] FATAL: http server error:', err.message);
  }
  process.exit(1);
});

http.listen(PORT, () => {
  console.log(`[browsergame] world server on :${PORT} @ ${TICK_RATE}Hz · instancing=${INSTANCING}`);
  console.log(`[browsergame] in dev, open the Vite url; it proxies /ws to this server.`);
});
