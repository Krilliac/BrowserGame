/**
 * Timed status effects on a single entity — debuffs on monsters (SLOW, BURN, WEAKEN) and buffs on
 * players (MIGHT, HASTE, REGEN). One generic, server-owned, tick-driven set powers both.
 *
 * Server-owned, pure, and tick-driven: time only advances via an explicit `dtMs`
 * passed to `tick()`. No `Date.now`, no randomness, no I/O — so the simulation is
 * deterministic and unit-testable.
 */

export type StatusId =
  // Monster debuffs:
  | 'slow' // reduces movement
  | 'burn' // damage over time
  | 'weaken' // reduces the monster's outgoing damage
  // Player buffs:
  | 'might' // increases the player's outgoing damage
  | 'haste' // faster attacks (lower cooldowns) + faster movement
  | 'regen'; // heal over time

/** Lowest movement multiplier slow can ever produce (so a slow can't fully freeze). */
const SLOW_FACTOR_FLOOR = 0.2;
/** Floors so a single debuff/buff can't fully zero a stat. */
const WEAKEN_FACTOR_FLOOR = 0.25;
const HASTE_COOLDOWN_FLOOR = 0.4;

/** Result of advancing a StatusSet by some dt. */
export interface StatusTickResult {
  /** Total burn (damage-over-time) damage dealt this tick. */
  burnDamage: number;
  /** Total regen (heal-over-time) restored this tick. */
  regenHeal: number;
}

/** Internal per-status state: how long it lasts and how strong it is. */
interface StatusState {
  remainingMs: number;
  magnitude: number;
}

/**
 * A set of timed status effects on a single entity. Server-owned; pure and tick-driven.
 * - 'slow' reduces movement: slowFactor() returns a multiplier in (0,1].
 * - 'burn' deals damage over time, reported from tick().
 */
export class StatusSet {
  private readonly effects = new Map<StatusId, StatusState>();

  /**
   * Apply (or refresh) a status. Re-applying refreshes duration and takes the stronger
   * magnitude. Refresh rule: `remainingMs = max(remaining, durationMs)` so a fresh hit
   * never shortens an existing effect, and `magnitude = max(existing, new)` so the
   * stronger effect wins. Non-positive durations/magnitudes are ignored.
   */
  apply(id: StatusId, durationMs: number, magnitude: number): void {
    if (durationMs <= 0 || magnitude <= 0) return;

    const existing = this.effects.get(id);
    if (existing) {
      existing.remainingMs = Math.max(existing.remainingMs, durationMs);
      existing.magnitude = Math.max(existing.magnitude, magnitude);
      return;
    }

    this.effects.set(id, { remainingMs: durationMs, magnitude });
  }

  /**
   * Advance all effects by dtMs, expiring finished ones. Returns the burn damage dealt
   * this tick.
   *
   * Burn accounting counts only the *active* elapsed time: if burn expires partway
   * through the tick, damage is `magnitude * (activeMs / 1000)` rather than the full dt.
   */
  tick(dtMs: number): StatusTickResult {
    let burnDamage = 0;
    let regenHeal = 0;
    if (dtMs <= 0) return { burnDamage, regenHeal };

    for (const [id, state] of this.effects) {
      const activeMs = Math.min(state.remainingMs, dtMs);

      if (id === 'burn') burnDamage += state.magnitude * (activeMs / 1000);
      else if (id === 'regen') regenHeal += state.magnitude * (activeMs / 1000);

      state.remainingMs -= dtMs;
      if (state.remainingMs <= 0) this.effects.delete(id);
    }

    return { burnDamage, regenHeal };
  }

  private mag(id: StatusId): number {
    return this.effects.get(id)?.magnitude ?? 0;
  }

  /**
   * Movement multiplier from active slow (1 = normal speed; e.g. 0.5 = half). No slow => 1.
   * The slow magnitude is the fractional slow amount in [0,1) (e.g. 0.4 => 0.6); the result
   * is clamped to a sane floor so a huge magnitude can't stop an entity dead.
   */
  slowFactor(): number {
    const slow = this.effects.get('slow');
    if (!slow) return 1;
    return Math.max(SLOW_FACTOR_FLOOR, 1 - slow.magnitude);
  }

  /** Monster outgoing-damage multiplier from WEAKEN (1 = normal; floored so it can't hit zero). */
  weakenFactor(): number {
    return Math.max(WEAKEN_FACTOR_FLOOR, 1 - this.mag('weaken'));
  }

  /** Player outgoing-damage multiplier from MIGHT (1 = normal; e.g. magnitude 0.3 => 1.3). */
  damageFactor(): number {
    return 1 + this.mag('might');
  }

  /** Player cooldown multiplier from HASTE (lower = faster attacks; floored). */
  cooldownFactor(): number {
    return Math.max(HASTE_COOLDOWN_FLOOR, 1 - this.mag('haste'));
  }

  /** Player movement multiplier from HASTE (1 = normal; e.g. magnitude 0.35 => 1.35). */
  moveFactor(): number {
    return 1 + this.mag('haste');
  }

  /** Whether a given status is currently active. */
  has(id: StatusId): boolean {
    return this.effects.has(id);
  }

  /** Number of active effects (for tests/inspection). */
  get size(): number {
    return this.effects.size;
  }

  /** Remove all effects. */
  clear(): void {
    this.effects.clear();
  }
}
