import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { World } from './world.js';
import {
  DEFAULT_TICK_RATE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  decodeClient,
  encode,
  type ServerMessage,
} from '../shared/protocol.js';

const PORT = Number(process.env.PORT ?? 8080);
const TICK_RATE = Number(process.env.TICK_RATE ?? DEFAULT_TICK_RATE);
const ENGINE_ADMIN_TOKEN = process.env.ENGINE_ADMIN_TOKEN ?? '';

const here = fileURLToPath(new URL('.', import.meta.url));
const clientDir = join(here, '..', 'client'); // dist/client after build

const world = new World();
const sockets = new Map<number, WebSocket>();

// --- HTTP: health check + static hosting of the built client in production -----------
const http = createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: world.population, tickRate: TICK_RATE }));
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
const wss = new WebSocketServer({ server: http, path: '/ws' });

wss.on('connection', (socket) => {
  let id = 0;

  socket.on('message', (raw) => {
    const msg = decodeClient(raw.toString());
    if (!msg) return;

    switch (msg.t) {
      case 'join': {
        if (id !== 0) return; // already joined
        id = world.spawn(msg.name);
        sockets.set(id, socket);
        send(socket, {
          t: 'welcome',
          id,
          tickRate: TICK_RATE,
          world: { w: WORLD_WIDTH, h: WORLD_HEIGHT },
        });
        break;
      }
      case 'input': {
        if (id !== 0) world.setInput(id, msg.input);
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
    if (id !== 0) {
      world.remove(id);
      sockets.delete(id);
    }
  });
});

function send(socket: WebSocket, msg: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(encode(msg));
}

// --- Fixed-timestep authoritative loop ------------------------------------------------
const dt = 1 / TICK_RATE;
let tick = 0;
setInterval(() => {
  world.tick(dt);
  tick++;
  const snapshot = encode({ t: 'snapshot', tick, entities: world.snapshot() });
  for (const socket of sockets.values()) {
    if (socket.readyState === socket.OPEN) socket.send(snapshot);
  }
}, 1000 / TICK_RATE);

http.listen(PORT, () => {
  console.log(`[browsergame] authoritative server on :${PORT} @ ${TICK_RATE}Hz`);
  console.log(`[browsergame] in dev, open the Vite url; it proxies /ws to this server.`);
});
