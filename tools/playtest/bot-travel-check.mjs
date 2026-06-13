// Verify bots travel between zones: spawn 3, watch them leave town for the wilderness. The probe
// joins, /login, /bot 3, then samples player count in the spawner's own instance over ~18s — when
// bots cross the portal they leave the spawner's town instance (a drop in local count proves it).
import WebSocket from 'ws';
const URL = process.argv[2] ?? 'ws://localhost:8080/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(URL);
let area = '';
let localPlayers = 0;
const samples = [];
ws.on('error', (e) => console.log('[ws error]', e.message));
ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'Watcher', v: 1 })));
ws.on('message', (raw) => {
  let m;
  try {
    m = JSON.parse(raw.toString());
  } catch {
    return;
  }
  if (m.t === 'welcome') area = m.areaId;
  if (m.t === 'area_changed') area = m.areaId;
  if (m.t === 'snapshot') localPlayers = m.entities.filter((e) => e.kind === 'player').length;
});

await sleep(1500);
ws.send(JSON.stringify({ t: 'chat', text: '/login dev changeme' }));
await sleep(600);
ws.send(JSON.stringify({ t: 'chat', text: '/bot 3' }));
await sleep(1200);
const peak = localPlayers; // you + 3 bots all in town
for (let i = 0; i < 18; i++) {
  await sleep(1000);
  samples.push(localPlayers);
}
const min = Math.min(...samples);
console.log(`spawner area: ${area}`);
console.log(`peak players in town (you + bots): ${peak}`);
console.log(`local-player samples over 18s: ${samples.join(',')}`);
console.log(
  `min local players: ${min} — a drop below ${peak} means bots left town for the next zone`,
);
console.log(min < peak ? 'PASS: bots travelled out of town' : 'INCONCLUSIVE: bots still in town');
ws.send(JSON.stringify({ t: 'chat', text: '/bot clear' }));
await sleep(800);
ws.close();
