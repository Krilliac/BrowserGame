/**
 * Ladder / leaderboard — a tiny persistent "best ever" board keyed by character name (the D2R/PoE
 * ladder, cut to essentials). The server is the SOLE writer (scores come from the authoritative save
 * during autosave), so there's no new client-trust surface. Each (name, metric) keeps the MAXIMUM
 * value ever recorded, so the board only ever climbs — a character can't drop the ladder by, say,
 * spending gold.
 *
 * Pure data access over the `leaderboard` table; no game logic. The host records scores on autosave
 * and exposes reads to the `/ladder` command.
 */

import type { GameDatabase } from './db/database.js';

/** The ranked metrics. Both come straight off the persisted character save (no extra tracking). */
export type LeaderboardMetric = 'level' | 'gold';

export const LEADERBOARD_METRICS: LeaderboardMetric[] = ['level', 'gold'];

/** True for a metric the board tracks (guards the `/ladder` arg at the boundary). */
export function isLeaderboardMetric(s: string): s is LeaderboardMetric {
  return (LEADERBOARD_METRICS as string[]).includes(s);
}

/**
 * Record a character's score for a metric, keeping the MAX ever seen. Idempotent: re-recording the
 * same or a lower value is a no-op (the `WHERE excluded.value > ...` guard), so calling this every
 * autosave is cheap and never lowers a standing. `at` is a wall-clock ms stamp (ties break by who
 * reached the value first).
 */
export function recordScore(
  db: GameDatabase,
  name: string,
  metric: LeaderboardMetric,
  value: number,
  at: number,
): void {
  db.prepare(
    `INSERT INTO leaderboard (name, metric, value, achieved_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(name, metric) DO UPDATE SET value = excluded.value, achieved_at = excluded.achieved_at
       WHERE excluded.value > leaderboard.value`,
  ).run(name, metric, value, at);
}

/** One ranked entry. */
export interface LeaderRow {
  name: string;
  value: number;
}

/**
 * The top `limit` characters for a metric, highest first (ties broken by who reached it earliest).
 * `limit` is clamped to a sane 1..100 so a caller can't ask for an unbounded scan.
 */
export function topScores(db: GameDatabase, metric: LeaderboardMetric, limit = 10): LeaderRow[] {
  const n = Math.max(1, Math.min(100, Math.floor(limit)));
  return db
    .prepare(
      'SELECT name, value FROM leaderboard WHERE metric = ? ORDER BY value DESC, achieved_at ASC LIMIT ?',
    )
    .all(metric, n) as LeaderRow[];
}

/** Format the top scores for a metric as a compact chat-friendly block (for the `/ladder` command). */
export function formatLadder(db: GameDatabase, metric: LeaderboardMetric, limit = 10): string {
  const rows = topScores(db, metric, limit);
  if (rows.length === 0) return `No ${metric} ladder entries yet.`;
  const lines = rows.map((r, i) => `${i + 1}. ${r.name} — ${Math.round(r.value)}`);
  return `Top ${metric}:\n${lines.join('\n')}`;
}
