/**
 * Bot squad coordination — pure logic that turns a loose group of AI bots into a cooperating party.
 *
 * The host (`index.ts`) groups every bot owned by the same GM into one squad and, each tick, calls
 * {@link coordinateSquad} with the squad's members and the mobs they can see. The result is a
 * {@link SquadContext} the host folds into each bot's {@link BotView.squad} so the pure brain
 * (`bot-brain.ts`) can act as a team: everyone focus-fires the SAME target, regroups when the party
 * scatters, and holds up to rescue a downed or low member instead of running to endgame solo.
 *
 * Like the brain, this file imports nothing from the World and is fully unit-testable. It is also
 * deterministic — no `Math.random` / `Date.now`; every choice is a function of the inputs (ties break
 * by entity id), so the same squad in the same situation always coordinates the same way.
 */

/** A bot's combat role, derived from its build. Drives how far it stands off and who it protects. */
export type BotRole = 'tank' | 'healer' | 'dps';

/** One squad member as the coordinator reads it (built by the host from each bot's stats). */
export interface SquadMemberInput {
  id: number;
  x: number;
  y: number;
  /** Current hp / maxHp in [0,1]; 0 when dead. */
  hpFrac: number;
  maxHp: number;
  level: number;
  dead: boolean;
  /** True if the bot has learned any heal spell — the support/healer signal. */
  hasHeal: boolean;
}

/** A mob the squad can see (the union of the members' nearby mobs, deduped by the host). */
export interface SquadMobInput {
  id: number;
  x: number;
  y: number;
  hp: number;
  level: number;
  boss: boolean;
  elite: boolean;
}

/** The shared coordination the whole squad acts on this tick. */
export interface SquadContext {
  /** Per-member role, keyed by bot id. */
  role: Map<number, BotRole>;
  /** The single target the squad concentrates fire on (id + position), if any is in range. */
  focusTargetId?: number;
  focusTarget?: { id: number; x: number; y: number; hp: number };
  /** Where scattered/rescuing members should converge; absent when the squad is gathered & safe. */
  rally?: { x: number; y: number };
  /** True when the squad should NOT push toward the next zone yet (spread out, or a member is down). */
  holdForParty: boolean;
  /** The living members' centroid — the squad's "where we are" anchor. */
  centroid: { x: number; y: number };
}

export interface SquadTuning {
  /** A member farther than this from the centroid is a straggler → regroup. */
  regroupRadius: number;
  /** Below this hp fraction a (living) member is "low" → the squad holds to protect it. */
  lowHpFrac: number;
  /** Only fold a mob into the focus pick if it is within this radius of the centroid. */
  engageRadius: number;
}

export const DEFAULT_SQUAD_TUNING: SquadTuning = {
  regroupRadius: 360,
  lowHpFrac: 0.35,
  engageRadius: 620,
};

/**
 * Coordinate a squad for one tick. Pure: depends only on the members, the visible mobs, and tuning.
 *
 * - **Roles**: every member that owns a heal is a `healer`; of the rest, the highest-maxHp living
 *   member is the `tank` (it engages first and bodies the focus target); everyone else is `dps`.
 * - **Focus fire**: pick ONE target near the squad centroid by priority boss → elite → most-wounded
 *   → nearest, so the whole squad collapses a single enemy instead of splitting damage.
 * - **Regroup & rescue**: if the party is spread past `regroupRadius`, or any living member is below
 *   `lowHpFrac`, or anyone is dead (respawning), set a rally point at the centroid and raise
 *   `holdForParty` so DPS stop pushing and the group re-forms / protects the casualty.
 */
export function coordinateSquad(
  members: SquadMemberInput[],
  mobs: SquadMobInput[],
  tuning: SquadTuning = DEFAULT_SQUAD_TUNING,
): SquadContext {
  const living = members.filter((m) => !m.dead);
  const centroid = centroidOf(living.length ? living : members);
  const role = assignRoles(members);

  const focus = pickFocusTarget(mobs, centroid, tuning.engageRadius);

  // Reasons to pull together rather than push on: a casualty, a low ally, or a scattered party.
  const anyDead = members.some((m) => m.dead);
  const anyLow = living.some((m) => m.hpFrac < tuning.lowHpFrac);
  const spread = living.some((m) => dist(m, centroid) > tuning.regroupRadius);
  const holdForParty = anyDead || anyLow || spread;

  const ctx: SquadContext = { role, holdForParty, centroid };
  if (focus) {
    ctx.focusTargetId = focus.id;
    ctx.focusTarget = { id: focus.id, x: focus.x, y: focus.y, hp: focus.hp };
  }
  // Rally only when there is something to re-form for AND we are not already on top of a fight: if a
  // focus target sits right in the middle of the squad, members should keep killing it, not retreat.
  if (holdForParty) ctx.rally = { ...centroid };
  return ctx;
}

/** healer = owns a heal; tank = the toughest remaining frontliner; the rest are dps. */
function assignRoles(members: SquadMemberInput[]): Map<number, BotRole> {
  const role = new Map<number, BotRole>();
  let tankId: number | undefined;
  let tankHp = -1;
  for (const m of members) {
    if (m.hasHeal) {
      role.set(m.id, 'healer');
      continue;
    }
    // Track the toughest non-healer as the tank (ties break to the lower id for determinism).
    if (
      !m.dead &&
      (m.maxHp > tankHp || (m.maxHp === tankHp && (tankId === undefined || m.id < tankId)))
    ) {
      tankHp = m.maxHp;
      tankId = m.id;
    }
  }
  for (const m of members) {
    if (role.has(m.id)) continue;
    role.set(m.id, m.id === tankId ? 'tank' : 'dps');
  }
  return role;
}

/** The one mob the squad should all hit: boss → elite → most-wounded → nearest centroid. */
function pickFocusTarget(
  mobs: SquadMobInput[],
  centroid: { x: number; y: number },
  engageRadius: number,
): SquadMobInput | undefined {
  let best: SquadMobInput | undefined;
  let bestRank = -1;
  let bestKey = Infinity;
  for (const m of mobs) {
    if (m.hp <= 0) continue;
    if (dist(m, centroid) > engageRadius) continue;
    const rank = m.boss ? 2 : m.elite ? 1 : 0;
    // Within a priority tier prefer the most-wounded (finish kills fast); break ties by nearest.
    const key = m.hp * 100000 + dist(m, centroid);
    if (rank > bestRank || (rank === bestRank && key < bestKey)) {
      best = m;
      bestRank = rank;
      bestKey = key;
    }
  }
  return best;
}

function centroidOf(pts: { x: number; y: number }[]): { x: number; y: number } {
  if (!pts.length) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
