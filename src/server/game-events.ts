/**
 * Timed recurring liveops world events — the TrinityCore `GameEventMgr` idea cut to essentials.
 *
 * A *game event* is a thing that periodically switches on for a while then off again on a fixed
 * cadence: a Bloodmoon that rises every few hours and grants bonus XP, a Golden Hour that boosts
 * loot, etc. The whole point is to make the world feel alive on a clock without any per-event
 * bespoke code — one schedule definition drives everything.
 *
 * This module is deliberately **PURE**: it imports nothing from World/DB/content and touches no
 * wall clock. It only does schedule math against a caller-supplied `nowMs`. WHY: the authoritative
 * simulation must stay deterministic — calling `Date.now()` inside the sim would make replays and
 * tests non-reproducible. The host layer reads the wall clock once and passes it in (see the wiring
 * guide), so the sim itself never observes real time. `DEFAULT_GAME_EVENTS` is the seed source for
 * a future `game_events` table; the data-driven loader replaces it later without touching this math.
 */

/**
 * One recurring world event. Times are in **minutes** for human-friendly DB rows; this module
 * converts to ms internally.
 */
export interface GameEventDef {
  /** Stable id (also the DB primary key + the token a `/event` GM command would name). */
  id: string;
  /** Display name shown in UI / announcements. */
  name: string;
  /** How often an occurrence *starts*, in minutes. Must be > 0 or the event never fires. */
  periodMin: number;
  /** How long each occurrence stays active, in minutes. Must be > 0 or the event never fires. */
  lengthMin: number;
  /** Optional fractional XP boost while active (0.5 = +50%). Host multiplies XP by (1 + bonus). */
  xpBonus?: number;
  /** Optional chat line broadcast when an occurrence begins. */
  announce?: string;
}

/** Minutes → milliseconds. Kept local so callers think purely in the DB-friendly minute unit. */
const MS_PER_MIN = 60_000;

/**
 * Seed events — the source rows for a future `game_events` table. Two thematic recurring events:
 * a long-cadence, high-reward Bloodmoon and a shorter, more frequent loot-themed Golden Hour.
 * Tuning lives here only until the DB takes over; nothing in the sim should read this directly.
 */
export const DEFAULT_GAME_EVENTS: GameEventDef[] = [
  {
    id: 'bloodmoon',
    name: 'Bloodmoon Rising',
    periodMin: 360, // every 6 hours
    lengthMin: 30,
    xpBonus: 0.5, // +50% XP while the moon is up
    announce: 'A Bloodmoon rises — slain foes yield richer experience for the next 30 minutes.',
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    periodMin: 120, // every 2 hours
    lengthMin: 15,
    xpBonus: 0.25, // gold/loot-themed; modest XP nudge alongside it
    announce: 'The Golden Hour dawns — fortune favors the bold for the next 15 minutes.',
  },
];

/**
 * Is `ev` currently active, measured from `epochMs`?
 *
 * Occurrences start at `epochMs`, then every `periodMin` after that, and each lasts `lengthMin`.
 * The window is **start-inclusive, end-exclusive**: `[start, start + length)`. WHY exclusive end —
 * back-to-back occurrences (length === period) then tile the timeline with no overlap or gap.
 *
 * Pure and deterministic: same inputs always give the same answer.
 *
 * Edge cases:
 * - `periodMin <= 0` → false (a non-positive cadence has no occurrences).
 * - `lengthMin <= 0` → false (a zero/negative window is never active).
 * - `lengthMin >= periodMin` → always-on once started: every moment lands in some window.
 * - `nowMs < epochMs` (before the schedule begins) → false.
 */
export function isEventActive(ev: GameEventDef, nowMs: number, epochMs = 0): boolean {
  if (ev.periodMin <= 0 || ev.lengthMin <= 0) return false;

  const periodMs = ev.periodMin * MS_PER_MIN;
  const lengthMs = ev.lengthMin * MS_PER_MIN;

  const elapsed = nowMs - epochMs;
  if (elapsed < 0) return false; // schedule has not started yet

  // Always-on: each window is at least as long as the gap to the next, so we are never between them.
  if (lengthMs >= periodMs) return true;

  // Offset into the current period; active iff we are still inside this occurrence's window.
  const intoPeriod = elapsed % periodMs;
  return intoPeriod < lengthMs;
}

/**
 * The subset of `events` active right now. Convenience wrapper over {@link isEventActive} so the
 * host can broadcast a single "what's live" set to clients.
 */
export function activeEvents(
  events: readonly GameEventDef[],
  nowMs: number,
  epochMs = 0,
): GameEventDef[] {
  return events.filter((ev) => isEventActive(ev, nowMs, epochMs));
}

/**
 * Milliseconds until `ev` next flips active↔inactive, useful for scheduling the announcement /
 * end-of-event message instead of polling every tick.
 *
 * Returns `Number.POSITIVE_INFINITY` when the state can never change:
 * - the event never fires (`periodMin <= 0` or `lengthMin <= 0`), or
 * - it is always-on (`lengthMin >= periodMin`) — once started it never turns off.
 *
 * Before the schedule starts, returns the time until the first occurrence begins.
 */
export function msUntilNextChange(ev: GameEventDef, nowMs: number, epochMs = 0): number {
  if (ev.periodMin <= 0 || ev.lengthMin <= 0) return Number.POSITIVE_INFINITY;

  const periodMs = ev.periodMin * MS_PER_MIN;
  const lengthMs = ev.lengthMin * MS_PER_MIN;

  const elapsed = nowMs - epochMs;
  if (elapsed < 0) return -elapsed; // ms until the very first occurrence starts

  // Always-on once started: no future flip.
  if (lengthMs >= periodMs) return Number.POSITIVE_INFINITY;

  const intoPeriod = elapsed % periodMs;
  // Active now → flips off at the end of this window; inactive → flips on at the next period start.
  return intoPeriod < lengthMs ? lengthMs - intoPeriod : periodMs - intoPeriod;
}

/**
 * Sum of the `xpBonus` of every currently-active event (0 if none). The host multiplies an XP
 * reward by `(1 + totalXpBonus(...))`. Events with no `xpBonus` contribute nothing.
 */
export function totalXpBonus(events: readonly GameEventDef[], nowMs: number, epochMs = 0): number {
  let total = 0;
  for (const ev of events) {
    if (isEventActive(ev, nowMs, epochMs)) total += ev.xpBonus ?? 0;
  }
  return total;
}
