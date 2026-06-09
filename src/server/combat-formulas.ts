/**
 * Pure, OSRS-inspired (simplified) combat math. The authoritative World can layer these on
 * top of the ability system to add hit/miss accuracy and damage variance.
 *
 * Faithful in spirit to OSRS's two-roll model (does it hit, then how much) but stripped of
 * gear/prayer/potion stacks. All randomness is injected via an `rng: () => number` in [0,1)
 * (default Math.random) so every function is deterministic and unit-testable. No Date, no
 * globals. See wiki/research/runescape-mechanics.md §4 for the source formulas.
 */

/** Effective-level offset added to a skill before rolling (OSRS uses +8 on the stance stack). */
const EFFECTIVE_LEVEL_OFFSET = 8;

/**
 * Max-hit scaling constant. `maxHit = floor(1 + (strength + bonus) * MAX_HIT_K)` lands a
 * strength ~20 in the mid-20s (1 + 20*1.2 = 25), fitting our ~10-30 damage band.
 */
const MAX_HIT_K = 1.2;

/**
 * Effective offensive roll from an attacker's level + an equipment/ability accuracy bonus.
 * A clean linear effective level: `attackLevel + 8 + accuracyBonus`.
 */
export function attackRoll(attackLevel: number, accuracyBonus = 0): number {
  return attackLevel + EFFECTIVE_LEVEL_OFFSET + accuracyBonus;
}

/**
 * Effective defensive roll from a defender's level + a defence bonus.
 * Same linear shape as {@link attackRoll}: `defenceLevel + 8 + defenceBonus`.
 */
export function defenceRoll(defenceLevel: number, defenceBonus = 0): number {
  return defenceLevel + EFFECTIVE_LEVEL_OFFSET + defenceBonus;
}

/**
 * OSRS-style hit chance in [0,1] from the two rolls. Piecewise: when the attacker is favored
 * (attack > defence) the chance climbs toward but never reaches 1; otherwise it scales up from
 * the unfavored branch. Result is clamped to [0,1].
 */
export function hitChance(attack: number, defence: number): number {
  let chance: number;
  if (attack > defence) {
    chance = 1 - (defence + 2) / (2 * (attack + 1));
  } else {
    chance = attack / (2 * (defence + 1));
  }
  return Math.min(1, Math.max(0, chance));
}

/** Whether an attack lands, given the two rolls and an rng. */
export function rolledHit(
  attack: number,
  defence: number,
  rng: () => number = Math.random,
): boolean {
  return rng() < hitChance(attack, defence);
}

/**
 * Max hit from a strength stat + a damage bonus. OSRS-inspired but scaled to our ~10-30 damage
 * band: `floor(1 + (strength + damageBonus) * MAX_HIT_K)`. Negative inputs are clamped to 0.
 */
export function maxHit(strength: number, damageBonus = 0): number {
  return Math.floor(1 + Math.max(0, strength + damageBonus) * MAX_HIT_K);
}

/** A damage roll in [0, maxHitValue] inclusive (uniform), via rng. */
export function rollDamage(maxHitValue: number, rng: () => number = Math.random): number {
  return Math.floor(rng() * (maxHitValue + 1));
}

/** The outcome of resolving a single attack. */
export interface AttackResult {
  hit: boolean;
  damage: number;
}

/** Convenience: resolve one attack. Returns {hit, damage} (damage 0 on a miss). */
export function resolveAttack(
  params: {
    attackLevel: number;
    accuracyBonus?: number;
    strength: number;
    damageBonus?: number;
    defenceLevel: number;
    defenceBonus?: number;
  },
  rng: () => number = Math.random,
): AttackResult {
  const attack = attackRoll(params.attackLevel, params.accuracyBonus);
  const defence = defenceRoll(params.defenceLevel, params.defenceBonus);
  const hit = rolledHit(attack, defence, rng);
  const damage = hit ? rollDamage(maxHit(params.strength, params.damageBonus), rng) : 0;
  return { hit, damage };
}
