// Measure server tick health as a single instance fills with bots — to find the per-instance
// player cap where the 20Hz (50ms) tick budget breaks. Joins one observer, then ramps bot count
// in steps, sampling the inter-snapshot gap (a direct proxy for whether the tick keeps up) and the
// visible mob count at each density. Run against a server whose /bot colocates bots in one instance.
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
const URL = process.argv[2] ?? 'ws://localhost:8080/ws';
const STEPS = (process.argv[3] ?? '50,100,200,350,500').split(',').map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(URL);
let lastSnap = 0;
let gaps = [];
let mobs = 0;
let players = 0;
ws.on('error', (e) => {
  console.log('[ws error]', e.message);
  process.exit(1);
});
ws.on('message', (raw) => {
  let m;
  try {
    m = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (m.t === 'snapshot') {
    const now = performance.now();
    if (lastSnap) gaps.push(now - lastSnap);
    lastSnap = now;
    mobs = m.entities.filter((e) => e.kind === 'mob').length;
    players = m.entities.filter((e) => e.kind === 'player').length;
  }
});

const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)] : 0);

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Density', v: 1 })));
await sleep(1500);
ws.send(JSON.stringify({ t: 'chat', text: '/login dev changeme' }));
await sleep(600);

let spawned = 0;
console.log('target | gap p50 | gap p99 | gap max | mobs(AoI) | players(AoI)');
for (const target of STEPS) {
  const add = target - spawned;
  if (add > 0) ws.send(JSON.stringify({ t: 'chat', text: `/bot ${add}` }));
  spawned = target;
  await sleep(3000); // let it settle + density scale up
  gaps = [];
  await sleep(5000); // sample window
  console.log(
    `${String(target).padStart(6)} | ${pct(gaps, 0.5).toFixed(1).padStart(7)} | ${pct(gaps, 0.99).toFixed(1).padStart(7)} | ${Math.max(
      ...gaps,
      0,
    )
      .toFixed(0)
      .padStart(7)} | ${String(mobs).padStart(9)} | ${String(players).padStart(11)}`,
  );
}
ws.send(JSON.stringify({ t: 'chat', text: '/bot clear' }));
await sleep(1500);
console.log(
  '(50ms = perfect 20Hz; gap p99 climbing well past 50 means the tick is falling behind)',
);
ws.close();
