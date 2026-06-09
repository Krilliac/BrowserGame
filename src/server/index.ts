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

const PORT = Number(process.env.PORT ?? 8080);
const TICK_RATE = Number(process.env.TICK_RATE ?? DEFAULT_TICK_RATE);
const ENGINE_ADMIN_TOKEN = process.env.ENGINE_ADMIN_TOKEN ?? '';
const INSTANCING: InstancingMode = process.env.INSTANCING === 'single' ? 'single' : 'auto';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = join(here, '..', 'client'); // dist/client after build

const manager = new InstanceManager(INSTANCING);
/** Per-player connection state. instanceId is mutated on portal crossings; accessLevel via /login. */
const players = new Map<number, { socket: WebSocket; instanceId: string; accessLevel: number }>();

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

wss.on('connection', (socket) => {
  let entityId = 0;
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
        const placement = manager.join(msg.name);
        entityId = placement.entityId;
        players.set(entityId, { socket, instanceId: placement.instanceId, accessLevel: 0 });
        send(socket, {
          t: 'welcome',
          id: entityId,
          tickRate: TICK_RATE,
          areaId: placement.areaId,
          instanceId: placement.instanceId,
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
        if (p) manager.get(p.instanceId)?.world.equip(entityId, msg.itemId);
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
  }
}, 1000 / TICK_RATE);

http.listen(PORT, () => {
  console.log(`[browsergame] world server on :${PORT} @ ${TICK_RATE}Hz · instancing=${INSTANCING}`);
  console.log(`[browsergame] in dev, open the Vite url; it proxies /ws to this server.`);
});
