/**
 * Replay tests: drive the REAL BotBrain from a small committed JSONL fixture through the
 * same message→state path the live client uses (world-state.ts), with no server and no
 * sockets. The fixture (fixtures/approaching-mob.jsonl) is a hand-written grind session:
 * welcome + content (town stub) + you, then 17 snapshots of a mob walking in from the
 * east (x 1400 → 950) toward the stationary bot at (800, 600).
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { BotBrain } from './behaviors.js';
import { replayBrain } from './replay.js';

const FIXTURE = join(
  fileURLToPath(new URL('.', import.meta.url)),
  'fixtures',
  'approaching-mob.jsonl',
);

/** Fixed rng + epoch so two brains are behaviorally identical. */
function freshBrain(): BotBrain {
  return new BotBrain('grind', () => 0.5, 0);
}

describe('replayBrain — approaching-mob fixture', () => {
  it('produces one decision per snapshot, all in FIGHT (mob is always the priority)', () => {
    const decisions = replayBrain(FIXTURE, freshBrain());
    expect(decisions).toHaveLength(17);
    expect(decisions.every((d) => d.state === 'FIGHT')).toBe(true);
  });

  it('closes toward the distant mob without casting', () => {
    const decisions = replayBrain(FIXTURE, freshBrain());
    // First 6 snapshots: mob at x 1400..1150 — beyond ATTACK_RANGE (300), so walk east.
    for (const d of decisions.slice(0, 6)) {
      expect(d.action.cast).toBeUndefined();
      expect(d.action.input.right).toBe(true);
      expect(d.action.input.left).toBe(false);
    }
  });

  it('opens fire once the mob is in range, aimed at it, respecting the cast cooldown', () => {
    const decisions = replayBrain(FIXTURE, freshBrain());
    const castIndices = decisions.flatMap((d, i) => (d.action.cast ? [i] : []));
    // In range from t=700 (index 6); 450ms cooldown over 100ms snapshots → every 5th.
    expect(castIndices).toEqual([6, 11, 16]);
    const first = decisions[6]!.action.cast!;
    expect(first.ability).toBe('arrow');
    expect(first.dx).toBe(300); // mob at (1100, 600), bot at (800, 600)
    expect(first.dy).toBe(0);
  });

  it('is deterministic: two replays with equivalent brains yield identical decisions', () => {
    const a = replayBrain(FIXTURE, freshBrain());
    const b = replayBrain(FIXTURE, freshBrain());
    expect(a).toEqual(b);
  });
});
