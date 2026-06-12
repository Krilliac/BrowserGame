/**
 * Offline replay: feed a recorded JSONL session (written by BotClient's record mode —
 * `--record` on stress.ts or the BOT_RECORD env var) through the SAME message→state path
 * the live client uses (world-state.ts), and collect the brain's decision after every
 * snapshot — the moments a live bot acts on fresh data. Same brain, swapped transport:
 * decisions become deterministic, diffable, and unit-testable against committed fixtures.
 */

import { readFileSync } from 'node:fs';
import { decodeServer } from '../../src/shared/protocol.js';
import type { BotBrain, BrainAction, BrainState } from './behaviors.js';
import { applyServerMessage, emptyWorldState, viewFrom } from './world-state.js';

/** One brain decision, taken right after the snapshot recorded at `t_ms`. */
export interface ReplayDecision {
  t_ms: number;
  /** Brain state after deciding (WANDER / FIGHT / LOOT / VENDOR / PORTAL_HOP). */
  state: BrainState;
  action: BrainAction;
}

/**
 * Replay a recorded session through `brain`. Each JSONL line is `{t_ms, msg}`; malformed
 * lines are skipped (same drop-don't-crash posture as the live client). The brain decides
 * once per snapshot, with `now` taken from the recording — wall-clock-free, so two replays
 * of the same file with equivalent brains produce identical decision sequences.
 */
export function replayBrain(jsonlPath: string, brain: BotBrain): ReplayDecision[] {
  const decisions: ReplayDecision[] = [];
  const state = emptyWorldState();
  for (const line of readFileSync(jsonlPath, 'utf8').split('\n')) {
    const record = parseRecord(line);
    if (!record) continue;
    // Round-trip through decodeServer so replay consumes exactly what a live decode would.
    const msg = decodeServer(JSON.stringify(record.msg));
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') continue;
    const kind = applyServerMessage(state, msg);
    if (kind !== 'snapshot') continue;
    brain.noteArea(state.areaId, record.t_ms);
    const action = brain.decide(viewFrom(state, record.t_ms));
    decisions.push({ t_ms: record.t_ms, state: brain.state, action });
  }
  return decisions;
}

function parseRecord(line: string): { t_ms: number; msg: unknown } | null {
  if (line.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object') return null;
    const { t_ms, msg } = parsed as { t_ms?: unknown; msg?: unknown };
    if (typeof t_ms !== 'number' || !Number.isFinite(t_ms) || msg === undefined) return null;
    return { t_ms, msg };
  } catch {
    return null;
  }
}
