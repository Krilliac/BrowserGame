// Benchmark the pure sim tick cost of a single combat-zone instance as it fills with players —
// the real per-instance ceiling (network/AoI are per-socket and cheap; the bite is tickMobs'
// O(mobs²) passes + the density scaling that balloons mob count with player count). For each
// player count it builds a wilderness World, scales the mob roster to that crowd via the live
// maintainDensity path, then times many ticks. Tick budget at 20Hz is 50ms.
import { initGameDb } from '../../src/server/content.js';
import { World } from '../../src/server/world.js';

initGameDb(':memory:');

const COUNTS = (process.argv[2] ?? '1,50,100,200,350,500').split(',').map(Number);
const TICKS = 200;

function bench(players: number): { mobs: number; avg: number; p99: number } {
  const area = { width: 1600 * 5, height: 1200 * 5 };
  const w = new World(area.width, area.height, { x: 800, y: 600 }, undefined, 'wilderness');
  w.populateMobs('wilderness');
  // Spread the crowd across the (5×) map and give each a move intent so the sim does real work.
  for (let i = 0; i < players; i++) {
    const id = w.spawn(`P${i}`, {
      x: 200 + ((i * 137) % (area.width - 400)),
      y: 200 + ((i * 251) % (area.height - 400)),
    });
    w.setLevel(id, 10 + (i % 30));
    w.setInput(id, { up: i % 2 === 0, down: i % 2 === 1, left: i % 3 === 0, right: i % 3 === 1 });
  }
  for (let i = 0; i < 40; i++) w.maintainDensity(); // scale mobs to the crowd
  const mobs = w.snapshot().filter((e) => e.kind === 'mob' && e.hp > 0).length;

  // Warm up, then time.
  for (let i = 0; i < 20; i++) w.tick(0.05);
  const samples: number[] = [];
  for (let i = 0; i < TICKS; i++) {
    const t0 = performance.now();
    w.tick(0.05);
    samples.push(performance.now() - t0);
    if (i % 20 === 0) w.maintainDensity(); // keep topping up as the crowd clears
  }
  samples.sort((a, b) => a - b);
  const avg = samples.reduce((s, x) => s + x, 0) / samples.length;
  return { mobs, avg, p99: samples[Math.floor(samples.length * 0.99)]! };
}

console.log('players | mobs | avg tick ms | p99 tick ms | within 50ms budget?');
for (const n of COUNTS) {
  const r = bench(n);
  const ok = r.p99 <= 50 ? 'OK' : r.p99 <= 50 / 0.5 ? 'TIGHT' : 'OVER';
  console.log(
    `${String(n).padStart(7)} | ${String(r.mobs).padStart(4)} | ${r.avg.toFixed(2).padStart(11)} | ${r.p99.toFixed(2).padStart(11)} | ${ok}`,
  );
}
