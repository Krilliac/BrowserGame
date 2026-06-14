/**
 * Hirelings — friendly mercenary allies a player hires from the town Recruiter NPC.
 *
 * Mirrors the mobs.ts pattern: templates define the roster, and the per-tick AI step is a
 * pure function (follow your owner; engage nearby monsters) so it is unit-testable without a
 * World. The World owns the stateful parts: spawning, damage, death, persistence, and the
 * actual attacks (melee hits / friendly projectiles), with kill credit flowing to the owner.
 */

export interface HirelingTemplate {
  type: string;
  name: string;
  behavior: 'melee' | 'ranged';
  /** Movement speed (px/s) — a touch above PLAYER_SPEED so it never trails its owner. */
  speed: number;
  attackRange: number;
  /** Ranged only: hold-fire band — retreat when a target gets closer than this. */
  kiteRange?: number;
  attackCooldownMs: number;
}

/**
 * Code DEFAULTS for the hireling roster — the seed source for the `hireling_templates` content table
 * and the fallback the live {@link HIRELING_TEMPLATES} resets to. Treat as immutable; edit via the DB.
 */
export const DEFAULT_HIRELING_TEMPLATES: Record<string, HirelingTemplate> = {
  guard: {
    type: 'guard',
    name: 'Guard',
    behavior: 'melee',
    speed: 190,
    attackRange: 40,
    attackCooldownMs: 1100,
  },
  marksman: {
    type: 'marksman',
    name: 'Marksman',
    behavior: 'ranged',
    speed: 190,
    attackRange: 230,
    kiteRange: 120,
    attackCooldownMs: 1500,
  },
};

/**
 * The LIVE hireling roster (overlaid from the `hireling_templates` DB table at load). Cleared and
 * repopulated in place by {@link applyHirelingOverrides} so a hireling added via SQL appears.
 */
export const HIRELING_TEMPLATES: Record<string, HirelingTemplate> = {
  ...DEFAULT_HIRELING_TEMPLATES,
};

/** Replace the live roster; an empty list RESETS to {@link DEFAULT_HIRELING_TEMPLATES}. In place. */
export function applyHirelingOverrides(list: HirelingTemplate[]): void {
  for (const type of Object.keys(HIRELING_TEMPLATES)) delete HIRELING_TEMPLATES[type];
  const src = list.length ? list : Object.values(DEFAULT_HIRELING_TEMPLATES);
  for (const t of src) HIRELING_TEMPLATES[t.type] = t;
}

export function hirelingTemplate(type: string): HirelingTemplate | undefined {
  return HIRELING_TEMPLATES[type];
}

/** Hire price scales with the owner's level (a recurring gold sink — death voids the contract). */
export function hirelingCost(ownerLevel: number): number {
  return 150 + 60 * ownerLevel;
}

/** Stats scale with the owner's level so the companion stays relevant without out-leveling them. */
export function hirelingStats(level: number): { maxHp: number; power: number } {
  return { maxHp: 50 + 16 * level, power: 4 + Math.round(2.2 * level) };
}

/** Stay at the owner's side when idle. */
export const HIRELING_FOLLOW_DIST = 56;
/** Only fight monsters this close to the hireling (and roughly this close to the owner). */
export const HIRELING_ENGAGE_RANGE = 240;
/** Beyond this distance from the owner, break off combat and run back. */
export const HIRELING_LEASH = 380;

export interface HirelingView {
  x: number;
  y: number;
  template: HirelingTemplate;
  attackReady: boolean;
}

/** A potential target (a living monster) as the step function sees it. */
export interface HirelingTargetView {
  id: number;
  x: number;
  y: number;
  alive: boolean;
}

export interface HirelingIntent {
  /** Desired velocity (px/s); the World applies dt and clamps to bounds. */
  vx: number;
  vy: number;
  facing: number | null;
  /** Mob id to hit this tick, or null. */
  attackTargetId: number | null;
}

const IDLE: HirelingIntent = { vx: 0, vy: 0, facing: null, attackTargetId: null };

/**
 * One AI step: leash to the owner first (never stray), otherwise fight the nearest living
 * monster near the pair, otherwise heel to the owner's side.
 */
export function stepHireling(
  h: HirelingView,
  owner: { x: number; y: number },
  targets: HirelingTargetView[],
): HirelingIntent {
  const t = h.template;
  const odx = owner.x - h.x;
  const ody = owner.y - h.y;
  const ownerDist = Math.hypot(odx, ody);

  // Too far from the owner: disengage and sprint back.
  if (ownerDist > HIRELING_LEASH) {
    const inv = 1 / ownerDist;
    return { vx: odx * inv * t.speed, vy: ody * inv * t.speed, facing: null, attackTargetId: null };
  }

  const target = nearestEngageable(h, owner, targets);
  if (target) {
    const dx = target.x - h.x;
    const dy = target.y - h.y;
    const dist = Math.hypot(dx, dy);
    const facing = Math.atan2(dy, dx);
    const inv = dist > 1e-6 ? 1 / dist : 0;

    if (t.behavior === 'ranged') {
      const kite = t.kiteRange ?? t.attackRange * 0.6;
      if (dist > t.attackRange) {
        return { vx: dx * inv * t.speed, vy: dy * inv * t.speed, facing, attackTargetId: null };
      }
      if (dist < kite) {
        return { vx: -dx * inv * t.speed, vy: -dy * inv * t.speed, facing, attackTargetId: null };
      }
      return { vx: 0, vy: 0, facing, attackTargetId: h.attackReady ? target.id : null };
    }

    if (dist <= t.attackRange) {
      return { vx: 0, vy: 0, facing, attackTargetId: h.attackReady ? target.id : null };
    }
    return { vx: dx * inv * t.speed, vy: dy * inv * t.speed, facing, attackTargetId: null };
  }

  // No fight: heel to the owner's side.
  if (ownerDist > HIRELING_FOLLOW_DIST) {
    const inv = 1 / ownerDist;
    return {
      vx: odx * inv * t.speed,
      vy: ody * inv * t.speed,
      facing: Math.atan2(ody, odx),
      attackTargetId: null,
    };
  }
  return IDLE;
}

/** Nearest living monster within engage range of the hireling that also stays near the owner. */
function nearestEngageable(
  h: HirelingView,
  owner: { x: number; y: number },
  targets: HirelingTargetView[],
): HirelingTargetView | null {
  let best: HirelingTargetView | null = null;
  let bestDist = HIRELING_ENGAGE_RANGE;
  for (const m of targets) {
    if (!m.alive) continue;
    // Never chase a monster that would drag the hireling past its leash from the owner.
    if (Math.hypot(m.x - owner.x, m.y - owner.y) > HIRELING_LEASH) continue;
    const dist = Math.hypot(m.x - h.x, m.y - h.y);
    if (dist <= bestDist) {
      best = m;
      bestDist = dist;
    }
  }
  return best;
}
