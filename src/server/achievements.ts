/**
 * Achievements: milestones a character unlocks by crossing a stat threshold (reach level 10,
 * hoard 1000 gold). This module is **pure** — no World/DB/content imports. It works on a plain
 * stats record plus the set of already-earned ids passed in, so it is trivially unit-testable and
 * has no hidden state. Persistence (the earned set lives in the player save), the unlock check, and
 * a `/achievements` command are wired by the orchestrator elsewhere — not here.
 *
 * WHY only `level` and `gold`: those are the only metrics actually tracked on a character today.
 * Adding kills/rift-tier achievements now would create *dead* achievements no path ever unlocks, so
 * we deliberately seed only what the simulation can already satisfy.
 */

/** The character stats an achievement can key off — only metrics that already exist on a character. */
export type AchievementMetric = 'level' | 'gold';

/**
 * A single milestone. Earned when `stats[metric] >= threshold`. `threshold` is the inclusive bar:
 * exactly at the threshold counts as earned (so "reach level 10" fires at level 10, not 11).
 */
export interface AchievementDef {
  /** Stable id — persisted in the save and used as the dedupe key. Never rename in place. */
  id: string;
  /** Player-facing title (shown when announced / in `/achievements`). */
  name: string;
  /** One-line description of how it was earned. */
  desc: string;
  /** Which character stat this milestone watches. */
  metric: AchievementMetric;
  /** Inclusive bar: earned once the metric reaches this value. */
  threshold: number;
}

/**
 * The SEED SOURCE for achievements. Thematic tiers across the two live metrics, thresholds ascending
 * per metric so each tier is strictly harder than the last. The orchestrator seeds a content table
 * from this list; this array remains the canonical default.
 */
export const DEFAULT_ACHIEVEMENTS: readonly AchievementDef[] = [
  // Level tiers — the climb from novice to ascended hero.
  {
    id: 'level_apprentice',
    name: 'Apprentice',
    desc: 'Reach character level 10.',
    metric: 'level',
    threshold: 10,
  },
  {
    id: 'level_adept',
    name: 'Adept',
    desc: 'Reach character level 20.',
    metric: 'level',
    threshold: 20,
  },
  {
    id: 'level_veteran',
    name: 'Veteran',
    desc: 'Reach character level 35.',
    metric: 'level',
    threshold: 35,
  },
  {
    id: 'level_ascendant',
    name: 'Ascendant',
    desc: 'Reach character level 50.',
    metric: 'level',
    threshold: 50,
  },
  // Gold tiers — the long road from a full purse to a dragon's hoard.
  {
    id: 'gold_collector',
    name: 'Coin Collector',
    desc: 'Hold 500 gold at once.',
    metric: 'gold',
    threshold: 500,
  },
  {
    id: 'gold_flush',
    name: 'Flush',
    desc: 'Hold 2,500 gold at once.',
    metric: 'gold',
    threshold: 2500,
  },
  {
    id: 'gold_wealthy',
    name: 'Wealthy',
    desc: 'Hold 10,000 gold at once.',
    metric: 'gold',
    threshold: 10000,
  },
  {
    id: 'gold_tycoon',
    name: 'Tycoon',
    desc: 'Hold 50,000 gold at once.',
    metric: 'gold',
    threshold: 50000,
  },
];

/**
 * Is this achievement satisfied by the given stats? A missing metric reads as 0 (a character that
 * has never accrued gold simply has not earned any gold achievement). Inclusive threshold.
 */
export function isEarned(def: AchievementDef, stats: Readonly<Record<string, number>>): boolean {
  const value = stats[def.metric] ?? 0;
  return value >= def.threshold;
}

/**
 * Every DEFAULT achievement that is now satisfied by `stats` AND not already in `earned`. Returns the
 * full defs (not just ids) so the caller can announce names. Pure and deterministic: it does not
 * mutate `earned`, and results follow DEFAULT_ACHIEVEMENTS order. The caller adds the returned ids to
 * the save and notifies the player.
 */
export function newlyEarned(
  stats: Readonly<Record<string, number>>,
  earned: ReadonlySet<string>,
): AchievementDef[] {
  return DEFAULT_ACHIEVEMENTS.filter((def) => !earned.has(def.id) && isEarned(def, stats));
}

/** Look up a definition by id, or `undefined` if no such achievement exists. */
export function achievementById(id: string): AchievementDef | undefined {
  return DEFAULT_ACHIEVEMENTS.find((def) => def.id === id);
}
