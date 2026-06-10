import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { InstanceManager, type InstancingMode } from './instance-manager.js';
import { sanitizeChat } from './chat.js';
import { TokenBucket } from './rate-limit.js';
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
import { isValidToken, loadSave, newPlayerToken, storeSave } from './player-store.js';
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
  return encode({ t: 'content', areas: c.areas(), abilities: c.abilityList(), items: c.items() });
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
      }),
    );
    return;
  }
  await serveStatic(req.url ?? '/', res);
});

async function serveStatic(url: string, res: ServerResponse): Promise<void> {
  const safePath = normalize(url.split('?')[0] ?? '/').replace(/^(\.\.[/\\])+/, '');
  const target = join(clientDir, safePath === '/' ? 'index.html' : safePath);
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
            send(p.socket, { t: 'chat', from: 'System', text: 'Command failed (server error).' });
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
  });

  socket.on('close', () => {
    const p = players.get(entityId);
    if (p) {
      // Persist the character so this guest can reload it on reconnect.
      const save = manager.get(p.instanceId)?.world.exportPlayer(entityId);
      if (save) storeSave(getDb(), p.token, save);
      manager.remove(p.instanceId, entityId);
      players.delete(entityId);
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
  const transfers = manager.tick(dt);
  tick++;

  // Area corruption: fade it once on the shared pool, and reset it every morning (06:00 local).
  manager.corruption.decay(dt);
  if (
    manager.corruption.rolloverIfNewDay(morningDayIndex(Date.now(), new Date().getTimezoneOffset()))
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
  }

  // Each player only sees their own instance (instancing), and within it only the entities
  // near them (interest management) — built once per instance via a spatial grid.
  for (const instance of manager.list()) {
    const world = instance.world;
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
  }
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
