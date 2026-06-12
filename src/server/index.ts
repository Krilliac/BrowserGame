import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { InstanceManager, type InstancingMode } from './instance-manager.js';
import { sanitizeChat } from './chat.js';
import { TokenBucket } from './rate-limit.js';
import { runGuarded, GuardStats } from './resilience.js';
import {
  DEFAULT_TICK_RATE,
  MAX_MESSAGE_BYTES,
  decodeClient,
  encode,
  type EntityState,
  type ServerMessage,
} from '../shared/protocol.js';
import { isAbilityId } from '../shared/combat.js';
import { initGameDb, getDb, getContent, reloadContent } from './content.js';
import { isCommand, runCommand } from './commands.js';
import { verifyLogin, setAccess } from './accounts.js';
import {
  isValidToken,
  loadSave,
  newPlayerToken,
  storeSave,
  loadFriends,
  addFriend as dbAddFriend,
  removeFriend as dbRemoveFriend,
} from './player-store.js';
import { PartyRegistry } from './party.js';
import { SocialRegistry, type FriendStore } from './social.js';
import { ARTIFICER_REROLL_GOLD, ARTIFICER_UNSOCKET_GOLD } from './world.js';
import type { PartyMember } from '../shared/protocol.js';
import { morningDayIndex } from './area-corruption.js';
import { SpatialGrid } from './spatial.js';
import { THEME_KEYS, coerceThemeValue } from '../shared/theme.js';
import { listTables, listColumns, listRows, getRow, editContent } from './content-edit.js';

// Load all game content from SQLite (the source of truth). Defaults to ./game.db; the file is
// created and seeded from the built-in content on first run. Edit it with any SQLite tool.
const content = initGameDb(process.env.GAME_DB ?? 'game.db');
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
  });
}

/** Re-read content from the DB, re-encode the packet, and push it to every connected client. */
function rebroadcastContent(): number {
  const c = reloadContent();
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
const AOI_HALF_W = 1400;
const AOI_HALF_H = 1000;

// Invasion events: how often we roll, and the per-instance chance each roll.
const INVASION_INTERVAL_MS = 90_000;
const INVASION_CHANCE = 0.35;

const PORT = Number(process.env.PORT ?? 8080);
const TICK_RATE = Number(process.env.TICK_RATE ?? DEFAULT_TICK_RATE);
const ENGINE_ADMIN_TOKEN = process.env.ENGINE_ADMIN_TOKEN ?? '';
const INSTANCING: InstancingMode = process.env.INSTANCING === 'single' ? 'single' : 'auto';

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
  await serveStatic(req.url ?? '/', res);
});

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

// Heartbeat: ping every socket periodically; a client that misses a pong (tab closed abruptly, a
// reload, a dropped network) is terminated so its player entity is removed promptly instead of
// lingering as an idle "ghost" until TCP times out. (This is what piled up dozens of stale players.)
const HEARTBEAT_MS = 15_000;
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

  socket.on('message', (raw) => {
    if (!messageBucket.tryRemove()) return; // rate-limited: silently drop
    // Guard the whole dispatch so one malformed-but-decodable message hitting a buggy handler can't
    // throw out of the ws 'message' callback and crash the server for everyone.
    runGuarded(
      'client-message',
      () => {
        const msg = decodeClient(raw.toString());
        if (!msg) return;

        switch (msg.t) {
          case 'join': {
            if (entityId !== 0) return; // already joined
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
                  },
                  listPlayers: () => world.playerNames(),
                  setAccessFor: (u, lvl) => setAccess(getDb(), u, lvl),
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
setInterval(() => {
  // Guard the whole tick: a throw from one corrupt entity/instance must not kill the interval and
  // freeze the world for everyone. On throw we skip this tick and carry on next frame.
  runGuarded(
    'tick',
    () => {
      const transfers = manager.tick(dt);
      tick++;

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

      // Apply portal crossings: update routing and tell the player their area changed.
      for (const ev of transfers) {
        const p = players.get(ev.entityId);
        if (!p) continue;
        p.instanceId = ev.toInstanceId;
        send(p.socket, { t: 'area_changed', areaId: ev.toAreaId, instanceId: ev.toInstanceId });
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
            send(socket, { t: 'stash', items: offer.items, cap: offer.cap });
          }
        }
      }
    },
    (label) => guardStats.record(label),
  );
}, 1000 / TICK_RATE);

// Periodic autosave: persist every connected character so progress survives a server crash, not
// just a clean disconnect. Cheap (a handful of upserts) and infrequent.
setInterval(() => {
  const db = getDb();
  for (const [id, p] of players) {
    const save = manager.get(p.instanceId)?.world.exportPlayer(id);
    if (save) storeSave(db, p.token, save);
  }
}, 20_000);

// Social liveness: once a second, refresh party rosters (HP/level/area move) and keep each online
// player's presence (level) current so friends lists reflect it. Cheap — parties + friends are tiny.
setInterval(() => {
  for (const [id, p] of players) {
    const lvl = manager.get(p.instanceId)?.world.playerStats(id)?.level;
    if (lvl !== undefined)
      social.updatePresence(p.token, manager.get(p.instanceId)?.areaId ?? '', lvl);
    if (parties.partyOf(id)) sendPartyState(id);
  }
}, 1000);

// Invasion events: every so often a populated, non-town instance is raided by a champion wave — a
// spontaneous group fight that turns a quiet farm into an onslaught.
setInterval(() => {
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
}, INVASION_INTERVAL_MS);

// "The forces of darkness grow stronger/weaker" — announce per-area corruption tier crossings
// (no numeric meter), broadcast to every instance of the area whose darkness shifted.
setInterval(() => {
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

http.listen(PORT, () => {
  console.log(`[browsergame] world server on :${PORT} @ ${TICK_RATE}Hz · instancing=${INSTANCING}`);
  console.log(`[browsergame] in dev, open the Vite url; it proxies /ws to this server.`);
});
