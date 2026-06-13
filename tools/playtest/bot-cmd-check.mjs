// Verify the /bot GM command end-to-end against the running server: join, /login, /bot 4, and
// confirm bot player entities appear in the snapshot, move over time, and /bot clear removes them.
import WebSocket from 'ws';

const URL = process.argv[2] ?? 'ws://localhost:8080/ws';
const PROTOCOL_VERSION = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(URL);
let selfId = 0;
let players = new Map(); // id -> {x,y}
const log = [];

ws.on('error', (e) => console.log('[ws error]', e.message));
ws.on('close', (code) => log.push(`[closed ${code}]`));
ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Overseer', v: PROTOCOL_VERSION })));
ws.on('message', (raw) => {
  let m;
  try {
    m = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (m.t === 'welcome') selfId = m.id;
  if (m.t === 'snapshot') {
    players = new Map(m.entities.filter((e) => e.kind === 'player').map((e) => [e.id, e]));
  }
  if (m.t === 'chat' && m.from === 'System') log.push(m.text);
});

await sleep(1500);
ws.send(JSON.stringify({ t: 'chat', text: '/login dev changeme' }));
await sleep(600);
ws.send(JSON.stringify({ t: 'chat', text: '/bot 4' }));
await sleep(1500);
const afterSpawn = players.size;
const positions1 = new Map(
  [...players].map(([id, e]) => [id, `${e.x.toFixed(1)},${e.y.toFixed(1)}`]),
);

await sleep(2500); // let the bots roam/fight
let moved = 0;
for (const [id, e] of players) {
  if (id === selfId) continue;
  if (positions1.get(id) !== `${e.x.toFixed(1)},${e.y.toFixed(1)}`) moved++;
}

ws.send(JSON.stringify({ t: 'chat', text: '/bot clear' }));
await sleep(1500);
const afterClear = players.size;

console.log(`login/bot replies: ${log.filter((t) => /bot|access|Logged/i.test(t)).join(' | ')}`);
console.log(`players after /bot 4: ${afterSpawn} (expect 5: you + 4 bots)`);
console.log(`bots that moved over 2.5s: ${moved} (expect > 0 — they roam/fight)`);
console.log(`players after /bot clear: ${afterClear} (expect 1: just you)`);
ws.close();
