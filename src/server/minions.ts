/**
 * Summoned minions — the Diablo-necromancer pet line, but data-driven: a `kind:'summon'` ability
 * raises a minion from ANY creature whose {@link MobTemplate} is flagged `summonable`. The summoned
 * creature follows its summoner and fights nearby monsters, persisting until slain (no timer).
 *
 * Minions REUSE the hireling brain: they steer with the same pure {@link stepHireling} follow-and-
 * fight AI. They differ from hirelings only in ownership rules — a player may field MANY (up to
 * {@link MAX_MINIONS_PER_OWNER}), raised for mana rather than a single gold-hired contract, and they
 * crumble on death/area-change instead of voiding a contract. The combat stats, AI archetype, and
 * the rendered sprite all come from the source mob template, so flagging a new creature `summonable`
 * is the whole content cost of adding a new summon — no code change. The World owns spawning, damage,
 * death, and the attacks; this module is the pure mapping + tuning, mirroring hirelings.ts / mobs.ts.
 */

import type { HirelingTemplate } from './hirelings.js';
import type { MobTemplate } from './mobs.js';

/** The most minions one summoner may field at once (raising past the cap is refused). */
export const MAX_MINIONS_PER_OWNER = 5;

/** The resolved combat profile a minion animates with, derived once from its source mob template. */
export interface MinionProfile {
  templateId: string;
  name: string;
  /** Hireling-AI archetype (mob 'ranged' archetypes kite + fire; everything else melees). */
  behavior: 'melee' | 'ranged';
  speed: number;
  attackRange: number;
  kiteRange?: number;
  attackCooldownMs: number;
  /** Ranged minions: the projectile sprite to fire (the creature's own spell, else a plain arrow). */
  projectileAbility?: string;
  maxHp: number;
  power: number;
}

/** The HirelingTemplate-shaped view stepHireling needs, built from a resolved {@link MinionProfile}. */
export function minionAiTemplate(p: MinionProfile): HirelingTemplate {
  return {
    type: p.templateId,
    name: p.name,
    behavior: p.behavior,
    speed: p.speed,
    attackRange: p.attackRange,
    ...(p.kiteRange !== undefined ? { kiteRange: p.kiteRange } : {}),
    attackCooldownMs: p.attackCooldownMs,
  };
}

/**
 * Resolve a summonable mob template into a minion combat profile, scaled to the summoner's level.
 * A summoned creature is a touch hardier/faster than its owner can run so it never trails, but
 * individually weaker than its wild counterpart (you field a whole pack). Returns null if the
 * template is not flagged `summonable` (so bosses / arbitrary ids can't be raised).
 */
export function minionFromTemplate(t: MobTemplate, ownerLevel: number): MinionProfile | null {
  if (!t.summonable) return null;
  // A mob 'ranged' archetype (incl. spell-casters, which are 'ranged' + a `spell`) kites and fires;
  // melee/charger close and strike in melee.
  const ranged = t.behavior === 'ranged';
  return {
    templateId: t.id,
    name: t.name,
    behavior: ranged ? 'ranged' : 'melee',
    // Keep pace with a sprinting owner (a touch above PLAYER_SPEED, like hirelings).
    speed: Math.max(185, t.speed),
    attackRange: t.attackRange,
    ...(t.kiteRange !== undefined ? { kiteRange: t.kiteRange } : {}),
    attackCooldownMs: t.attackCooldownMs,
    ...(t.spell ? { projectileAbility: t.spell } : ranged ? { projectileAbility: 'arrow' } : {}),
    // Weaker than the wild creature (half its template HP) plus a per-owner-level bump for relevance.
    maxHp: Math.max(1, Math.round(t.hp * 0.5 + 8 * ownerLevel)),
    power: Math.max(1, Math.round(t.damage * 0.6 + 1.4 * ownerLevel)),
  };
}
