/**
 * Stress-test runner: spawn N behavior-driven bots against a running server and report
 * connection health, message throughput, and snapshot-cadence jitter.
 *
 *   npx tsx tools/bots/stress.ts --bots 50 --url ws://localhost:8080 --minutes 5 \
 *     --mix grind:70,wander:20,hopper:10
 *
 * One process comfortably drives ~100 bots (JSON encode/decode is the ceiling); shard
 * across processes beyond that. Exit code 0 when thresholds pass:
 *   - zero unexpected disconnects, and
 *   - final-window p99 snapshot gap < 3x the server tick interval.
 *
 * Record mode (`--record path.jsonl` or BOT_RECORD=path.jsonl): the FIRST bot appends every
 * brain-consumed server message as JSONL for offline replay through replay.ts.
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { BotClient } from './bot-client.js';
import { BotBrain, type BotProfile } from './behaviors.js';
import { viewFrom } from './world-state.js';

const WINDOW_MS = 5000;
const BRAIN_TICK_MS = 100;

interface WindowStats {
  atSec: number;
  connected: number;
  msgsInPerSec: number;
  msgsOutPerSec: number;
  gapMeanMs: number;
  gapP99Ms: number;
  snapBytesMean: number;
  snapBytesP99: number;
  disconnects: number;
  reconnects: number;
  decodeErrors: number;
}

function parseCli(): {
  bots: number;
  url: string;
  durationMs: number;
  mix: { profile: BotProfile; weight: number }[];
  /** JSONL path for record mode (first bot only) — `--record` flag or BOT_RECORD env var. */
  record: string | undefined;
} {
  const { values } = parseArgs({
    options: {
      bots: { type: 'string', default: '10' },
      url: { type: 'string', default: 'ws://localhost:8080' },
      minutes: { type: 'string' },
      seconds: { type: 'string' },
      mix: { type: 'string', default: 'grind:70,wander:20,hopper:10' },
      record: { type: 'string' },
    },
  });
  const bots = Math.max(1, Number(values.bots) || 10);
  const durationMs = values.seconds
    ? Number(values.seconds) * 1000
    : (Number(values.minutes) || 1) * 60_000;
  const mix: { profile: BotProfile; weight: number }[] = [];
  for (const part of (values.mix ?? '').split(',')) {
    const [name, w] = part.split(':');
    if (name === 'grind' || name === 'wander' || name === 'hopper') {
      mix.push({ profile: name, weight: Math.max(0, Number(w) || 0) });
    }
  }
  if (mix.length === 0) mix.push({ profile: 'grind', weight: 100 });
  const record = values.record ?? process.env.BOT_RECORD;
  return { bots, url: values.url ?? 'ws://localhost:8080', durationMs, mix, record };
}

function pickProfile(
  mix: { profile: BotProfile; weight: number }[],
  index: number,
  total: number,
): BotProfile {
  // Deterministic proportional assignment: bot i gets the profile owning that slice of [0,1).
  const sum = mix.reduce((s, m) => s + m.weight, 0) || 1;
  const point = ((index + 0.5) / total) * sum;
  let acc = 0;
  for (const m of mix) {
    acc += m.weight;
    if (point <= acc) return m.profile;
  }
  return mix[mix.length - 1]!.profile;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i]!;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

async function main(): Promise<void> {
  const cfg = parseCli();
  console.log(
    `[stress] ${cfg.bots} bots → ${cfg.url} for ${(cfg.durationMs / 1000).toFixed(0)}s · mix ${cfg.mix
      .map((m) => `${m.profile}:${m.weight}`)
      .join(',')}`,
  );

  const bots: { client: BotClient; brain: BotBrain }[] = [];
  let connectFailures = 0;

  // Staggered spawn: 50ms apart so the server never sees a thundering herd of joins.
  for (let i = 0; i < cfg.bots; i++) {
    const profile = pickProfile(cfg.mix, i, cfg.bots);
    const client = new BotClient({
      url: cfg.url,
      name: `bot-${profile.slice(0, 1)}${i}`,
      reconnect: true,
      // Record mode covers the first bot only — one coherent session, not N interleaved.
      ...(i === 0 && cfg.record ? { recordPath: cfg.record } : {}),
    });
    const brain = new BotBrain(profile);
    bots.push({ client, brain });
    client.connect().catch(() => {
      connectFailures++;
    });
    await new Promise((r) => setTimeout(r, 50));
  }

  // Brain loop: read the latest client state, decide, send intent. 10Hz is plenty —
  // the server holds the last input and integrates it every tick.
  const brainTimer = setInterval(() => {
    const now = Date.now();
    for (const { client, brain } of bots) {
      if (!client.connected) continue;
      brain.noteArea(client.areaId, now);
      const action = brain.decide(viewFrom(client.world, now));
      client.sendInput(action.input);
      if (action.cast) client.cast(action.cast.ability, action.cast.dx, action.cast.dy);
      if (action.interact) client.interact();
    }
  }, BRAIN_TICK_MS);

  // Metrics windows: drain per-bot samples every 5s, print a live one-liner.
  const windows: WindowStats[] = [];
  const startedAt = Date.now();
  let prevIn = 0;
  let prevOut = 0;
  const metricsTimer = setInterval(() => {
    const gaps: number[] = [];
    const bytes: number[] = [];
    let msgsIn = 0;
    let msgsOut = 0;
    let connected = 0;
    let disconnects = 0;
    let reconnects = 0;
    let decodeErrors = 0;
    for (const { client } of bots) {
      const m = client.metrics;
      gaps.push(...m.gapSamplesMs.splice(0));
      bytes.push(...m.snapshotBytes.splice(0));
      msgsIn += m.msgsIn;
      msgsOut += m.msgsOut;
      disconnects += m.unexpectedDisconnects;
      reconnects += m.reconnects;
      decodeErrors += m.decodeErrors;
      if (client.connected) connected++;
    }
    gaps.sort((a, b) => a - b);
    bytes.sort((a, b) => a - b);
    const w: WindowStats = {
      atSec: Math.round((Date.now() - startedAt) / 1000),
      connected,
      msgsInPerSec: Math.round((msgsIn - prevIn) / (WINDOW_MS / 1000)),
      msgsOutPerSec: Math.round((msgsOut - prevOut) / (WINDOW_MS / 1000)),
      gapMeanMs: Math.round(mean(gaps) * 10) / 10,
      gapP99Ms: percentile(gaps, 99),
      snapBytesMean: Math.round(mean(bytes)),
      snapBytesP99: percentile(bytes, 99),
      disconnects,
      reconnects,
      decodeErrors,
    };
    prevIn = msgsIn;
    prevOut = msgsOut;
    windows.push(w);
    process.stdout.write(
      `\r[${String(w.atSec).padStart(4)}s] conn ${w.connected}/${cfg.bots} · in ${w.msgsInPerSec}/s out ${w.msgsOutPerSec}/s · gap ${w.gapMeanMs}ms p99 ${w.gapP99Ms}ms · snap ${w.snapBytesMean}B p99 ${w.snapBytesP99}B · dc ${w.disconnects} rc ${w.reconnects} err ${w.decodeErrors}   `,
    );
  }, WINDOW_MS);

  await new Promise((r) => setTimeout(r, cfg.durationMs));
  clearInterval(brainTimer);
  clearInterval(metricsTimer);
  process.stdout.write('\n');

  // Verdict on the FINAL window: steady-state health, not the connect ramp.
  const last = windows[windows.length - 1];
  const tickRate = bots.find((b) => b.client.tickRate > 0)?.client.tickRate ?? 20;
  const gapThresholdMs = 3 * (1000 / tickRate);
  const totalDisconnects = last?.disconnects ?? 0;
  const pass =
    totalDisconnects === 0 &&
    connectFailures === 0 &&
    (last?.gapP99Ms ?? Infinity) < gapThresholdMs;

  for (const { client } of bots) client.close();

  console.log('\n=== stress summary ===');
  console.table(
    windows.map((w) => ({
      sec: w.atSec,
      conn: w.connected,
      'in/s': w.msgsInPerSec,
      'out/s': w.msgsOutPerSec,
      'gap ms': w.gapMeanMs,
      'gap p99': w.gapP99Ms,
      'snap B': w.snapBytesMean,
      'snap p99': w.snapBytesP99,
      dc: w.disconnects,
      rc: w.reconnects,
      err: w.decodeErrors,
    })),
  );
  console.log(
    `verdict: ${pass ? 'PASS' : 'FAIL'} · disconnects=${totalDisconnects} connectFailures=${connectFailures} ` +
      `finalGapP99=${last?.gapP99Ms ?? 'n/a'}ms (threshold <${gapThresholdMs}ms @ ${tickRate}Hz)`,
  );

  const reportPath = join(fileURLToPath(new URL('.', import.meta.url)), 'last-run.json');
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        config: { bots: cfg.bots, url: cfg.url, durationMs: cfg.durationMs, mix: cfg.mix },
        tickRate,
        gapThresholdMs,
        connectFailures,
        windows,
        verdict: pass ? 'PASS' : 'FAIL',
        finishedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`report: ${reportPath}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('[stress] fatal:', err);
  process.exit(1);
});
